"""Land cells for the season clip's backdrop: OpenStreetMap land polygons (ODbL, via the npm package
@geo-maps/earth-lands-100m) clipped to Norway, simplified to about 100 m and cut into 1° cells.

  npm pack @geo-maps/earth-lands-100m && tar xzf geo-maps-earth-lands-100m-*.tgz
  python3 tools/land_cells.py package/map.geo.json data/land

Each cell file is a list of polygons, each a list of rings, each a flat list of [lat, lon] pairs as integers
(degrees × q from the cell's south-west corner). index.json lists cells that are all land ("full") and
cells with a coast ("part"); cells not listed are sea. Needs shapely.
"""
import json, os, sys
from shapely.geometry import shape, box, Polygon, MultiPolygon
from shapely.prepared import prep
d = json.load(open(sys.argv[1]))
geoms = d['features'] if 'features' in d else ([{'geometry': g} for g in d['geometries']] if 'geometries' in d else [{'geometry': d}])
print(len(geoms))
NOR = box(4, 57, 32, 72)
polys = []
for f in geoms:
    g = shape(f['geometry'])
    parts = g.geoms if hasattr(g, 'geoms') else [g]
    for p in parts:
        if p.intersects(NOR):
            p = p if p.is_valid else p.buffer(0)
            c = p.intersection(NOR)
            polys += [x for x in (c.geoms if hasattr(c, 'geoms') else [c]) if isinstance(x, Polygon) and not x.is_empty]
print('polys in Norway bbox', len(polys))
out = sys.argv[2]; os.makedirs(out, exist_ok=True)
Q = 10000; TOL = 0.0009
index = {"q": Q, "full": [], "part": []}
total = 0
for lat in range(57, 72):
    strip = box(4, lat, 32, lat + 1)
    srow = []
    for p in polys:
        if p.intersects(strip):
            c = p.intersection(strip)
            srow += [x for x in (c.geoms if hasattr(c, 'geoms') else [c]) if isinstance(x, Polygon) and not x.is_empty]
    print('row', lat, len(srow), flush=True)
    for lon in range(4, 32):
        cell = box(lon, lat, lon + 1, lat + 1)
        pc = prep(cell)
        hits = [p for p in srow if pc.intersects(p)]
        if not hits: continue
        pieces = []
        for p in hits:
            c = p.intersection(cell)
            if c.is_empty: continue
            pieces += list(c.geoms) if hasattr(c, 'geoms') else [c]
        pieces = [x for x in pieces if isinstance(x, Polygon)]
        area = sum(x.area for x in pieces)
        key = f"{lat}_{lon}"
        if area > 0.9999: index["full"].append(key); continue
        rings_out = []
        for x in pieces:
            x = x.simplify(TOL, preserve_topology=True)
            if x.is_empty or x.area < 1e-6: continue
            xs = list(x.geoms) if hasattr(x, 'geoms') else [x]
            for y in xs:
                if not isinstance(y, Polygon): continue
                rs = []
                for ring in [y.exterior, *y.interiors]:
                    flat = []
                    for (a, b) in ring.coords:
                        flat += [round((b - lat) * Q), round((a - lon) * Q)]
                    if len(flat) >= 8: rs.append(flat)
                if rs: rings_out.append(rs)
        if not rings_out: continue
        s = json.dumps(rings_out, separators=(',', ':'))
        open(f"{out}/{key}.json", "w").write(s); total += len(s)
        index["part"].append(key)
json.dump(index, open(f"{out}/index.json", "w"), separators=(',', ':'))
print('cells', len(index['part']), 'full', len(index['full']), 'bytes', total)
