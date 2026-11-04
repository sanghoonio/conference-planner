import { useCallback, useEffect, useState } from 'react';

// UI state lives in the URL: the view is the path (/, /posters, /calendar) and everything else
// (search, filters, selections) is the query string, so reloads and shared links keep your place.
// The Worker serves index.html for any path (wrangler.jsonc: not_found_handling).
export type UrlState = Record<string, string>;
export type UrlPatch = Record<string, string | null | undefined>;

const BASE = import.meta.env.BASE_URL; // "/"
const VIEWS = ['posters', 'calendar'] as const;

function viewOf(pathname: string): string | undefined {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  const seg = rest.split('/')[0];
  return (VIEWS as readonly string[]).includes(seg) ? seg : undefined;
}

function read(): UrlState {
  const state: UrlState = Object.fromEntries(new URLSearchParams(location.search));
  delete state.view;
  const view = viewOf(location.pathname);
  if (view) state.view = view;
  return state;
}

export const pathFor = (view: string | undefined) => (view && (VIEWS as readonly string[]).includes(view) ? `${BASE}${view}` : BASE);

export function useUrlState(): [UrlState, (patch: UrlPatch) => void] {
  const [state, setState] = useState<UrlState>(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const update = useCallback((patch: UrlPatch) => {
    const current = read();
    const params = new URLSearchParams(location.search);
    params.delete('view');
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'view') continue;
      if (v == null || v === '') params.delete(k);
      else params.set(k, v);
    }
    const view = 'view' in patch ? (patch.view ?? undefined) : current.view;
    const qs = params.toString();
    const url = `${pathFor(view)}${qs ? `?${qs}` : ''}`;
    const next: UrlState = Object.fromEntries(params);
    if (view && view !== 'program') next.view = view;
    setState(next);
    try {
      // Switching views is navigation (back button returns); filter and search changes just update the URL.
      if (view !== current.view) history.pushState(null, '', url);
      else history.replaceState(null, '', url);
    } catch {
      // Safari throttles rapid history calls; the in-memory state is what matters.
    }
  }, []);

  return [state, update];
}

/** Clear all UI state and go to the program root (used when opening or leaving a conference). */
export function resetUrl() {
  history.replaceState(null, '', BASE);
}
