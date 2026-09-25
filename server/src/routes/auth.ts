import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';
import { authenticate } from '../middleware/auth.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { User } from '../models/User.js';
import {
  REFRESH_TTL_MS,
  authBody,
  clearAuthCookies,
  hashToken,
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

export const authRouter = Router();

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
