# ExamPro — Build Context / Resume File

> Written to allow a fresh session to resume tomorrow. Read this first, then
> the AGENTS.md workflow in the repo root. Status reflects the last verified
> state of the workspace.

---

## 1. What we are building

Production online MCQ exam platform. Admin creates timed, multi-section tests;
students take them with server-authoritative timing, fullscreen anti-cheating
(3-warning auto-submit), restricted copy/paste, autosave, refresh recovery,
server-side scoring. Detailed admin results/analytics, simple student results.
Roles: ADMIN, STUDENT. RBAC enforced server-side.

## 2. Stack (LOCKED — do not revisit unless user changes their mind)

- **Repo:** `C:\Users\91983\Desktop\VibeCoded\forms` (greenfield; `git init` done, `main` branch, **0 commits**).
- **Backend** (`server/`): Node 24 + Express v4 + **Mongoose** + **MongoDB** (connection via `MONGODB_URI` env; user will provide an Atlas URI later). zod, argon2id (planned), jsonwebtoken, cookie-parser, helmet, cors, express-rate-limit, multer. TS strict, ESM (NodeNext), vitest + supertest.
- **Frontend** (`client/`): React 18 + Vite + TS strict, react-router-dom v6, @tanstack/react-query v5. **NO component/CSS library, NO Redux/global-store** — plain CSS design tokens + ~11 primitives + one AuthContext. vitest + Testing Library (jsdom).
- **No Docker, no Redis, no queues.** MongoDB is NOT installed locally (attempted install failed; only leftover `data/`/`log/` dirs) — run against the user's remote URI.
- **Machine facts:** Windows, Node v24.19.0, npm 11, PostgreSQL running on port 3008 (credentials unknown — **not used**, user chose MongoDB), Docker daemon down.

## 3. Database design (Mongoose, 4 collections — embedded, no relations/transactions)

Single-doc = whole entity. No multi-doc transactions needed: critical paths use
single-document atomic compare-and-set (`findOneAndUpdate` with status filter).

- **`User`** — email (unique idx, lowercase), passwordHash, name, role `ADMIN|STUDENT`.
- **`RefreshSession`** — userId, tokenHash (unique), previousTokenHash (replay detection), expiresAt, revokedAt.
- **`Test`** — status `DRAFT|PUBLISHED|ARCHIVED`, defaultNegativeMarks, deletedAt, embedded `sections[]` → each `{title, order, durationSec, negativeMarksOverride?, questions[]}` → each question `{type SINGLE|MULTI, order, text?, imageUrl?, marks, negativeMarks?, explanation?, options[]}` → option `{order, text?, imageUrl?, isCorrect}`.
- **`TestAttempt`** — status `GATED|IN_PROGRESS|SUBMITTED|TIMED_OUT`, warningCount, score fields, voided, embedded `sectionAttempts[]` (per-section `endAt` — server-set cumulative time windows), `answers[]` (questionId + selectedOptionIds), `events[]` (typed, capped, `FULLSCREEN_EXIT|COPY|PASTE|CUT|CONTEXT_MENU|VISIBILITY_HIDDEN|FOCUS_LOST|NETWORK_RECONNECT|START|SUBMIT`). Unique index `{testId, studentId}` = one attempt per student per test.

**Key integrity rules (baked into design, enforce in later phases):**
- Write-gate: every mutating exam op = atomic CAS (lock/claim via status filter) requiring `IN_PROGRESS` + deadline (now ≤ section `endAt`).
- Start = guarded `GATED→IN_PROGRESS` single transition; re-call idempotent.
- Submit / TIMED_OUT / 3rd violation = same CAS `IN_PROGRESS→SUBMITTED`; winner scores, losers get existing result (idempotent, no double-score).
- Lazy expiry on read (+ client heartbeat). Content freeze after first section start; escape hatch = duplicate test + attempt `voided`.
- Student question payload = DTO whitelist; **never** emit option `isCorrect` or question `explanation` to students.

## 4. API surface (defined; build per phase)

