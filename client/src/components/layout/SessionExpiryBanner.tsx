import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

/**
 * Non-blocking session-expiry banner per spec §1.3. The current page stays
 * visible underneath (made inert by the shell); Sign in returns the user to
 * this exact path after a successful re-login.
 */
export function SessionExpiryBanner() {
  const location = useLocation();
  const navigate = useNavigate();

  function handleSignIn() {
    const currentPath = location.pathname + location.search;
    navigate(`/login?next=${encodeURIComponent(currentPath)}`);
  }

  return (
    <div className="session-banner" role="alert">
      <div className="session-banner__text">
        <p className="session-banner__title">Your session has expired.</p>
        <p className="session-banner__body">
          Sign in again to continue. You won't lose your place — we'll bring you back to where you were.
        </p>
      </div>
      <Button variant="primary" onClick={handleSignIn}>
        Sign in
      </Button>
    </div>
  );
}