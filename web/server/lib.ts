// Shared by the Pages Functions in functions/api (kept outside functions/ so it isn't a route).

import { sameName, validKey } from "../src/intervals";
import { loadAthlete, type Athlete, type IndexRider, type Site } from "../src/data";

export interface D1Result<T> { results: T[] }
export interface D1Stmt { bind(...v: unknown[]): D1Stmt; run(): Promise<unknown>; all<T>(): Promise<D1Result<T>>; first<T>(): Promise<T | null> }
export interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
export interface Env { DB?: D1; ASSETS: { fetch(req: Request | string): Promise<Response> } }
export interface Ctx { request: Request; env: Env }

// owner: the intervals.icu account allowed to save for a rider (set when the names matched).
// power: avg power and NP per race. ride: speed, GPS distance and the 5 s track per race.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS owner (rider_id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, saved_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS power (rider_id TEXT NOT NULL, race_key TEXT NOT NULL, np INTEGER NOT NULL, ap INTEGER NOT NULL,
    athlete_id TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (rider_id, race_key))`,
  `CREATE TABLE IF NOT EXISTS ride (rider_id TEXT NOT NULL, race_key TEXT NOT NULL, speed REAL, km REAL, pts TEXT NOT NULL,
    athlete_id TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (rider_id, race_key))`,
];

export async function tables(db: D1) { await db.batch(SCHEMA.map((q) => db.prepare(q))); }

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const riderOk = (id: unknown): id is string => typeof id === "string" && /^\d{1,12}$/.test(id);
export const NO_DB = () => json({ error: "Lagring er ikke satt opp på denne siden ennå." }, 503);
export const BAD_KEY = () => json({ error: "Det ser ikke ut som en API-nøkkel fra intervals.icu." }, 400);

/** Parse a JSON body with a valid key and rider id, or null. */
export async function body<T>(request: Request, maxBytes: number): Promise<(T & { key: string; rider: string }) | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const b = JSON.parse(text) as T & { key?: unknown; rider?: unknown };
    const key = typeof b.key === "string" ? b.key.trim() : "";
    return validKey(key) && riderOk(b.rider) ? { ...b, key, rider: b.rider } : null;
  } catch { return null; }
}

/** The intervals.icu account behind a key, or an error response. */
export async function account(key: string): Promise<{ id: string; name: string } | Response> {
  let r: Response;
  try {
    r = await fetch("https://intervals.icu/api/v1/athlete/0", { headers: { Authorization: "Basic " + btoa("API_KEY:" + key) } });
  } catch { return json({ error: "Fikk ikke kontakt med intervals.icu. Prøv igjen." }, 502); }
  if (r.status === 401 || r.status === 403) return json({ error: "intervals.icu godtok ikke nøkkelen." }, 400);
  if (!r.ok) return json({ error: "Fikk ikke kontakt med intervals.icu. Prøv igjen." }, 502);
  const me = await r.json() as { id?: unknown; name?: unknown };
  return { id: String(me.id || ""), name: String(me.name || "") };
}

/** A rider's results from the site's own static data files. */
export async function athleteFor(ctx: Ctx, rider: string): Promise<Athlete | null> {
  const get = async <T,>(path: string): Promise<T> => {
    const r = await ctx.env.ASSETS.fetch(new URL(`/data/${path}`, ctx.request.url).toString());
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json() as Promise<T>;
  };
  try {
    const [site, index] = await Promise.all([get<Site>("site.json"), get<IndexRider[]>("riders/index.json")]);
    return await loadAthlete(rider, site, index, get);
  } catch { return null; }
}

/** The account is this rider if the names match (the same rule as the browser's). */
export const isRider = (me: { name: string }, a: Athlete) => !!me.name && sameName(me.name, a.name);

/** The account that may save for this rider, as recorded when the names matched. */
export async function ownerOf(db: D1, rider: string): Promise<string | null> {
  return (await db.prepare("SELECT athlete_id FROM owner WHERE rider_id = ?").bind(rider).first<{ athlete_id: string }>())?.athlete_id ?? null;
}
