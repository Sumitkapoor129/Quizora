# Task D brief — UI: Phases 10 + 11 client work

Repo: C:\Users\91983\Desktop\VibeCoded\forms (branch feature/resources-and-student-portal). Read AGENTS.md (frontend design guidelines authoritative), context.md §7 items 10-11, and — MOST IMPORTANTLY — the approved UX spec:

C:\Users\91983\Desktop\VibeCoded\forms\docs\ux\phase10-11-student-portal-and-resources.md

The UX spec is your design contract. Implement it faithfully (it already specifies exact copy, CSS classes, tokens, empty/loading/error states, a11y). Do NOT reuse the Phase 1 UX doc (deleted on this branch); the new spec is the only design authority.

Also read: C:\Users\91983\Desktop\VibeCoded\forms\docs\research\drive-links.md (external-link security notes: `target="_blank"` + `rel="noopener noreferrer"` + sr-only new-tab disclosure; store link as opaque string, never fetch).

You are the UI subagent. Work ONLY in client/. Never touch server/ or docs/. Do NOT dispatch subagents.

## Backend wire contract (ALREADY BUILT + committed as 1445fd0 — match exactly; do not emulate old-shape guesses)

### Resources
- Admin `POST /api/admin/resources` body `{ title, description?, kind, driveUrl }` → 201 `{ resource: { id, title, description (string|null), kind, driveUrl, createdAt, createdBy } }`. zod 400 details `[{field,message}]` (error messages: `Resource title is required.`, `Resource title must be at most 120 characters.`, `Description must be at most 500 characters.`, `Kind must be one of PDF, ZIP, IMAGE, or OTHER.`, `Enter a valid URL.`).
- Admin `GET /api/admin/resources` → `{ resources: [...] }` newest-first, includes createdBy.
- Admin `DELETE /api/admin/resources/:id` → 204 (404 on missing `NOT_FOUND`).
- Student `GET /api/student/resources` → `{ resources: [{ id, title, description (string|null), kind, driveUrl, createdAt }] }` — NO createdBy, newest-first.
- `createdAt` ISO string present on both.

### Student portal
- `GET /api/student/attempts` → `{ attempts: [{ attemptId, testId, testTitle, status, marksEarned, totalMarks, percent, date }] }` — own attempts, newest-first (date ISO). status ∈ GATED|IN_PROGRESS|SUBMITTED|TIMED_OUT. percent server-rounded (may be 0 for unscored). testTitle may be '' for deleted tests.
- `PATCH /api/student/profile` body: at least one of `{ name?, currentPassword?, newPassword? }`. newPassword requires currentPassword. 400 `INVALID_CREDENTIALS` ("Current password is incorrect.") on wrong current. Response = `/auth/me` shape `{ user: { id, email, name, role }, sessionExpiresAt }`. Role in DB is uppercase enum; client maps lowercase (see api/client.ts mapRole).

## Task D1 — Study Resources client (Phase 10)

Per UX spec §1. Files:
- Create `client/src/utils/resourceKind.ts` — kind → {label, variant} map (PDF/ZIP/IMAGE/OTHER; IMAGE=accent, rest default; unknown → OTHER/default).
- Create `client/src/types/` additions: `ResourceKind`, `Resource`, `ResourceListResponse`, `CreateResourceInput`, `StudentAttemptSummary`, `StudentAttemptsResponse`, `ProfileUpdateInput`, `ProfileUpdateResponse`.
- `client/src/api/client.ts`: add `admin.resources.list/create/remove` + `student.resources()` + `student.attempts()` + `student.profile.update()`. Follow existing request/mutation patterns (no new patterns). `description` from server is `string | null` — normalize to `string | undefined` at the api layer if convenient.
- Admin page `client/src/pages/admin/resources/ResourceList.tsx` (+ styles reuse) per §1.2: page header + Add resource modal (title/description/kind/driveUrl via Field/TextareaField/SelectField) + list rows (title, kind badge, one-line description, `Open link` external, Delete button w/ per-row loading) + delete confirm modal + `banner--success` success feedback + empty state + loading skeletons + ErrorState.
- Student page `client/src/pages/student/Resources.tsx` per §1.3: header + `card-grid` of `resource-card`s (title, kind badge, description, Open external button-link) + loading + empty + error.
- Wire routes: `/admin/resources` (admin ProtectedRoute children) + `/student/resources` (student children).
- Wire nav: ADMIN_NAV + STUDENT_NAV in AppLayout.

