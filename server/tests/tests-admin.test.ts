import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const PASSWORD = 'password123';

const TITLE_REQUIRED = 'Test title is required.';
const SECTION_TITLE_REQUIRED = 'Section title is required.';
const SINGLE_ONE_CORRECT = 'A single-answer question must have exactly one correct option.';
const MULTI_AT_LEAST_ONE = 'A multi-answer question needs at least one correct option.';
const TWO_OPTIONS = 'Each question needs at least two options.';
const OPTION_CONTENT = 'Each option needs text or an image.';
const FROZEN = 'This test is frozen because a student has started it.';

let mongo: MongoMemoryServer | undefined;
let app: Express;
let uploadDir: string;
let adminCookie: string;
let studentCookie: string;
let studentId: string;

// Server modules read UPLOAD_DIR from process.env at import time, so they are
// imported dynamically AFTER the temp dir is set (ESM import hoisting would
// otherwise parse env with the default before we can assign).
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
  const student = await seedUser('student@example.com', 'Student', 'STUDENT');
  studentCookie = student.cookie;
  studentId = student.id;

  async function seedUser(email: string, name: string, role: 'ADMIN' | 'STUDENT'): Promise<{ id: string; cookie: string }> {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await User.create({ email, name, passwordHash, role });
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    return { id: String(user._id), cookie: cookiePair(login, 'accessToken')! };
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createTest(title: string, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/admin/tests').set('Cookie', adminCookie).send({ title, ...extra });
  return res.body as { id: string; [k: string]: unknown };
}

const fullHierarchyBody = {
  title: 'Advanced Physics',
  description: 'v2',
  defaultNegativeMarks: 0.5,
  sections: [
    {
      title: 'Mechanics',
      order: 3,
      durationSec: 1200,
      negativeMarksOverride: 0.25,
      questions: [
        {
          type: 'SINGLE',
          order: 7,
          text: 'F = ?',
          marks: 2,
          negativeMarks: 0.5,
          explanation: 'Newton',
          options: [
            { order: 2, text: 'ma', isCorrect: true },
            { order: 9, text: 'mv', isCorrect: false },
            { order: 13, text: 'md', isCorrect: false }
          ]
        }
      ]
    }
  ]
} as const;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52 // IHDR chunk header
]);

describe('admin auth guards', () => {
  it('rejects anonymous requests with 401', async () => {
    const res = await request(app).get('/api/admin/tests');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
  });

  it('rejects STUDENT tokens with 403', async () => {
    const res = await request(app).get('/api/admin/tests').set('Cookie', studentCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } });
  });

  it('rejects a STUDENT upload with 403', async () => {
    const res = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', studentCookie)
      .attach('file', PNG_BYTES, 'image.png');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/tests', () => {
  it('creates a DRAFT test with empty sections', async () => {
    const res = await request(app)
      .post('/api/admin/tests')
      .set('Cookie', adminCookie)
      .send({ title: 'Fresh Test', description: 'Empty for now', defaultNegativeMarks: 0.75 });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Fresh Test');
    expect(res.body.description).toBe('Empty for now');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.defaultNegativeMarks).toBe(0.75);
    expect(res.body.sections).toEqual([]);
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('defaults defaultNegativeMarks to 0 and ignores a client status', async () => {
    const res = await request(app)
      .post('/api/admin/tests')
      .set('Cookie', adminCookie)
      .send({ title: 'Defaults', status: 'PUBLISHED', sections: [1, 2] });

    expect(res.status).toBe(201);
    expect(res.body.defaultNegativeMarks).toBe(0);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.sections).toEqual([]);
  });
});

describe('GET /api/admin/tests', () => {
  it('lists summaries sorted by updatedAt desc with computed sums, excluding soft-deleted', async () => {
    await createTest('First');
    await delay(5);
    const second = await createTest('Second', { defaultNegativeMarks: 0.5 });
    await request(app)
      .put(`/api/admin/tests/${second.id}`)
      .set('Cookie', adminCookie)
      .send({ ...fullHierarchyBody, title: 'Second' });
    const deleted = await createTest('To Delete');
    await request(app).delete(`/api/admin/tests/${deleted.id}`).set('Cookie', adminCookie);

    const res = await request(app).get('/api/admin/tests').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const tests = res.body.tests as Array<Record<string, unknown>>;
    const find = (title: string) => tests.find((t) => t.title === title);
    expect(find('Second')).toEqual({
      id: expect.any(String),
      title: 'Second',
      status: 'DRAFT',
      defaultNegativeMarks: 0.5,
      sectionCount: 1,
      questionCount: 1,
      totalDurationSec: 1200,
      totalMarks: 2,
      updatedAt: expect.any(String)
    });
    expect(find('First')).toEqual({
      id: expect.any(String),
      title: 'First',
      status: 'DRAFT',
      defaultNegativeMarks: 0,
      sectionCount: 0,
      questionCount: 0,
      totalDurationSec: 0,
      totalMarks: 0,
      updatedAt: expect.any(String)
    });
    // Sorted by updatedAt desc: Second was PUT after First was created.
    expect(tests.findIndex((t) => t.title === 'Second')).toBeLessThan(tests.findIndex((t) => t.title === 'First'));
    expect(tests.map((t) => t.title)).not.toContain('To Delete');
  });
});

