import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJooble } from '../adapters/jooble.js';
import { normalizeJSearch, normalizeTechmap } from '../adapters/rapidapi.js';
import { normalizeJobicy } from '../adapters/jobicy.js';
import { normalizeRemoteOK } from '../adapters/remoteok.js';
import { normalizeAshby } from '../adapters/ashby.js';
import { normalizeWorkable } from '../adapters/workable.js';
import { safeIso } from '../models/normalize.js';
const co = { id: 1, slug: 'x', ats_type: 'ashby', name: 'Acme', country_hint: 'ZA' };

test('jooble: South African job normalised; bad rows skipped', () => {
  const j = normalizeJooble({ id: 5, title: 'Senior Accountant', company: 'Acme', location: 'Sandton, Gauteng', snippet: '<b>Great</b> role', link: 'https://jooble.org/x', updated: '2026-11-16T10:00:00.1234567' })!;
  assert.equal(j.city, 'Sandton'); assert.equal(j.country, 'ZA'); assert.equal(j.experience_level, 'senior'); assert.equal(j.description_snippet, 'Great role'); assert.equal(j.posted_at_trusted, false);
  assert.equal(normalizeJooble({ id: 1, title: 'No link' }), null);
});
test('jsearch: remote flag, country and direct link', () => {
  const j = normalizeJSearch({ job_id: 'a', job_title: 'Driver', employer_name: 'Z', job_apply_link: 'https://z.co/apply', job_city: 'Benoni', job_state: 'Gauteng', job_country: 'ZA', job_posted_at_datetime_utc: '2026-11-16T08:00:00.000Z', job_min_salary: 8000, job_salary_currency: 'ZAR' })!;
  assert.equal(j.country, 'ZA'); assert.equal(j.city, 'Benoni'); assert.equal(j.posted_at_trusted, true); assert.equal(j.salary_min, 8000);
  assert.equal(normalizeJSearch({ job_id: 'b', job_title: 'x' }), null);
});
test('jobicy and remoteok: remote, worldwide detection, legal-notice row skipped', () => {
  assert.equal(normalizeJobicy({ id: 1, jobTitle: 'Dev', url: 'u', jobGeo: 'Anywhere', companyName: 'R' })!.remote_worldwide, true);
  assert.equal(normalizeRemoteOK({ legal: 'terms' }), null);
  const r = normalizeRemoteOK({ id: 9, position: 'Senior Engineer', url: 'https://remoteok.com/9', epoch: 1789560000, company: 'C' })!;
  assert.equal(r.is_remote, true); assert.equal(r.experience_level, 'senior'); assert.ok(r.posted_at);
});
test('ashby and workable: employer boards keep the direct apply link', () => {
  const a = normalizeAshby({ id: 'i', title: 'Designer', location: 'Cape Town', isRemote: false, applyUrl: 'https://jobs.ashbyhq.com/x/i/application', publishedAt: '2026-11-10T09:00:00Z' }, co)!;
  assert.equal(a.city, 'Cape Town'); assert.equal(a.apply_url, 'https://jobs.ashbyhq.com/x/i/application'); assert.equal(a.company, 'Acme');
  const w = normalizeWorkable({ shortcode: 'AB12', title: 'Nurse', city: 'Durban', country: 'South Africa', url: 'https://apply.workable.com/x/j/AB12/', telecommuting: false }, co)!;
  assert.equal(w.city, 'Durban'); assert.equal(w.country, 'ZA');
});
test('safeIso handles epoch seconds, zone-less strings, and junk', () => {
  assert.equal(safeIso(1789560000)?.slice(0, 4), '2026'); assert.ok(safeIso('2026-11-16 09:12:00')); assert.equal(safeIso('nonsense'), null); assert.equal(safeIso(''), null);
});

test('techmap: tolerant of schema.org-style fields, skips rows without a link', () => {
  const j = normalizeTechmap({ id: 7, title: 'Data Analyst', hiringOrganization: { name: 'Acme' }, jobLocation: { address: { addressLocality: 'Pretoria', addressRegion: 'Gauteng', addressCountry: 'ZA' } }, url: 'https://x.co/7', datePosted: '2026-11-17' })!;
  assert.equal(j.company, 'Acme'); assert.equal(j.city, 'Pretoria'); assert.equal(j.country, 'ZA'); assert.equal(j.source, 'techmap');
  assert.equal(normalizeTechmap({ id: 1, title: 'No link' }), null);
});
