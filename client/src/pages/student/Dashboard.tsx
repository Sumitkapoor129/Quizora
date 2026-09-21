import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';

export default function StudentDashboard() {
  const { user } = useAuth();
  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <>
      <h1 className="page-heading">Welcome, {firstName}</h1>
      <p className="page-sub">Pick a test below, or catch up on your results.</p>

      <section className="section" aria-labelledby="available-heading">
        <h2 className="section-title" id="available-heading">
          Available tests
        </h2>
        <EmptyState
          title="No tests available yet."
          description="When an instructor publishes a test, it will appear here. You're all set — no action needed."
        />
      </section>

      <section className="section" aria-labelledby="upcoming-heading">
        <h2 className="section-title" id="upcoming-heading">
          Upcoming
        </h2>
        <EmptyState
          title="No upcoming tests."
          description="Scheduled tests will show up here with their start time before they open."
        />
      </section>

      <section className="section" aria-labelledby="taken-heading">
        <h2 className="section-title" id="taken-heading">
          Taken
        </h2>
        <EmptyState
          title="No results yet."
          description="Once you finish a test, your score and marked answers will appear here."
        />
      </section>
    </>
  );
}