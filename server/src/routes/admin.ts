import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { type FilterQuery } from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { Test, type TestDoc } from '../models/Test.js';
import { TestAttempt, type TestAttemptDoc } from '../models/TestAttempt.js';
import { User } from '../models/User.js';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const uploadDir = resolve(env.UPLOAD_DIR);

const TITLE_REQUIRED = 'Test title is required.';
const SECTION_TITLE_REQUIRED = 'Section title is required.';
const SINGLE_ONE_CORRECT = 'A single-answer question must have exactly one correct option.';
const MULTI_AT_LEAST_ONE = 'A multi-answer question needs at least one correct option.';
const TWO_OPTIONS = 'Each question needs at least two options.';
const OPTION_CONTENT = 'Each option needs text or an image.';

const requiredString = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).trim().min(1, message);

const orderField = z
  .number({ invalid_type_error: 'Order must be a number.' })
  .int('Order must be a whole number.')
  .nonnegative('Order must be zero or greater.');

const optionWrite = z
  .object({
    order: orderField,
    text: z.string().optional(),
    imageUrl: z.string().optional(),
    isCorrect: z.boolean({ required_error: 'Each option needs a correct/incorrect flag.' })
  })
  .refine((o) => Boolean(o.text?.trim()) || Boolean(o.imageUrl), { message: OPTION_CONTENT });

const questionWrite = z
  .object({
    type: z.enum(['SINGLE', 'MULTI'], { required_error: 'Question type is required.' }),
    order: orderField,
    text: z.string().optional(),
    imageUrl: z.string().optional(),
    marks: z.number({ required_error: 'Question marks are required.' }).nonnegative('Marks must be zero or greater.'),
    negativeMarks: z.number().optional().refine((v) => v === undefined || v >= 0, 'Negative marks must be zero or greater.'),
    explanation: z.string().optional(),
    options: z.array(optionWrite).min(2, TWO_OPTIONS)
  })
  .superRefine((q, ctx) => {
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (q.type === 'SINGLE') {
      if (correct !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: SINGLE_ONE_CORRECT });
      }
    } else if (correct < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: MULTI_AT_LEAST_ONE });
    }
  });

const sectionWrite = z.object({
  title: requiredString(SECTION_TITLE_REQUIRED),
  order: orderField,
  durationSec: z
    .number({ required_error: 'Section duration is required.' })
    .int('Duration must be a whole number of seconds.')
    .nonnegative('Duration must be zero or greater.'),
  negativeMarksOverride: z.number().optional().refine((v) => v === undefined || v >= 0, 'Negative marks override must be zero or greater.'),
  questions: z.array(questionWrite)
});

/** PUT body: the whole test minus id/status/createdAt/updatedAt. */
const testWriteSchema = z.object({
  title: requiredString(TITLE_REQUIRED),
  description: z.string().optional(),
  defaultNegativeMarks: z.number().default(0).refine((v) => v >= 0, 'Default negative marks must be zero or greater.'),
  shuffleQuestions: z.boolean({ invalid_type_error: 'shuffleQuestions must be a boolean.' }).default(true),
  shuffleOptions: z.boolean({ invalid_type_error: 'shuffleOptions must be a boolean.' }).default(true),
  sections: z.array(sectionWrite).default([])
});

const testCreateSchema = z.object({
  title: requiredString(TITLE_REQUIRED),
  description: z.string().optional(),
  defaultNegativeMarks: z.number().default(0).refine((v) => v >= 0, 'Default negative marks must be zero or greater.')
});

// ---- JSON import (Phase 4) ----
//
// PUT /tests/:id strips client-supplied ids (whole-doc replace). Imports sit
// at a stricter boundary: an `id` key anywhere in the raw payload is rejected
// so the preview hash only ever covers content the server will actually insert.
// (zod's default strip mode would silently drop unknown keys, so the walk runs
// on the raw JSON-parsed object BEFORE zod parses it.)

const IMPORT_INVALID_JSON = 'Import content must be a valid JSON object.';
const IMPORT_ID_FORBIDDEN = "Import payload must not contain 'id' fields. Remove generated ids before importing.";

