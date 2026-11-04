import { useDeferredValue, useMemo, useState } from 'react';
import { joinSet, naturalCompare, presenterName, splitSet, toggled, type ViewProps } from '../components/common.tsx';
import { StarButton } from '../components/icons.tsx';
import { Shell } from '../components/Shell.tsx';
import { BodyBlock, joinSep } from '../components/Text.tsx';
import { makeMatcher, type Presentation, type Session } from '../lib/model.ts';
import { dayLabel, formatSpan, formatTime } from '../lib/time.ts';

const PICKS = '__picks__';
const PAGE = 150;

type Sort = 'number' | 'facet' | 'az' | 'pres';

/** "Poster Session I" → "Session I"; leaves other titles alone (reference `shortPoster`). */
const shortPoster = (t: string) => t.replace(/^\s*Posters?\s+(?=Session)/i, '').trim() || t;
const boardOf = (p: Presentation) => p.board ?? p.code ?? '';

export function PostersView(props: ViewProps) {
  const { model, stars, url, setUrl } = props;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const posterSessions = useMemo(() => model.sessions.filter((s) => s.presentations.some((p) => p.isPoster)), [model]);
  const allPosters = useMemo(() => posterSessions.flatMap((s) => s.presentations.filter((p) => p.isPoster)), [posterSessions]);
  const hasNumbers = allPosters.some((p) => boardOf(p));
  // The facet used for chips and "By <facet>" grouping: the first declared facet posters actually use.
  const facet = model.facets.find((f) => allPosters.some((p) => p.facets[f.key]?.length));

  const sel = url.session && (url.session === PICKS || model.sessionById.has(url.session)) ? url.session : (posterSessions[0]?.id ?? PICKS);
  const isPicks = sel === PICKS;
  const session = model.sessionById.get(sel);
  const q = url.q ?? '';
  const dq = useDeferredValue(q);
  const isSearchAll = !isPicks && !!dq.trim(); // a query searches every poster, across sessions
  // Like the reference (which opens "By track"), group by category when there is one.
  const defaultSort: Sort = facet ? 'facet' : hasNumbers ? 'number' : 'az';
  const sort: Sort = (['number', 'facet', 'az', 'pres'] as const).includes(url.sort as Sort) ? (url.sort as Sort) : defaultSort;
  const chipSel = splitSet(url.ptrack);

  const matcher = useMemo(() => makeMatcher(dq), [dq]);
  const picks = allPosters.filter((p) => stars.stars.has(p.id));
  const all = isPicks ? picks : isSearchAll ? allPosters : (session?.presentations.filter((p) => p.isPoster) ?? []);
  const qFiltered = matcher ? all.filter((p) => matcher(p.search)) : all;
  const chipCounts = new Map<string, number>();
  if (facet) for (const p of qFiltered) for (const v of p.facets[facet.key] ?? []) chipCounts.set(v, (chipCounts.get(v) ?? 0) + 1);
  const filtered = facet && chipSel.size ? qFiltered.filter((p) => (p.facets[facet.key] ?? []).some((v) => chipSel.has(v))) : qFiltered;

  const sess = (p: Presentation) => model.sessionById.get(p.sessionId)!;
  const byDayTimeBoard = (a: Presentation, b: Presentation) =>
    a.start.localeCompare(b.start) || naturalCompare(boardOf(a) || '~', boardOf(b) || '~') || a.title.localeCompare(b.title);
  const byNumber = (a: Presentation, b: Presentation) => naturalCompare(boardOf(a) || '~', boardOf(b) || '~') || a.title.localeCompare(b.title);
  const byTitle = (a: Presentation, b: Presentation) => a.title.localeCompare(b.title);
  const byPresenter = (a: Presentation, b: Presentation) => (presenterName(a) || '~').localeCompare(presenterName(b) || '~');

  const choose = (id: string) => {
    setSidebarOpen(false);
    setLimit(PAGE);
    setUrl({ session: id, q: null, ptrack: null });
  };

  // ---------- groups to render ----------
  type Group = { label?: string; meta?: string; items: Presentation[]; ctx?: (p: Presentation) => string; sugg?: boolean };
  let groups: Group[] = [];
  if (isPicks) {
    const byDay = new Map<string, Presentation[]>();
    for (const p of [...filtered].sort(byDayTimeBoard)) (byDay.get(sess(p).day) ?? byDay.set(sess(p).day, []).get(sess(p).day)!).push(p);
    groups = [...byDay].map(([d, items]) => ({
      label: dayLabel(d),
      meta: `${items.length} poster${items.length !== 1 ? 's' : ''}`,
      items,
      ctx: (p) => `${formatTime(sess(p).start)} · ${shortPoster(sess(p).title)}`,
    }));
  } else if (isSearchAll) {
    const bySess = new Map<string, Presentation[]>();
    for (const p of filtered) (bySess.get(p.sessionId) ?? bySess.set(p.sessionId, []).get(p.sessionId)!).push(p);
    groups = posterSessions
      .filter((s) => bySess.has(s.id))
      .map((s) => ({ label: s.title, meta: `${dayLabel(s.day)} · ${formatTime(s.start)} · ${bySess.get(s.id)!.length} here`, items: bySess.get(s.id)!.sort(byNumber) }));
  } else if (sort === 'facet' && facet) {
    const byF = new Map<string, Presentation[]>();
    for (const p of filtered) {
      const v = p.facets[facet.key]?.[0] ?? 'Other';
      (byF.get(v) ?? byF.set(v, []).get(v)!).push(p);
    }
    groups = [...byF.keys()].sort().map((v) => ({ label: v, meta: String(byF.get(v)!.length), items: byF.get(v)!.sort(hasNumbers ? byNumber : byTitle), sugg: facet.suggested }));
  } else {
    groups = [{ items: [...filtered].sort(sort === 'pres' ? byPresenter : sort === 'az' ? byTitle : byNumber) }];
  }

  // ---------- header ----------
  let head;
  if (isPicks) {
    head = (
      <div className="phead">
        <div className="phead-title">★ My poster picks</div>
        <div className="phead-meta">
          {picks.length} poster{picks.length !== 1 ? 's' : ''} saved · sorted by day, time{hasNumbers ? ', number' : ''}
        </div>
      </div>
    );
  } else if (isSearchAll) {
    const nSess = new Set(filtered.map((p) => p.sessionId)).size;
    head = (
      <div className="phead">
        <div className="phead-title">All posters</div>
        <div className="phead-meta">
          {filtered.length} poster{filtered.length !== 1 ? 's' : ''} matching “{q}” across {nSess} session{nSess !== 1 ? 's' : ''}
        </div>
      </div>
    );
  } else {
    head = (
      <div className="phead">
        <div className="phead-title">{session?.title}</div>
        <div className="phead-meta">
          {session && [dayLabel(session.day), formatSpan(session.start, session.end), session.rooms.join(', '), `${all.length} posters`].filter(Boolean).join(' · ')}
        </div>
      </div>
    );
  }

  const chipValues = [...chipCounts.keys()].sort();
  const daybar = (
    <>
      {head}
      <div className="ptoolbar">
        <div className="ptracks">
          {chipValues.length > 1 &&
            chipValues.map((v) => (
              <button key={v} className={`chip${chipSel.has(v) ? ' on' : ''}${facet?.suggested ? ' sugg' : ''}`} onClick={() => setUrl({ ptrack: joinSet(toggled(chipSel, v)) })}>
                {v}
                <span className="c">{chipCounts.get(v)}</span>
              </button>
            ))}
        </div>
        {!isPicks && !isSearchAll && (
          <div className="seg pseg">
            {facet && (
              <button className={sort === 'facet' ? 'on' : ''} onClick={() => setUrl({ sort: 'facet' })}>
                By {facet.label.toLowerCase()}
              </button>
            )}
            {hasNumbers && (
              <button className={sort === 'number' ? 'on' : ''} onClick={() => setUrl({ sort: 'number' })}>
                By number
              </button>
            )}
            <button className={sort === 'az' ? 'on' : ''} onClick={() => setUrl({ sort: 'az' })}>
              A–Z
            </button>
            <button className={sort === 'pres' ? 'on' : ''} onClick={() => setUrl({ sort: 'pres' })}>
              Presenter
            </button>
          </div>
        )}
      </div>
    </>
  );

  const byDay = new Map<string, Session[]>();
  for (const s of posterSessions) (byDay.get(s.day) ?? byDay.set(s.day, []).get(s.day)!).push(s);
  const sidebar = (
    <>
      <div className="side-sec" style={{ paddingTop: 12 }}>
        <div className={`opt pnav star-opt${isPicks ? ' on' : ''}`} onClick={() => choose(PICKS)}>
          <span className="lbl">My poster picks</span>
          <span className="n">{picks.length}</span>
        </div>
      </div>
      {[...byDay].map(([d, list]) => (
        <div key={d} className="side-sec">
          <div className="side-head">
            <span>{dayLabel(d)}</span>
          </div>
          {list.map((s) => (
            <div key={s.id} className={`opt pnav${sel === s.id && !isSearchAll ? ' on' : ''}`} title={s.title} onClick={() => choose(s.id)}>
              <span className="lbl">{shortPoster(s.title)}</span>
              <span className="n">{s.presentations.filter((p) => p.isPoster).length}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );

  let shown = 0;
  const toggle = (id: string) => setOpenIds((o) => toggled(o, id));

  return (
    <Shell
      {...props}
      view="posters"
      onView={(v) => setUrl({ view: v === 'program' ? null : v, q: null, ptrack: null })}
      sidebar={sidebar}
      daybar={daybar}
      q={q}
      onQ={(v) => {
        setLimit(PAGE);
        setUrl({ q: v });
      }}
      placeholder={isPicks ? 'Search my poster picks…' : 'Search all posters…'}
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
    >
      {!posterSessions.length ? (
        <div className="empty">
          <h3>No poster sessions</h3>
        </div>
      ) : isPicks && !picks.length ? (
        <div className="empty">
          <h3>No posters saved yet</h3>
          <p>Open a poster session and tap the star on posters you want to visit. They’ll collect here.</p>
        </div>
      ) : !filtered.length ? (
        <div className="empty">
          <h3>No posters match</h3>
          <p>Try a different search{facet ? ` or clear the ${facet.label.toLowerCase()} filter` : ''}.</p>
        </div>
      ) : (
        groups.map((g, gi) => {
          if (shown >= limit) return null;
          const items = g.items.slice(0, limit - shown);
          shown += items.length;
          return (
            <div key={g.label ?? gi}>
              {g.label && (
                <div className="pgroup-h">
                  <span className={`d${g.sugg ? ' sugg' : ''}`}>{g.label}</span>
                  <span className="n">{g.meta}</span>
                </div>
              )}
              {items.map((p) => (
                <PosterRow key={p.id} p={p} facetKey={facet?.key} facetSuggested={facet?.suggested} ctx={g.ctx?.(p)} open={openIds.has(p.id)} onToggle={() => toggle(p.id)} stars={stars} />
              ))}
            </div>
          );
        })
      )}
      {filtered.length > limit && (
        <button className="more-btn" onClick={() => setLimit((l) => l + PAGE * 4)}>
          Show more · {filtered.length - limit} remaining
        </button>
      )}
    </Shell>
  );
}

function PosterRow({
  p,
  facetKey,
  facetSuggested,
  ctx,
  open,
  onToggle,
  stars,
}: {
  p: Presentation;
  facetKey?: string;
  facetSuggested?: boolean;
  ctx?: string;
  open: boolean;
  onToggle: () => void;
  stars: ViewProps['stars'];
}) {
  const presenters = p.speakers.map((x) => x.name + (x.affiliation ? `, ${x.affiliation}` : '')).join('; ');
  const fv = facetKey && p.facets[facetKey]?.[0];
  const meta = joinSep([presenters || p.authors, fv && (facetSuggested ? <span className="sugg">{fv}</span> : fv)]);
  const hasBody = !!(p.abstract || p.authors || p.affiliations);
  return (
    <div className={`poster${open ? ' exp' : ''}`} data-pid={p.id}>
      <div className="poster-board">{boardOf(p)}</div>
      <div className="poster-main js-ptoggle" onClick={onToggle}>
        {ctx && <div className="poster-ctx">{ctx}</div>}
        <div className="poster-title">{p.title}</div>
        <div className="poster-meta">{meta}</div>
        {hasBody && open && (
          <div className="poster-abs">
            <BodyBlock abstract={p.abstract} authors={p.authors} affiliations={p.affiliations} />
          </div>
        )}
      </div>
      <StarButton on={stars.stars.has(p.id)} onToggle={() => stars.toggle(p.id)} title={stars.stars.has(p.id) ? 'Remove from picks' : 'Save poster'} />
    </div>
  );
}
