import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    verifyRegister: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthContext.Provider value={value}>
          <RoutesFromConfig />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
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
    // API calls are unmocked here, so the dashboard surfaces the fetch failure
    // instead of rendering misleading zero stats.
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor to /login', async () => {
    renderRouter('/student', null);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('student portal routes', () => {
  const student = { id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' as const };

  it('renders the Tests list at /student/tests, not the exam guard or NotFound', async () => {
    renderRouter('/student/tests', student);

    expect(await screen.findByRole('heading', { name: 'Tests' })).toBeInTheDocument();
    expect(screen.getByText('Take or resume a published test.')).toBeInTheDocument();
    // API calls are unmocked: the page surface still renders its error state.
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('renders the My Tests page at /student/results', async () => {
    renderRouter('/student/results', student);

    expect(await screen.findByRole('heading', { name: 'My Tests' })).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('renders the Profile page at /student/profile', async () => {
    renderRouter('/student/profile', student);

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveValue('Aria Sharma');
  });

  it('renders the student resources page at /student/resources', async () => {
    renderRouter('/student/resources', student);

    expect(await screen.findByRole('heading', { name: 'Resources' })).toBeInTheDocument();
    expect(screen.getByText('Study material shared by your instructors.')).toBeInTheDocument();
  });
});

describe('admin resource routes', () => {
  it('renders the resource management page at /admin/resources', async () => {
    renderRouter('/admin/resources', {
      id: '2',
      email: 'alex@example.com',
      name: 'Alex Morgan',
      role: 'admin',
    });

    expect(
      await screen.findByRole('heading', { name: 'Resources' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Share study material with students — PDFs, archives, images, or links.')).toBeInTheDocument();
  });
});