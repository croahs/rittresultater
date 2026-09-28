"""Rebuild everything for every rider in riders.json and write data/races.json.

Usage:
  python3 update.py            # all riders
  python3 update.py 171101     # one rider (the others are kept from the last run)

For each rider: placings from Turritt / EQ Timing (build.py), power from intervals.icu
when that rider's key is available, SSK Cup points races (sskcup.py) when configured.
Writes each rider's CSV (the spreadsheet) and data/races.json (what the dashboard reads).

A rider whose intervals.icu key is missing this run keeps the watts and speed from
their previous CSV, so a run without secrets never wipes power data.
"""
import csv
import json
import os
import re
import sys

import build
import sskcup
import sync

HERE = os.path.dirname(os.path.abspath(__file__))
RIDERS_FILE = os.path.join(HERE, "riders.json")
OUT = os.path.join(HERE, "data", "races.json")
SCHEMA = 1


def load_riders():
    with open(RIDERS_FILE, encoding="utf-8") as f:
        return json.load(f)["riders"]


def rider_csv(rider):
    return os.path.join(HERE, rider.get("csv") or os.path.join("data", "riders", f"{rider['id']}.csv"))


def points_csv(rider):
    return os.path.join(HERE, rider["ssk_cup"].get("csv") or os.path.join("data", "riders", f"{rider['id']}-points.csv"))


def read_csv(path):
    try:
        with open(path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except OSError:
        return []


def num(x, cast=float):
    try:
        return cast(x) if x not in ("", None) else None
    except ValueError:
        return None


def series_key(name):
    """'Tysværrittet 2025' and 'Tysværrittet' are the same race in different years."""
    return re.sub(r"\s+20\d\d$", "", name).strip().lower()


def race_id(r):
    if r.get("_turritt_race_id"):
        return f"turritt:{r['_turritt_race_id']}"
    if r.get("_eq"):
        return f"eqtiming:{r['_eq']}"
    return f"sheet:{sync.parse_date(r['Date']).isoformat()}:{series_key(r['Race'])}"


def race_json(rider, r):
    d = sync.parse_date(r["Date"])
    power = rider.get("publish_power", False)
    ap = num(r.get("Average Power"), int) if power else None
    return {
        "rider_id": rider["id"],
        "race_id": race_id(r),
        "name": re.sub(r"\s+20\d\d$", "", r["Race"]).strip(),
        "series": series_key(r["Race"]),
        "date": d.isoformat(),
        "year": d.year,
        "type": r.get("Type") or build.race_type(r["Race"]),
        "class_name": r.get("_class", ""),
        "class_place": num(r["Placement in class"], int),
        "class_n": num(r[build.C_N], int),
        "overall_place": num(r["Overall placement"], int),
        "overall_n": num(r[build.O_N], int),
        "percentile": num(r.get("Percentile in class")),
        "overall_percentile": num(r.get("Overall percentile")),
        "time": r["Time"],
        "time_s": sync.secs(r["Time"]),
        "winner_time": r["Class winner"],
        "behind_pct": num(r.get("% behind winner")),
        "distance_km": num(r.get("Distance (km)")),
        "elevation_m": num(r.get("Elevation gain (m)"), int),
        "climb_per_km": num(r.get("Climbing per km")),
        "speed_kmh": num(r.get("Average speed (km/h)")),
        "avg_power": ap,
        "np": num(r.get("Normalized Power"), int) if power else None,
        "age_class": r.get("Age class") or None,
        "age_place": num(r.get("Age class placement"), int),
        "age_n": num(r.get("Age class participants"), int),
        "source_ids": {"turritt": r.get("_turritt_race_id"), "eqtiming": r.get("_eq")},
        "links": {"turritt": r.get("Turritt") or None, "eqtiming": r.get("EQ Timing") or None,
                  "intervals": (r.get("intervals.icu activity") or None) if power else None},
    }


def points_json(rider, r):
    power = rider.get("publish_power", False)
    m = re.search(r"(\d+)$", r["Race"])
    return {
        "rider_id": rider["id"],
        "race_id": f"raceresult:{sskcup.EVENT}:cup{m.group(1) if m else r['Race']}",
        "name": r["Race"],
        "series": "ssk cup",
        "date": r["Date"],
        "year": int(r["Date"][:4]),
        "class_name": r["Class"],
        "place": r["Placement"] or None,  # text: "3", or "8-10 (shared)" for riders without points
        "field": num(r["Riders in class"], int),
        "points": num(r["Points"], int),
        "winner_points": num(r["Winner points"], int),
        "laps": num(r["Race laps"], int),
        "race_time": r["Race time"] or None,
        "distance_km": num(r["Distance (km)"]),
        "speed_kmh": num(r["Average speed (km/h)"]),
        "avg_power": num(r["Average Power"], int) if power else None,
        "np": num(r["Normalized Power"], int) if power else None,
        "note": r["Note"],
        "links": {"raceresult": r["raceresult"],
                  "intervals": r["intervals.icu activity"] if power else None},
    }


def run_rider(rider, log):
    rows, changes = build.build_rider(rider, log)
    # Keep last run's watts for rides we couldn't read this time (no key in this run).
    prev = {r["Date"]: r for r in read_csv(rider_csv(rider))}
    for r in rows:
        p = prev.get(r["Date"])
        if not r.get("_power") and p and p.get("intervals.icu activity"):
            for c in build.POWER_COLS:
                r[c] = p.get(c, "")
    path = rider_csv(rider)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    build.write_csv(rows, path)
    if rider.get("report") and rider.get("sheet"):
        build.write_report(changes, os.path.join(HERE, rider["report"]))

    points = []
    if rider.get("ssk_cup"):
        icu = build.intervals_client(rider)
        points = (sskcup.main(rider, icu, log) if icu else None)
        if points is None:  # no key this run: keep what we had
            points = read_csv(points_csv(rider))
        elif points:
            sskcup.write_csv(points, points_csv(rider))
    return rows, points


def main(only=()):
    log = lambda m: print(m, file=sys.stderr)
    riders = load_riders()
    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {"races": [], "points_races": []}
    races, points = [], []
    for rider in riders:
        if only and rider["id"] not in only:
            races += [x for x in old["races"] if x["rider_id"] == rider["id"]]
            points += [x for x in old["points_races"] if x["rider_id"] == rider["id"]]
            continue
        rows, pts = run_rider(rider, log)
        races += [race_json(rider, r) for r in rows]
        points += [points_json(rider, r) for r in pts]
        log(f"{rider['id']}: {len(rows)} races, {len(pts)} points races, "
            f"{sum(1 for r in rows if r.get('Average Power'))} with power")
    data = {
        "schema": SCHEMA,
        "riders": [{"id": r["id"], "name": r["name"], "turritt_id": r.get("turritt_id"),
                    "eq_id": r.get("eq_id"), "power": bool(r.get("publish_power"))} for r in riders],
        "races": sorted(races, key=lambda x: (x["date"], x["rider_id"])),
        "points_races": sorted(points, key=lambda x: (x["date"], x["rider_id"])),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return data


if __name__ == "__main__":
    main(tuple(sys.argv[1:]))
