import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '@tracker/shared';

interface ProtectedRouteProps {
  children: ReactNode;
  roles?: Role[];
}

// UI-level route guard. Redirects unauthenticated users to /login and
// unauthorized roles away. This is a UX convenience — the server independently
// enforces authorization on every protected endpoint.
export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <div className="flex h-screen items-center justify-center text-sm text-gray-500">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/grid" replace />;
  }

  return <>{children}</>;
}
