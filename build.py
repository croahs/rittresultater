"""Build one rider's results: placings from Turritt and EQ Timing, power from intervals.icu.

Usage (normally via update.py, which runs every rider in riders.json):
  python3 build.py [rider id]

A rider may start from a hand-kept sheet (Pedår's race_results_original.csv), which
keeps its race names, types and elevation. Placings, participants, times and winner
times are replaced by what Turritt or EQ Timing says (differences go to the report).
Races on Turritt or EQ Timing but not in the sheet are added, so a rider without a
sheet gets every race from their profiles.

Power and speed come from the matching intervals.icu ride, over the race window only
(sync.race_window). The computed numbers are cached in cache/metrics.json, which is
committed, so later runs never refetch old rides.
"""
import csv
import json
import os
import re
import sys
from datetime import timedelta

import requests

import sync
import eqtiming
import raceresult
import ultimate
import turritt

HERE = os.path.dirname(os.path.abspath(__file__))
C_N = "Class participants (not officials or DNS, DNF included)"
O_N = "Overall participants (not officials or DNS, DNF included)"
FROM_TURRITT = {
    "Placement in class": "class_place", "Overall placement": "overall_place",
    C_N: "class_n", O_N: "overall_n", "Time": "time", "Class winner": "class_winner",
}
# The hand-written Notes column is dropped: future races won't have it.
CSV_COLS = [c for c in sync.COLS[:-2] if c != "Notes"] + [
    "Age class", "Age class placement", "Age class participants",
    "Turritt", "EQ Timing", "intervals.icu activity", "Match note"]
POWER_COLS = ("Average Power", "Normalized Power", "Average speed (km/h)", "intervals.icu activity", "Match note")
STREAMS_DIR = os.path.join(HERE, "cache", "intervals")
METRICS_FILE = os.path.join(HERE, "cache", "metrics.json")

try:
    with open(METRICS_FILE, encoding="utf-8") as f:
        METRICS = json.load(f)
except (OSError, ValueError):
    METRICS = {}


def save_metrics():
    with open(METRICS_FILE, "w", encoding="utf-8") as f:
        f.write("{\n" + ",\n".join(f"{json.dumps(k)}: {json.dumps(v)}" for k, v in sorted(METRICS.items())) + "\n}\n")


def race_type(name):
    n = name.lower()
    if "lagtempo" in n:
        return "TTT"
    if "tempo" in n or "klostermil" in n or "toskaskabet" in n or re.search(r"\bmila\b", n):
        return "TT"
    if "gravel" in n or "cx" in n:
        return "Gravel"
    # Neither Turritt nor EQ Timing says what kind of race it is, so the name decides.
    # Terrain races: "MTB", "Terrengcup", XC classes ("CC Elite"), and forest loops ("-skogen").
    if re.search(r"\bmtb\b|terreng|\bcc (elite|sport)\b|skogen\b", n):
        return "MTB"
    return "Road"


ROAD_MIN_KMH = 29  # no road race in the lists has a winner slower than this


def checked_type(r):
    """A guessed "Road" whose winner rode slower than any road race is "Unknown", not road.

    Names without a keyword fall back to road (race_type), but a slow winner means it may be
    a hill climb or a terrain race, so the dashboard says we don't know. Types typed into a
    rider's own sheet are kept as they are."""
    if r.get("Type") != "Road" or not str(r.get("Match note", "")).startswith("new from"):
        return r.get("Type")
    km, w = r.get("Distance (km)"), sync.secs(r["Class winner"]) if r.get("Class winner") else 0
    try:
        return "Unknown" if km and w and float(km) / (w / 3600) < ROAD_MIN_KMH else "Road"
    except ValueError:
        return "Road"


def intervals_client(rider):
    """An intervals.icu client for this rider, or None when no key is available."""
    key = os.environ.get(rider.get("intervals_key_env") or "", "")
    if not key and not rider.get("intervals_via_proxy"):
        return None
    icu = sync.Intervals(key, rider.get("intervals_athlete_id") or "0")
    if not key:
        icu.s.auth = None  # the dev container's proxy adds the key
    return icu


def window(icu, activity_id, race_s):
    """sync.race_window for one ride, cached in cache/metrics.json."""
    k = f"{activity_id}:{race_s}"
    if k not in METRICS:
        w = sync.race_window(icu.streams(activity_id, STREAMS_DIR), race_s)
        METRICS[k] = None if w is None else [w[0], w[1], list(w[2]), w[3]]
    return METRICS[k]


def eq_class(e):
    """The race an EQ Timing result is in: the stage, plus the start group when that is its own race."""
    own = eqtiming.OWN_RACE_GROUP.search(e["group"]) and e["group"] not in e["stage"]
    return e["stage"] + (f" ({e['group']})" if own else "")


