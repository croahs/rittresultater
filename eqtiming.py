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
# Points races: everyone who scores gets the race's time, so the time says nothing about the
# placing. They are read as points races (kermesse()), not as timed races (races()).
POINTS_RACE = re.compile(r"kermesse", re.I)
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
        # EQ Timing also times ski and running races; keep the cycling federation's events only.
        if (h.get("Forbund") or {}).get("Navn", "Norges Cykleforbund") != "Norges Cykleforbund":
            continue
        if POINTS_RACE.search(h["ArrangementNavn"]):
            continue
        rows = result_list(h["ArrangementUID"], h["EtappeUID"])
        me = next((r for r in rows if r[0] == rider), None)
        if not me or me[2] == "DNS":  # did not start: not a race for this rider
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



def named_list(event, stage):
    """[(rider id, name, club, age class, status, time in ms, start group)] for one race,
    cached forever. For registry races (registry.py), where riders are matched by name because
    EQ links only some results to a profile. Anonymised rows (the rider asked EQ) keep their
    place in the list but have no name or club (None), so they are never shown or matched."""
    def fetch():
        items = _get(f"Result/Total/{event}/{stage}", count=99999)["Items"]
        return [[i["Deltaker"]["Utover"]["UID"]] + ([None, None] if i["Deltaker"].get("Anonym") else
                 [i["Deltaker"]["Utover"].get("NavnFormatert") or "", i["Deltaker"].get("Klubbnavn") or ""])
                + [i["Deltaker"]["Klasse"]["Navn"], i["StatusTekst"], i["AkkumulertTid"], i["Deltaker"]["Pulje"]["Navn"].strip()]
                for i in items]
    return _cached(f"named:{event}:{stage}", fetch)


def event_stages(event_id):
    """[(stage id, stage name)] of an event that has results on EQ (Resultat), else []."""
    key = f"stages:{event_id}"
    if key not in _cache:  # an event without results yet is asked again next run
        e = _get(f"Event/{event_id}")
        if not e.get("Resultat"):
            return []
        _cached(key, lambda: [[int(k), v.get("Navn") or ""] for k, v in e["Etapper"].items()])
    return [tuple(x) for x in _cache[key]]


def registry_races(entry, name, rider=None):
    """The rider's results in one registry race on EQ, by EQ id or else by name, shaped like
    races(). Stages matching entry["skip_classes"] (e.g. "uten tid") are left out."""
    import raceresult
    want, out = raceresult.fold(name), []
    skip = re.compile(entry["skip_classes"], re.I) if entry.get("skip_classes") else None
    for stage, stage_name in event_stages(entry["event"]):
        if (skip and skip.search(stage_name)) or (entry.get("stage") and stage != entry["stage"]):
            continue
        rows = [r for r in named_list(entry["event"], stage) if r[1] is not None]  # as before: without anonymised rows
        me = next((r for r in rows if rider and r[0] == rider), None) or \
            next((r for r in rows if raceresult.fold(r[1]) == want), None)
        if not me or me[4] == "DNS":
            continue
        pool = [[r[0], r[3], r[4], r[5], r[6]] for r in rows]  # the shape _rank() and races() use
        if OWN_RACE_GROUP.search(me[6]):
            pool = [r for r in pool if r[4] == me[6]]
        place, n = _rank(pool, me[0])
        age_place, age_n = _rank([r for r in pool if r[1] == me[3]], me[0])
        finishers = [r[3] for r in pool if r[2] == "TIME"]
        out.append({
            "event_id": entry["event"], "stage_id": stage, "name": entry["name"], "stage": stage_name,
            "group": me[6], "date": entry["date"], "class_place": place, "class_n": n,
            "age_class": me[3], "age_place": age_place, "age_n": age_n,
            "time": _hms(me[5]) if me[4] == "TIME" else me[4],
            "class_winner": _hms(min(finishers)) if finishers else "",
            "url": f"https://live.eqtiming.com/{entry['event']}#result",
        })
    return out


def _cached(key, fetch):
    if key not in _cache:
        _cache[key] = fetch()
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False)
    return _cache[key]


def event(event_id):
    """(name, date) of one event, cached forever."""
    return tuple(_cached(f"event:{event_id}", lambda: (lambda e: [e["Navn"], e["Dato"][:10]])(_get(f"Event/{event_id}"))))


def startlist(event_id):
    """{rider id: [start group, stage id]} for everyone registered for one event, cached forever."""
    def fetch():
        items = _get(f"Startlist/{event_id}", count=5000)["Items"]
        items = items.values() if isinstance(items, dict) else items
        return {str(i["Utover"]["UID"]): [(i["Pulje"]["Navn"] or "").strip(), i["Pulje"]["EtappeUID"]] for i in items}
    return _cached(f"startlist:{event_id}", fetch)


def points_list(event_id, stage):
    """[(rider id, status, points, time in ms, place)] for one group of a points race, cached
    forever. The points are in EQ Timing's "Tillegg" column. Some lists hold only the riders
    who scored; others hold every finisher with an official place."""
    def fetch():
        items = _get(f"Result/Total/{event_id}/{stage}", count=99999)["Items"]
        num = lambda x: int(x) if str(x).strip().isdigit() else 0
        return [[i["Deltaker"]["Utover"]["UID"], i["StatusTekst"], num(i["Tillegg"]), i["AkkumulertTid"],
                 (i.get("Plassering") or {}).get("Total") or 0] for i in items]
    return _cached(f"points:{event_id}:{stage}", fetch)


def kermesse(event_id, rider):
    """A rider's result in a points race (kermesse), or None when they weren't registered.

    The list only has the riders who scored (plus some DNS), so riders without points share
    the places after the last scorer, as in SSK Cup. Riders in class = registered in the group
    minus those marked DNS."""
    me = startlist(event_id).get(str(rider))
    if not me:
        return None
    group, stage = me
    name, date = event(event_id)
    rows = points_list(event_id, stage)
    dns = {r[0] for r in rows if r[1] == "DNS"}
    if rider in dns:
        return None
    field = sum(1 for uid, (_, st) in startlist(event_id).items() if st == stage and int(uid) not in dns)
    scored = [r for r in rows if r[1] == "TIME" and r[2] > 0]
    mine = next((r for r in rows if r[0] == rider and r[1] == "TIME"), None)
    pts = mine[2] if mine else 0
    if mine and mine[4]:  # the list ranks every finisher: use the official place
        place = str(mine[4])
    elif pts:
        place = str(1 + sum(r[2] > pts for r in scored))
    else:  # not a scorer, and the list only has scorers: shared places after them
        place = f"{len(scored) + 1}-{field} (shared)" if field > len(scored) + 1 else str(field)
    times = [r[3] for r in scored if r[3]]
    return {"event_id": event_id, "stage_id": stage, "name": name, "date": date, "group": group,
            "points": pts, "place": place, "field": field, "winner_points": max((r[2] for r in scored), default=0),
            "time": _hms(max(times)) if times else "", "url": f"https://live.eqtiming.com/{event_id}#result"}


def points_races(rider, since=0, extra=()):
    """kermesse() for every points race in the rider's EQ Timing history (they scored), plus the
    events in extra (riders who don't score aren't in their EQ history at all)."""
    ids = [h["ArrangementUID"] for h in history(rider)
           if POINTS_RACE.search(h["ArrangementNavn"]) and int(h["ArrangementDato"][:4]) >= since]
    out = []
    for e in dict.fromkeys(ids + list(extra)):
        k = kermesse(e, rider)
        if k:
            out.append(k)
    return out


if __name__ == "__main__":
    for r in races():
        print(r)
