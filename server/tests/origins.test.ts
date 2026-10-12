import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...actual, env: { ...actual.env, CLIENT_ORIGINS: ['http://localhost:5173', 'http://127.0.0.1:5173'] } };
});
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';

const app = createApp();
afterEach(() => vi.unstubAllGlobals());

describe('browser origin protection', () => {
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'allows local frontend %s with credentialed CORS', async (origin) => {
      const response = await request(app).get('/health').set('Origin', origin);
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers.vary).toContain('Origin');
    }
  );

  it('allows credentialed local preflight', async () => {
    const response = await request(app).options('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it.each(['https://evil.example', 'http://localhost:5173.evil.example', 'null', 'http://localhost:9999'])(
    'denies unconfigured origin %s without granting CORS', async (origin) => {
      const response = await request(app).get('/health').set('Origin', origin);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ORIGIN_FORBIDDEN');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  );

  it('rejects a hostile Referer even when Origin is allowed', async () => {
    const response = await request(app).get('/health')
      .set('Origin', 'http://localhost:5173').set('Referer', 'https://evil.example/page');
    expect(response.status).toBe(403);
  });

  it('supports requests without browser origin headers', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('uses the configured callback for Google sign-in and a host-only state cookie', async () => {
    const response = await request(app).get('/api/auth/oauth/google')
      .set('Host', 'localhost:3001').set('Origin', env.CLIENT_ORIGINS[0]);
    expect(response.status).toBe(302);
    expect(new URL(response.headers.location).searchParams.get('redirect_uri')).toBe(env.OAUTH_CALLBACK_URL);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const state = cookies.find((cookie) => cookie.startsWith('oauthState='));
    expect(state).toContain('HttpOnly');
    expect(state).toContain('SameSite=Lax');
    expect(state).not.toContain('Domain=');
  });
});

describe('OAuth local host handling', () => {
  it('keeps callback and failure redirect on 127.0.0.1 when starting there', async () => {
    const start = await request(app).get('/api/auth/oauth/google')
      .set('Host', '127.0.0.1:3001').set('Origin', 'http://127.0.0.1:5173');
    expect(start.status).toBe(302);
    expect(new URL(start.headers.location).searchParams.get('redirect_uri'))
      .toBe('http://127.0.0.1:3001/api/auth/oauth/google/callback');
    const cookies = start.headers['set-cookie'] as unknown as string[];
    const callback = await request(app).get('/api/auth/oauth/google/callback?error=access_denied')
      .set('Host', '127.0.0.1:3001').set('Cookie', cookies.map((cookie) => cookie.split(';')[0]));
    expect(callback.headers.location).toBe('http://127.0.0.1:5173/login?oauth=error');
  });

  it('exchanges the code using the same local callback URI used at start', async () => {
    const start = await request(app).get('/api/auth/oauth/google')
      .set('Host', '127.0.0.1:3001').set('Origin', 'http://127.0.0.1:5173');
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const tokenFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', tokenFetch);
    const cookies = start.headers['set-cookie'] as unknown as string[];
    const callback = await request(app).get(`/api/auth/oauth/google/callback?state=${encodeURIComponent(state)}&code=test-code`)
      .set('Host', '127.0.0.1:3001').set('Cookie', cookies.map((cookie) => cookie.split(';')[0]));
    expect(tokenFetch).toHaveBeenCalledOnce();
    const body = tokenFetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:3001/api/auth/oauth/google/callback');
    expect(callback.headers.location).toBe('http://127.0.0.1:5173/login?oauth=error');
  });

  it('does not derive a callback from an untrusted Host header', async () => {
    const response = await request(app).get('/api/auth/oauth/google')
      .set('Host', 'evil.example').set('Origin', 'http://localhost:5173');
    expect(new URL(response.headers.location).searchParams.get('redirect_uri')).toBe(env.OAUTH_CALLBACK_URL);
  });

  it('ignores a forged app origin cookie when redirecting on failure', async () => {
    const response = await request(app).get('/api/auth/oauth/google/callback?error=access_denied')
      .set('Cookie', 'oauthAppOrigin=https%3A%2F%2Fevil.example');
    expect(response.headers.location).toBe(`${env.CLIENT_ORIGINS[0]}/login?oauth=error`);
  });
});
