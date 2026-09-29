"""Pull a rider's race results from EQ Timing (live.eqtiming.com).

EQ Timing's live pages load JSON from /api/..., which we call directly:
  Participant/Results?id=N       every race a rider has a result in (one request)
  Result/Total/<event>/<stage>   the full result list of one race

Be gentle, as with Turritt: a published result list never changes, so each one is
fetched once and cached for good in cache/eqtiming.json (only the fields we use).
The rider's history is fetched live once per run so new races show up.

Placing rules match turritt.py: DNS is dropped, DNF stays in the count, and
rank = 1 + riders with a strictly faster time. "class" = the stage you rode
(e.g. "Atlantic Gravel 140km"), narrowed to your start group when that
group is its own race (10 km vs 5 km, Racer vs Tempo), not a seeded wave; the age class (M30-34 etc.) is kept separately.
"""
import json
import os
import re
import time

import requests

BASE = "https://live.eqtiming.com/api"
RIDER_ID = 6753412  # Peder Holterman Solland
PAUSE = 2
# Start groups that are separate competitions (distance or bike type), unlike
# seeded waves ("Pulje 2 - 3.00 til 3.20 timer") which are one race.
OWN_RACE_GROUP = re.compile(r"\d\s*km|racer|tempo|rekrutt", re.I)
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "eqtiming.json")

s = requests.Session()
s.headers["User-Agent"] = "rittresultater/0.1 (personal results sheet)"
_last = 0.0
try:
    with open(CACHE_FILE, encoding="utf-8") as f:
        _cache = json.load(f)
except (OSError, ValueError):
    _cache = {}


def _get(path, **params):
    global _last
    time.sleep(max(0, _last + PAUSE - time.time()))
    r = s.get(f"{BASE}/{path}", params=params, timeout=60)
    _last = time.time()
    r.raise_for_status()
    return r.json()


def history(rider=RIDER_ID):
    return _get("Participant/Results", id=rider)


def result_list(event, stage):
    """[(rider id, age class, status, time in ms, start group)] for one race, cached forever."""
    key = f"results:{event}:{stage}"
    if key not in _cache:
        items = _get(f"Result/Total/{event}/{stage}", count=99999)["Items"]
        _cache[key] = [[i["Deltaker"]["Utover"]["UID"], i["Deltaker"]["Klasse"]["Navn"],
                        i["StatusTekst"], i["AkkumulertTid"], i["Deltaker"]["Pulje"]["Navn"].strip()]
                       for i in items]
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
    return _cache[key]


def _hms(ms):
    t = int(ms // 1000)  # EQ Timing shows times truncated to the second
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def _rank(rows, me):
    """(place, field) among rows: DNS dropped, DNF counted and placed behind finishers."""
    field = [r for r in rows if r[2] != "DNS"]
    mine = next(r for r in field if r[0] == me)
    if mine[2] != "TIME":
        return None, len(field)
    return 1 + sum(1 for r in field if r[2] == "TIME" and r[3] < mine[3]), len(field)


def races(rider=RIDER_ID, since=0):
    """One dict per race in the rider's EQ Timing history from season `since`, newest first."""
    out = []
    for h in history(rider):
        if not h.get("HasResult") or int(h["ArrangementDato"][:4]) < since:
            continue
        rows = result_list(h["ArrangementUID"], h["EtappeUID"])
        me = next((r for r in rows if r[0] == rider), None)
        if not me:
            continue
        if OWN_RACE_GROUP.search(me[4]):
            rows = [r for r in rows if r[4] == me[4]]
        place, n = _rank(rows, rider)
        age_place, age_n = _rank([r for r in rows if r[1] == me[1]], rider)
        finishers = [r[3] for r in rows if r[2] == "TIME"]
        out.append({
            "event_id": h["ArrangementUID"], "stage_id": h["EtappeUID"],
            "name": h["ArrangementNavn"], "stage": h["EtappeNavn"], "group": me[4], "date": h["ArrangementDato"][:10],
            "class_place": place, "class_n": n,
            "age_class": me[1], "age_place": age_place, "age_n": age_n,
            "time": _hms(me[3]) if me[2] == "TIME" else me[2],
            "class_winner": _hms(min(finishers)) if finishers else "",
            "url": f"https://live.eqtiming.com/{h['ArrangementUID']}#result",
        })
    return out


if __name__ == "__main__":
    for r in races():
        print(r)
