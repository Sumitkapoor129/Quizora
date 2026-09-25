# Google OAuth Authentication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all local auth (email + password, and the email-OTP registration and password-reset flows) with a single "Continue with Google" sign-in.

**Architecture:** A hand-rolled OAuth 2.0 authorization-code flow. `GET /api/auth/oauth/google` issues a CSRF `state` cookie plus a validated `next` cookie and redirects to Google; `GET /api/auth/oauth/google/callback` verifies state, exchanges the code, upserts the user, issues the same opaque refresh session a password login used, and redirects back to the app. Google protocol code lives in one service module; session/cookie code is lifted out of the auth router so the server test harness can mint sessions without a login route. **Zero new dependencies.**

**Tech Stack:** Node 24, Express v4, Mongoose 8, zod, vitest + supertest (server); React 18, Vite, react-router-dom v6, @tanstack/react-query v5, vitest + Testing Library (client).

**Spec:** `docs/superpowers/specs/2026-09-25-google-oauth-design.md` — the spec is the binding authority; this plan argues from it.

## Global Constraints

- **No new dependencies in `server/package.json` or `client/package.json`.** Three are removed from the server: `argon2`, `nodemailer`, `@types/nodemailer`.
- **TS strict, ESM NodeNext** on the server: every relative import carries the `.js` extension. Client imports use the `@/` alias.
- **Error shape everywhere:** `{ error: { code, message, details? } }`. Unchanged. IDOR → 404, not 403.
- **The client is the source of truth for the wire contract** (`client/src/api/client.ts`); the server must match it exactly.
- **Server DTO roles are uppercase** (`'ADMIN' | 'STUDENT'`); the client maps them once, in `mapRole`, to lowercase `Role`. Do not introduce a second mapping.
- **Test suites must be green at the end of every task.** `cd server && npm test` and `cd client && npm test`. No `.skip`, no `.only`, no deleted assertions to make a suite pass.
- **TDD:** every new behaviour gets a test that is written, run, and watched fail for the right reason before the code is written. Pure refactors (Task 1's extraction) are guarded by the existing suite, which must stay green.
- **Never leak secrets to the browser:** no Google error string, no client secret, no token ever reaches a response body. Callback failures log the reason server-side and redirect to `/login?oauth=error`.
- **`CLIENT_ORIGINS[0]` is the app origin.** The post-sign-in redirect target is `env.CLIENT_ORIGINS[0]`, never `new URL(OAUTH_CALLBACK_URL).origin` (that is the server, which 404s in development).
- **Tasks 4 and 5 are one deploy unit.** Task 4 removes the last way to sign in; Task 5 restores it. Never deploy between them.
- **Verification gates per task:** `cd server && npm run typecheck` and `cd client && npm run typecheck` where the task touches that side.

---

### Task 1: Env configuration + session service extraction

No behaviour change. Prepares the config keys the OAuth tasks need and moves session/cookie code where both the auth router and the test harness can import it.

**Files:**
- Create: `server/src/services/session.ts`
- Create: `server/tests/env.test.ts`
- Modify: `server/src/config/env.ts`
- Modify: `server/src/routes/auth.ts` (import from the new service; delete the moved code)
- Modify: `server/vitest.config.ts` (pin the new test env keys)

**Interfaces:**
- Produces: `export function parseEmailList(raw: string): Set<string>` in `server/src/config/env.ts`
- Produces: `server/src/services/session.ts` exporting `ACCESS_TTL_MS`, `REFRESH_TTL_MS`, `SessionUser`, `hashToken`, `newRefreshToken`, `signAccessToken`, `setAuthCookies`, `clearAuthCookies`, `issueSession(user, res) => Promise<Date>`, `authBody(user, sessionExpiresAt) => object`
- Produces: `env.GOOGLE_OAUTH_CLIENT_ID`, `env.GOOGLE_OAUTH_CLIENT_SECRET`, `env.OAUTH_CALLBACK_URL`, `env.ADMIN_EMAIL_SET`
- Consumed by Tasks 2, 3, 4, 5.

- [ ] **Step 1: Write the failing test for `parseEmailList`**

Create `server/tests/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEmailList } from '../src/config/env.js';

describe('parseEmailList', () => {
  it('trims, lower-cases and drops empty entries', () => {
    expect([...parseEmailList(' Admin@Example.com , b@x.com ,, ')]).toEqual([
      'admin@example.com',
      'b@x.com'
    ]);
  });

  it('returns an empty set for an empty string', () => {
    expect(parseEmailList('').size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest run tests/env.test.ts`
Expected: FAIL — `parseEmailList` is not exported (TS/vitest import error).

- [ ] **Step 3: Add the four OAuth env keys and `parseEmailList` to `env.ts`**

In `server/src/config/env.ts`, add above `envSchema`:

```ts
/** Comma-separated allowlist -> lower-cased set. Shared shape with CLIENT_ORIGIN. */
export function parseEmailList(raw: string): Set<string> {
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
```

Add four entries to `envSchema` (after the `CLIENT_ORIGIN` entry, keeping `SMTP_*` and `JWT_REFRESH_SECRET` untouched — they are removed in Task 4):

```ts
  // Google OAuth (Phase 12). Optional so the server boots in development; the
  // production fail-fast below is what guarantees they are set where it counts.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_CALLBACK_URL: z.string().url().optional(),
  // Comma-separated emails that resolve to role ADMIN on every Google sign-in.
  ADMIN_EMAILS: z.string().default(''),
```

Replace the single production `COOKIE_SECURE` block with a production block that fails fast on all of them:

```ts
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
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
}
```

Add four lines to the exported `env` object (after `CLIENT_ORIGINS`):

```ts
  GOOGLE_OAUTH_CLIENT_ID: parsed.data.GOOGLE_OAUTH_CLIENT_ID ?? (isTest ? 'test-google-client-id' : ''),
  GOOGLE_OAUTH_CLIENT_SECRET: parsed.data.GOOGLE_OAUTH_CLIENT_SECRET ?? (isTest ? 'test-google-client-secret' : ''),
  OAUTH_CALLBACK_URL: parsed.data.OAUTH_CALLBACK_URL ?? (isTest ? 'http://localhost:3001/api/auth/oauth/google/callback' : ''),
  ADMIN_EMAIL_SET: parseEmailList(parsed.data.ADMIN_EMAILS),
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd server && npx vitest run tests/env.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `server/src/services/session.ts`**

Move the code out of `auth.ts` **unchanged**, except that `issueSession` absorbs the `setAuthCookies` call (the OAuth callback holds a `Response` and must not have to remember the pair). File content:

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshSession } from '../models/RefreshSession.js';

export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The user fields the session helpers read. */
export interface SessionUser {
  _id: unknown;
  email: string;
  name: string;
  role: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function signAccessToken(user: SessionUser): string {
  return jwt.sign(
    { id: String(user._id), email: user.email, role: user.role, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_TTL_MS / 1000 }
  );
}

const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
  path: '/'
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, refreshExpiresAt: Date): void {
  res.cookie('accessToken', accessToken, { ...cookieBase, maxAge: ACCESS_TTL_MS });
  res.cookie('refreshToken', refreshToken, { ...cookieBase, expires: refreshExpiresAt });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('accessToken', cookieBase);
  res.clearCookie('refreshToken', cookieBase);
}

export function authBody(user: SessionUser, sessionExpiresAt: Date): object {
  return {
    user: { id: String(user._id), email: user.email, name: user.name, role: user.role },
    sessionExpiresAt: sessionExpiresAt.toISOString()
  };
}

/** Creates the refresh session and sets both auth cookies. Returns the expiry. */
export async function issueSession(user: SessionUser, res: Response): Promise<Date> {
  const { raw, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await RefreshSession.create({ userId: user._id, tokenHash: hash, expiresAt, revokedAt: null });
  setAuthCookies(res, signAccessToken(user), raw, expiresAt);
  return expiresAt;
}
```

- [ ] **Step 6: Point `auth.ts` at the new service**

In `server/src/routes/auth.ts`: delete the now-moved definitions — `ACCESS_TTL_MS` and `REFRESH_TTL_MS` (lines 15-16), `hashToken`, `newRefreshToken`, `signAccessToken`, `cookieBase`, `setAuthCookies`, `clearAuthCookies`, `authBody` (lines 86-132), and `issueSession` (lines 225-230). Replace with:

```ts
import {
  REFRESH_TTL_MS,
  authBody,
  clearAuthCookies,
  hashToken,
  issueSession,
  newRefreshToken,
  setAuthCookies,
  signAccessToken
} from '../services/session.js';
```

`signAccessToken` is in the list because `/refresh` still calls it directly.

Keep the local `type AuthUserRecord = { _id: unknown; email: string; name: string; role: string }` where it is, or delete it and import `SessionUser` — either is acceptable; prefer importing `SessionUser` and deleting the duplicate.

Then fix the two call sites that used the old two-step form:

- `/register/verify` (line 273-274): `const session = await issueSession(user); setAuthCookies(res, signAccessToken(user), session.raw, session.expiresAt);` → `const expiresAt = await issueSession(user, res);`
- `/login` (line 333-334): the same replacement.

`/refresh` (line 376) calls `setAuthCookies(res, signAccessToken(user), raw, expiresAt)` directly and needs no change.

- [ ] **Step 7: Pin the new keys in `server/vitest.config.ts`**

In the `test.env` block, remove `JWT_REFRESH_SECRET` only in Task 4. In this task add:

```ts
      GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-client-secret',
      OAUTH_CALLBACK_URL: 'http://localhost:3001/api/auth/oauth/google/callback',
      ADMIN_EMAILS: 'admin@example.com',
```

`ADMIN_EMAILS` is pinned here deliberately: Task 5's tests need a known admin address.

- [ ] **Step 8: Verify the full server suite still passes and typecheck is clean**

Run: `cd server && npm test`
Expected: 152 existing + 2 new = **154 passed**, 12+1 = 13 files.

Run: `cd server && npm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add server/src/config/env.ts server/src/services/session.ts server/src/routes/auth.ts server/tests/env.test.ts server/vitest.config.ts
git commit -m "refactor(server): add Google OAuth env keys and extract the session service"
```

---

### Task 2: Shared test session helper

Ten server test files reference `POST /api/auth/login` today: seven authenticate through it and are migrated here (`admin-attempts`, `import-admin`, `resources`, `student-exam`, `student-portal`, `tests-admin`, `admin-analytics`); the other three are *about* login itself (`auth.test.ts`, `auth-otp.test.ts`, `auth-password-reset.test.ts`) and are rewritten or deleted in Task 4. Give the seven a helper first, while the route still exists, so no task is ever broken.

**Files:**
- Create: `server/tests/helpers/auth.ts`
- Modify: `server/tests/admin-attempts.test.ts`, `import-admin.test.ts`, `resources.test.ts`, `student-exam.test.ts`, `student-portal.test.ts`, `tests-admin.test.ts`, `admin-analytics.test.ts`, `health.test.ts` (only if it authenticates)

**Interfaces:**
- Consumes: `signAccessToken`, `REFRESH_TTL_MS` from `server/src/services/session.ts` (Task 1)
- Produces: `server/tests/helpers/auth.ts` exporting `SeededUser`, `seedUser(opts?)`, `createTestSession(opts?)` — the single auth entry point for every test file from Task 4 on.

- [ ] **Step 1: Create `server/tests/helpers/auth.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { RefreshSession } from '../../src/models/RefreshSession.js';
import { User } from '../../src/models/User.js';
import { REFRESH_TTL_MS, signAccessToken } from '../../src/services/session.js';

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
  const email = opts.email ?? uniqueEmail();
  const user = await User.create({
    email,
    name: opts.name ?? 'Test User',
    role: opts.role ?? 'STUDENT'
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
  const user = await seedUser(opts);
  const raw = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await RefreshSession.create({
    userId: user.id,
    tokenHash: createHash('sha256').update(raw).digest('hex'),
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
```

- [ ] **Step 2: Migrate one test file and prove the helper works**

Take `server/tests/resources.test.ts` as the pilot. It currently has a local login helper of this shape:

```ts
async function loginAsAdmin() { /* POST /api/auth/login with email+password, then scrape accessToken */ }
```

Replace it with:

```ts
import { createTestSession } from './helpers/auth.js';

async function loginAsAdmin() {
  const session = await createTestSession({ role: 'ADMIN' });
  return { id: session.id, cookie: session.accessCookie };
}
```

Delete the local `cookiePair` helper and the seeded-password constants it needed. Keep every test body and assertion unchanged.

- [ ] **Step 3: Run that file's tests**

Run: `cd server && npx vitest run tests/resources.test.ts`
Expected: PASS (10 tests), unchanged count.

- [ ] **Step 4: Migrate the remaining files the same way**

For each of `admin-attempts.test.ts`, `import-admin.test.ts`, `student-exam.test.ts`, `student-portal.test.ts`, `tests-admin.test.ts`, `admin-analytics.test.ts`: delete its local login + `cookiePair` helper and its `argon2.hash` seeding, import `createTestSession` from `./helpers/auth.js`, and keep every test body identical. `admin-analytics.test.ts` scrapes cookies with a different expression — it becomes `session.accessCookie` too. `health.test.ts` only asserts a 401 shape and does not authenticate; leave it alone unless it imports a deleted helper.

- [ ] **Step 5: Run the full server suite and typecheck**

Run: `cd server && npm test`
Expected: **154 passed** — the same tests as before this task, now authenticating through the helper.

Run: `cd server && npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Confirm no test file still calls the login route for authentication**

Run: `cd server && rg -n "auth/login" tests/`
Expected: matches only inside `auth.test.ts`, `auth-otp.test.ts` and `auth-password-reset.test.ts` — the three files that are about login itself, handled in Task 4 — plus any comment. If a migrated file still matches, fix it now.

- [ ] **Step 7: Commit**

```bash
git add server/tests
git commit -m "test(server): authenticate through a shared session helper instead of the login route"
```

---

### Task 3: Google OAuth protocol service

The Google half of the flow, isolated from Express and from the database. Fully testable by stubbing `fetch`.

**Files:**
- Create: `server/src/services/googleOAuth.ts`
- Create: `server/tests/google-oauth.test.ts`

**Interfaces:**
- Consumes: `env.GOOGLE_OAUTH_CLIENT_ID`, `env.GOOGLE_OAUTH_CLIENT_SECRET`, `env.OAUTH_CALLBACK_URL` (Task 1)
- Produces: `buildAuthUrl(opts: { state: string }): string`, `exchangeCode(code: string): Promise<string>`, `fetchProfile(accessToken: string): Promise<GoogleProfile>`, and `interface GoogleProfile { sub: string; email: string; name?: string; email_verified?: boolean }` — all consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/google-oauth.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthUrl, exchangeCode, fetchProfile } from '../src/services/googleOAuth.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('buildAuthUrl', () => {
  it('targets Google with the configured client, callback, scope and state', () => {
    const url = new URL(buildAuthUrl({ state: 'st4te' }));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/auth/oauth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('st4te');
  });

  it('encodes a state containing URL-unsafe characters', () => {
    expect(new URL(buildAuthUrl({ state: 'a b&c=d' })).searchParams.get('state')).toBe('a b&c=d');
  });
});

describe('exchangeCode', () => {
  it('posts the authorization-code grant and returns the access token', async () => {
    const fetchMock = vi.fn(async () => json({ access_token: 'tok-123' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeCode('code-abc')).resolves.toBe('tok-123');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-abc');
    expect(body.get('client_id')).toBe('test-google-client-id');
    expect(body.get('client_secret')).toBe('test-google-client-secret');
    expect(body.get('redirect_uri')).toBe('http://localhost:3001/api/auth/oauth/google/callback');
  });

  it('throws when Google rejects the code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'invalid_grant' }, 400)));
    await expect(exchangeCode('bad')).rejects.toThrow(/google_token_exchange_failed/);
  });

  it('throws when the response carries no access token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    await expect(exchangeCode('code')).rejects.toThrow(/google_token_exchange_failed/);
  });
});

describe('fetchProfile', () => {
  it('reads the profile with a bearer token', async () => {
    const fetchMock = vi.fn(async () =>
      json({ sub: 'google-sub-1', email: 'Student@Example.com', name: 'Student', email_verified: true })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProfile('tok-123')).resolves.toMatchObject({ sub: 'google-sub-1' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('throws when the userinfo call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(fetchProfile('tok')).rejects.toThrow(/google_profile_failed/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest run tests/google-oauth.test.ts`
Expected: FAIL — cannot resolve `../src/services/googleOAuth.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/services/googleOAuth.ts`:

```ts
import { env } from '../config/env.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
}

export function buildAuthUrl(opts: { state: string }): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.OAUTH_CALLBACK_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', opts.state);
  return url.toString();
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: env.OAUTH_CALLBACK_URL
    })
  });
  if (!res.ok) throw new Error(`google_token_exchange_failed:${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('google_token_exchange_failed:no_access_token');
  return body.access_token;
}

export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`google_profile_failed:${res.status}`);
  return (await res.json()) as GoogleProfile;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd server && npx vitest run tests/google-oauth.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/googleOAuth.ts server/tests/google-oauth.test.ts
