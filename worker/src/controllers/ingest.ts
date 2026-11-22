import type { Batch } from '../models/types.js';
import type { JobRow, Store } from '../models/store.js';
import { dedupeHash } from '../models/normalize.js';

/** Sources whose apply link goes straight to the employer. They win cross-source duplicates. */
export const DIRECT_SOURCES = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'oracle', 'smartrecruiters', 'recruitee', 'jsonld']);
export const EXPIRE_AFTER_MISSED_POLLS = 2;

export async function ingest(store: Store, batch: Batch, now = new Date()) {
  const seenAt = now.toISOString();
  const seen = new Set<string>();
  const valid = batch.jobs.filter(j => j.title && j.apply_url && j.source_job_id && !seen.has(j.source_job_id) && seen.add(j.source_job_id));

  const rows: JobRow[] = valid.map(j => ({ ...j, dedupe_hash: dedupeHash(j.company, j.title, j.city), last_seen_at: seenAt, missed_polls: 0, status: 'active' }));
  const existing = await store.existingIds(batch.source, rows.map(r => r.source_job_id));
  const fresh = rows.filter(r => !existing.has(r.source_job_id));

  // Cross-source dedupe, applied to NEW jobs only. Direct employer links beat aggregator copies.
  const skip = new Set<string>();
  const toExpire: number[] = [];
  if (fresh.length) {
    const dups = await store.duplicatesByHash(fresh.map(r => r.dedupe_hash), batch.source);
    const byHash = new Map<string, typeof dups>();
    dups.forEach(d => byHash.set(d.dedupe_hash, [...(byHash.get(d.dedupe_hash) ?? []), d]));
    for (const r of fresh) {
      const d = byHash.get(r.dedupe_hash);
      if (!d?.length) continue;
      if (DIRECT_SOURCES.has(r.source) && d.every(x => !DIRECT_SOURCES.has(x.source))) toExpire.push(...d.map(x => x.id));
      else skip.add(r.source_job_id);
    }
  }

  const toWrite = rows.filter(r => !skip.has(r.source_job_id));
  await store.upsertJobs(toWrite);
  if (toExpire.length) await store.expire(toExpire);
  const inserted = toWrite.filter(r => !existing.has(r.source_job_id)).length;

  // Expiry: only when the batch lists EVERY job in its scope. An empty aggregator feed is treated as an error, not "all gone".
  let expired = toExpire.length;
  if (batch.complete && (batch.company !== undefined || valid.length > 0)) {
    const missing = await store.unseenActive(batch.source, batch.company ?? null, seenAt);
    const gone = missing.filter(m => m.missed_polls + 1 >= EXPIRE_AFTER_MISSED_POLLS).map(m => m.id);
    const once = missing.filter(m => m.missed_polls + 1 < EXPIRE_AFTER_MISSED_POLLS).map(m => m.id);
    if (gone.length) await store.expire(gone);
    if (once.length) await store.setMissed(once, 1);
    expired += gone.length;
  }
  return { fetched: batch.jobs.length, inserted, expired };
}
