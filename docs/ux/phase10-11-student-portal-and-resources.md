# Phases 10–11 UX Spec — Study Resources + Student Portal

**Status:** Approved for implementation
**Scope:** f1 Study Resources (Phase 10) — admin `/admin/resources` management + student `/student/resources` preview cards. f2 Student Portal (Phase 11) — student sidebar shell, rewritten Dashboard with insights strip + "Recently added" sections, extracted Tests page, My Tests history, Profile page.
**Stack:** React 18 + Vite · react-router-dom v6 · @tanstack/react-query v5 · plain-CSS design tokens + existing UI primitives. **Zero new dependencies.**
**Visual direction:** same as Phase 1 — premium professional software. Paper-and-ink palette, one ink-blue accent, restrained badges (no rainbow), minimal shadows, no decorative motion. Resources are quiet utility pages; the Dashboard is the one page with a stat strip, and it reuses the existing admin stat-card style.

**Design tokens actually used (from `client/src/styles/tokens.css`):**
| Token | Value | Used for |
|---|---|---|
| `--paper` | `#fafaf9` | page background |
| `--surface` | `#ffffff` | cards, sidebar, table cards |
| `--ink` | `#1a1d21` | headings, primary text, active nav |
| `--ink-muted` | `#5c6470` | sub copy, hints, meta rows |
| `--ink-faint` | `#8a919c` | faint hints (stat-card__hint) |
| `--line` | `#e4e7eb` | card/input/sidebar borders |
| `--accent` / `--accent-hover` / `--accent-tint` | `#2b5bd7` / `#2147a8` / `#edf2fd` | primary buttons, links, active nav, success-state and in-progress badges |
| `--danger` | `#c0392b` | delete buttons, error copy, error state |
| `--warn` | `#8a5a10` | TIMED_OUT status badge |
| `--success` | `#2f7d4f` | SUBMITTED status badge, success messages |
| `--space-1..7` | 4/8/12/16/24/32/48 px | all spacing (existing scale only) |
| `--text-xs..2xl`, `--font-mono` | 12/14/16/20/24/32 px | type scale; stat values in mono |
| `--r-sm/r-md/r-lg`, `--shadow-sm/md` | 6/10/14 px radii; light shadows | buttons/inputs, cards, modal |

**Primitives to reuse (all exist in `client/src/components/ui/`):** `Button` (variants primary/secondary/ghost/danger, sizes sm/md, `loading`), `Field`, `TextField`-equivalent `Field`, `TextareaField`, `SelectField`, `Badge` (variants default/accent/success/warn/danger), `Card`, `Modal` (focus trap, Escape, backdrop; pass unique `id` per modal), `Spinner`, `EmptyState`, `ErrorState`.

**Existing CSS classes to reuse (in `client/src/styles/global.css`):** `page-header` / `page-heading` / `page-sub` / `page-header__actions`, `section` / `section-title`, `card-grid`, `test-card` (+ `__title`/`__chips`/`__meta`/`__cta`), `stat-grid` / `stat-card` (+ `__value`/`__label`/`__hint`), `test-row` (+ `__main`/`__head`/`__title`/`__meta`/`__actions`) for admin list rows, `table-card` / `table-wrap` / `data-table` (+ `__link`/`__sub`/`__num`), `tests-list`, `skeleton-row`, `empty-state` (+ `__title`/`__body`/`__action`/`__actions`), `error-state`, `banner` / `banner--error`, `field` / `field__label` / `field__input` / `field__error` / `field__hint`, `form-error`, `sidebar` / `sidebar__nav` / `sidebar--open` / `sidebar-backdrop`, `nav-row`, `nav-link` / `nav-link--active`, `hamburger`, `icon-btn`, `back-link`, `sr-only`, `route-loading`.

---

## 1. Phase 10 — Study Resources

### 1.1 Routes & roles

| Route | Role | Page |
|---|---|---|
| `/admin/resources` | admin | Resource management list (add / delete) |
| `/student/resources` | student | Preview card grid |

