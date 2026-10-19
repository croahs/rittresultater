"""Pull a rider's race results from turritt.com.

Turritt has no API, but its pages are plain HTML and each race's result list
comes from a JSON endpoint (the one its DataTables grid calls).

Be gentle: published results never change, so every race list, race page and
rider lookup is cached for good in cache/turritt.json. A normal run makes one
live request (your rider page), plus a few only when you have a new race.
Live requests are spaced PAUSE seconds apart.

Placing rules, from the sheet's column headers ("not officials or DNS, DNF included"):
  - officials' and leisure groups (pulje "Funksjonær...", "Trimritt", "Åpen klasse") are dropped
  - DNS (placement 99998 / time 99:59:50) is dropped; DNF stays in the count
  - rank = 1 + number of riders with a strictly faster time (ties share a place)
  - "class" = the Turritt race you rode (e.g. "Tempo Bue - Bryne - Racer"); where
    that race has bike-type groups (Racer vs MTB/CX/Hybrid) only your group counts
  - "overall" = all sibling races of the same event and year
    ("X - Racer" + "X - Tempo", "X" + "X CX/Gravel")
"""
import html
import json
import os
import re
import time
from datetime import datetime

import requests
from urllib.parse import unquote_plus

BASE = "https://turritt.com/index.php"
DNS_PLACE, DNS_TIME = 99998, 359990
EXCLUDE_GROUP = re.compile(r"funksjon|trim|åpen klasse", re.I)
BIKE_GROUP = re.compile(r"mtb|hybrid|\bcx\b", re.I)

PAUSE = 2
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "turritt.json")
REGISTRY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "registry.json")

s = requests.Session()
s.headers["User-Agent"] = "rittresultater/0.1 (personal results sheet)"
_last = 0.0
try:
    with open(CACHE_FILE, encoding="utf-8") as f:
        _cache = json.load(f)
except (OSError, ValueError):
    _cache = {}


def _cached(key, fetch):
    """Return the cached value for key, or fetch, store and return it."""
    if key not in _cache:
        _cache[key] = fetch()
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
    return _cache[key]


# Pedår, 2026-09-29: Turritt is a competitor, not a source. No requests go to it; what is
# already cached is still read until the migration to the original timing sources is done.
LIVE = False
_blocked = False


def _request(method, **kw):
    global _last, _blocked
    if not LIVE:
        raise requests.ConnectionError("Turritt is not fetched from (cached lists only)")
    if _blocked:  # after one 403, don't knock again this run
        raise requests.HTTPError("403 Forbidden (Turritt blocks this network)")
    time.sleep(max(0, _last + PAUSE - time.time()))
    r = s.request(method, BASE, timeout=60, **kw)
    _last = time.time()
    _blocked = r.status_code == 403
    r.raise_for_status()
    r.encoding = "utf-8"
    return r


def _get(**params):
    return _request("GET", params=params).text


def _text(x):
    return html.unescape(re.sub(r"<[^>]+>", "", x)).strip()


def hms(sec):
    return f"{sec // 3600:02}:{sec % 3600 // 60:02}:{sec % 60:02}"


def find_rider(turritt_id, name):
    """Turritt's rider pages use an internal id; find it via the name search."""
    def fetch():
        p = _request("POST", params={"page": "turrittid_finn"}, data={"navn": name}).text
        m = re.search(r"rid=(\d+)\">%s<" % turritt_id, p)
        return m.group(1) if m else None
    return _cached(f"rider:{turritt_id}", fetch)


def rider_races(rid):
    """Every (race id, year) the rider has a result in."""
    p = _get(page="rytterdetail", current=10, su=10, rid=rid)  # the one live request per run
    out = []
    # One row per event: link to its history page, then "Antall" (races ridden).
    for series, count in re.findall(r'page=rytterritt[^"]*?ritt=([^"&]+)"[^>]*>.*?</td>\s*<td[^>]*>(\d+)</td>', p, re.S):
        series = unquote_plus(html.unescape(series))

        def fetch():
            q = _get(page="rytterritt", current=10, su=10, rytter=rid, ritt=series)
            return [(m.group(1), int(_text(td))) for td in re.findall(r"<td[^>]*>(.*?)</td>", q, re.S)
                    for m in [re.search(r"Turritt=(\d+)", td)] if m]
        out += [tuple(x) for x in _cached(f"history:{rid}:{series}:{count}", fetch)]
    return out


