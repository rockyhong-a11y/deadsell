"""Pack rendered animation frames into a sprite sheet + JSON manifest.

usage: python3 tools/pack/sheet.py <frames_dir> <out_png> <spec.json>
  (normally called from a build script, see tools/README.md)

Post-processing applied to every frame (this is what makes renders read as
pixel art):
  * alpha is hard-thresholded (no semi-transparent pixels)
  * a 1 px outline in OUTLINE colour is drawn around the silhouette
  * colours are optionally quantised to a palette size
"""
import json
import os
import sys
from PIL import Image

OUTLINE = (18, 10, 26, 255)


def harden(im, threshold=110):
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= threshold else (0, 0, 0, 0)
    return im


def outline(im, color=OUTLINE):
    w, h = im.size
    src = im.load()
    out = im.copy()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3] != 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] != 0:
                    dst[x, y] = color
                    break
    return out


def process(path, do_outline=True, colors=0):
    im = Image.open(path).convert("RGBA")
    im = harden(im)
    if colors:
        alpha = im.getchannel("A")
        q = im.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGB")
        im = Image.merge("RGBA", (*q.split(), alpha))
    if do_outline:
        im = outline(im)
    return im


def pack(frames_dir, out_png, anims, frame_w, frame_h, anchor, do_outline=True, colors=0, extra=None):
    """anims: list of {"name", "fps", "loop"}; frames are <name>_###.png in frames_dir.

    Layout: one animation per row, frames left to right.
    """
    rows = []
    for a in anims:
        files = sorted(f for f in os.listdir(frames_dir)
                       if f.startswith(a["name"] + "_") and f[len(a["name"]) + 1:-4].isdigit())
        if not files:
            raise SystemExit("no frames for animation %r in %s" % (a["name"], frames_dir))
        rows.append((a, [process(os.path.join(frames_dir, f), do_outline, colors) for f in files]))
    cols = max(len(fr) for _, fr in rows)
    sheet = Image.new("RGBA", (cols * frame_w, len(rows) * frame_h), (0, 0, 0, 0))
    manifest = {"image": os.path.basename(out_png), "frameW": frame_w, "frameH": frame_h,
                "anchor": list(anchor), "animations": {}}
    for row, (a, frames) in enumerate(rows):
        for i, im in enumerate(frames):
            sheet.paste(im, (i * frame_w, row * frame_h))
        entry = {"row": row, "frames": len(frames), "fps": a.get("fps", 12), "loop": a.get("loop", False)}
        for k, v in a.items():
            if k not in ("name", "fps", "loop"):
                entry[k] = v
        manifest["animations"][a["name"]] = entry
    if extra:
        manifest.update(extra)
    os.makedirs(os.path.dirname(out_png) or ".", exist_ok=True)
    sheet.save(out_png, optimize=True)
    with open(out_png[:-4] + ".json", "w") as f:
        json.dump(manifest, f, indent=1)
    return manifest


if __name__ == "__main__":
    frames_dir, out_png, spec_path = sys.argv[1:4]
    spec = json.load(open(spec_path))
    pack(frames_dir, out_png, spec["animations"], spec["frameW"], spec["frameH"], spec["anchor"],
         spec.get("outline", True), spec.get("colors", 0), spec.get("extra"))
