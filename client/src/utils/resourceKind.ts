import type { BadgeVariant } from '@/components/ui/Badge';

export interface ResourceKindMeta {
  label: string;
  variant: BadgeVariant;
}

const KIND_META: Record<string, ResourceKindMeta> = {
  PDF: { label: 'PDF', variant: 'default' },
  ZIP: { label: 'ZIP', variant: 'default' },
  IMAGE: { label: 'Image', variant: 'accent' },
  OTHER: { label: 'Other', variant: 'default' },
};

/**
 * Badge label/variant for a resource kind. Unknown kinds fall back to
 * OTHER/default so a badge never crashes on server drift.
 */
export function resourceKind(kind: string): ResourceKindMeta {
  return KIND_META[kind] ?? KIND_META.OTHER;
}