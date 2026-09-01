import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PublicUser, Role } from '@tracker/shared';
import { apiClient, setOnSessionExpired } from '../lib/api-client';
import { tokenStore } from '../lib/tokenStore';

interface AuthContextValue {
  user: PublicUser | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchRole: (role: Role) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Restore an existing session on first load.
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      if (tokenStore.getAccess()) {
        try {
          const me = await apiClient.get<PublicUser>('/api/auth/me');
          if (!cancelled) setUser(me);
        } catch {
          if (!cancelled) clearSession();
        }
      }
      if (!cancelled) setInitializing(false);
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  // If we can't refresh, forget the session.
  useEffect(() => {
    setOnSessionExpired(clearSession);
    return () => setOnSessionExpired(null);
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiClient.post<AuthResponse>(
      '/api/auth/login',
      { email, password },
      false,
    );
    tokenStore.setTokens(result.accessToken, result.refreshToken);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    const refresh = tokenStore.getRefresh();
    try {
      if (refresh) await apiClient.post('/api/auth/logout', { refreshToken: refresh });
    } catch {
      // Best-effort; always clear local session.
    }
    clearSession();
  }, [clearSession]);

  const switchRole = useCallback(async (role: Role) => {
    const result = await apiClient.post<{ accessToken: string; user: PublicUser }>(
      '/api/auth/dev-switch-role',
      { role },
    );
    tokenStore.setAccess(result.accessToken);
    setUser(result.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, initializing, login, logout, switchRole }),
    [user, initializing, login, logout, switchRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
