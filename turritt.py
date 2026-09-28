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


def _request(method, **kw):
    global _last
    time.sleep(max(0, _last + PAUSE - time.time()))
    r = s.request(method, BASE, timeout=60, **kw)
    _last = time.time()
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


def year_list(year, need=None):
    """[(race id, name)] of Turritt Rogaland races that year (refetched if need is missing)."""
    def fetch():
        p = _get(page="resultater", current=2, su=2, year=year)
        sel = p[p.find("Velg Turritt Rogaland"):]
        sel = sel[: sel.find("</select>")]
        return [(v, html.unescape(n)) for v, n in re.findall(r'<option value="(\d+)">([^<]*)', sel)]
    key = f"year:{year}"
    if need and need not in dict(_cache.get(key, [])):
        _cache.pop(key, None)
    return [tuple(x) for x in _cached(key, fetch)]


def race_info(race_id):
    def fetch():
        t = re.sub(r"\s+", " ", _text(_get(Turritt=race_id, page="resultat", current=2, su=2)))
        return (re.search(r"Dato: (\d\d\.\d\d\.\d{4})", t).group(1), float(re.search(r"Distanse: ([\d.]+)", t).group(1)))
    d, dist = _cached(f"info:{race_id}", fetch)
    return datetime.strptime(d, "%d.%m.%Y").date(), dist


def results(race_id):
    """Rows: [place, class place, TurrittID, group, group place, first, last, club, class, seconds, km/h, ...]"""
    return _cached(f"results:{race_id}", lambda: _request(
        "GET", params={"page": "data_resultat", "rittid": race_id, "draw": 1, "start": 0, "length": 5000}).json()["aaData"])


def _counts(r):
    return int(r[0]) != DNS_PLACE and int(r[9]) != DNS_TIME and not EXCLUDE_GROUP.search(r[3])


def _base(name):
    return re.sub(r"( - (Racer|Tempo)| CX/Gravel)$", "", name).strip()


def race_row(race_id, year, turritt_id):
    rows = results(race_id)
    me = next(r for r in rows if r[2] == str(turritt_id))
    t = int(me[9])
    names = dict(year_list(year, need=race_id))
    name = names.get(race_id, "")
    groups = {r[3] for r in rows if _counts(r)}
    split_by_bike = any(BIKE_GROUP.search(g) for g in groups) and not BIKE_GROUP.search(me[3])
    cls = [r for r in rows if _counts(r) and not (split_by_bike and BIKE_GROUP.search(r[3]))]
    siblings = [v for v, n in names.items() if name and _base(n) == _base(name)] or [race_id]
    overall = [r for v in siblings for r in (rows if v == race_id else results(v)) if _counts(r)]
    rank = lambda pool: 1 + sum(int(r[9]) < t for r in pool)
    date, dist = race_info(race_id)
    finished = t < 359000
    return {
        "turritt_race_id": race_id,
        "turritt_name": name,
        "date": date,
        "distance_km": dist,
        "time": hms(t) if finished else "DNF",
        "class_place": rank(cls) if finished else "",
        "class_n": len(cls),
        "overall_place": rank(overall) if finished else "",
        "overall_n": len(overall),
        "class_winner": hms(min(int(r[9]) for r in cls)),
        "age_class": me[8],
    }


if __name__ == "__main__":
    import sys
    tid, name = sys.argv[1], sys.argv[2]
    rid = find_rider(tid, name)
    for race_id, year in rider_races(rid):
        print(json.dumps(race_row(race_id, year, tid), default=str, ensure_ascii=False))
