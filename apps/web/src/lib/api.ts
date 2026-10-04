/** Thin fetch wrapper: bearer token in memory, refresh via httpOnly cookie, typed errors. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onLogout: () => void = () => undefined;

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function setLogoutHandler(fn: () => void) {
  onLogout = fn;
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return false;
        accessToken = (await r.json()).accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: R = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? res.statusText;
  return new ApiError(res.status, msg, body.errors);
}

export async function request(method: string, path: string, body?: unknown, retry = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request(method, path, body, false);
    onLogout();
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function api<T = R>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await request(method, path, body);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const get = <T = R>(path: string) => api<T>('GET', path);
export const post = <T = R>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T = R>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T = R>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = (path: string) => api('DELETE', path);

/** Download a file (CSV/PDF) through the authenticated API. */
export async function download(path: string, fallbackName: string) {
  const res = await request('GET', path);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = decodeURIComponent(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a generated document (PDF, or printable HTML when no PDF engine is configured) in a new tab. */
export async function openDocument(path: string) {
  const win = window.open('', '_blank');
  try {
    const res = await request('GET', path);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    win?.close();
    throw e;
  }
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}
