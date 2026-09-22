import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SelectField } from '@/components/ui/SelectField';
import { Spinner } from '@/components/ui/Spinner';
import { formatPercent } from '@/utils/format';
import type { AdminAnalyticsPerQuestion } from '@/types';

const VIOLATION_LABELS: Record<string, string> = {
  FULLSCREEN_EXIT: 'Left fullscreen',
  COPY: 'Copy',
  PASTE: 'Paste',
  CUT: 'Cut',
  CONTEXT_MENU: 'Context menu',
  VISIBILITY_HIDDEN: 'Tab/window hidden',
  FOCUS_LOST: 'Focus lost',
  NETWORK_RECONNECT: 'Network reconnect',
};

const DIFFICULTY_BUCKET_RANGES = [
  '0–9%',
  '10–19%',
  '20–29%',
  '30–39%',
  '40–49%',
  '50–59%',
  '60–69%',
  '70–79%',
  '80–89%',
  '90–100%',
];

function bucketRange(i: number, bucket: number): string {
  return DIFFICULTY_BUCKET_RANGES[i] ?? `${bucket}–${bucket + 9}%`;
}

function getDifficultyColor(d: number): 'default' | 'warn' | 'danger' | 'success' {
  if (Number.isNaN(d)) return 'default';
  if (d < 40) return 'danger';
  if (d > 75) return 'success';
  if (d < 60) return 'warn';
  return 'default';
}

function getDifficultyBadgeVariant(d: number): BadgeVariant {
  return getDifficultyColor(d) as BadgeVariant;
}

