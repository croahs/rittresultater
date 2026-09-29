"""Rivals: head-to-head against every rider you have met, from cached Turritt lists.

No network: every result list is already in cache/turritt.json (the races in
race_results_auto.csv plus their sibling races). Riders are matched on
TurrittID, which is stable across years. EQ Timing-only races (Repsol-mila,
Atlantic Gravel) are left out for now: their cached lists have rider ids but no
names. SSK Cup is points only and is left out too.

Who counts, per race: the "overall" pool from turritt.py (all sibling races of
the event, same course, officials/leisure groups and DNS dropped). Faster time
wins. A DNF loses to any finisher (the sheet's rule); two DNFs are a draw.

  python3 rivals.py                 writes rivals.json, rivals.csv, race_analysis.csv (you)
                                    and data/ for every rider (races.json, riders/index.json, riders/shard-NN.json)
  python3 rivals.py søk <navn>      head-to-head against riders matching <navn>
  python3 rivals.py rytter <id>     rebuild one rider's full profile in data/riders (after "fetch all my races")
"""
import bisect
import csv
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict

import turritt

ME = "171101"
HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = os.path.join(HERE, "race_results_auto.csv")
RESULTS = os.path.join(HERE, "data", "results.json")
MIN_RACES = 3  # to be called a rival
DNF = 359000


