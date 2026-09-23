# Task B report — UX: Student Portal + Resources design spec

**Status:** DONE
**Deliverable:** `docs/ux/phase10-11-student-portal-and-resources.md`

## What was done

Read the brief, AGENTS.md (frontend rules), context.md (§7 items 10–11), the deleted-then-recovered Phase 1 UX spec, and the live client source (`AppLayout.tsx`, `routes/index.tsx`, `student/Dashboard.tsx`, `student/Result.tsx`, `tokens.css`, all 10 ui primitives, `global.css` responsive/stat/table/banner blocks, `api/client.ts`, `types/index.ts`, `attemptStatus.ts`, admin `TestsList`/`AttemptsList` for the confirm-modal and data-table conventions). Wrote the Phase 10–11 UX spec only; no client/ or server/ files touched. Wrote this report.

## Key design decisions (5)

1. **Student gets the admin sidebar verbatim** — reuse the already-hardened drawer (Escape/trap/focus-return, closed-not-focusable via existing CSS) with `student-nav` id; only new shell change is dropping the `isAdmin` gate and the student `nav-row`.
2. **Restrained kind badges** — PDF/ZIP/OTHER all `default`, only IMAGE `accent`; attempt-status badges reuse the existing `ATTEMPT_STATUS_LABEL/VARIANT` map, so no rainbow and no new status vocabulary.
3. **Dashboard = stat strip + two recent sections with parallel queries** — `Promise.all` of the three feeds; partial feed failure degrades per section instead of blanking the page; avg score shows `—` (em dash) at zero scored attempts per the Phase 1 rule.
4. **Dashboard extracts cleanly** — the existing `test-card` anatomy + `attemptAction` helper move wholesale to `/student/tests`; My Tests reuses the admin attempts `data-table` + per-status result/resume/continue links.
5. **Only 4 tiny new CSS classes** (`stat-grid--4`, `resource-card`, `banner--success`, `form-success`), all built from existing tokens; everything else reuses real tokens, primitives, and global.css classes — zero new dependencies.

## Conflicts / questions resolved

- **`docs/ux/phase1-auth-and-shell.md` was deleted in commit `fd88087`** ("Deleted something" — the working tree has no `docs/` directory). Recovered it from `git show fd88087^:docs/ux/phase1-auth-and-shell.md` to match its style and copy conventions; noted in context so the orchestrator knows the file is missing from the branch if later steps expect it.
- **Nav labels**: brief says "Dashboard/My Tests/Tests/Resources", but today's `STUDENT_NAV` uses "Home"/"My Results" — spec renames both (Dashboard matches admin; My Tests matches the history page). Called out explicitly in §2.1.
- **`stat-grid` is 3-column** on desktop; the insights strip needs 4 — spec the `auto-fit minmax(210px,1fr)` modifier (already the ≤1024px behavior) rather than inventing a new layout system.
- **No success-banner class exists** (`banner`/`banner--error` only) — spec a `banner--success`/`form-success` tinted pattern mirroring the existing `form-error`/`banner--error` construction with `--success` tokens.
- **Route collision** `/student/tests` vs `/student/tests/:testId/*` confirmed safe (rank + shell-free exam routes outside `AppLayout`); recommended a routes test asserting `/student/tests` renders the list page.
- **Result back-link** left as `Back to tests` → `/student` (still accurate from the Tests hub); deferring role-aware back links out of scope as noted polish.