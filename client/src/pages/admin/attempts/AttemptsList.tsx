import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatDateTime } from '@/utils/format';
import type { AttemptStatus } from '@/types';

const ATTEMPTS_KEY = ['admin', 'attempts'];

const STATUS_LABEL: Record<AttemptStatus, string> = {
  GATED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  TIMED_OUT: 'Timed out',
};

const STATUS_VARIANT: Record<AttemptStatus, BadgeVariant> = {
  GATED: 'default',
  IN_PROGRESS: 'accent',
  SUBMITTED: 'success',
  TIMED_OUT: 'warn',
};

export default function AttemptsList() {
  const list = useQuery({ queryKey: ATTEMPTS_KEY, queryFn: () => api.admin.attempts.list() });

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Attempts</h1>
          <p className="page-sub">Review student submissions, scores, and anti-cheat activity.</p>
        </div>
      </div>

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
          title="No attempts yet."
          description="When a student submits a test, their attempt will appear here with the score and a full answer review."
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
                      <Badge variant={STATUS_VARIANT[attempt.status]}>{STATUS_LABEL[attempt.status]}</Badge>
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