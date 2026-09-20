import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import Login from '@/pages/auth/Login';

function renderLogin() {
  const login = vi.fn();
  const value: AuthContextValue = { user: null, login, logout: vi.fn() };

  render(
    <MemoryRouter
      initialEntries={['/login']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/student" element={<h1>Student home</h1>} />
          <Route path="/admin" element={<h1>Admin home</h1>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );

  return { login };
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

  it('signs in with valid input and navigates to the student dashboard', async () => {
    const { login } = renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'aria@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('student'));
    expect(await screen.findByRole('heading', { name: 'Student home' })).toBeInTheDocument();
  });
});