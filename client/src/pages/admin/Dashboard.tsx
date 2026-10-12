import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { OrbitGraphic } from '@/components/visual/OrbitGraphic';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatDateTime, formatPercent } from '@/utils/format';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_VARIANT } from '@/utils/attemptStatus';

export default function AdminDashboard() {
  const testsQuery = useQuery({
    queryKey: ['admin', 'tests'],
    queryFn: () => api.tests.list(),
  });

  const analyticsQuery = useQuery({
    queryKey: ['admin', 'analytics'],
    queryFn: () => api.admin.analytics(),
  });

  const attemptsQuery = useQuery({
    queryKey: ['admin', 'attempts'],
    queryFn: () => api.admin.attempts.list(),
  });

  const isPending = testsQuery.isPending || analyticsQuery.isPending || attemptsQuery.isPending;
  const loadedWithError = analyticsQuery.isError || attemptsQuery.isError;

  const refetchAll = () => {
    void testsQuery.refetch();
    void analyticsQuery.refetch();
    void attemptsQuery.refetch();
  };

  const publishedCount = (testsQuery.data?.tests ?? []).filter((t) => t.status === 'PUBLISHED').length;
  const summary = analyticsQuery.data?.summary;
  // GATED docs are "not started" records, not student activity — keep them out of the feed.
  const activityAttempts = (attemptsQuery.data?.attempts ?? []).filter((a) => a.status !== 'GATED');
  const recent = activityAttempts.slice(0, 5);
  const hasActivity = activityAttempts.length > 0;

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="page-eyebrow">YOUR TEACHING WORKSPACE</p>
          <h1 className="page-heading">Dashboard</h1>
          <p className="page-sub">Overview of tests and student activity.</p>
        </div>
        <Link className="btn btn--primary btn--md" to="/admin/tests/new"><span aria-hidden="true">+</span> Create a test</Link>
      </header>

      {isPending && (
        <div className="tests-list" role="status" aria-label="Loading dashboard">
          <span className="sr-only">Loading dashboard</span>
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
        </div>
      )}

      {!isPending && loadedWithError && <ErrorState onRetry={refetchAll} />}

      {!isPending && !loadedWithError && (
        <>
          <section className="dashboard-banner" aria-labelledby="teaching-banner-title">
            <div className="dashboard-banner__copy">
              <p className="dashboard-banner__eyebrow">BUILT FOR BETTER LEARNING</p>
              <h2 className="dashboard-banner__title" id="teaching-banner-title">Great questions. Clearer insights.</h2>
              <p className="dashboard-banner__description">Bring your assessments and student progress together in one focused workspace.</p>
              <Link className="btn btn--secondary btn--md" to="/admin/tests">Manage tests <span aria-hidden="true">↗</span></Link>
            </div>
            <div className="dashboard-banner__art"><OrbitGraphic /></div>
          </section>

          <section className="section" aria-label="Summary">
            <div className="stat-grid">
              <Card className="stat-card">
                <span className="stat-card__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h3" /></svg></span>
                <p className="stat-card__value">{testsQuery.isError ? '—' : publishedCount}</p>
                <p className="stat-card__label">Published tests</p>
                <p className="stat-card__hint">
                  {testsQuery.isError ? 'Test list unavailable' : 'tests published across all time'}
                </p>
              </Card>
              <Card className="stat-card">
                <span className="stat-card__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg></span>
                <p className="stat-card__value">{summary?.attemptsToday ?? 0}</p>
                <p className="stat-card__label">Attempts today</p>
                <p className="stat-card__hint">submissions in the last 24 hours</p>
              </Card>
              <Card className="stat-card">
                <span className="stat-card__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10 M10 20V4 M16 20v-8 M22 20H2" /></svg></span>
                <p className="stat-card__value">{formatPercent(summary?.avgScorePercent)}</p>
                <p className="stat-card__label">Average score</p>
                <p className="stat-card__hint">mean across all attempts</p>
              </Card>
            </div>
          </section>

          {!hasActivity && (
            <section className="section" aria-labelledby="activity-heading">
              <h2 className="section-title" id="activity-heading">
                Activity
              </h2>
              <EmptyState
                title="No students have attempted tests yet."
                description="When students submit an attempt, scores and averages will appear here."
                action={
                  <Link className="btn btn--primary btn--md" to="/admin/tests/new">
                    Create your first test
                  </Link>
                }
              />
            </section>
          )}

          {recent.length > 0 && (
            <section className="section" aria-labelledby="recent-heading">
              <h2 className="section-title" id="recent-heading">
                Recent attempts
              </h2>
              <Card className="table-card">
                <div className="table-wrap">
                  <table className="data-table" aria-label="Recent student attempts">
                    <thead>
                      <tr>
                        <th scope="col">Student</th>
                        <th scope="col">Test</th>
                        <th scope="col">Status</th>
                        <th scope="col">Score</th>
                        <th scope="col">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((attempt) => (
                        <tr key={attempt.id}>
                          <td>
                            <Link className="data-table__link" to={`/admin/attempts/${attempt.id}`}>
                              {attempt.student.name}
                            </Link>
                            <span className="data-table__sub">{attempt.student.email}</span>
                          </td>
                          <td>{attempt.testTitle}</td>
                          <td>
                            <Badge variant={ATTEMPT_STATUS_VARIANT[attempt.status]}>
                              {ATTEMPT_STATUS_LABEL[attempt.status]}
                            </Badge>
                          </td>
                          <td className="data-table__num">
                            {attempt.score} / {attempt.maxScore}
                          </td>
                          <td>
                            {attempt.submittedAt
                              ? formatDateTime(attempt.submittedAt)
                              : attempt.startedAt
                                ? formatDateTime(attempt.startedAt)
                                : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
                  <Link to="/admin/attempts" className="btn btn--ghost btn--sm">
                    View all attempts
                  </Link>
                </div>
              </Card>
            </section>
          )}
        </>
      )}
    </>
  );
}