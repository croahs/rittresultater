// Race numbers a rider has chosen to save on the site, so they stay after the page is closed.
//
//   GET    /api/power?rider=<id>                saved watts (only if the rider shows them) and speed, and the years with GPS clips
//   POST   /api/power {key, rider, rows, show}  save avg power, NP, speed and GPS distance per race
//   PATCH  /api/power {key, rider, show}        show the saved watts to everyone, or hide them again
//   DELETE /api/power {key, rider}              delete everything that intervals.icu account saved for the rider
//
// Each rider chooses whether their watts are public. Hidden watts stay saved but GET
// leaves them out; speed and the season clip don't depend on that choice.
//
// The browser works the numbers out from the rider's own intervals.icu rides
// (src/intervals.ts); the Cloudflare free plan leaves a function too little CPU to
// parse dozens of ride files itself. The server checks the key instead: it must
// belong to an intervals.icu account whose name matches the rider's name in the
// result lists, so nobody can put numbers on someone else's page. The key itself
// and the ride files are never stored. GPS tracks go through /api/track, one race
// per call, with the short-lived token a successful save returns. Checking a key is
// the only thing that reaches intervals.icu, and it is rate limited per visitor and
// in total (server/lib.ts), so bots can't use the site to hammer intervals.icu.
// Nothing here ever fetches Turritt, EQ Timing or other result sites: that stays in
// the weekly pipeline. Needs a D1 database bound as DB (docs/DEPLOY.md); without it GET answers
// {enabled: false} and the page falls back to watts that aren't saved.

import { BAD_KEY, NO_DB, account, activities, athleteFor, body, isRider, json, limited, riderOk, signToken, tables, type ActivitySummary, type Ctx } from "../../server/lib";
import { raceKeyOf, secs } from "../../src/intervals";

type Row = { race_key: string; np: number; ap: number };
type In = { race_key: string; np?: unknown; ap?: unknown; speed?: unknown; km?: unknown };
const RIDES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"]);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const within = (v: number, ref: number | undefined, lo: number, hi: number) => !!ref && v >= ref * lo && v <= ref * hi;

// The numbers are worked out in the browser, so they are checked against the whole-ride
// summaries intervals.icu gives for the same account and date. Over the race window,
// power and speed sit a bit above the whole file (no dead time before the start or
// after the finish), so the bands are wide enough for that but not for made-up numbers.
function checkPower(r: In, acts: ActivitySummary[]): Row | null {
  const np = num(r.np), ap = num(r.ap);
  if (np == null || ap == null || !Number.isInteger(np) || !Number.isInteger(ap) || ap > np + 5) return null;
  return acts.some((a) => within(np, a.icu_weighted_avg_watts, 0.85, 1.5) && within(ap, a.icu_average_watts, 0.85, 1.7))
    ? { race_key: r.race_key, np, ap } : null;
}
function checkSpeed(r: In, acts: ActivitySummary[]): number | null {
  const v = num(r.speed);
  return v != null && acts.some((a) => within(v, (a.average_speed || 0) * 3.6, 0.85, 1.6)) ? v : null;
}
function checkKm(r: In, acts: ActivitySummary[]): number | null {
  const km = num(r.km);
  return km != null && acts.some((a) => km * 1000 <= (a.distance || 0) * 1.02) ? km : null;
}

