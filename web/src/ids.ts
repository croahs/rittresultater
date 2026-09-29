// Our own rider ids ("r17179", data/aliases.json from riderids.py). URLs, the API and the database use them.
// The static data files (riders/index.json, the shards, site.json) may still be keyed by TurrittID until
// rivals.py moves to our ids, so this maps between the two. Once the index is keyed by our ids, every
// lookup below is the identity and ids.json can go.

export type IdMap = Record<string, string>; // our id -> TurrittID (data/ids.json, built by copy-data.mjs)

export const isRid = (s: unknown): s is string => typeof s === "string" && /^r\d{1,9}$/.test(s);

export interface Ids {
  /** Our id for a data key (our id already, or a TurrittID); null when unknown. */
  toRid(key: string): string | null;
  /** The key the data files use for our id; null when unknown. inData tells whether a key exists in the index. */
  toKey(rid: string, inData: (key: string) => boolean): string | null;
}

export function makeIds(map: IdMap): Ids {
  const back = new Map<string, string>();
  for (const [rid, t] of Object.entries(map)) back.set(t, rid);
  return {
    toRid: (key) => (isRid(key) ? key : back.get(key) ?? null),
    toKey: (rid, inData) => (inData(rid) ? rid : map[rid] && inData(map[rid]) ? map[rid] : null),
  };
}

/** ids.json, fetched once and only when a rider is opened (the front page does without it). */
export function idsLoader(get: <T>(path: string) => Promise<T>): () => Promise<Ids> {
  let p: Promise<Ids> | null = null;
  return () => (p ??= get<IdMap>("ids.json").catch(() => ({} as IdMap)).then(makeIds));
}
