// GET /api/alle/sok?q=, /api/alle/rytter/<EQ id>, /api/alle/ritt/<EQ event>: every harvested race and
// its riders, from the tables alle.py loads into D1 every night. Read only, a row or two per call.
// Long values are split over rows (part 0, 1, ...), joined here in order.

import { json, type Ctx, type D1 } from "../../../server/lib";
import { RIDER_BUCKETS, lookupWord, matches, rowFor, searchKeys, type AlleRider, type SearchRow } from "../../../src/alle";

const CACHE = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" };

async function joined(db: D1, table: string, col: string, keys: (string | number)[]): Promise<Map<string, string>> {
  const marks = keys.map(() => "?").join(",");
  const r = await db.prepare(`SELECT ${col} AS k, body FROM ${table} WHERE ${col} IN (${marks}) ORDER BY ${col}, part`)
    .bind(...keys).all<{ k: string | number; body: string }>();
  const out = new Map<string, string>();
  for (const row of r.results) out.set(String(row.k), (out.get(String(row.k)) ?? "") + row.body);
  return out;
}

export async function onRequestGet(ctx: Ctx) {
  const db = ctx.env.DB;
  if (!db) return json({ error: "Databasen er ikke satt opp på denne siden." }, 503);
  const url = new URL(ctx.request.url);
  const [what, id] = url.pathname.replace(/^\/api\/alle\/?/, "").split("/");
  try {
    if (what === "sok") {
      const q = (url.searchParams.get("q") || "").slice(0, 80);
      const word = lookupWord(q);
      if (word.length < 2) return json([]);
      const raw = await joined(db, "alle_search", "prefix", searchKeys(word));
      const rows = new Map<string, SearchRow>([...raw].map(([k, v]) => [k, JSON.parse(v) as SearchRow]));
      const hits = rowFor(word, rows);
      return new Response(JSON.stringify(hits ? matches(q, hits) : []), { headers: CACHE });
    }
    if (what === "rytter" && /^\d{1,10}$/.test(id || "")) {
      const uid = Number(id);
      const raw = await joined(db, "alle_rider", "bucket", [uid % RIDER_BUCKETS]);
      const bucket = raw.get(String(uid % RIDER_BUCKETS));
      const r = bucket ? (JSON.parse(bucket) as Record<string, Omit<AlleRider, "uid">>)[id] : undefined;
      return r ? new Response(JSON.stringify({ uid, ...r }), { headers: CACHE }) : json({ error: "Fant ikke rytteren." }, 404);
    }
    if (what === "ritt" && /^\d{1,10}$/.test(id || "")) {
      const body = (await joined(db, "alle_race", "id", [`eq:${id}`])).get(`eq:${id}`);
      return body ? new Response(body, { headers: CACHE }) : json({ error: "Fant ikke rittet." }, 404);
    }
  } catch (e) {
    // The tables aren't there until the first load (alle.py); until then nothing is found.
    if (/no such table/i.test(String(e))) return what === "sok" ? json([]) : json({ error: "Ikke lastet inn ennå." }, 404);
    throw e;
  }
  return json({ error: "Fant ikke." }, 404);
}
