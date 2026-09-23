import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

const OTP_ERROR_CODES = new Set(['OTP_INVALID', 'OTP_EXPIRED', 'OTP_ATTEMPTS_EXCEEDED']);

interface FieldErrors {
  email?: string;
  code?: string;
  newPassword?: string;
  form?: string;
}

export default function ResetPassword() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function validateEmail(value: string): string | undefined {
    if (!value.trim()) return 'Email is required.';
    if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address.';
    return undefined;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      code: CODE_RE.test(code) ? undefined : 'Enter the 6-digit code.',
      newPassword: newPassword.length >= 8 ? undefined : 'Password must be at least 8 characters.',
    };
    setErrors(nextErrors);
    if (nextErrors.email) {
      document.getElementById('email')?.focus();
      return;
    }
    if (nextErrors.code) {
      document.getElementById('code')?.focus();
      return;
    }
    if (nextErrors.newPassword) {
      document.getElementById('newPassword')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await api.auth.resetPassword({ email: email.trim(), code, newPassword });
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && OTP_ERROR_CODES.has(err.code)) {
        setErrors({ code: err.message });
        setCode('');
        document.getElementById('code')?.focus();
      } else if (err instanceof ApiError) {
        setErrors({ form: err.message });
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-column">
        <Link to="/" className="brand-lockup auth-brand" aria-label="ExamPro home">
          <span className="brand-mark" aria-hidden="true">
            EP
          </span>
          <span className="brand-name">ExamPro</span>
        </Link>

        <Card className="auth-card">
          <h1 className="auth-title">Set a new password</h1>
          <p className="auth-sub">Enter the code we emailed you along with a new password.</p>

          <form onSubmit={handleSubmit} noValidate>
            <Field
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              disabled={submitting}
              error={errors.email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors((prev) => ({ ...prev, email: undefined, form: undefined }));
              }}
            />

            <Field
              id="code"
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              disabled={submitting}
              error={errors.code}
              hint="The 6-digit code from the email."
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setErrors((prev) => ({ ...prev, code: undefined, form: undefined }));
              }}
            />

            <Field
              id="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={newPassword}
              disabled={submitting}
              error={errors.newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setErrors((prev) => ({ ...prev, newPassword: undefined, form: undefined }));
              }}
            />

            {errors.form && (
              <p className="form-error" role="alert">
                {errors.form}
              </p>
            )}

            <Button type="submit" className="btn--block" loading={submitting}>
              {submitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </form>

          <p className="auth-footer">
            <Link to="/forgot-password">Need a new code?</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}