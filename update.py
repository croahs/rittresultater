"""Rebuild everything for every rider in riders.json and write data/results.json.

Usage:
  python3 update.py            # all riders
  python3 update.py 171101     # one rider (the others are kept from the last run)

For each rider: placings from Turritt / EQ Timing (build.py), power from intervals.icu
when that rider's key is available, SSK Cup points races (sskcup.py) when configured.
Writes each rider's CSV (the spreadsheet) and data/results.json (what the dashboard reads).

A rider whose intervals.icu key is missing this run keeps the watts and speed from
their previous CSV, so a run without secrets never wipes power data.
"""
import csv
import json
import os
import re
import sys

import build
import eqtiming
import riderids
import sskcup
import sync

HERE = os.path.dirname(os.path.abspath(__file__))
RIDERS_FILE = os.path.join(HERE, "riders.json")
OUT = os.path.join(HERE, "data", "results.json")
SCHEMA = 1


def load_riders():
    with open(RIDERS_FILE, encoding="utf-8") as f:
        return json.load(f)["riders"]


def rider_csv(rider):
    return os.path.join(HERE, rider.get("csv") or os.path.join("data", "csv", f"{rider['id']}.csv"))


def points_csv(rider):
    own = (rider.get("ssk_cup") or {}).get("csv")
    return os.path.join(HERE, own or os.path.join("data", "csv", f"{rider['id']}-points.csv"))


POINTS_COLS = ["Race", "Date", "Class", "Placement", "Riders in class", "Points", "Winner points",
               "Race laps", "Race time", "Distance (km)", "Average speed (km/h)", "Average Power",
               "Normalized Power", "raceresult", "EQ Timing", "intervals.icu activity", "Note"]


def kermesse_rows(rider, log):
    """Kermesse (points races on EQ Timing) as points-race rows, with watts and speed over the
    race time from the rider's intervals.icu ride when there is a key. Like SSK Cup they are
    kept apart from the timed races: the lists often hold only the riders who scored, so a
    share of the field beaten or a head-to-head would be made up."""
    if not rider.get("eq_id"):
        return []
    try:
        ks = eqtiming.points_races(int(rider["eq_id"]), int(rider.get("since") or 0), rider.get("eq_points_events") or ())
    except Exception as e:
        log(f"{rider['id']}: EQ Timing points races skipped: {e}")
        return []
    rows = []
    for k in ks:
        d = k["date"]
        timed = {"Race": k["name"], "Date": f"{d[8:10]}.{d[5:7]}.{d[2:4]}", "Time": k["time"] or "00:00:00"}
        if k["time"]:
            build.add_power(rider, [timed], log)
        secs = sync.secs(k["time"]) if k["time"] else 0
        rows.append({
            "Race": re.sub(r"^.*?\s-\s", "", k["name"]) if " - " in k["name"] else k["name"],
            "Date": d, "Class": k["group"].title(), "Placement": k["place"], "Riders in class": k["field"],
            "Points": k["points"], "Winner points": k["winner_points"], "Race laps": "",
            "Race time": re.sub(r"^0(?=\d:)", "", k["time"]) if secs else "",
            "Distance (km)": timed.get("Distance (km)", "") if timed.get("_gps_speed") else "", "Average speed (km/h)": timed.get("Average speed (km/h)", "") if timed.get("_gps_speed") else "",
            "Average Power": timed.get("Average Power", ""), "Normalized Power": timed.get("Normalized Power", ""),
            "raceresult": "", "EQ Timing": k["url"], "intervals.icu activity": timed.get("intervals.icu activity", ""),
            "Note": "kermesse: " + ("placed by points" if k["points"] else "no points; the list has only the riders who scored")
                    + ("; power and speed over the race time" if timed.get("_power") else ""),
            "_race_id": f"eqtiming:{k['event_id']}/{k['stage_id']}",
        })
    return rows


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
    if r.get("_rr"):
        return r["_rr"]
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
        "time_s": sync.secs(r["Time"]) if ":" in r["Time"] else None,  # lapped: "+2 runder"
        "winner_time": r["Class winner"],
        "behind_pct": num(r.get("% behind winner")),
        "distance_km": num(r.get("Distance (km)")),
        "stage_km": r.get("_stage_km"),  # the rider's own class/stage, from the timer; None when it gives none
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
    rid = r.get("_race_id") or r.get("Race id")
    return {
        "rider_id": rider["id"],
        "race_id": rid or f"raceresult:{sskcup.EVENT}:cup{m.group(1) if m else r['Race']}",
        "name": r["Race"],
        "series": "kermesse" if (rid or "").startswith("eqtiming:") else "ssk cup",
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
        "links": {"raceresult": r.get("raceresult") or None, "eqtiming": r.get("EQ Timing") or None,
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
        if points is None:  # no key this run: keep what we had, else placings from the lists
            points = [r for r in read_csv(points_csv(rider)) if not r.get("EQ Timing")] or sskcup.list_rows(rider, log)
    points = points + kermesse_rows(rider, log)
    if points:
        # Keep last run's watts for kermesse rides we couldn't read this time (no key in this run).
        prev = {(r["Race"], r["Date"]): r for r in read_csv(points_csv(rider))}
        for r in points:
            p = prev.get((r["Race"], r["Date"]))
            if p and not r.get("intervals.icu activity") and p.get("intervals.icu activity"):
                for c in ("Average Power", "Normalized Power", "Average speed (km/h)", "intervals.icu activity"):
                    r[c] = p.get(c, "")
        points.sort(key=lambda r: r["Date"])
        path = points_csv(rider)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=POINTS_COLS + ["Race id"], extrasaction="ignore")
            w.writeheader()
            w.writerows({**r, "Race id": r.get("_race_id") or r.get("Race id", "")} for r in points)
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
    # Our own rider ids (data/aliases.json): new riders from the lists fetched above get one.
    aliases = riderids.build(log)
    by_tt = {a["turritt"]: k for k, a in aliases.items() if a.get("turritt")}
    by_eq = {str(u): k for k, a in aliases.items() for u in riderids._eqs(a)}
    rid_of = lambda r: r.get("rid") or by_tt.get(str(r.get("turritt_id"))) or by_eq.get(str(r.get("eq_id")))
    data = {
        "schema": SCHEMA,
        "riders": [{"id": r["id"], "rid": rid_of(r), "name": r["name"], "turritt_id": r.get("turritt_id"),
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
