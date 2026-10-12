import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshSession } from '../models/RefreshSession.js';
import type { UserRole } from '../models/User.js';

export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The user fields the session helpers read. */
export interface SessionUser {
  _id: unknown;
  email: string;
  name: string;
  role: UserRole;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function signAccessToken(user: SessionUser): string {
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

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, refreshExpiresAt: Date): void {
  res.cookie('accessToken', accessToken, { ...cookieBase, maxAge: ACCESS_TTL_MS });
  res.cookie('refreshToken', refreshToken, { ...cookieBase, expires: refreshExpiresAt });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('accessToken', cookieBase);
  res.clearCookie('refreshToken', cookieBase);
}

export function authBody(user: SessionUser, sessionExpiresAt: Date): object {
  return {
    user: { id: String(user._id), email: user.email, name: user.name, role: user.role },
    sessionExpiresAt: sessionExpiresAt.toISOString()
  };
}

/** Sets the cookies here so every caller (including the OAuth callback) shares one cookie pair. */
export async function issueSession(user: SessionUser, res: Response): Promise<Date> {
  const { raw, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await RefreshSession.create({ userId: user._id, tokenHash: hash, expiresAt, revokedAt: null });
  setAuthCookies(res, signAccessToken(user), raw, expiresAt);
  return expiresAt;
}
