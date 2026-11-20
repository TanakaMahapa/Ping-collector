import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchJson, pool } from '../lib/http.js';
import { inferExperience, nonNull, parseLocation, safeIso, snippet } from '../models/normalize.js';

export function normalizeAshby(j: any, c: Company): NormalizedJob | null {
  const url = j?.applyUrl ?? j?.jobUrl;
  if (!j?.id || !j?.title || !url) return null;
  const loc = parseLocation(j.location, c.country_hint); if (j.isRemote) loc.is_remote = true;
  const posted = safeIso(j.publishedAt ?? j.publishedDate);
  return { source: 'ashby', source_job_id: String(j.id), title: j.title, company: c.name, location_text: j.location ?? null, ...loc, salary_min: null, salary_max: null, currency: null,
    category: j.department ?? j.team ?? null, experience_level: inferExperience(j.title), description_snippet: snippet(j.descriptionPlain ?? j.descriptionHtml), apply_url: url, posted_at: posted, posted_at_trusted: !!posted };
}
export const ashby: Adapter = {
  id: 'ashby', lane: 'fast', intervalMinutes: 5, enabled: () => true,
  async poll(ctx) {
    await pool(ctx.companies.filter(c => c.ats_type === 'ashby'), 5, async c => {
      try {
        const d = await fetchJson<{ jobs?: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}`);
        await ctx.emit({ source: 'ashby', scope: `ashby:${c.slug}`, company: c.name, complete: true, jobs: (d.jobs ?? []).map(j => normalizeAshby(j, c)).filter(nonNull) });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`ashby:${c.slug} failed: ${e}`); }
    });
  },
};
