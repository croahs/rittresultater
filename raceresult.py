"""Timed races whose results are on raceresult, found by the rider's name.

raceresult has no rider profiles or history, so the races come from data/registry.json
(registry.py) and a rider is matched by name. Each race's list is fetched once, 2 s apart,
and cached for good in cache/raceresult_events.json. The rows have the same shape as
eqtiming.races(), so build.py adds them the same way.
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


def result_list(entry):
    """{class: [(place or status, name, time)]} for one registry race, cached forever. Times
    are H:MM:SS. Lists that give the gap after the winner get it added here, and a rider in
    the same bunch as the one before gets that time. A lapped rider keeps the official
    place, with "+2 runder" for a time. entry["cols"] = [place, name, time] columns."""
    event, listname = entry["event"], entry["list"]
    pc, nc, tc = entry.get("cols") or [2, 3, 5]

    def fetch():
        conf = requests.get(f"https://my.raceresult.com/{event}/results/config",
                            params={"page": "results", "noVisitor": "1"}, timeout=60).json()
        time.sleep(PAUSE)
        r = requests.get(f"https://{conf['server']}/{event}/results/list",
                         params={"key": conf["key"], "listname": listname, "contest": "0", "r": "all", "l": "0"},
                         timeout=60)
        r.raise_for_status()
        out = {}
        for g, rows in r.json()["data"].items():
            cls, lead, prev = g.split("_", 1)[1], None, None
            out[cls] = []
            for row in rows:
                t = row[tc].strip()
                s = _secs(t.lstrip("+ "))
                if t == "''" and row[pc].endswith("."):  # same bunch as the rider before: same time
                    s = prev
                elif t.startswith("+") and lead is not None and s is not None:
                    s += lead
                elif not t.startswith("+") and s is not None and lead is None:
                    lead = s
                prev = s
                laps = re.fullmatch(r"[+-]?\s*(\d+)\s*(?:RUNDER?|LAPS?)", t, re.I)
                shown = _hms(s) if s is not None else f"+{laps.group(1)} {'runde' if laps.group(1) == '1' else 'runder'}" if laps else ""
                out[cls].append([row[pc].rstrip("."), row[nc].rstrip("*").strip(), shown])
        return out
    return _cached(f"{event}:{listname}", fetch)


def _secs(t):
    """4h13'39'' / 33'33''.72 / 15'' / 2:44:03 -> whole seconds (as the lists show them), else None."""
    for pat in (r"(?:(\d+)h)?(?:(\d+)')?(?:(\d+)'')(?:\.\d+)?", r"(?:(\d+):)?(\d+):(\d\d)(?:[.,]\d+)?"):
        m = re.fullmatch(pat, t or "")
        if m:
            h, mi, s = (int(x or 0) for x in m.groups())
            return h * 3600 + mi * 60 + s
    return None


def _hms(s):
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def fold(name):
    """A name as sorted plain words, so "SKAILAND, Odd", "Odd SKAILAND" and "Odd Skailand" match."""
    s = unicodedata.normalize("NFD", name.lower().replace("ø", "o").replace("æ", "ae"))
    return sorted(re.sub(r"[^\w\s-]", " ", re.sub(r"[\u0300-\u036f]", "", s)).split())


def races(entry, name):
    """The rider's results (by name) in one registry race, shaped like eqtiming.races()."""
    want, out = fold(name), []
    skip = re.compile(entry["skip_classes"], re.I) if entry.get("skip_classes") else None
    for cls, rows in result_list(entry).items():
        if skip and skip.search(cls):
            continue
        me = next((r for r in rows if fold(r[1]) == want), None)
        if not me or me[0] == "DNS":
            continue
        started = [r for r in rows if r[0] != "DNS"]
        placed = me[0].isdigit()
        out.append({
            "event_id": entry["event"], "stage_id": cls, "name": entry["name"], "stage": cls, "group": "",
            "date": entry["date"], "class_place": int(me[0]) if placed else me[0], "class_n": len(started),
            "age_class": "", "age_place": None, "age_n": None,
            "time": me[2] if placed else me[0],
            "class_winner": next((r[2] for r in rows if r[0] == "1"), ""),
            "url": f"https://my.raceresult.com/{entry['event']}/results",
        })
    return out
