import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { Types } from 'mongoose';
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
let student1Id: string;
let student2Id: string;

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
  student1Id = s1.id;
  const s2 = await seedUser('s2@example.com', 'Student Two', 'STUDENT');
  student2Cookie = s2.cookie;
  student2Id = s2.id;

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

// ---- Fixture builders (mirror the admin authoring contract + student flow) ----

type OptionWrite = { order: number; text: string; isCorrect?: boolean };
type QuestionWrite = {
  type: 'SINGLE' | 'MULTI';
  order: number;
  text: string;
  marks: number;
  negativeMarks?: number;
  explanation?: string;
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

async function answerCorrect(attemptId: string, started: Record<string, any>, questionText: string, optionText: string, cookie: string = studentCookie): Promise<void> {
  const q = started.attempt.sections[0].questions.find((qq: any) => qq.text === questionText);
  const res = await request(app)
    .put(`/api/student/attempts/${attemptId}/answers`)
    .set('Cookie', cookie)
    .send({ currentQuestionIndex: 0, answers: [{ questionId: q.questionId, selectedOptionIds: [findOptionId(started, questionText, optionText)] }] });
  expect(res.status).toBe(200);
}

async function submitAttempt(attemptId: string, cookie: string = studentCookie): Promise<void> {
  const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set('Cookie', cookie);
  expect(res.status).toBe(200);
}

// ---- 1. Auth guards ----

describe('admin attempt auth guards', () => {
  it('rejects STUDENT tokens with 403 on GET /api/admin/attempts', async () => {
    const res = await request(app).get('/api/admin/attempts').set('Cookie', studentCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });
  });

  it('rejects STUDENT tokens with 403 on GET /api/admin/attempts/:attemptId', async () => {
    const res = await request(app).get('/api/admin/attempts/0123456789abcdef01234567').set('Cookie', studentCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });
  });
});

// ---- 2. List ----

