// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateConference } from '../schema/conference.ts';
import { Planner } from '../src/App.tsx';
import { buildModel, type Model } from '../src/lib/model.ts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function loadModel(path: string): Model {
  let buf = readFileSync(path);
  if (buf[0] === 0x1f) buf = gunzipSync(buf);
  const r = validateConference(JSON.parse(buf.toString('utf8')));
  if (!r.ok) throw new Error(`${path} invalid: ${r.issues.map((i) => i.message).join('; ')}`);
  return buildModel(r.data);
}

const root = `${process.cwd()}/`;
const demo = loadModel(`${root}public/demo.conference.json`);

let container: HTMLDivElement;
let reactRoot: Root;

/** `at` is a path + query, e.g. "/posters?q=x"; defaults to the program root. */
function render(model: Model, at = '/') {
  history.replaceState(null, '', at);
  act(() => reactRoot.render(<Planner model={model} warnings={[]} onClose={() => {}} />));
}
/** Navigate as the browser would (back/forward or a pasted link) and let the app react. */
function go(at: string) {
  act(() => {
    history.replaceState(null, '', at);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}
const $$ = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const click = (el: Element) => act(() => (el as HTMLElement).click());
const text = () => container.textContent ?? '';
const starOf = (el: Element) => el.querySelector<HTMLElement>('.star')!;
const titles = (sel: string) => $$(sel).map((e) => e.textContent);
const button = (sel: string, label: string) => $$(sel).find((b) => b.textContent === label)!;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  reactRoot = createRoot(container);
});
afterEach(() => {
  act(() => reactRoot.unmount());
  container.remove();
});

describe('Program view', () => {
  it('lists every session grouped by day, reference style', () => {
    render(demo);
    expect($$('.card')).toHaveLength(demo.sessions.length);
    expect(titles('.daygroup-h .d')).toEqual(['Saturday, 27 March', 'Sunday, 28 March']);
    expect(titles('.daybar .chip .dn')).toEqual(['27', '28']);
    // A new start time is marked by the card's own (darker) top border, never a separate divider line.
    expect($$('.timedivider')).toHaveLength(0);
    const sat = $$('.daygroup')[0];
    const starts = [...sat.querySelectorAll('.card')].map((c) => c.classList.contains('block-start'));
    expect(starts).toEqual([false, true, true, false, true, true, true, true]); // s1 and s2 share 10:45
    expect(container.querySelector('.brand h1')?.textContent).toBe('Demo 2027');
    expect(container.querySelector('.topbar .switch-conf')?.textContent).toBe('Exit');
  });

  it('stars a session and persists it under the conference id', () => {
    render(demo);
    click(starOf($$('.card .card-side')[0]));
    expect(JSON.parse(localStorage.getItem(`cp:stars:${demo.meta.id}`)!)).toEqual([demo.sessions[0].id]);
    expect(container.querySelector('.star-opt .n')?.textContent).toBe('1');
  });

  it('searches abstracts and opens sessions with matching talks; a click closes it', () => {
    render(demo);
    go('/?q=minimizers');
    expect($$('.card')).toHaveLength(1);
    expect(titles('.pres-title')).toEqual(['Minimizers, revisited']);
    expect(container.querySelector('.subheat')?.textContent).toMatch(/1 of 3 presentations match/);
    click(container.querySelector('.card-row')!);
    expect($$('.pres')).toHaveLength(0);
  });

  it('keeps poster sessions closed during a search but counts matches', () => {
    render(demo, '/?q=pangenome');
    const poster = container.querySelector('.card[data-id="posters-1"]')!;
    expect(poster.classList.contains('open')).toBe(false);
    expect(poster.querySelector('.meta')?.textContent).toMatch(/1 matching poster/);
  });

  it('filters by facet, multiple days, and format, hiding zero-count options', () => {
    render(demo, '/?f_track=Algorithms');
    expect($$('.card').length).toBe(2); // s3 + the poster session (has Algorithms posters)
    go('/?f_track=Algorithms&day=2027-03-28');
    expect($$('.card').length).toBe(1);
    go('/?f_format=Workshop');
    expect(titles('.card .title')).toEqual(['Workshop: Building reproducible pipelines']);
    const roomSec = $$('.side-sec').find((s) => s.querySelector('.side-head span')?.textContent === 'Room')!;
    expect(roomSec.querySelectorAll('.opt')).toHaveLength(1); // only "Lab 1" has matches
  });

  it('expands a talk to show its abstract', () => {
    render(demo);
    click(container.querySelector('.card[data-id="s1"] .card-row')!);
    const more = container.querySelector<HTMLElement>('.card[data-id="s1"] .pres-more')!;
    expect(more.textContent).toBe('Show abstract');
    click(more);
    expect(container.querySelector('.card[data-id="s1"] .pres.exp .pres-abs')?.textContent).toMatch(/fictional abstract/);
  });

  it('expand all / collapse all', () => {
    render(demo);
    click(button('.seg button', 'Expand all'));
    expect($$('.card.open')).toHaveLength(demo.sessions.length);
    click(button('.seg button', 'Collapse all'));
    expect($$('.card.open')).toHaveLength(0);
  });
});

