import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { OrbitGraphic } from '@/components/visual/OrbitGraphic';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  // Same-origin validation, byte-identical to the server's `safeNext` in
  // server/src/routes/auth.ts: root-relative paths only. Backslash is what
  // makes `/\evil` and `/\/evil` protocol-relative for a browser that
  // normalises it, and control characters/spaces are not real paths — the URL
  // parser strips ASCII tab/LF/CR, so `/\t/evil.com` resolves cross-origin.
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

/**
 * Google's current brand "G", copied verbatim from Google's own hosted brand
 * asset: https://developers.google.com/static/identity/images/branding_guideline_sample_lt_sq_sl.svg
 * (linked from developers.google.com/identity/branding-guidelines). Google's
 * guidelines require the newest version, full colour, unmodified — do not
 * hand-edit these path or fill values. The asset draws the glyph at 10..30
 * inside a 40x40 button tile; this <g> shifts that exact geometry into the
 * 20x20 viewBox and changes nothing else.
 */
const GOOGLE_G = (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
    <g transform="translate(-10 -10)">
      <path
        d="M29.6 20.2273C29.6 19.5182 29.5364 18.8364 29.4182 18.1818H20V22.05H25.3818C25.15 23.3 24.4455 24.3591 23.3864 25.0682V27.5773H26.6182C28.5091 25.8364 29.6 23.2727 29.6 20.2273Z"
        fill="#4285F4"
      />
      <path
        d="M20 30C22.7 30 24.9636 29.1045 26.6181 27.5773L23.3863 25.0682C22.4909 25.6682 21.3454 26.0227 20 26.0227C17.3954 26.0227 15.1909 24.2636 14.4045 21.9H11.0636V24.4909C12.7091 27.7591 16.0909 30 20 30Z"
        fill="#34A853"
      />
      <path
        d="M14.4045 21.9C14.2045 21.3 14.0909 20.6591 14.0909 20C14.0909 19.3409 14.2045 18.7 14.4045 18.1V15.5091H11.0636C10.3864 16.8591 10 18.3864 10 20C10 21.6136 10.3864 23.1409 11.0636 24.4909L14.4045 21.9Z"
        fill="#FBBC04"
      />
      <path
        d="M20 13.9773C21.4681 13.9773 22.7863 14.4818 23.8227 15.4727L26.6909 12.6045C24.9591 10.9909 22.6954 10 20 10C16.0909 10 12.7091 12.2409 11.0636 15.5091L14.4045 18.1C15.1909 15.7364 17.3954 13.9773 20 13.9773Z"
        fill="#E94235"
      />
    </g>
  </svg>
);

export default function Login() {
  const { user, status, expired } = useAuth();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const oauthFailed = searchParams.get('oauth') === 'error';

  if (status === 'authenticated' && user && !expired) {
    // Next-aware so a post-login redirect and a fresh authenticated visit
    // can never race to different destinations.
    return <Navigate to={next ?? (user.role === 'admin' ? '/admin' : '/student')} replace />;
  }

  return (
    <div className="auth-page auth-page--split">
      <section className="auth-hero" aria-label="About Quizora">
        <Link to="/" className="brand-lockup" aria-label="Quizora home"><span className="brand-mark" aria-hidden="true">Q</span><span className="brand-name">Quizora</span></Link>
        <div className="auth-hero__body"><p className="page-eyebrow">A SPACE TO GROW</p><p className="auth-hero__title">Small steps.<br /><span>Extraordinary possibilities.</span></p><p>Test your knowledge. Build your confidence.<br />Make your next chapter your best one yet.</p><OrbitGraphic /></div>
        <p className="auth-hero__footer">Focused learning. Meaningful progress.</p>
      </section>
      <div className="auth-column">
        <Link to="/" className="brand-lockup auth-brand" aria-label="Quizora home">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <span className="brand-name">Quizora</span>
        </Link>

        <Card className="auth-card">
          <p className="page-eyebrow">YOUR LEARNING WORKSPACE</p>
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-sub">Use your Google account to continue.</p>

          {oauthFailed && (
            <p className="form-error" role="alert">
              Sign-in didn&apos;t complete. Please try again.
            </p>
          )}

          <a
            className="btn btn--secondary btn--md btn--block google-sign-in"
            href={api.auth.googleStartUrl(next ?? undefined)}
          >
            {GOOGLE_G}
            Continue with Google
          </a>
          <p className="auth-note">One account. A world of possibilities.</p>
        </Card>
        <p className="auth-bottom-note">Designed for curious minds.</p>
      </div>
    </div>
  );
}
