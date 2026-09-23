import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAuth } from '@/hooks/useAuth';
import { formatPercent } from '@/utils/format';
import { resourceKind } from '@/utils/resourceKind';
import { attemptAction, ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_VARIANT, durationLabel } from '@/utils/attemptStatus';

export default function StudentDashboard() {
  const { user } = useAuth();
  const firstName = user?.name.split(' ')[0] ?? 'there';

  const testsQuery = useQuery({ queryKey: ['student', 'tests'], queryFn: () => api.student.tests() });
  const attemptsQuery = useQuery({ queryKey: ['student', 'attempts'], queryFn: () => api.student.attempts() });
  const resourcesQuery = useQuery({ queryKey: ['student', 'resources'], queryFn: () => api.student.resources() });

  const isPending = testsQuery.isPending || attemptsQuery.isPending || resourcesQuery.isPending;
  const allFailed = testsQuery.isError && attemptsQuery.isError && resourcesQuery.isError;

  const tests = testsQuery.data?.tests ?? [];
  const attempts = attemptsQuery.data?.attempts ?? [];
  const resources = resourcesQuery.data?.resources ?? [];

  // GATED docs are "not started" records; IN_PROGRESS are unfinished runs.
  const completed = attempts.filter((a) => a.status === 'SUBMITTED' || a.status === 'TIMED_OUT');
  const inProgressCount = attempts.filter((a) => a.status === 'IN_PROGRESS').length;
  const average =
    completed.length > 0 ? Math.round(completed.reduce((sum, a) => sum + a.percent, 0) / completed.length) : null;

  const recentTests = tests.slice(0, 3);
  const recentResources = resources.slice(0, 3);

  return (
    <>
      <h1 className="page-heading">Welcome, {firstName}</h1>
      <p className="page-sub">Here's what's new, and where you left off.</p>

      {isPending && (
        <div role="status" aria-label="Loading your dashboard">
          <span className="sr-only">Loading your dashboard…</span>
          <div className="stat-grid stat-grid--4">
            <div className="skeleton-row" aria-hidden="true" />
            <div className="skeleton-row" aria-hidden="true" />
            <div className="skeleton-row" aria-hidden="true" />
            <div className="skeleton-row" aria-hidden="true" />
          </div>
          <div className="card-grid" aria-hidden="true">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
          <div className="card-grid" aria-hidden="true">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        </div>
      )}

      {!isPending && allFailed && <ErrorState onRetry={refetchAll} />}

      {!isPending && !allFailed && (
        <>
          <section className="section" aria-label="Summary">
            <div className="stat-grid stat-grid--4">
              <Card className="stat-card">
                <p className="stat-card__value">{testsQuery.isError ? '—' : tests.length}</p>
                <p className="stat-card__label">Tests available</p>
                <p className="stat-card__hint">{testsQuery.isError ? 'Unavailable' : 'Ready to take now'}</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{attemptsQuery.isError ? '—' : completed.length}</p>
                <p className="stat-card__label">Tests taken</p>
                <p className="stat-card__hint">{attemptsQuery.isError ? 'Unavailable' : 'Completed attempts'}</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{attemptsQuery.isError ? '—' : formatPercent(average)}</p>
                <p className="stat-card__label">Average score</p>
                <p className="stat-card__hint">{attemptsQuery.isError ? 'Unavailable' : 'Across completed tests'}</p>
              </Card>
              <Card className="stat-card">
                <p className="stat-card__value">{attemptsQuery.isError ? '—' : inProgressCount}</p>
                <p className="stat-card__label">In progress</p>
                <p className="stat-card__hint">
                  {attemptsQuery.isError
                    ? 'Unavailable'
                    : inProgressCount > 0
                      ? <Link to="/student/tests">Resume →</Link>
                      : 'No tests started'}
                </p>
              </Card>
            </div>
          </section>

          <section className="section" aria-labelledby="recent-tests-heading">
            <h2 className="section-title" id="recent-tests-heading">
              Recently added tests
            </h2>

            {testsQuery.isError && <ErrorState title="Couldn't load this section." onRetry={() => testsQuery.refetch()} />}

            {testsQuery.isSuccess && tests.length === 0 && (
              <EmptyState
                title="No tests available yet."
                description="When an instructor publishes a test, it will appear here. You're all set — no action needed."
              />
            )}

            {testsQuery.isSuccess && recentTests.length > 0 && (
              <div className="card-grid">
                {recentTests.map((test) => {
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

            {testsQuery.isSuccess && tests.length > 3 && (
              <Link className="back-link" to="/student/tests">
                View all tests
              </Link>
            )}
          </section>

          <section className="section" aria-labelledby="recent-resources-heading">
            <h2 className="section-title" id="recent-resources-heading">
              Recently added resources
            </h2>

            {resourcesQuery.isError && (
              <ErrorState title="Couldn't load this section." onRetry={() => resourcesQuery.refetch()} />
            )}

            {resourcesQuery.isSuccess && resources.length === 0 && (
              <EmptyState
                title="No resources yet."
                description="Study material will appear here when your instructor shares it."
              />
            )}

            {resourcesQuery.isSuccess && recentResources.length > 0 && (
              <div className="card-grid">
                {recentResources.map((resource) => {
                  const kind = resourceKind(resource.kind);
                  return (
                    <Card key={resource.id} className="resource-card">
                      <h3 className="test-card__title">{resource.title}</h3>
                      <Badge variant={kind.variant}>{kind.label}</Badge>
                      {resource.description && <p className="test-card__meta">{resource.description}</p>}
                      <div className="test-card__cta">
                        <a
                          className="btn btn--primary btn--md"
                          href={resource.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open
                          <span className="sr-only">Opens in a new tab</span>
                        </a>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {resourcesQuery.isSuccess && resources.length > 3 && (
              <Link className="back-link" to="/student/resources">
                View all resources
              </Link>
            )}
          </section>
        </>
      )}
    </>
  );

  function refetchAll() {
    void testsQuery.refetch();
    void attemptsQuery.refetch();
    void resourcesQuery.refetch();
  }
}