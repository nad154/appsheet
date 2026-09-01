const ACCESS_KEY = 'tracker.accessToken';
const REFRESH_KEY = 'tracker.refreshToken';

// Thin localStorage wrapper for the JWT access token + opaque refresh token.
// Kept separate from the auth store so the API client can read tokens without
// a React dependency.
export const tokenStore = {
  getAccess(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  getRefresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  setTokens(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  setAccess(access: string): void {
    localStorage.setItem(ACCESS_KEY, access);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};
