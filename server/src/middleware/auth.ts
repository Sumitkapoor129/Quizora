import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

export interface AuthUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'STUDENT';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface AccessTokenPayload {
  id: string;
  email: string;
  role: 'ADMIN' | 'STUDENT';
}

/** Reads the access JWT from the `accessToken` cookie and attaches req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.accessToken;
  if (!token) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload & Partial<AccessTokenPayload>;
    if (!payload.id || !payload.email || (payload.role !== 'ADMIN' && payload.role !== 'STUDENT')) {
      throw new Error('Invalid token payload');
    }
    req.user = { id: payload.id, email: payload.email, role: payload.role };
    next();
  } catch {
    // Expired, malformed, or wrong-secret tokens all land here.
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  }
}

/** Guards a route to the given roles. Must run after `authenticate`. */
export function requireRole(...roles: Array<'ADMIN' | 'STUDENT'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'Insufficient permissions.'));
    }
    next();
  };
}