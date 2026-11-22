import { createHash } from 'node:crypto';
import type { Adapter, Company, NormalizedJob } from '../models/types.js';
import { fetchText, pool } from '../lib/http.js';
import { inferExperience, parseLocation, safeIso, snippet } from '../models/normalize.js';

/**
 * Employer websites that publish their jobs as schema.org "JobPosting" data (the same data Google Jobs reads).
 * No hiring system is needed, so this reaches small businesses too: a plain WordPress site with a jobs plugin is enough.
 * companies.slug = the address of the careers/vacancies page, e.g. "https://acmeplumbing.co.za/careers".
 * Polite by design: obeys robots.txt, one page at a time, a short pause between pages, and never more than MAX_PAGES per company.
 */
const MAX_PAGES = 40;
const PAUSE_MS = 300;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function extractJobPostings(html: string): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const t = n['@type']; if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) out.push(n);
    if (n['@graph']) walk(n['@graph']);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* ignore a block that is not valid JSON */ }
  }
  return out;
}

/** Links on the listing page that look like individual job pages, on the same site. */
export function findJobLinks(html: string, pageUrl: string, max = MAX_PAGES): string[] {
  const base = new URL(pageUrl); const seen = new Set<string>([pageUrl]); const out: string[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], pageUrl);
      if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol) || /\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(u.pathname)) continue;
      if (!/(job|career|vacanc|position|opening|opportunit|apply)/i.test(u.pathname) || u.pathname.replace(/\/$/, '') === base.pathname.replace(/\/$/, '')) continue;
      u.hash = ''; const href = u.toString();
      if (!seen.has(href)) { seen.add(href); out.push(href); if (out.length >= max) break; }
    } catch { /* bad href */ }
  }
  return out;
}

export const hasNextPage = (html: string) => /rel=["']next["']/i.test(html) || /href=["'][^"']*[?&](?:page|paged|pg)=\d+/i.test(html);

/** Minimal robots.txt reader: the "*" group and any group naming us; longest matching rule wins, Allow wins a tie. */
export function parseRobots(txt: string, agent = 'pingjobs') {
  const rules: { allow: boolean; path: string }[] = [];
  let applies = false, inAgents = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'user-agent') { const a = v.toLowerCase(); if (!inAgents) applies = false; inAgents = true; if (a === '*' || agent.includes(a) || a.includes(agent)) applies = true; }
    else { inAgents = false; if (applies && (k === 'allow' || k === 'disallow') && v) rules.push({ allow: k === 'allow', path: v }); }
  }
  return (path: string) => {
    let best: { allow: boolean; len: number } | null = null;
    for (const r of rules) {
      const pat = r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
      if (new RegExp('^' + pat).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
    }
    return best ? best.allow : true;
  };
}

const text = (v: any): string | null => (typeof v === 'string' ? v : typeof v?.name === 'string' ? v.name : null);
export function normalizeJsonLd(p: any, c: Company, pageUrl: string, now = new Date()): NormalizedJob | null {
  const title = text(p?.title); if (!title) return null;
  const until = safeIso(p.validThrough); if (until && new Date(until) < now) return null; // closed already
  const loc0 = Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation;
  const a = loc0?.address ?? {};
  const countryRaw = text(a.addressCountry);
  const locText = [text(a.addressLocality), text(a.addressRegion), countryRaw].filter(Boolean).join(', ') || null;
  const loc = parseLocation(locText, c.country_hint);
  if (countryRaw && /^[A-Za-z]{2}$/.test(countryRaw)) loc.country = countryRaw.toUpperCase();
  if (String(p.jobLocationType ?? '').toUpperCase() === 'TELECOMMUTE') loc.is_remote = true;
  const bv = p.baseSalary?.value ?? {};
  const min = Number(bv.minValue ?? bv.value ?? NaN), max = Number(bv.maxValue ?? bv.value ?? NaN);
  const posted = safeIso(p.datePosted);
  const apply = typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url : pageUrl;
  const id = createHash('sha1').update(`${apply}|${title}`).digest('hex').slice(0, 20);
  return {
    source: 'jsonld', source_job_id: id, title: title.trim(), company: c.name, location_text: locText, ...loc,
    salary_min: Number.isFinite(min) ? min : null, salary_max: Number.isFinite(max) ? max : null, currency: Number.isFinite(min) || Number.isFinite(max) ? (p.baseSalary?.currency ?? null) : null,
    category: text(p.occupationalCategory) ?? text(p.industry), experience_level: inferExperience(title),
    description_snippet: snippet(typeof p.description === 'string' ? p.description : null), apply_url: apply,
    posted_at: posted, posted_at_trusted: !!posted,
  };
}

/** Read one company: listing page first, then individual job pages if the listing itself carries no data. */
export async function readCompany(c: Company, now = new Date()): Promise<{ jobs: NormalizedJob[]; complete: boolean }> {
  const start = new URL(c.slug);
  const rb = await fetchText(`${start.origin}/robots.txt`);
  if (rb.status >= 500) throw new Error(`robots.txt unavailable (HTTP ${rb.status}), not crawling`);
  const allowed = rb.status === 200 ? parseRobots(rb.text) : () => true;
  if (!allowed(start.pathname)) throw new Error('robots.txt asks us not to read this page');

  const list = await fetchText(c.slug); if (list.status !== 200) throw new Error(`HTTP ${list.status} for careers page`);
  const jobs = new Map<string, NormalizedJob>();
  const add = (ps: any[], url: string) => { for (const p of ps) { const n = normalizeJsonLd(p, c, url, now); if (n) jobs.set(n.source_job_id, n); } };
  add(extractJobPostings(list.text), list.url);

  let capped = false;
  if (!jobs.size) {
    const links = findJobLinks(list.text, list.url);
    capped = links.length >= MAX_PAGES;
    for (const href of links) {
      if (!allowed(new URL(href).pathname)) continue;
      await sleep(PAUSE_MS);
      try { const r = await fetchText(href); if (r.status === 200) add(extractJobPostings(r.text), r.url); } catch { /* one bad page must not lose the rest */ }
    }
  }
  return { jobs: [...jobs.values()], complete: !capped && !hasNextPage(list.text) };
}

export const jsonld: Adapter = {
  id: 'jsonld', lane: 'fast', intervalMinutes: 30, enabled: () => true,
  async poll(ctx) {
    const targets = ctx.companies.filter(c => c.ats_type === 'jsonld');
    await pool(targets, 2, async c => {
      try {
        const { jobs, complete } = await readCompany(c);
        await ctx.emit({ source: 'jsonld', scope: `jsonld:${c.slug}`, company: c.name, complete, jobs });
        await ctx.reportCompany(c.id, true);
      } catch (e) { await ctx.reportCompany(c.id, false, String(e)); ctx.log(`jsonld:${c.slug} failed: ${e}`); }
    });
  },
};
