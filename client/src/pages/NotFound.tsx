import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';

export default function NotFound() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const home = user?.role === 'admin' ? '/admin' : '/student';
  const homeLabel = user ? (user.role === 'admin' ? 'Back to Dashboard' : 'Back to Home') : 'Go Home';

  return (
    <div className="auth-page">
      <div className="auth-column">
        <Card className="auth-card">
          <h1 className="auth-title">Page not found</h1>
          <p className="auth-sub">The page you're looking for doesn't exist or has moved.</p>
          <div className="auth-actions">
            <Link className="btn btn--primary" to={user ? home : '/'}>
              {homeLabel}
            </Link>
            {user && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={async () => {
                  await logout();
                  navigate('/login', { replace: true });
                }}
              >
                Log out
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}