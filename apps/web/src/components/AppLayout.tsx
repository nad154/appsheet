import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
// Removed: canManageDriveFolder import (moved to UNUSED_DRIVE.md)
import { canManageSettings } from '../lib/rbac';
import { NotificationBell } from './NotificationBell';
import { Button } from './ui/Button';
import type { Role } from '@tracker/shared';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `relative inline-flex items-center px-1 py-4 text-sm font-medium transition-colors ${
    isActive ? 'text-accent' : 'text-ink-muted hover:text-ink'
  }`;

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} className={navClass}>
      {({ isActive }) => (
        <>
          <span>{label}</span>
          {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />}
        </>
      )}
    </NavLink>
  );
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function AppLayout() {
  const { user, logout, switchRole } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Dev-only mock role switcher (matches the server's dev-switch-role, which is
  // disabled in production). Only rendered in Vite dev mode.
  const isDev = import.meta.env.DEV;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <img src="/asset/logo.png" alt="Logo" className="h-7 w-7" />
              <span className="text-sm font-semibold tracking-tight text-ink">Project Tracker</span>
            </div>
            <nav className="flex h-14 items-stretch gap-5">
              <NavItem to="/grid" label="Grid" />
              <NavItem to="/dashboard" label="Dashboard" />
              <NavItem to="/account" label="Account" />
              {canManageSettings(user?.role) && <NavItem to="/settings" label="Settings" />}
              {/* Removed: Drive Browser nav item / canManageDriveFolder (moved to UNUSED_DRIVE.md) */}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <NotificationBell />
            {isDev && user && (
              <select
                data-testid="dev-role-switcher"
                value={user.role}
                onChange={(e) => switchRole(e.target.value as Role)}
                className="rounded-md border border-dashed border-border bg-transparent px-2 py-1 text-xs text-ink-muted"
                title="Dev-only: switch role"
              >
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="STAFF">STAFF</option>
              </select>
            )}
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {initials(user?.name)}
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-sm text-ink">{user?.name}</span>
                <span className="block text-xs text-ink-muted" data-testid="user-role-badge">
                  ({user?.role})
                </span>
              </span>
            </div>
            <Button variant="ghost" size="md" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
