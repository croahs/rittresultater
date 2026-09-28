"""Rebuild the results sheet: placings from Turritt, power from intervals.icu.

Usage:
  python3 build.py race_results_original.csv race_results_auto.csv [changes.md]

Starts from the hand sheet, so race names, types, elevation and notes are kept.
Placings, participants, times and winner times are replaced by what Turritt
says (differences are listed in changes.md). Turritt races missing from the
sheet are added. Races Turritt doesn't cover (e.g. Atlantic Gravel) stay as typed.
Power, speed and missing elevation come from the matching intervals.icu ride
when INTERVALS_API_KEY is set or the proxy injects the key.
"""
import csv
import json
import os
import sys
from datetime import timedelta

import sync
import turritt

TURRITT_ID, NAME = "171101", "Peder Holterman Solland"
C_N = "Class participants (not officials or DNS, DNF included)"
O_N = "Overall participants (not officials or DNS, DNF included)"
FROM_TURRITT = {
    "Placement in class": "class_place", "Overall placement": "overall_place",
    C_N: "class_n", O_N: "overall_n", "Time": "time", "Class winner": "class_winner",
}


# Fallback when the API is unreachable: the activities list saved from a logged-in
# browser at https://intervals.icu/api/v1/athlete/0/activities.csv (or the JSON
# version, .../activities?oldest=2025-01-01), dropped next to this script.
ACTIVITIES_FILE = next((p for p in (os.path.join(os.path.dirname(os.path.abspath(__file__)), n)
                        for n in ("activities.csv", "activities.json")) if os.path.exists(p)), "")


ACTIVITIES_FILE_USED = False
STREAMS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "intervals")


def load_activities(path):
    if path.endswith(".json"):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    with open(path, newline="", encoding="utf-8-sig") as f:
        acts = list(csv.DictReader(f))
    for a in acts:
        for k, v in a.items():
            try:
                a[k] = float(v) if v not in ("", None) and k not in ("id", "start_date_local", "type", "name") else v
            except ValueError:
                pass
        a["race"] = str(a.get("race", "")).lower() == "true"
    return acts


def race_type(name):
    n = name.lower()
    if "lagtempo" in n:
        return "TTT"
    if "tempo" in n or "klostermil" in n or "toskaskabet" in n:
        return "TT"
    if "gravel" in n or "cx" in n:
        return "Gravel"
    return "Road"


def main(src, dst, report):
    with open(src, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("Time")]
    rid = turritt.find_rider(TURRITT_ID, NAME)
    tt = [turritt.race_row(race_id, year, TURRITT_ID) for race_id, year in turritt.rider_races(rid)]

    changes, used = [], set()
    for r in rows:
        d = sync.parse_date(r["Date"])
        hit = min((t for t in tt if abs((t["date"] - d).days) <= 2), key=lambda t: abs((t["date"] - d).days), default=None)
        if not hit:
            r["Match note"] = "not on Turritt, kept as typed"
            continue
        used.add(hit["turritt_race_id"])
        r["Turritt"] = f"https://turritt.com/index.php?Turritt={hit['turritt_race_id']}&page=resultat&current=2&su=2"
        new_date = hit["date"].strftime("%d.%m.%y")
        if new_date != r["Date"]:
            changes.append((r["Race"], "Date", r["Date"], new_date))
            r["Date"] = new_date
        for col, key in FROM_TURRITT.items():
            v = str(hit[key])
            if r.get(col) != v:
                changes.append((r["Race"], col, r.get(col, ""), v))
                r[col] = v

    for t in tt:
        if t["turritt_race_id"] in used or t["time"] == "DNF":
            continue
        r = {"Race": f"{t['turritt_name']} {t['date'].year}", "Date": t["date"].strftime("%d.%m.%y"),
             "Type": race_type(t["turritt_name"]), "Distance (km)": str(t["distance_km"]),
             "Turritt": f"https://turritt.com/index.php?Turritt={t['turritt_race_id']}&page=resultat&current=2&su=2",
             "Match note": "new from Turritt"}
        r.update({col: str(t[key]) for col, key in FROM_TURRITT.items()})
        rows.append(r)
        changes.append((r["Race"], "(new row)", "", "added from Turritt"))

    rows.sort(key=lambda r: sync.parse_date(r["Date"]))
    acts, icu = [], None
    global ACTIVITIES_FILE_USED
    key = os.environ.get("INTERVALS_API_KEY", "")
    try:
        dates = [sync.parse_date(r["Date"]) for r in rows]
        icu = sync.Intervals(key)
        if not key:
            icu.s.auth = None  # let the environment's proxy add the key
        acts = icu.activities(min(dates), max(dates) + timedelta(days=1))
    except Exception as e:  # no key / not authorised: placings still get written
        print(f"intervals.icu API skipped: {e}", file=sys.stderr)
    if not acts and os.path.exists(ACTIVITIES_FILE):
        acts = load_activities(ACTIVITIES_FILE)
        ACTIVITIES_FILE_USED = True
    for r in rows:
        if acts:
            a, note = sync.match(r, acts)
            r["Match note"] = "; ".join(x for x in (r.get("Match note"), note) if x)
            if a:
                r["intervals.icu activity"] = f"https://intervals.icu/activities/{a['id']}"
                # Speed is official distance / official time; the file's speed only
                # fills in when there is no official distance.
                if not r.get("Distance (km)") and a.get("average_speed"):
                    r["Average speed (km/h)"] = f"{a['average_speed'] * 3.6:.1f}"
                win = None
                if icu and not ACTIVITIES_FILE_USED:
                    try:
                        win = sync.race_window(icu.streams(a["id"], STREAMS_DIR), sync.secs(r["Time"]))
                    except Exception as e:
                        print(f"streams for {a['id']} skipped: {e}", file=sys.stderr)
                if win:
                    avg, np_, (s0, s1) = win
                    r["Average Power"], r["Normalized Power"] = str(round(avg)), str(round(np_))
                    whole = a.get("elapsed_time") or 0
                    if whole - (s1 - s0) > 60:
                        r["Match note"] = "; ".join(x for x in (r.get("Match note"),
                            f"power over race only ({s0 // 60}-{s1 // 60} min of {whole // 60} min file)") if x)
                else:
                    if a.get("icu_average_watts"):
                        r["Average Power"] = str(round(a["icu_average_watts"]))
                    if a.get("icu_weighted_avg_watts"):
                        r["Normalized Power"] = str(round(a["icu_weighted_avg_watts"]))
                if not r.get("Elevation gain (m)") and a.get("total_elevation_gain"):
                    r["Elevation gain (m)"] = str(round(a["total_elevation_gain"]))
        if r.get("Distance (km)"):  # official speed, see above
            r["Average speed (km/h)"] = ""
        if r.get("Elevation gain (m)"):
            sync.derive(r)
        else:  # everything but climbing per km
            r["Elevation gain (m)"] = "0"
            sync.derive(r)
            r["Elevation gain (m)"] = r["Climbing per km"] = ""

    cols = sync.COLS[:-2] + ["Turritt", "intervals.icu activity", "Match note"]
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    if report:
        with open(report, "w", encoding="utf-8") as f:
            f.write("# Turritt vs hand sheet\n\n| Race | Column | Sheet | Turritt |\n|---|---|---|---|\n")
            f.writelines(f"| {a} | {b} | {c} | {d} |\n" for a, b, c, d in changes)
    return rows, changes


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
