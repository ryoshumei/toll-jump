"""
render_previews.py - Cycles previews of public/models/roadster.glb in a dark studio.

Imports the exported GLB (so what you see is what the game loads), adds a dark floor,
a soft spotlight pool, softboxes that only light the car, and a faint backdrop, then renders:

    shots/blender-compare.png   same rear-3/4 angle + framing as refs/roadster.png (2000x1000)
    shots/blender-side.png      left side, long lens (compare with the side view in refs/v2-key.jpg)
    shots/blender-front34.png   front 3/4 (the front is not in any reference)

Run:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/render_previews.py -- \
        [--glb path] [--shots compare,side,front34] [--samples 64] [--scale 100] \
        [--out-dir dir] [--prefix blender-]

Side-by-side sheets against the reference are made by tools/blender/compose_compare.py.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))

# 'compare' camera: landmark fit against refs/roadster.png (2000x1000, 36 mm sensor width):
# rear-left 3/4, azimuth ~49 deg from the car axis, ~1.5 deg elevation, 30 mm lens.
# pool = floor point (x, y) the spot light is aimed at.
CAMERAS = {
    "compare": dict(loc=(-5.71, -5.39, 0.75), target=(0.06, -0.41, 0.55), lens=30.0, res=(2000, 1000),
                    pool=(-1.7, 3.0), wall=True),
    "side": dict(loc=(-24.0, -0.15, 1.35), target=(0.0, -0.15, 0.52), lens=120.0, res=(2000, 800),
                 pool=(-1.2, 0.2), wall=True),
    "front34": dict(loc=(-6.2, 7.4, 1.55), target=(0.0, 0.0, 0.5), lens=42.0, res=(2000, 1000),
                    pool=(-1.0, 0.6), wall=True),
    "rear": dict(loc=(2.6, -7.6, 2.4), target=(0.0, -0.4, 0.55), lens=40.0, res=(2000, 1000),   # debug only
                 pool=(0.0, -2.5), wall=True),
    "dbg_nose": dict(loc=(-3.2, 4.6, 0.9), target=(-0.2, 1.7, 0.45), lens=40.0, res=(2000, 1000),
                     pool=(-1.0, 2.6), wall=True),
    "dbg_under": dict(loc=(-3.0, -3.2, 0.12), target=(0.0, 0.0, 0.2), lens=24.0, res=(2000, 1000),
                      pool=(0.0, 0.0), wall=True),
    "dbg_wheel": dict(loc=(-3.6, -2.2, 0.55), target=(-0.9, -1.4, 0.4), lens=60.0, res=(2000, 1000),
                      pool=(-1.5, -0.5), wall=True),
    "dbg_roof": dict(loc=(-1.0, -3.0, 3.0), target=(0.0, -0.9, 0.95), lens=50.0, res=(2000, 1000),
                     pool=(-1.0, 0.0), wall=True),
    "dbg_top": dict(loc=(-3.4, -4.2, 4.2), target=(0.0, -0.3, 0.8), lens=35.0, res=(2000, 1000),
                    pool=(-1.0, 0.0), wall=True),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"glb": os.path.join(PROJECT, "public", "models", "roadster.glb"),
         "shots": ["compare", "side", "front34"], "samples": 64, "scale": 100,
         "out_dir": os.path.join(PROJECT, "shots"), "prefix": "blender-"}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == "--glb":
            o["glb"] = os.path.abspath(argv[i + 1]); i += 1
        elif k == "--shots":
            o["shots"] = argv[i + 1].split(","); i += 1
        elif k == "--samples":
            o["samples"] = int(argv[i + 1]); i += 1
        elif k == "--scale":
            o["scale"] = int(argv[i + 1]); i += 1
        elif k == "--out-dir":
            o["out_dir"] = os.path.abspath(argv[i + 1]); i += 1
        elif k == "--prefix":
            o["prefix"] = argv[i + 1]; i += 1
        i += 1
    return o


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def add_area(name, loc, target, size, energy, color=(1, 1, 1), size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE" if size_y else "SQUARE"
    ld.size = size
    if size_y:
        ld.size_y = size_y
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    look_at(ob, target)
    return ob


def add_spot(name, loc, target, energy, angle_deg, blend, radius=0.5, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "SPOT")
    ld.energy = energy
    ld.spot_size = math.radians(angle_deg)
    ld.spot_blend = blend
    ld.shadow_soft_size = radius
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    look_at(ob, target)
    return ob


def link_receivers(light_obj, coll):
    """Cycles light linking: this light only illuminates objects in `coll`."""
    try:
        light_obj.light_linking.receiver_collection = coll
    except Exception as e:  # older Blender: no light linking, lights just hit everything
        print("[previews] light linking unavailable:", e)


def make_collection(name, objects):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    for ob in objects:
        coll.objects.link(ob)
    return coll


def make_material(name, base, rough):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = base
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    return mat


class Studio:
    """Floor, softboxes, spot pool and a faint wall; re-aimed per shot."""

    def __init__(self, scene, car_objects):
        world = bpy.data.worlds.new("studio")
        scene.world = world
        if world.node_tree is None:
            world.use_nodes = True
        bg = world.node_tree.nodes.get("Background")
        bg.inputs["Color"].default_value = (0.006, 0.0065, 0.009, 1.0)
        bg.inputs["Strength"].default_value = 1.0

        bpy.ops.mesh.primitive_plane_add(size=90.0, location=(0, 0, 0))
        self.floor = bpy.context.active_object
        self.floor.name = "studio_floor"
        self.floor.data.materials.append(make_material("studio_floor", (0.085, 0.09, 0.105, 1.0), 0.55))

        bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
        self.wall = bpy.context.active_object
        self.wall.name = "studio_wall"
        self.wall.scale = (80.0, 30.0, 1.0)
        self.wall.data.materials.append(make_material("studio_wall", (0.05, 0.055, 0.068, 1.0), 0.85))

        car_only = make_collection("car_only", car_objects)
        wall_only = make_collection("wall_only", [self.wall])
        floor_only = make_collection("floor_only", [self.floor])
        pool_rx = make_collection("pool_receivers", car_objects + [self.floor])

        # softboxes: light the car only, so the floor stays dark and they read as reflections on paint/glass
        for lo in (
            add_area("strip_top", (-0.4, -0.2, 4.3), (0.0, -0.2, 0.0), 1.1, 150.0, size_y=7.5),
            add_area("dome", (0.0, 0.0, 6.0), (0.0, 0.0, 0.0), 9.0, 90.0),
            add_area("side_top", (-2.6, -0.3, 3.2), (-0.9, -0.3, 0.45), 1.4, 40.0, size_y=6.0),
            add_area("key", (-5.0, 4.2, 4.6), (0, 0, 0.6), 4.0, 22.0, (1.0, 0.99, 0.97), size_y=2.0),
            add_area("rim", (4.8, -4.6, 2.4), (0, -1.5, 0.7), 3.0, 170.0, (0.85, 0.92, 1.0), size_y=0.8),
            add_area("rim2", (-4.8, -5.0, 2.0), (0, -2.0, 0.7), 2.0, 60.0, (1.0, 1.0, 1.0), size_y=0.6),
            add_area("back_fill", (0.0, -7.5, 2.4), (0, 0, 0.6), 3.0, 14.0, (1.0, 1.0, 1.0)),
            add_area("glass_glow", (4.5, 3.8, 2.6), (0, 0, 0.7), 3.0, 110.0, (1.0, 0.78, 0.55)),
        ):
            link_receivers(lo, car_only)
        self.pool = add_spot("pool", (-4.6, 5.6, 6.2), (-1.7, 3.0, 0.0), 3200.0, 40.0, 0.85, radius=0.8)
        link_receivers(self.pool, pool_rx)
        # faint overall floor light so the black rocker/diffuser separate from the floor (as in the reference)
        link_receivers(add_area("floor_fill", (0.0, 0.0, 7.0), (0.0, 0.0, 0.0), 14.0, 100.0), floor_only)
        self.wash = add_area("wall_wash", (0, 0, 0.3), (0, 0, 6.0), 44.0, 520.0, size_y=3.0)
        link_receivers(self.wash, wall_only)

    def aim(self, cfg):
        """Re-aim pool + wall for a camera."""
        cam = Vector(cfg["loc"])
        tgt = Vector(cfg["target"])
        d = Vector((tgt.x - cam.x, tgt.y - cam.y, 0.0))
        d.normalize()
        px, py = cfg.get("pool", (-1.7, 3.0))
        side = Vector((-d.y, d.x, 0.0))                       # camera-left on the ground plane
        self.pool.location = Vector((px, py, 0.0)) - d * 3.5 + side * 2.0 + Vector((0, 0, 6.2))
        look_at(self.pool, (px, py, 0.0))
        # wall: faces the camera, far behind the car
        wall_c = Vector((tgt.x, tgt.y, 0.0)) + d * 15.0
        self.wall.location = (wall_c.x, wall_c.y, 9.0)
        self.wall.rotation_euler = (math.radians(90.0), 0.0, math.atan2(d.y, d.x) + math.radians(90.0) + math.pi)
        self.wall.hide_render = not cfg.get("wall", True)
        # wash: low light in front of the wall, aimed at it
        self.wash.location = (wall_c.x - d.x * 6.0, wall_c.y - d.y * 6.0, 0.3)
        look_at(self.wash, (wall_c.x, wall_c.y, 5.5))


def setup_cycles(scene, samples, scale):
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.samples = samples
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    cy.max_bounces = 6
    cy.glossy_bounces = 4
    cy.transmission_bounces = 2
    cy.sample_clamp_indirect = 8.0
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cy.device = "GPU"
    except Exception as e:  # CPU fallback
        print("[previews] GPU not available:", e)
        cy.device = "CPU"
    scene.render.resolution_percentage = scale
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure = 0.0


def render_shot(scene, studio, name, cfg, opts):
    studio.aim(cfg)
    cam_data = bpy.data.cameras.new("cam_" + name)
    cam_data.lens = cfg["lens"]
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.sensor_width = 36.0
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new("cam_" + name, cam_data)
    scene.collection.objects.link(cam)
    cam.location = cfg["loc"]
    look_at(cam, cfg["target"])
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = cfg["res"]
    os.makedirs(opts["out_dir"], exist_ok=True)
    path = os.path.join(opts["out_dir"], f"{opts['prefix']}{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[previews] wrote", path, flush=True)
    bpy.data.objects.remove(cam)


def main():
    opts = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=opts["glb"])
    car_objects = [o for o in scene.objects]
    studio = Studio(scene, car_objects)
    setup_cycles(scene, opts["samples"], opts["scale"])
    for name in opts["shots"]:
        render_shot(scene, studio, name, CAMERAS[name], opts)


if __name__ == "__main__":
    main()
