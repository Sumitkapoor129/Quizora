import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
  form?: string;
}

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Email is required.';
  if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address.';
  return undefined;
}

function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required.';
  return undefined;
}

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  // Same-origin validation: must be a root-relative internal path. Reject
  // protocol-relative (`//host`) and backslash tricks (`/\host`).
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

export default function Login() {
  const { user, status, expired, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated' && user && !expired) {
    // Next-aware so a post-login redirect and a fresh authenticated visit
    // can never race to different destinations.
    return <Navigate to={next ?? (user.role === 'admin' ? '/admin' : '/student')} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    if (nextErrors.email) {
      document.getElementById('email')?.focus();
      return;
    }
    if (nextErrors.password) {
      document.getElementById('password')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const authed = await login({ email: email.trim(), password });
      navigate(next ?? (authed.role === 'admin' ? '/admin' : '/student'), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErrors({ form: 'Invalid email or password.' });
        setPassword('');
        document.getElementById('password')?.focus();
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
        <Link to="/" className="brand-lockup auth-brand" aria-label="Quizora home">
          <span className="brand-mark" aria-hidden="true">
            EP
          </span>
          <span className="brand-name">Quizora</span>
        </Link>

        <Card className="auth-card">
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-sub">Welcome back. Enter your details to continue.</p>

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
              onBlur={() => setErrors((prev) => ({ ...prev, email: validateEmail(email) }))}
            />

            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={submitting}
              error={errors.password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({ ...prev, password: undefined, form: undefined }));
              }}
              onBlur={() => setErrors((prev) => ({ ...prev, password: validatePassword(password) }))}
            />

            {errors.form && (
              <p className="form-error" role="alert">
                {errors.form}
              </p>
            )}

            <Button type="submit" className="btn--block" loading={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="auth-footer">
            Don't have an account? <Link to="/register">Create one</Link>
          </p>
          <p className="auth-footer">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}