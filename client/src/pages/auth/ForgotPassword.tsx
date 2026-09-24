import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Email is required.');
      document.getElementById('email')?.focus();
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      document.getElementById('email')?.focus();
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      await api.auth.forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-column">
        <Link to="/" className="brand-lockup auth-brand" aria-label="Quizora home">
          <span className="brand-mark" aria-hidden="true">
            EP
          </span>
          <span className="brand-name">Quizora</span>
        </Link>

        <Card className="auth-card">
          {sent ? (
            <>
              <h1 className="auth-title">Check your email</h1>
              <p className="form-success" role="status">
                If an account exists for that email, we sent you a code to reset your password.
              </p>
              <p className="auth-sub">
                Enter the code and a new password on the next page.
              </p>
              <Link className="btn btn--primary btn--md btn--block" to="/reset-password">
                Enter the code
              </Link>
              <p className="auth-footer">
                <Link to="/login">Back to sign in</Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="auth-title">Reset your password</h1>
              <p className="auth-sub">
                Enter your account email and we'll send you a 6-digit code.
              </p>

              <form onSubmit={handleSubmit} noValidate>
                <Field
                  id="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={submitting}
                  error={error}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(undefined);
                  }}
                />

                <Button type="submit" className="btn--block" loading={submitting}>
                  {submitting ? 'Sending code…' : 'Send code'}
                </Button>
              </form>

              <p className="auth-footer">
                <Link to="/login">Back to sign in</Link>
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}