/** Deep-collects object key paths named `id` (the strip-on-write keys). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findIdPaths(value: any, base: Array<string | number> = []): Array<Array<string | number>> {
  const hits: Array<Array<string | number>> = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...findIdPaths(item, [...base, i])));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'id') hits.push([...base, key]);
      else hits.push(...findIdPaths(nested, [...base, key]));
    }
  }
  return hits;
}

const importRequestSchema = z.object({
  content: z.string({ required_error: 'Import content is required.', invalid_type_error: 'Import content must be a JSON string.' })
});

const importConfirmSchema = z.object({
  content: z.string({ required_error: 'Import content is required.', invalid_type_error: 'Import content must be a JSON string.' }),
  hash: z.string({ required_error: 'Preview hash is required.', invalid_type_error: 'Preview hash must be a string.' })
});

/**
 * Shared validate step for both import routes (validate + confirm re-validate):
 * JSON.parse → INVALID_JSON for non-objects → id-boundary check → authoring
 * validation. Returns the normalized authoring payload.
 */
function parseImportContent(content: string): z.infer<typeof testWriteSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new AppError(400, 'INVALID_JSON', IMPORT_INVALID_JSON, [{ field: 'content', message: IMPORT_INVALID_JSON }]);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError(400, 'INVALID_JSON', IMPORT_INVALID_JSON, [{ field: 'content', message: IMPORT_INVALID_JSON }]);
  }

  const idPaths = findIdPaths(raw);
  if (idPaths.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request payload.', idPaths.map((path) => ({
      field: path.join('.'),
      message: IMPORT_ID_FORBIDDEN
    })));
  }

  return testWriteSchema.parse(raw);
}

/** sha256 over the exact normalized JSON the confirm step will insert. */
function hashImportContent(testData: z.infer<typeof testWriteSchema>): string {
  return createHash('sha256').update(JSON.stringify(testData)).digest('hex');
}

function summarizeImport(testData: z.infer<typeof testWriteSchema>): object {
  const questionCount = testData.sections.reduce((n, s) => n + s.questions.length, 0);
  const totalDurationSec = testData.sections.reduce((n, s) => n + s.durationSec, 0);
  const totalMarks = testData.sections.reduce((n, s) => n + s.questions.reduce((m, q) => m + q.marks, 0), 0);
  return {
    title: testData.title,
    sectionCount: testData.sections.length,
    questionCount,
    totalDurationSec,
    totalMarks
  };
}

// ---- Serialization (contract JSON): stringified _ids, optional fields omitted ----

