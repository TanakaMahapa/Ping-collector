const UA = process.env.PING_USER_AGENT ?? 'PingJobs/0.1 (job discovery; contact: set PING_USER_AGENT)';
export class HttpError extends Error { constructor(public status: number, url: string) { super(`HTTP ${status} for ${url}`); } }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function fetchJson<T = any>(url: string, opts: { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  const { retries = 3, timeoutMs = 15000 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 404 || res.status === 401 || res.status === 403) throw new HttpError(res.status, url); // no retry
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && [401, 403, 404].includes(e.status)) throw e;
      if (attempt < retries) await sleep(500 * 2 ** attempt + Math.random() * 250); // exponential backoff + jitter
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

/** Run fn over items with a concurrency cap; never throws (fn handles its own errors). */
export async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
