# Conference Planner

A static planner for scientific conferences, with the look and behaviour of [sashagusev/ashg-2026-planner](https://github.com/sashagusev/ashg-2026-planner) but no conference baked in. Open a conference file (`.conference.json` or `.conference.json.gz`) and you get:

- **Program**: sessions by day, with filters (days, session type, the conference's own facets such as tracks, rooms) and live counts. Search covers titles, people and abstracts. Expand a session for its talks and their abstracts, and star sessions or individual talks.
- **Posters**: pick a poster session; filter by facet chips; sort by number, facet, title or presenter; search across all posters; star posters into **My poster picks** (in visiting order).
- **Calendar**: everything starred, by day, with overlapping items side by side. Talks the program lists without their own times are nested under their session. Click an item to jump to it in the program.

The deployed app contains no conference data. The file you open is cached in your browser (IndexedDB) so a reload doesn't ask for it again, and stars are kept in `localStorage` under `cp:stars:<conference id>`. Nothing is sent anywhere.

## Run

```sh
npm install
npm run dev            # then open the printed URL; "Try the demo conference" loads public/demo.conference.json
npm run dev -- --host  # same, reachable from a phone on the same network
```

## Build, test, deploy

```sh
npm test               # vitest: schema, times, model, schedule layout, loading, IndexedDB cache, view rendering
npm run typecheck
npm run build          # regenerates public/conference.schema.json, then builds dist/
```

`dist/` is a plain static site with relative paths, so it can be hosted anywhere. Pushing to `main` on GitHub deploys it with `.github/workflows/deploy.yml` (enable Pages → Source: GitHub Actions in the repo settings). The deploy serves `AGENTS.md`, `conference.schema.json` and the demo file alongside the app.

## Conference files

- `schema/conference.ts`: the format, as a Zod schema plus the semantic checks (unique IDs, end ≥ start, declared facets, valid timezone). It is the single source of truth.
- `public/conference.schema.json`: generated JSON Schema (`npm run schema`).
- `public/AGENTS.md`: instructions for a coding agent that produces a conference file from a program website, API or PDF. "Add your conference" on the start screen copies it, with the JSON Schema appended, as one self-contained block to paste to an agent, so the agent never needs to reach the deployed site. It lives in `public/`, not the repo root, so that agents working *on this repo* don't mistake it for repo instructions.
- `npm run validate -- <file>`: the same checks the app runs, from the command line.

Converters kept here:

- `scripts/convert_cshl_abstract_book.py`: a CSHL meeting abstract book PDF → conference file.
  `uv run scripts/convert_cshl_abstract_book.py <book.pdf> --out <id>.conference.json`
- `scripts/convert-ashg.ts`: the ASHG 2026 data from sashagusev/ashg-2026-planner, used as a full-size test (268 sessions, 3,207 presentations, 3.5 MB gzipped).
  `npx tsx scripts/convert-ashg.ts <data.js> local/ashg-2026.conference.json.gz`

Real conference files and their sources go in `local/` (gitignored). The view tests also render any real files found there.
