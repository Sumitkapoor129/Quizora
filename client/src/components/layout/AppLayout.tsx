import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SessionExpiryBanner } from '@/components/layout/SessionExpiryBanner';
import { NavIcon } from '@/components/visual/NavIcon';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  to: string;
  label: string;
  end: boolean;
}

const STUDENT_NAV: NavItem[] = [
  { to: '/student', label: 'Dashboard', end: true },
  { to: '/student/profile', label: 'Profile', end: false },
  { to: '/student/results', label: 'My Tests', end: false },
  { to: '/student/tests', label: 'Tests', end: false },
  { to: '/student/resources', label: 'Resources', end: false },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/tests', label: 'Tests', end: false },
  { to: '/admin/attempts', label: 'Attempts / Results', end: false },
  { to: '/admin/analytics', label: 'Analytics', end: false },
  { to: '/admin/resources', label: 'Resources', end: false },
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
  const navId = isAdmin ? 'admin-nav' : 'student-nav';
  const navLabel = isAdmin ? 'Admin navigation' : 'Student navigation';
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
    const content = contentRef.current;
    const underlying = content?.querySelectorAll<HTMLElement>('.app-header, .app-main');
    underlying?.forEach((element) => {
      if (navOpen) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
    });
    return () => underlying?.forEach((element) => element.removeAttribute('inert'));
  }, [navOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 1025px)');
    const closeOnDesktop = () => { if (desktop.matches) setNavOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

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
    <nav aria-label={navLabel} className="sidebar__nav">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
        >
          <NavIcon name={item.label} />
          {item.label}
          <span className="nav-link__indicator" aria-hidden="true" />
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="app-shell">
      {expired && <SessionExpiryBanner />}
      {expired && <div className="session-veil" aria-hidden="true" />}
      <a className="skip-link" href="#main" tabIndex={navOpen ? -1 : undefined} aria-hidden={navOpen ? true : undefined}>
        Skip to content
      </a>
      <div className="app-content" ref={contentRef}>
        <header className="app-header">
          <button
            ref={hamburgerRef}
            type="button"
            className="icon-btn hamburger"
            aria-expanded={navOpen}
            aria-controls={navId}
            aria-label="Toggle navigation menu"
            onClick={() => setNavOpen((open) => !open)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <Link to={home} className="brand-lockup" aria-label="Quizora home">
            <span className="brand-mark" aria-hidden="true">
              Q
            </span>
            <span className="brand-name">Quizora</span>
          </Link>

          <span className="workspace-path">Workspace <span>/</span> {items.find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))?.label ?? "Overview"}</span>
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
          {navOpen && (
            <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
          )}
          <aside
            ref={drawerRef}
            id={navId}
            className={`sidebar${navOpen ? ' sidebar--open' : ''}`}
            aria-label={navLabel}
            role={navOpen ? "dialog" : undefined}
            aria-modal={navOpen ? true : undefined}
          >
            {navOpen && <button type="button" className="icon-btn sidebar__close" aria-label="Close navigation menu" onClick={() => setNavOpen(false)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
            <div className="sidebar__workspace"><span className="sidebar__workspace-icon" aria-hidden="true">{isAdmin ? 'A' : 'S'}</span><div><strong>{isAdmin ? 'Admin workspace' : 'My workspace'}</strong><span>{isAdmin ? 'Manage & inspire' : 'Learn at your pace'}</span></div></div>
            <p className="sidebar__label">WORKSPACE</p>
            {nav}
            <div className="sidebar__footer"><span className="sidebar__status" aria-hidden="true" /> Your next chapter starts here.</div>
          </aside>
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