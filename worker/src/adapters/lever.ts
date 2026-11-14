import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchJson, pool } from '../lib/http.js';
import { inferExperience, parseLocation, snippet } from '../models/normalize.js';

export function normalizeLever(j: any, c: Company): NormalizedJob {
  const locText = j.categories?.location ?? j.categories?.allLocations?.[0] ?? null;
  const loc = parseLocation(locText, j.country ?? c.country_hint);
  if (j.workplaceType === 'remote') loc.is_remote = true;
  return {
    source: 'lever', source_job_id: j.id, title: j.text, company: c.name, location_text: locText, ...loc,
    salary_min: j.salaryRange?.min ?? null, salary_max: j.salaryRange?.max ?? null, currency: j.salaryRange?.currency ?? null,
    category: j.categories?.team ?? null, experience_level: inferExperience(j.text),
    description_snippet: snippet(j.descriptionPlain ?? j.description), apply_url: j.applyUrl ?? j.hostedUrl,
    posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null, posted_at_trusted: !!j.createdAt,
  };
}

export const lever: Adapter = {
  id: 'lever', lane: 'fast', intervalMinutes: 5, enabled: () => true,
  async poll(ctx) {
    const list = ctx.companies.filter(c => c.ats_type === 'lever');
    await pool(list, 5, async c => {
      try {
        const data = await fetchJson<any[]>(`https://api.lever.co/v0/postings/${c.slug}?mode=json`);
        await ctx.emit({ source: 'lever', scope: `lever:${c.slug}`, company: c.name, complete: true, jobs: data.map(j => normalizeLever(j, c)) });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`lever:${c.slug} failed: ${e}`); }
    });
  },
};
