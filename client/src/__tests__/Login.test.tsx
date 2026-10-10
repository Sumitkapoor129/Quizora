import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import Login from '@/pages/auth/Login';
import type { AuthUser } from '@/types';

const student: AuthUser = { id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' };
const admin: AuthUser = { id: '2', email: 'alex@example.com', name: 'Alex Morgan', role: 'admin' };

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    sessionExpiresAt: null,
    status: 'anonymous',
    expired: false,
    logout: vi.fn(),
    ...overrides,
  };
}

function renderLogin(overrides: Partial<AuthContextValue> = {}, search = '') {
  render(
    <MemoryRouter
      initialEntries={[`/login${search}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={authValue(overrides)}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/student" element={<h1>Student home</h1>} />
          <Route path="/student/results" element={<h1>My results</h1>} />
          <Route path="/admin" element={<h1>Admin home</h1>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Login', () => {
  // The href is asserted with a regex, never an exact string: BASE_URL is
  // 'http://localhost:3001' under vitest (import.meta.env.DEV) and the branded
  // backend origin in the production bundle, so only the path is a stable
  // contract.
  // The name is asserted exactly: the official Google G is aria-hidden, so the
  // accessible name must be precisely "Continue with Google" and nothing else.
  it('offers exactly one Google link pointing at the OAuth start route', () => {
    renderLogin();

    const links = screen.getAllByRole('link', { name: 'Continue with Google' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toMatch(/\/api\/auth\/oauth\/google$/);
  });

  it('offers no password, register or password-reset controls', () => {
    renderLogin();

    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create one|register|forgot password/i })).not.toBeInTheDocument();
  });

  it('preserves a safe ?next so the user returns where they were headed', () => {
    renderLogin({}, '?next=%2Fstudent%2Fresults');

    expect(
      screen.getByRole('link', { name: 'Continue with Google' }).getAttribute('href'),
    ).toMatch(/\/api\/auth\/oauth\/google\?next=%2Fstudent%2Fresults$/);
  });

  // Every one of these resolves cross-origin in a browser, or is not a path at
  // all. `/\t/evil.com` is the subtle one: the URL parser strips ASCII tab
  // before resolving, so it is protocol-relative. The validator is a security
  // control, so each rejection branch needs a case.
  it.each([
    ['protocol-relative', '//evil.example.com'],
    ['backslash-normalised', '/%5Cevil.example.com'],
    ['tab-stripped', '/%09/evil.example.com'],
    ['absolute URL', 'https://evil.example.com'],
    ['relative path', 'student/results'],
  ])('drops an unsafe ?next (%s)', (_label, next) => {
    renderLogin({}, `?next=${next}`);

    const href = screen.getByRole('link', { name: 'Continue with Google' }).getAttribute('href');
    expect(href).toMatch(/\/api\/auth\/oauth\/google$/);
    expect(href).not.toContain('evil.example.com');
  });

  it('shows the failure banner for ?oauth=error, and no banner without it', () => {
    renderLogin({}, '?oauth=error');

    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in didn't complete/i);
  });

  it('shows no failure banner on a normal visit', () => {
    renderLogin();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('redirects an already-authenticated user away from the Google link', async () => {
    renderLogin({ user: admin, status: 'authenticated' });

    expect(await screen.findByRole('heading', { name: 'Admin home' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Continue with Google' }),
    ).not.toBeInTheDocument();
  });

  it('sends an already-authenticated user to ?next when one is supplied', async () => {
    renderLogin({ user: student, status: 'authenticated' }, '?next=%2Fstudent%2Fresults');

    expect(await screen.findByRole('heading', { name: 'My results' })).toBeInTheDocument();
  });

  // The already-authenticated branch navigates with <Navigate to={next}>, which
  // bypasses the server entirely, so the client validator is the only guard.
  it('refuses to navigate an authenticated user to a cross-origin ?next', async () => {
    renderLogin({ user: student, status: 'authenticated' }, '?next=%2F%09%2Fevil.example.com');

    expect(await screen.findByRole('heading', { name: 'Student home' })).toBeInTheDocument();
  });
});
