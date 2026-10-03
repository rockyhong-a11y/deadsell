"""Pack every build/frames/<sheet>/spec.json into public/assets/sprites/<sheet>.png/.json.

usage: python3 tools/pack/pack_all.py [sheet ...]     (no args = all)

spec.json (written by the Blender scripts):
  {"frameW": 128, "frameH": 112, "anchor": [64, 100], "outline": true, "colors": 0,
   "out": "sprites/heroine.png",            # relative to public/assets (optional)
   "animations": [{"name": "idle", "fps": 10, "loop": true}, ...],
   "extra": {...}}                          # merged into the manifest (optional)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sheet import pack  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRAMES = os.path.join(ROOT, "build", "frames")
ASSETS = os.path.join(ROOT, "public", "assets")


def main(names):
    names = names or sorted(n for n in os.listdir(FRAMES) if not n.startswith("_"))
    for name in names:
        spec_path = os.path.join(FRAMES, name, "spec.json")
        if not os.path.exists(spec_path):
            continue
        spec = json.load(open(spec_path))
        out = os.path.join(ASSETS, spec.get("out", "sprites/%s.png" % name))
        m = pack(os.path.join(FRAMES, name), out, spec["animations"], spec["frameW"], spec["frameH"],
                 spec["anchor"], spec.get("outline", True), spec.get("colors", 0), spec.get("extra"))
        print("packed %-16s %3d anims -> %s" % (name, len(m["animations"]), os.path.relpath(out, ROOT)))


if __name__ == "__main__":
    main(sys.argv[1:])
