
import 'dotenv/config';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test';

// JWT secrets must be at least 32 characters outside test mode.
const secretSchema = isTest
  ? z.string().optional()
  : z
      .string()
      .min(32)
      .refine(
        (v) => !v.includes('replace-with-a-random'),
        '[env] JWT secret must not be the example placeholder.'
      )
      .optional();

/**
 * Convert comma-separated emails into a lowercase Set.
 */
export function parseEmailList(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Production configuration validation type.
 */
export type ProductionConfig = {
  NODE_ENV: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  OAUTH_CALLBACK_URL?: string;
  PUBLIC_BACKEND_ORIGIN?: string;
  ADMIN_EMAILS: string;
  COOKIE_SECURE: boolean;
  CLIENT_ORIGIN: string[];
};

/**
 * Validate the frontend redirect origin.
 * The first origin is where users land after Google login.
 */
export function appOriginProblem(
  origins: string[]
): string | null {
  const first = origins[0];

  if (!first) {
    return '[env] CLIENT_ORIGIN is required in production.';
  }

  let url: URL;

  try {
    url = new URL(first);
  } catch {
    return `[env] Invalid CLIENT_ORIGIN: "${first}".`;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return '[env] CLIENT_ORIGIN must use HTTP or HTTPS.';
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    return '[env] CLIENT_ORIGIN must be an origin without paths, credentials, queries, or fragments.';
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  ) {
    return '[env] CLIENT_ORIGIN must list the production frontend first, not localhost.';
  }

  if (url.protocol !== 'https:') {
    return '[env] Production CLIENT_ORIGIN must use HTTPS.';
  }

  return null;
}

/**
 * Zod environment schema.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3001),

  MONGODB_URI: z.string().optional(),

  JWT_ACCESS_SECRET: secretSchema,

  CLIENT_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),

  // Public HTTPS URL of the Express backend.
  PUBLIC_BACKEND_ORIGIN: z
    .string()
    .url()
    .optional(),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),

  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  OAUTH_CALLBACK_URL: z
    .string()
    .url()
    .refine(
      (u) =>
        u.startsWith('http://') ||
        u.startsWith('https://'),
      'Must be an HTTP(S) URL.'
    )
    .optional(),

  ADMIN_EMAILS: z.string().default(''),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  UPLOAD_DIR: z.string().default('uploads')
});

/**
 * Parse and validate environment variables.
 */
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const bad = parsed.error.issues
    .map((i) => i.path.join('.') || '(root)')
    .join(', ');

  console.error(
    `[env] Invalid environment configuration. Missing or invalid: ${bad}`
  );

  process.exit(1);
}

// After process.exit() TypeScript knows parsing succeeded.
const data = parsed.data;

/**
 * Required configuration for non-test environments.
 */
if (!isTest) {
  const missing: Array<{
    key: string;
    hint: string;
  }> = [];

  if (!data.MONGODB_URI) {
    missing.push({
      key: 'MONGODB_URI',
      hint: '[env] MONGODB_URI is required.'
    });
  }

  if (!data.JWT_ACCESS_SECRET) {
    missing.push({
      key: 'JWT_ACCESS_SECRET',
      hint: '[env] JWT_ACCESS_SECRET is required.'
    });
  }

  if (data.CLIENT_ORIGIN.length === 0) {
    missing.push({
      key: 'CLIENT_ORIGIN',
      hint: '[env] CLIENT_ORIGIN is required.'
    });
  }

  if (missing.length > 0) {
    for (const m of missing) {
      console.error(m.hint);
    }

    process.exit(1);
  }
}

/**
 * Validate production-only requirements.
 *
 * Frontend and backend may have different origins.
 * The OAuth callback must point to the backend.
 */
