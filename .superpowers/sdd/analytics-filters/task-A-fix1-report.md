# Task A Fix 1 Report — Analytics Filters

Commit: `125cb32` — fix(client): scope analytics live region and keep picker mounted while loading

## Nits addressed

### Nit 1 — over-broad live region (analytics.tsx)
- Replaced the `<div role="status" aria-live="polite">` wrapper that enclosed the entire
  results tree with a concise sr-only status inside the results branch:
  `<p className="sr-only" role="status" aria-live="polite">Results updated for <selection></p>`.
- The summary stats, score distribution, per-question tables, and violations are no longer
  inside a live region; only the short status line is announced. Follows the existing
  `sr-only` + `role="status"` convention (see ExamRunner).
- Selection label mirrors picker state: test title when filtered, "all tests" otherwise.

### Nit 2 — full-page spinner on every selection
- Page-level `route-loading` spinner now only guards the FIRST load (`testsQuery.isPending`).
- Analytics re-fetches no longer unmount the page: the filter section (search, range,
  picker rows) stays mounted while `analyticsQuery.isPending`, and the results area shows a
  compact centered `<Spinner label="Loading analytics" />` in a new `.results-loading`
  container instead. Query keys and data flow unchanged.
- Existing "filters survive error" behavior untouched; a new test proves filters also
  survive loading.

### Nit 3 — zero-tests picker hint
- `No tests match …` hint now requires non-empty search text (`search && visibleTests.length === 0`),
  so a system with zero tests and a clean search box no longer shows a misleading hint.

## Tests (client/src/__tests__/Analytics.test.tsx)
- New: "announces result swaps with a concise live region, not the full results" — asserts
  the `role="status"` element is sr-only, contains `Results updated`, and does NOT contain
  stat values / table data / headings; stats are still rendered outside the region.
- New: "keeps the picker mounted while analytics load, showing a compact loading state" —
  with a never-settling analytics fetch, asserts search input + All tests + test rows remain
  present and the results area shows `Loading analytics` with no stale results.
- New: "does not show the no-match hint for an empty search when there are zero tests".
- Extended: "filters the test picker list by title search" — asserts no hint on empty search,
  hint present only for a search that matches nothing.

All 110 client tests pass (107 existing + 3 new). TDD: new tests written first, confirmed
red against the old code, then implementation made them green.

## Build / typecheck
- `npm run build` — clean (vite build OK, 119 modules).
- `npm run typecheck` — clean.

## Files changed
- client/src/pages/admin/analytics.tsx
- client/src/styles/global.css (added `.results-loading`)
- client/src/__tests__/Analytics.test.tsx

No server/, docs/, or .superpowers/ changes (report file excepted per brief).

## Remaining improvements (non-blocking)
- The sr-only status could also announce the pending phase ("Loading results for …") if
  per-item loading speech is desired; the compact Spinner already announces "Loading
  analytics" via its own `role="status"`, so a second pending announcement would double-fire.