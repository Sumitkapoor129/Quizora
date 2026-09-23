import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const PASSWORD = 'password123';
const NEW_PASSWORD = 'newpassword9';

const ATTEMPT_KEYS = ['attemptId', 'date', 'marksEarned', 'percent', 'status', 'testId', 'testTitle', 'totalMarks'];

let mongo: MongoMemoryServer | undefined;
let app: Express;
let uploadDir: string;
let adminCookie: string;
let studentCookie: string;
let student2Cookie: string;

beforeAll(async () => {
  uploadDir = await mkdtemp(join(os.tmpdir(), 'exampro-upload-'));
  process.env.UPLOAD_DIR = uploadDir;

  const { createApp } = await import('../src/app.js');
  const { connect, disconnect } = await import('../src/db/connect.js');
  const { User } = await import('../src/models/User.js');
  const { Test } = await import('../src/models/Test.js');
  const { TestAttempt } = await import('../src/models/TestAttempt.js');

  app = createApp();
  mongo = await MongoMemoryServer.create();
  await connect(mongo.getUri());
  await User.init();
  await Test.init();
  await TestAttempt.init();

  const admin = await seedUser('admin@example.com', 'Admin', 'ADMIN');
  adminCookie = admin.cookie;
  const s1 = await seedUser('s1@example.com', 'Student One', 'STUDENT');
  studentCookie = s1.cookie;
  const s2 = await seedUser('s2@example.com', 'Student Two', 'STUDENT');
  student2Cookie = s2.cookie;

  async function seedUser(email: string, name: string, role: 'ADMIN' | 'STUDENT'): Promise<{ id: string; cookie: string }> {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await User.create({ email, name, passwordHash, role });
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    return { id: String(login.body.user.id), cookie: cookiePair(login, 'accessToken')! };
  }
}, 120_000);

