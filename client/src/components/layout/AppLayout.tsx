import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  to: string;
  label: string;
  end: boolean;
}

const STUDENT_NAV: NavItem[] = [
  { to: '/student', label: 'Home', end: true },
  { to: '/student/results', label: 'My Results', end: false },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/tests', label: 'Tests', end: false },
  { to: '/admin/attempts', label: 'Attempts', end: false },
  { to: '/admin/analytics', label: 'Analytics', end: false },
];

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isAdmin = user?.role === 'admin';
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  const items = isAdmin ? ADMIN_NAV : STUDENT_NAV;
  const home = isAdmin ? '/admin' : '/student';

  const nav = (
    <nav aria-label="Primary" className={isAdmin ? 'sidebar__nav' : 'nav-row'}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        {isAdmin && (
          <button
            type="button"
            className="icon-btn hamburger"
            aria-expanded={navOpen}
            aria-controls="admin-nav"
            aria-label="Toggle navigation menu"
            onClick={() => setNavOpen((open) => !open)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}

        <Link to={home} className="brand-lockup" aria-label="ExamPro home">
          <span className="brand-mark" aria-hidden="true">
            EP
          </span>
          <span className="brand-name">ExamPro</span>
        </Link>

        {!isAdmin && nav}

        <div className="app-header__user">
          {user && (
            <span className="user-chip">
              <span className="avatar" aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className="user-chip__name">{user.name.split(' ')[0]}</span>
            </span>
          )}
          <Button variant="ghost" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      <div className="app-body">
        {isAdmin && (
          <>
            {navOpen && (
              <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
            )}
            <aside id="admin-nav" className={`sidebar${navOpen ? ' sidebar--open' : ''}`} aria-label="Admin navigation">
              {nav}
            </aside>
          </>
        )}
        <main id="main" className="app-main" tabIndex={-1}>
          <div className="container">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}