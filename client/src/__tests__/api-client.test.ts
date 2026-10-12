import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  for (const key of ['VITE_API_URL', 'VITE_API_URL_DEV', 'VITE_API_URL_PROD']) vi.stubEnv(key, '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
function browserHost(hostname: string) {
  vi.stubGlobal('window', { location: { hostname } });
}
async function expectApiOrigin(origin: string) {
  const { api, assetUrl } = await import('@/api/client');
  expect(api.auth.googleStartUrl()).toBe(`${origin}/api/auth/oauth/google`);
  expect(assetUrl('/uploads/image.png')).toBe(`${origin}/uploads/image.png`);
}

describe('api base URL', () => {
  it('uses the direct backend fallback on deployed hosts for OAuth state cookies', async () => {
    browserHost('quizora.example.test');
    vi.stubEnv('DEV', false);
    await expectApiOrigin('https://quizora-ppfp.onrender.com');
  });
  it.each(['localhost', '127.0.0.1', '[::1]'])('uses the same loopback hostname for a production preview on %s', async (hostname) => {
    browserHost(hostname);
    vi.stubEnv('DEV', false);
    await expectApiOrigin(`http://${hostname}:3001`);
  });
  it('selects and normalizes the dev URL locally with both environments configured', async () => {
    browserHost('localhost');
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_API_URL_DEV', ' http://localhost:4000/// ');
    vi.stubEnv('VITE_API_URL_PROD', 'https://api.example.test');
    vi.stubEnv('VITE_API_URL', 'https://legacy.example.test');
    await expectApiOrigin('http://localhost:4000');
  });
  it('selects production on deployed hosts even with Vite dev mode', async () => {
    browserHost('quizora.example.test');
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_URL_DEV', 'http://localhost:4000');
    vi.stubEnv('VITE_API_URL_PROD', ' https://api.example.test/ ');
    await expectApiOrigin('https://api.example.test');
  });
  it('preserves the legacy fallback when the selected environment URL is blank', async () => {
    browserHost('quizora.example.test');
    vi.stubEnv('VITE_API_URL_PROD', '   ');
    vi.stubEnv('VITE_API_URL', ' https://legacy.example.test/// ');
    await expectApiOrigin('https://legacy.example.test');
  });
});
