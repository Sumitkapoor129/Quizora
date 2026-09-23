# Feature: Mailer + Email-OTP Registration + Password Reset

Date: 2026-09-24. Branch: feature/email-otp-auth. Status: approved design, pre-implementation.

## 1. Purpose

Verify ownership of an email address before creating an account, and let users recover
accounts, using Gmail SMTP to send 6-digit one-time codes. Two flows, both email-OTP based:

1. **Registration** — two-step. User submits name/email/password → server emails a 6-digit OTP →
   user enters the OTP → account is created and a session is issued. The account does NOT exist
   until the OTP verifies.
2. **Password reset** — user enters their email → server emails a 6-digit OTP → user enters the
   OTP and a new password → password is reset and all refresh sessions revoked.

## 2. Server

### 2.1 Mailer service (`server/src/services/mailer.ts`) — NEW
- Dependency: `nodemailer` (only new server dep).
- Config from `server/.env` via `server/src/config/env.ts`. All SMTP vars are OPTIONAL in the env
  schema so the server boots (and existing tests run) before creds are set:
  - `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default `587`), `SMTP_USER`,
    `SMTP_PASS`, `MAIL_FROM` (defaults to `SMTP_USER`).
- Lazy transporter: created on first send, not at boot. `sendMail({ to, subject, text })`.
- If required SMTP config is missing, sending throws a clear error (`MAIL_NOT_CONFIGURED`, 503)
  caught by the route layer. In development only, the OTP is also logged to the server console
  as a fallback so flows can be exercised before Gmail creds are added.

### 2.2 OTP model (`server/src/models/EmailOtp.ts`) — NEW
- Fields: `email` (indexed), `purpose` enum `REGISTER | PASSWORD_RESET`, `codeHash`
  (SHA-256 of the 6-digit code, `select:false`), `expiresAt` (10 min, TTL index via `expires`),
  `attemptsLeft` (default 5), `timestamps:true`.
- One active OTP per (email, purpose): a new send invalidates previous ones for that key.

### 2.3 Auth routes (`server/src/routes/auth.ts`) — MODIFY
- `POST /api/auth/register` → RE-PURPOSED as step 1: validates name/email/password, rejects
  EMAIL_TAKEN (pre-create check), generates 6-digit OTP, sends email, stores EmailOtp.
  Response `201 { email, otpExpiresAt }`. NO account created, NO session.
- `POST /api/auth/register/verify` → NEW: body `{ name, email, password, code }`. Verifies OTP
  (purpose REGISTER, email match, not expired, attemptsLeft > 0, timing-safe compare), creates
  STUDENT user, issues refresh session + access cookie (existing machinery), marks OTP used,
  invalidates remaining attempts. Errors: `OTP_INVALID` / `OTP_EXPIRED` / `OTP_ATTEMPTS_EXCEEDED`.
- `POST /api/auth/forgot-password` → NEW: body `{ email }`. ALWAYS responds 200 (no user
  enumeration — same stance as login). If account exists, generates PASSWORD_RESET OTP + email.
  Response `{ email, otpExpiresAt }`.
- `POST /api/auth/reset-password` → NEW: body `{ email, code, newPassword }`. Verifies
  PASSWORD_RESET OTP, requires password ≥ 8 (zod), sets new passwordHash (argon2id), revokes
  ALL the user's RefreshSessions, clears auth cookies. 204 on success.
- Rate limits on all four routes via existing `rateLimit` pattern (e.g. send: 5/min per route,
  verify: 10/min). OTP is `randomInt(100000, 1000000)` style strictly 6-digit.

### 2.4 Env additions (`server/src/config/env.ts`) — MODIFY
- Optional SMTP block per 2.1. No new required vars (creds come later).

## 3. Client

### 3.1 API (`client/src/api/client.ts`) — MODIFY
- `api.auth.sendRegisterOtp({name,email,password})` → `{email, otpExpiresAt}`
- `api.auth.verifyRegister({name,email,password,code})` → SessionResponse (mapped via mapSession)
- `api.auth.forgotPassword({email})` → `{email, otpExpiresAt}`
- `api.auth.resetPassword({email, code, newPassword})` → void
- Types added in `client/src/types/index.ts` (OtpSentResponse etc.). `register` in api.client.ts
  is replaced by the two-call flow (or kept as thin compose; prefer explicit two methods).

### 3.2 AuthContext (`client/src/context/AuthContext.tsx`) — MODIFY
- `register` context method changes: no longer calls api.auth.register (that now only sends OTP).
  Register page orchestrates send → verify locally; on verify success call a new context method
  (e.g. `verifyRegister(...)` returning AuthUser and setting session) OR reuse login after
  creating session server-side. Keep AuthContext as the single place that sets session state.

### 3.3 Pages
- `client/src/pages/auth/Register.tsx` — MODIFY to two-step wizard:
  - Step 1: existing name/email/password form + validations; submit → sendRegisterOtp.
  - Step 2: single 6-digit OTP field (digits only), resend link (calls sendRegisterOtp again with
    the same stored name/email/password), verify button → verifyRegister → navigate to next/home.
  - Handle errors: EMAIL_TAKEN (step 1), OTP_INVALID/OTP_EXPIRED/OTP_ATTEMPTS_EXCEEDED (step 2),
    generic failure. `return-to-login` affordance. Reuse existing Field/Button/Card patterns.
- `client/src/pages/auth/ForgotPassword.tsx` — NEW: email field → forgotPassword → success state
  ("If an account exists, we emailed you a code.") + link to /reset-password.
- `client/src/pages/auth/ResetPassword.tsx` — NEW: email + code + new password (+ confirm? NO —
  keep single new-password field per codebase convention of one password field, unless review
  wants confirm; match Registration's single-password precedent) → resetPassword → success →
  navigate to /login.
- `client/src/routes/index.tsx` — MODIFY: add `/forgot-password`, `/reset-password` (public,
  shell-free like /login and /register).
- `client/src/pages/auth/Login.tsx` — MODIFY: add "Forgot password?" link to /forgot-password.

## 4. Constraints (from approved flow + AGENTS.md)
- Zero new client dependencies. One server dep: `nodemailer`.
- Preserve the auth security posture already in code: argon2id hashing, hashed refresh tokens,
  no user enumeration, rate limiting, httpOnly cookies. OTP codes stored hashed (SHA-256 + salt
  not required for 6-digit codes, but take care to `select:false` and timing-safe compare).
- a11y: every field labelled, focus management on step switch and errors, role="alert" for
  errors / role="status" for success, keyboard-friendly.
- Restrained design: reuse auth-page/card/field/button conventions; no new design language.

## 5. Tests

### Server (`server/tests/`) — mailer mocked (vi.mock or injectable)
- Register step 1: valid → 201 + OTP exists (get via model, code not returned in body), EMAIL_TAKEN
  pre-check, invalid body → 400, send replaces prior OTP, mailer called with 6-digit code.
- Register step 2: correct code → 201 + session + account created + OTP used; wrong code →
  OTP_INVALID and attemptsLeft decremented; exhausted → OTP_ATTEMPTS_EXCEEDED; expired →
  OTP_EXPIRED; reused code → OTP_INVALID.
- Forgot-password: valid + existing → 200 + OTP stored + mailer called; unknown email → 200 but
  mailer NOT called (no enumeration). Invalid email → 400.
- Reset-password: correct → 204 + passwordHash rotated (old password 401 after, new works),
  refresh sessions revoked; wrong/expired code → 400; unauth practice kept.
- Ensure existing auth tests updated: register no longer returns session; new verify path used.

### Client (`client/src/__tests__/`)
- Register: step-1 submit calls sendRegisterOtp and shows step 2; step 2 validates 6 digits,
  verify calls verifyRegister and navigates; resend calls sendRegisterOtp; error mapping on both
  steps. Existing Email-taken test adapted.
- ForgotPassword: valid submit → success message; API failure → error.
- ResetPassword: valid → success + navigate to /login; error mapping.
- AuthContext tests updated for the new register/verify wiring.

## 6. Verification
- `cd server && npm test` (134 existing + new, all green), `npm run build` clean.
- `cd client && npm test` (110 existing + new, all green), `npm run build`, `npm run typecheck`.
- Manual smoke after code: register with a real Gmail once creds exist; reset password.

## 7. Out of scope
- Email templates/HTML (plain text is fine), i18n, resend cooldown timers, admin mail-test page,
  email verification for OAuth, changing existing user verification status.