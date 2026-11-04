import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConference } from '../schema/conference.ts';
import { buildModel, makeMatcher } from '../src/lib/model.ts';
import { clusters, scheduleCount, scheduleEntries } from '../src/lib/schedule.ts';

const load = () => {
  const r = validateConference(JSON.parse(readFileSync(new URL('../public/demo.conference.json', import.meta.url), 'utf8')));
  if (!r.ok) throw new Error('demo invalid');
  return buildModel(r.data);
};

describe('model', () => {
  const m = load();

  it('groups days and sorts sessions by start', () => {
    expect(m.days).toEqual(['2027-03-27', '2027-03-28']);
    const starts = m.sessions.map((s) => s.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it('inherits session times and facets into presentations', () => {
    const p = m.presentationById.get(m.sessionById.get('s3')!.presentations[0].id)!;
    expect(p.ownTime).toBe(false);
    expect(p.start).toBe('2027-03-28T09:30');
    expect(p.end).toBe('2027-03-28T11:30');
    expect(p.facets.track).toEqual(['Algorithms']);
  });

  it('detects posters and rooms', () => {
    expect(m.hasPosters).toBe(true);
    expect(m.presentations.filter((p) => p.isPoster)).toHaveLength(12);
    expect(m.rooms).toContain('Poster Hall');
  });

  it('matches every search term, accent-insensitive', () => {
    const match = makeMatcher('pangenome  GRAPH')!;
    expect(m.presentations.filter((p) => match(p.search)).map((p) => p.title).sort()).toEqual([
      'Fast approximate pangenome graph indexing',
      'Graph indexes for pangenomes',
    ]);
    expect(makeMatcher('   ')).toBeNull();
    expect(makeMatcher('a')).toBeNull();
    const accented = makeMatcher('PANGÉNOME')!;
    expect(m.presentations.filter((p) => accented(p.search))).toHaveLength(2);
  });
});

describe('calendar entries', () => {
  const m = load();
  const s1 = m.sessionById.get('s1')!;
  const s2 = m.sessionById.get('s2')!;
  const s3 = m.sessionById.get('s3')!;

  it('clusters overlapping starred talks into side-by-side columns', () => {
    const entries = scheduleEntries(m, new Set([s1.presentations[0].id, s2.presentations[0].id, s1.presentations[2].id]));
    expect(entries.map((e) => e.kind)).toEqual(['talk', 'talk', 'talk']);
    const cl = clusters(entries);
    expect(cl).toHaveLength(2); // 10:45 pair overlaps; 11:25 talk stands alone
    expect(cl[0].columns).toHaveLength(2);
    expect(cl[1].columns).toHaveLength(1);
  });

  it('does not treat back-to-back or very short talks as overlapping', () => {
    expect(clusters(scheduleEntries(m, new Set([s1.presentations[0].id, s1.presentations[1].id]))).every((c) => c.columns.length === 1)).toBe(true);
  });

  it('nests untimed starred talks under their session; a starred session absorbs its starred talks', () => {
    let e = scheduleEntries(m, new Set([s3.presentations[0].id, s3.presentations[2].id]));
    expect(e).toHaveLength(1);
    expect(e[0].sessionStarred).toBe(false);
    expect(e[0].nested.map((p) => p.id)).toEqual([s3.presentations[0].id, s3.presentations[2].id]);
    e = scheduleEntries(m, new Set(['s1', s1.presentations[0].id]));
    expect(e).toHaveLength(1);
    expect(e[0].nested).toHaveLength(1);
  });

  it('keeps poster picks out of the calendar but notes them on their session', () => {
    const e = scheduleEntries(m, new Set(['poster-1', 'poster-2']));
    expect(e).toHaveLength(1);
    expect(e[0].posterPicks).toBe(2);
    expect(scheduleCount(m, new Set(['poster-1', 's1']))).toBe(1);
  });

  it('gives open-ended items a default length', () => {
    const [d] = scheduleEntries(m, new Set(['dinner']));
    expect(d.end).toBeNull();
    expect(d.endMin - d.startMin).toBe(60);
  });
});

describe('suggested facets', () => {
  it('flags suggested facets and whether any are in use', () => {
    const m = load();
    expect(m.facets.find((f) => f.key === 'topic')?.suggested).toBe(true);
    expect(m.facets.find((f) => f.key === 'track')?.suggested).toBe(false);
    expect(m.hasSuggested).toBe(true);
  });

  it('reports no suggestions when a suggested facet is declared but unused', () => {
    const r = validateConference({
      format: 'conference-planner/v1',
      conference: { id: 'x', name: 'X', timezone: 'UTC' },
      facets: [{ key: 'topic', label: 'Topic', source: 'suggested' }],
      sessions: [{ id: 's', title: 'S', kind: 'talks', start: '2026-01-01T09:00' }],
    });
    if (!r.ok) throw new Error('invalid');
    expect(buildModel(r.data).hasSuggested).toBe(false);
  });
});

describe('facet merging', () => {
  it('unions presentation facets with session facets', () => {
    const r = validateConference({
      format: 'conference-planner/v1',
      conference: { id: 'x', name: 'X', timezone: 'UTC' },
      facets: [{ key: 'track', label: 'Track' }],
      sessions: [{ id: 's', title: 'S', kind: 'talks', start: '2026-01-01T09:00', facets: { track: ['A'] }, presentations: [{ id: 'p', title: 'P', facets: { track: ['B'] } }] }],
    });
    if (!r.ok) throw new Error('invalid');
    expect(buildModel(r.data).presentations[0].facets.track).toEqual(['A', 'B']);
  });
});
