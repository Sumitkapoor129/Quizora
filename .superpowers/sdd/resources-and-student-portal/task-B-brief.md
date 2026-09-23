# Task B brief — UX: Student Portal + Resources design spec

Repo: C:\Users\91983\Desktop\VibeCoded\forms (branch feature/resources-and-student-portal).

You are the UX subagent. Work ONLY in docs/ux/ (create files there). Do NOT touch client/ or server/ code. Do NOT dispatch subagents.

## Context
Read AGENTS.md (frontend design guidelines) and context.md. Then read client/src/components/layout/AppLayout.tsx, client/src/routes/index.tsx, client/src/pages/student/Dashboard.tsx, client/src/styles/tokens.css. This is a production MCQ exam platform with a restrained design system (no component lib, plain CSS tokens, ~11 primitives: Button/Field/Card/Badge/Spinner/EmptyState/ErrorState/Modal/SelectField/TextareaField). Admin already has a sidebar; students currently have a horizontal top nav row.

## Deliverable
Write `docs/ux/phase10-11-student-portal-and-resources.md` — a UX spec, following the same style/quality as the existing `docs/ux/phase1-auth-and-shell.md`.

Cover these two features, matching the AGENTS.md frontend design philosophy (Performance first, professional/classy/minimal, no flashy effects, consistent spacing/typography, a11y mandatory):

### f1 — Study Resources (Phase 10)
- Admin page `/admin/resources`: manage resources (PDF/ZIP/IMAGE/OTHER) — list with title, kind, short description, drive link, delete (confirm-before-destroy). "Add resource" modal form (title, description, kind select, driveUrl). Empty state.
- Student page `/student/resources`: preview cards — title, small description, kind badge, "Open" external link. Drive links open in a new tab (rel=noopener). Empty state.
- Copy rules, loading/error states per existing conventions.

### f2 — Student Portal (Phase 11)
- Student layout becomes a SIDEBAR (like admin's: hamburger drawer, Escape/trap/focus-return, closed side not focusable). Nav items: **Dashboard** `/student`, **Profile** `/student/profile`, **My Tests** `/student/results`, **Tests** `/student/tests`, **Resources** `/student/resources`. Note the exam flow stays shell-free (unchanged).
- Student Dashboard rewrite: insights/analytics strip (tests available, tests taken, avg score %, resume in-progress) + two "Recently added" sections — recent tests (top 3) and recent resources (top 3), cards linking onward. Define the exact hierarchy/empty states.
- `Tests` page: the existing available-tests grid (extracted from today's Dashboard).
- `My Tests` page (`/student/results`): attempt history rows — test title, status badge, marks/percent, link to result. Reuse the Result page patterns.
- `Profile` page: name + change-password form (current password required to change password).

## Spec rules
- Concrete: define component layouts, labels, copy, ordering, empty states, error/loading states, a11y (labels, focus, semantics), responsive behavior (sidebar drawer on mobile, static sidebar desktop), and the exact spacing/typography tokens to reuse from tokens.css.
- Professional and minimal. Do NOT design flashy: no gradients, no heavy shadows, no decorative animation. Refer to the token values actually in tokens.css.
- Keep it implementable by a UI subagent in plain CSS + existing primitives. No new dependencies.

## Report
Write full report to: C:\Users\91983\Desktop\VibeCoded\forms\.superpowers\sdd\resources-and-student-portal\task-B-report.md
Return: DONE + the spec file path + a 5-line summary of the key design decisions + any conflicts/questions you resolved.