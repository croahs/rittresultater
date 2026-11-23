import { fold } from "./format";
// Every harvested race (alle.py writes them to D1, functions/api/alle serves them): riders and races
// beyond the followed riders' own, so anyone who rode a race on EQ Timing can find themselves.
// Shared by the page and the function, so both read the rows the same way.

/** One rider in the name search: EQ Timing id, name, club, races, newest year. */
export type AlleHit = [number, string, string, number, string];
/** A search row: riders, or {split: n} when the riders are under longer prefixes. */
export type SearchRow = AlleHit[] | { split: number };

/** One result: event, date, race, sport, stage, class, place (null = DNF), field, time, status («DNF», «−1 runde»). */
export type AlleResult = [string, string, string, string, string, string, number | null, number, string, string];
export interface AlleRider { uid: number; name: string; club: string; results: AlleResult[] }

/** A row in a stage's list: EQ id (null when anonymised), name, club, class, place, time, status. */
export type AlleRow = [number | null, string, string, string, number | null, string, string];
export interface AlleRace {
  id: string; name: string; date: string; sport: string; place: string; organizer: string;
  stages: { id: string; name: string; km: number | null; rows: AlleRow[] }[];
}

export const SEARCH_PREFIX = 3;
export const RIDER_BUCKETS = 2048;

/** The words of a name or query, as alle.py's words(). */
export const words = (s: string) => fold(s).split(/[^\p{L}\p{N}_]+/u).filter(Boolean);

/** The search row keys that may hold a word: its first 3, 4, 5 and 6 letters, and the word with a full stop. */
export function searchKeys(word: string): string[] {
  const keys = [3, 4, 5, 6].filter((n) => n <= word.length).map((n) => word.slice(0, n));
  if (word.length < 3) keys.push(word);
  return [...new Set([...keys, word + "."])];
}

/** The row for a word among the rows fetched by searchKeys(), following splits. null: no rider has it. */
export function rowFor(word: string, rows: Map<string, SearchRow>): AlleHit[] | null {
  let key = word.slice(0, SEARCH_PREFIX);
  for (;;) {
    const row = rows.get(key);
    if (!row) return null;
    if (Array.isArray(row)) return row;
    key = word.length >= row.split ? word.slice(0, row.split) : word + ".";
  }
}

/** Riders whose name has a word starting with each word of the query, most races first. */
export function matches(query: string, hits: AlleHit[], max = 12): AlleHit[] {
  const q = words(query);
  return hits.filter((h) => { const w = words(h[1]); return q.every((x) => w.some((y) => y.startsWith(x))); }).slice(0, max);
}

/** The query word to look up: the longest, as it narrows the most. */
export const lookupWord = (query: string) => words(query).sort((a, b) => b.length - a.length)[0] ?? "";

const cache = new Map<string, Promise<unknown>>();
function api<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(`/api/alle/${path}`).then((r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path) as Promise<T>;
}

export const searchAlle = (q: string) => api<AlleHit[]>(`sok?q=${encodeURIComponent(q)}`);
export const loadAlleRider = (uid: string) => api<AlleRider | null>(`rytter/${uid}`);
export const loadAlleRace = (id: string) => api<AlleRace | null>(`ritt/${id}`);
