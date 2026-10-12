import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connect, disconnect } from '../src/db/connect.js';
import { RefreshSession } from '../src/models/RefreshSession.js';
import { User } from '../src/models/User.js';
import { createTestSession } from './helpers/auth.js';

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

/** Returns the `name=value` pair (ready for a Cookie header) for `name`. */
function cookiePair(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  for (const cookie of list) {
    const pair = cookie.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq) === name) return pair;
  }
  return undefined;
}

function expectAuthBody(body: unknown, email: string, name: string): void {
  expect(body).toEqual({
    user: { id: expect.any(String), email, name, role: 'STUDENT' },
    sessionExpiresAt: expect.any(String)
  });
  const sessionExpiresAt = (body as { sessionExpiresAt: string }).sessionExpiresAt;
  expect(Number.isNaN(Date.parse(sessionExpiresAt))).toBe(false);
  expect(Date.parse(sessionExpiresAt)).toBeGreaterThan(Date.now());
}

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

describe('GET /api/auth/me', () => {
  it('returns the current user for an authenticated request', async () => {
    const session = await createTestSession({ name: 'Ada' });

    const res = await request(app).get('/api/auth/me').set('Cookie', session.accessCookie);
    expect(res.status).toBe(200);
    expectAuthBody(res.body, session.email, 'Ada');
  });

  it('rejects anonymous requests with 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' }
    });
  });
});

describe('POST /api/auth/refresh', () => {
  it('keeps the session alive when a rotated token is replayed within the race window', async () => {
    const session = await createTestSession({ name: 'Race' });
    const first = session.refreshCookie;

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', first);
    expect(rotated.status).toBe(200);
    const second = cookiePair(rotated, 'refreshToken');
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    // Two tabs sharing the cookie race on refresh: the loser replays the just-rotated
    // token within the grace window. That must NOT count as theft and revoke the session.
    const concurrent = await request(app).post('/api/auth/refresh').set('Cookie', first);
    expect(concurrent.status).toBe(401);

    // The current token must still work — the session survived the race.
    const after = await request(app).post('/api/auth/refresh').set('Cookie', second!);
    expect(after.status).toBe(200);
    expectAuthBody(after.body, session.email, 'Race');
  });

  it('revokes the session on a genuine replay outside the race window', async () => {
    const session = await createTestSession({ name: 'Replay' });

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', session.refreshCookie);
    expect(rotated.status).toBe(200);
    const second = cookiePair(rotated, 'refreshToken')!;

    // Backdate the rotation so the replay falls outside the authentication race window.
    const firstHash = createHash('sha256').update(session.refreshToken).digest('hex');
    await RefreshSession.updateOne({ previousTokenHash: firstHash }, { $set: { rotatedAt: new Date(Date.now() - 15_000) } });

    // Replaying the already-rotated token is detected as reuse.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', session.refreshCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('UNAUTHENTICATED');

    // The rotation revoked the session, so the freshly issued token is dead too.
    const afterRevoke = await request(app).post('/api/auth/refresh').set('Cookie', second);
    expect(afterRevoke.status).toBe(401);
  });

  it('rejects a missing refresh cookie with 401', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears cookies and makes the refresh token unusable', async () => {
    const session = await createTestSession();

    const res = await request(app).post('/api/auth/logout').set('Cookie', session.refreshCookie);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.some((c) => c.startsWith('accessToken=;'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('refreshToken=;'))).toBe(true);

    const afterLogout = await request(app).post('/api/auth/refresh').set('Cookie', session.refreshCookie);
    expect(afterLogout.status).toBe(401);
  });
});
