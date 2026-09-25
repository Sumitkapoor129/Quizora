import 'dotenv/config';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test';

// JWT secrets must be >= 32 chars outside test mode (short determinism is fine
// for the test harness). Presence is still validated manually below.
const secretSchema = isTest
  ? z.string().optional()
  : z.string().min(32).refine((v) => !v.includes('replace-with-a-random'), '[env] JWT secret must not be the example placeholder.').optional();

/** Comma-separated allowlist -> lower-cased set. Shared shape with CLIENT_ORIGIN. */
export function parseEmailList(raw: string): Set<string> {
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/**
 * A completed Google sign-in redirects to the FIRST client origin, so a dev-first
 * or empty list breaks sign-in in production. Returns the boot error, or null.
 * Extracted as a pure function because the production block itself calls
 * process.exit() at import time and cannot be exercised in-process.
 */
export function appOriginProblem(origins: string[]): string | null {
  const first = origins[0];
  if (!first) {
    return '[env] CLIENT_ORIGIN is required in production (comma-separated; the first entry is where sign-in redirects to).';
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(first)) {
    return `[env] CLIENT_ORIGIN must list the production app first, but its first entry is "${first}". Sign-in would redirect users there.`;
  }
  return null;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Validated for presence manually below (exempt in test mode so vitest can
  // run without a real MongoDB).
  MONGODB_URI: z.string().optional(),
  JWT_ACCESS_SECRET: secretSchema,
  CLIENT_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  // Google OAuth (Phase 12). Optional so the server boots in development; the
  // production fail-fast below is what guarantees they are set where it counts.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_CALLBACK_URL: z.string().url().refine((u) => u.startsWith('http'), 'Must be an http(s) URL.').optional(),
  // Comma-separated emails that resolve to role ADMIN on every Google sign-in.
  ADMIN_EMAILS: z.string().default(''),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Directory for admin-uploaded test images (relative to process cwd).
  UPLOAD_DIR: z.string().default('uploads')
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
  if (missing.length > 0) {
    for (const m of missing) console.error(m.hint);
    process.exit(1);
  }
}

if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (!parsed.data.GOOGLE_OAUTH_CLIENT_ID) {
    problems.push('[env] GOOGLE_OAUTH_CLIENT_ID is required in production (Google Cloud OAuth client).');
  }
  if (!parsed.data.GOOGLE_OAUTH_CLIENT_SECRET) {
    problems.push('[env] GOOGLE_OAUTH_CLIENT_SECRET is required in production (Google Cloud OAuth client).');
  }
  if (!parsed.data.OAUTH_CALLBACK_URL) {
    problems.push('[env] OAUTH_CALLBACK_URL is required in production (the /api/auth/oauth/google/callback URL).');
  }
  if (parseEmailList(parsed.data.ADMIN_EMAILS).size === 0) {
    problems.push('[env] ADMIN_EMAILS is required in production (comma-separated admin emails; an empty list would demote every admin on their next sign-in).');
  }
  if (!parsed.data.COOKIE_SECURE) {
    problems.push('[env] COOKIE_SECURE must be "true" in production (secure cookies require HTTPS).');
  }
  // The FIRST client origin is where a completed Google sign-in lands, so a
  // dev-first list (or an empty one) would send every user to localhost, or to
  // the relative "undefined/". Fail loudly at boot instead of at first sign-in.
  const originProblem = appOriginProblem(parsed.data.CLIENT_ORIGIN);
  if (originProblem) problems.push(originProblem);
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
}

export const env = {
  NODE_ENV: parsed.data.NODE_ENV,
  PORT: parsed.data.PORT,
  MONGODB_URI: parsed.data.MONGODB_URI ?? '',
  JWT_ACCESS_SECRET: parsed.data.JWT_ACCESS_SECRET ?? (isTest ? 'test-access-secret' : ''),
  CLIENT_ORIGINS: parsed.data.CLIENT_ORIGIN,
  GOOGLE_OAUTH_CLIENT_ID: parsed.data.GOOGLE_OAUTH_CLIENT_ID ?? (isTest ? 'test-google-client-id' : ''),
  GOOGLE_OAUTH_CLIENT_SECRET: parsed.data.GOOGLE_OAUTH_CLIENT_SECRET ?? (isTest ? 'test-google-client-secret' : ''),
  OAUTH_CALLBACK_URL: parsed.data.OAUTH_CALLBACK_URL ?? (isTest ? 'http://localhost:3001/api/auth/oauth/google/callback' : ''),
  ADMIN_EMAIL_SET: parseEmailList(parsed.data.ADMIN_EMAILS),
  COOKIE_SECURE: parsed.data.COOKIE_SECURE,
  UPLOAD_DIR: parsed.data.UPLOAD_DIR
} as const;