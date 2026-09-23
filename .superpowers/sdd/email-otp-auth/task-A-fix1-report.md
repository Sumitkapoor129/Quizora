# Task A Fix 1 Report — mailer + email-OTP security review round

Status: **DONE** — all findings fixed on `feature/email-otp-auth`.

Commit: `4ed8d8c` — `fix(server): atomic OTP attempt cap and single-active OTP per email+purpose` (7 files, +231/-25). Not merged, not pushed.

## Problem

The security review of the mailer + email-OTP feature requested changes:
- **I1** — `attemptsLeft` check-then-decrement is not concurrency-safe; N parallel wrong guesses can pierce the 5-attempt cap and drive the counter negative (`min: 0` does not run on `$inc` updates).
- **I2** — delete-then-create send race allows two active OTPs per (email, purpose); verification may accept the wrong one.
- **M1** — forgot-password timing side channel: unknown-email path returns without a DB write or SMTP round-trip, so wall-clock timing reveals account existence.
- **M2** — send routes limited at 10/min, spec says 5/min.
- **M3** — STARTTLS was opportunistic on the default 587 path.
- **M4** — missing tests: cross-purpose, concurrent wrong-guesses, concurrent send invalidation.

## M1 decision

Chose the **uniform-machinery fix** (preferred by the review): `/forgot-password` now runs the exact same `storeEmailOtp` + `sendOtpEmail` path for every email — known or unknown. The unknown-email branch (synthetic expiry, no store, no mail) was removed entirely; `User.exists` is no longer queried in this route. A real OTP is stored for a ghost email and `sendMail` is still invoked, so response shape AND server work (DB write + SMTP round-trip) are identical. Ghost OTPs are inert (`/reset-password` still returns `OTP_INVALID` for a missing account — verified by the new cross-purpose-adjacent behavior and the pre-existing user-missing guard at `User.findOne`) and expire via the existing TTL index in 10 minutes. Storage-abuse risk is capped by the 5/min send limiter. The "no OTP row / no mail" no-enumeration test was replaced with a response-shape + machinery assertion (mail sent, OTP row stored with `attemptsLeft: 5`).

## Changes

### `server/src/routes/auth.ts`
- **I1** `verifyEmailOtp`: wrong-guess decrement is now an atomic conditional update — `EmailOtp.updateOne({ _id, attemptsLeft: { $gt: 0 } }, { $inc: { attemptsLeft: -1 } })`. A `modifiedCount === 0` (guess arrived while already exhausted) throws `OTP_ATTEMPTS_EXCEEDED`. The exhausted-correct-code guard moved after the hash match, preserving "a spent code is dead even with the right digits" (existing lock test). Counter can never go negative; at most N concurrent decrements land.
- **I2** `storeEmailOtp`: `deleteMany` + `create` replaced with one atomic upsert — `EmailOtp.findOneAndUpdate({ email, purpose }, { $set: { codeHash, expiresAt, attemptsLeft } }, { upsert: true })`.
- **M1** `/forgot-password`: uniform store+mail machinery for all emails (see above).
- **M2** `OTP_SEND_LIMIT = 5`, `OTP_VERIFY_LIMIT = 10` exported and wired into the four OTP limiters (sends 5/min, verify/reset 10/min; each route keeps its own `rateLimit(...)` instance — no shared budget pooling). Added `skip: () => env.NODE_ENV === 'test'` to `limiterOptions`: the 5/min per-IP budget would structurally break the auth test files (7–8 send calls per file, plus new concurrency tests that fire 10 parallel verifies). Rate limiting is a production control; the harness runs dozens of requests/minute from one IP per file (the previous limit of 10 was itself a test accommodation). Mailer already branches on `NODE_ENV` (dev console fallback), so this follows existing convention. Documented trade-off below.
- **M3** `server/src/services/mailer.ts`: `requireTLS: true` on the transporter (mandates STARTTLS on 587; ignored on 465).

