import { useEffect, useRef, type ReactNode } from 'react';
import type { Model } from '../lib/model.ts';
import { formatShortRange } from '../lib/time.ts';
import { DoorOpen } from 'lucide-react';
import type { SuggestedToggle } from './common.tsx';
import { MenuIcon, SearchIcon } from './icons.tsx';

export type View = 'program' | 'posters' | 'calendar';

type Props = {
  model: Model;
  view: View;
  onView: (v: View) => void;
  onClose: () => void;
  suggested: SuggestedToggle;
  sidebar: ReactNode;
  daybar: ReactNode;
  q: string;
  onQ: (q: string) => void;
  placeholder: string;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  children: ReactNode;
};

/** The reference planner's frame: sidebar (brand, view switch, view filters) + top bar (search, switch conference) + day bar + list. */
export function Shell(p: Props) {
  const m = p.model.meta;
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) {
        e.preventDefault();
        input.current?.focus();
      } else if (e.key === 'Escape') {
        if (t === input.current) input.current?.blur();
        p.setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [p.setSidebarOpen]);

  const dates = m.start && m.end ? formatShortRange(m.start, m.end) : p.model.days.length ? formatShortRange(p.model.days[0], p.model.days[p.model.days.length - 1]) : '';
  const place = m.location?.split(',')[0];

  return (
    <div className={`app ${p.view}-view`}>
      <aside className={`sidebar${p.sidebarOpen ? ' show' : ''}`}>
        <div className="brand">
          <div>
            <h1>{m.shortName ?? m.name}</h1>
            <div className="sub">{[place, dates].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="viewswitch">
          <button className={p.view === 'program' ? 'on' : ''} onClick={() => p.onView('program')}>
            Program
          </button>
          {p.model.hasPosters && (
            <button className={p.view === 'posters' ? 'on' : ''} onClick={() => p.onView('posters')}>
              Posters
            </button>
          )}
          <button className={p.view === 'calendar' ? 'on' : ''} onClick={() => p.onView('calendar')}>
            Calendar
          </button>
        </div>
        <div>{p.sidebar}</div>
        {m.url && (
          <div className="side-foot">
            <a href={m.url} target="_blank" rel="noreferrer">
              Official site
            </a>
          </div>
        )}
      </aside>
      <div className={`scrim${p.sidebarOpen ? ' show' : ''}`} onClick={() => p.setSidebarOpen(false)} />

      <div className="main">
        <div className="topbar">
          <button className="menu-btn" aria-label="Filters" onClick={() => p.setSidebarOpen(true)}>
            <MenuIcon />
          </button>
          <div className="search">
            <SearchIcon />
            <input
              ref={input}
              type="text"
              value={p.q}
              placeholder={p.placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => p.onQ(e.target.value)}
            />
            <span className="kbd">/</span>
          </div>
          {p.suggested.available && (
            <button
              className={`suggest-toggle${p.suggested.show ? ' on' : ''}`}
              role="switch"
              aria-checked={p.suggested.show}
              title="Show topics suggested from the abstracts by AI, not by the organizers"
              onClick={p.suggested.toggle}
            >
              <span className="suggest-track">
                <span className="suggest-thumb" />
              </span>
              <span>Suggested topics</span>
            </button>
          )}
          <button className="switch-conf" onClick={p.onClose} title="Exit to your conferences">
            <DoorOpen size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Exit</span>
          </button>
        </div>
        <div className="daybar">{p.daybar}</div>
        <div className="list">{p.children}</div>
      </div>
    </div>
  );
}
