import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { connect, disconnect } from '../src/db/connect.js';
import { EmailOtp } from '../src/models/EmailOtp.js';
import { RefreshSession } from '../src/models/RefreshSession.js';
import { User } from '../src/models/User.js';
import { sendMail } from '../src/services/mailer.js';
import { OTP_SEND_LIMIT, OTP_VERIFY_LIMIT } from '../src/routes/auth.js';

vi.mock('../src/services/mailer.js', () => ({ sendMail: vi.fn() }));

const app = createApp();

let mongo: MongoMemoryServer | undefined;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connect(mongo.getUri());
  await User.init();
  await RefreshSession.init();
  await EmailOtp.init();
}, 120_000);

beforeEach(() => {
  vi.mocked(sendMail).mockClear();
});

afterAll(async () => {
  await disconnect();
  await mongo?.stop();
});

const PASSWORD = 'password123';

function otpCodeFromMail(to: string): string {
  const call = [...vi.mocked(sendMail).mock.calls].reverse().find((c) => c[0].to === to);
  expect(call, `expected a mail to ${to}`).toBeDefined();
  const match = /(\d{6})/.exec(call![0].text);
  expect(match, `expected a 6-digit code in mail to ${to}`).not.toBeNull();
  return match![1];
}

/** Every 6-digit code mailed to `to` (concurrent sends leave more than one). */
function otpCodesFromMail(to: string): string[] {
  const calls = vi.mocked(sendMail).mock.calls.filter((c) => c[0].to === to);
  expect(calls, `expected at least one mail to ${to}`).not.toHaveLength(0);
  return calls.map((c) => /^.*?(\d{6})/.exec(c[0].text)?.[1] ?? '');
}

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

/** Step 1: mails an OTP for `email` and returns the code from the mailer mock. */
async function sendRegisterOtp(email: string, name: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  return otpCodeFromMail(email);
}

describe('POST /api/auth/register (step 1 — send OTP)', () => {
  it('a new send replaces the prior OTP for the same email', async () => {
    const first = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Replace', email: 'replace@example.com', password: PASSWORD });
    expect(first.status).toBe(201);
    const firstCode = otpCodeFromMail('replace@example.com');
    expect(firstCode).toMatch(/^\d{6}$/);
    expect(await EmailOtp.countDocuments({ email: 'replace@example.com', purpose: 'REGISTER' })).toBe(1);

    const second = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Replace', email: 'replace@example.com', password: PASSWORD });
    expect(second.status).toBe(201);
    const secondCode = otpCodeFromMail('replace@example.com');
    expect(secondCode).not.toBe(firstCode);
    expect(await EmailOtp.countDocuments({ email: 'replace@example.com', purpose: 'REGISTER' })).toBe(1);

    // The first code is dead and the second still works.
    const stale = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Replace', email: 'replace@example.com', password: PASSWORD, code: firstCode });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('OTP_INVALID');

    const fresh = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Replace', email: 'replace@example.com', password: PASSWORD, code: secondCode });
    expect(fresh.status).toBe(201);
  });
});

describe('OTP send vs verify rate limits', () => {
  it('throttles the two SEND routes to 5/min and verify/reset to 10/min', () => {
    expect(OTP_SEND_LIMIT).toBe(5);
    expect(OTP_VERIFY_LIMIT).toBe(10);
    expect(OTP_SEND_LIMIT).toBeLessThan(OTP_VERIFY_LIMIT);
  });
});

