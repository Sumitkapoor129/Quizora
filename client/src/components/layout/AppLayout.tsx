import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SessionExpiryBanner } from '@/components/layout/SessionExpiryBanner';
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
  { to: '/admin/attempts', label: 'Attempts / Results', end: false },
  { to: '/admin/analytics', label: 'Analytics', end: false },
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

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
  const { user, expired, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const [navOpen, setNavOpen] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  // When the drawer closes because of navigation, don't yank focus back to
  // the hamburger — the user has moved to a new page on purpose.
  const suppressFocusRestoreRef = useRef(false);

  // Make the underlying page inert (read-only, unfocusable) while expired.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (expired) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [expired]);

  useEffect(() => {
    if (!navOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    firstFocusable?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusables = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previous;
      if (suppressFocusRestoreRef.current) {
        suppressFocusRestoreRef.current = false;
      } else {
        hamburgerRef.current?.focus();
      }
    };
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;
    // Navigation closed the drawer (or will after render): the cleanup above
    // runs after this effect, so it will skip restoring focus.
    suppressFocusRestoreRef.current = true;
    setNavOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

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
      {expired && <SessionExpiryBanner />}
      {expired && <div className="session-veil" aria-hidden="true" />}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app-content" ref={contentRef}>
        <header className="app-header">
          {isAdmin && (
            <button
              ref={hamburgerRef}
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
            <Button variant="ghost" onClick={handleLogout}>
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
              <aside
                ref={drawerRef}
                id="admin-nav"
                className={`sidebar${navOpen ? ' sidebar--open' : ''}`}
                aria-label="Admin navigation"
              >
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
    </div>
  );
}