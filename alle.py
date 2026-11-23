"""Every harvested race on the site: the result lists harvest.py has fetched, made searchable.

The site's own data (rivals.py, export_web.py) only has the races a followed rider rode. This
script reads every list on the branch "harvest" (cache/harvest, see harvest.py) and writes three
tables to the site's D1 database, so anyone in any of those races can find themselves:

  alle_race    one race (an EQ Timing event): every stage's result list, placed
  alle_rider   every rider's results, in buckets by EQ Timing id (uid % RIDER_BUCKETS)
  alle_search  name search: riders by the first SEARCH_PREFIX letters of each word of their name,
               or more letters where that is too many riders (the shorter row then says {"split": 4},
               and a word no longer than the prefix moves to the word and a full stop: «ole.»)

Rows are JSON. D1 refuses SQL statements over 100 KB, so a value longer than CHUNK characters is
split over several rows (part 0, 1, ...) and the site joins them (web/functions/api/alle).
Only rows that changed since the last load are written: alle-loaded.json in cache/harvest holds a
hash of each, and the workflow commits it with the lists. Delete it to load everything again.

Placing, as in eqtiming.py: DNS is dropped, DNF stays in the count behind the finishers. A lap race
ranks by laps, then time. Riders with the same time share the place (both 64th, the next is 66th).
Anonymised riders (they asked EQ Timing) keep their place in the list with no name, and are never
searchable. Only EQ Timing lists so far: raceresult's lists differ from race to race.

  python3 alle.py sql FILE    write the SQL for what changed to FILE (the workflow runs it with wrangler),
                              and in FILE.json what D1 will hold once it has run
  python3 alle.py saved FILE  after a successful load: remember FILE.json as loaded
  python3 alle.py stats       sizes, without writing anything
"""
import glob
import gzip
import hashlib
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "cache", "harvest")
CALENDAR = os.path.join(DIR, "calendar.json")
LOADED = os.path.join(DIR, "alle-loaded.json")
RIDER_BUCKETS = 2048
SEARCH_PREFIX = 3
SEARCH_SPLIT = 2000  # a prefix with more riders than this is split by one more letter (and → ande, andr, ...)
SEARCH_MAX = 6  # longest prefix
CHUNK = 40_000  # characters per row; at most 2 bytes each in UTF-8 for these names, so under D1's 100 KB
FINISHED = {"TIME", "LAP", "COMPLETED"}
SPORT = {"Landevei": "Landevei", "Terreng": "Terreng", "Sykkelkross": "Sykkelkross", "Gravel": "Grus"}

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS alle_race (id TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (id, part))",
    "CREATE TABLE IF NOT EXISTS alle_rider (bucket INTEGER NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (bucket, part))",
    "CREATE TABLE IF NOT EXISTS alle_search (prefix TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (prefix, part))",
]
TABLES = {"race": ("alle_race", "id"), "rider": ("alle_rider", "bucket"), "search": ("alle_search", "prefix")}


def fold(s):
    """Lower case without accents, ø as o and æ as ae: the same as fold() in web/src/format.ts."""
    s = unicodedata.normalize("NFD", s.lower().replace("ø", "o").replace("æ", "ae"))
    return re.sub(r"[̀-ͯ]", "", s)


def words(name):
    """The words of a name for search (Egeland-Jarstø is egeland and jarsto)."""
    return [w for w in re.split(r"[^\w]+", fold(name)) if w]