describe('GET /api/admin/attempts', () => {
  it('returns an empty list when nothing has started yet', async () => {
    const res = await request(app).get('/api/admin/attempts').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ attempts: [] });
  });

  it('lists all attempts newest-first with test/student enrichment', async () => {
    const section = (marks: number): SectionWrite[] => [
      {
        title: 'S',
        order: 0,
        durationSec: 600,
        questions: [singleQ(0, 'q?', marks, [opt(0, 'a', true), opt(1, 'b')])]
      }
    ];
    const testA = await publishTest('List Alpha', section(2), { shuffleQuestions: false, shuffleOptions: false });
    const testB = await publishTest('List Beta', section(1), { shuffleQuestions: false, shuffleOptions: false });

    // Creation order: a1 (s1/testA submitted) → a2 (s2/testA submitted) → a3 (s1/testB in-progress) → a4 (s2/testB in-progress).
    const a1 = await createAttempt(testA, studentCookie);
    const startedA1 = await startAttempt(a1, studentCookie);
    await answerCorrect(a1, startedA1, 'q?', 'a', studentCookie);
    await submitAttempt(a1, studentCookie);

    const a2 = await createAttempt(testA, student2Cookie);
    const startedA2 = await startAttempt(a2, student2Cookie);
    await answerCorrect(a2, startedA2, 'q?', 'a', student2Cookie);
    await submitAttempt(a2, student2Cookie);

    const a3 = await createAttempt(testB, studentCookie);
    await startAttempt(a3, studentCookie);

    const a4 = await createAttempt(testB, student2Cookie);
    await startAttempt(a4, student2Cookie);

    const res = await request(app).get('/api/admin/attempts').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const attempts = res.body.attempts as Array<Record<string, any>>;
    expect(attempts.map((x) => x.id)).toEqual([a4, a3, a2, a1]);

    expect(attempts[3]).toMatchObject({
      id: a1,
      testId: testA,
      testTitle: 'List Alpha',
      student: { id: student1Id, name: 'Student One', email: 's1@example.com' },
      status: 'SUBMITTED',
      score: 2,
      maxScore: 2,
      correctCount: 1,
      totalQuestions: 1,
      warningCount: 0
    });
    expect(typeof attempts[3].startedAt).toBe('string');
    expect(typeof attempts[3].submittedAt).toBe('string');

    expect(attempts[2]).toMatchObject({
      id: a2,
      testId: testA,
      testTitle: 'List Alpha',
      student: { id: student2Id, name: 'Student Two', email: 's2@example.com' },
      status: 'SUBMITTED',
      score: 2,
      maxScore: 2,
      correctCount: 1,
      totalQuestions: 1
    });

    expect(attempts[1]).toMatchObject({
      id: a3,
      testId: testB,
      testTitle: 'List Beta',
      student: { id: student1Id, name: 'Student One', email: 's1@example.com' },
      status: 'IN_PROGRESS',
      score: 0,
      maxScore: 1,
      totalQuestions: 1
    });
    expect(typeof attempts[1].startedAt).toBe('string');
    expect(attempts[1].submittedAt).toBeNull();

    expect(attempts[0]).toMatchObject({
      id: a4,
      testId: testB,
      testTitle: 'List Beta',
      student: { id: student2Id, name: 'Student Two', email: 's2@example.com' },
      status: 'IN_PROGRESS',
      score: 0,
      maxScore: 1
    });
    expect(typeof attempts[0].startedAt).toBe('string');
    expect(attempts[0].submittedAt).toBeNull();
  });

  it('filters by ?testId=', async () => {
    const keep = await publishTest('Filter Keep', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])] }
    ]);
    const other = await publishTest('Filter Other', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])] }
    ]);
    const k1 = await createAttempt(keep, studentCookie);
    await createAttempt(other, studentCookie);

    const res = await request(app).get(`/api/admin/attempts?testId=${keep}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0]).toMatchObject({
      id: k1,
      testId: keep,
      testTitle: 'Filter Keep',
      status: 'GATED',
      score: 0,
      correctCount: 0,
      totalQuestions: 0
    });
    // GATED attempts have no timestamps yet → explicit null.
    expect(res.body.attempts[0].startedAt).toBeNull();
    expect(res.body.attempts[0].submittedAt).toBeNull();
  });

  it('treats a blank ?testId= as unfiltered', async () => {
    const testId = await publishTest('Blank Filter', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])] }
    ]);
    await createAttempt(testId, studentCookie);

    const res = await request(app).get('/api/admin/attempts?testId=').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.attempts)).toBe(true);
    expect(res.body.attempts.length).toBeGreaterThan(0);
  });
});

// ---- 2b. Status filter ----

describe('GET /api/admin/attempts ?status filter', () => {
  it('filters by each of the four statuses and composes with testId', async () => {
    const byTitle: Record<string, string> = {};
    for (const title of ['Status Gated', 'Status InProgress', 'Status Submitted', 'Status TimedOut']) {
      byTitle[title] = await publishTest(title, [
        { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])] }
      ], { shuffleQuestions: false, shuffleOptions: false });
    }

    const gated = await createAttempt(byTitle['Status Gated'], studentCookie);

    const inProgress = await createAttempt(byTitle['Status InProgress'], studentCookie);
    await startAttempt(inProgress, studentCookie);

    const submitted = await createAttempt(byTitle['Status Submitted'], studentCookie);
    const started = await startAttempt(submitted, studentCookie);
    await answerCorrect(submitted, started, 'q?', 'a', studentCookie);
    await submitAttempt(submitted, studentCookie);

    const timedOut = await createAttempt(byTitle['Status TimedOut'], studentCookie);
    const startedTO = await startAttempt(timedOut, studentCookie);
    await answerCorrect(timedOut, startedTO, 'q?', 'a', studentCookie);
    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.updateOne({ _id: timedOut }, { $set: { endAt: new Date(Date.now() - 60_000) } });
    // Lazy expiry only runs on the student-facing read, not the admin route.
    const touch = await request(app).get(`/api/student/attempts/${timedOut}`).set('Cookie', studentCookie);
    expect(touch.status).toBe(200);
    expect(touch.body.attempt.status).toBe('TIMED_OUT');

    const idsFor = async (qs: string): Promise<string[]> => {
      const res = await request(app).get(`/api/admin/attempts${qs}`).set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      return (res.body.attempts as Array<Record<string, any>>).map((a) => a.id);
    };

    // Each test has exactly one attempt, so testId+status pins a single row.
    expect(await idsFor(`?testId=${byTitle['Status Gated']}&status=GATED`)).toEqual([gated]);
    expect(await idsFor(`?testId=${byTitle['Status InProgress']}&status=IN_PROGRESS`)).toEqual([inProgress]);
    expect(await idsFor(`?testId=${byTitle['Status Submitted']}&status=SUBMITTED`)).toEqual([submitted]);
    expect(await idsFor(`?testId=${byTitle['Status TimedOut']}&status=TIMED_OUT`)).toEqual([timedOut]);

    // The two filters AND together.
    expect(await idsFor(`?testId=${byTitle['Status Submitted']}&status=GATED`)).toEqual([]);
  });

  it('applies the status filter before the 200-attempt cap', async () => {
    const testId = await publishTest('Status Cap', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'q?', 1, [opt(0, 'a', true), opt(1, 'b')])] }
    ], { shuffleQuestions: false, shuffleOptions: false });

    // One SUBMITTED attempt (oldest), then a flood of newer GATED docs that
    // push it out of the unfiltered 200-row window.
    const submitted = await createAttempt(testId, studentCookie);
    const started = await startAttempt(submitted, studentCookie);
    await answerCorrect(submitted, started, 'q?', 'a', studentCookie);
    await submitAttempt(submitted, studentCookie);

    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.insertMany(
      Array.from({ length: 201 }, () => ({ testId, studentId: new Types.ObjectId(), status: 'GATED' }))
    );

    const unfiltered = await request(app).get(`/api/admin/attempts?testId=${testId}`).set('Cookie', adminCookie);
    expect(unfiltered.status).toBe(200);
    const unfilteredAttempts = unfiltered.body.attempts as Array<Record<string, any>>;
    expect(unfilteredAttempts).toHaveLength(200);
    expect(unfilteredAttempts.every((a) => a.status === 'GATED')).toBe(true);
    expect(unfilteredAttempts.map((a) => a.id)).not.toContain(submitted);

    // Filtering first means the single matching attempt still comes back.
    const filtered = await request(app)
      .get(`/api/admin/attempts?testId=${testId}&status=SUBMITTED`)
      .set('Cookie', adminCookie);
    expect(filtered.status).toBe(200);
    const filteredAttempts = filtered.body.attempts as Array<Record<string, any>>;
    expect(filteredAttempts).toHaveLength(1);
    expect(filteredAttempts[0]).toMatchObject({ id: submitted, status: 'SUBMITTED' });
  });

  it('rejects an unknown status with the flat-details error shape', async () => {
    const res = await request(app).get('/api/admin/attempts?status=DELETE_ME').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('status');
  });
});

// ---- 3. Detail ----

describe('GET /api/admin/attempts/:attemptId', () => {
  it('serializes the full answer key for a submitted multi-section attempt', async () => {
    const testId = await publishTest(
      'Detail Key',
      [
        {
          title: 'Section A',
          order: 0,
          durationSec: 600,
          negativeMarksOverride: 1,
          questions: [
            singleQ(0, 'qA1 correct', 3, [opt(0, 'A1a', true), opt(1, 'A1b')], { explanation: 'because A1' }),
            { ...singleQ(1, 'qA2 multi', 5, [opt(0, 'A2a', true), opt(1, 'A2b', true), opt(2, 'A2c')]), type: 'MULTI' }
          ]
        },
        {
          title: 'Section B',
          order: 1,
          durationSec: 600,
          questions: [singleQ(0, 'qB1 skip', 2, [opt(0, 'B1a', true), opt(1, 'B1b')])]
        }
      ],
      { shuffleQuestions: false, shuffleOptions: false }
    );
    const attemptId = await createAttempt(testId, studentCookie);
    const started = await startAttempt(attemptId, studentCookie);
    const q = (text: string) => started.attempt.sections.flatMap((s: any) => s.questions).find((qq: any) => qq.text === text);
    const optId = (qq: any, text: string) => qq.options.find((o: any) => o.text === text).optionId;

    // qA1 correct, qA2 incomplete MULTI (wrong → −1), qB1 unattempted.
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({
        currentQuestionIndex: 1,
        answers: [
          { questionId: q('qA1 correct').questionId, selectedOptionIds: [optId(q('qA1 correct'), 'A1a')] },
          { questionId: q('qA2 multi').questionId, selectedOptionIds: [optId(q('qA2 multi'), 'A2a')] }
        ]
      });
    // One violation → warningCount 1 and a payload-bearing event in the timeline.
    await request(app)
      .post(`/api/student/attempts/${attemptId}/events`)
      .set('Cookie', studentCookie)
      .send({ type: 'COPY', payload: { reason: 'user' } });
    await submitAttempt(attemptId, studentCookie);

    const res = await request(app).get(`/api/admin/attempts/${attemptId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt as Record<string, any>;

    expect(attempt).toMatchObject({
      id: attemptId,
      testId,
      testTitle: 'Detail Key',
      student: { id: student1Id, name: 'Student One', email: 's1@example.com' },
      status: 'SUBMITTED',
      score: 2,
      maxScore: 10,
      correctCount: 1,
      totalQuestions: 3,
      warningCount: 1
    });
    expect(typeof attempt.startedAt).toBe('string');
    expect(typeof attempt.endAt).toBe('string');
    expect(typeof attempt.submittedAt).toBe('string');

    expect(attempt.sections).toEqual([
      { sectionId: started.attempt.sections[0].sectionId, sectionIndex: 0, title: 'Section A', score: 2, maxScore: 8, correctCount: 1 },
      { sectionId: started.attempt.sections[1].sectionId, sectionIndex: 1, title: 'Section B', score: 0, maxScore: 2, correctCount: 0 }
    ]);

    // Questions in SEALED blueprint order with the answer key + selections.
    expect(attempt.questions).toEqual([
      {
        questionId: q('qA1 correct').questionId,
        questionIndex: 0,
        sectionIndex: 0,
        type: 'SINGLE',
        text: 'qA1 correct',
        explanation: 'because A1',
        marks: 3,
        negativeMarks: 1,
        options: [
          { optionId: optId(q('qA1 correct'), 'A1a'), text: 'A1a', isCorrect: true, selected: true },
          { optionId: optId(q('qA1 correct'), 'A1b'), text: 'A1b', isCorrect: false, selected: false }
        ],
        selectedOptionIds: [optId(q('qA1 correct'), 'A1a')],
        isCorrect: true,
        marksAwarded: 3,
        isAttempted: true
      },
      {
        questionId: q('qA2 multi').questionId,
        questionIndex: 1,
        sectionIndex: 0,
        type: 'MULTI',
        text: 'qA2 multi',
        marks: 5,
        negativeMarks: 1,
        options: [
          { optionId: optId(q('qA2 multi'), 'A2a'), text: 'A2a', isCorrect: true, selected: true },
          { optionId: optId(q('qA2 multi'), 'A2b'), text: 'A2b', isCorrect: true, selected: false },
          { optionId: optId(q('qA2 multi'), 'A2c'), text: 'A2c', isCorrect: false, selected: false }
        ],
        selectedOptionIds: [optId(q('qA2 multi'), 'A2a')],
        isCorrect: false,
        marksAwarded: -1,
        isAttempted: true
      },
      {
        questionId: q('qB1 skip').questionId,
        questionIndex: 2,
        sectionIndex: 1,
        type: 'SINGLE',
        text: 'qB1 skip',
        marks: 2,
        negativeMarks: 0,
        options: [
          { optionId: optId(q('qB1 skip'), 'B1a'), text: 'B1a', isCorrect: true, selected: false },
          { optionId: optId(q('qB1 skip'), 'B1b'), text: 'B1b', isCorrect: false, selected: false }
        ],
        selectedOptionIds: [],
        isCorrect: false,
        marksAwarded: 0,
        isAttempted: false
      }
    ]);

    expect(attempt.events.map((e: any) => e.type)).toEqual(['START', 'COPY', 'SUBMIT']);
    expect(attempt.events[1]).toMatchObject({ payload: { reason: 'user' } });
    for (const e of attempt.events) expect(typeof e.createdAt).toBe('string');
  });

  it('returns 404 for an unknown attempt id', async () => {
    const res = await request(app).get('/api/admin/attempts/0123456789abcdef01234567').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('serializes an attempt even when the Test doc is gone, keeping the blueprint answer key', async () => {
    const testId = await publishTest(
      'Doomed Detail',
      [
        { title: 'S', order: 0, durationSec: 600, questions: [singleQ(0, 'ghost', 2, [opt(0, 'x', true), opt(1, 'y')], { explanation: 'gone' })] }
      ],
      { shuffleQuestions: false, shuffleOptions: false }
    );
    const attemptId = await createAttempt(testId, studentCookie);
    const started = await startAttempt(attemptId, studentCookie);
    const q1 = started.attempt.sections[0].questions[0];
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [{ questionId: q1.questionId, selectedOptionIds: [q1.options[0].optionId] }] });
    await submitAttempt(attemptId, studentCookie);

    const { Test } = await import('../src/models/Test.js');
    await Test.deleteOne({ _id: testId });

    const res = await request(app).get(`/api/admin/attempts/${attemptId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt as Record<string, any>;
    expect(attempt.testTitle).toBe('');
    expect(attempt.student).toEqual({ id: student1Id, name: 'Student One', email: 's1@example.com' });
    expect(attempt.status).toBe('SUBMITTED');
    expect(attempt.score).toBe(2);

    const question = attempt.questions[0];
    expect(question.text).toBeUndefined();
    expect(question.explanation).toBeUndefined();
    // Answer key survives from the sealed blueprint even though the test is gone.
    expect(question.options).toEqual([
      { optionId: q1.options[0].optionId, isCorrect: true, selected: true },
      { optionId: q1.options[1].optionId, isCorrect: false, selected: false }
    ]);
    expect(question.selectedOptionIds).toEqual([q1.options[0].optionId]);
    expect(question.isCorrect).toBe(true);
    expect(question.marksAwarded).toBe(2);
  });

  it('serializes a TIMED_OUT attempt that was lazily expired by the server timer', async () => {
    const testId = await publishTest('Timed Out', [
      { title: 'S', order: 0, durationSec: 60, questions: [singleQ(0, 'q?', 2, [opt(0, 'a', true), opt(1, 'b')])] }
    ], { shuffleQuestions: false, shuffleOptions: false });
    const attemptId = await createAttempt(testId, studentCookie);
    const started = await startAttempt(attemptId, studentCookie);
    const q1 = started.attempt.sections[0].questions[0];
    const put = await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({ currentQuestionIndex: 0, answers: [{ questionId: q1.questionId, selectedOptionIds: [q1.options[0].optionId] }] });
    expect(put.status).toBe(200);

    // Backdate the deadline well past the grace window, then trigger lazy expiry
    // through a stateful student read (the admin detail route never expires).
    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.updateOne({ _id: attemptId }, { $set: { endAt: new Date(Date.now() - 60_000) } });
    const touch = await request(app).get(`/api/student/attempts/${attemptId}`).set('Cookie', studentCookie);
    expect(touch.status).toBe(200);
    expect(touch.body.attempt.status).toBe('TIMED_OUT');

    const res = await request(app).get(`/api/admin/attempts/${attemptId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt as Record<string, any>;
    expect(attempt.status).toBe('TIMED_OUT');
    expect(attempt.score).toBe(2);
    expect(attempt.correctCount).toBe(1);
    expect(typeof attempt.submittedAt).toBe('string');
    expect(attempt.questions[0]).toMatchObject({ isCorrect: true, marksAwarded: 2, isAttempted: true });
    expect(attempt.questions[0].selectedOptionIds).toEqual([q1.options[0].optionId]);
  });

  it('keeps the SEALED blueprint option order + answer key when the test shuffles options', async () => {
    const testId = await publishTest(
      'Shuffled Detail',
      [
        {
          title: 'Shuffled',
          order: 0,
          durationSec: 600,
          questions: [
            singleQ(0, 'SQ1', 2, [opt(0, 'sq1a'), opt(1, 'sq1b'), opt(2, 'sq1c', true)], { explanation: 'e1' }),
            { ...singleQ(1, 'SQ2', 3, [opt(0, 'sq2a'), opt(1, 'sq2b', true), opt(2, 'sq2c')]), type: 'MULTI' },
            singleQ(2, 'SQ3', 1, [opt(0, 'sq3a', true), opt(1, 'sq3b'), opt(2, 'sq3c')])
          ]
        }
      ],
      { shuffleQuestions: true, shuffleOptions: true, defaultNegativeMarks: 3 }
    );
    const attemptId = await createAttempt(testId, studentCookie);
    const started = await startAttempt(attemptId, studentCookie);

    // Answer against the student-seen snapshot (optionIds only — the student
    // never sees correctness). SQ1 correct, SQ2 correctly selects both, SQ3 skipped.
    const seen = (text: string) => started.attempt.sections[0].questions.find((qq: any) => qq.text === text);
    const optIdOf = (qq: any, text: string) => qq.options.find((o: any) => o.text === text).optionId;
    await request(app)
      .put(`/api/student/attempts/${attemptId}/answers`)
      .set('Cookie', studentCookie)
      .send({
        currentQuestionIndex: 2,
        answers: [
          { questionId: seen('SQ1').questionId, selectedOptionIds: [optIdOf(seen('SQ1'), 'sq1c')] },
          { questionId: seen('SQ2').questionId, selectedOptionIds: [optIdOf(seen('SQ2'), 'sq2b'), optIdOf(seen('SQ2'), 'sq2c')] },
          { questionId: seen('SQ3').questionId, selectedOptionIds: [optIdOf(seen('SQ3'), 'sq3a')] }
        ]
      });
    await submitAttempt(attemptId, studentCookie);

    const res = await request(app).get(`/api/admin/attempts/${attemptId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const attempt = res.body.attempt as Record<string, any>;

    // Admin detail MUST replay the exact option order the student saw
    // (sealed blueprint), not the live test's order.
    expect(attempt.questions.map((qq: any) => qq.options.map((o: any) => o.optionId))).toEqual(
      started.attempt.sections[0].questions.map((qq: any) => qq.options.map((o: any) => o.optionId))
    );

    const byText = (options: any[]) => Object.fromEntries(options.map((o: any) => [o.text, o]));
    const q2 = attempt.questions.find((qq: any) => qq.text === 'SQ2')!;
    // Both correct selections, wrong pick marked; answer key traced by optionId.
    expect(byText(q2.options).sq2b).toMatchObject({ isCorrect: true, selected: true });
    expect(byText(q2.options).sq2c).toMatchObject({ isCorrect: false, selected: true });
    expect(byText(q2.options).sq2a).toMatchObject({ isCorrect: false, selected: false });
    expect(q2).toMatchObject({ type: 'MULTI', isCorrect: false, marksAwarded: -3, isAttempted: true });

    const q3 = attempt.questions.find((qq: any) => qq.text === 'SQ3')!;
    expect(byText(q3.options).sq3a).toMatchObject({ isCorrect: true, selected: true });
  });
});