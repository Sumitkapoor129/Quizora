import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import ExamRunner from '@/pages/student/ExamRunner';
import type {
  AttemptResultResponse,
  PostEventResponse,
  SaveAnswersBody,
  SaveAnswersResponse,
  StudentAttempt,
  StudentQuestion,
  StudentSection,
} from '@/types';

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

function option(id: string, text: string) {
  return { optionId: id, text };
}

const question1: StudentQuestion = {
  questionId: 'q1',
  questionIndex: 0,
  type: 'SINGLE',
  text: 'What is 2+2?',
  marks: 4,
  negativeMarks: 1,
  options: [option('o1', '4'), option('o2', '5'), option('o3', '6')],
};

const question2: StudentQuestion = {
  questionId: 'q2',
  questionIndex: 1,
  type: 'MULTI',
  text: 'Who was a Greek mathematician?',
  marks: 4,
  negativeMarks: 1,
  options: [option('o4', 'Pythagoras'), option('o5', 'Euler'), option('o6', 'Newton')],
};

const question3: StudentQuestion = {
  questionId: 'q3',
  questionIndex: 2,
  type: 'SINGLE',
  text: 'What is the capital of France?',
  marks: 4,
  negativeMarks: 1,
  options: [option('o7', 'Paris'), option('o8', 'London')],
};

function buildAttempt(overrides: Partial<StudentAttempt> = {}): StudentAttempt {
  const sections: StudentSection[] = [
    {
      sectionId: 's1',
      sectionIndex: 0,
      title: 'Section A',
      durationSec: 600,
      negativeMarks: 1,
      questions: [question1, question2],
    },
    {
      sectionId: 's2',
      sectionIndex: 1,
      title: 'Section B',
      durationSec: 600,
      negativeMarks: 1,
      questions: [question3],
    },
  ];
  return {
    id: 'a1',
    testId: 't1',
    testTitle: 'Algebra Midterm',
    status: 'IN_PROGRESS',
    startedAt: '2026-01-01T00:00:00.000Z',
    endAt: new Date(Date.now() + 3_600_000).toISOString(),
    currentQuestionIndex: 0,
    warningCount: 0,
    maxScore: 12,
    totalQuestions: 3,
    sections,
    answers: [{ questionId: 'q2', selectedOptionIds: ['o5'], isAttempted: true, isMarked: false }],
    events: [],
    ...overrides,
  };
}

