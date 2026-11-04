import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { flashEl, joinSet, Opt, SideGroup, splitSet, toggled, type ViewProps } from '../components/common.tsx';
import { Chev, StarButton } from '../components/icons.tsx';
import { Shell } from '../components/Shell.tsx';
import { BodyBlock, joinSep, Paragraphs } from '../components/Text.tsx';
import { KIND_LABELS, makeMatcher, type Model, type Person, type Presentation, type Session } from '../lib/model.ts';
import { scheduleCount } from '../lib/schedule.ts';
import { dayLabel, dayNumber, formatDuration, formatRange, formatTime, longDate, nowInZone, weekdayShort } from '../lib/time.ts';

type Dim = 'day' | 'kind' | 'room' | `f:${string}`;

/** The session-type label shown on cards: the organizer's own "type" facet if there is one, else our kind. */
export function typeLabel(model: Model, s: Session) {
  const t = model.facets.some((f) => f.key === 'type') ? s.facets.type?.[0] : undefined;
  return t ?? KIND_LABELS[s.kind];
}

export function ProgramView(props: ViewProps) {
  const { model, stars, url, setUrl } = props;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Per-card open/closed choices; anything not in here follows expand-all / auto-open rules.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map(url.open ? [[url.open, true]] : []));
  const [expandAll, setExpandAll] = useState(false);
  const q = url.q ?? '';
  const dq = useDeferredValue(q);
  const days = splitSet(url.day);
  const kinds = splitSet(url.kind);
  const rooms = splitSet(url.room);
  const starredOnly = url.starred === '1';
  const facetSel = Object.fromEntries(model.facets.map((f) => [f.key, splitSet(url[`f_${f.key}`])]));
  const hasTypeFacet = model.facets.some((f) => f.key === 'type');

  // Union of session-level and presentation-level facet values, per session.
  const sessionFacets = useMemo(() => {
    const m = new Map<string, Record<string, Set<string>>>();
    for (const s of model.sessions) {
      const acc: Record<string, Set<string>> = {};
      const add = (fv: Record<string, string[]>) => {
        for (const [k, vs] of Object.entries(fv)) for (const v of vs) (acc[k] ??= new Set()).add(v);
      };
      add(s.facets);
      s.presentations.forEach((p) => add(p.facets));
      m.set(s.id, acc);
    }
    return m;
  }, [model]);

  const matcher = useMemo(() => makeMatcher(dq), [dq]);
  const matchInfo = useMemo(() => {
    const info = new Map<string, Set<string>>();
    if (!matcher) return info;
    for (const s of model.sessions) {
      const presIds = new Set(s.presentations.filter((p) => matcher(p.search)).map((p) => p.id));
      if (presIds.size || matcher(s.search)) info.set(s.id, presIds);
    }
    return info;
  }, [matcher, model]);

  useEffect(() => {
    // A new query re-opens sessions whose talks match, even if they were closed for the last query.
    setOverrides((o) => new Map([...o].filter(([, v]) => v)));
  }, [dq]);

  // Like the reference, a starred poster doesn't put its poster session in My Schedule (it goes to poster picks).
  const hasStarredTalk = (s: Session) => s.presentations.some((p) => !p.isPoster && stars.stars.has(p.id));
  const passes = (s: Session, except?: Dim) => {
    if (matcher && !matchInfo.has(s.id)) return false;
    if (starredOnly && !stars.stars.has(s.id) && !hasStarredTalk(s)) return false;
    if (except !== 'day' && days.size && !days.has(s.day)) return false;
    if (except !== 'kind' && kinds.size && !kinds.has(s.kind)) return false;
    if (except !== 'room' && rooms.size && !s.allRooms.some((r) => rooms.has(r))) return false;
    const sf = sessionFacets.get(s.id)!;
    for (const f of model.facets) {
      if (except === `f:${f.key}`) continue;
      const sel = facetSel[f.key];
      if (sel.size && ![...(sf[f.key] ?? [])].some((v) => sel.has(v))) return false;
    }
    return true;
  };
  const countBy = (dim: Dim, valuesOf: (s: Session) => Iterable<string>) => {
    const counts = new Map<string, number>();
    for (const s of model.sessions) if (passes(s, dim)) for (const v of new Set(valuesOf(s))) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  };

  const visible = model.sessions.filter((s) => passes(s));
  const dayCounts = countBy('day', (s) => [s.day]);
  const kindCounts = countBy('kind', (s) => [s.kind]);
  const roomCounts = countBy('room', (s) => s.allRooms);

  // Search opens talk sessions with matching talks; poster sessions stay closed (they can hold hundreds of posters).
  const autoOpen = (s: Session) => (starredOnly && !stars.stars.has(s.id) && hasStarredTalk(s)) || (s.kind !== 'posters' && !!matchInfo.get(s.id)?.size);
  const isOpen = (s: Session) => overrides.get(s.id) ?? (expandAll || autoOpen(s));
  const setCardOpen = (id: string, open: boolean) => setOverrides((o) => new Map(o).set(id, open));

  // Jump from the calendar: open the card, scroll to it, flash it (and the talk, if one was targeted).
  useEffect(() => {
    if (!url.open) return;
    setOverrides((o) => new Map(o).set(url.open!, true));
    const t = setTimeout(() => {
      const card = document.querySelector(`.card[data-id="${CSS.escape(url.open!)}"]`);
      const pres = url.pres ? card?.querySelector(`.pres[data-id="${CSS.escape(url.pres)}"]`) : null;
      flashEl(pres ?? card ?? null, pres ? 'center' : 'start');
    }, 40);
    return () => clearTimeout(t);
  }, [url.open, url.pres]);

  const anyFilter = !!(days.size || kinds.size || rooms.size || starredOnly || q || Object.values(facetSel).some((s) => s.size));
  const clearAll = () =>
    setUrl({ day: null, kind: null, room: null, starred: null, q: null, ...Object.fromEntries(model.facets.map((f) => [`f_${f.key}`, null])) });

  const byDay = new Map<string, Session[]>();
  for (const s of visible) (byDay.get(s.day) ?? byDay.set(s.day, []).get(s.day)!).push(s);

  const now = nowInZone(model.meta.timezone);
  // "Now": the most recently started session still running, else the next one to start.
  const nextUp = model.days.includes(now.slice(0, 10))
    ? (visible.filter((s) => s.start <= now && (s.end ?? s.start) > now && s.day === now.slice(0, 10)).pop() ?? visible.find((s) => s.start >= now))
    : undefined;

  const sidebar = (
    <>
      <div className="side-top">
        <span>Filters</span>
        <button className="side-reset" disabled={!anyFilter} onClick={clearAll}>
          Clear all
        </button>
      </div>
      <div className="side-sec">
        <Opt className="star-opt" label="My Schedule" count={scheduleCount(model, stars.stars)} on={starredOnly} onClick={() => setUrl({ starred: starredOnly ? null : '1' })} />
      </div>
      {model.kinds.length > 1 && !hasTypeFacet && (
        <SideGroup
          title="Session type"
          options={model.kinds.map((k) => ({ value: k, label: KIND_LABELS[k], count: kindCounts.get(k) ?? 0 }))}
          selected={kinds}
          onToggle={(v) => setUrl({ kind: joinSet(toggled(kinds, v)) })}
          onClear={() => setUrl({ kind: null })}
        />
      )}
      {model.facets.map((f) => {
        const counts = countBy(`f:${f.key}`, (s) => sessionFacets.get(s.id)![f.key] ?? []);
        const all = new Set<string>();
        for (const sf of sessionFacets.values()) sf[f.key]?.forEach((v) => all.add(v));
        return (
          <SideGroup
            key={f.key}
            title={f.label}
            options={[...all].sort().map((v) => ({ value: v, label: v, count: counts.get(v) ?? 0 }))}
            selected={facetSel[f.key]}
            suggested={f.suggested}
            onToggle={(v) => setUrl({ [`f_${f.key}`]: joinSet(toggled(facetSel[f.key], v)) })}
            onClear={() => setUrl({ [`f_${f.key}`]: null })}
          />
        );
      })}
      {model.rooms.length > 1 && (
        <SideGroup
          title="Room"
          options={model.rooms.map((r) => ({ value: r, label: r, count: roomCounts.get(r) ?? 0 }))}
          selected={rooms}
          onToggle={(v) => setUrl({ room: joinSet(toggled(rooms, v)) })}
          onClear={() => setUrl({ room: null })}
        />
      )}
    </>
  );

  const daybar = (
    <>
      {model.days.map((d) => {
        const c = dayCounts.get(d) ?? 0;
        return (
          <button
            key={d}
            className={`chip${days.has(d) ? ' on' : ''}${c === 0 && !days.has(d) ? ' zero' : ''}`}
            title={dayLabel(d)}
            onClick={() => setUrl({ day: joinSet(toggled(days, d)) })}
          >
            <span className="dw">{weekdayShort(d)}</span>
            <span className="dn">{dayNumber(d)}</span>
            <span className="c">{c}</span>
          </button>
        );
      })}
      <div className="seg">
        {nextUp && (
          <button
            onClick={() => {
              if (days.size && !days.has(nextUp.day)) setUrl({ day: null });
              setTimeout(() => flashEl(document.querySelector(`.card[data-id="${CSS.escape(nextUp.id)}"]`), 'start'), 40);
            }}
          >
            Now
          </button>
        )}
        <button
          className={!expandAll ? 'on' : ''}
          onClick={() => {
            setExpandAll(false);
            setOverrides(new Map());
          }}
        >
          Collapse all
        </button>
        <button
          className={expandAll ? 'on' : ''}
          onClick={() => {
            setExpandAll(true);
            setOverrides(new Map());
          }}
        >
          Expand all
        </button>
      </div>
    </>
  );

  return (
    <Shell
      {...props}
      view="program"
      onView={(v) => setUrl({ view: v === 'program' ? null : v, q: null, open: null, pres: null })}
      sidebar={sidebar}
      daybar={daybar}
      q={q}
      onQ={(v) => setUrl({ q: v })}
      placeholder="Search sessions, speakers, abstracts…"
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
    >
      {visible.length === 0 && (
        <div className="empty">
          <h3>No sessions match</h3>
          <p>Try removing a filter or clearing the search.</p>
        </div>
      )}
      {[...byDay].map(([d, list]) => (
        <div key={d} className="daygroup">
          <div className="daygroup-h">
            <span className="d">{longDate(d)}</span>
            <span className="n">
              {list.length} session{list.length > 1 ? 's' : ''}
            </span>
          </div>
          {list.map((s, i) => {
            const newBlock = i === 0 || s.start !== list[i - 1].start;
            return [
              i > 0 && newBlock ? <div key={`${s.id}-div`} className="timedivider" /> : null,
              <Card
                key={s.id}
                model={model}
                s={s}
                showTime={newBlock}
                open={isOpen(s)}
                onSetOpen={setCardOpen}
                stars={stars}
                starSig={starSignature(s, stars.stars)}
                matchIds={matchInfo.get(s.id)}
                query={dq}
              />,
            ];
          })}
        </div>
      ))}
    </Shell>
  );
}

