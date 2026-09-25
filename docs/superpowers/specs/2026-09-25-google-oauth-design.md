# Google OAuth Authentication — Design Spec

Date: 2026-09-25
Status: approved (user-confirmed decisions below)
Supersedes: the password + email-OTP auth system added in Phase 12-OTP
  (`server/src/routes/auth.ts` register/login/forgot/reset flows,
  `server/src/models/EmailOtp.ts`, `server/src/services/mailer.ts`).

---

## 1. Goal

Replace all local auth (email + password, and the email-OTP registration and
password-reset flows) with a single Google sign-in button. An administrator
creates timed tests; a student signs in with a Google account and takes them.
Nothing else about the product changes.

Non-goals are listed in §10.

## 2. Confirmed decisions

These were put to the user and answered. They are binding on implementation.

| # | Decision | Answer |
|---|---|---|
| D1 | Auth provider | Google OAuth only. Hand-rolled authorization-code flow, **zero new dependencies** |
| D2 | Local password auth | Removed entirely: no `passwordHash`, no `argon2`, no `nodemailer`, no OTP |
| D3 | Admin bootstrap | `ADMIN_EMAILS` env allowlist (comma-separated, same parsing style as `CLIENT_ORIGIN`) |
| D4 | Role on sign-in | **Re-evaluated on every Google sign-in**: `ADMIN_EMAILS` contains the email → `ADMIN`, otherwise `STUDENT`. Removing an email from the list revokes admin on that user's next sign-in. Production **fails fast at boot** when `ADMIN_EMAILS` is empty, so the list can never silently lock every admin out |
| D5 | Existing accounts | A pre-OAuth account has no `googleId`. First Google sign-in **links by email**, preserving the existing account and its `name` so a student's edited profile name survives. Its `role` is *not* preserved — it follows D4, so an operator whose email is missing from `ADMIN_EMAILS` is demoted to `STUDENT` on first sign-in (deploy step 2 prevents that) |
| D6 | Live client origin | `https://quizora-rho.vercel.app` (backend `https://quizora-ppfp.onrender.com`) |
| D7 | Server test auth | New shared helper mints a session directly. No test-only route in production code |
| D8 | `/register` page | **Deleted.** One `/login` page with the Google button; `/register` redirects to `/login` |
| D9 | `JWT_REFRESH_SECRET` | **Deleted.** It is required by `env.ts` today but signs and verifies nothing — refresh tokens are opaque random bytes (`server/src/routes/auth.ts:90`) |

## 3. Approaches considered

**A. Hand-rolled authorization-code flow (chosen).** `server/src/services/googleOAuth.ts`
with three thin functions over Node's global `fetch` and `node:crypto`. Tests stub
`fetch` with `vi.stubGlobal`. Zero new dependencies, consistent with every previous
phase in this repo.

**B. `google-auth-library` / `passport-google-oauth20`.** Rejected: a new dependency
for roughly forty lines of a documented protocol, and harder to stub in tests.

**C. Client-side Google Identity Services + server-side ID-token verification.**
Rejected: adds a third-party script to the bundle, needs JWKS fetching on the server,
and is the worst of the three on performance and moving parts.

## 4. Server design

### 4.1 Data model

`server/src/models/User.ts`:

- **remove** `passwordHash` (currently `required: true, select: false` at line 7 —
  it must go, or account creation without a password fails validation)
- **add** `googleId: { type: String, unique: true, sparse: true, index: true }`
- `email` stays `unique, lowercase, trim` — it is the link key and the
  `ADMIN_EMAILS` lookup key
- `name` stays `required, trim`; `role` stays `enum ['ADMIN','STUDENT'], default 'STUDENT'`

`server/src/models/EmailOtp.ts` is **deleted**. `RefreshSession` is unchanged —
OAuth issues the same opaque refresh session as a password login did.

`ponytail:` existing documents keep an orphaned `passwordHash` field in MongoDB
that Mongoose ignores on read. Harmless; a one-line `$unset` is in the deploy
runbook (§9) and is optional.

### 4.2 New service: `server/src/services/googleOAuth.ts`

Three exported functions, no side effects beyond the network call, each
independently testable by stubbing `fetch`:

