"""The races we fetch from their own timer (data/registry.json), matched to a rider by name.

Turritt is not a source (Pedår, 2026-09-29), and raceresult and Ultimate have no rider
profiles, so every race we read from them is listed by hand. EQ Timing races the rider has
linked to their EQ profile are found from the profile (eqtiming.races); the registry adds
EQ races where the result isn't linked, matched by EQ id or name.
"""
import json
import os

import eqtiming
import raceresult
import ultimate

FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "registry.json")


def load():
    with open(FILE, encoding="utf-8") as f:
        return json.load(f)["races"]


def races(rider, log=print):
    """Every registry race the rider rode, shaped like eqtiming.races(), plus "source"."""
    since, eq_id, out = int(rider.get("since") or 0), rider.get("eq_id"), []
    for e in load():
        if int(e["date"][:4]) < since:
            continue
        try:
            if e["source"] == "eq":
                found = eqtiming.registry_races(e, rider["name"], int(eq_id) if eq_id else None)
            elif e["source"] == "raceresult":
                found = raceresult.races(e, rider["name"])
            elif e["source"] == "ultimate":
                found = ultimate.races(e, rider["name"])
            else:
                continue
        except Exception as x:  # one list we can't read shouldn't stop the rest
            log(f"{rider['id']}: {e['name']} ({e['source']}) skipped: {x}")
            continue
        out += [{**f, "source": e["source"], "type": e.get("type")} for f in found]
    return out
