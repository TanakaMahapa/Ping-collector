import type { Adapter, NormalizedJob } from '../models/types.js';
import { fetchJson } from '../lib/http.js';
import { inferExperience, parseLocation, snippet } from '../models/normalize.js';

export function normalizeRemotive(j: any): NormalizedJob {
  const loc = parseLocation(`remote ${j.candidate_required_location ?? 'worldwide'}`);
  return {
    source: 'remotive', source_job_id: String(j.id), title: j.title, company: j.company_name,
    location_text: j.candidate_required_location ?? 'Remote', city: null, region: null, country: null,
    is_remote: true, remote_worldwide: loc.remote_worldwide, remote_countries: loc.remote_countries,
    salary_min: null, salary_max: null, currency: null, // salary is free text; shown only if parsed later
    category: j.category ?? null, experience_level: inferExperience(j.title),
    description_snippet: snippet(j.description), apply_url: j.url, // links back to remotive.com (required)
    posted_at: j.publication_date ? new Date(j.publication_date + 'Z').toISOString() : null, posted_at_trusted: !!j.publication_date,
  };
}

// Remotive asks for sparing use (a few calls/day recommended), so the default interval is 360 min (4 requests a day, as Remotive asks).
export const remotive: Adapter = {
  id: 'remotive', lane: 'slow', intervalMinutes: Number(process.env.REMOTIVE_INTERVAL_MIN ?? 360), enabled: () => true,
  async poll(ctx) {
    const data = await fetchJson<{ jobs: any[] }>('https://remotive.com/api/remote-jobs');
    await ctx.emit({ source: 'remotive', scope: 'remotive:all', complete: true, jobs: data.jobs.map(normalizeRemotive) });
  },
};
