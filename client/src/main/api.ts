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
  opts: { method?: string; token?: string; body?: unknown; raw?: { data: Uint8Array; type: string }; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers['content-type'] = opts.raw.type;
    // IPC delivers a Uint8Array; hand fetch a plain Buffer copy.
    body = Buffer.from(opts.raw.data);
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    res = await fetch(serverUrl + path, {
      method: opts.method ?? 'GET',
      headers,
      body,
      // Uploads (chat images) may take longer than plain calls.
      signal: AbortSignal.timeout(opts.raw ? 60_000 : 10_000),
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

export const authed = <T>(
  s: ActiveSession,
  path: string,
  opts: { method?: string; body?: unknown; raw?: { data: Uint8Array; type: string }; headers?: Record<string, string> } = {},
) =>
  request<T>(s.serverUrl, path, { ...opts, token: s.token });
