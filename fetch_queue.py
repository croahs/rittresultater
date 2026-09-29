"""Process the site's queue: «Hent alle mine ritt» and «Fant du deg ikke?» requests.

The site only queues a request (D1 table fetch_requests, behind a bot check and a daily
cap); it never scrapes. This script, run by .github/workflows/fetch-queue.yml, takes at
most MAX_PER_RUN requests and builds each rider with update.py, which fetches only result
lists that aren't cached yet, 2 s apart. Sources are the original timing systems, never
Turritt (a competitor; turritt.LIVE is off). A request is one of (column kind):
- rider: a rider already in our lists (rid, data/aliases.json) asks for all their races:
  EQ Timing including kermesse (when exactly one EQ profile has their name), SSK Cup, and by
  name in the races listed in data/registry.json (EQ Timing, raceresult, Ultimate).
- eq_profile: someone not in our lists gives their EQ Timing profile (eq_participant_id).
  One request reads the profile's races; the newest MAX_LISTS cycling races with results are
  added to the registry and read, and the rider gets an id of ours.
- freetext: a name and one race they rode (race_text, race_year). EQ Timing's calendar is
  searched for that race by name (one request); when exactly one cycling event that year has
  results and the name is in it, it goes as eq_profile. Otherwise the request is left as
  needs_source, for a race to be added to the registry by hand.
No EQ ids are ever tried in turn: only what one profile or one named race points to is read.
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

import build
import eqtiming
import raceresult
import registry
import riderids
import sskcup
import update

MAX_PER_RUN = 3
MAX_LISTS = 30  # new result lists one request may fetch (profile, race search and build together)
MAX_STAGES = 12  # stages searched for a name in one race named in words
SINCE = 2005
SCHEMA = """CREATE TABLE IF NOT EXISTS fetch_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, turritt_id TEXT NOT NULL, name TEXT NOT NULL,
  requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', done_at TEXT, note TEXT)"""
# The site's columns (web/functions, same ALTERs): whichever runs first adds them.
NEW_COLUMNS = [("rid", "TEXT"), ("kind", "TEXT NOT NULL DEFAULT 'rider'"), ("eq_participant_id", "TEXT"),
               ("race_text", "TEXT"), ("race_year", "INTEGER"), ("ref", "TEXT")]


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


class Skip(Exception):
    """A request that ends without building anyone: (status, note)."""


def rid_for_eq(uid):
    """Our id for an EQ Timing participant id, following merged ids ("same_as"), or None."""
    rid = riderids.by_eq().get(str(uid))
    aliases = riderids.load()
    while rid and aliases.get(rid, {}).get("same_as"):
        rid = aliases[rid]["same_as"]
    return rid


def from_profile(uid, fallback_name, log):
    """(rider entry, site id) for someone known by their EQ Timing profile. Their newest MAX_LISTS
    cycling races with results go into the registry, so their rivals come from the full lists."""
    races = eqtiming.profile_races(uid, SINCE, MAX_LISTS)
    if not races:
        raise Skip("failed", "Vi fant ingen sykkelritt med resultater på denne EQ Timing-profilen.")
    name = ""
    for h in races:
        try:
            rows = eqtiming.named_list(h["ArrangementUID"], h["EtappeUID"])
        except eqtiming.BudgetSpent:
            break
        registry.add_eq(h["ArrangementUID"], [h["EtappeUID"]], h["ArrangementNavn"], h["ArrangementDato"][:10],
                        build.race_type(h["ArrangementNavn"]), "fra en EQ Timing-profil i køen på nettsiden")
        name = name or next((r[1] for r in rows if r[0] == uid and r[1]), "")
    name = name or fallback_name
    if not name:  # every profile race lists them by name, unless they are anonymised at EQ
        raise Skip("failed", "Vi fant ikke navnet på denne EQ Timing-profilen i resultatlistene.")
    riderids.build(log)  # gives them an id of ours, or links them to one they have
    rid = rid_for_eq(uid)
    alias = riderids.load().get(rid, {})
    tid = alias.get("turritt", "")
    rider = {"id": tid or rid, "rid": rid, "name": name, "turritt_id": tid or None,
             "eq_id": uid, "since": SINCE, "eq_max_lists": MAX_LISTS}
    return {k: v for k, v in rider.items() if v}, tid or rid


def from_race(text, year, name, log):
    """(EQ participant id, event) for a name in one race named in words, or Skip(needs_source)."""
    query = re.sub(r"\b(19|20)\d\d\b", " ", text).strip()
    events = eqtiming.find_events(query, year) if query else []
    if len(events) != 1:
        raise Skip("needs_source", f"Fant {'ikke rittet' if not events else 'flere ritt med det navnet'} "
                                   f"hos EQ Timing for {year}. Rittet legges inn for hånd.")
    event, ev_name, date = events[0]
    stages = eqtiming.event_stages(event)
    if not stages:
        raise Skip("needs_source", f"{ev_name} har ingen resultater hos EQ Timing. Rittet legges inn for hånd.")
    want, hits = raceresult.fold(name), {}
    for stage, _ in stages[:MAX_STAGES]:
        try:
            rows = eqtiming.named_list(event, stage)
        except eqtiming.BudgetSpent:
            break
        for r in rows:
            if r[1] and raceresult.fold(r[1]) == want and r[4] != "DNS":
                hits.setdefault(r[0], stage)
    if len(hits) != 1:
        raise Skip("needs_source", f"Vi fant {'ikke navnet' if not hits else 'flere med det navnet'} i "
                                   f"resultatlisten for {ev_name}. Det sjekkes for hånd.")
    (uid, stage), = hits.items()
    registry.add_eq(event, [stage], ev_name, date, build.race_type(ev_name), "fra et ritt oppgitt i køen på nettsiden")
    return uid


