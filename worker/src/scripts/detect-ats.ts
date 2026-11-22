// Finds which hiring system each employer uses by reading its public careers pages.
// Usage: node dist/scripts/detect-ats.js ../data/sa-targets.csv ./detect-out
// Input CSV: name,domain   Output: detect-report.csv (everything found) + companies-suggested.csv (ready for the importer).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pool } from '../lib/http.js';

const UA = process.env.PING_USER_AGENT ?? 'PingJobs/0.1 (job discovery; contact: set PING_USER_AGENT)';
const SUPPORTED = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'oracle', 'smartrecruiters', 'recruitee', 'jsonld-jobposting']);
const SKIP_SUB = new Set(['www', 'api', 'careers', 'jobs', 'app', 'support', 'help']);

interface Rule { ats: string; re: RegExp; slug: (m: RegExpExecArray) => string | null }
export const RULES: Rule[] = [
  { ats: 'greenhouse', re: /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/gi, slug: m => m[1] },
  { ats: 'greenhouse', re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?!embed)([a-z0-9_-]+)/gi, slug: m => m[1] },
  { ats: 'lever', re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/gi, slug: m => m[1] },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9._-]+)/gi, slug: m => m[1] },
  { ats: 'workable', re: /apply\.workable\.com\/([a-z0-9_-]+)/gi, slug: m => m[1] },
  { ats: 'smartrecruiters', re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/gi, slug: m => m[1] },
  { ats: 'recruitee', re: /([a-z0-9-]+)\.recruitee\.com/gi, slug: m => (SKIP_SUB.has(m[1].toLowerCase()) ? null : m[1].toLowerCase()) },
  { ats: 'oracle', re: /([a-z0-9.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_]+)/gi, slug: m => `${m[1].toLowerCase()}|${m[2]}` },
  { ats: 'workday', re: /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/gi, slug: m => `${m[1]}.${m[2]}|${m[3]}` },
  { ats: 'successfactors', re: /([a-z0-9.-]*(?:successfactors\.(?:com|eu)|jobs2web\.com))/gi, slug: m => m[1].toLowerCase() },
  { ats: 'taleo', re: /([a-z0-9-]+)\.taleo\.net/gi, slug: m => m[1].toLowerCase() },
  { ats: 'icims', re: /([a-z0-9-]+)\.icims\.com/gi, slug: m => m[1].toLowerCase() },
  { ats: 'teamtailor', re: /([a-z0-9-]+)\.teamtailor\.com/gi, slug: m => (SKIP_SUB.has(m[1].toLowerCase()) ? null : m[1].toLowerCase()) },
  { ats: 'bamboohr', re: /([a-z0-9-]+)\.bamboohr\.com/gi, slug: m => m[1].toLowerCase() },
  { ats: 'breezy', re: /([a-z0-9-]+)\.breezy\.hr/gi, slug: m => m[1].toLowerCase() },
  { ats: 'pinpoint', re: /([a-z0-9-]+)\.pinpointhq\.com/gi, slug: m => m[1].toLowerCase() },
  { ats: 'personio', re: /([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/gi, slug: m => m[1].toLowerCase() },
  { ats: 'jobvite', re: /jobs\.jobvite\.com\/([a-z0-9_-]+)/gi, slug: m => m[1].toLowerCase() },
  { ats: 'zoho-recruit', re: /([a-z0-9-]+)\.zohorecruit\.(?:com|eu)/gi, slug: m => m[1].toLowerCase() },
  { ats: 'jsonld-jobposting', re: /"@type"\s*:\s*"JobPosting"/gi, slug: () => 'page' },
];

export function scanHtml(html: string, url: string) {
  const hits: { ats: string; slug: string; evidence: string }[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (let m = r.re.exec(html); m; m = r.re.exec(html)) {
      const slug = r.slug(m);
      if (slug) hits.push({ ats: r.ats, slug, evidence: url });
    }
  }
  return hits;
}

async function getHtml(url: string): Promise<string | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    return (await res.text()).slice(0, 2_000_000);
  } catch { return null; } finally { clearTimeout(t); }
}

