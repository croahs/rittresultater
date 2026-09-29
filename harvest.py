"""Nightly harvest: the result list of every cycling race in Norway, found from the timers' own
calendars, so a rider's races are found without anyone knowing what the races were called.

Pedår, 2026-09-29: the whole country, EQ Timing, raceresult and Ultimate, fetched at night with
long pauses. Only scheduled jobs run this (.github/workflows/harvest.yml); nothing on the site
can trigger it.

  EQ Timing   calendar: the official API, api.eqtiming.com/api/v2/Events (open, no key), every
              event of Norges Cykleforbund (organizationId 13) with results, road, MTB, cyclocross
              and gravel. Result lists: live.eqtiming.com/api (as eqtiming.py) until EQ gives us a
              key for the official result endpoints, which answer 403 without one.
  raceresult  calendar: my.raceresult.com/RREvents/list (the events page's own call), Norway
              (country 578), cycling, MTB and cyclocross. Result lists: every list named as results.
  Ultimate    no open calendar (its API needs an agreement), so Ultimate races are still added
              by hand in data/registry.json.

A published list doesn't change, so each race is fetched once and kept for good, compactly, in
its own file, cache/harvest/<source>/<year>/<id>.json.gz, written once and never again. That
folder is the branch "harvest" (checked out there by the workflow), not main, so the lists
(tens of MB for the whole country) never weigh on the site's repository. The calendar
(cache/harvest/calendar.json) is read once per past year; this year and last year are read
again every night, for new and late-published races.

  python3 harvest.py [minutes]     read calendars, then fetch lists until the time is up (default 330)
  python3 harvest.py status        what is in the calendar and what is fetched
"""
import datetime
import gzip
import json
import os
import random
import sys
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "cache", "harvest")
CALENDAR = os.path.join(DIR, "calendar.json")
PAUSE = (8, 15)  # seconds between any two requests, a random number in this range (Pedår, 2026-09-29)
FIRST_YEAR = 2008  # EQ Timing's first cycling results
EQ_CAL = "https://api.eqtiming.com/api/v2/Events"
EQ_LIVE = "https://live.eqtiming.com/api"
NCF = 13  # Norges Cykleforbund in EQ Timing
EQ_SPORTS = {"Landevei", "Terreng", "Sykkelkross", "Gravel"}  # not BMX, track, downhill, enduro, trial, e-sport
RR_CAL = "https://my.raceresult.com/RREvents/list"
RR_NORWAY = 578
RR_SPORTS = {11, 2, 20}  # Cycling, Mountain Bike, Cyclocross
# raceresult lists that are something else than one race's results
RR_SKIP_LIST = ("live", "detalj", "sammenlagt", "totalt", "beste", "påmeld", "start", "deltaker", "participant", "series")

s = requests.Session()
s.headers["User-Agent"] = "rittresultater/0.1 (nightly, 8-15 s between requests; peder@holterman.no)"
_last = 0.0


class Blocked(Exception):
    """A source said no (403 or 429): the whole run stops, and nothing tries to get around it."""


def _get(url, **params):
    global _last
    time.sleep(max(0, _last + random.uniform(*PAUSE) - time.time()))
    try:
        r = s.get(url, params=params, timeout=120)
    finally:
        _last = time.time()
    if r.status_code in (403, 429) and not url.startswith(EQ_CAL):
        raise Blocked(f"{r.status_code} from {url}")
    r.raise_for_status()
    return r.json()


def _load(path, default):
    try:
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    if path.endswith(".gz"):
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=9) as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    else:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=0, sort_keys=True)
    os.replace(tmp, path)


# --- calendars -------------------------------------------------------------------------------

def eq_year(year):
    """{"eq:<id>": event} for one year's NCF cycling events that have results."""
    out = {}
    for e in _get(EQ_CAL, organizationId=NCF, dateFrom=f"{year}-01-01", dateTo=f"{year}-12-31", take=10000):
        sport = ((e.get("Sport") or {}).get("Parent") or {}).get("Name")
        if sport not in EQ_SPORTS or not (e.get("Meta") or {}).get("GotResults"):
            continue
        out[f"eq:{e['Id']}"] = {"name": (e.get("Name") or "").strip(), "date": e["Date"][:10], "sport": sport,
                                "level": (e.get("Sportlevel") or {}).get("Name"),
                                "organizer": (e.get("Organizer") or {}).get("Name"),
                                "place": ((e.get("City") or {}).get("Name") or "").strip()}
    return out


def rr_year(year):
    """{"rr:<id>": event} for one year's cycling events in Norway on raceresult, held by now."""
    out, today = {}, datetime.date.today().isoformat()
    for group in _get(RR_CAL, year=year, country=RR_NORWAY, modes="", limit=1000, lang="en") or []:
        for e in group.get("Events") or []:
            if e.get("eventType") in RR_SPORTS and e.get("dateFrom", "9") <= today:
                out[f"rr:{e['id']}"] = {"name": e["name"].strip(), "date": e["dateFrom"], "sport": e.get("eventTypeName"),
                                        "level": None, "organizer": None, "place": (e.get("location") or "").strip()}
    return out