```ts
buildAuthUrl(opts: { state: string }): string
exchangeCode(code: string): Promise<string>        // → access_token
fetchProfile(accessToken: string): Promise<{ sub: string; email: string; name?: string; email_verified?: boolean }>
```

- `buildAuthUrl` → `https://accounts.google.com/o/oauth2/v2/auth` with
  `client_id`, `redirect_uri` (`OAUTH_CALLBACK_URL`), `response_type=code`,
  `scope=openid email profile`, `state`. Built with `URL` + `searchParams`.
- `exchangeCode` → `POST https://oauth2.googleapis.com/token`,
  `grant_type=authorization_code`, `code`, `client_id`, `client_secret`,
  `redirect_uri`. Returns the `access_token`. Non-2xx or a body without
  `access_token` throws.
- `fetchProfile` → `GET https://openidconnect.googleapis.com/v1/userinfo` with
  `Authorization: Bearer <access_token>`. Non-2xx throws.

No `access_type=offline`, no refresh-token handling from Google, no `prompt`, no
`login_hint`: we issue our own session and never talk to Google again after
sign-in.

### 4.3 New service: `server/src/services/session.ts`

Lifted out of `server/src/routes/auth.ts` so the auth routes and the server test
helper can both import them. Every helper keeps its current implementation; the
one change is that `issueSession` absorbs the `setAuthCookies` call, because the
OAuth callback holds a `Response` and must not have to remember the pair:

- `ACCESS_TTL_MS` (15 min), `REFRESH_TTL_MS` (7 d)
- `hashToken`, `newRefreshToken`
- `signAccessToken(user)` — HS256, payload `{ id, email, role, type: 'access' }`
- `cookieBase`, `setAuthCookies`, `clearAuthCookies`
- `issueSession(user, res)` — creates the `RefreshSession` doc and sets both cookies

`server/src/routes/auth.ts` imports from it. Nothing else changes in the shape of
`/refresh`, `/logout` or `/me`, so the client's refresh machinery, the
`ApiError` handling and the session-expiry banner are unaffected.

### 4.4 Routes

Mounted on the existing `authRouter` at `/api/auth` (`server/src/app.ts:30`).

| Method | Path | Behaviour |
|---|---|---|
| GET | `/oauth/google` | Validate optional `?next=` with the server-side `safeNext`; generate `state = randomBytes(32).toString('base64url')`; set `oauthState` and `oauthNext` cookies; `302` to `buildAuthUrl` |
| GET | `/oauth/google/callback` | Verify state, exchange the code, fetch the profile, upsert the user, `issueSession`, `302` to `APP_ORIGIN + next` |
| POST | `/refresh` | Unchanged |
| POST | `/logout` | Unchanged |
| GET | `/me` | Unchanged |

**Deleted:** `POST /register`, `POST /register/verify`, `POST /forgot-password`,
`POST /reset-password`, `POST /login`. Each returns `404 NOT_FOUND` through the
existing `notFound` middleware. Rate limiters for the deleted routes are deleted
with them; `/refresh`'s 60/min limiter stays. `/oauth/google` gets no limiter —
its cost is one redirect to Google, and it is not a credential-guessing surface.

**The callback has no express-rate-limit** for the same reason, but it *is*
protected by the state cookie, which is the real defence.

### 4.5 The `originCheck` exemption (load-bearing)

`server/src/middleware/originCheck.ts:15-25` rejects any request whose `Referer`
origin is not in `CLIENT_ORIGINS`, and it is mounted app-wide at
`server/src/app.ts:24`. Google redirects the browser to the callback with
`Referer: https://accounts.google.com/`, so the callback **would be rejected with
403 `ORIGIN_FORBIDDEN`**.

Therefore: `originCheck` **skips the path `/api/auth/oauth/google/callback`** and
nothing else. The state cookie is the CSRF defence on that route — an attacker
cannot forge it without a browser that holds the httpOnly cookie. The start route
`/oauth/google` stays checked (its referer is the app itself, which is
allowlisted), and `/refresh`, `/logout`, `/me` and all admin/student routes stay
checked.