type OptionJson = { id: string; order: number; text?: string; imageUrl?: string; isCorrect: boolean };
type QuestionJson = {
  id: string;
  type: 'SINGLE' | 'MULTI';
  order: number;
  text?: string;
  imageUrl?: string;
  marks: number;
  negativeMarks?: number;
  explanation?: string;
  options: OptionJson[];
};
type SectionJson = {
  id: string;
  title: string;
  order: number;
  durationSec: number;
  negativeMarksOverride?: number;
  questions: QuestionJson[];
};
type TestJson = {
  id: string;
  title: string;
  description?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  defaultNegativeMarks: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  sections: SectionJson[];
  createdAt: string;
  updatedAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeTest(test: any): TestJson {
  return {
    id: String(test._id),
    title: test.title,
    description: test.description ?? undefined,
    status: test.status,
    defaultNegativeMarks: test.defaultNegativeMarks,
    shuffleQuestions: test.shuffleQuestions === true,
    shuffleOptions: test.shuffleOptions === true,
    sections: test.sections.map((s: any) => ({
      id: String(s._id),
      title: s.title,
      order: s.order,
      durationSec: s.durationSec,
      negativeMarksOverride: s.negativeMarksOverride ?? undefined,
      questions: s.questions.map((q: any) => ({
        id: String(q._id),
        type: q.type,
        order: q.order,
        text: q.text ?? undefined,
        imageUrl: q.imageUrl ?? undefined,
        marks: q.marks,
        negativeMarks: q.negativeMarks ?? undefined,
        explanation: q.explanation ?? undefined,
        options: q.options.map((o: any) => ({
          id: String(o._id),
          order: o.order,
          text: o.text ?? undefined,
          imageUrl: o.imageUrl ?? undefined,
          isCorrect: o.isCorrect === true
        }))
      }))
    })),
    createdAt: test.createdAt.toISOString(),
    updatedAt: test.updatedAt.toISOString()
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSummary(test: any): object {
  const sections = test.sections ?? [];
  const questionCount = sections.reduce((n: number, s: any) => n + (s.questions?.length ?? 0), 0);
  const totalDurationSec = sections.reduce((n: number, s: any) => n + (s.durationSec ?? 0), 0);
  const totalMarks = sections.reduce(
    (n: number, s: any) => n + (s.questions ?? []).reduce((m: number, q: any) => m + (q.marks ?? 0), 0),
    0
  );
  return {
    id: String(test._id),
    title: test.title,
    status: test.status,
    defaultNegativeMarks: test.defaultNegativeMarks,
    sectionCount: sections.length,
    questionCount,
    totalDurationSec,
    totalMarks,
    updatedAt: test.updatedAt.toISOString()
  };
}

// ---- Attempt review (Phase 7): admin-only serialization of the sealed blueprint ----

/**
 * Live-content map keyed by _id (text/images/explanation — never correctness).
 * Missing test → null, so a deleted/edited test degrades to omitted fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildContent(test: any) {
  if (!test) return null;
  const questionById = new Map<string, { type?: string; text?: string; imageUrl?: string; explanation?: string }>();
  const optionById = new Map<string, { text?: string; imageUrl?: string }>();
  for (const section of test.sections ?? []) {
    for (const q of section.questions ?? []) {
      questionById.set(String(q._id), {
        type: q.type,
        text: q.text ?? undefined,
        imageUrl: q.imageUrl ?? undefined,
        explanation: q.explanation ?? undefined
      });
      for (const o of q.options ?? []) {
        optionById.set(String(o._id), { text: o.text ?? undefined, imageUrl: o.imageUrl ?? undefined });
      }
    }
  }
  return { title: test.title, questionById, optionById };
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
function serializeAttemptSummary(attempt: any, test: any, student: any): object {
  return {
    id: String(attempt._id),
    testId: String(attempt.testId),
    testTitle: test?.title ?? '',
    student: {
      id: String(student?._id ?? attempt.studentId),
      name: student?.name ?? '',
      email: student?.email ?? ''
    },
    status: attempt.status,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore ?? 0,
    correctCount: attempt.correctCount ?? 0,
    totalQuestions: attempt.totalQuestions ?? 0,
    warningCount: attempt.warningCount ?? 0,
    startedAt: attempt.startedAt ? new Date(attempt.startedAt).toISOString() : null,
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : null
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeAttemptDetail(attempt: any, content: ReturnType<typeof buildContent>, student: any): object {
  const scored = attempt.status === 'SUBMITTED' || attempt.status === 'TIMED_OUT';
  const answerByQuestion = new Map<string, any>(
    (attempt.answers ?? []).map((a: any) => [String(a.questionId), a] as [string, any])
  );
  const correctByQuestion = new Map<string, Set<string>>(
    (attempt.blueprint ?? []).map((bp: any) => [String(bp.questionId), new Set<string>((bp.correctOptionIds ?? []).map(String))])
  );
  const selectedByQuestion = new Map<string, Set<string>>(
    (attempt.answers ?? []).map((a: any) => [String(a.questionId), new Set<string>((a.selectedOptionIds ?? []).map(String))])
  );
  const sectionIndexBySectionId = new Map<string, number>();
  for (const bp of attempt.blueprint ?? []) {
    if (!sectionIndexBySectionId.has(String(bp.sectionId))) sectionIndexBySectionId.set(String(bp.sectionId), bp.sectionIndex);
  }

  return {
    id: String(attempt._id),
    testId: String(attempt.testId),
    testTitle: content?.title ?? '',
    student: {
      id: String(student?._id ?? attempt.studentId),
      name: student?.name ?? '',
      email: student?.email ?? ''
    },
    status: attempt.status,
    startedAt: attempt.startedAt ? new Date(attempt.startedAt).toISOString() : null,
    endAt: attempt.endAt ? new Date(attempt.endAt).toISOString() : null,
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : null,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore ?? 0,
    correctCount: attempt.correctCount ?? 0,
    totalQuestions: attempt.totalQuestions ?? 0,
    warningCount: attempt.warningCount ?? 0,
    sections: (attempt.sectionAttempts ?? []).map((sa: any) => ({
      sectionId: String(sa.sectionId),
      sectionIndex: sectionIndexBySectionId.get(String(sa.sectionId)) ?? 0,
      title: sa.title ?? '',
      score: sa.score ?? 0,
      maxScore: sa.maxScore ?? 0,
      correctCount: sa.correctCount ?? 0
    })),
    questions: (attempt.blueprint ?? []).map((bp: any, i: number) => {
      const q = content?.questionById.get(String(bp.questionId));
      const answer = answerByQuestion.get(String(bp.questionId));
      const correct = correctByQuestion.get(String(bp.questionId)) ?? new Set<string>();
      const selected = selectedByQuestion.get(String(bp.questionId)) ?? new Set<string>();
      return {
        questionId: String(bp.questionId),
        questionIndex: i,
        sectionIndex: bp.sectionIndex,
        type: bp.type,
        ...(q?.text !== undefined ? { text: q.text } : {}),
        ...(q?.imageUrl !== undefined ? { imageUrl: q.imageUrl } : {}),
        ...(q?.explanation !== undefined ? { explanation: q.explanation } : {}),
        marks: bp.marks,
        negativeMarks: bp.negativeMarks,
        options: (bp.optionIds ?? []).map((oid: any) => {
          const o = content?.optionById.get(String(oid));
          return {
            optionId: String(oid),
            ...(o?.text !== undefined ? { text: o.text } : {}),
            ...(o?.imageUrl !== undefined ? { imageUrl: o.imageUrl } : {}),
            isCorrect: correct.has(String(oid)),
            selected: selected.has(String(oid))
          };
        }),
        selectedOptionIds: answer ? answer.selectedOptionIds.map(String) : [],
        // isAttempted reflects the live answer regardless of status (an admin
        // watching a live attempt still sees what the student has selected);
        // only correctness/marks need a completed score.
        isAttempted: Boolean(answer && answer.selectedOptionIds.length > 0),
        isCorrect: scored ? (answer?.isCorrect ?? false) : false,
        marksAwarded: scored ? (answer?.marksAwarded ?? 0) : 0
      };
    }),
    events: serializeEvents(attempt)
  };
}

// ---- Helpers ----

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

async function findTest(id: string) {
  const test = await Test.findOne({ _id: id, deletedAt: null });
  if (!test) throw new AppError(404, 'NOT_FOUND', 'Test not found.');
  return test;
}

async function assertNotFrozen(testId: unknown): Promise<void> {
  const frozen = await TestAttempt.exists({ testId });
  if (frozen) {
    throw new AppError(409, 'TEST_FROZEN', 'This test is frozen because a student has started it.');
  }
}

// ---- Uploads ----

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

const IMAGE_TYPES: Record<string, { mime: string; ext: string }> = {
  png: { mime: 'image/png', ext: '.png' },
  jpeg: { mime: 'image/jpeg', ext: '.jpg' },
  gif: { mime: 'image/gif', ext: '.gif' },
  webp: { mime: 'image/webp', ext: '.webp' }
};

/** Content sniffing by magic numbers — extension/MIME claims are never trusted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sniffImageType(buf: Buffer): { mime: string; ext: string } | null {
  const is = (offset: number, bytes: number[]) => {
    if (buf.length < offset + bytes.length) return false;
    return buf.subarray(offset, offset + bytes.length).equals(Buffer.from(bytes));
  };
  // PNG \x89PNG\r\n\x1a\n
  if (is(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return IMAGE_TYPES.png;
  // JPEG \xFF\xD8\xFF
  if (is(0, [0xff, 0xd8, 0xff])) return IMAGE_TYPES.jpeg;
  // GIF87a / GIF89a
  if (is(0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || is(0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return IMAGE_TYPES.gif;
  // RIFF....WEBP within the first 12 bytes
  if (is(0, [0x52, 0x49, 0x46, 0x46]) && is(8, [0x57, 0x45, 0x42, 0x50])) return IMAGE_TYPES.webp;
  return null;
}

/** Wrapper translating multer errors into the uniform error shape. */
function uploadSingle(field: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const tooLarge = err.code === 'LIMIT_FILE_SIZE';
        return next(
          tooLarge
            ? new AppError(400, 'UPLOAD_TOO_LARGE', 'Uploaded file is too large. Maximum size is 2MB.')
            : new AppError(400, 'UPLOAD_INVALID', 'Upload failed. Use a single file in the "file" field.')
        );
      }
      next(err);
    });
  };
}

