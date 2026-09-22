import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const PASSWORD = 'password123';

const MULTI_AT_LEAST_ONE = 'A multi-answer question needs at least one correct option.';
const IMPORT_ID_FORBIDDEN = "Import payload must not contain 'id' fields. Remove generated ids before importing.";
const STALE = 'The preview is out of date. Please re-validate and try again.';

let mongo: MongoMemoryServer | undefined;
let app: Express;
let adminCookie: string;
let studentCookie: string;
let uploadDir: string;

// Server modules read env at import time; import dynamically after setup
// (same pattern as tests-admin.test.ts).
beforeAll(async () => {
  uploadDir = await mkdtemp(join(os.tmpdir(), 'exampro-import-'));
  process.env.UPLOAD_DIR = uploadDir;

  const { createApp } = await import('../src/app.js');
  const { connect, disconnect } = await import('../src/db/connect.js');
  const { User } = await import('../src/models/User.js');
  const { Test } = await import('../src/models/Test.js');

  app = createApp();
  mongo = await MongoMemoryServer.create();
  await connect(mongo.getUri());
  await User.init();
  await Test.init();

  async function seedUser(email: string, name: string, role: 'ADMIN' | 'STUDENT'): Promise<string> {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await User.create({ email, name, passwordHash, role });
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    return cookiePair(login, 'accessToken')!;
  }

  adminCookie = await seedUser('import-admin@example.com', 'Import Admin', 'ADMIN');
  studentCookie = await seedUser('import-student@example.com', 'Import Student', 'STUDENT');
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

/** A valid full-authoring payload (same shape as the PUT body). */
const validContent = {
  title: 'Imported Physics',
  description: 'from JSON',
  defaultNegativeMarks: 0.5,
  shuffleQuestions: false,
  shuffleOptions: true,
  sections: [
    {
      title: 'Mechanics',
      order: 0,
      durationSec: 1200,
      negativeMarksOverride: 0.25,
      questions: [
        {
          type: 'SINGLE',
          order: 0,
          text: 'F = ?',
          marks: 2,
          negativeMarks: 0.5,
          explanation: 'Newton',
          options: [
            { order: 0, text: 'ma', isCorrect: true },
            { order: 1, text: 'mv', isCorrect: false }
          ]
        },
        {
          type: 'MULTI',
          order: 1,
          text: 'Pick two',
          marks: 3,
          options: [
            { order: 0, text: 'a', isCorrect: true },
            { order: 1, text: 'b', isCorrect: false },
            { order: 2, text: 'c', isCorrect: true }
          ]
        }
      ]
    },
    {
      title: 'Thermo',
      order: 1,
      durationSec: 600,
      questions: [
        {
          type: 'SINGLE',
          order: 0,
          marks: 1,
          options: [
            { order: 0, text: 'hot', isCorrect: true },
            { order: 1, text: 'cold', isCorrect: false }
          ]
        }
      ]
    }
  ]
};

const contentJson = (body: unknown): string => JSON.stringify(body);

const validate = (body: Record<string, unknown>) =>
  request(app).post('/api/admin/import/validate').set('Cookie', adminCookie).send(body);

const confirm = (body: Record<string, unknown>) =>
  request(app).post('/api/admin/import/confirm').set('Cookie', adminCookie).send(body);

describe('admin auth guards on import routes', () => {
  it('rejects anonymous requests with 401 on both routes', async () => {
    const v = await request(app).post('/api/admin/import/validate').send({ content: contentJson(validContent) });
    expect(v.status).toBe(401);
    expect(v.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });

    const c = await request(app).post('/api/admin/import/confirm').send({ content: contentJson(validContent), hash: 'x' });
    expect(c.status).toBe(401);
    expect(c.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
  });

  it('rejects STUDENT tokens with 403 on both routes', async () => {
    const v = await request(app)
      .post('/api/admin/import/validate')
      .set('Cookie', studentCookie)
      .send({ content: contentJson(validContent) });
    expect(v.status).toBe(403);
    expect(v.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });

    const c = await request(app)
      .post('/api/admin/import/confirm')
      .set('Cookie', studentCookie)
      .send({ content: contentJson(validContent), hash: 'x' });
    expect(c.status).toBe(403);
    expect(c.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });
  });
});

