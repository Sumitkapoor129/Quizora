import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connect, disconnect } from '../src/db/connect.js';
import { RefreshSession } from '../src/models/RefreshSession.js';
import { User } from '../src/models/User.js';

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

const PASSWORD = 'password123';

async function seedUser(email = 'seed@example.com', name = 'Seed'): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await User.create({ email, name, passwordHash });
}

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

describe('POST /api/auth/register', () => {
  it('creates a STUDENT, sets auth cookies, and never leaks secrets', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'Alice@Example.com', password: PASSWORD });

    expect(res.status).toBe(201);
    expectAuthBody(res.body, 'alice@example.com', 'Alice');

    const access = cookiePair(res, 'accessToken');
    const refresh = cookiePair(res, 'refreshToken');
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.every((c) => c.includes('HttpOnly'))).toBe(true);
    expect(res.text).not.toContain('passwordHash');
    expect(res.text).not.toContain(PASSWORD);
    expect(res.body.user).not.toHaveProperty('isCorrect');

    // Raw refresh token is never persisted; only its sha256 hash is.
    const rawToken = refresh!.slice('refreshToken='.length);
    const session = await RefreshSession.findOne({}).select('+tokenHash');
    expect(session).not.toBeNull();
    const expectedHash = createHash('sha256').update(rawToken).digest('hex');
    expect(session!.tokenHash).toBe(expectedHash);
    expect(session!.tokenHash).not.toBe(rawToken);
  });

  it('ignores a client-supplied role', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Mallory', email: 'mallory@example.com', password: PASSWORD, role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('STUDENT');
    const stored = await User.findOne({ email: 'mallory@example.com' });
    expect(stored!.role).toBe('STUDENT');
  });

  it('rejects invalid payloads with the exact inline field messages', async () => {
    const cases = [
      { body: { email: 'a@example.com', password: PASSWORD }, field: 'name', message: 'Name is required.' },
      { body: { name: 'No Email', email: '', password: PASSWORD }, field: 'email', message: 'Email is required.' },
      { body: { name: 'Bad Email', email: 'not-an-email', password: PASSWORD }, field: 'email', message: 'Enter a valid email address.' },
      { body: { name: 'Short Pw', email: 'b@example.com', password: 'short' }, field: 'password', message: 'Password must be at least 8 characters.' }
    ];

    for (const c of cases) {
      const res = await request(app).post('/api/auth/register').send(c.body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toContainEqual({ field: c.field, message: c.message });
    }
  });

  it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dup One', email: 'dup@example.com', password: PASSWORD });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dup Two', email: 'dup@example.com', password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' }
    });
  });
});

describe('POST /api/auth/login', () => {
  it('logs in an existing user and sets cookies', async () => {
    await seedUser('login@example.com', 'Log In');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expectAuthBody(res.body, 'login@example.com', 'Log In');
    expect(cookiePair(res, 'accessToken')).toBeDefined();
    expect(cookiePair(res, 'refreshToken')).toBeDefined();
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    await seedUser('wrongpw@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpw@example.com', password: 'not-the-password' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
    });
  });

  it('rejects an unknown email with 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user for an authenticated request', async () => {
    await seedUser('me@example.com', 'Me User');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'me@example.com', password: PASSWORD });
    const access = cookiePair(login, 'accessToken')!;

    const res = await request(app).get('/api/auth/me').set('Cookie', access);
    expect(res.status).toBe(200);
    expectAuthBody(res.body, 'me@example.com', 'Me User');
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
    await seedUser('race@example.com', 'Race');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'race@example.com', password: PASSWORD });
    const first = cookiePair(login, 'refreshToken')!;

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
    expectAuthBody(after.body, 'race@example.com', 'Race');
  });

  it('revokes the session on a genuine replay outside the race window', async () => {
    await seedUser('replay@example.com', 'Replay');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'replay@example.com', password: PASSWORD });
    const first = cookiePair(login, 'refreshToken')!;

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', first);
    expect(rotated.status).toBe(200);
    const second = cookiePair(rotated, 'refreshToken')!;

    // Backdate the rotation so the replay falls outside the authentication race window.
    const firstHash = createHash('sha256').update(first.slice('refreshToken='.length)).digest('hex');
    await RefreshSession.updateOne({ previousTokenHash: firstHash }, { $set: { rotatedAt: new Date(Date.now() - 15_000) } });

    // Replaying the already-rotated token is detected as reuse.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', first);
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
    await seedUser('logout@example.com');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logout@example.com', password: PASSWORD });
    const refresh = cookiePair(login, 'refreshToken')!;

    const res = await request(app).post('/api/auth/logout').set('Cookie', refresh);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.some((c) => c.startsWith('accessToken=;'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('refreshToken=;'))).toBe(true);

    const afterLogout = await request(app).post('/api/auth/refresh').set('Cookie', refresh);
    expect(afterLogout.status).toBe(401);
  });
});