- Auth: `POST /api/auth/register|login|refresh|logout`, `GET /api/auth/me`.
- Admin: `/api/admin/tests` (+`:id`, sections, questions, reorder, publish/unpublish, image upload), `/api/admin/import/validate|confirm`, `/api/admin/attempts[:id]`, `/api/admin/students`, `/api/admin/tests/:id/analytics`.
- Student: `GET /api/student/tests`, `POST /api/student/tests/:id/attempts`, `POST /api/student/attempts/:id/start`, `GET /api/student/attempts/:id`, `PUT /api/student/attempts/:id/answers`, `POST /api/student/attempts/:id/events`, `POST /api/student/attempts/:id/submit`, `GET /api/student/attempts/:id/result`.
- Error shape everywhere: `{ error: { code, message, details? } }`. Codes: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), zod→400 with flat `details` `[{field,message}]`. IDOR → 404 (not 403).

## 5. Phase 1 progress (foundation)

### DONE + VERIFIED — `server/` ✅
- `server/package.json`, `tsconfig.json` (strict, NodeNext), `vitest.config.ts`, `.env`, `.env.example`, `README.md`.
- `src/config/env.ts` (zod env), `src/db/connect.ts`, `src/errors.ts` (AppError), `src/app.ts` (`createApp(mountRoutes?)`), `src/server.ts`.
- `src/models/{User,RefreshSession,Test,TestAttempt}.ts` — exact schema above.
- `src/middleware/{errorHandler,notFound,originCheck,auth}.ts` — `authenticate` (cookie `accessToken` JWT) + `requireRole`.
- Tests `server/tests/{health,db-harness}.test.ts` — **5/5 pass** (health, 404 shape, 401 shape, memory-server create + dup-email 11000). `npm run build` = tsc strict **passes**.
- `npm run dev` fails fast: "MONGODB_URI is required…" until a real URI is set. Tests need NO DB (mongodb-memory-server; mongod binary cached).
- Note: `e.preventDefault()` on default — boot does not block `/health` without DB.
- **Post-review hardening (pre-commit):** `User.passwordHash` + `RefreshSession.tokenHash` → `select:false`; `Test.questionSchema.order` → required; `auth.ts` jwt.verify pinned to HS256; `env.ts` fails fast if production + `COOKIE_SECURE !== true`.

### DONE + VERIFIED — `client/` ✅ (re-verified session 2026-09-20)
`npm run build` (tsc -b + vite) exit 0; `npm test` 3 files / 7 tests PASS
(Field ×2, routes ×3, Login ×2); `npm run typecheck` exit 0. No fixes needed.
**Post-review hardening (pre-commit):** `api/client.ts` `...init` spread order fixed (header merge no longer clobbered); Login/Register `safeNext` no longer double-decodes `next`.

Tree: `api/client.ts`, `context/AuthContext.tsx` (stub: localStorage role), `hooks/useAuth.ts`, `routes/index.tsx` (+`ProtectedRoute` guard), `pages/{auth/Login,auth/Register,student/Dashboard,admin/Dashboard,NotFound,Placeholder}.tsx`, `components/layout/AppLayout.tsx`, `components/ui/{Button,Field,Card,Badge,Spinner,EmptyState,ErrorState,Modal}.tsx`, `styles/{tokens,global}.css`, `types/index.ts`, `test/setup.ts`, `__tests__/{Field,Login,routes}.test.tsx`.

### Pre-commit review (2026-09-20) — deferred follow-ups → Phase 2
No Critical findings. Resolved before commit: see hardening bullets above. Deferred:
- **Admin mobile drawer a11y** (`AppLayout.tsx`): closed sidebar links stay keyboard-focusable; missing Escape-to-close, focus trap/mgmt. Fix during shell work before real users.
- **Spec drift (minor):** Register lacks demo role selector; logged-in visit to `/login` does not redirect to role home; validation never focuses first invalid field.
- **Modal primitives:** hard-coded `aria-labelledby="modal-title"` (dup ids if 2 modals), placeholder focus trap — revisit when Modal gets real callers.
- **Secrets:** `.env.example` `change-me` values pass zod presence-only check; add min-length (≥32) when Phase 2 lands.