describe('POST /api/admin/import/validate', () => {
  it('returns a sha256 hash and correct summary counts for valid content', async () => {
    const res = await validate({ content: contentJson(validContent) });

    expect(res.status).toBe(200);
    expect(res.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.summary).toEqual({
      title: 'Imported Physics',
      sectionCount: 2,
      questionCount: 3,
      totalDurationSec: 1800,
      totalMarks: 6
    });
  });

  it('is deterministic: same content always hashes the same', async () => {
    const first = await validate({ content: contentJson(validContent) });
    const second = await validate({ content: contentJson(validContent) });
    expect(first.body.hash).toBe(second.body.hash);
  });

  it('rejects empty or whitespace-only content with 400 INVALID_JSON', async () => {
    for (const bad of ['', '   ', '\n\t']) {
      const res = await validate({ content: bad });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    }
  });

  it('rejects malformed JSON with 400 INVALID_JSON and a content-scoped detail', async () => {
    const res = await validate({ content: '{not json' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'Import content must be a valid JSON object.',
        details: [{ field: 'content', message: 'Import content must be a valid JSON object.' }]
      }
    });
  });

  it('rejects JSON that is not an object (array/primitive) with 400 INVALID_JSON', async () => {
    for (const bad of ['[1, 2, 3]', '"just a string"', '42', 'null']) {
      const res = await validate({ content: bad });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    }
  });

  it('rejects an invalid structure (MULTI with zero correct options) with flat VALIDATION_ERROR details', async () => {
    const bad = {
      ...validContent,
      sections: [
        {
          title: 'S',
          order: 0,
          durationSec: 60,
          questions: [
            {
              type: 'MULTI',
              order: 0,
              marks: 1,
              options: [
                { order: 0, text: 'a', isCorrect: false },
                { order: 1, text: 'b', isCorrect: false }
              ]
            }
          ]
        }
      ]
    };
    const res = await validate({ content: contentJson(bad) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual({
      field: 'sections.0.questions.0.options',
      message: MULTI_AT_LEAST_ONE
    });
  });

  it('rejects a top-level id field with 400 VALIDATION_ERROR', async () => {
    const withRootId = { id: '99999999-8888-4777-8666-555555555555', ...validContent };
    const rootRes = await validate({ content: contentJson(withRootId) });
    expect(rootRes.status).toBe(400);
    expect(rootRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(rootRes.body.error.details).toContainEqual({ field: 'id', message: IMPORT_ID_FORBIDDEN });
  });

  it('rejects id fields anywhere in the payload with 400 VALIDATION_ERROR', async () => {
    const withSectionId = {
      ...validContent,
      sections: [
        { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ...validContent.sections[0] },
        validContent.sections[1]
      ]
    };
    const sectionRes = await validate({ content: contentJson(withSectionId) });
    expect(sectionRes.status).toBe(400);
    expect(sectionRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(sectionRes.body.error.details).toContainEqual({ field: 'sections.0.id', message: IMPORT_ID_FORBIDDEN });

    const withQuestionId = structuredClone(validContent);
    withQuestionId.sections[0].questions[0] = { id: '11111111-2222-4333-8444-555555555555', ...withQuestionId.sections[0].questions[0] };
    const questionRes = await validate({ content: contentJson(withQuestionId) });
    expect(questionRes.status).toBe(400);
    expect(questionRes.body.error.details).toContainEqual({ field: 'sections.0.questions.0.id', message: IMPORT_ID_FORBIDDEN });

    const withOptionId = structuredClone(validContent);
    withOptionId.sections[0].questions[0].options[0] = { id: '66666666-7777-4888-8999-000000000000', ...withOptionId.sections[0].questions[0].options[0] };
    const optionRes = await validate({ content: contentJson(withOptionId) });
    expect(optionRes.status).toBe(400);
    expect(optionRes.body.error.details).toContainEqual({ field: 'sections.0.questions.0.options.0.id', message: IMPORT_ID_FORBIDDEN });
  });

  it('requires content to be present as a string (zod VALIDATION_ERROR)', async () => {
    const missing = await validate({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.details).toContainEqual(expect.objectContaining({ field: 'content' }));

    const notString = await validate({ content: 42 });
    expect(notString.status).toBe(400);
    expect(notString.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/admin/import/confirm', () => {
  it('inserts a DRAFT test when the hash matches and returns the serializeTest shape', async () => {
    const validated = await validate({ content: contentJson(validContent) });

    const res = await confirm({ content: contentJson(validContent), hash: validated.body.hash });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Imported Physics');
    expect(res.body.description).toBe('from JSON');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.defaultNegativeMarks).toBe(0.5);
    expect(res.body.shuffleQuestions).toBe(false);
    expect(res.body.shuffleOptions).toBe(true);
    expect(res.body.sections).toHaveLength(2);
    expect(res.body.sections[0].questions).toHaveLength(2);
    expect(res.body.sections[0].questions[1].type).toBe('MULTI');
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
    expect(typeof res.body.updatedAt).toBe('string');

    // Persisted as DRAFT and retrievable through the normal admin API.
    const get = await request(app).get(`/api/admin/tests/${res.body.id}`).set('Cookie', adminCookie);
    expect(get.status).toBe(200);
    expect(get.body.status).toBe('DRAFT');
    expect(get.body.title).toBe('Imported Physics');
  });

  it('rejects a stale/wrong hash with 409 IMPORT_STALE and creates NOTHING', async () => {
    const { Test } = await import('../src/models/Test.js');
    const before = await Test.countDocuments({ title: 'Stale Never' });

    const res = await confirm({ content: contentJson({ ...validContent, title: 'Stale Never' }), hash: '0'.repeat(64) });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'IMPORT_STALE', message: STALE } });

    const after = await Test.countDocuments({ title: 'Stale Never' });
    expect(after).toBe(before);
  });

  it('re-validates the content at confirm time and inserts NOTHING when validation fails', async () => {
    const validated = await validate({ content: contentJson(validContent) });

    // Title is unique and the rest of the payload is schema-invalid (MULTI
    // with zero correct options), so a successful 400 response proves confirm
    // re-validates instead of trusting the hash AND that no partial insert
    // leaked out of the all-or-nothing confirm step.
    const { Test } = await import('../src/models/Test.js');
    const invalid = {
      ...validContent,
      title: 'Never Inserted',
      sections: [
        {
          title: 'S',
          order: 0,
          durationSec: 60,
          questions: [
            {
              type: 'MULTI',
              order: 0,
              marks: 1,
              options: [
                { order: 0, text: 'a', isCorrect: false },
                { order: 1, text: 'b', isCorrect: false }
              ]
            }
          ]
        }
      ]
    };
    const res = await confirm({ content: contentJson(invalid), hash: validated.body.hash });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Test.countDocuments({ title: 'Never Inserted' })).toBe(0);
  });

  it('returns the same normalized doc for equal content with defaults applied', async () => {
    // Omit defaults in the payload; hash still covers the normalized values
    // (defaultNegativeMarks 0, shuffleQuestions/shuffleOptions true).
    const minimal = {
      title: 'Defaults Import',
      sections: [
        {
          title: 'S',
          order: 0,
          durationSec: 60,
          questions: [
            {
              type: 'SINGLE',
              order: 0,
              marks: 1,
              options: [
                { order: 0, text: 'a', isCorrect: true },
                { order: 1, text: 'b', isCorrect: false }
              ]
            }
          ]
        }
      ]
    };
    const validated = await validate({ content: contentJson(minimal) });
    const res = await confirm({ content: contentJson(minimal), hash: validated.body.hash });

    expect(res.status).toBe(201);
    expect(res.body.defaultNegativeMarks).toBe(0);
    expect(res.body.shuffleQuestions).toBe(true);
    expect(res.body.shuffleOptions).toBe(true);
    expect(res.body.status).toBe('DRAFT');
  });
});