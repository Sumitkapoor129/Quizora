import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/api/client';
import ForgotPassword from '@/pages/auth/ForgotPassword';

function renderForgotPassword() {
  render(
    <MemoryRouter initialEntries={['/forgot-password']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<h1>Set a new password</h1>} />
        <Route path="/login" element={<h1>Sign in</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requires an email before submitting', async () => {
    const forgotSpy = vi.spyOn(api.auth, 'forgotPassword');
    renderForgotPassword();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /send code/i }));

    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(forgotSpy).not.toHaveBeenCalled();
  });

  it('shows the no-enumeration success message and links to reset-password', async () => {
    const forgotSpy = vi
      .spyOn(api.auth, 'forgotPassword')
      .mockResolvedValue({ email: 'aria@example.com', otpExpiresAt: '2026-01-01T00:00:00.000Z' });
    renderForgotPassword();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'aria@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    expect(forgotSpy).toHaveBeenCalledWith({ email: 'aria@example.com' });
    const status = await screen.findByText(/If an account exists for that email/i);
    expect(status).toHaveAttribute('role', 'status');
    await user.click(screen.getByRole('link', { name: /enter the code/i }));
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
  });

  it('surfaces an API failure as an error', async () => {
    vi.spyOn(api.auth, 'forgotPassword').mockRejectedValue(
      new ApiError(503, { error: { code: 'MAIL_NOT_CONFIGURED', message: 'Email service is not configured.' } }),
    );
    renderForgotPassword();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'aria@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    expect(await screen.findByText('Email service is not configured.')).toBeInTheDocument();
  });
});