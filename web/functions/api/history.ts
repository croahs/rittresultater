// "Hent alle mine ritt": a rider asks for their full race history (back to 2005) instead of only
// the races the site already has. «Fant du deg ikke?»: someone the search can't find asks to be added.
//
//   GET  /api/history?rider=<id>          where that rider's request stands
//   GET  /api/history?ref=<ref>           where a «Fant du deg ikke?» request stands (the ref POST gave back)
//   POST /api/history {rider}             put the rider in the queue
//   POST /api/history {eq}                a rider not on the site, by EQ Timing profile link
//   POST /api/history {name, race, year}  a rider not on the site, by name and one race they rode
//
// A visit never fetches anything from Turritt, EQ Timing or other result sites. This only adds a
// row to fetch_requests; the data job (fetch-queue workflow) works through a few requests per
// run, slowly and with cache, over Cloudflare's D1 API, and sets status, done_at and note. Only riders already in the site's
// own result lists can be queued by id, each once; a request for someone new is only text for the job to look up.
// A few per visitor per hour and a capped number per day in total, so the worst a bot can do is make
// the queue longer; the job keeps its own pace.

import { NO_DB, dataKey, json, riderFrom, staticJSON, tables, type Ctx, type D1 } from "../../server/lib";
import { makeIds, type IdMap } from "../../src/ids";
import { eqParticipant, freeText } from "../../src/find";
import type { IndexRider, Site } from "../../src/data";

// status: queued -> running -> done | failed | skipped | needs_source (the job sets everything after queued;
// needs_source: the job couldn't find the race's result list, so someone has to find it by hand).
// Agreed with the job's side: one open (queued or running) request per rider; name is the index's.
// kind: 'rider' (rid, a rider on the site), 'eq_profile' (eq_participant_id) or 'freetext' (name, race_text,
// race_year). rid is our rider id; turritt_id is kept filled ("" when unknown) while the job still reads it.
// ref is a random token the visitor gets back for a request without a rid, to look up its status.
const QUEUE = `CREATE TABLE IF NOT EXISTS fetch_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, turritt_id TEXT NOT NULL,
  name TEXT NOT NULL, requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', done_at TEXT, note TEXT, rid TEXT,
  kind TEXT NOT NULL DEFAULT 'rider', eq_participant_id TEXT, race_text TEXT, race_year INTEGER, ref TEXT)`;
// Columns added after the table first went live, added to an existing table without touching its rows.
const ADDED: [string, string][] = [["rid", "TEXT"], ["kind", "TEXT NOT NULL DEFAULT 'rider'"], ["eq_participant_id", "TEXT"],
  ["race_text", "TEXT"], ["race_year", "INTEGER"], ["ref", "TEXT"]];

/** The queue table, with newer columns added to an older table and rid filled in from the TurrittID. */
async function queue(db: D1, ctx: Ctx): Promise<IdMap> {
  await db.batch([db.prepare(QUEUE)]);
  const cols = await db.prepare("PRAGMA table_info(fetch_requests)").all<{ name: string }>();
  const have = new Set(cols.results.map((c) => c.name));
  for (const [c, type] of ADDED) if (!have.has(c)) await db.prepare(`ALTER TABLE fetch_requests ADD COLUMN ${c} ${type}`).run();
  const map = (await staticJSON<IdMap>(ctx, "ids.json")) || {};
  const todo = await db.prepare("SELECT DISTINCT turritt_id FROM fetch_requests WHERE rid IS NULL AND kind = 'rider'").all<{ turritt_id: string }>();
  const ids = makeIds(map);
  const moves = todo.results.map((r) => [r.turritt_id, ids.toRid(r.turritt_id)] as const).filter((x): x is readonly [string, string] => !!x[1]);
  if (moves.length) await db.batch(moves.map(([t, rid]) => db.prepare("UPDATE fetch_requests SET rid = ? WHERE turritt_id = ? AND rid IS NULL").bind(rid, t)));
  return map;
}
const PER_IP_HOUR = 3, NEW_PER_DAY = 30;

type Row = { id: number; status: string; requested_at: string; done_at: string | null; note: string | null };
const COLS = "id, status, requested_at, done_at, note";
const OPEN = "status IN ('queued', 'running')";
const isRef = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{22}$/.test(s);

async function statusOf(db: D1, row: Row | null) {
  if (!row) return { enabled: true, status: "none" };
  const ahead = row.status === "queued"
    ? (await db.prepare("SELECT COUNT(*) AS n FROM fetch_requests WHERE status = 'queued' AND id < ?").bind(row.id).first<{ n: number }>())?.n ?? 0
    : 0;
  const { id: _, ...rest } = row;
  return { enabled: true, ...rest, ahead };
}
const status = async (db: D1, rider: string) =>
  statusOf(db, await db.prepare(`SELECT ${COLS} FROM fetch_requests WHERE rid = ? ORDER BY id DESC LIMIT 1`).bind(rider).first<Row>());
const byRef = async (db: D1, ref: string) =>
  statusOf(db, await db.prepare(`SELECT ${COLS} FROM fetch_requests WHERE ref = ?`).bind(ref).first<Row>());

