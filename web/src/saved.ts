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
  const rows = [...res.power].map(([race_key, p]) => ({ race_key, np: p.np, ap: p.ap }));
  const { saved } = await call<{ saved: number }>("POST", "power", { key, rider, rows });
  let tracks = 0, done = 0;
  for (const [race_key, t] of res.tracks) {
    try {
      await call("POST", "track", { key, rider, race_key, speed: t.speed, km: t.km, pts: t.pts });
      tracks++;
    } catch { /* one track failing shouldn't lose the rest */ }
    onProgress?.(++done, res.tracks.size);
  }
  cache.delete(rider);
  return { power: saved, tracks };
}

export async function deleteRides(key: string, rider: string): Promise<number> {
  cache.delete(rider);
  return (await call<{ deleted: number }>("DELETE", "power", { key, rider })).deleted;
}
