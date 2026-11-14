import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchJson, pool } from '../lib/http.js';
import { inferExperience, parseLocation, snippet } from '../models/normalize.js';

export function normalizeGreenhouse(j: any, c: Company): NormalizedJob {
  const loc = parseLocation(j.location?.name, c.country_hint);
  const first = j.first_published ? new Date(j.first_published).toISOString() : null;
  return {
    source: 'greenhouse', source_job_id: String(j.id), title: j.title, company: c.name,
    location_text: j.location?.name ?? null, ...loc,
    salary_min: null, salary_max: null, currency: null,
    category: j.departments?.[0]?.name ?? null, experience_level: inferExperience(j.title),
    description_snippet: snippet(j.content), apply_url: j.absolute_url,
    posted_at: first, posted_at_trusted: !!first, // updated_at is NOT a posting date, so it is never used
  };
}

export const greenhouse: Adapter = {
  id: 'greenhouse', lane: 'fast', intervalMinutes: 5, enabled: () => true,
  async poll(ctx) {
    const list = ctx.companies.filter(c => c.ats_type === 'greenhouse');
    await pool(list, 5, async c => {
      try {
        const data = await fetchJson<{ jobs: any[] }>(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`);
        await ctx.emit({ source: 'greenhouse', scope: `greenhouse:${c.slug}`, company: c.name, complete: true, jobs: data.jobs.map(j => normalizeGreenhouse(j, c)) });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`greenhouse:${c.slug} failed: ${e}`); }
    });
  },
};
