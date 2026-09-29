"""Write your own profile for the web dashboard (data/site/).

The site is static: it only reads these files, so refresh them after the pipeline has run.

  python3 export_web.py

Reads race_results_auto.csv + points_races.csv (your races, with power), rivals.json
(your head-to-head), season_clip*.json (GPS clips) and data/riders/ (every rider in the
cached result lists, from rivals.py). Nothing here makes a network request.
"""
import glob
import json
import os
import shutil

import dashboard

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "site")  # web/scripts/copy-data.mjs copies this and data/riders into the site
ME = "171101"


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def turritt_rider(rider_id):
    """Name, club and age class as the latest Turritt list has them."""
    with open(os.path.join(HERE, "cache", "turritt.json"), encoding="utf-8") as f:
        cache = json.load(f)
    rows = [r for k, v in cache.items() if k.startswith("results:") and isinstance(v, list)
            for r in v if r[2] == rider_id]
    if not rows:
        return {}
    r = rows[-1]
    return {"name": f"{r[5]} {r[6]}".strip(), "club": r[7].strip(), "age_class": r[8]}


def bike_class(r):
    """The class only when it says something (EQ lists often repeat the race name as the class)."""
    c = (r.get("class_name") or "").strip()
    words = set(r["name"].lower().split())
    if not c or len(c) > 24 or words & set(c.lower().replace("(", " ").replace(")", " ").split()):
        return None
    return c


def points_for(pipe, rider_id):
    """A followed rider's points races (kermesse, SSK Cup) from data/results.json, in the page's format."""
    s = lambda v: "" if v is None else str(v)
    return [{"name": p["name"], "date": p["date"], "cls": p["class_name"], "place": s(p["place"]), "n": s(p["field"]),
             "pts": s(p["points"]), "win": s(p["winner_points"]), "laps": s(p["laps"]), "time": s(p["race_time"]),
             "speed": s(p["speed_kmh"]), "np": s(p["np"]), "ap": s(p["avg_power"]), "note": p.get("note") or "",
             "icu": s((p.get("links") or {}).get("intervals"))}
            for p in pipe.get("points_races", []) if p["rider_id"] == rider_id]


def pipeline_profiles(me_id, index):
    path = os.path.join(HERE, "data", "results.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        pipe = json.load(f)
    written = []
    for rider in pipe.get("riders", []):
        rid = str(rider.get("turritt_id") or rider["id"])
        if rid == me_id:
            continue
        rows = [r for r in pipe.get("races", []) if r["rider_id"] == rider["id"]]
        if not rows:
            continue
        entry = next((r for r in index if r["id"] == rid), None)
        shard = {}
        if entry and entry.get("shard"):
            with open(os.path.join(HERE, "data", "riders", f"shard-{entry['shard']}.json"), encoding="utf-8") as f:
                shard = json.load(f).get(rid, {})
        links = lambda r: r.get("links") or {}
        results = [{
            "name": r["name"], "date": r["date"], "type": r["type"], "class": bike_class(r),
            "place": r["class_place"], "field": r["class_n"], "top": r["percentile"], "behind": r.get("behind_pct"),
            "time": r["time"], "winner": r.get("winner_time") or "",
            "np": r.get("np"), "ap": r.get("avg_power"), "speed": r.get("speed_kmh"),
            "km": r.get("distance_km"), "climb": r.get("elevation_m"),
            "age_class": r.get("age_class") or "", "age_place": r.get("age_place"), "age_n": r.get("age_n"),
            "turritt": links(r).get("turritt") or links(r).get("eqtiming") or links(r).get("raceresult") or "", "icu": links(r).get("intervals") or "",
        } for r in rows if r.get("class_place") and r.get("class_n")]
        dump(os.path.join(OUT, "athletes", f"{rid}.json"), {
            "id": rid, "name": shard.get("name") or rider["name"], "club": shard.get("club", ""),
            "age_class": shard.get("age_class", ""), "power": bool(rider.get("power")) and any(x["np"] for x in results),
            "clips": [], "results": results, "points": points_for(pipe, rider["id"]),
            "opponents": shard.get("opponents", []), "rivals": shard.get("rivals", []), "insights": shard.get("insights", {}),
        })
        written.append(rid)
    return written


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    results = dashboard.rows(os.path.join(HERE, "race_results_auto.csv"))
    points = dashboard.points_rows(os.path.join(HERE, "points_races.csv"))
    rivals = dashboard.rivals_payload(os.path.join(HERE, "rivals.json"))
    with open(os.path.join(HERE, "rivals.json"), encoding="utf-8") as f:
        me_id = json.load(f).get("rider", ME)

    clips = []
    for path in sorted(glob.glob(os.path.join(HERE, "season_clip*.json"))):
        with open(path, encoding="utf-8") as f:
            clip = json.load(f)
        dump(os.path.join(OUT, "clips", f"{me_id}-{clip['year']}.json"), clip)
        clips.append(clip["year"])

    index_path = os.path.join(HERE, "data", "riders", "index.json")
    index = []
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            index = json.load(f)

    # Your own profile: official results with power, points races, rivals, clips.
    # The search index (rivals.py) has the club from the newest result; the Turritt cache is only a fallback.
    me = {**turritt_rider(me_id), **{k: v for k, v in next((r for r in index if r["id"] == me_id), {}).items()
                                     if k in ("name", "club", "age_class") and v}}
    profile = {
        "id": me_id, "name": me.get("name", ""), "club": me.get("club", ""), "age_class": me.get("age_class", ""),
        "power": True, "clips": sorted(set(clips)),
        "results": results, "points": points,
        "opponents": rivals.get("opponents", []), "rivals": rivals.get("insights", {}).get("closest", []),
        "insights": {k: v for k, v in rivals.get("insights", {}).items() if k != "closest"},
    }
    dump(os.path.join(OUT, "athletes", f"{me_id}.json"), profile)
    # Other riders the pipeline follows (riders.json -> data/results.json): their full result
    # history, including races outside the lists rivals.py pools, plus rivals from their shard.
    profiles = [me_id] + pipeline_profiles(me_id, index)
    dump(os.path.join(OUT, "site.json"), {"default_rider": me_id, "profiles": profiles,
                                                 # Links to your intervals.icu activities; they are private there anyway.
                                                 "activity_links": False,
                                                 # Shown in the footer for corrections and takedown requests; set before launch.
                                                 "contact": "peder@holterman.no"})
    print(f"wrote {OUT}: {len(results)} races, {len(points)} points races, "
          f"{len(profile['opponents'])} opponents, clips {clips}, {len(index)} riders in search")


if __name__ == "__main__":
    main()
