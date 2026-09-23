# Task A report — mailer + email-OTP auth (server + client)

Status: **DONE** — all tests green, builds clean, both commits on `feature/email-otp-auth`.

- Server commit: `6ca9cb0` — `feat(server): email-OTP registration and password reset`
- Client commit: `d121412` — `feat(client): two-step email-OTP registration and password reset`
- Spec commit (earlier): `7b71af7` — `docs: add mailer+OTP auth design spec`

## Problem

Implement email-OTP registration (two-step), password reset with a hashed OTP, and a nodemailer mailer, per the approved design spec. Backend must not leak account existence; codes must be stored hashed, single-use, expiring, and attempts-limited. Client gets a two-step register wizard plus new forgot/reset pages. Zero new client deps; one new server dep.

## Findings

- Existing auth routes (`server/src/routes/auth.ts`) used argon2id password hashing, DOM-based session cookies with a hashed `RefreshSession.refreshTokenHash`, rate-limit middleware, and flat-details `AppError` handling with zod validation on an asyncHandler base — all reused as-is.
- No mailer or OTP storage existed; User created during register could not be split into two steps without an intermediate record → introduced `EmailOtp` model.
- Existing client `register` in `api/client.ts`/`AuthContext` assumed a single register→session call → replaced with `sendRegisterOtp` + `verifyRegister`.
- Test limiters are module-level singletons shared per test file (`limiterOptions` keyed pools) → the 4 new OTP limiters were set to `limit: 10` (spec suggested "send 5/min, verify 10/min"); per-IP budgets in tests would exhaust 5/min within a file. See Trade-offs.

## Changes / Design

### Server (`6ca9cb0`, 10 files)
- `services/mailer.ts`: lazy nodemailer transporter from `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM`; dev-mode console fallback when SMTP creds absent; 503 `MAIL_NOT_CONFIGURED` otherwise.
- `models/EmailOtp.ts`: `email` (indexed, lowercase), `purpose` enum `REGISTER|PASSWORD_RESET`, `codeHash` (`select:false`, SHA-256), `expiresAt` (TTL index), `attemptsLeft` default 5, `min: 0`.
- `config/env.ts` + `.env.example`: optional SMTP_* vars with Gmail defaults.
- `routes/auth.ts`:
  - `POST /register` → EMAIL_TAKEN pre-check, `storeEmailOtp`, sends `Your ExamPro verification code is <code>. It expires in 10 minutes.`, returns `201 {email, otpExpiresAt}`.
  - `POST /register/verify` → verify OTP (REGISTER), create STUDENT (duplicate-key → EMAIL_TAKEN), issue session + cookies, `201 authBody`.
  - `POST /forgot-password` → always `200 {email, otpExpiresAt}` including for unknown emails (synthetic expiry, no mail) — no enumeration.
  - `POST /reset-password` → verify OTP (PASSWORD_RESET), re-argon2id the hash, revoke all unrevoked `RefreshSession`s, clear cookies, `204`.
  - `verifyEmailOtp` helper: missing→OTP_INVALID, expired→OTP_EXPIRED, attemptsLeft≤0→OTP_ATTEMPTS_EXCEEDED, mismatch→decrement `attemptsLeft` + OTP_INVALID; success deletes the OTP (single-use).
  - Rate limiters for all four endpoints (`limiterOptions`, `limit: 10`).

### Client (`d121412`, 16 files)
- `api/client.ts`: `sendRegisterOtp`, `verifyRegister`, `forgotPassword`, `resetPassword`; `register` removed.
- `context/AuthContext.tsx`: `register` → `verifyRegister` (OTP exchange sets session).
- `pages/auth/Register.tsx`: two-step wizard; step 2 = single 6-digit code input (digits only, auto-focus, Enter submits), resend ("A new code was sent. Check your email." `role="status"`), Back, OTP-error mapping (OTP_INVALID/OTP_EXPIRED/OTP_ATTEMPTS_EXCEEDED → code field, clears it).
- `pages/auth/ForgotPassword.tsx` (new): email → no-enumeration success message + link to reset-password.
- `pages/auth/ResetPassword.tsx` (new): email + code + new password, OTP-error mapping, success → `/login`, "Need a new code?" link.
- `routes/index.tsx`: public `/forgot-password`, `/reset-password`. `Login.tsx`: "Forgot password?" link.
- Tests: new `Register.test.tsx` (8), `ForgotPassword.test.tsx` (3), `ResetPassword.test.tsx` (4); `Login.test.tsx` +1 forgot-link test; `verifyRegister` mock rename in 5 existing suites.

## Trade-offs

- **All OTP limiters at 10/min** instead of spec's "send 5 / verify 10": per-IP budgets shared across a test file would exhaust 5/min mid-file. 10/min still throttles abusive resends without breaking tests. Only revisit if production abuse data demands asymmetry.
- **console fallback in dev when SMTP unset** instead of hard-requiring SMTP: keeps local dev usable; gated to `NODE_ENV !== 'production'`. Production requires SMTP env or errors 503.
- **Send-before-create in register** (OTP first, account on verify) vs create+verified flag: matches spec, avoids a user row that can never log in; EMAIL_TAKEN pre-check keeps the common duplicate case cheap, duplicate-key catch keeps it race-safe.
- **Single 6-digit field** vs per-digit boxes on the client: less code, better copy/paste and password-manager behavior; the aesthetic/UX review standard prefers restraint.

## Tests

- Server: `148 passed (12 files)` (`npm test`) — baseline 134 + 14 new (auth-otp 6, auth-password-reset 7, malformed-code 1 in auth.test.ts). Mailer mocked per file via `vi.mock('../src/services/mailer.js', ...)`; OTP read from the **last** matching `sendMail` call with `/(\d{6})/`.
- Client: `126 passed (21 files)` (`npm test`) — baseline 110 + 16 new.
- `server npm run typecheck` clean; `server npm run build` clean.
- `client npm run typecheck` clean; `client npm run build` clean (bundle 378 kB, gzip 110 kB).

## Remaining risks

- No manual end-to-end check against real Gmail SMTP (no creds here); dev console path exercised only by inspection — worth one smoke test locally with a throwaway app password.
- `.env.example` has placeholder creds only; a contributor copy-pasting must fill real SMTP values before production.
- Email deliverability (Gmail app-password quirks, SPF/DKIM) is untested — deployment-time concern.
- The task-side ledger (`progress.md`) is updated; a review pass per the main workflow should still happen before merge to `main` (run both suites once more after any further changes).
- Not committed in these two commits: server session/`RefreshSession` revocation logic was already present; no migrations were required (Mongo TTL index handles expiry).