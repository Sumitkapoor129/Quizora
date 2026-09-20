# Phase 1 UX Spec — Auth & App Shell

**Status:** Approved for implementation
**Scope:** Auth screens (Register / Login) + Student & Admin app shells + dashboard placeholders
**Stack:** React frontend · Node + Express + Mongoose backend · cookie sessions
**Visual direction:** Premium professional software — paper-and-ink palette, one ink-blue accent, clean hierarchy, minimal shadows, no flash.

**Brand:** **ExamPro** (neutral, short, works for both roles; avoid "Mock Exams" wording in UI — it reads like a demo site). Header lockup: ink-blue rounded square with "EP" monogram + "ExamPro" wordmark. No tagline.

**Design token baseline (implement once, reuse everywhere):**
| Token | Value |
|---|---|
| Ink (primary text) | `#1a1d21` |
| Accent | `#2b5bd7` (hover `#2147a8`, tint `#edf2fd`) |
| Paper (page bg) | `#fafaf9` |
| Surface (card bg) | `#ffffff` |
| Border | `#e4e7eb` |
| Muted text | `#5c6470` (faint `#8a919c`) |
| Success / Danger | `#2f7d4f` / `#c0392b` |
| Radius | tokens sm/md/lg = 6 / 10 / 14 px (cards 10 px, buttons/inputs 6 px) |

---

## 1. Auth Flow

### 1.1 Register

**Fields (in order):**
1. **Full name** — label "Full name", placeholder "e.g. Aria Sharma", `autocomplete="name"`.
2. **Email** — label "Email", placeholder "you@example.com", `type="email"`, `autocomplete="email"`.
3. **Password** — label "Password", `type="password"`, `autocomplete="new-password"`, helper text under field: "At least 8 characters."
4. **Role** *(Phase 1 stub only)* — label "I am a", select with **Student** (default) and **Admin**. Helper text: "Phase 1 demo — real role assignment arrives with backend auth." This is temporary; delete when the backend assigns roles.

**Password rules:** minimum 8 characters. No complexity requirements in Phase 1 (keep friction low; raise later if policy demands).

**Validation behavior:**
- Validate a field on **blur** and on **submit**.
- Clear the field's error as soon as the user edits that field.
- On submit, if any field errors, focus the first invalid field.

**Exact inline error copy (field-level, shown under the field):**

| Condition | Field | Copy |
|---|---|---|
| Empty name on submit | Name | `Name is required.` |
| Empty email on submit | Email | `Email is required.` |
| Malformed email (e.g. `foo@`) | Email | `Enter a valid email address.` |
| Password < 8 chars | Password | `Password must be at least 8 characters.` |
| Duplicate email (server returns 409) | Email | `An account with this email already exists.` |
| Any other server/network failure | Form-level (above submit button) | `Something went wrong. Please try again.` |

**Loading:** submit button disables and shows `Creating account…`. Form fields lock (no edits while in flight). No double submit — spin-up guard.

**Success behavior:**
- Register **auto-logs the user in** (server sets the session cookie in the same response — Phase 1 stub; backend Phase 2 completes this).
- Redirect: to `?next=` if present (deep link), otherwise by role — student → `/student`, admin → `/admin`.

**What the user sees between submit and landing:** the submit button reads `Creating account…` (disabled); on success there is **no interstitial** — an immediate redirect to the dashboard shell, which shows its own loading skeletons while data fetches. If the request fails with the duplicate/generic error, the form stays filled and the error appears inline.

### 1.2 Login

**Fields:**
1. **Email** — label "Email", `type="email"`, `autocomplete="email"`.
2. **Password** — label "Password", `type="password"`, `autocomplete="current-password"`.

**Exact error copy:**

| Condition | Field | Copy |
|---|---|---|
| Empty email on submit | Email | `Email is required.` |
| Empty password on submit | Password | `Password is required.` |
| Wrong credentials (server 401) | Form-level | `Invalid email or password.` |
| Any other server/network failure | Form-level | `Something went wrong. Please try again.` |

- Wrong credentials use **one message** — do not reveal whether the email exists (no user enumeration).
- On 401, clear password only, focus password, keep email filled.
- On generic error, keep both fields filled.

**Loading:** submit button disables and shows `Signing in…`. Fields lock.

**Remember-session note:** this is a **cookie app** — the server sets an httpOnly, `SameSite=Lax` session cookie. There is **nothing to configure on the client** and **no "Remember me" checkbox** in Phase 1. Session lifetime is a backend concern; the client simply carries the cookie.

**Redirect logic (after successful login or auto-login from register):**
1. If the page URL has `?next=` (captured when the app redirected a logged-out user to login) → validate it is a same-origin internal path, then go there.
2. Otherwise, by role: **student → `/student`**, **admin → `/admin`**.
3. Bonus (cheap, worth it): if a logged-in user hits `/login`, redirect them to their role home instead of showing the form.

