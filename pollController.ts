// Controller: decides which sources are due, runs them in isolation, and hands results to the ingest controller.
import { adapters } from '../adapters/index.js';
import { ingest } from './ingest.js';
import { SupabaseStore, type Store } from '../models/store.js';
import type { Adapter, Company } from '../models/types.js';

import { log, logRun, logFatal } from '../views/console.js';
const SLACK_MS = 90_000;          // cron jitter allowance when deciding if a source is due
const ADAPTER_TIMEOUT_MS = 3 * 60_000;
const STALE_DAYS = 7;             // active jobs not seen for this long are expired (covers partial feeds like Adzuna)
const PURGE_DAYS = 30;            // expired rows older than this are deleted to protect the free-tier DB size
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);

async function runAdapter(store: Store, a: Adapter, companies: Company[]) {
  const runId = await store.startRun(a.id);
  const stats = { fetched: 0, inserted: 0, expired: 0 };
  let error: string | undefined;
  let batchErrors = 0;
  try {
    await withTimeout(a.poll({
      companies, log,
      reportCompany: (id, ok, e) => store.reportCompany(id, ok, e).catch(err => log(`reportCompany failed: ${err}`)),
      emit: async b => {
        try { const r = await ingest(store, b); stats.fetched += r.fetched; stats.inserted += r.inserted; stats.expired += r.expired; }
        catch (e) { batchErrors++; log(`ingest ${b.scope} failed: ${e}`); }
      },
    }), ADAPTER_TIMEOUT_MS, a.id);
  } catch (e) { error = String(e); }
  if (!error && batchErrors) error = `${batchErrors} batch(es) failed to save`;
  await store.finishRun(runId, { ok: !error, ...stats, error });
  logRun(a.id, stats, error);
}

export async function runPoll() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); }
  const store = new SupabaseStore(url, key);
  const only = (process.env.ONLY ?? '').split(',').map(s => s.trim()).filter(Boolean); // empty input = run everything
  const force = process.env.FORCE === '1';

  const due: Adapter[] = [];
  for (const a of adapters) {
    if (only.length && !only.includes(a.id)) continue;
    if (!a.enabled()) { log(`${a.id}: disabled (missing env)`); continue; }
    const last = await store.lastRunStart(a.id);
    if (force || !last || Date.now() - last.getTime() >= a.intervalMinutes * 60_000 - SLACK_MS) due.push(a);
  }
  log(`due: ${due.map(a => a.id).join(', ') || 'none'}`);

  if (due.length) {
    const companies = due.some(a => a.lane === 'fast') ? await store.activeCompanies() : [];
    // Each source is isolated: one failing adapter never stops the others.
    await Promise.allSettled(due.map(a => runAdapter(store, a, companies).catch(e => log(`${a.id} crashed: ${e}`))));
  }
  await store.expireStale(daysAgo(STALE_DAYS)).catch(e => log(`expireStale failed: ${e}`));
  await store.purgeExpired(daysAgo(PURGE_DAYS)).catch(e => log(`purge failed: ${e}`));
  log('done');
}
