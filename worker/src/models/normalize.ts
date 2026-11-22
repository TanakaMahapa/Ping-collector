import { createHash } from 'node:crypto';

export const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export const dedupeHash = (company: string, title: string, city: string | null) =>
  createHash('sha1').update(`${norm(company)}|${norm(title)}|${norm(city)}`).digest('hex');

const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export function snippet(html: string | null | undefined, max = 500): string | null {
  if (!html) return null;
  const text = html.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, m => ENT[m]) // Greenhouse double-encodes HTML
    .replace(/<[^>]*>/g, ' ').replace(/&(lt|gt|amp|quot|#39|nbsp);/g, m => ENT[m]).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export function inferExperience(title: string): string | null {
  const t = title.toLowerCase();
  if (/\b(intern|internship|graduate|trainee|learnership)\b/.test(t)) return 'entry';
  if (/\b(junior|jr|entry)\b/.test(t)) return 'junior';
  if (/\b(senior|sr|lead|principal|staff|head of|manager|director)\b/.test(t)) return 'senior';
  if (/\b(mid|intermediate)\b/.test(t)) return 'mid';
  return null;
}

const ZA_PROVINCES: Record<string, string> = {
  'gauteng': 'Gauteng', 'gp': 'Gauteng', 'western cape': 'Western Cape', 'wc': 'Western Cape',
  'kwazulu natal': 'KwaZulu-Natal', 'kzn': 'KwaZulu-Natal', 'eastern cape': 'Eastern Cape', 'free state': 'Free State',
  'limpopo': 'Limpopo', 'mpumalanga': 'Mpumalanga', 'north west': 'North West', 'northern cape': 'Northern Cape',
};
import LOC from '../data/locations.json' with { type: 'json' };
// City/alias -> [City, Province] for every South African place in data/locations.json
const ZA_CITIES: Record<string, [string, string]> = {};
for (const l of LOC as { city: string; region: string; country: string; aliases: string[] }[])
  if (l.country === 'ZA') for (const n of [l.city, ...l.aliases]) ZA_CITIES[norm(n)] = [l.city, l.region];

export interface ParsedLocation { city: string | null; region: string | null; country: string | null; is_remote: boolean; remote_worldwide: boolean; remote_countries: string[] }

export function parseLocation(text: string | null | undefined, countryHint: string | null = null): ParsedLocation {
  const raw = text ?? '';
  const n = norm(raw);
  const out: ParsedLocation = { city: null, region: null, country: null, is_remote: /\b(remote|anywhere|work from home|wfh|worldwide)\b/.test(n), remote_worldwide: false, remote_countries: [] };
  if (out.is_remote) {
    if (/\b(worldwide|anywhere|global)\b/.test(n) && !/\b(only)\b/.test(n)) out.remote_worldwide = true;
    if (/south africa|\bza\b|\bafrica\b|\bemea\b/.test(n)) out.remote_countries.push('ZA'); // Africa/EMEA include ZA
  }
  const inZA = /south africa|\bza\b/.test(n);
  for (const part of raw.split(/[,;|\/\-–]/).map(norm).filter(Boolean)) {
    if (ZA_CITIES[part]) { [out.city, out.region] = ZA_CITIES[part]; out.country = 'ZA'; break; }
    if (ZA_PROVINCES[part]) { out.region = ZA_PROVINCES[part]; out.country = 'ZA'; }
  }
  if (!out.country && inZA) out.country = 'ZA';
  if (!out.city && !out.country && !out.is_remote) { // generic "City, Region" guess
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) out.city = parts[0];
  }
  if (!out.country && !out.is_remote) out.country = countryHint;
  return out;
}

/** Parse a date from a source into an ISO string, or null if it is missing or unreadable. Assumes UTC when no zone is given. */
export function safeIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? String(v) : String(v).replace(' ', 'T') + 'Z');
  return isNaN(s.getTime()) ? null : s.toISOString();
}
export const nonNull = <T,>(x: T | null | undefined): x is T => x !== null && x !== undefined;
