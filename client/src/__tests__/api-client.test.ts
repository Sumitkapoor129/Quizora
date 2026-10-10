import { afterEach, describe, expect, it, vi } from 'vitest';

// The OAuth start must reach the backend host directly: the host-only
// `oauthState` cookie is set there, and Google sends the callback there too.
// If BASE_URL ever falls back to '' (the Vercel proxy) in production, the
// cookie stays on the frontend host and every sign-in fails with
// state_mismatch. These pin both the fallback and the env override.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('api base URL', () => {
  it('falls back to the backend host in production so OAuth state survives', async () => {
    vi.stubEnv('DEV', false);
    const { api } = await import('@/api/client');

    expect(api.auth.googleStartUrl()).toBe(
      'https://quizora-ppfp.onrender.com/api/auth/oauth/google',
    );
  });

  it('lets VITE_API_URL override the backend origin', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    const { api } = await import('@/api/client');

    expect(api.auth.googleStartUrl()).toBe(
      'https://api.example.test/api/auth/oauth/google',
    );
  });
});