def read_calendars(log=print):
    """Add every new race in the timers' calendars to cache/harvest/calendar.json."""
    cal = _load(CALENDAR, {"years": {}, "events": {}})
    this = datetime.date.today().year
    for src, fetch in (("eq", eq_year), ("rr", rr_year)):
        for year in range(FIRST_YEAR, this + 1):
            if f"{src}:{year}" in cal["years"] and year < this - 1:
                continue
            try:
                found = fetch(year)
            except (requests.RequestException, ValueError) as x:
                log(f"calendar {src} {year}: {x}")
                continue
            new = {k: v for k, v in found.items() if k not in cal["events"]}
            cal["events"].update(new)
            cal["years"][f"{src}:{year}"] = len(found)
            if new:
                log(f"calendar {src} {year}: {len(new)} new of {len(found)}")
    _dump(CALENDAR, cal)
    return cal


# --- result lists ----------------------------------------------------------------------------

def path(key, date):
    """The file of one race's lists."""
    src, eid = key.split(":")
    return os.path.join(DIR, src, date[:4], f"{eid}.json.gz")


def lists(key, date):
    """One race's lists as fetched (eq_event() or rr_event()), or None when not fetched yet."""
    return _load(path(key, date), None)


def eq_event(event_id):
    """{stage id: {"name", "km", "rows": [[rider id, name, club, age class, status, ms, group]]}}.
    Anonymised riders (they asked EQ) keep their row with no name or club."""
    e = _get(f"{EQ_LIVE}/Event/{event_id}")
    out = {}
    for sid, st in (e.get("Etapper") or {}).items():
        items = _get(f"{EQ_LIVE}/Result/Total/{event_id}/{sid}", count=99999).get("Items") or []
        rows = []
        for i in items:
            d = i["Deltaker"]
            anon = d.get("Anonym")
            club = (d.get("Klubbnavn") or d.get("KlubbTeamFormatert") or (d.get("Klubb") or {}).get("Navn")
                    or ((d.get("Utover") or {}).get("Klubb") or {}).get("Navn") or "").strip()
            rows.append([d["Utover"]["UID"], None if anon else (d["Utover"].get("NavnFormatert") or ""),
                         None if anon else club, (d.get("Klasse") or {}).get("Navn") or "", i.get("StatusTekst"),
                         i.get("AkkumulertTidGlattet") or i.get("AkkumulertTid"), ((d.get("Pulje") or {}).get("Navn") or "").strip()])
        out[sid] = {"name": st.get("Navn") or "", "km": st.get("Km") or None, "rows": rows}
    return out


def rr_event(event_id):
    """{list name: {"fields": [column expressions], "groups": {group: [rows]}}} for every results list.
    Kept as raceresult gives them (lists differ from race to race); reading them is for later."""
    conf = _get(f"https://my.raceresult.com/{event_id}/RRPublish/data/config", page="results", noVisitor=1)
    out = {}
    for l in conf.get("lists") or []:
        name = l.get("Name") or ""
        if any(w in name.lower() for w in RR_SKIP_LIST):
            continue
        r = _get(f"https://{conf['server']}/{event_id}/results/list", key=conf["key"], listname=name,
                 contest=l.get("Contest") or "0", r="all", l="0")
        groups = r.get("data") or {}
        if isinstance(groups, list):
            groups = {"": groups}
        # One level of nesting (contest, then class) is common: flatten it to "contest / class".
        flat = {}
        for g, v in groups.items():
            if isinstance(v, dict):
                for g2, rows in v.items():
                    flat[f"{g} / {g2}"] = rows
            else:
                flat[g] = v
        out[name] = {"fields": r.get("DataFields") or [], "groups": flat}
    return out


def fetch_lists(minutes, log=print):
    """Fetch the lists of calendar races not fetched yet, oldest first, until the time is up.
    A race whose lists can't be read is marked and tried again after 30 days."""
    cal = _load(CALENDAR, {"years": {}, "events": {}})
    stop = time.time() + minutes * 60
    today = datetime.date.today()
    done = 0
    todo = sorted((v["date"], k) for k, v in cal["events"].items()
                  if not v.get("fetched") and (not v.get("failed") or
                     (today - datetime.date.fromisoformat(v["failed"])).days >= 30))
    for date, key in todo:
        if time.time() > stop:
            break
        src, eid = key.split(":")
        try:
            got = eq_event(eid) if src == "eq" else rr_event(eid)
        except Blocked as x:
            log(f"harvest stopped: {x}. Nothing more is fetched until someone looks at it.")
            _dump(CALENDAR, cal)
            sys.exit(1)
        except (requests.RequestException, ValueError, KeyError, TypeError) as x:
            log(f"{key} {cal['events'][key]['name']}: {x}")
            cal["events"][key]["failed"] = today.isoformat()
            continue
        _dump(path(key, date), got)
        cal["events"][key]["fetched"] = today.isoformat()
        cal["events"][key].pop("failed", None)
        done += 1
        if done % 50 == 0:  # save as we go, so a stopped run keeps what it fetched
            _dump(CALENDAR, cal)
    _dump(CALENDAR, cal)
    left = sum(1 for v in cal["events"].values() if not v.get("fetched"))
    log(f"harvest: {done} races fetched, {left} left")
    return done, left


def status():
    cal = _load(CALENDAR, {"years": {}, "events": {}})
    by = {}
    for k, v in cal["events"].items():
        b = by.setdefault((k.split(":")[0], v["date"][:4]), [0, 0])
        b[0] += 1
        b[1] += bool(v.get("fetched"))
    for (src, y), (n, f) in sorted(by.items()):
        print(f"{src} {y}: {f}/{n} fetched")


if __name__ == "__main__":
    if sys.argv[1:] == ["status"]:
        status()
    else:
        read_calendars()
        fetch_lists(float(sys.argv[1]) if sys.argv[1:] else 330)