// ---- Router ----

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('ADMIN'));

adminRouter.get(
  '/tests',
  asyncHandler(async (_req, res) => {
    const tests = await Test.find({ deletedAt: null }).sort({ updatedAt: -1 });
    res.json({ tests: tests.map(toSummary) });
  })
);

adminRouter.post(
  '/tests',
  asyncHandler(async (req, res) => {
    const body = testCreateSchema.parse(req.body);
    const test = await Test.create({
      title: body.title,
      description: body.description,
      defaultNegativeMarks: body.defaultNegativeMarks
    });
    res.status(201).json(serializeTest(test));
  })
);

adminRouter.get(
  '/tests/:id',
  asyncHandler(async (req, res) => {
    const test = await findTest(req.params.id);
    res.json(serializeTest(test));
  })
);

adminRouter.put(
  '/tests/:id',
  asyncHandler(async (req, res) => {
    const body = testWriteSchema.parse(req.body);
    const test = await findTest(req.params.id);
    await assertNotFrozen(test._id);

    test.title = body.title;
    test.description = body.description ?? null;
    test.defaultNegativeMarks = body.defaultNegativeMarks;
    test.shuffleQuestions = body.shuffleQuestions;
    test.shuffleOptions = body.shuffleOptions;
    // Whole-doc replace: fresh plain objects become brand-new subdocuments
    // (new _ids). Never touch test.status.
    test.sections = body.sections as unknown as TestDoc['sections'];
    await test.save();
    res.json(serializeTest(test));
  })
);

