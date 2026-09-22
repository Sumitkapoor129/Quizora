import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAuth } from '@/hooks/useAuth';
import type { StudentTestListItem } from '@/types';

function durationLabel(totalSec: number): string {
  return `${Math.round(totalSec / 60)} min`;
}

const STATUS_LABEL: Record<string, string> = {
  GATED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  TIMED_OUT: 'Timed out',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  GATED: 'default',
  IN_PROGRESS: 'accent',
  SUBMITTED: 'success',
  TIMED_OUT: 'warn',
};

function attemptAction(test: StudentTestListItem): { label: string; to: string } {
  const attempt = test.attempt;
  if (attempt?.status === 'IN_PROGRESS') {
    return { label: 'Resume', to: `/student/tests/${test.id}/attempt/${attempt.id}` };
  }
  if (attempt?.status === 'SUBMITTED' || attempt?.status === 'TIMED_OUT') {
    return { label: 'View result', to: `/student/tests/${test.id}/result/${attempt.id}` };
  }
  // Fresh test, or a GATED attempt (created but not started): both go through
  // the instructions gate, which creates/starts the attempt idempotently.
  return { label: attempt ? 'Continue' : 'Take test', to: `/student/tests/${test.id}/instructions` };
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const firstName = user?.name.split(' ')[0] ?? 'there';

  const list = useQuery({ queryKey: ['student', 'tests'], queryFn: () => api.student.tests() });

  const hasTests = list.isSuccess && list.data.tests.length > 0;

  return (
    <>
      <h1 className="page-heading">Welcome, {firstName}</h1>
      <p className="page-sub">Pick a test below, or catch up on your results.</p>

      <section className="section" aria-labelledby="available-heading">
        <h2 className="section-title" id="available-heading">
          Available tests
        </h2>

        {list.isPending && (
          <div className="tests-list" role="status" aria-live="polite">
            <span className="sr-only">Loading tests…</span>
            <div className="skeleton-row" aria-hidden="true" />
            <div className="skeleton-row" aria-hidden="true" />
            <div className="skeleton-row" aria-hidden="true" />
          </div>
        )}

        {list.isError && <ErrorState onRetry={() => list.refetch()} />}

        {list.isSuccess && !hasTests && (
          <EmptyState
            title="No tests available yet."
            description="When an instructor publishes a test, it will appear here. You're all set — no action needed."
          />
        )}

        {hasTests && (
          <div className="card-grid">
            {list.data.tests.map((test) => {
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
                    {status && <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>}
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
      </section>
    </>
  );
}