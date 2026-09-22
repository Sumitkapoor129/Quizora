import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const PASSWORD = 'password123';

const NOT_IN_PROGRESS = 'This attempt is not in progress.';
const ALREADY_STARTED = 'This attempt has already been started.';
const NOT_STARTED = 'This attempt has not been started yet.';
const NOT_SUBMITTED = 'This attempt has not been submitted yet.';

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

// ---- Fixture builders (mirror the admin authoring contract) ----

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
  negativeMarksOverride?: number;
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

/** Creates + fills + publishes a test via the admin API. Returns the test id. */
async function publishTest(
  title: string,
  sections: SectionWrite[],
  opts: Partial<{ shuffleQuestions: boolean; shuffleOptions: boolean; defaultNegativeMarks: number }> = {}
): Promise<string> {
  const created = await request(app).post('/api/admin/tests').set('Cookie', adminCookie).send({ title });
  const id = (created.body as { id: string }).id;
  const put = await request(app)
    .put(`/api/admin/tests/${id}`)
    .set('Cookie', adminCookie)
    .send({ title, ...opts, sections });
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

function findOptionId(body: Record<string, any>, questionText: string, optionText: string): string {
  const q = body.attempt.sections[0].questions.find((qq: any) => qq.text === questionText);
  return q.options.find((o: any) => o.text === optionText).optionId as string;
}

// ---- 1. List published tests ----

describe('student auth guards', () => {
  it('rejects anonymous requests with 401', async () => {
    const res = await request(app).get('/api/student/tests');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
  });

  it('rejects ADMIN tokens with 403 on student routes', async () => {
    const res = await request(app).get('/api/student/tests').set('Cookie', adminCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });
  });

  it('still enforces admin-only on admin routes', async () => {
    const res = await request(app).get('/api/admin/tests').set('Cookie', studentCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });
  });
});

describe('GET /api/student/tests', () => {
  it('lists only PUBLISHED non-soft-deleted tests with summary and attempt null', async () => {
    // DRAFT (hidden), PUBLISHED (shown), PUBLISHED-then-deleted (hidden).
    await request(app).post('/api/admin/tests').set('Cookie', adminCookie).send({ title: 'Draft Hidden' });
    const published = await publishTest('Published One', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        negativeMarksOverride: 0.5,
        questions: [
          singleQ(0, 'q?', 2, [opt(0, 'a', true), opt(1, 'b')])
        ]
      }
    ], { shuffleQuestions: false, shuffleOptions: false, defaultNegativeMarks: 0.25 });
    const doomed = await publishTest('Doomed Hidden', [
      {
        title: 'S',
        order: 0,
        durationSec: 30,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    await request(app).delete(`/api/admin/tests/${doomed}`).set('Cookie', adminCookie);

    const res = await request(app).get('/api/student/tests').set('Cookie', studentCookie);

    expect(res.status).toBe(200);
    const tests = res.body.tests as Array<Record<string, unknown>>;
    const titles = tests.map((t) => t.title);
    expect(titles).not.toContain('Draft Hidden');
    expect(titles).not.toContain('Doomed Hidden');
    expect(titles).toContain('Published One');

    const pub = tests.find((t) => t.title === 'Published One')!;
    expect(pub).toMatchObject({
      id: expect.any(String),
      sectionCount: 1,
      questionCount: 1,
      totalDurationSec: 60,
      totalMarks: 2,
      defaultNegativeMarks: 0.25,
      shuffleQuestions: false,
      shuffleOptions: false
    });
    expect(pub.attempt).toBeNull();
    // Never any question/section content in the list.
    expect(JSON.stringify(pub)).not.toContain('"sections"');
  });

  it('includes the attempt summary once an attempt exists', async () => {
    const testId = await publishTest('Attempted Test', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);

    const attemptId = await createAttempt(testId);
    const res = await request(app).get('/api/student/tests').set('Cookie', studentCookie);
    const pub = (res.body.tests as Array<Record<string, unknown>>).find((t) => t.title === 'Attempted Test')!;
    expect(pub.attempt).toEqual({ id: attemptId, status: 'GATED' });
  });
});

// ---- 2. Create attempt ----

describe('POST /api/student/tests/:testId/attempts', () => {
  it('creates a GATED attempt the first time (201)', async () => {
    const testId = await publishTest('Create Once', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const res = await request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', studentCookie);

    expect(res.status).toBe(201);
    expect(res.body.attempt).toMatchObject({ testId, status: 'GATED' });
    expect(typeof res.body.attempt.id).toBe('string');
  });

  it('is idempotent: returns the same attempt with 200 on repeat', async () => {
    const testId = await publishTest('Create Twice', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const first = await request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', studentCookie);
    const second = await request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', studentCookie);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.attempt.id).toBe(first.body.attempt.id);
    expect(second.body.attempt.status).toBe('GATED');
    expect(second.body.attempt.testId).toBe(testId);
  });

  it('returns 404 for an unknown test', async () => {
    const unknown = '0123456789abcdef01234567';
    const res = await request(app).post(`/api/student/tests/${unknown}/attempts`).set('Cookie', studentCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a DRAFT test', async () => {
    const created = await request(app).post('/api/admin/tests').set('Cookie', adminCookie).send({ title: 'Draft Nope' });
    const res = await request(app)
      .post(`/api/student/tests/${(created.body as { id: string }).id}/attempts`)
      .set('Cookie', studentCookie);
    expect(res.status).toBe(404);
  });

  it('returns 409 EXAM_ALREADY_SUBMITTED after the attempt was submitted', async () => {
    const testId = await publishTest('Create After Submit', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);
    const submit = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);
    expect(submit.status).toBe(200);

    const res = await request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', studentCookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'EXAM_ALREADY_SUBMITTED',
        message: 'You have already submitted this exam.',
        details: { attemptId }
      }
    });
  });
});