afterAll(async () => {
  const { disconnect } = await import('../src/db/connect.js');
  await disconnect();
  await mongo?.stop();
  await rm(uploadDir, { recursive: true, force: true });
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

// ---- Fixture builders (minimal: one section, one question worth 2 marks) ----

/** Creates + publishes a test via the admin API. Returns the test id. */
async function publishTest(title: string): Promise<string> {
  const created = await request(app).post('/api/admin/tests').set('Cookie', adminCookie).send({ title });
  const id = (created.body as { id: string }).id;
  const put = await request(app)
    .put(`/api/admin/tests/${id}`)
    .set('Cookie', adminCookie)
    .send({
      title,
      shuffleQuestions: false,
      shuffleOptions: false,
      sections: [
        {
          title: 'S',
          order: 0,
          durationSec: 600,
          questions: [
            {
              type: 'SINGLE',
              order: 0,
              text: 'q?',
              marks: 2,
              options: [
                { order: 0, text: 'a', isCorrect: true },
                { order: 1, text: 'b', isCorrect: false }
              ]
            }
          ]
        }
      ]
    });
  expect(put.status).toBe(200);
  const pub = await request(app).post(`/api/admin/tests/${id}/publish`).set('Cookie', adminCookie);
  expect(pub.status).toBe(200);
  return id;
}

async function createAttempt(testId: string, cookie: string = studentCookie): Promise<string> {
  const res = await request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', cookie);
  expect(res.status).toBe(201);
  return (res.body.attempt as { id: string }).id;
}

/** Starts the attempt, answers the single question correctly, and submits. */
async function completeAttempt(attemptId: string, cookie: string = studentCookie): Promise<void> {
  const started = await request(app).post(`/api/student/attempts/${attemptId}/start`).set('Cookie', cookie);
  expect(started.status).toBe(200);
  const q = started.body.attempt.sections[0].questions[0];
  const optionA = q.options.find((o: { text: string }) => o.text === 'a');
  const save = await request(app)
    .put(`/api/student/attempts/${attemptId}/answers`)
    .set('Cookie', cookie)
    .send({ currentQuestionIndex: 0, answers: [{ questionId: q.questionId, selectedOptionIds: [optionA.optionId] }] });
  expect(save.status).toBe(200);
  const submit = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', cookie);
  expect(submit.status).toBe(200);
  expect(submit.body.attempt).toMatchObject({ status: 'SUBMITTED', score: 2, maxScore: 2 });
}

// ---- 1. Own attempts: empty list + newest-first ----

describe('GET /api/student/attempts', () => {
  it('returns an empty list with no attempts, else own attempts newest-first', async () => {
    const empty = await request(app).get('/api/student/attempts').set('Cookie', student2Cookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ attempts: [] });

    // s1: submitted attempt on test A, then a GATED attempt on test B (newer).
    const testA = await publishTest('Portal Test A');
    const a1 = await createAttempt(testA);
    await completeAttempt(a1);
    const testB = await publishTest('Portal Test B');
    const a2 = await createAttempt(testB);

    const res = await request(app).get('/api/student/attempts').set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    const attempts = res.body.attempts as Array<Record<string, unknown>>;
    expect(attempts.map((a) => a.attemptId)).toEqual([a2, a1]);

    for (const a of attempts) expect(Object.keys(a).sort()).toEqual(ATTEMPT_KEYS);

    expect(attempts[0]).toMatchObject({
      attemptId: a2,
      testId: testB,
      testTitle: 'Portal Test B',
      status: 'GATED',
      marksEarned: 0,
      totalMarks: 0,
      percent: 0
    });
    expect(typeof attempts[0].date).toBe('string');
    expect(Number.isNaN(Date.parse(attempts[0].date as string))).toBe(false);

    expect(attempts[1]).toMatchObject({
      attemptId: a1,
      testId: testA,
      testTitle: 'Portal Test A',
      status: 'SUBMITTED',
      marksEarned: 2,
      totalMarks: 2,
      percent: 100
    });
    expect(Number.isNaN(Date.parse(attempts[1].date as string))).toBe(false);
  });

  it('returns only the calling student attempts (scoping)', async () => {
    const scopeTest = await publishTest('Portal Scope Test');
    const s2Attempt = await createAttempt(scopeTest, student2Cookie);

    const s1Res = await request(app).get('/api/student/attempts').set('Cookie', studentCookie);
    expect(s1Res.status).toBe(200);
    const s1Ids = (s1Res.body.attempts as Array<{ attemptId: string }>).map((a) => a.attemptId);
    expect(s1Ids).not.toContain(s2Attempt);
    expect(s1Ids.length).toBeGreaterThanOrEqual(2);

    const s2Res = await request(app).get('/api/student/attempts').set('Cookie', student2Cookie);
    expect(s2Res.status).toBe(200);
    const s2Ids = (s2Res.body.attempts as Array<{ attemptId: string }>).map((a) => a.attemptId);
    expect(s2Ids).toEqual([s2Attempt]);
  });
});

// ---- 2. Profile ----

describe('PATCH /api/student/profile', () => {
  it('updates the name and returns the /auth/me response shape', async () => {
    const res = await request(app)
      .patch('/api/student/profile')
      .set('Cookie', studentCookie)
      .send({ name: 'Renamed Student' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: expect.any(String), email: 's1@example.com', name: 'Renamed Student', role: 'STUDENT' },
      sessionExpiresAt: expect.any(String)
    });
    expect(Number.isNaN(Date.parse(res.body.sessionExpiresAt))).toBe(false);

    const me = await request(app).get('/api/auth/me').set('Cookie', studentCookie);
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe('Renamed Student');
  });

  it('changes the password when the current password verifies', async () => {
    const res = await request(app)
      .patch('/api/student/profile')
      .set('Cookie', student2Cookie)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: 's2@example.com',
      name: 'Student Two',
      role: 'STUDENT'
    });

    // The new password logs in; the old one no longer does.
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ email: 's2@example.com', password: NEW_PASSWORD });
    expect(loginNew.status).toBe(200);
    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ email: 's2@example.com', password: PASSWORD });
    expect(loginOld.status).toBe(401);
  });

  it('rejects a wrong current password with 400 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .patch('/api/student/profile')
      .set('Cookie', studentCookie)
      .send({ currentPassword: 'wrong-password', newPassword: 'anotherpassword1' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' }
    });
  });

  it('rejects a body with no name or password, and a too-short newPassword (400)', async () => {
    const empty = await request(app).patch('/api/student/profile').set('Cookie', studentCookie).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(empty.body.error.details).toContainEqual({
      field: 'name',
      message: 'Provide a name or a new password.'
    });

    const short = await request(app)
      .patch('/api/student/profile')
      .set('Cookie', studentCookie)
      .send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    expect(short.body.error.details).toContainEqual({
      field: 'newPassword',
      message: 'Password must be at least 8 characters.'
    });
  });
});