Do **not** solve this by adding `accounts.google.com` to `CLIENT_ORIGINS` — that
weakens the check for every route.

A regression test asserts the callback is not 403'd when the request carries
`Referer: https://accounts.google.com/`.

### 4.6 The callback algorithm

```
1. state = query.state; cookieState = cookies.oauthState
   missing either, or they differ  → fail('state_mismatch')
2. next = cookies.oauthNext ?? '/'          (already validated at start)
3. clear both oauth cookies (all paths, success or failure)
4. if query.error (user denied access)       → fail('google_error')
5. code = query.code; missing                → fail('missing_code')
6. accessToken = exchangeCode(code)          → fail('exchange_failed') on throw
7. profile = fetchProfile(accessToken)       → fail('profile_failed') on throw
8. if (!profile.email || profile.email_verified === false) → fail('email_unverified')
9. email = profile.email.trim().toLowerCase()
   name  = profile.name?.trim() || email.split('@')[0]
   role  = ADMIN_EMAILS.has(email) ? 'ADMIN' : 'STUDENT'
10. user =
      (a) by googleId = profile.sub          → reuse
      (b) else by email                       → set user.googleId = profile.sub,
                                                 user.role = role, keep user.name
      (c) else User.create({ googleId: profile.sub, email, name, role })
    In (a) and (b) the role is always re-assigned per D4.
11. issueSession(user, res)
12. 302 → APP_ORIGIN + next
```

- The email used for lookup and for the `ADMIN_EMAILS` check is always
  lower-cased and trimmed, matching the schema's `lowercase, trim`.
- `next` is never taken from the callback query — only from the httpOnly cookie,
  so it cannot be tampered with between the two hops.
- Every `fail(reason)` logs `reason` server-side and answers
  `302 → APP_ORIGIN + '/login?oauth=error'`. No Google error string ever reaches
  the browser.
- A duplicate-key race on `User.create` (two tabs finishing sign-in at once) is
  caught and retried as a lookup by `googleId`, then by `email`.

### 4.7 Server-side `safeNext`

`?next=` arrives from the browser and is used to build a redirect, so it is
untrusted input. One helper, `safeNext(raw)`, on the server:

- `null`/empty → `/`
- must start with `/`
- must not start with `//` (protocol-relative)
- must not contain `\`
- otherwise returned verbatim

The value is stored in the `oauthNext` cookie and reused in step 2, so it is
validated exactly once. The client's existing identical check
(`client/src/pages/auth/Login.tsx:28-34`) stays for its own use and is not a
second source of truth for the server.

### 4.8 Configuration

`server/src/config/env.ts` — **added:**

| Key | Type | Notes |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | string | test-mode fallback `'test-google-client-id'`, like the JWT secrets |
| `GOOGLE_OAUTH_CLIENT_SECRET` | string | test-mode fallback `'test-google-client-secret'` |
| `OAUTH_CALLBACK_URL` | string | must be a valid `http(s)` URL; test fallback `http://localhost:3001/api/auth/oauth/google/callback` |
| `ADMIN_EMAILS` | string | comma-separated → `env.ADMIN_EMAIL_SET: Set<string>` of lower-cased addresses; defaults to empty |

**Removed:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`,
`JWT_REFRESH_SECRET`. Removed keys are dropped from the exported `env` object,
so any surviving reference is a TypeScript error rather than a silent `undefined`.

`server/.env.example` is rewritten to match.

**Production fail-fast**, alongside the existing `COOKIE_SECURE` check:

- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `OAUTH_CALLBACK_URL`
  missing → print a hint naming the variable and `process.exit(1)`.
- `ADMIN_EMAILS` empty → print a hint and `process.exit(1)` (D4: an empty
  allowlist would demote every admin on their next sign-in).

**`APP_ORIGIN` is not a new variable.** The post-sign-in redirect target is
`env.CLIENT_ORIGINS[0]`. That is the app origin in both environments — Vercel in
production, `http://localhost:5173` in development — while
`new URL(OAUTH_CALLBACK_URL).origin` would be the *server* origin and would land
the browser on a 404 in development. **Invariant to document in the file: the
first entry of `CLIENT_ORIGIN` is the app origin.** `CLIENT_ORIGIN` always has at
least one entry (it defaults to `http://localhost:5173`).

