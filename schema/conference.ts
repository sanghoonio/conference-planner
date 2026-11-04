import { z } from 'zod';

export const FORMAT = 'conference-planner/v1';

// Patterns are strict enough that JSON Schema validators reject what the app rejects (no 24:00, no month 13).
const LOCAL_DATE_RE = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
const LOCAL_DATETIME = new RegExp(`^${LOCAL_DATE_RE}T(?:[01]\\d|2[0-3]):[0-5]\\d$`);
const LOCAL_DATE = new RegExp(`^${LOCAL_DATE_RE}$`);

const text = z.string().min(1);
const opt = <T extends z.ZodType>(t: T) => t.nullish();

export const LocalDateTime = z
  .string()
  .regex(LOCAL_DATETIME, 'must be local wall-clock time "YYYY-MM-DDTHH:mm" (no offset, no Z)')
  .refine(isRealDateTime, 'not a real calendar date/time')
  .describe('Local wall-clock time in conference.timezone, "YYYY-MM-DDTHH:mm".');

export const LocalDate = z
  .string()
  .regex(LOCAL_DATE, 'must be "YYYY-MM-DD"')
  .refine((s) => isRealDateTime(`${s}T00:00`), 'not a real calendar date');

export const Person = z
  .strictObject({
    name: text,
    affiliation: opt(z.string()),
  })
  .describe('A person. `affiliation` is free text as printed.');

export const FacetValues = z
  .record(z.string(), z.array(text))
  .describe('Map of facet key (declared in top-level `facets`) to display-label values.');

export const SESSION_KINDS = ['talks', 'posters', 'keynote', 'plenary', 'workshop', 'social', 'break', 'other'] as const;

export const Presentation = z.strictObject({
  id: text.describe('Unique across the whole file and stable across regenerations.'),
  title: text,
  start: opt(LocalDateTime).describe('Omit to inherit the session start.'),
  end: opt(LocalDateTime).describe('Omit to inherit the session end.'),
  speakers: opt(z.array(Person)).describe('Presenting author(s) / speaker(s).'),
  authors: opt(z.string()).describe('Full author line as printed, e.g. "A. Smith, B. Jones".'),
  affiliations: opt(z.string()).describe('Full affiliation text as printed.'),
  abstract: opt(z.string()).describe('Plain text; a blank line separates paragraphs.'),
  code: opt(z.string()).describe('Abstract / program number as printed, e.g. "42" or "PgmNr 1234".'),
  board: opt(z.string()).describe('Poster board number, if different from `code`.'),
  rooms: opt(z.array(text)).describe('Only if different from the session rooms.'),
  facets: opt(FacetValues),
  url: opt(z.string()),
});

export const Session = z.strictObject({
  id: text.describe('Unique across the whole file and stable across regenerations.'),
  title: text,
  kind: z.enum(SESSION_KINDS),
  start: LocalDateTime,
  end: opt(LocalDateTime).describe('Omit only if the program gives no end time.'),
  rooms: opt(z.array(text)),
  chairs: opt(z.array(Person)),
  description: opt(z.string()).describe('Plain text; a blank line separates paragraphs.'),
  code: opt(z.string()).describe('Session number/code as printed, e.g. "Session 3".'),
  facets: opt(FacetValues),
  url: opt(z.string()),
  presentations: opt(z.array(Presentation)),
});

export const Facet = z.strictObject({
  key: z.string().regex(/^[a-z0-9_-]+$/, 'lowercase letters, digits, "_" or "-"'),
  label: text,
  source: z
    .enum(['organizer', 'suggested'])
    .nullish()
    .describe('"organizer" (default): the conference\'s own categories. "suggested": inferred by an agent from titles and abstracts; the planner styles these differently and lets the user hide them.'),
});

export const Conference = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal(FORMAT),
  conference: z.strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase slug, e.g. "cshl-data-2026"')
      .describe('Stable slug. Stars are stored under it, so never change it between versions of one conference.'),
    name: text,
    shortName: opt(z.string().min(1)).describe('Short display name for the sidebar, e.g. "ASHG 2026". Defaults to `name`.'),
    timezone: text.describe('IANA timezone, e.g. "America/New_York". All times in the file are local to it.'),
    start: opt(LocalDate),
    end: opt(LocalDate),
    location: opt(z.string()),
    url: opt(z.string()),
    description: opt(z.string()),
    source: opt(
      z.strictObject({
        description: opt(z.string()),
        retrieved: opt(LocalDate),
      }),
    ),
  }),
  facets: opt(z.array(Facet)).describe('Filterable dimensions, in display order.'),
  sessions: z.array(Session).min(1),
});

