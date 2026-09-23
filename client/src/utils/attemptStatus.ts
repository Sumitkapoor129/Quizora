import type { BadgeVariant } from '@/components/ui/Badge';
import type { StudentTestListItem } from '@/types';

export const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  GATED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  TIMED_OUT: 'Timed out',
};

export const ATTEMPT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  GATED: 'default',
  IN_PROGRESS: 'accent',
  SUBMITTED: 'success',
  TIMED_OUT: 'warn',
};

/** Per-test CTA, shared by the Dashboard and Tests pages. */
export function attemptAction(test: StudentTestListItem): { label: string; to: string } {
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

export function durationLabel(totalSec: number): string {
  return `${Math.round(totalSec / 60)} min`;
}