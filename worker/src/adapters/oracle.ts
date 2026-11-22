import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchJson, pool } from '../lib/http.js';
import { inferExperience, parseLocation, snippet } from '../models/normalize.js';

/**
 * Oracle Recruiting Cloud ("Candidate Experience") career sites. MTN Group uses this.
 * companies.slug format: "<host>|<siteNumber>", e.g. "ehle.fa.em2.oraclecloud.com|CX_1".
 * The endpoint is the one the career site itself calls, so it is the employer's own live data.
 */
export const ORACLE_PAGE = 25;
const MAX_PAGES = 40; // 1000 jobs per site is plenty; beyond that the batch is marked incomplete

export function splitOracleSlug(slug: string) {
  const [host, site] = slug.split('|').map(s => s.trim());
  if (!host || !site) throw new Error(`bad oracle slug "${slug}" (expected host|siteNumber, e.g. ehle.fa.em2.oraclecloud.com|CX_1)`);
  return { host, site };
}

export function oracleListUrl(host: string, site: string, offset: number, limit = ORACLE_PAGE) {
  const facets = ['LOCATIONS', 'WORK_LOCATIONS', 'WORKPLACE_TYPES', 'TITLES', 'CATEGORIES', 'ORGANIZATIONS', 'POSTING_DATES', 'FLEX_FIELDS'].join('%3B');
  return `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations`
    + `&finder=findReqs;siteNumber=${site},facetsList=${facets},limit=${limit},offset=${offset},sortBy=POSTING_DATES_DESC`;
}

export async function fetchOraclePage(host: string, site: string, offset: number) {
  const data = await fetchJson<any>(oracleListUrl(host, site, offset), { retries: 2 });
  const block = data?.items?.[0];
  if (!block || !Array.isArray(block.requisitionList)) throw new Error('unexpected Oracle response (no requisitionList)');
  return { total: Number(block.TotalJobsCount ?? 0), jobs: block.requisitionList as any[] };
}

/** Oracle gives a date only (no time). A past date is a reliable posting day; for "today" we let first-seen time
 *  decide, so a job posted this morning shows as new within minutes instead of sitting at 00:00. */
export function oraclePostedAt(v: unknown, now = new Date()): { posted_at: string | null; posted_at_trusted: boolean } {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(String(v ?? ''))?.[0];
  if (!day) return { posted_at: null, posted_at_trusted: false };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now);
  if (day >= today) return { posted_at: null, posted_at_trusted: false };
  return { posted_at: new Date(`${day}T00:00:00+02:00`).toISOString(), posted_at_trusted: true };
}

export function normalizeOracle(j: any, c: Company, host: string, site: string, now = new Date()): NormalizedJob | null {
  if (!j?.Id || !j?.Title) return null;
  const locText: string | null = j.PrimaryLocation ?? null;
  const loc = parseLocation(locText, c.country_hint);
  const cc = typeof j.PrimaryLocationCountry === 'string' && j.PrimaryLocationCountry.length === 2 ? j.PrimaryLocationCountry.toUpperCase() : null;
  if (cc) loc.country = cc; // the site's own country code beats our guess and the company hint
  if (/remote/i.test(String(j.WorkplaceType ?? ''))) loc.is_remote = true;
  return {
    source: 'oracle', source_job_id: String(j.Id), title: j.Title, company: c.name,
    location_text: locText, ...loc,
    salary_min: null, salary_max: null, currency: null,
    category: j.JobFamily ?? j.Category ?? null, experience_level: inferExperience(j.Title),
    description_snippet: snippet(j.ShortDescriptionStr),
    apply_url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`,
    ...oraclePostedAt(j.PostedDate, now),
  };
}

export const oracle: Adapter = {
  id: 'oracle', lane: 'fast', intervalMinutes: 5, enabled: () => true,
  async poll(ctx) {
    const targets = ctx.companies.filter(c => c.ats_type === 'oracle');
    await pool(targets, 3, async c => {
      try {
        const { host, site } = splitOracleSlug(c.slug);
        const jobs: NormalizedJob[] = []; let complete = true;
        for (let page = 0; ; page++) {
          if (page >= MAX_PAGES) { complete = false; break; }
          const { total, jobs: raw } = await fetchOraclePage(host, site, page * ORACLE_PAGE);
          for (const j of raw) { const n = normalizeOracle(j, c, host, site); if (n) jobs.push(n); }
          if (raw.length < ORACLE_PAGE || (page + 1) * ORACLE_PAGE >= total) break;
        }
        await ctx.emit({ source: 'oracle', scope: `oracle:${c.slug}`, company: c.name, complete, jobs });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`oracle:${c.slug} failed: ${e}`); }
    });
  },
};
