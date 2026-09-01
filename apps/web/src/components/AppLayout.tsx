import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { canManageSettings, canSeeApprovals } from '../lib/rbac';
import type { Role } from '@tracker/shared';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
  }`;

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
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="flex items-center justify-between px-4 py-2">
          <nav className="flex items-center gap-1">
            <NavLink to="/grid" className={navClass}>
              Grid
            </NavLink>
            {canSeeApprovals(user?.role) && (
              <NavLink to="/approvals" className={navClass}>
                Approvals
              </NavLink>
            )}
            {canManageSettings(user?.role) && (
              <NavLink to="/settings" className={navClass}>
                Settings
              </NavLink>
            )}
            {canSeeApprovals(user?.role) && (
              <NavLink to="/drive-browser" className={navClass}>
                Drive Browser
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-3">
            {isDev && user && (
              <select
                data-testid="dev-role-switcher"
                value={user.role}
                onChange={(e) => switchRole(e.target.value as Role)}
                className="rounded-md border px-2 py-1 text-xs"
                title="Dev-only: switch role"
              >
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="STAFF">STAFF</option>
              </select>
            )}
            <span className="text-sm text-gray-600">
              {user?.name} <span data-testid="user-role-badge" className="text-xs text-gray-400">({user?.role})</span>
            </span>
            <button
              onClick={handleLogout}
              className="rounded-md border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
