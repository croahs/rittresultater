-- Initial D1 schema for rittresultater (Cloudflare Pages Functions).
-- Apply with: npx wrangler d1 migrations apply rittresultater --remote

CREATE TABLE IF NOT EXISTS owner (
  rider_id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  show_power INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS power (
  rider_id TEXT NOT NULL,
  race_key TEXT NOT NULL,
  np INTEGER NOT NULL,
  ap INTEGER NOT NULL,
  athlete_id TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (rider_id, race_key)
);

CREATE TABLE IF NOT EXISTS ride (
  rider_id TEXT NOT NULL,
  race_key TEXT NOT NULL,
  speed REAL,
  km REAL,
  secs INTEGER,
  pts TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (rider_id, race_key)
);

CREATE TABLE IF NOT EXISTS hits (
  ip TEXT NOT NULL,
  hour INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (ip, hour)
);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fetch_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turritt_id TEXT NOT NULL,
  name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  done_at TEXT,
  note TEXT,
  rid TEXT,
  kind TEXT NOT NULL DEFAULT 'rider',
  eq_participant_id TEXT,
  race_text TEXT,
  race_year INTEGER,
  ref TEXT
);
