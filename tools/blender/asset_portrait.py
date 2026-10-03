"""DEADSELL boss portrait: The Iron Matron, bust shot with a dramatic low angle.

    blender -b --factory-startup -P tools/blender/asset_portrait.py

Reuses the finished boss model (lib_boss.build_matron, mesh quality x3) and its planar
FK/IK pose solver; the pose below is a hunched, glaring, head-turned-to-camera variant of
the sprite sheet's idle.  Writes the raw render build/frames/portrait/portrait_000.png
(transparent, cut off at the waist); tools/pack/post_portrait.py hardens the alpha, trims
the bottom edge, adds the 2 px #120a1a outline and writes public/assets/ui/boss_portrait.png.
Env: PORTRAIT_PPU (default 128 px/unit), PORTRAIT_CAST (1 = sun shadows on, default).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import common  # noqa: E402
from lib_boss import build_matron, ROOT  # noqa: E402

PPU = float(os.environ.get("PORTRAIT_PPU", "128"))
CAST = os.environ.get("PORTRAIT_CAST", "1") == "1"
TAG = os.environ.get("PORTRAIT_TAG", "")
OUT = os.path.join(ROOT, "build", "frames", "portrait")
W, H = 560, 380
Z_CUT = 2.2                      # world height of the bottom edge of the frame (at the target plane)
TARGET = (0.15, 0.0, 3.3)
YAW, PITCH = 26.0, -12.0
AX, AY = 300, int(round(H - (TARGET[2] - Z_CUT) * PPU * math.cos(math.radians(PITCH))))

common.reset_scene()
common.add_sun((-0.45, 0.55, -0.70), energy=3.2, color=(1.0, 0.95, 0.88))
sc = bpy.context.scene
sc.eevee.shadow_cube_size = "512"
sc.eevee.shadow_cascade_size = "2048"
m = build_matron(q=3, cast=CAST)
rig, P = m.rig, m.P
common.setup_sprite_camera(W, H, AX, AY, yaw_deg=YAW, pitch_deg=PITCH, px_per_unit=PPU, target=TARGET)

# hot (pale) eye overlays are for attack frames only; the amber eyes are the portrait's glow
for ob in m.eyes_hot:
    ob.hide_render = True

# ---------------------------------------------------------------------------
# pose (same conventions as asset_matron.py: 'joint@' = world swing, 'ik_*' / 'reach_*' targets)
BELL_PTS = [(0, -0.05), (0.32, -0.18), (-0.32, -0.18), (0.6, -0.7), (-0.6, -0.7),
            (0.64, -1.05), (-0.64, -1.05), (0.6, -1.11), (-0.6, -1.11)]
CHAIN = P.length("fl0", "fl1") + P.length("fl1", "bell")
CLOTH = ("braid", "braid1", "braid2", "braid3", "braid4", "cape", "cape1", "cape2", "cape3", "tab", "tab1")


def cloth(braid, cape, tab=(0, 0)):
    d = {}
    for j, v in zip(CLOTH[:5], braid):
        d[j + "@"] = v
    for j, v in zip(CLOTH[5:9], cape):
        d[j + "@"] = v
    d["tab@"], d["tab1@"] = tab
    return d


def gz(a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    return -min(px * s + pz * c for px, pz in BELL_PTS) - 0.015


POSE = {
    **cloth(braid=(-64, -34, -22, -14, -10), cape=(8, 12, 14, 14)),
    "off_hips": (0.0, 0, -0.12), "hips": -2, "spine": -3, "chest": -3, "neck": 7, "head": 3, "jaw": -4,
    "ik_th_n": (-0.34, 0.17, 0.0), "ik_th_f": (0.40, 0.17, 0.0),
    "sh_n@": 38, "el_n": 66, "ha_n": -14,
    "sh_f@": -20, "el_f": 34, "ha_f": 0,
    "ca": 12.0, "cl": 0.8, "ba": 0.0, "bpx": 1.0, "bpz": gz(0.0), "bw": 1.0,
    "tw_head": -30, "tw_neck": -8,
}


def solve(p):
    spec, off, tw = {}, {}, {}
    for k, v in p.items():
        if k.startswith("off_"):
            off[k[4:]] = v
        elif k.startswith("tw_"):
            tw[k[3:]] = v
        elif k in ("ca", "cl", "ba", "bpx", "bpz", "bw"):
            continue
        else:
            spec[k] = v
    ang, W_ = P.solve(spec, off)
    fx0, fz0, _ = W_["fl0"]
    tx = fx0 + p["cl"] * CHAIN * math.sin(math.radians(p["ca"]))
    tz = fz0 - p["cl"] * CHAIN * math.cos(math.radians(p["ca"]))
    tx += (p["bpx"] - tx) * p["bw"]
    tz += (p["bpz"] - tz) * p["bw"]
    spec["reach_fl0"] = (tx, tz, p["ba"])
    ang, W_ = P.solve(spec, off)
    for s in ("n", "f"):
        a = (ang.get("sh_" + s, 0.0) + 180.0) % 360.0 - 180.0
        ang["pa_" + s] = max(-45.0, min(55.0, 0.35 * a))
    oz = off.get("hips", (0, 0, 0))[2]
    sk = max(0.5, min(1.0, (2.0 + oz - 0.04) / 1.5))
    tb = max(0.5, min(1.0, (1.9 + oz - 0.04) / 1.35))
    cp = max(0.6, min(1.0, (3.1 + oz - 0.04) / 2.6))
    return ang, off, {"skirt": (1, 1, sk), "tab": (1, 1, tb), "cape": (1, 1, cp)}, tw


ang, off, scl, tw = solve(POSE)
rig.pose(ang, off, scl, tw)
bpy.context.view_layer.update()
os.makedirs(OUT, exist_ok=True)
sc.render.filepath = os.path.join(OUT, "portrait%s_000.png" % TAG)
sc.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("portrait done (ppu %.0f, cast %s, %dx%d)" % (PPU, CAST, W, H))
