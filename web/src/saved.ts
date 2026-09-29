// Race numbers riders have chosen to save on the site (functions/api/power.ts, track.ts, clip.ts; Cloudflare D1).
// Without the database (local dev, the artifact preview) everything here quietly says "not enabled".
// The numbers are worked out in the browser from the rider's own intervals.icu rides; the
// server only checks that the key belongs to this rider before storing them.

import type { PowerFetch, RacePower } from "./intervals";

export interface Saved { enabled: boolean; power: Map<string, RacePower>; speed: Map<string, number>; clipYears: number[] }

const API = "api/";
const none: Saved = { enabled: false, power: new Map(), speed: new Map(), clipYears: [] };
const cache = new Map<string, Promise<Saved>>();

type Row = { race_key: string; np: number; ap: number };
type Ride = { race_key: string; speed: number | null; km: number | null };

export function getSaved(rider: string): Promise<Saved> {
  if (!cache.has(rider)) {
    cache.set(rider, fetch(`${API}power?rider=${encodeURIComponent(rider)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return none;
        const b = await r.json() as { enabled?: boolean; rows?: Row[]; rides?: Ride[]; clipYears?: number[] };
        return {
          enabled: !!b.enabled,
          power: new Map((b.rows || []).map((x) => [x.race_key, { np: x.np, ap: x.ap }])),
          speed: new Map((b.rides || []).filter((x) => x.speed != null).map((x) => [x.race_key, x.speed!])),
          clipYears: b.clipYears || [],
        };
      })
      .catch(() => none));
  }
  return cache.get(rider)!;
}

async function call<T>(method: "POST" | "DELETE", path: string, payload: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch { throw new Error("Fikk ikke kontakt med siden. Prøv igjen."); }
  const b = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(b.error || `Noe gikk galt (${r.status}).`);
  return b;
}

/** Save watts, then speed and GPS track one race at a time. Returns how many of each were saved. */
export async function saveRides(key: string, rider: string, res: PowerFetch, onProgress?: (done: number, total: number) => void): Promise<{ power: number; tracks: number }> {
  cache.delete(rider);
  const keys = new Set([...res.power.keys(), ...res.tracks.keys()]);
  const rows = [...keys].map((race_key) => {
    const p = res.power.get(race_key), t = res.tracks.get(race_key);
    return { race_key, np: p?.np, ap: p?.ap, speed: t?.speed ?? undefined, km: t?.km ?? undefined };
  });
  // The key goes to the site once; the tracks use the short-lived token it answers with.
  const { saved, rides, token } = await call<{ saved: number; rides: string[]; token: string }>("POST", "power", { key, rider, rows });
  const withPts = [...res.tracks].filter(([k, t]) => t.pts.length && rides.includes(k));
  let tracks = 0, done = 0;
  for (const [race_key, t] of withPts) {
    try {
      await call("POST", "track", { token, rider, race_key, pts: t.pts });
      tracks++;
    } catch { /* one track failing shouldn't lose the rest */ }
    onProgress?.(++done, withPts.length);
  }
  cache.delete(rider);
  return { power: saved, tracks };
}

export async function deleteRides(key: string, rider: string): Promise<number> {
  cache.delete(rider);
  return (await call<{ deleted: number }>("DELETE", "power", { key, rider })).deleted;
}
