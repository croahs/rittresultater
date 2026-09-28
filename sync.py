"""Prototype: rebuild Pedår's race results sheet from raw inputs.

Raw inputs per race (what a results site gives you):
  race, date, type, time, class placement/participants, overall placement/participants,
  class winner time, distance, elevation, notes
Power (avg, NP) comes from the matching intervals.icu activity.
Everything else in the sheet is derived.

Usage:
  INTERVALS_API_KEY=... python3 sync.py race_results_original.csv out.csv
  python3 sync.py race_results_original.csv out.csv --offline   # recompute only
"""
import csv
import json
import os
import sys
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import requests

INTERVALS = "https://intervals.icu/api/v1"
RIDE_TYPES = {"Ride", "VirtualRide", "GravelRide", "MountainBikeRide"}

COLS = [
    "Race", "Placement in class", "Overall placement", "Percentile in class",
    "Overall percentile", "Average speed (km/h)", "Date", "Average Power",
    "Normalized Power", "Class participants (not officials or DNS, DNF included)",
    "Overall participants (not officials or DNS, DNF included)", "Type", "Time",
    "% behind winner", "Distance (km)", "Elevation gain (m)", "Climbing per km",
    "Notes", "Class winner", "intervals.icu activity", "Match note",
]


def secs(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def parse_date(d):
    return datetime.strptime(d, "%d.%m.%y").date()


def rnd(x, places=2):
    """Round half up like a spreadsheet (Python's round/format use half-even on floats)."""
    return str(Decimal(str(x)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def derive(r):
    """Fill the derived columns from the raw ones (same formulas as the hand sheet)."""
    t = secs(r["Time"])
    dist = float(r["Distance (km)"])
    cp, cn = int(r["Placement in class"]), int(r["Class participants (not officials or DNS, DNF included)"])
    op, on = int(r["Overall placement"]), int(r["Overall participants (not officials or DNS, DNF included)"])
    r["Percentile in class"] = rnd(cp / cn * 100)
    r["Overall percentile"] = rnd(op / on * 100)
    # The hand sheet's speed comes from the bike computer, not official distance/time;
    # this is only a fallback, overwritten from the intervals.icu activity when matched.
    if not r.get("Average speed (km/h)"):
        r["Average speed (km/h)"] = f"{dist / (t / 3600):.1f}"
    r["% behind winner"] = f"{round((t / secs(r['Class winner']) - 1) * 100)}"
    r["Climbing per km"] = rnd(float(r['Elevation gain (m)']) / dist)
    return r


class Intervals:
    def __init__(self, api_key, athlete="0"):
        self.s = requests.Session()
        self.s.auth = ("API_KEY", api_key)
        self.athlete = athlete

    def activities(self, oldest: date, newest: date):
        r = self.s.get(f"{INTERVALS}/athlete/{self.athlete}/activities",
                       params={"oldest": oldest.isoformat(), "newest": newest.isoformat()})
        r.raise_for_status()
        return r.json()

    def streams(self, activity_id, cache_dir):
        """time/watts/distance streams for one activity, cached on disk (rides never change)."""
        path = os.path.join(cache_dir, f"{activity_id}.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        r = self.s.get(f"{INTERVALS}/activity/{activity_id}/streams.json",
                       params={"types": "time,watts,distance"})
        r.raise_for_status()
        data = {x["type"]: x["data"] for x in r.json()}
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return data


def race_window(streams, race_secs):
    """Average and normalized power over the race itself, without dead time.

    The race is taken as the race_secs-long stretch of the file that covers the most
    distance, so standing at the start, warm-up and cool-down fall outside it.
    Samples are put on a 1 s grid; pauses in recording count as 0 W.
    Returns (avg, np, (start_s, end_s)) or None without power data.
    """
    t, w, d = streams.get("time"), streams.get("watts"), streams.get("distance")
    if not t or not w or not any(w):
        return None
    n = t[-1] + 1
    watts, dist = [0.0] * n, [0.0] * n
    for i, s in enumerate(t):
        watts[s] = w[i] or 0.0
        dist[s] = (d[i] or 0.0) if d else 0.0
    for s in range(1, n):  # carry distance over recording gaps
        dist[s] = max(dist[s], dist[s - 1])
    span = min(race_secs, n)
    start = max(range(n - span + 1), key=lambda s: dist[s + span - 1] - dist[s]) if d else 0
    win = watts[start:start + span]
    avg = sum(win) / len(win)
    roll, acc = [], 0.0
    for i, x in enumerate(win):
        acc += x - (win[i - 30] if i >= 30 else 0)
        if i >= 29:
            roll.append(acc / 30)
    np_ = (sum(x ** 4 for x in roll) / len(roll)) ** 0.25 if roll else avg
    return avg, np_, (start, start + span)


def match(race, activities):
    """Pick the ride on the race date whose distance and duration best fit the result.

    Score = relative distance error + relative duration error. Warm-up rides on the
    same day are short and far off on both, so they lose to the race file. If the
    best file is much longer than the race (warm-up recorded in the same file),
    whole-file power understates race power; that is flagged, not fixed, for now.
    """
    d = parse_date(race["Date"])
    t = secs(race["Time"])
    dist_m = float(race["Distance (km)"]) * 1000
    cands = [a for a in activities
             if a.get("type") in RIDE_TYPES and str(a.get("start_date_local", ""))[:10] == d.isoformat()]
    if not cands:
        return None, "no ride on race date"

    def score(a):
        de = abs((a.get("distance") or 0) - dist_m) / dist_m
        te = abs((a.get("elapsed_time") or a.get("moving_time") or 0) - t) / t
        return de + te + (0 if a.get("race") else 0.05)

    best = min(cands, key=score)
    note = [] if score(best) < 0.3 else [f"weak match (score {score(best):.2f})"]
    if (best.get("distance") or 0) > dist_m * 1.15:
        note.append("file longer than race, power includes warm-up")
    return best, "; ".join(note)


def run(src, dst, api_key=None):
    with open(src, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("Time")]
    acts = []
    if api_key:
        dates = [parse_date(r["Date"]) for r in rows]
        acts = Intervals(api_key).activities(min(dates), max(dates) + timedelta(days=1))
    for r in rows:
        derive(r)
        if acts:
            a, note = match(r, acts)
            r["Match note"] = note
            if a:
                r["intervals.icu activity"] = f"https://intervals.icu/activities/{a['id']}"
                if a.get("average_speed"):
                    r["Average speed (km/h)"] = f"{a['average_speed'] * 3.6:.1f}"
                if a.get("icu_average_watts"):
                    r["Average Power"] = str(round(a["icu_average_watts"]))
                if a.get("icu_weighted_avg_watts"):
                    r["Normalized Power"] = str(round(a["icu_weighted_avg_watts"]))
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return rows


if __name__ == "__main__":
    offline = "--offline" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run(args[0], args[1], None if offline else os.environ.get("INTERVALS_API_KEY"))
