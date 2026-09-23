import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { Router, type CookieOptions, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';
import { authenticate } from '../middleware/auth.js';
import { EmailOtp, type EmailOtpPurpose } from '../models/EmailOtp.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { User } from '../models/User.js';
import { sendMail } from '../services/mailer.js';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Replays of a just-rotated token within this window are usually two tabs
// sharing the cookie racing on refresh, not theft. Old replays still revoke.
const REPLAY_REVOKE_GRACE_MS = 10_000;

const NAME_REQUIRED = 'Name is required.';
const EMAIL_REQUIRED = 'Email is required.';
const EMAIL_INVALID = 'Enter a valid email address.';
const PASSWORD_INVALID = 'Password must be at least 8 characters.';
const CODE_INVALID = 'Enter the 6-digit code.';
const OTP_INVALID_MESSAGE = 'Invalid verification code.';
const OTP_EXPIRED_MESSAGE = 'This code has expired. Request a new one.';
const OTP_ATTEMPTS_MESSAGE = 'Too many failed attempts. Request a new code.';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_ATTEMPTS = 5;

const emailField = z
  .string({ required_error: EMAIL_REQUIRED, invalid_type_error: EMAIL_REQUIRED })
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    if (!value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: EMAIL_REQUIRED });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: EMAIL_INVALID });
    }
  });

const registerSchema = z.object({
  name: z
    .string({ required_error: NAME_REQUIRED, invalid_type_error: NAME_REQUIRED })
    .trim()
    .min(1, NAME_REQUIRED),
  email: emailField,
  password: z
    .string({ required_error: PASSWORD_INVALID, invalid_type_error: PASSWORD_INVALID })
    .min(8, PASSWORD_INVALID)
});

const codeField = z
  .string({ required_error: CODE_INVALID, invalid_type_error: CODE_INVALID })
  .regex(/^\d{6}$/, CODE_INVALID);

const registerVerifySchema = z.object({
  name: registerSchema.shape.name,
  email: emailField,
  password: registerSchema.shape.password,
  code: codeField
});

const forgotPasswordSchema = z.object({
  email: emailField
});

const resetPasswordSchema = z.object({
  email: emailField,
  code: codeField,
  newPassword: z
    .string({ required_error: PASSWORD_INVALID, invalid_type_error: PASSWORD_INVALID })
    .min(8, PASSWORD_INVALID)
});

const loginSchema = z.object({
  email: emailField,
  password: z.string({ required_error: PASSWORD_INVALID, invalid_type_error: PASSWORD_INVALID }).min(1, PASSWORD_INVALID)
});

type AuthUserRecord = { _id: unknown; email: string; name: string; role: string };

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

// Verify against a constant hash on unknown email so login response time does
// not reveal whether an account exists (no user enumeration).
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  return (dummyHashPromise ??= argon2.hash('exampro-timing-equalizer', { type: argon2.argon2id }));
}

function signAccessToken(user: AuthUserRecord): string {
  return jwt.sign(
    { id: String(user._id), email: user.email, role: user.role, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_TTL_MS / 1000 }
  );
}

const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
  path: '/'
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string, refreshExpiresAt: Date): void {
  res.cookie('accessToken', accessToken, { ...cookieBase, maxAge: ACCESS_TTL_MS });
  res.cookie('refreshToken', refreshToken, { ...cookieBase, expires: refreshExpiresAt });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('accessToken', cookieBase);
  res.clearCookie('refreshToken', cookieBase);
}

function authBody(user: AuthUserRecord, sessionExpiresAt: Date): object {
  return {
    user: { id: String(user._id), email: user.email, name: user.name, role: user.role },
    sessionExpiresAt: sessionExpiresAt.toISOString()
  };
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

const limiterResponse = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }
};

const limiterOptions = {
  windowMs: 60_000,
  standardHeaders: true as const,
  legacyHeaders: false as const,
  message: limiterResponse,
  // Rate limits are a production control; the test harness fires many
  // requests per minute from one IP per file and would exhaust even 10/min.
  skip: () => env.NODE_ENV === 'test'
};