### 4.9 Deleted server files and dependencies

- `server/src/models/EmailOtp.ts` — deleted
- `server/src/services/mailer.ts` — deleted
- `server/tests/auth-otp.test.ts`, `server/tests/auth-password-reset.test.ts` — deleted
- dependencies `argon2`, `nodemailer` removed from `package.json`; devDependency
  `@types/nodemailer` removed

`server/src/routes/student.ts` — `PATCH /api/student/profile` becomes name-only:
the `currentPassword` / `newPassword` zod fields, the `argon2` import, and the
rehash block are removed. A body with only `name` succeeds; a body carrying
password fields is rejected as unknown by zod's strip mode. The response keeps
its existing `authBody` shape.

## 5. Client design

### 5.1 `client/src/pages/auth/Login.tsx` — the whole auth UI

One card, one control, plus an error banner slot:

- brand lockup and `auth-card` shell reused exactly as today
- `<h1>Sign in</h1>` / `<p class="auth-sub">Use your Google account to continue.</p>`
- **one anchor**: `<a class="btn btn--primary btn--md btn--block" href={startUrl}>`
  containing the inline 4-colour Google "G" SVG (one module constant, no network
  request, no image asset) and the label `Continue with Google`. A real anchor,
  not a `Button` with an `onClick` — it is a navigation, so middle-click,
  keyboard and "open in new tab" must work.
- when `?oauth=error` is present: one `<p class="form-error" role="alert">` above
  the button reading `Sign-in didn't complete. Please try again.`
- the existing already-authenticated early `<Navigate>` is unchanged
- the existing local `safeNext` still validates `?next=` before it is embedded in
  the start URL

`startUrl = api.auth.googleStartUrl(next)` where

```ts
googleStartUrl: (next?: string) =>
  `${BASE_URL}/api/auth/oauth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`
```

`BASE_URL` is `''` in production, so this is a same-origin path that Vercel
rewrites to Render; in development it is `http://localhost:3001`. No `fetch` is
involved — the browser navigates.

### 5.2 Deleted client files

`client/src/pages/auth/Register.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`,
and their tests. `/register` keeps a route entry that renders
`<Navigate to="/login" replace />` (D8). `/forgot-password` and
`/reset-password` are removed from the route table and fall through to
`NotFound`.

### 5.3 `AuthContext`

`AuthContextValue` becomes `{ user, sessionExpiresAt, status, expired, logout }`
— `login` and `verifyRegister` are removed. `checkSession` (the `/me` probe on
mount and on window focus), the single-flight guard, and the `onSessionExpired`
subscription are unchanged: after the callback sets the cookies, the full-page
navigation to `/admin` or `/student` mounts `AuthProvider`, which probes `/me`
and finds the session.

### 5.4 `api/client.ts` and `types/index.ts`

- `api.auth` keeps `me`, `logout`; gains `googleStartUrl`. Removed: `login`,
  `sendRegisterOtp`, `verifyRegister`, `forgotPassword`, `resetPassword`, and
  `refresh` (present but never called — the module-private `refreshSession()` is
  what the 401 path uses).
- `request`, `ApiError`, `refreshSession`, `mapSession`, `mapRole` and the
  lowercase `Role` mapping are untouched.
- `OtpSentResponse` deleted. `ProfileUpdateInput` becomes `{ name?: string }`.
  `ProfileUpdateResponse` unchanged.

### 5.5 `Profile.tsx`

Name field plus save. The password section, the mismatch check, the
`currentPassword` field and its `INVALID_CREDENTIALS` mapping are removed.

### 5.6 No new client dependencies, no new UI primitives

The button is the existing `.btn` class set. The bundle loses three pages and
three test files; it gains no dependency.

## 6. Error handling summary

