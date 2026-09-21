import type { ApiErrorBody, AuthUser, Role, SessionResponse } from '@/types';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  code: string;
  details?: unknown;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

type SessionBody = {
  user: { id: string; email: string; name: string; role: string };
  sessionExpiresAt: string;
};

function mapRole(role: string): Role {
  return role.toUpperCase() === 'ADMIN' ? 'admin' : 'student';
}

function mapUser(user: SessionBody['user']): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: mapRole(user.role) };
}

function mapSession(body: SessionBody): SessionResponse {
  return { user: mapUser(body.user), sessionExpiresAt: body.sessionExpiresAt };
}

/*
 * Session-expiry handling for non-auth endpoints. On a 401 we attempt a
 * single-flight refresh once; the original request is replayed if it
 * succeeds. Only when refresh fails does the session count as expired.
 * Tokens are httpOnly cookies — the client never reads or stores them.
 */
let expiredHandler: (() => void) | null = null;

export function onSessionExpired(handler: () => void): void {
  expiredHandler = handler;
}

function notifySessionExpired(): void {
  expiredHandler?.();
}

let refreshPromise: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, {
      error: {
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the server. Please try again.',
      },
    });
  }

  if (res.status === 401 && allowRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, init, false);
    }
    notifySessionExpired();
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error body; fall through to generic shape.
    }
    throw new ApiError(
      res.status,
      body ?? {
        error: { code: 'UNKNOWN', message: res.statusText || 'Request failed.' },
      },
    );
  }

  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : undefined) as T;
}

export const api = {
  auth: {
    login: (input: { email: string; password: string }) =>
      request<SessionResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }, false).then(mapSession),
    register: (input: { name: string; email: string; password: string }) =>
      request<SessionResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }, false).then(mapSession),
    logout: () => request<void>('/api/auth/logout', { method: 'POST' }, false),
    refresh: () => request<SessionResponse>('/api/auth/refresh', { method: 'POST' }, false).then(mapSession),
    me: () => request<SessionResponse>('/api/auth/me', {}).then(mapSession),
  },
};