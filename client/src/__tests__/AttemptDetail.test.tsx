import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import AttemptDetail from '@/pages/admin/attempts/AttemptDetail';
import type { AdminAttemptDetail } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: {
        attempts: {
          list: vi.fn(),
          get: vi.fn(),
        },
      },
    },
  };
});

const detail: AdminAttemptDetail = {
  id: 'a1',
  testId: 't1',
  testTitle: 'Algebra Midterm',
  student: { id: 'u1', name: 'Aria Sharma', email: 'aria@example.com' },
  status: 'SUBMITTED',
  score: 4,
  maxScore: 8,
  correctCount: 1,
  totalQuestions: 2,
  warningCount: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  endAt: '2026-01-01T01:00:00.000Z',
  submittedAt: '2026-01-01T00:45:00.000Z',
  sections: [
    { sectionId: 's1', sectionIndex: 0, title: 'Section A', score: 4, maxScore: 4, correctCount: 1 },
    { sectionId: 's2', sectionIndex: 1, title: 'Section B', score: 0, maxScore: 4, correctCount: 0 },
  ],
  questions: [
    {
      questionId: 'q1',
      questionIndex: 0,
      sectionIndex: 0,
      type: 'SINGLE',
      text: 'What is 2+2?',
      explanation: 'Because four is the sum.',
      marks: 4,
      negativeMarks: 1,
      options: [
        { optionId: 'o1', text: '4', isCorrect: true, selected: true },
        { optionId: 'o2', text: '5', isCorrect: false, selected: false },
      ],
      selectedOptionIds: ['o1'],
      isCorrect: true,
      marksAwarded: 4,
      isAttempted: true,
    },
    {
      questionId: 'q2',
      questionIndex: 1,
      sectionIndex: 1,
      type: 'MULTI',
      text: 'Who is a Greek mathematician?',
      imageUrl: '/uploads/quiz.png',
      marks: 4,
      negativeMarks: 1,
      options: [
        { optionId: 'o3', text: 'Pythagoras', isCorrect: true, selected: false },
        { optionId: 'o4', text: 'Euler', isCorrect: false, selected: true },
      ],
      selectedOptionIds: ['o4'],
      isCorrect: false,
      marksAwarded: -1,
      isAttempted: true,
    },
  ],
  events: [
    { type: 'START', createdAt: '2026-01-01T00:00:00.000Z' },
    { type: 'COPY', createdAt: '2026-01-01T00:10:00.000Z' },
    { type: 'SUBMIT', createdAt: '2026-01-01T00:45:00.000Z' },
  ],
};

function renderDetail() {
  vi.mocked(api.admin.attempts.get).mockResolvedValue({ attempt: detail });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/admin/attempts/a1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/admin/attempts" element={<div>ATTEMPTS LIST</div>} />
          <Route path="/admin/attempts/:attemptId" element={<AttemptDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AttemptDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the header, metadata, and section breakdown', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Aria Sharma' })).toBeInTheDocument();
    expect(screen.getByText(/aria@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Algebra Midterm/)).toBeInTheDocument();
    // Status badge; "Submitted" also appears as a SUBMIT event label below.
    expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
    expect(screen.getByText('4 / 8')).toBeInTheDocument();
    expect(screen.getByText('1 / 2 correct')).toBeInTheDocument();
    expect(screen.getByText('1 violation')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Section A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Section B' })).toBeInTheDocument();
    // Per-question awarded marks
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('shows the answer key: correct options labeled, student selection marked, wrong selection visible', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Aria Sharma' });

    // Both correct options carry the answer-key marker.
    expect(screen.getAllByText('Correct answer')).toHaveLength(2);

    // The selected-correct option also gets a "Your answer" marker.
    expect(screen.getByText('Your answer')).toBeInTheDocument();

    // The wrong selection is visibly marked as such (text, not color alone).
    const wrong = screen.getByText('Your answer (wrong)');
    expect(wrong).toBeInTheDocument();
    expect(wrong.closest('.badge')).toHaveClass('badge--danger');
    // It sits on the same option row as the wrongly selected text.
    expect(wrong.closest('li')).toHaveTextContent('Euler');
  });

  it('renders explanations for admin review', async () => {
    renderDetail();

    expect(await screen.findByText(/Because four is the sum/)).toBeInTheDocument();
  });

  it('renders a question image when imageUrl is present', async () => {
    const { container } = renderDetail();

    await screen.findByRole('heading', { name: 'Aria Sharma' });
    // Question images are presentational (alt="") when the question has text.
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', expect.stringContaining('/uploads/quiz.png'));
  });

  it('groups anti-cheat events into violations and informational activity', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Anti-cheat events' });

    expect(screen.getByRole('heading', { name: 'Violations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();

    // Human-readable event labels (the meta strip also shows "Started"/"Submitted").
    expect(screen.getByText('Copied text')).toBeInTheDocument();
    expect(screen.getAllByText('Started').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
  });

  it('provides a back link to the attempts list', async () => {
    const user = userEvent.setup();
    renderDetail();

    const back = await screen.findByRole('link', { name: 'Back to attempts' });
    expect(back).toHaveAttribute('href', '/admin/attempts');

    await user.click(back);
    expect(await screen.findByText('ATTEMPTS LIST')).toBeInTheDocument();
  });

  it('shows a loading skeleton while loading', async () => {
    vi.mocked(api.admin.attempts.get).mockImplementation(() => new Promise(() => {}));
    renderDetail();

    expect(screen.getByRole('status', { name: /Loading attempt/ })).toBeInTheDocument();
  });

  it('surfaces a query error with a retry that reloads the detail', async () => {
    vi.mocked(api.admin.attempts.get).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderDetail();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    vi.mocked(api.admin.attempts.get).mockResolvedValueOnce({ attempt: detail });

    const user = userEvent.setup();
    await user.click(retry);

    expect(await screen.findByRole('heading', { name: 'Aria Sharma' })).toBeInTheDocument();
    await waitFor(() => expect(api.admin.attempts.get).toHaveBeenCalledTimes(2));
  });
});