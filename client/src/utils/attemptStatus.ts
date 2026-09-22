import type { BadgeVariant } from '@/components/ui/Badge';

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