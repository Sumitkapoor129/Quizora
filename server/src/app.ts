import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import helmetModule from 'helmet';
// # ponytail: helmet ships separate ESM/CJS type files; Vercel compiles the
// function as CJS and its .d.cts loses the callable default, so cast here.
// Fix/lift when helmet adds a `types` condition to its exports map.
const helmet = helmetModule as unknown as () => express.RequestHandler;
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { originCheck } from './middleware/originCheck.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { studentRouter } from './routes/student.js';

export type RouteMount = (app: Express) => void;

export function createApp(mountRoutes?: RouteMount): Express {
  const app = express();

  // Single trusted proxy hop (Render) — required so express-rate-limit can
  // key on the real client IP from X-Forwarded-For instead of erroring.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(originCheck);

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'mcq-exam-server', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/student', studentRouter);

  // Admin-uploaded test images. Extension is server-generated from sniffed
  // magic bytes, so static content-type lookup by extension is safe. On
  // serverless (Vercel) the filesystem is ephemeral/read-only — set
  // UPLOAD_DIR=/tmp and rely on Cloudinary when configured.
  const uploadDir = resolve(env.UPLOAD_DIR);
  try {
    mkdirSync(uploadDir, { recursive: true });
  } catch {
    // Read-only fs (serverless) — static /uploads just serves nothing.
  }
  app.use('/uploads', express.static(uploadDir, { index: false, maxAge: '30d', immutable: true }));

  // Test hook: routes mounted here sit before notFound/errorHandler.
  mountRoutes?.(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}