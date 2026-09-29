// POST /api/track {token, rider, race_key, pts}: the 5 s GPS track over one race's
// window, for the season clip. Only for races the save (/api/power) found a real ride for. One race per call keeps
// each request small. The token comes from a successful /api/power save and is valid
// for 30 minutes, so tracks need neither the API key nor a call to intervals.icu.

import { NO_DB, body, json, readToken, tables, type Ctx } from "../../server/lib";

const MAX_PTS = 8 * 3600 / 5; // an 8 hour race at one point per 5 s
const okPts = (p: unknown): p is [number, number][] => Array.isArray(p) && p.length <= MAX_PTS
  && p.every((x) => Array.isArray(x) && x.length === 2 && Math.abs(x[0]) <= 90 && Math.abs(x[1]) <= 180);

export async function onRequestPost({ request, env }: Ctx) {
  if (!env.DB) return NO_DB();
  const b = await body<{ token?: unknown; race_key?: unknown; pts?: unknown }>(request, 400_000, true);
  if (!b) return json({ error: "Ugyldig forespørsel." }, 400);
  if (typeof b.race_key !== "string" || !/^\d{4}-\d\d-\d\d\|.{1,120}$/.test(b.race_key)
    || !okPts(b.pts)) return json({ error: "Ugyldig spor." }, 400);
  await tables(env.DB);
  const athlete = await readToken(env.DB, b.token, b.rider);
  if (!athlete) return json({ error: "Lagre på nytt: tillatelsen er utløpt." }, 403);
  await env.DB.prepare("UPDATE ride SET pts = ? WHERE rider_id = ? AND race_key = ? AND athlete_id = ?")
    .bind(JSON.stringify(b.pts), b.rider, b.race_key, athlete).run();
  return json({ saved: 1 });
}
