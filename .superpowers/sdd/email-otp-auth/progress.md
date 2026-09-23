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