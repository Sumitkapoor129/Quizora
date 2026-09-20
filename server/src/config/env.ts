import 'dotenv/config';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Validated for presence manually below (exempt in test mode so vitest can
  // run without a real MongoDB).
  MONGODB_URI: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const bad = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
  console.error(`[env] Invalid environment configuration. Missing or invalid: ${bad}`);
  process.exit(1);
}

if (!isTest) {
  const missing: Array<{ key: string; hint: string }> = [];
  if (!parsed.data.MONGODB_URI) {
    missing.push({
      key: 'MONGODB_URI',
      hint: "MONGODB_URI is required. Set it in server/.env (e.g. an Atlas connection string). Tests use mongodb-memory-server and don't need it."
    });
  }
  if (!parsed.data.JWT_ACCESS_SECRET) {
    missing.push({
      key: 'JWT_ACCESS_SECRET',
      hint: 'JWT_ACCESS_SECRET is required. Set a long random value in server/.env.'
    });
  }
  if (!parsed.data.JWT_REFRESH_SECRET) {
    missing.push({
      key: 'JWT_REFRESH_SECRET',
      hint: 'JWT_REFRESH_SECRET is required. Set a long random value in server/.env.'
    });
  }
  if (missing.length > 0) {
    for (const m of missing) console.error(m.hint);
    process.exit(1);
  }
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
  console.error('[env] COOKIE_SECURE must be "true" in production (secure cookies require HTTPS).');
  process.exit(1);
}

export const env = {
  NODE_ENV: parsed.data.NODE_ENV,
  PORT: parsed.data.PORT,
  MONGODB_URI: parsed.data.MONGODB_URI ?? '',
  JWT_ACCESS_SECRET: parsed.data.JWT_ACCESS_SECRET ?? (isTest ? 'test-access-secret' : ''),
  JWT_REFRESH_SECRET: parsed.data.JWT_REFRESH_SECRET ?? (isTest ? 'test-refresh-secret' : ''),
  CLIENT_ORIGIN: parsed.data.CLIENT_ORIGIN,
  COOKIE_SECURE: parsed.data.COOKIE_SECURE
} as const;