git commit -m "feat(server): Google OAuth protocol service over fetch, with no new dependency"
```

---

### Task 4: Delete the dead auth surface

Removes password login, the OTP model, the mailer and their config. **After this task there is no way to sign in** — Task 5 restores it. They ship together.

**Files:**
- Delete: `server/src/models/EmailOtp.ts`, `server/src/services/mailer.ts`, `server/tests/auth-otp.test.ts`, `server/tests/auth-password-reset.test.ts`
- Modify: `server/src/models/User.ts`, `server/src/routes/auth.ts`, `server/src/routes/student.ts`, `server/src/config/env.ts`, `server/vitest.config.ts`, `.env.example`, `server/package.json`, `server/tests/auth.test.ts`, `server/tests/db-harness.test.ts`, `server/tests/student-portal.test.ts`

**Interfaces:**
- Consumes: `services/session.ts` and `seedUser`/`createTestSession` (Tasks 1-2)
- Produces: `User.googleId?: string`; the `User` model no longer has `passwordHash`; `PATCH /api/student/profile` accepts only `name`; `env` no longer has `SMTP_*` or `JWT_REFRESH_SECRET`.

- [ ] **Step 1: Write the failing tests for the deletions**

In `server/tests/auth.test.ts`, add a describe block asserting every removed route is gone:

```ts
describe('removed password and OTP auth endpoints', () => {
  it.each([
    ['post', '/api/auth/register'],
    ['post', '/api/auth/register/verify'],
    ['post', '/api/auth/forgot-password'],
    ['post', '/api/auth/reset-password'],
    ['post', '/api/auth/login']
  ])('%s %s returns 404 with the standard error shape', async (method, path) => {
    const res = await request(app)[method as 'post'](path).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
```

`auth.test.ts` already imports `request` from `supertest` and `createApp`, and its harness boots `MongoMemoryServer`, `User.init()` and `RefreshSession.init()`. Remove its `EmailOtp` import and `.init()` call. Delete the `sendMail` mock and the `PASSWORD` constant, and rewrite the two remaining authenticated tests to use `createTestSession`:

- "returns the current user for an authenticated request" → `const s = await createTestSession({ name: 'Ada' });` then `GET /api/auth/me` with `Cookie: s.accessCookie` asserts `user.email === s.email`.
- "clears cookies and makes the refresh token unusable" → create a session, `POST /api/auth/logout` with `Cookie: s.refreshCookie`, then `POST /api/auth/refresh` with the same cookie expects 401.

The three refresh-rotation tests keep their shape but seed through `createTestSession` and read `s.refreshCookie` / `s.refreshToken` instead of logging in.

In `server/tests/student-portal.test.ts`, replace the three password-change tests with a name-only test:

```ts
it('updates the name and ignores unknown password fields', async () => {
  const session = await createTestSession();
  const res = await request(app)
    .patch('/api/student/profile')
    .set('Cookie', session.accessCookie)
    .send({ name: 'Renamed', currentPassword: 'whatever', newPassword: 'longenough' });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe('Renamed');
});
```

In `server/tests/db-harness.test.ts`, replace the `passwordHash` assertion with `googleId` uniqueness:

```ts
it('creates a user without a password and rejects a duplicate googleId', async () => {
  const user = await User.create({ email: 'nopass@example.com', name: 'No Pass', googleId: 'sub-1' });
  expect(user.role).toBe('STUDENT');
  expect(user.googleId).toBe('sub-1');
  await expect(
    User.create({ email: 'other@example.com', name: 'Other', googleId: 'sub-1' })
  ).rejects.toMatchObject({ code: 11000 });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd server && npx vitest run tests/auth.test.ts tests/student-portal.test.ts tests/db-harness.test.ts`
Expected: FAIL — the removed endpoints still answer 200/201, `googleId` is not in the schema, and profile still demands a password.

- [ ] **Step 3: Change the `User` model**

`server/src/models/User.ts` — replace `passwordHash` with `googleId`:

```ts
  // Google account id (the OIDC `sub`). Sparse so documents predating OAuth
  // are still valid; the first Google sign-in links one by email.
  googleId: { type: String, unique: true, sparse: true, index: true },
```

- [ ] **Step 4: Delete the routes, model, mailer and their helpers**

In `server/src/routes/auth.ts` delete: the five route blocks `POST /register` (lines 234-252), `POST /register/verify` (254-277), `POST /forgot-password` (279-295), `POST /reset-password` (297-318), `POST /login` (320-337); the OTP message constants (21-28), `OTP_TTL_MS`/`OTP_ATTEMPTS` (30-31), the zod schemas `emailField`/`registerSchema`/`codeField`/`registerVerifySchema`/`forgotPasswordSchema`/`resetPasswordSchema`/`loginSchema` (33-82), `getDummyHash` (95-100), the `OTP_SEND_LIMIT`/`OTP_VERIFY_LIMIT` exports and the four limiters that use them (162-168, keeping `refreshLimiter`), and the whole "Email OTP helpers" section (171-223).

Then fix the imports. After the deletions and the Task 1 move, the surviving set is exactly:

- **remove:** `argon2`, `EmailOtp`/`EmailOtpPurpose`, `sendMail`, `randomInt`, `timingSafeEqual`, `createHash`, `jwt`, `z`
- **keep:** `randomBytes` (Task 5 mints `state` from it), `Router`/`CookieOptions`/`NextFunction`/`Request`/`Response`, `rateLimit` (only `refreshLimiter` is left), `env`, `AppError`, `authenticate`, `RefreshSession`, `User`

`jwt` and `createHash` are not "probably" unused: they were only ever used by `signAccessToken`/`hashToken`, both of which Task 1 moved out. Leaving either import behind fails `npm run typecheck` on `noUnusedLocals`. `REPLAY_REVOKE_GRACE_MS` stays — `/refresh` still uses it.

Keep `isDuplicateKey` — Task 5 reuses it for the sign-in race.

Delete `server/src/models/EmailOtp.ts` and `server/src/services/mailer.ts`.

- [ ] **Step 5: Make `PATCH /api/student/profile` name-only**

In `server/src/routes/student.ts` (~lines 734-793): delete the `argon2` import (line 2), reduce the zod schema to

```ts
const profileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120, 'Name is too long.').optional()
});
```

(keep whatever length bound the current `name` field already uses — match it, do not invent one), delete the `superRefine` that required `currentPassword` for `newPassword`, and reduce the handler to: load the user, apply `name` when present, save, then respond with the existing session DTO. Import `authBody` from `../services/session.js` instead of rebuilding the object inline at lines 788-791, and look up the live session for the expiry exactly as the old code did.

- [ ] **Step 6: Remove the dead config keys**

In `server/src/config/env.ts`: delete `JWT_REFRESH_SECRET` and all five `SMTP_*` entries from `envSchema`, the `JWT_REFRESH_SECRET` hint from the `!isTest` missing list, and all six lines from the exported `env` object.

In `server/vitest.config.ts`: remove the `JWT_REFRESH_SECRET` env entry.

In `server/.env.example`: remove the `JWT_REFRESH_SECRET` line and the whole commented SMTP block; add

```
# Google OAuth (required in production; the server fails fast without them)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
# Must be the exact URL registered in Google Cloud, and must be reachable by the
# browser: the production one rides the Vercel /api rewrite.
OAUTH_CALLBACK_URL=http://localhost:3001/api/auth/oauth/google/callback
# Comma-separated Google accounts that resolve to role ADMIN on every sign-in.
ADMIN_EMAILS=
```

- [ ] **Step 7: Remove the dependencies**

`server/package.json`: remove `"argon2"` and `"nodemailer"` from `dependencies` and `"@types/nodemailer"` from `devDependencies`. Run `cd server && npm install` to update `package-lock.json`.

- [ ] **Step 8: Delete the OTP test files and verify**

Run: `cd server && rm tests/auth-otp.test.ts tests/auth-password-reset.test.ts`
Then: `cd server && npm test`
Expected: PASS. Count = 154 − 9 (`auth-otp`) − 8 (`auth-password-reset`) − the assertions removed from `auth.test.ts` + the 5 new 404 tests + the `db-harness`/profile changes. Record the exact number.

Run: `cd server && npm run typecheck` — expected exit 0. Any error naming `env.SMTP_*`, `env.JWT_REFRESH_SECRET`, `passwordHash`, or `EmailOtp` means a reference survived; delete it.

- [ ] **Step 9: Commit**

```bash
git add -A server
git commit -m "feat(server): remove password, email-OTP and mail auth; User gains googleId"
```

---

### Task 5: Google sign-in routes

The live flow, end to end. After this task the app is signable-into again.

**Files:**
- Create: `server/tests/oauth.test.ts`
- Modify: `server/src/routes/auth.ts`, `server/src/middleware/originCheck.ts`

**Interfaces:**
- Consumes: `buildAuthUrl`, `exchangeCode`, `fetchProfile`, `GoogleProfile` (Task 3); `issueSession`, `authBody` (Task 1); `env.ADMIN_EMAIL_SET` (Task 1); `User.googleId` (Task 4); `seedUser`, `createTestSession` (Task 2)
- Produces: `GET /api/auth/oauth/google`, `GET /api/auth/oauth/google/callback`, and the `originCheck` path exemption.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/oauth.test.ts` with the standard harness (copy the `MongoMemoryServer` / `connect` / `User.init()` / `RefreshSession.init()` / `disconnect` preamble from `server/tests/auth.test.ts`, minus the mailer mock and the `EmailOtp` init), these helpers, and the twelve tests below:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { connect, disconnect } from '../src/db/connect.js';
import { RefreshSession } from '../src/models/RefreshSession.js';
import { User } from '../src/models/User.js';
import { seedUser } from './helpers/auth.js';

const APP_ORIGIN = 'http://localhost:5173';
const app = createApp();
let mongo: MongoMemoryServer | undefined;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connect(mongo.getUri());
  await User.init();
  await RefreshSession.init();
}, 120_000);

afterAll(async () => {
  await disconnect();
  await mongo?.stop();
});

/** Every set-cookie pair from a response, joined into one Cookie header. */
function cookieHeaderOf(res: request.Response): string {
  return (res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
}

/** The raw value of one set-cookie, e.g. the state token. */
function cookieValueOf(res: request.Response, name: string): string | undefined {
  for (const c of res.headers['set-cookie'] ?? []) {
    const [pair] = c.split(';');
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return undefined;
}

/** Stubs Google's two endpoints. `overrides` changes the userinfo payload. */
function stubGoogle(profile: Record<string, unknown>, opts: { tokenStatus?: number } = {}) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.startsWith('https://oauth2.googleapis.com/token')) {
      if (opts.tokenStatus && opts.tokenStatus >= 400) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: opts.tokenStatus });
      }
      return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
    }
    return new Response(JSON.stringify(profile), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Runs the start route and returns the state token plus the cookies to replay. */
async function startGoogle(query = ''): Promise<{ state: string; cookie: string }> {
  const res = await request(app).get(`/api/auth/oauth/google${query}`);
  return { state: cookieValueOf(res, 'oauthState') ?? '', cookie: cookieHeaderOf(res) };
}

const okProfile = (over: Record<string, unknown> = {}) => ({
  sub: 'google-sub-1',
  email: 'student@example.com',
  name: 'Grace Student',
  email_verified: true,
  ...over
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

1. **Start redirects to Google with a state cookie.** `const res = await request(app).get('/api/auth/oauth/google');` assert `res.status === 302`, `new URL(res.headers.location).origin === 'https://accounts.google.com'`, the location carries `client_id=test-google-client-id` and a `state`, and `cookieValueOf(res, 'oauthState')` is a non-empty string. Also assert the cookie is `HttpOnly` and `Path=/api/auth/oauth` (assert on the raw `set-cookie` string).
2. **`next` is carried, and unsafe values are dropped.** `await startGoogle('?next=%2Fstudent%2Ftests')` → `cookieValueOf(res, 'oauthNext') === '/student/tests'`. `await startGoogle('?next=%2F%2Fevil.example.com')` → `'/'`. `await startGoogle('?next=%2F%5Cevil')` → `'/'`.
3. **Happy callback signs a new student in.** `stubGoogle(okProfile())`, start, then `GET /api/auth/oauth/google/callback?code=code-1&state=<state>` with the start cookies. Assert 302 to `${APP_ORIGIN}/student`; both `accessToken` and `refreshToken` cookies set; exactly one `User` exists with `role: 'STUDENT'`, `googleId: 'google-sub-1'`, `name: 'Grace Student'`; and `GET /api/auth/me` with the returned access cookie returns that user.
4. **A second sign-in reuses the account.** Sign in twice with the same profile. Assert `await User.countDocuments({})` is unchanged by the second sign-in and the second callback still returns 302 with an access cookie.
5. **A pre-OAuth account is linked by email, keeping its name.** `const existing = await seedUser({ name: 'Original Name', role: 'STUDENT' });` then `stubGoogle(okProfile({ email: existing.email }))` and complete the flow. Assert still exactly one user for that email, `googleId` now set, `name` still `'Original Name'`.
6. **`ADMIN_EMAILS` grants ADMIN on sign-in, and removing an address revokes it (D4).** `env.ADMIN_EMAIL_SET` is a `Set`, so the allowlist can be moved in the test without reloading the module: add a throwaway address, sign that address in, then delete it and sign in again with the *same* `sub` and email. First sign-in → `role: 'ADMIN'`; second → the same single `User` doc, now `role: 'STUDENT'`. Restore the set in the existing `afterEach`. Sketch:

   ```ts
   it('grants and revokes ADMIN from the allowlist on every sign-in', async () => {
     env.ADMIN_EMAIL_SET.add('temp-admin@example.com');
     const profile = okProfile({ sub: 'google-sub-admin', email: 'temp-admin@example.com' });
     stubGoogle(profile);
     const first = await startGoogle();
     await request(app).get(`/api/auth/oauth/google/callback?code=c1&state=${first.state}`).set('Cookie', first.cookie);
     expect((await User.findOne({ email: 'temp-admin@example.com' }))?.role).toBe('ADMIN');

     env.ADMIN_EMAIL_SET.delete('temp-admin@example.com');
     const second = await startGoogle();
     await request(app).get(`/api/auth/oauth/google/callback?code=c2&state=${second.state}`).set('Cookie', second.cookie);
     const user = await User.findOne({ email: 'temp-admin@example.com' });
     expect(user?.role).toBe('STUDENT');
     expect(await User.countDocuments({ email: 'temp-admin@example.com' })).toBe(1);
   });
   ```

   The existing `afterEach` must also do `env.ADMIN_EMAIL_SET.delete('temp-admin@example.com')` so the mutation cannot leak into another test. `admin@example.com` from `vitest.config.ts` still gets its own ADMIN assertion as part of test 3's created-user check — keep that.
7. **State mismatch signs nobody in.** Start, then call the callback with `state=wrong`. Assert 302 to `${APP_ORIGIN}/login?oauth=error`, no `accessToken` cookie, no `User` created, and that an `oauthState=;` clearing cookie is present.
8. **Missing state signs nobody in.** Call the callback with a `code` but no cookie and no `state` → same assertions as test 7.
9. **An unverified email creates nothing.** `stubGoogle(okProfile({ email_verified: false }))` → 302 `?oauth=error`, `await User.countDocuments({})` unchanged.
10. **A Google token failure signs nobody in.** `stubGoogle(okProfile(), { tokenStatus: 400 })` → 302 `?oauth=error`, no `User`, no `accessToken` cookie.
11. **A Google-reported error signs nobody in.** Call the callback with `error=access_denied&state=<state>` → 302 `?oauth=error`, no `User`.
12. **The callback is exempt from the origin check, and only the callback is.** Start, then call the callback with `Referer: https://accounts.google.com/` → expect **not** 403 (it either signs in or redirects to `?oauth=error`, both fine). Then `POST /api/auth/refresh` with the same `Referer` header → expect **403 `ORIGIN_FORBIDDEN`**.

- [ ] **Step 2: Run and watch them fail**

Run: `cd server && npx vitest run tests/oauth.test.ts`
Expected: FAIL — both routes 404.

- [ ] **Step 3: Exempt the callback from `originCheck`**

In `server/src/middleware/originCheck.ts`, add above the exported function:

```ts
// Google redirects the browser here with `Referer: https://accounts.google.com/`,
// which is not a configured client origin. The httpOnly `oauthState` cookie is
// the CSRF defence on this one route, so it alone is exempt. Do not "fix" this
// by allowlisting accounts.google.com — that weakens every other route.
const OAUTH_CALLBACK_PATH = '/api/auth/oauth/google/callback';
```

and make the first statement of `originCheck`:

```ts
  if (req.path === OAUTH_CALLBACK_PATH) return next();
```

- [ ] **Step 4: Add the two routes to `auth.ts`**

Add near the top of the file, after the imports:

```ts
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Scoped to the OAuth routes, and SameSite=Lax so the cookie still arrives on
// the callback: that request is a top-level cross-site GET navigation from
// accounts.google.com, which Lax permits (and Strict would not).
const oauthCookieBase: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/api/auth/oauth'
};

/**
 * Where the browser goes after signing in: the FIRST configured client origin.
 * That is the app (Vercel in production, localhost:5173 in development).
 * OAUTH_CALLBACK_URL's own origin is the *server* and would 404 in development.
 */
function appOrigin(): string {
  return env.CLIENT_ORIGINS[0];
}

/** Untrusted input that ends up in a redirect: same-origin paths only. */
function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  return raw;
}

function clearOauthCookies(res: Response): void {
  res.clearCookie('oauthState', oauthCookieBase);
  res.clearCookie('oauthNext', oauthCookieBase);
}

/** Log the reason server-side; never leak a Google error string to the browser. */
function failOauth(res: Response, reason: string): void {
  console.warn(`[oauth] sign-in failed: ${reason}`);
  res.redirect(302, `${appOrigin()}/login?oauth=error`);
}

/**
 * Find or create the account for a Google profile. A pre-OAuth account is
 * linked by email so the student's identity, attempts and results survive. The
 * role is re-evaluated from ADMIN_EMAILS on every sign-in (removing an address
 * from the list revokes admin); the display name is only ever set at creation,
 * so a name the student edited in their profile is not overwritten.
 */
async function upsertGoogleUser(profile: GoogleProfile, email: string, role: 'ADMIN' | 'STUDENT') {
  const existing = (await User.findOne({ googleId: profile.sub })) ?? (await User.findOne({ email }));
  if (existing) {
    existing.googleId = profile.sub;
    existing.role = role;
    await existing.save();
    return existing;
  }
  try {
    return await User.create({
      googleId: profile.sub,
      email,
      name: profile.name?.trim() || email.split('@')[0],
      role
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Two tabs finished signing in at once; the loser adopts the winner's row.
    const winner = (await User.findOne({ googleId: profile.sub })) ?? (await User.findOne({ email }));
    if (!winner) throw err;
    return winner;
  }
}
```

Add the imports `buildAuthUrl, exchangeCode, fetchProfile, type GoogleProfile` from `../services/googleOAuth.js` and `randomBytes` from `node:crypto`.

Then register the routes above the `/refresh` handler:

```ts
authRouter.get(
  '/oauth/google',
  asyncHandler(async (req, res) => {
    const state = randomBytes(32).toString('base64url');
    const next = safeNext(req.query.next);
    res.cookie('oauthState', state, { ...oauthCookieBase, maxAge: OAUTH_STATE_TTL_MS });
    res.cookie('oauthNext', next, { ...oauthCookieBase, maxAge: OAUTH_STATE_TTL_MS });
    res.redirect(302, buildAuthUrl({ state }));
  })
);

authRouter.get(
  '/oauth/google/callback',
  asyncHandler(async (req, res) => {
    // Clear first: every exit path below has consumed both cookies.
    clearOauthCookies(res);

    const expected = req.cookies?.oauthState;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!expected || !state || expected !== state) return failOauth(res, 'state_mismatch');

    if (req.query.error) return failOauth(res, `google_error:${String(req.query.error)}`);

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return failOauth(res, 'missing_code');

    let profile: GoogleProfile;
    try {
      profile = await fetchProfile(await exchangeCode(code));
    } catch (err) {
      return failOauth(res, err instanceof Error ? err.message : 'google_exchange_failed');
    }

    const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
    if (!email || profile.email_verified === false) return failOauth(res, 'email_unverified');

    const next = safeNext(req.cookies?.oauthNext);
    const role = env.ADMIN_EMAIL_SET.has(email) ? 'ADMIN' : 'STUDENT';
    const user = await upsertGoogleUser(profile, email, role);

    await issueSession(user, res);
    res.redirect(302, `${appOrigin()}${next}`);
  })
);
```

- [ ] **Step 5: Run the OAuth tests and watch them pass**

Run: `cd server && npx vitest run tests/oauth.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Run the full server suite and typecheck**

Run: `cd server && npm test`
Expected: all green. Record the count.

Run: `cd server && npm run typecheck` — expected exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/auth.ts server/src/middleware/originCheck.ts server/tests/oauth.test.ts
git commit -m "feat(server): Google sign-in routes with state CSRF defence and admin allowlist"
```

---

### Task 6: Client — Google-only auth UI

**Files:**
- Create: none
- Delete: `client/src/pages/auth/Register.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `client/src/__tests__/Register.test.tsx`, `ForgotPassword.test.tsx`, `ResetPassword.test.tsx`
- Modify: `client/src/pages/auth/Login.tsx`, `client/src/api/client.ts`, `client/src/context/AuthContext.tsx`, `client/src/routes/index.tsx`, `client/src/types/index.ts`, `client/src/pages/student/Profile.tsx`, `client/src/__tests__/Login.test.tsx`, `routes.test.tsx`, `Profile.test.tsx`, `AppLayout.test.tsx`, `Dashboard.test.tsx`, `SessionExpiryBanner.test.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/oauth/google` (Task 5); `env.ADMIN_EMAIL_SET` is server-side only
- Produces: `api.auth.googleStartUrl(next?: string): string`; `AuthContextValue` = `{ user, sessionExpiresAt, status, expired, logout }`; `ProfileUpdateInput` = `{ name?: string }`

- [ ] **Step 1: Rewrite `Login.test.tsx`**

Delete `Login.test.tsx` and write it fresh with four tests:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import Login from '@/pages/auth/Login';

const authValue = (over: Partial<AuthContextValue> = {}): AuthContextValue => ({
  user: null,
  sessionExpiresAt: null,
  status: 'anonymous',
  expired: false,
  logout: vi.fn(),
  ...over
});

const renderLogin = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <AuthContext.Provider value={authValue()}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/student" element={<div>Student Home</div>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
```

1. renders a single "Continue with Google" link pointing at the start route —
   `expect(screen.getByRole('link', { name: /continue with google/i }).getAttribute('href'))
   .toMatch(/\/api\/auth\/oauth\/google$/)`
2. preserves `?next` — render `?next=%2Fstudent` and expect the href to end with
   `?next=%2Fstudent`
3. drops an unsafe `next` — render `?next=//evil.example.com` and expect the href
   to match `/\/api\/auth\/oauth\/google$/` with no `next` in it
4. shows the failure banner for `?oauth=error` — expect
   `screen.getByRole('alert')` to have text matching `/sign-in didn't complete/i`,
   and no such alert without the param

**Assert the path with a regex, never an exact string.** `BASE_URL` in `api/client.ts` is `import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : '')`; under vitest `DEV` is true, so the href is `http://localhost:3001/api/auth/oauth/google`, not the bare path. An exact-equality assertion would pass in production and fail in the test run.

**Every context injection in the other five test files must drop `login` and `verifyRegister` from the object literal** — TypeScript's excess-property check makes them compile errors otherwise.

- [ ] **Step 2: Run the client suite and watch Login's tests fail**

Run: `cd client && npx vitest run src/__tests__/Login.test.tsx`
Expected: FAIL — no Google link exists yet.

- [ ] **Step 3: Add `googleStartUrl` and trim `api.auth`**

In `client/src/api/client.ts`, replace the `auth` object with:

```ts
  auth: {
    /**
     * A navigation target, not a request: the browser goes straight to the
     * server, which owns the OAuth handshake. BASE_URL is '' in production, so
     * this is a same-origin path that the /api rewrite forwards.
     */
    googleStartUrl: (next?: string) =>
      `${BASE_URL}/api/auth/oauth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`,
    logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
    me: () => request<SessionResponse>('/api/auth/me')
  },
```

Delete `login`, `sendRegisterOtp`, `verifyRegister`, `forgotPassword`, `resetPassword` and `refresh` from it, and delete the now-unused types those signatures referenced.

- [ ] **Step 4: Rewrite `Login.tsx`**

Replace the whole form with the single-button card. Keep the file's existing `safeNext` helper, the brand lockup, and the already-authenticated early return. The body of the card becomes:

```tsx
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-sub">Use your Google account to continue.</p>

        {oauthFailed && (
          <p className="form-error" role="alert">
            Sign-in didn&apos;t complete. Please try again.
          </p>
        )}

        <a
          className="btn btn--primary btn--md btn--block"
          href={api.auth.googleStartUrl(next ?? undefined)}
        >
          Continue with Google
        </a>
```

with, alongside the existing `const next = safeNext(searchParams.get('next'));`,
`const oauthFailed = searchParams.get('oauth') === 'error';`. Delete every
`Field`, the email/password validators, the `errors`/`submitting` state, the
submit handler, the "Don't have an account?" link and the
`/forgot-password` link. Keep the `.auth-footer` element only if it still has
content worth keeping; otherwise remove it.

The button is a text button on the existing `.btn` scale **plus** the inline
Google "G" that spec §5.1 requires. Shape:

```tsx
const GOOGLE_G = (
  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
    {/* the four official Google brand paths, #4285F4 #EA4335 #FBBC05 #34A853 */}
  </svg>
);
```

Three rules, all of which the reviewer will check:

- **The path data must be Google's official brand asset**, copied from Google's
  sign-in button guidelines — do not hand-write or approximate the four paths, and
  do not invent a base64 blob. If you cannot obtain the official markup, stop and
  report that instead of shipping a guessed logo.
- One module constant. No component, no JSX branch, no re-render cost.
- `aria-hidden` + `focusable="false"`, so the accessible name stays
  "Continue with Google" and `getByRole('link', { name: /continue with google/i })`
  matches.

- [ ] **Step 5: Trim `AuthContext`**

In `client/src/context/AuthContext.tsx` delete `login` and `verifyRegister` from
`AuthContextValue` and their `useCallback` implementations, and remove both from
the memo dependency array. `useAuth()`'s remaining surface is
`{ user, sessionExpiresAt, status, expired, logout }`.

- [ ] **Step 6: Update the route table, types and Profile**

`client/src/routes/index.tsx`: replace the `Register`, `ForgotPassword` and
`ResetPassword` route entries with a single

```tsx
{ path: '/register', element: <Navigate to="/login" replace /> },
```

Delete the three now-unused imports. `/forgot-password` and `/reset-password`
are gone and fall through to `*` → `NotFound`.

`client/src/types/index.ts`: delete `OtpSentResponse`; change
`ProfileUpdateInput` to `{ name?: string }`.

`client/src/pages/student/Profile.tsx`: delete the password section — the
`currentPassword` field, the `newPassword` field, the mismatch check, and the
`INVALID_CREDENTIALS` mapping. The form keeps the name field, its save button,
and the existing success/error copy.

- [ ] **Step 7: Delete the dead pages and their tests**

```bash
cd client && rm src/pages/auth/Register.tsx src/pages/auth/ForgotPassword.tsx src/pages/auth/ResetPassword.tsx src/__tests__/Register.test.tsx src/__tests__/ForgotPassword.test.tsx src/__tests__/ResetPassword.test.tsx
```

- [ ] **Step 8: Update `routes.test.tsx` and `Profile.test.tsx`**

`routes.test.tsx`: add a case asserting `/register` renders the login page after
the redirect. `Profile.test.tsx`: delete the password tests, keep a name-update
test, and drop `login`/`verifyRegister` from its context literal.

- [ ] **Step 9: Run the full client suite, typecheck and build**

Run: `cd client && npm test`
Expected: all green. Record the count.

Run: `cd client && npm run typecheck` — expected exit 0. A "not assignable to
AuthContextValue" error means a test file still injects the removed fields.

Run: `cd client && npm run build` — expected exit 0, and the bundle smaller than
the previous build.

- [ ] **Step 10: Verify nothing still references the removed auth API**

Run: `cd client && rg -n "verifyRegister|sendRegisterOtp|forgotPassword|resetPassword|OtpSentResponse|currentPassword" src/`
Expected: no matches.

- [ ] **Step 11: Commit**

```bash
git add -A client
git commit -m "feat(client): Google-only sign-in; drop password, register and OTP pages"
```

---

### Task 7: Whole-branch verification

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run both suites and both builds from a clean state**

```bash
cd server && npm test
cd server && npm run typecheck && npm run build
cd client && npm test
cd client && npm run typecheck && npm run build
```

Expected: every command exits 0. Paste the counts into the ledger.

- [ ] **Step 2: Confirm the dependency removals landed**

```bash
cd server && npm ls argon2 nodemailer
```

Expected: npm reports the packages as absent ("empty" or not found). This
command **exits non-zero when they are correctly gone** — that is the pass
condition, not a failure.

- [ ] **Step 3: Confirm the deploy surface still serves the callback**

Read `client/vercel.json`. It must still be unchanged: the three rewrites
(`/api/(.*)`, `/uploads/(.*)`, `/(.*)` → `/index.html`). The callback
`/api/auth/oauth/google/callback` is matched by the first rewrite, so no change
is required — confirm and do not edit the file.

- [ ] **Step 4: Write the deploy checklist into the ledger**

Record the four user actions from the spec's §9 (Google Cloud redirect URIs,
Render env vars **before** the server deploy, `CLIENT_ORIGIN` containing
`https://quizora-rho.vercel.app`, and the optional `$unset` of `passwordHash`).
These are not code and must not be attempted from here.
