import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
// Removed: canManageDriveFolder import (moved to UNUSED_DRIVE.md)
import { canManageSettings } from '../lib/rbac';
import { NotificationBell } from './NotificationBell';
import { Button } from './ui/Button';
import type { Role } from '@tracker/shared';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-brand-50/60 hover:text-ink'
  }`;

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} className={navClass}>
      {label}
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
    <div className="flex h-screen flex-col overflow-hidden bg-canvas bg-page-glow">
      <div className="h-0.5 bg-brand-gradient" aria-hidden="true" />
      <header className="border-b border-border bg-surface shadow-sm">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient p-1.5 shadow-sm">
                <img src="/asset/logo.png" alt="Logo" className="h-full w-full object-contain" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-ink">Project Tracker</span>
            </div>
            <nav className="flex items-center gap-2">
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
                className="rounded-lg border border-dashed border-border bg-transparent px-2 py-1 text-xs text-ink-muted"
                title="Dev-only: switch role"
              >
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="STAFF">STAFF</option>
              </select>
            )}
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
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