const PATHS = ['', '/careers', '/careers/', '/jobs', '/vacancies', '/careers/vacancies', '/about-us/careers', '/join-us', '/work-with-us'];
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function detect(name: string, domain: string) {
  const hits: { ats: string; slug: string; evidence: string }[] = [];
  const seenUrls = new Set<string>(); const extra: string[] = [];
  const bases = [`https://${domain}`, `https://www.${domain}`];
  for (const base of bases) {
    let anyOk = false;
    for (const p of PATHS) {
      const url = base + p; if (seenUrls.has(url)) continue; seenUrls.add(url);
      const html = await getHtml(url); if (!html) continue;
      anyOk = true; hits.push(...scanHtml(html, url));
      if (p === '') for (const m of html.matchAll(/href="([^"#]+)"/gi)) { // follow a few career-looking links from the home page
        if (!/career|vacanc|jobs|work-with|join/i.test(m[1])) continue;
        try { const u = new URL(m[1], url).toString(); if (new URL(u).hostname.endsWith(domain) && extra.length < 4 && !seenUrls.has(u)) extra.push(u); } catch { /* ignore bad href */ }
      }
    }
    if (anyOk) break; // the www/non-www variant answered, no need to try the other
  }
  for (const u of extra) { if (seenUrls.has(u)) continue; seenUrls.add(u); const html = await getHtml(u); if (html) hits.push(...scanHtml(html, u)); }
  const unique = new Map<string, (typeof hits)[number]>(); for (const h of hits) unique.set(`${h.ats}|${h.slug}`, h);
  return { name, domain, hits: [...unique.values()], pages: seenUrls.size };
}

async function main() {
  const [inFile = '../data/sa-targets.csv', outDir = './detect-out'] = process.argv.slice(2);
  const rows: string[][] = readFileSync(inFile, 'utf8').split('\n').slice(1).map(l => l.trim()).filter(Boolean).map(l => l.split(',').map(x => x.trim()));
  mkdirSync(outDir, { recursive: true });
  const report = ['name,domain,ats,slug,supported_by_ping,evidence_url'];
  const suggested = ['slug,name,country_hint,ats_type']; const done = new Set<string>();
  await pool(rows, 4, async ([name, domain]) => {
    if (!name || !domain) return;
    const r = await detect(name, domain);
    if (!r.hits.length) { report.push([name, domain, 'unknown', '', 'no', ''].map(csvCell).join(',')); console.log(`? ${name}: no hiring system found on ${r.pages} pages (JavaScript-only page? check by hand)`); return; }
    for (const h of r.hits) {
      const ok = SUPPORTED.has(h.ats);
      report.push([name, domain, h.ats, h.slug, ok ? 'yes' : 'no', h.evidence].map(csvCell).join(','));
      console.log(`${ok ? '✓' : '·'} ${name}: ${h.ats} ${h.slug}`);
      const isLd = h.ats === 'jsonld-jobposting'; // the page that carries the structured data becomes the company's careers address
      const slug = isLd ? h.evidence : h.slug, ats = isLd ? 'jsonld' : h.ats, key = `${ats}|${slug}`;
      if (ok && !done.has(key)) { done.add(key); suggested.push([slug, name, 'ZA', ats].map(csvCell).join(',')); }
    }
  });
  writeFileSync(`${outDir}/detect-report.csv`, report.join('\n') + '\n');
  writeFileSync(`${outDir}/companies-suggested.csv`, suggested.join('\n') + '\n');
  console.log(`\nWrote ${outDir}/detect-report.csv and ${outDir}/companies-suggested.csv (${suggested.length - 1} ready to import).`);
}
if (process.argv[1]?.endsWith('detect-ats.js')) main();
