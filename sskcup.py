"""SSK Cup (Stavanger SK's points races) from raceresult, joined with intervals.icu.

SSK Cup is scored on sprint points, not time, so it doesn't fit the main sheet
(no time, no % behind winner). It gets its own file, points_races.csv.

raceresult serves each round's list as JSON (the same call its results page makes).
Each round's list is fetched once and cached for good in cache/raceresult.json.
The list shows everyone registered for the series in each round; riders with
0 points share the places after the last scorer, so a 0-point place is "shared".

Usage:
  python3 sskcup.py points_races.csv
"""
import csv
import json
import os
import re
import sys
import time

import requests

import sync

EVENT, KEY = "391696", "3edeb65ff357cd58e6d7f8c77340819c"
URL = f"https://my-us-1.raceresult.com/{EVENT}/results/list"
PAGE = f"https://my.raceresult.com/{EVENT}/"
NAME = "SOLLAND Peder Holterman"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "raceresult.json")
PAUSE = 2

try:
    with open(CACHE_FILE, encoding="utf-8") as f:
        _cache = json.load(f)
except (OSError, ValueError):
    _cache = {}


def round_list(n):
    """{class: [(place, name, points)]} for cup round n."""
    key = f"{EVENT}:cup{n}"
    if key not in _cache:
        time.sleep(PAUSE)
        r = requests.get(URL, params={"key": KEY, "listname": f"2 - Results|{n} Cup {n}",
                                      "contest": "0", "r": "all", "l": "0"}, timeout=60)
        r.raise_for_status()
        _cache[key] = {g.split("_", 1)[1]: [[row[2].rstrip("."), row[3].split(" (")[0], row[6]] for row in rows]
                       for g, rows in r.json()["data"].items() if "_" in g and g.split("_", 1)[1]}
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
    return _cache[key]


def main(dst):
    icu = sync.Intervals(os.environ.get("INTERVALS_API_KEY", ""))
    if not os.environ.get("INTERVALS_API_KEY"):
        icu.s.auth = None  # the environment's proxy adds the key
    from datetime import date
    acts = icu.activities(date(2026, 1, 1), date.today())
    out = []
    for a in sorted(acts, key=lambda a: a["start_date_local"]):
        m = re.search(r"ssk cup\s*#?\s*(\d+)", a.get("name") or "", re.I)
        if not m or a.get("type") not in sync.RIDE_TYPES:
            continue
        n = int(m.group(1))
        for cls, rows in round_list(n).items():
            me = next((r for r in rows if r[1] == NAME), None)
            if not me:
                continue
            pts = int(me[2] or 0)
            scorers = [r for r in rows if int(r[2] or 0) > 0]
            place = me[0] if pts else f"{len(scorers) + 1}-{len(rows)} (shared)"
            out.append({
                "Race": f"SSK Cup {n}", "Date": a["start_date_local"][:10], "Class": cls,
                "Placement": place, "Riders in class": len(rows), "Points": pts,
                "Winner points": max(int(r[2] or 0) for r in rows),
                "Distance (km)": f"{(a.get('distance') or 0) / 1000:.1f}",
                "Average speed (km/h)": f"{(a.get('average_speed') or 0) * 3.6:.1f}",
                "Average Power": round(a["icu_average_watts"]) if a.get("icu_average_watts") else "",
                "Normalized Power": round(a["icu_weighted_avg_watts"]) if a.get("icu_weighted_avg_watts") else "",
                "raceresult": PAGE, "intervals.icu activity": f"https://intervals.icu/activities/{a['id']}",
                "Note": "power and speed over the whole file (no official time to trim to)",
            })
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    return out


if __name__ == "__main__":
    for r in main(sys.argv[1]):
        print(r)