describe('POST /api/auth/register/verify (step 2 — create account + session)', () => {
  it('verifies the code, creates a STUDENT with a session, and consumes the OTP', async () => {
    const code = await sendRegisterOtp('verify@example.com', 'Verify');

    const res = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Verify', email: 'verify@example.com', password: PASSWORD, code });
    expect(res.status).toBe(201);
    expectAuthBody(res.body, 'verify@example.com', 'Verify');

    const access = cookiePair(res, 'accessToken');
    const refresh = cookiePair(res, 'refreshToken');
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.every((c) => c.includes('HttpOnly'))).toBe(true);
    expect(res.text).not.toContain(PASSWORD);

    // Raw refresh token is never persisted; only its sha256 hash is.
    const rawToken = refresh!.slice('refreshToken='.length);
    const user = await User.findOne({ email: 'verify@example.com' });
    const session = await RefreshSession.findOne({ userId: user!._id }).select('+tokenHash');
    expect(session).not.toBeNull();
    expect(session!.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(session!.tokenHash).not.toBe(rawToken);

    // A verified OTP is one-time: the document is gone.
    expect(await EmailOtp.countDocuments({ email: 'verify@example.com', purpose: 'REGISTER' })).toBe(0);

    // The new credentials can sign in normally.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'verify@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('rejects a wrong code with OTP_INVALID and decrements attemptsLeft', async () => {
    await sendRegisterOtp('wrong@example.com', 'Wrong Code');
    expect((await EmailOtp.findOne({ email: 'wrong@example.com', purpose: 'REGISTER' }))!.attemptsLeft).toBe(5);

    const bad = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Wrong Code', email: 'wrong@example.com', password: PASSWORD, code: '000000' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('OTP_INVALID');
    expect(await User.exists({ email: 'wrong@example.com' })).toBeNull();

    expect((await EmailOtp.findOne({ email: 'wrong@example.com', purpose: 'REGISTER' }))!.attemptsLeft).toBe(4);
  });

  it('fails with OTP_EXPIRED once the code is past its expiry', async () => {
    const code = await sendRegisterOtp('expired@example.com', 'Expired');
    await EmailOtp.updateOne(
      { email: 'expired@example.com', purpose: 'REGISTER' },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } }
    );

    const res = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Expired', email: 'expired@example.com', password: PASSWORD, code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('rejects a replay of an already-used code with OTP_INVALID', async () => {
    const code = await sendRegisterOtp('replay@example.com', 'Replay');

    const first = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Replay', email: 'replay@example.com', password: PASSWORD, code });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Replay', email: 'replay@example.com', password: PASSWORD, code });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('OTP_INVALID');
  });

  it('locks the code with OTP_ATTEMPTS_EXCEEDED once attemptsLeft runs out', async () => {
    const code = await sendRegisterOtp('locked@example.com', 'Locked');
    // Fast-forward the code to its last attempt so the exhaustion is cheap to
    // exercise; the lock behavior is what matters.
    await EmailOtp.updateOne(
      { email: 'locked@example.com', purpose: 'REGISTER' },
      { $set: { attemptsLeft: 1 } }
    );

    const lastWrong = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Locked', email: 'locked@example.com', password: PASSWORD, code: '000000' });
    expect(lastWrong.status).toBe(400);
    expect(lastWrong.body.error.code).toBe('OTP_INVALID');
    expect((await EmailOtp.findOne({ email: 'locked@example.com', purpose: 'REGISTER' }))!.attemptsLeft).toBe(0);

    // Even the correct code is refused once the OTP is exhausted.
    const res = await request(app)
      .post('/api/auth/register/verify')
      .send({ name: 'Locked', email: 'locked@example.com', password: PASSWORD, code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    expect(await User.exists({ email: 'locked@example.com' })).toBeNull();
  });

  it('parallel wrong guesses cannot exceed the attempt cap or drive the counter negative', async () => {
    const email = 'burst@example.com';
    await sendRegisterOtp(email, 'Burst');
    expect((await EmailOtp.findOne({ email, purpose: 'REGISTER' }))!.attemptsLeft).toBe(5);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/register/verify')
          .send({ name: 'Burst', email, password: PASSWORD, code: '000000' })
      )
    );

    const invalid = results.filter((r) => r.status === 400 && r.body.error.code === 'OTP_INVALID');
    const exceeded = results.filter((r) => r.status === 400 && r.body.error.code === 'OTP_ATTEMPTS_EXCEEDED');
    expect(results.every((r) => r.status === 400)).toBe(true);
    // The decrement is atomic: only the 5 guesses that arrive while
    // attemptsLeft > 0 may consume a guess; the rest are refused as exhausted.
    expect(invalid.length).toBe(5);
    expect(exceeded.length).toBe(5);
    expect(invalid.length + exceeded.length).toBe(10);

    const after = await EmailOtp.findOne({ email, purpose: 'REGISTER' });
    expect(after!.attemptsLeft).toBe(0);
    expect(await User.exists({ email })).toBeNull();
  });

  it('two concurrent sends leave exactly one active OTP and only the winning code verifies', async () => {
    const email = 'concurrent@example.com';
    const [first, second] = await Promise.all([
      request(app).post('/api/auth/register').send({ name: 'Concurrent', email, password: PASSWORD }),
      request(app).post('/api/auth/register').send({ name: 'Concurrent', email, password: PASSWORD })
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    // The (email, purpose) unique index + atomic upsert guarantee exactly one
    // active code even when two sends race.
    expect(await EmailOtp.countDocuments({ email, purpose: 'REGISTER' })).toBe(1);

    const codes = otpCodesFromMail(email);
    expect(codes).toHaveLength(2);
    expect(codes[0]).not.toBe(codes[1]);

    const tryCode = (code: string) =>
      request(app)
        .post('/api/auth/register/verify')
        .send({ name: 'Concurrent', email, password: PASSWORD, code });

    const a = await tryCode(codes[0]);
    const b = await tryCode(codes[1]);

    // Exactly one code survived the concurrent sends; the loser is rejected.
    expect([a, b].filter((r) => r.status === 201)).toHaveLength(1);
    const rejected = [a, b].filter((r) => r.status === 400);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].body.error.code).toBe('OTP_INVALID');

    // The single doc is consumed by the winner; exactly one account is created.
    expect(await EmailOtp.countDocuments({ email, purpose: 'REGISTER' })).toBe(0);
    expect(await User.exists({ email })).not.toBeNull();
  });
});