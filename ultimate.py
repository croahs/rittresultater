"""Timed races whose results are on Ultimate (live.ultimate.dk), found by the rider's name.

Ultimate times Bergen-Voss. Like raceresult it has no rider profiles to look up, so the
races come from data/registry.json (registry.py) and riders are matched by name. Each event's list is
read once (1000 more riders a page, 2 s apart) and cached for good in cache/ultimate.json.
The rows have the same shape as eqtiming.races(), so build.py adds them the same way.
"""
import bisect
import html
import json
import os
import re
import time

import requests

import raceresult
from ageclass import decade

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


SMARTRES = "http://results.ultimate.dk/smartres/"


def smartres_list(event, distance):
    """result_list() for Ultimate's older results pages (smartres, Nordsjørittet 2011-2013).
    Read one age class at a time, since the overall list has no age class; the place is
    recomputed over the whole distance. 50 or 100 riders a page, 2 s apart, cached for good."""
    key = f"smartres:{event}:{distance}"
    if key not in _cache:
        time.sleep(PAUSE)
        page = requests.get(SMARTRES, params={"eventid": event}, timeout=60).text
        sel = page[page.find('name="results_category"'):]
        sel = sel[:sel.find("</select>")]
        cats = [(v, html.unescape(n)) for v, n in re.findall(r'<option value="(C::[^"]+)"[^>]*>([^<]*)', sel)]
        out = []
        for cat, cat_name in cats:
            # "Kvinner 40-44 år" -> "K40-44", the age classes the other timers use.
            span = re.search(r"\d+(-\d+|\+)?", cat_name)
            age = ("K" if cat_name.lower().startswith("kvinne") else "M") + (span.group(0) if span else " Elite")
            start = 0
            while True:
                time.sleep(PAUSE)
                r = requests.get(SMARTRES + "results.php", params={"eventid": event, "results_distance": distance,
                                                                   "results_category": cat, "startrecord": start}, timeout=60)
                r.raise_for_status()
                rows = [[html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
                        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S)]
                rows = [c for c in rows if len(c) >= 6 and c[0].isdigit()]
                out += [["", c[2], c[3], age, c[5]] for c in rows]
                # "1413 deltakere" (2011-2012, 100 a page) or "1311 deltagere(e)" (2013, 50 a page)
                total = re.search(r"(\d+) delta[gk]ere", r.text)
                start += len(rows)
                if not rows or not total or start >= int(total.group(1)):
                    break
        secs = lambda t: _secs(t) if ":" in t else None
        times = sorted(s for s in (secs(r[4]) for r in out) if s is not None)
        for r in out:
            s = secs(r[4])
            r[0] = str(1 + bisect.bisect_left(times, s)) if s is not None else "DNF"
        out.sort(key=lambda r: (secs(r[4]) is None, secs(r[4]) or 0))
        _cache[key] = out
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
    return _cache[key]


def _secs(t):
    h, m, s = ([0, 0] + [int(x) for x in t.split(":")])[-3:]
    return h * 3600 + m * 60 + s


def _hms(t):
    h, m, s = ([0, 0] + [int(x) for x in t.split(":")])[-3:]
    return f"{h:02d}:{m:02d}:{s:02d}"


def races(entry, name):
    """The rider's result (by name) in one registry race, shaped like eqtiming.races()."""
    want = raceresult.fold(name)
    lister = smartres_list if entry.get("smartres") else result_list
    rows = lister(entry["event"], entry.get("distance", 1))
    me = next((r for r in rows if raceresult.fold(r[1]) == want), None)
    if not me or not me[0].isdigit() or ":" not in me[4]:
        return []
    age = [r for r in rows if decade(r[3]) == decade(me[3])]
    timed = [r for r in rows if ":" in r[4]]
    return [{
        "event_id": entry["event"], "stage_id": entry.get("distance", 1), "name": entry["name"],
        "stage": re.sub(r"\s+20\d\d$", "", entry["name"]), "group": "", "date": entry["date"],
        "class_place": int(me[0]), "class_n": len(rows),
        "age_class": decade(me[3]), "age_place": 1 + sum(1 for r in age if ":" in r[4] and _hms(r[4]) < _hms(me[4])),
        "age_n": len(age), "time": _hms(me[4]), "class_winner": min(_hms(r[4]) for r in timed),
        "url": f"{SMARTRES}?eventid={entry['event']}" if entry.get("smartres")
               else f"https://live.ultimate.dk/desktop/front/?eventid={entry['event']}",
    }]
