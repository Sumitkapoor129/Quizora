# SDD ledger — feature: Google OAuth replaces password + email-OTP auth

BASE: main @ a68e4fa (spec + plan committed; server 152 / client 126 green)
Branch: feature/google-oauth-auth
Plan: `docs/superpowers/plans/2026-09-25-google-oauth-auth.md` (7 tasks)
Spec: `docs/superpowers/specs/2026-09-25-google-oauth-design.md` (binding)

## Scope
- Hand-rolled OAuth 2.0 authorization-code flow, Node `fetch`, **zero new deps**.
- Delete password login, email-OTP register/verify, forgot/reset password, `EmailOtp`,
  `mailer.ts`, `argon2`, `nodemailer`, `@types/nodemailer`, SMTP env keys, `JWT_REFRESH_SECRET`.
- `User` drops `passwordHash`, gains `googleId {String, unique, sparse, index}`.
- New `services/session.ts` (extracted, behaviour unchanged) + `services/googleOAuth.ts`.
- `ADMIN_EMAILS` allowlist re-evaluates role on every sign-in; fail-fast in production.
- Callback path alone is exempt from `originCheck` (Google sends a foreign `Referer`).
- Client: one `Login` card with a "Continue with Google" anchor; Register/Forgot/Reset pages deleted.

## Constraints
- Tasks 4 and 5 ship as ONE deploy unit (Task 4 alone leaves no way to sign in).
- TDD: test written, watched fail for the right reason, then the minimum code.
- Suites green at the end of every task. No `.skip`/`.only`, no deleted assertions.
- Never leak a Google error string, the client secret, or a token to the browser.
- No secrets in git; production rollout is a user action, never done from here.

## Progress
- `88dff3c` spec + context.md.
- `a68e4fa` implementation plan; self-review found and fixed 8 defects: missing
  `signAccessToken` in the session import list, `jwt`/`createHash` must be dropped
  (not "probably unused" — `noUnusedLocals`), the ADMIN revoke test never actually
  tested revocation, `BASE_URL` is `http://localhost:3001` under vitest so exact
  `href` equality would fail, "no Google glyph" contradicted spec §5.1, 10 files
  reference `auth/login` not 12, `npm ls` exits non-zero on success, and
  `context.md` still described a `Register` page. Spec §7.2/§7.4/§8 reconciled to match.
- Branch created from main.
- `5b4bb74` **Task 1** env keys + `services/session.ts` extraction. Server 154 green
  (152 + 2 new), typecheck clean. Review: SHIP, no Critical. Extracted bodies verified
  byte-identical to the originals (TTLs, JWT payload/alg, cookie attributes, DTO).
- `503e005` fix round: `OAUTH_CALLBACK_URL` now http(s)-only (spec §5.4), `SessionUser.role`
  is `UserRole` not `string` (stops a lowercase role reaching a signed JWT), reworded the
  `issueSession` comment to state the contract change. 154 still green, typecheck clean.
- `8fb1912` docs: **deploy unit widened to tasks 1–5.** Reviewer finding — Task 1's
  production gate makes four unset env vars fatal, so deploying this branch before
  Task 5 is a Render crash loop. Never deploy before Task 5 merges.
- Accepted gap (not a defect): the production fail-fast block has no automated test.
  A subprocess boot test was judged not worth it. Verified by hand instead.
- `cf4ac96` **Task 2** shared `tests/helpers/auth.ts`; 7 files migrated off
  `POST /api/auth/login`. 154 green, per-file counts unchanged, zero test bodies
  or assertions touched. Review: SHIP.
  - **Plan defect found:** the plan's `seedUser` omitted `passwordHash`, but
    `User.passwordHash` is `{ required: true }`, so every call threw. Also
    `student-portal`'s password tests need a real argon2 hash. Helper now seeds
    one, memoized per test file. Temporary — Task 4 deletes it.
  - **Second plan defect:** a static `src` import in the helper evaluates
    `config/env.ts` before `beforeAll` assigns `UPLOAD_DIR`, freezing it at
    `'uploads'` and breaking `tests-admin`'s upload test. The helper's `src`
    imports are dynamic, like every test file's. Any new test module importing
    `src` has the same constraint.
- `6db6a5a` fix round: helper uses `newRefreshToken()` from the session service
  instead of re-deriving sha256; `student-portal`'s `PASSWORD` is now
  `TEST_PASSWORD` imported from the helper (coupling is compiler-enforced).
