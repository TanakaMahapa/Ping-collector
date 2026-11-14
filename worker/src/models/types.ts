export interface NormalizedJob {
  source: string;
  source_job_id: string;
  title: string;
  company: string;
  location_text: string | null;
  city: string | null;
  region: string | null;
  country: string | null; // ISO-2
  is_remote: boolean;
  remote_worldwide: boolean;
  remote_countries: string[]; // ISO-2
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  category: string | null;
  experience_level: string | null;
  description_snippet: string | null;
  apply_url: string;
  posted_at: string | null; // ISO
  posted_at_trusted: boolean;
}

export interface Company { id: number; slug: string; ats_type: string; name: string; country_hint: string | null }

/** One unit of fetched data. `scope` identifies what the batch covers (e.g. "greenhouse:stripe").
 *  complete=true means the batch lists EVERY active job in that scope, so missing jobs may be counted as gone. */
export interface Batch { source: string; scope: string; company?: string; jobs: NormalizedJob[]; complete: boolean }

export interface AdapterContext {
  companies: Company[];
  emit: (batch: Batch) => Promise<void>;
  reportCompany: (id: number, ok: boolean, error?: string) => Promise<void>;
  log: (msg: string) => void;
}

export interface Adapter {
  id: string;
  lane: 'fast' | 'slow';
  intervalMinutes: number;
  enabled(): boolean;
  poll(ctx: AdapterContext): Promise<void>;
}
