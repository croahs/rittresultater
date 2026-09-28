// Race power straight from intervals.icu, in the browser. The API key is sent only to
// intervals.icu, kept in memory for the duration of the fetch and never stored.
// Same method as sync.py: the ride on the race date that best fits distance and time,
// then avg/NP over the official race time's stretch that covers the most distance.

import type { Result } from "./data";
import { raceKey } from "./state";

const API = "https://intervals.icu/api/v1";
const RIDE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"]);

export interface RacePower { np: number; ap: number }
export interface PowerFetch { athlete: string; power: Map<string, RacePower>; missing: number }

export const validKey = (k: string) => /^[\x21-\x7e]{8,256}$/.test(k);

const secs = (t: string) => t.split(":").reduce((s, p) => s * 60 + Number(p), 0);

async function get<T>(key: string, path: string): Promise<T> {
  const r = await fetch(API + path, { headers: { Authorization: "Basic " + btoa("API_KEY:" + key) }, credentials: "omit", referrerPolicy: "no-referrer" });
  if (r.status === 401 || r.status === 403) throw new Error("intervals.icu godtok ikke nøkkelen");
  if (!r.ok) throw new Error(`intervals.icu svarte ${r.status}`);
  return r.json() as Promise<T>;
}

interface Activity { id: string; type?: string; start_date_local?: string; distance?: number; elapsed_time?: number; moving_time?: number; race?: boolean }

/** Port of sync.race_window: avg and NP over the race_secs stretch covering the most distance. */
export function raceWindow(t: number[], w: number[] | undefined, d: number[] | undefined, raceSecs: number): RacePower | null {
  if (!t?.length || !w?.some((x) => x)) return null;
  const n = t[t.length - 1] + 1;
  const watts = new Float64Array(n), dist = new Float64Array(n);
  t.forEach((s, i) => { watts[s] = w[i] || 0; dist[s] = d ? d[i] || 0 : 0; });
  for (let s = 1; s < n; s++) dist[s] = Math.max(dist[s], dist[s - 1]);
  const span = Math.min(raceSecs, n);
  let start = 0;
  if (d) {
    let best = -1;
    for (let s = 0; s + span <= n; s++) { const v = dist[s + span - 1] - dist[s]; if (v > best) { best = v; start = s; } }
  }
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

export async function fetchRacePower(key: string, rows: Result[], onProgress?: (done: number, total: number) => void): Promise<PowerFetch> {
  const me = await get<{ name?: string }>(key, "/athlete/0");
  const dates = rows.map((r) => r.date).sort();
  const acts = await get<Activity[]>(key, `/athlete/0/activities?oldest=${dates[0]}&newest=${dates[dates.length - 1]}`);
  const power = new Map<string, RacePower>();
  let done = 0, missing = 0;
  for (const r of rows) {
    const t = secs(r.time), dm = r.km ? r.km * 1000 : null;
    const cands = acts.filter((a) => RIDE_TYPES.has(a.type || "") && (a.start_date_local || "").slice(0, 10) === r.date);
    const score = (a: Activity) => (dm ? Math.abs((a.distance || 0) - dm) / dm : 0) + Math.abs((a.elapsed_time || a.moving_time || 0) - t) / t + (a.race ? 0 : 0.05);
    const best = t > 0 ? cands.sort((a, b) => score(a) - score(b))[0] : undefined;
    if (best) {
      const s = await get<{ type: string; data: number[] }[]>(key, `/activity/${best.id}/streams.json?types=time,watts,distance`);
      const by = Object.fromEntries(s.map((x) => [x.type, x.data]));
      const p = raceWindow(by.time, by.watts, by.distance, t);
      if (p) power.set(raceKey(r), p); else missing++;
    } else missing++;
    onProgress?.(++done, rows.length);
  }
  return { athlete: me.name || "", power, missing };
}
