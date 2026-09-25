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
- Next: Task 4 (delete the dead auth surface).



