"""Timed races whose results are on Ultimate (live.ultimate.dk), found by the rider's name.

Ultimate times Bergen-Voss. Like raceresult it has no rider profiles to look up, so the
races come from data/registry.json (registry.py) and riders are matched by name. Each event's list is
read once (1000 more riders a page, 2 s apart) and cached for good in cache/ultimate.json.
The rows have the same shape as eqtiming.races(), so build.py adds them the same way.
"""
import html
import json
import os
import re
import time

import requests

import raceresult

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(HERE, "cache", "ultimate.json")
DATA = "https://live.ultimate.dk/desktop/front/data.php"
PAUSE = 2
try:
    with open(CACHE_FILE, encoding="utf-8") as f:
        _cache = json.load(f)
except (OSError, ValueError):
    _cache = {}


def result_list(event, distance):
    """[(place or status, name, club, age class, time)] for one race, cached forever."""
    key = f"{event}:{distance}"
    if key not in _cache:
        out, start = [], 0
        while True:
            time.sleep(PAUSE)
            params = {"eventid": event, "mode": "results", "distance": distance, "category": "", "language": "no"}
            if start:
                params["results_startrecord"] = start
            r = requests.get(DATA, params=params, timeout=60)
            r.raise_for_status()
            rows = [[html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row)]
                    for row in re.findall(r'<tr id="results_row_\d+".*?</tr>', r.text)]
            # A later page repeats the rows before it (it is "show more"), so keep each rider once.
            seen = {tuple(x) for x in out}
            out += [x for x in ([c[0], c[2], c[4], c[5], c[6]] for c in rows) if tuple(x) not in seen]
            total = int(re.search(r"(\d+) deltager", r.text).group(1))
            if len(out) >= total or len(out) == start:
                break
            start = len(out)
        _cache[key] = out
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
    return _cache[key]


def _hms(t):
    h, m, s = ([0, 0] + [int(x) for x in t.split(":")])[-3:]
    return f"{h:02d}:{m:02d}:{s:02d}"


def races(entry, name):
    """The rider's result (by name) in one registry race, shaped like eqtiming.races()."""
    want = raceresult.fold(name)
    rows = result_list(entry["event"], entry.get("distance", 1))
    me = next((r for r in rows if raceresult.fold(r[1]) == want), None)
    if not me or not me[0].isdigit() or ":" not in me[4]:
        return []
    age = [r for r in rows if r[3] == me[3]]
    timed = [r for r in rows if ":" in r[4]]
    return [{
        "event_id": entry["event"], "stage_id": entry.get("distance", 1), "name": entry["name"],
        "stage": re.sub(r"\s+20\d\d$", "", entry["name"]), "group": "", "date": entry["date"],
        "class_place": int(me[0]), "class_n": len(rows),
        "age_class": me[3], "age_place": 1 + sum(1 for r in age if ":" in r[4] and _hms(r[4]) < _hms(me[4])),
        "age_n": len(age), "time": _hms(me[4]), "class_winner": min(_hms(r[4]) for r in timed),
        "url": f"https://live.ultimate.dk/desktop/front/?eventid={entry['event']}",
    }]
