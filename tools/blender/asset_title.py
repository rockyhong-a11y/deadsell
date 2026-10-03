"""DEADSELL title key art: Cinder (the heroine) in a heroic pose.

    blender -b --factory-startup -P tools/blender/asset_title.py

Reuses the finished heroine model/rig/chain simulation from lib_heroine.py (no edits to it):
rusty sword raised to the sky, scarf and ponytail streaming back in the wind, slight low
camera angle, same toon shading / cool rim as the sprite sheets.  Writes the raw render
build/frames/title/title_000.png (transparent background); tools/pack/post_title.py hardens
the alpha, adds the 2 px #120a1a outline and writes public/assets/ui/title.png.
Env: TITLE_PPU (pixels per unit, default 156).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import common  # noqa: E402
import lib_heroine as L  # noqa: E402
from mathutils import Vector, Quaternion  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "build", "frames", "title")
PPU = float(os.environ.get("TITLE_PPU", "156"))
W, H = 620, 640
AX, AY = 270, 590          # pixel of the world origin (between her feet)
plant = L.plant

common.reset_scene()
common.add_sun((-0.45, 0.55, -0.70), energy=3.2, color=(1.0, 0.95, 0.88))
sc = bpy.context.scene
sc.eevee.shadow_cube_size = "512"
sc.eevee.shadow_cascade_size = "2048"
M = L.make_materials()
h = L.Heroine(M)
h.chains = L.make_chains(h)
common.setup_sprite_camera(W, H, AX, AY, yaw_deg=26.0, pitch_deg=-9.0, px_per_unit=PPU)


def torso(lean=0.0, head=0.0):
    return {"hips": -0.40 * lean, "spine": -0.30 * lean, "chest": -0.30 * lean,
            "neck": 0.30 * lean, "head": 0.40 * lean + head}


# heroic lunge: weight on the front leg, back heel lifted, chest out, sword arm thrust high,
# free arm flung back for balance, chin up
a = {"sh_n": 8, "el_n": 25, "ha_n": -10, "sh_f": -10, "el_f": 25, "ha_f": -10}
a.update(torso(-3.0, 6.0))
spec = {
    "a": a,
    "hip": (0.10, -0.25),
    "fn": plant(0.52),
    "ff": plant(-0.44, -30),
    "ground": 0.0,
    "hn": (0.30, 1.60, 62),
    "hf": (-0.40, 1.06, -35),
    "show": ["sword"],
    "vel": (2.2, 0.3),
    "wind": (-2.4, 0.5),
}
posed = L.solve_frames(h, [spec], 10, False, pre=(2.2, 0.3), wind=(-2.4, 0.5))
pa, poff, pts = posed[0]

# measure the blade tip for a glint
rig = h.rig
rig.pose(pa, poff, {})
L.update()
sw = h.prop_root["sword"]
tip = sw.matrix_world @ h.tip_local["sword"][0]
print("TITLE sword tip (%.2f, %.2f)" % (tip.x, tip.z))
star = L.prism("glint", [(0, 0.15), (0.03, 0.04), (0.15, 0), (0.03, -0.04), (0, -0.15), (-0.03, -0.04), (-0.15, 0), (-0.03, 0.04)],
               0.02, M["smear"])
star.hide_render = True
objs = L.chain_objects(h, "title", pts, spec, phase=0.0)


def fx(i, n, spec_):
    out = {ob: None for ob in objs}
    out[star] = (Vector((tip.x, -0.4, tip.z)), Quaternion((0, 1, 0), math.radians(8)), (0.8, 1.0, 0.8))
    return out


os.makedirs(OUT, exist_ok=True)
L.render_frames(h, "title", posed, [spec], OUT, fx_fn=fx, extra_objs=objs + [star])
print("title done (ppu %.0f, %dx%d)" % (PPU, W, H))
