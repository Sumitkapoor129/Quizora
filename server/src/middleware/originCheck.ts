import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

/**
 * Rejects browser requests whose Origin/Referer is not the configured client.
 * Requests with neither header (curl, server-to-server) pass through.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && origin !== env.CLIENT_ORIGIN) {
    return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Request origin not allowed.'));
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (refOrigin && refOrigin !== env.CLIENT_ORIGIN) {
        return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Request origin not allowed.'));
      }
    } catch {
      return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Request origin not allowed.'));
    }
  }

  next();
}