const CAP = 60;
const names = (ps: Person[]) => ps.map((p) => p.name);
const shorten = (ns: string[]) => (ns.length > 4 ? `${ns.slice(0, 4).join(', ')} +${ns.length - 4} more` : ns.join(', '));

type CardProps = {
  model: Model;
  s: Session;
  showTime: boolean;
  open: boolean;
  onSetOpen: (id: string, open: boolean) => void;
  stars: ViewProps['stars'];
  /** Which of this card's items are starred; lets memo skip cards a star toggle didn't touch. */
  starSig: string;
  matchIds?: Set<string>;
  query: string;
};

function starSignature(s: Session, stars: Set<string>) {
  let sig = stars.has(s.id) ? '1' : '0';
  for (const p of s.presentations) if (stars.has(p.id)) sig += `|${p.id}`;
  return sig;
}

const Card = memo(CardImpl, (a, b) =>
  a.s === b.s && a.open === b.open && a.showTime === b.showTime && a.starSig === b.starSig && a.matchIds === b.matchIds && a.query === b.query && a.model === b.model,
);

function CardImpl({ model, s, showTime, open, onSetOpen, stars, matchIds, query }: CardProps) {
  const nStar = s.presentations.filter((p) => stars.stars.has(p.id)).length;
  const dur = formatDuration(s.start, s.end);
  const meta = joinSep([
    s.code && <span className="mi">{s.code}</span>,
    <span className="mi">{typeLabel(model, s)}</span>,
    dur && <span className="mi">{dur}</span>,
    s.rooms.length > 0 && s.rooms.join(', '),
    nStar > 0 && <span className="saved mi">★ {nStar} saved</span>,
    !!matchIds?.size && !open && (
      <span className="mi">
        {matchIds.size} matching {s.kind === 'posters' ? 'poster' : 'presentation'}
        {matchIds.size > 1 ? 's' : ''}
      </span>
    ),
  ]);
  const speakers = s.kind === 'posters' ? [] : [...new Set(s.presentations.flatMap((p) => names(p.speakers)))];
  const people = joinSep([
    s.chairs.length > 0 && (
      <>
        <b>Chairs</b> {names(s.chairs).join(', ')}
      </>
    ),
    speakers.length > 0 && (
      <>
        <b>{speakers.length > 1 ? 'Speakers' : 'Speaker'}</b> {shorten(speakers)}
      </>
    ),
  ]);

  return (
    <div className={`card${open ? ' open' : ''}`} data-id={s.id}>
      <div className="card-row js-toggle" onClick={() => onSetOpen(s.id, !open)}>
        <div className="time">{showTime && <span className="t1">{formatTime(s.start)}</span>}</div>
        <div className="body">
          <div className="title">{s.title}</div>
          <div className="meta">{meta}</div>
          {people.length > 0 && <div className="people">{people}</div>}
        </div>
        <div className="card-side">
          <StarButton on={stars.stars.has(s.id)} onToggle={() => stars.toggle(s.id)} />
          <span className="chev">
            <Chev />
          </span>
        </div>
      </div>
      <div className="detail">{open && <Detail model={model} s={s} stars={stars} matchIds={matchIds} query={query} />}</div>
    </div>
  );
}

