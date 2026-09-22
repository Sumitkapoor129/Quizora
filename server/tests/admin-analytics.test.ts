import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const PASSWORD = 'password123';

let mongo: MongoMemoryServer | undefined;
let app: Express;
let uploadDir: string;
let adminCookie: string;
let studentCookie: string;
let student2Cookie: string;

type AnalyticsBody = {
  testId: string | null;
  summary: {
    scoredAttempts: number;
    attemptsToday: number;
    avgScorePercent: number | null;
    highestScorePercent: number | null;
    lowestScorePercent: number | null;
    avgCorrectPercent: number | null;
    totalWarnings: number;
  };
  distribution: Array<{ bucket: number; count: number }>;
  perQuestion: Array<{
    questionId: string;
    testId: string;
    testTitle: string;
    sectionIndex: number;
    type: 'SINGLE' | 'MULTI';
    text?: string;
    marks: number;
    attempted: number;
    correct: number;
    difficulty: number | null;
  }>;
  violations: {
    byType: Record<string, number>;
    attemptsWithViolations: number;
    totalWarnings: number;
  };
};

async function getAnalytics(query = ''): Promise<request.Response> {
  return request(app).get(`/api/admin/analytics${query}`).set('Cookie', adminCookie);
}

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

  async function seedUser(email: string, name: string, role: 'ADMIN' | 'STUDENT'): Promise<{ cookie: string }> {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await User.create({ email, name, passwordHash, role });
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    const raw = login.headers['set-cookie'];
    const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const access = list.map((c) => c.split(';')[0]).find((c) => c.startsWith('accessToken='))!;
    return { cookie: access };
  }

  const admin = await seedUser('analytics-admin@example.com', 'Analytics Admin', 'ADMIN');
  adminCookie = admin.cookie;
  const s1 = await seedUser('a1@example.com', 'Analytics One', 'STUDENT');
  studentCookie = s1.cookie;
  const s2 = await seedUser('a2@example.com', 'Analytics Two', 'STUDENT');
  student2Cookie = s2.cookie;
}, 120_000);

afterAll(async () => {
  const { disconnect } = await import('../src/db/connect.js');
  await disconnect();
  await mongo?.stop();
  await rm(uploadDir, { recursive: true, force: true });
});

// ---- Fixture builders + student flow (mirror admin-attempts.test.ts) ----

type OptionWrite = { order: number; text: string; isCorrect?: boolean };
type QuestionWrite = {
  type: 'SINGLE' | 'MULTI';
  order: number;
  text: string;
  marks: number;
  negativeMarks?: number;
  options: OptionWrite[];
};
type SectionWrite = {
  title: string;
  order: number;
  durationSec: number;
  questions: QuestionWrite[];
};

const opt = (order: number, text: string, isCorrect = false): OptionWrite => ({ order, text, isCorrect });

const singleQ = (order: number, text: string, marks: number, options: OptionWrite[], extra: Partial<QuestionWrite> = {}): QuestionWrite => ({
  type: 'SINGLE',
  order,
  text,
  marks,
  options,
  ...extra
});

async function publishTest(title: string, sections: SectionWrite[]): Promise<string> {
  const created = await request(app).post('/api/admin/tests').set('Cookie', adminCookie).send({ title });
  const id = (created.body as { id: string }).id;
  const put = await request(app)
    .put(`/api/admin/tests/${id}`)
    .set('Cookie', adminCookie)
    .send({ title, shuffleQuestions: false, shuffleOptions: false, sections });
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

async function startAttempt(attemptId: string, cookie: string = studentCookie): Promise<Record<string, any>> {
  const res = await request(app).post(`/api/student/attempts/${attemptId}/start`).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body as Record<string, any>;
}

async function putAnswers(attemptId: string, answers: Array<{ questionId: string; selectedOptionIds: string[] }>, cookie: string = studentCookie): Promise<void> {
  const res = await request(app)
    .put(`/api/student/attempts/${attemptId}/answers`)
    .set('Cookie', cookie)
    .send({ currentQuestionIndex: 0, answers });
  expect(res.status).toBe(200);
}

async function submitAttempt(attemptId: string, cookie: string = studentCookie): Promise<void> {
  const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', cookie);
  expect(res.status).toBe(200);
}

function qById(started: Record<string, any>, text: string): Record<string, any> {
  return started.attempt.sections[0].questions.find((qq: any) => qq.text === text);
}

/** One completed + submitted attempt. Returns { attemptId, questions } for assertions. */
async function runAttempt(
  testId: string,
  cookie: string,
  answers: Array<{ text: string; optionTexts: string[] }>,
  beforeSubmit?: (attemptId: string) => Promise<void>
): Promise<{ attemptId: string; questionIds: Record<string, string> }> {
  const attemptId = await createAttempt(testId, cookie);
  const started = await startAttempt(attemptId, cookie);
  const questionIds: Record<string, string> = {};
  const payload = answers.map((a) => {
    const q = qById(started, a.text);
    questionIds[a.text] = q.questionId;
    const opts = a.optionTexts.map((t) => q.options.find((o: any) => o.text === t).optionId);
    return { questionId: q.questionId, selectedOptionIds: opts };
  });
  await putAnswers(attemptId, payload, cookie);
  if (beforeSubmit) await beforeSubmit(attemptId);
  await submitAttempt(attemptId, cookie);
  return { attemptId, questionIds };
}

// ---- 1. Auth guard ----

describe('admin analytics auth guard', () => {
  it('rejects STUDENT tokens with 403 on GET /api/admin/analytics', async () => {
    const res = await request(app).get('/api/admin/analytics').set('Cookie', studentCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });
  });
});