describe('Posters view', () => {
  it('lists posters by number and collects starred ones in My poster picks', () => {
    render(demo, '/posters');
    expect($$('.poster')).toHaveLength(12);
    // opens grouped by the first category, like the reference's "By track"
    expect(titles('.pgroup-h .d')).toEqual(['Algorithms', 'Machine Learning', 'Population Genetics', 'Single-cell & Spatial', 'Tools & Infrastructure']);
    click(button('.pseg button', 'By number'));
    expect($$('.pgroup-h')).toHaveLength(0);
    expect(titles('.poster-board').slice(0, 3)).toEqual(['101', '102', '103']);
    click(starOf($$('.poster')[2]));
    click(starOf($$('.poster')[0]));
    click(container.querySelector('.pnav.star-opt')!);
    expect(titles('.phead-title')).toEqual(['★ My poster picks']);
    expect(titles('.poster-title')).toEqual(['A benchmark of cell-type deconvolution methods across tissues', 'Fast approximate pangenome graph indexing']);
  });

  it('filters by facet chips, groups by facet, and searches across all posters', () => {
    render(demo, '/posters');
    click($$('.ptracks .chip').find((c) => c.textContent?.startsWith('Machine Learning'))!);
    expect($$('.poster')).toHaveLength(3);
    expect(titles('.pgroup-h .d')).toEqual(['Machine Learning']);
    go('/posters?q=attention');
    expect(titles('.phead-title')).toEqual(['All posters']);
    expect($$('.poster')).toHaveLength(1);
  });

  it('expands a poster abstract', () => {
    render(demo, '/posters');
    click(container.querySelector('.poster .poster-main')!);
    expect(container.querySelector('.poster.exp .poster-abs')?.textContent).toMatch(/Abstract/);
  });
});

describe('Calendar', () => {
  it('shows an empty state with nothing starred', () => {
    render(demo, '/calendar');
    expect(text()).toMatch(/Your schedule is empty/);
  });

  it('puts overlapping starred talks side by side and lists them in the sidebar agenda', () => {
    const s1 = demo.sessionById.get('s1')!;
    const s2 = demo.sessionById.get('s2')!;
    localStorage.setItem(`cp:stars:${demo.meta.id}`, JSON.stringify([s1.presentations[0].id, s2.presentations[0].id, 'dinner']));
    render(demo, '/calendar');
    expect($$('.calc-card')).toHaveLength(3);
    expect($$('.cal-cluster').some((c) => c.querySelectorAll('.cal-col2').length === 2)).toBe(true);
    expect($$('.agenda-row')).toHaveLength(3);
    click(starOf($$('.agenda-row')[0]));
    expect($$('.calc-card')).toHaveLength(2);
  });

  it('nests starred untimed talks inside their session card', () => {
    const s3 = demo.sessionById.get('s3')!;
    localStorage.setItem(`cp:stars:${demo.meta.id}`, JSON.stringify([s3.presentations[0].id, s3.presentations[1].id]));
    render(demo, '/calendar');
    expect($$('.calc-card')).toHaveLength(1);
    expect($$('.calc-sub')).toHaveLength(2);
  });

  it('jumps from a calendar card to the open session in the program, clearing filters', () => {
    localStorage.setItem(`cp:stars:${demo.meta.id}`, JSON.stringify(['s3']));
    render(demo, '/calendar?f_track=Machine%20Learning');
    click($$('.calc-card')[0]);
    expect(location.pathname).toBe('/');
    expect(location.search).toMatch(/open=s3/);
    expect(location.search).not.toMatch(/f_track/);
    expect(container.querySelector('.card[data-id="s3"].open')).toBeTruthy();
  });
});

