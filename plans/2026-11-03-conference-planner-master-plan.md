---
date: 2026-11-03
status: complete
model: Claude Opus 5.5
description: Static React planner that loads any scientific conference from a user-supplied JSON (or gzipped JSON) file, with stars kept in the browser and an AGENTS.md for generating conference files
---

# Conference planner: master plan

## Goal

A fast static React app in the style of sashagusev/ashg-2026-planner that works for any scientific conference.

- **The deployed app contains no conference data.** The user opens a single `.conference.json` or `.conference.json.gz` file that describes the whole conference, and the app renders it.
- **Conference files are machine-generated.** Nobody hand-writes them. The deployment ships an `AGENTS.md` plus a JSON Schema, so a user can point a coding agent at a conference's website, API dump or PDF program and get a valid file back.
- **User state is stars only**, kept in the browser. There's no server, accounts, sync, export or calendar download.

## Reference app (sashagusev/ashg-2026-planner @ 1dcf471)

- `index.html` (61 KB, vanilla JS) plus `data.js` (11.8 MB, 3.6 MB gzipped) baked into the deploy.
- ASHG 2026 has 268 sessions and 3,207 nested presentations, 2,757 of them posters with board numbers.
- Track, session type and room are hard-coded as the only facets. Stars live in an un-namespaced `localStorage['ashg_stars']`.

What carries over: the Program, Posters and Calendar views, live facet counts, search across abstracts, and stars on sessions and individual presentations.

## Architecture

```
user opens / drops  *.conference.json  or  *.conference.json.gz
   │ gzip detected by magic bytes (1f 8b) → native DecompressionStream
   ▼
JSON.parse → validate (Zod) → semantic checks → normalize
   │            errors listed in-app as  path: problem
   ▼
normalized Conference ── cached in IndexedDB so reload doesn't re-ask
   │
   ▼
React views  ←→  stars in localStorage, key `cp:stars:<conference.id>`
```

- **Stack:** Vite, React and TypeScript, with Vitest for tests. Libraries:
  - `zod` for the schema, which is also the source of the generated JSON Schema;
  - `@fontsource-variable/inter` and `@fontsource-variable/newsreader`: the reference's fonts, self-hosted so the app works offline at a venue.
- **Built-in, no extra dependency:**
  - search is a term-match over a precomputed, accent-folded haystack per item (about 4 ms per query at ASHG scale);
  - times use `Intl` only: wall-clock strings are displayed and ordered directly, and `Intl` gives "now" in the conference timezone;
  - gzip uses the browser's `DecompressionStream`.
- **Visual design:** ported from the reference `index.html`, including its CSS, layout and interactions, with React components emitting the reference's markup and class names.
- **Deploy:** `npm run build` produces `dist/` for any static host. The deploy holds the app, `conference.schema.json`, `AGENTS.md` and the demo file. It holds no real conference data.
- **Persistence:**
  - Stars go in localStorage, namespaced by conference ID.
  - The last loaded conferences go in IndexedDB, because ASHG-size data (~12 MB) exceeds localStorage's ~5 MB limit. A "Recent conferences" list switches between them, and "Remove" drops one.
  - `navigator.storage.persist()` is requested once.
  - Known limitation: Safari can evict site storage after 7 days without a visit. Re-open the file if that happens; stars are lost in that case, and that's accepted.

## 1. Conference file format (`schema/`)

The schema is **strict and explicit**, because every producer is a script or an agent. Each field has one shape, IDs are required, and every value that looks like a code is a string. That keeps the app's normalizer trivial and the agent instructions unambiguous.

```json
{
  "$schema": "https://<deploy>/conference.schema.json",
  "format": "conference-planner/v1",
  "conference": {
    "id": "ashg-2026",
    "name": "ASHG 2026 Annual Meeting",
    "timezone": "America/Toronto",
    "start": "2026-10-18",
    "end": "2026-10-24",
    "url": "https://www.ashg.org/meeting/2026",
    "location": "Montréal, Canada",
    "source": { "description": "Official program API dump", "retrieved": "2026-09-30" }
  },
  "facets": [
    { "key": "track", "label": "Track" },
    { "key": "type",  "label": "Session type" }
  ],
  "sessions": [
    {
      "id": "plat-12",
      "title": "Statistical methods for rare variants",
      "kind": "talks",
      "start": "2026-10-20T17:00",
      "end": "2026-10-20T18:30",
      "rooms": ["Room 510"],
      "facets": { "track": ["Statistical Genetics"], "type": ["Platform Sessions"] },
      "chairs": [{ "name": "Barbara Fortini" }],
      "description": "Plain text; blank lines separate paragraphs.",
      "url": null,
      "presentations": [
        {
          "id": "abs-1234",
          "title": "Automated interpretation of rare disease genomes",
          "start": "2026-10-20T17:00",
          "end": "2026-10-20T17:18",
          "speakers": [{ "name": "Aashish Adhikari", "affiliation": "Illumina" }],
          "authors": "Aashish Nath Adhikari (Illumina), …",
          "abstract": "…",
          "board": null,
          "facets": { "track": ["AI and Machine Learning Applications"] }
        }
      ]
    }
  ]
}
```