adminRouter.delete(
  '/tests/:id',
  asyncHandler(async (req, res) => {
    const test = await findTest(req.params.id);
    test.deletedAt = new Date();
    await test.save();
    res.status(204).end();
  })
);

adminRouter.post(
  '/tests/:id/publish',
  asyncHandler(async (req, res) => {
    const test = await findTest(req.params.id);
    if (test.status === 'ARCHIVED') {
      throw new AppError(409, 'STATUS_FROZEN', 'Archived tests cannot be published or unpublished.');
    }
    if (!test.sections.length) {
      throw new AppError(400, 'NOT_PUBLISHABLE', 'A test needs at least one section before it can be published.');
    }
    const totalQuestions = test.sections.reduce((n, s) => n + (s.questions?.length ?? 0), 0);
    if (totalQuestions < 1) {
      throw new AppError(400, 'NOT_PUBLISHABLE', 'A test needs at least one question before it can be published.');
    }
    test.status = 'PUBLISHED';
    await test.save();
    res.json(serializeTest(test));
  })
);

adminRouter.post(
  '/tests/:id/unpublish',
  asyncHandler(async (req, res) => {
    const test = await findTest(req.params.id);
    if (test.status === 'ARCHIVED') {
      throw new AppError(409, 'STATUS_FROZEN', 'Archived tests cannot be published or unpublished.');
    }
    test.status = 'DRAFT';
    await test.save();
    res.json(serializeTest(test));
  })
);

adminRouter.post(
  '/uploads',
  uploadSingle('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, 'UPLOAD_REQUIRED', 'No file uploaded. Use the "file" multipart field.');

    const type = sniffImageType(file.buffer);
    if (!type) {
      throw new AppError(400, 'UPLOAD_INVALID_TYPE', 'Unsupported image type. Allowed: PNG, JPEG, GIF, WebP.');
    }

    const name = `${randomUUID()}${type.ext}`;
    await writeFile(resolve(uploadDir, name), file.buffer);
    res.status(201).json({ url: `/uploads/${name}` });
  })
);

adminRouter.post(
  '/import/validate',
  asyncHandler(async (req, res) => {
    const { content } = importRequestSchema.parse(req.body);
    const testData = parseImportContent(content);
    res.json({
      hash: hashImportContent(testData),
      summary: summarizeImport(testData)
    });
  })
);

