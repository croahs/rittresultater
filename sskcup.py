"""SSK Cup (Stavanger SK's points races) from raceresult, joined with intervals.icu.

SSK Cup is scored on sprint points, not time, so it doesn't fit the main sheet
(no time, no % behind winner). It gets its own file, points_races.csv.

raceresult serves each round's list as JSON (the same call its results page makes).
Each round's list is fetched once and cached for good in cache/raceresult.json.
The list shows everyone registered for the series in each round; riders with
0 points share the places after the last scorer, so a 0-point place is "shared".
Power, speed and time cover only the race laps (auto-laps of the circuit).

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
STREAMS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "intervals")
NAME = "SOLLAND Peder Holterman"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "raceresult.json")
PAUSE = 2
# Pedår rode Sort klasse in these rounds although raceresult lists him in Blå
# (he told us; it isn't recorded anywhere). Sort isn't in his results there.
RODE_SORT = {1, 6}
NEUTRAL_LAPS = 15  # Sort klasse rides 15 neutral laps before the race starts

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


def race_laps(laps, sort_class):
    """The laps that are the race: drop the ride to the start (first lap) and a
    trailing stub lap; in Sort klasse also the neutral laps, up to the first lap
    ridden clearly harder than them."""
    laps = [l for l in laps[1:] if (l.get("distance") or 0) > 500]
    if sort_class:
        easy = sorted(l.get("average_watts") or 0 for l in laps[:NEUTRAL_LAPS])
        base = easy[len(easy) // 2]
        start = next((i for i, l in enumerate(laps) if i >= NEUTRAL_LAPS
                      and (l.get("average_watts") or 0) > 1.5 * base), None)
        laps = laps[start:] if start is not None else []
    return laps


def window_stats(streams, t0, t1):
    t, w, d = streams["time"], streams.get("watts") or [], streams.get("distance") or []
    idx = [i for i, s in enumerate(t) if t0 <= s < t1]
    win = [w[i] or 0 for i in idx] if w else []
    avg = sum(win) / len(win) if win else None
    roll = [sum(win[i - 29:i + 1]) / 30 for i in range(29, len(win))]
    np_ = (sum(x ** 4 for x in roll) / len(roll)) ** 0.25 if roll else avg
    km = (d[idx[-1]] - d[idx[0]]) / 1000 if d and idx else None
    return avg, np_, km, t1 - t0


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
        sort_class = n in RODE_SORT
        full = icu.s.get(f"{sync.INTERVALS}/activity/{a['id']}", params={"intervals": "true"}).json()
        laps = race_laps(full.get("icu_intervals") or [], sort_class)
        avg = np_ = km = secs = None
        if laps:
            t0 = laps[0]["start_time"]
            t1 = laps[-1]["start_time"] + laps[-1]["elapsed_time"]
            avg, np_, km, secs = window_stats(icu.streams(a["id"], STREAMS_DIR), t0, t1)
        row = {"Race": f"SSK Cup {n}", "Date": a["start_date_local"][:10],
               "Class": "Sort klasse" if sort_class else "", "Placement": "", "Riders in class": "",
               "Points": "", "Winner points": ""}
        for cls, rows in round_list(n).items():
            me = next((r for r in rows if r[1] == NAME), None)
            if not me or sort_class:
                continue
            pts = int(me[2] or 0)
            scorers = [r for r in rows if int(r[2] or 0) > 0]
            row.update({"Class": cls, "Placement": me[0] if pts else f"{len(scorers) + 1}-{len(rows)} (shared)",
                        "Riders in class": len(rows), "Points": pts,
                        "Winner points": max(int(r[2] or 0) for r in rows)})
        row.update({
            "Race laps": len(laps), "Race time": f"{secs // 60}:{secs % 60:02d}" if secs else "",
            "Distance (km)": f"{km:.1f}" if km else "",
            "Average speed (km/h)": f"{km / secs * 3600:.1f}" if km and secs else "",
            "Average Power": round(avg) if avg else "", "Normalized Power": round(np_) if np_ else "",
            "raceresult": PAGE, "intervals.icu activity": f"https://intervals.icu/activities/{a['id']}",
            "Note": ("rode Sort klasse (not in its results list); " if sort_class else "")
                    + "power, speed and time over the race laps only",
        })
        out.append(row)
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    return out


if __name__ == "__main__":
    for r in main(sys.argv[1]):
        print(r)
