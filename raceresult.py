"""Timed races whose results are on raceresult (NM Landevei 2026), found by the rider's name.

raceresult has no rider profiles or history, so the events are listed in EVENTS by hand
and a followed rider is matched by name (the lists write "Given SURNAME"). Each event's
list is fetched once, 2 s apart, and cached for good in cache/raceresult_events.json.
The rows have the same shape as eqtiming.races(), so build.py adds them the same way.
SSK Cup (points races) is on raceresult too, but lives in sskcup.py.
"""
import json
import os
import re
import time
import unicodedata

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(HERE, "cache", "raceresult_events.json")
PAUSE = 2
ROAD, CRIT, TT = "02-Results|Road Race Results", "02-Results|Criterium Results", "02-Results|Time Trial Results"
# (event id, list, name, date). The event's key and server come from its config.
EVENTS = [
    (378682, TT, "NM Individuell Tempo 2026", "2026-06-25"),
    (378683, CRIT, "NM Gateritt 2026", "2026-06-26"),
    (378684, ROAD, "NM Fellesstart Junior 2026", "2026-06-27"),
    (378685, ROAD, "NM Fellesstart Elite 2026", "2026-06-28"),
]

try:
    with open(CACHE_FILE, encoding="utf-8") as f:
        _cache = json.load(f)
except (OSError, ValueError):
    _cache = {}


def _cached(key, fetch):
    if key not in _cache:
        time.sleep(PAUSE)
        _cache[key] = fetch()
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
    return _cache[key]


def result_list(event, listname):
    """{class: [(place or status, name, time)]} for one event, cached forever. Times are
    H:MM:SS; after the winner, road and criterium lists give the gap, which is added here.
    A lapped rider keeps the official place, with "+2 runder" for a time."""
    def fetch():
        conf = requests.get(f"https://my.raceresult.com/{event}/results/config",
                            params={"page": "results", "noVisitor": "1"}, timeout=60).json()
        time.sleep(PAUSE)
        r = requests.get(f"https://{conf['server']}/{event}/results/list",
                         params={"key": conf["key"], "listname": listname, "contest": "0", "r": "all", "l": "0"},
                         timeout=60)
        r.raise_for_status()
        col = 6 if listname == TT else 5
        out = {}
        for g, rows in r.json()["data"].items():
            cls, lead, prev = g.split("_", 1)[1], None, None
            out[cls] = []
            for row in rows:
                t = row[col].strip()
                s = _secs(t.lstrip("+"))
                if t == "''" and row[2].endswith("."):  # same bunch as the rider before: same time
                    s = prev
                elif t.startswith("+") and lead is not None and s is not None:
                    s += lead
                elif not t.startswith("+") and s is not None and lead is None:
                    lead = s
                prev = s
                laps = re.fullmatch(r"[+-]?\s*(\d+)\s*(?:RUNDER?|LAPS?)", t.strip(), re.I)
                shown = _hms(s) if s is not None else f"+{laps.group(1)} {'runde' if laps.group(1) == '1' else 'runder'}" if laps else ""
                out[cls].append([row[2].rstrip("."), row[3].rstrip("*").strip(), shown])
        return out
    return _cached(f"{event}:{listname}", fetch)


def _secs(t):
    """4h13'39'' / 33'33''.72 / 15'' -> whole seconds (like the lists show them), else None."""
    m = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)')?(?:(\d+)'')(?:\.\d+)?", t or "")
    if not m:
        return None
    h, mi, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + s


def _hms(s):
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def fold(name):
    s = unicodedata.normalize("NFD", name.lower().replace("ø", "o").replace("æ", "ae"))
    return sorted(re.sub(r"[̀-ͯ]", "", s).split())


def races(name, since=0):
    """One dict per EVENTS race the rider (by name) started, shaped like eqtiming.races()."""
    want, out = fold(name), []
    for event, listname, title, date in EVENTS:
        if int(date[:4]) < since:
            continue
        for cls, rows in result_list(event, listname).items():
            me = next((r for r in rows if fold(r[1]) == want), None)
            if not me or me[0] == "DNS":
                continue
            started = [r for r in rows if r[0] != "DNS"]
            placed = me[0].isdigit()
            out.append({
                "event_id": event, "stage_id": cls, "name": title, "stage": cls, "group": "", "date": date,
                "class_place": int(me[0]) if placed else me[0], "class_n": len(started),
                "age_class": "", "age_place": None, "age_n": None,
                "time": me[2] if placed else me[0],
                "class_winner": next((r[2] for r in rows if r[0] == "1"), ""),
                "url": f"https://my.raceresult.com/{event}/results",
            })
    return out