| Situation | Server | Client sees |
|---|---|---|
| User denies consent at Google | `302 /login?oauth=error`, logs `google_error` | Error banner on `/login` |
| State missing or mismatched | same, logs `state_mismatch`; both cookies cleared | Error banner |
| Token exchange or profile fetch fails | same, logs the reason | Error banner |
| Google email not verified | same, logs `email_unverified`; no user created | Error banner |
| Any request to the callback with a `Referer` at all | Accepted — the exemption is **path-based, not referer-based**. No referer is rejected on that one path; an attacker cannot forge a request that passes the state check | Error banner after the second hop |
| Access token expired mid-session | unchanged: `401` → single-flight refresh → replay | unchanged session-expiry banner |
| `ADMIN_EMAILS` empty in production | boot fails with a hint naming the variable | — |

## 7. Testing plan

TDD throughout: every test is written, watched failing for the right reason, then
the minimum code is written to pass it.

### 7.1 New `server/tests/oauth.test.ts`

1. `GET /oauth/google` → 302 to `accounts.google.com` carrying `client_id`,
   `redirect_uri`, `response_type=code`, `scope=openid email profile`, a `state`,
   and sets httpOnly `oauthState` + `oauthNext` cookies.
2. `?next=/admin/analytics` is carried in `oauthNext`; `?next=//evil.example.com`
   and `?next=/\evil` are both stored as `/`.
3. Happy callback (stubbed `fetch`) → 302 to `http://localhost:5173/student`,
   sets `accessToken` + `refreshToken` cookies, creates a `STUDENT`, and
   `GET /api/auth/me` with the cookie returns that user.
4. Second sign-in with the same `googleId` reuses the account (one `User` doc).
5. A pre-OAuth user (no `googleId`, same email, `name: 'Original Name'`, email in
   `ADMIN_EMAILS`) is linked: exactly one `User` doc, `googleId` set, `name`
   still `'Original Name'`, `role` now `ADMIN` per D4.
6. An email in `ADMIN_EMAILS` gets `role: 'ADMIN'`; a second sign-in for an email
   *removed* from the list is demoted back to `STUDENT`.
7. `state` mismatch → no session, both cookies cleared, 302 `?oauth=error`.
8. `email_verified: false` → 302 `?oauth=error` and no `User` created.
9. Google token endpoint returns 400 → 302 `?oauth=error`, no session.
10. The callback with `Referer: https://accounts.google.com/` is **not** 403'd;
    `/api/auth/refresh` with the same foreign referer still is.
11. `POST /login`, `/register`, `/register/verify`, `/forgot-password`,
    `/reset-password` all return `404` with the standard error shape.

### 7.2 New `server/tests/helpers/auth.ts`

Two exports, replacing the seven duplicated `login`+`cookiePair` helpers
(`admin-attempts`, `import-admin`, `resources`, `student-exam`, `student-portal`,
`tests-admin`, `admin-analytics`):

```ts
export async function seedUser(opts?: { role?: 'ADMIN' | 'STUDENT'; email?: string; name?: string }):
  Promise<{ id: string; email: string; name: string; role: 'ADMIN' | 'STUDENT' }>

export async function createTestSession(opts?: { role?: 'ADMIN' | 'STUDENT'; email?: string; name?: string }):
  Promise<SeededUser & { accessCookie: string; refreshCookie: string; refreshToken: string }>
```

`seedUser` creates the `User` alone. `createTestSession` is `seedUser` plus a real
`RefreshSession` and a signed access token (via `signAccessToken` from
`services/session.ts`) — `/me` requires a live session, so a cookie without one is
not an authenticated user. Cookies are returned as ready-made `Cookie` header
values (`accessToken=…`), so no file scrapes `set-cookie` any more.

### 7.3 Existing server tests

- `auth.test.ts` — pruned to `/refresh` (rotation, replay grace, genuine replay),
  `/logout`, `/me`
- `auth-otp.test.ts`, `auth-password-reset.test.ts` — deleted
- the seven other files — login helper swapped for `createTestSession`
- `auth.test.ts`, `student-portal.test.ts` also switch to the helper as part of
  their pruning
- `db-harness.test.ts` — the assertion on `passwordHash` is replaced with one on
  `googleId` uniqueness and the `STUDENT` role default
- expected total: ~152 → ~137

### 7.4 Client tests

