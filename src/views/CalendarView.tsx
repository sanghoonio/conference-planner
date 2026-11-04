import { useDeferredValue, useMemo, useState } from 'react';
import type { ViewProps } from '../components/common.tsx';
import { Pin, StarButton } from '../components/icons.tsx';
import { Shell } from '../components/Shell.tsx';
import { makeMatcher, type Presentation, type Session } from '../lib/model.ts';
import { clusters, scheduleCount, scheduleEntries, type Entry } from '../lib/schedule.ts';
import { dayLabel, formatRange, formatSpan, formatTime, longDate } from '../lib/time.ts';

const presenters = (p: Presentation) => p.speakers.map((x) => x.name).join(', ');
const sessionPeople = (s: Session) => {
  const out: string[] = [];
  if (s.chairs.length) out.push(`Chairs: ${s.chairs.map((x) => x.name).join(', ')}`);
  // Keynotes and plenaries: show the talk itself (the session title usually names the speaker already).
  if ((s.kind === 'keynote' || s.kind === 'plenary') && s.presentations.length === 1) {
    const p = s.presentations[0];
    const who = p.speakers.map((x) => x.name).join(', ');
    out.push(s.title.includes(who) || !who ? `“${p.title}”` : `“${p.title}” · ${who}`);
  }
  return out.join('  ·  ');
};

