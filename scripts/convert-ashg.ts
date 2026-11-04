// Dev-only: convert the sashagusev/ashg-2026-planner data.js into a conference file, as a
// full-size test of the format and the app (268 sessions, 3,207 presentations).
// Usage: npx tsx scripts/convert-ashg.ts <path/to/data.js> <out.conference.json[.gz]>
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { FORMAT, validateConference, type ConferenceFile, type SessionKind } from '../schema/conference.ts';
import { nowInZone } from '../src/lib/time.ts';

type Sp = { n: string; a: string };
type Raw = {
  id: string; t: string; s: string; e: string; rm: string[]; tr: string[]; st: string[]; sp: Sp[]; mo: Sp[];
  sub: string; abs?: string; au?: string; board?: string; pr?: Raw[];
};

const [input, out] = process.argv.slice(2);
if (!input || !out) {
  console.error('usage: npx tsx scripts/convert-ashg.ts <data.js> <out.conference.json[.gz]>');
  process.exit(2);
}

const TZ = 'America/Toronto';
const text = readFileSync(input, 'utf8');
const data = JSON.parse(text.slice(text.indexOf('=') + 1).trim().replace(/;$/, '')) as { sessions: Raw[] };

const local = (iso: string) => nowInZone(TZ, new Date(iso));
const people = (xs: Sp[]) => xs.map((x) => ({ name: x.n, ...(x.a ? { affiliation: x.a } : {}) }));
const nz = <T>(xs: T[]) => (xs.length ? xs : undefined);

const KIND: Record<string, SessionKind> = {
  'Poster Presentations': 'posters',
  'Plenary Sessions': 'plenary',
  'Workshops and Courses': 'workshop',
  'Networking and Social Events': 'social',
  'Ancillary Events': 'other',
  'Industry Events': 'other',
};

const facets = (r: Raw) => {
  const f: Record<string, string[]> = {};
  if (r.tr.length) f.track = r.tr;
  return Object.keys(f).length ? f : undefined;
};

const conf: ConferenceFile = {
  format: FORMAT,
  conference: {
    id: 'ashg-2026',
    name: 'ASHG 2026 Annual Meeting',
    shortName: 'ASHG 2026',
    timezone: TZ,
    start: '2026-10-18',
    end: '2026-10-24',
    location: 'Montréal, Canada',
    url: 'https://www.ashg.org/meeting/',
    source: { description: 'sashagusev/ashg-2026-planner data.js (floq/AppSync program dump)', retrieved: '2026-11-03' },
  },
  facets: [
    { key: 'track', label: 'Track' },
    { key: 'type', label: 'Session type' },
  ],
  sessions: data.sessions.map((s) => ({
    id: s.id,
    title: s.t,
    kind: KIND[s.st[0]] ?? 'talks',
    start: local(s.s),
    end: local(s.e),
    rooms: nz(s.rm),
    chairs: nz(people(s.mo)),
    description: [s.sub, s.abs].filter(Boolean).join('\n\n') || undefined,
    facets: { ...(facets(s) ?? {}), ...(s.st.length ? { type: s.st } : {}) },
    presentations: nz(
      (s.pr ?? []).map((p) => ({
        id: p.id,
        title: p.t,
        // Talks with their own slot get explicit times; posters spanning the session inherit them.
        ...(p.s && p.e && (p.s !== s.s || p.e !== s.e) ? { start: local(p.s), end: local(p.e) } : {}),
        speakers: nz(people(p.sp)),
        authors: p.au || undefined,
        abstract: p.abs || undefined,
        board: p.board || undefined,
        rooms: nz(p.rm),
        facets: facets(p),
      })),
    ),
  })),
};

const r = validateConference(JSON.parse(JSON.stringify(conf)));
for (const i of r.issues.slice(0, 20)) console.log(`${i.level}: ${i.path}: ${i.message}`);
if (r.issues.length > 20) console.log(`…${r.issues.length - 20} more issues`);
if (!r.ok) process.exit(1);

const json = JSON.stringify(conf);
const bytes = out.endsWith('.gz') ? gzipSync(json, { level: 9 }) : Buffer.from(json);
writeFileSync(out, bytes);
const pres = conf.sessions.reduce((n, s) => n + (s.presentations?.length ?? 0), 0);
console.log(`wrote ${out}: ${conf.sessions.length} sessions, ${pres} presentations, ${(json.length / 1e6).toFixed(1)} MB JSON, ${(bytes.length / 1e6).toFixed(2)} MB on disk`);
