import type { ActiveSession } from './session';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(
  serverUrl: string,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(serverUrl + path, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn(`[api] ${opts.method ?? 'GET'} ${serverUrl}${path} failed:`, err);
    throw new ApiError(0, 'Сервер недоступен');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON reply (e.g. proxy error page).
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Ошибка сервера (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const authed = <T>(s: ActiveSession, path: string, opts: { method?: string; body?: unknown } = {}) =>
  request<T>(s.serverUrl, path, { ...opts, token: s.token });
