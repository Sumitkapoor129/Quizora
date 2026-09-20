import { render, screen } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { routes } from '@/routes';
import type { User } from '@/types';

function RoutesFromConfig() {
  return useRoutes(routes);
}

function renderRouter(path: string, user: User | null) {
  const value: AuthContextValue = { user, login: vi.fn(), logout: vi.fn() };
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
  it('redirects a student away from /admin to the student dashboard', async () => {
    renderRouter('/admin', {
      id: '1',
      email: 'aria@example.com',
      name: 'Aria Sharma',
      role: 'student',
    });

    expect(await screen.findByRole('heading', { name: 'Welcome, Aria' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Available tests' })).toBeInTheDocument();
  });

  it('lets an admin into /admin', async () => {
    renderRouter('/admin', {
      id: '2',
      email: 'alex@example.com',
      name: 'Alex Morgan',
      role: 'admin',
    });

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Active tests')).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor to /login', async () => {
    renderRouter('/student', null);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});