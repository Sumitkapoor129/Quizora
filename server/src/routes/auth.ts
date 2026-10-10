import { randomBytes } from 'node:crypto';
import { Router, type CookieOptions, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';
import { authenticate } from '../middleware/auth.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { User } from '../models/User.js';
import {
  buildAuthUrl,
  exchangeCode,
  fetchProfile,
  type GoogleProfile
} from '../services/googleOAuth.js';
import {
  REFRESH_TTL_MS,
  authBody,
  clearAuthCookies,
  hashToken,
  issueSession,
  newRefreshToken,
  setAuthCookies,
  signAccessToken
} from '../services/session.js';

// Replays of a just-rotated token within this window are usually two tabs
// sharing the cookie racing on refresh, not theft. Old replays still revoke.
const REPLAY_REVOKE_GRACE_MS = 10_000;

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

const refreshLimiter = rateLimit({ ...limiterOptions, limit: 60 });

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// ponytail: the two OAuth routes get no rate limiter, unlike /refresh. A
// start→callback loop costs one outbound call to Google's token endpoint, which
// Google already rate-limits, and a per-IP ceiling here would lock out a cohort
// signing in together from one campus NAT — the normal case for this product.
// Add one if the log noise or egress ever matters.

// Scoped to the OAuth routes, and SameSite=Lax so the cookie still arrives on
// the callback: that request is a top-level cross-site GET navigation from
// accounts.google.com, which Lax permits (and Strict would not).
const oauthCookieBase: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/api/auth/oauth'
};

/**
 * Where the browser goes after signing in: the FIRST configured client origin.
 * That is the app (Vercel in production, localhost:5173 in development).
 * OAUTH_CALLBACK_URL's own origin is the *server* and would 404 in development.
 */
function appOrigin(): string {
  return env.CLIENT_ORIGINS[0];
}

/** Untrusted input that ends up in a redirect: same-origin paths only. */
function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  // Backslash is what makes `/\evil` and `/\/evil` protocol-relative for a
  // browser that normalises it. Control characters and spaces are not real paths.
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return '/';
  return raw;
}

function clearOauthCookies(res: Response): void {
  res.clearCookie('oauthState', oauthCookieBase);
  res.clearCookie('oauthNext', oauthCookieBase);
}

/** Log the reason server-side; never leak a Google error string to the browser. */
function failOauth(res: Response, reason: string): void {
  // The reason can echo a Google-supplied `error` value, so strip anything that
  // could forge a log line or drive a terminal: Cc covers ESC (ANSI + OSC-8),
  // Cf covers bidi overrides, and Zl/Zp are line terminators to log shippers.
  const safe = reason.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').slice(0, 200);
  console.warn(`[oauth] sign-in failed: ${safe}`);
  res.redirect(302, `${appOrigin()}/login?oauth=error`);
}

/**
 * Find or create the account for a Google profile. A pre-OAuth account is
 * linked by email so the student's identity, attempts and results survive. The
 * role is re-evaluated from ADMIN_EMAILS on every sign-in (removing an address
 * from the list revokes admin); the display name is only ever set at creation,
 * so a name the student edited in their profile is not overwritten.
 *
 * Returns null when the matching email already belongs to a *different* Google
 * identity. That happens when an institutional address is reassigned (recycled
 * domain, lapsed Workspace seat); re-pointing googleId would silently hand the
 * previous holder's attempts and results to the newcomer. Failing closed costs
 * a support request and is recoverable by clearing googleId on the row.
 * ponytail: recovery is manual (clear `googleId`, let them relink). Add an
 * admin-only "reclaim this address" flow if that becomes a real support load.
 */
async function upsertGoogleUser(profile: GoogleProfile, email: string, role: 'ADMIN' | 'STUDENT') {
  const existing = (await User.findOne({ googleId: profile.sub })) ?? (await User.findOne({ email }));
  if (existing) {
    if (existing.googleId && existing.googleId !== profile.sub) return null;
    existing.googleId = profile.sub;
    existing.role = role;
    try {
      await existing.save();
    } catch (err) {
      // Same race as the create below: another tab linked this googleId first.
      // Fail with the normal error redirect rather than a raw 500.
      if (!isDuplicateKey(err)) throw err;
      return null;
    }
    return existing;
  }
  try {
    return await User.create({
      googleId: profile.sub,
      email,
      name: profile.name?.trim() || email.split('@')[0],
      role
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Two tabs finished signing in at once; the loser adopts the winner's row.
    const winner = (await User.findOne({ googleId: profile.sub })) ?? (await User.findOne({ email }));
    if (!winner || (winner.googleId && winner.googleId !== profile.sub)) throw err;
    return winner;
  }
}

export const authRouter = Router();

authRouter.get(
  '/oauth/google',
  asyncHandler(async (req, res) => {
    const state = randomBytes(32).toString('base64url');
    const next = safeNext(req.query.next);
    res.cookie('oauthState', state, { ...oauthCookieBase, maxAge: OAUTH_STATE_TTL_MS });
    res.cookie('oauthNext', next, { ...oauthCookieBase, maxAge: OAUTH_STATE_TTL_MS });
    res.redirect(302, buildAuthUrl({ state }));
  })
);

authRouter.get(
  '/oauth/google/callback',
  asyncHandler(async (req, res) => {
    // Clear first: every exit path below has consumed both cookies.
    clearOauthCookies(res);

    const expected = req.cookies?.oauthState;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!expected || !state || expected !== state) return failOauth(res, 'state_mismatch');

    if (req.query.error) return failOauth(res, `google_error:${String(req.query.error)}`);

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return failOauth(res, 'missing_code');

    let profile: GoogleProfile;
    try {
      profile = await fetchProfile(await exchangeCode(code));
    } catch (err) {
      return failOauth(res, err instanceof Error ? err.message : 'google_exchange_failed');
    }

    const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
    // `!== true` rather than `=== false`: an absent flag, or a profile that sends
    // the string "false", is not a verified email and must not sign anyone in.
    if (!email || profile.email_verified !== true) return failOauth(res, 'email_unverified');

    const next = safeNext(req.cookies?.oauthNext);
    const role = env.ADMIN_EMAIL_SET.has(email) ? 'ADMIN' : 'STUDENT';
    const user = await upsertGoogleUser(profile, email, role);
    if (!user) return failOauth(res, 'link_conflict');

    await issueSession(user, res);
    res.redirect(302, `${appOrigin()}${next}`);
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
