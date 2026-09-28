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
    me = turritt_rider(me_id)
    profile = {
        "id": me_id, "name": me.get("name", ""), "club": me.get("club", ""), "age_class": me.get("age_class", ""),
        "power": True, "clips": sorted(set(clips)),
        "results": results, "points": points,
        "opponents": rivals.get("opponents", []), "rivals": rivals.get("insights", {}).get("closest", []),
        "insights": {k: v for k, v in rivals.get("insights", {}).items() if k != "closest"},
    }
    dump(os.path.join(OUT, "athletes", f"{me_id}.json"), profile)
    dump(os.path.join(OUT, "site.json"), {"default_rider": me_id, "profiles": [me_id]})
    print(f"wrote {OUT}: {len(results)} races, {len(points)} points races, "
          f"{len(profile['opponents'])} opponents, clips {clips}, {len(index)} riders in search")


if __name__ == "__main__":
    main()