// ---- 3. Start ----

describe('POST /api/student/attempts/:attemptId/start', () => {
  it('captures blueprint in source order when shuffles are off, without leaking answers', async () => {
    const testId = await publishTest(
      'No Shuffle',
      [
        {
          title: 'Math',
          order: 0,
          durationSec: 3600,
          negativeMarksOverride: 1,
          questions: [
            singleQ(5, 'q5', 2, [opt(2, 'c'), opt(0, 'a', true), opt(1, 'b')]),
            singleQ(1, 'q1', 3, [opt(1, 'y'), opt(0, 'x', true)]),
            singleQ(3, 'q3', 4, [opt(3, 'w'), opt(0, 'v', true), opt(2, 'u'), opt(1, 't')])
          ]
        }
      ],
      { shuffleQuestions: false, shuffleOptions: false, defaultNegativeMarks: 0.25 }
    );
    const attemptId = await createAttempt(testId);
    const body = await startAttempt(attemptId);
    const attempt = body.attempt;

    expect(attempt).toMatchObject({
      id: attemptId,
      status: 'IN_PROGRESS',
      testId,
      testTitle: 'No Shuffle',
      currentQuestionIndex: 0,
      warningCount: 0
    });

    const section = attempt.sections[0];
    expect(section).toMatchObject({
      sectionIndex: 0,
      title: 'Math',
      durationSec: 3600,
      negativeMarks: 1 // section override, not the 0.25 default
    });

    // Questions presented in source `order` (5,1,3 → 1,3,5); options too.
    expect(section.questions.map((q: any) => q.text)).toEqual(['q1', 'q3', 'q5']);
    expect(section.questions.map((q: any) => q.questionIndex)).toEqual([0, 1, 2]);
    const q1 = section.questions.find((q: any) => q.text === 'q1');
    expect(q1.options.map((o: any) => o.text)).toEqual(['x', 'y']); // option orders 0,1
    expect(q1.marks).toBe(3);
    expect(q1.negativeMarks).toBe(1); // question overrides nothing → section override

    // Deadlines: whole test + per-section cumulative.
    const startedAt = Date.parse(attempt.startedAt);
    expect(startedAt).toBeGreaterThan(0);
    expect(Date.parse(attempt.endAt)).toBe(startedAt + 3600 * 1000);
    expect(Date.parse(section.endAt)).toBe(startedAt + 3600 * 1000);

    // maxScore = 3+4+2, totalQuestions = 3.
    expect(await getAttempt(attemptId)).toMatchObject({ maxScore: 9, totalQuestions: 3 });

    // The student NEVER sees correct answers or explanations.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('isCorrect');
    expect(raw).not.toContain('explanation');
    expect(raw).not.toContain('correctOptionIds');
  });

  it('shuffles deterministically per-attempt, keeps section order, and sets cumulative section deadlines', async () => {
    const questions: QuestionWrite[] = Array.from({ length: 10 }, (_, i) =>
      singleQ(i, `q${i}`, 1, [
        opt(0, `a${i}`, i % 2 === 0),
        opt(1, `b${i}`, i % 2 === 1),
        opt(2, `c${i}`),
        opt(3, `d${i}`)
      ])
    );
    const testId = await publishTest(
      'Shuffled',
      [
        { title: 'S0', order: 0, durationSec: 600, questions },
        { title: 'S1', order: 1, durationSec: 300, questions: questions.slice(0, 5) }
      ],
      { shuffleQuestions: true, shuffleOptions: true }
    );

    const adminRes = await request(app).get(`/api/admin/tests/${testId}`).set('Cookie', adminCookie);
    const sourceSectionTitles = adminRes.body.sections.map((s: any) => s.title);
    const sourceQ0 = adminRes.body.sections[0].questions.map((q: any) => q.text);

    const attemptId = await createAttempt(testId);
    const body = await startAttempt(attemptId);

    // Sections keep author order; only questions/options shuffle.
    expect(body.attempt.sections.map((s: any) => s.title)).toEqual(sourceSectionTitles);

    const qOrder = body.attempt.sections[0].questions.map((q: any) => q.text);
    expect([...qOrder].sort()).toEqual([...sourceQ0].sort());
    // With 10 questions the identity permutation is effectively impossible.
    expect(qOrder.join(',')).not.toBe(sourceQ0.join(','));

    // Options are a permutation of the source set per question.
    for (const q of body.attempt.sections[0].questions) {
      const i = Number(q.text.slice(1));
      expect(q.options.map((o: any) => o.text).sort()).toEqual([`a${i}`, `b${i}`, `c${i}`, `d${i}`].sort());
    }

    // Global questionIndex runs across sections: first question of section 1 is index 10.
    expect(body.attempt.sections[1].questions[0].questionIndex).toBe(10);
    expect(body.attempt.totalQuestions ?? body.attempt.sections.flatMap((s: any) => s.questions).length).toBe(15);
    expect(await getAttempt(attemptId)).toMatchObject({ maxScore: 15, totalQuestions: 15 });

    // Cumulative per-section deadlines: S0 → +600s, S1 → +900s = whole-test endAt.
    const startedAt = Date.parse(body.attempt.startedAt);
    expect(Date.parse(body.attempt.sections[0].endAt)).toBe(startedAt + 600 * 1000);
    expect(Date.parse(body.attempt.sections[1].endAt)).toBe(startedAt + 900 * 1000);
    expect(Date.parse(body.attempt.endAt)).toBe(startedAt + 900 * 1000);

    // Resume sees the SAME order (blueprint persisted per attempt).
    const resumed = await request(app).get(`/api/student/attempts/${attemptId}`).set('Cookie', studentCookie);
    expect(resumed.status).toBe(200);
    const resumedOrder = resumed.body.attempt.sections[0].questions.map((q: any) => q.text);
    expect(resumedOrder).toEqual(qOrder);
    expect(JSON.stringify(resumed.body)).not.toContain('isCorrect');
  });

  it('returns 409 ALREADY_STARTED on a second start', async () => {
    const testId = await publishTest('Start Twice', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);

    const res = await request(app).post(`/api/student/attempts/${attemptId}/start`).set('Cookie', studentCookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'ALREADY_STARTED', message: ALREADY_STARTED } });
  });

  it('returns 409 TEST_NOT_AVAILABLE when the test was unpublished after gating', async () => {
    const testId = await publishTest('Unpublish Trap', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await request(app).post(`/api/admin/tests/${testId}/unpublish`).set('Cookie', adminCookie);

    const res = await request(app).post(`/api/student/attempts/${attemptId}/start`).set('Cookie', studentCookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEST_NOT_AVAILABLE');
  });
});

