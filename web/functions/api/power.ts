// Saved race power, so a rider's watts stay on the site after they close the page.
//
//   GET    /api/power?rider=<id>      saved watts for that rider (anyone who can see the site)
//   POST   /api/power {key, rider}    fetch the rider's race power from intervals.icu and save it
//   DELETE /api/power {key, rider}    delete what that intervals.icu account saved for the rider
//
// Only the numbers per race are stored (avg power, NP), never the API key or the ride
// files. The server computes the numbers itself from intervals.icu, with the same code as
// the browser (src/intervals.ts), so nobody can post made-up watts, and it only saves
// when the key's intervals.icu name matches the rider's name in the result lists.
// Needs a D1 database bound as DB in the Pages project (docs/DEPLOY.md); without it
// GET answers {enabled: false} and the page falls back to watts that aren't saved.

import { IcuError, NameMismatch, fetchRacePower, validKey } from "../../src/intervals";
import { loadAthlete, type IndexRider, type Site } from "../../src/data";

interface D1Result<T> { results: T[] }
interface D1Stmt { bind(...v: unknown[]): D1Stmt; run(): Promise<unknown>; all<T>(): Promise<D1Result<T>>; first<T>(): Promise<T | null> }
interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
interface Env { DB?: D1; ASSETS: { fetch(req: Request | string): Promise<Response> } }
interface Ctx { request: Request; env: Env }

// Pages Functions may make 50 outside requests per call on the free plan: two go to
// intervals.icu for the account and the ride list, three to the site's own data files,
// and one per race for the ride file.
const MAX_RACES = 40;

const SCHEMA = `CREATE TABLE IF NOT EXISTS power (
  rider_id TEXT NOT NULL, race_key TEXT NOT NULL, np INTEGER NOT NULL, ap INTEGER NOT NULL,
  athlete_id TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (rider_id, race_key))`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const riderOk = (id: unknown): id is string => typeof id === "string" && /^\d{1,12}$/.test(id);

async function table(db: D1) { await db.prepare(SCHEMA).run(); }

async function body(request: Request): Promise<{ key: string; rider: string } | null> {
  try {
    const b = await request.json() as { key?: unknown; rider?: unknown };
    const key = typeof b.key === "string" ? b.key.trim() : "";
    return validKey(key) && riderOk(b.rider) ? { key, rider: b.rider } : null;
  } catch { return null; }
}

export async function onRequestGet({ request, env }: Ctx) {
  const rider = new URL(request.url).searchParams.get("rider");
  if (!env.DB) return json({ enabled: false, rows: [] });
  if (!riderOk(rider)) return json({ error: "Ukjent rytter." }, 400);
  await table(env.DB);
  const { results } = await env.DB.prepare("SELECT race_key, np, ap FROM power WHERE rider_id = ?").bind(rider).all<{ race_key: string; np: number; ap: number }>();
  return json({ enabled: true, rows: results });
}

export async function onRequestPost({ request, env }: Ctx) {
  if (!env.DB) return json({ error: "Lagring er ikke satt opp på denne siden ennå." }, 503);
  const b = await body(request);
  if (!b) return json({ error: "Det ser ikke ut som en API-nøkkel fra intervals.icu." }, 400);
  const get = async <T,>(path: string): Promise<T> => {
    const r = await env.ASSETS.fetch(new URL(`/data/${path}`, request.url).toString());
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json() as Promise<T>;
  };
  let a;
  try {
    const [site, index] = await Promise.all([get<Site>("site.json"), get<IndexRider[]>("riders/index.json")]);
    a = await loadAthlete(b.rider, site, index, get);
  } catch { return json({ error: "Fant ikke rytteren." }, 404); }
  const rows = a.results.slice(-MAX_RACES);
  let res;
  try {
    res = await fetchRacePower(b.key, rows, a.name); // throws NameMismatch unless the names match
  } catch (e) {
    if (e instanceof NameMismatch) return json({ error: `Nøkkelen tilhører «${e.owner}» i intervals.icu, ikke ${a.name}. Bare rytteren selv kan lagre watt på sin side.` }, 403);
    if (e instanceof IcuError) return json({ error: e.message }, 400);
    return json({ error: "Fikk ikke kontakt med intervals.icu. Prøv igjen." }, 502);
  }
  await table(env.DB);
  const now = new Date().toISOString();
  const put = env.DB.prepare(`INSERT INTO power (rider_id, race_key, np, ap, athlete_id, saved_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (rider_id, race_key) DO UPDATE SET np = excluded.np, ap = excluded.ap, athlete_id = excluded.athlete_id, saved_at = excluded.saved_at`);
  const saved = [...res.power].map(([k, p]) => ({ race_key: k, np: p.np, ap: p.ap }));
  if (saved.length) await env.DB.batch(saved.map((p) => put.bind(b.rider, p.race_key, p.np, p.ap, res.athleteId, now)));
  return json({ saved: saved.length, of: rows.length, skipped: a.results.length - rows.length, failed: res.failed, rows: saved });
}

export async function onRequestDelete({ request, env }: Ctx) {
  if (!env.DB) return json({ error: "Lagring er ikke satt opp på denne siden ennå." }, 503);
  const b = await body(request);
  if (!b) return json({ error: "Det ser ikke ut som en API-nøkkel fra intervals.icu." }, 400);
  // Deleting needs the same account that saved: whoever holds the key owns those rows.
  const r = await fetch("https://intervals.icu/api/v1/athlete/0", { headers: { Authorization: "Basic " + btoa("API_KEY:" + b.key) } });
  if (r.status === 401 || r.status === 403) return json({ error: "intervals.icu godtok ikke nøkkelen." }, 400);
  if (!r.ok) return json({ error: "Fikk ikke kontakt med intervals.icu. Prøv igjen." }, 502);
  const me = await r.json() as { id?: string };
  await table(env.DB);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM power WHERE rider_id = ? AND athlete_id = ?").bind(b.rider, String(me.id || "")).first<{ n: number }>();
  await env.DB.prepare("DELETE FROM power WHERE rider_id = ? AND athlete_id = ?").bind(b.rider, String(me.id || "")).run();
  return json({ deleted: n?.n ?? 0 });
}
