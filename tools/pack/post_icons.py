"""Keep the icon frames that shipped before CONTENT4 pixel-identical.

pack_all.py rebuilds public/assets/sprites/icons.png from the Blender renders; a few of the older models (turret, wolf
trap, gold) have drifted since their frames were committed.  The first rows of the sheet are therefore taken from
tools/pack/icons_legacy.png (the sheet as committed with CONTENT3: rows 0..N-1) and only the rows appended after them
come from the fresh render.  Append-only: new icon ids go after the legacy ones in tools/blender/asset_icons.py.

usage: python3 tools/pack/post_icons.py
"""
import json
import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHEET = os.path.join(ROOT, "public", "assets", "sprites", "icons.png")
LEGACY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons_legacy.png")
FRAME = 32


def main():
    if not os.path.exists(SHEET) or not os.path.exists(LEGACY):
        return
    legacy = Image.open(LEGACY).convert("RGBA")
    sheet = Image.open(SHEET).convert("RGBA")
    rows = legacy.size[1] // FRAME
    if sheet.size[0] != legacy.size[0] or sheet.size[1] < legacy.size[1]:
        raise SystemExit("icons.png is smaller than the legacy sheet: icon rows may only be appended")
    sheet.paste(legacy, (0, 0))
    sheet.save(SHEET, optimize=True)
    n = len(json.load(open(SHEET[:-4] + ".json"))["animations"])
    print("icons: %d legacy rows pinned, %d appended" % (rows, n - rows))


if __name__ == "__main__":
    main()
