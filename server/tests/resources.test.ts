import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const PASSWORD = 'password123';

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } };

let mongo: MongoMemoryServer | undefined;
let app: Express;
let uploadDir: string;
let adminCookie: string;
let studentCookie: string;
let adminId: string;

beforeAll(async () => {
  uploadDir = await mkdtemp(join(os.tmpdir(), 'exampro-upload-'));
  process.env.UPLOAD_DIR = uploadDir;

  const { createApp } = await import('../src/app.js');
  const { connect, disconnect } = await import('../src/db/connect.js');
  const { User } = await import('../src/models/User.js');
  const { Resource } = await import('../src/models/Resource.js');

  app = createApp();
  mongo = await MongoMemoryServer.create();
  await connect(mongo.getUri());
  await User.init();
  await Resource.init();

  const admin = await seedUser('admin@example.com', 'Admin', 'ADMIN');
  adminCookie = admin.cookie;
  adminId = admin.id;
  const s1 = await seedUser('s1@example.com', 'Student One', 'STUDENT');
  studentCookie = s1.cookie;

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

const validBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Algebra Chapter 1',
  description: 'Summary notes for chapter 1',
  kind: 'PDF',
  driveUrl: 'https://drive.google.com/file/d/abc123',
  ...overrides
});

// ---- 1. Admin create ----

describe('POST /api/admin/resources', () => {
  it('creates a resource and returns the exact admin DTO with 201', async () => {
    const res = await request(app).post('/api/admin/resources').set('Cookie', adminCookie).send(validBody());

    expect(res.status).toBe(201);
    const resource = res.body.resource as Record<string, unknown>;
    expect(Object.keys(resource).sort()).toEqual(['createdAt', 'createdBy', 'description', 'driveUrl', 'id', 'kind', 'title']);
    expect(resource).toMatchObject({
      id: expect.any(String),
      title: 'Algebra Chapter 1',
      description: 'Summary notes for chapter 1',
      kind: 'PDF',
      driveUrl: 'https://drive.google.com/file/d/abc123',
      createdBy: adminId
    });
    expect(Number.isNaN(Date.parse(resource.createdAt as string))).toBe(false);
  });

  it('rejects STUDENT tokens with 403 on admin resource routes', async () => {
    const post = await request(app).post('/api/admin/resources').set('Cookie', studentCookie).send(validBody());
    expect(post.status).toBe(403);
    expect(post.body).toEqual(FORBIDDEN);

    const get = await request(app).get('/api/admin/resources').set('Cookie', studentCookie);
    expect(get.status).toBe(403);
    expect(get.body).toEqual(FORBIDDEN);

    const del = await request(app).delete('/api/admin/resources/0123456789abcdef01234567').set('Cookie', studentCookie);
    expect(del.status).toBe(403);
    expect(del.body).toEqual(FORBIDDEN);
  });

  it('rejects a missing title with a flat field detail (400)', async () => {
    const res = await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ title: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual({ field: 'title', message: 'Resource title is required.' });
  });

  it('rejects an unknown kind with 400', async () => {
    const res = await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ kind: 'DOCX' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ field: 'kind' })
    );
  });

  it('rejects a non-URL driveUrl with 400', async () => {
    const res = await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ driveUrl: 'not-a-url' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual({ field: 'driveUrl', message: 'Enter a valid URL.' });
  });
});

// ---- 2. Admin list ----

describe('GET /api/admin/resources', () => {
  it('lists resources newest-first with createdBy on every item', async () => {
    const older = await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ title: 'Older Resource', kind: 'ZIP', driveUrl: 'https://drive.google.com/file/d/older' }));
    expect(older.status).toBe(201);
    const newer = await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ title: 'Newer Resource', kind: 'IMAGE', driveUrl: 'https://drive.google.com/file/d/newer' }));
    expect(newer.status).toBe(201);

    const res = await request(app).get('/api/admin/resources').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const resources = res.body.resources as Array<Record<string, unknown>>;
    expect(Array.isArray(resources)).toBe(true);

    const titles = resources.map((r) => r.title as string);
    expect(titles.indexOf('Newer Resource')).toBeLessThan(titles.indexOf('Older Resource'));
    expect(titles[0]).toBe('Newer Resource');
    for (const r of resources) {
      expect(r.createdBy).toBeDefined();
      expect(typeof r.createdAt).toBe('string');
    }
  });
});

// ---- 3. Admin delete ----

describe('DELETE /api/admin/resources/:id', () => {
  it('deletes with 204, then 404s on a second delete', async () => {
    const created = await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ title: 'Doomed Resource' }));
    expect(created.status).toBe(201);
    const id = (created.body.resource as { id: string }).id;

    const first = await request(app).delete(`/api/admin/resources/${id}`).set('Cookie', adminCookie);
    expect(first.status).toBe(204);
    expect(first.text).toBe('');

    const second = await request(app).delete(`/api/admin/resources/${id}`).set('Cookie', adminCookie);
    expect(second.status).toBe(404);
    expect(second.body.error.code).toBe('NOT_FOUND');
  });
});

// ---- 4. Student list ----

describe('GET /api/student/resources', () => {
  it('returns newest-first without createdBy and only the student DTO fields', async () => {
    await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ title: 'Student Older', kind: 'PDF', driveUrl: 'https://drive.google.com/file/d/s-older' }));
    await request(app)
      .post('/api/admin/resources')
      .set('Cookie', adminCookie)
      .send(validBody({ title: 'Student Newer', kind: 'OTHER', driveUrl: 'https://drive.google.com/file/d/s-newer' }));

    const res = await request(app).get('/api/student/resources').set('Cookie', studentCookie);
    expect(res.status).toBe(200);
    const resources = res.body.resources as Array<Record<string, unknown>>;
    expect(Array.isArray(resources)).toBe(true);

    const titles = resources.map((r) => r.title as string);
    expect(titles[0]).toBe('Student Newer');
    expect(titles.indexOf('Student Newer')).toBeLessThan(titles.indexOf('Student Older'));

    for (const r of resources) {
      expect(Object.keys(r).sort()).toEqual(['createdAt', 'description', 'driveUrl', 'id', 'kind', 'title']);
      expect(r).not.toHaveProperty('createdBy');
    }
    expect(JSON.stringify(res.body)).not.toContain('createdBy');
  });
});
