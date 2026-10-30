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

export interface BlobResponse {
  blob: Blob;
  /** From Content-Disposition, falling back to "projects.csv". */
  filename: string;
}

type ResponseType = 'json' | 'blob';

function errorMessageFrom(data: unknown, status: number): string {
  return (
    (typeof data === 'object' && data && 'error' in data && typeof (data as { error: unknown }).error === 'string'
      ? (data as { error: string }).error
      : null) ?? `Request failed (${status})`
  );
}

/** `attachment; filename="projects-2026-10-29.csv"` -> projects-2026-10-29.csv */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return encoded[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

async function doRequest(
  method: string,
  path: string,
  body?: unknown,
  useAuth = true,
  retry = true,
  responseType: ResponseType = 'json',
): Promise<unknown> {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isJson = body !== undefined && !isFormData;
  const res = await fetch(path, {
    method,
    headers: buildHeaders(useAuth, isJson),
    body: isFormData ? body : isJson ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && useAuth && retry) {
    // Access token may be expired — try to refresh once, then retry.
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return doRequest(method, path, body, useAuth, false, responseType);
    }
    onSessionExpired?.();
    throw new ApiError(401, 'Session expired');
  }

  // Files must not run through parseResponse (JSON-or-text); an ApiError still
  // carries the server's JSON `error` field when the request failed.
  if (responseType === 'blob') {
    if (!res.ok) {
      const errorBody = await parseResponse(res);
      throw new ApiError(res.status, errorMessageFrom(errorBody, res.status), errorBody);
    }
    const result: BlobResponse = {
      blob: await res.blob(),
      filename: filenameFromDisposition(res.headers.get('Content-Disposition')) ?? 'projects.csv',
    };
    return result;
  }

  const data = await parseResponse(res);
  if (!res.ok) {
    throw new ApiError(res.status, errorMessageFrom(data, res.status), data);
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
  async put<T>(path: string, body?: unknown): Promise<T> {
    return (await doRequest('PUT', path, body)) as T;
  },
  async del<T>(path: string): Promise<T> {
    return (await doRequest('DELETE', path)) as T;
  },
  /** Binary download (e.g. CSV export) with the server-suggested filename. */
  async getBlob(path: string): Promise<BlobResponse> {
    return (await doRequest('GET', path, undefined, true, true, 'blob')) as BlobResponse;
  },
};
