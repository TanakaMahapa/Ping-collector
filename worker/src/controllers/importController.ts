import { createClient } from '@supabase/supabase-js';
import { fetchJson, pool } from '../lib/http.js';
import { fetchOraclePage, splitOracleSlug } from '../adapters/oracle.js';
import { readCompany } from '../adapters/jsonld.js';

const probe: Record<string, (s: string) => Promise<unknown>> = {
  greenhouse: s => fetchJson(`https://boards-api.greenhouse.io/v1/boards/${s}`, { retries: 1 }),
  ashby: s => fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${s}`, { retries: 1 }),
  workable: s => fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${s}`, { retries: 1 }),
  oracle: async s => { const { host, site } = splitOracleSlug(s); const p = await fetchOraclePage(host, site, 0); if (!p.total && !p.jobs.length) throw new Error('no jobs'); },
  smartrecruiters: async s => { const d: any = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`, { retries: 1 }); if (!(Number(d?.totalFound) > 0)) throw new Error('no postings'); },
  recruitee: async s => { const d: any = await fetchJson(`https://${s}.recruitee.com/api/offers/`, { retries: 1 }); if (!Array.isArray(d?.offers)) throw new Error('not a board'); },
  jsonld: async s => { const r = await readCompany({ id: 0, slug: s, ats_type: 'jsonld', name: 'probe', country_hint: null }); if (!r.jobs.length) throw new Error('no structured job data found'); },
  lever: async s => { if (!Array.isArray(await fetchJson(`https://api.lever.co/v0/postings/${s}?mode=json&limit=1`, { retries: 1 }))) throw new Error('not a board'); },
};
const AUTO = ['greenhouse', 'ashby', 'workable', 'lever']; // oracle/smartrecruiters/recruitee/jsonld are tried only when the CSV names them (their slugs can collide with other companies)
export interface ImportResult { lines: string[]; ok: number; miss: number; dbErrors: number; fatal?: string }

/** Verify each CSV slug (slug,name,country_hint[,ats_type]) against Greenhouse/Lever; save only boards that respond. Safe to re-run. */
export async function importCompanies(csv: string): Promise<ImportResult> {
  const lines: string[] = [];
  const say = (s: string) => { lines.push(s); console.log(s); };
  const res: ImportResult = { lines, ok: 0, miss: 0, dbErrors: 0 };
  const stop = (m: string) => { say(m); res.fatal = m; return res; };
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return stop('STOP: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
  say(`Database: ${url} | key starts with "${key.slice(0, 10)}…" (should start with sb_secret_ or eyJ)`);
  if (key.startsWith('sb_publishable_')) return stop('STOP: the key is the PUBLISHABLE key. Use the SECRET key (starts sb_secret_).');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const read = await db.from('companies').select('id').limit(1);
  if (read.error) return stop(`STOP: cannot read the companies table: ${read.error.message} (wrong URL or key, or the SQL setup did not run?)`);

  const rows = csv.split('\n').slice(1).map(l => l.trim()).filter(Boolean).map(l => l.split(',').map(x => x.trim()));
  await pool(rows, 4, async ([slug, name, hint, ats]) => {
    for (const type of ats ? [ats] : AUTO) {
      try { await probe[type](slug); } catch { continue; } // no board on this ATS; try the next
      const { error } = await db.from('companies').upsert({ slug, ats_type: type, name, country_hint: hint || null, active: true, verified_at: new Date().toISOString(), error_count: 0 }, { onConflict: 'ats_type,slug' });
      if (error) { res.dbErrors++; if (res.dbErrors <= 3) say(`DATABASE ERROR saving ${name}: ${error.message}`); return; }
      res.ok++; say(`✓ ${name} (${type}:${slug})`); return;
    }
    res.miss++; say(`✗ ${name} (${slug}): no board found (if this company uses another system, add its ats_type as the 4th CSV column)`);
  });
  say(`\nActivated ${res.ok}, not found ${res.miss}, database errors ${res.dbErrors}.`);
  return res;
}
