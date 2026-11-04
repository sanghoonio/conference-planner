import type { ConferenceFile, PersonT, SessionKind } from '../../schema/conference.ts';
import { dayKey } from './time.ts';

export type Person = { name: string; affiliation: string | null };

export type Presentation = {
  id: string;
  sessionId: string;
  title: string;
  start: string;
  end: string | null;
  ownTime: boolean;
  speakers: Person[];
  authors: string | null;
  affiliations: string | null;
  abstract: string | null;
  code: string | null;
  board: string | null;
  rooms: string[];
  facets: Record<string, string[]>;
  url: string | null;
  isPoster: boolean;
  search: string;
};

export type Session = {
  id: string;
  title: string;
  kind: SessionKind;
  start: string;
  end: string | null;
  day: string;
  rooms: string[];
  /** Session rooms plus any presentation-specific rooms; used for the room filter. */
  allRooms: string[];
  chairs: Person[];
  description: string | null;
  code: string | null;
  facets: Record<string, string[]>;
  url: string | null;
  presentations: Presentation[];
  search: string;
};

export type FacetDef = { key: string; label: string; suggested: boolean };

export type Model = {
  meta: ConferenceFile['conference'];
  facets: FacetDef[];
  days: string[];
  sessions: Session[];
  presentations: Presentation[];
  sessionById: Map<string, Session>;
  presentationById: Map<string, Presentation>;
  rooms: string[];
  kinds: SessionKind[];
  hasPosters: boolean;
  /** At least one suggested (agent-inferred) facet with at least one value in use. */
  hasSuggested: boolean;
};

/** A presentation's facets add to its session's (per-key union). */
function mergeFacets(a: Record<string, string[]>, b: Record<string, string[]>) {
  const out: Record<string, string[]> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = [...new Set([...(a[k] ?? []), ...(b[k] ?? [])])];
  return out;
}

const person = (p: PersonT): Person => ({ name: p.name, affiliation: p.affiliation ?? null });
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const people = (ps: Person[]) => ps.map((p) => `${p.name} ${p.affiliation ?? ''}`).join(' ');

export function buildModel(c: ConferenceFile): Model {
  const sessions: Session[] = [];
  const presentations: Presentation[] = [];
  const rooms = new Set<string>();
  const kinds = new Set<SessionKind>();

  for (const s of c.sessions) {
    const sRooms = s.rooms ?? [];
    sRooms.forEach((r) => rooms.add(r));
    kinds.add(s.kind);
    const chairs = (s.chairs ?? []).map(person);
    const session: Session = {
      id: s.id,
      title: s.title,
      kind: s.kind,
      start: s.start,
      end: s.end ?? null,
      day: dayKey(s.start),
      rooms: sRooms,
      allRooms: sRooms,
      chairs,
      description: s.description ?? null,
      code: s.code ?? null,
      facets: s.facets ?? {},
      url: s.url ?? null,
      presentations: [],
      search: norm([s.title, s.code, s.description, people(chairs), sRooms.join(' ')].filter(Boolean).join(' ')),
    };
    for (const p of s.presentations ?? []) {
      const speakers = (p.speakers ?? []).map(person);
      const pRooms = p.rooms ?? sRooms;
      pRooms.forEach((r) => rooms.add(r));
      const pres: Presentation = {
        id: p.id,
        sessionId: s.id,
        title: p.title,
        start: p.start ?? s.start,
        end: p.end ?? (p.start ? null : (s.end ?? null)),
        ownTime: !!p.start,
        speakers,
        authors: p.authors ?? null,
        affiliations: p.affiliations ?? null,
        abstract: p.abstract ?? null,
        code: p.code ?? null,
        board: p.board ?? null,
        rooms: pRooms,
        facets: mergeFacets(session.facets, p.facets ?? {}),
        url: p.url ?? null,
        isPoster: s.kind === 'posters' || !!p.board,
        search: norm(
          [p.title, p.code, p.board, people(speakers), p.authors, p.affiliations, p.abstract].filter(Boolean).join(' '),
        ),
      };
      session.presentations.push(pres);
      for (const r of pRooms) if (!session.allRooms.includes(r)) session.allRooms = [...session.allRooms, r];
      presentations.push(pres);
    }
    sessions.push(session);
  }

  const facetDefs: FacetDef[] = (c.facets ?? []).map((f) => ({ key: f.key, label: f.label, suggested: f.source === 'suggested' }));
  const used = (key: string) => sessions.some((s) => s.facets[key]?.length || s.presentations.some((p) => p.facets[key]?.length));

  sessions.sort((a, b) => a.start.localeCompare(b.start) || (a.end ?? '').localeCompare(b.end ?? '') || a.title.localeCompare(b.title));
  for (const s of sessions) s.presentations.sort((a, b) => a.start.localeCompare(b.start)); // stable: keeps file order for equal times

  return {
    meta: c.conference,
    facets: facetDefs,
    days: [...new Set(sessions.map((s) => s.day))].sort(),
    sessions,
    presentations,
    sessionById: new Map(sessions.map((s) => [s.id, s])),
    presentationById: new Map(presentations.map((p) => [p.id, p])),
    rooms: [...rooms].sort(),
    kinds: [...kinds],
    hasSuggested: facetDefs.some((f) => f.suggested && used(f.key)),
    hasPosters: sessions.some((s) => s.kind === 'posters') || presentations.some((p) => p.isPoster),
  };
}

/** Every whitespace-separated term must appear somewhere in the haystack. */
export function makeMatcher(query: string): ((haystack: string) => boolean) | null {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  // A single character matches nearly everything; wait for a second one.
  if (!terms.length || (terms.length === 1 && terms[0].length < 2)) return null;
  return (h) => terms.every((t) => h.includes(t));
}

export const KIND_LABELS: Record<SessionKind, string> = {
  talks: 'Talks',
  posters: 'Posters',
  keynote: 'Keynote',
  plenary: 'Plenary',
  workshop: 'Workshop',
  social: 'Social',
  break: 'Break',
  other: 'Other',
};
