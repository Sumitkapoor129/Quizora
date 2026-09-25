import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

// The `src` imports below are deliberately dynamic. Test files assign
// process.env.UPLOAD_DIR in beforeAll and then import `src` on purpose, so a
// static import here would evaluate config/env.ts (via services/session.ts)
// before that assignment and freeze UPLOAD_DIR at its 'uploads' default.

/**
 * Seeded users still get a real password hash: the schema requires one, and
 * student-portal.test.ts's password-change tests verify it. Temporary — the
 * password task deletes this, the argon2 import and those tests together.
 */
export const TEST_PASSWORD = 'password123';

let passwordHash: string | undefined;
/** argon2 is deliberately slow, so hash once per test file and reuse it. */
async function testPasswordHash(): Promise<string> {
  return (passwordHash ??= await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id }));
}

export interface SeededUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'STUDENT';
}

export interface SeedOptions {
  role?: 'ADMIN' | 'STUDENT';
  email?: string;
  name?: string;
}

let counter = 0;

/** Unique per call so tests in one file never collide on the unique email index. */
function uniqueEmail(): string {
  counter += 1;
  return `user-${counter}-${randomBytes(4).toString('hex')}@example.test`;
}

export async function seedUser(opts: SeedOptions = {}): Promise<SeededUser> {
  const { User } = await import('../../src/models/User.js');
  const email = opts.email ?? uniqueEmail();
  const user = await User.create({
    email,
    name: opts.name ?? 'Test User',
    role: opts.role ?? 'STUDENT',
    passwordHash: await testPasswordHash()
  });
  return { id: String(user._id), email, name: user.name, role: user.role };
}

export interface TestSession extends SeededUser {
  /** `accessToken=<jwt>` — pass as the `Cookie` header on authenticated requests. */
  accessCookie: string;
  /** `refreshToken=<raw>` */
  refreshCookie: string;
  /** The raw refresh token, for rotation tests that need to replay it. */
  refreshToken: string;
}

/**
 * A user plus a live refresh session. `/api/auth/me` requires an unexpired
 * RefreshSession, so a cookie without one is not an authenticated user.
 */
export async function createTestSession(opts: SeedOptions = {}): Promise<TestSession> {
  const { RefreshSession } = await import('../../src/models/RefreshSession.js');
  const { REFRESH_TTL_MS, newRefreshToken, signAccessToken } = await import('../../src/services/session.js');
  const user = await seedUser(opts);
  const { raw, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await RefreshSession.create({
    userId: user.id,
    tokenHash: hash,
    expiresAt,
    revokedAt: null
  });
  const accessToken = signAccessToken({
    _id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  });
  return {
    ...user,
    accessCookie: `accessToken=${accessToken}`,
    refreshCookie: `refreshToken=${raw}`,
    refreshToken: raw
  };
}