export function productionProblems(
  d: ProductionConfig
): string[] {
  if (d.NODE_ENV !== 'production') {
    return [];
  }

  const problems: string[] = [];

  if (!d.GOOGLE_OAUTH_CLIENT_ID) {
    problems.push(
      '[env] GOOGLE_OAUTH_CLIENT_ID is required in production.'
    );
  }

  if (!d.GOOGLE_OAUTH_CLIENT_SECRET) {
    problems.push(
      '[env] GOOGLE_OAUTH_CLIENT_SECRET is required in production.'
    );
  }

  if (!d.OAUTH_CALLBACK_URL) {
    problems.push(
      '[env] OAUTH_CALLBACK_URL is required in production.'
    );
  }

  if (!d.PUBLIC_BACKEND_ORIGIN) {
    problems.push(
      '[env] PUBLIC_BACKEND_ORIGIN is required in production.'
    );
  }

  if (parseEmailList(d.ADMIN_EMAILS).size === 0) {
    problems.push(
      '[env] ADMIN_EMAILS is required in production.'
    );
  }

  if (!d.COOKIE_SECURE) {
    problems.push(
      '[env] COOKIE_SECURE must be "true" in production.'
    );
  }

  // Validate frontend origin.
  const originProblem = appOriginProblem(d.CLIENT_ORIGIN);

  if (originProblem) {
    problems.push(originProblem);
  }

  // Validate that the OAuth callback uses the backend,
  // not the Vercel frontend.
  if (d.OAUTH_CALLBACK_URL && d.PUBLIC_BACKEND_ORIGIN) {
    try {
      const callback = new URL(d.OAUTH_CALLBACK_URL);
      const backend = new URL(d.PUBLIC_BACKEND_ORIGIN);

      if (
        backend.protocol !== 'https:' ||
        backend.username ||
        backend.password ||
        backend.pathname !== '/' ||
        backend.search ||
        backend.hash
      ) {
        problems.push(
          '[env] PUBLIC_BACKEND_ORIGIN must be a clean HTTPS origin.'
        );
      }

      if (
        callback.protocol !== 'https:' ||
        callback.origin !== backend.origin ||
        callback.pathname !==
          '/api/auth/oauth/google/callback' ||
        callback.search ||
        callback.hash ||
        callback.username ||
        callback.password
      ) {
        problems.push(
          '[env] OAUTH_CALLBACK_URL must use the backend HTTPS origin and /api/auth/oauth/google/callback path.'
        );
      }
    } catch {
      problems.push(
        '[env] Invalid OAuth callback or backend origin URL.'
      );
    }
  }

  return problems;
}

/**
 * Fail fast if production configuration is invalid.
 */
const problems = productionProblems(data);

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }

  process.exit(1);
}

/**
 * Export validated environment configuration.
 */
export const env = {
  NODE_ENV: data.NODE_ENV,

  PORT: data.PORT,

  MONGODB_URI: data.MONGODB_URI ?? '',

  JWT_ACCESS_SECRET:
    data.JWT_ACCESS_SECRET ??
    (isTest ? 'test-access-secret' : ''),

  CLIENT_ORIGINS: data.CLIENT_ORIGIN,

  PUBLIC_BACKEND_ORIGIN:
    data.PUBLIC_BACKEND_ORIGIN ?? '',

  GOOGLE_OAUTH_CLIENT_ID:
    data.GOOGLE_OAUTH_CLIENT_ID ??
    (isTest ? 'test-google-client-id' : ''),

  GOOGLE_OAUTH_CLIENT_SECRET:
    data.GOOGLE_OAUTH_CLIENT_SECRET ??
    (isTest ? 'test-google-client-secret' : ''),

  OAUTH_CALLBACK_URL:
    data.OAUTH_CALLBACK_URL ??
    (isTest
      ? 'http://localhost:3001/api/auth/oauth/google/callback'
      : ''),

  ADMIN_EMAIL_SET: parseEmailList(data.ADMIN_EMAILS),

  COOKIE_SECURE: data.COOKIE_SECURE,

  UPLOAD_DIR: data.UPLOAD_DIR
} as const;
