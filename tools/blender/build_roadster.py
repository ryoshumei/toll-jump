"""
build_roadster.py - procedural hero car for the flying-roadster game.

Contract: docs/CAR_MODEL.md  (size, origin, axes, node names, materials, budget).
Design source: refs/roadster.png (rear 3/4) and the side view in refs/v2-key.jpg.

Run (deterministic, always starts from an empty scene):

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_roadster.py
    ... -P tools/blender/build_roadster.py -- --out /tmp/x.glb --blend /tmp/x.blend --no-export

Units are meters. Blender axes: car faces +Y, +X is the car's right, +Z is up.
The glTF exporter turns that into three.js axes (Y up, car faces -Z).

Everything lives in this file: parameter tables first (tune the look there),
then geometry builders, then verification + export.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(PROJECT, "public", "models", "roadster.glb")

# --------------------------------------------------------------------------
# Contract constants (docs/CAR_MODEL.md)
# --------------------------------------------------------------------------
WHEELBASE = 2.65
AXLE_F = WHEELBASE / 2.0          # +Y is forward
AXLE_R = -WHEELBASE / 2.0
TRACK = 1.70
HUB_X = TRACK / 2.0
WHEEL_R = 0.36
LENGTH, WIDTH, HEIGHT = 4.40, 2.00, 1.15
MAX_TRIS, MAX_MATS, MAX_BYTES = 80_000, 12, 5 * 1024 * 1024

NOSE_Y = 2.12                    # front-most point of the body
TAIL_Y = -2.22                   # body end (rear cap plane)
BLADE_Y = -2.28                  # rear-most point (blade lip, strakes)
PARAM_NOSE_Y, PARAM_TAIL_Y = 2.05, -2.29   # the shape tables below are written for this length
WARP_START = 1.70                # |y| beyond which the nose/tail region is stretched/compressed

SPOKES = 6                       # refs/roadster.png shows 6 (the first brief said 5)
TIRE_STEPS = 64

ARCH_R = 0.405                   # wheel arch cutter radius (tire R 0.36 + 4.5 cm)
ARCH_INNER_X = 0.62              # inner end of the arch tunnel

# --------------------------------------------------------------------------
# Materials (glTF PBR, by name)
# --------------------------------------------------------------------------
MATERIALS = {
    # name: dict(color hex sRGB, metallic, roughness, coat, emission(color hex, strength))
    "paint":        dict(color="#d9d6d0", metallic=0.60, roughness=0.32, coat=0.35, coat_rough=0.08),
    "lower_black":  dict(color="#0c0c0e", metallic=0.30, roughness=0.30),
    "glass":        dict(color="#2b1d14", metallic=0.55, roughness=0.08),
    "tire":         dict(color="#101011", metallic=0.0, roughness=0.88),
    "rim_dark":     dict(color="#0a0a0c", metallic=0.85, roughness=0.22),
    "rim_light":    dict(color="#b7b9bc", metallic=0.55, roughness=0.42),
    "tail_red":     dict(color="#3a0000", metallic=0.0, roughness=0.35, emit=("#ff1208", 6.0)),
    "head_white":   dict(color="#f4f6ff", metallic=0.0, roughness=0.30, emit=("#ffffff", 5.0)),
    "marker_amber": dict(color="#3a1800", metallic=0.0, roughness=0.35, emit=("#ff8a10", 4.0)),
    "plate":        dict(color="#f1f1ec", metallic=0.0, roughness=0.55),
}

# --------------------------------------------------------------------------
# Body parameter curves (y in meters, tail -> nose).  Monotone cubic (PCHIP)
# interpolation, so the loft is smooth and never overshoots a control value.
# --------------------------------------------------------------------------


def pchip(points):
    pts = sorted(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    if n == 2:
        m = [d[0], d[0]]
    else:
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                w1 = 2 * h[i] + h[i - 1]
                w2 = h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

        def endp(h0, h1, d0, d1):
            v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
            if v * d0 <= 0:
                return 0.0
            if d0 * d1 <= 0 and abs(v) > 3 * abs(d0):
                return 3 * d0
            return v

        m[0] = endp(h[0], h[1], d[0], d[1])
        m[-1] = endp(h[-1], h[-2], d[-1], d[-2])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        lo, hi = 0, n - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if xs[mid] <= x:
                lo = mid
            else:
                hi = mid
        t = (x - xs[lo]) / h[lo]
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1
        h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2
        h11 = t ** 3 - t ** 2
        return h00 * ys[lo] + h10 * h[lo] * m[lo] + h01 * ys[lo + 1] + h11 * h[lo] * m[lo + 1]

    return f


def lin(points):
    pts = sorted(points)

    def f(x):
        if x <= pts[0][0]:
            return pts[0][1]
        if x >= pts[-1][0]:
            return pts[-1][1]
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            if x0 <= x <= x1:
                return y0 + (y1 - y0) * (x - x0) / (x1 - x0)

    return f


# floor height (underside); rises into a diffuser at the tail
ZF = pchip([(-2.29, 0.14), (-2.0, 0.14), (-1.7, 0.14), (0.0, 0.14), (1.7, 0.14), (2.05, 0.17)])
# floor half width
XF = pchip([(-2.29, 0.52), (-2.2, 0.58), (-2.0, 0.69), (-1.5, 0.80), (0.0, 0.82), (1.5, 0.80), (1.9, 0.66), (2.05, 0.58)])
# max half width (at the sweep line)
XS = pchip([(-2.29, 0.86), (-2.10, 0.90), (-1.85, 0.965), (-1.5, 1.0), (-0.5, 1.0), (0.5, 0.995),
            (1.2, 0.98), (1.6, 0.95), (1.9, 0.88), (2.05, 0.80)])
# height of the rocker chamfer (bigger at the tail corners)
RK_H = pchip([(-2.29, 0.21), (-2.0, 0.12), (-1.7, 0.075), (2.05, 0.075)])
# black/paint split line (the "sweep"): thin at the front wheel, tall at the rear
ZS = pchip([(-2.29, 0.72), (-2.10, 0.68), (-1.95, 0.62), (-1.80, 0.50), (-1.5, 0.45), (-0.8, 0.42),
            (0.0, 0.35), (1.0, 0.29), (1.5, 0.27), (1.9, 0.27), (2.05, 0.28)])
# top centerline of the body (hood / cowl / deck under the canopy / tail deck)
ZT = pchip([(-2.29, 0.905), (-2.0, 0.915), (-1.7, 0.925), (-1.55, 0.935), (-1.3, 0.976), (-1.0, 0.946),
            (-0.6, 0.891), (-0.2, 0.861), (0.5, 0.856), (1.0, 0.861), (1.28, 0.866), (1.40, 0.85),
            (1.50, 0.825), (1.64, 0.775), (1.80, 0.70), (1.95, 0.625), (2.05, 0.56)])
# crown: how much the outer edge sits below the centerline
CROWN = pchip([(-2.29, 0.006), (-1.5, 0.006), (0.0, 0.005), (1.2, 0.006), (1.4, 0.02), (1.8, 0.03), (2.05, 0.03)])

CREASE_Y = -0.125     # panel break on the flank (front panel / rear panel)
LEAN = lin([(-2.30, 0.20), (-0.15, 0.20), (-0.10, 0.10), (2.10, 0.10)])   # tumblehome of the paint wall (dx/dz)
LEDGE = 0.012         # little step at the sweep line (catches a highlight)
DECK_INSET = 0.045    # flat paint ledge around the canopy

# canopy (separate glass mesh) -----------------------------------------------
CANOPY_Y0, CANOPY_Y1 = -1.55, 1.28
ZC = pchip([(-1.55, 0.938), (-1.40, 0.99), (-1.25, 1.03), (-1.0, 1.075), (-0.5, 1.13), (0.0, 1.15),
            (0.4, 1.09), (0.9, 0.96), (1.28, 0.877)])
XT = pchip([(-1.55, 0.46), (-1.30, 0.50), (-1.0, 0.54), (-0.5, 0.58), (0.0, 0.61), (0.4, 0.64),
            (0.9, 0.72), (1.28, 0.84)])

# loft stations (y); the canopy uses the subset inside CANOPY_Y0..CANOPY_Y1
STATIONS = [-2.29, -2.20, -2.08, -1.95, -1.83, -1.70, -1.55, -1.40, -1.25, -1.10, -0.95, -0.75,
            -0.55, -0.35, -0.15, -0.10, 0.05, 0.25, 0.45, 0.65, 0.85, 1.00, 1.15, 1.28, 1.40, 1.52,
            1.64, 1.76, 1.86, 1.95, 2.02, 2.05]

# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h, alpha=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


def ywarp(y):
    """Map table y (written for a 4.34 m body) onto the real nose/tail positions."""
    if y > WARP_START:
        return WARP_START + (y - WARP_START) * (NOSE_Y - WARP_START) / (PARAM_NOSE_Y - WARP_START)
    if y < -WARP_START:
        return -WARP_START + (y + WARP_START) * (TAIL_Y + WARP_START) / (PARAM_TAIL_Y + WARP_START)
    return y


def log(*a):
    print("[roadster]", *a, flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"out": DEFAULT_OUT, "blend": None, "export": True}
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            opts["out"] = os.path.abspath(argv[i + 1])
            i += 1
        elif argv[i] == "--blend":
            opts["blend"] = os.path.abspath(argv[i + 1])
            i += 1
        elif argv[i] == "--no-export":
            opts["export"] = False
        i += 1
    return opts


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.images):
        for item in list(coll):
            coll.remove(item)
    return scene


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def new_mesh_object(name, bm, materials, parent=None, smooth=False):
    """bmesh -> object; `materials` is the ordered list of material names (slots)."""
    me = bpy.data.meshes.new(name + "_mesh")
    bm.to_mesh(me)
    bm.free()
    for mname in materials:
        me.materials.append(bpy.data.materials[mname])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    return link(ob, parent)


def bake_modifiers(ob):
    """Apply every modifier by evaluating the depsgraph (works headless, no ops/context)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    me.name = ob.name + "_mesh"
    return me


