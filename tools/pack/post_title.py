"""Title key art post-processing -> public/assets/ui/title.png.

  build/frames/title/title_000.png (raw Blender render, transparent)
    -> hard alpha (no semi-transparent pixels), tight crop, 2 px #120a1a outline.

Also provides `finish()` which post_portrait.py reuses.  Run directly:  python3 tools/pack/post_title.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image  # noqa: E402
from sheet import harden, outline  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "build", "frames", "title", "title_000.png")
DST = os.path.join(ROOT, "public", "assets", "ui", "title.png")


def finish(src, dst, px=2, margin=2, cut=None):
    """Hard-alpha `src`, optional `cut(im)->im`, crop to the silhouette, pad, outline `px` pixels."""
    im = harden(Image.open(src).convert("RGBA"))
    if cut:
        im = cut(im)
    im = im.crop(im.getchannel("A").getbbox())
    pad = px + margin
    canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, (pad, pad))
    for _ in range(px):
        canvas = outline(canvas)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    canvas.save(dst, optimize=True)
    return canvas.size


def main():
    if not os.path.exists(SRC):
        print("post_title: %s missing (run tools/blender/asset_title.py first), skipped" % os.path.relpath(SRC, ROOT))
        return
    size = finish(SRC, DST)
    print("title key art %dx%d -> %s" % (size[0], size[1], os.path.relpath(DST, ROOT)))


if __name__ == "__main__":
    main()
