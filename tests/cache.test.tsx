// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { getConference, getLast, listConferences, removeConference, saveConference } from '../src/lib/cache.ts';
import { readStars } from '../src/lib/stars.ts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const raw = readFileSync(`${process.cwd()}/public/demo.conference.json`);
const demo = JSON.parse(raw.toString('utf8'));

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
};

describe('conference cache (IndexedDB)', () => {
  it('saves, lists, reloads and removes conferences; remembers the last one', async () => {
    await saveConference(demo);
    expect(getLast()).toBe('demo-symposium-2027');
    const other = structuredClone(demo);
    other.conference.id = 'other-2027';
    other.conference.name = 'Other';
    await saveConference(other);
    expect((await listConferences()).map((c) => c.id)).toEqual(['other-2027', 'demo-symposium-2027']);
    expect((await getConference('demo-symposium-2027'))?.data.sessions.length).toBe(demo.sessions.length);
    await removeConference('other-2027');
    expect(getLast()).toBeNull();
    expect((await listConferences()).map((c) => c.id)).toEqual(['demo-symposium-2027']);
  });
});

describe('App', () => {
  it('opens a gzipped file from the start screen, then restores it on reload', async () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    let root = createRoot(el);
    await act(async () => root.render(<App />));
    await flush();
    expect(el.textContent).toMatch(/Drop a conference file here/);

    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([gzipSync(raw)], 'demo.conference.json.gz');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
    expect(el.querySelector('.brand h1')?.textContent).toBe(demo.conference.shortName);

    // star something, "reload"
    await act(async () => el.querySelector<HTMLElement>('.card .card-side .star')!.click());
    act(() => root.unmount());
    root = createRoot(el);
    await act(async () => root.render(<App />));
    await flush();
    expect(el.querySelector('.brand h1')?.textContent).toBe(demo.conference.shortName);
    expect(readStars(demo.conference.id).size).toBe(1);
    act(() => root.unmount());
    el.remove();
  });

  it('shows validation errors with paths instead of a blank screen', async () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<App />));
    await flush();
    const bad = structuredClone(demo);
    bad.sessions[0].start = '2027-03-27T08:30Z';
    delete bad.conference.timezone;
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(bad)], 'bad.json')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
    const issues = [...el.querySelectorAll('.error-box li')].map((li) => li.textContent);
    expect(issues.join('\n')).toMatch(/conference\.timezone/);
    expect(issues.join('\n')).toMatch(/sessions\[0\]\.start/);
    act(() => root.unmount());
    el.remove();
  });
});

describe('Start screen', () => {
  it('sends deep links to the root when no conference is open', async () => {
    localStorage.clear();
    history.replaceState(null, '', '/posters?q=genome');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<App />));
    await flush();
    expect(el.textContent).toMatch(/Drop a conference file here/);
    expect(location.pathname + location.search).toBe('/');
    act(() => root.unmount());
    el.remove();
  });

  it('opens the agent instructions in a modal and closes it with Escape', async () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<App />));
    await flush();
    expect(el.querySelector('a[href$="conference.schema.json"]')).toBeNull();
    // Serve AGENTS.md and the schema from public/ the way the deployed site would.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const name = String(url).split('/').pop()!;
      return new Response(readFileSync(`${process.cwd()}/public/${name}`, 'utf8'));
    }) as typeof fetch;
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (copied = t) }, configurable: true });

    const trigger = [...el.querySelectorAll<HTMLButtonElement>('.start-links .btn-black')].find((b) => b.textContent === 'Create a conference file')!;
    await act(async () => trigger.click());
    await flush();
    expect(el.querySelector('[role="dialog"] pre')?.textContent).toMatch(/^Follow AGENTS\.md to make a Conference Planner file/);
    const copyBtn = [...el.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === 'Copy prompt + AGENTS.md')!;
    expect(copyBtn.disabled).toBe(false);
    await act(async () => copyBtn.click());
    // Self-contained: the prompt, then AGENTS.md (guide + schema) delimited; no placeholder URLs to resolve.
    expect(copied).toMatch(/^Follow AGENTS\.md to make/);
    expect(copied).toContain('<AGENTS.md>\n# Making a conference file');
    expect(copied.trimEnd().endsWith('</AGENTS.md>')).toBe(true);
    expect(copied).toContain('# Making a conference file for Conference Planner');
    expect(copied).toContain('"title": "Conference file (conference-planner/v1)"');
    expect(copied).not.toContain('<planner-url>');
    globalThis.fetch = realFetch;
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
    el.remove();
  });
});
