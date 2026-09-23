# Task A report — Backend: Phases 10 + 11 server work

Status: **DONE**
Branch: `feature/resources-and-student-portal`
Commit: `1445fd0` (`feat(server): study resources CRUD and student portal endpoints (Phases 10+11)`)
Date: 2026-09-23

## Problem

Server work for two features:
- **A1 — Study Resources (Phase 10):** new `Resource` model, admin CRUD (`POST/GET/DELETE /api/admin/resources`), student list (`GET /api/student/resources`).
- **A2 — Student portal (Phase 11):** `GET /api/student/attempts` (own attempts, newest-first, capped 200) and `PATCH /api/student/profile` (name / password change with argon2 verify), both returning DTOs that are the client wire contract.

## Findings

- Existing patterns confirmed: `authenticate` + `requireRole('ADMIN'|'STUDENT')` already mounted at router level in `admin.ts`/`student.ts`; zod → 400 flat `details:[{field,message}]` via `errorHandler`; IDOR → 404; error shape `{ error: { code, message, details? } }`.
- `TestAttempt` has **no** `createdAt` (verified in `models/TestAttempt.ts`) — student attempts list follows the admin pattern: `sort({ _id: -1 }).limit(200)` with a `ponytail:` no-cursor comment.
- `Resource` DOES have `timestamps: true` (per brief), so resource lists sort `{ createdAt: -1, _id: -1 }` (the `_id` tie-break makes same-millisecond creates deterministic while still being "newest-first by createdAt").
- `/auth/me` shape: `auth.ts` `authBody` = `{ user: { id, email, name, role }, sessionExpiresAt }`, role is the raw uppercase DB enum. Replicated exactly.
- `User.passwordHash` is `select:false` — profile route uses `findById(...).select('+passwordHash')` (brief requirement).
- Baseline test count was **113** (not 106 as the brief estimated); suite is now **127** (8 resources + 6 portal).

## Changes / Design

### A1 — Study Resources
- **`server/src/models/Resource.ts`** (new): `title` (required, trim, 1–120), `description` (optional, ≤500), `kind` enum `['PDF','ZIP','IMAGE','OTHER']` (required), `driveUrl` (required), `createdBy` (ObjectId ref `User`, required), `timestamps: true`.
- **`server/src/routes/admin.ts`**:
  - `POST /api/admin/resources` — zod body (`title` min1/max120 trim, `description` optional max500, `kind` enum, `driveUrl` `.url()`); 201 `{ resource: { id, title, description, kind, driveUrl, createdAt, createdBy } }`; zod issues → 400 flat details via existing errorHandler.
  - `GET /api/admin/resources` — management list, newest-first, `{ resources: [...] }` (same DTO incl. `createdBy`).
  - `DELETE /api/admin/resources/:id` — `findByIdAndDelete`; missing → 404 `NOT_FOUND`; success → 204. (Bad id format → 400 `INVALID_ID` via existing CastError handling, same as other admin routes.)
- **`server/src/routes/student.ts`**:
  - `GET /api/student/resources` — any authenticated student; newest-first; DTO **without** `createdBy`: `{ id, title, description, kind, driveUrl, createdAt }`, wrapped `{ resources: [...] }`.

### A2 — Student portal
- **`GET /api/student/attempts`** — `TestAttempt.find({ studentId }).sort({ _id: -1 }).limit(200)` (`ponytail:` no cursor yet); live `Test` docs fetched once into a map (deleted-test tolerant → `testTitle: ''`, matching admin attempts pattern). DTO per attempt, exact keys: `{ attemptId, testId, testTitle, status, marksEarned, totalMarks, percent, date }` where `marksEarned = score ?? 0`, `totalMarks = maxScore ?? 0`, `percent = totalMarks > 0 ? Math.round((marksEarned/totalMarks)*100) : 0`, `date = (submittedAt ?? startedAt ?? _id.getTimestamp()).toISOString()`. All statuses included (GATED/IN_PROGRESS/SUBMITTED/TIMED_OUT).
- **`PATCH /api/student/profile`** — zod body all-optional with `superRefine`: at least one of `name`/`newPassword` required (issue at `name` path: "Provide a name or a new password."); `newPassword` requires `currentPassword` (issue at `currentPassword`: "Current password is required."). `name` trim min1, `currentPassword` min1, `newPassword` min8. On `newPassword`: argon2.verify against `+passwordHash`; mismatch → 400 `INVALID_CREDENTIALS` "Current password is incorrect."; success → rehash argon2id + save. `name` updated only if present and differs. Response = exact `/auth/me` shape `{ user: { id, email, name, role }, sessionExpiresAt }` (sessionExpiresAt from the latest live RefreshSession, same query as `/auth/me`). Refresh sessions NOT revoked (`ponytail:` comment — hard-revoke later if required).

### Tests (new, additive — no existing test modified)
- **`server/tests/resources.test.ts`** (8): admin create → 201 + exact DTO keys; student→admin 403 (POST/GET/DELETE); missing title → 400 flat `{field:'title'}`; bad kind → 400; non-URL driveUrl → 400; admin list newest-first + createdBy; delete → 204 then 404; student list exact 6-key DTO, no `createdBy` in the JSON, newest-first.
- **`server/tests/student-portal.test.ts`** (6): own attempts empty-list + newest-first + exact DTO keys + percent math (SUBMITTED 2/2 → 100, GATED → 0); cross-student scoping; profile name patch → `/auth/me` shape; password change with correct current → 200 + new password logs in / old fails; wrong current → 400 `INVALID_CREDENTIALS`; bad bodies (empty, short newPassword) → 400 flat details.

## Trade-offs

- `sort({ createdAt: -1, _id: -1 })` adds a deterministic tie-break over the bare brief sort — strictly monotonic, same visible ordering, no flaky same-ms ordering in tests.
- `description` serialized as `null` when absent (stable key for the client wire contract) rather than omitted.
- Single commit instead of two: A1 and A2 both touch `student.ts`, so splitting would leave the intermediate commit failing its own tests (AGENTS.md: never commit untested code).

## Tests

- `cd server && npm test` → **127 passed (127)** across 10 files (113 pre-existing + 8 resources + 6 student-portal).
- `cd server && npm run build` → **tsc strict clean** (exit 0).

## Remaining risks

- Attempts list and admin resource list have no cursor pagination beyond their caps (documented `ponytail:` comments — add `?cursor=` when volume grows).
- Password change intentionally leaves refresh sessions valid (`ponytail:` in code — hard-revoke later if required).
- No `Resource` edit endpoint (per brief: delete + re-add covers typos); no publish/staging gating (created = visible).
- `sessionExpiresAt` on profile PATCH mirrors `/auth/me` but does not rotate the access token (user continues with existing cookies — intended).
- Report and commit only. No merge/push performed (per instructions). `context.md` and `docs/` were already modified/untracked before this task — left untouched.