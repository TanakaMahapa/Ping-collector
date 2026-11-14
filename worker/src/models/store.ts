import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Company, NormalizedJob } from './types.js';

export type JobRow = NormalizedJob & { dedupe_hash: string; last_seen_at: string; missed_polls: number; status: 'active' | 'expired' };
export interface RunPatch { ok: boolean; fetched: number; inserted: number; expired: number; error?: string }

/** Everything the worker needs from the database. Supabase implementation below; tests use an in-memory one. */
export interface Store {
  activeCompanies(): Promise<Company[]>;
  reportCompany(id: number, ok: boolean, error?: string): Promise<void>;
  existingIds(source: string, ids: string[]): Promise<Set<string>>;
  duplicatesByHash(hashes: string[], excludeSource: string): Promise<{ id: number; source: string; dedupe_hash: string }[]>;
  upsertJobs(rows: JobRow[]): Promise<void>;
  unseenActive(source: string, company: string | null, before: string): Promise<{ id: number; missed_polls: number }[]>;
  setMissed(ids: number[], n: number): Promise<void>;
  expire(ids: number[]): Promise<void>;
  expireStale(olderThanIso: string): Promise<void>;
  purgeExpired(olderThanIso: string): Promise<void>;
  lastRunStart(source: string): Promise<Date | null>;
  startRun(source: string): Promise<number>;
  finishRun(id: number, patch: RunPatch): Promise<void>;
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const MAX_COMPANY_ERRORS = 5; // consecutive failures before a slug is deactivated

export class SupabaseStore implements Store {
  private db: SupabaseClient;
  constructor(url: string, serviceKey: string) { this.db = createClient(url, serviceKey, { auth: { persistSession: false } }); }

  private ok<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> { if (r.error) throw new Error(r.error.message); return r.data as NonNullable<T>; }

  async activeCompanies() {
    const out: Company[] = [];
    for (let from = 0; ; from += 1000) { // PostgREST caps responses at 1000 rows
      const rows = this.ok(await this.db.from('companies').select('id,slug,ats_type,name,country_hint').eq('active', true).order('id').range(from, from + 999));
      out.push(...(rows as Company[]));
      if (rows.length < 1000) return out;
    }
  }

  async reportCompany(id: number, ok: boolean, _error?: string) {
    const now = new Date().toISOString();
    if (ok) { this.ok(await this.db.from('companies').update({ error_count: 0, last_polled_at: now }).eq('id', id)); return; }
    const row = this.ok(await this.db.from('companies').select('error_count').eq('id', id).single());
    const n = (row?.error_count ?? 0) + 1;
    this.ok(await this.db.from('companies').update({ error_count: n, last_polled_at: now, ...(n >= MAX_COMPANY_ERRORS ? { active: false } : {}) }).eq('id', id));
  }

  async existingIds(source: string, ids: string[]) {
    const found = new Set<string>();
    for (const c of chunk(ids, 50)) {
      const rows = this.ok(await this.db.from('jobs').select('source_job_id').eq('source', source).in('source_job_id', c));
      rows.forEach((r: any) => found.add(r.source_job_id));
    }
    return found;
  }

  async duplicatesByHash(hashes: string[], excludeSource: string) {
    const out: { id: number; source: string; dedupe_hash: string }[] = [];
    for (const c of chunk([...new Set(hashes)], 50)) {
      out.push(...(this.ok(await this.db.from('jobs').select('id,source,dedupe_hash').eq('status', 'active').neq('source', excludeSource).in('dedupe_hash', c)) as any[]));
    }
    return out;
  }

  async upsertJobs(rows: JobRow[]) {
    for (const c of chunk(rows, 500)) this.ok(await this.db.from('jobs').upsert(c, { onConflict: 'source,source_job_id' })); // first_seen_at omitted => preserved
  }

  async unseenActive(source: string, company: string | null, before: string) {
    const out: { id: number; missed_polls: number }[] = [];
    for (let from = 0; ; from += 1000) {
      let q = this.db.from('jobs').select('id,missed_polls').eq('source', source).eq('status', 'active').lt('last_seen_at', before);
      if (company) q = q.eq('company', company);
      const rows = this.ok(await q.order('id').range(from, from + 999)) as any[];
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  async setMissed(ids: number[], n: number) { for (const c of chunk(ids, 100)) this.ok(await this.db.from('jobs').update({ missed_polls: n }).in('id', c)); }
  async expire(ids: number[]) { for (const c of chunk(ids, 100)) this.ok(await this.db.from('jobs').update({ status: 'expired' }).in('id', c)); }
  async expireStale(iso: string) { this.ok(await this.db.from('jobs').update({ status: 'expired' }).eq('status', 'active').lt('last_seen_at', iso)); }
  async purgeExpired(iso: string) { this.ok(await this.db.from('jobs').delete().eq('status', 'expired').lt('last_seen_at', iso)); }

  async lastRunStart(source: string) {
    const rows = this.ok(await this.db.from('source_runs').select('started_at').eq('source', source).order('started_at', { ascending: false }).limit(1)) as any[];
    return rows[0] ? new Date(rows[0].started_at) : null;
  }
  async startRun(source: string) { return this.ok(await this.db.from('source_runs').insert({ source }).select('id').single()).id as number; }
  async finishRun(id: number, p: RunPatch) {
    this.ok(await this.db.from('source_runs').update({ finished_at: new Date().toISOString(), ok: p.ok, fetched: p.fetched, inserted: p.inserted, expired: p.expired, error: p.error ?? null }).eq('id', id));
  }
}