// ---- 4. Save answers ----

describe('PUT /api/student/attempts/:attemptId/answers', () => {
  it('upserts answers, derives isAttempted, supports undo, and never moves endAt', async () => {
    const testId = await publishTest('Autosave', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [
          singleQ(0, 'q1', 2, [opt(0, 'a', true), opt(1, 'b')]),
          singleQ(1, 'q2', 2, [opt(0, 'c', true), opt(1, 'd')])
        ]
      }
    ]);
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const endAt = started.attempt.endAt;
    const q1 = findOptionId(started, 'q1', 'a');
    const q2 = findOptionId(started, 'q2', 'c');
    const questionId1 = started.attempt.sections[0].questions.find((qq: any) => qq.text === 'q1').questionId;

    const save = await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({
        currentQuestionIndex: 1,
        answers: [
          { questionId: questionId1, selectedOptionIds: [q1], isMarked: true },
          { questionId: started.attempt.sections[0].questions.find((qq: any) => qq.text === 'q2').questionId, selectedOptionIds: [q2] }
        ]
      });

    expect(save.status).toBe(200);
    expect(typeof save.body.savedAt).toBe('string');
    expect(Date.parse(save.body.savedAt)).toBeGreaterThan(0);
    expect(save.body).toMatchObject({ status: 'IN_PROGRESS', endAt });

    let attempt = await getAttempt(attemptId);
    expect(attempt.currentQuestionIndex).toBe(1);
    const saved1 = attempt.answers.find((a: any) => a.questionId === questionId1);
    expect(saved1).toMatchObject({ selectedOptionIds: [q1], isAttempted: true, isMarked: true });
    // Pre-submit answers must NOT expose scoring fields.
    expect('isCorrect' in saved1).toBe(false);
    expect('marksAwarded' in saved1).toBe(false);

    // Upsert (same questionId) replaces, does not duplicate.
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 2, answers: [{ questionId: questionId1, selectedOptionIds: [q1] }] });
    attempt = await getAttempt(attemptId);
    expect(attempt.answers.filter((a: any) => a.questionId === questionId1)).toHaveLength(1);
    expect(attempt.answers.find((a: any) => a.questionId === questionId1).isMarked).toBe(true); // preserved

    // Undo to empty selection: cleared, isAttempted false, still one entry.
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 2, answers: [{ questionId: questionId1, selectedOptionIds: [] }] });
    attempt = await getAttempt(attemptId);
    const undone = attempt.answers.find((a: any) => a.questionId === questionId1);
    expect(undone.selectedOptionIds).toEqual([]);
    expect(undone.isAttempted).toBe(false);

    // endAt is server-owned and untouched by any save.
    const after = await request(app).get(`/api/student/attempts/${attemptId}`).set('Cookie', studentCookie);
    expect(after.body.attempt.endAt).toBe(endAt);
  });

  it('returns 409 NOT_IN_PROGRESS for a GATED attempt', async () => {
    const testId = await publishTest('Gate Answers', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    const res = await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'NOT_IN_PROGRESS', message: NOT_IN_PROGRESS } });
  });

  it('returns 400 VALIDATION_ERROR for an invalid body', async () => {
    const testId = await publishTest('Bad Autosave', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);
    const res = await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: -1, answers: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---- 5. Events ----

describe('POST /api/student/attempts/:attemptId/events', () => {
  it('stores anti-cheat events and returns the expected response shape', async () => {
    const testId = await publishTest('Events', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);

    const res = await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', studentCookie)
      .send({ type: 'FULLSCREEN_EXIT', payload: { reason: 'user' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'IN_PROGRESS', warningCount: 1, submitted: false });

    const attempt = await getAttempt(attemptId);
    const event = attempt.events.find((e: any) => e.type === 'FULLSCREEN_EXIT');
    expect(event).toMatchObject({ type: 'FULLSCREEN_EXIT', payload: { reason: 'user' } });
    expect(typeof event.createdAt).toBe('string');
    expect(attempt.events.some((e: any) => e.type === 'START')).toBe(true);
  });

  it('gates IN_PROGRESS and validates the type enum', async () => {
    const testId = await publishTest('Events Gate', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);

    const gated = await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', studentCookie)
      .send({ type: 'COPY' });
    expect(gated.status).toBe(409);
    expect(gated.body.error.code).toBe('NOT_IN_PROGRESS');

    await startAttempt(attemptId);
    const bad = await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', studentCookie)
      .send({ type: 'BOGUS' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('automatically submits the attempt on the 3rd violation', async () => {
    const testId = await publishTest('Events Auto Submit', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);

    for (let i = 1; i <= 3; i++) {
      const res = await request(app)
        .post(`/api/student/attempts/${attemptId}/events`)
        .set('Cookie', studentCookie)
        .send({ type: i === 1 ? 'COPY' : i === 2 ? 'PASTE' : 'CONTEXT_MENU' });
      expect(res.status).toBe(200);
      expect(res.body.warningCount).toBe(i);
      if (i < 3) {
        expect(res.body).toEqual({ status: 'IN_PROGRESS', warningCount: i, submitted: false });
      } else {
        expect(res.body).toEqual({ status: 'SUBMITTED', warningCount: 3, submitted: true });
      }
    }

    const final = await getAttempt(attemptId);
    expect(final.status).toBe('SUBMITTED');
    expect(final.submittedAt).toBeDefined();
    expect(final.events.some((e: any) => e.type === 'SUBMIT')).toBe(true);

    const result = await request(app)
      .get(`/api/student/attempts/${attemptId}/result`)
      .set('Cookie', studentCookie);
    expect(result.status).toBe(200);
    expect(result.body.attempt.status).toBe('SUBMITTED');

    const fourth = await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', studentCookie)
      .send({ type: 'COPY' });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('NOT_IN_PROGRESS');
  });

  it('does not count informational events toward warnings', async () => {
    const testId = await publishTest('Events Info', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);

    const res = await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', studentCookie)
      .send({ type: 'NETWORK_RECONNECT' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'IN_PROGRESS', warningCount: 0, submitted: false });
  });
});

// ---- 6. Submit + scoring ----

describe('POST /api/student/attempts/:attemptId/submit', () => {
  it('scores from the blueprint: full marks on exact match, negative marks per wrong answer, floor-0 total', async () => {
    const testId = await publishTest(
      'Scored',
      [
        {
          title: 'S',
          order: 0,
          durationSec: 600,
          negativeMarksOverride: 2,
          questions: [
            singleQ(0, 'q1', 4, [opt(0, 'a', true), opt(1, 'b'), opt(2, 'c')]),
            singleQ(1, 'q2', 4, [opt(0, 'a'), opt(1, 'b', true), opt(2, 'c')]),
            { ...singleQ(2, 'q3', 4, [opt(0, 'a', true), opt(1, 'b', true), opt(2, 'c'), opt(3, 'd')]), type: 'MULTI' },
            singleQ(3, 'q4', 4, [opt(0, 'a', true), opt(1, 'b')])
          ]
        }
      ],
      { shuffleQuestions: false, shuffleOptions: false }
    );
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const qid = (text: string) => started.attempt.sections[0].questions.find((q: any) => q.text === text).questionId;

    // q1 correct, q2 wrong, q3 MULTI incomplete (only one of two correct), q4 unattempted.
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({
        currentQuestionIndex: 3,
        answers: [
          { questionId: qid('q1'), selectedOptionIds: [findOptionId(started, 'q1', 'a')] },
          { questionId: qid('q2'), selectedOptionIds: [findOptionId(started, 'q2', 'a')] },
          { questionId: qid('q3'), selectedOptionIds: [findOptionId(started, 'q3', 'a')] }
        ]
      });

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt;
    // q1 +4, q2 −2 (negativeMarksOverride 2), q3 −2 (incomplete MULTI), q4 0 → net 0 (floored).
    expect(attempt).toMatchObject({
      id: attemptId,
      testId,
      testTitle: 'Scored',
      status: 'SUBMITTED',
      score: 0,
      maxScore: 16,
      correctCount: 1,
      totalQuestions: 4
    });
    expect(typeof attempt.submittedAt).toBe('string');
    expect(typeof attempt.startedAt).toBe('string');
    expect(attempt.sections).toEqual([
      { sectionId: started.attempt.sections[0].sectionId, sectionIndex: 0, title: 'S', score: 0, maxScore: 16, correctCount: 1 }
    ]);
    expect(attempt.questions).toEqual([
      { questionId: qid('q1'), questionIndex: 0, isCorrect: true, marksAwarded: 4, isAttempted: true, selectedOptionIds: [findOptionId(started, 'q1', 'a')] },
      { questionId: qid('q2'), questionIndex: 1, isCorrect: false, marksAwarded: -2, isAttempted: true, selectedOptionIds: [findOptionId(started, 'q2', 'a')] },
      { questionId: qid('q3'), questionIndex: 2, isCorrect: false, marksAwarded: -2, isAttempted: true, selectedOptionIds: [findOptionId(started, 'q3', 'a')] },
      { questionId: qid('q4'), questionIndex: 3, isCorrect: false, marksAwarded: 0, isAttempted: false, selectedOptionIds: [] }
    ]);

    // Post-submit GET attempt exposes scoring fields on answers.
    const attemptAfter = await getAttempt(attemptId);
    const a1 = attemptAfter.answers.find((a: any) => a.questionId === qid('q1'));
    expect(a1).toMatchObject({ isCorrect: true, marksAwarded: 4 });
  });

  it('is idempotent: double submit returns the same result without double-scoring', async () => {
    const testId = await publishTest('Double Submit', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 2, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ], { defaultNegativeMarks: 1 });
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const qid = started.attempt.sections[0].questions[0].questionId;
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [{ questionId: qid, selectedOptionIds: [findOptionId(started, 'q?', 'a')] }] });

    const first = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);
    const second = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.attempt).toEqual(first.body.attempt);
    expect(second.body.attempt.score).toBe(2);

    const after = await getAttempt(attemptId);
    expect(after.events.filter((e: any) => e.type === 'SUBMIT')).toHaveLength(1);
  });

  it('returns 409 NOT_STARTED for a GATED attempt', async () => {
    const testId = await publishTest('Submit Gate', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'NOT_STARTED', message: NOT_STARTED } });
  });

  it('supports a TIMED_OUT attempt: result works and answers expose scoring', async () => {
    const testId = await publishTest('Timed Out Test', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 2, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const qid = started.attempt.sections[0].questions[0].questionId;
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [{ questionId: qid, selectedOptionIds: [findOptionId(started, 'q?', 'a')] }] });

    // Score it normally, then simulate the server-side timeout transition.
    await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);
    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.updateOne({ _id: attemptId }, { $set: { status: 'TIMED_OUT' } });

    const result = await request(app).get(`/api/student/attempts/${attemptId}/result`).set('Cookie', studentCookie);
    expect(result.status).toBe(200);
    expect(result.body.attempt.status).toBe('TIMED_OUT');
    expect(result.body.attempt.score).toBe(2);

    const after = await getAttempt(attemptId);
    expect(after.status).toBe('TIMED_OUT');
    expect(after.answers[0]).toMatchObject({ isCorrect: true, marksAwarded: 2 });
  });

  it('lazy-expires an overdue IN_PROGRESS attempt on GET/save: scores with submittedAt = endAt and blocks saves', async () => {
    const testId = await publishTest('Lazy Expiry', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 2, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const qid = started.attempt.sections[0].questions[0].questionId;
    const newEndAt = new Date(Date.now() - 30_000);

    // Force the clock past endAt + grace directly in the DB.
    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.updateOne(
      { _id: attemptId },
      { $set: { endAt: newEndAt } }
    );

    const before = await getAttempt(attemptId);
    expect(before.status).toBe('TIMED_OUT');

    // A late save is rejected with NOT_IN_PROGRESS, not silently applied.
    const save = await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [{ questionId: qid, selectedOptionIds: [findOptionId(started, 'q?', 'a')] }] });
    expect(save.status).toBe(409);
    expect(save.body.error.code).toBe('NOT_IN_PROGRESS');

    // Result exists without a manual submit; it was scored at endAt.
    const result = await request(app).get(`/api/student/attempts/${attemptId}/result`).set('Cookie', studentCookie);
    expect(result.status).toBe(200);
    expect(result.body.attempt.status).toBe('TIMED_OUT');
    expect(result.body.attempt.submittedAt).toBe(newEndAt.toISOString());
  });
});