// ---- 2. Empty state (runs before any attempt exists) ----

describe('GET /api/admin/analytics empty state', () => {
  it('returns nulls/zeros, 10 zero-filled buckets, empty perQuestion and violations when nothing has started', async () => {
    const res = await getAnalytics();
    expect(res.status).toBe(200);
    expect(res.body as AnalyticsBody).toEqual({
      testId: null,
      summary: {
        scoredAttempts: 0,
        attemptsToday: 0,
        avgScorePercent: null,
        highestScorePercent: null,
        lowestScorePercent: null,
        avgCorrectPercent: null,
        totalWarnings: 0
      },
      distribution: Array.from({ length: 10 }, (_, i) => ({ bucket: i * 10, count: 0 })),
      perQuestion: [],
      violations: { byType: {}, attemptsWithViolations: 0, totalWarnings: 0 }
    });
  });
});

// ---- 3. Invalid testId ----

describe('GET /api/admin/analytics validation', () => {
  it('returns 400 with the validation error shape for a non-ObjectId testId', async () => {
    const res = await getAnalytics('?testId=not-an-object-id');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('testId');
  });
});

// ---- 4. Known scores over a MULTI + SINGLE test ----

describe('GET /api/admin/analytics scoring aggregates', () => {
  it('computes summary, buckets, per-question stats and violations for a known MULTI + SINGLE test', async () => {
    const testId = await publishTest('Analytics Main', [
      {
        title: 'Section One',
        order: 0,
        durationSec: 600,
        questions: [
          singleQ(0, 'q1 single', 4, [opt(0, 'a1', true), opt(1, 'b1')]),
          { ...singleQ(1, 'q2 multi', 6, [opt(0, 'x1', true), opt(1, 'y1', true), opt(2, 'z1')]), type: 'MULTI' }
        ]
      }
    ]);

    // s1: Q1 correct (4), Q2 WRONG (partial multi → 0), then 2 violations fired
    // while still IN_PROGRESS: COPY via the student events API (counts as a
    // warning), FULLSCREEN_EXIT pumped directly through the model (manual POST
    // equivalent) so the total stays under the 3-strike auto-submit.
    const s1 = await runAttempt(
      testId,
      studentCookie,
      [
        { text: 'q1 single', optionTexts: ['a1'] },
        { text: 'q2 multi', optionTexts: ['x1'] }
      ],
      async (attemptId) => {
        const copyRes = await request(app)
          .post(`/api/student/attempts/${attemptId}/events`)
          .set('Cookie', studentCookie)
          .send({ type: 'COPY' });
        expect(copyRes.status).toBe(200);
        const { TestAttempt } = await import('../src/models/TestAttempt.js');
        await TestAttempt.updateOne(
          { _id: attemptId },
          { $push: { events: { type: 'FULLSCREEN_EXIT', createdAt: new Date() } }, $inc: { warningCount: 1 } }
        );
      }
    );

    // s2: Q1 WRONG (0), Q2 correct (6).
    await runAttempt(testId, student2Cookie, [
      { text: 'q1 single', optionTexts: ['b1'] },
      { text: 'q2 multi', optionTexts: ['x1', 'y1'] }
    ]);

    const res = await getAnalytics(`?testId=${testId}`);
    expect(res.status).toBe(200);
    const body = res.body as AnalyticsBody;
    expect(body.testId).toBe(testId);

    expect(body.summary).toEqual({
      scoredAttempts: 2,
      attemptsToday: 2,
      avgScorePercent: 50,
      highestScorePercent: 60,
      lowestScorePercent: 40,
      avgCorrectPercent: 50,
      totalWarnings: 2
    });

    // 40% → bucket 4, 60% → bucket 6.
    expect(body.distribution).toHaveLength(10);
    expect(body.distribution[4]).toEqual({ bucket: 40, count: 1 });
    expect(body.distribution[6]).toEqual({ bucket: 60, count: 1 });
    for (const [i, b] of body.distribution.entries()) {
      expect(b.bucket).toBe(i * 10);
      if (i !== 4 && i !== 6) expect(b.count).toBe(0);
    }

    expect(body.perQuestion).toEqual([
      {
        questionId: s1.questionIds['q1 single'],
        testId,
        testTitle: 'Analytics Main',
        sectionIndex: 0,
        type: 'SINGLE',
        text: 'q1 single',
        marks: 4,
        attempted: 2,
        correct: 1,
        difficulty: 50
      },
      {
        questionId: s1.questionIds['q2 multi'],
        testId,
        testTitle: 'Analytics Main',
        sectionIndex: 0,
        type: 'MULTI',
        text: 'q2 multi',
        marks: 6,
        attempted: 2,
        correct: 1,
        difficulty: 50
      }
    ]);

    // START/SUBMIT events must NOT appear in byType; only the two violations.
    expect(body.violations).toEqual({
      byType: { COPY: 1, FULLSCREEN_EXIT: 1 },
      attemptsWithViolations: 1,
      totalWarnings: 2
    });
  });
});

