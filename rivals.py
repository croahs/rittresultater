"""Rivals: head-to-head against every rider you have met, from cached Turritt lists.

No network: every result list is already in cache/turritt.json (the races in
race_results_auto.csv plus their sibling races). Riders are matched on
TurrittID, which is stable across years. EQ Timing-only races (Repsol-mila,
Atlantic Gravel) are left out for now: their cached lists have rider ids but no
names. SSK Cup is points only and is left out too.

Who counts, per race: the "overall" pool from turritt.py (all sibling races of
the event, same course, officials/leisure groups and DNS dropped). Faster time
wins. A DNF loses to any finisher (the sheet's rule); two DNFs are a draw.

  python3 rivals.py                 writes rivals.json, rivals.csv, race_analysis.csv
  python3 rivals.py søk <navn>      head-to-head against riders matching <navn>
"""
import csv
import json
import os
import re
import statistics
import sys
from collections import defaultdict

import turritt

ME = "171101"
HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = os.path.join(HERE, "race_results_auto.csv")
MIN_RACES = 3  # to be called a rival
DNF = 359000


def races():
    """[(race dict from the sheet, turritt race id)] for sheet rows that link to Turritt."""
    with open(SHEET, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            m = re.search(r"Turritt=(\d+)", r.get("Turritt", ""))
            if m:
                yield r, m.group(1)


def pool(race_id):
    """Every counted row on the same course: the race plus its sibling races."""
    year = turritt.race_info(race_id)[0].year
    names = dict(turritt.year_list(year))
    name = names.get(race_id, "")
    sibs = [v for v, n in names.items() if name and turritt._base(n) == turritt._base(name)] or [race_id]
    return [r for v in sibs for r in turritt.results(v) if turritt._counts(r)]


def name(r):
    return f"{r[5]} {r[6]}".strip()


def build():
    opp = {}  # turritt id -> summary
    meetings = defaultdict(list)
    analysis = []
    for sheet, race_id in races():
        rows = pool(race_id)
        me = next((r for r in rows if r[2] == ME), None)
        if not me:
            continue
        t = int(me[9])
        finished = [int(r[9]) for r in rows if int(r[9]) < DNF]
        winner = min(finished)
        beaten = sum(int(r[9]) > t for r in rows if r[2] != ME)
        dist = float(sheet["Distance (km)"] or 0)
        elev = float(sheet["Elevation gain (m)"] or 0)
        analysis.append({
            "race": sheet["Race"], "date": sheet["Date"], "type": sheet["Type"],
            "field": len(rows), "beaten": beaten,
            "beaten_pct": round(100 * beaten / (len(rows) - 1), 1),
            "behind_winner_pct": round(100 * (t / winner - 1), 1) if t < DNF else "",
            "distance_km": dist, "climb_m_per_km": round(elev / dist, 1) if dist else "",
            "turritt_race_id": race_id,
        })
        for r in rows:
            if r[2] == ME or not r[2] or r[2] == "0":
                continue
            o = int(r[9])
            if t >= DNF and o >= DNF:
                res, gap = "draw", None
            elif o >= DNF:
                res, gap = "win", None
            elif t >= DNF:
                res, gap = "loss", None
            else:
                res = "win" if t < o else "loss" if t > o else "draw"
                gap = t - o  # seconds; negative = you were faster
            opp[r[2]] = {"turritt_id": r[2], "name": name(r), "club": r[7].strip(), "age_class": r[8]}
            meetings[r[2]].append({
                "race": sheet["Race"], "date": sheet["Date"], "type": sheet["Type"], "result": res,
                "gap_s": gap, "gap_pct": round(100 * gap / o, 1) if gap is not None else None,
                "their_time": turritt.hms(o) if o < DNF else "DNF",
            })

    out = []
    for tid, ms in meetings.items():
        gaps = [m["gap_pct"] for m in ms if m["gap_pct"] is not None]
        secs = [m["gap_s"] for m in ms if m["gap_s"] is not None]
        o = opp[tid]
        o.update({
            "races": len(ms),
            "wins": sum(m["result"] == "win" for m in ms),
            "losses": sum(m["result"] == "loss" for m in ms),
            "draws": sum(m["result"] == "draw" for m in ms),
            "avg_gap_s": round(statistics.mean(secs)) if secs else None,
            "median_gap_pct": round(statistics.median(gaps), 1) if gaps else None,
            "meetings": ms,
        })
        out.append(o)
    out.sort(key=lambda o: (-o["races"], abs(o["median_gap_pct"] or 99)))
    return out, analysis


def rivals(opps):
    """Met at least MIN_RACES times, ranked by how close you usually finish."""
    rs = [o for o in opps if o["races"] >= MIN_RACES and o["median_gap_pct"] is not None]
    # Closeness: median gap, plus how split the record is (5-5 is a rivalry, 10-0 is not).
    score = lambda o: abs(o["median_gap_pct"]) + 5 * abs(o["wins"] - o["losses"]) / o["races"]
    return sorted(rs, key=score)


def fmt_gap(s):
    if s is None:
        return "–"
    sign = "+" if s > 0 else "-"
    return f"{sign}{turritt.hms(abs(s)).lstrip('0:') or '0'}"


def search(opps, q):
    q = q.lower()
    hits = [o for o in opps if q in o["name"].lower()]
    if not hits:
        print(f"Ingen motstandere som matcher «{q}».")
    for o in hits[:10]:
        print(f"\n{o['name']} ({o['club']}, {o['age_class']}), TurrittID {o['turritt_id']}")
        print(f"  {o['races']} ritt sammen: {o['wins']} seire, {o['losses']} tap, {o['draws']} likt; "
              f"snitt tidsforskjell {fmt_gap(o['avg_gap_s'])} (minus = du var raskere)")
        for m in o["meetings"]:
            res = {"win": "slo", "loss": "tapte for", "draw": "likt med"}[m["result"]]
            print(f"  {m['date']}  {m['race']:<32} du {res}  {fmt_gap(m['gap_s'])}  (deres tid {m['their_time']})")


def write(opps, analysis):
    with open(os.path.join(HERE, "rivals.json"), "w", encoding="utf-8") as f:
        json.dump({"rider": ME, "rivals": [o["turritt_id"] for o in rivals(opps)], "opponents": opps},
                  f, ensure_ascii=False, indent=1)
    cols = ["turritt_id", "name", "club", "age_class", "races", "wins", "losses", "draws", "avg_gap_s", "median_gap_pct"]
    with open(os.path.join(HERE, "rivals.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, cols + ["rival_rank"], extrasaction="ignore")
        w.writeheader()
        rank = {o["turritt_id"]: i + 1 for i, o in enumerate(rivals(opps))}
        for o in opps:
            w.writerow({**o, "rival_rank": rank.get(o["turritt_id"], "")})
    with open(os.path.join(HERE, "race_analysis.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, list(analysis[0]))
        w.writeheader()
        w.writerows(analysis)


def summary(opps, analysis):
    print(f"{len(opps)} motstandere i {len(analysis)} Turritt-ritt.\n")
    print("Mest møtt:")
    for o in opps[:10]:
        print(f"  {o['races']:>2} ritt  {o['wins']}-{o['losses']}  {o['name']} ({o['club']})")
    print(f"\nRivaler (minst {MIN_RACES} ritt, jevnest først):")
    for o in rivals(opps)[:15]:
        print(f"  {o['races']:>2} ritt  {o['wins']}-{o['losses']}  median {o['median_gap_pct']:+.1f} %  {o['name']} ({o['club']})")
    print("\nAndel av feltet du slo, per type:")
    by = defaultdict(list)
    for a in analysis:
        by[a["type"]].append(a["beaten_pct"])
    for k, v in sorted(by.items(), key=lambda kv: -statistics.mean(kv[1])):
        print(f"  {k:<7} {statistics.mean(v):5.1f} %  ({len(v)} ritt)")
    by = defaultdict(list)
    for a in analysis:
        by["20" + a["date"][-2:]].append(a["beaten_pct"])
    print("\nAndel av feltet du slo, per år:")
    for k, v in sorted(by.items()):
        print(f"  {k}    {statistics.mean(v):5.1f} %  ({len(v)} ritt)")
    y = [a["beaten_pct"] for a in analysis]
    print("\nSammenheng med andel slått (korrelasjon, -1 til 1):")
    for label, key in (("feltstørrelse", "field"), ("stigning per km", "climb_m_per_km"), ("distanse", "distance_km")):
        print(f"  {label:<16} {statistics.correlation([float(a[key]) for a in analysis], y):+.2f}")


if __name__ == "__main__":
    opps, analysis = build()
    if len(sys.argv) > 2 and sys.argv[1] in ("søk", "sok", "search"):
        search(opps, " ".join(sys.argv[2:]))
    else:
        write(opps, analysis)
        summary(opps, analysis)
