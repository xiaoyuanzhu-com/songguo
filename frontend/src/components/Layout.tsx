import { Suspense, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, Boxes, Braces, Layers, Plug, Rocket, Settings, Users } from 'lucide-react';
import styles from './Layout.module.css';

const NAV = [
  { to: '/', label: 'Overview', icon: Activity, end: true },
  { to: '/services', label: 'Services', icon: Layers, end: false },
  { to: '/providers', label: 'Providers', icon: Plug, end: false },
  { to: '/users', label: 'Users', icon: Users, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

const DOCS_NAV = [
  { to: '/docs/quickstart', label: 'Quickstart', icon: Rocket },
  { to: '/docs/api', label: 'API', icon: Braces },
  { to: '/docs/mcp', label: 'MCP', icon: Boxes },
] as const;

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem;

export function Layout() {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src="/songguo-mark.svg" alt="" />
          <span className={styles.wordmark}>Songguo</span>
        </div>
        <nav className={styles.nav}>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={navItemClass}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
          <div className={styles.navGroup}>
            <span className={styles.navGroupLabel}>Docs</span>
            {DOCS_NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={navItemClass}>
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </aside>
      <main className={styles.main}>
        {/* Each route is a lazy chunk; keep the shell and show a spinner in the
            page area while the chunk loads. */}
        <Suspense
          fallback={
            <div className={styles.routeFallback}>
              <span className="spinner" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

interface PageProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Page renders the top toolbar (title + actions) and the scrolling body. */
export function Page({ title, actions, children }: PageProps) {
  return (
    <>
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {actions ? <div className={styles.toolbarActions}>{actions}</div> : null}
      </div>
      <div className={styles.body}>{children}</div>
    </>
  );
}
