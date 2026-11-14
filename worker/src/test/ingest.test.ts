import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../controllers/ingest.js';
import type { JobRow, Store } from '../models/store.js';
import type { Batch, NormalizedJob } from '../models/types.js';

class MemStore implements Store {
  rows: (JobRow & { id: number; first_seen_at: string })[] = []; n = 0;
  async activeCompanies() { return []; }
  async reportCompany() {}
  async existingIds(source: string, ids: string[]) { return new Set(this.rows.filter(r => r.source === source && ids.includes(r.source_job_id)).map(r => r.source_job_id)); }
  async duplicatesByHash(h: string[], ex: string) { return this.rows.filter(r => r.status === 'active' && r.source !== ex && h.includes(r.dedupe_hash)).map(r => ({ id: r.id, source: r.source, dedupe_hash: r.dedupe_hash })); }
  async upsertJobs(rows: JobRow[]) { for (const r of rows) { const e = this.rows.find(x => x.source === r.source && x.source_job_id === r.source_job_id); if (e) Object.assign(e, r); else this.rows.push({ ...r, id: ++this.n, first_seen_at: r.last_seen_at }); } }
  async unseenActive(s: string, c: string | null, b: string) { return this.rows.filter(r => r.source === s && r.status === 'active' && r.last_seen_at < b && (!c || r.company === c)).map(r => ({ id: r.id, missed_polls: r.missed_polls })); }
  async setMissed(ids: number[], n: number) { this.rows.filter(r => ids.includes(r.id)).forEach(r => (r.missed_polls = n)); }
  async expire(ids: number[]) { this.rows.filter(r => ids.includes(r.id)).forEach(r => (r.status = 'expired')); }
  async expireStale() {} async purgeExpired() {} async lastRunStart() { return null; } async startRun() { return 1; } async finishRun() {}
}
const job = (source: string, id: string, title = 'Driver', company = 'Acme'): NormalizedJob => ({ source, source_job_id: id, title, company, location_text: 'Benoni', city: 'Benoni', region: 'Gauteng', country: 'ZA', is_remote: false, remote_worldwide: false, remote_countries: [], salary_min: null, salary_max: null, currency: null, category: null, experience_level: null, description_snippet: null, apply_url: 'https://x', posted_at: null, posted_at_trusted: false });
const batch = (source: string, jobs: NormalizedJob[], complete = true, company: string | undefined = 'Acme'): Batch => ({ source, scope: source, company, jobs, complete });
const t = (m: number) => new Date(Date.UTC(2026, 10, 11, 8, m));

test('new job inserted once; first_seen_at preserved on re-poll', async () => {
  const s = new MemStore();
  assert.equal((await ingest(s, batch('greenhouse', [job('greenhouse', '1')]), t(0))).inserted, 1);
  assert.equal((await ingest(s, batch('greenhouse', [job('greenhouse', '1')]), t(5))).inserted, 0);
  assert.equal(s.rows.length, 1); assert.equal(s.rows[0].first_seen_at, t(0).toISOString());
});

test('job expires after 2 consecutive missed polls; reappearing resets the counter', async () => {
  const s = new MemStore();
  await ingest(s, batch('greenhouse', [job('greenhouse', '1')]), t(0));
  await ingest(s, batch('greenhouse', []), t(5));
  assert.equal(s.rows[0].status, 'active'); assert.equal(s.rows[0].missed_polls, 1);
  await ingest(s, batch('greenhouse', [job('greenhouse', '1')]), t(10));
  assert.equal(s.rows[0].missed_polls, 0);
  await ingest(s, batch('greenhouse', []), t(15)); await ingest(s, batch('greenhouse', []), t(20));
  assert.equal(s.rows[0].status, 'expired');
});

test('expiry is scoped to one company and never runs on incomplete or empty aggregator feeds', async () => {
  const s = new MemStore();
  await ingest(s, batch('greenhouse', [job('greenhouse', '1', 'Driver', 'Acme'), job('greenhouse', '2', 'Clerk', 'Other')]), t(0));
  await ingest(s, batch('greenhouse', []), t(5)); await ingest(s, batch('greenhouse', []), t(6));
  assert.deepEqual(s.rows.map(r => r.status), ['expired', 'active']); // only Acme scope expired
  await ingest(s, batch('remotive', [job('remotive', 'a', 'Dev', 'R')], true, undefined), t(7));
  await ingest(s, batch('remotive', [], true, undefined), t(8)); await ingest(s, batch('remotive', [], true, undefined), t(9));
  assert.equal(s.rows.find(r => r.source === 'remotive')!.status, 'active');
  await ingest(s, batch('adzuna', [job('adzuna', 'z', 'Nurse', 'H')], false, undefined), t(10));
  await ingest(s, batch('adzuna', [job('adzuna', 'y', 'Cook', 'K')], false, undefined), t(11));
  assert.equal(s.rows.find(r => r.source_job_id === 'z')!.status, 'active');
});

test('cross-source dedupe: direct employer link wins over aggregator copy, in either arrival order', async () => {
  let s = new MemStore();
  await ingest(s, batch('greenhouse', [job('greenhouse', '1')]), t(0));
  await ingest(s, batch('adzuna', [job('adzuna', 'a')], false, undefined), t(1));
  assert.equal(s.rows.length, 1); // aggregator copy skipped
  s = new MemStore();
  await ingest(s, batch('adzuna', [job('adzuna', 'a')], false, undefined), t(0));
  await ingest(s, batch('greenhouse', [job('greenhouse', '1')]), t(1));
  assert.deepEqual(s.rows.map(r => [r.source, r.status]), [['adzuna', 'expired'], ['greenhouse', 'active']]);
});

test('same-source jobs with identical title/company/city are NOT merged (multiple openings)', async () => {
  const s = new MemStore();
  await ingest(s, batch('greenhouse', [job('greenhouse', '1'), job('greenhouse', '2')]), t(0));
  assert.equal(s.rows.length, 2);
});