describe('URL routing', () => {
  it('puts the view in the path and filters in the query', () => {
    render(demo);
    click(button('.viewswitch button', 'Posters'));
    expect(location.pathname).toBe('/posters');
    expect(container.querySelector('.phead-title')).toBeTruthy();
    click(button('.viewswitch button', 'Calendar'));
    expect(location.pathname).toBe('/calendar');
    click(button('.viewswitch button', 'Program'));
    expect(location.pathname).toBe('/');
    click($$('.daybar .chip')[1]);
    expect(location.pathname).toBe('/');
    expect(location.search).toBe('?day=2027-03-28');
  });

  it('re-renders on browser navigation (back/forward fire popstate)', () => {
    render(demo);
    click(button('.viewswitch button', 'Posters'));
    expect($$('.poster').length).toBeGreaterThan(0);
    go('/');
    expect($$('.card')).toHaveLength(demo.sessions.length);
  });

  it('treats unknown paths as the program', () => {
    render(demo, '/no/such/page?q=minimizers');
    expect($$('.card')).toHaveLength(1);
  });
});

describe('Suggested categories', () => {
  it('shows suggested facets in violet with a toggle that hides them', () => {
    render(demo);
    const toggle = container.querySelector<HTMLElement>('.suggest-toggle')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const topicSec = $$('.side-sec.sugg');
    expect(topicSec).toHaveLength(1);
    expect(topicSec[0].querySelector('.side-head span')?.textContent).toBe('Topic');
    click(container.querySelector('.card[data-id="s3"] .card-row')!);
    expect(titles('.card[data-id="s3"] .pres-people .sugg')).toContain('Sequence search');

    click(toggle);
    expect(localStorage.getItem('cp:suggested')).toBe('0');
    expect($$('.side-sec.sugg')).toHaveLength(0);
    expect($$('.card[data-id="s3"] .pres-people .sugg')).toHaveLength(0);
    // organizer facets are untouched
    expect($$('.side-sec .side-head span').map((e) => e.textContent)).toContain('Track');
  });

  it('ignores a suggested-facet filter while suggestions are hidden', () => {
    localStorage.setItem('cp:suggested', '0');
    render(demo, '/?f_topic=Human%20evolution');
    expect($$('.card')).toHaveLength(demo.sessions.length);
  });

  it('groups posters under violet section headers when the only category is suggested', () => {
    const topicOnly = { ...demo, facets: demo.facets.filter((f) => f.suggested) };
    render(topicOnly, '/posters');
    const heads = $$('.pgroup-h .d');
    expect(heads.length).toBeGreaterThan(1);
    expect(heads.every((h) => h.classList.contains('sugg'))).toBe(true);
    expect(titles('.pseg button')[0]).toBe('By topic');
  });

  it('hides the toggle when a conference has no suggested categories', () => {
    const plain = { ...demo, facets: demo.facets.filter((f) => !f.suggested), hasSuggested: false };
    render(plain);
    expect(container.querySelector('.suggest-toggle')).toBeNull();
  });
});

// Real-world files (gitignored, present only on the machine that made them).
const realFiles = [`${root}local/ashg-2026.conference.json.gz`, `${root}local/cshl-data-2026/cshl-data-2026.conference.json`].filter(existsSync);

describe.each(realFiles)('real file %s', (path) => {
  const model = loadModel(path);
  it('renders every view without errors', () => {
    const t0 = performance.now();
    render(model);
    expect($$('.card').length).toBe(model.sessions.length);
    go('/?q=genome');
    expect($$('.card').length).toBeGreaterThan(0);
    go('/');
    click(button('.seg button', 'Expand all'));
    if (model.hasPosters) {
      go('/posters');
      expect($$('.poster').length).toBeGreaterThan(0);
    }
    localStorage.setItem(`cp:stars:${model.meta.id}`, JSON.stringify(model.presentations.filter((p) => !p.isPoster).slice(0, 40).map((p) => p.id)));
    act(() => reactRoot.unmount());
    reactRoot = createRoot(container);
    render(model, '/calendar');
    expect($$('.calc-card').length).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(20000);
  });
});
