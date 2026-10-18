"""Timed races whose results are on Birken's own result service (tiur.birken.no), found by name.

Birken times GravelBirken. Like raceresult it has no rider profiles to look up by id, so the
races come from data/registry.json (registry.py) and riders are matched by name. Each race's
list is read once (50 riders a page, 2 s apart) and cached for good in cache/birken.json.
The rows have the same shape as eqtiming.races(), so build.py adds them the same way.

Birken's classes are wide (M17-29, M30-39), so they don't say which UCI gravel age group a
rider is in (19-34, 35-39, ...; Pedår, 2026-10-18). Each rider's age is read once from their
result page (one request a rider, 2 s apart) and cached with the day it was read. Birken
gives today's age, not the birth year, so the UCI age (race year minus birth year) is taken as
that age less the years since the race: a rider whose birthday falls between the read day
and new year is one year older to the UCI than counted here.
"""
import ast
import datetime
import json
import os
import re
import time

import requests

import raceresult

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(HERE, "cache", "birken.json")
API = "https://tiur.birken.no/embed/result.ashx"
PAUSE = 2
# Birken's class ids -> age classes as the other timers write them.
CLASSES = {"M17": "M17-29", "K17": "K17-29", "M30": "M30-39", "K30": "K30-39", "M40": "M40-49", "K40": "K40-49",
           "M50": "M50-59", "K50": "K50+", "M60": "M60+", "ME": "M Elite", "KE": "K Elite"}
NO_TIME = {"LEDU"}  # companions without a time
try:
    with open(CACHE_FILE, encoding="utf-8") as f:
        _cache = json.load(f)
except (OSError, ValueError):
    _cache = {}


def _save():
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(_cache, f, ensure_ascii=False)


def _get(method, f):
    time.sleep(PAUSE)
    r = requests.get(API, params={"m": method, "f": json.dumps(f, ensure_ascii=False), "json": "0"}, timeout=60)
    r.raise_for_status()
    return r.text


def result_list(arr, year):
    """[(place or DNF, name, club, class id, H:MM:SS or "", result id)] for one race, cached
    forever. arr is Birken's event id (202646 = GravelBirken 100 2026)."""
    key = f"list:{arr}"
    if key not in _cache:
        out, at = [], None
        while True:
            f = {"stnr": "", "navn": "", "klubb": "", "postnr": "", "poststed": "", "nasjon": None, "kjonn": "",
                 "klasseid": "", "puljeid": "", "stedid": "", "resyear": year, "arr": arr, "sport": 2, "liveres": ""}
            if at is not None:
                f["_resultatpunkt"] = at
            text = _get("search", f)
            # The last item is the page navigation, written with single quotes.
            cut = text.rfind(",{'_PgStart'")
            rows, nav = (json.loads(text[:cut] + "]"), ast.literal_eval(text[cut + 1:-1])) if cut > 0 else (json.loads(text), {})
            for x in rows:
                s = (x["_TidSekunder"] or 0) // 100  # hundredths; none for DNF
                done = x["_Status"] == "" and s > 0
                out.append([x["Pl"] if done else (x["_Status"] or "DNF"), x["Person"], x["Klubb"] or "", x["KlasseId"],
                            _hms(s) if done else "", x["_ResultId"]])
            if not rows or nav.get("_PgDn", -1) < 0:
                break
            at = nav["_PgDn"]
        _cache[key] = out
        _save()
    return _cache[key]


def age(result_id):
    """(age, day read) for the rider of one result, read once and cached."""
    key = f"age:{result_id}"
    if key not in _cache:
        d = json.loads(_get("person", {"resultid": result_id}))
        _cache[key] = [d[0].get("Alder") if d else None, datetime.date.today().isoformat()]
        _save()
    return _cache[key]


def uci_age(result_id, year):
    a, read = age(result_id)
    return None if a is None else a - (int(read[:4]) - year)


def uci_class(cls, a):
    """UCI gravel age group ("M19-34", "K35-39", ..., "M Elite"), or None for youth, para and
    companions. Elite riders stay elite: in a UCI race they ride the elite class, not an age group."""
    sex = cls[:1]
    if cls in ("ME", "KE"):
        return f"{sex} Elite"
    if sex not in "MK" or cls not in CLASSES or a is None or a < 19:
        return None
    if a <= 34:
        return f"{sex}19-34"
    lo = min(a // 5 * 5, 80)
    return f"{sex}{lo}+" if lo == 80 else f"{sex}{lo}-{lo + 4}"


def uci_classes(arr, year):
    """{result id: UCI class} for every rider in one race (an age lookup per rider not cached yet)."""
    return {r[5]: uci_class(r[3], uci_age(r[5], year)) for r in result_list(arr, year) if r[3] not in NO_TIME}


def races(entry, name):
    """The rider's result (by name) in one registry race, shaped like eqtiming.races(), plus
    the UCI gravel age group: uci_class, uci_place, uci_n."""
    want, year = raceresult.fold(name), int(entry["date"][:4])
    rows = [r for r in result_list(entry["event"], year) if r[3] not in NO_TIME]
    me = next((r for r in rows if raceresult.fold(r[1]) == want), None)
    if not me or not me[0].isdigit():
        return []
    rank = lambda group: 1 + sum(1 for r in group if r[4] and _secs(r[4]) < _secs(me[4]))
    cls = [r for r in rows if r[3] == me[3]]
    uci = uci_classes(entry["event"], year)
    mine = uci.get(me[5])
    group = [r for r in rows if mine and uci.get(r[5]) == mine]
    return [{
        "event_id": entry["event"], "stage_id": 1, "name": entry["name"],
        "stage": re.sub(r"\s+20\d\d$", "", entry["name"]), "group": "", "date": entry["date"],
        "class_place": rank(rows), "class_n": len(rows),
        "age_class": CLASSES.get(me[3], me[3]), "age_place": rank(cls), "age_n": len(cls),
        "uci_class": mine, "uci_place": rank(group) if mine else None, "uci_n": len(group) if mine else None,
        "time": _hms_pad(me[4]), "class_winner": _hms_pad(min((r[4] for r in rows if r[4]), key=_secs)),
        "url": "https://tiur.birken.no/res/ListResult.aspx",
    }]


def _hms(s):
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def _secs(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def _hms_pad(t):
    return ":".join(x.zfill(2) for x in t.split(":"))
