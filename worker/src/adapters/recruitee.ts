import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchJson, pool } from '../lib/http.js';
import { inferExperience, parseLocation, safeIso, snippet } from '../models/normalize.js';

/** Recruitee public offers API. slug = the subdomain in <slug>.recruitee.com. */
export function normalizeRecruitee(j: any, c: Company): NormalizedJob | null {
  if (!j?.id || !j?.title) return null;
  const text: string | null = j.location ?? ([j.city, j.country].filter(Boolean).join(', ') || null);
  const loc = parseLocation(text, c.country_hint);
  if (typeof j.country_code === 'string' && j.country_code.length === 2) loc.country = j.country_code.toUpperCase();
  if (j.remote) loc.is_remote = true;
  const posted = safeIso(j.published_at ?? j.created_at);
  return {
    source: 'recruitee', source_job_id: String(j.id), title: j.title, company: c.name, location_text: text, ...loc,
    salary_min: null, salary_max: null, currency: null,
    category: j.department ?? null, experience_level: inferExperience(j.title),
    description_snippet: snippet(j.description), apply_url: j.careers_url ?? `https://${c.slug}.recruitee.com/o/${j.slug}`,
    posted_at: posted, posted_at_trusted: !!posted,
  };
}

export const recruitee: Adapter = {
  id: 'recruitee', lane: 'fast', intervalMinutes: 5, enabled: () => true,
  async poll(ctx) {
    const targets = ctx.companies.filter(c => c.ats_type === 'recruitee');
    await pool(targets, 3, async c => {
      try {
        const d = await fetchJson<any>(`https://${c.slug}.recruitee.com/api/offers/`);
        if (!Array.isArray(d?.offers)) throw new Error('unexpected Recruitee response');
        const jobs = d.offers.map((j: any) => normalizeRecruitee(j, c)).filter((x: NormalizedJob | null): x is NormalizedJob => !!x);
        await ctx.emit({ source: 'recruitee', scope: `recruitee:${c.slug}`, company: c.name, complete: true, jobs });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`recruitee:${c.slug} failed: ${e}`); }
    });
  },
};
