import type { Adapter, NormalizedJob } from '../models/types.js';
import { fetchJson } from '../lib/http.js';
import { inferExperience, snippet } from '../models/normalize.js';

export function normalizeAdzuna(j: any): NormalizedJob {
  const area: string[] = j.location?.area ?? []; // e.g. ["South Africa","Gauteng","Johannesburg"]
  return {
    source: 'adzuna', source_job_id: String(j.id), title: j.title, company: j.company?.display_name ?? 'Unknown',
    location_text: j.location?.display_name ?? null, city: area.length > 2 ? area[area.length - 1] : null,
    region: area[1] ?? null, country: 'ZA', is_remote: /\bremote\b/i.test(`${j.title} ${j.description}`),
    remote_worldwide: false, remote_countries: [],
    salary_min: j.salary_min ?? null, salary_max: j.salary_max ?? null, currency: j.salary_min ? 'ZAR' : null,
    category: j.category?.label ?? null, experience_level: inferExperience(j.title),
    description_snippet: snippet(j.description), apply_url: j.redirect_url, // aggregator redirect
    posted_at: j.created ?? null, posted_at_trusted: !!j.created,
  };
}

// Env: ADZUNA_APP_ID, ADZUNA_APP_KEY, ADZUNA_PAGES (default 2). 30 min x 2 pages = ~96 calls/day; check your plan's cap.
export const adzuna: Adapter = {
  id: 'adzuna', lane: 'slow', intervalMinutes: 30,
  enabled: () => !!process.env.ADZUNA_APP_ID && !!process.env.ADZUNA_APP_KEY,
  async poll(ctx) {
    const pages = Number(process.env.ADZUNA_PAGES ?? 2);
    const jobs: NormalizedJob[] = [];
    for (let p = 1; p <= pages; p++) {
      const url = `https://api.adzuna.com/v1/api/jobs/za/search/${p}?app_id=${process.env.ADZUNA_APP_ID}&app_key=${process.env.ADZUNA_APP_KEY}&results_per_page=50&sort_by=date&content-type=application/json`;
      jobs.push(...(await fetchJson<{ results: any[] }>(url)).results.map(normalizeAdzuna));
    }
    await ctx.emit({ source: 'adzuna', scope: 'adzuna:za', complete: false, jobs }); // partial window: expiry is age-based
  },
};
