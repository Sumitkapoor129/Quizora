import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

// Google redirects the browser here with `Referer: https://accounts.google.com/`,
// which is not a configured client origin. The httpOnly `oauthState` cookie is
// the CSRF defence on this one route, so it alone is exempt. Do not "fix" this
// by allowlisting accounts.google.com — that weakens every other route.
const OAUTH_CALLBACK_PATH = '/api/auth/oauth/google/callback';

/**
 * Rejects browser requests whose Origin/Referer is not the configured client.
 * Requests with neither header (curl, server-to-server) pass through.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction): void {
  // App-level middleware, so req.path is still the full request path here.
  if (req.path === OAUTH_CALLBACK_PATH) return next();

  const origin = req.headers.origin;
  if (origin && !env.CLIENT_ORIGINS.includes(origin)) {
    return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Request origin not allowed.'));
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (refOrigin && !env.CLIENT_ORIGINS.includes(refOrigin)) {
        return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Request origin not allowed.'));
      }
    } catch {
      return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Request origin not allowed.'));
    }
  }

  next();
}