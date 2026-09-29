// Race power straight from intervals.icu, in the browser. The API key is sent only to
// intervals.icu, kept in memory for the duration of the fetch and never stored.
// Same method as sync.py: the ride on the race date that best fits distance and time,
// then avg/NP over the official race time's stretch that covers the most distance.

import type { Result } from "./data";

const API = "https://intervals.icu/api/v1";
// Same key as state.raceKey; kept here so the server (functions/api) can use this file without React.
export const raceKeyOf = (r: Result) => `${r.date}|${r.race}`;
const raceKey = raceKeyOf;
const RIDE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"]);

export interface RacePower { np: number; ap: number }
export interface RaceTrack { speed: number | null; km: number | null; pts: [number, number][] }
export interface PowerFetch { athlete: string; athleteId: string; power: Map<string, RacePower>; tracks: Map<string, RaceTrack>; missing: number; failed: number }

export const validKey = (k: string) => /^[\x21-\x7e]{8,256}$/.test(k);

export const secs = (t: string) => t.split(":").reduce((s, p) => s * 60 + Number(p), 0);

/** An error whose message is written for the reader. */
export class IcuError extends Error {}
/** The key belongs to someone whose intervals.icu name does not match the rider. */
export class NameMismatch extends IcuError { constructor(public owner: string) { super(owner); } }

const retryAfterMs = (v: string | null) => {
  const n = Number(v);
  if (v && Number.isFinite(n)) return Math.min(30_000, Math.max(0, n * 1000));
  const d = v ? Date.parse(v) : NaN;
  return Number.isFinite(d) ? Math.min(30_000, Math.max(0, d - Date.now())) : 1000;
};

async function get<T>(key: string, path: string, retry = true): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API + path, { headers: { Authorization: "Basic " + btoa("API_KEY:" + key) }, credentials: "omit", referrerPolicy: "no-referrer" });
  } catch (e) {
    if (retry) { await new Promise((ok) => setTimeout(ok, 1000)); return get<T>(key, path, false); }
    throw e;
  }
  if (r.status === 401 || r.status === 403) throw new IcuError("intervals.icu godtok ikke nøkkelen.");
  if ((r.status === 429 || r.status >= 500) && retry) {
    await new Promise((ok) => setTimeout(ok, retryAfterMs(r.headers.get("retry-after"))));
    return get<T>(key, path, false);
  }
  if (!r.ok) throw new Error(`intervals.icu svarte ${r.status}`);
  return r.json() as Promise<T>;
}

