"""The races we fetch from their own timer (data/registry.json), matched to a rider by name.

Turritt is not a source (Pedår, 2026-09-29), and raceresult, Ultimate and Birken have no
rider profiles, so every race we read from them is listed by hand. EQ Timing races the rider has
linked to their EQ profile are found from the profile (eqtiming.races); the registry adds
EQ races where the result isn't linked, matched by EQ id or name.
"""
import json
import re
import os

import birken
import eqtiming
import raceresult
import ultimate

FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "registry.json")


def load():
    """Every row (one race series and year) in the registry."""
    with open(FILE, encoding="utf-8") as f:
        return json.load(f)["races"]


def entries():
    """One entry per source list we read: the confirmed rows' sources, points races left out."""
    for r in load():
        if r.get("status") != "bekreftet" or r.get("type") == "Points":
            continue
        for src in r["sources"]:
            yield {**src, "name": f"{r['name']} {r['year']}", "date": r["date"], "type": r.get("type")}


def races(rider, log=print):
    """Every registry race the rider rode, shaped like eqtiming.races(), plus "source"."""
    since, eq_id, out = int(rider.get("since") or 0), rider.get("eq_id"), []
    for e in entries():
        if int(e["date"][:4]) < since:
            continue
        try:
            if e["source"] == "eqtiming":
                found = eqtiming.registry_races(e, rider["name"], int(eq_id) if eq_id else None)
            elif e["source"] in ("raceresult", "ultimate", "birken"):
                # Lists without profiles have only the name, so try the other names a rider
                # has raced under (also_names in riders.json, e.g. without a middle name).
                mod = {"raceresult": raceresult, "ultimate": ultimate, "birken": birken}[e["source"]]
                found = next((f for n in [rider["name"], *rider.get("also_names", [])] if (f := mod.races(e, n))), [])
            else:
                continue
        except Exception as x:  # one list we can't read shouldn't stop the rest
            log(f"{rider['id']}: {e['name']} ({e['source']}) skipped: {x}")
            continue
        out += [{**f, "source": e["source"], "type": e.get("type")} for f in found]
    return out


def _save(data):
    with open(FILE, "w", encoding="utf-8") as f:
        f.write("{\n  \"_help\": " + json.dumps(data["_help"], ensure_ascii=False) + ",\n  \"races\": [\n")
        f.write(",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in data["races"]))
        f.write("\n  ]\n}\n")


def add_eq(event_id, stages, name, date, type_, note):
    """Add one EQ Timing race (the stages given) as a confirmed row, unless the registry already
    lists that event, whose row was then made by hand and is left as it is. True if added."""
    with open(FILE, encoding="utf-8") as f:
        data = json.load(f)
    if any(s.get("source") == "eqtiming" and s.get("event") == event_id for r in data["races"] for s in r["sources"]):
        return False
    base = re.sub(r"\s*\b20\d\d\b\s*", " ", name).strip()
    data["races"].append({"series": base.lower(), "year": int(date[:4]), "name": base, "date": date, "type": type_,
                          "sources": [{"source": "eqtiming", "event": event_id, "stage": s} for s in stages],
                          "turritt_ids": [], "status": "bekreftet", "note": note})
    data["races"].sort(key=lambda r: r["date"])
    _save(data)
    return True
