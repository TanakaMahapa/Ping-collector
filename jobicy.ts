import type { Adapter, NormalizedJob } from '../models/types.js';
import { fetchJson } from '../lib/http.js';
import { inferExperience, nonNull, parseLocation, safeIso, snippet } from '../models/normalize.js';

export function normalizeJobicy(j: any): NormalizedJob | null {
  if (!j?.id || !j?.jobTitle || !j?.url) return null;
  const loc = parseLocation(`remote ${Array.isArray(j.jobGeo) ? j.jobGeo.join(' ') : j.jobGeo ?? 'worldwide'}`);
  return { source: 'jobicy', source_job_id: String(j.id), title: j.jobTitle, company: j.companyName || 'Unknown', location_text: Array.isArray(j.jobGeo) ? j.jobGeo.join(', ') : j.jobGeo ?? 'Remote', city: null, region: null, country: null,
    is_remote: true, remote_worldwide: loc.remote_worldwide, remote_countries: loc.remote_countries, salary_min: j.salaryMin ?? null, salary_max: j.salaryMax ?? null, currency: j.salaryCurrency ?? null,
    category: Array.isArray(j.jobIndustry) ? j.jobIndustry[0] ?? null : j.jobIndustry ?? null, experience_level: inferExperience(j.jobTitle),
    description_snippet: snippet(j.jobExcerpt ?? j.jobDescription), apply_url: j.url, posted_at: safeIso(j.pubDate), posted_at_trusted: false }; // timezone of pubDate is not documented
}
// No key. Jobicy asks for sparing use, so hourly by default; shown as "via Jobicy" with the link back to their page.
export const jobicy: Adapter = {
  id: 'jobicy', lane: 'slow', intervalMinutes: Number(process.env.JOBICY_INTERVAL_MIN ?? 60), enabled: () => true,
  async poll(ctx) {
    // Latest remote jobs worldwide, plus any regions listed in JOBICY_GEO (default "south-africa"). A rejected region never breaks the batch.
    const geos = ['', ...(process.env.JOBICY_GEO ?? 'south-africa').split(';').map(x => x.trim()).filter(Boolean)];
    const byId = new Map<string, NormalizedJob>();
    for (const g of geos) {
      try {
        const d = await fetchJson<{ jobs?: any[] }>(`https://jobicy.com/api/v2/remote-jobs?count=50${g ? `&geo=${encodeURIComponent(g)}` : ''}`);
        for (const j of (d.jobs ?? []).map(normalizeJobicy).filter(nonNull)) byId.set(j.source_job_id, j);
      } catch (e) { if (!g) throw e; ctx.log(`jobicy geo=${g} failed: ${e}`); }
    }
    await ctx.emit({ source: 'jobicy', scope: 'jobicy:recent', complete: false, jobs: [...byId.values()] });
  },
};
