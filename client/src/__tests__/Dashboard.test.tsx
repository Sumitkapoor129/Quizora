import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import AdminDashboard from '@/pages/admin/Dashboard';
import type { AdminAnalytics, AdminAttemptListItem } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      tests: {
        ...actual.api.tests,
        list: vi.fn(),
      },
      admin: {
        ...actual.api.admin,
        attempts: {
          list: vi.fn(),
          get: vi.fn(),
        },
        analytics: vi.fn(),
      },
    },
  };
});

const analytics: AdminAnalytics = {
  testId: null,
  summary: {
    scoredAttempts: 5,
    attemptsToday: 2,
    avgScorePercent: 60,
    highestScorePercent: 90,
    lowestScorePercent: 10,
    avgCorrectPercent: 55,
    totalWarnings: 0,
  },
  distribution: Array.from({ length: 10 }, (_, i) => ({ bucket: i * 10, count: 0 })),
  perQuestion: [],
  violations: { byType: {}, attemptsWithViolations: 0, totalWarnings: 0 },
};

const submitted: AdminAttemptListItem = {
  id: 'a1',
  testId: 't1',
  testTitle: 'Algebra Midterm',
  student: { id: 'u1', name: 'Aria Sharma', email: 'aria@example.com' },
  status: 'SUBMITTED',
  score: 8,
  maxScore: 12,
  correctCount: 2,
  totalQuestions: 3,
  warningCount: 0,
  startedAt: null,
  submittedAt: '2026-01-01T00:00:00.000Z',
};

const gated: AdminAttemptListItem = {
  id: 'a0',
  testId: 't1',
  testTitle: 'Algebra Midterm',
  student: { id: 'u0', name: 'Gated Student', email: 'gated@example.com' },
  status: 'GATED',
  score: 0,
  maxScore: 12,
  correctCount: 0,
  totalQuestions: 3,
  warningCount: 0,
  startedAt: null,
  submittedAt: null,
};

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeletons while any query is pending (no misleading zeros)', async () => {
    vi.mocked(api.tests.list).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.admin.analytics).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.admin.attempts.list).mockImplementation(() => new Promise(() => {}));
    renderDashboard();

    expect(screen.getByRole('status', { name: 'Loading dashboard' })).toBeInTheDocument();
    expect(document.querySelectorAll('.skeleton-row')).toHaveLength(3);
    expect(screen.queryByText('Attempts today')).not.toBeInTheDocument();
    expect(screen.queryByText('Create your first test')).not.toBeInTheDocument();
  });

  it('shows an error state with retry when attempts fail, without the empty state', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [] });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    vi.mocked(api.admin.attempts.list).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderDashboard();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText('No students have attempted tests yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Create your first test')).not.toBeInTheDocument();

    vi.mocked(api.admin.attempts.list).mockResolvedValueOnce({ attempts: [submitted] });
    const user = userEvent.setup();
    await user.click(retry);

    expect(await screen.findByRole('link', { name: 'Aria Sharma' })).toBeInTheDocument();
    await waitFor(() => expect(api.admin.attempts.list).toHaveBeenCalledTimes(2));
  });

  it('shows an error state when analytics fails (no misleading attempt-count zeros)', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [] });
    vi.mocked(api.admin.analytics).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    vi.mocked(api.admin.attempts.list).mockResolvedValue({ attempts: [] });
    renderDashboard();

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Attempts today')).not.toBeInTheDocument();
    expect(screen.queryByText('No students have attempted tests yet.')).not.toBeInTheDocument();
  });

  it('shows an em dash and note for published tests when only the tests query fails', async () => {
    vi.mocked(api.tests.list).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    vi.mocked(api.admin.attempts.list).mockResolvedValue({ attempts: [submitted] });
    renderDashboard();

    expect(await screen.findByText('Test list unavailable')).toBeInTheDocument();
    // Published-test count is unknown, not zero.
    const published = screen.getByText('Published tests').parentElement!;
    expect(withinValue(published)).toBe('—');
    // The rest of the dashboard still loads.
    expect(screen.getByRole('link', { name: 'Aria Sharma' })).toBeInTheDocument();
  });

  it('excludes GATED attempts from the recent-attempts rows', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [] });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    vi.mocked(api.admin.attempts.list).mockResolvedValue({ attempts: [gated, submitted] });
    renderDashboard();

    expect(await screen.findByRole('link', { name: 'Aria Sharma' })).toBeInTheDocument();
    expect(screen.queryByText('Gated Student')).not.toBeInTheDocument();
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();
  });

  it('shows exactly one empty state when there are zero attempts (no separate recent section)', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [] });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    vi.mocked(api.admin.attempts.list).mockResolvedValue({ attempts: [] });
    renderDashboard();

    expect(await screen.findByText('No students have attempted tests yet.')).toBeInTheDocument();
    expect(screen.getByText('Create your first test')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent attempts' })).not.toBeInTheDocument();
    expect(screen.queryByText('No recent attempts.')).not.toBeInTheDocument();
  });
});

function withinValue(statCard: HTMLElement): string | null {
  return statCard.querySelector('.stat-card__value')?.textContent ?? null;
}