import { createHash } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { Test } from '../models/Test.js';
import { TestAttempt, type TestAttemptDoc } from '../models/TestAttempt.js';

// ---- Zod bodies ----

const saveAnswersSchema = z.object({
  currentQuestionIndex: z.number().int('Must be a whole number.').nonnegative('Must be zero or greater.'),
  answers: z.array(
    z.object({
      questionId: z.string().min(1, 'questionId is required.'),
      selectedOptionIds: z.array(z.string()),
      isMarked: z.boolean().optional()
    })
  )
});

const antiCheatEventTypes = [
  'FULLSCREEN_EXIT',
  'COPY',
  'PASTE',
  'CUT',
  'CONTEXT_MENU',
  'VISIBILITY_HIDDEN',
  'FOCUS_LOST',
  'NETWORK_RECONNECT'
] as const;

const postEventSchema = z.object({
  type: z.enum(antiCheatEventTypes),
  payload: z.unknown().optional()
});

/** Event types that count toward the 3-strike auto-submit. NETWORK_RECONNECT is informational. */
const VIOLATION_EVENT_TYPES = new Set<string>([
  'FULLSCREEN_EXIT',
  'COPY',
  'PASTE',
  'CUT',
  'CONTEXT_MENU',
  'VISIBILITY_HIDDEN',
  'FOCUS_LOST'
]);
const MAX_WARNINGS = 3;

// ---- Seeded shuffle (deterministic per attempt, stable across resume) ----