function saveOk(endAt?: string): SaveAnswersResponse {
  return {
    savedAt: new Date().toISOString(),
    status: 'IN_PROGRESS',
    endAt: endAt ?? new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function renderExam(attempt: StudentAttempt = buildAttempt()) {
  vi.mocked(api.student.attempt).mockResolvedValue({ attempt });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/student/tests/t1/attempt/a1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/student/tests/:testId/attempt/:attemptId" element={<ExamRunner />} />
          <Route path="/student/tests/:testId/instructions" element={<h1>Instructions</h1>} />
          <Route path="/student/tests/:testId/result/:attemptId" element={<div>RESULT PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExamRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.student.saveAnswers).mockResolvedValue(saveOk());
    vi.mocked(api.student.submit).mockResolvedValue(undefined as unknown as AttemptResultResponse);
    vi.mocked(api.student.postEvent).mockResolvedValue({ status: 'IN_PROGRESS', warningCount: 0, submitted: false });
  });

  function postEventResult(warningCount: number, submitted = false): PostEventResponse {
    return {
      status: submitted ? 'SUBMITTED' : 'IN_PROGRESS',
      warningCount,
      submitted,
    };
  }

  it('renders the current question and stores SINGLE/MULTI selections', async () => {
    const user = userEvent.setup();
    renderExam();

    expect(await screen.findByText('What is 2+2?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '4' })).not.toBeChecked();

    await user.click(screen.getByRole('radio', { name: '4' }));
    expect(screen.getByRole('radio', { name: '4' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '5' }));
    expect(screen.getByRole('radio', { name: '5' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '4' })).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Who was a Greek mathematician?')).toBeInTheDocument();
    // Seeded answer for q2 comes back checked.
    expect(screen.getByRole('checkbox', { name: 'Euler' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Pythagoras' }));
    await user.click(screen.getByRole('checkbox', { name: 'Newton' }));
    expect(screen.getByRole('checkbox', { name: 'Pythagoras' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Euler' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Newton' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Newton' }));
    expect(screen.getByRole('checkbox', { name: 'Newton' })).not.toBeChecked();
  });

  it('shows answer state in the palette and navigates between all questions', async () => {
    const user = userEvent.setup();
    renderExam();

    await screen.findByText('What is 2+2?');
    expect(screen.getByRole('button', { name: /^Question 1, current$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Question 2, answered$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Question 3$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByText(/Section 1 of 2: Section A/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '4' }));
    expect(screen.getByRole('button', { name: /^Question 1, answered, current$/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Question 3$/ }));
    expect(await screen.findByText('What is the capital of France?')).toBeInTheDocument();
    expect(screen.getByText(/Section 2 of 2: Section B/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Who was a Greek mathematician?')).toBeInTheDocument();
    expect(screen.getByText(/Section 1 of 2: Section A/)).toBeInTheDocument();
  });

  it('autosaves after a debounce with the current index and all answers', async () => {
    const user = userEvent.setup();
    renderExam();

    await screen.findByText('What is 2+2?');
    await user.click(screen.getByRole('radio', { name: '5' }));
    expect(api.student.saveAnswers).not.toHaveBeenCalled();

    await waitFor(() => expect(api.student.saveAnswers).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(api.student.saveAnswers).toHaveBeenCalledWith('a1', {
      currentQuestionIndex: 0,
      answers: [
        { questionId: 'q1', selectedOptionIds: ['o2'], isMarked: false },
        { questionId: 'q2', selectedOptionIds: ['o5'], isMarked: false },
        { questionId: 'q3', selectedOptionIds: [], isMarked: false },
      ],
    });
  });

  it('shows an offline banner on network failure and clears it after a successful retry', async () => {
    vi.mocked(api.student.saveAnswers)
      .mockReset()
      .mockRejectedValueOnce(
        new ApiError(0, {
          error: { code: 'NETWORK_ERROR', message: 'Unable to reach the server. Please try again.' },
        }),
      )
      .mockResolvedValueOnce(saveOk());
    const user = userEvent.setup();
    renderExam();

    await screen.findByText('What is 2+2?');
    await user.click(screen.getByRole('radio', { name: '4' }));

    expect(await screen.findByText(/Connection lost/, undefined, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Connection lost/)).not.toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(api.student.saveAnswers).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('confirms submission in a modal: cancel stays, confirm submits and navigates', async () => {
    const user = userEvent.setup();
    renderExam();
    await screen.findByText('What is 2+2?');

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('heading', { name: 'Submit exam?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Submit exam?' })).not.toBeInTheDocument();
    expect(api.student.submit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(await screen.findByRole('button', { name: /^Submit exam$/ }));
    await waitFor(() => expect(api.student.submit).toHaveBeenCalledWith('a1'));
    expect(await screen.findByText('RESULT PAGE')).toBeInTheDocument();
  });

  it('auto-submits once when time expires and navigates to the result', async () => {
    renderExam(buildAttempt({ endAt: '2020-01-01T00:00:00.000Z' }));

    await waitFor(() => expect(api.student.submit).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(api.student.submit).toHaveBeenCalledWith('a1');
    expect(await screen.findByText('RESULT PAGE')).toBeInTheDocument();

    // A later tick (past the 1s countdown interval) must not fire a second submit.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(api.student.submit).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending answer before submitting so nothing is lost on the wire', async () => {
    const user = userEvent.setup();
    const saved: SaveAnswersBody[] = [];
    vi.mocked(api.student.saveAnswers).mockImplementation(async (_id, body) => {
      saved.push(body);
      return saveOk();
    });
    renderExam();

    await screen.findByText('What is 2+2?');
    await user.click(screen.getByRole('radio', { name: '5' }));

    // Submit immediately, well inside the autosave debounce so the answer is
    // still only local. The submit path must flush it before handing off.
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(await screen.findByRole('button', { name: /^Submit exam$/ }));

    await waitFor(() => {
      expect(saved.length).toBeGreaterThanOrEqual(1);
      expect(api.student.submit).toHaveBeenCalledWith('a1');
    });

    // The most recent flush must contain the newly selected option.
    expect(saved[saved.length - 1].answers.find((a) => a.questionId === 'q1')).toMatchObject({
      selectedOptionIds: ['o2'],
    });
    expect(await screen.findByText('RESULT PAGE')).toBeInTheDocument();
  });

  it('aborts submission when the pending flush cannot persist', async () => {
    vi.mocked(api.student.saveAnswers)
      .mockReset()
      .mockRejectedValue(
        new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
      );
    const user = userEvent.setup();
    renderExam();

    await screen.findByText('What is 2+2?');
    await user.click(screen.getByRole('radio', { name: '5' }));

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(await screen.findByRole('button', { name: /^Submit exam$/ }));

    // Save fails → submit must never fire; the modal stays with an error.
    expect(api.student.submit).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Submit exam?' })).toBeInTheDocument();
    expect(screen.getByText(/Unable to submit your exam/)).toBeInTheDocument();
  });

  it('redirects a GATED attempt back to the instructions screen', async () => {
    renderExam(buildAttempt({ status: 'GATED' }));
    expect(await screen.findByRole('heading', { name: 'Instructions' })).toBeInTheDocument();
  });

  it('redirects a SUBMITTED attempt to the result screen', async () => {
    renderExam(buildAttempt({ status: 'SUBMITTED' }));
    expect(await screen.findByText('RESULT PAGE')).toBeInTheDocument();
  });

  it('suppresses copy, logs the violation, and shows an inline notice (no blocking modal)', async () => {
    vi.mocked(api.student.postEvent).mockResolvedValue(postEventResult(1));
    renderExam();
    await screen.findByText('What is 2+2?');

    let prevented = false;
    await act(async () => {
      prevented = document.dispatchEvent(new Event('copy', { cancelable: true })) === false;
    });
    expect(prevented).toBe(true);

    await waitFor(() => expect(api.student.postEvent).toHaveBeenCalledWith('a1', { type: 'COPY' }));
    expect(await screen.findByText(/Warning 1 of 3: Copying is not allowed during the exam/)).toBeInTheDocument();
    expect(screen.getByText('1/3 warnings')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Warning 1 of 3' })).not.toBeInTheDocument();
  });

  it('coalesces a tab/window switch (blur + hidden) into a single blocking violation', async () => {
    vi.mocked(api.student.postEvent).mockResolvedValue(postEventResult(1));
    renderExam();
    await screen.findByText('What is 2+2?');

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      Reflect.deleteProperty(document, 'hidden');
    });

    await waitFor(() => expect(api.student.postEvent).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Warning 1 of 3' })).toBeInTheDocument();
    expect(screen.getByText(/You switched away|exam window lost focus/)).toBeInTheDocument();
  });

  it('flushes a pending answer before posting a violation', async () => {
    const saved: SaveAnswersBody[] = [];
    vi.mocked(api.student.saveAnswers).mockImplementation(async (_id, body) => {
      saved.push(body);
      return saveOk();
    });
    vi.mocked(api.student.postEvent).mockResolvedValue(postEventResult(1));
    const user = userEvent.setup();
    renderExam();
    await screen.findByText('What is 2+2?');

    await user.click(screen.getByRole('radio', { name: '5' }));
    await act(async () => {
      document.dispatchEvent(new Event('copy', { cancelable: true }));
    });

    await waitFor(() => expect(api.student.postEvent).toHaveBeenCalledTimes(1));
    expect(saved.length).toBe(1);
    expect(saved[0].answers.find((a) => a.questionId === 'q1')).toMatchObject({
      selectedOptionIds: ['o2'],
    });
    const saveOrder = vi.mocked(api.student.saveAnswers).mock.invocationCallOrder[0];
    const postOrder = vi.mocked(api.student.postEvent).mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(postOrder);
  });

  it('warns with a blocking modal (and fullscreen recovery) when leaving fullscreen', async () => {
    vi.mocked(api.student.postEvent).mockResolvedValue(postEventResult(1));
    renderExam();
    await screen.findByText('What is 2+2?');

    const fs = (value: unknown) => ({ configurable: true, get: () => value });
    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', fs(document.documentElement));
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', fs(null));
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Reflect.deleteProperty(document, 'fullscreenElement');

    expect(await screen.findByRole('heading', { name: 'Warning 1 of 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to fullscreen' })).toBeInTheDocument();
    expect(screen.getByText(/3 violations auto-submit your exam/)).toBeInTheDocument();
  });

  it('auto-submits on the 3rd violation and navigates to the result', async () => {
    const user = userEvent.setup();
    vi.mocked(api.student.postEvent)
      .mockResolvedValueOnce(postEventResult(1))
      .mockResolvedValueOnce(postEventResult(2))
      .mockResolvedValueOnce(postEventResult(3, true));
    renderExam();
    await screen.findByText('What is 2+2?');

    // Distinct event types from separate user actions (per-type coalescing
    // would otherwise swallow three rapid copies as one).
    await act(async () => {
      document.dispatchEvent(new Event('copy', { cancelable: true }));
    });
    await act(async () => {
      document.dispatchEvent(new Event('paste', { cancelable: true }));
    });
    await act(async () => {
      document.dispatchEvent(new Event('contextmenu', { cancelable: true }));
    });

    expect(await screen.findByRole('heading', { name: 'Exam auto-submitted' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View result' }));
    expect(await screen.findByText('RESULT PAGE')).toBeInTheDocument();
  });
});