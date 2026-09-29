// POST /api/track {key, rider, race_key, speed, km, pts}: speed, GPS distance and the
// 5 s GPS track over one race's window, for the season clip. One race per call keeps
// each request small. Only the account that saved the rider's watts (/api/power) may
// save tracks for that rider.

import { BAD_KEY, NO_DB, account, body, json, ownerOf, tables, type Ctx } from "../../server/lib";

const MAX_PTS = 8 * 3600 / 5; // an 8 hour race at one point per 5 s
const okPts = (p: unknown): p is [number, number][] => Array.isArray(p) && p.length <= MAX_PTS
  && p.every((x) => Array.isArray(x) && x.length === 2 && Math.abs(x[0]) <= 90 && Math.abs(x[1]) <= 180);
const okNum = (v: unknown, lo: number, hi: number) => v === null || (typeof v === "number" && v >= lo && v <= hi);

export async function onRequestPost({ request, env }: Ctx) {
  if (!env.DB) return NO_DB();
  const b = await body<{ race_key?: unknown; speed?: unknown; km?: unknown; pts?: unknown }>(request, 400_000);
  if (!b) return BAD_KEY();
  if (typeof b.race_key !== "string" || !/^\d{4}-\d\d-\d\d\|.{1,120}$/.test(b.race_key)
    || !okNum(b.speed, 3, 80) || !okNum(b.km, 0.1, 400) || !okPts(b.pts)) return json({ error: "Ugyldig spor." }, 400);
  const me = await account(b.key);
  if (me instanceof Response) return me;
  await tables(env.DB);
  if ((await ownerOf(env.DB, b.rider)) !== me.id) return json({ error: "Lagre wattene først." }, 403);
  await env.DB.prepare(`INSERT INTO ride (rider_id, race_key, speed, km, pts, athlete_id, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (rider_id, race_key) DO UPDATE SET speed = excluded.speed, km = excluded.km, pts = excluded.pts,
      athlete_id = excluded.athlete_id, saved_at = excluded.saved_at`)
    .bind(b.rider, b.race_key, b.speed ?? null, b.km ?? null, JSON.stringify(b.pts), me.id, new Date().toISOString()).run();
  return json({ saved: 1 });
}