export async function onRequestGet(ctx: Ctx) {
  const { request, env } = ctx;
  const rider = new URL(request.url).searchParams.get("rider");
  if (!env.DB) return json({ enabled: false, rows: [], rides: [], clipYears: [], hidden: false });
  if (!riderOk(rider)) return json({ error: "Ukjent rytter." }, 400);
  await tables(env.DB, ctx);
  const [p, r] = await Promise.all([
    env.DB.prepare(`SELECT race_key, np, ap, (SELECT show_power FROM owner WHERE rider_id = ?1) AS shown
      FROM power WHERE rider_id = ?1`).bind(rider).all<Row & { shown: number | null }>(),
    env.DB.prepare("SELECT race_key, speed, km, length(pts) > 2 AS gps FROM ride WHERE rider_id = ?").bind(rider).all<{ race_key: string; speed: number | null; km: number | null; gps: number }>(),
  ]);
  const clipYears = [...new Set(r.results.filter((x) => x.gps).map((x) => Number(x.race_key.slice(0, 4))))].sort();
  const shown = p.results.filter((x) => x.shown).map(({ race_key, np, ap }) => ({ race_key, np, ap }));
  return json({ enabled: true, rows: shown, hidden: p.results.length > shown.length, rides: r.results.map(({ race_key, speed, km }) => ({ race_key, speed, km })), clipYears });
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return NO_DB();
  const b = await body<{ rows?: unknown; show?: unknown }>(request, 64_000);
  if (!b) return BAD_KEY();
  await tables(env.DB, ctx);
  const stop = await limited(ctx);
  if (stop) return stop;
  const me = await account(b.key);
  if (me instanceof Response) return me;
  const a = await athleteFor(ctx, b.rider);
  if (!a) return json({ error: "Fant ikke rytteren." }, 404);
  if (!isRider(me, a)) return json({ error: `Nøkkelen tilhører «${me.name}» i intervals.icu, ikke ${a.name}. Bare rytteren selv kan lagre på sin side.` }, 403);
  const raceSecs = new Map(a.results.map((r) => [raceKeyOf(r), secs(r.time) || null]));
  const keys = new Set(raceSecs.keys());
  const input = (Array.isArray(b.rows) ? b.rows as In[] : []).filter((r) => r && typeof r.race_key === "string" && keys.has(r.race_key)).slice(0, 400);
  const dates = input.map((r) => r.race_key.slice(0, 10)).sort();
  const acts = dates.length ? await activities(b.key, dates[0], dates[dates.length - 1]) : [];
  if (!acts) return json({ error: "Fikk ikke kontakt med intervals.icu. Prøv igjen." }, 502);
  const onDate = (d: string) => acts.filter((x) => RIDES.has(x.type || "") && (x.start_date_local || "").slice(0, 10) === d);
  const rows: Row[] = [], rides: { race_key: string; speed: number | null; km: number | null; secs: number | null }[] = [];
  for (const r of input) {
    const day = onDate(r.race_key.slice(0, 10));
    if (!day.length) continue; // no ride that day in this account: nothing of it is saved
    const p = checkPower(r, day);
    if (p) rows.push(p);
    rides.push({ race_key: r.race_key, speed: checkSpeed(r, day), km: checkKm(r, day), secs: raceSecs.get(r.race_key) ?? null });
  }
  const now = new Date().toISOString();
  const put = env.DB.prepare(`INSERT INTO power (rider_id, race_key, np, ap, athlete_id, saved_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (rider_id, race_key) DO UPDATE SET np = excluded.np, ap = excluded.ap, athlete_id = excluded.athlete_id, saved_at = excluded.saved_at`);
  // A ride row marks a race with a real ride that day; /api/track may then add its GPS track,
  // no longer than the official race time (secs) so nothing from before or after the race is kept.
  const ride = env.DB.prepare(`INSERT INTO ride (rider_id, race_key, speed, km, secs, pts, athlete_id, saved_at) VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
    ON CONFLICT (rider_id, race_key) DO UPDATE SET speed = excluded.speed, km = excluded.km, secs = excluded.secs, athlete_id = excluded.athlete_id, saved_at = excluded.saved_at`);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO owner (rider_id, athlete_id, show_power, saved_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (rider_id) DO UPDATE SET athlete_id = excluded.athlete_id, show_power = excluded.show_power, saved_at = excluded.saved_at`).bind(b.rider, me.id, b.show === true ? 1 : 0, now),
    ...rows.map((r) => put.bind(b.rider, r.race_key, r.np, r.ap, me.id, now)),
    ...rides.map((r) => ride.bind(b.rider, r.race_key, r.speed, r.km, r.secs, me.id, now)),
  ]);
  return json({ saved: rows.length, rides: rides.map((r) => r.race_key), token: await signToken(env.DB, b.rider, me.id) });
}

export async function onRequestPatch(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return NO_DB();
  const b = await body<{ show?: unknown }>(request, 4_000);
  if (!b || typeof b.show !== "boolean") return BAD_KEY();
  await tables(env.DB, ctx);
  const stop = await limited(ctx);
  if (stop) return stop;
  // Only the account that saved the watts can show or hide them.
  const me = await account(b.key);
  if (me instanceof Response) return me;
  const r = await env.DB.prepare("UPDATE owner SET show_power = ? WHERE rider_id = ? AND athlete_id = ?").bind(b.show ? 1 : 0, b.rider, me.id).run();
  if (!r.meta?.changes) return json({ error: "Denne intervals.icu-kontoen har ikke lagret noe her." }, 404);
  return json({ show: b.show });
}

export async function onRequestDelete(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return NO_DB();
  const b = await body(request, 4_000);
  if (!b) return BAD_KEY();
  await tables(env.DB, ctx);
  const stop = await limited(ctx);
  if (stop) return stop;
  // Whoever holds the account that saved the numbers can delete them.
  const me = await account(b.key);
  if (me instanceof Response) return me;
  const n = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM power WHERE rider_id = ?1 AND athlete_id = ?2)
    + (SELECT COUNT(*) FROM ride WHERE rider_id = ?1 AND athlete_id = ?2) AS n`).bind(b.rider, me.id).first<{ n: number }>();
  await env.DB.batch(["power", "ride", "owner"].map((t) => env.DB!.prepare(`DELETE FROM ${t} WHERE rider_id = ? AND athlete_id = ?`).bind(b.rider, me.id)));
  return json({ deleted: n?.n ?? 0 });
}
