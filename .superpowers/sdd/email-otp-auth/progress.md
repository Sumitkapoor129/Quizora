# SDD ledger — feature: mailer + email-OTP registration + password reset

BASE: main (125cb32, analytics filters merged; server 134 / client 110 green)
Branch: feature/email-otp-auth

## Scope (approved design)
- Server mailer service (nodemailer, Gmail SMTP, lazy init, config from .env).
- EmailOtp model (SHA-256 hashed 6-digit code, expiry, purpose REGISTER|PASSWORD_RESET, attemptsLeft).
- Auth routes: /register → send OTP (step 1), /register/verify → create account + session (step 2), /forgot-password → email OTP, /reset-password → verify + rotate passwordHash + revoke sessions.
- Client: two-step Register wizard, ForgotPassword + ResetPassword pages, AuthContext.register becomes verify+session, api client additions.
- Zero new client deps; one server dep (nodemailer).

## Progress
- Branch created from main. Dispatch pending.
- `7b71af7` docs: spec + ledger committed.
- `6ca9cb0` feat(server): mailer + EmailOtp model + OTP register/verify/forgot/reset routes + tests. Server 148 green (134 baseline + 14 new), typecheck + build clean.
- `d121412` feat(client): two-step Register wizard, ForgotPassword + ResetPassword pages, login forgot link, api/auth context updates + tests. Client 126 green (110 baseline + 16 new), typecheck + build clean.
- Task A report: `.superpowers/sdd/email-otp-auth/task-A-report.md`.
- Next: review pass, then merge to main (per main flow: run both suites once more after any further changes).