function formatOneDecimal(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Math.round(n * 10) / 10}%`;
}

type PerQuestionRow = {
  key: string;
  testId: string;
  testTitle: string;
  sectionIndex: number;
  order: number;
  text: string;
  type: AdminAnalyticsPerQuestion['type'];
  marks: number;
  attempted: number;
  correct: number;
  difficulty: number | null;
};

function groupPerQuestion(items: AdminAnalyticsPerQuestion[]): PerQuestionRow[] {
  const rows = items.map((q, i) => ({
    key: q.questionId || `${q.testId}-${q.sectionIndex}-${i}`,
    testId: q.testId,
    testTitle: q.testTitle,
    sectionIndex: q.sectionIndex,
    order: i + 1,
    text: q.text ?? '(untitled question)',
    type: q.type,
    marks: q.marks,
    attempted: q.attempted,
    correct: q.correct,
    difficulty: q.difficulty,
  }));
  rows.sort((a, b) => {
    if (a.testTitle !== b.testTitle) return a.testTitle.localeCompare(b.testTitle);
    if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex;
    return a.order - b.order;
  });
  return rows.map((r, idx) => ({ ...r, order: idx + 1 }));
}

export default function Analytics() {
  const [testId, setTestId] = useState<string | undefined>(undefined);

  const testsQuery = useQuery({
    queryKey: ['admin', 'tests'],
    queryFn: () => api.tests.list(),
  });

  const analyticsQuery = useQuery({
    queryKey: ['admin', 'analytics', testId],
    queryFn: () => api.admin.analytics(testId),
  });

  const tests = testsQuery.data?.tests ?? [];

  const data = analyticsQuery.data;
  const summary = data?.summary;
  const distribution = data?.distribution ?? [];
  const perQuestion = data?.perQuestion ?? [];
  const violations = data?.violations;

  const hasNoScored = (summary?.scoredAttempts ?? 0) === 0;

  const maxBucketCount = useMemo(() => {
    if (distribution.length === 0) return 0;
    return Math.max(...distribution.map((d) => d.count));
  }, [distribution]);

  const perQuestionRows = useMemo(() => groupPerQuestion(perQuestion), [perQuestion]);

  // Group by test first (needed when the view is unfiltered), then by section.
  const testGroups = useMemo(() => {
    const map = new Map<string, { testId: string; testTitle: string; sections: Map<number, PerQuestionRow[]> }>();
    for (const r of perQuestionRows) {
      let group = map.get(r.testId);
      if (!group) {
        group = { testId: r.testId, testTitle: r.testTitle || '(unknown test)', sections: new Map() };
        map.set(r.testId, group);
      }
      if (!group.sections.has(r.sectionIndex)) group.sections.set(r.sectionIndex, []);
      group.sections.get(r.sectionIndex)!.push(r);
    }
    return Array.from(map.values());
  }, [perQuestionRows]);

  const showTestSubheadings = data?.testId == null && testGroups.length > 1;

  if (analyticsQuery.isPending || testsQuery.isPending) {
    return (
      <div className="route-loading">
        <Spinner label="Loading analytics" />
      </div>
    );
  }

  return (
    <>
      <h1 className="page-heading">Analytics</h1>
      <p className="page-sub">Performance trends across tests and students.</p>

      <section className="section" aria-label="Analytics filters">
        <div className="filter-field">
          <SelectField
            id="test-filter"
            label="Filter by test"
            value={testId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setTestId(v ? v : undefined);
            }}
          >
            <option value="">All tests</option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </SelectField>
          {testsQuery.isError && (
            <div className="filter-error">
              <p className="field__error">Couldn&apos;t load the test list.</p>
              <Button variant="ghost" size="sm" onClick={() => void testsQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </section>

      {analyticsQuery.isError ? (
        <ErrorState
          onRetry={() => {
            void analyticsQuery.refetch();
            if (testsQuery.isError) void testsQuery.refetch();
          }}
        />
      ) : (
        <>
          <section className="section" aria-label="Summary">
            <div className="stat-grid">
              <Card className="stat-card">
                <p className="stat-card__value">{summary?.scoredAttempts ?? 0}</p>
                <p className="stat-card__label">Attempts scored</p>
                <p className="stat-card__hint">attempts with a score</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{summary?.attemptsToday ?? 0}</p>
                <p className="stat-card__label">Attempts today</p>
                <p className="stat-card__hint">submissions in the last 24 hours</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{formatPercent(summary?.avgScorePercent)}</p>
                <p className="stat-card__label">Avg score %</p>
                <p className="stat-card__hint">mean score percentage</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{formatPercent(summary?.highestScorePercent)}</p>
                <p className="stat-card__label">Highest %</p>
                <p className="stat-card__hint">best score</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{formatPercent(summary?.lowestScorePercent)}</p>
                <p className="stat-card__label">Lowest %</p>
                <p className="stat-card__hint">lowest score</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{formatPercent(summary?.avgCorrectPercent)}</p>
                <p className="stat-card__label">Avg correct %</p>
                <p className="stat-card__hint">correct answers</p>
              </Card>
            </div>
          </section>

          {hasNoScored && (
            <EmptyState
              title="No scored attempts yet."
              description={
                testId
                  ? 'When students submit attempts for this test, analytics will appear here.'
                  : 'When students submit attempts for your tests, analytics will appear here.'
              }
            />
          )}

          {!hasNoScored && (
            <>
              <section className="section" aria-label="Score distribution">
                <Card>
                  <div className="card__header">
                    <h2 className="section-title">Score distribution</h2>
                    <p className="card__sub">Attempts by score bucket (percent)</p>
                  </div>
                  <div className="histogram">
                    {distribution.map((b, i) => {
                      const pct = maxBucketCount === 0 ? 0 : Math.round((b.count / maxBucketCount) * 100);
                      return (
                        <div className="histogram__bar" key={b.bucket} aria-hidden="true">
                          <div className="histogram__label">{bucketRange(i, b.bucket)}</div>
                          <div className="histogram__track">
                            <div className="histogram__fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="histogram__count">{b.count}</div>
                        </div>
                      );
                    })}
                  </div>
                  <ul className="sr-only">
                    {distribution.map((b, i) => (
                      <li key={b.bucket}>
                        {bucketRange(i, b.bucket)}: {b.count}
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>

              <section className="section" aria-label="Per-question difficulty">
                <Card>
                  <div className="card__header">
                    <h2 className="section-title">Per-question difficulty</h2>
                    <p className="card__sub">Correct rate by question</p>
                  </div>
                  {testGroups.map((group) => (
                    <div key={group.testId} className="section-group">
                      {showTestSubheadings && (
                        <h3 className="subsection-title">{group.testTitle}</h3>
                      )}
                      {Array.from(group.sections.entries())
                        .sort((a, b) => a[0] - b[0])
                        .map(([sectionIdx, rows]) => (
                          <div key={sectionIdx} className="section-group">
                            <h3 className="subsection-title">Section {sectionIdx + 1}</h3>
                            <div className="table-wrap">
                              <table
                                className="data-table"
                                aria-label={`Per-question difficulty for ${group.testTitle}, section ${sectionIdx + 1}`}
                              >
                                <thead>
                                  <tr>
                                    <th scope="col">#</th>
                                    <th scope="col">Question</th>
                                    <th scope="col">Type</th>
                                    <th scope="col">Marks</th>
                                    <th scope="col">Attempted</th>
                                    <th scope="col">Correct</th>
                                    <th scope="col">Difficulty</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((r) => (
                              <tr key={r.key}>
                                <td className="data-table__num">{r.order}</td>
                                <td>{r.text}</td>
                                <td>
                                  <Badge variant={r.type === 'SINGLE' ? 'default' : 'accent'}>
                                    {r.type === 'SINGLE' ? 'SINGLE' : 'MULTI'}
                                  </Badge>
                                </td>
                                <td className="data-table__num">{r.marks}</td>
                                <td className="data-table__num">{r.attempted}</td>
                                <td className="data-table__num">{r.correct}</td>
                                <td>
                                  {r.difficulty === null || Number.isNaN(r.difficulty) ? (
                                    <span className="muted">—</span>
                                  ) : (
                                    <Badge variant={getDifficultyBadgeVariant(r.difficulty)}>
                                      {formatOneDecimal(r.difficulty)}
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  {perQuestionRows.length === 0 && (
                    <EmptyState
                      title="No question data."
                      description="Question-level stats are not available for this selection."
                    />
                  )}
                </Card>
              </section>

              <section className="section" aria-label="Violations">
                <Card>
                  <div className="card__header">
                    <h2 className="section-title">Violations</h2>
                    <p className="card__sub">Anti-cheat events summary</p>
                  </div>
                  {violations ? (
                    <div className="violations">
                      <div className="violations__summary">
                        <div>
                          <p className="violations__value">{violations.totalWarnings}</p>
                          <p className="stat-card__label">Total warnings</p>
                        </div>
                        <div>
                          <p className="violations__value">{violations.attemptsWithViolations}</p>
                          <p className="stat-card__label">Attempts with violations</p>
                        </div>
                      </div>
                      <h3 className="subsection-title">By type</h3>
                      <div className="violations__grid">
                        {Object.entries(violations.byType).map(([k, v]) => (
                          <Badge key={k} variant="warn">
                            {VIOLATION_LABELS[k] ?? k}: {v}
                          </Badge>
                        ))}
                        {Object.keys(violations.byType).length === 0 && (
                          <p className="muted">No violations recorded.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No violations." description="No anti-cheat events recorded." />
                  )}
                </Card>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}