async function eachLimited<T>(items: T[], n: number, work: (x: T) => Promise<void>) {
  let next = 0;
  const run = async () => { while (next < items.length) await work(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

/** Loose name match ("Pedår" vs "Peder", middle names): first and last name, case and accents ignored. */
export function sameName(a: string, b: string): boolean {
  const f = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae").split(/[\s-]+/).filter(Boolean);
  const x = f(a), y = f(b);
  if (!x.length || !y.length) return false;
  return x[x.length - 1] === y[y.length - 1] && (x[0] === y[0] || x.some((w) => y.includes(w) && w !== x[x.length - 1]));
}

interface Activity { id: string; type?: string; start_date_local?: string; distance?: number; elapsed_time?: number; moving_time?: number; race?: boolean }

/** The race_secs stretch of the file that covers the most distance (sync.race_window's window). */
export function windowOf(t: number[], d: number[] | undefined, raceSecs: number): { start: number; span: number; metres: number; dist: Float64Array } {
  const n = t[t.length - 1] + 1;
  const dist = new Float64Array(n);
  if (d) t.forEach((s, i) => { dist[s] = d[i] || 0; });
  for (let s = 1; s < n; s++) dist[s] = Math.max(dist[s], dist[s - 1]);
  const span = Math.min(raceSecs, n);
  let start = 0;
  if (d) {
    let best = -1;
    for (let s = 0; s + span <= n; s++) { const v = dist[s + span - 1] - dist[s]; if (v > best) { best = v; start = s; } }
  }
  return { start, span, metres: dist[start + span - 1] - dist[start], dist };
}

/** Port of sync.race_window: avg and NP over the race_secs stretch covering the most distance. */
export function raceWindow(t: number[], w: number[] | undefined, d: number[] | undefined, raceSecs: number): RacePower | null {
  if (!t?.length || !w?.some((x) => x)) return null;
  const { start, span } = windowOf(t, d, raceSecs);
  const watts = new Float64Array(t[t.length - 1] + 1);
  t.forEach((s, i) => { watts[s] = w[i] || 0; });
  const win = watts.subarray(start, start + span);
  if (!win.some((x) => x)) return null;
  const avg = win.reduce((a, b) => a + b, 0) / win.length;
  let acc = 0, sum4 = 0, k = 0;
  for (let i = 0; i < win.length; i++) {
    acc += win[i] - (i >= 30 ? win[i - 30] : 0);
    if (i >= 29) { sum4 += (acc / 30) ** 4; k++; }
  }
  return { ap: Math.round(avg), np: Math.round(k ? (sum4 / k) ** 0.25 : avg) };
}

export const TRACK_STEP = 5; // seconds between track points, as season_clip.py

/** Speed and the GPS track over the race window, for the season clip (port of season_clip.track).
 *  Speed = GPS distance in the window / official time, only when the file covers the whole race. */
export function raceTrack(t: number[], lat: number[] | undefined, lng: number[] | undefined, d: number[] | undefined, raceSecs: number): RaceTrack | null {
  if (!t?.length) return null;
  const { start, span, metres } = windowOf(t, d, raceSecs);
  const whole = span === raceSecs && metres > 0;
  const out: RaceTrack = { speed: whole ? Math.round((metres / raceSecs) * 36) / 10 : null, km: metres > 0 ? Math.round(metres / 100) / 10 : null, pts: [] };
  if (!lat?.length || !lng?.length) return out.speed ? out : null;
  const pos: ([number, number] | undefined)[] = new Array(t[t.length - 1] + 1);
  t.forEach((s, i) => { if (lat[i] && lng[i]) pos[s] = [lat[i], lng[i]]; });
  let last: [number, number] | undefined;
  for (let s = start; s < start + span && !last; s++) last = pos[s];
  if (!last) return out.speed ? out : null;
  for (let s = start; s < start + span; s++) {
    last = pos[s] || last;
    if ((s - start) % TRACK_STEP === 0) out.pts.push([Math.round(last[0] * 1e5) / 1e5, Math.round(last[1] * 1e5) / 1e5]);
  }
  return out;
}

export async function fetchRacePower(key: string, rows: Result[], rider: string | null, onProgress?: (done: number, total: number) => void, withTracks = false): Promise<PowerFetch> {
  const me = await get<{ id?: string; name?: string }>(key, "/athlete/0");
  // A key only shows its owner's rides; never put them on someone else's page.
  // Pass rider = null once the person has confirmed that an unfamiliar account name is theirs.
  if (rider && me.name && !sameName(me.name, rider)) throw new NameMismatch(me.name);
  const dates = rows.map((r) => r.date).sort();
  const acts = await get<Activity[]>(key, `/athlete/0/activities?oldest=${dates[0]}&newest=${dates[dates.length - 1]}`);
  const power = new Map<string, RacePower>(), tracks = new Map<string, RaceTrack>();
  let done = 0, missing = 0, failed = 0;
  await eachLimited(rows, 3, async (r) => {
    const t = secs(r.time), dm = r.km ? r.km * 1000 : null;
    const cands = acts.filter((a) => RIDE_TYPES.has(a.type || "") && (a.start_date_local || "").slice(0, 10) === r.date);
    const score = (a: Activity) => (dm ? Math.abs((a.distance || 0) - dm) / dm : 0) + Math.abs((a.elapsed_time || a.moving_time || 0) - t) / t + (a.race ? 0 : 0.05);
    const best = t > 0 ? cands.sort((a, b) => score(a) - score(b))[0] : undefined;
    if (!best) missing++;
    else {
      try {
        const s = await get<{ type: string; data: number[]; data2?: number[] }[]>(key, `/activity/${best.id}/streams.json?types=time,watts,distance${withTracks ? ",latlng" : ""}`);
        const by = Object.fromEntries(s.map((x) => [x.type, x.data]));
        const p = raceWindow(by.time, by.watts, by.distance, t);
        if (p) power.set(raceKey(r), p); else missing++;
        if (withTracks) {
          const tr = raceTrack(by.time, by.latlng, s.find((x) => x.type === "latlng")?.data2, by.distance, t);
          if (tr) tracks.set(raceKey(r), tr);
        }
      } catch (e) {
        if (e instanceof IcuError) throw e;
        failed++; // one bad file should not lose the rest
      }
    }
    onProgress?.(++done, rows.length);
  });
  return { athlete: me.name || "", athleteId: String(me.id || ""), power, tracks, missing, failed };
}
