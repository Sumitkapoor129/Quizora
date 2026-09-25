import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { connect, disconnect } from '../src/db/connect.js';
import { RefreshSession } from '../src/models/RefreshSession.js';
import { User } from '../src/models/User.js';
import { seedUser } from './helpers/auth.js';

// Derived from config, not hardcoded: the first configured client origin is the
// app the callback redirects to (vitest sets CLIENT_ORIGIN=http://localhost:5173).
const APP_ORIGIN = env.CLIENT_ORIGINS[0];
const ADMIN_EMAIL = 'temp-admin@example.com';

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

/**
 * Node's client always delivers `set-cookie` as an array, but superagent's
 * types declare it as a plain string, so normalise both shapes once here.
 */
function setCookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** Every set-cookie pair from a response, joined into one Cookie header. */
function cookieHeaderOf(res: request.Response): string {
  return setCookiesOf(res)
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** The raw value of one set-cookie, e.g. the state token. */
function cookieValueOf(res: request.Response, name: string): string | undefined {
  for (const c of setCookiesOf(res)) {
    const [pair] = c.split(';');
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return undefined;
}

/** The whole set-cookie string for one cookie, attributes included. */
function rawCookieOf(res: request.Response, name: string): string | undefined {
  return setCookiesOf(res).find((c) => c.startsWith(`${name}=`));
}

/**
 * The `next` the callback will actually act on. cookie@0.7 encodes cookie values
 * with encodeURIComponent on the way out and cookie-parser decodes them on the
 * way back in, so the raw wire value is percent-encoded.
 */
function nextCookieOf(res: request.Response): string | undefined {
  const raw = cookieValueOf(res, 'oauthNext');
  return raw === undefined ? undefined : decodeURIComponent(raw);
}

/** Stubs Google's two endpoints. `overrides` changes the userinfo payload. */
function stubGoogle(profile: Record<string, unknown>, opts: { tokenStatus?: number } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        if (opts.tokenStatus && opts.tokenStatus >= 400) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: opts.tokenStatus });
        }
        return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
      }
      return new Response(JSON.stringify(profile), { status: 200 });
    })
  );
}

/** Runs the start route and returns the state token plus the cookies to replay. */
async function startGoogle(query = ''): Promise<{ state: string; cookie: string }> {
  const res = await request(app).get(`/api/auth/oauth/google${query}`);
  return { state: cookieValueOf(res, 'oauthState') ?? '', cookie: cookieHeaderOf(res) };
}

const okProfile = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sub: 'google-sub-1',
  email: 'student@example.com',
  name: 'Grace Student',
  email_verified: true,
  ...over
});

/**
 * The harm a failed sign-in must never do, asserted in one place so a future
 * "just log it and redirect anyway" shortcut fails every failure test at once.
 */
async function expectSignedOut(res: request.Response, usersBefore: number): Promise<void> {
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe(`${APP_ORIGIN}/login?oauth=error`);
  expect(cookieValueOf(res, 'accessToken')).toBeUndefined();
  expect(cookieValueOf(res, 'refreshToken')).toBeUndefined();
  expect(await User.countDocuments({})).toBe(usersBefore);
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Test 6 moves the allowlist; a thrown assertion must not leak an admin.
  env.ADMIN_EMAIL_SET.delete(ADMIN_EMAIL);
});

describe('GET /api/auth/oauth/google', () => {
  it('redirects to Google with a state cookie bound to that redirect', async () => {
    const res = await request(app).get('/api/auth/oauth/google');
    expect(res.status).toBe(302);

    const location = new URL(String(res.headers.location));
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(location.searchParams.get('state')).toBeTruthy();

    const state = cookieValueOf(res, 'oauthState');
    expect(state).toBeTruthy();
    // The cookie is the CSRF defence, so it must be the same value Google will echo back.
    expect(state).toBe(location.searchParams.get('state'));

    const raw = rawCookieOf(res, 'oauthState') ?? '';
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('Path=/api/auth/oauth');
  });

  it('carries next, and drops anything that is not a plain in-app path', async () => {
    const safe = await request(app).get('/api/auth/oauth/google?next=%2Fstudent%2Ftests');
    expect(nextCookieOf(safe)).toBe('/student/tests');

    for (const unsafe of ['%2F%2Fevil.example.com', '%2F%5Cevil', 'https%3A%2F%2Fevil.example.com']) {
      const res = await request(app).get(`/api/auth/oauth/google?next=${unsafe}`);
      expect(nextCookieOf(res)).toBe('/');
    }
  });
});