def eq_row(e, rider):
    """A new sheet row from an EQ Timing race (class = overall; EQ has no overall list here)."""
    name = re.sub(r"\s*-\s*(?=20\d\d$)", " ", e["name"]).strip()
    r = {"Race": name, "Date": sync.parse_date_iso(e["date"]).strftime("%d.%m.%y"),
         "Type": race_type(f"{e['name']} {e['stage']} {e['group']}"), "Match note": "new from EQ Timing",
         "_class": eq_class(e)}
    hit = {**e, "overall_place": e["class_place"], "overall_n": e["class_n"]}
    r.update({col: str(hit[key]) for col, key in FROM_TURRITT.items()})
    return r


def build_rider(rider, log=print):
    """Rows (CSV columns plus a few _internal keys) for one rider, oldest first."""
    rows = []
    if rider.get("sheet"):
        with open(os.path.join(HERE, rider["sheet"]), newline="", encoding="utf-8") as f:
            rows = [r for r in csv.DictReader(f) if r.get("Time")]
    exclude = re.compile(rider["exclude"], re.I) if rider.get("exclude") else None

    tt = []
    rider["_turritt_blocked"] = False
    if rider.get("turritt_id"):
        try:
            rid = turritt.find_rider(rider["turritt_id"], rider["name"])
            pairs = turritt.rider_races(rid) if rid else []
        except requests.RequestException as e:
            # Turritt isn't fetched from any more (turritt.LIVE). Use what is cached and go on
            # with the original timing sources: EQ Timing, raceresult, Ultimate.
            if turritt.LIVE:
                log(f"{rider['id']}: Turritt unreachable ({e}), using cached Turritt lists only")
            rider["_turritt_blocked"] = True
            rid = turritt._cache.get(f"rider:{rider['turritt_id']}")
            pairs = turritt.cached_races(rid) if rid else []
        if rid or rider["_turritt_blocked"]:
            since = int(rider.get("since") or 0)  # older seasons cost a request per race list
            for race_id, year in pairs:
                if int(year) < since:
                    continue
                try:
                    tt.append(turritt.race_row(race_id, year, rider["turritt_id"]))
                except Exception as e:  # one odd list shouldn't stop the rest
                    log(f"{rider['id']}: Turritt race {race_id} skipped: {e}")
        else:
            log(f"{rider['id']}: Turritt rider {rider['turritt_id']} not found by name {rider['name']!r}")

    eq_all = []
    if rider.get("eq_id"):
        try:
            eq_all = [e for e in eqtiming.races(int(rider["eq_id"]), int(rider.get("since") or 0)) if e["class_place"]]
        except Exception as e:  # placings still come from Turritt
            log(f"{rider['id']}: EQ Timing skipped: {e}")
    eq_by_date = {sync.parse_date_iso(e["date"]).strftime("%d.%m.%y"): e for e in eq_all}

    changes, used = [], set()
    for r in rows:
        d = sync.parse_date(r["Date"])
        hit = min((t for t in tt if abs((t["date"] - d).days) <= 2), key=lambda t: abs((t["date"] - d).days), default=None)
        if not hit:
            eq = eq_by_date.get(r["Date"])
            if not eq:
                r["Match note"] = "not on Turritt or EQ Timing, kept as typed"
                continue
            hit = {**eq, "overall_place": eq["class_place"], "overall_n": eq["class_n"]}
            r["Match note"] = "placings from EQ Timing"
            r["_class"] = eq_class(eq)
            for col, key in FROM_TURRITT.items():
                v = str(hit[key])
                if r.get(col) != v:
                    changes.append((r["Race"], col, r.get(col, ""), v + " (EQ Timing)"))
                    r[col] = v
            continue
        used.add(hit["turritt_race_id"])
        r["Turritt"] = f"https://turritt.com/index.php?Turritt={hit['turritt_race_id']}&page=resultat&current=2&su=2"
        r["_turritt_race_id"], r["_class"] = hit["turritt_race_id"], hit["turritt_name"]
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
        r = {"Race": f"{turritt._base(t['turritt_name'])} {t['date'].year}", "Date": t["date"].strftime("%d.%m.%y"),
             "Type": race_type(t["turritt_name"]), "Distance (km)": str(t["distance_km"]),
             "Turritt": f"https://turritt.com/index.php?Turritt={t['turritt_race_id']}&page=resultat&current=2&su=2",
             "Match note": "new from Turritt", "_turritt_race_id": t["turritt_race_id"], "_class": t["turritt_name"]}
        r.update({col: str(t[key]) for col, key in FROM_TURRITT.items()})
        rows.append(r)
        changes.append((r["Race"], "(new row)", "", "added from Turritt"))

    # EQ Timing races nobody has a row for yet (Turritt covers many of the same races).
    taken = {sync.parse_date(r["Date"]) for r in rows}
    for e in eq_all:
        d = sync.parse_date_iso(e["date"])
        if any(abs((d - x).days) <= 1 for x in taken) or ":" not in e["time"]:
            continue
        r = eq_row(e, rider)
        rows.append(r)
        taken.add(d)
        changes.append((r["Race"], "(new row)", "", "added from EQ Timing"))

    # Races on raceresult (NM) and Ultimate (Bergen-Voss), found by name: no rider id to go by.
    for src, mod in (("raceresult", raceresult), ("Ultimate", ultimate)):
        try:
            found = mod.races(rider["name"], int(rider.get("since") or 0))
        except Exception as e:
            log(f"{rider['id']}: {src} skipped: {e}")
            found = []
        for e in found:
            d = sync.parse_date_iso(e["date"])
            # NM has a race a day, so only the same day is a duplicate. Lapped riders keep their place.
            if d in taken or not isinstance(e["class_place"], int):
                continue
            r = eq_row(e, rider)
            r["Match note"], r["_rr"] = f"new from {src}", f"{src.lower()}:{e['event_id']}/{e['stage_id']}"
            if e["age_place"]:
                r["Age class"], r["Age class placement"], r["Age class participants"] = e["age_class"], str(e["age_place"]), str(e["age_n"])
            rows.append(r)
            taken.add(d)
            changes.append((r["Race"], "(new row)", "", f"added from {src}"))

    if exclude:
        rows = [r for r in rows if not exclude.search(r["Race"])]
    rows.sort(key=lambda r: sync.parse_date(r["Date"]))
    for r in rows:
        eq = eq_by_date.get(r["Date"])
        if eq:
            r["EQ Timing"] = eq["url"]
            r["_eq"] = f"{eq['event_id']}/{eq['stage_id']}"
            if eq["age_place"] and eq["age_class"] not in ("Menn", "M17+"):
                r["Age class"] = eq["age_class"]
                r["Age class placement"], r["Age class participants"] = str(eq["age_place"]), str(eq["age_n"])

    add_power(rider, rows, log)
    for r in rows:
        if not r.get("_gps_speed") and r.get("Distance (km)"):
            r["Average speed (km/h)"] = ""  # derive() then uses official distance / time
        sync.derive(r)
        r["Type"] = checked_type(r)
    return rows, changes


