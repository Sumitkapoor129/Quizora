export type Role = 'student' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type User = AuthUser;

export interface SessionResponse {
  user: AuthUser;
  sessionExpiresAt: string;
}

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}