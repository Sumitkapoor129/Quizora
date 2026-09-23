import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/api/client';
import ResetPassword from '@/pages/auth/ResetPassword';

function renderResetPassword() {
  render(
    <MemoryRouter initialEntries={['/reset-password']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/forgot-password" element={<h1>Reset your password</h1>} />
        <Route path="/login" element={<h1>Sign in</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'aria@example.com');
  await user.type(screen.getByLabelText('Verification code'), '123456');
  await user.type(screen.getByLabelText('New password'), 'new-password-456');
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows validation errors and does not call the API on an empty form', async () => {
    const resetSpy = vi.spyOn(api.auth, 'resetPassword');
    renderResetPassword();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Enter the 6-digit code.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('resets the password and navigates to the login page', async () => {
    const resetSpy = vi.spyOn(api.auth, 'resetPassword').mockResolvedValue(undefined);
    renderResetPassword();
    const user = userEvent.setup();
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() =>
      expect(resetSpy).toHaveBeenCalledWith({
        email: 'aria@example.com',
        code: '123456',
        newPassword: 'new-password-456',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('maps an OTP error onto the code field and clears it', async () => {
    vi.spyOn(api.auth, 'resetPassword').mockRejectedValue(
      new ApiError(400, { error: { code: 'OTP_INVALID', message: 'Invalid verification code.' } }),
    );
    renderResetPassword();
    const user = userEvent.setup();
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText('Invalid verification code.')).toBeInTheDocument();
    expect(screen.getByLabelText('Verification code')).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('links back to request a new code', async () => {
    renderResetPassword();
    const user = userEvent.setup();

    await user.click(screen.getByRole('link', { name: /need a new code/i }));

    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });
});