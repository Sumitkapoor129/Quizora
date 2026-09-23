import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import AppLayout from '@/components/layout/AppLayout';
import type { User } from '@/types';

function renderLayout(user: User) {
  const value: AuthContextValue = {
    user,
    sessionExpiresAt: null,
    status: 'authenticated',
    expired: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={[user.role === 'admin' ? '/admin' : '/student']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={value}>
        <AppLayout />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  it('gives students the sidebar navigation with a student-labeled drawer', async () => {
    renderLayout({ id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' });

    const aside = screen.getByRole('complementary', { name: 'Student navigation' });
    expect(aside).toHaveAttribute('id', 'student-nav');
    expect(screen.getByRole('navigation', { name: 'Student navigation' })).toBeInTheDocument();

    const links = withinNav(screen.getByRole('navigation', { name: 'Student navigation' }));
    expect(links('Dashboard')).toHaveAttribute('href', '/student');
    expect(links('Profile')).toHaveAttribute('href', '/student/profile');
    expect(links('My Tests')).toHaveAttribute('href', '/student/results');
    expect(links('Tests')).toHaveAttribute('href', '/student/tests');
    expect(links('Resources')).toHaveAttribute('href', '/student/resources');

    expect(screen.getByRole('button', { name: 'Toggle navigation menu' })).toHaveAttribute(
      'aria-controls',
      'student-nav',
    );
  });

  it('opens the drawer from the hamburger, and Escape closes it and restores focus', async () => {
    const user = userEvent.setup();
    renderLayout({ id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' });

    const hamburger = screen.getByRole('button', { name: 'Toggle navigation menu' });
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    await user.click(hamburger);
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Student navigation' })).toHaveClass('sidebar--open');

    await user.keyboard('{Escape}');
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('complementary', { name: 'Student navigation' })).not.toHaveClass('sidebar--open');
    expect(hamburger).toHaveFocus();
  });

  it('closes the drawer after navigating to a new page (no focus restore)', async () => {
    const user = userEvent.setup();
    renderLayout({ id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' });

    const hamburger = screen.getByRole('button', { name: 'Toggle navigation menu' });
    await user.click(hamburger);
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    // Profile is a different route, so navigation closes the drawer.
    await user.click(screen.getByRole('navigation', { name: 'Student navigation' }).querySelector('a[href="/student/profile"]')!);
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the admin sidebar with its own drawer id and Resources nav item', () => {
    renderLayout({ id: '2', email: 'alex@example.com', name: 'Alex Morgan', role: 'admin' });

    const aside = screen.getByRole('complementary', { name: 'Admin navigation' });
    expect(aside).toHaveAttribute('id', 'admin-nav');
    expect(screen.getByRole('button', { name: 'Toggle navigation menu' })).toHaveAttribute('aria-controls', 'admin-nav');

    const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
    const resources = withinNav(nav)('Resources');
    expect(resources).toHaveAttribute('href', '/admin/resources');
    // Students no longer get a header nav-row, both roles use the sidebar nav.
    expect(nav).toHaveClass('sidebar__nav');
  });
});

function withinNav(nav: HTMLElement) {
  return (label: string): HTMLElement => {
    const anchor = Array.from(nav.querySelectorAll('a')).find((a) => a.textContent === label);
    if (!anchor) throw new Error(`Missing nav link ${label}`);
    return anchor as HTMLElement;
  };
}