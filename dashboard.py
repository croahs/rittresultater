"""Build the results dashboard (one self-contained HTML page) from the rebuilt sheet.

Usage:
  python3 dashboard.py race_results_auto.csv dashboard.html   (also reads points_races.csv)
"""
import csv
import json
import re
import sys

import sync


def series_key(name):
    """'Tysværrittet 2025' and 'Tysværrittet' are the same race in different years."""
    return re.sub(r"\s+20\d\d$", "", name).strip().lower()


def rows(path):
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            d = sync.parse_date(r["Date"])
            num = lambda k: float(r[k]) if r.get(k) else None
            out.append({
                "name": re.sub(r"\s+20\d\d$", "", r["Race"]),
                "key": series_key(r["Race"]),
                "date": d.isoformat(), "year": d.year,
                "type": r["Type"],
                "place": int(r["Placement in class"]),
                "field": int(r["Class participants (not officials or DNS, DNF included)"]),
                "top": num("Percentile in class"),
                "behind": num("% behind winner"),
                "np": num("Normalized Power"), "ap": num("Average Power"),
                "speed": num("Average speed (km/h)"),
                "km": num("Distance (km)"), "climb": num("Elevation gain (m)"),
                "time": r["Time"], "winner": r["Class winner"],
                "notes": r.get("Notes", ""),
                "age_class": r.get("Age class", ""),
                "age_place": int(r["Age class placement"]) if r.get("Age class placement") else None,
                "age_n": int(r["Age class participants"]) if r.get("Age class participants") else None,
                "turritt": r.get("Turritt", "") or r.get("EQ Timing", ""),
                "icu": r.get("intervals.icu activity", ""),
            })
    return out


def points_rows(path):
    try:
        with open(path, newline="", encoding="utf-8") as f:
            return [{"name": r["Race"], "date": r["Date"], "cls": r["Class"], "place": r["Placement"],
                     "n": r["Riders in class"], "pts": r["Points"], "win": r["Winner points"],
                     "laps": r["Race laps"], "time": r["Race time"], "speed": r["Average speed (km/h)"],
                     "np": r["Normalized Power"], "ap": r["Average Power"], "note": r["Note"],
                     "icu": r["intervals.icu activity"]} for r in csv.DictReader(f)]
    except OSError:
        return []


def main(src, dst, points="points_races.csv"):
    data = rows(src)
    with open(__file__.replace("dashboard.py", "dashboard_template.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace("/*DATA*/[]", json.dumps(data, ensure_ascii=False))
    html = html.replace("/*POINTS*/[]", json.dumps(points_rows(points), ensure_ascii=False))
    with open(dst, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