### 1.3 Session Expiry UX (spec now, build in later phases)

Do **not** hard-redirect on expiry — that loses the user's place.

**Plan:** a global API layer detects a `401` on any authed request (excluding the login/register calls themselves) and triggers a **non-blocking banner**.

**Banner copy:**
- Title: `Your session has expired.`
- Body: `Sign in again to continue. You won't lose your place — we'll bring you back to where you were.`
- Button: `Sign in` → navigates to `/login?next=<current-path>`.

The current page stays visible underneath, content becomes read-only (interactions disabled), and after a successful re-login the user returns to the exact path in `?next=`.

### 1.4 Auth page chrome

- Centered card (max-width 420 px) on paper background; brand lockup above the form.
- Links: Register page shows `/ Sign in` link ("Already have an account? Sign in"). Login page shows `Don't have an account? Create one`.
- On error, no nav animations, no confetti. Quiet and recoverable.

---

## 2. App Shell

### 2.1 Shared header (Student)

- **Left:** brand lockup (clickable → role home).
- **Center/left nav:** **`Home`** and **`My Results`** — two items, plain text or hairline icons.
- **Right:** user menu — a button showing the user's initials in a small circle + first name; opens a dropdown with **full name** (non-clickable header), **`Logout`**.
- **Active state:** active item rendered in ink with a 2 px ink-blue underline (or filled pill — pick one in implementation) + `aria-current="page"`. Inactive items muted; hover darkens to ink.
- **Logout:** instant action, no confirmation (non-destructive). On success → `/login`.

**Mobile (< 768 px):** compact header — brand + user menu (initials only, name hidden). Because Home/My Results are just two short items, keep them visible inline even on mobile; no hamburger needed for the student shell.

### 2.2 Admin shell (sidebar)

- **Sidebar (≥ 1024 px):** fixed left rail with the 4 items, stacked, labels:
  - **`Dashboard`**
  - **`Tests`**
  - **`Attempts / Results`**
  - **`Analytics`**
- Active item rendered with ink text + ink-blue left indicator + `aria-current="page"`.
- **Below 1024 px:** sidebar collapses to a hamburger in a compact top header. Tapping opens an **overlay drawer** (slide-in from left) with backdrop; Escape or backdrop-click closes; body scroll locks while open; focus moves into the drawer and returns to the hamburger on close. `aria-expanded` + `aria-controls` on the toggle.

**Fresh-admin empty-shell behavior:** the shell renders normally (sidebar always visible so the admin can navigate); each page shows its own empty state (see §4). The **`Tests`** page empty state carries the CTA — primary button **`Create your first test`**. Test-building ships in a later phase, so in Phase 1 this button is **disabled** with a visually-dismissed hint: `Test creation arrives in a later phase.` (Tooltip/title text; do not fake a builder.)

---

## 3. Student Dashboard

Route: `/student`. Page title: **`Welcome, {first name}`** (e.g., "Welcome, Aria").

Three sections, in order:

### 3.1 Available tests
Section heading: **`Available tests`**.
- **Empty — new student, nothing published:** `No tests available yet.` / body: `When an instructor publishes a test, it will appear here. You're all set — no action needed.` Backs it up with a quiet hint that the page refreshes on visit.
- **Empty — all completed/due:** `You've completed everything currently available.` / body: `Check back soon — new tests will appear here.`

### 3.2 Upcoming
Section heading: **`Upcoming`** (shown always; scheduling arrives in a later phase).
- **Empty:** `No upcoming tests.` / body: `Scheduled tests will show up here with their start time before they open.`

### 3.3 Taken
Section heading: **`Taken`**.
- **Empty:** `No results yet.` / body: `Once you finish a test, your score and marked answers will appear here.`

**New-student warm state (first visit, no tests at all):** the dashboard opens on the Available section with the copy above plus a title-level touch: `Welcome to ExamPro, {name}.` This is not a dead end — it says exactly what happens next ("when a test is published it appears here") and nothing is broken-looking.

### 3.4 Test card anatomy (target for later phases)

Each card (surface, 1 px border, 10 px radius (`--r-md`), no glow) must be able to hold:
- **Test name** — heading, clamp to 2 lines.
- **Duration** — `45 min` (format: `{n} min`).
- **Total marks** — `100 marks`.
- **Sections count** — `3 sections` (singular: `1 section`).
- **Negative-marking badge** — only when negative marking applies, e.g. `-0.25 wrong answer` / `-1/3 per wrong answer`, as a small muted chip. Absent badge = no negative marking.
- **Status chip (future):** `Available` / `Upcoming` (with start time) / `Taken` (with score, e.g. `72%`).
- **Action slot (future):** primary CTA `Start test` (or `Resume`), secondary `View results` for taken tests.
- Meta row layout: duration · marks · sections, dot-separated, muted.