def main():
    if not all(os.environ.get(k) for k in ("CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_D1_DATABASE_ID")):
        print("queue: Cloudflare secrets not set, skipping", file=sys.stderr)
        return []
    log = lambda m: print(m, file=sys.stderr)
    d1(SCHEMA)
    for col, typ in NEW_COLUMNS:
        try:
            d1(f"ALTER TABLE fetch_requests ADD COLUMN {col} {typ}")
        except Exception:  # "duplicate column": already there
            pass
    todo = d1("SELECT id, kind, rid, turritt_id, eq_participant_id, name, race_text, race_year FROM fetch_requests "
              "WHERE status = 'queued' ORDER BY id LIMIT ?", MAX_PER_RUN)
    with open(update.RIDERS_FILE, encoding="utf-8") as f:
        conf = json.load(f)
    aliases = riderids.load()
    by_tt = {a["turritt"]: k for k, a in aliases.items() if a.get("turritt")}
    known = {r["id"] for r in conf["riders"]} | {r["rid"] for r in conf["riders"] if r.get("rid")}
    known |= {by_tt[r["turritt_id"]] for r in conf["riders"] if r.get("turritt_id") in by_tt}
    known_eq = {str(r["eq_id"]) for r in conf["riders"] if r.get("eq_id")}
    built = []
    for req in todo:
        eqtiming.list_budget = MAX_LISTS  # new result lists one request may fetch, all steps together
        kind = req.get("kind") or "rider"
        name = str(req.get("name") or "").strip()[:100]
        try:
            if kind == "rider":
                rider, site_id = from_request(req, aliases, by_tt, name)
            elif kind == "eq_profile":
                uid = str(req.get("eq_participant_id") or "")
                if not re.fullmatch(r"\d{1,12}", uid):
                    raise Skip("skipped", "ugyldig forespørsel")
                if uid in known_eq:
                    raise Skip("done", "følges allerede")
                d1("UPDATE fetch_requests SET status = 'running' WHERE id = ?", req["id"])
                rider, site_id = from_profile(int(uid), name, log)
            elif kind == "freetext":
                year, text = str(req.get("race_year") or ""), str(req.get("race_text") or "").strip()[:100]
                if not name or not text or not re.fullmatch(r"(19|20)\d\d", year):
                    raise Skip("skipped", "ugyldig forespørsel")
                d1("UPDATE fetch_requests SET status = 'running' WHERE id = ?", req["id"])
                uid = from_race(text, int(year), name, log)
                if str(uid) in known_eq:
                    raise Skip("done", "følges allerede")
                rider, site_id = from_profile(uid, name, log)
            else:
                raise Skip("skipped", "ugyldig forespørsel")
            if site_id in known or rider.get("rid") in known:
                raise Skip("done", "følges allerede")
        except Skip as s:
            finish(req["id"], *s.args)
            continue
        except Exception as e:  # EQ Timing down, a list we can't read: «Prøv igjen» on the site queues it again
            log(f"queue: request {req['id']} failed: {e}")
            finish(req["id"], "failed", "Tidtakeren svarte ikke. Prøv igjen senere.")
            continue
        d1("UPDATE fetch_requests SET status = 'running' WHERE id = ?", req["id"])
        ssk = ssk_name_for(rider["name"])
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
            known_eq.add(str(rider.get("eq_id")))
            built.append(site_id)
        except Exception as e:  # keep the rider out rather than half-built
            conf["riders"] = [r for r in conf["riders"] if r["id"] != site_id]
            with open(update.RIDERS_FILE, "w", encoding="utf-8") as f:
                json.dump(conf, f, ensure_ascii=False, indent=2)
                f.write("\n")
            finish(req["id"], "failed", str(e))
    eqtiming.list_budget = None
    return built


def from_request(req, aliases, by_tt, name):
    """(rider entry, site id) for «Hent alle mine ritt» by a rider already in our lists."""
    rid, tid = str(req.get("rid") or ""), str(req.get("turritt_id") or "")
    if rid and rid not in aliases or (not rid and not re.fullmatch(r"\d{1,12}", tid)) or not name:
        raise Skip("skipped", "ugyldig forespørsel")
    rid = rid or by_tt.get(tid, "")
    alias = aliases.get(rid, {})
    tid = alias.get("turritt") or (tid if re.fullmatch(r"\d{1,12}", tid) else "")
    site_id = tid or rid  # the site's rider ids are still TurrittIDs where there is one
    rider = {"id": site_id, "rid": rid or None, "name": name, "turritt_id": tid or None, "since": SINCE}
    rider = {k: v for k, v in rider.items() if v}
    eq = alias.get("eq") or eq_id_for(name)
    if eq:
        rider["eq_id"] = eq
    return rider, site_id


if __name__ == "__main__":
    for rid in main():
        print(rid)
