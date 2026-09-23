# Task A brief — Backend: Phases 10 + 11 server work

Repo: C:\Users\91983\Desktop\VibeCoded\forms (branch feature/resources-and-student-portal). Read AGENTS.md and context.md first, then this brief. You are the BACKEND subagent; do NOT dispatch other subagents, do NOT touch client/ or docs/. Work only in server/.

## Context (from context.md)
Production MCQ exam platform, Node 24 + Express + Mongoose + zod, TS strict ESM (NodeNext), vitest + supertest. Existing models: User, RefreshSession, Test, TestAttempt. Router mounting in src/app.ts. `authenticate` + `requireRole('ADMIN'|'STUDENT')` middleware in src/middleware/auth.ts. Error shape everywhere: `{ error: { code, message, details? } }`; zod → 400 flat details [{field,message}]; IDOR → 404.

## Task A1 — Study Resources (Phase 10, server part)

### New model: server/src/models/Resource.ts
- `title`: String, required, trim, 1–120 chars.
- `description`: String, optional, ≤500 chars.
- `kind`: enum `['PDF','ZIP','IMAGE','OTHER']`, required.
- `driveUrl`: String, required (valid http(s) URL).
- `createdBy`: ObjectId ref 'User', required.
- `timestamps: true` (this model HAS createdAt — newest-first ordering by createdAt desc; do NOT follow the _id-ordering convention of TestAttempt).

### Admin routes (add to server/src/routes/admin.ts, which already mounts `authenticate` + `requireRole('ADMIN')` at router level)
- `POST /api/admin/resources` — zod body: title (min1 max120), description (optional, max500), kind (enum), driveUrl (url()). 201 → `{ resource: { id, title, description, kind, driveUrl, createdAt, createdBy } }`. 400 → flat zod details.
- `GET /api/admin/resources` — management list, newest-first (createdAt desc), same DTO shape, wrapped `{ resources: [...] }`.
- `DELETE /api/admin/resources/:id` — 404 `NOT_FOUND` on missing; 204 on success.

### Student route (add to server/src/routes/student.ts, which mounts `authenticate` + `requireRole('STUDENT')`)
- `GET /api/student/resources` — any authenticated student; newest-first (createdAt desc); DTO `{ id, title, description, kind, driveUrl, createdAt }`, wrapped `{ resources: [...] }`. Students see NO `createdBy` on this list.

## Task A2 — Student portal server (Phase 11, server part)

### `GET /api/student/attempts` in src/routes/student.ts
- Returns the calling student's OWN attempts, newest-first. Sort by `_id` desc (TestAttempt has no createdAt — see admin attempts list pattern in admin.ts). Cap at 200 (`ponytail:` no cursor yet).
- DTO per attempt: `{ attemptId, testId, testTitle, status, marksEarned, totalMarks, percent, date }` where:
  - `testTitle` from the live Test doc (`Test.findById(attempt.testId)`), tolerant of deleted tests → '' (follow the admin attempts pattern for deleted-test tolerance).
  - `marksEarned = attempt.score ?? 0`, `totalMarks = attempt.maxScore ?? 0`.
  - `percent = totalMarks > 0 ? round((marksEarned / totalMarks) * 100) : 0`.
  - `date = (attempt.submittedAt ?? attempt.startedAt ?? attempt._id.getTimestamp())` as ISO string. For GATED/IN_PROGRESS use startedAt ?? _id timestamp.
- Include ALL statuses (GATED, IN_PROGRESS, SUBMITTED, TIMED_OUT) — the "My Tests" page and dashboard stats need the full picture.
- Wrapped `{ attempts: [...] }`.

### `PATCH /api/student/profile` in src/routes/student.ts
- Body (zod, all optional, at least one required): `name` (trim min1), `currentPassword` (min1), `newPassword` (min8).
- Rules: if `newPassword` present, `currentPassword` is REQUIRED and must verify against the user's argon2 hash — 400 `INVALID_CREDENTIALS` "Current password is incorrect." on mismatch. On success rehash with argon2id and save.
- If `name` present (and differs), update it.
- Response: same shape as `GET /api/auth/me` → `{ user: { id, email, name, role }, sessionExpiresAt }`. Look at how auth.ts builds authBody — replicate exactly (`role` stays uppercase enum server-side).
- Do NOT revoke refresh sessions on password change (`ponytail:` hard-revoke later if required).
- Needs `User` findById + `.select('+passwordHash')` for the verify.
- NOTE: user role is enum `'ADMIN'|'STUDENT'` uppercase in the DB. `/auth/me` returns role as the raw uppercase string (client maps lowercase). Match that.

## Tests (vitest + supertest, against mongodb-memory-server — see existing tests in server/tests/)

Create NEW files (do not modify existing tests unless a breakage requires it):
- `server/tests/resources.test.ts` (~8 tests):
  1. admin create → 201 + correct DTO;
  2. admin list newest-first ordering (create 2, assert order);
  3. student token hitting admin resource routes → 403;
  4. admin create missing title → 400 with field detail;
  5. admin create bad kind → 400;
  6. admin create non-url driveUrl → 400;
  7. delete → 204 then 404 on second delete;
  8. student GET resources → only title/desc/kind/driveUrl/createdAt, NO createdBy leaked, newest-first.
- `server/tests/student-portal.test.ts` (~6 tests):
  1. student GET own attempts → newest-first, no attempts → empty list;
  2. only own attempts (2 students, assert scoping);
  3. profile patch name → updated + /auth/me shape;
  4. profile patch password with correct currentPassword → 200;
  5. profile patch password with wrong currentPassword → 400 INVALID_CREDENTIALS;
  6. bad body (both name+password missing, or short newPassword) → 400.

Look at existing test files (tests/student-exam.test.ts, tests/admin-attempts.test.ts) for the exact pattern: how they create users, log in, seed tests/attempts, build the app with `createApp`, and assert the error shape. Match helpers where sensible; do not over-engineer new helpers.

## Definition of done
- `cd server && npm test` — ALL tests pass (existing + new). Currently 106 tests; expect ~120.
- `cd server && npm run build` — tsc strict clean.
- Follow lint conventions (this codebase has no lint script; tsc + tests are the gate).
- API returns EXACTLY the DTO shapes above (they are the client wire contract).

## Report (write to the path below, return only status + commit hashes + test counts + concerns)
Write full report to: C:\Users\91983\Desktop\VibeCoded\forms\.superpowers\sdd\resources-and-student-portal\task-A-report.md
Return: DONE/DONE_WITH_CONCERNS + commits + `npm test` summary line + `npm run build` result.