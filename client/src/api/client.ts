import type {
  AdminAttemptDetailResponse,
  AdminAttemptListResponse,
  AdminTest,
  AdminTestWrite,
  AntiCheatEventType,
  ApiErrorBody,
  AttemptResponse,
  AttemptResultResponse,
  AuthUser,
  CreateAttemptResponse,
  ListTestsResponse,
  PostEventResponse,
  Role,
  SaveAnswersBody,
  SaveAnswersResponse,
  SessionResponse,
  StartAttemptResponse,
  StudentTestsResponse,
  UploadResponse,
  ValidateImportResponse,
} from '@/types';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/** Absolute URL for a relative asset path (e.g. `/uploads/x.png`). */
export const assetUrl = (path?: string | null): string => (path ? `${BASE_URL}${path}` : '');

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
  // Multipart bodies must set their own boundary — never force JSON there.
  const headers =
    typeof FormData !== 'undefined' && init.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init.headers };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers,
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
  tests: {
    list: () => request<ListTestsResponse>('/api/admin/tests'),
    get: (id: string) => request<AdminTest>(`/api/admin/tests/${id}`),
    create: (input: { title: string; description?: string; defaultNegativeMarks?: number }) =>
      request<AdminTest>('/api/admin/tests', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, body: AdminTestWrite) =>
      request<AdminTest>(`/api/admin/tests/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) => request<void>(`/api/admin/tests/${id}`, { method: 'DELETE' }),
    publish: (id: string) => request<AdminTest>(`/api/admin/tests/${id}/publish`, { method: 'POST' }),
    unpublish: (id: string) => request<AdminTest>(`/api/admin/tests/${id}/unpublish`, { method: 'POST' }),
  },
  uploads: {
    upload: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request<UploadResponse>('/api/admin/uploads', { method: 'POST', body: form });
    },
  },
  imports: {
    validate: (input: { content: string }) =>
      request<ValidateImportResponse>('/api/admin/import/validate', { method: 'POST', body: JSON.stringify(input) }),
    confirm: (input: { content: string; hash: string }) =>
      request<AdminTest>('/api/admin/import/confirm', { method: 'POST', body: JSON.stringify(input) }),
  },
  admin: {
    attempts: {
      list: (testId?: string) => {
        const query = testId ? `?testId=${encodeURIComponent(testId)}` : '';
        return request<AdminAttemptListResponse>(`/api/admin/attempts${query}`);
      },
      get: (attemptId: string) => request<AdminAttemptDetailResponse>(`/api/admin/attempts/${attemptId}`),
    },
    analytics: (testId?: string) => {
      const query = testId ? `?testId=${encodeURIComponent(testId)}` : '';
      return request<import('@/types').AdminAnalytics>(`/api/admin/analytics${query}`);
    },
  },
  student: {
    tests: () => request<StudentTestsResponse>('/api/student/tests'),
    createAttempt: (testId: string) =>
      request<CreateAttemptResponse>(`/api/student/tests/${testId}/attempts`, { method: 'POST' }),
    startAttempt: (attemptId: string) =>
      request<StartAttemptResponse>(`/api/student/attempts/${attemptId}/start`, { method: 'POST' }),
    attempt: (attemptId: string) => request<AttemptResponse>(`/api/student/attempts/${attemptId}`),
    saveAnswers: (attemptId: string, body: SaveAnswersBody) =>
      request<SaveAnswersResponse>(`/api/student/attempts/${attemptId}/answers`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    postEvent: (attemptId: string, body: { type: AntiCheatEventType; payload?: unknown }) =>
      request<PostEventResponse>(`/api/student/attempts/${attemptId}/events`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    submit: (attemptId: string) =>
      request<AttemptResultResponse>(`/api/student/attempts/${attemptId}/submit`, { method: 'POST' }),
    result: (attemptId: string) => request<AttemptResultResponse>(`/api/student/attempts/${attemptId}/result`),
  },
};