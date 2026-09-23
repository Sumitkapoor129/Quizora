import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, onSessionExpired } from '@/api/client';
import type { AuthStatus, AuthUser, SessionResponse } from '@/types';

export interface AuthContextValue {
  user: AuthUser | null;
  sessionExpiresAt: string | null;
  status: AuthStatus;
  expired: boolean;
  login: (credentials: { email: string; password: string }) => Promise<AuthUser>;
  /** Registration step 2: exchange the emailed OTP for a session. */
  verifyRegister: (input: { name: string; email: string; password: string; code: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [expired, setExpired] = useState(false);
  const checkInFlight = useRef(false);

  const checkSession = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    try {
      const data = await api.auth.me();
      setSession(data);
      setStatus('authenticated');
      setExpired(false);
    } catch {
      setSession(null);
      setStatus('anonymous');
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    checkSession();
    window.addEventListener('focus', checkSession);
    return () => window.removeEventListener('focus', checkSession);
  }, [checkSession]);

  useEffect(() => {
    onSessionExpired(() => setExpired(true));
  }, []);

  const login = useCallback(async ({ email, password }: { email: string; password: string }) => {
    const data = await api.auth.login({ email, password });
    setSession(data);
    setStatus('authenticated');
    setExpired(false);
    return data.user;
  }, []);

  const verifyRegister = useCallback(
    async ({ name, email, password, code }: { name: string; email: string; password: string; code: string }) => {
      const data = await api.auth.verifyRegister({ name, email, password, code });
      setSession(data);
      setStatus('authenticated');
      setExpired(false);
      return data.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Clear the local session even if the server call fails.
    } finally {
      setSession(null);
      setStatus('anonymous');
      setExpired(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      sessionExpiresAt: session?.sessionExpiresAt ?? null,
      status,
      expired,
      login,
      verifyRegister,
      logout,
    }),
    [session, status, expired, login, verifyRegister, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}