def add_power(rider, rows, log=print):
    """Watts and GPS speed over the race window from the rider's intervals.icu rides.
    Marks rows it has fresh power data for with _power = True."""
    icu = intervals_client(rider)
    if not icu or not rows:
        return
    try:
        dates = [sync.parse_date(r["Date"]) for r in rows]
        acts = icu.activities(min(dates), max(dates) + timedelta(days=1))
    except Exception as e:  # placings still get written; update.py keeps earlier watts
        log(f"{rider['id']}: intervals.icu skipped: {e}")
        return
    for r in rows:
        if ":" not in r["Time"]:  # lapped: no official time to find the ride or race window by
            continue
        a, note = sync.match(r, acts)
        r["Match note"] = "; ".join(x for x in (r.get("Match note"), note) if x)
        if not a:
            continue
        r["_power"] = True
        r["intervals.icu activity"] = f"https://intervals.icu/activities/{a['id']}"
        race_s = sync.secs(r["Time"])
        try:
            win = window(icu, a["id"], race_s)
        except Exception as e:
            log(f"streams for {a['id']} skipped: {e}")
            win = None
        if win:
            avg, np_, (s0, s1), metres = win
            if avg is not None:
                r["Average Power"], r["Normalized Power"] = str(round(avg)), str(round(np_))
            if s1 - s0 == race_s and metres:
                # GPS distance in the race window / official time: official
                # course lengths are rounded, the official time is exact.
                r["Average speed (km/h)"] = f"{metres / race_s * 3.6:.1f}"
                r["_gps_speed"] = True
                if not r.get("Distance (km)"):
                    r["Distance (km)"] = f"{metres / 1000:.1f}"
            whole = a.get("elapsed_time") or 0
            if avg is not None and whole - (s1 - s0) > 60:
                r["Match note"] = "; ".join(x for x in (r.get("Match note"),
                    f"power over race only ({s0 // 60}-{s1 // 60} min of {whole // 60} min file)") if x)
        if not win or win[0] is None:
            if a.get("icu_average_watts"):
                r["Average Power"] = str(round(a["icu_average_watts"]))
            if a.get("icu_weighted_avg_watts"):
                r["Normalized Power"] = str(round(a["icu_weighted_avg_watts"]))
        if not r.get("Elevation gain (m)") and a.get("total_elevation_gain"):
            r["Elevation gain (m)"] = str(round(a["total_elevation_gain"]))
    save_metrics()


def write_csv(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def write_report(changes, path):
    with open(path, "w", encoding="utf-8") as f:
        f.write("# Turritt vs hand sheet\n\n| Race | Column | Sheet | Turritt |\n|---|---|---|---|\n")
        f.writelines(f"| {a} | {b} | {c} | {d} |\n" for a, b, c, d in changes)


if __name__ == "__main__":
    import update
    update.main(sys.argv[1:])
