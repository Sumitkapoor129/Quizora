import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import AttemptsList from '@/pages/admin/attempts/AttemptsList';
import type { AdminAttemptListItem } from '@/types';

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
        attempts: {
          list: vi.fn(),
          get: vi.fn(),
        },
      },
    },
  };
});

const attempt1: AdminAttemptListItem = {
  id: 'a1',
  testId: 't1',
  testTitle: 'Algebra Midterm',
  student: { id: 'u1', name: 'Aria Sharma', email: 'aria@example.com' },
  status: 'SUBMITTED',
  score: 8,
  maxScore: 12,
  correctCount: 2,
  totalQuestions: 3,
  warningCount: 2,
  startedAt: null,
  submittedAt: '2026-01-01T00:00:00.000Z',
};

const attempt2: AdminAttemptListItem = {
  id: 'a2',
  testId: 't2',
  testTitle: 'Physics Quiz',
  student: { id: 'u2', name: 'Ben Liu', email: 'ben@example.com' },
  status: 'TIMED_OUT',
  score: 0,
  maxScore: 10,
  correctCount: 0,
  totalQuestions: 5,
  warningCount: 3,
  startedAt: '2026-01-02T00:00:00.000Z',
  submittedAt: '2026-01-02T01:00:00.000Z',
};

const testList = [
  {
    id: 't1',
    title: 'Algebra Midterm',
    status: 'PUBLISHED' as const,
    defaultNegativeMarks: 0,
    sectionCount: 1,
    questionCount: 2,
    totalDurationSec: 600,
    totalMarks: 10,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 't2',
    title: 'Physics Quiz',
    status: 'DRAFT' as const,
    defaultNegativeMarks: 0,
    sectionCount: 1,
    questionCount: 1,
    totalDurationSec: 300,
    totalMarks: 5,
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/admin/attempts']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/admin/attempts" element={<AttemptsList />} />
          <Route path="/admin/attempts/:attemptId" element={<div>ATTEMPT DETAIL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AttemptsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders rows with student, test, status, score, correct count, warnings, and date', async () => {
    vi.mocked(api.admin.attempts.list).mockResolvedValue({ attempts: [attempt1, attempt2] });
    vi.mocked(api.tests.list).mockResolvedValue({ tests: testList });
    renderList();

    expect(await screen.findByRole('link', { name: 'Aria Sharma' })).toHaveAttribute(
      'href',
      '/admin/attempts/a1',
    );
    expect(screen.getByText('aria@example.com')).toBeInTheDocument();
    // Test titles also appear as filter options, so scope table cells.
    const table = screen.getByRole('table', { name: 'Student attempts' });
    expect(within(table).getByText('Algebra Midterm')).toBeInTheDocument();
    expect(screen.getByText('8 / 12')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    // Status column header + the SUBMITTED row badge both read "Submitted".
    expect(screen.getAllByText('Submitted').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Ben Liu' })).toHaveAttribute('href', '/admin/attempts/a2');
    expect(within(table).getByText('Physics Quiz')).toBeInTheDocument();
    expect(within(table).getByText('Timed out')).toBeInTheDocument();
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  it('shows an empty state when there are no attempts', async () => {
    vi.mocked(api.admin.attempts.list).mockResolvedValue({ attempts: [] });
    vi.mocked(api.tests.list).mockResolvedValue({ tests: testList });
    renderList();

    expect(await screen.findByText('No attempts yet.')).toBeInTheDocument();
  });

  it('shows a loading skeleton while loading', async () => {
    vi.mocked(api.admin.attempts.list).mockImplementation(() => new Promise(() => {}));
    renderList();

    expect(screen.getByRole('status', { name: /Loading attempts/ })).toBeInTheDocument();
  });

  it('surfaces a query error with a retry that reloads the list', async () => {
    vi.mocked(api.admin.attempts.list).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderList();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    vi.mocked(api.admin.attempts.list).mockResolvedValueOnce({ attempts: [attempt1] });

    const user = userEvent.setup();
    await user.click(retry);

    expect(await screen.findByRole('link', { name: 'Aria Sharma' })).toBeInTheDocument();
    await waitFor(() => expect(api.admin.attempts.list).toHaveBeenCalledTimes(2));
  });

  it('refetches server-side when the status and test filters change', async () => {
    vi.mocked(api.admin.attempts.list).mockResolvedValue({ attempts: [attempt1] });
    vi.mocked(api.tests.list).mockResolvedValue({ tests: testList });
    renderList();

    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Aria Sharma' });

    await user.selectOptions(await screen.findByLabelText('Status'), 'SUBMITTED');
    await waitFor(() =>
      expect(api.admin.attempts.list).toHaveBeenLastCalledWith({ testId: undefined, status: 'SUBMITTED' }),
    );

    await user.selectOptions(screen.getByLabelText('Test'), 't1');
    await waitFor(() =>
      expect(api.admin.attempts.list).toHaveBeenLastCalledWith({ testId: 't1', status: 'SUBMITTED' }),
    );

    // Clearing both filters returns to the unfiltered query.
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.selectOptions(screen.getByLabelText('Test'), '');
    await waitFor(() =>
      expect(api.admin.attempts.list).toHaveBeenLastCalledWith({ testId: undefined, status: undefined }),
    );

    // Server returns nothing for the selection → filter-aware empty state.
    vi.mocked(api.admin.attempts.list).mockResolvedValueOnce({ attempts: [] });
    await user.selectOptions(screen.getByLabelText('Status'), 'TIMED_OUT');
    expect(await screen.findByText('No attempts match your filters.')).toBeInTheDocument();
  });
});