Field rules (enforced by the schema and documented in `AGENTS.md`):

| Field | Rule |
|---|---|
| `format` | Required. Exactly `conference-planner/v1` |
| `conference.id` | Required, a lowercase slug. It namespaces stars, so it has to stay the same across regenerations of one conference |
| `conference.timezone` | Required. An IANA name |
| `start` / `end` (items) | ISO 8601 local wall-clock time `YYYY-MM-DDTHH:mm`, interpreted in `conference.timezone`. No offsets and no `Z`, which gives one representation and no conversion mistakes by producers |
| `sessions[].id`, `presentations[].id` | Required strings, unique across the whole file and stable across regenerations: the source system's ID if one exists, otherwise a deterministic slug of the session code or title. Stars are keyed on these |
| `kind` | Required on sessions. One of `talks`, `posters`, `plenary`, `workshop`, `social`, `break`, `other`. `posters` drives the Posters view |
| `presentations[].start/end` | Optional. Inherited from the session when absent (typical for posters) |
| `board` | Poster board or ID as a string, or null |
| `facets` | Declared once at the top (key, label, display order). Each item maps a key to an **array** of display-label strings. Values aren't pre-declared; the app collects them |
| `speakers`, `chairs` | Arrays of `{ name, affiliation? }` |
| `authors` | Optional free-text author line exactly as the program prints it |
| `description`, `abstract` | Plain text. Blank line = paragraph. No HTML |
| Optional fields | Use `null` or omit. Unknown extra fields are rejected so agent typos surface |

**Semantic checks** go beyond JSON Schema and run in the app and the test suite. Errors: duplicate IDs, `end` before `start`, an unknown facet key, a timezone not found in the IANA database. Warnings: a presentation outside its session's time window, a session with no times, a `posters` session whose items have no `board`, zero sessions.

Deliverables:
- `schema/conference.ts` (Zod schema + semantic checks + normalizer);
- `scripts/generate-schema.ts` → `public/conference.schema.json`;
- `public/demo.conference.json`: small and synthetic, with 2 days, talk, poster and plenary sessions, and a DST-adjacent time. It's the in-app "try the demo" button.

## 2. `AGENTS.md` (`public/AGENTS.md`, served at `/AGENTS.md`)

It's written for a coding agent working on behalf of the user. A user gives their agent: "Read <deploy>/AGENTS.md and make a conference file for <conference> from <source>."

Contents:
1. **Task and output contract:** one UTF-8 JSON file named `<conference-id>.conference.json`. Gzip it (`.json.gz`) if it's over ~5 MB. It must validate against `<deploy>/conference.schema.json`.
2. **Finding the source, in preference order:**
   - the official program's own JSON/API behind its web app (look at the network requests);
   - an export or download the organizers offer;
   - HTML program pages;
   - the PDF program book.
   Capture raw sources to disk first and transform afterwards, so the conversion can be rerun.
3. **Mapping guidance:**
   - what counts as a session and what counts as a presentation;
   - posters (one `posters` session per poster block, each poster a presentation with `board`);
   - choosing facets (use the organizer's own tracks, types and topics; don't invent categories; keep labels verbatim);
   - socials and ancillary events (`kind: social`/`other`, still included);
   - multi-room sessions.
4. **Times:** convert everything to conference-local wall-clock time. Check against a session whose time is known from the printed program, because a UTC offset applied twice is the usual failure.
5. **IDs:** use the source IDs. If there are none, derive deterministic slugs and never random ones, so regenerating the file keeps the user's stars.
6. **Text hygiene:**
   - strip HTML;
   - decode entities;
   - keep abstracts complete, not summarized;
   - never fabricate missing fields (use `null`).
7. **Validation, which is required before handing the file over:**
   - `uvx check-jsonschema --schemafile <deploy>/conference.schema.json <file>` (or `npx ajv-cli` as an alternative);
   - then open it in the planner and fix any semantic errors it lists.
