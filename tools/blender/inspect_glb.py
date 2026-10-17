"""
inspect_glb.py - dependency-free GLB summary: nodes, materials, triangle count, size, bounds.

    python3 tools/blender/inspect_glb.py [public/models/roadster.glb]

Checks the contract in docs/CAR_MODEL.md (node names, material names, budget) and exits 1 on any miss.
Reported bounds are in glTF space (Y up, car faces -Z).
"""
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))

REQUIRED_NODES = [
    "wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR",
    "nozzle_down_FL", "nozzle_down_FR", "nozzle_down_RL", "nozzle_down_RR",
    "nozzle_rear_L", "nozzle_rear_R",
    "rcs_L_front", "rcs_L_rear", "rcs_R_front", "rcs_R_rear",
    "taillight", "headlight", "marker_L", "marker_R",
]
REQUIRED_MATERIALS = ["paint", "lower_black", "glass", "tire", "rim_dark", "rim_light",
                      "tail_red", "head_white", "marker_amber", "plate"]
MAX_TRIS, MAX_MATS, MAX_BYTES = 80_000, 12, 5 * 1024 * 1024


def load(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and length == len(data), "not a valid GLB"
    off = 12
    js = bin_chunk = None
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            bin_chunk = chunk
        off += 8 + clen
    return js, bin_chunk, len(data)


def main():
    path = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(PROJECT, "public", "models", "roadster.glb")
    g, binc, size = load(path)
    acc = g["accessors"]
    names = [n.get("name", "") for n in g["nodes"]]
    mats = [m.get("name", "") for m in g.get("materials", [])]
    tris = 0
    prims = 0
    mn = [1e9] * 3
    mx = [-1e9] * 3

    # world transform bounds via node traversal (translation only; the exporter bakes everything else)
    def walk(ni, off):
        nonlocal tris, prims
        n = g["nodes"][ni]
        t = n.get("translation", [0, 0, 0])
        o = [off[i] + t[i] for i in range(3)]
        if "mesh" in n:
            for p in g["meshes"][n["mesh"]]["primitives"]:
                prims += 1
                idx = acc[p["indices"]]["count"] if "indices" in p else acc[p["attributes"]["POSITION"]]["count"]
                tris += idx // 3
                a = acc[p["attributes"]["POSITION"]]
                for i in range(3):
                    mn[i] = min(mn[i], a["min"][i] + o[i])
                    mx[i] = max(mx[i], a["max"][i] + o[i])
        for c in n.get("children", []):
            walk(c, o)

    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        walk(r, [0, 0, 0])

    print(f"file: {path}")
    print(f"size: {size} bytes ({size / 1024:.0f} KiB)   tris: {tris}   primitives: {prims}   nodes: {len(names)}")
    print(f"materials ({len(mats)}): {', '.join(mats)}")
    print(f"extensionsUsed: {g.get('extensionsUsed', [])}   draco: {'KHR_draco_mesh_compression' in g.get('extensionsUsed', [])}")
    print("bounds (glTF space, Y up): x[%.3f, %.3f] y[%.3f, %.3f] z[%.3f, %.3f]  size=(%.3f, %.3f, %.3f)"
          % (mn[0], mx[0], mn[1], mx[1], mn[2], mx[2], mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]))
    for n in g["nodes"]:
        if n.get("name", "").startswith("wheel_"):
            print("  %-10s translation=%s rotation=%s scale=%s" % (n["name"], [round(v, 3) for v in n.get("translation", [0, 0, 0])],
                                                                 n.get("rotation", "-"), n.get("scale", "-")))
    bad = []
    for r in REQUIRED_NODES:
        if r not in names:
            bad.append(f"missing node {r}")
    for r in REQUIRED_MATERIALS:
        if r not in mats:
            bad.append(f"missing material {r}")
    if len(mats) > MAX_MATS:
        bad.append(f"{len(mats)} materials > {MAX_MATS}")
    if tris > MAX_TRIS:
        bad.append(f"{tris} tris > {MAX_TRIS}")
    if size > MAX_BYTES:
        bad.append(f"{size} bytes > {MAX_BYTES}")
    if "KHR_draco_mesh_compression" in g.get("extensionsUsed", []):
        bad.append("Draco is not allowed")
    dup = {n for n in names if n and names.count(n) > 1}
    if dup:
        bad.append(f"duplicate node names: {sorted(dup)}")
    print("CONTRACT:", "OK" if not bad else "FAIL")
    for b in bad:
        print("  -", b)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