Server contract: admin `GET/POST /api/admin/resources`, `DELETE /api/admin/resources/:id`; student `GET /api/student/resources` (newest-first by `_id` desc). DTO for student: `{id, title, description, kind, driveUrl}`. `driveUrl` is an **untrusted string** — never interpolate it into the page outside `href`; server validates http(s) at creation.

### 1.2 Admin — `/admin/resources`

**Page header**
- `page-heading`: `Resources`
- `page-sub`: `Share study material with students — PDFs, archives, images, or links.`
- Action (in `page-header__actions`): primary `Button` labeled `Add resource`, opens the add modal.

**List (has data)** — reuse the admin Tests list pattern (card rows in `tests-list`, `Card` with `test-row` classes):

Each row (`test-row`):
- **Title** — `test-row__title` as a plain `<strong>`-level span (not a link; editing ships later — delete+re-add covers typos).
- **Kind** — `Badge`, label/variant from the resource kind map (§1.4).
- **Short description** — `test-row__meta` invert: show description (muted, `--text-sm`) when present; when absent show `No description.` muted. *Keep it one line; the admin list is a management surface, not a marketing deck.*
- **Drive link** — quiet external link: `Open link`, `target="_blank"` `rel="noopener noreferrer"`, muted underline, with `sr-only` suffix `(opens in a new tab)`.
- **Action** — `Button variant="ghost" size="sm"` labeled `Delete`, opens the delete confirm modal. Each row's Delete shows `loading` while its own delete is pending (`remove.isPending && remove.variables?.id === r.id` — same pattern as Tests list).

**Loading** — `tests-list` + three `skeleton-row` blocks (identical to Tests/Attempts lists), `role="status"` + `sr-only` `Loading resources…`.

**Empty** — `EmptyState`:
- Title: `No resources yet.`
- Body: `Share study material like PDFs, question banks, or images. Students will see them under Resources.`
- Action (in `empty-state__action`): primary `Button` `Add your first resource` → opens the modal. Empty state must still be reachable — same convention as Tests list.

**Error** — default `ErrorState` (`Something went wrong. …`) with `Try again` refetch.

**Add-resource modal**
- `Modal` elementId `add-resource-modal-title`, title `Add resource`.
- Fields, in order:
  1. **Title** — `Field`, label `Title`, placeholder `e.g. Optics formula sheet`, `required`, `maxLength 120`.
  2. **Short description** — `TextareaField`, label `Short description`, `rows={3}`, `maxLength 500`, hint `Optional — shown to students on the resource card.`
  3. **Kind** — `SelectField`, label `Kind`, options and labels per §1.4.
  4. **Drive link** — `Field`, label `Drive link`, `type="url"`, placeholder `https://drive.google.com/…`, hint `Students open this link in a new tab.`
- Footer: `Button variant="secondary"` `Cancel` · `Button variant="primary"` `Add resource` with `loading` while creating.
- Validation table (field-level, shown under the field via `Field`/`TextareaField`/`SelectField` `error` prop; server zod `details[{field,message}]` maps onto fields; unmapped server errors → form-level):

| Condition | Field | Copy |
|---|---|---|
| Empty title on submit | Title | `Title is required.` |
| Title > 120 chars (server) | Title | `Title must be 120 characters or fewer.` |
| Description > 500 chars (server) | Description | `Description must be 500 characters or fewer.` |
| Invalid kind (server) | Kind | `Choose a valid kind.` |
| Empty / not a valid web URL | Drive link | `Enter a valid link starting with http or https.` |
| Poster said so / network | Form-level (`form-error` above footer) | `Something went wrong. Please try again.` |

- Behavior: clear a field's error as soon as the user edits that field; on server-save failure keep the form filled and focus the first invalid field. **Close-while-pending guard** (Phase 4 convention): `onClose` is a no-op while the create mutation is pending; Escape/backdrop do not close mid-flight. On success: close modal, invalidate the admin resources query, show a `banner banner--error`-style row? No — success uses the symmetric inline/hint pattern below.