8. **Report back:** item counts by kind, the date range, the facets found, anything skipped or uncertain, and the source used.
9. A short complete example, generated from the demo file so it never drifts from the schema.

A test checks that the example inside `AGENTS.md` validates and that every schema field and session kind is documented. The doc is the format reference, so there's no separate `docs/file-format.md`.

It lives only in `public/`, not the repo root. A root `AGENTS.md` is the convention for instructions to agents working *on* a repo, and this file is instructions for producing conference files.

## 3. App (`src/`)

The layout, typography and interactions follow the reference. Generic data replaces its hard-coded ASHG track, type and room lists.

- **Start screen:**
  - drop zone/file picker (`.json`, `.json.gz`);
  - "Open again" list of cached conferences;
  - "Try the demo conference";
  - a copyable agent prompt pointing at `AGENTS.md`.

  Validation failures show as a readable `path: problem` list.
- **Shell:** sidebar with the serif brand (`conference.shortName` or `name`), a Program / Posters / Calendar switch, and view-specific filters. Top bar with search (`/`) and a count. Below it, a day bar and the list. On phones the sidebar becomes a drawer.
- **Program:**
  - day chips (multi-select, live counts), plus Now / Collapse all / Expand all;
  - sidebar filters with live faceted counts: My Schedule, session type (the file's `type` facet if declared, else `kind`), each declared facet, and room. Zero-count options are hidden.
  - cards grouped by day with time dividers;
  - expanding a card shows tags, the description and presentations, each with a star and "Show abstract";
  - search opens talk sessions that have matching talks and shows only the matches (with "Show all"); poster sessions stay closed and show a match count.
- **Posters:**
  - sidebar: "My poster picks" plus poster sessions by day;
  - header with chips for the first facet posters use;
  - sorting by number, facet, A–Z or presenter;
  - a search covers all posters, grouped by session;
  - picks are listed by day, time and number.
- **Calendar:**
  - starred sessions (with their starred talks nested) and starred talks with their own slot;
  - overlapping clusters laid out side by side;
  - a sidebar agenda;
  - clicking jumps to the item in Program, clearing filters so it's visible.
  - Talks with no own time are nested under their session. Starred posters stay in poster picks; their session shows a picks count.
- **URL hash** holds view, filters, search and selections, so a reload keeps your place.
- **Performance:** no virtualization or Web Worker needed. ASHG parse + validate + model takes about 115 ms in Node. Cards are memoized on their own star state. Search waits for two characters, and long presentation lists show 60 at a time.

## 4. Repo layout

```
schema/        conference.ts (zod schema + semantic checks)
src/           App.tsx, styles.css (ported reference CSS), components/ (Shell, icons, Text, common), views/ (Start, Program, Posters, Calendar),
               lib/ (model, schedule, time, load, cache, stars, hash)
public/        AGENTS.md, demo.conference.json, conference.schema.json (generated)
scripts/       generate-schema.ts, validate.ts, convert-ashg.ts, convert_cshl_abstract_book.py
tests/         schema, time, model + calendar entries, load (gzip), IndexedDB cache + App flow, AGENTS.md, view rendering (happy-dom) incl. real files
.github/       workflows/deploy.yml (GitHub Pages; runs only on push)
local/         gitignored: real conference files and sources
plans/
```

`scripts/convert-ashg.ts` doubles as a worked example of what `AGENTS.md` asks agents to do, so writing it tests whether the instructions hold up on a real 3k-item meeting.

## 5. Execution

### First target: CSHL Biological Data Science 2026 (Nov 4–7, 2026)

The first real use is CSHL Biological Data Science, which opens Wed Nov 4 at 7:30 pm and ends with lunch Sat Nov 7. The public meeting page ([meetings.cshl.edu, meet=DATA&year=26](https://meetings.cshl.edu/meetings.aspx?meet=DATA&year=26)) has no schedule, talks or posters: the program sits behind the attendee-only Abstracts tab or comes as the attendee program PDF. That means:

- **The source is the user's attendee program/abstract book**, saved into `local/cshl-data-2026/source/`. The conversion is a by-hand run of the `AGENTS.md` procedure: PDF → `local/cshl-data-2026.conference.json` → `check-jsonschema` → load in the app.
- **The meeting is small** (a CSHL meeting is roughly 8–10 oral sessions plus 2–3 poster sessions), so gzip, virtualization and Web Worker parsing don't matter for this first target.
- **Phone use at the meeting needs a deploy** (e.g. GitHub Pages from this repo), and that requires a push, which is the user's call. Before that, the app can be reached from a phone on the same network via the user's own `npm run dev -- --host`.
- DST ended Nov 1, 2026, so meeting times are all EST (UTC−5).

Order for this week (it supersedes the general order below where they conflict):
1. Scaffold, schema, loader (JSON + gzip), stars store, Program + Posters + Calendar views, demo file.
2. CSHL conference file from the attendee program, then a user check in the browser.
3. `AGENTS.md` written from what the CSHL conversion actually needed.
4. `scripts/convert-ashg.ts` scale test (done the same night; it showed no virtualization or worker was needed).

### General order

One agent, sequentially:

1. `git init`, Vite + React + TS + Vitest scaffold, `.gitignore` (including `local/`).
2. Zod schema, semantic checks and normalizer, then generate the JSON Schema, the demo file and tests.
3. Loader (JSON / gzip), IndexedDB cache, stars store, with tests.
4. Views: start screen, Program, Posters, Calendar.
5. `scripts/convert-ashg.ts`: run it on a local clone of the reference repo, gzip the output into `local/`, and record the file sizes and parse time.
6. `AGENTS.md`, informed by step 5, with its example test. Then the README (run/build/deploy).
7. `npm run typecheck && npm test && npm run build` green, `check-jsonschema` passing on the demo and ASHG files, then `/code-review`.

No dev server or browser automation is run by the agent. The user checks the app with `npm run dev`.

## Decisions & ownership

| Decision | Tag | Note |
|---|---|---|
| React SPA, no server, no conference data in the deploy | user-owned, surfaced | Decided by the user |
| Stars only, in-browser, no export/sync/calendar download | user-owned, surfaced | Decided by the user. Cleared or evicted storage loses stars |
| JSON only, optionally gzipped | user-owned, surfaced | Decided by the user. Gzip via native `DecompressionStream`, detected by magic bytes rather than extension |
| `AGENTS.md` served with the deploy as the format reference | user-owned, surfaced | Decided by the user |
| Strict schema: required IDs, one shape per field, no unknown fields | AI-owned, defended | Producers are machines, so strictness turns agent mistakes into validation errors instead of silent misrendering |
| Times as local wall-clock + IANA timezone, offsets disallowed | AI-owned, defended | One representation, and it matches how printed programs state times. Producers convert once |
| Unknown fields rejected (not ignored) | AI-owned, default | Catches typos like `abstarct`. Cost: no room for producer-specific extras. An `extra` object could be allowed later |
| Uploaded conference cached in IndexedDB between visits | AI-owned, defended | Otherwise every reload asks for the file. It's local and removable |
| `convert-ashg.ts` + ASHG file kept in gitignored `local/` | AI-owned, default | Real-scale test, without republishing ASHG abstracts |
| Validation command in `AGENTS.md` uses `uvx check-jsonschema` | AI-owned, default | Runs anywhere with uv and needs no project setup. `ajv-cli` listed as the alternative |
| Single-agent execution | AI-owned, defended | The core was built by one agent. Once the user asked for full fidelity overnight, two background agents ran in parallel: the CSHL PDF converter and an independent bug review |
| Copy the reference's visual design (CSS, markup, interactions) | user-owned, surfaced | The user's direction after seeing the first UI. The reference CSS is ported nearly verbatim |
| Self-hosted fonts instead of Google Fonts | AI-owned, defended | Works offline at the venue and makes no third-party request |
| Calendar nests time-less talks under their session | AI-owned, defended | Programs like CSHL's list talks without slots. The reference would show each talk spanning the whole session, all as overlaps |
| Poster picks stay out of the calendar (session shows a picks count) | AI-owned, default | Follows the reference, which keeps posters in My poster picks |
| `conference.shortName` added to the schema | AI-owned, default | Additive optional field. Long meeting names wrap badly in the sidebar heading |

## What this changes elsewhere

- **No data in the deploy → the deploy is useless without a file.** The demo button and `AGENTS.md` are the onboarding.
- **Stars keyed by item ID → whether stars survive a regenerated file depends on the agent keeping IDs stable.** That's why `AGENTS.md` makes deterministic IDs a hard rule, and why `conference.id` must never change between versions.
- **The schema URL is embedded in conference files and `AGENTS.md` → the deploy URL is part of the contract.** Moving the deploy breaks `$schema` links in old files. They still load, because the app doesn't fetch `$schema`. `format: conference-planner/v1` is the actual version marker, and any v2 must stay loadable alongside it.
- **Strict schema → schema changes are breaking for existing files.** Additive optional fields are fine within v1. Anything else means v2 plus app support for both.
- **IndexedDB cache → a stale copy.** Loading a newer file with the same `conference.id` replaces it, and the stars carry over.

## Implementation log (2026-11-03 → 11-04)

- **Built:** schema + semantic checks, loader (JSON/gzip), IndexedDB cache with a localStorage summary index, per-conference stars, URL-hash state, the three views, start screen, demo file, JSON Schema generation, CLI validator, GitHub Pages workflow and README.
- **First UI didn't look like the reference:** it was an original Linear-ish design with a top tab bar and a timeline calendar. The user flagged it, and the UI was rebuilt on the reference's own CSS and markup: sidebar brand and view switch, serif day chips, cards with chevrons, poster rows, and the clustered calendar with a sidebar agenda. Quick Look snapshots of static renders were compared against the reference.
- **CSHL Biological Data Science 2026:** `scripts/convert_cshl_abstract_book.py` (pdfplumber; uv inline script) turns the attendee abstract book into `local/cshl-data-2026/cshl-data-2026.conference.json` (+ `.gz`). It has 13 sessions and 207 presentations. All 204 abstract numbers are present once, and the presenter was found from underline rects for every entry. Cross-checked against the abstract pages: 203 of 204 presenters agree; #169 differs only by diacritics.
- **ASHG scale test:** `scripts/convert-ashg.ts` produces 268 sessions and 3,207 presentations, 11 MB of JSON (3.5 MB gzipped). Parse + validate + model takes about 115 ms in Node.
- **Independent review:** 17 findings. Fixed:
  - a presentation's facets now add to its session's instead of replacing them;
  - the time patterns reject `24:00` and impossible dates in JSON Schema too;
  - the calendar no longer adds a minimum length when checking overlaps, and talks after midnight stay on their session's day;
  - jumping from the calendar clears program filters;
  - the room filter includes presentation rooms;
  - "Now" picks the right session;
  - the cache index avoids deserializing every cached file;
  - one shared collator for sorting;
  - `history.replaceState` is guarded;
  - phone CSS: 16 px input to stop iOS zoom, larger star tap targets, `100dvh` sidebar, poster sort visible;
  - the search render cap is back, with memoized cards;
  - warnings for talks running past their session and for timezone abbreviations;
  - the CLI validator strips a BOM.

  Not changed: `|` as the hash separator for multi-select values, since no data contains it.
- **AGENTS.md** was extended from the CSHL conversion with guidance on PDF structure, keynote titling, unlisted talks, line breaks vs paragraphs, affiliation numbering, no `24:00`, and spelling disagreements.
- **Verification:** 47 tests pass (including full renders of the CSHL and ASHG files); `tsc -b` and `vite build` are clean; `check-jsonschema` and `scripts/validate.ts` pass on the demo, CSHL and ASHG files. Nothing has been committed or pushed.

## Implementation log, continued (2026-11-04)

- **Start screen:**
  - black "Try demo" / "Create a conference file" buttons;
  - the agent instructions moved into a modal that copies or downloads a self-contained `AGENTS.md` (guide + JSON Schema appended), so agents never need to reach the deployed site;
  - `public/.nojekyll` for branch-based GitHub Pages deploys;
  - lucide icons (trash, close, door).
- **Top bar:** "Exit" (lucide `DoorOpen`) replaces the session count. A "Suggested topics" switch appears only when the file has suggested categories.
- **Suggested categories:**
  - facets take `source: "organizer" | "suggested"`;
  - suggested ones render in muted violet (`#6e5bb5`): sidebar group, labels, chips, section headers, topic line on talks;
  - the switch (remembered per browser) hides them and ignores their filters.
  - `scripts/export-items.ts` and `scripts/apply-suggestions.ts` move categories in and out of a conference file.
- **Prompt tuning:** blind agents categorized ASHG abstracts with the real tracks hidden, across 10 prompt variants plus replicates on a second sample (`scripts/suggest-eval/README.md`). The winner (v8, 0.574 / 0.570) is quoted in `AGENTS.md`. Applied to CSHL: 13 topics over 207 presentations.
- **Heading length:** `AGENTS.md` sets a 32-character guideline for the sidebar heading, with a matching warning in validation.
- **Layout fixes:**
  - removed the reference's custom WebKit scrollbar (it forced a classic scrollbar that left a gap beside the top bar);
  - wide-window section lines fade out where they end in open space;
  - the gap before a time divider belongs to the card above, so hover reaches the line;
  - Posters default to grouping by category;
  - sidebar labels get hover tooltips;
  - black Safari `theme-color`.