### DONE — `docs/ux/phase1-auth-and-shell.md` ✅
Full approved UX spec: auth copy/validation table, session-expiry banner pattern, app shell IA, student/admin dashboard empty states, A11y checklist, later-phase rules (exam = shell-free full-screen route, role-separated route trees, confirm-before-destroy, session-banner app-wide, server-authoritative timers).

### DONE + VERIFIED — Phase 2 (Auth + RBAC) ✅ (session 2026-09-21)
Server: `src/routes/auth.ts` (register 201 / login / refresh / logout 204 / me), argon2id, HS256 access JWT (15min httpOnly cookie) + opaque 48-byte refresh token (7d, sha256-stored, atomic rotation CAS, replay detection — `REPLAY_REVOKE_GRACE_MS=10s` via new `rotatedAt` so two-tab refresh races don't revoke a legit session), per-route express-rate-limit, zod validation with exact spec copy + flat details, login timing-equalizer (dummy argon2 verify, no user enumeration), `RefreshSession.expiresAt` TTL index, env JWT secrets min(32) + refuse the example placeholder. Tests `tests/auth.test.ts` 13 → suite 18/18; `npm run build` clean.
Client: real AuthContext (single-flight refresh; `/me` refresh-recovery), session-expiry banner + `inert` veil (`SessionExpiryBanner.tsx` in AppLayout), hardened `safeNext`, next-aware post-login/register redirects, `AccessDenied` route (UX spec §5 role-mismatch), admin-drawer a11y (Escape/trap/focus-return, closed-sidebar not focusable), demo role selector + `DEMO_TESTS` removed. Tests 12/12 (added SessionExpiryBanner + AccessDenied/routes); build + typecheck clean.
Notes: **client `api/client.ts` is source-of-truth for the auth wire contract** (match it server-side). Deferred (logged): logout-failure retry/error surface; `JWT_REFRESH_SECRET` now dead config (opaque tokens) but kept to avoid churn; `trust proxy` note for Phase 9 deploy docs.

## 6. ✅ RESOLVED — token/brand reconciliation (decided via approved default)

Decision: **keep the approved tokens + adopt "ExamPro" as brand.** Was already in
effect in code (`client/src/styles/tokens.css` + brand lockups); UX spec doc
`docs/ux/phase1-auth-and-shell.md` token table/radius lines updated to match
implemented values. No code change was required.

## 7. Remaining phases (order matters)

1. **Close Phase 1 — DONE ✅** (session 2026-09-20): client verified, tokens/brand reconciled, review + hardening fixes applied, final verify green (server 5/5, client 7/7, both tsc builds clean), initial commit landed on `main`.
2. **Phase 2 — Auth + RBAC — DONE ✅** (session 2026-09-21): full auth API + real client wiring. Details in §5 (Phase 2 block).
3. **Phase 3 — Test creation — DONE ✅** (session 2026-09-22, committed `87fde76`, merged to `main`): 
   - Server `src/routes/admin.ts`: full CRUD tests/sections/questions/options (zod, whole-doc PUT replace, publish gates ≥1 section/≥1 question, freeze gate 409 `TEST_FROZEN` once an attempt exists, soft delete, ARCHIVED status-lock, magic-number image uploads PNG/JPEG/GIF/WebP ≤2MB with UUID server filenames → `/uploads`). `serializeTest`/`toSummary` reshape to the client contract.
   - Client: `pages/admin/tests/{List,Builder}.tsx`, `ui/{SelectField,TextareaField}.tsx`; unsaved-change blocker + confirm-before-destroy; `student/{Dashboard,TestInstructions}.tsx`; **stubs** `ExamRunner.tsx`/`Result.tsx` (Phase 5/7 — replaced later).
   - Review: no Criticals; fixed IMPORTANT shuffle-flags contract mismatch (AdminTest now carries shuffleQuestions/shuffleOptions end-to-end, no silent reset on save) + whitespace-only option text rejected. Deferred items → §5 deferred list.
   - Verify: **server 45/45, client 18/18, both `tsc` builds clean.**
   - **Deferred (logged, MINOR):** (a) uploads never garbage-collected on test delete/image replace — revisit Phase 9 hardening; (b) freeze check TOCTOU + ignores `voided:true` attempts — Phase 5 start-CAS must re-assert content freeze; (c) admin routes untested for rate-limit/pagination — harden before Phase 8; (d) `imageUrl` is an unvalidated admin-supplied string; (e) Builder rounds section durations to whole minutes; (f) create-then-edit failure can orphan an empty DRAFT.
4. **Phase 4 — JSON import — DONE ✅** (session 2026-09-22, committed `a673edd`, on `feature/json-import` → merge to `main`):
   - Server `src/routes/admin.ts`: `POST /api/admin/import/validate|confirm` (admin-only). Validate: zod strip-mode parse, `id`-key rejection at any depth, **hash = sha256 over `JSON.stringify` of normalized zod output** → `{hash, summary:{title,sectionCount,questionCount,totalDurationSec,totalMarks}}`; 400 `INVALID_JSON` (flat stack-safe path walk, depth-capped) / `VALIDATION_ERROR` (flat `details:[{field,message}]`). Confirm: re-validate + re-hash inside a single `Test.create`, 409 `IMPORT_STALE` on hash mismatch, all-or-nothing, imported as DRAFT. `server/tests/import-admin.test.ts`: 15 tests (incl. stale→409, deep-nesting→400, atomicity).
   - Client: `pages/admin/tests/ImportTestModal.tsx` (two-step paste→Validate→preview summary→Import test; inline `INVALID_JSON` error on field, `VALIDATION_ERROR` detail list, stale banner + Back), `api.imports.validate/confirm`, `types` (`ImportSummary`, `ValidateImportResponse`, `ImportErrorDetail`), "Import test" buttons in `List.tsx` header + empty-state CTA. `ImportTest.test.tsx` 5 tests.
   - UX review: fixed focus loss on step transition (`key={step}` on Modal) + close-while-pending guard (`handleClose` no-ops while a mutation is pending, `useCallback`-stabilized so it doesn't churn Modal's focus effect on every keystroke — this was the source of the only failing test, a space typed in the textarea reactivating the focused close button), cancel/escape during pending blocked, hint contrast `--ink-faint`→`--ink-muted` at 12px, DRAFT→draft copy.
   - Verify: **server 60/60, client 23/23, both `tsc` builds clean.**
   - **Deferred (logged, MINOR):** `description`/`imageUrl` on imported tests currently default; consider exposing section duration rounding; import payload size limits not yet enforced (express.json default 100kb) — revisit Phase 9 hardening.
5. **Phase 5 — Exam engine — DONE ✅** (session 2026-09-22, committed `2b4b07c` on `feature/exam-engine` → merge to `main`):
   - Server `src/routes/student.ts`, mounted `/api/student`: GET `/tests` (published, not deleted); POST `/tests/:testId/attempts` (409 `ALREADY_IN_PROGRESS` if a live attempt exists, CAS-guarded); POST `/attempts/:attemptId/start` (**CAS-atomic**: GATED→IN_PROGRESS via `findOneAndUpdate({status:'GATED'})`, 409 `ALREADY_STARTED` on race, re-reads test for PUBLISHED + not-deleted → 409 `TEST_NOT_AVAILABLE`); GET `/attempts/:attemptId` (own-attempt only, 404 on IDOR/foreign); PUT `/attempts/:attemptId/answers` (upsert, undo, endAt never moves); POST `/events` (validated type enum, gated IN_PROGRESS); POST `/submit` (idempotent — double submit returns same result without double-scoring); GET `/result` (409 `NOT_SUBMITTED` while in progress; no answer key; exposes per-question marks only after submit).
   - **Server-owned timer**: `lazyExpire(attempt)` transitions IN_PROGRESS→TIMED_OUT past `endAt + 5s` grace, scores with `submittedAt = endAt`, pushes SUBMIT event; called on GET/save/events/submit — client clock is display-only. Overdue attempt's result works without manual submit; late saves → 409 `NOT_IN_PROGRESS`.
   - **Scoring (server-side, reads frozen `blueprint` only)**: exact sorted-set match → `+marks`; wrong *answered* → `−negativeMarks` per question (resolved `question.negativeMarks ?? section.negativeMarksOverride ?? test.defaultNegativeMarks`); unattempted → 0; **only total floored at 0** (per-section may be negative). Blueprint is a seeded per-attempt shuffle (sha256(attemptId)→mulberry32); `isCorrect`/correctOptionIds never leave the server pre-submit.
   - `server/src/middleware/errorHandler.ts`: mongoose **VersionError (concurrent writers, e.g. save racing submit/expire) → 409 `CONCURRENCY_CONFLICT`** (was silent 500). Client treats it as retryable, like network loss.
   - `server/tests/student-exam.test.ts`: **33 tests** (scoring incl. MULTI exact-set & negative-mark resolution, idempotent submit, seeded determinism, IDOR walk, concurrency race, lazy-expiry TIMED_OUT + grace, post-submit gates, structural secrecy).
   - Client: **`pages/student/ExamRunner.tsx`** replaces the Phase 3 stub (real exam screen: sticky header w/ countdown + save state, question card, palette w/ answered/marked/current + legend, debounced 800ms autosave, offline retry banner, submit confirmation Modal, GATED→redirect to instructions, SUBMITTED/TIMED_OUT→result). Exam CSS in `global.css`. `client/src/__tests__/ExamRunner.test.tsx`: **10 tests**.
   - **Review fixes (post-implementation, both agents verified):** (a) **flush-before-submit** — submit now awaits a serialized single-flight flush so a locally-held (debounced) answer can never be lost on the wire; failed flush aborts submit with an error instead of a silent partial score; (b) `stateRef` render mutation removed, save loop re-reads `pendingPayloadRef` after every save (keystroke during in-flight PUT re-flushed); (c) `beforeunload` guard when a payload is pending; (d) countdown dropped `aria-live` (was announcing every tick) → `TimerAnnouncements` sr-only thresholds (5m/1m/time-up); (e) save-state contrast `--ink-faint`→`--ink-muted` + `--danger` on failure; offline banner + palette-marked contrast darkened (`#7a4a0d` on tan); (f) palette marked = dashed border + ◈ marker + legend **Current** swatch (non-color affordance); (g) palette grid scrolls within sticky sidebar (long exams), palette below question on mobile (dropped `order:-1`), `:focus-visible` restored on question/palette; (h) MULTI "Select all that apply" hint; question/option images get meaningful alt. `SaveAnswersResponse.endAt` typed `string | null`.
   - Verify: **server 93/93, client 33/33, both `tsc` builds clean.**
   - **Deferred (logged for Phase 6/9):** timer dead-center fullscreen auto-start + 3-strike logic pending (→ done in Phase 6); uploads GC + import size limits + rate-limit/pagination hardening remain for Phase 9; Result page still the Phase 3 stub (Phase 7).
6. **Phase 6 — Anti-cheat (DONE Most Recent):** 3-strike enforcement + 3rd-strike auto-submit, both sides.
   - Server (`server/src/routes/student.ts`): events route now counts of violations. `VIOLATION_EVENT_TYPES` (everything except informational `NETWORK_RECONNECT`) increments `attempt.warningCount` (`TestAttempt` model field); at `MAX_WARNINGS = 3` the attempt is finalized through a new shared `finalizeSubmit` helper (also used by the manual submit route → scores frozen `blueprint`+answers, sets `SUBMITTED`, appends `SUBMIT` event); response is `{status, warningCount, submitted}` with `submitted:true` on the 3rd. Save wrapped in a bounded `VersionError` retry (`reload` + re-apply + status re-check) so a concurrent event from another tab can never silently drop a violation or double-submit.
   - Client (`pages/student/ExamRunner.tsx`): once-mounted listeners — `fullscreenchange` (exit counts only if fullscreen was engaged, `wasFullscreenRef`), `visibilitychange` + `blur` coalesced into one "focus away" violation per 1s window, `copy`/`cut`/`paste`/`contextmenu` `preventDefault` + per-type 1s coalesce (`lastEventRef`). Event POSTs run on a serialized single chain (`eventChainRef`, same pattern as `flush`), and pending answers are `flush()`ed BEFORE each POST so a 3rd-strike auto-submit scores the latest snapshot. Strokes 1–2: **blocking modal** for fullscreen/visibility/blur (incl. "Return to fullscreen" re-engage button) vs **inline auto-dismissing amber banner** for already-suppressed copy/paste/right-click (so an accidental right-click never stops the exam clock). 3rd: **server** auto-submits → "Exam auto-submitted" modal → result or back-to-tests. Header warnings pill `N/3` always mounted (`visibility:hidden` at 0 — zero layout shift), `role="status"`. `refetchOnWindowFocus: false` on the attempt query (every alt-tab return refetched the static snapshot). `Modal.tsx` focus-trap effect deps tightened to `[open]` via `onCloseRef` — root-cause: the 1s countdown re-render was dragging focus back to the modal close button every tick; warning-modal dismissal now refocuses the question.
   - Tests: server +2 (`3rd-violation auto-submit` incl. SUBMIT event + result access + post-submit 409; `NETWORK_RECONNECT` not counted) and the stale `warningCount:0`→`1` expectation updated; client +5 (copy suppressed → banner, blur+hidden coalesced to 1 post + blocking modal, flush-before-violation ordering, fullscreen-exit modal + recovery button, 3-strike auto-submit navigation).
   - Review pass (perf/code-quality/a11y/UX agents) findings all resolved: serialized POSTs + no stale-count overwrites (`Math.max`), late-409 no longer nukes an already-submitted exam (`submittedRef` guards), Modal focus churn fixed at root, pill + banner contrast/consistency, disclosure "3 violations auto-submit your exam" on every warning modal, graceful second exit on auto-submit modal.
   - Verify: **server 95/95, client 38/38, both `tsc` builds clean**, bundle unchanged (~318KB, zero new deps).
7. **Phase 7 — Results (NEXT):** student summary (no answer key) + detailed admin result view.
8. **Phase 8 — Analytics:** admin aggregates (avg/highest/lowest, distribution, per-question difficulty, violation stats).
9. **Phase 9 — Final audit:** @review + @tester, full verify, Playwright E2E (also via mongodb-memory-server), README/env docs.

## 8. How to run (as of this state)

```sh
cd server && npm test        # no DB needed (memory-server)
cd server && npm run dev     # REQUIRES MONGODB_URI in server/.env (user provides later)
cd client && npm run dev     # standalone, mockless UI (port 5173)
cd client && npm run build   # verified green (Phase 2 close-out)
```

## 9. Environment / env vars (server/.env)

`PORT=3001`, `MONGODB_URI=` (blank → boot refuses with helpful message), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_ORIGIN=http://localhost:5173`, `COOKIE_SECURE=false`, `NODE_ENV=development`. Client uses `VITE_API_URL` (default `http://localhost:3001`).

## 10. Subagent config + recommendations

- Agents live in `.opencode/agents/` (backend/UI/UX/tester/review/search). AGENTS.md mandates subagent-driven workflow, branch-per-feature, test-then-review.
- Recommended for each phase: production agent → tester → review → fix loop → commit to feature branch → merge to `main` (AGENTS.md sequence).
- Be careful: parallel agents must work on disjoint paths (`server/`, `client/`, `docs/`). A cancelled task dump (like client/) needs verification before trusting.

## 11. Open inputs needed from user

1. Real `MONGODB_URI` (only needed to run the app live; tests don't need it).
2. ~Confirm token/brand reconciliation (§6) or provide preference.~ **RESOLVED**: approved default adopted (§6).