def cached_races(rid):
    """rider_races() from the cache alone, for when Turritt can't be reached."""
    return [tuple(x) for k, v in _cache.items() if k.startswith(f"history:{rid}:") for x in v]


def _one_off():
    """Registry rows (data/registry.json) for races read once from Turritt by hand ("one_off"),
    which no rider page in the cache lists. "laps" marks a lap race (cyclocross)."""
    with open(REGISTRY, encoding="utf-8") as f:
        return [r for r in json.load(f)["races"] if r.get("one_off")]


def one_off_races(turritt_id):
    """(race id, year) of every one-off race whose cached list has the rider."""
    return [(t, r["year"]) for r in _one_off() for t in r["turritt_ids"]
            if any(x[2] == str(turritt_id) for x in _cache.get(f"results:{t}", []))]


def fetch_one_off(race_id):
    """Fetch one race's list, date and name once into the cache, though Turritt isn't a source:
    for a race Pedår asks for by hand (KleppeKrossen 2026). Add its registry row with one_off too."""
    global LIVE
    LIVE = True
    try:
        results(race_id), race_info(race_id), race_name(race_id)
    finally:
        LIVE = False


def year_list(year, need=None):
    """[(race id, name)] of Turritt Rogaland races that year (refetched if need is missing)."""
    def fetch():
        p = _get(page="resultater", current=2, su=2, year=year)
        sel = p[p.find("Velg Turritt Rogaland"):]
        sel = sel[: sel.find("</select>")]
        return [(v, html.unescape(n)) for v, n in re.findall(r'<option value="(\d+)">([^<]*)', sel)]
    key = f"year:{year}"
    if not LIVE:  # cached lists only; a race outside them takes its name from race_name()
        return [tuple(x) for x in _cache.get(key, [])]
    if need and need not in dict(_cache.get(key, [])):
        _cache.pop(key, None)
    return [tuple(x) for x in _cached(key, fetch)]


def race_info(race_id):
    def fetch():
        t = re.sub(r"\s+", " ", _text(_get(Turritt=race_id, page="resultat", current=2, su=2)))
        return (re.search(r"Dato: (\d\d\.\d\d\.\d{4})", t).group(1), float(re.search(r"Distanse: ([\d.]+)", t).group(1)))
    d, dist = _cached(f"info:{race_id}", fetch)
    return datetime.strptime(d, "%d.%m.%Y").date(), dist


def race_name(race_id):
    """The name on the race page, for races outside the Rogaland list (year_list)."""
    def fetch():
        t = re.sub(r"\s+", " ", _text(_get(Turritt=race_id, page="resultat", current=2, su=2)))
        m = re.search(r"\} ([^{}]+?) - 20\d\d .*?Dato:", t)
        return re.sub(r"\s*Resultat$", "", m.group(1)).strip() if m else f"Turritt {race_id}"
    return _cached(f"name:{race_id}", fetch)


def results(race_id):
    """Rows: [place, class place, TurrittID, group, group place, first, last, club, class, seconds, km/h, ...]

    In a lap race (registry "laps") a lapped rider's row is cut to
    [..., ranking seconds, km/h, laps down, official seconds], as from EQ Timing (lap_rows)."""
    rows = _cached(f"results:{race_id}", lambda: _request(
        "GET", params={"page": "data_resultat", "rittid": race_id, "draw": 1, "start": 0, "length": 5000}).json()["aaData"])
    if any(r.get("laps") and str(race_id) in r["turritt_ids"] for r in _one_off()):
        rows = lap_rows(rows)
    return rows


LAPPED = 359970  # Turritt's time for a rider who didn't ride every lap (shown as no time)


