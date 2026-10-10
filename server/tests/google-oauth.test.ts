import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthUrl, exchangeCode, fetchProfile } from '../src/services/googleOAuth.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('buildAuthUrl', () => {
  it('targets Google with the configured client, callback, scope and state', () => {
    const url = new URL(buildAuthUrl({ state: 'st4te' }));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/auth/oauth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('st4te');
  });

  it('encodes a state containing URL-unsafe characters', () => {
    expect(new URL(buildAuthUrl({ state: 'a b&c=d' })).searchParams.get('state')).toBe('a b&c=d');
  });
});

describe('exchangeCode', () => {
  it('posts the authorization-code grant and returns the access token', async () => {
    const fetchMock = vi.fn(async () => json({ access_token: 'tok-123' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeCode('code-abc')).resolves.toBe('tok-123');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers as HeadersInit).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-abc');
    expect(body.get('client_id')).toBe('test-google-client-id');
    expect(body.get('client_secret')).toBe('test-google-client-secret');
    expect(body.get('redirect_uri')).toBe('http://localhost:3001/api/auth/oauth/google/callback');
  });

  it('throws with the rejected status when Google refuses the code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'invalid_grant' }, 400)));
    await expect(exchangeCode('bad')).rejects.toThrow(/google_token_exchange_failed:400/);
  });

  it('throws when the response carries no access token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    await expect(exchangeCode('code')).rejects.toThrow(/google_token_exchange_failed:no_access_token/);
  });

  it('contains a transport failure as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    await expect(exchangeCode('code')).rejects.toThrow(/google_token_exchange_failed:unreachable/);
  });
});

describe('fetchProfile', () => {
  it('reads the profile with a bearer token', async () => {
    const fetchMock = vi.fn(async () =>
      json({ sub: 'google-sub-1', email: 'Student@Example.com', name: 'Student', email_verified: true })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProfile('tok-123')).resolves.toMatchObject({ sub: 'google-sub-1' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect(new Headers(init.headers as HeadersInit).get('Authorization')).toBe('Bearer tok-123');
  });

  it('throws with the failing status when the userinfo call is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(fetchProfile('tok')).rejects.toThrow(/google_profile_failed:401/);
  });

  it('contains a non-JSON success body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nope</html>', { status: 200 })));
    await expect(fetchProfile('tok')).rejects.toThrow(/google_profile_failed:invalid_json/);
  });

  it('rejects a payload with no subject', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ email: 'student@example.com' })));
    await expect(fetchProfile('tok')).rejects.toThrow(/google_profile_failed:invalid_payload/);
  });

  it('rejects a payload with no email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sub: 'google-sub-1' })));
    await expect(fetchProfile('tok')).rejects.toThrow(/google_profile_failed:invalid_payload/);
  });
});
