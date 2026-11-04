import type { Model, Presentation, Session } from './model.ts';
import { wallMinutes } from './time.ts';

// Calendar entries, following the reference planner: starred sessions (with their starred talks
// nested) plus starred talks that have their own time slot. Starred posters live in "My poster
// picks"; a poster session shows up here if it is starred or has picks, with a picks count.
// Talks without their own time (the program lists them only under the session) are nested under
// their session rather than each spanning the whole session.

export type Entry = {
  key: string;
  kind: 'session' | 'talk';
  session: Session;
  presentation?: Presentation;
  sessionStarred: boolean;
  nested: Presentation[];
  posterPicks: number;
  day: string;
  start: string;
  end: string | null;
  startMin: number;
  endMin: number;
};

const SESSION_DEFAULT_MIN = 60;
const TALK_DEFAULT_MIN = 30;

/** Minutes from midnight of `day` (can exceed 1440 for items after midnight), and the real end. */
function span(day: string, start: string, end: string | null, fallback: number) {
  const startMin = wallMinutes(start) - wallMinutes(`${day}T00:00`);
  const len = end ? Math.max(wallMinutes(end) - wallMinutes(start), 1) : fallback;
  return { startMin, endMin: startMin + len };
}

export function scheduleEntries(model: Model, stars: Set<string>): Entry[] {
  const out: Entry[] = [];
  for (const s of model.sessions) {
    const starred = stars.has(s.id);
    const picked = s.presentations.filter((p) => stars.has(p.id));
    const posters = picked.filter((p) => p.isPoster);
    const talks = picked.filter((p) => !p.isPoster);
    const own = starred ? [] : talks.filter((p) => p.ownTime);
    const nested = starred ? talks : talks.filter((p) => !p.ownTime);
    if (starred || nested.length || posters.length) {
      out.push({
        key: s.id,
        kind: 'session',
        session: s,
        sessionStarred: starred,
        nested,
        posterPicks: posters.length,
        day: s.day,
        start: s.start,
        end: s.end,
        ...span(s.day, s.start, s.end, SESSION_DEFAULT_MIN),
      });
    }
    for (const p of own) {
      out.push({
        key: p.id,
        kind: 'talk',
        session: s,
        presentation: p,
        sessionStarred: false,
        nested: [],
        posterPicks: 0,
        day: s.day, // a talk after midnight stays with its session's day
        start: p.start,
        end: p.end,
        ...span(s.day, p.start, p.end, TALK_DEFAULT_MIN),
      });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin || a.endMin - b.endMin);
}

/** Overlap clusters within one day, each lane-packed into columns (reference `renderCalendar`). */
export function clusters(entries: Entry[]): { startMin: number; columns: Entry[][] }[] {
  const out: { startMin: number; columns: Entry[][] }[] = [];
  let cl: Entry[] = [];
  let maxEnd = -1;
  const flush = () => {
    if (!cl.length) return;
    const laneEnd: number[] = [];
    const cols: Entry[][] = [];
    for (const e of cl) {
      let lane = laneEnd.findIndex((end) => e.startMin >= end);
      if (lane === -1) {
        lane = laneEnd.length;
        laneEnd.push(0);
        cols.push([]);
      }
      laneEnd[lane] = e.endMin;
      cols[lane].push(e);
    }
    out.push({ startMin: Math.min(...cl.map((e) => e.startMin)), columns: cols });
    cl = [];
    maxEnd = -1;
  };
  for (const e of entries) {
    if (cl.length && e.startMin >= maxEnd) flush();
    cl.push(e);
    maxEnd = Math.max(maxEnd, e.endMin);
  }
  flush();
  return out;
}

/** Starred sessions and non-poster presentations: the "My Schedule" count. */
export function scheduleCount(model: Model, stars: Set<string>): number {
  let n = 0;
  for (const s of model.sessions) {
    if (stars.has(s.id)) n++;
    for (const p of s.presentations) if (!p.isPoster && stars.has(p.id)) n++;
  }
  return n;
}
