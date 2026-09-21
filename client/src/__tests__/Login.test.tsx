import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

function renderLogin(overrides: Partial<AuthContextValue> = {}, initialEntry = '/login') {
  const value = authValue(overrides);

  render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<h1>Create your account</h1>} />
          <Route path="/student" element={<h1>Student home</h1>} />
          <Route path="/student/results" element={<h1>My results</h1>} />
          <Route path="/admin" element={<h1>Admin home</h1>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );

  return value;
}

describe('Login', () => {
  it('shows validation errors and does not sign in when fields are empty', async () => {
    const { login } = renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in with credentials and navigates to the role home', async () => {
    const { login } = renderLogin({ login: vi.fn().mockResolvedValue(student) });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'aria@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({ email: 'aria@example.com', password: 'password123' }),
    );
    expect(await screen.findByRole('heading', { name: 'Student home' })).toBeInTheDocument();
  });

  it('redirects an already-authenticated admin away from the login form', async () => {
    renderLogin({ user: admin, status: 'authenticated' });

    expect(await screen.findByRole('heading', { name: 'Admin home' })).toBeInTheDocument();
  });

  it('returns to the ?next= path after signing in (session re-login)', async () => {
    renderLogin(
      { login: vi.fn().mockResolvedValue(student) },
      '/login?next=%2Fstudent%2Fresults',
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'aria@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'My results' })).toBeInTheDocument();
  });
});