def fix_slots(ob, names):
    """Booleans can append empty material slots; restore exactly the intended list."""
    me = ob.data
    idx = [p.material_index for p in me.polygons]      # clearing slots would reset these
    me.materials.clear()
    for n in names:
        me.materials.append(bpy.data.materials[n])
    for p, i in zip(me.polygons, idx):
        p.material_index = min(i, len(names) - 1)


def recalc_outward(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()


def orient_outward(bm, ref):
    """Flip faces whose normal points toward `ref` (star-shaped shells only)."""
    bm.normal_update()
    for f in bm.faces:
        if f.normal.dot(f.calc_center_median() - ref) < 0:
            f.normal_flip()
    bm.normal_update()


def recenter(ob):
    """Move the object origin to its geometric center (mesh stays where it is in the car)."""
    me = ob.data
    if not me.vertices:
        return
    pts = [ob.matrix_world @ v.co for v in me.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2.0
    me.transform(Matrix.Translation(-c))
    ob.location = c


def add_box(bm, center, size, rot=None, bevel=0.0, mat=0, seg=2):
    """Axis-aligned (optionally rotated) box; returns created faces."""
    m = Matrix.Translation(center)
    if rot is not None:
        m = m @ rot.to_4x4() if hasattr(rot, "to_4x4") else m @ rot
    m = m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    verts = res["verts"]
    faces = {f for v in verts for f in v.link_faces}
    if bevel > 0:
        edges = {e for v in verts for e in v.link_edges}
        out = bmesh.ops.bevel(bm, geom=list(edges), offset=bevel, offset_type="OFFSET",
                              segments=seg, profile=0.5, affect="EDGES")
        faces = set(out["faces"]) | faces
    for f in faces:
        if f.is_valid:
            f.material_index = mat
    return faces


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------


def set_socket(bsdf, names, value):
    for n in names:
        sock = bsdf.inputs.get(n)
        if sock is not None:
            sock.default_value = value
            return True
    return False


def make_materials():
    for name, spec in MATERIALS.items():
        mat = bpy.data.materials.new(name)
        if mat.node_tree is None:       # Blender < 5 needs use_nodes
            mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        set_socket(bsdf, ["Base Color"], hex_to_linear(spec["color"]))
        set_socket(bsdf, ["Metallic"], spec.get("metallic", 0.0))
        set_socket(bsdf, ["Roughness"], spec.get("roughness", 0.5))
        if spec.get("coat"):
            set_socket(bsdf, ["Coat Weight", "Clearcoat"], spec["coat"])
            set_socket(bsdf, ["Coat Roughness", "Clearcoat Roughness"], spec.get("coat_rough", 0.1))
        if spec.get("emit"):
            col, strength = spec["emit"]
            set_socket(bsdf, ["Emission Color", "Emission"], hex_to_linear(col))
            set_socket(bsdf, ["Emission Strength"], strength)
        mat.diffuse_color = hex_to_linear(spec["color"])
        mat.metallic = spec.get("metallic", 0.0)
        mat.roughness = spec.get("roughness", 0.5)


# --------------------------------------------------------------------------
# Body
# --------------------------------------------------------------------------


def body_section(y):
    """Half cross-section (x >= 0) from underside center, around, to top center."""
    zf, xf = ZF(y), XF(y)
    xs, zs = XS(y), ZS(y)
    zt = ZT(y)
    crown = CROWN(y)
    zb = zt - crown
    xb = xs - LEAN(y) * (zb - zs)
    xd = xb - DECK_INSET
    zd = zt - crown * 0.3
    zr = min(zf + RK_H(y), zs - 0.03)
    xr = xs - 0.02
    return [(0.0, zf), (xf, zf), (xr, zr), (xs, zs), (xs - LEDGE, zs), (xb, zb), (xd, zd), (0.0, zt)]


def body_section_lin(y):
    """Section as the loft really is: linear between stations (use it to place things ON the surface)."""
    ys = STATIONS
    if y <= ys[0]:
        return body_section(ys[0])
    if y >= ys[-1]:
        return body_section(ys[-1])
    for i in range(len(ys) - 1):
        if ys[i] <= y <= ys[i + 1]:
            t = (y - ys[i]) / (ys[i + 1] - ys[i])
            a, b = body_section(ys[i]), body_section(ys[i + 1])
            return [((1 - t) * pa[0] + t * pb[0], (1 - t) * pa[1] + t * pb[1]) for pa, pb in zip(a, b)]


# material slot order for the body: 0 paint, 1 lower_black
BODY_MATS = ["paint", "lower_black"]
SEG_MAT = [1, 1, 1, 1, 0, 0, 0]   # per half-section segment


def build_body_halfmesh():
    bm = bmesh.new()
    rows = []
    for y in STATIONS:
        rows.append([bm.verts.new((x, ywarp(y), z)) for x, z in body_section(y)])
    n = len(rows[0])
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        yc = 0.5 * (STATIONS[i] + STATIONS[i + 1])
        for k in range(n - 1):
            f = bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
            mat = SEG_MAT[k]
            if k == 6 and yc < -1.62:       # rear deck behind the canopy reads dark in the ref
                mat = 1
            f.material_index = mat
    for i, y in enumerate(STATIONS):
        if y in (-0.15, -0.10):                       # the two rings that bound the crease strip
            for k in (4, 5):
                e = bm.edges.get((rows[i][k], rows[i][k + 1])) if k < n - 1 else None
                if e is not None:
                    e.smooth = False
    tail = bm.faces.new(rows[0])
    tail.material_index = 1
    nose = bm.faces.new(rows[-1][::-1])
    nose.material_index = 0
    orient_outward(bm, Vector((0.0, -0.1, 0.5)))
    # split the nose cap so its lower lip (splitter) can be black
    res = bmesh.ops.bisect_plane(bm, geom=[nose] + list(nose.edges) + list(nose.verts), dist=1e-5,
                                 plane_co=(0.0, NOSE_Y, 0.31), plane_no=(0.0, 0.0, 1.0))
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.y - NOSE_Y) < 1e-4 and abs(f.normal.y) > 0.99:
            f.material_index = 1 if c.z < 0.31 else 0
    return bm


def arch_cutter(side, axle_y, name):
    bm = bmesh.new()
    length = 0.70
    cx = side * (ARCH_INNER_X + length / 2.0)
    m = Matrix.Translation((cx, axle_y, WHEEL_R)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=96, radius1=ARCH_R,
                          radius2=ARCH_R, depth=length, matrix=m)
    me = bpy.data.meshes.new(name + "_mesh")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.display_type = "WIRE"
    return link(ob)


def build_body(root):
    bm = build_body_halfmesh()
    ob = new_mesh_object("body", bm, BODY_MATS, root, smooth=True)

    mir = ob.modifiers.new("Mirror", "MIRROR")
    mir.use_axis = (True, False, False)
    mir.use_clip = True
    mir.use_mirror_merge = True
    mir.merge_threshold = 1e-5

    cutters = []
    for sx, tag in ((-1, "L"), (1, "R")):
        for ay, ft in ((AXLE_F, "F"), (AXLE_R, "R")):
            c = arch_cutter(sx, ay, f"cutter_{ft}{tag}")
            cutters.append(c)
            bo = ob.modifiers.new(f"Arch_{ft}{tag}", "BOOLEAN")
            bo.operation = "DIFFERENCE"
            bo.operand_type = "OBJECT"
            bo.object = c
            bo.solver = "EXACT"
    bake_modifiers(ob)
    fix_slots(ob, BODY_MATS)
    for c in cutters:
        me = c.data
        bpy.data.objects.remove(c)
        bpy.data.meshes.remove(me)

    # material pass for the wheel arch tunnels (black liner)
    me = ob.data
    centers = [(AXLE_F, WHEEL_R), (AXLE_R, WHEEL_R)]
    for p in me.polygons:
        vs = [me.vertices[i].co for i in p.vertices]
        in_wall = all(abs(abs(v.x) - ARCH_INNER_X) < 2e-4 for v in vs)
        on_cyl = False
        for cy, cz in centers:
            if all(abs(math.hypot(v.y - cy, v.z - cz) - ARCH_R) < 2.5e-3 and abs(v.x) > ARCH_INNER_X - 1e-3
                   for v in vs):
                on_cyl = True
        if in_wall or on_cyl:
            p.material_index = 1

    # bevel + weighted normals (crisp facets that still catch highlights)
    bev = ob.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.005
    bev.segments = 2
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(32)
    bev.harden_normals = True
    bev.use_clamp_overlap = True
    bev.loop_slide = True
    wn = ob.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    wn.mode = "FACE_AREA"
    wn.weight = 60
    wn.keep_sharp = True
    for p in ob.data.polygons:
        p.use_smooth = True
    bake_modifiers(ob)
    fix_slots(ob, BODY_MATS)
    return ob


# the glass base line is a smooth curve (no jog at the flank crease): same lean change, spread over 1 m
LEAN_GLASS = lin([(-2.30, 0.20), (-0.60, 0.20), (0.40, 0.10), (2.10, 0.10)])


def build_canopy(root):
    """Separate glass mesh: windshield + side glass + roof. Dense loft so reflections stay smooth.

    The glass starts a few mm ABOVE the deck on a short vertical skirt that sinks into the paint, so the
    visible boundary is a clean straight line (a sloped sheet cutting through the deck would zig-zag).
    """
    bm = bmesh.new()
    n_st = 84
    ys = [CANOPY_Y0 + (CANOPY_Y1 - CANOPY_Y0) * i / n_st for i in range(n_st + 1)]
    crown_steps = 4
    rows = []
    for y in ys:
        sec = body_section_lin(y)
        zd = sec[6][1]
        zb = sec[5][1]
        xg = XS(y) - LEAN_GLASS(y) * (zb - ZS(y)) - 0.048
        xt = XT(y)
        ze = max(zd + 0.016, ZC(y) - 0.025)           # roof edge always clear of the deck
        zc = max(ZC(y), ze + 0.010)
        pts = [(xg, zd - 0.020), (xg, zd + 0.004), (xt, ze)]
        for k in range(1, crown_steps + 1):             # parabolic crown across the roof
            f = k / crown_steps
            pts.append((xt * (1.0 - f), zc - (zc - ze) * (1.0 - f) ** 2))
        rows.append([bm.verts.new((x, y, z)) for x, z in pts])
    n = len(rows[0])
    for i in range(len(rows) - 1):
        for k in range(n - 1):
            bm.faces.new((rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]))
    # outward = upward / sideways for the open shell (skirt faces point sideways)
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, 0.0, 1.0))) < 0:
            f.normal_flip()
    # the roof edge ring is a real crease (side glass 45 deg, roof flat): keep it crisp
    for i in range(len(rows) - 1):
        e = bm.edges.get((rows[i][2], rows[i + 1][2]))
        if e is not None:
            e.smooth = False
    # crisp end faces (windshield base, rear edge)
    for row, ny in ((rows[0], -1.0), (rows[-1], 1.0)):
        zb0 = row[0].co.z
        lowc = bm.verts.new((0.0, row[0].co.y, zb0))
        cap = bm.faces.new(list(row) + [lowc])
        cap.normal_update()
        if cap.normal.y * ny < 0:        # rear cap must face -Y, front cap +Y
            cap.normal_flip()
    ob = new_mesh_object("canopy", bm, ["glass"], root, smooth=True)
    mir = ob.modifiers.new("Mirror", "MIRROR")
    mir.use_axis = (True, False, False)
    mir.use_clip = True
    mir.use_mirror_merge = True
    mir.merge_threshold = 1e-5
    bake_modifiers(ob)
    return ob


