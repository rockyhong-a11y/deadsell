"""Boss portrait post-processing -> public/assets/ui/boss_portrait.png.

  build/frames/portrait/portrait_000.png (raw Blender render of the Iron Matron, cut off at the waist)
    -> hard alpha, slanted trim of the bottom edge (reads as a deliberate bust cut), tight crop,
       2 px #120a1a outline.

Run directly:  python3 tools/pack/post_portrait.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image, ImageDraw  # noqa: E402
from post_title import finish, ROOT  # noqa: E402

SRC = os.path.join(ROOT, "build", "frames", "portrait", "portrait_000.png")
DST = os.path.join(ROOT, "public", "assets", "ui", "boss_portrait.png")
TRIM_LEFT, TRIM_RIGHT = 0.00, 0.10      # fraction of the height removed at the left / right end of the bottom edge


def slant(im):
    bb = im.getchannel("A").getbbox()
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    y0 = bb[3] - TRIM_LEFT * h
    y1 = bb[3] - TRIM_RIGHT * h
    mask = Image.new("L", im.size, 255)
    ImageDraw.Draw(mask).polygon([(bb[0], y0), (bb[2], y1), (bb[2], im.height), (bb[0], im.height)], fill=0)
    a = im.getchannel("A")
    px_a, px_m = a.load(), mask.load()
    for y in range(im.height):
        for x in range(im.width):
            if px_m[x, y] == 0:
                px_a[x, y] = 0
    im.putalpha(a)
    return im


def main():
    if not os.path.exists(SRC):
        print("post_portrait: %s missing (run tools/blender/asset_portrait.py first), skipped" % os.path.relpath(SRC, ROOT))
        return
    size = finish(SRC, DST, cut=slant)
    print("boss portrait %dx%d -> %s" % (size[0], size[1], os.path.relpath(DST, ROOT)))


if __name__ == "__main__":
    main()