// ---- 7. Result ----

describe('GET /api/student/attempts/:attemptId/result', () => {
  it('returns 409 NOT_SUBMITTED while in progress', async () => {
    const testId = await publishTest('Result Gate', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);
    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`).set('Cookie', studentCookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'NOT_SUBMITTED', message: NOT_SUBMITTED } });
  });

  it('returns the summary result without the answer key, exposing per-question marks', async () => {
    const testId = await publishTest('Result Test', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        negativeMarksOverride: 1,
        questions: [
          singleQ(0, 'q1', 3, [opt(0, 'a', true), opt(1, 'b')]),
          singleQ(1, 'q2', 1, [opt(0, 'a'), opt(1, 'b', true)])
        ]
      }
    ], { shuffleQuestions: false, shuffleOptions: false });
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const q1 = started.attempt.sections[0].questions.find((q: any) => q.text === 'q1');
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 1, answers: [{ questionId: q1.questionId, selectedOptionIds: [findOptionId(started, 'q1', 'a')] }] });
    await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`).set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt;
    expect(attempt).toMatchObject({
      id: attemptId,
      testId,
      testTitle: 'Result Test',
      status: 'SUBMITTED',
      score: 3,
      maxScore: 4,
      correctCount: 1,
      totalQuestions: 2
    });
    expect(attempt.sections).toEqual([
      { sectionId: started.attempt.sections[0].sectionId, sectionIndex: 0, title: 'S', score: 3, maxScore: 4, correctCount: 1 }
    ]);
    expect(attempt.questions).toEqual([
      { questionId: q1.questionId, questionIndex: 0, isCorrect: true, marksAwarded: 3, isAttempted: true, selectedOptionIds: [findOptionId(started, 'q1', 'a')] },
      { questionId: started.attempt.sections[0].questions.find((q: any) => q.text === 'q2').questionId, questionIndex: 1, isCorrect: false, marksAwarded: 0, isAttempted: false, selectedOptionIds: [] }
    ]);
    // The result summary never includes option ids/correctness of options.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('optionId');
    expect(raw).not.toContain('correctOptionIds');
  });
});

