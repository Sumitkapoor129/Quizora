# Tester Report — Phases 10–11 (Study Resources + Student Portal)

Branch `feature/resources-and-student-portal` · commit `1445fd0` (server) + uncommitted client working tree.
Scope: reproduce failing test, edge-case hunt on server (committed) and client (uncommitted). No files were modified during this review.

**Suite state measured (read-only runs):**
- `client`: `npx vitest run` → **2 failed / 99 passed (101)**. The 2 failures: `Dashboard.test.tsx:298` (the known target) and `ExamRunner.test.tsx` "renders the current question…" timing out at 5000ms.
- `ExamRunner.test.tsx` alone: **15/15 pass** in ~8s. ExamRunner is untouched by this branch's diff; the timeout is load-induced flakiness under the parallel full run (pre-existing; earlier run of record shows 100 passed, i.e. only the Dashboard failure). Not a Phase 10–11 finding — flag, do not dispatch a fix (see §6).
- `server`: `tests/student-portal.test.ts` + `tests/resources.test.ts` → **16/16 pass**. Server Phases 10–11 behavior verified; the working-tree additions to `resources.test.ts` (ftp:// rejection, http:// acceptance) pass against the committed code.

---

## 1. Reproduced failure — root cause verdict

**Verdict: the TEST is wrong; the implementation matches the approved UX spec.**

- `client/src/pages/student/Dashboard.tsx:152` renders the footer only when `testsQuery.isSuccess && tests.length > 3` → `View all tests`.
- Spec `docs/ux/phase10-11-student-portal-and-resources.md:181`: "When > 3 tests: a quiet section footer link `View all tests` → `/student/tests`".
- The fixture `studentTests` (`Dashboard.test.tsx:193-230`) has **exactly 3 tests** (t1, t2, t3) → `tests.length > 3` is false → no link renders → `getByRole('link', { name: 'View all tests' })` at line 298 throws.
- Evidence the author knew the condition: comment at `Dashboard.test.tsx:282` — "`View all tests` is not a valid wait target — it only renders when tests.length > 3." The assertion at 298 was simply left stale.
- Corroborating evidence: the parallel resources fixture has **4 items** (`Dashboard.test.tsx:238-243`) precisely to cover the >3 branch, and line 308 asserts `View all resources`.
- The `>3` branch currently has **zero coverage** (the empty-state test at 373 covers only the `==0` branch).

### Exact minimal fix (preserves strongest real-behavior coverage)

Recommended: bump the fixture to 4 tests + update the one stat expectation. This keeps the >3 footer branch covered (dropping line 298 would delete the only coverage of a real conditional).

1. In `Dashboard.test.tsx`, after the t3 entry (line 229), append t4 to `studentTests`:
```ts
  {
    id: 't4',
    title: 'Chemistry Lab',
    sectionCount: 1,
    questionCount: 6,
    totalDurationSec: 600,
    totalMarks: 60,
    defaultNegativeMarks: 0,
    shuffleQuestions: false,
    shuffleOptions: false,
  },
];
```
2. Line 285: `expect(withinValue(screen.getByText('Tests available').parentElement!)).toBe('3');` → `toBe('4');`.

Why this is safe: `studentTests` is referenced only at line 274 (single test). `recentTests = tests.slice(0, 3)` keeps t1–t3 as the top-3 cards (assertions at 294–297 unchanged: Resume t1, View result t2, Take test t3). Only the stat count changes.

Retest: `cd client && npx vitest run src/__tests__/Dashboard.test.tsx` → expect 11/11; then full `npx vitest run` (watch the ExamRunner flake, §6).

---

## 2. Findings table

| # | Location | Severity | Status | What's wrong | Why it matters | Exact fix |
|---|----------|----------|--------|--------------|----------------|-----------|
| 1 | `client/src/__tests__/Dashboard.test.tsx:298` (fixture 193-230) | 🔴 Critical (blocks green suite; test-only) | **CONFIRMED** | Asserts `View all tests` footer against a 3-item fixture; footer requires >3 (`Dashboard.tsx:152`, spec §2.2) | Suite is red; the >3 branch is uncovered | §1: append t4 to `studentTests`, change stat expectation `'3'`→`'4'` at line 285 |
| 2 | `client/src/pages/admin/resources/ResourceList.tsx:73,86-94,189` | 🟡 Minor | **CONFIRMED** | Server field key mismatch: `if (detail.field === 'driveUrl') mapped.driveUrl` vs Field reading `fieldErrors['drive-url']`; `focusFirstInvalid` order looks for `'drive-url'` | Server-side URL errors are silently swallowed (no field message, no focus, no generic form error — the early-return at 78 skips the fallback) | In `onError`, map to the field's key: `if (detail.field === 'driveUrl') mapped['drive-url'] = detail.message;` (one-line). Client validation catches most cases today, so user impact is narrow, but the error contract is broken for that field |
| 3 | `client/src/pages/student/Profile.tsx:48-66` (and `AuthContext.tsx`) | 🟡 Minor | **CONFIRMED** | Successful name PATCH ignores the returned `{user, sessionExpiresAt}`; `AuthContext` exposes no setter/refresh | Header user-chip and Dashboard greeting show the stale first name until tab-refocus (`checkSession` on window `focus`) or reload | Expose `updateUser`/`refreshSession` on `AuthContext` (or call `checkSession`), and invoke it in the account mutation's `onSuccess` using `mapSession`'s result |
| 4 | `client/src/pages/admin/resources/ResourceList.tsx:321-324` | 🟡 Minor | **CONFIRMED** | Delete confirm modal `onClose={() => setPendingDelete(null)}` has no `remove.isPending` guard; the Add modal does have the guard (`handleClose` at 110-113) | Spec §1.2 close-while-pending guard missing on delete; user closes mid-flight → "Resource deleted." banner appears after cancel-looking close. No data corruption (delete still completes) | `onClose={() => { if (remove.isPending) return; setPendingDelete(null); }}`. Note: matches the pre-existing admin Tests list delete modal, so consistent-with-codebase but spec-non-compliant |
| 5 | `server/src/routes/student.ts:735` + `server/src/models/User.ts:6` | 🟢 Optional | **Suspicion → confirmed non-blocking** | PATCH `/profile` name has no max-length (client Field caps 120; server register schema also has none) | A direct API call can store an unbounded name → header/chip overflow | Add `max(120)` to `profileUpdateSchema.name` (optional; pre-existing pattern, not a Phase 10–11 regression) |
| 6 | `server/src/models/Resource.ts` | 🟢 Optional | Suspicion | No index on `createdAt` | Sort by `createdAt: -1` per request; collection is admin-created and capped ~200 by convention — fine at this scale | Add `{ createdAt: -1 }` index when resource volume grows; `ponytail:` acceptable as-is |
| 7 | `server/src/routes/admin.ts:139-144` | — | **False alarm (already fixed)** | "known bug": `.url()` accepts `ftp://`/`mailto:` | Already mitigated: `.refine((v) => /^https?:\/\//i.test(v), RESOURCE_URL_HTTPS)` at line 144; new working-tree test `resources.test.ts:147-156` passes (10/10) | None |
| 8 | `server/src/routes/admin.ts:694-701` | — | False alarm | DELETE `/resources/:id` with malformed id | `errorHandler.ts:37-39` maps `mongoose.Error.CastError` → 400 `INVALID_ID` | None |
| 9 | `server/src/routes/student.ts:702-731` GET /attempts | — | False alarm | percent math, date chain, all-statuses, `_id` sort, own-scoping, deleted-test tolerance | `percent` guards `totalMarks > 0`; date chain `submittedAt ?? startedAt ?? _id.getTimestamp()`; sort `{_id:-1}`; scoped `studentId: req.user!.id` (no IDOR, tested); deleted test → `testTitle: ''` and MyTests shows `'Untitled test'` | None |
| 10 | `server/src/routes/student.ts:733-793` PATCH /profile | — | False alarm | name-only, password+currentPassword, wrong-current→400 `INVALID_CREDENTIALS`, at-least-one-field refine, `name:'   '` | `.trim().min(1)` rejects whitespace name (400 `Name is required.`); refine fires on `name===undefined && newPassword===undefined`; client sends trimmed values; cross-form buttons disabled to prevent concurrent PATCHes | None |
| 11 | Client pages: empty/all-statuses/`description:null`/unknown kind/`driveUrl` missing | — | False alarm | Empty/error/loading surfaces per page; `normalizeResource` (`client.ts:67-69`) maps `null → undefined`; `resourceKind` falls back to OTHER/default; `driveUrl` required by model + zod | Behavior matches spec; covered by new tests (MyTests/Resources/Tests/Profile/AppLayout/routes) | None |
| 12 | `AppLayout.tsx` student sidebar | — | False alarm | Drawer a11y: focus trap, Escape, focus-return, `aria-controls`/`aria-expanded`, closed-drawer unfocusable | Implemented + `AppLayout.test.tsx` covers Escape/focus-restore/nav-close; CSS keeps `visibility:hidden` on closed drawer (`global.css` unchanged for that rule) | None |

---

## 3. Fix dispatch vs false alarms

**Dispatch fixes (frontend sub-agent):**
- **#1 (Critical)** — Dashboard.test.tsx fixture bump + stat expectation. Only change required to turn the suite green.
- **#2 (Minor)** — ResourceList server `driveUrl` error mapping key — one-line.
- **#3 (Minor)** — Profile success should refresh AuthContext user — small, touches `AuthContext` + `Profile.tsx`.
- **#4 (Minor)** — Delete-modal close-while-pending guard — one-line; optional but cheap spec compliance.

**Do NOT dispatch (false alarms / already correct):** #7 (http(s) refine exists + tests pass), #8 (CastError → 400), #9 (attempts math/scoping), #10 (profile validation incl. whitespace-name), #11 (client normalization/fallbacks/empty states), #12 (sidebar a11y).

**Notes:** #5/#6 are Optional hardening, can be deferred or folded into a later phase. §6 ExamRunner flake is pre-existing and out of Phase 10–11 scope.

---

## 4. (Appendix) Additional edge notes for retest after fix

- `Dashboard.test.tsx` after the fixture bump must still pass at 285 (`Tests available` = 4), 286 (`Tests taken` = 2), 287 (`Average score` = 50%), 290 (`Resume →` stat hint), 294-297 (top-3 card CTAs unchanged), 308 (`View all resources` with 4-item resources fixture).
- After any fix dispatch, re-run `cd client && npx vitest run` and `cd server && npx vitest run tests/student-portal.test.ts tests/resources.test.ts`.
- If the ExamRunner 5000ms timeout reproduces twice in a row on the full run but passes solo, treat as flake (load), not a regression; consider `testTimeout` bump or isolation, separately from this phase.