export async function onRequestGet(ctx: Ctx) {
  const { request, env } = ctx;
  const q = new URL(request.url).searchParams;
  const ref = q.get("ref");
  if (!env.DB) return json({ enabled: false, status: "none" });
  if (ref !== null) {
    if (!isRef(ref)) return json({ error: "Ukjent forespørsel." }, 400);
    await queue(env.DB, ctx);
    return json({ ...(await byRef(env.DB, ref)), ref });
  }
  const rider = await riderFrom(ctx, q.get("rider"));
  if (!rider) return json({ error: "Ukjent rytter." }, 400);
  await queue(env.DB, ctx);
  return json(await status(env.DB, rider));
}

/** Per visitor and hour, in the same counter table as the key checks but under its own prefix; then the cap per day. */
async function overLimit(db: D1, request: Request): Promise<Response | null> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const ip = "history:" + (request.headers.get("cf-connecting-ip") || "unknown");
  const mine = await db.prepare(`INSERT INTO hits (ip, hour, n) VALUES (?, ?, 1)
    ON CONFLICT (ip, hour) DO UPDATE SET n = n + 1 RETURNING n`).bind(ip, hour).first<{ n: number }>();
  if ((mine?.n ?? 0) > PER_IP_HOUR) return json({ error: "For mange forespørsler. Prøv igjen om en time." }, 429);
  const today = new Date().toISOString().slice(0, 10);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM fetch_requests WHERE requested_at >= ?").bind(today).first<{ n: number }>();
  if ((n?.n ?? 0) >= NEW_PER_DAY) return json({ error: "Køen er full for i dag. Prøv igjen i morgen." }, 429);
  return null;
}

function newRef(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!env.DB) return NO_DB();
  const text = await request.text();
  let b: Record<string, unknown> = {};
  try { const v = text.length < 1000 ? JSON.parse(text) : null; if (v && typeof v === "object") b = v as Record<string, unknown>; } catch { /* stays empty */ }
  const db = env.DB;
  if ("eq" in b || "race" in b) return findMe(ctx, db, b);
  const rider = await riderFrom(ctx, b.rider);
  if (!rider) return json({ error: "Ukjent rytter." }, 400);
  await tables(db, ctx);
  const map = await queue(db, ctx);

  const open = await db.prepare(`SELECT 1 FROM fetch_requests WHERE rid = ? AND ${OPEN}`).bind(rider).first();
  if (open) return json(await status(db, rider)); // asking twice changes nothing

  const limit = await overLimit(db, request);
  if (limit) return limit;

  const [site, index] = await Promise.all([staticJSON<Site>(ctx, "site.json"), staticJSON<IndexRider[]>(ctx, "riders/index.json")]);
  if (!site || !index) return json({ error: "Fikk ikke lest resultatlistene. Prøv igjen." }, 502);
  // Riders the pipeline follows (the job adds requested riders there) have a full profile already.
  const key = await dataKey(ctx, rider, index);
  if (key && site.profiles.includes(key)) return json({ error: "Denne rytteren har allerede hele historikken sin her." }, 409);
  const entry = key ? index.find((r) => r.id === key) : undefined;
  if (!entry) return json({ error: "Fant ikke rytteren i resultatlistene." }, 404);

  await db.prepare("INSERT INTO fetch_requests (turritt_id, rid, name, requested_at, kind) VALUES (?, ?, ?, ?, 'rider')")
    .bind(map[rider] || "", rider, entry.name, new Date().toISOString()).run();
  return json(await status(db, rider));
}

/** «Fant du deg ikke?»: a rider not on the site, by EQ profile link or by name, race and year. Only text for the job. */
async function findMe(ctx: Ctx, db: D1, b: Record<string, unknown>) {
  let row: { kind: "eq_profile" | "freetext"; eq?: string; name: string; race?: string; year?: number };
  if ("eq" in b) {
    const eq = typeof b.eq === "string" ? eqParticipant(b.eq) : null;
    if (!eq) return json({ error: "Det ser ikke ut som en profillenke fra EQ Timing. Den har «participanthistory:» og et tall i seg." }, 400);
    row = { kind: "eq_profile", eq, name: "" };
  } else {
    const f = freeText(b.name, b.race, b.year);
    if (typeof f === "string") return json({ error: f }, 400);
    row = { kind: "freetext", name: f.name, race: f.race, year: f.year };
  }
  await tables(db, ctx);
  await queue(db, ctx);

  // The same request twice gets the one already in the queue.
  const same = row.kind === "eq_profile"
    ? await db.prepare(`SELECT ref FROM fetch_requests WHERE kind = 'eq_profile' AND eq_participant_id = ? AND ${OPEN} AND ref IS NOT NULL`).bind(row.eq).first<{ ref: string }>()
    : await db.prepare(`SELECT ref FROM fetch_requests WHERE kind = 'freetext' AND lower(name) = lower(?) AND lower(race_text) = lower(?) AND race_year = ? AND ${OPEN} AND ref IS NOT NULL`)
      .bind(row.name, row.race, row.year).first<{ ref: string }>();
  if (same) return json({ ...(await byRef(db, same.ref)), ref: same.ref });

  const limit = await overLimit(db, ctx.request);
  if (limit) return limit;

  const ref = newRef();
  await db.prepare(`INSERT INTO fetch_requests (turritt_id, rid, name, requested_at, kind, eq_participant_id, race_text, race_year, ref)
    VALUES ('', NULL, ?, ?, ?, ?, ?, ?, ?)`).bind(row.name, new Date().toISOString(), row.kind, row.eq ?? null, row.race ?? null, row.year ?? null, ref).run();
  return json({ ...(await byRef(db, ref)), ref });
}