// ---- 8. Cross-student authorization (IDOR → 404) ----

describe('attempt ownership', () => {
  it('returns 404 for another student touching an attempt (start/GET/result/answers)', async () => {
    const testId = await publishTest('Ownership', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId, studentCookie);

    const start = await request(app).post(`/api/student/attempts/${attemptId}/start`).set('Cookie', student2Cookie);
    expect(start.status).toBe(404);
    expect(start.body.error.code).toBe('NOT_FOUND');

    const get = await request(app).get(`/api/student/attempts/${attemptId}`).set('Cookie', student2Cookie);
    expect(get.status).toBe(404);

    const save = await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', student2Cookie)
      .send({ currentQuestionIndex: 0, answers: [] });
    expect(save.status).toBe(404);

    const submit = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', student2Cookie);
    expect(submit.status).toBe(404);

    // student2 can create their own attempt on the same test (unique per student).
    const own = await request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', student2Cookie);
    expect(own.status).toBe(201);
    expect(own.body.attempt.id).not.toBe(attemptId);
  });
});

// ---- 9. Tester: focused regression coverage ----

/**
 * Structural leak check: no option/question object in a pre-submit payload may
 * carry answer-key fields, and options may only expose optionId/text/imageUrl.
 */
function expectNoAnswerKeyLeak(value: unknown): void {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if ('optionId' in obj) {
        expect(obj).not.toHaveProperty('isCorrect');
        expect(obj).not.toHaveProperty('correctOptionIds');
        expect(obj).not.toHaveProperty('explanation');
        for (const key of Object.keys(obj)) {
          expect(['optionId', 'text', 'imageUrl']).toContain(key);
        }
      }
      if ('questionId' in obj) {
        expect(obj).not.toHaveProperty('isCorrect');
        expect(obj).not.toHaveProperty('explanation');
        expect(obj).not.toHaveProperty('correctOptionIds');
      }
      Object.values(obj).forEach(walk);
    }
  };
  walk(value);
}

