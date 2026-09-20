import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import type { Role } from '@/types';

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
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setSubmitting(true);
    window.setTimeout(() => {
      login(role);
      navigate(next ?? (role === 'admin' ? '/admin' : '/student'));
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
                setErrors((prev) => ({ ...prev, email: undefined }));
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
                setErrors((prev) => ({ ...prev, password: undefined }));
              }}
              onBlur={() => setErrors((prev) => ({ ...prev, password: validatePassword(password) }))}
            />

            {errors.form && (
              <p className="form-error" role="alert">
                {errors.form}
              </p>
            )}

            <div className="field">
              <span className="field__label" id="demo-role-label">
                Demo role
              </span>
              <div className="role-toggle" role="radiogroup" aria-labelledby="demo-role-label">
                {(['student', 'admin'] as const).map((option) => (
                  <label
                    key={option}
                    className={`role-toggle__option${role === option ? ' role-toggle__option--active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="demo-role"
                      className="sr-only"
                      checked={role === option}
                      disabled={submitting}
                      onChange={() => setRole(option)}
                    />
                    {option === 'student' ? 'Student' : 'Admin'}
                  </label>
                ))}
              </div>
              <p className="dev-note">Demo mode — sign-in is simulated until the backend is connected.</p>
            </div>

            <Button type="submit" className="btn--block" loading={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="auth-footer">
            Don't have an account? <Link to="/register">Create one</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}