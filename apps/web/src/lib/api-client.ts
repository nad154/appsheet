import { tokenStore } from './tokenStore';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Called when the session can no longer be refreshed (e.g. 401 after refresh).
// The auth provider wires this to clear the in-memory user.
export type OnSessionExpired = () => void;
let onSessionExpired: OnSessionExpired | null = null;
export function setOnSessionExpired(fn: OnSessionExpired | null): void {
  onSessionExpired = fn;
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildHeaders(useAuth: boolean, isJson: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  if (useAuth) {
    const access = tokenStore.getAccess();
    if (access) headers.Authorization = `Bearer ${access}`;
  }
  return headers;
}

async function doRequest(
  method: string,
  path: string,
  body?: unknown,
  useAuth = true,
  retry = true,
): Promise<unknown> {
  const isJson = body !== undefined;
  const res = await fetch(path, {
    method,
    headers: buildHeaders(useAuth, isJson),
    body: isJson ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && useAuth && retry) {
    // Access token may be expired — try to refresh once, then retry.
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return doRequest(method, path, body, useAuth, false);
    }
    onSessionExpired?.();
    throw new ApiError(401, 'Session expired');
  }

  const data = await parseResponse(res);
  if (!res.ok) {
    const message =
      (typeof data === 'object' && data && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  // Deduplicate concurrent refresh calls.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = tokenStore.getRefresh();
      if (!refresh) return false;
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        tokenStore.setTokens(data.accessToken, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    return (await doRequest('GET', path)) as T;
  },
  async post<T>(path: string, body?: unknown, useAuth = true): Promise<T> {
    return (await doRequest('POST', path, body, useAuth)) as T;
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await doRequest('PATCH', path, body)) as T;
  },
  async del<T>(path: string): Promise<T> {
    return (await doRequest('DELETE', path)) as T;
  },
};
