import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import Result from '@/pages/student/Result';
import type { AttemptResultData } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      student: {
        tests: vi.fn(),
        createAttempt: vi.fn(),
        startAttempt: vi.fn(),
        attempt: vi.fn(),
        saveAnswers: vi.fn(),
        postEvent: vi.fn(),
        submit: vi.fn(),
        result: vi.fn(),
      },
    },
  };
});

const result: AttemptResultData = {
  id: 'a1',
  testId: 't1',
  testTitle: 'Algebra Midterm',
  status: 'SUBMITTED',
  score: 7,
  maxScore: 12,
  correctCount: 2,
  totalQuestions: 3,
  submittedAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:00.000Z',
  sections: [
    { sectionId: 's1', sectionIndex: 0, title: 'Section A', score: 4, maxScore: 8, correctCount: 1 },
    { sectionId: 's2', sectionIndex: 1, title: 'Section B', score: 3, maxScore: 4, correctCount: 1 },
  ],
  questions: [
    { questionId: 'q1', questionIndex: 0, isCorrect: true, marksAwarded: 4, isAttempted: true, selectedOptionIds: ['o1'] },
    { questionId: 'q2', questionIndex: 1, isCorrect: false, marksAwarded: -1, isAttempted: true, selectedOptionIds: ['o3'] },
    { questionId: 'q3', questionIndex: 2, isCorrect: false, marksAwarded: 0, isAttempted: false, selectedOptionIds: [] },
  ],
};

function renderResult(overrides: Partial<AttemptResultData> = {}) {
  vi.mocked(api.student.result).mockResolvedValue({ attempt: { ...result, ...overrides } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/student/tests/t1/result/a1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/student/tests/:testId/result/:attemptId" element={<Result />} />
          <Route path="/student" element={<div>STUDENT HOME</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Student Result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the score header, section breakdown, and per-question review', async () => {
    renderResult();

    expect(await screen.findByRole('heading', { name: 'Algebra Midterm' })).toBeInTheDocument();

    // Score summary
    expect(screen.getByText('7 / 12')).toBeInTheDocument();
    expect(screen.getByText('2 / 3 correct')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument();

    // Section breakdown
    expect(screen.getByRole('heading', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByText('Section A')).toBeInTheDocument();
    expect(screen.getByText('Section B')).toBeInTheDocument();

    // Question review: indicator badges + awarded marks (negative for wrong)
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument();
    const questionsTable = screen.getByRole('table', { name: 'Question by question result' });
    expect(within(questionsTable).getByText('Question 1')).toBeInTheDocument();
    expect(within(questionsTable).getByText('Question 2')).toBeInTheDocument();
    expect(within(questionsTable).getByText('Question 3')).toBeInTheDocument();
    expect(within(questionsTable).getByText('Correct')).toBeInTheDocument();
    expect(within(questionsTable).getByText('Incorrect')).toBeInTheDocument();
    expect(within(questionsTable).getByText('Not attempted')).toBeInTheDocument();
    expect(within(questionsTable).getByText('+4')).toBeInTheDocument();
    expect(within(questionsTable).getByText('-1')).toBeInTheDocument();
    expect(within(questionsTable).getByText('0')).toBeInTheDocument();
  });

  it('never shows the answer key: no option text, no correct-answer markers, no explanation', async () => {
    renderResult();

    await screen.findByRole('heading', { name: 'Algebra Midterm' });

    // The disclosed copy is fine; an actual answer-key marker is not.
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    expect(screen.queryByText(/explanation/i)).not.toBeInTheDocument();
    // Option ids / texts from the payload must never be rendered either.
    expect(screen.queryByText('o1')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton while the result loads', async () => {
    vi.mocked(api.student.result).mockImplementation(() => new Promise(() => {}));
    renderResult();

    expect(screen.getByRole('status', { name: /Loading your result/ })).toBeInTheDocument();
  });

  it('surfaces a query error with a retry that reloads the result', async () => {
    vi.mocked(api.student.result).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderResult();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    vi.mocked(api.student.result).mockResolvedValueOnce({ attempt: result });

    const user = userEvent.setup();
    await user.click(retry);

    expect(await screen.findByRole('heading', { name: 'Algebra Midterm' })).toBeInTheDocument();
    await waitFor(() => expect(api.student.result).toHaveBeenCalledTimes(2));
  });
});