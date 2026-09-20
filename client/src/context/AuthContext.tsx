import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Role, User } from '@/types';

const ROLE_STORAGE_KEY = 'exampro.role';

export interface AuthContextValue {
  user: User | null;
  login: (role: Role) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_USERS: Record<Role, User> = {
  student: { id: 'demo-student', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' },
  admin: { id: 'demo-admin', email: 'alex@example.com', name: 'Alex Morgan', role: 'admin' },
};

function readStoredRole(): Role | null {
  const stored = localStorage.getItem(ROLE_STORAGE_KEY);
  return stored === 'student' || stored === 'admin' ? stored : null;
}

/**
 * Phase 1 stub auth. Persists a demo role in localStorage so refreshes
 * keep the session. Phase 2 replaces login/logout with real API calls
 * (cookie session) — the `{ user, login, logout }` surface stays the same.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const role = readStoredRole();
    return role ? DEMO_USERS[role] : null;
  });

  const login = useCallback((role: Role) => {
    localStorage.setItem(ROLE_STORAGE_KEY, role);
    setUser(DEMO_USERS[role]);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ROLE_STORAGE_KEY);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}