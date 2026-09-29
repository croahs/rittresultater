// Race power riders have chosen to save on the site (functions/api/power.ts, Cloudflare D1).
// Without the database (local dev, the artifact preview) everything here quietly says "not enabled".

import type { RacePower } from "./intervals";

export interface Saved { enabled: boolean; power: Map<string, RacePower> }
export interface SaveResult { saved: number; of: number; skipped: number; failed: number; power: Map<string, RacePower> }

const API = "api/power";
const none: Saved = { enabled: false, power: new Map() };
const cache = new Map<string, Promise<Saved>>();

type Row = { race_key: string; np: number; ap: number };
const toMap = (rows: Row[]) => new Map(rows.map((r) => [r.race_key, { np: r.np, ap: r.ap }]));

export function getSaved(rider: string): Promise<Saved> {
  if (!cache.has(rider)) {
    cache.set(rider, fetch(`${API}?rider=${encodeURIComponent(rider)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return none;
        const b = await r.json() as { enabled?: boolean; rows?: Row[] };
        return { enabled: !!b.enabled, power: toMap(b.rows || []) };
      })
      .catch(() => none));
  }
  return cache.get(rider)!;
}

async function call<T>(method: "POST" | "DELETE", key: string, rider: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ key, rider }) });
  } catch { throw new Error("Fikk ikke kontakt med siden. Prøv igjen."); }
  const b = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(b.error || `Noe gikk galt (${r.status}).`);
  cache.delete(rider);
  return b;
}

export async function savePower(key: string, rider: string): Promise<SaveResult> {
  const b = await call<Omit<SaveResult, "power"> & { rows: Row[] }>("POST", key, rider);
  return { saved: b.saved, of: b.of, skipped: b.skipped, failed: b.failed, power: toMap(b.rows) };
}

export async function deletePower(key: string, rider: string): Promise<number> {
  return (await call<{ deleted: number }>("DELETE", key, rider)).deleted;
}