def races():
    """[(race dict in the sheet's columns, turritt race id)] for every Turritt race of every rider
    in data/results.json (update.py: all riders in riders.json), else of your sheet alone."""
    try:
        with open(RESULTS, encoding="utf-8") as f:
            rows = json.load(f)["races"]
    except (OSError, ValueError, KeyError):
        with open(SHEET, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                m = re.search(r"Turritt=(\d+)", r.get("Turritt", ""))
                if m:
                    yield r, m.group(1)
        return
    for r in sorted(rows, key=lambda r: (r["date"], r["rider_id"] != ME)):
        tid = (r.get("source_ids") or {}).get("turritt")
        if not tid:
            continue
        y, m, d = r["date"].split("-")
        yield {"Race": f"{r['name']} {r['year']}", "Date": f"{d}.{m}.{y[2:]}", "Type": r["type"],
               "Distance (km)": r.get("distance_km"), "Elevation gain (m)": r.get("elevation_m"),
               "Turritt": (r.get("links") or {}).get("turritt") or ""}, str(tid)


def pool(race_id, year):
    """Every counted row on the same course: the race plus its sibling races."""
    names = dict(turritt.year_list(year))
    name = names.get(race_id, "")
    sibs = [v for v, n in names.items() if name and turritt._base(n) == turritt._base(name)] or [race_id]
    rows = [(r, category(names.get(v, ""), r[3])) for v in sibs for r in turritt.results(v) if turritt._counts(r)]
    if any(c == "CX/Gravel" for _, c in rows):
        # Gravel events: the main race next to the CX/Gravel class is one class (MTB or any bike),
        # even where one of its waves is labelled "(MTB)".
        rows = [(r, c if c == "CX/Gravel" else "MTB/åpen") for r, c in rows]
    return rows, sibs


def category(race_name, group):
    """Bike category of a start: "Racer", "Temposykkel", "CX/Gravel", "MTB/Hybrid", or None when the
    race has no bike classes (seeded waves like "Pulje 2" say nothing about the bike)."""
    group = group or ""
    g = f"{race_name} | {group}".lower()
    if re.search(r"mtb|hybrid", g):
        return "MTB/Hybrid"
    if re.search(r"\bcx\b|gravel", g):
        return "CX/Gravel"
    if re.search(r"- tempo$", race_name.lower()) or re.search(r"^(tempo|temposykkel)$", group.strip().lower()):
        return "Temposykkel"
    if "racer" in g:
        return "Racer"
    return None


def name(r):
    return f"{r[5]} {r[6]}".strip()


def events():
    """Every race in the sheet that links to Turritt, with its pool of riders, fetched once."""
    out, done = [], set()
    for sheet, race_id in races():
        if race_id in done:  # two riders in the same event (maybe in sibling races): one pool
            continue
        cats, sibs = pool(race_id, 2000 + int(sheet["Date"][-2:]))
        done |= set(sibs)
        by_cat, by_club = defaultdict(list), defaultdict(list)
        for r, c in cats:
            by_cat[c].append(int(r[9]))
            by_club[club_key((r[7] or "").strip())].append((int(r[9]), (r[7] or "").strip(), r[2]))
        by_id = {}
        for r, c in cats:
            if r[2] not in ("", "0"):
                by_id.setdefault(r[2], (r, c))  # a few riders are listed twice: keep the first
        order = [r[2] for r, _ in sorted(cats, key=lambda rc: int(rc[0][9])) if r[2] not in ("", "0")]
        out.append({"sheet": sheet, "race_id": race_id, "cats": cats, "order": order,
                    "pos": {x: i for i, x in reversed(list(enumerate(order)))},
                    "times": sorted(int(r[9]) for r, _ in cats),
                    "cat_times": {c: sorted(v) for c, v in by_cat.items()},
                    "club_times": {k: (sorted(x[0] for x in v), v[0][1], {x[2] for x in v} - {"", "0"})
                                   for k, v in by_club.items()},
                    "by_id": by_id})
    return out


def tally(times, t):
    """(wins, losses) against everyone in a sorted list of times, you (time t) included as a draw."""
    if t >= DNF:
        return 0, bisect.bisect_left(times, DNF)
    return len(times) - bisect.bisect_right(times, t), bisect.bisect_left(times, t)


def club_table(me, evs):
    """How often you beat riders from each club (20+ head-to-heads), from every race you rode."""
    clubs = defaultdict(lambda: {"riders": set(), "wins": 0, "losses": 0, "names": defaultdict(int)})
    for ev in evs:
        if me not in ev["by_id"]:
            continue
        t = int(ev["by_id"][me][0][9])
        for k, (times, shown, ids) in ev["club_times"].items():
            c = clubs[k]
            w, l = tally(times, t)
            c["wins"] += w
            c["losses"] += l
            c["riders"] |= ids - {me}
            c["names"][shown or "(ingen klubb)"] += len(times)
    return sorted(({"club": max(v["names"], key=v["names"].get), "riders": len(v["riders"]), "wins": v["wins"],
                    "losses": v["losses"], "win_pct": round(100 * v["wins"] / (v["wins"] + v["losses"]), 1)}
                   for k, v in clubs.items() if v["wins"] + v["losses"] >= 20),
                  key=lambda c: -c["win_pct"])


def build(me=ME, evs=None, keep=None):
    """Head-to-head against every opponent (or only those in keep, which is much faster in
    the 9000-rider Nordsjørittet fields) and your result in each race."""
    opp = {}  # turritt id -> summary
    meetings = defaultdict(list)
    analysis = []
    for ev in evs or events():
        if me not in ev["by_id"]:
            continue
        sheet, race_id, cats, times = ev["sheet"], ev["race_id"], ev["cats"], ev["times"]
        rows = [r for r, _ in cats]
        me_row, my_cat = ev["by_id"][me]
        t = int(me_row[9])
        winner = times[0]
        beaten = tally(times, t)[0]
        cls = ev["cat_times"][my_cat]
        dist = float(sheet["Distance (km)"] or 0)
        elev = float(sheet["Elevation gain (m)"] or 0)
        analysis.append({
            "race": sheet["Race"], "date": sheet["Date"], "type": sheet["Type"],
            "field": len(rows), "beaten": beaten,
            "beaten_pct": round(100 * beaten / (len(rows) - 1), 1) if len(rows) > 1 else 0.0,
            "behind_winner_pct": round(100 * (t / winner - 1), 1) if t < DNF else "",
            "distance_km": dist, "climb_m_per_km": round(elev / dist, 1) if dist else "",
            "turritt_race_id": race_id,
            "time": turritt.hms(t) if t < DNF else "DNF",
            "class": my_cat,
            "place": bisect.bisect_left(times, t) + 1 if t < DNF else "",
            "class_place": 1 + bisect.bisect_left(cls, t) if t < DNF else "",
            "class_n": len(cls),
            "behind_class_winner_pct": round(100 * (t / cls[0] - 1), 1) if t < DNF else "",
            "class_winner": turritt.hms(cls[0]),
        })
        lo, hi = bisect.bisect_left(times, t), bisect.bisect_right(times, t)
        met = set()
        for r, cat in (cats if keep is None else [ev["by_id"][x] for x in keep if x in ev["by_id"]]):
            if r[2] == me or r[2] in ("", "0") or r[2] in met:  # a few riders are listed twice
                continue
            met.add(r[2])
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
            if o < t < DNF:  # places between you: 1 = finished right ahead of you, -1 = right behind
                places = 1 + lo - bisect.bisect_right(times, o)
            elif t < o < DNF:
                places = -(1 + bisect.bisect_left(times, o) - hi)
            else:
                places = None
            meetings[r[2]].append({
                "race": sheet["Race"], "date": sheet["Date"], "type": sheet["Type"], "result": res,
                "gap_s": gap, "gap_pct": round(100 * gap / o, 1) if gap is not None else None,
                "their_time": turritt.hms(o) if o < DNF else "DNF",
                # Bike category each of you started in; same_class is False only when they differ,
                # e.g. you on CX/Gravel and them on MTB, or you on a road bike and them on a TT bike.
                "my_class": my_cat, "their_class": cat, "same_class": cat == my_cat,
                "places": places,
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
            "same_class_races": sum(m["same_class"] for m in ms),
            "same_class_wins": sum(m["same_class"] and m["result"] == "win" for m in ms),
            "same_class_losses": sum(m["same_class"] and m["result"] == "loss" for m in ms),
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


def _record(ms):
    w = sum(m["result"] == "win" for m in ms)
    l = sum(m["result"] == "loss" for m in ms)
    gaps = [m["gap_pct"] for m in ms if m["gap_pct"] is not None]
    return w, l, (statistics.median(gaps) if gaps else None)


def _who(o, **extra):
    return {"turritt_id": o["turritt_id"], "name": o["name"], "club": o["club"], **extra}


def club_key(club):
    """Same club, different spelling: "Bogafjell SK" = "Bogafjell Sykleklubb" = "bogafjell sykleklubb"."""
    c = re.sub(r"\b(sykleklubb|sykkelklubb|sykkelklub|sykleklub)\b", "sk", club.lower())
    return re.sub(r"\s+", " ", c).strip() or "(ingen klubb)"


def insights(opps, clubs=None):
    """The extra views: rivals per race type, gap over time, nemesis/victim, clubs, who is right ahead."""
    out = {}

    # Rivals per race type: the same closeness score, counting only that type's races.
    out["rivals_by_type"] = {}
    for typ in ("Road", "TT", "Gravel"):
        rows = []
        for o in opps:
            ms = [m for m in o["meetings"] if m["type"] == typ]
            w, l, med = _record(ms)
            if len(ms) >= MIN_RACES and med is not None:
                rows.append((abs(med) + 5 * abs(w - l) / len(ms),
                             _who(o, races=len(ms), wins=w, losses=l, median_gap_pct=round(med, 1))))
        out["rivals_by_type"][typ] = [r for _, r in sorted(rows, key=lambda x: x[0])[:10]]

    # Gap over time against the closest rivals, ready to plot (negative = you were faster).
    out["gap_curves"] = [_who(o, points=[{"date": m["date"], "race": m["race"], "type": m["type"],
                                            "gap_s": m["gap_s"], "gap_pct": m["gap_pct"]}
                                           for m in o["meetings"] if m["gap_s"] is not None])
                         for o in rivals(opps)[:10]]

    # Nemesis and victim: among riders at your level (median gap within 5 %, 3+ races).
    level = [o for o in opps if o["races"] >= MIN_RACES and o["median_gap_pct"] is not None
             and abs(o["median_gap_pct"]) <= 5]
    pick = lambda key: [_who(o, races=o["races"], wins=o["wins"], losses=o["losses"])
                        for o in sorted(level, key=key)[:5]]
    out["nemesis"] = pick(lambda o: (-o["losses"] / o["races"], -o["losses"]))
    out["victims"] = pick(lambda o: (-o["wins"] / o["races"], -o["wins"]))

    # Specialists: always beat you in one type, always lose to you in another (2+ races each).
    out["specialists"] = []
    for o in opps:
        by = defaultdict(list)
        for m in o["meetings"]:
            by[m["type"]].append(m["result"])
        strong = [t for t, rs in by.items() if len(rs) >= 2 and all(r == "loss" for r in rs)]
        weak = [t for t, rs in by.items() if len(rs) >= 2 and all(r == "win" for r in rs)]
        if strong and weak:
            out["specialists"].append(_who(o, stronger_than_you_in=strong, weaker_than_you_in=weak))

    # Overtaken: beat you every time last season, you beat them every time this season.
    out["overtaken"] = []
    for o in opps:
        by = defaultdict(list)
        for m in o["meetings"]:
            by["20" + m["date"][-2:]].append(m["result"])
        years = sorted(by)
        for a, b in zip(years, years[1:]):
            if len(by[a]) >= 2 and len(by[b]) >= 2 and set(by[a]) == {"loss"} and set(by[b]) == {"win"}:
                out["overtaken"].append(_who(o, lost_in=a, beat_in=b, races=len(by[a]) + len(by[b])))

    # Clubs: from club_table(), over the full fields (opps may hold only riders met twice).
    out["clubs"] = sorted(sorted(clubs or [], key=lambda c: -(c["wins"] + c["losses"]))[:MAX_LIST],
                          key=lambda c: -c["win_pct"])  # the clubs you met most
    out["specialists"] = out["specialists"][:MAX_LIST]
    out["overtaken"] = sorted(out["overtaken"], key=lambda o: -o["races"])[:MAX_LIST]

    # Right ahead: riders who most often finish 1-3 places in front of you. The next ones to catch.
    ahead = []
    for o in opps:
        n = sum(1 <= (m["places"] or 0) <= 3 for m in o["meetings"])
        behind = sum(-3 <= (m["places"] or 0) <= -1 for m in o["meetings"])
        if n + behind >= 2:
            ahead.append(_who(o, right_ahead=n, right_behind=behind, races=o["races"]))
    out["right_ahead"] = sorted(ahead, key=lambda a: (-a["right_ahead"], a["right_behind"]))[:10]
    out["right_behind"] = sorted(ahead, key=lambda a: (-a["right_behind"], a["right_ahead"]))[:10]
    return out


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
            other = "" if m["same_class"] else f"  [annen klasse: {m['their_class'] or 'åpen'}, du {m['my_class'] or 'åpen'}]"
            print(f"  {m['date']}  {m['race']:<32} du {res}  {fmt_gap(m['gap_s'])}  (deres tid {m['their_time']}){other}")


def write(opps, analysis):
    with open(os.path.join(HERE, "rivals.json"), "w", encoding="utf-8") as f:
        json.dump({"rider": ME, "rivals": [o["turritt_id"] for o in rivals(opps)],
                   "insights": insights(opps, club_table(ME, EVS)), "opponents": opps},
                  f, ensure_ascii=False, indent=1)
    cols = ["turritt_id", "name", "club", "age_class", "races", "wins", "losses", "draws",
            "same_class_races", "same_class_wins", "same_class_losses", "avg_gap_s", "median_gap_pct"]
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


def iso(d):
    dd, mm, yy = d.split(".")
    return f"20{yy}-{mm}-{dd}"


def profile(analysis):
    """Share of the field beaten per race type and per year, and what it goes with."""
    out = {"by_type": {}, "by_year": {}, "correlations": None}
    for key, f in (("by_type", lambda a: a["type"]), ("by_year", lambda a: "20" + a["date"][-2:])):
        by = defaultdict(list)
        for a in analysis:
            by[f(a)].append(a["beaten_pct"])
        out[key] = {k: {"races": len(v), "avg_beaten_pct": round(statistics.mean(v), 1)} for k, v in sorted(by.items())}
    if len(analysis) >= 4:
        y = [a["beaten_pct"] for a in analysis]
        out["correlations"] = {}
        for key in ("field", "climb_m_per_km", "distance_km"):
            try:
                out["correlations"][key] = round(statistics.correlation([float(a[key] or 0) for a in analysis], y), 2)
            except statistics.StatisticsError:  # constant input
                out["correlations"][key] = None
    return out


SHARDS = 64
MAX_LIST = 20  # clubs, specialists, overtaken per rider
SUMMARY_KEYS = ("turritt_id", "name", "club", "races", "wins", "losses", "draws",
                "same_class_races", "same_class_wins", "same_class_losses", "avg_gap_s", "median_gap_pct")


def followed():
    try:
        with open(os.path.join(HERE, "riders.json"), encoding="utf-8") as f:
            return {str(r.get("turritt_id") or r["id"]) for r in json.load(f)["riders"]}
    except (OSError, ValueError, KeyError):
        return {ME}


def rider_object(entry, evs, full):
    """One rider for the site. full (riders in riders.json, who asked for their data): head-to-head
    with every opponent over all their races. Otherwise results only; the app can still compute
    head-to-head with anyone from races.json."""
    me = entry["id"]
    mine = [ev for ev in evs if me in ev["by_id"]]
    urls = {ev["race_id"]: ev["sheet"]["Turritt"] for ev in mine}
    opps, analysis = build(me, mine, None if full else [])
    results = [{
        "race": a["race"], "date": iso(a["date"]), "type": a["type"], "class": a["class"],
        "place": a["class_place"] if a["time"] != "DNF" else None, "field": a["class_n"],
        "top_pct": round(100 * a["class_place"] / a["class_n"], 2) if a["class_place"] != "" else None,
        "behind_pct": a["behind_class_winner_pct"] if a["time"] != "DNF" else None, "time": a["time"],
        "winner": a["class_winner"], "overall_place": a["place"], "overall_field": a["field"],
        "beaten_pct": a["beaten_pct"], "distance_km": a["distance_km"], "climb_m_per_km": a["climb_m_per_km"],
        "turritt": urls[a["turritt_race_id"]],
    } for a in analysis]
    results.sort(key=lambda a: a["date"])
    obj = {k: entry[k] for k in ("id", "name", "club", "age_class")}
    obj["results"] = results
    obj.update(profile(analysis))
    if not full:
        obj.update(opponents=[], rivals=[], insights={})
        return obj
    ins = insights(opps, club_table(me, mine))
    del ins["gap_curves"]  # the app draws them from opponents
    ranked = [o["turritt_id"] for o in rivals(opps)]
    named = set(ranked) | {x["turritt_id"] for v in ins.values() if isinstance(v, list)
                           for x in v if "turritt_id" in x}
    named |= {x["turritt_id"] for v in ins["rivals_by_type"].values() for x in v}
    # Everyone met twice or more; riders met once are only in the totals (and in races.json).
    obj["opponents"] = [
        [o["turritt_id"], o["name"], o["club"], o["wins"], o["losses"], o["median_gap_pct"],
         [[m["race"], iso(m["date"]), m["type"], m["result"][0], m["gap_s"], m["gap_pct"], m["places"],
           m["my_class"], m["their_class"], int(m["same_class"])] for m in o["meetings"]]]
        for o in opps if o["races"] >= 2 or o["turritt_id"] in named]
    obj["rivals"] = ranked
    obj["insights"] = ins
    wl = [tally(ev["times"], int(ev["by_id"][me][0][9])) for ev in mine]
    obj["record"] = {"opponents": len(opps), "wins": sum(w for w, _ in wl), "losses": sum(l for _, l in wl)}
    return obj


def update_rider(tid):
    """Rebuild one rider's full profile in place (for the "fetch all my races" job), leaving the
    other riders' files as they are."""
    evs = events()
    data = os.path.join(HERE, "data", "riders")
    with open(os.path.join(data, "index.json"), encoding="utf-8") as f:
        index = json.load(f)
    rows = [(iso(ev["sheet"]["Date"]), ev["by_id"][tid][0]) for ev in evs if tid in ev["by_id"]]
    if not rows:
        raise SystemExit(f"{tid} er ikke i noen av resultatlistene")
    last = max(rows, key=lambda x: x[0])[1]
    entry = {"id": tid, "name": name(last), "club": last[7].strip(), "age_class": last[8],
             "races": len(rows), "shard": f"{int(tid) % SHARDS:02}"}
    index = [e for e in index if e["id"] != tid] + [entry]
    index.sort(key=lambda r: (-r["races"], r["name"]))
    path = os.path.join(data, f"shard-{entry['shard']}.json")
    try:
        with open(path, encoding="utf-8") as f:
            shard = json.load(f)
    except OSError:
        shard = {}
    shard[tid] = rider_object(entry, evs, True)
    for p, obj in ((path, shard), (os.path.join(data, "index.json"), index)):
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return shard[tid]


def write_all(evs):
    """Static-site data for every rider in the cached lists: races.json, riders/index.json, riders/shard-NN.json."""
    data = os.path.join(HERE, "data")
    os.makedirs(os.path.join(data, "riders"), exist_ok=True)
    dump = lambda path, obj: json.dump(obj, open(os.path.join(data, path), "w", encoding="utf-8"),
                                       ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    races_out, seen = [], defaultdict(list)
    for ev in evs:
        sh = ev["sheet"]
        dist, elev = float(sh["Distance (km)"] or 0), float(sh["Elevation gain (m)"] or 0)
        races_out.append({
            "id": ev["race_id"], "name": sh["Race"], "date": iso(sh["Date"]), "type": sh["Type"],
            "distance_km": dist, "climb_m_per_km": round(elev / dist, 1) if dist else None,
            "turritt": sh["Turritt"],
            "rows": [[r[2], name(r), r[7].strip(), r[8], c, int(r[9]) if int(r[9]) < DNF else None]
                     for r, c in sorted(ev["cats"], key=lambda rc: int(rc[0][9]))],
        })
        for tid, (r, _) in ev["by_id"].items():
            seen[tid].append((iso(sh["Date"]), r))
    races_out.sort(key=lambda r: r["date"])
    dump("races.json", {
        "scope": "Turritt result lists of every race ridden by the riders in riders.json (data/results.json). "
                 "Other riders' histories only cover these races.",
        "row_fields": ["turritt_id", "name", "club", "age_class", "class", "time_s (null = DNF)"],
        "races": races_out})

    index = []
    for tid, rs in seen.items():
        last = max(rs, key=lambda x: x[0])[1]
        index.append({"id": tid, "name": name(last), "club": last[7].strip(), "age_class": last[8],
                      "races": len(rs), "shard": f"{int(tid) % SHARDS:02}"})
    index.sort(key=lambda r: (-r["races"], r["name"]))

    follow = followed()
    shards = defaultdict(dict)
    for entry in index:
        shards[entry["shard"]][entry["id"]] = rider_object(entry, evs, entry["id"] in follow)

    riders_dir = os.path.join(data, "riders")
    for f in os.listdir(riders_dir):  # clear files from earlier layouts
        os.remove(os.path.join(riders_dir, f))
    dump(os.path.join("riders", "index.json"), index)
    for k, v in shards.items():
        dump(os.path.join("riders", f"shard-{k}.json"), v)
    return len(index), sum(e["id"] in follow for e in index)


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

    ins = insights(opps, club_table(ME, EVS))
    for typ, rs in ins["rivals_by_type"].items():
        print(f"\nRivaler, {typ}:")
        for o in rs[:5]:
            print(f"  {o['races']:>2} ritt  {o['wins']}-{o['losses']}  median {o['median_gap_pct']:+.1f} %  {o['name']}")
    print("\nTidsforskjell over tid (minus = du var raskere):")
    for c in ins["gap_curves"][:5]:
        print(f"  {c['name']:<28} " + "  ".join(f"{p['date'][:5]}.{p['date'][-2:]} {fmt_gap(p['gap_s'])}" for p in c["points"]))
    for key, label in (("nemesis", "Nemesis (jevnbyrdige du taper oftest mot)"), ("victims", "Offer (jevnbyrdige du slår oftest)")):
        print(f"\n{label}:")
        for o in ins[key]:
            print(f"  {o['wins']}-{o['losses']}  {o['name']} ({o['club']})")
    print("\nSpesialister:")
    for o in ins["specialists"]:
        print(f"  {o['name']}: sterkere i {', '.join(o['stronger_than_you_in'])}, svakere i {', '.join(o['weaker_than_you_in'])}")
    print("\nForbikjørt:")
    for o in ins["overtaken"]:
        print(f"  {o['name']}: tapte for i {o['lost_in']}, slo i {o['beat_in']}")
    print("\nKlubber (seiersprosent, minst 20 dueller):")
    for c in ins["clubs"]:
        print(f"  {c['win_pct']:5.1f} %  {c['wins']:>3}-{c['losses']:<3} {c['riders']:>3} ryttere  {c['club']}")
    print("\nOftest rett foran deg (1-3 plasser):")
    for o in ins["right_ahead"][:8]:
        print(f"  {o['right_ahead']} ganger foran, {o['right_behind']} bak  {o['name']} ({o['club']})")
    print("\nOftest rett bak deg:")
    for o in ins["right_behind"][:5]:
        print(f"  {o['right_behind']} ganger bak, {o['right_ahead']} foran  {o['name']} ({o['club']})")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] in ("rytter", "rider"):
        o = update_rider(sys.argv[2])
        print(f"{o['name']}: {len(o['results'])} ritt, {len(o['rivals'])} rivaler, {o['record']['opponents']} motstandere")
        sys.exit()
    evs = EVS = events()
    opps, analysis = build(ME, evs)
    if len(sys.argv) > 2 and sys.argv[1] in ("søk", "sok", "search"):
        search(opps, " ".join(sys.argv[2:]))
    else:
        write(opps, analysis)
        n, written = write_all(evs)
        summary(opps, analysis)
        print(f"\ndata/: {n} ryttere i indeksen, {written} med rivaler (ryttere i riders.json)")
