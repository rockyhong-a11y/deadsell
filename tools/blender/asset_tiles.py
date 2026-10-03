"""Tile-set source renders (G-buffers) for the three biomes.

blender -b --factory-startup -P tools/blender/asset_tiles.py [-- biome ...]

Writes build/env/tiles/<biome>/<piece>_{n,d}.png + pieces.json, which
tools/pack/post_tiles.py turns into public/assets/tiles/<biome>.png/.json.
Scale: 1 Blender unit = 1 tile = 24 px.  Front orthographic view.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_env as E  # noqa: E402

FILL_W, FILL_H = 8, 4          # fill / back-wall macro size in cells (periodic)
U = 1.0 / E.PPU                # one pixel in Blender units


# --------------------------------------------------------------------------
# masonry walls (periodic macros)


def masonry(seed, heights, lengths, gap_px, depth, bevel_px, chip_px, matids, rot_jit=1.5,
            depth_jit_px=0.8, mortar="mortar", mortar_y=None, w_cells=FILL_W, h_cells=FILL_H,
            big=None):
    """Periodic stone wall, w_cells x h_cells, bottom-left at world (0,0)."""
    rnd = random.Random(seed)
    pw, ph = w_cells * E.PPU, h_cells * E.PPU
    lay = E.courses(rnd, pw, ph, heights, lengths)
    if big:
        # merge some neighbouring stones of two courses into big slabs
        pass
    for i, (x, z, w, h) in enumerate(lay):
        cx, cz = (x + w / 2) * U, (z + h / 2) * U
        sw, sh = (w - gap_px) * U, (h - gap_px) * U
        mat = matids[rnd.randrange(len(matids))]
        s = rnd.randrange(1 << 30)
        rid = rnd.randrange(1, 255)
        dy = rnd.uniform(-depth_jit_px, depth_jit_px) * U
        rot = (rnd.uniform(-rot_jit, rot_jit), rnd.uniform(-rot_jit * 0.6, rot_jit * 0.6),
               rnd.uniform(-rot_jit, rot_jit))

        def mk(ddx, ddz, cx=cx, cz=cz, sw=sw, sh=sh, mat=mat, s=s, rid=rid, dy=dy, rot=rot):
            return E.block(sw, sh, depth, (cx + ddx, depth / 2 + dy, cz + ddz), matid=mat,
                           bevel=bevel_px * U, chip=chip_px * U, seed=s, rot=rot, rid=rid)
        E.periodic(mk, cx, cz, sw + 0.1, sh + 0.1, w_cells, h_cells)
    my = mortar_y if mortar_y is not None else bevel_px * U + 2.5 * U
    E.block(w_cells + 4, h_cells + 4, 0.1, (w_cells / 2, my + 0.05, h_cells / 2), matid=mortar,
            bevel=0, rid=0)
    return lay


BIOMES = {
    "prison": dict(
        fill=dict(seed=11, heights=(9, 15), lengths=(14, 40), gap_px=1.6, depth=0.5, bevel_px=2.2,
                  chip_px=1.6, matids=["stone", "stone", "stone", "stone2"], rot_jit=2.5),
        back=dict(seed=21, heights=(7, 10), lengths=(12, 26), gap_px=1.4, depth=0.4, bevel_px=1.5,
                  chip_px=1.0, matids=["back", "back", "back2"], rot_jit=1.5, mortar="backmortar"),
    ),
    "ramparts": dict(
        fill=dict(seed=12, heights=(11, 13), lengths=(22, 38), gap_px=1.4, depth=0.5, bevel_px=1.8,
                  chip_px=0.9, matids=["stone", "stone", "stone2"], rot_jit=1.2),
        back=dict(seed=22, heights=(11, 13), lengths=(24, 40), gap_px=1.3, depth=0.4, bevel_px=1.4,
                  chip_px=0.6, matids=["back", "back", "back2"], rot_jit=0.8, mortar="backmortar"),
    ),
    "tower": dict(
        fill=dict(seed=13, heights=(7, 9), lengths=(14, 22), gap_px=1.5, depth=0.4, bevel_px=1.6,
                  chip_px=1.0, matids=["brick", "brick", "stone2"], rot_jit=1.5),
        back=dict(seed=23, heights=(6, 7), lengths=(12, 18), gap_px=1.3, depth=0.3, bevel_px=1.2,
                  chip_px=0.7, matids=["back", "back", "back2"], rot_jit=1.0, mortar="backmortar"),
    ),
}


def out(biome, name):
    return os.path.join(E.ENV_OUT, "tiles", biome, name)


def build(biome):
    P = BIOMES[biome]
    meta = {"biome": biome, "pieces": {}}
    # ---- fill macro
    E.new_scene()
    masonry(**P["fill"])
    E.render(out(biome, "fill"), 0, FILL_H, FILL_W * E.PPU, FILL_H * E.PPU)
    meta["pieces"]["fill"] = {"w": FILL_W, "h": FILL_H}
    # ---- back wall macro
    E.clear()
    masonry(**P["back"])
    E.render(out(biome, "back"), 0, FILL_H, FILL_W * E.PPU, FILL_H * E.PPU)
    meta["pieces"]["back"] = {"w": FILL_W, "h": FILL_H}
    E.save_meta(out(biome, "pieces.json"), meta)


if __name__ == "__main__":
    args = E.common.script_args()
    for b in (args or list(BIOMES)):
        build(b)
