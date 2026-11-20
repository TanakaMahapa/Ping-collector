import type { Adapter, NormalizedJob } from '../models/types.js';
import { fetchJson } from '../lib/http.js';
import { inferExperience, parseLocation, snippet } from '../models/normalize.js';

export function normalizeArbeitnow(j: any): NormalizedJob {
  const loc = parseLocation(j.remote ? `remote ${j.location ?? ''}` : j.location);
  return {
    source: 'arbeitnow', source_job_id: j.slug, title: j.title, company: j.company_name,
    location_text: j.location ?? null, ...loc, is_remote: !!j.remote || loc.is_remote,
    salary_min: null, salary_max: null, currency: null,
    category: j.tags?.[0] ?? null, experience_level: inferExperience(j.title),
    description_snippet: snippet(j.description), apply_url: j.url,
    posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : null, posted_at_trusted: !!j.created_at,
  };
}

export const arbeitnow: Adapter = {
  id: 'arbeitnow', lane: 'slow', intervalMinutes: 20, enabled: () => true,
  async poll(ctx) {
    const jobs: NormalizedJob[] = [];
    let url: string | null = 'https://www.arbeitnow.com/api/job-board-api';
    for (let i = 0; i < 3 && url; i++) { // first 3 pages (newest)
      const d: { data: any[]; links?: { next?: string } } = await fetchJson(url);
      jobs.push(...d.data.map(normalizeArbeitnow));
      url = d.links?.next ?? null;
    }
    await ctx.emit({ source: 'arbeitnow', scope: 'arbeitnow:recent', complete: false, jobs });
  },
};
