# Making a conference file for Conference Planner

You are an agent turning a scientific conference program into one JSON file that Conference Planner can open. The user will open the file in the planner in their browser. The planner holds no conference data of its own: what you produce is everything it knows about the meeting.

The format is defined by a JSON Schema, `conference.schema.json`. If these instructions were pasted or attached, the schema is appended at the end: save it to a local file named `conference.schema.json`. If you were given a link to this file, the schema sits next to it at the same address. This document explains how to fill the format in well.

## Deliverable

- One UTF-8 JSON file named `<conference-id>.conference.json`, e.g. `cshl-data-2026.conference.json`.
- If it is larger than about 5 MB, also produce a gzipped copy (`<conference-id>.conference.json.gz`). The planner opens either.
- It must pass validation (see [Validate](#validate)) before you hand it over.
- Keep the raw source material you downloaded and the script you wrote to do the conversion, so the file can be regenerated when the program changes. Write a script rather than typing JSON by hand, even for a small meeting.

## Where to get the program

Prefer sources in this order, and say in your report which one you used:

1. **The program's own data behind its web app or scheduler.** Many conference apps (Cvent, Oxford Abstracts, Pathable, Whova, Sched, floq, pretalx, Confex) load the program as JSON from an API. Look at the network requests the page makes. This is usually the most complete and accurate source, with IDs, times, rooms and abstracts already structured.
2. **An official export or download**: a CSV, a spreadsheet or an iCal feed offered by the organizers.
3. **The HTML program pages.**
4. **The PDF program or abstract book.** Use a PDF library that gives you fonts and positions (for example pdfplumber), not just plain text. Bold titles, underlined presenters and spacing between blocks carry structure that plain text loses:
   - An underlined presenter is usually a thin drawn rectangle or line just under the name, not a font property.
   - Vertical gaps separate the title, author, affiliation and body blocks.
   - Page footers often carry the abstract number.
   - Cross-check the program listing against the abstract pages (same number → same title and presenter) and report any disagreements.

Save raw sources to disk first, then transform them, so reruns don't need the network. Only use material the user has access to. Many abstract books are given only to attendees, and the user decides what to do with the result.

## The shape

```
{ format, conference, facets?, sessions: [ { …, presentations?: [ … ] } ] }
```

- A **session** is a block of time on the program: a talk session, a keynote, a poster session, a workshop, a social or a meal break.
- A **presentation** is one talk or one poster inside a session.
- Everything in the program goes in, including socials, keynotes and sessions without a list. For a slot like "Lightning talks" whose talks aren't listed, use `kind: "talks"` with no `presentations`. Leave out what isn't on the program, such as generic daily meal times, unless the program lists them as events.
- **Keynotes:** a session with `kind: "keynote"` holding one presentation (the talk title and speaker). If the program only says "Keynote Speaker", title the session `Keynote: <speaker name>` so that several keynotes can be told apart.

### `conference`

| field | required | notes |
|---|---|---|
| `id` | yes | Lowercase slug, e.g. `ashg-2026`. **Stars are stored under it.** Never change it between versions of the same conference |
| `name` | yes | As the organizers write it, e.g. "Biological Data Science 2026" |
| `shortName` | no | Short form for the planner's sidebar heading, e.g. "ASHG 2026", "CSHL Data 2026". Defaults to `name`. The heading is large and wraps at roughly 15 characters per line, so keep it to **32 characters or fewer** (about three lines; exact wrapping depends on the browser). If `name` is longer than 32 characters, set a `shortName` |
| `timezone` | yes | IANA name of where the meeting happens, e.g. `America/New_York`, `Europe/Berlin` |
| `start`, `end` | no | `YYYY-MM-DD` |
| `location`, `url`, `description` | no | `description` is a good place for organizers, a code of conduct link, etc. |
| `source` | no | `{ "description": "what you converted from", "retrieved": "YYYY-MM-DD" }` |

### `sessions[]`

| field | required | notes |
|---|---|---|
| `id` | yes | Stable string (see [IDs](#ids-the-rule-that-matters-most)) |
| `title` | yes | e.g. "Machine Learning". Don't repeat the session number here; it goes in `code` |
| `kind` | yes | One of `talks`, `posters`, `keynote`, `plenary`, `workshop`, `social`, `break`, `other`. `posters` turns on the planner's Posters view |
| `start` | yes | Local time, see [Times](#times) |
| `end` | no | Omit only if the program gives no end time (e.g. "5:00 pm Wine and Cheese Party") |
| `code` | no | Session number as printed, e.g. "Session 3", "PS-12" |
| `rooms` | no | Array of room names as printed. Omit if the program doesn't say |
| `chairs` | no | Array of people (`{ "name", "affiliation"? }`): chairs, moderators |
| `description` | no | Plain text |
| `facets` | no | See [Facets](#facets) |
| `url` | no | Link to the session on the official site |
| `presentations` | no | Talks or posters in this session |

### `sessions[].presentations[]`

| field | required | notes |
|---|---|---|
| `id` | yes | Stable string, unique across the **whole file** |
| `title` | yes | As printed. Keep the organizers' capitalization |
| `start`, `end` | no | Only if this talk has its own time slot. Omit both and it inherits the session's times (typical for posters, and for programs that list talks without times; the planner then lists them under their session rather than inventing slots). If you give `start`, give `end` too when known. Never guess per-talk times by dividing up a session |
| `speakers` | no | The presenting author(s) or speaker(s), as people. If the program marks the presenter (underlined, bold, asterisk, "Presenter:"), use exactly that person |
| `authors` | no | The full author line as one string, as printed, e.g. "A. Smith, B. Jones, C. Lee" |
| `affiliations` | no | Full affiliation text as one string. Keep the source's numbering if it has one, e.g. "1 Johns Hopkins University, Baltimore, MD; 2 …" |
| `abstract` | no | Full text, not a summary |
| `code` | no | Abstract or program number as printed, e.g. "42", "PgmNr 1234" |
| `board` | no | Poster board number, only if it is different from `code` |
| `rooms` | no | Only if different from the session's rooms |
| `facets` | no | Adds to the session's facets |
| `url` | no | |

## Times

- Every time is **local wall-clock time at the venue**, written `YYYY-MM-DDTHH:mm` (24-hour, no seconds), and read in `conference.timezone`. Example: a talk at 7:30 pm in Cold Spring Harbor is `"2026-11-04T19:30"` with timezone `America/New_York`.
- **No offsets and no `Z`.** If your source gives UTC or offset timestamps (most APIs do), convert them to local time in the conference timezone with a real timezone library. Don't apply a fixed offset by hand, because meetings can straddle a DST change.
- **Check one known time.** After converting, find one session whose time you can see in the printed or web program and confirm your file has the same local time. Applying an offset twice, or not at all, is the most common mistake.
- If a time runs past midnight, use the next day's date for `end`. Never write `24:00`; midnight is `00:00` on the next day.

## IDs: the rule that matters most

Users star sessions and presentations, and stars are saved under the item `id`. When the program changes and the file is regenerated, every item whose `id` is unchanged keeps its star.

- Use the **source's own IDs** when it has them: API object IDs, abstract numbers, session codes. Prefix them if needed to make them unique, e.g. `a42` for abstract 42, `s3` for session 3.
- If the source has no IDs, derive them **deterministically** from what won't change: an abstract number, a session code, or a slug of the title (`keynote-karen-miga`). Never use random IDs, never use list positions that shift when an item is added, and don't build IDs from times or rooms, because reschedules would drop stars.
- IDs must be unique across the whole file. Sessions and presentations share one namespace.

## Facets

Facets are the program's own filterable categories: tracks, topics, session types, levels. Declare each one once at the top, in the order the filters should appear:

```json
"facets": [ { "key": "track", "label": "Track" }, { "key": "type", "label": "Session type" } ]
```

Then tag items with display labels, always as arrays: `"facets": { "track": ["Statistical Genetics", "Cancer Genetics"] }`. A presentation's facets add to its session's.

- Use the organizers' categories and labels **verbatim**. Never mix inferred categories into an organizer facet.
- If the program has no categories, omit `facets` entirely (or add suggested ones, below, only if the user asks). Day, type, room and search still work.
- `kind` already says talk vs. poster vs. social. Use a `type` facet only for the organizers' finer session types (e.g. "Platform Sessions", "Featured Symposia").
- Every facet has an optional `source`: `"organizer"` (the default) or `"suggested"`. The planner shows suggested facets in a different color and lets the user hide them.

## Suggested categories (only when the user asks)

If the user asks for categories the program doesn't provide, add **one** suggested facet, declared after any organizer facets:

```json
{ "key": "topic", "label": "Topic", "source": "suggested" }
```

and tag presentations with it (`"facets": { "topic": ["…", "…"] }`). Build it by reading, not with keyword rules or clustering code, following these instructions. They were tuned by having blind agents categorize real conference abstracts with the organizers' tracks hidden, and keeping the wording whose categories came closest to the real ones:

> Design the track list that this meeting's abstract submission form would have offered, then pick tracks as the authors would have.
>
> 1. Read every presentation (title and abstract).
> 2. Write the submission form's track dropdown: 10–13 tracks (fewer for a small meeting: aim for each track to hold at least 4% of presentations). Authors choose their own tracks when submitting, so each track must be broad enough that most authors in that area pick it confidently, named in the field's standard vocabulary, and recognisable at a glance. A good list is mostly approach tracks (the kind of work: computational, statistical, functional/experimental, machine learning, clinical translation and implementation, population and public health, ethics and policy…), plus a few application tracks.
>    - Application tracks follow how the field itself divides its subject, at the coarsest level it uses (for example broad classes of disease or organism), not by organ system, specialty or individual condition. Work on a specific condition goes under its broad class and its approach track.
>    - Most fields have a broad translational track (bringing findings into practice) and a population-level health track. Include them when the program has that work: authors use them as second choices.
>    - Avoid narrow tracks for a single technology, assay or molecular layer: authors doing that work would pick the broad track instead.
> 3. For each presentation, choose the tracks its authors would most likely have ticked: the one that describes the work best, plus others that clearly also apply (a method paper about a disease ticks both). Authors tend to tick more than one when they can: aim for about 1.5–2 tracks per presentation on average, never more than four.
> 4. Check the result: count presentations per track. A track under 4% is too narrow (merge it into the broad track its authors would otherwise pick); a track over a third is probably two tracks. Revise once if needed.

- Read every abstract in full.
- Tag presentations only, not sessions: a session's topics are the union of its talks'.
- Keep labels short enough for a filter list (two to six words). The organizers' own session titles are not tracks; don't copy them.
- In your report, list the tracks with their counts and note that they are suggestions.

## Text

- Plain text only: strip HTML tags, decode entities (`&amp;` → `&`), and drop footnote or superscript markers that are just affiliation numbers.
- Paragraphs are separated by a blank line (`\n\n`). A single `\n` is a line break within a paragraph: use it for list items, reference lines, or "Web: <url>" lines that the source sets on their own lines. Join lines that only wrapped because of page width with a space. With PDFs, rejoin hyphenated line breaks only when they are clearly word breaks ("inter-\nesting" → "interesting"), and keep real hyphens ("genome-wide").
- Keep Unicode as is (é, —, ’, Greek letters). Don't transliterate. Superscripts in text (10⁻⁵) can use Unicode superscript characters. There is no italic or bold, so keep any literal `*` the authors typed.
- If the program and the abstract page spell a name differently, use the program's spelling and mention it in your report.
- **Never invent anything.** If a field isn't in the source, leave it out. Don't fill gaps with guesses. `null` and omission both mean "unknown".

## Strictness

The schema rejects unknown fields, so a typo like `abstarct` is an error, not a silently missing abstract. Codes, board numbers and IDs are always strings (`"42"`, not `42`). Optional fields can be omitted or `null`.

## Validate

Both checks are required.

1. **Schema:**
   ```sh
   uvx check-jsonschema --schemafile conference.schema.json <file>.conference.json
   ```
   (or `npx ajv-cli validate --spec=draft2020 -s conference.schema.json -d <file>`), using the local copy of the schema.
2. **Semantic checks:** the planner also checks things a JSON Schema can't express, and lists any problem when the user opens the file:
   - errors: duplicate IDs, an `end` before its `start`, a facet key used but not declared, an unknown timezone;
   - warnings: a talk timed outside its session or running past its end, a poster session with no posters, a timezone abbreviation like "EST" instead of an IANA name, a sidebar heading (`shortName`, or `name` without one) over 32 characters.

   Check these yourself in your script: IDs unique across sessions and presentations, `end >= start`, every facet key declared, and the timezone valid.

Then sanity-check the result against the source:
- counts per session match the printed program;
- every abstract number appears once;
- the first and last item of each day are where the program says;
- spot-check five random presentations (title, presenter, start of the abstract) against the source.

## Report back to the user

- Source used and date retrieved.
- Counts: sessions by kind, presentations, posters, days, date range.
- Facets found, with their values.
- What was missing from the source (no rooms, no per-talk times, no board numbers…).
- Anything skipped, uncertain or fixed up by hand, item by item.
- The commands to regenerate the file.

## Complete minimal example

```json
{
  "format": "conference-planner/v1",
  "conference": {
    "id": "example-meeting-2027",
    "name": "Example Meeting 2027",
    "timezone": "America/New_York",
    "start": "2027-05-10",
    "end": "2027-05-11",
    "location": "Example Hall, Boston, MA",
    "source": { "description": "Official program PDF", "retrieved": "2027-04-20" }
  },
  "facets": [{ "key": "track", "label": "Track" }],
  "sessions": [
    {
      "id": "s1",
      "code": "Session 1",
      "title": "Statistical Genetics",
      "kind": "talks",
      "start": "2027-05-10T09:00",
      "end": "2027-05-10T10:30",
      "rooms": ["Auditorium"],
      "chairs": [{ "name": "Jane Chair", "affiliation": "Example University" }],
      "facets": { "track": ["Statistical Genetics"] },
      "presentations": [
        {
          "id": "a1",
          "code": "1",
          "title": "Fine-mapping across ancestries",
          "start": "2027-05-10T09:00",
          "end": "2027-05-10T09:20",
          "speakers": [{ "name": "Sam Speaker", "affiliation": "Example Institute" }],
          "authors": "Sam Speaker, Pat Coauthor, Jane Chair",
          "abstract": "First paragraph.\n\nSecond paragraph."
        }
      ]
    },
    {
      "id": "posters-1",
      "title": "Poster Session I",
      "kind": "posters",
      "start": "2027-05-10T17:00",
      "end": "2027-05-10T19:00",
      "presentations": [
        { "id": "a2", "code": "2", "title": "A poster title", "speakers": [{ "name": "Lee Poster" }], "abstract": "…" }
      ]
    },
    {
      "id": "social-reception",
      "title": "Welcome reception",
      "kind": "social",
      "start": "2027-05-10T19:00"
    }
  ]
}
```