- `Login.test.tsx` — rewritten: the anchor's `href` is the start URL; `?next` is
  preserved and an unsafe one is dropped; `?oauth=error` shows the banner and
  nothing shows it otherwise; an already-authenticated visitor is redirected to
  the role home. Assert the path with a regex, not an exact string — under vitest
  `import.meta.env.DEV` is true, so `BASE_URL` is `http://localhost:3001`.
- `Register.test.tsx`, `ForgotPassword.test.tsx`, `ResetPassword.test.tsx` —
  deleted
- `routes.test.tsx` — adds `/register` → `/login`
- `Profile.test.tsx` — name-only update
- the six files that inject a literal `AuthContextValue` — drop `login` and
  `verifyRegister` from the object
- expected total: ~126 → ~119

### 7.5 Gates

`cd server && npm test` and `cd client && npm test` green; `npm run typecheck`
and `npm run build` clean in both; no new dependency in either `package.json`.

## 8. Files touched

**New (2):** `server/src/services/googleOAuth.ts`, `server/src/services/session.ts`
**New test (3):** `server/tests/oauth.test.ts`, `server/tests/helpers/auth.ts`,
`server/tests/env.test.ts`
**Deleted (server, 4):** `src/models/EmailOtp.ts`, `src/services/mailer.ts`,
`tests/auth-otp.test.ts`, `tests/auth-password-reset.test.ts`
**Deleted (client, 3):** `pages/auth/Register.tsx`, `pages/auth/ForgotPassword.tsx`,
`pages/auth/ResetPassword.tsx` + their 3 tests
**Modified (server):** `src/routes/auth.ts`, `src/routes/student.ts`,
`src/models/User.ts`, `src/config/env.ts`, `src/middleware/originCheck.ts`,
`package.json`, `.env.example`, `vitest.config.ts`, `tests/auth.test.ts`,
`tests/student-portal.test.ts`, `tests/db-harness.test.ts`, and the 7 test files
adopting the helper
**Modified (client):** `src/api/client.ts`, `src/context/AuthContext.tsx`,
`src/routes/index.tsx`, `src/types/index.ts`, `src/pages/auth/Login.tsx`,
`src/pages/student/Profile.tsx`, and the 6 test files injecting the context

## 9. Deploy runbook (user actions, not code)

1. **Google Cloud** → OAuth client → *Web application*. Authorized redirect URIs:
   - `https://quizora-rho.vercel.app/api/auth/oauth/google/callback`
   - `http://localhost:3001/api/auth/oauth/google/callback`
2. **Before deploying the server**, set on Render: `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET`,
   `OAUTH_CALLBACK_URL=https://quizora-rho.vercel.app/api/auth/oauth/google/callback`,
   `ADMIN_EMAILS=<your Google account email>`. Add
   `https://quizora-rho.vercel.app` to `CLIENT_ORIGIN`. Delete `SMTP_*` and
   `JWT_REFRESH_SECRET`. Keep `COOKIE_SECURE=true`.
   Production fails fast on the new keys — deploying the server first is a crash
   loop.
3. Deploy server, then client. `client/vercel.json` needs **no** change: the
   callback rides the existing `/api/(.*)` rewrite.
4. Local development needs the four new keys in `server/.env`; with
   `NODE_ENV=development` they are optional (no fail-fast) but sign-in will
   redirect to a placeholder client id, so set a real one to test the flow.
5. Optional one-off cleanup:
   `db.users.updateMany({}, { $unset: { passwordHash: '' } })`

## 10. Out of scope

Logged for later, not part of this phase:

- avatars / `picture` from the Google profile
- `trust proxy` on the server (rate-limit IP keys are wrong behind Vercel/Render)
- the pre-existing brand inconsistency: `brand-mark` renders `EP` while the brand
  name is `Quizora` (`client/src/components/layout/AppLayout.tsx`, `Login.tsx:69`)
- Phase 9 hardening backlog: uploads GC, import payload size limits, admin
  rate-limit/pagination, cursor pagination past the 200-row cap

## 11. Open items for the user

None blocking. `ADMIN_EMAILS` must contain the operator's Google account before
the server is deployed (step 2 above) or every sign-in resolves to `STUDENT`.
