"""Season clip data: every race of a year as a GPS track cut to the race itself.

Each track starts at the gun (t = 0) and ends at the official finish time, using the
same race window as the power numbers (sync.race_window), so warm-up, waiting at the
start and riding home are left out. The clip plays all tracks together on one clock,
so they finish in the order of their race times.

Usage:
  python3 season_clip.py race_results_auto.csv season_clip.json [year]      # data
  python3 season_clip.py race_results_auto.csv season_clip.html [year]      # standalone page

Year defaults to the latest year in the sheet. Needs intervals.icu (key in
INTERVALS_API_KEY, or the proxy adds it); GPS streams are cached in cache/intervals/.
"""
import csv
import json
import os
import sys

import sync

STEP = 5  # seconds between track points
HERE = os.path.dirname(os.path.abspath(__file__))
STREAMS_DIR = os.path.join(HERE, "cache", "intervals")


def gps_streams(icu, activity_id):
    """time/latlng/distance for one activity, cached on disk (rides never change)."""
    path = os.path.join(STREAMS_DIR, f"{activity_id}-gps.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    r = icu.s.get(f"{sync.INTERVALS}/activity/{activity_id}/streams.json",
                  params={"types": "time,latlng,distance"})
    r.raise_for_status()
    data = {}
    for x in r.json():
        data[x["type"]] = x["data"]
        if x["type"] == "latlng":
            data["lng"] = x.get("data2") or []
    os.makedirs(STREAMS_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return data


def track(streams, race_secs):
    """[[lat, lon], ...] every STEP seconds from the gun to the finish, or None."""
    t, lat, lng = streams.get("time"), streams.get("latlng"), streams.get("lng")
    if not t or not lat or not lng:
        return None
    win = sync.race_window({"time": t, "distance": streams.get("distance")}, race_secs)
    if not win:
        return None
    s0, s1 = win[2]
    # Position on a 1 s grid, carrying the last fix over gaps and missing GPS.
    pos = [None] * (t[-1] + 1)
    for i, s in enumerate(t):
        if lat[i] and lng[i]:
            pos[s] = (lat[i], lng[i])
    first = next((p for p in pos[s0:] if p), None)
    if first is None:
        return None
    last, out = first, []
    for s in range(s0, s1):
        last = pos[s] or last
        if (s - s0) % STEP == 0:
            out.append([round(last[0], 5), round(last[1], 5)])
    # A file shorter than the race time (Garmin stopped early) ends where it ended.
    return out


def build(src, year=None):
    icu = sync.Intervals(os.environ.get("INTERVALS_API_KEY", ""))
    if not os.environ.get("INTERVALS_API_KEY"):
        icu.s.auth = None  # let the environment's proxy add the key
    with open(src, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    year = year or max(sync.parse_date(r["Date"]).year for r in rows)
    races, skipped = [], []
    for r in rows:
        d = sync.parse_date(r["Date"])
        if d.year != year:
            continue
        name = r["Race"].removesuffix(f" {year}").strip()
        link = r.get("intervals.icu activity", "")
        pts = None
        if link:
            try:
                pts = track(gps_streams(icu, link.rsplit("/", 1)[1]), sync.secs(r["Time"]))
            except Exception as e:  # one bad ride should not stop the clip
                print(f"{name}: {e}", file=sys.stderr)
        if not pts:
            skipped.append(name)
            continue
        c_n = "Class participants (not officials or DNS, DNF included)"
        races.append({
            "name": name, "date": d.isoformat(), "type": r["Type"],
            "time": sync.secs(r["Time"]), "place": int(r["Placement in class"]),
            "field": int(r[c_n]), "km": float(r["Distance (km)"] or 0), "pts": pts,
        })
    races.sort(key=lambda x: x["date"])
    return {"year": year, "step": STEP, "races": races, "skipped": skipped}


def main(src, dst, year=None):
    data = build(src, int(year) if year else None)
    if dst.endswith(".html"):
        with open(os.path.join(HERE, "season_clip.js"), encoding="utf-8") as f:
            js = f.read()
        with open(os.path.join(HERE, "season_clip_template.html"), encoding="utf-8") as f:
            html = f.read()
        out = (html.replace("/*SEASON_CLIP_JS*/", js)
                   .replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":"))))
    else:
        out = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(dst, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"{len(data['races'])} races from {data['year']}"
          + (f"; skipped (no GPS): {', '.join(data['skipped'])}" if data["skipped"] else ""))


if __name__ == "__main__":
    main(*sys.argv[1:4])