function mulberry32(seed: number): () => number {
  let state = seed;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Resolved negative marks: question → section → test default. */
function resolveNegativeMarks(q: any, section: any, test: any): number {
  return q.negativeMarks ?? section.negativeMarksOverride ?? test.defaultNegativeMarks ?? 0;
}

/**
 * Freeze a per-student view of the test into a blueprint. This is the ONLY
 * place the Test is read for exam content; scoring later runs purely off the
 * blueprint.
 */
function captureBlueprint(test: any, attemptId: unknown, startedAt: Date) {
  const rng = mulberry32(createHash('sha256').update(String(attemptId)).digest().readUInt32BE(0));
  const sections = [...test.sections].sort((a: any, b: any) => a.order - b.order);

  const blueprint: any[] = [];
  const sectionAttempts: any[] = [];
  let cumulativeSec = 0;
  let maxScore = 0;

  sections.forEach((section: any, sectionIndex: number) => {
    cumulativeSec += section.durationSec;
    const questions = test.shuffleQuestions ? seededShuffle(section.questions, rng) : [...section.questions].sort((a: any, b: any) => a.order - b.order);
    let sectionMax = 0;

    for (const q of questions) {
      const options = test.shuffleOptions
        ? seededShuffle(q.options, rng)
        : [...q.options].sort((a: any, b: any) => a.order - b.order);
      blueprint.push({
        questionId: q._id,
        sectionIndex,
        sectionId: section._id,
        type: q.type,
        marks: q.marks,
        negativeMarks: resolveNegativeMarks(q, section, test),
        correctOptionIds: options.filter((o: any) => o.isCorrect === true).map((o: any) => o._id),
        optionIds: options.map((o: any) => o._id)
      });
      sectionMax += q.marks;
    }

    sectionAttempts.push({
      sectionId: section._id,
      title: section.title,
      endAt: new Date(startedAt.getTime() + cumulativeSec * 1000),
      maxScore: sectionMax
    });
    maxScore += sectionMax;
  });

  return { blueprint, sectionAttempts, totalQuestions: blueprint.length, maxScore };
}

// ---- Content maps (text/images only — never isCorrect) ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildContent(test: any) {
  if (!test) return null;
  const sectionBySectionId = new Map<string, { title: string; durationSec: number; negativeMarks: number }>();
  const questionById = new Map<string, { type: string; text?: string; imageUrl?: string }>();
  const optionById = new Map<string, { text?: string; imageUrl?: string }>();

  for (const section of test.sections ?? []) {
    sectionBySectionId.set(String(section._id), {
      title: section.title,
      durationSec: section.durationSec,
      negativeMarks: section.negativeMarksOverride ?? test.defaultNegativeMarks ?? 0
    });
    for (const q of section.questions ?? []) {
      questionById.set(String(q._id), { type: q.type, text: q.text ?? undefined, imageUrl: q.imageUrl ?? undefined });
      for (const o of q.options ?? []) {
        optionById.set(String(o._id), { text: o.text ?? undefined, imageUrl: o.imageUrl ?? undefined });
      }
    }
  }
  return { title: test.title, sectionBySectionId, questionById, optionById };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeSections(attempt: any, content: ReturnType<typeof buildContent>): any[] {
  const sectionAttemptBySectionId = new Map<string, any>(
    (attempt.sectionAttempts ?? []).map((sa: any) => [String(sa.sectionId), sa] as [string, any])
  );
  const sections = new Map<number, any>();
  let questionIndex = 0;

  for (const bp of attempt.blueprint ?? []) {
    let section = sections.get(bp.sectionIndex);
    if (!section) {
      const info = content?.sectionBySectionId.get(String(bp.sectionId));
      const sa = sectionAttemptBySectionId.get(String(bp.sectionId));
      section = {
        sectionId: String(bp.sectionId),
        sectionIndex: bp.sectionIndex,
        title: info?.title ?? '',
        durationSec: info?.durationSec ?? 0,
        endAt: sa?.endAt ? new Date(sa.endAt).toISOString() : undefined,
        negativeMarks: info?.negativeMarks ?? 0,
        questions: []
      };
      sections.set(bp.sectionIndex, section);
    }
    const q = content?.questionById.get(String(bp.questionId));
    section.questions.push({
      questionId: String(bp.questionId),
      questionIndex: questionIndex++,
      type: bp.type,
      text: q?.text ?? undefined,
      imageUrl: q?.imageUrl ?? undefined,
      marks: bp.marks,
      negativeMarks: bp.negativeMarks,
      options: bp.optionIds.map((oid: any) => {
        const o = content?.optionById.get(String(oid));
        return { optionId: String(oid), text: o?.text ?? undefined, imageUrl: o?.imageUrl ?? undefined };
      })
    });
  }
  return [...sections.values()];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeAnswers(attempt: any): any[] {
  const exposeScoring = attempt.status === 'SUBMITTED' || attempt.status === 'TIMED_OUT';
  return (attempt.answers ?? []).map((a: any) => ({
    questionId: String(a.questionId),
    selectedOptionIds: a.selectedOptionIds.map(String),
    isAttempted: a.isAttempted === true,
    isMarked: a.isMarked === true,
    ...(exposeScoring ? { isCorrect: a.isCorrect ?? false, marksAwarded: a.marksAwarded ?? 0 } : {})
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeEvents(attempt: any): any[] {
  return (attempt.events ?? []).map((e: any) => ({
    type: e.type,
    ...(e.payload !== undefined ? { payload: e.payload } : {}),
    createdAt: new Date(e.createdAt).toISOString()
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeAttempt(attempt: any, content: ReturnType<typeof buildContent>) {
  return {
    id: String(attempt._id),
    testId: String(attempt.testId),
    testTitle: content?.title ?? '',
    status: attempt.status,
    startedAt: attempt.startedAt ? new Date(attempt.startedAt).toISOString() : undefined,
    endAt: attempt.endAt ? new Date(attempt.endAt).toISOString() : undefined,
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : undefined,
    currentQuestionIndex: attempt.currentQuestionIndex,
    warningCount: attempt.warningCount,
    maxScore: attempt.maxScore ?? 0,
    totalQuestions: attempt.totalQuestions ?? 0,
    sections: serializeSections(attempt, content),
    answers: serializeAnswers(attempt),
    events: serializeEvents(attempt)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeStart(attempt: any, test: any) {
  const content = buildContent(test);
  return {
    id: String(attempt._id),
    status: attempt.status,
    testId: String(attempt.testId),
    startedAt: new Date(attempt.startedAt).toISOString(),
    endAt: new Date(attempt.endAt).toISOString(),
    currentQuestionIndex: attempt.currentQuestionIndex,
    warningCount: attempt.warningCount,
    testTitle: test.title,
    sections: serializeSections(attempt, content)
  };
}

// ---- Scoring (blueprint is the source of truth) ----

/** Exact-set comparison on sorted string ids. */
function sameSet(a: unknown[], b: unknown[]): boolean {
  const left = a.map(String).sort();
  const right = b.map(String).sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreAttempt(attempt: any, submittedAt: Date): void {
  const answerByQuestion = new Map<string, any>(
    (attempt.answers ?? []).map((a: any) => [String(a.questionId), a] as [string, any])
  );
  const aggBySection = new Map<string, { score: number; correctCount: number }>();
  let score = 0;
  let correctCount = 0;

  for (const bp of attempt.blueprint ?? []) {
    const answer = answerByQuestion.get(String(bp.questionId));
    const answered = Boolean(answer && answer.selectedOptionIds.length > 0);

    let isCorrect = false;
    let marksAwarded = 0;
    if (answered) {
      isCorrect = sameSet(answer.selectedOptionIds, bp.correctOptionIds);
      marksAwarded = isCorrect ? bp.marks : -bp.negativeMarks;
    }
    if (answer) {
      answer.isCorrect = isCorrect;
      answer.marksAwarded = marksAwarded;
    }

    const key = String(bp.sectionId);
    const agg = aggBySection.get(key) ?? { score: 0, correctCount: 0 };
    agg.score += marksAwarded;
    if (isCorrect) agg.correctCount += 1;
    aggBySection.set(key, agg);

    score += marksAwarded;
    if (isCorrect) correctCount += 1;
  }

  attempt.score = Math.max(0, score);
  attempt.correctCount = correctCount;
  for (const sa of attempt.sectionAttempts ?? []) {
    const agg = aggBySection.get(String(sa.sectionId)) ?? { score: 0, correctCount: 0 };
    sa.score = agg.score;
    sa.correctCount = agg.correctCount;
    sa.submittedAt = submittedAt;
  }
}

/**
 * Scores and marks an IN_PROGRESS attempt as submitted, appending the SUBMIT
 * event. Shared by the manual submit route and anti-cheat auto-submit.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function finalizeSubmit(attempt: any, submittedAt: Date): void {
  attempt.submittedAt = submittedAt;
  attempt.status = 'SUBMITTED';
  scoreAttempt(attempt, submittedAt);
  attempt.events = [...(attempt.events ?? []), { type: 'SUBMIT', createdAt: submittedAt }] as unknown as TestAttemptDoc['events'];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildResult(attempt: any, content: ReturnType<typeof buildContent>) {
  const sectionIndexBySectionId = new Map<string, number>();
  for (const bp of attempt.blueprint ?? []) {
    if (!sectionIndexBySectionId.has(String(bp.sectionId))) sectionIndexBySectionId.set(String(bp.sectionId), bp.sectionIndex);
  }
  const answerByQuestion = new Map<string, any>(
    (attempt.answers ?? []).map((a: any) => [String(a.questionId), a] as [string, any])
  );
  const now = new Date();

  return {
    id: String(attempt._id),
    testId: String(attempt.testId),
    testTitle: content?.title ?? '',
    status: attempt.status,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore ?? 0,
    correctCount: attempt.correctCount ?? 0,
    totalQuestions: attempt.totalQuestions ?? (attempt.blueprint ?? []).length,
    submittedAt: (attempt.submittedAt ?? now).toISOString(),
    startedAt: (attempt.startedAt ?? now).toISOString(),
    sections: (attempt.sectionAttempts ?? []).map((sa: any) => ({
      sectionId: String(sa.sectionId),
      sectionIndex: sectionIndexBySectionId.get(String(sa.sectionId)) ?? 0,
      title: sa.title ?? '',
      score: sa.score ?? 0,
      maxScore: sa.maxScore ?? 0,
      correctCount: sa.correctCount ?? 0
    })),
    questions: (attempt.blueprint ?? []).map((bp: any, i: number) => {
      const a = answerByQuestion.get(String(bp.questionId));
      return {
        questionId: String(bp.questionId),
        questionIndex: i,
        isCorrect: a?.isCorrect ?? false,
        marksAwarded: a?.marksAwarded ?? 0,
        isAttempted: a?.isAttempted ?? false,
        selectedOptionIds: a ? a.selectedOptionIds.map(String) : []
      };
    })
  };
}

// ---- Shared route helpers ----

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

/** Attempt that exists AND belongs to the caller; otherwise 404 (IDOR-safe). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOwnAttempt(attemptId: string, studentId: string): Promise<any> {
  const attempt = await TestAttempt.findOne({ _id: attemptId, studentId });
  if (!attempt) throw new AppError(404, 'NOT_FOUND', 'Attempt not found.');
  return attempt;
}

/** Wall-clock tolerance for the server-side deadline (network latency, clock skew). */
const OVERDUE_GRACE_MS = 5_000;

/**
 * Lazy expiry: past the endAt deadline (+ grace) an IN_PROGRESS attempt is
 * scored and transitioned to TIMED_OUT. Called before every stateful route so
 * the server — not the client countdown — owns the timer. Scoring uses the
 * frozen blueprint with submittedAt = endAt.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lazyExpire(attempt: any): Promise<void> {
  if (attempt.status !== 'IN_PROGRESS' || !attempt.endAt) return;
  const endAt = new Date(attempt.endAt).getTime();
  if (Date.now() <= endAt + OVERDUE_GRACE_MS) return;

  const submittedAt = new Date(endAt);
  attempt.status = 'TIMED_OUT';
  attempt.submittedAt = submittedAt;
  scoreAttempt(attempt, submittedAt);
  attempt.events = [...(attempt.events ?? []), { type: 'SUBMIT', createdAt: submittedAt }] as unknown as TestAttemptDoc['events'];
  await attempt.save();
}

function totalDurationSec(test: any): number {
  return (test.sections ?? []).reduce((n: number, s: any) => n + (s.durationSec ?? 0), 0);
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// ---- Router ----

export const studentRouter = Router();
studentRouter.use(authenticate, requireRole('STUDENT'));

studentRouter.get(
  '/tests',
  asyncHandler(async (req, res) => {
    const tests = await Test.find({ status: 'PUBLISHED', deletedAt: null }).sort({ updatedAt: -1 });
    const attempts = await TestAttempt.find({
      studentId: req.user!.id,
      testId: { $in: tests.map((t) => t._id) }
    });
    const attemptByTestId = new Map(attempts.map((a) => [String(a.testId), a]));

    res.json({
      tests: tests.map((t) => ({
        id: String(t._id),
        title: t.title,
        description: t.description ?? undefined,
        sectionCount: (t.sections ?? []).length,
        questionCount: (t.sections ?? []).reduce((n: number, s: any) => n + (s.questions?.length ?? 0), 0),
        totalDurationSec: totalDurationSec(t),
        totalMarks: (t.sections ?? []).reduce(
          (n: number, s: any) => n + (s.questions ?? []).reduce((m: number, q: any) => m + (q.marks ?? 0), 0),
          0
        ),
        defaultNegativeMarks: t.defaultNegativeMarks ?? 0,
        shuffleQuestions: t.shuffleQuestions === true,
        shuffleOptions: t.shuffleOptions === true,
        attempt: attemptByTestId.has(String(t._id))
          ? { id: String(attemptByTestId.get(String(t._id))!._id), status: attemptByTestId.get(String(t._id))!.status }
          : null
      }))
    });
  })
);

studentRouter.post(
  '/tests/:testId/attempts',
  asyncHandler(async (req, res) => {
    const test = await Test.findOne({ _id: req.params.testId, status: 'PUBLISHED', deletedAt: null });
    if (!test) throw new AppError(404, 'NOT_FOUND', 'Test not found.');
    const { id: studentId } = req.user!;

    const existing = await TestAttempt.findOne({ testId: test._id, studentId });
    if (existing) return respondExistingAttempt(existing, res, String(test._id));

    let attempt;
    try {
      attempt = await TestAttempt.create({ testId: test._id, studentId, status: 'GATED' });
    } catch (err) {
      // Repeat-click race on the unique (testId, studentId) index: reuse the winner.
      if (!isDuplicateKeyError(err)) throw err;
      attempt = await TestAttempt.findOne({ testId: test._id, studentId });
      if (attempt) return respondExistingAttempt(attempt, res, String(test._id));
      throw err;
    }
    res.status(201).json({ attempt: { id: String(attempt._id), status: 'GATED', testId: String(test._id) } });
  })
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function respondExistingAttempt(attempt: any, res: Response, testId: string): void {
  if (attempt.status === 'SUBMITTED' || attempt.status === 'TIMED_OUT') {
    throw new AppError(409, 'EXAM_ALREADY_SUBMITTED', 'You have already submitted this exam.', {
      attemptId: String(attempt._id)
    });
  }
  res.json({ attempt: { id: String(attempt._id), status: attempt.status, testId } });
}

studentRouter.post(
  '/attempts/:attemptId/start',
  asyncHandler(async (req, res) => {
    const now = new Date();
    // CAS-style atomic transition: only a GATED attempt owned by the caller
    // can become IN_PROGRESS. A concurrently started attempt yields null here
    // instead of two writers racing on the same document (VersionError → 500).
    const attempt = await findOwnAttempt(req.params.attemptId, req.user!.id);
    if (attempt.status !== 'GATED') {
      throw new AppError(409, 'ALREADY_STARTED', 'This attempt has already been started.');
    }

    const test = await Test.findOne({ _id: attempt.testId, deletedAt: null });
    if (!test || test.status !== 'PUBLISHED') {
      throw new AppError(409, 'TEST_NOT_AVAILABLE', 'This test is no longer available.');
    }

    const startedAt = now;
    const captures = captureBlueprint(test, attempt._id, startedAt);
    const transitioned = await TestAttempt.findOneAndUpdate(
      { _id: attempt._id, studentId: req.user!.id, status: 'GATED' },
      {
        $set: {
          status: 'IN_PROGRESS',
          startedAt,
          endAt: new Date(startedAt.getTime() + totalDurationSec(test) * 1000),
          currentQuestionIndex: 0,
          blueprint: captures.blueprint as unknown as TestAttemptDoc['blueprint'],
          sectionAttempts: captures.sectionAttempts as unknown as TestAttemptDoc['sectionAttempts'],
          totalQuestions: captures.totalQuestions,
          maxScore: captures.maxScore
        },
        $push: { events: { type: 'START', createdAt: startedAt } }
      },
      { new: true }
    );

    if (!transitioned) {
      throw new AppError(409, 'ALREADY_STARTED', 'This attempt has already been started.');
    }
    res.json({ attempt: serializeStart(transitioned, test) });
  })
);

studentRouter.get(
  '/attempts/:attemptId',
  asyncHandler(async (req, res) => {
    const attempt = await findOwnAttempt(req.params.attemptId, req.user!.id);
    await lazyExpire(attempt);
    const test = await Test.findById(attempt.testId);
    res.json({ attempt: serializeAttempt(attempt, buildContent(test)) });
  })
);

studentRouter.put(
  '/attempts/:attemptId/answers',
  asyncHandler(async (req, res) => {
    const attempt = await findOwnAttempt(req.params.attemptId, req.user!.id);
    await lazyExpire(attempt);
    if (attempt.status !== 'IN_PROGRESS') {
      throw new AppError(409, 'NOT_IN_PROGRESS', 'This attempt is not in progress.');
    }

    const body = saveAnswersSchema.parse(req.body);
    const now = new Date();

    for (const input of body.answers) {
      const questionId = new mongoose.Types.ObjectId(input.questionId);
      const existing = attempt.answers.find((a: any) => String(a.questionId) === String(questionId));
      if (existing) {
        // Live subdoc: mutating it directly persists.
        existing.selectedOptionIds = input.selectedOptionIds.map((s) => new mongoose.Types.ObjectId(s));
        existing.isAttempted = input.selectedOptionIds.length > 0;
        if (input.isMarked !== undefined) existing.isMarked = input.isMarked;
        existing.updatedAt = now;
      } else {
        // Build the full object BEFORE push — mongoose copies plain objects,
        // so mutating afterwards would be a silent no-op.
        attempt.answers.push({
          questionId,
          selectedOptionIds: input.selectedOptionIds.map((s) => new mongoose.Types.ObjectId(s)),
          isAttempted: input.selectedOptionIds.length > 0,
          isMarked: input.isMarked ?? false,
          updatedAt: now
        });
      }
    }
    attempt.currentQuestionIndex = body.currentQuestionIndex;

    await attempt.save();
    res.json({
      savedAt: now.toISOString(),
      status: attempt.status,
      endAt: attempt.endAt ? new Date(attempt.endAt).toISOString() : null
    });
  })
);

studentRouter.post(
  '/attempts/:attemptId/events',
  asyncHandler(async (req, res) => {
    const attempt = await findOwnAttempt(req.params.attemptId, req.user!.id);
    await lazyExpire(attempt);
    if (attempt.status !== 'IN_PROGRESS') {
      throw new AppError(409, 'NOT_IN_PROGRESS', 'This attempt is not in progress.');
    }

    const body = postEventSchema.parse(req.body);

    // Retry on mongoose VersionError (a concurrent event/save from another tab
    // bumped __v between read and save): reload the fresh doc and re-apply the
    // mutation so a violation is never silently lost. 3 attempts (2 retries).
    let submitted = false;
    for (let attemptNo = 0; attemptNo < 3; attemptNo += 1) {
      attempt.events = [
        ...(attempt.events ?? []),
        { type: body.type, ...(body.payload !== undefined ? { payload: body.payload } : {}), createdAt: new Date() }
      ] as unknown as TestAttemptDoc['events'];

      if (VIOLATION_EVENT_TYPES.has(body.type)) {
        attempt.warningCount = (attempt.warningCount ?? 0) + 1;
      }

      submitted = (attempt.warningCount ?? 0) >= MAX_WARNINGS;
      if (submitted) finalizeSubmit(attempt, new Date());

      try {
        await attempt.save();
        break;
      } catch (err) {
        if (!(err instanceof mongoose.Error.VersionError) || attemptNo === 2) throw err;
        await attempt.reload();
        if (attempt.status !== 'IN_PROGRESS') {
          throw new AppError(409, 'NOT_IN_PROGRESS', 'This attempt is not in progress.');
        }
      }
    }

    res.json({ status: attempt.status, warningCount: attempt.warningCount, submitted });
  })
);

studentRouter.post(
  '/attempts/:attemptId/submit',
  asyncHandler(async (req, res) => {
    const attempt = await findOwnAttempt(req.params.attemptId, req.user!.id);
    await lazyExpire(attempt);
    const content = buildContent(await Test.findById(attempt.testId));

    // Idempotent: already scored (or timed out) → return the stored result.
    if (attempt.status === 'SUBMITTED' || attempt.status === 'TIMED_OUT') {
      res.json({ attempt: buildResult(attempt, content) });
      return;
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new AppError(409, 'NOT_STARTED', 'This attempt has not been started yet.');
    }

    const submittedAt = new Date();
    finalizeSubmit(attempt, submittedAt);
    await attempt.save();
    res.json({ attempt: buildResult(attempt, content) });
  })
);

studentRouter.get(
  '/attempts/:attemptId/result',
  asyncHandler(async (req, res) => {
    const attempt = await findOwnAttempt(req.params.attemptId, req.user!.id);
    if (attempt.status !== 'SUBMITTED' && attempt.status !== 'TIMED_OUT') {
      throw new AppError(409, 'NOT_SUBMITTED', 'This attempt has not been submitted yet.');
    }
    const content = buildContent(await Test.findById(attempt.testId));
    res.json({ attempt: buildResult(attempt, content) });
  })
);