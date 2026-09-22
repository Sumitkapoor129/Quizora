import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api, assetUrl } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import type { AntiCheatEventType, SaveAnswersBody, StudentAttempt, StudentQuestion, StudentSection } from '@/types';

type FlushResult = 'ok' | 'terminal' | 'error';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SAVE_DEBOUNCE_MS = 800;
const SAVE_RETRY_BASE_MS = 1000;
const MAX_WARNINGS = 3;
/** Coalesces blur + visibility into one violation per tab/window switch. */
const FOCUS_AWAY_COALESCE_MS = 1000;
/** Coalesces repeated copy/cut/paste/right-click into one violation per window. */
const CLIPBOARD_COALESCE_MS = 1000;
/** How long the inline (non-blocking) violation notice stays visible. */
const NOTICE_DURATION_MS = 4000;
/**
 * Violations that require the student to re-engage with the exam get a
 * blocking modal; already-suppressed input (copy/paste/right-click) gets a
 * lighter inline notice so an accidental right-click doesn't stop the clock.
 */
const BLOCKING_VIOLATIONS: ReadonlySet<AntiCheatEventType> = new Set([
  'FULLSCREEN_EXIT',
  'VISIBILITY_HIDDEN',
  'FOCUS_LOST',
]);

interface FlatQuestion {
  question: StudentQuestion;
  section: StudentSection;
}

function flattenQuestions(attempt: StudentAttempt): FlatQuestion[] {
  const out: FlatQuestion[] = [];
  for (const section of attempt.sections) {
    for (const question of section.questions) {
      out.push({ question, section });
    }
  }
  return out;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function enterFullscreen(): void {
  const el = document.documentElement;
  if (typeof el.requestFullscreen === 'function') {
    void el.requestFullscreen().catch(() => {
      // Best effort: the exam still runs when fullscreen is unavailable.
    });
  }
}

const WARNING_MESSAGES: Record<AntiCheatEventType, string> = {
  FULLSCREEN_EXIT: 'You left fullscreen mode.',
  COPY: 'Copying is not allowed during the exam.',
  PASTE: 'Pasting is not allowed during the exam.',
  CUT: 'Cutting text is not allowed during the exam.',
  CONTEXT_MENU: 'Right-click is disabled during the exam.',
  VISIBILITY_HIDDEN: 'You switched away from the exam window.',
  FOCUS_LOST: 'The exam window lost focus.',
  NETWORK_RECONNECT: '',
};

function useCountdown(endAt: string | undefined): { remainingMs: number | null; expired: boolean } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [endAt]);

  if (!endAt) return { remainingMs: null, expired: false };
  const remainingMs = new Date(endAt).getTime() - now;
  if (Number.isNaN(remainingMs)) return { remainingMs: null, expired: false };
  return { remainingMs, expired: remainingMs <= 0 };
}

// Announces time only at meaningful boundaries so SR users aren't read a
// live tick every second. jsx-ally keeps it sr-only and off the tab flow.
function TimerAnnouncements({ remainingMs }: { remainingMs: number | null }) {
  const [announced, setAnnounced] = useState<string | null>(null);

  useEffect(() => {
    if (remainingMs === null) return;
    const minutes = Math.ceil(remainingMs / 60_000);
    let message: string | null = null;
    if (remainingMs <= 0) message = 'Time is up.';
    else if (minutes === 5) message = '5 minutes remaining.';
    else if (minutes === 1) message = '1 minute remaining.';
    if (message && message !== announced) setAnnounced(message);
  }, [remainingMs, announced]);

  if (!announced) return null;
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {announced}
    </span>
  );
}

function paletteLabel(
  n: number,
  state: { isAnswered: boolean; isMarked: boolean; isCurrent: boolean },
): string {
  const parts = [`Question ${n}`];
  if (state.isMarked) parts.push('marked');
  if (state.isAnswered) parts.push('answered');
  if (state.isCurrent) parts.push('current');
  return parts.join(', ');
}

function buildPayload(
  answers: Record<string, { selectedOptionIds: string[]; isMarked?: boolean }>,
  currentIndex: number,
  flat: FlatQuestion[],
): SaveAnswersBody {
  return {
    currentQuestionIndex: currentIndex,
    answers: flat.map(({ question }) => ({
      questionId: question.questionId,
      selectedOptionIds: answers[question.questionId]?.selectedOptionIds ?? [],
      isMarked: answers[question.questionId]?.isMarked ?? false,
    })),
  };
}