function Detail({ model, s, stars, matchIds, query }: { model: Model; s: Session; stars: ViewProps['stars']; matchIds?: Set<string>; query: string }) {
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(CAP);
  useEffect(() => {
    setShowAll(false);
    setLimit(CAP);
  }, [query]);
  const tags = model.facets.filter((f) => f.key !== 'type').flatMap((f) => (s.facets[f.key] ?? []).map((v) => ({ v, suggested: f.suggested })));
  const n = s.presentations.length;
  const filtering = !!matchIds?.size && !showAll && matchIds.size < n;
  const pres = filtering ? s.presentations.filter((p) => matchIds!.has(p.id)) : s.presentations;
  const noun = s.kind === 'posters' ? 'Poster' : 'Presentation';
  const suggestedKeys = model.facets.filter((f) => f.suggested).map((f) => f.key);
  return (
    <>
      {tags.length > 0 && (
        <div className="dtracks">
          {tags.map((t, i) => (
            <span key={i} className={t.suggested ? 'sugg' : undefined}>
              {i > 0 && '  ·  '}
              {t.v}
            </span>
          ))}
        </div>
      )}
      {s.description && (
        <div className="info">
          <Paragraphs text={s.description} />
        </div>
      )}
      {n > 0 && (
        <div className="subheat">
          {filtering ? `${pres.length} of ${n} ${noun.toLowerCase()}s match` : `${n} ${noun}${n > 1 ? 's' : ''}`}
          {filtering && (
            <button className="subheat-all" onClick={() => setShowAll(true)}>
              Show all
            </button>
          )}
        </div>
      )}
      {pres.slice(0, limit).map((p) => (
        <PresRow key={p.id} p={p} stars={stars} topics={suggestedKeys.flatMap((k) => p.facets[k] ?? [])} />
      ))}
      {pres.length > limit && (
        <button className="more-btn" onClick={() => setLimit(Infinity)}>
          Show all {pres.length}
        </button>
      )}
    </>
  );
}

