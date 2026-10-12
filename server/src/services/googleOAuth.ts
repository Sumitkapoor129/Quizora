import { env } from '../config/env.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const TIMEOUT_MS = 10_000;

/**
 * One place that turns a transport, status or decode failure into
 * `<reason>:<detail>`. Callers match on the `google_*_failed` prefix, and a
 * hung or unparseable Google response must not escape as a raw fetch/JSON
 * error or hang the sign-in request.
 */
async function googleJson(reason: string, url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error(`${reason}:unreachable`);
  }
  if (!res.ok) throw new Error(`${reason}:${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${reason}:invalid_json`);
  }
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
}

export function buildAuthUrl(opts: { state: string; redirectUri?: string }): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', opts.redirectUri ?? env.OAUTH_CALLBACK_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', opts.state);
  return url.toString();
}

export async function exchangeCode(code: string, redirectUri = env.OAUTH_CALLBACK_URL): Promise<string> {
  const body = (await googleJson('google_token_exchange_failed', TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri
    })
  })) as { access_token?: string };
  if (!body.access_token) throw new Error('google_token_exchange_failed:no_access_token');
  return body.access_token;
}

export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const profile = (await googleJson('google_profile_failed', USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })) as Partial<GoogleProfile>;
  if (!profile.sub || !profile.email) throw new Error('google_profile_failed:invalid_payload');
  return profile as GoogleProfile;
}
