"""
compose_compare.py - stack the reference above a render for visual comparison.

Plain Python + Pillow (no Blender). Usage:

    python3 tools/blender/compose_compare.py render.png out.png [--ref refs/roadster.png]
        [--crop x0,y0,x1,y1] [--blend]

--crop    crop both images to this box (pixels of the 2000x1000 originals) before stacking
--blend   also append a 50/50 overlay row (handy for checking landmark alignment)
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    render_path, out_path = args[0], args[1]
    ref_path = os.path.join(PROJECT, "refs", "roadster.png")
    crop = None
    blend = False
    i = 2
    while i < len(args):
        if args[i] == "--ref":
            ref_path = args[i + 1]
            i += 1
        elif args[i] == "--crop":
            crop = tuple(int(v) for v in args[i + 1].split(","))
            i += 1
        elif args[i] == "--blend":
            blend = True
        i += 1
    ref = Image.open(ref_path).convert("RGB")
    ren = Image.open(render_path).convert("RGB")
    if ren.size != ref.size:
        ren = ren.resize(ref.size, Image.LANCZOS)
    if crop:
        ref, ren = ref.crop(crop), ren.crop(crop)
    rows = [ref, ren]
    if blend:
        rows.append(Image.blend(ref, ren, 0.5))
    w, h = ref.size
    sheet = Image.new("RGB", (w, h * len(rows)))
    for k, im in enumerate(rows):
        sheet.paste(im, (0, k * h))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    sheet.save(out_path)
    print("wrote", out_path, sheet.size)


if __name__ == "__main__":
    main()
