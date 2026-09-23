import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { attemptAction, ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_VARIANT, durationLabel } from '@/utils/attemptStatus';

function isFinished(status?: string): boolean {
  return status === 'SUBMITTED' || status === 'TIMED_OUT';
}

export default function Tests() {
  const list = useQuery({ queryKey: ['student', 'tests'], queryFn: () => api.student.tests() });

  const tests = list.data?.tests ?? [];
  const allCompleted = list.isSuccess && tests.length > 0 && tests.every((test) => isFinished(test.attempt?.status));

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Tests</h1>
          <p className="page-sub">Take or resume a published test.</p>
        </div>
      </div>

      {list.isPending && (
        <div className="tests-list" role="status" aria-live="polite">
          <span className="sr-only">Loading tests…</span>
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
        </div>
      )}

      {list.isError && <ErrorState onRetry={() => list.refetch()} />}

      {list.isSuccess && tests.length === 0 && (
        <EmptyState
          title="No tests available yet."
          description="When an instructor publishes a test, it will appear here. You're all set — no action needed."
        />
      )}

      {list.isSuccess && allCompleted && (
        <EmptyState
          title="You've completed everything currently available."
          description="Check back soon — new tests will appear here."
        />
      )}

      {list.isSuccess && tests.length > 0 && !allCompleted && (
        <div className="card-grid">
          {tests.map((test) => {
            const action = attemptAction(test);
            const status = test.attempt?.status;
            return (
              <Card key={test.id} className="test-card">
                <h3 className="test-card__title">{test.title}</h3>
                <div className="test-card__chips">
                  <Badge variant="accent">
                    {test.sectionCount} section{test.sectionCount === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant="default">
                    {test.questionCount} question{test.questionCount === 1 ? '' : 's'}
                  </Badge>
                  {status && (
                    <Badge variant={ATTEMPT_STATUS_VARIANT[status]}>{ATTEMPT_STATUS_LABEL[status]}</Badge>
                  )}
                </div>
                <p className="test-card__meta">
                  {durationLabel(test.totalDurationSec)} · {test.totalMarks} marks
                  {test.defaultNegativeMarks > 0 && (
                    <>
                      {' '}
                      · −{test.defaultNegativeMarks} per wrong answer
                    </>
                  )}
                </p>
                <div className="test-card__cta">
                  <Link className="btn btn--primary btn--md" to={action.to}>
                    {action.label}
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}