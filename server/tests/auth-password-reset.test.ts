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
const NEW_PASSWORD = 'new-password-456';

function otpCodeFromMail(to: string): string {
  const call = [...vi.mocked(sendMail).mock.calls].reverse().find((c) => c[0].to === to);
  expect(call, `expected a mail to ${to}`).toBeDefined();
  const match = /(\d{6})/.exec(call![0].text);
  expect(match, `expected a 6-digit code in mail to ${to}`).not.toBeNull();
  return match![1];
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

/** Creates an account via the two-step registration flow. */
async function registerUser(email: string, name: string): Promise<void> {
  await request(app).post('/api/auth/register').send({ name, email, password: PASSWORD });
  await request(app)
    .post('/api/auth/register/verify')
    .send({ name, email, password: PASSWORD, code: otpCodeFromMail(email) });
}

/** Step 1 of reset: mails a PASSWORD_RESET OTP and returns the code. */
async function sendResetOtp(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/forgot-password').send({ email });
  expect(res.status).toBe(200);
  return otpCodeFromMail(email);
}

describe('POST /api/auth/forgot-password', () => {
  it('emails a PASSWORD_RESET OTP for an existing account', async () => {
    await registerUser('forgot@example.com', 'Forgot');
    vi.mocked(sendMail).mockClear();

    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'forgot@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'forgot@example.com', otpExpiresAt: expect.any(String) });
    expect(Date.parse(res.body.otpExpiresAt)).toBeGreaterThan(Date.now());
    expect(otpCodeFromMail('forgot@example.com')).toMatch(/^\d{6}$/);

    const otp = await EmailOtp.findOne({ email: 'forgot@example.com', purpose: 'PASSWORD_RESET' });
    expect(otp).not.toBeNull();
    expect(otp!.attemptsLeft).toBe(5);
  });

  it('for an unknown email runs the same store+mail machinery (no enumeration by shape or timing)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    // Identical response shape to the existing-account path…
    expect(res.body).toEqual({ email: 'ghost@example.com', otpExpiresAt: expect.any(String) });
    expect(Date.parse(res.body.otpExpiresAt)).toBeGreaterThan(Date.now());
    // …and identical work on the server (DB write + mail round trip), so the
    // wall-clock timing cannot reveal whether the account exists.
    expect(otpCodeFromMail('ghost@example.com')).toMatch(/^\d{6}$/);
    const otp = await EmailOtp.findOne({ email: 'ghost@example.com', purpose: 'PASSWORD_RESET' });
    expect(otp).not.toBeNull();
    expect(otp!.attemptsLeft).toBe(5);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/reset-password', () => {
  it('resets the password, revokes all sessions, and clears the auth cookies', async () => {
    await registerUser('reset@example.com', 'Reset');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
    const oldRefresh = cookiePair(login, 'refreshToken')!;

    const code = await sendResetOtp('reset@example.com');
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'reset@example.com', code, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.some((c) => c.startsWith('accessToken=;'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('refreshToken=;'))).toBe(true);

    // Every refresh session on the account was revoked at reset time…
    const user = await User.findOne({ email: 'reset@example.com' });
    expect(await RefreshSession.countDocuments({ userId: user!._id, revokedAt: null })).toBe(0);

    // …so the pre-reset session can no longer refresh.
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', oldRefresh);
    expect(refresh.status).toBe(401);

    // The old password no longer works; the new one does.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a wrong code with OTP_INVALID', async () => {
    await registerUser('reset-wrong@example.com', 'Reset Wrong');
    await sendResetOtp('reset-wrong@example.com');

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'reset-wrong@example.com', code: '000000', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_INVALID');

    // Password untouched: the old one still logs in.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset-wrong@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('rejects an expired code with OTP_EXPIRED', async () => {
    await registerUser('reset-expired@example.com', 'Reset Expired');
    const code = await sendResetOtp('reset-expired@example.com');
    await EmailOtp.updateOne(
      { email: 'reset-expired@example.com', purpose: 'PASSWORD_RESET' },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } }
    );

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'reset-expired@example.com', code, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('rejects a short new password with 400', async () => {
    await registerUser('reset-short@example.com', 'Reset Short');
    const code = await sendResetOtp('reset-short@example.com');

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'reset-short@example.com', code, newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a REGISTER-purpose code used at /reset-password', async () => {
    await registerUser('cross@example.com', 'Cross Purpose');

    // Plant an active REGISTER-purpose code for the same email (a real
    // register flow cannot mint one for an existing account, so create the
    // fixture directly).
    await EmailOtp.create({
      email: 'cross@example.com',
      purpose: 'REGISTER',
      codeHash: createHash('sha256').update('123456').digest('hex'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attemptsLeft: 5
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'cross@example.com', code: '123456', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_INVALID');

    // The cross-purpose attempt neither consumed nor decremented the
    // REGISTER-purpose code…
    const otp = await EmailOtp.findOne({ email: 'cross@example.com', purpose: 'REGISTER' });
    expect(otp).not.toBeNull();
    expect(otp!.attemptsLeft).toBe(5);

    // …and the password is untouched.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cross@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
  });
});