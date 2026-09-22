/** Formats a percentage for display, returning an em dash for missing/NaN values. */
export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Math.round(n)}%`;
}

/** Formats an ISO timestamp for display (e.g. "Jan 1, 2026, 12:00 AM"). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}