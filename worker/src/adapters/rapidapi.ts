import type { Adapter, NormalizedJob } from '../models/types.js';
import { fetchJson } from '../lib/http.js';
import { inferExperience, nonNull, parseLocation, safeIso, snippet } from '../models/normalize.js';

export function normalizeJSearch(j: any): NormalizedJob | null {
  const url = j?.job_apply_link ?? j?.job_google_link;
  if (!j?.job_id || !j?.job_title || !url) return null;
  const text = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ');
  const cc = typeof j.job_country === 'string' && j.job_country.length === 2 ? j.job_country.toUpperCase() : null;
  const loc = parseLocation(j.job_is_remote ? `remote ${text}` : text, cc ?? 'ZA');
  const posted = safeIso(j.job_posted_at_datetime_utc);
  return { source: 'jsearch', source_job_id: String(j.job_id), title: j.job_title, company: j.employer_name || 'Unknown', location_text: text || null, ...loc,
    city: j.job_city ?? loc.city, region: j.job_state ?? loc.region, country: cc ?? loc.country, is_remote: !!j.job_is_remote || loc.is_remote,
    salary_min: j.job_min_salary ?? null, salary_max: j.job_max_salary ?? null, currency: j.job_salary_currency ?? null, category: null,
    experience_level: inferExperience(j.job_title), description_snippet: snippet(j.job_description), apply_url: url, posted_at: posted, posted_at_trusted: !!posted };
}
// RapidAPI-hosted sources: JSearch (Google for Jobs) and Techmap. One RapidAPI key can serve both (RAPIDAPI_KEY), but you must subscribe to each API on RapidAPI.
// OPTIONAL and off by default. Free plan = a small HARD monthly cap (about 100 to 200 requests), so this runs once a day by default.
// Env: JSEARCH_API_KEY (RapidAPI key), JSEARCH_QUERIES ("jobs in South Africa;accountant jobs in Gauteng"), JSEARCH_PAGES (1), JSEARCH_INTERVAL_MIN (1440).
export const jsearch: Adapter = {
  id: 'jsearch', lane: 'slow', intervalMinutes: Number(process.env.JSEARCH_INTERVAL_MIN ?? 1440), enabled: () => !!(process.env.JSEARCH_API_KEY ?? process.env.RAPIDAPI_KEY),
  async poll(ctx) {
    const queries = (process.env.JSEARCH_QUERIES ?? 'jobs in South Africa').split(';').map(s => s.trim()).filter(Boolean);
    const jobs: NormalizedJob[] = [];
    for (const q of queries) {
      const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&page=1&num_pages=${Number(process.env.JSEARCH_PAGES ?? 1)}&country=za&date_posted=today`;
      const d = await fetchJson<{ data?: any[] }>(url, { headers: { 'X-RapidAPI-Key': (process.env.JSEARCH_API_KEY ?? process.env.RAPIDAPI_KEY)!, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }, retries: 0 });
      jobs.push(...(d.data ?? []).map(normalizeJSearch).filter(nonNull));
    }
    await ctx.emit({ source: 'jsearch', scope: 'jsearch:za', complete: false, jobs });
  },
};

/** Techmap "Daily International Job Postings" (RapidAPI). The response field names below are tolerant guesses from public docs and were NOT
 *  verified against a live response: check the first run's log, and send it to the developer if jobs do not appear. */
export function normalizeTechmap(j: any): NormalizedJob | null {
  const url = j?.url ?? j?.sameAs ?? j?.applyUrl ?? j?.link;
  const title = j?.title ?? j?.name;
  const id = j?.id ?? j?.jobId ?? url;
  if (!id || !title || !url) return null;
  const l0 = Array.isArray(j.jobLocation) ? j.jobLocation[0] : j.jobLocation;
  const addr = l0?.address ?? l0 ?? {};
  const city = addr.addressLocality ?? j.city ?? null, region = addr.addressRegion ?? j.region ?? null;
  const raw = String(addr.addressCountry ?? j.countryCode ?? 'ZA');
  const loc = parseLocation([city, region, raw.length === 2 ? '' : raw].filter(Boolean).join(', '), 'ZA');
  const posted = safeIso(j.datePosted ?? j.dateCreated ?? j.date);
  const remote = /remote/i.test(String(j.workPlace ?? j.jobLocationType ?? ''));
  return { source: 'techmap', source_job_id: String(id), title, company: j.hiringOrganization?.name ?? j.companyName ?? j.company?.name ?? (typeof j.company === 'string' ? j.company : 'Unknown'),
    location_text: [city, region].filter(Boolean).join(', ') || null, ...loc, city: city ?? loc.city, region: region ?? loc.region, country: raw.length === 2 ? raw.toUpperCase() : loc.country, is_remote: remote || loc.is_remote,
    salary_min: j.baseSalary?.value?.minValue ?? null, salary_max: j.baseSalary?.value?.maxValue ?? null, currency: j.baseSalary?.currency ?? null, category: j.industry ?? null,
    experience_level: inferExperience(title), description_snippet: snippet(j.description), apply_url: url, posted_at: posted, posted_at_trusted: !!posted };
}
// Free BASIC plan is about 100 requests / 1,000 postings a month, so: once a day, 2 pages. Env: TECHMAP_API_KEY (or RAPIDAPI_KEY), TECHMAP_PAGES (2), TECHMAP_INTERVAL_MIN (1440).
export const techmap: Adapter = {
  id: 'techmap', lane: 'slow', intervalMinutes: Number(process.env.TECHMAP_INTERVAL_MIN ?? 1440), enabled: () => !!(process.env.TECHMAP_API_KEY ?? process.env.RAPIDAPI_KEY),
  async poll(ctx) {
    const key = (process.env.TECHMAP_API_KEY ?? process.env.RAPIDAPI_KEY)!, host = 'daily-international-job-postings.p.rapidapi.com';
    const jobs: NormalizedJob[] = [], today = new Date().toISOString().slice(0, 10);
    for (let page = 1; page <= Number(process.env.TECHMAP_PAGES ?? 2); page++) {
      const d = await fetchJson<any>(`https://${host}/api/v2/jobs/search?countryCode=za&dateCreated=${today}&page=${page}`, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }, retries: 0 });
      const arr: any[] = d.data ?? d.result ?? d.jobs ?? []; jobs.push(...arr.map(normalizeTechmap).filter(nonNull));
      if (arr.length < 10) break;
    }
    await ctx.emit({ source: 'techmap', scope: 'techmap:za', complete: false, jobs });
  },
};
