import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, assetUrl } from '@/api/client';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime } from '@/utils/format';
import type { AdminAttemptDetail, AdminAttemptQuestion } from '@/types';

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Submitted',
  TIMED_OUT: 'Timed out',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  SUBMITTED: 'success',
  TIMED_OUT: 'warn',
};

/** Anti-cheat events that represent a violation; everything else is informational. */
const VIOLATION_TYPES: ReadonlySet<string> = new Set([
  'FULLSCREEN_EXIT',
  'COPY',
  'PASTE',
  'CUT',
  'CONTEXT_MENU',
  'VISIBILITY_HIDDEN',
  'FOCUS_LOST',
]);

const EVENT_LABEL: Record<string, string> = {
  START: 'Started',
  SUBMIT: 'Submitted',
  NETWORK_RECONNECT: 'Reconnected',
  FULLSCREEN_EXIT: 'Left fullscreen',
  COPY: 'Copied text',
  PASTE: 'Pasted text',
  CUT: 'Cut text',
  CONTEXT_MENU: 'Right-click',
  VISIBILITY_HIDDEN: 'Switched away',
  FOCUS_LOST: 'Lost focus',
};

function formatMarks(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function questionStatus(q: AdminAttemptQuestion): { label: string; variant: BadgeVariant } {
  if (!q.isAttempted) return { label: 'Not attempted', variant: 'default' };
  return q.isCorrect ? { label: 'Correct', variant: 'success' } : { label: 'Incorrect', variant: 'danger' };
}

function groupQuestions(attempt: AdminAttemptDetail): Map<number, AdminAttemptQuestion[]> {
  const groups = new Map<number, AdminAttemptQuestion[]>();
  for (const question of attempt.questions) {
    const list = groups.get(question.sectionIndex) ?? [];
    list.push(question);
    groups.set(question.sectionIndex, list);
  }
  return groups;
}

export default function AttemptDetail() {
  const { attemptId = '' } = useParams();

  const detail = useQuery({
    queryKey: ['admin', 'attempts', attemptId],
    queryFn: () => api.admin.attempts.get(attemptId),
    retry: false,
  });

  if (detail.isPending) {
    return (
      <div className="route-loading" aria-label="Loading attempt">
        <Spinner label="Loading attempt" />
      </div>
    );
  }

  if (detail.isError) {
    return (
      <div className="exam-error">
        <ErrorState
          title="Unable to load this attempt."
          message="Please try again. If the problem persists, return to the attempts list."
          onRetry={() => void detail.refetch()}
        />
        <div className="exam-error__actions">
          <Link className="btn btn--secondary btn--md" to="/admin/attempts">
            Back to attempts
          </Link>
        </div>
      </div>
    );
  }

  const attempt = detail.data?.attempt;
  if (!attempt) return null;

  const questionsBySection = groupQuestions(attempt);
  const violations = attempt.events.filter((event) => VIOLATION_TYPES.has(event.type));
  const activity = attempt.events.filter((event) => !VIOLATION_TYPES.has(event.type));

  return (
    <>
      <Link className="back-link" to="/admin/attempts">
        Back to attempts
      </Link>

      <div className="page-header">
        <div>
          <h1 className="page-heading">{attempt.student.name}</h1>
          <p className="page-sub">
            {attempt.student.email} · {attempt.testTitle}
          </p>
        </div>
        <div className="page-header__actions">
          <Badge variant={STATUS_VARIANT[attempt.status]}>{STATUS_LABEL[attempt.status] ?? attempt.status}</Badge>
        </div>
      </div>

      <Card className="attempt-meta">
        <div className="attempt-meta__item">
          <span className="attempt-meta__label">Score</span>
          <span className="attempt-meta__value">
            {attempt.score} / {attempt.maxScore}
          </span>
        </div>
        <div className="attempt-meta__item">
          <span className="attempt-meta__label">Correct</span>
          <span className="attempt-meta__value">
            {attempt.correctCount} / {attempt.totalQuestions} correct
          </span>
        </div>
        <div className="attempt-meta__item">
          <span className="attempt-meta__label">Warnings</span>
          <span className="attempt-meta__value">
            {attempt.warningCount} {attempt.warningCount === 1 ? 'violation' : 'violations'}
          </span>
        </div>
        <div className="attempt-meta__item">
          <span className="attempt-meta__label">Started</span>
          <span className="attempt-meta__value">{formatDateTime(attempt.startedAt)}</span>
        </div>
        <div className="attempt-meta__item">
          <span className="attempt-meta__label">Submitted</span>
          <span className="attempt-meta__value">{formatDateTime(attempt.submittedAt)}</span>
        </div>
      </Card>

      <section className="section" aria-labelledby="sections-heading">
        <h2 className="section-title" id="sections-heading">
          Section scores
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
                    <td className="data-table__num">
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

      {attempt.sections.map((section) => {
        const questions = (questionsBySection.get(section.sectionIndex) ?? []).sort(
          (a, b) => a.questionIndex - b.questionIndex,
        );
        const headingId = `section-${section.sectionId}-questions`;
        return (
          <section className="section" key={section.sectionId} aria-labelledby={headingId}>
            <h2 className="section-title" id={headingId}>
              {section.title}
            </h2>
            {questions.map((q) => {
              const outcome = questionStatus(q);
              return (
                <Card key={q.questionId} className="attempt-question">
                  <div className="attempt-question__head">
                    <Badge variant={outcome.variant}>{outcome.label}</Badge>
                    <span>Question {q.questionIndex + 1}</span>
                    <span>{q.type === 'MULTI' ? 'Multiple choice' : 'Single choice'}</span>
                    <span>
                      {formatMarks(q.marks)} per question · −{q.negativeMarks} wrong
                    </span>
                    <span className="attempt-question__awarded">
                      Awarded: <strong>{formatMarks(q.marksAwarded)}</strong>
                    </span>
                  </div>

                  {q.text && <p className="attempt-question__text">{q.text}</p>}
                  {q.imageUrl && (
                    <img
                      className="exam-question__image"
                      src={assetUrl(q.imageUrl)}
                      alt={q.text ? '' : 'Question image'}
                    />
                  )}

                  <ul className="attempt-options">
                    {q.options.map((option) => (
                      <li
                        key={option.optionId}
                        className={`attempt-option${option.selected ? ' attempt-option--selected' : ''}${option.selected && !option.isCorrect ? ' attempt-option--wrong' : ''}`}
                      >
                        <span className="attempt-option__text">
                          {option.imageUrl && (
                            <img className="exam-option__image" src={assetUrl(option.imageUrl)} alt="" />
                          )}
                          {option.text}
                        </span>
                        <span className="attempt-option__markers">
                          {option.isCorrect && <Badge variant="success">Correct answer</Badge>}
                          {option.selected && (
                            <Badge variant={option.isCorrect ? 'accent' : 'danger'}>
                              {option.isCorrect ? 'Your answer' : 'Your answer (wrong)'}
                            </Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {q.explanation && (
                    <p className="attempt-explanation">
                      <strong>Explanation:</strong> {q.explanation}
                    </p>
                  )}
                </Card>
              );
            })}
          </section>
        );
      })}

      <section className="section" aria-labelledby="events-heading">
        <h2 className="section-title" id="events-heading">
          Anti-cheat events
        </h2>

        {attempt.events.length === 0 && (
          <EmptyState title="No events recorded." description="This attempt has no anti-cheat event history." />
        )}

        {(violations.length > 0 || activity.length > 0) && (
          <div className="attempt-events">
            {violations.length > 0 && (
              <div>
                <h3 className="subsection-title">Violations</h3>
                <ul className="attempt-events__list">
                  {violations.map((event, i) => (
                    <li key={`${event.type}-${i}`} className="attempt-events__item">
                      <Badge variant="danger">{EVENT_LABEL[event.type] ?? event.type}</Badge>
                      <time className="attempt-events__time" dateTime={event.createdAt}>
                        {formatDateTime(event.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activity.length > 0 && (
              <div>
                <h3 className="subsection-title">Activity</h3>
                <ul className="attempt-events__list">
                  {activity.map((event, i) => (
                    <li key={`${event.type}-${i}`} className="attempt-events__item">
                      <Badge>{EVENT_LABEL[event.type] ?? event.type}</Badge>
                      <time className="attempt-events__time" dateTime={event.createdAt}>
                        {formatDateTime(event.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}