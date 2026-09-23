import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import MyTests from '@/pages/student/MyTests';
import type { StudentAttemptSummary } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      student: {
        ...actual.api.student,
        attempts: vi.fn(),
      },
    },
  };
});

const submitted: StudentAttemptSummary = {
  attemptId: 'a1',
  testId: 't1',
  testTitle: 'Algebra Midterm',
  status: 'SUBMITTED',
  marksEarned: 40,
  totalMarks: 50,
  percent: 80,
  date: '2026-01-01T00:00:00.000Z',
};

const inProgress: StudentAttemptSummary = {
  attemptId: 'a2',
  testId: 't2',
  testTitle: 'Physics Quiz',
  status: 'IN_PROGRESS',
  marksEarned: 0,
  totalMarks: 100,
  percent: 0,
  date: '2026-01-02T00:00:00.000Z',
};

const gated: StudentAttemptSummary = {
  attemptId: 'a3',
  testId: 't3',
  testTitle: 'Biology Basics',
  status: 'GATED',
  marksEarned: 0,
  totalMarks: 80,
  percent: 0,
  date: '2026-01-03T00:00:00.000Z',
};

function renderMyTests() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MyTests />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('My Tests page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders attempts with status badges, scores, percent, date, and result links', async () => {
    vi.mocked(api.student.attempts).mockResolvedValue({ attempts: [submitted, inProgress, gated] });
    renderMyTests();

    expect(await screen.findByRole('heading', { name: 'My Tests' })).toBeInTheDocument();

    // Submitted row: title + score + percent + result link.
    // Waits for the query (headings render before data resolves).
    expect(await screen.findByRole('link', { name: 'Algebra Midterm' })).toHaveAttribute(
      'href',
      '/student/tests/t1/result/a1',
    );
    expect(screen.getByText('40 / 50')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View result' })).toHaveAttribute('href', '/student/tests/t1/result/a1');

    // In-progress: resume link, no score yet.
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/student/tests/t2/attempt/a2');
    expect(screen.getByText('In progress')).toBeInTheDocument();

    // Gated: Continue via the instructions gate, no score.
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/student/tests/t3/instructions');
    expect(screen.getByText('Not started')).toBeInTheDocument();

    // Unscored rows show em dashes, never misleading zeros.
    expect(screen.getAllByText('—')).toHaveLength(4);

    // Date is formatted once per row from the server ISO string.
    expect(screen.getAllByText(/Jan 1, 2026|Jan 2, 2026|Jan 3, 2026/)).toHaveLength(3);
  });

  it('shows an empty state when there are no attempts', async () => {
    vi.mocked(api.student.attempts).mockResolvedValue({ attempts: [] });
    renderMyTests();

    expect(await screen.findByText('No attempts yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('surfaces a query error with a retry that reloads the list', async () => {
    vi.mocked(api.student.attempts).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderMyTests();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    vi.mocked(api.student.attempts).mockResolvedValueOnce({ attempts: [submitted] });
    const user = userEvent.setup();
    await user.click(retry);

    expect(await screen.findByRole('link', { name: 'Algebra Midterm' })).toBeInTheDocument();
  });
});