function Exam({ attempt, attemptId, testId }: { attempt: StudentAttempt; attemptId: string; testId: string }) {
  const navigate = useNavigate();
  const flat = useMemo(() => flattenQuestions(attempt), [attempt]);
  const resultRoute = `/student/tests/${testId}/result/${attemptId}`;

  const [answers, setAnswers] = useState<
    Record<string, { selectedOptionIds: string[]; isMarked?: boolean }>
  >(() => {
    const seeded: Record<string, { selectedOptionIds: string[]; isMarked?: boolean }> = {};
    for (const answer of attempt.answers) {
      seeded[answer.questionId] = { selectedOptionIds: answer.selectedOptionIds, isMarked: answer.isMarked };
    }
    return seeded;
  });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(attempt.currentQuestionIndex ?? 0);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [offline, setOffline] = useState(false);
  const [endAt, setEndAt] = useState<string | undefined>(attempt.endAt);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [warningCount, setWarningCount] = useState(attempt.warningCount ?? 0);
  const [warning, setWarning] = useState<{ count: number; type: AntiCheatEventType } | null>(null);
  const [notice, setNotice] = useState<{ count: number; text: string } | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  const submittedRef = useRef(false);
  const lastFocusAwayRef = useRef(0);
  const lastEventRef = useRef<Partial<Record<AntiCheatEventType, number>>>({});
  const wasFullscreenRef = useRef(false);
  const hadWarningRef = useRef(false);
  const eventChainRef = useRef<Promise<void>>(Promise.resolve());
  const noticeTimerRef = useRef<number | null>(null);
  const questionRef = useRef<HTMLElement>(null);
  const pendingPayloadRef = useRef<SaveAnswersBody | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const flushPromiseRef = useRef<Promise<FlushResult> | null>(null);

  const safeIndex = Math.min(Math.max(currentQuestionIndex, 0), Math.max(flat.length - 1, 0));
  const current = flat[safeIndex];

  const saveNow = useCallback(
    async (payload: SaveAnswersBody): Promise<FlushResult> => {
      if (submittedRef.current) return 'terminal';
      for (let retryNo = 0; retryNo <= 3; retryNo += 1) {
        try {
          const res = await api.student.saveAnswers(attemptId, payload);
          setOffline(false);
          setEndAt((prev) => (res.endAt && prev !== res.endAt ? res.endAt : prev));
          if (res.status === 'SUBMITTED' || res.status === 'TIMED_OUT') {
            submittedRef.current = true;
            navigate(resultRoute, { replace: true });
            return 'terminal';
          }
          // Payload still matches what the server just saved → clean.
          setIsDirty(false);
          setSaveStatus('saved');
          return 'ok';
        } catch (err) {
          if (err instanceof ApiError && err.code === 'NOT_IN_PROGRESS') {
            setTerminal(true);
            return 'terminal';
          }
          if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
            setOffline(true);
            setSaveStatus('error');
            if (retryNo < 3) {
              await new Promise((resolve) => window.setTimeout(resolve, SAVE_RETRY_BASE_MS * 2 ** retryNo));
              continue;
            }
            return 'error';
          }
          // Hard failure (500, validation, etc). isDirty stays true so the
          // next edit retries.
          setSaveStatus('error');
          return 'error';
        }
      }
      return 'error';
    },
    [attemptId, navigate, resultRoute],
  );

  /**
   * Serialized flush: guarantees the LATEST pending payload is persisted,
   * re-reading after every save so a keystroke during an in-flight PUT can't
   * be lost. Single-flight via flushPromiseRef prevents overlapping PUTs
   * (they triggered mongoose VersionErrors on the server).
   */
  const flush = useCallback(async (): Promise<FlushResult> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    flushPromiseRef.current = (async () => {
      if (submittedRef.current) return 'terminal';
      while (true) {
        const payload = pendingPayloadRef.current;
        if (!payload || submittedRef.current) break;
        const result = await saveNow(payload);
        if (result !== 'ok') return result;
        const stillSame = pendingPayloadRef.current
          ? JSON.stringify(pendingPayloadRef.current) === JSON.stringify(payload)
          : true;
        if (stillSame) pendingPayloadRef.current = null;
        // If a newer payload appeared mid-save, loop again and flush it too.
      }
      setIsDirty(false);
      return 'ok';
    })().finally(() => {
      flushPromiseRef.current = null;
    });
    return flushPromiseRef.current;
  }, [saveNow]);

  useEffect(() => {
    if (!isDirty) return;
    setSaveStatus('saving');
    pendingPayloadRef.current = buildPayload(answers, safeIndex, flat);
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [isDirty, answers, safeIndex, flat, flush]);

  const { remainingMs, expired } = useCountdown(endAt);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (pendingPayloadRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (expired) setTimeExpired(true);
  }, [expired]);

  const doSubmit = useCallback(async (): Promise<boolean> => {
    if (submittedRef.current) return true;
    // Never hand off to the server with locally-held answers still unflushed.
    // The flush loop re-reads pendingPayloadRef after every save, so this
    // awaits a truly current snapshot.
    const flushResult = await flush();
    if (flushResult === 'terminal') return true;
    if (flushResult !== 'ok') return false;
    submittedRef.current = true;
    try {
      await api.student.submit(attemptId);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_IN_PROGRESS') return true;
      submittedRef.current = false;
      return false;
    }
  }, [attemptId, flush]);

  /**
   * Anti-cheat: serializes the event POSTs (a single chain, like `flush`) so
   * rapid violations can't race the server's read-modify-save and drop counts.
   * Local answers are flushed before each POST so a 3rd-strike auto-submit
   * scores the latest snapshot — never hand the server a stale one.
   */
  const reportViolation = useCallback(
    (type: AntiCheatEventType): void => {
      if (submittedRef.current) return;
      eventChainRef.current = eventChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (submittedRef.current) return;
          const flushResult = await flush();
          if (flushResult === 'terminal' || submittedRef.current) return;
          let res;
          try {
            res = await api.student.postEvent(attemptId, { type });
          } catch (err) {
            if (submittedRef.current) return;
            if (err instanceof ApiError && (err.code === 'NOT_IN_PROGRESS' || err.code === 'NOT_STARTED')) {
              submittedRef.current = true;
              setTerminal(true);
            }
            return; // Connection failure: the exam keeps running; the server stays authoritative.
          }
          setWarningCount((prev) => Math.max(prev, res.warningCount));
          if (res.submitted) {
            submittedRef.current = true;
            setAutoSubmitted(true);
            return;
          }
          if (BLOCKING_VIOLATIONS.has(type)) {
            setWarning({ count: res.warningCount, type });
          } else {
            setNotice({ count: res.warningCount, text: WARNING_MESSAGES[type] });
          }
        });
    },
    [attemptId, flush],
  );

  useEffect(() => {
    const reportFocusAway = (type: AntiCheatEventType) => {
      const now = Date.now();
      if (now - lastFocusAwayRef.current < FOCUS_AWAY_COALESCE_MS) return;
      lastFocusAwayRef.current = now;
      reportViolation(type);
    };

    const reportCoalesced = (type: AntiCheatEventType) => {
      const now = Date.now();
      if (now - (lastEventRef.current[type] ?? 0) < CLIPBOARD_COALESCE_MS) return;
      lastEventRef.current[type] = now;
      reportViolation(type);
    };

    function onFullscreenChange() {
      if (document.fullscreenElement) {
        wasFullscreenRef.current = true;
        // Re-entering fullscreen is the only way out of the FULLSCREEN_EXIT
        // warning (no "Continue exam" escape hatch), so dismiss it here.
        setWarning((prev) => (prev?.type === 'FULLSCREEN_EXIT' ? null : prev));
        return;
      }
      if (wasFullscreenRef.current) {
        wasFullscreenRef.current = false;
        reportViolation('FULLSCREEN_EXIT');
      }
    }

    function onVisibilityChange() {
      if (!document.hidden) return;
      reportFocusAway('VISIBILITY_HIDDEN');
    }

    function onWindowBlur() {
      reportFocusAway('FOCUS_LOST');
    }

    const onCopy = (e: Event) => {
      e.preventDefault();
      reportCoalesced('COPY');
    };
    const onCut = (e: Event) => {
      e.preventDefault();
      reportCoalesced('CUT');
    };
    const onPaste = (e: Event) => {
      e.preventDefault();
      reportCoalesced('PASTE');
    };
    const onContextMenu = (e: Event) => {
      e.preventDefault();
      reportCoalesced('CONTEXT_MENU');
    };

    wasFullscreenRef.current = Boolean(document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onContextMenu);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [reportViolation]);

  useEffect(() => {
    if (warning) {
      hadWarningRef.current = true;
      return;
    }
    if (hadWarningRef.current) {
      hadWarningRef.current = false;
      questionRef.current?.focus();
    }
  }, [warning]);

  useEffect(() => {
    if (!notice) return;
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, [notice]);

  useEffect(() => {
    if (!timeExpired || submittedRef.current || confirmOpen || confirmSubmitting) return;
    void (async () => {
      const ok = await doSubmit();
      if (ok) navigate(resultRoute, { replace: true });
    })();
  }, [timeExpired, confirmOpen, confirmSubmitting, doSubmit, navigate, resultRoute]);

  useEffect(() => {
    questionRef.current?.focus();
  }, [safeIndex]);

  function goToQuestion(index: number) {
    setCurrentQuestionIndex(Math.min(Math.max(index, 0), flat.length - 1));
    setIsDirty(true);
  }

  function toggleOption(question: StudentQuestion, optionId: string) {
    const isMulti = question.type === 'MULTI';
    setAnswers((prev) => {
      const previous = prev[question.questionId]?.selectedOptionIds ?? [];
      const selectedOptionIds = isMulti
        ? previous.includes(optionId)
          ? previous.filter((id) => id !== optionId)
          : [...previous, optionId]
        : [optionId];
      return { ...prev, [question.questionId]: { selectedOptionIds, isMarked: prev[question.questionId]?.isMarked } };
    });
    setIsDirty(true);
  }

  function toggleMark(question: StudentQuestion) {
    setAnswers((prev) => ({
      ...prev,
      [question.questionId]: {
        selectedOptionIds: prev[question.questionId]?.selectedOptionIds ?? [],
        isMarked: !prev[question.questionId]?.isMarked,
      },
    }));
    setIsDirty(true);
  }

  async function handleConfirmSubmit() {
    if (confirmSubmitting || submittedRef.current) return;
    setConfirmSubmitting(true);
    setSubmitError(null);
    const ok = await doSubmit();
    if (ok) {
      navigate(resultRoute, { replace: true });
    } else {
      setConfirmSubmitting(false);
      setSubmitError('Unable to submit your exam. Please check your connection and try again.');
    }
  }

  if (terminal) {
    return (
      <div className="exam-shell">
        <div className="exam-error">
          <ErrorState
            title="This exam is no longer in progress."
            message="It may have already been submitted or timed out. You can view the result if one exists."
          />
          <div className="exam-error__actions">
            <Link className="btn btn--secondary btn--md" to={resultRoute}>
              View result
            </Link>
            <Link className="btn btn--ghost btn--md" to="/student">
              Back to tests
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="exam-shell">
        <div className="exam-error">
          <ErrorState title="This exam has no questions." message="There is nothing to answer here." />
          <div className="exam-error__actions">
            <Link className="btn btn--secondary btn--md" to={resultRoute}>
              Submit anyway
            </Link>
            <Link className="btn btn--ghost btn--md" to="/student">
              Back to tests
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const selectedOptionIds = answers[current.question.questionId]?.selectedOptionIds ?? [];
  const isCurrentMarked = answers[current.question.questionId]?.isMarked ?? false;

  return (
    <div className="exam-shell">
      <header className="exam-header">
        <div className="exam-header__titles">
          <h1 className="exam-header__title">{attempt.testTitle}</h1>
          <p className="exam-header__section">
            Section {current.section.sectionIndex + 1} of {attempt.sections.length}: {current.section.title}
          </p>
        </div>
        <div className="exam-header__right">
          <span className={`exam-save-state${saveStatus === 'error' ? ' exam-save-state--error' : ''}`} role="status" aria-live="polite">
            {offline
              ? 'Offline'
              : saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'saved'
                  ? 'Saved'
                  : saveStatus === 'error'
                    ? 'Save failed'
                    : ''}
          </span>
          <span
            className={`exam-warnings${warningCount > 0 ? '' : ' exam-warnings--hidden'}`}
            role="status"
          >
            {warningCount}/{MAX_WARNINGS} warnings
          </span>
          <div
            className={`exam-clock${remainingMs !== null && remainingMs < 60_000 ? ' exam-clock--danger' : ''}`}
            aria-label="Time remaining"
          >
            {remainingMs !== null ? formatClock(remainingMs) : '—'}
          </div>
          <TimerAnnouncements remainingMs={remainingMs} />
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Submit
          </Button>
        </div>
      </header>

      {offline && (
        <div className="banner exam-offline" role="status">
          <p className="banner__text">Connection lost — reconnecting… Your answers are saved on this device.</p>
        </div>
      )}

      {notice && (
        <div className="banner exam-notice" role="status">
          <p className="banner__text">
            Warning {notice.count} of {MAX_WARNINGS}: {notice.text}
          </p>
        </div>
      )}

      <main className="exam-body">
        <Card className="exam-question-card">
          <section
            ref={questionRef}
            tabIndex={-1}
            className="exam-question"
            aria-label={`Question ${safeIndex + 1} of ${flat.length}`}
          >
            <p className="sr-only" aria-live="polite">
              Question {safeIndex + 1} of {flat.length}, {current.section.title}
            </p>
            <div className="exam-question__head">
              <Badge>
                Question {safeIndex + 1} of {flat.length}
              </Badge>
              <span className="exam-question__marks">
                +{current.question.marks}
                {current.question.negativeMarks > 0
                  ? ` · −${current.question.negativeMarks} wrong`
                  : ' · no negative marking'}
              </span>
            </div>
            {current.question.text && <p className="exam-question__text">{current.question.text}</p>}
            {current.question.imageUrl && (
              <img
                className="exam-question__image"
                src={assetUrl(current.question.imageUrl)}
                alt={current.question.text ? '' : 'Question image'}
              />
            )}
            {current.question.type === 'MULTI' && (
              <p className="exam-question__hint">Select all that apply.</p>
            )}
            <fieldset
              className="exam-options"
              aria-label={current.question.type === 'SINGLE' ? 'Choose one answer' : 'Choose all that apply'}
            >
              <legend className="sr-only">Your answer</legend>
              {current.question.options.map((option, i) => {
                const checked = selectedOptionIds.includes(option.optionId);
                return (
                  <label key={option.optionId} className={`exam-option${checked ? ' exam-option--selected' : ''}`}>
                    <input
                      type={current.question.type === 'SINGLE' ? 'radio' : 'checkbox'}
                      name={current.question.type === 'SINGLE' ? `question-${current.question.questionId}` : undefined}
                      checked={checked}
                      onChange={() => toggleOption(current.question, option.optionId)}
                      aria-label={option.text ?? `Option ${LETTERS[i] ?? i + 1}`}
                    />
                    {option.imageUrl && (
                      <img className="exam-option__image" src={assetUrl(option.imageUrl)} alt="" />
                    )}
                    {option.text && <span className="exam-option__text">{option.text}</span>}
                  </label>
                );
              })}
            </fieldset>

            <div className="exam-actions">
              <Button variant="ghost" onClick={() => toggleMark(current.question)}>
                {isCurrentMarked ? 'Unmark for review' : 'Mark for review'}
              </Button>
              <div className="exam-nav">
                <Button variant="secondary" onClick={() => goToQuestion(safeIndex - 1)} disabled={safeIndex === 0}>
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => goToQuestion(safeIndex + 1)}
                  disabled={safeIndex === flat.length - 1}
                >
                  Next
                </Button>
              </div>
            </div>
          </section>
        </Card>

        <aside className="exam-palette">
          <Card>
            <h2 className="section-title">Questions</h2>
            <div className="exam-palette__grid">
              {flat.map(({ question }, i) => {
                const isAnswered = (answers[question.questionId]?.selectedOptionIds.length ?? 0) > 0;
                const isMarked = answers[question.questionId]?.isMarked ?? false;
                const isCurrent = i === safeIndex;
                return (
                  <button
                    key={question.questionId}
                    type="button"
                    className={`exam-palette-btn${isAnswered ? ' exam-palette-btn--answered' : ''}${isMarked ? ' exam-palette-btn--marked' : ''}${isCurrent ? ' exam-palette-btn--current' : ''}`}
                    aria-label={paletteLabel(i + 1, { isAnswered, isMarked, isCurrent })}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => goToQuestion(i)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="exam-legend">
              <span className="exam-legend__item">
                <span className="exam-legend__swatch exam-legend__swatch--answered" /> Answered
              </span>
              <span className="exam-legend__item">
                <span className="exam-legend__swatch exam-legend__swatch--marked" /> Marked
              </span>
              <span className="exam-legend__item">
                <span className="exam-legend__swatch exam-legend__swatch--current" /> Current
              </span>
            </div>
          </Card>
        </aside>
      </main>

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!confirmSubmitting) setConfirmOpen(false);
        }}
        title="Submit exam?"
        id="exam-submit-modal"
      >
        <p>Submit this exam? You won't be able to change your answers afterwards.</p>
        {submitError && (
          <div className="banner banner--error" role="alert">
            <p className="banner__text">{submitError}</p>
          </div>
        )}
        <div className="modal__footer">
          <Button variant="secondary" disabled={confirmSubmitting} onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button loading={confirmSubmitting} onClick={() => void handleConfirmSubmit()}>
            Submit exam
          </Button>
        </div>
      </Modal>

      <Modal
        open={warning !== null && !autoSubmitted}
        onClose={() => {
          // FULLSCREEN_EXIT offers only two choices: re-enter fullscreen or
          // exit the exam. Esc/✕ must not dismiss it while out of fullscreen.
          if (confirmSubmitting || warning?.type === 'FULLSCREEN_EXIT') return;
          setWarning(null);
        }}
        title={warning ? `Warning ${warning.count} of ${MAX_WARNINGS}` : 'Warning'}
        id="exam-warning-modal"
      >
        {warning && (
          <>
            <p>{WARNING_MESSAGES[warning.type]}</p>
            <p>{MAX_WARNINGS} violations auto-submit your exam.</p>
            {warning.type === 'FULLSCREEN_EXIT' && (
              <p>Return to fullscreen to continue, or exit the exam to submit.</p>
            )}
            {warning.type === 'FULLSCREEN_EXIT' && submitError && (
              <div className="banner banner--error" role="alert">
                <p className="banner__text">{submitError}</p>
              </div>
            )}
            <div className="modal__footer">
              {warning.type === 'FULLSCREEN_EXIT' ? (
                <>
                  <Button variant="secondary" disabled={confirmSubmitting} onClick={enterFullscreen}>
                    Enter fullscreen
                  </Button>
                  <Button loading={confirmSubmitting} onClick={() => void handleConfirmSubmit()}>
                    Exit exam
                  </Button>
                </>
              ) : (
                <Button onClick={() => setWarning(null)}>Continue exam</Button>
              )}
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={autoSubmitted}
        onClose={() => navigate(resultRoute, { replace: true })}
        title="Exam auto-submitted"
        id="exam-autosubmit-modal"
      >
        <p>
          You reached {MAX_WARNINGS} violations, so your exam was automatically submitted. You can now view
          your result.
        </p>
        <div className="modal__footer">
          <Button variant="ghost" onClick={() => navigate('/student', { replace: true })}>
            Back to tests
          </Button>
          <Button onClick={() => navigate(resultRoute, { replace: true })}>View result</Button>
        </div>
      </Modal>
    </div>
  );
}

export default function ExamRunner() {
  const { testId = '', attemptId = '' } = useParams();
  const navigate = useNavigate();

  const attemptQuery = useQuery({
    queryKey: ['student', 'attempt', attemptId],
    queryFn: () => api.student.attempt(attemptId),
    retry: false,
    // The exam snapshot is static once started; refetching on every
    // alt-tab return (which Phase 6 anti-cheat makes frequent) is pure waste.
    refetchOnWindowFocus: false,
  });

  const status = attemptQuery.data?.attempt.status;

  useEffect(() => {
    if (status === 'SUBMITTED' || status === 'TIMED_OUT') {
      navigate(`/student/tests/${testId}/result/${attemptId}`, { replace: true });
    } else if (status === 'GATED') {
      navigate(`/student/tests/${testId}/instructions`, { replace: true });
    }
  }, [status, testId, attemptId, navigate]);

  if (attemptQuery.isPending) {
    return (
      <div className="route-loading" role="status" aria-label="Loading your exam">
        <Spinner label="Loading your exam" />
      </div>
    );
  }

  if (attemptQuery.isError) {
    if (attemptQuery.error instanceof ApiError && attemptQuery.error.code === 'TEST_NOT_AVAILABLE') {
      return (
        <div className="exam-shell">
          <div className="exam-error">
            <ErrorState
              title="This test is no longer available."
              message="Your instructor deleted or unpublished the test, so this exam has been stopped."
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
    return (
      <div className="exam-shell">
        <div className="exam-error">
          <ErrorState
            title="Unable to load your exam."
            message="Please try again. If the problem persists, return to your tests."
            onRetry={() => void attemptQuery.refetch()}
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

  const attempt = attemptQuery.data?.attempt;
  if (!attempt || attempt.status !== 'IN_PROGRESS') {
    return (
      <div className="route-loading" role="status" aria-label="Loading your exam">
        <Spinner label="Loading your exam" />
      </div>
    );
  }

  return <Exam attempt={attempt} attemptId={attemptId} testId={testId} />;
}