def lap_rows(rows):
    """A cyclocross list from Turritt ranked by laps, then time, like eqtiming.lap_times.

    Turritt gives a time only to riders who rode every lap; the rest have LAPPED, which the
    code here would read as DNF. Columns 11-19 are the passings (lead-in, then each lap, 0 when
    none) in seconds from the start. A rider is lapped, not out, when their last passing came after
    the winner had finished: the race ended for them at that passing, laps down. One who stopped
    before that stays DNF. A lapped rider gets a ranking time: their time projected to the full
    laps, and at least a second behind the rider ahead. The official time (the last passing) is
    kept beside it for display."""
    passings = lambda r: [int(x) for x in r[11:20] if x not in ("", "0")]
    done = sorted((r for r in rows if int(r[9]) < 359000), key=lambda r: int(r[9]))
    if not done:
        return rows
    full = max(len(passings(r)) for r in done)  # laps: a finisher's passings less the lead-in, plus the finish
    lapped = sorted((r for r in rows if int(r[9]) == LAPPED and len(passings(r)) > 1 and passings(r)[-1] >= int(done[0][9])),
                    key=lambda r: (-len(passings(r)), passings(r)[-1]))
    out, prev = list(done), int(done[-1][9])
    for r in lapped:
        n, t = len(passings(r)) - 1, passings(r)[-1]
        prev = max(round(t * full / n), prev + 1)
        out.append([*r[:9], str(prev), r[10], full - n, t])
    return out + [r for r in rows if r not in done and r not in lapped]


def _counts(r):
    return int(r[0]) != DNS_PLACE and int(r[9]) != DNS_TIME and not EXCLUDE_GROUP.search(r[3] or "")


def _base(name):
    return re.sub(r"( - (Racer|Tempo)| CX/Gravel)$", "", name).strip()


def is_team(name):
    """Team time trials (lagtempo) are ranked by team, not by rider."""
    return "lagtempo" in (name or "").lower()


def as_teams(rows, key=lambda r: ""):
    """Team time trial rows with each rider's time set to their team's time, plus the team times.

    Turritt lists every rider, with the team name in the group column. A team is ranked by its
    fastest counted time (riders who are dropped keep a slower time of their own, but the team's
    result is theirs too), so teammates share a place and the field is the number of teams.
    key separates teams with the same name in different races (sibling races)."""
    best = {}
    for r in rows:
        k = (key(r), team_name(r))
        best[k] = min(best.get(k, DNS_TIME), int(r[9]))
    out = []
    for r in rows:
        r = list(r)
        r[9] = str(best[(key(r), team_name(r))])
        out.append(r)
    return out, sorted(best.values())


def team_name(r):
    """The team: the group column, or in older lists the club column ("Team / club"), or
    else the shared time, which is all teammates have in common there."""
    club = r[7] or ""
    return (r[3] or "").strip() or (club.split(" / ")[0].strip() if " / " in club else f"time {r[9]}")


def race_row(race_id, year, turritt_id):
    rows = results(race_id)
    me = next(r for r in rows if r[2] == str(turritt_id))
    t = int(me[9])
    names = dict(year_list(year, need=race_id))
    name = names.get(race_id) or race_name(race_id)
    groups = {r[3] or "" for r in rows if _counts(r)}
    split_by_bike = any(BIKE_GROUP.search(g) for g in groups) and not BIKE_GROUP.search(me[3] or "")
    cls = [r for r in rows if _counts(r) and not (split_by_bike and BIKE_GROUP.search(r[3] or ""))]
    siblings = [v for v, n in names.items() if name and _base(n) == _base(name)] or [race_id]
    overall = [r for v in siblings for r in (rows if v == race_id else results(v)) if _counts(r)]
    rank = lambda pool: 1 + sum(int(r[9]) < t for r in pool)
    if is_team(name):
        # Placed by team, within this race only: the Racer and Tempo team races are separate.
        teamed, team_times = as_teams(cls)
        t = next((int(r[9]) for r in teamed if r[2] == str(turritt_id)), t)
        cls = overall = [[""] * 9 + [str(x)] for x in team_times]
    date, dist = race_info(race_id)
    finished = t < 359000
    return {
        "turritt_race_id": race_id,
        "turritt_name": name,
        "date": date,
        "distance_km": dist,
        # A lapped rider (lap_rows) is placed by the ranking time and shown with their own.
        "time": hms(me[12] if len(me) == 13 else t) if finished else "DNF",
        "class_place": rank(cls) if finished else "",
        "class_n": len(cls),
        "overall_place": rank(overall) if finished else "",
        "overall_n": len(overall),
        "class_winner": hms(min(int(r[9]) for r in cls)),
        "age_class": me[8],
    }


if __name__ == "__main__":
    import sys
    if sys.argv[1] == "enkelt":  # python3 turritt.py enkelt <race id>
        fetch_one_off(sys.argv[2])
        sys.exit()
    tid, name = sys.argv[1], sys.argv[2]
    rid = find_rider(tid, name)
    for race_id, year in rider_races(rid):
        print(json.dumps(race_row(race_id, year, tid), default=str, ensure_ascii=False))