**Loading:** use **skeleton cards** matching this anatomy (3 gray pulse blocks) — recommended over a spinner because the layout is predictable. A single spinner is acceptable only during the post-login redirect.

---

## 4. Admin Dashboard

Route: `/admin`. Page title: **`Dashboard`**.

### 4.1 Summary cards (the 3 numbers that matter first)

Row of 3 cards, each with a muted label, a large number, and a subtle hint:

1. **`Published tests`** — count of published tests. Hint: `tests published across all time`.
2. **`Attempts today`** — completed attempts in the last 24 h. Hint: `submissions in the last 24 hours`.
3. **`Average score`** — mean score percentage across all attempts. Hint: `mean across all attempts`.

**Empty data behavior:** cards show `0` for counts and **`—`** (em dash, not `0%`) for Average score when there are zero attempts — a fake zero is misleading.

### 4.2 Fresh-install empty state

Page-level empty card (after the summary cards):
- Title: `No students have attempted tests yet.`
- Body: `When students submit an attempt, scores and averages will appear here.`
- CTA: `Create your first test` → disabled in Phase 1 with the same `Test creation arrives in a later phase.` hint as §2.2.

### 4.3 Recent attempts (placeholder)

Section heading: **`Recent attempts`** — a compact table placeholdering the final version:

| Student | Test | Score | Time |
|---|---|---|---|
| *(empty)* | | | |

- **Empty:** `No recent attempts.` / body: `Completed test submissions will show up here.`

**Which 3 numbers matter first (ranked):** (1) published tests, (2) attempts, (3) average score. If a fourth card is ever added, it should be pass rate — not now (YAGNI).

---

## 5. Interaction Requirements (shell checklist)

- **Focus-visible:** every interactive element shows a clear 2 px ink-blue focus ring via `:focus-visible`. Never remove the outline without replacing it. Keyboard users must always see where they are.
- **Loading vs empty vs error pattern (app-wide):** a shared state system — `LoadingState` (skeleton) → data → `EmptyState` (muted title + body + optional CTA, no sad icons) → `ErrorState`.
- **ErrorState (recommended):** title `Something went wrong.` body `We couldn't load this. Please try again.` + button **`Try again`** that re-runs the fetch. This is the standard error surface for every data-driven view; per-page custom copy only when the context demands it.
- **404 page:** title `Page not found` / body `The page you're looking for doesn't exist or has moved.` / primary button `Back to {Home/Dashboard}` (role-aware) + quiet link `Log out`.
- **Role mismatch guard (401-level, not 404):** a student hitting `/admin` sees `You don't have access to this page.` + `Back to your home` — never expose admin content.
- **Skip link:** `Skip to content` as the first focusable element on every shell page.
- **Nav a11y:** `<nav aria-label="Primary">` landmark; active item carries `aria-current="page"`; user menu button `aria-expanded` + `aria-haspopup="menu"`.
- **Modals/drawers (any, incl. admin mobile drawer):** Escape closes; backdrop-click closes; focus trapped while open; focus returns to the trigger on close.
- **Mobile nav:** hamburger `aria-expanded` + `aria-controls`, menu given an accessible label; body scroll lock while drawer is open.
- **Forms reuse:** auth forms establish the shared field + inline-error component pattern; every later-phase form reuses it (consistent error copy style).

---

## 6. Rules Enforced in Later Phases (build the shell future-proof)

1. **The exam interface is a full-screen focused grid.** Taking a test renders outside the app shell — no student nav, no admin sidebar, no chrome. The shell must be structured so a route (`/exam/:id`) can render shell-free.
2. **Admin sidebars never leak into student flows, and vice versa.** Role-based guard on both client routes and server APIs; admins and students are separate route trees (`/admin/*`, `/student/*`) with no shared screens.
3. **All destructive or high-stakes actions require explicit confirmation** — delete test, unpublish a live test, archive results. Confirm modal states the consequence in the button verb (e.g. `Delete test`) — never a generic "OK".
4. **Confirmation of exam submission is two-step** (final submit asks "You still have {n} unanswered — Submit anyway?" the exam catches unanswered items before final submit). Never silently drop work.
5. **Session-expiry banner pattern from §1.3 applies app-wide**, preserving the user's place on every relogin.
6. **Every data view defines Loading, Empty, and Error copy up front** — empty states are designed, not afterthoughts.
7. **Test timing and marking rules are server-authoritative.** Client timers are display-only; never trust client-side time for scoring.
8. **Right-to-work defaults:** no autosave-only flows — all saves are explicit (except an in-exam heartbeat that future phases add); no feature is "added" without a user need behind it.

---

*Feed this spec to UI implementation and QA. Copy strings above are source-of-truth for Phase 1.*