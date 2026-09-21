import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';

/**
 * Role-mismatch surface per spec §5: a student hitting /admin (or vice
 * versa) sees this instead of admin content. Rendered shell-free, mirroring
 * the 404 page, so the wrong role's navigation never renders.
 */
export default function AccessDenied() {
  const { user } = useAuth();
  const home = user?.role === 'admin' ? '/admin' : '/student';

  return (
    <div className="auth-page">
      <div className="auth-column">
        <Card className="auth-card">
          <h1 className="auth-title">You don't have access to this page.</h1>
          <p className="auth-sub">This page is for a different account type.</p>
          <div className="auth-actions">
            <Link className="btn btn--primary" to={home}>
              Back to your home
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}