describe('GET /api/auth/oauth/google/callback', () => {
  it('signs a new student in and honours next', async () => {
    stubGoogle(okProfile());
    const start = await startGoogle('?next=%2Fstudent%2Ftests');

    const res = await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-1&state=${start.state}`)
      .set('Cookie', start.cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${APP_ORIGIN}/student/tests`);
    expect(cookieValueOf(res, 'accessToken')).toBeTruthy();
    expect(cookieValueOf(res, 'refreshToken')).toBeTruthy();

    const user = await User.findOne({ email: 'student@example.com' });
    expect(await User.countDocuments({ email: 'student@example.com' })).toBe(1);
    expect(user?.googleId).toBe('google-sub-1');
    expect(user?.name).toBe('Grace Student');
    expect(user?.role).toBe('STUDENT');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `accessToken=${cookieValueOf(res, 'accessToken')}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({
      id: String(user!._id),
      email: 'student@example.com',
      name: 'Grace Student',
      role: 'STUDENT'
    });

    // The same flow, for the address vitest.config.ts puts in ADMIN_EMAILS.
    stubGoogle(okProfile({ sub: 'google-sub-allowlist', email: 'admin@example.com' }));
    const adminStart = await startGoogle();
    const adminRes = await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-admin&state=${adminStart.state}`)
      .set('Cookie', adminStart.cookie);

    expect(adminRes.status).toBe(302);
    expect((await User.findOne({ email: 'admin@example.com' }))?.role).toBe('ADMIN');
  });

  it('reuses the account on a second sign-in', async () => {
    stubGoogle(okProfile());
    const start = await startGoogle();
    await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-1&state=${start.state}`)
      .set('Cookie', start.cookie);

    const usersBefore = await User.countDocuments({});
    const again = await startGoogle();
    const res = await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-2&state=${again.state}`)
      .set('Cookie', again.cookie);

    expect(res.status).toBe(302);
    expect(cookieValueOf(res, 'accessToken')).toBeTruthy();
    expect(await User.countDocuments({})).toBe(usersBefore);
    expect(await User.countDocuments({ googleId: 'google-sub-1' })).toBe(1);
  });

  it('links a pre-OAuth account by email and keeps its name', async () => {
    const existing = await seedUser({ name: 'Original Name', role: 'STUDENT' });
    stubGoogle(okProfile({ sub: 'google-sub-linked', email: existing.email }));
    const start = await startGoogle();

    const res = await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-link&state=${start.state}`)
      .set('Cookie', start.cookie);

    expect(res.status).toBe(302);
    const user = await User.findOne({ email: existing.email });
    expect(await User.countDocuments({ email: existing.email })).toBe(1);
    expect(user?.googleId).toBe('google-sub-linked');
    expect(user?.name).toBe('Original Name');
  });

  it('grants and revokes ADMIN from the allowlist on every sign-in', async () => {
    env.ADMIN_EMAIL_SET.add(ADMIN_EMAIL);
    stubGoogle(okProfile({ sub: 'google-sub-admin', email: ADMIN_EMAIL }));

    const first = await startGoogle();
    await request(app)
      .get(`/api/auth/oauth/google/callback?code=c1&state=${first.state}`)
      .set('Cookie', first.cookie);
    expect((await User.findOne({ email: ADMIN_EMAIL }))?.role).toBe('ADMIN');

    env.ADMIN_EMAIL_SET.delete(ADMIN_EMAIL);
    const second = await startGoogle();
    await request(app)
      .get(`/api/auth/oauth/google/callback?code=c2&state=${second.state}`)
      .set('Cookie', second.cookie);

    const user = await User.findOne({ email: ADMIN_EMAIL });
    expect(user?.role).toBe('STUDENT');
    expect(await User.countDocuments({ email: ADMIN_EMAIL })).toBe(1);
  });

  it('signs nobody in when the state does not match the cookie', async () => {
    stubGoogle(okProfile());
    const start = await startGoogle();
    const before = await User.countDocuments({});

    const res = await request(app)
      .get('/api/auth/oauth/google/callback?code=code-1&state=wrong')
      .set('Cookie', start.cookie);

    await expectSignedOut(res, before);
    expect(rawCookieOf(res, 'oauthState')).toMatch(/^oauthState=;/);
  });

  it('signs nobody in when the state cookie is missing', async () => {
    stubGoogle(okProfile());
    const before = await User.countDocuments({});

    const res = await request(app).get('/api/auth/oauth/google/callback?code=code-1&state=whatever');

    await expectSignedOut(res, before);
    expect(rawCookieOf(res, 'oauthState')).toMatch(/^oauthState=;/);
  });

  it('creates nothing when the email is not verified', async () => {
    stubGoogle(okProfile({ email_verified: false }));
    const start = await startGoogle();
    const before = await User.countDocuments({});

    const res = await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-1&state=${start.state}`)
      .set('Cookie', start.cookie);

    await expectSignedOut(res, before);
  });

  it('signs nobody in when Google rejects the code, and leaks nothing', async () => {
    stubGoogle(okProfile(), { tokenStatus: 400 });
    const start = await startGoogle();
    const before = await User.countDocuments({});

    const res = await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-secret&state=${start.state}`)
      .set('Cookie', start.cookie);

    await expectSignedOut(res, before);
    expect(`${res.headers.location}${res.text}`).not.toContain('invalid_grant');
    expect(`${res.headers.location}${res.text}`).not.toContain('code-secret');
  });

  it('signs nobody in when Google reports an error', async () => {
    stubGoogle(okProfile());
    const start = await startGoogle();
    const before = await User.countDocuments({});

    const res = await request(app)
      .get(`/api/auth/oauth/google/callback?error=access_denied&state=${start.state}`)
      .set('Cookie', start.cookie);

    await expectSignedOut(res, before);
    expect(`${res.headers.location}${res.text}`).not.toContain('access_denied');
  });

  it('is exempt from the origin check, and only the callback is', async () => {
    stubGoogle(okProfile({ sub: 'google-sub-referer', email: 'referer@example.com' }));
    const start = await startGoogle();

    const callback = await request(app)
      .get(`/api/auth/oauth/google/callback?code=code-1&state=${start.state}`)
      .set('Cookie', start.cookie)
      .set('Referer', 'https://accounts.google.com/');

    // Not just "not 403": the exempted route must still complete the sign-in.
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${APP_ORIGIN}/`);
    expect(cookieValueOf(callback, 'accessToken')).toBeTruthy();

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Referer', 'https://accounts.google.com/');
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe('ORIGIN_FORBIDDEN');
  });
});