### `server/src/models/EmailOtp.ts`
- **I2** compound unique index `emailOtpSchema.index({ email: 1, purpose: 1 }, { unique: true })` — keeps the existing single-field `email: 1` index. `EmailOtp.init()` in tests builds it.

### `server/tests/`
- `auth-otp.test.ts` (+3): rate-limit config assertion (send 5 < verify 10); 10 parallel wrong guesses at `attemptsLeft=5` → exactly 5 `OTP_INVALID` + 5 `OTP_ATTEMPTS_EXCEEDED`, counter ends exactly 0, no user; two concurrent sends → exactly one active OTP doc, exactly one of the two codes verifies (201), the loser is rejected `OTP_INVALID`, one account created.
- `auth-password-reset.test.ts` (+1, rewritten 1): the no-enumeration test now asserts mail + stored OTP for an unknown email (uniform machinery); new cross-purpose test — a REGISTER-purpose code used at `/reset-password` → `OTP_INVALID`, the REGISTER doc is neither consumed nor decremented, and the old password still works.

## TDD evidence

Tests written first; RED confirmed before implementation:
- M2: `expected 10 to be 5` (send limit was 10).
- M4.2: parallel guesses failed (`every 400` false — a 429 appeared because the verify limiter's 10/min budget was already exhausted by earlier tests in the file, which also proved the skip-in-test need).
- M4.3: `expected 2 to be 1` — deleteMany+create race left two docs.
- M1: `expected a mail to ghost@example.com … toBeDefined` — no mail sent for unknown email.
- M4.1 (cross-purpose) is an invariant-guard coverage test and started green (purpose is already enforced by the `findOne({ email, purpose })` filter); kept as a regression guard.

All new tests pass after the fixes; M4.2 is deterministic (exactly 5/5) because MongoDB serializes the atomic decrements.

## Verification (run locally)

- `cd server && npm test` — **152 passed (12 files)** (148 baseline + 4 net new; the M1 assertion was rewritten in place).
- `cd server && npm run build` — `tsc` clean.
- `cd client && npm test` — **126 passed (21 files)**, two consecutive clean full runs. Client is untouched (`git status` has no client files). Note: two earlier full client runs showed 1 flaky failure (`TestsList` "renders tests returned by the API", a `findByRole` timeout under full-suite load); the file passes in isolation (5/5) and the suite passed twice in a row — pre-existing load flake, unrelated to this change (zero client diff).
- `cd client && npm run build` / typecheck — not rerun (no client changes), per "client should be untouched".

## Trade-offs

- **skip-in-test for rate limiters** (M2): in test env the limiters pass every request through (they are simply not enforced), so the suite cannot exercise the 429 path. Production limit values are asserted directly on the exported `OTP_SEND_LIMIT`/`OTP_VERIFY_LIMIT`, and instance-separation is structural (four separate `rateLimit()` calls, visible in the diff). If a 429 integration test is ever required, the limiter would need per-test IP keying instead — worth it only if rate-limit behavior itself becomes a review focus.
- **Storing OTPs for ghost emails** (M1): small storage cost bounded by the 5/min limiter; docs self-expire via the TTL index in 10 min. Stronger than the dummy-hash alternative because the full SMTP round-trip is equalized, not just the hashing cost.
- **Post-match exhausted guard** (I1): the review's snippet alone would accept a correct code after exhaustion; keeping a guard (moved after the hash comparison) preserves "spent code is dead" while the atomic filter remains the real cap enforcement.

## Remaining risks

- Real-Gmail SMTP behavior (STARTTLS `requireTLS: true` on Gmail 587) not exercised here — no SMTP creds; verified as the standard nodemailer option by inspection only.
- The 10-parallel-verify test sits exactly at the 10/min verify budget in production semantics; it passes because the harness skips enforcement. Under real loads the limiter would 429 a subset — expected behavior.
- flaky client TestsList test (pre-existing, load-related) — worth a follow-up `findByRole` timeout or `waitFor` hardening, out of scope here.