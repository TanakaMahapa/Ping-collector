import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOracle, oracleListUrl, oraclePostedAt, splitOracleSlug } from '../adapters/oracle.js';
import { normalizeSmartRecruiters } from '../adapters/smartrecruiters.js';
import { normalizeRecruitee } from '../adapters/recruitee.js';
import { scanHtml } from '../scripts/detect-ats.js';
const co = { id: 1, slug: 'ehle.fa.em2.oraclecloud.com|CX_1', ats_type: 'oracle', name: 'MTN', country_hint: 'ZA' };
const NOW = new Date('2026-11-22T10:00:00Z');

test('oracle slug and url', () => {
  assert.deepEqual(splitOracleSlug('ehle.fa.em2.oraclecloud.com|CX_1'), { host: 'ehle.fa.em2.oraclecloud.com', site: 'CX_1' });
  assert.throws(() => splitOracleSlug('nonsense'));
  const u = oracleListUrl('h.example.com', 'CX_1', 25);
  assert.ok(u.startsWith('https://h.example.com/hcmRestApi/') && u.includes('siteNumber=CX_1') && u.includes('offset=25') && u.includes('sortBy=POSTING_DATES_DESC'));
});
test('oracle posting date: past day is trusted, today falls back to first-seen', () => {
  assert.equal(oraclePostedAt('2026-11-03', NOW).posted_at_trusted, true);
  assert.equal(oraclePostedAt('2026-11-22', NOW).posted_at, null);
  assert.equal(oraclePostedAt(undefined, NOW).posted_at_trusted, false);
});
test('oracle job: SA location, site country code wins, direct apply link', () => {
  const j = normalizeOracle({ Id: '123', Title: 'Senior Manager - Software Developer', PostedDate: '2026-11-03', PrimaryLocation: 'Roodepoort, Gauteng, South Africa', PrimaryLocationCountry: 'ZA' }, co, 'ehle.fa.em2.oraclecloud.com', 'CX_1', NOW)!;
  assert.equal(j.country, 'ZA'); assert.equal(j.source, 'oracle'); assert.equal(j.experience_level, 'senior');
  assert.equal(j.apply_url, 'https://ehle.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123');
  const g = normalizeOracle({ Id: '9', Title: 'Engineer', PrimaryLocation: 'Accra, Ghana', PrimaryLocationCountry: 'GH' }, co, 'h', 'CX_1', NOW)!;
  assert.equal(g.country, 'GH'); // not mislabelled ZA by the company hint
  assert.equal(normalizeOracle({ Title: 'No id' }, co, 'h', 's', NOW), null);
});
test('smartrecruiters and recruitee normalise', () => {
  const s = normalizeSmartRecruiters({ id: '77', name: 'Analyst', releasedDate: '2026-11-20T08:00:00.000Z', location: { city: 'Cape Town', country: 'za' } }, { ...co, slug: 'acme', ats_type: 'smartrecruiters' })!;
  assert.equal(s.country, 'ZA'); assert.equal(s.apply_url, 'https://jobs.smartrecruiters.com/acme/77'); assert.equal(s.posted_at_trusted, true);
  const r = normalizeRecruitee({ id: 5, title: 'Designer', city: 'Durban', country_code: 'ZA', published_at: '2026-11-20 08:00:00 UTC', careers_url: 'https://acme.recruitee.com/o/designer' }, { ...co, slug: 'acme', ats_type: 'recruitee' })!;
  assert.equal(r.country, 'ZA'); assert.equal(r.apply_url, 'https://acme.recruitee.com/o/designer');
});
test('detector spots hiring systems in page html', () => {
  const html = '<a href="https://ehle.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs">Jobs</a> <a href="https://boards.greenhouse.io/luno">x</a> <script type="application/ld+json">{"@type":"JobPosting"}</script>';
  const hits = scanHtml(html, 'https://x.co.za/careers').map(h => `${h.ats}:${h.slug}`);
  assert.ok(hits.includes('oracle:ehle.fa.em2.oraclecloud.com|CX_1')); assert.ok(hits.includes('greenhouse:luno')); assert.ok(hits.includes('jsonld-jobposting:page'));
});

import { extractJobPostings, findJobLinks, hasNextPage, normalizeJsonLd, parseRobots } from '../adapters/jsonld.js';
const small = { id: 2, slug: 'https://acmeplumbing.co.za/careers', ats_type: 'jsonld', name: 'Acme Plumbing', country_hint: 'ZA' };
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

test('jsonld: small business job page becomes a direct job, expired ones are skipped', () => {
  const html = ld({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'JobPosting', title: 'Plumber', datePosted: '2026-11-20', validThrough: '2026-12-31', url: 'https://acmeplumbing.co.za/jobs/plumber',
    jobLocation: { address: { addressLocality: 'Soweto', addressRegion: 'Gauteng', addressCountry: 'ZA' } }, baseSalary: { currency: 'ZAR', value: { minValue: 9000, maxValue: 12000 } }, description: '<p>Fix pipes</p>' }] })
    + ld({ '@type': 'JobPosting', title: 'Old role', validThrough: '2026-01-01' });
  const posts = extractJobPostings(html); assert.equal(posts.length, 2);
  const j = normalizeJsonLd(posts[0], small, 'https://acmeplumbing.co.za/careers', NOW)!;
  assert.equal(j.country, 'ZA'); assert.equal(j.city, 'Soweto'); assert.equal(j.salary_min, 9000); assert.equal(j.currency, 'ZAR'); assert.equal(j.company, 'Acme Plumbing'); assert.equal(j.apply_url, 'https://acmeplumbing.co.za/jobs/plumber');
  assert.equal(normalizeJsonLd(posts[1], small, 'x', NOW), null);
  assert.equal(extractJobPostings('<script type="application/ld+json">{broken</script>').length, 0);
});
test('jsonld: finds job-page links on the same site only; detects paging', () => {
  const html = '<a href="/jobs/driver">d</a><a href="https://other.com/jobs/x">x</a><a href="/about">a</a><a href="/careers">self</a><a href="/files/cv.pdf">pdf</a>';
  assert.deepEqual(findJobLinks(html, 'https://acmeplumbing.co.za/careers'), ['https://acmeplumbing.co.za/jobs/driver']);
  assert.equal(hasNextPage('<a rel="next" href="?page=2">'), true); assert.equal(hasNextPage('<p>none</p>'), false);
});
test('robots.txt: disallowed paths are skipped, longest rule wins', () => {
  const ok = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/jobs\n\nUser-agent: badbot\nDisallow: /');
  assert.equal(ok('/careers'), true); assert.equal(ok('/private/x'), false); assert.equal(ok('/private/jobs/1'), true);
  assert.equal(parseRobots('User-agent: pingjobs\nDisallow: /')('/careers'), false);
  assert.equal(parseRobots('')('/anything'), true);
});
