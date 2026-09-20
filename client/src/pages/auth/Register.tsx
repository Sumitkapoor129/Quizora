import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {
      name: validateName(name),
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.email || nextErrors.password || nextErrors.form) return;

    setSubmitting(true);
    window.setTimeout(() => {
      login('student');
      navigate(next ?? '/student');
    }, 400);
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
                setErrors((prev) => ({ ...prev, name: undefined }));
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
                setErrors((prev) => ({ ...prev, email: undefined }));
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
                setErrors((prev) => ({ ...prev, password: undefined }));
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