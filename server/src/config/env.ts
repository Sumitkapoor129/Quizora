import 'dotenv/config';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test';

// JWT secrets must be >= 32 chars outside test mode (short determinism is fine
// for the test harness). Presence is still validated manually below.
const secretSchema = isTest
  ? z.string().optional()
  : z.string().min(32).refine((v) => !v.includes('replace-with-a-random'), '[env] JWT secret must not be the example placeholder.').optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Validated for presence manually below (exempt in test mode so vitest can
  // run without a real MongoDB).
  MONGODB_URI: z.string().optional(),
  JWT_ACCESS_SECRET: secretSchema,
  JWT_REFRESH_SECRET: secretSchema,
  CLIENT_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Directory for admin-uploaded test images (relative to process cwd).
  UPLOAD_DIR: z.string().default('uploads'),
  // Cloudinary (image storage). All three optional: when present, uploads are
  // stored on Cloudinary and imageUrl comes back as an absolute URL; otherwise
  // they fall back to the local UPLOAD_DIR (dev). Vercel's filesystem is
  // ephemeral, so production deployments must set these.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  // SMTP (email OTP delivery). All optional so the server boots and tests run
  // before creds exist; the mailer falls back to a dev console log until then.
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional()
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
      hint: "MONGODB_URI is required. Set it in server/.env locally or in the Vercel project's environment variables (e.g. an Atlas connection string). Tests use mongodb-memory-server and don't need it."
    });
  }
  if (!parsed.data.JWT_ACCESS_SECRET) {
    missing.push({
      key: 'JWT_ACCESS_SECRET',
      hint: 'JWT_ACCESS_SECRET is required. Set a long random value in server/.env locally or in the Vercel project settings.'
    });
  }
  if (!parsed.data.JWT_REFRESH_SECRET) {
    missing.push({
      key: 'JWT_REFRESH_SECRET',
      hint: 'JWT_REFRESH_SECRET is required. Set a long random value in server/.env locally or in the Vercel project settings.'
    });
  }
  // Vercel's filesystem is ephemeral, so production uploads need Cloudinary.
  if (
    parsed.data.NODE_ENV === 'production' &&
    (!parsed.data.CLOUDINARY_CLOUD_NAME || !parsed.data.CLOUDINARY_API_KEY || !parsed.data.CLOUDINARY_API_SECRET)
  ) {
    missing.push({
      key: 'CLOUDINARY_*',
      hint: 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required in production (Vercel storage is ephemeral). Set them in the Vercel project settings.'
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
  CLIENT_ORIGINS: parsed.data.CLIENT_ORIGIN,
  COOKIE_SECURE: parsed.data.COOKIE_SECURE,
  UPLOAD_DIR: parsed.data.UPLOAD_DIR,
  CLOUDINARY_CLOUD_NAME: parsed.data.CLOUDINARY_CLOUD_NAME ?? '',
  CLOUDINARY_API_KEY: parsed.data.CLOUDINARY_API_KEY ?? '',
  CLOUDINARY_API_SECRET: parsed.data.CLOUDINARY_API_SECRET ?? '',
  SMTP_HOST: parsed.data.SMTP_HOST,
  SMTP_PORT: parsed.data.SMTP_PORT,
  SMTP_USER: parsed.data.SMTP_USER ?? '',
  SMTP_PASS: parsed.data.SMTP_PASS ?? '',
  MAIL_FROM: parsed.data.MAIL_FROM ?? ''
} as const;