import type { Adapter, NormalizedJob } from '../models/types.js';
import { fetchJson } from '../lib/http.js';
import { inferExperience, nonNull, parseLocation, safeIso, snippet } from '../models/normalize.js';

export function normalizeJooble(j: any): NormalizedJob | null {
  if (!j?.id || !j?.title || !j?.link) return null;
  const loc = parseLocation(j.location, 'ZA');
  return { source: 'jooble', source_job_id: String(j.id), title: j.title, company: j.company || 'Unknown', location_text: j.location ?? null, ...loc,
    salary_min: null, salary_max: null, currency: null, category: null, experience_level: inferExperience(j.title),
    description_snippet: snippet(j.snippet), apply_url: j.link, posted_at: safeIso(j.updated), posted_at_trusted: false }; // `updated` is last-updated, not posted
}
// Free key: jooble.org/api/about. Env: JOOBLE_API_KEY, optional JOOBLE_KEYWORDS ("accountant;driver"), JOOBLE_PAGES (3), JOOBLE_LOCATION (South Africa), JOOBLE_INTERVAL_MIN (60).
export const jooble: Adapter = {
  id: 'jooble', lane: 'slow', intervalMinutes: Number(process.env.JOOBLE_INTERVAL_MIN ?? 60), enabled: () => !!process.env.JOOBLE_API_KEY,
  async poll(ctx) {
    const kws = (process.env.JOOBLE_KEYWORDS ?? '').split(';').map(s => s.trim()).filter(Boolean), list = kws.length ? kws : [''];
    const pages = Number(process.env.JOOBLE_PAGES ?? 3), location = process.env.JOOBLE_LOCATION ?? 'South Africa';
    const jobs: NormalizedJob[] = [];
    for (const keywords of list) for (let p = 1; p <= pages; p++) {
      const d = await fetchJson<{ jobs?: any[] }>(`https://jooble.org/api/${process.env.JOOBLE_API_KEY}`, { method: 'POST', body: { keywords, location, page: String(p) } });
      const arr = d.jobs ?? []; jobs.push(...arr.map(normalizeJooble).filter(nonNull));
      if (arr.length < 5) break;
    }
    await ctx.emit({ source: 'jooble', scope: 'jooble:za', complete: false, jobs });
  },
};
