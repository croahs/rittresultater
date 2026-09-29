// GET /api/clip?rider=<id>&year=<yyyy>: the season clip (the same shape as the static
// data/clips/<id>-<year>.json) built from GPS tracks the rider saved through /api/track.

import { athleteFor, json, riderFrom, tables, type Ctx } from "../../server/lib";
import { TRACK_STEP, raceKeyOf } from "../../src/intervals";

const secs = (t: string) => t.split(":").reduce((s, p) => s * 60 + Number(p), 0);

export async function onRequestGet(ctx: Ctx) {
  const { request, env } = ctx;
  const q = new URL(request.url).searchParams, year = Number(q.get("year"));
  if (!env.DB) return json({ error: "Lagring er ikke satt opp." }, 404);
  const rider = await riderFrom(ctx, q.get("rider"));
  if (!rider || !(year > 2000 && year < 2100)) return json({ error: "Ukjent rytter eller år." }, 400);
  await tables(env.DB, ctx);
  const { results } = await env.DB.prepare("SELECT race_key, km, pts FROM ride WHERE rider_id = ? AND race_key LIKE ?")
    .bind(rider, `${year}-%`).all<{ race_key: string; km: number | null; pts: string }>();
  const a = await athleteFor(ctx, rider);
  if (!a) return json({ error: "Fant ikke rytteren." }, 404);
  const byKey = new Map(results.map((r) => [r.race_key, r]));
  // Tracks are spliced in as stored text: parsing them would cost CPU the free plan doesn't have.
  const races: string[] = [], skipped: string[] = [];
  for (const r of a.results.filter((x) => x.year === year)) {
    const ride = byKey.get(raceKeyOf(r));
    if (!ride || ride.pts.length <= 2) { skipped.push(r.race); continue; }
    const head = JSON.stringify({ name: r.race, date: r.date, type: r.type, time: secs(r.time), place: r.place, field: r.field, km: r.km ?? ride.km ?? 0 });
    races.push(`${head.slice(0, -1)},"pts":${ride.pts}}`);
  }
  return new Response(`{"year":${year},"step":${TRACK_STEP},"races":[${races.join(",")}],"skipped":${JSON.stringify(skipped)}}`,
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
