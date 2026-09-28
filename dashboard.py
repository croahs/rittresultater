"""Build the results dashboard (one self-contained HTML page) from the rebuilt sheet.

Usage:
  python3 dashboard.py race_results_auto.csv dashboard.html
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
                "turritt": r.get("Turritt", ""), "icu": r.get("intervals.icu activity", ""),
            })
    return out


def main(src, dst):
    data = rows(src)
    with open(__file__.replace("dashboard.py", "dashboard_template.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace("/*DATA*/[]", json.dumps(data, ensure_ascii=False))
    with open(dst, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
