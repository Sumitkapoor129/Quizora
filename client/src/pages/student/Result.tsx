import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime } from '@/utils/format';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_VARIANT } from '@/utils/attemptStatus';
import type { ResultQuestion } from '@/types';

function questionStatus(q: ResultQuestion): { label: string; variant: BadgeVariant } {
  if (!q.isAttempted) return { label: 'Not attempted', variant: 'default' };
  return q.isCorrect ? { label: 'Correct', variant: 'success' } : { label: 'Incorrect', variant: 'danger' };
}

function formatMarks(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export default function Result() {
  const { attemptId = '' } = useParams();

  const result = useQuery({
    queryKey: ['student', 'result', attemptId],
    queryFn: () => api.student.result(attemptId),
    retry: false,
  });

  if (result.isPending) {
    return (
      <div className="route-loading" aria-label="Loading your result">
        <Spinner label="Loading your result" />
      </div>
    );
  }

  if (result.isError) {
    return (
      <div className="exam-shell">
        <div className="exam-error">
          <ErrorState
            title="Unable to load your result."
            message="Please try again. If the problem persists, return to your tests."
            onRetry={() => void result.refetch()}
          />
          <div className="exam-error__actions">
            <Link className="btn btn--secondary btn--md" to="/student">
              Back to tests
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const attempt = result.data?.attempt;
  if (!attempt) return null;

  const status = ATTEMPT_STATUS_LABEL[attempt.status] ?? attempt.status;

  return (
    <div className="exam-shell">
      <div className="result-page">
        <Link className="back-link" to="/student">
          Back to tests
        </Link>

        <h1 className="page-heading">{attempt.testTitle}</h1>
        <p className="result-note">Correct answers are not shown here.</p>

        <Card className="result-summary">
          <div className="result-summary__score">
            <span className="result-summary__value">{attempt.score} / {attempt.maxScore}</span>
            <span className="result-summary__label">Score</span>
          </div>
          <div className="result-summary__meta">
            <span>{attempt.correctCount} / {attempt.totalQuestions} correct</span>
            <span>Submitted {formatDateTime(attempt.submittedAt)}</span>
          </div>
          <Badge variant={ATTEMPT_STATUS_VARIANT[attempt.status]}>{status}</Badge>
        </Card>

        <section className="section" aria-labelledby="sections-heading">
          <h2 className="section-title" id="sections-heading">
            Sections
          </h2>
          <Card className="table-card">
            <div className="table-wrap">
              <table className="data-table" aria-label="Score by section">
                <thead>
                  <tr>
                    <th scope="col">Section</th>
                    <th scope="col">Score</th>
                    <th scope="col">Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {attempt.sections.map((section) => (
                    <tr key={section.sectionId}>
                      <td>{section.title}</td>
                      <td>
                        {section.score} / {section.maxScore}
                      </td>
                      <td className="data-table__num">{section.correctCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section className="section" aria-labelledby="questions-heading">
          <h2 className="section-title" id="questions-heading">
            Questions
          </h2>
          <Card className="table-card">
            <div className="table-wrap">
              <table className="data-table" aria-label="Question by question result">
                <caption className="sr-only">
                  Question-by-question result. Correct answers are not shown.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col">Result</th>
                    <th scope="col">
                      <abbr title="Marks awarded">Marks</abbr>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attempt.questions.map((q) => {
                    const outcome = questionStatus(q);
                    return (
                      <tr key={q.questionId}>
                        <td>Question {q.questionIndex + 1}</td>
                        <td>
                          <Badge variant={outcome.variant}>{outcome.label}</Badge>
                        </td>
                        <td>
                          <span className="sr-only">Marks awarded: </span>
                          {formatMarks(q.marksAwarded)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}