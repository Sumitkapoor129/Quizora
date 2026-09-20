import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { originCheck } from './middleware/originCheck.js';

export type RouteMount = (app: Express) => void;

export function createApp(mountRoutes?: RouteMount): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(originCheck);

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'mcq-exam-server', time: new Date().toISOString() });
  });

  // Placeholder for Phase 2 feature routes (`/api/auth`, `/api/tests`, ...).
  app.use('/api', (_req: Request, _res: Response, next: NextFunction) => next());

  // Test hook: routes mounted here sit before notFound/errorHandler.
  mountRoutes?.(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}