export function CalendarView(props: ViewProps) {
  const { model, stars, url, setUrl } = props;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const q = url.q ?? '';
  const dq = useDeferredValue(q);
  const matcher = useMemo(() => makeMatcher(dq), [dq]);

  const all = useMemo(() => scheduleEntries(model, stars.stars), [model, stars.stars]);
  const total = scheduleCount(model, stars.stars);
  const entries = matcher
    ? all.filter((e) => (e.presentation ? matcher(e.presentation.search) : matcher(e.session.search) || e.nested.some((p) => matcher(p.search))))
    : all;

  const goTo = (e: Entry, presId?: string) => {
    setSidebarOpen(false);
    if (e.session.kind === 'posters' && !presId) return setUrl({ view: 'posters', session: e.sessionStarred ? e.session.id : '__picks__', q: null });
    // Clear program filters so the target is guaranteed visible (reference `openSessionInProgram`).
    setUrl({
      view: null,
      open: e.session.id,
      pres: presId ?? e.presentation?.id ?? null,
      q: null,
      day: null,
      kind: null,
      room: null,
      starred: null,
      ...Object.fromEntries(model.facets.map((f) => [`f_${f.key}`, null])),
    });
  };

  const unstarAll = () => {
    const ids = model.sessions.flatMap((s) => [s.id, ...s.presentations.filter((p) => !p.isPoster).map((p) => p.id)]).filter((id) => stars.stars.has(id));
    if (ids.length && confirm(`Remove all ${ids.length} items from My Schedule? (Poster picks are kept.)`)) stars.clear(ids);
  };

  // ---------- sidebar agenda ----------
  type Row = { id: string; time: string; title: string; entry: Entry; presId?: string };
  const rows: Row[] = [];
  for (const e of all) {
    if (e.sessionStarred || e.kind === 'talk') rows.push({ id: e.presentation?.id ?? e.session.id, time: e.start, title: e.presentation?.title ?? e.session.title, entry: e });
    if (e.kind === 'session') for (const p of e.nested) rows.push({ id: p.id, time: p.start, title: p.title, entry: e, presId: p.id });
  }
  const agendaByDay = new Map<string, Row[]>();
  for (const r of rows) (agendaByDay.get(r.entry.day) ?? agendaByDay.set(r.entry.day, []).get(r.entry.day)!).push(r);

  const sidebar = (
    <>
      <div className="side-top">
        <span>My schedule · {total}</span>
        {total > 0 && (
          <button className="side-reset" onClick={unstarAll}>
            Clear all
          </button>
        )}
      </div>
      {[...agendaByDay].map(([d, list]) => (
        <div key={d} className="side-sec">
          <div className="side-head">
            <span>{dayLabel(d)}</span>
          </div>
          {list.map((r) => (
            <div key={r.id} className="agenda-row">
              <StarButton on onToggle={() => stars.toggle(r.id)} title="Remove" />
              <div className="agenda-b" onClick={() => goTo(r.entry, r.presId)} role="button">
                <div className="agenda-t">{formatTime(r.time)}</div>
                <div className="agenda-title" title={r.title}>{r.title}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );

  const daybar = (
    <div className="phead">
      <div className="phead-title">My Schedule</div>
      <div className="phead-meta">
        {total} starred item{total !== 1 ? 's' : ''} · sessions &amp; talks you’ve saved{model.hasPosters ? ' (posters live in My poster picks)' : ''}
      </div>
    </div>
  );

  const byDay = new Map<string, Entry[]>();
  for (const e of entries) (byDay.get(e.day) ?? byDay.set(e.day, []).get(e.day)!).push(e);

  return (
    <Shell
      {...props}
      view="calendar"
      onView={(v) => setUrl({ view: v === 'program' ? null : v, q: null })}
      sidebar={sidebar}
      daybar={daybar}
      q={q}
      onQ={(v) => setUrl({ q: v })}
      placeholder="Search sessions, speakers, abstracts…"
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
    >
      {!all.length ? (
        <div className="empty">
          <h3>Your schedule is empty</h3>
          <p>
            Tap the ☆ on any session or presentation and it will appear here grouped by day and time, so you can spot overlaps at a glance.
            {model.hasPosters && (
              <>
                {' '}
                (Starred posters go to <b>My poster picks</b>.)
              </>
            )}
          </p>
        </div>
      ) : !entries.length ? (
        <div className="empty">
          <h3>No matches</h3>
          <p>Nothing in your schedule matches “{q}”.</p>
        </div>
      ) : (
        <div className="cal-stack">
          {[...byDay].map(([d, list]) => (
            <div key={d} className="cal-day">
              <div className="cal-day-h">
                <span className="d">{longDate(d)}</span>
                <span className="n">
                  {list.length} item{list.length !== 1 ? 's' : ''}
                </span>
              </div>
              {clusters(list).map((c, i) => (
                <div key={i} className={`cal-cluster${c.columns.length > 1 ? ' overlap' : ''}`}>
                  <div className="cal-cluster-time">{formatTime(`${d}T${String(Math.floor(c.startMin / 60) % 24).padStart(2, '0')}:${String(c.startMin % 60).padStart(2, '0')}`)}</div>
                  <div className="cal-cluster-cols">
                    {c.columns.map((col, j) => (
                      <div key={j} className="cal-col2">
                        {col.map((e) => (
                          <CalCard key={e.key} e={e} stars={stars} onOpen={goTo} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function CalCard({ e, stars, onOpen }: { e: Entry; stars: ViewProps['stars']; onOpen: (e: Entry, presId?: string) => void }) {
  const time = formatSpan(e.start, e.end);
  if (e.kind === 'talk') {
    const p = e.presentation!;
    const room = (p.rooms.length ? p.rooms : e.session.rooms).join(', ');
    return (
      <div className="calc-card k-talk" onClick={() => onOpen(e)}>
        <StarButton className="calc-star" on onToggle={() => stars.toggle(p.id)} title="Remove from schedule" />
        <div className="calc-time">{time}</div>
        <div className="calc-title">{p.title}</div>
        {presenters(p) && <div className="calc-people">{presenters(p)}</div>}
        <div className="calc-sess">{e.session.title}</div>
        {room && (
          <div className="calc-room">
            <Pin />
            {room}
          </div>
        )}
      </div>
    );
  }
  const s = e.session;
  const people = sessionPeople(s);
  return (
    <div className="calc-card k-session" onClick={() => onOpen(e)}>
      <StarButton className="calc-star" on={e.sessionStarred} onToggle={() => stars.toggle(s.id)} title={e.sessionStarred ? 'Remove from schedule' : 'Add whole session'} />
      <div className="calc-time">{time}</div>
      <div className="calc-title">{s.title}</div>
      {people && <div className="calc-people">{people}</div>}
      {s.rooms.length > 0 && (
        <div className="calc-room">
          <Pin />
          {s.rooms.join(', ')}
        </div>
      )}
      {e.posterPicks > 0 && (
        <div className="calc-sess">
          ★ {e.posterPicks} poster pick{e.posterPicks !== 1 ? 's' : ''} in this session
        </div>
      )}
      {e.nested.length > 0 && (
        <div className="calc-nested">
          {e.nested.map((p) => (
            <div
              key={p.id}
              className="calc-sub"
              onClick={(ev) => {
                ev.stopPropagation();
                onOpen(e, p.id);
              }}
            >
              <StarButton className="calc-substar" on onToggle={() => stars.toggle(p.id)} title="Remove from schedule" />
              {p.ownTime && <div className="calc-time">{formatRange(p.start, p.end).replace(' – ', '–')}</div>}
              <div className="calc-title">{p.title}</div>
              {presenters(p) && <div className="calc-people">{presenters(p)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
