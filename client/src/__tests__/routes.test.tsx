import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { routes } from '@/routes';
import type { User } from '@/types';

function RoutesFromConfig() {
  return useRoutes(routes);
}

function renderRouter(path: string, user: User | null) {
  const value: AuthContextValue = {
    user,
    sessionExpiresAt: null,
    status: user ? 'authenticated' : 'anonymous',
    expired: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={value}>
        <RoutesFromConfig />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('route guards', () => {
  it('shows a wrong-role student the access-denied page, not admin content', async () => {
    renderRouter('/admin', {
      id: '1',
      email: 'aria@example.com',
      name: 'Aria Sharma',
      role: 'student',
    });

    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('lets a wrong-role user return to their role home from the access-denied page', async () => {
    const user = userEvent.setup();
    renderRouter('/admin', {
      id: '1',
      email: 'aria@example.com',
      name: 'Aria Sharma',
      role: 'student',
    });

    await user.click(await screen.findByRole('link', { name: 'Back to your home' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Aria' })).toBeInTheDocument();
  });

  it('lets an admin into /admin', async () => {
    renderRouter('/admin', {
      id: '2',
      email: 'alex@example.com',
      name: 'Alex Morgan',
      role: 'admin',
    });

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Published tests')).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor to /login', async () => {
    renderRouter('/student', null);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});