export type ConferenceFile = z.infer<typeof Conference>;
export type SessionIn = z.infer<typeof Session>;
export type PresentationIn = z.infer<typeof Presentation>;
export type PersonT = z.infer<typeof Person>;
export type SessionKind = (typeof SESSION_KINDS)[number];

// ---------- semantic checks ----------

/** Sidebar heading length that stays within about three lines at the reference's 27px serif. */
export const HEADING_MAX = 32;

export type Issue = { level: 'error' | 'warning'; path: string; message: string };

export function isRealDateTime(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function semanticIssues(c: ConferenceFile): Issue[] {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });

  const tz = c.conference.timezone;
  if (!isValidTimeZone(tz)) err('conference.timezone', `unknown IANA timezone "${tz}"`);
  else if (!tz.includes('/') && tz !== 'UTC') warn('conference.timezone', `"${tz}" is an abbreviation, not an IANA name like "America/New_York"; daylight-saving rules may be wrong`);

  const heading = c.conference.shortName ?? c.conference.name;
  if (heading.length > HEADING_MAX)
    warn(
      c.conference.shortName ? 'conference.shortName' : 'conference.name',
      `"${heading}" is ${heading.length} characters; the sidebar heading wraps past three lines above about ${HEADING_MAX}${c.conference.shortName ? '' : '. Add a shorter conference.shortName'}`,
    );

  const facetKeys = new Set((c.facets ?? []).map((f) => f.key));
  const seenFacet = new Set<string>();
  (c.facets ?? []).forEach((f, i) => {
    if (seenFacet.has(f.key)) err(`facets[${i}].key`, `duplicate facet key "${f.key}"`);
    seenFacet.add(f.key);
  });
  const checkFacets = (path: string, fv: Record<string, string[]> | null | undefined) => {
    for (const k of Object.keys(fv ?? {})) if (!facetKeys.has(k)) err(`${path}.facets.${k}`, `facet "${k}" is not declared in top-level "facets"`);
  };

  const ids = new Map<string, string>();
  const checkId = (path: string, id: string) => {
    const prev = ids.get(id);
    if (prev) err(`${path}.id`, `duplicate id "${id}" (also at ${prev})`);
    else ids.set(id, path);
  };

  c.sessions.forEach((s, i) => {
    const sp = `sessions[${i}]`;
    checkId(sp, s.id);
    checkFacets(sp, s.facets);
    if (s.end && s.end < s.start) err(`${sp}.end`, `ends (${s.end}) before it starts (${s.start})`);
    if (s.kind === 'posters' && !(s.presentations?.length)) warn(sp, 'poster session has no presentations');
    s.presentations?.forEach((p, j) => {
      const pp = `${sp}.presentations[${j}]`;
      checkId(pp, p.id);
      checkFacets(pp, p.facets);
      if (p.start && p.end && p.end < p.start) err(`${pp}.end`, `ends (${p.end}) before it starts (${p.start})`);
      if (p.end && !p.start) warn(pp, 'has an end but no start');
      if (p.start && (p.start < s.start || (s.end && p.start > s.end))) warn(`${pp}.start`, `outside its session (${s.start}–${s.end ?? '?'})`);
      else if (p.end && s.end && p.end > s.end) warn(`${pp}.end`, `runs past its session's end (${s.end})`);
    });
  });
  return issues;
}

export type ParseResult = { ok: true; data: ConferenceFile; issues: Issue[] } | { ok: false; issues: Issue[] };

/** Validate an already JSON-parsed value: schema first, then semantic checks. */
export function validateConference(value: unknown): ParseResult {
  const r = Conference.safeParse(value);
  if (!r.success) {
    const issues: Issue[] = r.error.issues.map((i) => ({ level: 'error', path: formatPath(i.path), message: i.message }));
    return { ok: false, issues };
  }
  const issues = semanticIssues(r.data);
  if (issues.some((i) => i.level === 'error')) return { ok: false, issues };
  return { ok: true, data: r.data, issues };
}

function formatPath(path: PropertyKey[]): string {
  let out = '';
  for (const p of path) out += typeof p === 'number' ? `[${p}]` : out ? `.${String(p)}` : String(p);
  return out || '(root)';
}
