"""Land cells for the season clip's backdrop: OpenStreetMap land polygons (ODbL, via the npm package
@geo-maps/earth-lands-100m) clipped to Norway, simplified to about 150 m, lakes and islets under about 0.3 km² left out, and cut into 1° cells.

  npm pack @geo-maps/earth-lands-100m && tar xzf geo-maps-earth-lands-100m-*.tgz
  python3 tools/land_cells.py package/map.geo.json data/land

Each cell file is a list of polygons, each a list of rings, each a flat list of [lat, lon] pairs as integers
(degrees × q from the cell's south-west corner). index.json lists cells that are all land ("full") and
cells with a coast ("part"); cells not listed are sea. Needs shapely.
"""
import json, os, sys
import shapely
from shapely.geometry import shape, Polygon

d = json.load(open(sys.argv[1]))
geoms = d['geometries'] if 'geometries' in d else [f['geometry'] for f in d['features']]
parts = []
for g in geoms:
    s = shape(g)
    parts += list(s.geoms) if hasattr(s, 'geoms') else [s]
norway = [p for p in parts if p.bounds[2] >= 4 and p.bounds[0] <= 32 and p.bounds[3] >= 57 and p.bounds[1] <= 72]
print('parts', len(parts), 'near Norway', len(norway), flush=True)
nor = [shapely.clip_by_rect(p, 4, 57, 32, 72) for p in norway]
nor = [g for g in nor if not g.is_empty]
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
Q = 10000
TOL = 0.0015
index = {"q": Q, "full": [], "part": []}
total = 0


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [x for x in getattr(g, 'geoms', []) if isinstance(x, Polygon)]


for lat in range(57, 72):
    row = [g for g in (shapely.clip_by_rect(p, 4, lat, 32, lat + 1) for p in nor) if not g.is_empty]
    print('row', lat, len(row), flush=True)
    for lon in range(4, 32):
        pieces = []
        for g in row:
            b = g.bounds
            if b[2] < lon or b[0] > lon + 1:
                continue
            pieces += polys(shapely.clip_by_rect(g, lon, lat, lon + 1, lat + 1))
        if not pieces:
            continue
        key = f"{lat}_{lon}"
        if sum(x.area for x in pieces) > 0.9999:
            index["full"].append(key)
            continue
        rings_out = []
        for x in pieces:
            x = x.simplify(TOL, preserve_topology=True)
            for y in polys(x):
                if y.area < 4e-5:
                    continue
                rs = []
                for ring in [y.exterior]:  # no lakes: land is one flat shape
                    flat = []
                    for (a, b) in ring.coords:
                        flat += [round((b - lat) * Q), round((a - lon) * Q)]
                    if len(flat) >= 8:
                        rs.append(flat)
                if rs:
                    rings_out.append(rs)
        if not rings_out:
            continue
        s = json.dumps(rings_out, separators=(',', ':'))
        open(f"{out}/{key}.json", "w").write(s)
        total += len(s)
        index["part"].append(key)
json.dump(index, open(f"{out}/index.json", "w"), separators=(',', ':'))
print('cells', len(index['part']), 'full', len(index['full']), 'bytes', total, flush=True)