describe('tester regression coverage', () => {
  it('scores MULTI exactly: full set in ANY order wins; superset and partial get negative marks', async () => {
    const testId = await publishTest(
      'Multi Exact Set',
      [
        {
          title: 'S',
          order: 0,
          durationSec: 600,
          questions: [
            { ...singleQ(0, 'q0', 4, [opt(0, 'a', true), opt(1, 'b', true), opt(2, 'c'), opt(3, 'd')]), type: 'MULTI' },
            { ...singleQ(1, 'q1', 4, [opt(0, 'a', true), opt(1, 'b', true), opt(2, 'c'), opt(3, 'd')]), type: 'MULTI' },
            { ...singleQ(2, 'q2', 4, [opt(0, 'a', true), opt(1, 'b', true), opt(2, 'c'), opt(3, 'd')]), type: 'MULTI' },
            { ...singleQ(3, 'q3', 4, [opt(0, 'a', true), opt(1, 'b', true), opt(2, 'c'), opt(3, 'd')]), type: 'MULTI' },
            singleQ(4, 'q4', 4, [opt(0, 'a', true), opt(1, 'b')])
          ]
        }
      ],
      { shuffleQuestions: false, shuffleOptions: false, defaultNegativeMarks: 0.5 }
    );
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const q = (text: string) => started.attempt.sections[0].questions.find((qq: any) => qq.text === text);
    const optId = (qq: any, text: string) => qq.options.find((o: any) => o.text === text).optionId;

    // q0 exact set [a,b]; q1 exact set in REVERSED order [b,a]; q2 superset
    // [a,b,c]; q3 partial [a]; q4 unattempted.
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({
        currentQuestionIndex: 4,
        answers: [
          { questionId: q('q0').questionId, selectedOptionIds: [optId(q('q0'), 'a'), optId(q('q0'), 'b')] },
          { questionId: q('q1').questionId, selectedOptionIds: [optId(q('q1'), 'b'), optId(q('q1'), 'a')] },
          { questionId: q('q2').questionId, selectedOptionIds: [optId(q('q2'), 'a'), optId(q('q2'), 'b'), optId(q('q2'), 'c')] },
          { questionId: q('q3').questionId, selectedOptionIds: [optId(q('q3'), 'a')] }
        ]
      });

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt;
    // q0 +4, q1 +4 (order-insensitive), q2 −0.5, q3 −0.5, q4 0 → 7; correct 2.
    expect(attempt).toMatchObject({ score: 7, maxScore: 20, correctCount: 2, totalQuestions: 5 });
    expect(attempt.questions).toEqual([
      { questionId: q('q0').questionId, questionIndex: 0, isCorrect: true, marksAwarded: 4, isAttempted: true, selectedOptionIds: [optId(q('q0'), 'a'), optId(q('q0'), 'b')] },
      { questionId: q('q1').questionId, questionIndex: 1, isCorrect: true, marksAwarded: 4, isAttempted: true, selectedOptionIds: [optId(q('q1'), 'b'), optId(q('q1'), 'a')] },
      { questionId: q('q2').questionId, questionIndex: 2, isCorrect: false, marksAwarded: -0.5, isAttempted: true, selectedOptionIds: [optId(q('q2'), 'a'), optId(q('q2'), 'b'), optId(q('q2'), 'c')] },
      { questionId: q('q3').questionId, questionIndex: 3, isCorrect: false, marksAwarded: -0.5, isAttempted: true, selectedOptionIds: [optId(q('q3'), 'a')] },
      { questionId: q('q4').questionId, questionIndex: 4, isCorrect: false, marksAwarded: 0, isAttempted: false, selectedOptionIds: [] }
    ]);
  });

  it('resolves negative marks question → section → test default; only the TOTAL is floored', async () => {
    const testId = await publishTest(
      'Neg Marks Priority',
      [
        {
          title: 'A',
          order: 0,
          durationSec: 300,
          negativeMarksOverride: 2,
          questions: [
            singleQ(0, 'qA1', 3, [opt(0, 'a', true), opt(1, 'b')]),                                    // → -2
            singleQ(1, 'qA2', 3, [opt(0, 'a', true), opt(1, 'b')], { negativeMarks: 1 })              // → -1
          ]
        },
        {
          title: 'B',
          order: 1,
          durationSec: 300,
          questions: [
            singleQ(0, 'qB1', 5, [opt(0, 'a', true), opt(1, 'b')]),                                    // correct → +5
            singleQ(1, 'qB2', 2, [opt(0, 'a', true), opt(1, 'b')])                                     // → -0.5 (test default)
          ]
        }
      ],
      { shuffleQuestions: false, shuffleOptions: false, defaultNegativeMarks: 0.5 }
    );
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    const oId = (sectionTitle: string, qText: string, oText: string) =>
      started.attempt.sections
        .find((s: any) => s.title === sectionTitle)!
        .questions.find((qq: any) => qq.text === qText)!
        .options.find((o: any) => o.text === oText)!.optionId;
    const qid = (sectionTitle: string, qText: string) =>
      started.attempt.sections
        .find((s: any) => s.title === sectionTitle)!
        .questions.find((qq: any) => qq.text === qText)!.questionId;

    // qA1 and qA2 wrong (b), qB1 correct (a), qB2 wrong (b).
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({
        currentQuestionIndex: 3,
        answers: [
          { questionId: qid('A', 'qA1'), selectedOptionIds: [oId('A', 'qA1', 'b')] },
          { questionId: qid('A', 'qA2'), selectedOptionIds: [oId('A', 'qA2', 'b')] },
          { questionId: qid('B', 'qB1'), selectedOptionIds: [oId('B', 'qB1', 'a')] },
          { questionId: qid('B', 'qB2'), selectedOptionIds: [oId('B', 'qB2', 'b')] }
        ]
      });

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt;
    // Section A shows negative (not floored per section); total floored only at 0 — here it stays 1.5.
    expect(attempt.sections).toEqual([
      { sectionId: started.attempt.sections[0].sectionId, sectionIndex: 0, title: 'A', score: -3, maxScore: 6, correctCount: 0 },
      { sectionId: started.attempt.sections[1].sectionId, sectionIndex: 1, title: 'B', score: 4.5, maxScore: 7, correctCount: 1 }
    ]);
    expect(attempt.score).toBe(1.5);
    expect(attempt.correctCount).toBe(1);
    const byQ = new Map(attempt.questions.map((qq: any) => [qq.questionId, qq]));
    expect(byQ.get(qid('A', 'qA1')).marksAwarded).toBe(-2);
    expect(byQ.get(qid('A', 'qA2')).marksAwarded).toBe(-1);
    expect(byQ.get(qid('B', 'qB1')).marksAwarded).toBe(5);
    expect(byQ.get(qid('B', 'qB2')).marksAwarded).toBe(-0.5);
  });

  it('is race-safe: concurrent attempt creation yields exactly one attempt', async () => {
    const testId = await publishTest('Create Race', [
      {
        title: 'S',
        order: 0,
        durationSec: 60,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', studentCookie),
      request(app).post(`/api/student/tests/${testId}/attempts`).set('Cookie', studentCookie)
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.attempt.id).toBe(r2.body.attempt.id);
    expect(r1.body.attempt.testId).toBe(testId);
  });

  it('never leaks answer-key fields structurally in start or pre-submit GET payloads', async () => {
    const testId = await publishTest('Leak Watch', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 2, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    const started = await startAttempt(attemptId);
    expectNoAnswerKeyLeak(started.attempt);
    const rawStart = JSON.stringify(started);
    expect(rawStart).not.toContain('isCorrect');
    expect(rawStart).not.toContain('correctOptionIds');
    expect(rawStart).not.toContain('"blueprint"');

    const q1 = started.attempt.sections[0].questions[0];
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [{ questionId: q1.questionId, selectedOptionIds: [q1.options[0].optionId] }] });

    const pre = await getAttempt(attemptId);
    expectNoAnswerKeyLeak(pre);
    const rawGet = JSON.stringify(pre);
    expect(rawGet).not.toContain('isCorrect');
    expect(rawGet).not.toContain('correctOptionIds');
    expect(rawGet).not.toContain('"blueprint"');
  });

  it('returns 404 for another student on events and result too', async () => {
    const testId = await publishTest('Ownership II', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId, studentCookie);

    const events = await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', student2Cookie)
      .send({ type: 'COPY' });
    expect(events.status).toBe(404);
    expect(events.body.error.code).toBe('NOT_FOUND');

    const result = await request(app).get(`/api/student/attempts/${attemptId}/result`).set('Cookie', student2Cookie);
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects answers and events with 409 NOT_IN_PROGRESS after submit', async () => {
    const testId = await publishTest('Post Submit Gate', [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ]);
    const attemptId = await createAttempt(testId);
    await startAttempt(attemptId);
    await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie);

    const answers = await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [] });
    expect(answers.status).toBe(409);
    expect(answers.body).toEqual({ error: { code: 'NOT_IN_PROGRESS', message: NOT_IN_PROGRESS } });

    const events = await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', studentCookie)
      .send({ type: 'COPY' });
    expect(events.status).toBe(409);
    expect(events.body).toEqual({ error: { code: 'NOT_IN_PROGRESS', message: NOT_IN_PROGRESS } });
  });
});

// ---- shared helpers ----

async function getAttempt(attemptId: string): Promise<Record<string, any>> {
  const res = await request(app).get(`/api/student/attempts/${attemptId}`).set('Cookie', studentCookie);
  expect(res.status).toBe(200);
  return res.body.attempt as Record<string, any>;
}