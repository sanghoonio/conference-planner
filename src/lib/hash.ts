import { useCallback, useEffect, useState } from 'react';

// View state lives in the URL hash (#view=program&day=…&q=…) so a reload keeps your place.
export type HashState = Record<string, string>;

function read(): HashState {
  return Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/, '')));
}

export function useHashState(): [HashState, (patch: Record<string, string | null | undefined>) => void] {
  const [state, setState] = useState<HashState>(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const update = useCallback((patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(location.hash.replace(/^#/, ''));
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    setState(Object.fromEntries(next));
    try {
      history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
    } catch {
      // Safari throttles rapid history calls; the in-memory state is what matters.
    }
  }, []);
  return [state, update];
}
