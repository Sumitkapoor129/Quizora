import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  form?: string;
}

function validateName(value: string): string | undefined {
  return value.trim() ? undefined : 'Name is required.';
}

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Email is required.';
  if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address.';
  return undefined;
}

function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required.';
  if (value.length < 8) return 'Password must be at least 8 characters.';
  return undefined;
}

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  // Same-origin validation: must be a root-relative internal path. Reject
  // protocol-relative (`//host`) and backslash tricks (`/\host`).
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

export default function Register() {
  const { user, status, expired, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated' && user && !expired) {
    // Next-aware so a post-register redirect and a fresh authenticated visit
    // can never race to different destinations.
    return <Navigate to={next ?? (user.role === 'admin' ? '/admin' : '/student')} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {
      name: validateName(name),
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    if (nextErrors.name) {
      document.getElementById('name')?.focus();
      return;
    }
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
      const authed = await register({ name: name.trim(), email: email.trim(), password });
      navigate(next ?? (authed.role === 'admin' ? '/admin' : '/student'), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') {
        setErrors({ email: 'An account with this email already exists.' });
        document.getElementById('email')?.focus();
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
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-sub">Start practicing with ExamPro in under a minute.</p>

          <form onSubmit={handleSubmit} noValidate>
            <Field
              id="name"
              label="Full name"
              autoComplete="name"
              placeholder="e.g. Aria Sharma"
              value={name}
              disabled={submitting}
              error={errors.name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined, form: undefined }));
              }}
              onBlur={() => setErrors((prev) => ({ ...prev, name: validateName(name) }))}
            />

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
              autoComplete="new-password"
              hint="At least 8 characters."
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
              {submitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}