// One limiter instance per route: sharing an instance would pool their budgets.
// Sends are throttled harder than verifies: a 6-digit code has a ~1e6 keyspace
// and send is the only client-controlled way to mint codes.
export const OTP_SEND_LIMIT = 5;
export const OTP_VERIFY_LIMIT = 10;
const registerLimiter = rateLimit({ ...limiterOptions, limit: OTP_SEND_LIMIT });
const registerVerifyLimiter = rateLimit({ ...limiterOptions, limit: OTP_VERIFY_LIMIT });
const forgotPasswordLimiter = rateLimit({ ...limiterOptions, limit: OTP_SEND_LIMIT });
const resetPasswordLimiter = rateLimit({ ...limiterOptions, limit: OTP_VERIFY_LIMIT });
const loginLimiter = rateLimit({ ...limiterOptions, limit: 10 });
const refreshLimiter = rateLimit({ ...limiterOptions, limit: 60 });

// --- Email OTP helpers -----------------------------------------------------

function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

async function storeEmailOtp(email: string, purpose: EmailOtpPurpose, code: string): Promise<Date> {
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  // Atomic upsert: a new send replaces the single active OTP for (email,
  // purpose) in one step, so concurrent sends cannot leave two live codes
  // (the (email, purpose) unique index backs this up).
  await EmailOtp.findOneAndUpdate(
    { email, purpose },
    { $set: { codeHash: hashToken(code), expiresAt, attemptsLeft: OTP_ATTEMPTS } },
    { upsert: true }
  );
  return expiresAt;
}

async function sendOtpEmail(to: string, code: string): Promise<void> {
  await sendMail({
    to,
    subject: 'Your ExamPro verification code',
    text: `Your ExamPro verification code is ${code}. It expires in 10 minutes.`
  });
}

/** Verifies a code against the active OTP for (email, purpose); consumes it on success. */
async function verifyEmailOtp(email: string, purpose: EmailOtpPurpose, code: string): Promise<void> {
  const otp = await EmailOtp.findOne({ email, purpose }).select('+codeHash');
  if (!otp) throw new AppError(400, 'OTP_INVALID', OTP_INVALID_MESSAGE);
  if (otp.expiresAt.getTime() < Date.now()) throw new AppError(400, 'OTP_EXPIRED', OTP_EXPIRED_MESSAGE);

  const expected = Buffer.from(otp.codeHash, 'hex');
  const actual = Buffer.from(hashToken(code), 'hex');
  if (!timingSafeEqual(expected, actual)) {
    // Atomic check-and-decrement: only guesses arriving while attemptsLeft > 0
    // consume a guess, so parallel wrong guesses cannot pierce the cap and the
    // counter can never go negative. A no-op means the code is already spent.
    const res = await EmailOtp.updateOne(
      { _id: otp._id, attemptsLeft: { $gt: 0 } },
      { $inc: { attemptsLeft: -1 } }
    );
    if (res.modifiedCount === 0) throw new AppError(400, 'OTP_ATTEMPTS_EXCEEDED', OTP_ATTEMPTS_MESSAGE);
    throw new AppError(400, 'OTP_INVALID', OTP_INVALID_MESSAGE);
  }

  // An exhausted code is dead even when the digits match.
  if (otp.attemptsLeft <= 0) throw new AppError(400, 'OTP_ATTEMPTS_EXCEEDED', OTP_ATTEMPTS_MESSAGE);

  // One-time use: a replayed code then fails as OTP_INVALID.
  await otp.deleteOne();
}

async function issueSession(user: AuthUserRecord): Promise<{ raw: string; expiresAt: Date }> {
  const { raw, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await RefreshSession.create({ userId: user._id, tokenHash: hash, expiresAt, revokedAt: null });
  return { raw, expiresAt };
}

export const authRouter = Router();

authRouter.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);

    // Step 1 of two: only the OTP is sent here. No account is created and no
    // session is issued until the code verifies at /register/verify.
    if (await User.exists({ email })) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }

    const code = generateOtpCode();
    // Store before sending: an email that arrives must always be verifiable.
    const otpExpiresAt = await storeEmailOtp(email, 'REGISTER', code);
    await sendOtpEmail(email, code);
    res.status(201).json({ email, otpExpiresAt: otpExpiresAt.toISOString() });
  })
);

