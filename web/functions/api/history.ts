// "Hent alle mine ritt": a rider asks for their full race history (back to 2005) instead of only
// the races the site already has.
//
//   GET  /api/history?rider=<id>   where that rider's request stands
//   POST /api/history {rider}      put the rider in the queue
//
// A visit never fetches anything from Turritt, EQ Timing or other result sites. This only adds a
// row to fetch_requests; the daily data job (update-data workflow) works through a few requests per
// run, slowly and with cache, over Cloudflare's D1 API, and sets status, done_at and note. Only riders already in the site's
// own result lists can be queued, each once, a few per visitor per hour and a capped number per
// day in total. So the worst a bot can do is make the queue longer; the job keeps its own pace.

import { NO_DB, dataKey, json, riderFrom, staticJSON, tables, type Ctx, type D1 } from "../../server/lib";
import { makeIds, type IdMap } from "../../src/ids";
import type { IndexRider, Site } from "../../src/data";

// status: queued -> running -> done | failed | skipped (the job sets everything after queued).
// Agreed with the job's side: one open (queued or running) request per rider; name is the index's.
// rid is our rider id (the key here); turritt_id is kept filled ("" when unknown) while the job still reads it.
const QUEUE = `CREATE TABLE IF NOT EXISTS fetch_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, turritt_id TEXT NOT NULL,
  name TEXT NOT NULL, requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', done_at TEXT, note TEXT, rid TEXT)`;

/** The queue table, with the rid column added to an older table and filled in from the TurrittID. */
async function queue(db: D1, ctx: Ctx): Promise<IdMap> {
  await db.batch([db.prepare(QUEUE)]);
  const cols = await db.prepare("PRAGMA table_info(fetch_requests)").all<{ name: string }>();
  if (!cols.results.some((c) => c.name === "rid")) await db.prepare("ALTER TABLE fetch_requests ADD COLUMN rid TEXT").run();
  const map = (await staticJSON<IdMap>(ctx, "ids.json")) || {};
  const todo = await db.prepare("SELECT DISTINCT turritt_id FROM fetch_requests WHERE rid IS NULL").all<{ turritt_id: string }>();
  const ids = makeIds(map);
  const moves = todo.results.map((r) => [r.turritt_id, ids.toRid(r.turritt_id)] as const).filter((x): x is readonly [string, string] => !!x[1]);
  if (moves.length) await db.batch(moves.map(([t, rid]) => db.prepare("UPDATE fetch_requests SET rid = ? WHERE turritt_id = ? AND rid IS NULL").bind(rid, t)));
  return map;
}
const PER_IP_HOUR = 3, NEW_PER_DAY = 30;

type Row = { id: number; status: string; requested_at: string; done_at: string | null; note: string | null };


async function status(db: D1, rider: string) {
  const row = await db.prepare("SELECT id, status, requested_at, done_at, note FROM fetch_requests WHERE rid = ? ORDER BY id DESC LIMIT 1").bind(rider).first<Row>();
  if (!row) return { enabled: true, status: "none" };
  const ahead = row.status === "queued"
    ? (await db.prepare("SELECT COUNT(*) AS n FROM fetch_requests WHERE status = 'queued' AND id < ?").bind(row.id).first<{ n: number }>())?.n ?? 0
    : 0;
  const { id: _, ...rest } = row;
  return { enabled: true, ...rest, ahead };
}

export async function onRequestGet(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return json({ enabled: false, status: "none" });
  const rider = await riderFrom(ctx, new URL(request.url).searchParams.get("rider"));
  if (!rider) return json({ error: "Ukjent rytter." }, 400);
  await queue(env.DB, ctx);
  return json(await status(env.DB, rider));
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return NO_DB();
  const text = await request.text();
  let asked: unknown;
  try { asked = text.length < 200 ? (JSON.parse(text) as { rider?: unknown }).rider : null; } catch { asked = null; }
  const rider = await riderFrom(ctx, asked);
  if (!rider) return json({ error: "Ukjent rytter." }, 400);
  const db = env.DB;
  await tables(db, ctx);
  const map = await queue(db, ctx);

  const open = await db.prepare("SELECT 1 FROM fetch_requests WHERE rid = ? AND status IN ('queued', 'running')").bind(rider).first();
  if (open) return json(await status(db, rider)); // asking twice changes nothing

  // Per visitor and hour, in the same counter table as the key checks but under its own prefix.
  const hour = Math.floor(Date.now() / 3_600_000);
  const ip = "history:" + (request.headers.get("cf-connecting-ip") || "unknown");
  const mine = await db.prepare(`INSERT INTO hits (ip, hour, n) VALUES (?, ?, 1)
    ON CONFLICT (ip, hour) DO UPDATE SET n = n + 1 RETURNING n`).bind(ip, hour).first<{ n: number }>();
  if ((mine?.n ?? 0) > PER_IP_HOUR) return json({ error: "For mange forespørsler. Prøv igjen om en time." }, 429);

  const [site, index] = await Promise.all([staticJSON<Site>(ctx, "site.json"), staticJSON<IndexRider[]>(ctx, "riders/index.json")]);
  if (!site || !index) return json({ error: "Fikk ikke lest resultatlistene. Prøv igjen." }, 502);
  // Riders the pipeline follows (the job adds requested riders there) have a full profile already.
  const key = await dataKey(ctx, rider, index);
  if (key && site.profiles.includes(key)) return json({ error: "Denne rytteren har allerede hele historikken sin her." }, 409);
  const entry = key ? index.find((r) => r.id === key) : undefined;
  if (!entry) return json({ error: "Fant ikke rytteren i resultatlistene." }, 404);

  const today = new Date().toISOString().slice(0, 10);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM fetch_requests WHERE requested_at >= ?").bind(today).first<{ n: number }>();
  if ((n?.n ?? 0) >= NEW_PER_DAY) return json({ error: "Køen er full for i dag. Prøv igjen i morgen." }, 429);

  await db.prepare("INSERT INTO fetch_requests (turritt_id, rid, name, requested_at) VALUES (?, ?, ?, ?)")
    .bind(map[rider] || "", rider, entry.name, new Date().toISOString()).run();
  return json(await status(db, rider));
}