## Task D2 — Student portal client (Phase 11)

Per UX spec §2 (sidebar IA, Dashboard rewrite, Tests extraction, My Tests, Profile). Files:
- `AppLayout.tsx`: remove `isAdmin` gate — both roles get the sidebar/drawer machinery verbatim (hamburger + aside.sidebar + Escape/trap/focus-return/backdrop/suppressFocusRestore), with role-specific `aria-label` + aside id (`admin-nav`/`student-nav`). Drop the student `nav-row` branch (nav always `sidebar__nav`). Drop `isAdmin`-only hamburger. New nav definitions:
  - STUDENT_NAV: Dashboard `/student` (end), Profile `/student/profile` (end:false), My Tests `/student/results` (end:false), Tests `/student/tests` (end:false), Resources `/student/resources` (end:false).
  - ADMIN_NAV unchanged + append `{ to: '/admin/resources', label: 'Resources', end: false }`.
- `routes/index.tsx`: student children: index=Dashboard (rewritten), `profile`, `results` (replace Placeholder → MyTests), `tests` (Tests grid), `resources`. Add a routes test hitting `/student/tests` expecting the list page (not the exam guard) — UX spec §3 collision note.
- `pages/student/Dashboard.tsx` rewrite per §2.2: `Promise.all` of tests/attempts/resources; `stat-grid stat-grid--4` strip (Tests available / Tests taken / Average score — `—` when zero / In progress — Resume link when >0); Recently added tests (top 3 test-cards + `View all tests` footer); Recently added resources (top 3 resource-cards + `View all resources` footer); both empty states with their headings always present; per-section error degradation.
- `pages/student/Tests.tsx` per §2.3: extract existing available-tests grid verbatim (test-card + attemptAction helper), page header, loading/empty (both variants)/error.
- `pages/student/MyTests.tsx` per §2.4: table (Test / Status badge / Score marksEarned/totalMarks — for unscored, / Percent / Result link per status). Uses `ATTEMPT_STATUS_LABEL`/`ATTEMPT_STATUS_VARIANT` + `formatDateTime`.
- `pages/student/Profile.tsx` per §2.5: Account section (name) + Change password section (current/new/confirm), server 400 mapping, `form-success` role=status messages, no logout on password change.
- CSS: add ONLY `stat-grid--4`, `resource-card`, `banner--success`, `form-success` per spec §2.6 + §1.2/§2.2 (all from existing tokens). Respect current `stat-grid` (3-col); `stat-grid--4` = `repeat(auto-fit, minmax(210px, 1fr))`.
- Reuse `attemptAction` + `ATTEMPT_STATUS_*` from existing `utils/attemptStatus.ts` (already exists — don't recreate). Move it where needed (Dashboard → shared) WITHOUT breaking existing tests.

## TDD requirement (codebase convention — vitest + Testing Library, jsdom)
Existing tests: `client/src/__tests__/*.test.tsx`. Follow their patterns. Add/update:
- `Resources.test.tsx` (student preview render + admin add modal validation + delete confirm flow) ~5 tests.
- `Dashboard.test.tsx` update for new strip + recent sections (keep existing passing behavior).
- `MyTests.test.tsx` ~3 (row rendering per status, empty).
- `Profile.test.tsx` ~4 (name update, password mismatch client-side, wrong-current server 400 mapping, success message).
- `Tests.test.tsx` ~3 (grid render, empty, completed-all empty variant).
- `routes.test.tsx` update for new student/admin routes + `/student/tests` collision test.
Every test must assert real behavior (not mocks-only smoke). Update the QueryClient/ms-window mock as needed to cover new endpoints (see how existing tests stub api).

## Verification (you MUST run before reporting)
- `cd client && npm test` — all pass (existing + new).
- `cd client && npm run build` — clean.
- `cd client && npm run typecheck` — clean.
- Bundle: no new dependencies.

Commit your work on feature/resources-and-student-portal with conventional commits. Do NOT merge or push.

## Report
Write full report to: C:\Users\91983\Desktop\VibeCoded\forms\.superpowers\sdd\resources-and-student-portal\task-D-report.md
Return ONLY: status (DONE/DONE_WITH_CONCERNS/BLOCKED), commit hashes, one-line npm test summary, one-line build + typecheck result, concerns.