**Create/delete success feedback** — one action banner at the top of the list, same pattern as Tests list (`banner` + `banner__close`), but for success use a **new `banner--success` class** *styled from existing tokens* (background `#eef6f1`-family light tint of `--success`, 1px border using `--success` at low alpha — identical to how `banner--error` tints `--danger`). Copy:
- Added: `Resource added. Students can now see it.`
- Deleted: `Resource deleted.`

Keep exactly one banner at a time; auto-dismiss is not required (Tests list keeps the banner until closed).

**Delete confirm modal** — confirm-before-destroy, verb in the button (Phase 1 rule §3):
- `Modal` elementId `delete-resource-modal-title`, title `Delete resource`.
- Body: `Delete <strong>{title}</strong>? Students will no longer see it. This can't be undone.`
- Footer: `Cancel` (secondary) · `Delete resource` (danger, `loading` while pending).
- On success: close modal, invalidate, success banner. Close-while-pending guard applies.

### 1.3 Student — `/student/resources`

**Page header**
- `page-heading`: `Resources`
- `page-sub`: `Study material shared by your instructors.`

**Card grid (has data)** — `card-grid`; each `Card` (`resource-card`, same vertical anatomy as `test-card`):
- **Title** — `h3` (`test-card__title` size class reuse), clamp 2 lines.
- **Kind** — `Badge` per §1.4 map.
- **Description** — small muted paragraph (`test-card__meta` style), `--text-sm`, `--ink-muted`; when absent render nothing for it (student cards show description as the value prop; blank description card still needs title + badge + Open).
- **Open** — primary `Button`-as-link `Open`, `target="_blank"` `rel="noopener noreferrer"`, appended `sr-only` `Opens in a new tab`. Card-level CTA slot matches `test-card__cta` (`align-self: flex-start; margin-top: auto`).

Order: newest-first as returned by the API; render as-is (server owns ordering). List is small (admin-created); no pagination (cap 200 admin-side at worst — `ponytail:` unchanged).

**Loading** — three skeleton cards: reuse `skeleton-row` blocks inside a `card-grid` (3 columns), `role="status"` + `sr-only` `Loading resources…`. (Phase 1 recommended skeletons because the layout is predictable.)

**Empty** — `EmptyState`:
- Title: `No resources yet.`
- Body: `Study material will appear here when your instructor shares it.`

**Error** — default `ErrorState` with `Try again` refetch.

### 1.4 Resource kind map (`client/src/utils/resourceKind.ts`)

| kind | Label | Badge variant |
|---|---|---|
| `PDF` | `PDF` | `default` |
| `ZIP` | `ZIP` | `default` |
| `IMAGE` | `Image` | `accent` |
| `OTHER` | `Other` | `default` |

Restrained by design — file formats are metadata, not a rainbow of status colors; only IMAGE gets accent because it is the visually-distinct download type. Unknown/legacy kinds fall back to `OTHER`/`default` (defensive: badge must never crash on server drift).

---

## 2. Phase 11 — Student Portal

### 2.1 IA & navigation