function PresRow({ p, stars, topics }: { p: Presentation; stars: ViewProps['stars']; topics: string[] }) {
  const [exp, setExp] = useState(false);
  const tline = p.ownTime ? formatRange(p.start, p.end) : '';
  const people = p.speakers.map((x) => (x.affiliation ? `${x.name} (${x.affiliation})` : x.name)).join('; ');
  const tag = p.board ? `Board ${p.board}` : p.code ? `#${p.code}` : '';
  const hasBody = !!(p.abstract || p.authors || p.affiliations);
  const lbl = p.abstract ? 'abstract' : 'authors';
  return (
    <div className={`pres${exp ? ' exp' : ''}`} data-id={p.id}>
      <StarButton className="pres-star" on={stars.stars.has(p.id)} onToggle={() => stars.toggle(p.id)} />
      <div className="pres-body">
        <div className="pres-t">
          {tline && <span className="pres-time">{tline}</span>}
          <span className="pres-title">{p.title}</span>
        </div>
        {(people || p.authors || tag || topics.length > 0) && (
          <div className="pres-people">{joinSep([people || p.authors, tag, topics.length > 0 && <span className="sugg">{topics.join(', ')}</span>])}</div>
        )}
        {hasBody && (
          <>
            <div className="pres-abs">
              <BodyBlock abstract={p.abstract} authors={p.authors} affiliations={p.affiliations} />
            </div>
            <span className="pres-more js-absmore" onClick={() => setExp((e) => !e)}>
              {exp ? `Hide ${lbl}` : `Show ${lbl}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
