import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatDateTime } from '@/utils/format';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_VARIANT } from '@/utils/attemptStatus';
import type { StudentAttemptSummary } from '@/types';

function isScored(status: StudentAttemptSummary['status']): boolean {
  return status === 'SUBMITTED' || status === 'TIMED_OUT';
}

function titleLink(attempt: StudentAttemptSummary) {
  if (attempt.status === 'IN_PROGRESS') {
    return `/student/tests/${attempt.testId}/attempt/${attempt.attemptId}`;
  }
  if (isScored(attempt.status)) {
    return `/student/tests/${attempt.testId}/result/${attempt.attemptId}`;
  }
  return null;
}

function resultAction(attempt: StudentAttemptSummary): { label: string; to: string } | null {
  if (isScored(attempt.status)) {
    return { label: 'View result', to: `/student/tests/${attempt.testId}/result/${attempt.attemptId}` };
  }
  if (attempt.status === 'IN_PROGRESS') {
    return { label: 'Resume', to: `/student/tests/${attempt.testId}/attempt/${attempt.attemptId}` };
  }
  if (attempt.status === 'GATED') {
    return { label: 'Continue', to: `/student/tests/${attempt.testId}/instructions` };
  }
  return null;
}

export default function MyTests() {
  const list = useQuery({ queryKey: ['student', 'attempts'], queryFn: () => api.student.attempts() });

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">My Tests</h1>
          <p className="page-sub">Your attempt history and scores.</p>
        </div>
      </div>

      {list.isPending && (
        <div className="tests-list" role="status" aria-live="polite">
          <span className="sr-only">Loading your attempts…</span>
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
        </div>
      )}

      {list.isError && <ErrorState onRetry={() => list.refetch()} />}

      {list.isSuccess && list.data.attempts.length === 0 && (
        <EmptyState
          title="No attempts yet."
          description="When you take a test, it will appear here with your score and result."
        />
      )}

      {list.isSuccess && list.data.attempts.length > 0 && (
        <Card className="table-card">
          <div className="table-wrap">
            <table className="data-table" aria-label="My test attempts">
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                  <th scope="col">Score</th>
                  <th scope="col">Percent</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {list.data.attempts.map((attempt) => {
                  const scored = isScored(attempt.status);
                  const titleTo = titleLink(attempt);
                  const action = resultAction(attempt);
                  return (
                    <tr key={attempt.attemptId}>
                      <td>
                        {titleTo ? (
                          <Link className="data-table__link" to={titleTo}>
                            {attempt.testTitle || 'Untitled test'}
                          </Link>
                        ) : (
                          <span className="data-table__link">{attempt.testTitle || 'Untitled test'}</span>
                        )}
                      </td>
                      <td>
                        <Badge variant={ATTEMPT_STATUS_VARIANT[attempt.status]}>
                          {ATTEMPT_STATUS_LABEL[attempt.status]}
                        </Badge>
                      </td>
                      <td>{formatDateTime(attempt.date)}</td>
                      <td className="data-table__num">
                        {scored ? `${attempt.marksEarned} / ${attempt.totalMarks}` : '—'}
                      </td>
                      <td className="data-table__num">
                        {/* Percent derived client-side from raw marks; never trust a drifted server field. */}
                        {scored && attempt.totalMarks > 0
                          ? `${Math.round((attempt.marksEarned / attempt.totalMarks) * 100)}%`
                          : '—'}
                      </td>
                      <td>{action && <Link to={action.to}>{action.label}</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}