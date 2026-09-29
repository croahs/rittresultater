// Race numbers a rider has chosen to save on the site, so they stay after the page is closed.
//
//   GET    /api/power?rider=<id>          saved watts and speed for that rider, and the years with GPS clips
//   POST   /api/power {key, rider, rows}  save avg power and NP per race
//   DELETE /api/power {key, rider}        delete everything that intervals.icu account saved for the rider
//
// The browser works the numbers out from the rider's own intervals.icu rides
// (src/intervals.ts); the Cloudflare free plan leaves a function too little CPU to
// parse dozens of ride files itself. The server checks the key instead: it must
// belong to an intervals.icu account whose name matches the rider's name in the
// result lists, so nobody can put numbers on someone else's page. The key itself
// and the ride files are never stored. GPS tracks go through /api/track, one race
// per call. Needs a D1 database bound as DB (docs/DEPLOY.md); without it GET answers
// {enabled: false} and the page falls back to watts that aren't saved.

import { BAD_KEY, NO_DB, account, athleteFor, body, isRider, json, riderOk, tables, type Ctx } from "../../server/lib";
import { raceKeyOf } from "../../src/intervals";

type Row = { race_key: string; np: number; ap: number };
const okRow = (r: Row, keys: Set<string>) => keys.has(r.race_key)
  && Number.isInteger(r.np) && Number.isInteger(r.ap) && r.np >= 30 && r.np <= 800 && r.ap >= 20 && r.ap <= r.np + 5;

export async function onRequestGet({ request, env }: Ctx) {
  const rider = new URL(request.url).searchParams.get("rider");
  if (!env.DB) return json({ enabled: false, rows: [], rides: [], clipYears: [] });
  if (!riderOk(rider)) return json({ error: "Ukjent rytter." }, 400);
  await tables(env.DB);
  const [p, r] = await Promise.all([
    env.DB.prepare("SELECT race_key, np, ap FROM power WHERE rider_id = ?").bind(rider).all<Row>(),
    env.DB.prepare("SELECT race_key, speed, km, length(pts) > 2 AS gps FROM ride WHERE rider_id = ?").bind(rider).all<{ race_key: string; speed: number | null; km: number | null; gps: number }>(),
  ]);
  const clipYears = [...new Set(r.results.filter((x) => x.gps).map((x) => Number(x.race_key.slice(0, 4))))].sort();
  return json({ enabled: true, rows: p.results, rides: r.results.map(({ race_key, speed, km }) => ({ race_key, speed, km })), clipYears });
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return NO_DB();
  const b = await body<{ rows?: unknown }>(request, 64_000);
  if (!b) return BAD_KEY();
  const me = await account(b.key);
  if (me instanceof Response) return me;
  const a = await athleteFor(ctx, b.rider);
  if (!a) return json({ error: "Fant ikke rytteren." }, 404);
  if (!isRider(me, a)) return json({ error: `Nøkkelen tilhører «${me.name}» i intervals.icu, ikke ${a.name}. Bare rytteren selv kan lagre på sin side.` }, 403);
  const keys = new Set(a.results.map(raceKeyOf));
  const rows = (Array.isArray(b.rows) ? b.rows as Row[] : []).filter((r) => okRow(r, keys));
  await tables(env.DB);
  const now = new Date().toISOString();
  const put = env.DB.prepare(`INSERT INTO power (rider_id, race_key, np, ap, athlete_id, saved_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (rider_id, race_key) DO UPDATE SET np = excluded.np, ap = excluded.ap, athlete_id = excluded.athlete_id, saved_at = excluded.saved_at`);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO owner (rider_id, athlete_id, saved_at) VALUES (?, ?, ?)
      ON CONFLICT (rider_id) DO UPDATE SET athlete_id = excluded.athlete_id, saved_at = excluded.saved_at`).bind(b.rider, me.id, now),
    ...rows.map((r) => put.bind(b.rider, r.race_key, r.np, r.ap, me.id, now)),
  ]);
  return json({ saved: rows.length });
}

export async function onRequestDelete({ request, env }: Ctx) {
  if (!env.DB) return NO_DB();
  const b = await body(request, 4_000);
  if (!b) return BAD_KEY();
  // Whoever holds the account that saved the numbers can delete them.
  const me = await account(b.key);
  if (me instanceof Response) return me;
  await tables(env.DB);
  const n = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM power WHERE rider_id = ?1 AND athlete_id = ?2)
    + (SELECT COUNT(*) FROM ride WHERE rider_id = ?1 AND athlete_id = ?2) AS n`).bind(b.rider, me.id).first<{ n: number }>();
  await env.DB.batch(["power", "ride", "owner"].map((t) => env.DB!.prepare(`DELETE FROM ${t} WHERE rider_id = ? AND athlete_id = ?`).bind(b.rider, me.id)));
  return json({ deleted: n?.n ?? 0 });
}
