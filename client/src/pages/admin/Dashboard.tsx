import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

const SUMMARY = [
  { label: 'Published tests', value: '0', hint: 'tests published across all time' },
  { label: 'Attempts today', value: '0', hint: 'submissions in the last 24 hours' },
  { label: 'Average score', value: '—', hint: 'mean across all attempts' },
];

export default function AdminDashboard() {
  return (
    <>
      <h1 className="page-heading">Dashboard</h1>
      <p className="page-sub">Overview of tests and student activity.</p>

      <section className="section" aria-label="Summary">
        <div className="stat-grid">
          {SUMMARY.map((stat) => (
            <Card key={stat.label} className="stat-card">
              <p className="stat-card__value">{stat.value}</p>
              <p className="stat-card__label">{stat.label}</p>
              <p className="stat-card__hint">{stat.hint}</p>
            </Card>
          ))}
        </div>
      </section>

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

      <section className="section" aria-labelledby="recent-heading">
        <h2 className="section-title" id="recent-heading">
          Recent attempts
        </h2>
        <EmptyState title="No recent attempts." description="Completed test submissions will show up here." />
      </section>
    </>
  );
}