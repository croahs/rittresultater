"""Our own rider ids ("r123"), with the ids each rider has at the timers (data/aliases.json).

Turritt is not a source any more (Pedår, 2026-09-29), so a rider can't be known by their
TurrittID. Every rider gets an id of ours, once, that never changes. data/aliases.json maps
it to the rider's ids elsewhere: TurrittID (from the cached Turritt lists, while the site
still uses them), EQ Timing participant id. Links are made only when they are certain:
- a TurrittID and EQ id given together in riders.json;
- an EQ result whose name matches exactly one Turritt rider who is in the same race's
  Turritt list (data/registry.json says which), or who has ridden for the same club.
Everything else that could be the same rider goes to data/linking.json, which is edited by
hand ("id": "r123" to link, "id": "new" for a rider of their own) and never guessed.
An EQ rider matching nobody gets an id of their own.

Usage:
  python3 riderids.py      # add ids for riders not seen before; existing ids stay as they are
"""
import json
import os
import re
import sys
from collections import Counter

import eqtiming
import raceresult
import registry
import turritt

HERE = os.path.dirname(os.path.abspath(__file__))
ALIASES = os.path.join(HERE, "data", "aliases.json")
LINKING = os.path.join(HERE, "data", "linking.json")
RIDERS = os.path.join(HERE, "riders.json")


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def load():
    """{our id: {"name", "club", "turritt", "eq"}}."""
    return _load(ALIASES, {}).get("riders", {})


def by_turritt():
    """{TurrittID: our id}, for moving the site's ids and URLs off TurrittIDs."""
    return {a["turritt"]: rid for rid, a in load().items() if a.get("turritt")}


def _club(c):
    """A club as its telling words: "Sandnes Sykleklubb" and "Sandnes SK" share {"sandnes"}."""
    c = re.sub(r"(\d)(?=[a-z])", r"\1 ", (c or "").lower())
    return set(raceresult.fold(re.sub(r"\b(sk|ck|il|if|bk|sykkel|sykkelklubb|sykleklubb|cykleklubb|sportsklubben|"
                                     r"idrettslag|cykle|club|klubb|team)\b", " ", c)))


def build(log=print):
    data = _load(ALIASES, {"riders": {}, "next": 1})
    riders, nxt = data["riders"], data["next"]
    linking = _load(LINKING, {"links": []})
    decided = {str(l["eq"]): l.get("id") for l in linking["links"] if l.get("id")}
    open_links = {str(l["eq"]): l for l in linking["links"] if not l.get("id")}

    def new(**kw):
        nonlocal nxt
        rid = f"r{nxt}"
        nxt += 1
        riders[rid] = {k: v for k, v in kw.items() if v}
        return rid

    # Turritt riders from the cached lists (ids given out in TurrittID order, once).
    tt, clubs, in_race = {}, {}, {}
    for key, rows in turritt._cache.items():
        if key.startswith("results:"):
            for r in rows:
                if r[2] not in ("", "0"):
                    tt[r[2]] = f"{r[5]} {r[6]}".strip()
                    clubs.setdefault(r[2], Counter())[(r[7] or "").strip()] += 1
                    in_race.setdefault(key.split(":")[1], set()).add(r[2])
    have_tt = {a["turritt"] for a in riders.values() if a.get("turritt")}
    for tid in sorted(set(tt) - have_tt, key=int):
        new(name=tt[tid], club=clubs[tid].most_common(1)[0][0], turritt=tid)

    tt_id = {a["turritt"]: rid for rid, a in riders.items() if a.get("turritt")}
    eq_id = {str(a["eq"]): rid for rid, a in riders.items() if a.get("eq")}

    # Followed riders: riders.json says which TurrittID and EQ id are the same person.
    for r in _load(RIDERS, {"riders": []})["riders"]:
        if r.get("turritt_id") and r.get("eq_id") and r["turritt_id"] in tt_id and str(r["eq_id"]) not in eq_id:
            riders[tt_id[r["turritt_id"]]]["eq"] = int(r["eq_id"])
            eq_id[str(r["eq_id"])] = tt_id[r["turritt_id"]]

    # EQ riders from the cached named lists (registry races).
    by_name = {}
    for rid, a in riders.items():
        if a.get("turritt"):
            by_name.setdefault(" ".join(raceresult.fold(a["name"])), []).append(rid)
    # The same race on Turritt, from the registry: an EQ rider whose name matches a Turritt
    # rider in that very race's Turritt list is the same rider.
    same_race = {}
    for row in registry.load():
        for src in row["sources"]:
            if src["source"] == "eqtiming":
                same_race.setdefault(src["event"], set()).update(t for x in row["turritt_ids"] for t in in_race.get(x, ()))
    seen = {}
    for key, rows in eqtiming._cache.items():
        if key.startswith("named:"):
            for r in rows:
                seen.setdefault(str(r[0]), [r[1], r[2], set()])[2] |= same_race.get(int(key.split(":")[1]), set())
    for uid, (name, club, race_riders) in sorted(seen.items()):
        if uid in eq_id:
            continue
        if uid in decided:
            rid = decided[uid] if decided[uid] != "new" else new(name=name, club=club, eq=int(uid))
            riders[rid]["eq"] = int(uid)
            eq_id[uid] = rid
            continue
        cands = [c for c in by_name.get(" ".join(raceresult.fold(name)), []) if not riders[c].get("eq")]
        tid = riders[cands[0]]["turritt"] if len(cands) == 1 else None
        if tid and (tid in race_riders or any(_club(club) & _club(c) for c in clubs.get(tid, ()) if c)):
            riders[cands[0]]["eq"] = int(uid)
            eq_id[uid] = cands[0]
        elif cands:
            open_links[uid] = {"eq": int(uid), "name": name, "club": club,
                               "candidates": [{"id": c, "club": riders[c].get("club", "")} for c in cands], "id": None}
        else:
            eq_id[uid] = new(name=name, club=club, eq=int(uid))

    open_links = {u: l for u, l in open_links.items() if u not in eq_id}
    data = {"_help": "Our rider ids (riderids.py). Each id is given once and never reused or changed. "
                     "turritt: TurrittID (only while the site still uses Turritt data), eq: EQ Timing participant id.",
            "next": nxt, "riders": riders}
    with open(ALIASES, "w", encoding="utf-8") as f:
        f.write('{\n  "_help": ' + json.dumps(data["_help"], ensure_ascii=False) + f',\n  "next": {nxt},\n  "riders": {{\n')
        f.write(",\n".join(f"    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}"
                           for k, v in sorted(riders.items(), key=lambda kv: int(kv[0][1:]))))
        f.write("\n  }\n}\n")
    links = [l for l in linking["links"] if l.get("id")] + sorted(open_links.values(), key=lambda l: l["name"])
    with open(LINKING, "w", encoding="utf-8") as f:
        json.dump({"_help": "EQ Timing riders that may be a rider we already know. Set \"id\" to one of the "
                            "candidates' ids to link them, or to \"new\" for a rider of their own; riderids.py "
                            "applies it on its next run. Nothing here is linked by guessing.",
                   "links": links}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    log(f"riderids: {len(riders)} riders, {sum(1 for a in riders.values() if a.get('eq'))} with an EQ id, "
        f"{len(open_links)} to link by hand")
    return riders


if __name__ == "__main__":
    build(lambda m: print(m, file=sys.stderr))
