import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchJson, pool } from '../lib/http.js';
import { inferExperience, nonNull, parseLocation, safeIso, snippet } from '../models/normalize.js';

export function normalizeWorkable(j: any, c: Company): NormalizedJob | null {
  const url = j?.url ?? j?.application_url ?? j?.shortlink;
  const id = j?.shortcode ?? j?.id;
  if (!id || !j?.title || !url) return null;
  const text = [j.city, j.state, j.country].filter(Boolean).join(', ');
  const loc = parseLocation(j.telecommuting ? `remote ${text}` : text, c.country_hint);
  const posted = safeIso(j.published_on ?? j.created_at);
  return { source: 'workable', source_job_id: String(id), title: j.title, company: c.name, location_text: text || null, ...loc, salary_min: null, salary_max: null, currency: null,
    category: j.department ?? null, experience_level: inferExperience(j.title), description_snippet: snippet(j.description), apply_url: url, posted_at: posted, posted_at_trusted: !!posted };
}
export const workable: Adapter = {
  id: 'workable', lane: 'fast', intervalMinutes: 5, enabled: () => true,
  async poll(ctx) {
    await pool(ctx.companies.filter(c => c.ats_type === 'workable'), 4, async c => {
      try {
        const d = await fetchJson<{ jobs?: any[] }>(`https://apply.workable.com/api/v1/widget/accounts/${c.slug}?details=true`);
        await ctx.emit({ source: 'workable', scope: `workable:${c.slug}`, company: c.name, complete: true, jobs: (d.jobs ?? []).map(j => normalizeWorkable(j, c)).filter(nonNull) });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`workable:${c.slug} failed: ${e}`); }
    });
  },
};
