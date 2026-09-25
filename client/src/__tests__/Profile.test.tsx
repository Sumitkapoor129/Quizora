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

  it('rejects a blank name client-side without calling the API', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.clear(screen.getByLabelText('Full name'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    expect(api.student.profile.update).not.toHaveBeenCalled();
  });

  // Google-only accounts: there is no local password to change, so the whole
  // password form must be gone rather than merely hidden.
  it('has no password-change section at all', () => {
    renderProfile();

    expect(screen.queryByRole('heading', { name: /change password/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm new password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update password/i })).not.toBeInTheDocument();
  });

  it('maps a name validation error from the server onto the name field', async () => {
    vi.mocked(api.student.profile.update).mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body.',
          details: [{ field: 'name', message: 'Name is too long.' }],
        },
      }),
    );
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Name is too long.')).toBeInTheDocument();
  });
});
