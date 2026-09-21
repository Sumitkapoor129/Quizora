import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SessionExpiryBanner } from '@/components/layout/SessionExpiryBanner';

function renderBannerAt(path: string) {
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="*" element={<SessionExpiryBanner />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function LoginProbe() {
  const location = useLocation();
  return (
    <>
      <h1>Sign in</h1>
      <p data-testid="next">{location.search}</p>
    </>
  );
}

describe('SessionExpiryBanner', () => {
  it('renders the exact spec copy', () => {
    renderBannerAt('/student/results');
    const banner = screen.getByRole('alert');

    expect(banner).toHaveTextContent('Your session has expired.');
    expect(banner).toHaveTextContent(
      "Sign in again to continue. You won't lose your place — we'll bring you back to where you were.",
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('navigates to /login with the current path (and query) in ?next=', async () => {
    const user = userEvent.setup();
    renderBannerAt('/student/results?tab=1');

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByTestId('next')).toHaveTextContent('?next=%2Fstudent%2Fresults%3Ftab%3D1');
  });
});