describe('GET /api/admin/tests/:id', () => {
  it('returns the full test hierarchy', async () => {
    const created = await createTest('Full');
    await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send(fullHierarchyBody);

    const res = await request(app).get(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Advanced Physics');
    expect(res.body.description).toBe('v2');
    expect(res.body.defaultNegativeMarks).toBe(0.5);
    const section = res.body.sections[0];
    expect(section).toMatchObject({ title: 'Mechanics', order: 3, durationSec: 1200, negativeMarksOverride: 0.25 });
    expect(typeof section.id).toBe('string');
    const question = section.questions[0];
    expect(question).toMatchObject({
      type: 'SINGLE',
      order: 7,
      text: 'F = ?',
      marks: 2,
      negativeMarks: 0.5,
      explanation: 'Newton'
    });
    expect(typeof question.id).toBe('string');
    expect(question.options.map((o: { order: number }) => o.order)).toEqual([2, 9, 13]);
    expect(question.options.map((o: { isCorrect: boolean }) => o.isCorrect)).toEqual([true, false, false]);
    expect(question.options.every((o: { id: unknown }) => typeof o.id === 'string')).toBe(true);
  });

  it('returns 404 for an unknown id', async () => {
    const unknown = '0123456789abcdef01234567';
    const res = await request(app).get(`/api/admin/tests/${unknown}`).set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a soft-deleted test', async () => {
    const created = await createTest('Ghost');
    await request(app).delete(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);

    const res = await request(app).get(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/admin/tests/:id', () => {
  it('replaces the full hierarchy verbatim and never overwrites status', async () => {
    const created = await createTest('Replace Me');
    await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send({ ...fullHierarchyBody });
    await request(app).post(`/api/admin/tests/${created.id}/publish`).set('Cookie', adminCookie);

    const put = await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send({ ...fullHierarchyBody, status: 'ARCHIVED' });

    expect(put.status).toBe(200);
    expect(put.body.status).toBe('PUBLISHED');
    expect(put.body.title).toBe('Advanced Physics');

    const get = await request(app).get(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);
    expect(get.body.status).toBe('PUBLISHED');
    expect(get.body.description).toBe('v2');
    expect(get.body.defaultNegativeMarks).toBe(0.5);
    expect(get.body.sections[0]).toMatchObject({ title: 'Mechanics', order: 3, durationSec: 1200, negativeMarksOverride: 0.25 });
    expect(get.body.sections[0].questions[0]).toMatchObject({ type: 'SINGLE', order: 7, text: 'F = ?', marks: 2, negativeMarks: 0.5, explanation: 'Newton' });
    expect(get.body.sections[0].questions[0].options.map((o: { order: number }) => o.order)).toEqual([2, 9, 13]);
  });

  it('assigns fresh subdocument ids on every whole-doc replace', async () => {
    const created = await createTest('Fresh Ids');
    await request(app).put(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie).send(fullHierarchyBody);
    const first = await request(app).get(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);

    await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send({ ...fullHierarchyBody, title: 'Renamed' });
    const second = await request(app).get(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);

    expect(second.body.sections[0].id).not.toBe(first.body.sections[0].id);
    expect(second.body.sections[0].questions[0].id).not.toBe(first.body.sections[0].questions[0].id);
    expect(second.body.sections[0].questions[0].options[0].id).not.toBe(first.body.sections[0].questions[0].options[0].id);
    expect(second.body.title).toBe('Renamed');
  });

  it('strips client-supplied subdocument uuid ids and returns server ids instead', async () => {
    // The builder sends crypto.randomUUID() temp ids in the PUT body. They
    // must be stripped (not 400), and fresh server _ids returned.
    const created = await createTest('Client Ids');
    const sectionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const questionId = '11111111-2222-4333-8444-555555555555';
    const optionId = '66666666-7777-4888-8999-000000000000';
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const res = await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send({
        title: 'Client Ids',
        sections: [
          {
            id: sectionId,
            title: 'S',
            order: 0,
            durationSec: 600,
            questions: [
              {
                id: questionId,
                type: 'SINGLE',
                order: 0,
                text: 'Q?',
                marks: 1,
                options: [
                  { id: optionId, order: 0, text: 'a', isCorrect: true },
                  { order: 1, text: 'b', isCorrect: false }
                ]
              }
            ]
          }
        ]
      });

    expect(res.status).toBe(200);
    const section = res.body.sections[0];
    const question = section.questions[0];
    const option = question.options[0];
    expect(typeof section.id).toBe('string');
    expect(typeof question.id).toBe('string');
    expect(typeof option.id).toBe('string');
    expect(section.id).not.toBe(sectionId);
    expect(question.id).not.toBe(questionId);
    expect(option.id).not.toBe(optionId);
    // Server ids are Mongo ObjectIds, not uuid-shaped.
    expect(section.id).not.toMatch(uuidLike);
    expect(question.id).not.toMatch(uuidLike);
    expect(option.id).not.toMatch(uuidLike);
  });

  it('returns 404 for an unknown id', async () => {
    const unknown = '0123456789abcdef01234567';
    const res = await request(app)
      .put(`/api/admin/tests/${unknown}`)
      .set('Cookie', adminCookie)
      .send(fullHierarchyBody);
    expect(res.status).toBe(404);
  });

  it('returns 409 TEST_FROZEN when a student attempt exists', async () => {
    const created = await createTest('Frozen Put');
    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.create({ testId: created.id, studentId });

    const res = await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send(fullHierarchyBody);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'TEST_FROZEN', message: FROZEN } });
  });

  it('rejects invalid payloads with flat field-scoped details', async () => {
    const base = { title: 'Valid', sections: [{ title: 'S', order: 0, durationSec: 60, questions: [] as unknown[] }] };
    const question = (over: Record<string, unknown>) => ({
      type: 'SINGLE',
      order: 0,
      marks: 1,
      options: [
        { order: 0, text: 'a', isCorrect: false },
        { order: 1, text: 'b', isCorrect: false }
      ],
      ...over
    });
    const cases = [
      {
        name: 'missing test title',
        body: { description: 'no title' },
        field: 'title',
        message: TITLE_REQUIRED
      },
      {
        name: 'section missing title',
        body: { ...base, sections: [{ order: 0, durationSec: 60, questions: [] }] },
        field: 'sections.0.title',
        message: SECTION_TITLE_REQUIRED
      },
      {
        name: 'SINGLE with zero correct options',
        body: { ...base, sections: [{ title: 'S', order: 0, durationSec: 60, questions: [question({})] }] },
        field: 'sections.0.questions.0.options',
        message: SINGLE_ONE_CORRECT
      },
      {
        name: 'SINGLE with two correct options',
        body: {
          ...base,
          sections: [
            {
              title: 'S',
              order: 0,
              durationSec: 60,
              questions: [
                question({
                  options: [
                    { order: 0, text: 'a', isCorrect: true },
                    { order: 1, text: 'b', isCorrect: true }
                  ]
                })
              ]
            }
          ]
        },
        field: 'sections.0.questions.0.options',
        message: SINGLE_ONE_CORRECT
      },
      {
        name: 'MULTI with zero correct options',
        body: {
          ...base,
          sections: [
            {
              title: 'S',
              order: 0,
              durationSec: 60,
              questions: [question({ type: 'MULTI' })]
            }
          ]
        },
        field: 'sections.0.questions.0.options',
        message: MULTI_AT_LEAST_ONE
      },
      {
        name: 'question with fewer than two options',
        body: {
          ...base,
          sections: [
            {
              title: 'S',
              order: 0,
              durationSec: 60,
              questions: [
                question({ options: [{ order: 0, text: 'only', isCorrect: true }] })
              ]
            }
          ]
        },
        field: 'sections.0.questions.0.options',
        message: TWO_OPTIONS
      },
      {
        name: 'option with neither text nor image',
        body: {
          ...base,
          sections: [
            {
              title: 'S',
              order: 0,
              durationSec: 60,
              questions: [
                question({
                  options: [
                    { order: 0, isCorrect: false },
                    { order: 1, text: 'b', isCorrect: true }
                  ]
                })
              ]
            }
          ]
        },
        field: 'sections.0.questions.0.options.0',
        message: OPTION_CONTENT
      }
    ];

    for (const c of cases) {
      const created = await createTest(`Bad ${c.name}`);
      const res = await request(app)
        .put(`/api/admin/tests/${created.id}`)
        .set('Cookie', adminCookie)
        .send(c.body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toContainEqual({ field: c.field, message: c.message });
    }
  });
});

describe('DELETE /api/admin/tests/:id', () => {
  it('soft-deletes, then excludes it from GET and list', async () => {
    const created = await createTest('Doomed');

    const del = await request(app).delete(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);
    expect(del.status).toBe(204);

    const get = await request(app).get(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);
    expect(get.status).toBe(404);

    const list = await request(app).get('/api/admin/tests').set('Cookie', adminCookie);
    expect(list.body.tests.map((t: { title: string }) => t.title)).not.toContain('Doomed');
  });

  it('soft-deletes even when a student attempt exists', async () => {
    const created = await createTest('Frozen Delete');
    const { TestAttempt } = await import('../src/models/TestAttempt.js');
    await TestAttempt.create({ testId: created.id, studentId });

    const res = await request(app).delete(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(204);

    const get = await request(app).get(`/api/admin/tests/${created.id}`).set('Cookie', adminCookie);
    expect(get.status).toBe(404);
  });
});

describe('POST /api/admin/tests/:id/publish and /unpublish', () => {
  it('publishes a DRAFT test and is idempotent when already PUBLISHED', async () => {
    const created = await createTest('Publish Me');
    await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send({ ...fullHierarchyBody, title: 'Publish Me' });

    const first = await request(app).post(`/api/admin/tests/${created.id}/publish`).set('Cookie', adminCookie);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('PUBLISHED');

    const second = await request(app).post(`/api/admin/tests/${created.id}/publish`).set('Cookie', adminCookie);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('PUBLISHED');
  });

  it('refuses to publish or unpublish an ARCHIVED test', async () => {
    const created = await createTest('Archived');
    const { Test } = await import('../src/models/Test.js');
    await Test.updateOne({ _id: created.id }, { $set: { status: 'ARCHIVED' } });

    const pub = await request(app).post(`/api/admin/tests/${created.id}/publish`).set('Cookie', adminCookie);
    expect(pub.status).toBe(409);
    expect(pub.body).toEqual({
      error: { code: 'STATUS_FROZEN', message: 'Archived tests cannot be published or unpublished.' }
    });

    const unpub = await request(app).post(`/api/admin/tests/${created.id}/unpublish`).set('Cookie', adminCookie);
    expect(unpub.status).toBe(409);
    expect(unpub.body.error.code).toBe('STATUS_FROZEN');
  });

  it('refuses to publish a test with no sections', async () => {
    const created = await createTest('No Sections');
    const res = await request(app).post(`/api/admin/tests/${created.id}/publish`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'NOT_PUBLISHABLE', message: 'A test needs at least one section before it can be published.' }
    });
  });

  it('refuses to publish a test with sections but no questions', async () => {
    const created = await createTest('No Questions');
    await request(app)
      .put(`/api/admin/tests/${created.id}`)
      .set('Cookie', adminCookie)
      .send({
        ...fullHierarchyBody,
        title: 'No Questions',
        sections: [{ title: 'Empty', order: 0, durationSec: 600, questions: [] }]
      });

    const res = await request(app).post(`/api/admin/tests/${created.id}/publish`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'NOT_PUBLISHABLE', message: 'A test needs at least one question before it can be published.' }
    });
  });

  it('unpublishes back to DRAFT', async () => {
    const created = await createTest('Cycle');
    await request(app).post(`/api/admin/tests/${created.id}/publish`).set('Cookie', adminCookie);

    const res = await request(app).post(`/api/admin/tests/${created.id}/unpublish`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DRAFT');
  });

  it('returns 404 for an unknown id on publish and unpublish', async () => {
    const unknown = '0123456789abcdef01234567';
    const pub = await request(app).post(`/api/admin/tests/${unknown}/publish`).set('Cookie', adminCookie);
    expect(pub.status).toBe(404);

    const unpub = await request(app).post(`/api/admin/tests/${unknown}/unpublish`).set('Cookie', adminCookie);
    expect(unpub.status).toBe(404);
  });
});

describe('POST /api/admin/uploads', () => {
  it('accepts a PNG by magic bytes regardless of claimed filename/MIME, and serves it', async () => {
    const upload = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', adminCookie)
      .attach('file', PNG_BYTES, { filename: 'evil.svg', contentType: 'image/svg+xml' });

    expect(upload.status).toBe(201);
    expect(upload.body.url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);

    const name = (upload.body.url as string).split('/').pop()!;
    const files = await readdir(uploadDir);
    expect(files).toContain(name);

    const served = await request(app).get(upload.body.url as string);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/^image\/png/);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.body.equals(PNG_BYTES)).toBe(true);
  });

  it('rejects SVG bytes with 400 UPLOAD_INVALID_TYPE', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', adminCookie)
      .attach('file', svg, { filename: 'vector.svg', contentType: 'image/svg+xml' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UPLOAD_INVALID_TYPE');
  });

  it('rejects files over the 2MB cap with 400 UPLOAD_TOO_LARGE', async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    const res = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', adminCookie)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UPLOAD_TOO_LARGE');
  });

  it('rejects a request with no file field with 400 UPLOAD_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', adminCookie)
      .field('note', 'no file here');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UPLOAD_REQUIRED');
  });
});