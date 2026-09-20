import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';

interface TestCardData {
  id: string;
  name: string;
  duration: string;
  marks: string;
  sections: string;
  negativeMarking?: string;
}

// Static demo data — shaped like the Phase 3 query results so the cards
// can be swapped for real data without visual changes.
const DEMO_TESTS: TestCardData[] = [
  { id: 'demo-1', name: 'General Aptitude Mock', duration: '45 min', marks: '100 marks', sections: '3 sections' },
  {
    id: 'demo-2',
    name: 'Quantitative Reasoning',
    duration: '30 min',
    marks: '60 marks',
    sections: '2 sections',
    negativeMarking: '-0.25 wrong answer',
  },
];

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
        {DEMO_TESTS.length > 0 ? (
          <div className="card-grid">
            {DEMO_TESTS.map((test) => (
              <Card key={test.id} className="test-card">
                <div className="test-card__chips">
                  <Badge variant="accent">Available</Badge>
                  {test.negativeMarking && <Badge variant="warn">{test.negativeMarking}</Badge>}
                </div>
                <h3 className="test-card__title">{test.name}</h3>
                <p className="test-card__meta">
                  {test.duration} · {test.marks} · {test.sections}
                </p>
                <Button disabled title="Test-taking arrives in a later phase." className="test-card__cta">
                  Start test
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No tests available yet."
            description="When an instructor publishes a test, it will appear here."
          />
        )}
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