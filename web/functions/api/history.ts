// "Hent alle mine ritt": a rider asks for their full race history (back to 2005) instead of only
// the races the site already has.
//
//   GET  /api/history?rider=<id>   where that rider's request stands
//   POST /api/history {rider}      put the rider in the queue
//
// A visit never fetches anything from Turritt, EQ Timing or other result sites. This only adds a
// row to history_queue; the scheduled data job works through the queue slowly and with cache
// (it owns the fetching and sets status, done_at and note). Only riders already in the site's
// own result lists can be queued, each once, a few per visitor per hour and a capped number per
// day in total. So the worst a bot can do is make the queue longer; the job keeps its own pace.

import { NO_DB, json, riderOk, tables, type Ctx } from "../../server/lib";
import type { IndexRider, Site } from "../../src/data";

// status: queued -> running -> done | failed (the job sets the last three).
const QUEUE = `CREATE TABLE IF NOT EXISTS history_queue (rider_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', done_at TEXT, note TEXT)`;
const PER_IP_HOUR = 3, NEW_PER_DAY = 30;

type Row = { status: string; requested_at: string; done_at: string | null; note: string | null };

async function staticJSON<T>(ctx: Ctx, path: string): Promise<T | null> {
  try {
    const r = await ctx.env.ASSETS.fetch(new URL(`/data/${path}`, ctx.request.url).toString());
    return r.ok ? await r.json() as T : null;
  } catch { return null; }
}

async function status(db: NonNullable<Ctx["env"]["DB"]>, rider: string) {
  const row = await db.prepare("SELECT status, requested_at, done_at, note FROM history_queue WHERE rider_id = ?").bind(rider).first<Row>();
  if (!row) return { enabled: true, status: "none" };
  const ahead = row.status === "queued"
    ? (await db.prepare("SELECT COUNT(*) AS n FROM history_queue WHERE status = 'queued' AND requested_at < ?").bind(row.requested_at).first<{ n: number }>())?.n ?? 0
    : 0;
  return { enabled: true, ...row, ahead };
}

export async function onRequestGet({ request, env }: Ctx) {
  const rider = new URL(request.url).searchParams.get("rider");
  if (!env.DB) return json({ enabled: false, status: "none" });
  if (!riderOk(rider)) return json({ error: "Ukjent rytter." }, 400);
  await env.DB.batch([env.DB.prepare(QUEUE)]);
  return json(await status(env.DB, rider));
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return NO_DB();
  const text = await request.text();
  let rider: unknown;
  try { rider = text.length < 200 ? (JSON.parse(text) as { rider?: unknown }).rider : null; } catch { rider = null; }
  if (!riderOk(rider)) return json({ error: "Ukjent rytter." }, 400);
  const db = env.DB;
  await tables(db);
  await db.batch([db.prepare(QUEUE)]);

  const known = await db.prepare("SELECT 1 FROM history_queue WHERE rider_id = ?").bind(rider).first();
  if (known) return json(await status(db, rider)); // asking twice changes nothing

  // Per visitor and hour, in the same counter table as the key checks but under its own prefix.
  const hour = Math.floor(Date.now() / 3_600_000);
  const ip = "history:" + (request.headers.get("cf-connecting-ip") || "unknown");
  const mine = await db.prepare(`INSERT INTO hits (ip, hour, n) VALUES (?, ?, 1)
    ON CONFLICT (ip, hour) DO UPDATE SET n = n + 1 RETURNING n`).bind(ip, hour).first<{ n: number }>();
  if ((mine?.n ?? 0) > PER_IP_HOUR) return json({ error: "For mange forespørsler. Prøv igjen om en time." }, 429);

  const [site, index] = await Promise.all([staticJSON<Site>(ctx, "site.json"), staticJSON<IndexRider[]>(ctx, "riders/index.json")]);
  if (!site || !index) return json({ error: "Fikk ikke lest resultatlistene. Prøv igjen." }, 502);
  if (site.profiles.includes(rider)) return json({ error: "Denne rytteren har allerede hele historikken sin her." }, 409);
  if (!index.some((r) => r.id === rider)) return json({ error: "Fant ikke rytteren i resultatlistene." }, 404);

  const today = new Date().toISOString().slice(0, 10);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM history_queue WHERE requested_at >= ?").bind(today).first<{ n: number }>();
  if ((n?.n ?? 0) >= NEW_PER_DAY) return json({ error: "Køen er full for i dag. Prøv igjen i morgen." }, 429);

  await db.prepare("INSERT OR IGNORE INTO history_queue (rider_id, requested_at) VALUES (?, ?)").bind(rider, new Date().toISOString()).run();
  return json(await status(db, rider));
}
