import type { Adapter, NormalizedJob } from '../models/types.js';
import { fetchJson } from '../lib/http.js';
import { inferExperience, nonNull, parseLocation, safeIso, snippet } from '../models/normalize.js';

export function normalizeRemoteOK(j: any): NormalizedJob | null {
  if (!j?.id || !j?.position || !(j.url || j.apply_url)) return null; // the first array item is a legal notice, not a job
  const loc = parseLocation(`remote ${j.location ?? 'worldwide'}`);
  const posted = safeIso(j.epoch ?? j.date);
  return { source: 'remoteok', source_job_id: String(j.id), title: j.position, company: j.company || 'Unknown', location_text: j.location || 'Remote', city: null, region: null, country: null,
    is_remote: true, remote_worldwide: loc.remote_worldwide || !j.location, remote_countries: loc.remote_countries, salary_min: j.salary_min || null, salary_max: j.salary_max || null, currency: j.salary_min ? 'USD' : null,
    category: Array.isArray(j.tags) ? j.tags[0] ?? null : null, experience_level: inferExperience(j.position), description_snippet: snippet(j.description),
    apply_url: j.url ?? j.apply_url, posted_at: posted, posted_at_trusted: !!posted };
}
// No key. RemoteOK's terms require a visible link back and naming them as the source: cards say "via RemoteOK" and link to their page.
export const remoteok: Adapter = {
  id: 'remoteok', lane: 'slow', intervalMinutes: Number(process.env.REMOTEOK_INTERVAL_MIN ?? 60), enabled: () => true,
  async poll(ctx) {
    const d = await fetchJson<any[]>('https://remoteok.com/api');
    await ctx.emit({ source: 'remoteok', scope: 'remoteok:recent', complete: false, jobs: d.map(normalizeRemoteOK).filter(nonNull) });
  },
};