def hms(ms):
    t = int(ms // 1000)  # EQ Timing shows times truncated to the second
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"


def placed(rows):
    """[(row, place)] for one stage: DNS dropped, finishers by laps then time with ties sharing the
    place, then DNF and the rest (place None)."""
    rows = [r for r in rows if r[4] != "DNS"]
    done = sorted((r for r in rows if r[4] in FINISHED and r[5]), key=lambda r: (-(r[7] or 1), r[5]))
    out, prev, place = [], None, 0
    for i, r in enumerate(done):
        key = (r[7] or 1, int(r[5] // 1000))
        if key != prev:
            place, prev = i + 1, key
        out.append((r, place))
    return out + [(r, None) for r in rows if not (r[4] in FINISHED and r[5])]


def status(r, laps_behind):
    """What the list shows instead of or beside a time: DNF, DSQ, «−2 runder»."""
    if r[4] in FINISHED and r[5]:
        return f"−{laps_behind} runde{'r' if laps_behind > 1 else ''}" if laps_behind > 0 else ""
    return r[4] if r[4] in ("DNF", "DSQ", "DNQ") else "DNF"


def build():
    """(races, riders, search): what goes in each table, keyed by row key."""
    cal = json.load(open(CALENDAR, encoding="utf-8"))["events"]
    races, people = {}, {}
    for path in sorted(glob.glob(os.path.join(DIR, "eq", "*", "*.json.gz"))):
        eid = os.path.basename(path).split(".")[0]
        ev = cal.get(f"eq:{eid}")
        if not ev:
            continue
        lists = json.load(gzip.open(path, "rt", encoding="utf-8"))
        stages = []
        for sid, st in lists.items():
            ranked = placed(st["rows"])
            if not ranked:
                continue
            field = len(ranked)
            top_laps = max((r[7] or 1) for r, _ in ranked)
            rows = []
            for r, place in ranked:
                behind = top_laps - (r[7] or 1) if st.get("laps", 0) > 1 else 0
                anon = r[1] is None
                rows.append([None if anon else r[0], r[1] or "", r[2] or "", r[3] or "",
                             place, hms(r[5]) if place else "", status(r, behind)])
                if anon or not r[1]:
                    continue
                p = people.setdefault(r[0], {"names": {}, "clubs": {}, "r": []})
                p["names"][r[1]] = ev["date"]
                if r[2]:
                    p["clubs"][r[2]] = max(p["clubs"].get(r[2], ""), ev["date"])
                p["r"].append([eid, ev["date"], ev["name"], SPORT.get(ev["sport"], ev["sport"]),
                               st.get("name") or "", r[3] or "", place, field, hms(r[5]) if place else "",
                               status(r, behind)])
            stages.append({"id": sid, "name": st.get("name") or "", "km": st.get("km"), "rows": rows})
        if stages:
            races[f"eq:{eid}"] = {"id": f"eq:{eid}", "name": ev["name"], "date": ev["date"],
                                  "sport": SPORT.get(ev["sport"], ev["sport"]), "place": ev.get("place") or "",
                                  "organizer": ev.get("organizer") or "", "stages": stages}
    riders, search = {}, {}
    for uid, p in people.items():
        name = max(p["names"], key=p["names"].get)  # the name in their newest race
        club = max(p["clubs"], key=p["clubs"].get) if p["clubs"] else ""
        res = sorted(p["r"], key=lambda x: x[1], reverse=True)
        riders.setdefault(str(uid % RIDER_BUCKETS), {})[str(uid)] = {"name": name, "club": club, "results": res}
        hit = [uid, name, club, len(res), res[0][1][:4]]
        for w in set(words(name)):
            search.setdefault(w[:SEARCH_PREFIX], []).append(hit)
    while True:
        big = [p for p, hits in search.items() if isinstance(hits, list) and len(hits) > SEARCH_SPLIT and len(p) < SEARCH_MAX]
        if not big:
            break
        for pre in big:
            n = len(pre) + 1
            for hit in search.pop(pre):
                # A word as short as the prefix (Ole under «ole») goes under the whole word and a «.»
                for key in {w[:n] if len(w) >= n else w + "." for w in words(hit[1]) if w.startswith(pre)}:
                    search.setdefault(key, []).append(hit)
            search[pre] = {"split": n}
    for hits in search.values():
        if isinstance(hits, list):
            hits.sort(key=lambda h: -h[3])
    return races, riders, search


def rows():
    """{"race:<id>": json, "rider:<bucket>": json, "search:<prefix>": json}"""
    races, riders, search = build()
    out = {}
    for kind, table in (("race", races), ("rider", riders), ("search", search)):
        for k, v in table.items():
            out[f"{kind}:{k}"] = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    return out


def digest(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:16]


def lit(v):
    return str(v) if isinstance(v, int) else "'" + str(v).replace("'", "''") + "'"


def sql(path):
    """Write the SQL that brings D1 up to date, and in path.json the hashes D1 will then hold."""
    loaded = json.load(open(LOADED)) if os.path.exists(LOADED) else {}
    now = {k: (v, digest(v)) for k, v in rows().items()}
    changed = [k for k, (_, h) in now.items() if loaded.get(k) != h]
    gone = [k for k in loaded if k not in now]
    with open(path, "w", encoding="utf-8") as f:
        for s in SCHEMA:
            f.write(s + ";\n")
        for k in sorted(changed) + gone:
            kind, key = k.split(":", 1)
            table, col = TABLES[kind]
            key = int(key) if kind == "rider" else key
            f.write(f"DELETE FROM {table} WHERE {col} = {lit(key)};\n")
            body = now[k][0] if k in now else ""
            for part, i in enumerate(range(0, len(body), CHUNK)):
                f.write(f"INSERT INTO {table} ({col}, part, body) VALUES ({lit(key)}, {part}, {lit(body[i:i + CHUNK])});\n")
    json.dump({k: h for k, (_, h) in now.items()}, open(path + ".json", "w"))
    print(f"alle: {len(changed)} rows changed, {len(gone)} gone, of {len(now)}")
    return len(changed) + len(gone)


def saved(path):
    """The load went through: what path.json describes is now in D1."""
    os.replace(path + ".json", LOADED)


def stats():
    races, riders, search = build()
    size = lambda t: sorted(len(json.dumps(v, ensure_ascii=False)) for v in t.values())
    for name, t in (("races", races), ("rider buckets", riders), ("search buckets", search)):
        s = size(t)
        print(f"{name}: {len(s)}, {sum(s) / 1e6:.1f} MB, median {s[len(s) // 2] / 1e3:.0f} KB, largest {s[-1] / 1e3:.0f} KB")
    print(f"riders: {sum(len(b) for b in riders.values())}")


if __name__ == "__main__":
    cmd = sys.argv[1:2]
    if cmd == ["sql"]:
        sql(sys.argv[2])
    elif cmd == ["saved"]:
        saved(sys.argv[2])
    elif cmd == ["stats"]:
        stats()
    else:
        print(__doc__)
