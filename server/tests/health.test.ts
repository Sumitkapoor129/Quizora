import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authenticate } from '../src/middleware/auth.js';

// Stub protected route mounted (before notFound) to prove `authenticate` works.
const app = createApp((a) => {
  a.get('/protected', authenticate, (_req, res) => {
    res.json({ ok: true });
  });
});

describe('health & error shape', () => {
  it('GET /health -> 200 { ok: true, service, time }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('mcq-exam-server');
    expect(typeof res.body.time).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false);
  });

  it('GET /api/unknown -> 404 with uniform JSON error shape', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });

  it('protected route without access cookie -> 401 with exact error shape', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
  });
});