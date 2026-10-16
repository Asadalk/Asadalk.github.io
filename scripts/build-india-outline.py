#!/usr/bin/env python3
"""Build the small India outline used by the Cellular "Follow the packet" demo.

Dev-time only; the output (src/content/data/cellular/india.json) is committed,
so the site never requests map tiles or data at runtime.

Source: Natural Earth 1:10m Admin 0 countries, India point of view
(ne_10m_admin_0_countries_ind, v5.1.1), public domain.
  https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries_ind.zip
The 1:50m and 1:110m files only exist in the default (de facto) point of view;
the India POV file is only published at 1:10m, so it is simplified here to
roughly 1:50m detail.

Usage (standard library only):
  python3 -I scripts/build-india-outline.py <dir-with-unzipped-shapefile> src/content/data/cellular/india.json
"""

import json
import math
import struct
import sys
from pathlib import Path

STEM = "ne_10m_admin_0_countries_ind"
TOLERANCE_DEG = 0.035      # Douglas-Peucker tolerance (about 4 km)
MIN_RING_AREA_DEG2 = 0.005 # drop islands smaller than this (they would be specks)
WIDTH = 400                # SVG user units
LAT0 = 22.0                # standard parallel for the equirectangular projection


def read_dbf(path: Path) -> list[dict]:
    data = path.read_bytes()
    n_records, header_len, record_len = struct.unpack("<IHH", data[4:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b"\0", 1)[0].decode("ascii")
        fields.append((name, data[pos + 16]))
        pos += 32
    rows = []
    for i in range(n_records):
        rec = data[header_len + i * record_len: header_len + (i + 1) * record_len]
        off, row = 1, {}
        for name, length in fields:
            row[name] = rec[off:off + length].decode("utf-8", "replace").strip()
            off += length
        rows.append(row)
    return rows


def read_polygons(path: Path) -> list[list[list[tuple[float, float]]]]:
    """Every record as a list of rings of (lon, lat)."""
    data = path.read_bytes()
    pos, shapes = 100, []
    while pos < len(data):
        _, length_words = struct.unpack(">ii", data[pos:pos + 8])
        content = data[pos + 8: pos + 8 + length_words * 2]
        pos += 8 + length_words * 2
        shape_type = struct.unpack("<i", content[:4])[0]
        if shape_type == 0:
            shapes.append([])
            continue
        assert shape_type == 5, shape_type  # Polygon
        n_parts, n_points = struct.unpack("<ii", content[36:44])
        parts = list(struct.unpack(f"<{n_parts}i", content[44:44 + 4 * n_parts]))
        pts_off = 44 + 4 * n_parts
        pts = [struct.unpack("<dd", content[pts_off + 16 * k: pts_off + 16 * (k + 1)]) for k in range(n_points)]
        parts.append(n_points)
        shapes.append([pts[parts[j]:parts[j + 1]] for j in range(n_parts)])
    return shapes


def area(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]))) / 2


def simplify(points, tol):
    """Douglas-Peucker, iterative."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm if (dx or dy) else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def main(src_dir: str, out: str) -> None:
    src = Path(src_dir)
    rows = read_dbf(src / f"{STEM}.dbf")
    shapes = read_polygons(src / f"{STEM}.shp")
    idx = next(i for i, r in enumerate(rows) if r.get("ADM0_A3") == "IND")
    rings = [r for r in shapes[idx] if area(r) >= MIN_RING_AREA_DEG2]

    lons = [p[0] for r in rings for p in r]
    lats = [p[1] for r in rings for p in r]
    lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)
    kx = math.cos(math.radians(LAT0))
    scale = WIDTH / ((lon_max - lon_min) * kx)
    height = (lat_max - lat_min) * scale

    def project(lon, lat):
        return ((lon - lon_min) * kx * scale, (lat_max - lat) * scale)

    d = []
    for ring in rings:
        # Simplify open (first point repeated at the end in shapefiles).
        simple = simplify(ring, TOLERANCE_DEG)
        if len(simple) < 4:
            continue
        xy = [project(*p) for p in simple[:-1]]
        d.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in xy) + "Z")

    result = {
        "source": "Natural Earth 1:10m Admin 0 countries, India point of view (ne_10m_admin_0_countries_ind v5.1.1), public domain; simplified",
        "projection": "equirectangular",
        "lat0": LAT0,
        "lonMin": round(lon_min, 4),
        "latMax": round(lat_max, 4),
        "scale": round(scale, 6),
        "width": WIDTH,
        "height": round(height, 1),
        "d": "".join(d),
    }
    Path(out).write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(d)} rings, {sum(s.count('L') + 1 for s in d)} points, {Path(out).stat().st_size} bytes")


if __name__ == "__main__":
    main(*sys.argv[1:3])