- `51c628a` plan + spec updated for both defects, plus Task 4 now strips the
  helper's argon2 seeding *before* `npm install` drops the dependency.
- Known: `tsconfig.json` excludes `tests`, so `npm run typecheck` does not cover
  test files — check helpers with a standalone strict `tsc` invocation.
- Known, not fixed: test runs create an empty untracked `server/uploads/`.
- `da3fd53` **Task 3** `services/googleOAuth.ts` + 7 tests, exactly as planned.
  Review found the 400 test **vacuous** (a loose prefix regex passes even with the
  `!res.ok` branch deleted, since a 400 body has no `access_token` and the
  `no_access_token` path throws the same prefix), two undeclared throw paths
  escaping the `google_*_failed` contract (raw `SyntaxError` from `res.json()`,
  raw `TypeError: fetch failed`), no timeout, and `as GoogleProfile` typing
  `sub`/`email` as guaranteed so the route's guard would look like dead code.
- `87836f8` fix round: one `googleJson(reason, url, init)` helper now owns
  transport/status/decode failure, with `AbortSignal.timeout(10_000)`; `sub`/`email`
  validated at runtime (`:invalid_payload`). Net **shorter** file. 4 new tests
  (161 → 165) plus two regression guards. Google's `client_secret_post` form style
  confirmed correct from Google's docs (reviewer fetched them, not memory);
  `access_type=offline` correctly omitted because the design stores no refresh token.
- `d70e398` plan updated to the shipped error contract.
- Accepted: dev mode with no `.env` values yields `client_id=`/`redirect_uri=` and a
  Google error page. Deploy-time config is the fix, not a code guard; `.env.example`
  gains the four keys in Task 4.
- `f929f48` **Task 4** password/OTP/mailer removal, `User.googleId {unique, sparse, index}`.
  **Suite 165 → 143 / 12 files** (165 − 9 `auth-otp` − 8 `auth-password-reset` − 3 from
  `auth.test.ts` 14→11 − 1 `db-harness` − 1 `student-portal`), typecheck clean.
  Surviving `/me` `/refresh` `/logout` tests rewired to `createTestSession`; the
  rotation test's `not.toBe(first)` cookie assertion and the replay test's
  backdating `updateOne` both keep them from passing for a trivial reason.
- `690f446` `CookieOptions` + `issueSession` + `node:crypto` left OUT of `auth.ts`
  rather than parked unused for Task 5 (also fixed stale `server/README.md` claims).
  `student.ts` now uses `authBody()` from the session service.
- Deliberate deviation: an empty `PATCH /api/student/profile` body still returns
  400 `'Provide a name.'` — a 200 no-op would claim success on a request that
  changed nothing, and a stale client sending only the old password fields gets a
  diagnostic instead of silence. Pinned by a test.
- `9f0e107` review follow-ups: `context.md` still said `passwordHash` /
  `JWT_REFRESH_SECRET`, README still promised "Phase 2 adds the auth routes",
  and Task 5's import list omitted the two imports Task 4 had removed. All synced.
