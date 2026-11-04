import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConference, type ConferenceFile } from '../schema/conference.ts';

const demo = (): ConferenceFile => JSON.parse(readFileSync(new URL('../public/demo.conference.json', import.meta.url), 'utf8'));
const errors = (v: unknown) => {
  const r = validateConference(v);
  return r.issues.filter((i) => i.level === 'error').map((i) => `${i.path}: ${i.message}`);
};

describe('conference schema', () => {
  it('accepts the demo file without errors or warnings', () => {
    const r = validateConference(demo());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('accepts a minimal file', () => {
    const r = validateConference({
      format: 'conference-planner/v1',
      conference: { id: 'x', name: 'X', timezone: 'UTC' },
      sessions: [{ id: 's', title: 'S', kind: 'talks', start: '2026-01-01T09:00' }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown fields with a path', () => {
    const d = demo() as any;
    d.sessions[1].presentations[0].abstarct = 'typo';
    expect(errors(d).join('\n')).toMatch(/sessions\[1\]\.presentations\[0\].*abstarct/);
  });

  it('rejects offsets, Z, and impossible dates', () => {
    for (const start of ['2026-01-01T09:00Z', '2026-01-01T09:00-05:00', '2026-01-01 09:00', '2026-02-30T09:00', '2026-01-01T25:00']) {
      const d = demo() as any;
      d.sessions[0].start = start;
      expect(errors(d).length, start).toBeGreaterThan(0);
    }
  });

  it('requires string codes and boards', () => {
    const d = demo() as any;
    d.sessions[6].presentations[0].board = 101;
    expect(errors(d).join()).toMatch(/board/);
  });

  it('reports duplicate ids across sessions and presentations', () => {
    const d = demo() as any;
    d.sessions[2].presentations[0].id = 's1';
    expect(errors(d).join()).toMatch(/duplicate id "s1"/);
  });

  it('reports undeclared facet keys, bad timezones, end before start', () => {
    const d = demo() as any;
    d.sessions[2].facets.region = ['x'];
    d.conference.timezone = 'Mars/Olympus';
    d.sessions[0].end = '2027-03-27T08:00';
    const e = errors(d).join('\n');
    expect(e).toMatch(/facet "region" is not declared/);
    expect(e).toMatch(/unknown IANA timezone/);
    expect(e).toMatch(/before it starts/);
  });

  it('warns (but loads) when a talk is outside its session window', () => {
    const d = demo() as any;
    d.sessions[2].presentations[0].start = '2027-03-27T09:00';
    const r = validateConference(d);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.message).join()).toMatch(/outside its session/);
  });

  it('warns when the sidebar heading would run past about three lines', () => {
    const d = demo() as any;
    delete d.conference.shortName;
    d.conference.name = 'International Symposium on Very Long Conference Names 2027';
    let r = validateConference(d);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => `${i.path}: ${i.message}`).join()).toMatch(/conference\.name: .*Add a shorter conference\.shortName/);
    d.conference.shortName = 'Long Names 2027';
    r = validateConference(d);
    expect(r.issues).toEqual([]);
  });

  it('rejects a wrong format marker and slug ids', () => {
    const d = demo() as any;
    d.format = 'conference-planner/v2';
    d.conference.id = 'Demo Conf';
    const e = errors(d).join('\n');
    expect(e).toMatch(/^format:/m);
    expect(e).toMatch(/conference\.id/);
  });
});
