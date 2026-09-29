// Shared by the Pages Functions in functions/api (kept outside functions/ so it isn't a route).

import { sameName, validKey } from "../src/intervals";
import { loadAthlete, type Athlete, type IndexRider, type Site } from "../src/data";

export interface D1Result<T> { results: T[] }
export interface D1Stmt { bind(...v: unknown[]): D1Stmt; run(): Promise<{ meta?: { changes?: number } }>; all<T>(): Promise<D1Result<T>>; first<T>(): Promise<T | null> }
export interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
export interface Env { DB?: D1; ASSETS: { fetch(req: Request | string): Promise<Response> } }
export interface Ctx { request: Request; env: Env }

// owner: the intervals.icu account allowed to save for a rider (set when the names matched),
// and whether the rider shows the saved watts to everyone (show_power; hidden by default).
// power: avg power and NP per race. ride: speed, GPS distance and the 5 s track per race.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS owner (rider_id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, show_power INTEGER NOT NULL DEFAULT 0, saved_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS power (rider_id TEXT NOT NULL, race_key TEXT NOT NULL, np INTEGER NOT NULL, ap INTEGER NOT NULL,
    athlete_id TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (rider_id, race_key))`,
  `CREATE TABLE IF NOT EXISTS ride (rider_id TEXT NOT NULL, race_key TEXT NOT NULL, speed REAL, km REAL, secs INTEGER, pts TEXT NOT NULL,
    athlete_id TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (rider_id, race_key))`,
  // hits: calls that reach intervals.icu, per visitor IP and hour ("*" = everyone), for rate limiting.
  `CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, hour INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, hour))`,
  // meta: the random secret that signs save tokens, made on first use.
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];

// Only requests that reach intervals.icu (checking a key) count. A person saving uses one;
// the tracks that follow use the signed token instead, so they never reach intervals.icu.
const PER_IP_HOUR = 10, ALL_HOUR = 200;

/** Refuse (429) when this visitor, or everyone together, has checked too many keys this hour. */
export async function limited(ctx: Ctx): Promise<Response | null> {
  const db = ctx.env.DB!;
  const hour = Math.floor(Date.now() / 3_600_000);
  const ip = ctx.request.headers.get("cf-connecting-ip") || "unknown";
  const bump = db.prepare(`INSERT INTO hits (ip, hour, n) VALUES (?, ?, 1)
    ON CONFLICT (ip, hour) DO UPDATE SET n = n + 1 RETURNING n`);
  const [mine, all] = await Promise.all([bump.bind(ip, hour).first<{ n: number }>(), bump.bind("*", hour).first<{ n: number }>()]);
  if (hour % 6 === 0) await db.prepare("DELETE FROM hits WHERE hour < ?").bind(hour - 24).run();
  if ((mine?.n ?? 0) > PER_IP_HOUR || (all?.n ?? 0) > ALL_HOUR) return json({ error: "For mange forsøk. Prøv igjen om en time." }, 429);
  return null;
}

async function secret(db: D1): Promise<CryptoKey> {
  let row = await db.prepare("SELECT v FROM meta WHERE k = 'token_secret'").first<{ v: string }>();
  if (!row) {
    const v = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('token_secret', ?)").bind(v).run();
    row = await db.prepare("SELECT v FROM meta WHERE k = 'token_secret'").first<{ v: string }>();
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(row!.v), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** A short-lived token saying "this intervals.icu account may save for this rider", so the
 *  tracks after a save don't need the API key or another call to intervals.icu. */
export async function signToken(db: D1, rider: string, athlete: string, minutes = 30): Promise<string> {
  const body = new TextEncoder().encode(JSON.stringify({ r: rider, a: athlete, e: Date.now() + minutes * 60_000 }));
  return `${b64(body)}.${b64(await crypto.subtle.sign("HMAC", await secret(db), body))}`;
}

export async function readToken(db: D1, token: unknown, rider: string): Promise<string | null> {
  if (typeof token !== "string" || token.length > 600) return null;
  const [p, sig] = token.split(".");
  try {
    const body = unb64(p);
    if (!await crypto.subtle.verify("HMAC", await secret(db), unb64(sig), body)) return null;
    const t = JSON.parse(new TextDecoder().decode(body)) as { r: string; a: string; e: number };
    return t.r === rider && t.e > Date.now() ? t.a : null;
  } catch { return null; }
}

export async function tables(db: D1) { await db.batch(SCHEMA.map((q) => db.prepare(q))); }

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const riderOk = (id: unknown): id is string => typeof id === "string" && /^\d{1,12}$/.test(id);
export const NO_DB = () => json({ error: "Lagring er ikke satt opp på denne siden ennå." }, 503);
export const BAD_KEY = () => json({ error: "Det ser ikke ut som en API-nøkkel fra intervals.icu." }, 400);

/** Parse a JSON body with a rider id and (unless noKey) a valid API key, or null. */
export async function body<T>(request: Request, maxBytes: number, noKey = false): Promise<(T & { key: string; rider: string }) | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const b = JSON.parse(text) as T & { key?: unknown; rider?: unknown };
    const key = typeof b.key === "string" ? b.key.trim() : "";
    return (noKey || validKey(key)) && riderOk(b.rider) ? { ...b, key, rider: b.rider } : null;
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

export interface ActivitySummary { type?: string; start_date_local?: string; distance?: number; average_speed?: number; icu_average_watts?: number; icu_weighted_avg_watts?: number }

/** The account's rides between two dates: whole-file summaries, used to sanity-check submitted numbers. */
export async function activities(key: string, oldest: string, newest: string): Promise<ActivitySummary[] | null> {
  try {
    const r = await fetch(`https://intervals.icu/api/v1/athlete/0/activities?oldest=${oldest}&newest=${newest}`, { headers: { Authorization: "Basic " + btoa("API_KEY:" + key) } });
    return r.ok ? await r.json() as ActivitySummary[] : null;
  } catch { return null; }
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