// ---- 5. ?testId filter narrows the aggregate ----

describe('GET /api/admin/analytics ?testId filter', () => {
  it('narrows the aggregate to one test vs the unfiltered view', async () => {
    const filterTest = await publishTest('Analytics Filter', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'fq', 2, [opt(0, 'fa', true), opt(1, 'fb')])] }
    ]);
    await runAttempt(filterTest, studentCookie, [{ text: 'fq', optionTexts: ['fa'] }]);

    // A second, independent test: the unfiltered aggregate must span both, so
    // these assertions hold no matter how many earlier tests/attempts ran (the
    // old hard-coded "3" silently coupled this test to the scoring test above).
    const siblingTest = await publishTest('Analytics Filter Sibling', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'sq', 2, [opt(0, 'sa', true), opt(1, 'sb')])] }
    ]);
    await runAttempt(siblingTest, studentCookie, [{ text: 'sq', optionTexts: ['sa'] }]);

    const filtered = await getAnalytics(`?testId=${filterTest}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.testId).toBe(filterTest);
    expect((filtered.body as AnalyticsBody).summary.scoredAttempts).toBe(1);
    expect((filtered.body as AnalyticsBody).summary.attemptsToday).toBe(1);

    const filteredSibling = await getAnalytics(`?testId=${siblingTest}`);
    expect(filteredSibling.status).toBe(200);
    expect(filteredSibling.body.testId).toBe(siblingTest);
    expect((filteredSibling.body as AnalyticsBody).summary.scoredAttempts).toBe(1);

    // Unfiltered view spans every test (at least our two) and is broader than
    // either filter.
    const unfiltered = await getAnalytics();
    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body.testId).toBeNull();
    const all = unfiltered.body as AnalyticsBody;
    expect(all.summary.scoredAttempts).toBeGreaterThanOrEqual(2);
    expect(all.summary.scoredAttempts).not.toBe((filtered.body as AnalyticsBody).summary.scoredAttempts);
    expect(all.summary.attemptsToday).toBeGreaterThanOrEqual(2);

    // Every perQuestion entry carries its test identity, whether the test was
    // created here or by an earlier describe block.
    for (const q of all.perQuestion) {
      expect(q.testId).toBeTruthy();
      expect(q.testTitle).toBeTruthy();
    }

    // Soft-deleted tests keep contributing text + title to analytics.
    const del = await request(app).delete(`/api/admin/tests/${filterTest}`).set('Cookie', adminCookie);
    expect(del.status).toBe(204);
    const afterDelete = await getAnalytics(`?testId=${filterTest}`);
    expect(afterDelete.status).toBe(200);
    const delBody = afterDelete.body as AnalyticsBody;
    expect(delBody.summary.scoredAttempts).toBe(1);
    expect(delBody.perQuestion).toHaveLength(1);
    expect(delBody.perQuestion[0]).toMatchObject({
      testId: filterTest,
      testTitle: 'Analytics Filter',
      text: 'fq'
    });
  });
});

// ---- 6. attemptsToday window ----

describe('GET /api/admin/analytics attemptsToday', () => {
  it('counts only attempts submitted within the last 24h, excluding old submittedAt', async () => {
    const testId = await publishTest('Analytics Old', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'oq', 1, [opt(0, 'oa', true), opt(1, 'ob')])] }
    ]);
    const { attemptId } = await runAttempt(testId, studentCookie, [{ text: 'oq', optionTexts: ['oa'] }]);

    const fresh = await getAnalytics(`?testId=${testId}`);
    expect((fresh.body as AnalyticsBody).summary.attemptsToday).toBe(1);

    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.updateOne(
      { _id: attemptId },
      { $set: { submittedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } }
    );

    const stale = await getAnalytics(`?testId=${testId}`);
    expect(stale.status).toBe(200);
    const body = stale.body as AnalyticsBody;
    // The old attempt is still part of the scored analysis, but not "today".
    expect(body.summary.scoredAttempts).toBe(1);
    expect(body.summary.attemptsToday).toBe(0);
  });
});