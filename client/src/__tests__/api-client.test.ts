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
  it('uses the same-origin proxy on deployed hosts for first-party OAuth cookies', async () => {
    browserHost('quizora.example.test');
    vi.stubEnv('DEV', false);
    await expectApiOrigin('');
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
  it('keeps deployed requests same-origin even when Vite dev mode is enabled', async () => {
    browserHost('quizora.example.test');
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_URL_DEV', 'http://localhost:4000');
    vi.stubEnv('VITE_API_URL_PROD', ' https://api.example.test/ ');
    await expectApiOrigin('');
  });
  it('keeps deployed requests same-origin when configured production URLs are blank', async () => {
    browserHost('quizora.example.test');
    vi.stubEnv('VITE_API_URL_PROD', '   ');
    vi.stubEnv('VITE_API_URL', ' https://legacy.example.test/// ');
    await expectApiOrigin('');
  });
});
