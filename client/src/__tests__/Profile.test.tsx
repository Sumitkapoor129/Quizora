import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import Profile from '@/pages/student/Profile';
import type { SessionResponse } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      student: {
        ...actual.api.student,
        profile: {
          update: vi.fn(),
        },
      },
    },
  };
});

const session: SessionResponse = {
  user: { id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' },
  sessionExpiresAt: '2026-02-01T00:00:00.000Z',
};

const authValue: AuthContextValue = {
  user: session.user,
  sessionExpiresAt: session.sessionExpiresAt,
  status: 'authenticated',
  expired: false,
  login: vi.fn(),
  verifyRegister: vi.fn(),
  logout: vi.fn(),
};

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Profile />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('Profile page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the name and shows an inline success message', async () => {
    vi.mocked(api.student.profile.update).mockResolvedValue(session);
    const user = userEvent.setup();
    renderProfile();

    const nameInput = screen.getByLabelText('Full name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Aisha Verma');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
    expect(api.student.profile.update).toHaveBeenCalledWith({ name: 'Aisha Verma' });
  });

  it('rejects mismatched passwords client-side without calling the API', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText('Current password'), 'oldpass123');
    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'different123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(api.student.profile.update).not.toHaveBeenCalled();
  });

  it('maps the wrong-current-password server error onto the current password field', async () => {
    vi.mocked(api.student.profile.update).mockRejectedValue(
      new ApiError(400, { error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' } }),
    );
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText('Current password'), 'wrongpass');
    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });

  it('clears the password fields and shows success after a valid password change', async () => {
    vi.mocked(api.student.profile.update).mockResolvedValue(session);
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText('Current password'), 'oldpass123');
    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Password updated.')).toBeInTheDocument();
    expect(api.student.profile.update).toHaveBeenCalledWith({
      currentPassword: 'oldpass123',
      newPassword: 'newpass123',
    });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });
});