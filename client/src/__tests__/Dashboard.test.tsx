import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import AdminDashboard from '@/pages/admin/Dashboard';
import StudentDashboard from '@/pages/student/Dashboard';
import type {
  AdminAnalytics,
  AdminAttemptListItem,
  Resource,
  StudentAttemptSummary,
  StudentTestListItem,
} from '@/types';

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
      student: {
        ...actual.api.student,
        tests: vi.fn(),
        attempts: vi.fn(),
        resources: vi.fn(),
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

const studentTests: StudentTestListItem[] = [
  {
    id: 't1',
    title: 'Algebra Midterm',
    description: 'Chapters 1-4.',
    sectionCount: 3,
    questionCount: 12,
    totalDurationSec: 2700,
    totalMarks: 100,
    defaultNegativeMarks: 0.25,
    shuffleQuestions: true,
    shuffleOptions: true,
    attempt: { id: 'a1', status: 'IN_PROGRESS' },
  },
  {
    id: 't2',
    title: 'Physics Quiz',
    sectionCount: 1,
    questionCount: 5,
    totalDurationSec: 600,
    totalMarks: 50,
    defaultNegativeMarks: 0,
    shuffleQuestions: false,
    shuffleOptions: false,
    attempt: { id: 'a2', status: 'SUBMITTED' },
  },
  {
    id: 't3',
    title: 'Biology Basics',
    sectionCount: 2,
    questionCount: 8,
    totalDurationSec: 900,
    totalMarks: 80,
    defaultNegativeMarks: 0.5,
    shuffleQuestions: true,
    shuffleOptions: false,
  },
  {
    id: 't4',
    title: 'Chemistry Lab',
    sectionCount: 2,
    questionCount: 10,
    totalDurationSec: 1200,
    totalMarks: 60,
    defaultNegativeMarks: 0.25,
    shuffleQuestions: true,
    shuffleOptions: true,
  },
];

const studentAttempts: StudentAttemptSummary[] = [
  { attemptId: 'a2', testId: 't2', testTitle: 'Physics Quiz', status: 'SUBMITTED', marksEarned: 40, totalMarks: 50, percent: 80, date: '2026-01-01T00:00:00.000Z' },
  { attemptId: 'a4', testId: 't4', testTitle: 'Chemistry Lab', status: 'SUBMITTED', marksEarned: 10, totalMarks: 50, percent: 20, date: '2026-01-02T00:00:00.000Z' },
  { attemptId: 'a1', testId: 't1', testTitle: 'Algebra Midterm', status: 'IN_PROGRESS', marksEarned: 0, totalMarks: 100, percent: 0, date: '2026-01-03T00:00:00.000Z' },
];

const studentResources: Resource[] = [
  { id: 'r1', title: 'Formula Sheet', description: 'Key formulas for the midterm.', kind: 'PDF', driveUrl: 'https://drive.google.com/file/d/abc/view', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'r2', title: 'Diagram Pack', kind: 'IMAGE', driveUrl: 'https://drive.google.com/file/d/def/view', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'r3', title: 'Past Papers', description: 'Last three years.', kind: 'ZIP', driveUrl: 'https://drive.google.com/file/d/ghi/view', createdAt: '2026-01-03T00:00:00.000Z' },
  { id: 'r4', title: 'Reading List', kind: 'OTHER', driveUrl: 'https://example.com/reading', createdAt: '2026-01-04T00:00:00.000Z' },
];

const authValue: AuthContextValue = {
  user: { id: '1', email: 'aria@example.com', name: 'Aria Sharma', role: 'student' },
  sessionExpiresAt: null,
  status: 'authenticated',
  expired: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
};

function renderStudentDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <StudentDashboard />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('StudentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the stats strip, recent tests, and recent resources from the three feeds', async () => {
    vi.mocked(api.student.tests).mockResolvedValue({ tests: studentTests });
    vi.mocked(api.student.attempts).mockResolvedValue({ attempts: studentAttempts });
    vi.mocked(api.student.resources).mockResolvedValue({ resources: studentResources });
    renderStudentDashboard();

    expect(await screen.findByRole('heading', { name: 'Welcome, Aria' })).toBeInTheDocument();

    // Waits for the tests feed (the greeting/stat labels render before feeds resolve).
    // "View all tests" is not a valid wait target — it only renders when tests.length > 3.
    expect(await screen.findByText('Algebra Midterm')).toBeInTheDocument();

    expect(withinValue(screen.getByText('Tests available').parentElement!)).toBe('4');
    expect(withinValue(screen.getByText('Tests taken').parentElement!)).toBe('2');
    expect(withinValue(screen.getByText('Average score').parentElement!)).toBe('50%');
    // Scoped to the stat label — attempt badges in the test cards use the same wording.
    expect(withinValue(screen.getByText('In progress', { selector: '.stat-card__label' }).parentElement!)).toBe('1');
    expect(screen.getByRole('link', { name: 'Resume →' })).toHaveAttribute('href', '/student/tests');

    // Recently added tests: top 3, cards deep-link via attemptAction.
    expect(screen.getByRole('heading', { name: 'Recently added tests' })).toBeInTheDocument();
    expect(screen.getByText('Algebra Midterm')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/student/tests/t1/attempt/a1');
    expect(screen.getByRole('link', { name: 'View result' })).toHaveAttribute('href', '/student/tests/t2/result/a2');
    expect(screen.getByRole('link', { name: 'Take test' })).toHaveAttribute('href', '/student/tests/t3/instructions');
    expect(screen.getByRole('link', { name: 'View all tests' })).toHaveAttribute('href', '/student/tests');

    // Recently added resources: top 3, Open links are external.
    expect(screen.getByRole('heading', { name: 'Recently added resources' })).toBeInTheDocument();
    expect(screen.getByText('Formula Sheet')).toBeInTheDocument();
    const openLinks = screen.getAllByRole('link', { name: /^Open/ });
    expect(openLinks).toHaveLength(3);
    expect(openLinks[0]).toHaveAttribute('href', 'https://drive.google.com/file/d/abc/view');
    expect(openLinks[0]).toHaveAttribute('target', '_blank');
    expect(openLinks[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'View all resources' })).toHaveAttribute('href', '/student/resources');
  });

  it('shows one skeleton loading surface while the dashboard feeds are pending', async () => {
    vi.mocked(api.student.tests).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.student.attempts).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.student.resources).mockImplementation(() => new Promise(() => {}));
    renderStudentDashboard();

    expect(screen.getByRole('status', { name: 'Loading your dashboard' })).toBeInTheDocument();
    expect(document.querySelectorAll('.skeleton-row')).toHaveLength(10);
    expect(screen.queryByText('Tests available')).not.toBeInTheDocument();
    expect(screen.queryByText('Recently added tests')).not.toBeInTheDocument();
  });

  it('shows a full error state only when every feed fails, keeping the greeting', async () => {
    vi.mocked(api.student.tests).mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    vi.mocked(api.student.attempts).mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    vi.mocked(api.student.resources).mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderStudentDashboard();

    expect(await screen.findByRole('heading', { name: 'Welcome, Aria' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Tests available')).not.toBeInTheDocument();
    expect(screen.queryByText('Recently added tests')).not.toBeInTheDocument();
  });

  it('degrades per section when one feed fails, keeping the other sections', async () => {
    vi.mocked(api.student.tests).mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    vi.mocked(api.student.attempts).mockResolvedValue({ attempts: studentAttempts });
    vi.mocked(api.student.resources).mockResolvedValue({ resources: studentResources });
    renderStudentDashboard();

    // Tests stat is unknown, not zero; its hint says so.
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(withinValue(screen.getByText('Tests available').parentElement!)).toBe('—');
    // The tests section shows its own scoped error; other stats still load.
    expect(screen.getByText("Couldn't load this section.")).toBeInTheDocument();
    expect(withinValue(screen.getByText('Tests taken').parentElement!)).toBe('2');
    expect(screen.getByRole('heading', { name: 'Recently added resources' })).toBeInTheDocument();
    expect(screen.getByText('Formula Sheet')).toBeInTheDocument();
  });

  it('renders empty states and zero/dash stats when the feeds come back empty', async () => {
    vi.mocked(api.student.tests).mockResolvedValue({ tests: [] });
    vi.mocked(api.student.attempts).mockResolvedValue({ attempts: [] });
    vi.mocked(api.student.resources).mockResolvedValue({ resources: [] });
    renderStudentDashboard();

    expect(await screen.findByText('No tests available yet.')).toBeInTheDocument();
    expect(screen.getByText('Study material will appear here when your instructor shares it.')).toBeInTheDocument();
    expect(withinValue(screen.getByText('Tests available').parentElement!)).toBe('0');
    expect(withinValue(screen.getByText('Tests taken').parentElement!)).toBe('0');
    // Fake zero is misleading for an unanswered average: em dash instead.
    expect(withinValue(screen.getByText('Average score').parentElement!)).toBe('—');
    expect(withinValue(screen.getByText('In progress').parentElement!)).toBe('0');
    expect(screen.getByText('No tests started')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View all tests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View all resources' })).not.toBeInTheDocument();
  });
});

function withinValue(statCard: HTMLElement): string | null {
  return statCard.querySelector('.stat-card__value')?.textContent ?? null;
}