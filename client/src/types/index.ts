export type Role = 'student' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}