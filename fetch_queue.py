"""Process «Hent alle mine ritt» requests: riders who asked, on the site, to have their races fetched.

The site only queues a request (D1 table fetch_requests, behind a bot check and a daily
cap); it never scrapes. This script, run by .github/workflows/fetch-queue.yml, takes at
most MAX_PER_RUN requests, adds each rider to riders.json (history from SINCE) and builds
them with update.py, which fetches only result lists that aren't cached yet, 2 s apart.
Sources are the original timing systems, never Turritt (a competitor; turritt.LIVE is off):
EQ Timing including kermesse (when exactly one EQ profile has their name), SSK Cup, and by
name in the races listed in data/registry.json (EQ Timing, raceresult, Ultimate).
A request names the rider by our id (rid, data/aliases.json); their TurrittID, where they
have one, is still their id on the site until it moves to our ids.
rivals.py and export_web.py then refresh the site data.

The queue is read through Cloudflare's D1 REST API, so the site needs no endpoint for
the job. Needs CF_API_TOKEN (Account · D1 · Edit), CF_ACCOUNT_ID and CF_D1_DATABASE_ID
(docs/DEPLOY.md section 6); without them it does nothing.

Usage:
  python3 fetch_queue.py         # prints the ids it built, one per line
"""
import contextlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

import requests

import eqtiming
import riderids
import sskcup
import update

MAX_PER_RUN = 3
SINCE = 2005
SCHEMA = """CREATE TABLE IF NOT EXISTS fetch_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, turritt_id TEXT NOT NULL, name TEXT NOT NULL,
  requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', done_at TEXT, note TEXT)"""


def d1(sql, *params):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CF_ACCOUNT_ID']}"
           f"/d1/database/{os.environ['CF_D1_DATABASE_ID']}/query")
    r = requests.post(url, json={"sql": sql, "params": list(params)},
                      headers={"Authorization": f"Bearer {os.environ['CF_API_TOKEN']}"}, timeout=60)
    r.raise_for_status()
    return r.json()["result"][0].get("results", [])


def fold(name):
    s = unicodedata.normalize("NFD", name.lower().replace("ø", "o").replace("æ", "ae"))
    return " ".join(re.sub(r"[̀-ͯ]", "", s).split())


def eq_id_for(name):
    """The rider's EQ Timing id when exactly one profile has exactly this name, else None."""
    try:
        hits = eqtiming._get("Participant/Search", query=name)
    except Exception:
        return None
    same = [p["UID"] for p in hits if fold(f"{p['Fornavn']} {p['Etternavn']}") == fold(name)]
    return same[0] if len(same) == 1 else None


def ssk_name_for(name):
    """The rider's name in the SSK Cup lists on raceresult, when it is there."""
    try:
        return sskcup.name_for(name)
    except Exception:
        return None


def finish(req_id, status, note):
    d1("UPDATE fetch_requests SET status = ?, done_at = ?, note = ? WHERE id = ?",
       status, datetime.now(timezone.utc).isoformat(timespec="seconds"), note[:500], req_id)


def main():
    if not all(os.environ.get(k) for k in ("CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_D1_DATABASE_ID")):
        print("queue: Cloudflare secrets not set, skipping", file=sys.stderr)
        return []
    d1(SCHEMA)
    try:  # the site adds rid (our rider id, data/aliases.json); older tables lack it
        todo = d1("SELECT id, rid, turritt_id, name FROM fetch_requests WHERE status = 'queued' ORDER BY id LIMIT ?", MAX_PER_RUN)
    except requests.HTTPError:
        todo = d1("SELECT id, turritt_id, name FROM fetch_requests WHERE status = 'queued' ORDER BY id LIMIT ?", MAX_PER_RUN)
    with open(update.RIDERS_FILE, encoding="utf-8") as f:
        conf = json.load(f)
    aliases = riderids.load()
    by_tt = {a["turritt"]: k for k, a in aliases.items() if a.get("turritt")}
    known = {r["id"] for r in conf["riders"]} | {r["rid"] for r in conf["riders"] if r.get("rid")}
    known |= {by_tt[r["turritt_id"]] for r in conf["riders"] if r.get("turritt_id") in by_tt}
    built = []
    for req in todo:
        rid, tid, name = str(req.get("rid") or ""), str(req.get("turritt_id") or ""), str(req["name"]).strip()
        if rid and rid not in aliases or (not rid and not re.fullmatch(r"\d{1,12}", tid)) or not name:
            finish(req["id"], "skipped", "ugyldig forespørsel")
            continue
        rid = rid or by_tt.get(tid, "")
        alias = aliases.get(rid, {})
        tid = alias.get("turritt") or (tid if re.fullmatch(r"\d{1,12}", tid) else "")
        site_id = tid or rid  # the site's rider ids are still TurrittIDs where there is one
        if site_id in known or (rid and rid in known):
            finish(req["id"], "done", "følges allerede")
            continue
        d1("UPDATE fetch_requests SET status = 'running' WHERE id = ?", req["id"])
        rider = {"id": site_id, "rid": rid or None, "name": name, "turritt_id": tid or None, "since": SINCE}
        rider = {k: v for k, v in rider.items() if v}
        eq = alias.get("eq") or eq_id_for(name)
        if eq:
            rider["eq_id"] = eq
        ssk = ssk_name_for(name)
        if ssk:
            rider["ssk_cup"] = {"name": ssk}
        conf["riders"].append(rider)
        with open(update.RIDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(conf, f, ensure_ascii=False, indent=2)
            f.write("\n")
        try:
            with contextlib.redirect_stdout(sys.stderr):  # stdout is only the built ids
                data = update.main((site_id,))
            n = sum(1 for r in data["races"] if r["rider_id"] == site_id)
            n += sum(1 for r in data["points_races"] if r["rider_id"] == site_id)
            if not n:
                raise RuntimeError("Vi fant ingen ritt med dette navnet hos tidtakerne vi henter fra.")
            finish(req["id"], "done", f"{n} ritt")
            known.add(site_id)
            built.append(site_id)
        except Exception as e:  # keep the rider out rather than half-built
            conf["riders"] = [r for r in conf["riders"] if r["id"] != site_id]
            with open(update.RIDERS_FILE, "w", encoding="utf-8") as f:
                json.dump(conf, f, ensure_ascii=False, indent=2)
                f.write("\n")
            finish(req["id"], "failed", str(e))
    return built


if __name__ == "__main__":
    for rid in main():
        print(rid)
