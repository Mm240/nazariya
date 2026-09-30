import { API_URL } from './config';
import { visitorId } from './visitor';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Responses are cached for the session so going back to a page is instant.
// The API itself caches for 60 seconds, so this never hides fresh news for long.
const cache = new Map<string, { at: number; data: unknown }>();
const MAX_AGE_MS = 60_000;

export function cached<T>(path: string): T | undefined {
  const hit = cache.get(path);
  return hit && Date.now() - hit.at < MAX_AGE_MS ? (hit.data as T) : undefined;
}

export async function apiGet<T>(path: string, signal?: AbortSignal, personal = false): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (personal) headers['X-Visitor-Id'] = visitorId();
  try {
    res = await fetch(`${API_URL}/api${path}`, { signal, headers });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network');
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const data = (await res.json()) as T;
  cache.set(path, { at: Date.now(), data });
  return data;
}

/** Forget cached responses so the next request fetches fresh data. */
export function invalidateCache(): void {
  cache.clear();
}

/** Error text from the API (validation messages come back as an array). */
export async function apiError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return Array.isArray(body.message) ? body.message.join(' ') : String(body.message ?? res.statusText);
  } catch {
    return res.statusText;
  }
}

export async function apiSend<T>(
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Visitor-Id': visitorId(), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok) throw new ApiError(res.status, await apiError(res));
  return (res.status === 204 ? undefined : await res.json()) as T;
}
