import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchJson, pool } from '../lib/http.js';
import { inferExperience, parseLocation, safeIso } from '../models/normalize.js';

/** SmartRecruiters public Posting API. slug = the company identifier in jobs.smartrecruiters.com/<identifier>. */
export function normalizeSmartRecruiters(j: any, c: Company): NormalizedJob | null {
  if (!j?.id || !j?.name) return null;
  const l = j.location ?? {};
  const text = [l.city, l.region, l.country ? String(l.country).toUpperCase() : null].filter(Boolean).join(', ') || null;
  const loc = parseLocation(text, c.country_hint);
  if (typeof l.country === 'string' && l.country.length === 2) loc.country = l.country.toUpperCase();
  if (l.remote) loc.is_remote = true;
  const posted = safeIso(j.releasedDate);
  return {
    source: 'smartrecruiters', source_job_id: String(j.id), title: j.name, company: c.name, location_text: text, ...loc,
    salary_min: null, salary_max: null, currency: null,
    category: j.department?.label ?? j.function?.label ?? null, experience_level: inferExperience(j.name),
    description_snippet: null, apply_url: `https://jobs.smartrecruiters.com/${c.slug}/${j.id}`,
    posted_at: posted, posted_at_trusted: !!posted,
  };
}

export const smartrecruiters: Adapter = {
  id: 'smartrecruiters', lane: 'fast', intervalMinutes: 5, enabled: () => true,
  async poll(ctx) {
    const targets = ctx.companies.filter(c => c.ats_type === 'smartrecruiters');
    await pool(targets, 3, async c => {
      try {
        const jobs: NormalizedJob[] = []; let complete = true;
        for (let offset = 0; ; offset += 100) {
          if (offset >= 2000) { complete = false; break; }
          const d = await fetchJson<any>(`https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?limit=100&offset=${offset}`);
          const items: any[] = Array.isArray(d?.content) ? d.content : [];
          for (const j of items) { const n = normalizeSmartRecruiters(j, c); if (n) jobs.push(n); }
          if (items.length < 100 || offset + 100 >= Number(d?.totalFound ?? 0)) break;
        }
        await ctx.emit({ source: 'smartrecruiters', scope: `smartrecruiters:${c.slug}`, company: c.name, complete, jobs });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`smartrecruiters:${c.slug} failed: ${e}`); }
    });
  },
};
