import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

function flatZodIssues(err: ZodError): Array<{ field: string; message: string }> {
  return err.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message
  }));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let body: ErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } };

  if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload.',
        details: flatZodIssues(err)
      }
    };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: Object.entries(err.errors).map(([field, e]) => ({ field, message: e.message }))
      }
    };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { error: { code: 'INVALID_ID', message: 'Invalid identifier format.' } };
  } else if (err instanceof AppError) {
    status = err.statusCode;
    body = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {})
      }
    };
  } else {
    // Unknown error: log the real cause server-side, never leak it to the client.
    console.error('[errorHandler]', err);
  }

  res.status(status).json(body);
}