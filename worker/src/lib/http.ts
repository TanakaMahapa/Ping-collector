const UA = process.env.PING_USER_AGENT ?? 'PingJobs/0.1 (job discovery; contact: set PING_USER_AGENT)';
export class HttpError extends Error { constructor(public status: number, url: string) { super(`HTTP ${status} for ${url.replace(/\/api\/[^/?]+/, '/api/***')}`); } } // never log API keys in URLs
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const NO_RETRY = [401, 403, 404, 429]; // 429 = quota or rate limit: retrying only makes it worse

export interface FetchOpts { retries?: number; timeoutMs?: number; method?: string; headers?: Record<string, string>; body?: unknown }
export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { retries = 3, timeoutMs = 15000 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET', signal: ctl.signal, body: opts.body ? JSON.stringify(opts.body) : undefined,
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && NO_RETRY.includes(e.status)) throw e;
      if (attempt < retries) await sleep(500 * 2 ** attempt + Math.random() * 250); // exponential backoff + jitter
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

/** Run fn over items with a concurrency cap; never throws (fn handles its own errors). */
export async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** GET a page as text (HTML). Returns the status too, so callers can tell "not found" from "server down". */
export async function fetchText(url: string, timeoutMs = 12000): Promise<{ status: number; text: string; url: string }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain' } });
    return { status: res.status, text: res.ok ? (await res.text()).slice(0, 2_000_000) : '', url: res.url || url };
  } finally { clearTimeout(t); }
}
