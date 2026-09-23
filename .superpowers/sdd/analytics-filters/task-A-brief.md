# Task A brief — analytics click-to-test + filters

Feature branch: feature/analytics-filters (base: main @ 584de24)
Implementer: backend subagent

## Requirement (user verbatim)
> the analytics in admin is good but it will become a mess when i have 100 tests,
> make it so that i click on the test i want analytics,
> also, add filters in places you think it can fit in.

## Scope

### 1. Analytics — click-to-test (primary ask)
Today `/admin/analytics` (client/src/pages/admin/analytics.tsx) filters by test via a single
`<select>` dropdown (line ~157-172, `Filter by test`). With 100 tests a dropdown is unusable.
Replace with a **searchable, clickable test picker**:
- Search input (by test title) + a clickable list of matching tests (styles from the existing
  `.tests-list` / `.test-row` / `.filter-field` system — NO new components, NO design drift).
- Clicking a test loads its analytics (sets testId → `api.admin.analytics(testId)`).
- A clear "All tests" option returns to the aggregate view.
- Keep state-based selection (no URL param needed) unless trivially free; prefer minimal diff.

Add a **date-range filter** on the analytics page (Last 7 days / Last 30 days / All time) that
passes `from` to the API. This is the one place a server-side filter is genuinely required
(analytics aggregates scored attempts).

### 2. Server filters (minimal, additive, backward-compatible)
- `GET /api/admin/analytics` (server/src/routes/admin.ts:765): accept optional `from` and `to`
  ISO date query params (zod-validated; invalid → 400). Apply as a `submittedAt` range that
  AND-combines with the existing `testId` filter on the scored-attempts query. `attemptsToday`
  stays a last-24h stat unchanged. Empty/absent params = no change (today's default behavior
  preserved).
- `GET /api/admin/attempts` (server/src/routes/admin.ts:703): accept optional `status` param
  (one of GATED/IN_PROGRESS/SUBMITTED/TIMED_OUT). Apply the filter BEFORE the `.limit(200)`
  so the cap reflects only matching attempts. `testId` param stays as-is.
- `GET /api/admin/tests` (server/src/routes/admin.ts:525): NO server change required. The
  admin Tests list already loads the full list; filter client-side (see item 3).

### 3. Filters in other admin places (client-side where data is already loaded)
- **Admin Tests list** (client/src/pages/admin/tests/List.tsx): add a search box (title) and a
  status filter (Draft/Published/Archived x All). Client-side `useMemo` over the already-fetched
  `tests`. Respect existing empty state when a filter yields nothing.
- **Admin Attempts list** (client/src/pages/admin/attempts/AttemptsList.tsx): add a status
  select (server param, per item 2) and a test select (existing `testId` server param — reuse
  the tests list query already used elsewhere, keyed `['admin','tests']`). These must be
  server-side filters because the list is capped at 200.

## Design system constraints (from AGENTS.md frontend guidelines — mandatory)
- Zero new npm dependencies in client or server.
- Reuse existing primitives/components: `Card`, `Button`, `Badge`, `SelectField`, `Field`,
  `EmptyState`, `ErrorState`, `Spinner`, `.tests-list`, `.test-row`, `.filter-field`,
  `.filter-error`, `.page-heading`, `.section`, `.data-table`, `stat-grid`.
- No new visual language, colors, gradients, or loud effects. Restrained, professional, minimal.
- A11y: every filter is a labelled form control; the test picker is keyboard-accessible
  (search input + list of links/buttons need visible focus states); aria-live where async
  results swap; error/success use existing `role="alert"`/`role="status"` conventions.
- Server errors on filter params: 400 with the codebase's flat-details ApiError shape
  (`{ field, message }`), consistent with existing zod usage.

## Tests (required, run yourself)
- Server: extend `server/tests/` — analytics `from`/`to` (bounded window, missing params
  unchanged, invalid date → 400); attempts `status` filter (only matching statuses, cap
  applies after filter). Existing 129 must stay green.
- Client: update/extend `client/src/__tests__/Analytics.test.tsx` for the click-to-test picker,
  search, "All tests" return, and date-range filter driving the `from` param. Add test-coverage
  for the Tests-list and Attempts-list filters. Existing 102 must stay green.

## Verification (mandatory, run yourself)
- `cd server && npm test` (expect 129 + new, all green) and `npm run build` (tsc clean).
- `cd client && npm test` (expect 102 + new, all green), `npm run build`, `npm run typecheck`.

## Commit
Commit on `feature/analytics-filters` with conventional messages, the shortest set that
produces a coherent history (server API change + tests, then client change + tests). Do NOT
merge or push.

## Report
Write your full report to:
`.superpowers/sdd/analytics-filters/task-A-report.md`
Return ONLY: status (DONE/BLOCKED), commit hashes, one-line server+client test summaries,
one-line build/typecheck results, decisions+concerns.