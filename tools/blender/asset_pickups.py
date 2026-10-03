"""Pickups sheet: 24x24 frames, anchor (12,22) = ground contact, bottom-centre.

blender -b --factory-startup -P tools/blender/asset_pickups.py
Writes build/frames/pickups/<anim>_###.png + spec.json.
Scale is the in-game 32 px / unit (pickups are modelled a bit oversized for readability).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector  # noqa: E402
import lib_objects as L  # noqa: E402
from lib_objects import bpy  # noqa: E402

OUT = os.path.join(L.FRAMES, "pickups")
W = H = 24
AX, AY = 12, 22
PPU = L.common.PX_PER_UNIT


def setup(yaw=15, pitch=12):
    L.clear_objects(cameras=True)
    L.camera(W, H, AX, AY, yaw=yaw, pitch=pitch)


def behind(center, dist):
    _, _, fwd = L.cam_basis()
    return Vector(center) + fwd * dist


def billboard(ob, center, dist):
    L.face_camera(ob)
    ob.location = behind(center, dist)
    return ob


def snap(root, objs=None, row=AY):
    """Sit the lowest visible pixel of root on `row`."""
    L.ground_snap(root, objs, lift=-(row - AY) / PPU)


# --------------------------------------------------------------------------


def a_cell():
    n = 6
    for i in range(n):
        setup()
        t = 2 * math.pi * i / n
        c = L.m_cell(0.088)
        z = 0.26 + 0.03 * math.sin(t)
        c.location = (0, 0, z)
        hr = 0.135 + 0.018 * math.sin(t)
        billboard(L.disc("cell_halo", hr, L.glow("#1a6fd0")), (0, 0, z), 0.3)
        if i in (1, 2):
            sp = L.sparkle("cell_tw", (0.13, 0.19)[i - 1], L.glow("#e6fdff"))
            billboard(sp, (-0.12, 0, z + 0.13), -0.3)
        L.render_frame(OUT, "cell", i)


def a_gold_coin():
    for i in range(6):
        setup()
        c = L.m_coin(0.15, 0.045, "coin")
        c.rotation_euler = (0, 0, math.radians(30 * i))
        snap(c, row=AY - 1)
        if i == 0:
            billboard(L.sparkle("coin_tw", 0.16, L.glow("#fff6c8")), c.location + Vector((0.1, 0, 0.11)), -0.3)
        L.render_frame(OUT, "gold_coin", i)


def a_gold_pile():
    setup(15, 20)
    rng = random.Random(3)
    objs = []
    k = 0
    for layer, (n, rad) in enumerate([(7, 0.21), (5, 0.13), (3, 0.06), (1, 0.0)]):
        for j in range(n):
            a = 2 * math.pi * j / n + layer * 0.7
            c = L.m_coin(0.085, 0.03, "gp%d" % k)
            c.rotation_euler = (math.radians(90 + rng.uniform(-25, 25)), math.radians(rng.uniform(-25, 25)),
                                math.radians(rng.uniform(0, 90)))
            c.location = (rad * math.cos(a), rad * math.sin(a) * 0.6, 0.03 + layer * 0.05)
            objs.append(c)
            k += 1
    st = L.m_coin(0.1, 0.035, "gstand")
    st.rotation_euler = (math.radians(-8), 0, math.radians(-20))
    st.location = (0.1, -0.15, 0.1)
    objs.append(st)
    gem = L.sphere("gp_gem", 0.05, L.toon("ruby", "#d8203a", "#6a0a2a", "#ff8a8a", rim=L.RIM),
                   loc=(-0.12, -0.1, 0.09), segs=6, rings=4)
    objs.append(gem)
    root = L.group("gold_pile", objs)
    snap(root)
    billboard(L.sparkle("gp_tw", 0.13, L.glow("#fff6c8")), root.location + Vector((-0.04, 0, 0.27)), -0.4)
    L.render_frame(OUT, "gold_pile", 0)


def a_food_apple():
    setup(15, 12)
    m = L.mat("apple")
    prof = [(0.0, 0.02), (0.06, 0.0), (0.12, 0.04), (0.15, 0.11), (0.14, 0.19), (0.1, 0.24), (0.05, 0.245),
            (0.0, 0.22)]
    parts = [L.lathe("ap_body", prof, m, segs=18)]
    parts.append(L.ellipsoid("ap_shine", (0.04, 0.02, 0.06), L.glow("#ffd0c8"), loc=(-0.07, -0.12, 0.16),
                             rot=(0, 20, 0)))
    parts.append(L.cyl("ap_stem", 0.014, 0.09, L.mat("wood_dark"), loc=(0, 0, 0.21), rot=(0, 12, 0), segs=6))
    leaf = [(0.0, 0.0), (0.05, 0.03), (0.11, 0.025), (0.14, 0.0), (0.09, -0.02), (0.04, -0.015)]
    parts.append(L.prism("ap_leaf", leaf, 0.015, L.mat("leaf"), loc=(0.01, -0.01, 0.27), rot=(0, -25, 0)))
    root = L.group("apple", parts, scale=1.05)
    snap(root)
    L.render_frame(OUT, "food_apple", 0)


def a_food_bread():
    setup(18, 14)
    parts = [L.ellipsoid("br_loaf", (0.5, 0.26, 0.24), L.mat("bread"), loc=(0, 0, 0.11))]
    for i, x in enumerate((-0.13, 0.0, 0.13)):
        parts.append(L.box("br_cut%d" % i, (0.03, 0.2, 0.025), L.mat("cloth_cream"), loc=(x, -0.02, 0.215),
                           rot=(0, 25, 0)))
    parts.append(L.ellipsoid("br_roll", (0.22, 0.2, 0.16), L.mat("crust"), loc=(0.2, -0.12, 0.07)))
    parts.append(L.box("br_rollcut", (0.025, 0.12, 0.02), L.mat("cloth_cream"), loc=(0.2, -0.13, 0.145),
                       rot=(0, 25, 0)))
    root = L.group("bread", parts)
    snap(root)
    L.render_frame(OUT, "food_bread", 0)


def a_food_meat():
    setup(15, 14)
    parts = [L.ellipsoid("mt_meat", (0.36, 0.26, 0.27), L.mat("meat"), loc=(-0.05, 0, 0.14), rot=(0, -15, 0))]
    parts.append(L.ellipsoid("mt_fat", (0.16, 0.2, 0.1), L.mat("cloth_cream"), loc=(-0.1, -0.06, 0.24),
                             rot=(0, -15, 0)))
    parts.append(L.cyl("mt_bone", 0.04, 0.24, L.mat("bone"), loc=(0.08, 0, 0.14), rot=(0, 75, 0), segs=8))
    for dz in (-0.04, 0.04):
        parts.append(L.sphere("mt_knob", 0.05, L.mat("bone"), loc=(0.33, 0, 0.2 + dz), segs=8, rings=6))
    root = L.group("meat", parts, scale=0.88)
    snap(root)
    L.render_frame(OUT, "food_meat", 0)


def a_scroll(color):
    setup(15, 10)
    r, ring, core = L.m_scroll(color, length=0.3, r=0.065, aura=0.03)
    r.rotation_euler = (0, math.radians(-20), 0)
    snap(r, row=AY - 2)
    billboard(L.sparkle("sc_tw", 0.15, L.glow(core)), r.location + Vector((0.2, 0, 0.16)), -0.3)
    L.render_frame(OUT, "scroll_" + color, 0)


def a_flask():
    setup(15, 10)
    r = L.m_flask()
    r.scale = (1.08, 1.08, 1.08)
    snap(r)
    L.render_frame(OUT, "flask", 0)


ANIMS = [
    {"name": "cell", "fps": 10, "loop": True},
    {"name": "gold_coin", "fps": 12, "loop": True},
    {"name": "gold_pile", "fps": 1, "loop": False},
    {"name": "food_apple", "fps": 1, "loop": False},
    {"name": "food_bread", "fps": 1, "loop": False},
    {"name": "food_meat", "fps": 1, "loop": False},
    {"name": "scroll_red", "fps": 1, "loop": False},
    {"name": "scroll_purple", "fps": 1, "loop": False},
    {"name": "scroll_green", "fps": 1, "loop": False},
    {"name": "flask", "fps": 1, "loop": False},
]


def main():
    only = L.common.script_args()
    if only:
        os.makedirs(OUT, exist_ok=True)
    else:
        L.clean_dir(OUT)
    L.new_scene(shadows=False)
    steps = [("cell", a_cell), ("gold_coin", a_gold_coin), ("gold_pile", a_gold_pile), ("food_apple", a_food_apple),
             ("food_bread", a_food_bread), ("food_meat", a_food_meat),
             ("scroll_red", lambda: a_scroll("red")), ("scroll_purple", lambda: a_scroll("purple")),
             ("scroll_green", lambda: a_scroll("green")), ("flask", a_flask)]
    for name, fn in steps:
        if only and name not in only:
            continue
        fn()
    L.write_spec(OUT, W, H, (AX, AY), ANIMS)


main()
