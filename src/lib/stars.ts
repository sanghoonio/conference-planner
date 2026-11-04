import { useCallback, useEffect, useState } from 'react';

// Stars are a set of item ids per conference, in localStorage under `cp:stars:<conference id>`.
const key = (conferenceId: string) => `cp:stars:${conferenceId}`;

export function readStars(conferenceId: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key(conferenceId)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeStars(conferenceId: string, stars: Set<string>) {
  localStorage.setItem(key(conferenceId), JSON.stringify([...stars]));
}

export function useStars(conferenceId: string) {
  const [stars, setStars] = useState(() => readStars(conferenceId));

  useEffect(() => {
    setStars(readStars(conferenceId));
    const onStorage = (e: StorageEvent) => {
      if (e.key === key(conferenceId)) setStars(readStars(conferenceId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [conferenceId]);

  const toggle = useCallback(
    (id: string) => {
      setStars((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeStars(conferenceId, next);
        return next;
      });
    },
    [conferenceId],
  );

  const clear = useCallback(
    (ids: Iterable<string>) => {
      setStars((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        writeStars(conferenceId, next);
        return next;
      });
    },
    [conferenceId],
  );

  return { stars, toggle, clear };
}

export type Stars = ReturnType<typeof useStars>;