- **Reviewer (independent) found no vacuous tests, no over-deletion, and Task 5's
  inputs intact.** `typecheck` does NOT cover tests (`exclude: ["tests"]`, and
  `noUnusedLocals` is off — the plan's earlier claim was wrong, now fixed). A
  standalone strict pass over all 13 test files: 0 errors in the 4 files Task 4
  touched; 6 pre-existing errors in `import-admin.test.ts` / `student-exam.test.ts`
  (unrelated, not fixed).
- **Merge gate restated by the reviewer: Tasks 4+5+6 must ship as ONE unit.**
  The client still posts to five routes that now 404 (`client.ts:158-169`,
  `AuthContext.tsx:12,58`). Branch is not deployable on its own.
- Open for Task 5: the two new public OAuth routes have no rate limiter (the four
  other limiters were just deleted). Decide deliberately — the callback does an
  outbound token exchange per request, and `state` match alone does not stop a
  start→callback loop.
- Known, not fixed: orphaned `passwordHash` values in a real `users` collection
  are ignored by Mongoose `strict`; optional `$unset` is in the spec.
- `d4d9b21` **Task 5** both OAuth routes + `originCheck` exemption, 12 tests.
  143 → **155 / 13 files**, typecheck clean. Implementer caught three plan/test
  defects: the `oauthNext` cookie is percent-encoded on the wire, the plan's
  tests 3+6 collided on one `sub` (a real cross-test leak), and supertest types
  `set-cookie` as `string`. Test 12 was strengthened past the plan: it asserts
  the callback *completes* the sign-in, and a new test pins that the start route
  and `/me` are still 403 with Google's Referer.
- Review ran 21 `?next=` variants + 10 cookie-toss variants over raw sockets:
  **0 origin escapes**. State fails closed on all 6 shapes. Exemption is one
  exact path (14 variants all 403). No secret reaches the client. No vacuous test.
  Four findings, all real:
  - **I1** email match re-pointed `googleId`, so a reassigned institutional
    address silently transferred the previous holder's attempts + results.
  - **I2** `CLIENT_ORIGIN` unvalidated in production: `.env.example`'s own
    dev-first list meant every sign-in would land on `http://localhost:5173`,
    and `CLIENT_ORIGIN=` produced `undefined/`.
  - **I3** the callback-side `safeNext` (the strongest line in the commit) had no
    test; deleting it kept all 12 green. Nothing pinned the exemption's width.
  - **I4** `String(req.query.error)` into `console.warn` → forged log lines and
    ANSI/OSC-8 terminal escapes.
- `8a23c19` fix round, written test-first (both I1 and the `email_verified`
  test failed first, for the right reasons):
  `link_conflict` on a sub mismatch, `email_verified !== true`, control-char
  `safeNext`, `failOauth` sanitiser. **155 → 164**.
- Post-fix review confirmed all four fixed via mutation testing (deleting each
  guard makes its test fail), and found the file clean byte-level after a NUL
  byte I injected mid-edit and repaired. One gap: the I2 fix's *wiring* was
  untested — deleting the two call-site lines kept the whole suite green.
- `b5fb525` extracted the whole production gate into an exported pure
  `productionProblems()` and tested it (6 problems from an empty config, 0 from
  a valid one, 0 outside production). Also closed the `localhost.evil.com`
  false positive, `0.0.0.0`/`127.0.0.2` misses, a non-http(s) origin, and
  U+2028/U+2029 in the log sanitiser. **164 → 170 / 13 files**.
- Spec corrected: it mandated the *weaker* `cookies.oauthNext ?? '/'` and
  `email_verified === false`, and wrongly claimed `CLIENT_ORIGIN` always has an
  entry. The code is now the stronger document in all three.
- Deliberately deferred (all with a `ponytail:` note): no rate limiter on the
  OAuth routes; `link_conflict` recovery is manual; `__Host-` cookie prefix
  (needs `Path=/`, trades the scoping); log-reason length is now capped at 200.
- Next: Task 6 (client Google-only auth UI). Server is signable; nothing calls it yet.

## Task 6 — client Google-only auth UI (`f1ed5fd`)

- Tests written first and observed failing for the right reasons (no Google
  link existed; the password section was still on the Profile page).
- `Login` is now one card: a single `Continue with Google` anchor whose href is
  `api.auth.googleStartUrl(next)`, plus the `?oauth=error` banner
  (`role="alert"`, "Sign-in didn't complete. Please try again."). `safeNext`,
  the brand lockup and the already-authenticated early return all survive.
- The Google "G" is **Google's own hosted brand asset**, downloaded from
  `https://developers.google.com/static/identity/images/branding_guideline_sample_lt_sq_sl.svg`
  (the asset linked from `developers.google.com/identity/branding-guidelines`),
  copied verbatim, with the source URL cited in the code. Deliberate deviation
  from the plan: the plan named the *older* palette (`#EA4335`/`#FBBC05`), but
  Google's current guidance is "use only the newest Google G" — the asset served
  today is `#4285F4`/`#34A853`/`#FBBC04`/`#E94235`, so that is what ships. The
  glyph is drawn at 10..30 in the asset's 40x40 tile; a `translate(-10 -10)` moves
  that exact geometry into the 20x20 viewBox. Nothing redrawn, no base64 blob.
- `api.auth` is `googleStartUrl`/`logout`/`me` only. `AuthContextValue` is
  `{ user, sessionExpiresAt, status, expired, logout }`. `OtpSentResponse`
  deleted, `ProfileUpdateInput` name-only, `/register` → redirect to `/login`,
  forgot/reset fall through to NotFound, and the Register/ForgotPassword/
  ResetPassword pages plus their tests are deleted.
- **Client 126 → 121 / 18 files.** `npm run typecheck` exit 0, `npm run build`
  exit 0. CSS 29.14 → 29.01 kB (dead `.auth-footer` removed; `.auth-actions` is
  still live in AccessDenied/NotFound). JS flat at ~364 kB / 107 kB gzip — the
  deleted pages and the inline SVG roughly cancel, so "smaller bundle" is only
  true of the CSS, not the JS.
- Review round (1 IMPORTANT, fixed): the client `safeNext` was a weaker twin of
  the server's — it accepted `/\t/evil.com`, which the URL parser strips into a
  protocol-relative `https://evil.com/`. The Google href was never at risk
  (`encodeURIComponent` escapes the tab and the server re-validates twice), but
  the already-authenticated `<Navigate to={next}>` sink never reaches the server
  at all. The client check is now byte-identical to `server/src/routes/auth.ts`.
  Mutation-verified: restoring the weak `raw.includes('\\')` version fails 2 of
  the 13 new Login tests.
- Also fixed from the review: each `safeNext` rejection branch now has a case
  (5 unsafe-`next` variants, plus the authenticated-navigation one), the
  accessible name is pinned to the exact string `Continue with Google`, the
  provenance comment cites a URL that resolves, and `context.md` no longer calls
  the profile endpoint "name / password".
- Accepted, not fixed (deliberate): a failed sign-in drops `?next`, so a retry
  lands on the role home instead of the original deep link. The user is still
  signed in and the destination is recoverable by hand; preserving it would mean
  re-touching reviewed Task 5 redirect code. `next=` is also preserved across the
  failure only if the operator's Google consent screen is re-entered.
- Double-clicking the Google link starts two flows and the second overwrites the
  `oauthState` cookie, so the first callback fails state validation. It fails
  closed to `?oauth=error` with no security impact.

## Task 7 — whole-branch verification

All gates pass from a clean state:

| Gate | Result |
| ---- | ------ |
| `server && npm test` | 170 / 13 files, exit 0 |
| `server && npm run typecheck` | exit 0 |
| `server && npm run build` | exit 0 |
| `client && npm test` | 121 / 18 files, exit 0 |
| `client && npm run typecheck` | exit 0 |
| `client && npm run build` | exit 0 |
| `server && npm ls argon2 nodemailer` | `(empty)`, exit 1 — the non-zero exit is the pass condition |
| `client/vercel.json` | unchanged; three rewrites intact, the callback rides `/api/(.*)` |

- Standalone strict check of `server/tests/oauth.test.ts` (which `tsc` excludes):
  exit 0. Its `okProfile(over: Record<string, unknown>)` helper is deliberately
  untyped so the malformed-`email_verified` test can inject a runtime-invalid
  value, so there is no hidden type error behind the passing suite.
- Doc drift fixed here: `server/README.md` claimed "no sign-in route exists" and
  12 files / 143 tests; `server/.env.example` and the README advertised
  `quizora-sk.vercel.app` while the spec, plan, tests, `vercel.json` and
  `context.md` all use `quizora-rho.vercel.app` (confirmed live: the Vercel
  frontend is `quizora-rho`, the Render backend is `quizora-ppfp`).
- Merge gate from Task 4 is now satisfied: server, client and docs land together.

## Final branch review — whole flow, not per task

Each task above was reviewed in isolation, so a final pass reviewed the branch as
one flow against `main`: cross-task contract agreement, the security chain end to
end, what the branch broke outside auth, suite honesty, and deploy safety.

**Verdict: no CRITICAL, safe to merge.** The seams that a per-task review
structurally cannot see all line up:

- `googleStartUrl` → start route → callback → Login is a single encode/decode
  round trip; `ProtectedRoute` encodes once, `googleStartUrl` re-encodes, no
  double-decode.
- The callback redirects to `CLIENT_ORIGINS[0]`, matching the client's
  `APP_ORIGIN` assumption; `?oauth=error` and `/api/auth/me` match `Login.tsx`
  and `mapSession` field for field.
- The client `safeNext` copy **is** the security boundary for the authenticated
  `<Navigate to={next}>` in `Login.tsx`, which never reaches the server. It is
  byte-identical to the server's and mutation-verified, but only the branch-level
  pass could establish that dependency.
- Deploy order is server-first and non-obvious: the old server 404s the new
  client's start route, and the reverse order dead-ends the Google button.
- Suite honesty verified by counting: every surviving client test file has an
  identical case count to the merge base, so the 126 → 121 drop is entirely the
  three deleted auth features.

Fixed in this round:

| Finding | Fix |
| ------- | --- |
| **Important** — `db-harness.test.ts` had dropped its duplicate-`email` 11000 assertion while merging in the `googleId` one. The `email` index is load-bearing: the callback catches 11000 to adopt the winning row, and no test reached that catch, so deleting the whole recovery block kept 170 green | Restored as its own test, and added a test that forces 11000 on `User.create` and asserts the loser adopts the winner's row |
| **Important** — `sub` is scoped to the OAuth *client id*, so replacing the client id changes every user's `sub` and locks out every linked account with `link_conflict`. Neither checklist said so | Documented in the runbook and the ledger: rotate the secret freely, but unset `googleId` before ever changing the id |
| **Minor** — `existing.save()` in the link path was not wrapped for 11000, so two tabs linking at once produced a raw 500 JSON body instead of `?oauth=error` | Wrapped in the same `isDuplicateKey` catch, returning the normal `link_conflict` failure. New test went red (500 ≠ 302) before the fix |
| **Minor** — an empty `CLIENT_ORIGIN` parses to `[]` in *every* env, but the check sat behind the production gate, so in dev a successful sign-in redirected to `undefined/student/tests` — signed in, on a 404, with no boot error | Moved into the existing non-test `missing` block, so it fails at boot in every env |
| **Minor** — `context.md` Phase 12 still read "PLANNED, NOT STARTED", said `verified_email` (the field is `email_verified`), said first sign-in preserves "accounts/roles" (the opposite of D4), and named the branch `feature/oauth-auth` | Corrected all four |

Documented rather than changed: the unrated OAuth start/callback (Task 5's
deliberate `ponytail:` tradeoff), the missing PKCE half, and the ≤15-minute
window before removing an email from `ADMIN_EMAILS` revokes an already-issued
access token. All three are now written down instead of living only in review
notes.

Re-verified after the fixes: **server 173 / 13 files** (3 new tests), client
121 / 18 files, both typechecks and both builds exit 0.

## Deploy checklist (user actions — not code, not attempted from here)

1. **Google Cloud**: create a *Web application* OAuth client. Authorized redirect
   URIs, exactly:
   - `https://quizora-rho.vercel.app/api/auth/oauth/google/callback`
   - `http://localhost:3001/api/auth/oauth/google/callback` (local dev)
2. **Render env — set BEFORE deploying the server**, or the new fail-fast checks
   crash-loop the service: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `OAUTH_CALLBACK_URL=https://quizora-rho.vercel.app/api/auth/oauth/google/callback`,
   `ADMIN_EMAILS=<your email>`, `COOKIE_SECURE=true`, and `CLIENT_ORIGIN` with
   `https://quizora-rho.vercel.app` as the **first** entry. Delete the stale
   `SMTP_*` variables.
3. **Deploy order**: server first (it must answer the callback), then the client.
   Do not deploy the client alone — it now only knows the Google flow.
4. **Optional cleanup**: `$unset` the now-unused `passwordHash` field on existing
   users; `User.googleId` links them on first Google sign-in by email.

### Two things that will bite you

- **Never replace `GOOGLE_OAUTH_CLIENT_ID` once users exist.** Google's `sub` is
  the identity key and it is scoped to the client id, so a new client id changes
  every user's `sub`. Every linked row then matches by email with a mismatched
  `googleId` and hits `link_conflict` — a total lockout, recoverable only by
  hand. Rotating the *secret* alone is safe; if the id really must change, run
  `db.users.updateMany({}, { $unset: { googleId: '' } })` first so everyone
  relinks by email.
- **A wrong client id or a callback URL that does not match the registered URI
  fails on Google's error page, not on our banner.** The `?oauth=error` banner
  only appears for failures after Google redirected back to us, so check the
  Google Cloud console and the Render log line `[oauth] sign-in failed: …`
  before suspecting the app.

### Not fixed, on purpose

- `GET /oauth/google` is unauthenticated and unrated, and each callback makes two
  outbound calls, so anyone can drive traffic at `oauth2.googleapis.com` from the
  Render IP. If Google ever rate-limits that IP, real sign-ins break; the cheap
  mitigation is a limiter on the callback only. This is the documented Task 5
  `ponytail:` tradeoff, not an oversight.
- No PKCE. `state` covers login-CSRF; nothing covers authorization-code
  interception. For a Web-application client the secret is not confidential, so
  this is the missing half — but adding it is a protocol change with its own
  test surface, not a drive-by.
- Removing an email from `ADMIN_EMAILS` revokes admin at that user's next
  sign-in; their already-issued access token keeps admin until it expires
  (≤15 min, and `/refresh` re-signs from the DB, so it self-heals). This matches
  decision D4 in the spec.
