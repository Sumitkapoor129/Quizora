import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/api/client';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import Register from '@/pages/auth/Register';
import type { AuthUser } from '@/types';

const student: AuthUser = { id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' };

const OTP_SENT = { email: 'aria@example.com', otpExpiresAt: '2026-01-01T00:00:00.000Z' };

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    sessionExpiresAt: null,
    status: 'anonymous',
    expired: false,
    login: vi.fn(),
    verifyRegister: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

function renderRegister(overrides: Partial<AuthContextValue> = {}, initialEntry = '/register') {
  const value = authValue(overrides);

  render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<h1>Sign in</h1>} />
          <Route path="/student" element={<h1>Student home</h1>} />
          <Route path="/admin" element={<h1>Admin home</h1>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );

  return value;
}

async function fillStep1(
  user: ReturnType<typeof userEvent.setup>,
  name = 'Aria Sharma',
  email = 'aria@example.com',
  password = 'password123',
) {
  await user.type(screen.getByLabelText('Full name'), name);
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
}

describe('Register', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows validation errors and does not send an OTP when fields are empty', async () => {
    const sendSpy = vi.spyOn(api.auth, 'sendRegisterOtp');
    const { verifyRegister } = renderRegister();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(verifyRegister).not.toHaveBeenCalled();
  });

  it('step 1 sends an OTP and moves to the focused code step', async () => {
    const sendSpy = vi.spyOn(api.auth, 'sendRegisterOtp').mockResolvedValue(OTP_SENT);
    renderRegister();
    const user = userEvent.setup();
    await fillStep1(user);

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(sendSpy).toHaveBeenCalledWith({
      name: 'Aria Sharma',
      email: 'aria@example.com',
      password: 'password123',
    });
    const codeInput = screen.getByLabelText('Verification code');
    expect(codeInput).toHaveValue('');
    expect(codeInput).toHaveFocus();
  });

  it('maps EMAIL_TAKEN onto the email field on step 1', async () => {
    vi.spyOn(api.auth, 'sendRegisterOtp').mockRejectedValue(
      new ApiError(409, { error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' } }),
    );
    renderRegister();
    const user = userEvent.setup();
    await fillStep1(user);

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
  });

  it('requires a full 6-digit code before verifying', async () => {
    vi.spyOn(api.auth, 'sendRegisterOtp').mockResolvedValue(OTP_SENT);
    const { verifyRegister } = renderRegister({ verifyRegister: vi.fn().mockResolvedValue(student) });
    const user = userEvent.setup();
    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const codeInput = await screen.findByLabelText('Verification code');
    await user.type(codeInput, '123');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    expect(screen.getByText('Enter the 6-digit code.')).toBeInTheDocument();
    expect(verifyRegister).not.toHaveBeenCalled();
  });

  it('accepts only digits in the code field', async () => {
    vi.spyOn(api.auth, 'sendRegisterOtp').mockResolvedValue(OTP_SENT);
    renderRegister();
    const user = userEvent.setup();
    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const codeInput = await screen.findByLabelText('Verification code');
    await user.type(codeInput, '12ab34');
    expect(codeInput).toHaveValue('1234');
  });

  it('verifies the code and navigates to the student home', async () => {
    vi.spyOn(api.auth, 'sendRegisterOtp').mockResolvedValue(OTP_SENT);
    const { verifyRegister } = renderRegister({ verifyRegister: vi.fn().mockResolvedValue(student) });
    const user = userEvent.setup();
    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() =>
      expect(verifyRegister).toHaveBeenCalledWith({
        name: 'Aria Sharma',
        email: 'aria@example.com',
        password: 'password123',
        code: '123456',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Student home' })).toBeInTheDocument();
  });

  it('maps OTP errors onto the code field and clears it', async () => {
    vi.spyOn(api.auth, 'sendRegisterOtp').mockResolvedValue(OTP_SENT);
    renderRegister({
      verifyRegister: vi.fn().mockRejectedValue(
        new ApiError(400, { error: { code: 'OTP_EXPIRED', message: 'This code has expired. Request a new one.' } }),
      ),
    });
    const user = userEvent.setup();
    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const codeInput = await screen.findByLabelText('Verification code');
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    expect(await screen.findByText('This code has expired. Request a new one.')).toBeInTheDocument();
    expect(codeInput).toHaveValue('');
  });

  it('resends an OTP with the same details and shows a status message', async () => {
    const sendSpy = vi.spyOn(api.auth, 'sendRegisterOtp').mockResolvedValue(OTP_SENT);
    renderRegister();
    const user = userEvent.setup();
    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByLabelText('Verification code');

    await user.click(screen.getByRole('button', { name: /resend code/i }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2));
    expect(sendSpy).toHaveBeenLastCalledWith({
      name: 'Aria Sharma',
      email: 'aria@example.com',
      password: 'password123',
    });
    const status = await screen.findByText('A new code was sent. Check your email.');
    expect(status).toHaveAttribute('role', 'status');
  });
});