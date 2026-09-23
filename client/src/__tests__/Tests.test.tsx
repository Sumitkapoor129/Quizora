import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import Tests from '@/pages/student/Tests';
import type { StudentTestListItem } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      student: {
        ...actual.api.student,
        tests: vi.fn(),
      },
    },
  };
});

const fresh: StudentTestListItem = {
  id: 't1',
  title: 'Algebra Midterm',
  sectionCount: 3,
  questionCount: 12,
  totalDurationSec: 2700,
  totalMarks: 100,
  defaultNegativeMarks: 0.25,
  shuffleQuestions: true,
  shuffleOptions: true,
};

const submitted: StudentTestListItem = {
  ...fresh,
  id: 't2',
  title: 'Physics Quiz',
  sectionCount: 1,
  questionCount: 5,
  totalDurationSec: 600,
  totalMarks: 50,
  defaultNegativeMarks: 0,
  attempt: { id: 'a2', status: 'SUBMITTED' },
};

const inProgress: StudentTestListItem = {
  ...fresh,
  id: 't3',
  title: 'Biology Basics',
  sectionCount: 2,
  questionCount: 8,
  totalDurationSec: 900,
  totalMarks: 80,
  defaultNegativeMarks: 0.5,
  attempt: { id: 'a3', status: 'IN_PROGRESS' },
};

function renderTests() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Tests />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Tests page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the available tests grid with per-status CTAs and badges', async () => {
    vi.mocked(api.student.tests).mockResolvedValue({ tests: [fresh, submitted, inProgress] });
    renderTests();

    expect(await screen.findByRole('heading', { name: 'Tests' })).toBeInTheDocument();
    expect(screen.getByText('Take or resume a published test.')).toBeInTheDocument();

    // Waits for the query (headings render before data resolves).
    expect(await screen.findByRole('link', { name: 'Take test' })).toHaveAttribute('href', '/student/tests/t1/instructions');
    expect(screen.getByRole('link', { name: 'View result' })).toHaveAttribute('href', '/student/tests/t2/result/a2');
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/student/tests/t3/attempt/a3');

    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('3 sections')).toBeInTheDocument();
    expect(screen.getByText(/45 min/)).toBeInTheDocument();
    expect(screen.getByText(/100 marks/)).toBeInTheDocument();
  });

  it('shows the empty state when no tests are available', async () => {
    vi.mocked(api.student.tests).mockResolvedValue({ tests: [] });
    renderTests();

    expect(await screen.findByText('No tests available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Take test' })).not.toBeInTheDocument();
  });

  it('shows the all-completed variant when every test has a finished attempt', async () => {
    vi.mocked(api.student.tests).mockResolvedValue({
      tests: [
        { ...submitted },
        { ...submitted, id: 't9', title: 'Chemistry Lab', attempt: { id: 'a9', status: 'TIMED_OUT' } },
      ],
    });
    renderTests();

    expect(await screen.findByText("You've completed everything currently available.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Take test' })).not.toBeInTheDocument();
  });

  it('surfaces a query error with a retry that reloads the list', async () => {
    vi.mocked(api.student.tests).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderTests();

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });
});