# --------------------------------------------------------------------------
# Rear end details, lights, plate
# --------------------------------------------------------------------------


def add_prism_xz(bm, pts, y0, y1, bevel=0.0, mat=0):
    """Extrude a convex XZ outline along Y from y0 to y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    faces = [bm.faces.new(a[::-1]), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    if bevel > 0:
        edges = {e for f in faces for e in f.edges}
        out = bmesh.ops.bevel(bm, geom=list(edges), offset=bevel, offset_type="OFFSET", segments=2,
                              profile=0.5, affect="EDGES")
        faces = list(set(out["faces"]) | set(faces))
    for f in faces:
        if f.is_valid:
            f.material_index = mat


def build_rear_details(root):
    # paint frame around the black tail band: blade lip (top), lower lip, end plates
    bm = bmesh.new()
    y_mid = (BLADE_Y + TAIL_Y) / 2.0 + 0.02
    add_box(bm, (0, y_mid, 0.897), (1.76, 0.10, 0.022), bevel=0.0035)               # blade lip
    add_box(bm, (0, (BLADE_Y + TAIL_Y) / 2.0, 0.781), (1.73, 0.055, 0.018), bevel=0.003)   # lower lip
    for sx in (-1, 1):
        add_box(bm, (sx * 0.866, (BLADE_Y + TAIL_Y) / 2.0, 0.840), (0.014, 0.055, 0.136), bevel=0.003)
    blade = new_mesh_object("rear_blade", bm, ["paint"], root)

    # diffuser: trapezoid tray, three strakes, splitter lip (all black)
    bm = bmesh.new()
    add_prism_xz(bm, [(-0.43, 0.125), (0.43, 0.125), (0.57, 0.46), (-0.57, 0.46)], TAIL_Y + 0.01,
                 TAIL_Y - 0.045, bevel=0.004, mat=0)
    for x in (-0.27, 0.0, 0.27):
        add_box(bm, (x, (TAIL_Y + BLADE_Y) / 2.0 + 0.004, 0.30), (0.014, 0.062, 0.31), bevel=0.002)
    add_box(bm, (0, (TAIL_Y + BLADE_Y) / 2.0 + 0.012, 0.108), (1.04, 0.07, 0.020), bevel=0.004)
    diff = new_mesh_object("diffuser", bm, ["lower_black"], root)

    # tail light bar (emissive)
    bm = bmesh.new()
    add_box(bm, (0, TAIL_Y - 0.012, 0.833), (1.64, 0.016, 0.022), bevel=0.0045, seg=2)
    tail = new_mesh_object("taillight", bm, ["tail_red"], root)
    recenter(tail)
    return blade, diff, tail


def outer_wall(y, z):
    """(x, lean angle) of the outer flank at (y, z), right side. Walks the half-section from the rocker up."""
    sec = body_section_lin(y)
    for i in range(2, 5):                      # rocker -> sweep -> ledge -> paint wall
        (x0, z0), (x1, z1) = sec[i], sec[i + 1]
        if z0 <= z <= z1 and z1 - z0 > 1e-6:
            t = (z - z0) / (z1 - z0)
            return x0 + (x1 - x0) * t, math.atan2(x0 - x1, z1 - z0)
    (x0, z0), (x1, z1) = sec[4], sec[5]        # above/below the wall: extend the paint wall
    t = (z - z0) / (z1 - z0)
    return x0 + (x1 - x0) * t, math.atan2(x0 - x1, z1 - z0)


def wall_xyz(sx, y, z):
    """Point on the outer paint wall (right side mirrored by sx) at height z."""
    sec = body_section_lin(y)
    (xs, zs), (xb, zb) = sec[4], sec[5]
    t = (z - zs) / (zb - zs)
    return Vector((sx * (xs + (xb - xs) * t), y, z))


def build_shut_lines(root):
    """Thin dark panel lines on the flanks (door cut) - they give the planar look of the reference."""
    bm = bmesh.new()
    lines = [((0.97, 0.835), (0.86, 0.33)),       # front fender / door line:  (y, z) top -> bottom
             ((CREASE_Y, 0.835), (CREASE_Y, 0.40))]  # door / rear quarter line (on the crease)
    for sx in (-1, 1):
        for (yt, zt_), (yb, zb_) in lines:
            w = 0.0022
            quad = []
            for (y, z) in ((yt - w, zt_), (yt + w, zt_), (yb + w, zb_), (yb - w, zb_)):
                p = wall_xyz(sx, y, z)
                p.x += sx * 0.0012
                quad.append(bm.verts.new(p))
            f = bm.faces.new(quad if sx > 0 else quad[::-1])
            f.normal_update()
            if f.normal.x * sx < 0:
                f.normal_flip()
            f.material_index = 0
    return new_mesh_object("shut_lines", bm, ["lower_black"], root)


def build_plate(root):
    bm = bmesh.new()
    pocket = bmesh.new()
    add_prism_xz(pocket, [(-0.25, 0.505), (0.25, 0.505), (0.31, 0.745), (-0.31, 0.745)], TAIL_Y + 0.004,
                 TAIL_Y - 0.010, bevel=0.003, mat=0)
    new_mesh_object("plate_pocket", pocket, ["lower_black"], root)
    add_box(bm, (0, TAIL_Y - 0.0135, 0.625), (0.40, 0.007, 0.20), bevel=0.0025, mat=0)
    plate = new_mesh_object("plate", bm, ["plate", "lower_black"], root)

    # text: Text object -> mesh
    cu = bpy.data.curves.new("plate_text", "FONT")
    cu.body = "RDSTR"
    cu.size = 0.092
    cu.extrude = 0.0012
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_character = 1.05
    tob = bpy.data.objects.new("plate_text_tmp", cu)
    link(tob)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    tme = bpy.data.meshes.new_from_object(tob.evaluated_get(dg), depsgraph=dg)
    bpy.data.objects.remove(tob)
    bpy.data.curves.remove(cu)

    tm = Matrix.Translation((0.0, TAIL_Y - 0.0175, 0.625)) @ Matrix.Rotation(math.pi / 2, 4, "X") \
        @ Matrix.Diagonal((0.86, 1.0, 1.0, 1.0))
    tbm = bmesh.new()
    tbm.from_mesh(tme)
    bpy.data.meshes.remove(tme)
    bmesh.ops.transform(tbm, matrix=tm, verts=tbm.verts)
    bmesh.ops.recalc_face_normals(tbm, faces=tbm.faces)
    for f in tbm.faces:
        f.material_index = 1
    pbm = bmesh.new()
    pbm.from_mesh(plate.data)
    nfaces = len(pbm.faces)
    off = len(pbm.faces)
    # append the text geometry
    tmp = bpy.data.meshes.new("tmp_text")
    tbm.to_mesh(tmp)
    tbm.free()
    pbm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
    pbm.faces.ensure_lookup_table()
    for f in pbm.faces:
        f.material_index = 0 if f.index < nfaces else 1
    pbm.to_mesh(plate.data)
    pbm.free()
    for p in plate.data.polygons:
        p.use_smooth = False
    return plate


# --------------------------------------------------------------------------
# Wheels
# --------------------------------------------------------------------------


def revolve_mesh(name, profile, steps, closed=True):
    """Profile of (x, r) pairs revolved around the X axis with the Screw modifier."""
    n = len(profile)
    me = bpy.data.meshes.new(name + "_profile")
    me.from_pydata([(x, r, 0.0) for x, r in profile],
                   [(i, (i + 1) % n) for i in range(n if closed else n - 1)], [])
    ob = bpy.data.objects.new(name, me)
    link(ob)
    mod = ob.modifiers.new("Screw", "SCREW")
    mod.axis = "X"
    mod.angle = math.tau
    mod.steps = steps
    mod.render_steps = steps
    mod.screw_offset = 0.0
    mod.iterations = 1
    mod.use_merge_vertices = True
    mod.merge_threshold = 1e-5
    mod.use_normal_calculate = True
    me2 = bake_modifiers(ob)
    recalc_outward(me2)
    bpy.data.objects.remove(ob)
    return me2


def spoke_prisms(bm, side):
    """SPOKES straight tapered blades, extruded along the wheel axis."""
    poly = [(0.030, -0.034), (0.268, -0.021), (0.286, -0.010), (0.286, 0.010), (0.268, 0.021), (0.030, 0.034)]
    x0, x1 = 0.086, 0.117
    for k in range(SPOKES):
        phi = math.radians(90.0) + k * math.tau / SPOKES
        c, s = math.cos(phi), math.sin(phi)

        def P(u, v, x):
            return (side * x, u * c - v * s, u * s + v * c)

        lower = [bm.verts.new(P(u, v, x0)) for u, v in poly]
        upper = [bm.verts.new(P(u, v, x1)) for u, v in poly]
        n = len(poly)
        bm.faces.new(lower)
        bm.faces.new(upper[::-1])
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))


def build_wheel_meshes(side):
    """Return (tire_mesh, rim_mesh) for one side (side = +1 right / -1 left, outward = side * X)."""
    s = side
    tire_prof = [(-0.098, 0.360), (0.098, 0.360), (0.124, 0.352), (0.134, 0.335), (0.133, 0.312),
                 (0.122, 0.296), (0.100, 0.289), (-0.100, 0.289), (-0.122, 0.296), (-0.133, 0.312),
                 (-0.134, 0.335), (-0.124, 0.352)]
    tire = revolve_mesh("tire_rev", [(s * x, r) for x, r in tire_prof], TIRE_STEPS)
    for p in tire.polygons:
        p.use_smooth = True
    tire.materials.append(bpy.data.materials["tire"])

    disc_prof = [(0.020, 0.0), (0.020, 0.286), (0.100, 0.286), (0.100, 0.270), (0.086, 0.070), (0.086, 0.0)]
    lip_prof = [(0.094, 0.266), (0.094, 0.298), (0.128, 0.298), (0.128, 0.278), (0.112, 0.266)]
    hub_prof = [(0.080, 0.0), (0.080, 0.040), (0.100, 0.046), (0.120, 0.040), (0.124, 0.0)]
    disc = revolve_mesh("disc_rev", [(s * x, r) for x, r in disc_prof], TIRE_STEPS)
    lip = revolve_mesh("lip_rev", [(s * x, r) for x, r in lip_prof], TIRE_STEPS)
    hub = revolve_mesh("hub_rev", [(s * x, r) for x, r in hub_prof], 32)

    bm = bmesh.new()
    bm.from_mesh(disc)
    n_disc = len(bm.faces)
    bm.from_mesh(lip)
    bm.from_mesh(hub)
    n_ring = len(bm.faces)
    sp = bmesh.new()
    spoke_prisms(sp, s)
    bmesh.ops.recalc_face_normals(sp, faces=sp.faces)
    bmesh.ops.bevel(sp, geom=list(sp.edges), offset=0.0022, offset_type="OFFSET", segments=1,
                    profile=0.5, affect="EDGES")
    smesh = bpy.data.meshes.new("spokes_tmp")
    sp.to_mesh(smesh)
    sp.free()
    bm.from_mesh(smesh)
    bpy.data.meshes.remove(smesh)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.material_index = 0 if f.index < n_disc else 1
    rim = bpy.data.meshes.new("rim_mesh")
    bm.to_mesh(rim)
    bm.free()
    rim.materials.append(bpy.data.materials["rim_light"])
    rim.materials.append(bpy.data.materials["rim_dark"])
    for p in rim.polygons:
        p.use_smooth = p.material_index == 0
    for m in (disc, lip, hub):
        bpy.data.meshes.remove(m)
    return tire, rim


def build_wheels(root):
    wheels = {}
    mesh_cache = {}
    for tag, sx, ay in (("FL", -1, AXLE_F), ("FR", 1, AXLE_F), ("RL", -1, AXLE_R), ("RR", 1, AXLE_R)):
        if sx not in mesh_cache:
            mesh_cache[sx] = build_wheel_meshes(sx)
        tire_m, rim_m = mesh_cache[sx]
        w = bpy.data.objects.new(f"wheel_{tag}", None)
        w.empty_display_type = "ARROWS"
        w.empty_display_size = 0.2
        w.location = (sx * HUB_X, ay, WHEEL_R)
        link(w, root)
        t = link(bpy.data.objects.new(f"tire_{tag}", tire_m), w)
        r = link(bpy.data.objects.new(f"rim_{tag}", rim_m), w)
        wheels[tag] = (w, t, r)
    return wheels


# --------------------------------------------------------------------------
# Thruster mounts, lights, markers
# --------------------------------------------------------------------------


def build_empties(root):
    def empty(name, loc):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.08
        e.location = loc
        return link(e, root)

    # down-firing nozzles under the floor, just inboard of each wheel
    bm = bmesh.new()
    for tag, sx, ay in (("FL", -1, AXLE_F), ("FR", 1, AXLE_F), ("RL", -1, AXLE_R), ("RR", 1, AXLE_R)):
        x = sx * 0.55
        empty(f"nozzle_down_{tag}", (x, ay, 0.100))
        m = Matrix.Translation((x, ay, 0.122))
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=0.055,
                              radius2=0.078, depth=0.044, matrix=m)
    for f in bm.faces:
        f.material_index = 0
    new_mesh_object("nozzles_down", bm, ["lower_black"], root, smooth=True)

    # rear-firing nozzles in the diffuser
    for tag, sx in (("L", -1), ("R", 1)):
        empty(f"nozzle_rear_{tag}", (sx * 0.36, BLADE_Y, 0.305))

    # sideways RCS ports on the flanks (empties only), on the outer wall
    for side_tag, sx in (("L", -1), ("R", 1)):
        for pos_tag, y, z in (("front", 1.80, 0.50), ("rear", -1.86, 0.52)):
            xw, _ = outer_wall(y, z)
            empty(f"rcs_{side_tag}_{pos_tag}", (sx * xw, ywarp(y), z))


def build_lights(root):
    # small red side lights on the rear quarters (visible in refs/roadster.png)
    for tag, sx in (("L", -1), ("R", 1)):
        y, z = -1.80, 0.60
        xw, lean = outer_wall(y, z)
        bm = bmesh.new()
        add_box(bm, (sx * (xw + 0.002), ywarp(y), z), (0.008, 0.045, 0.020),
                rot=Matrix.Rotation(sx * -lean, 4, "Y"), bevel=0.0025, mat=0)
        recenter(new_mesh_object(f"sidelight_{tag}", bm, ["tail_red"], root))

    # headlight: thin full-width white bar on the nose face
    bm = bmesh.new()
    add_box(bm, (0, NOSE_Y + 0.003, 0.455), (1.46, 0.012, 0.020), bevel=0.004, seg=2)
    recenter(new_mesh_object("headlight", bm, ["head_white"], root))

    # amber side markers on the front fenders
    for tag, sx in (("L", -1), ("R", 1)):
        y, z = 1.02, 0.745
        xw, lean = outer_wall(y, z)
        bm = bmesh.new()
        rot = Matrix.Rotation(sx * -lean, 4, "Y")
        add_box(bm, (sx * (xw + 0.002), y, z), (0.010, 0.15, 0.028), rot=rot, bevel=0.003)
        recenter(new_mesh_object(f"marker_{tag}", bm, ["marker_amber"], root))


# --------------------------------------------------------------------------
# Verification + export
# --------------------------------------------------------------------------

REQUIRED_NODES = (
    ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR",
     "nozzle_down_FL", "nozzle_down_FR", "nozzle_down_RL", "nozzle_down_RR",
     "nozzle_rear_L", "nozzle_rear_R",
     "rcs_L_front", "rcs_L_rear", "rcs_R_front", "rcs_R_rear",
     "taillight", "headlight", "marker_L", "marker_R"])


def scene_stats():
    tris = 0
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        for corner in ob.bound_box:
            w = ob.matrix_world @ Vector(corner)
            mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
            mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
    return tris, mn, mx


def verify():
    problems = []
    names = {o.name for o in bpy.context.scene.objects}
    for n in REQUIRED_NODES:
        if n not in names:
            problems.append(f"missing node {n}")
    used = set()
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH":
            for slot in ob.material_slots:
                if slot.material is None:
                    problems.append(f"object {ob.name} has an empty material slot")
                else:
                    used.add(slot.material.name)
    if len(used) > MAX_MATS:
        problems.append(f"{len(used)} materials > {MAX_MATS}")
    for m in MATERIALS:
        if m not in used:
            problems.append(f"material {m} unused")
    tris, mn, mx = scene_stats()
    size = mx - mn
    log(f"tris={tris} bbox x[{mn.x:.3f},{mx.x:.3f}] y[{mn.y:.3f},{mx.y:.3f}] z[{mn.z:.3f},{mx.z:.3f}] "
        f"size=({size.x:.3f}, {size.y:.3f}, {size.z:.3f}) materials={sorted(used)}")
    if tris > MAX_TRIS:
        problems.append(f"{tris} tris > {MAX_TRIS}")
    for label, got, want, tol in (("length", size.y, LENGTH, 0.06), ("width", size.x, WIDTH, 0.06),
                                  ("height", size.z, HEIGHT, 0.05)):
        if abs(got - want) > tol:
            problems.append(f"{label} {got:.3f} vs {want}")
    if abs(mn.z) > 0.002:
        problems.append(f"lowest point {mn.z:.4f} should be 0 (tire contact plane)")
    return problems


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(
        filepath=path, export_format="GLB", use_selection=False, use_visible=False, use_renderable=False,
        export_apply=True, export_yup=True, export_normals=True, export_texcoords=False,
        export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=False,
        export_animations=False, export_skins=False, export_morph=False,
        export_draco_mesh_compression_enable=False, export_vertex_color="NONE",
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = {k: v for k, v in kw.items() if k in props}
    res = bpy.ops.export_scene.gltf(**kw)
    log("export", res, path, os.path.getsize(path), "bytes")


def main():
    opts = parse_args()
    log("Blender", bpy.app.version_string)
    reset_scene()
    make_materials()
    root = bpy.data.objects.new("roadster", None)
    root.empty_display_type = "PLAIN_AXES"
    link(root)

    build_body(root)
    build_canopy(root)
    build_rear_details(root)
    build_shut_lines(root)
    build_plate(root)
    build_wheels(root)
    build_empties(root)
    build_lights(root)

    bpy.context.view_layer.update()
    problems = verify()
    for p in problems:
        log("PROBLEM:", p)
    if opts["blend"]:
        bpy.ops.wm.save_as_mainfile(filepath=opts["blend"])
    if opts["export"]:
        if problems:      # never overwrite the GLB the game loads with something that breaks the contract
            log("contract violated - NOT exporting")
            sys.exit(2)
        export_glb(opts["out"])
        size = os.path.getsize(opts["out"])
        if size > MAX_BYTES:
            log(f"PROBLEM: GLB is {size} bytes > {MAX_BYTES}")
            sys.exit(3)
    log("done; problems=%d" % len(problems))


if __name__ == "__main__":
    main()