authRouter.post(
  '/register/verify',
  registerVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { name, email, password, code } = registerVerifySchema.parse(req.body);
    await verifyEmailOtp(email, 'REGISTER', code);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    let user;
    try {
      // Role is always STUDENT on self-registration; never trust a client role.
      user = await User.create({ name, email, passwordHash, role: 'STUDENT' });
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
      }
      throw err;
    }

    const session = await issueSession(user);
    setAuthCookies(res, signAccessToken(user), session.raw, session.expiresAt);
    res.status(201).json(authBody(user, session.expiresAt));
  })
);

authRouter.post(
  '/forgot-password',
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);

    // Uniform machinery for every email, known or unknown: same response shape
    // AND the same server work (DB write + SMTP round-trip), so an attacker
    // cannot tell accounts apart by response shape or wall-clock timing. The
    // OTP stored for an unknown email is inert (reset-password still refuses
    // to verify a missing account) and expires via the TTL index in 10 minutes.
    const code = generateOtpCode();
    const otpExpiresAt = await storeEmailOtp(email, 'PASSWORD_RESET', code);
    await sendOtpEmail(email, code);
    res.json({ email, otpExpiresAt: otpExpiresAt.toISOString() });
  })
);

authRouter.post(
  '/reset-password',
  resetPasswordLimiter,
  asyncHandler(async (req, res) => {
    const { email, code, newPassword } = resetPasswordSchema.parse(req.body);
    await verifyEmailOtp(email, 'PASSWORD_RESET', code);

    const user = await User.findOne({ email });
    if (!user) {
      // OTP existed but the account is gone — behave exactly like a bad code.
      throw new AppError(400, 'OTP_INVALID', OTP_INVALID_MESSAGE);
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await user.updateOne({ $set: { passwordHash } });

    // A reset revokes every established session on the account.
    await RefreshSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    clearAuthCookies(res);
    res.status(204).end();
  })
);

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = user
      ? await argon2.verify(user.passwordHash, password).catch(() => false)
      : await argon2.verify(await getDummyHash(), password).catch(() => false);
    if (!user || !ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const session = await issueSession(user);
    setAuthCookies(res, signAccessToken(user), session.raw, session.expiresAt);
    res.json(authBody(user, session.expiresAt));
  })
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const presented: string | undefined = req.cookies?.refreshToken;
    if (!presented) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');

    const presentedHash = hashToken(presented);
    const { raw, hash } = newRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    // Atomic compare-and-swap: only the current, unrevoked, unexpired token rotates.
    const session = await RefreshSession.findOneAndUpdate(
      { tokenHash: presentedHash, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { tokenHash: hash, previousTokenHash: presentedHash, expiresAt, rotatedAt: new Date() } },
      { new: true }
    );

    if (!session) {
      // A previously rotated token being replayed means the session may be
      // compromised — but two tabs refreshing simultaneously race here too.
      // Only revoke when the rotation is outside the grace window.
      const replayed = await RefreshSession.findOne({ previousTokenHash: presentedHash, revokedAt: null });
      const rotatedRecently =
        !!replayed?.rotatedAt && Date.now() - replayed.rotatedAt.getTime() < REPLAY_REVOKE_GRACE_MS;
      if (replayed && !rotatedRecently) {
        await replayed.updateOne({ $set: { revokedAt: new Date() } });
      }
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const user = await User.findById(session.userId);
    if (!user) {
      await RefreshSession.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    setAuthCookies(res, signAccessToken(user), raw, expiresAt);
    res.json(authBody(user, expiresAt));
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const presented: string | undefined = req.cookies?.refreshToken;
    if (presented) {
      const presentedHash = hashToken(presented);
      await RefreshSession.updateOne(
        { $or: [{ tokenHash: presentedHash }, { previousTokenHash: presentedHash }], revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    clearAuthCookies(res);
    res.status(204).end();
  })
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');

    const session = await RefreshSession.findOne({
      userId: user._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });
    if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');

    res.json(authBody(user, session.expiresAt));
  })
);
