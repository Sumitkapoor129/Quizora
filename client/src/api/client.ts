import type { ApiErrorBody } from '@/types';

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

/**
 * Fetch wrapper used by every API call.
 * Expects the backend (Phase 2) to return errors shaped as
 * `{ error: { code, message, details? } }` with 401 `UNAUTHENTICATED`
 * and 403 `FORBIDDEN` for auth/session failures.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  return (await res.json()) as T;
}