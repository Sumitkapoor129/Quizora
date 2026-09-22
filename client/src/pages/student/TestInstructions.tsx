import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import type { StudentTestListItem } from '@/types';

function durationLabel(totalSec: number): string {
  return `${Math.round(totalSec / 60)} min`;
}

function negativeCopy(test: StudentTestListItem): string {
  if (test.defaultNegativeMarks > 0) {
    return `Unanswered questions score 0. Incorrect answers may deduct ${test.defaultNegativeMarks} marks each.`;
  }
  return 'Unanswered questions score 0. No negative marking for incorrect answers.';
}

function enterFullscreen(): void {
  const el = document.documentElement;
  if (typeof el.requestFullscreen === 'function') {
    void el.requestFullscreen().catch(() => {
      // Best effort: the exam still runs when fullscreen is unavailable.
    });
  }
}

export default function TestInstructions() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const listQuery = useQuery({ queryKey: ['student', 'tests'], queryFn: () => api.student.tests() });
  const test = listQuery.data?.tests.find((item) => item.id === testId) ?? null;

  // A GATED attempt already exists: pull its sections so the student sees
  // per-section timing/negative marks before resuming into the exam.
  const gatedAttemptId = test?.attempt?.status === 'GATED' ? test.attempt.id : null;
  const detailQuery = useQuery({
    queryKey: ['student', 'attempt', gatedAttemptId ?? 'none'],
    queryFn: () => {
      if (!gatedAttemptId) throw new Error('No attempt');
      return api.student.attempt(gatedAttemptId);
    },
    enabled: gatedAttemptId !== null,
    retry: false,
  });
  const sections = detailQuery.data?.attempt.sections ?? [];

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      // POST attempts is idempotent: returns the existing attempt or creates one.
      const created = await api.student.createAttempt(testId);
      const attemptId = created.attempt.id;
      await api.student.startAttempt(attemptId);
      enterFullscreen();
      navigate(`/student/tests/${testId}/attempt/${attemptId}`, { replace: true });
    } catch (err) {
      setStarting(false);
      if (err instanceof ApiError && err.code === 'EXAM_ALREADY_SUBMITTED') {
        const details = err.details as { attemptId?: string } | undefined;
        if (details?.attemptId) {
          navigate(`/student/tests/${testId}/result/${details.attemptId}`, { replace: true });
          return;
        }
      }
      setStartError(err instanceof ApiError ? err.message : 'Unable to start the exam. Please try again.');
    }
  }

  if (listQuery.isPending) {
    return (
      <div className="route-loading" role="status">
        <Spinner label="Loading test details" />
      </div>
    );
  }

  if (listQuery.isError || !test) {
    return (
      <>
        <div className="page-header">
          <div>
            <Link className="back-link" to="/student">
              ← Tests
            </Link>
            <h1 className="page-heading">Test instructions</h1>
          </div>
        </div>
        <ErrorState
          title="Test not found."
          message="This test isn't available to you right now. It may have been unpublished."
          onRetry={() => listQuery.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Link className="back-link" to="/student">
            ← Tests
          </Link>
          <h1 className="page-heading">{test.title}</h1>
          {test.description && <p className="page-sub">{test.description}</p>}
        </div>
      </div>

      <Card className="instructions-card">
        <h2 className="section-title" id="instructions-summary">
          Before you start
        </h2>
        <dl className="instructions-meta">
          <div>
            <dt>Duration</dt>
            <dd>{durationLabel(test.totalDurationSec)}</dd>
          </div>
          <div>
            <dt>Questions</dt>
            <dd>{test.questionCount}</dd>
          </div>
          <div>
            <dt>Sections</dt>
            <dd>{test.sectionCount}</dd>
          </div>
          <div>
            <dt>Total marks</dt>
            <dd>{test.totalMarks}</dd>
          </div>
        </dl>
        <p className="instructions-note">{negativeCopy(test)}</p>

        {sections.length > 0 && (
          <div className="instructions-sections">
            <h3 className="subsection-title" id="instructions-sections-heading">
              Section timing
            </h3>
            <ul className="instructions-section-list">
              {sections.map((section) => (
                <li className="instructions-section" key={section.sectionId}>
                  <span className="instructions-section__title">{section.title}</span>
                  <span className="instructions-section__meta">
                    {durationLabel(section.durationSec)}
                    {section.negativeMarks > 0 && <> · −{section.negativeMarks} per wrong answer</>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="instructions-rules">
          <h3 className="subsection-title" id="instructions-rules-heading">
            Anti-cheat rules
          </h3>
          <p>This exam runs in fullscreen. Leaving fullscreen, switching tabs, copying, or using the context menu is
            logged, and 3 violations auto-submit your exam.</p>
        </div>

        {startError && (
          <div className="banner banner--error" role="alert">
            <p className="banner__text">{startError}</p>
          </div>
        )}

        <div className="instructions-actions">
          <Button loading={starting} onClick={handleStart}>
            Start exam
          </Button>
        </div>
      </Card>
    </>
  );
}