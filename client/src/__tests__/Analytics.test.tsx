import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import Analytics from '@/pages/admin/analytics';
import type { AdminAnalytics, AdminTestListItem } from '@/types';

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

const tests: AdminTestListItem[] = [
  {
    id: 't1',
    title: 'Algebra Midterm',
    status: 'PUBLISHED',
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
    status: 'DRAFT',
    defaultNegativeMarks: 0,
    sectionCount: 1,
    questionCount: 1,
    totalDurationSec: 300,
    totalMarks: 5,
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

const analytics: AdminAnalytics = {
  testId: null,
  summary: {
    scoredAttempts: 42,
    attemptsToday: 5,
    avgScorePercent: 62.5,
    highestScorePercent: 95,
    lowestScorePercent: 20,
    avgCorrectPercent: 58,
    totalWarnings: 3,
  },
  distribution: [
    { bucket: 0, count: 2 },
    { bucket: 10, count: 4 },
    { bucket: 20, count: 0 },
    { bucket: 30, count: 6 },
    { bucket: 40, count: 10 },
    { bucket: 50, count: 8 },
    { bucket: 60, count: 5 },
    { bucket: 70, count: 4 },
    { bucket: 80, count: 2 },
    { bucket: 90, count: 1 },
  ],
  perQuestion: [
    { questionId: 'q1', testId: 't1', testTitle: 'Algebra Midterm', sectionIndex: 0, type: 'SINGLE', text: 'What is x?', marks: 2, attempted: 30, correct: 20, difficulty: 66.7 },
    { questionId: 'q2', testId: 't1', testTitle: 'Algebra Midterm', sectionIndex: 0, type: 'MULTI', text: 'Select all primes', marks: 3, attempted: 28, correct: 5, difficulty: 17.9 },
    { questionId: 'q3', testId: 't1', testTitle: 'Algebra Midterm', sectionIndex: 1, type: 'SINGLE', text: 'Solve for y', marks: 5, attempted: 20, correct: 18, difficulty: 90 },
  ],
  violations: {
    byType: { FULLSCREEN_EXIT: 2, PASTE: 1 },
    attemptsWithViolations: 2,
    totalWarnings: 3,
  },
};

function renderAnalytics() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Analytics />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary cards with values from the analytics response', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    renderAnalytics();

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('Attempts scored')).toBeInTheDocument();
    // "5" appears both as Attempts today and as a histogram count, so scope to stat-card values.
    const statValues = () => screen.getAllByText((_, el) => el?.classList?.contains('stat-card__value') ?? false);
    expect(statValues().map((n) => n.textContent)).toEqual(
      expect.arrayContaining(['42', '5', '63%', '95%', '20%', '58%']),
    );
  });

  it('renders dashes for null summary values and empty distribution', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue({
      ...analytics,
      summary: {
        ...analytics.summary,
        avgScorePercent: null,
        highestScorePercent: null,
        lowestScorePercent: null,
        avgCorrectPercent: null,
      },
      distribution: Array.from({ length: 10 }, (_, i) => ({ bucket: i * 10, count: 0 })),
      perQuestion: [],
      violations: { byType: {}, attemptsWithViolations: 0, totalWarnings: 0 },
    });
    renderAnalytics();

    expect(await screen.findAllByText('—', { selector: '.stat-card__value' })).toHaveLength(4);
  });

  it('calls analytics with the selected test id when the dropdown changes', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    renderAnalytics();

    const select = await screen.findByLabelText('Filter by test');
    // Initial load: no testId.
    await waitFor(() => expect(api.admin.analytics).toHaveBeenCalledTimes(1));
    expect(api.admin.analytics).toHaveBeenLastCalledWith(undefined);

    const user = userEvent.setup();
    await user.selectOptions(select, 't2');

    await waitFor(() =>
      expect(api.admin.analytics).toHaveBeenCalledWith('t2'),
    );
  });

  it('renders the per-question table grouped by section with difficulty badges', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    renderAnalytics();

    // Section 1 (index 0) table
    const section1 = await screen.findByRole('table', { name: 'Per-question difficulty for Algebra Midterm, section 1' });
    expect(within(section1).getByText('What is x?')).toBeInTheDocument();
    expect(within(section1).getByText('Select all primes')).toBeInTheDocument();
    expect(within(section1).getByText('MULTI')).toBeInTheDocument();
    // 66.7 → rounds to one decimal 66.7 → getDifficultyColor returns default (>=60) → badge "66.7%"
    expect(within(section1).getByText('66.7%')).toBeInTheDocument();
    // 17.9 → danger badge
    expect(within(section1).getByText('17.9%')).toBeInTheDocument();

    // Section 2 (index 1) table
    const section2 = screen.getByRole('table', { name: 'Per-question difficulty for Algebra Midterm, section 2' });
    expect(within(section2).getByText('Solve for y')).toBeInTheDocument();
    // 90 → success badge
    expect(within(section2).getByText('90%')).toBeInTheDocument();
  });

  it('renders violations section with byType counts', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    renderAnalytics();

    expect(await screen.findByText('Left fullscreen: 2')).toBeInTheDocument();
    expect(screen.getByText('Paste: 1')).toBeInTheDocument();
    expect(screen.getByText('Total warnings')).toBeInTheDocument();
    expect(screen.getByText('Attempts with violations')).toBeInTheDocument();
  });

  it('shows the empty state when there are no scored attempts and hides the tables', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue({
      ...analytics,
      summary: { ...analytics.summary, scoredAttempts: 0 },
      distribution: Array.from({ length: 10 }, (_, i) => ({ bucket: i * 10, count: 0 })),
      perQuestion: [],
      violations: { byType: {}, attemptsWithViolations: 0, totalWarnings: 0 },
    });
    renderAnalytics();

    expect(await screen.findByText('No scored attempts yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Left fullscreen: 2')).not.toBeInTheDocument();
  });

  it('renders null difficulty as muted text instead of a colored badge', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue({
      ...analytics,
      perQuestion: [
        {
          questionId: 'q0',
          testId: 't1',
          testTitle: 'Algebra Midterm',
          sectionIndex: 0,
          type: 'SINGLE',
          text: 'Never attempted',
          marks: 2,
          attempted: 0,
          correct: 0,
          difficulty: null,
        },
      ],
    });
    renderAnalytics();

    const table = await screen.findByRole('table', { name: 'Per-question difficulty for Algebra Midterm, section 1' });
    const dash = within(table).getByText('—');
    expect(dash).toHaveClass('muted');
    // No colored badge is rendered for an unknown difficulty.
    expect(within(table).queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('exposes histogram bucket data to assistive tech while hiding the visual bars', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue(analytics);
    renderAnalytics();

    // The sr-only list carries per-bucket "range: count" text for screen readers.
    expect(await screen.findByText('90–100%: 1')).toBeInTheDocument();
    expect(screen.getByText('0–9%: 2')).toBeInTheDocument();
    // The decorative histogram is no longer announced as an image.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const bars = document.querySelectorAll('.histogram__bar');
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((bar) => expect(bar).toHaveAttribute('aria-hidden', 'true'));
  });

  it('groups per-question rows by test with test subheadings and separate tables', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockResolvedValue({
      ...analytics,
      perQuestion: [
        ...analytics.perQuestion,
        // A question belonging to a second test sharing the same section index.
        { questionId: 'q4', testId: 't2', testTitle: 'Physics Quiz', sectionIndex: 0, type: 'SINGLE', text: 'Define momentum', marks: 1, attempted: 8, correct: 2, difficulty: 25 },
      ],
    });
    renderAnalytics();

    // Test subheadings for both tests (unfiltered multi-test view).
    expect(await screen.findByRole('heading', { name: 'Physics Quiz' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Algebra Midterm' })).toBeInTheDocument();

    // Each test's questions live in their own per-section table.
    const physicsTable = screen.getByRole('table', { name: 'Per-question difficulty for Physics Quiz, section 1' });
    expect(within(physicsTable).getByText('Define momentum')).toBeInTheDocument();
    expect(within(physicsTable).queryByText('What is x?')).not.toBeInTheDocument();

    const algebraTable = screen.getByRole('table', { name: 'Per-question difficulty for Algebra Midterm, section 1' });
    expect(within(algebraTable).getByText('What is x?')).toBeInTheDocument();
    expect(within(algebraTable).getByText('Select all primes')).toBeInTheDocument();
    expect(within(algebraTable).queryByText('Define momentum')).not.toBeInTheDocument();
  });

  it('keeps the test filter rendered when analytics fails, and retry reloads', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests });
    vi.mocked(api.admin.analytics).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    renderAnalytics();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    // The filter survives the analytics error so admins can still switch tests.
    expect(screen.getByLabelText('Filter by test')).toBeInTheDocument();
    expect(screen.queryByText('No scored attempts yet.')).not.toBeInTheDocument();

    vi.mocked(api.admin.analytics).mockResolvedValueOnce(analytics);
    const user = userEvent.setup();
    await user.click(retry);

    expect(await screen.findByText('Attempts scored')).toBeInTheDocument();
    await waitFor(() => expect(api.admin.analytics).toHaveBeenCalledTimes(2));
  });
});