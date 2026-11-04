import type { ConferenceFile } from '../../schema/conference.ts';

// Loaded conference files are kept in IndexedDB (they can exceed localStorage's ~5 MB limit)
// so a reload doesn't ask for the file again. Nothing leaves the browser.

const DB = 'conference-planner';
const STORE = 'conferences';
const LAST_KEY = 'cp:last';

export type CachedEntry = { id: string; name: string; start: string | null; end: string | null; loadedAt: string; data: ConferenceFile };
export type CachedSummary = Omit<CachedEntry, 'data'>;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = t.onabort = () => {
      db.close();
      reject(t.error ?? req.error);
    };
  });
}

export async function saveConference(data: ConferenceFile): Promise<void> {
  const entry: CachedEntry = {
    id: data.conference.id,
    name: data.conference.name,
    start: data.conference.start ?? data.sessions[0]?.start.slice(0, 10) ?? null,
    end: data.conference.end ?? null,
    loadedAt: new Date().toISOString(),
    data,
  };
  await tx('readwrite', (s) => s.put(entry));
  const { data: _data, ...summary } = entry;
  const existing = readIndex() ?? (await listConferences());
  writeIndex([summary, ...existing.filter((c) => c.id !== entry.id)]);
  setLast(entry.id);
}

// Summaries live in localStorage so the start screen doesn't deserialize every cached file to list names.
const INDEX_KEY = 'cp:index';
function readIndex(): CachedSummary[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX_KEY) ?? 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function writeIndex(list: CachedSummary[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export const getConference = (id: string) => tx<CachedEntry | undefined>('readonly', (s) => s.get(id));

export async function listConferences(): Promise<CachedSummary[]> {
  const index = readIndex();
  if (index) return [...index].sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));
  // No index yet (or it was cleared): rebuild it once from the store.
  const all = await tx<CachedEntry[]>('readonly', (s) => s.getAll());
  const list = all.map(({ data: _data, ...rest }) => rest).sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));
  writeIndex(list);
  return list;
}

export async function removeConference(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  writeIndex((readIndex() ?? []).filter((c) => c.id !== id));
  if (getLast() === id) setLast(null);
}

export const getLast = () => localStorage.getItem(LAST_KEY);
export const setLast = (id: string | null) => (id ? localStorage.setItem(LAST_KEY, id) : localStorage.removeItem(LAST_KEY));

export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {});
}
