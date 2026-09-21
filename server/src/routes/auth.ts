import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Router, type CookieOptions, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';
import { authenticate } from '../middleware/auth.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { User } from '../models/User.js';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Replays of a just-rotated token within this window are usually two tabs
// sharing the cookie racing on refresh, not theft. Old replays still revoke.
const REPLAY_REVOKE_GRACE_MS = 10_000;

const NAME_REQUIRED = 'Name is required.';
const EMAIL_REQUIRED = 'Email is required.';
const EMAIL_INVALID = 'Enter a valid email address.';
const PASSWORD_INVALID = 'Password must be at least 8 characters.';

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
  sameSite: 'lax',
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
  message: limiterResponse
};

// One limiter instance per route: sharing an instance would pool their budgets.
const registerLimiter = rateLimit({ ...limiterOptions, limit: 10 });
const loginLimiter = rateLimit({ ...limiterOptions, limit: 10 });
const refreshLimiter = rateLimit({ ...limiterOptions, limit: 60 });

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