adminRouter.post(
  '/import/confirm',
  asyncHandler(async (req, res) => {
    const { content, hash } = importConfirmSchema.parse(req.body);
    const testData = parseImportContent(content);

    // Stale-preview guard: hash mismatch on confirm means the admin approved a
    // different payload than this one. Re-validated + re-hashed above, so the
    // single insertOne below is exactly the content that was previewed.
    const computedHash = hashImportContent(testData);
    if (computedHash !== hash) {
      throw new AppError(409, 'IMPORT_STALE', 'The preview is out of date. Please re-validate and try again.');
    }

    // One Test.create = one atomic insertOne, all-or-nothing. No status set:
    // the schema default (DRAFT) applies.
    const test = await Test.create({
      title: testData.title,
      description: testData.description,
      defaultNegativeMarks: testData.defaultNegativeMarks,
      shuffleQuestions: testData.shuffleQuestions,
      shuffleOptions: testData.shuffleOptions,
      sections: testData.sections as unknown as TestDoc['sections']
    });
    res.status(201).json(serializeTest(test));
  })
);

adminRouter.get(
  '/attempts',
  asyncHandler(async (req, res) => {
    const { testId } = z.object({ testId: z.string().trim().optional() }).parse(req.query);
    const filter = testId ? { testId } : {};
    // _id embeds the creation timestamp — newest first without a schema change.
    // Hard cap keeps the global (all-students) list bounded as volume grows.
    // ponytail: no cursor pagination yet — add ?page=/cursor when the list can
    // realistically exceed a few hundred attempts.
    const attempts = await TestAttempt.find(filter).sort({ _id: -1 }).limit(200);
    const testIds = [...new Set(attempts.map((a) => String(a.testId)))];
    const studentIds = [...new Set(attempts.map((a) => String(a.studentId)))];
    const [tests, users] = await Promise.all([
      Test.find({ _id: { $in: testIds } }),
      User.find({ _id: { $in: studentIds } })
    ]);
    const testBy = new Map(tests.map((t) => [String(t._id), t]));
    const userBy = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      attempts: attempts.map((a) => serializeAttemptSummary(a, testBy.get(String(a.testId)), userBy.get(String(a.studentId))))
    });
  })
);

adminRouter.get(
  '/attempts/:attemptId',
  asyncHandler(async (req, res) => {
    const attempt = await TestAttempt.findById(req.params.attemptId);
    if (!attempt) throw new AppError(404, 'NOT_FOUND', 'Attempt not found.');
    const [test, student] = await Promise.all([
      Test.findById(attempt.testId),
      User.findById(attempt.studentId)
    ]);
    res.json({ attempt: serializeAttemptDetail(attempt, buildContent(test), student) });
  })
);

// ---- Analytics (Phase 8): admin-only aggregate over scored attempts ----

/** Event types that count as violations in the analytics view (START/SUBMIT/NETWORK_RECONNECT excluded). */
const ANALYTICS_VIOLATION_TYPES = new Set<string>([
  'FULLSCREEN_EXIT',
  'COPY',
  'PASTE',
  'CUT',
  'CONTEXT_MENU',
  'VISIBILITY_HIDDEN',
  'FOCUS_LOST'
]);

type QuestionAgg = {
  testId: string;
  testTitle: string;
  sectionIndex: number;
  seq: number;
  type: string;
  marks: number;
  text?: string;
  attempted: number;
  correct: number;
};

adminRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const { testId } = z
      .object({ testId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'testId must be a valid ObjectId.').optional() })
      .parse(req.query);

    const testFilter: FilterQuery<TestAttemptDoc> = testId ? { testId } : {};
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // # ponytail: JS-side analysis over the 1000 most recent scored attempts —
    // switch to Mongo aggregation/$facet when volume exceeds ~1000 scored attempts.
    const [attempts, attemptsToday] = await Promise.all([
      TestAttempt.find({ ...testFilter, status: { $in: ['SUBMITTED', 'TIMED_OUT'] } })
        .sort({ _id: -1 })
        .limit(1000),
      // attemptsToday counts ALL attempts (any status) submitted in the last 24h.
      TestAttempt.countDocuments({ ...testFilter, submittedAt: { $gte: since } })
    ]);

    const total = attempts.length;
    let scoreSum = 0;
    let correctPctSum = 0;
    let highest = -1;
    let lowest = Infinity;
    let totalWarnings = 0;
    let attemptsWithViolations = 0;
    const buckets = new Array<number>(10).fill(0);
    const byType: Record<string, number> = {};
    const questionAgg = new Map<string, QuestionAgg>();
    let seq = 0;

    for (const attempt of attempts) {
      const maxScore = attempt.maxScore ?? 0;
      const pct = maxScore > 0 ? Math.min(100, Math.max(0, ((attempt.score ?? 0) / maxScore) * 100)) : 0;
      buckets[Math.min(9, Math.floor(pct / 10))] += 1;
      scoreSum += pct;
      highest = Math.max(highest, pct);
      lowest = Math.min(lowest, pct);

      const totalQuestions = attempt.totalQuestions ?? 0;
      if (totalQuestions > 0) correctPctSum += ((attempt.correctCount ?? 0) / totalQuestions) * 100;

      const warnings = attempt.warningCount ?? 0;
      totalWarnings += warnings;
      if (warnings > 0) attemptsWithViolations += 1;

      for (const bp of attempt.blueprint ?? []) {
        const key = String(bp.questionId);
        if (!questionAgg.has(key)) {
          questionAgg.set(key, {
            testId: String(attempt.testId),
            testTitle: '',
            sectionIndex: bp.sectionIndex,
            seq: seq++,
            type: bp.type,
            marks: bp.marks,
            attempted: 0,
            correct: 0
          });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const answerByQuestion = new Map<string, any>((attempt.answers ?? []).map((a) => [String(a.questionId), a] as [string, any]));
      for (const bp of attempt.blueprint ?? []) {
        const agg = questionAgg.get(String(bp.questionId));
        if (!agg) continue;
        const answer = answerByQuestion.get(String(bp.questionId));
        if (answer && answer.isAttempted === true) {
          agg.attempted += 1;
          if (answer.isCorrect === true) agg.correct += 1;
        }
      }

      for (const event of attempt.events ?? []) {
        if (ANALYTICS_VIOLATION_TYPES.has(event.type)) {
          byType[event.type] = (byType[event.type] ?? 0) + 1;
        }
      }
    }

    // Live question text/title (never correctness) keyed by question _id. The
    // query intentionally does NOT filter deletedAt — soft-deleted tests still
    // contribute their text and titles so analytics stays useful after a
    // delete. A hard-deleted/missing test degrades gracefully: text omitted,
    // title '' (testId is retained from the attempt).
    const testIds = [...new Set(attempts.map((a) => String(a.testId)))];
    const tests = testIds.length
      ? await Test.find({ _id: { $in: testIds } }).select('title sections.questions._id sections.questions.text')
      : [];
    const infoByQuestion = new Map<string, { testId: string; testTitle: string; text?: string }>();
    for (const t of tests) {
      for (const section of t.sections ?? []) {
        for (const q of section.questions ?? []) {
          const text = q.text?.trim();
          infoByQuestion.set(String(q._id), { testId: String(t._id), testTitle: t.title, ...(text ? { text } : {}) });
        }
      }
    }
    for (const [key, agg] of questionAgg) {
      const info = infoByQuestion.get(key);
      if (!info) continue;
      agg.testId = info.testId;
      agg.testTitle = info.testTitle;
      if (info.text !== undefined) agg.text = info.text;
    }

    const perQuestion = [...questionAgg.entries()]
      .sort((a, b) => a[1].sectionIndex - b[1].sectionIndex || a[1].seq - b[1].seq)
      .map(([questionId, agg]) => ({
        questionId,
        testId: agg.testId,
        testTitle: agg.testTitle,
        sectionIndex: agg.sectionIndex,
        type: agg.type,
        ...(agg.text !== undefined ? { text: agg.text } : {}),
        marks: agg.marks,
        attempted: agg.attempted,
        correct: agg.correct,
        difficulty: agg.attempted === 0 ? null : Math.round((agg.correct / agg.attempted) * 1000) / 10
      }));

    res.json({
      testId: testId ?? null,
      summary: {
        scoredAttempts: total,
        attemptsToday,
        avgScorePercent: total ? scoreSum / total : null,
        highestScorePercent: total ? highest : null,
        lowestScorePercent: total ? lowest : null,
        avgCorrectPercent: total ? correctPctSum / total : null,
        totalWarnings
      },
      distribution: buckets.map((count, i) => ({ bucket: i * 10, count })),
      perQuestion,
      violations: { byType, attemptsWithViolations, totalWarnings }
    });
  })
);