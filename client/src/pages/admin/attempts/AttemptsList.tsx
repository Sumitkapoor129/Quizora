import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SelectField } from '@/components/ui/SelectField';
import { formatDateTime } from '@/utils/format';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_VARIANT } from '@/utils/attemptStatus';
import type { AttemptStatus } from '@/types';

const ATTEMPTS_KEY = ['admin', 'attempts'];

const STATUS_OPTIONS: AttemptStatus[] = ['GATED', 'IN_PROGRESS', 'SUBMITTED', 'TIMED_OUT'];

export default function AttemptsList() {
  const [testId, setTestId] = useState('');
  const [status, setStatus] = useState('');

  // Server-side filters: the list is capped at 200, so narrowing happens in
  // the query, not in the browser.
  const list = useQuery({
    queryKey: [...ATTEMPTS_KEY, testId, status],
    queryFn: () =>
      api.admin.attempts.list({
        testId: testId || undefined,
        status: (status || undefined) as AttemptStatus | undefined,
      }),
  });

  // Reuses the tests query already cached by the Tests page / analytics.
  const testsQuery = useQuery({ queryKey: ['admin', 'tests'], queryFn: api.tests.list });

  const hasFilters = Boolean(testId || status);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Attempts</h1>
          <p className="page-sub">Review student submissions, scores, and anti-cheat activity.</p>
        </div>
      </div>

      <section className="section" aria-label="Attempt filters">
        <div className="field-row">
          <SelectField
            id="attempts-test-filter"
            label="Test"
            value={testId}
            onChange={(e) => setTestId(e.target.value)}
          >
            {testsQuery.isPending ? (
              <option value="">Loading tests…</option>
            ) : (
              <>
                <option value="">All tests</option>
                {(testsQuery.data?.tests ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </>
            )}
          </SelectField>
          <SelectField id="attempts-status-filter" label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {ATTEMPT_STATUS_LABEL[s]}
              </option>
            ))}
          </SelectField>
        </div>
        {testsQuery.isError && (
          <div className="filter-error">
            <p className="field__error">Couldn&apos;t load the test list.</p>
            <Button variant="ghost" size="sm" onClick={() => void testsQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
      </section>

      {list.isPending && (
        <div className="tests-list" role="status" aria-label="Loading attempts">
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
        </div>
      )}

      {list.isError && <ErrorState onRetry={() => list.refetch()} />}

      {list.isSuccess && list.data.attempts.length === 0 && (
        <EmptyState
          title={hasFilters ? 'No attempts match your filters.' : 'No attempts yet.'}
          description={
            hasFilters
              ? 'Try a different test or status.'
              : 'When a student submits a test, their attempt will appear here with the score and a full answer review.'
          }
        />
      )}

      {list.isSuccess && list.data.attempts.length > 0 && (
        <Card className="table-card">
          <div className="table-wrap">
            <table className="data-table" aria-label="Student attempts">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Test</th>
                  <th scope="col">Status</th>
                  <th scope="col">Score</th>
                  <th scope="col">Correct</th>
                  <th scope="col">Warnings</th>
                  <th scope="col">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {list.data.attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>
                      <Link className="data-table__link" to={`/admin/attempts/${attempt.id}`}>
                        {attempt.student.name}
                      </Link>
                      <span className="data-table__sub">{attempt.student.email}</span>
                    </td>
                    <td>{attempt.testTitle}</td>
                    <td>
                      <Badge variant={ATTEMPT_STATUS_VARIANT[attempt.status]}>{ATTEMPT_STATUS_LABEL[attempt.status]}</Badge>
                    </td>
                    <td className="data-table__num">
                      {attempt.score} / {attempt.maxScore}
                    </td>
                    <td className="data-table__num">
                      {attempt.correctCount} / {attempt.totalQuestions}
                    </td>
                    <td className="data-table__num">{attempt.warningCount}/3</td>
                    <td>{attempt.submittedAt ? formatDateTime(attempt.submittedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}