**New student nav (vs today's 2-item `Home` / `My Results` row):**

| Label | Route | `end` |
|---|---|---|
| Dashboard | `/student` | `true` |
| Profile | `/student/profile` | `false` |
| My Tests | `/student/results` | `false` |
| Tests | `/student/tests` | `false` |
| Resources | `/student/resources` | `false` |

- **Dashboard** replaces today's `Home` label — matches the admin label and the product's mental model.
- **My Tests** replaces today's `My Results` — it is a history/attempt page; Results is still the per-attempt review (unchanged pages).
- `/student/tests` (list index) vs `/student/tests/:testId/…` (shell-free exam flow): React Router rank resolves the index at `/student/tests`; the exam routes are outside `AppLayout` so the sidebar never renders during an exam. Verify in routes tests (already planned).

**Shell change summary (`AppLayout.tsx` + `global.css`):**
- Remove the `isAdmin` gate around the hamburger and the sidebar: **students now get the exact admin sidebar/drawer machinery** —
  - `<button class="icon-btn hamburger">`, `aria-expanded={navOpen}` + `aria-controls` matching the aside id (`admin-nav` for admin, `student-nav` for student) + `aria-label="Toggle navigation menu"`.
  - `<aside id={...} class="sidebar sidebar--open?">` with `aria-label` = `Admin navigation` / `Student navigation`; nav element class always `sidebar__nav` (drop the `nav-row` branch for students).
  - Reuse verbatim the existing drawer effect: open → focus first focusable in drawer, body scroll lock, Tab trap first/last, Escape closes, focus returns to hamburger on close **unless** navigation caused the close (`suppressFocusRestoreRef`), backdrop click closes (desktop-css-hidden, drawn at `≤1024px` only).
  - **Closed drawer is not focusable** — already guaranteed by `visibility:hidden` + transform in the `≤1024px` stylesheet block; keep it.
- Desktop (`>1024px`): static sticky `sidebar` (220 px) + content; no hamburger (`hamburger { display:none }` already).
- Header layout: hamburger on the left for both roles (student header now gets the hamburger that was admin-only), brand lockup next, user chip + Log out unchanged. No student nav row inside the header anymore.

### 2.2 Student Dashboard rewrite — `/student`

Data: three parallel react-query calls (deduplicate into `Promise.all` of `api.student.tests()`, `api.student.attempts()` [new], `api.student.resources()` [new]) — one loading surface, one error surface (a Partially-loaded page is acceptable: see per-section states).

**Page header**
- `page-heading`: `Welcome, {first name}` (unchanged).
- `page-sub`: `Here's what's new, and where you left off.`

**Insights strip** (reuses `.stat-grid` + `.stat-card`; today's grid is `repeat(3,1fr)` so add a **`stat-grid--4` modifier** = `repeat(auto-fit, minmax(210px, 1fr))` — the same auto-fit already used at `≤1024px`, hoisted to desktop for 4 cards; collapses to 1 column on narrow phones via the existing `≤768px` rule):

1. **Tests available** — value = count of published tests (`api.student.tests()` length). Hint: `Ready to take now`. Value `0` when none.
2. **Tests taken** — value = count of attempts with status `SUBMITTED` or `TIMED_OUT`. Hint: `Completed attempts`.
3. **Average score** — value = rounded mean of `percent` over scored attempts only; when there are **zero scored attempts show `—` (em dash, not `0%`)** — Phase 1 rule: a fake zero is misleading. Hint: `Across completed tests`.
4. **In progress** — value = count of attempts `IN_PROGRESS`. Hint: when 0 → `No tests started`; when > 0 → link `Resume →` to `/student/tests` (muted, underlined) — the only place Resume CTAs live.

Stat cards are otherwise display-only: `.stat-card` (padding `--space-5`), value in `--font-mono` `--text-2xl`, label `font-weight 600`, hint `--ink-faint` `--text-xs`. No icons, no spinners inside cards — the strip renders as part of the page loading surface.

**Recently added tests** (`section` + `section-title` `Recently added tests`)
- Top 3 from `api.student.tests()` in list order (server-sorted), rendered as **`test-card`s in `card-grid`**, reusing the current Dashboard card anatomy exactly: title (`test-card__title`), chips (`test-card__chips`: `{sectionCount} sections`, `{questionCount} questions`, attempt-status `Badge` from `ATTEMPT_STATUS_LABEL`/`VARIANT` when present), meta row (`durationLabel` · `{totalMarks} marks` · negative-marking note), CTA per `attemptAction(test)` (`Take test` / `Continue` / `Resume` / `View result`) — the exact helper already in today's Dashboard, unchanged.
- When > 3 tests: a quiet section footer link `View all tests` → `/student/tests` (`back-link`-style or muted link; no arrow decoration).
- Empty (no tests at all): `EmptyState` title `No tests available yet.` body `When an instructor publishes a test, it will appear here. You're all set — no action needed.` (unchanged copy from today).
- The dashboard-level test action **always deep-links**; no inline "start here" wizard.

**Recently added resources** (`section` + `section-title` `Recently added resources`)
- Top 3 newest-first from `api.student.resources()`, rendered with the same `resource-card` anatomy as §1.3 (title, kind badge, description, `Open` external link).
- When > 3: footer link `View all resources` → `/student/resources`.
- Empty: `EmptyState` title `No resources yet.` body `Study material will appear here when your instructor shares it.`

**Dashboard section order:** insights strip → Recently added tests → Recently added resources. Both sections always render their heading (consistent rhythm), each with its own empty state. No section ever disappears.

**Loading** — page-level: the strip + both sections render skeleton blocks (skeleton stat-cards: three `skeleton-row`s in `stat-grid`; `skeleton-row`s in `card-grid` for each section), `role="status"` + `sr-only` `Loading your dashboard…`, mirroring today's skeleton convention. `Promise.all` means one pending state for all three feeds.

**Error** — if the primary load fails: `ErrorState` with `Try again` refetch. Because the three feeds are parallel and independent, a partial failure degrades per section: each section that failed shows its own `ErrorState` (title `Couldn't load this section.`, `Try again` scoped to that query) while the others render — a fully-red dashboard is worse than a partially-missing one. For the stats strip, a feed failure renders `—` for the affected stat with hint `Unavailable` (no alarm styling).

### 2.3 Tests page — `/student/tests`

Extract the current Dashboard's "Available tests" grid verbatim into its own page (this is the existing `test-card` grid + `attemptAction`):

- `page-heading`: `Tests` · `page-sub`: `Take or resume a published test.`
- Section heading: `Available tests` (drop the per-section header? keep it — it anchors the grid and reads fine; the page header sub already says the same thing, so use section heading `Available tests` only when the empty state needs framing. **Decision:** page renders the grid directly under the page header with no redundant `Available tests` section title — the page header is the heading; avoids two adjacent headings saying the same thing.) [Conflicts-resolved note: keep the section title only if implementers find the grid needs it; default is no duplicate heading.]
- Loading: three `skeleton-row`s, `role="status"`, `sr-only` `Loading tests…`.
- Empty: two cases (Phase 1 §3.1):
  - `No tests available yet.` / `When an instructor publishes a test, it will appear here. You're all set — no action needed.`
  - All-completed variant: `You've completed everything currently available.` / `Check back soon — new tests will appear here.` (derive: tests list non-empty but every item has a finished attempt).
- Error: default `ErrorState` + `Try again`.

### 2.4 My Tests page — `/student/results`

Attempt history from the new `GET /api/student/attempts` (own attempts, newest-first `_id` desc, capped 200 — `ponytail:` no cursor yet; the cap is invisible at this scale, log for Phase 9).

**Page header:** `My Tests` · `page-sub`: `Your attempt history and scores.`

**Table** (reuse `Card class="table-card"` + `table-wrap` + `data-table`, same anatomy as admin AttemptsList):

| Column | Content |
|---|---|
| Test | Title — `data-table__link` to the result/attempt route for scored/in-progress rows |
| Status | `Badge` from `ATTEMPT_STATUS_LABEL`/`ATTEMPT_STATUS_VARIANT` (`Not started` / `In progress` / `Submitted` / `Timed out`) |
| Score | `marksEarned / totalMarks`, right-aligned `data-table__num`; `—` for GATED/IN_PROGRESS (not scored yet) |
| Percent | `n%` (rounded), `data-table__num`; `—` when not scored |
| Result | Per status: `SUBMITTED`/`TIMED_OUT` → link `View result` → `/student/tests/{testId}/result/{attemptId}`; `IN_PROGRESS` → link `Resume` → `/student/tests/{testId}/attempt/{attemptId}`; `GATED` → link `Continue` → `/student/tests/{testId}/instructions`. Blank cell for none. |

Percent is display-only derived from `marksEarned/totalMarks` client-side (avoid trust issues with a server field if it drifts; the server already returns both numbers). Status badge and result-link column are the same affordances the Dashboard already uses — no new vocabulary.

**Loading:** three `skeleton-row`s, `role="status"`, `sr-only` `Loading your attempts…`.
**Empty:** title `No attempts yet.` body `When you take a test, it will appear here with your score and result.`
**Error:** default `ErrorState` + `Try again`.

Result page reuse: the Result route stays untouched (shell-free, `Back to tests` link to `/student` is still accurate enough — reaching Results from My Tests is a forward link, and Tests remains the hub). Defer relabeling `Back to tests` → role-aware back link out of scope; note as a candidate polish.

### 2.5 Profile page — `/student/profile`

**Page header:** `Profile` · `page-sub`: `Update your name or password.`

**Account section** (`section` + `section-title` `Account`)
- **Full name** — `Field`, label `Full name`, `autocomplete="name"`, prefilled with `user.name`, `maxLength` per server. 
- Action: `Button variant="primary"` `Save changes` (`loading` while pending).
- Field error (server 400 on name): `Enter a name.`
- Success: inline `role="status"` message `Profile updated.` (see §2.6 success styling) — replaced on next edit.

**Change password section** (`section` + `section-title` `Change password`)
- Fields in order:
  1. **Current password** — `Field`, `type="password"`, `autocomplete="current-password"`, hint `Required to change your password.`
  2. **New password** — `Field`, `type="password"`, `autocomplete="new-password"`, hint `At least 8 characters.`
  3. **Confirm new password** — `Field`, `type="password"`, `autocomplete="new-password"`.
- Action: `Button variant="primary"` `Update password` (`loading` while pending).
- Validation copy:

| Condition | Field | Copy |
|---|---|---|
| Current password empty on submit | Current password | `Enter your current password.` |
| New password < 8 chars | New password | `Password must be at least 8 characters.` |
| Confirm doesn't match | Confirm new password | `Passwords don't match.` |
| Server 400 `INVALID_CREDENTIALS` (wrong current) | Current password | `Current password is incorrect.` |
| Generic server/network failure | Form-level (`form-error`) | `Something went wrong. Please try again.` |

- Behavior: clear field errors on edit; focus first invalid field on failed submit. On success: clear new/confirm fields, keep current-password empty, show `role="status"` `Password updated.` Both forms share the single name-update mutation; a password change does **not** log the student out (server keeps refresh sessions — `ponytail:` hard-revoke deferred).

**Loading/error:** the page is static client-side (name from `AuthContext`); no fetch. If the PATCH fails with a network error, `form-error` shows the generic copy; fields keep their values.

### 2.6 Success-message convention (new, tiny)

Mirror the existing `form-error` block (bg tint of `--danger`, 1px tinted border) with a `form-success` class built from existing tokens: background a light tint of `--success` (`#eef6f1`), border 1px `rgba(47,125,79,0.3)`, text `--success`, `--text-sm`, `margin-bottom: var(--space-4)`, `role="status"`. Used on Profile (both forms) and as the admin resources success banner (`banner--success`, same tint logic as `banner--error`). This is the only new CSS beyond the 4-card stat modifier and the resource-card class — both tiny.

---

## 3. Routes summary (delta from today)

| Route | Guard | Change |
|---|---|---|
| `/student` | `ProtectedRoute student` | Dashboard rewrite |
| `/student/profile` | same | **new** — Profile |
| `/student/results` | same | **replace** `Placeholder` — My Tests |
| `/student/tests` | same | **new** — Tests grid (extracted) |
| `/student/resources` | same | **new** — Resources |
| `/student/tests/:testId/instructions` / `attempt/:attemptId` / `result/:attemptId` | `ProtectedExamRoute` | **unchanged** (shell-free) |
| `/admin/resources` | admin | **new** — Resources management |

Collision note: `/student/tests` index vs `/student/tests/:testId/*` — React Router rank gives the static segment priority at that depth; because the shell-free exam routes live outside `AppLayout`, the sidebar never overlaps the exam, and the `NavLink` for `Tests` (`end:false`) is active only when the sidebar is actually rendered. Add a routes test that hits `/student/tests` and expects the list page (not the exam guard).

---

## 4. Shared conventions (reused from Phase 1 – keep untouched)

1. `Loading → Empty → Error` for every data view; copy defined above, not afterthought.
2. Confirm-before-destroy: verb in the button (`Delete resource`, `Delete test`), never generic `OK`.
3. External links: `target="_blank"` + `rel="noopener noreferrer"` + `sr-only` `(opens in a new tab)`; href is server-validated but treated as untrusted.
4. Focus-visible ring everywhere; never remove outline without a replacement.
5. Skip-link, `<nav aria-label>`, `aria-current="page"` on active NavLink, session-expiry banner app-wide (unchanged).
6. Modals/drawers: Escape, backdrop-click, trap, focus-return, unique `aria-labelledby`, close-while-pending guard.

---

## 5. A11y checklist (per page)

- [ ] Sidebar drawer: open focuses first link; Tab wraps first/last; Shift+Tab from first goes last; Escape closes; focus returns to hamburger on non-nav close; closed sidebar links unfocusable (`visibility:hidden` preserved).
- [ ] Hamburger: `aria-expanded`, `aria-controls` = aside id, accessible `aria-label`.
- [ ] Tables: `th scope="col"`, `aria-label` on table, right-aligned numeric cells `data-table__num`, `sr-only` prefixes where needed (`Marks awarded: ` pattern from Result).
- [ ] Badges convey status — never color-only: status labels are text (`Submitted`, `In progress`); kind badges are text (`PDF`).
- [ ] Forms: label every field, `aria-invalid` + `aria-describedby` on error fields (via existing `Field`/`TextareaField`/`SelectField` props), focus first invalid on failed submit, `autocomplete` attributes per §2.5/§1.2, success messages `role="status"`, errors in `role="alert"` (`form-error`, `error-state` already do).
- [ ] External links announce new tab via `sr-only`.
- [ ] Empty/loading/error surfaces use headings and `role="status"`/`role="alert"` as the existing primitives do.
- [ ] Stat strip: values are text (mono), labels paired; zero-vs-dash distinction is defined (§2.2) so no aria mismatch.
- [ ] Dashboard sections `aria-labelledby` their `section-title` ids.

---

## 6. Responsive behavior

| Breakpoint | Behavior |
|---|---|
| `>1024px` | Static 220px sidebar both roles; hamburger hidden; content max-width container unchanged; `stat-grid--4` auto-fits 4-across |
| `≤1024px` | Hamburger shown; sidebar becomes 260px overlay drawer (transform + backdrop + focus mgmt — existing admin CSS reused as-is for students); `stat-grid--4` reflows via auto-fit |
| `≤768px` | stat grid 1 column; user-chip name hidden; `.app-main` padding per existing rule; data tables scroll inside `table-wrap` (already) |
| `≤480px` | compact header, brand-name hidden per existing rule |

No new breakpoint logic. Student sidebar = copy the admin's already-hardened CSS + JSX pattern.

---

## 7. Out of scope / deferred (logged)

- **No resource edit endpoint** — delete + re-add covers typos (`ponytail:`); revisit only if admins ask.
- **No resource pin/publish gating** — created = visible; revisit if staging is needed.
- **Student attempts list cap 200, no cursor** — revisit Phase 9 pagination.
- **"Avg score" = simple mean of attempt percents** (no weighting) — logged.
- **Result page `Back to tests` label** stays; role-aware back link is polish.
- **Admin analytics untouched** — out of scope for this phase.
- **`stat-grid--4`, `resource-card`, `banner--success`, `form-success`** are the only new CSS classes; everything else reuses existing classes.