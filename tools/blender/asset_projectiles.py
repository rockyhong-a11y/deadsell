"""Projectiles & skill objects sheet: 48x48 frames, anchor (24,24) = centre.

blender -b --factory-startup -P tools/blender/asset_projectiles.py
Writes build/frames/projectiles/<anim>_###.png + spec.json.

Everything that flies points/travels toward +X (the game mirrors for -X).
Ground-standing skill objects (turret_*, trap_*) are drawn with their ground
contact on a fixed row (manifest "groundRow"), centred horizontally.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Matrix, Vector  # noqa: E402
import lib_objects as L  # noqa: E402
from lib_objects import bpy  # noqa: E402

OUT = os.path.join(L.FRAMES, "projectiles")
W = H = 48
AX, AY = 24, 24
GROUND_TURRET = 37   # pixel row of the turret feet
GROUND_TRAP = 31     # pixel row of the trap base


def cam(yaw=12, pitch=6):
    return L.camera(W, H, AX, AY, yaw=yaw, pitch=pitch)


def behind(center, dist):
    _, _, fwd = L.cam_basis()
    return Vector(center) + fwd * dist


def billboard(ob, center, dist):
    L.face_camera(ob)
    ob.location = behind(center, dist)
    return ob


def setup(yaw=12, pitch=6):
    L.clear_objects(cameras=True)
    cam(yaw, pitch)


# --------------------------------------------------------------------------


def a_arrow():
    setup(10, 6)
    r = L.m_arrow(length=0.84, shaft_r=0.024)
    r.location = (0, 0, 0)
    L.render_frame(OUT, "arrow", 0)


def a_feather():
    setup(10, 6)
    parts = []
    # vane outline along +X: sharp quill tip at +X, frayed tail at -X
    up = [(0.36, 0.0), (0.26, 0.03), (0.12, 0.068), (-0.02, 0.085), (-0.14, 0.08), (-0.2, 0.05), (-0.23, 0.075),
          (-0.3, 0.04), (-0.33, 0.0)]
    lo = [(0.36, 0.0), (0.24, -0.022), (0.1, -0.05), (-0.04, -0.064), (-0.12, -0.05), (-0.16, -0.065),
          (-0.24, -0.04), (-0.33, 0.0)]
    parts.append(L.prism("fe_up", up, 0.02, L.mat("feather_light")))
    parts.append(L.prism("fe_lo", lo, 0.02, L.mat("feather"), loc=(0, 0.002, 0)))
    parts.append(L.tube("fe_rachis", [(0.4, -0.014, 0.0), (0.0, -0.014, 0.004), (-0.36, -0.014, 0.0)],
                        [0.012, 0.012, 0.008], L.mat("bone"), segs=5))
    for i, (x, z, a) in enumerate([(0.05, 0.06, 35), (-0.1, -0.05, -35), (-0.06, 0.07, 30)]):
        parts.append(L.box("fe_barb%d" % i, (0.012, 0.01, 0.05), L.mat("feather"), loc=(x, -0.012, z), rot=(0, a, 0)))
    parts.append(L.cone("fe_tip", 0.02, 0.0, 0.07, L.glow("#ff7ad8"), loc=(0.36, -0.01, 0.0), rot=(0, 90, 0), segs=5))
    L.group("feather", parts, rot=(0, 0, 0))
    L.render_frame(OUT, "feather", 0)


def a_boss_debris():
    setup(14, 8)
    parts = [L.rocky("db_main", 0.3, L.mat("stone"), seed=11, jitter=0.3, scale=(1.15, 0.9, 0.85))]
    parts.append(L.rocky("db_chunk", 0.16, L.mat("stone_dark"), seed=5, loc=(0.22, -0.05, -0.12), jitter=0.3))
    parts.append(L.rocky("db_chunk2", 0.11, L.mat("stone_light"), seed=8, loc=(-0.26, -0.06, 0.1), jitter=0.3))
    # mortar / moss crust on top and a snapped iron bolt sticking out
    parts.append(L.rocky("db_crust", 0.16, L.mat("mortar"), seed=3, loc=(-0.05, 0.03, 0.18), jitter=0.2,
                         scale=(1.6, 1.0, 0.45)))
    parts.append(L.cyl("db_rod", 0.025, 0.22, L.mat("rust"), loc=(0.1, -0.05, 0.12), rot=(0, 35, 0), segs=6))
    r = L.group("boss_debris", parts, rot=(0, 15, 0))
    r.location = (0, 0, 0)
    L.render_frame(OUT, "boss_debris", 0)


def a_bomb():
    for i in range(4):
        setup(12, 8)
        r, tip = L.m_bomb()
        r.rotation_euler = (0, math.radians((-6, 0, 6, 0)[i]), 0)
        r.location = (0, 0, -0.05)
        bpy.context.view_layer.update()
        wtip = r.matrix_world @ tip
        size = (0.1, 0.075, 0.115, 0.085)[i]
        sp = L.spark("bomb_spark", size, i * 0.5, (0, 0, 0))
        g = L.group("bomb_sparkg", sp)
        billboard(g, wtip, -0.3)
        rng = random.Random(i)
        for k in range(3):
            e = L.box("ember%d" % k, (0.03, 0.03, 0.03), L.glow(("#ffb03a", "#ff7a1e", "#ffe27a")[k]),
                      loc=wtip + Vector((rng.uniform(-0.16, 0.06), -0.3, rng.uniform(0.0, 0.14))))
            del e
        L.render_frame(OUT, "bomb", i)


def a_fire_grenade():
    for i in range(4):
        setup(12, 8)
        r = L.m_fire_grenade()
        r.rotation_euler = (0, math.radians(-90 * i + 15), 0)
        r.location = (0, 0, -0.03)
        back = L.flame("fg_back", 0.46 + 0.04 * (i % 2), 0.21, layers=("#a8201c", "#ff5a1e"), seed=10 + i,
                       sway=(0.12, -0.05, 0.16, 0.0)[i])
        bg = L.group("fg_backg", back)
        bg.location = behind((0, 0, -0.16), 0.3)
        rng = random.Random(i + 3)
        for k in range(2):
            L.box("fg_ember%d" % k, (0.035, 0.03, 0.035), L.glow(("#ffb03a", "#ff5a1e")[k]),
                  loc=behind((rng.uniform(-0.25, 0.2), 0, rng.uniform(0.2, 0.36)), -0.3))
        L.render_frame(OUT, "fire_grenade", i)


def a_ice_grenade():
    for i in range(4):
        setup(12, 8)
        r = L.m_ice_grenade()
        r.rotation_euler = (0, math.radians(-90 * i), 0)
        h1 = L.star("ig_h1", 0.3 if i % 2 == 0 else 0.27, 0.07, 6, L.glow("#2a78d8"), phase=math.radians(15 * i))
        billboard(h1, (0, 0, 0), 0.35)
        h2 = L.star("ig_h2", 0.23, 0.06, 6, L.glow("#a8ecff"), phase=math.pi / 6 + math.radians(15 * i))
        billboard(h2, (0, 0, 0), 0.3)
        sp = L.star("ig_glint", 0.07, 0.012, 4, L.glow("#ffffff"))
        billboard(sp, [(-0.16, 0, 0.14), (0.15, 0, 0.12), (0.1, 0, -0.15), (-0.14, 0, -0.1)][i], -0.4)
        L.render_frame(OUT, "ice_grenade", i)


def turret_scene():
    setup(30, 12)
    root, P = L.m_turret()
    L.set_turret(P, deploy=1.0, draw=0.0)
    L.ground_snap(root, lift=-(GROUND_TURRET - AY) / L.common.PX_PER_UNIT)
    return root, P


def a_turret():
    # deploy: folded bundle -> standing & loaded
    root, P = turret_scene()
    ds = [0.0, 0.22, 0.45, 0.68, 0.88, 1.0]
    for i, d in enumerate(ds):
        L.set_turret(P, deploy=d, draw=max(0.0, (d - 0.6) / 0.4), eye=1.0 if i >= 4 else 0.0)
        L.render_frame(OUT, "turret_deploy", i)
    for i in range(4):
        L.set_turret(P, deploy=1.0, draw=1.0, eye=(1.0, 0.6, 0.2, 0.6)[i], bob=(0, -0.012, -0.024, -0.012)[i])
        L.render_frame(OUT, "turret_idle", i)
    states = [dict(draw=1.0, bolt=True, recoil=0.0, eye=1.0),
              dict(draw=0.0, bolt=False, recoil=1.0, flash=True, eye=1.0),
              dict(draw=0.35, bolt=False, recoil=0.45, eye=0.6),
              dict(draw=0.85, bolt=True, recoil=0.1, eye=0.6)]
    for i, st in enumerate(states):
        L.set_turret(P, deploy=1.0, **st)
        L.render_frame(OUT, "turret_shoot", i)


def a_trap():
    setup(20, 30)
    root, P = L.m_wolf_trap()
    L.set_trap(P, 0.0)
    L.ground_snap(root, lift=-(GROUND_TRAP - AY) / L.common.PX_PER_UNIT)
    L.render_frame(OUT, "trap_open", 0)
    flash = L.star("trap_flash", 0.12, 0.03, 4, L.glow("#ffffff"))
    for i, c in enumerate([0.3, 0.78, 1.0, 1.0]):
        L.set_trap(P, c)
        flash.hide_render = i != 2
        root.location.z += (0.03 if i == 1 else 0.0)
        bpy.context.view_layer.update()
        billboard(flash, root.matrix_world @ Vector((0.0, 0, 0.36)), -0.5)
        L.render_frame(OUT, "trap_snap", i)
        root.location.z -= (0.03 if i == 1 else 0.0)


ANIMS = [
    {"name": "arrow", "fps": 1, "loop": False},
    {"name": "bomb", "fps": 12, "loop": True},
    {"name": "fire_grenade", "fps": 12, "loop": True},
    {"name": "ice_grenade", "fps": 12, "loop": True},
    {"name": "boss_debris", "fps": 1, "loop": False},
    {"name": "turret_deploy", "fps": 12, "loop": False},
    {"name": "turret_idle", "fps": 6, "loop": True},
    {"name": "turret_shoot", "fps": 14, "loop": False},
    {"name": "trap_open", "fps": 1, "loop": False},
    {"name": "trap_snap", "fps": 16, "loop": False},
    {"name": "feather", "fps": 1, "loop": False},
]


def main():
    only = L.common.script_args()
    if only:
        os.makedirs(OUT, exist_ok=True)
    else:
        L.clean_dir(OUT)
    L.new_scene(shadows=False)
    steps = [("arrow", a_arrow), ("feather", a_feather), ("boss_debris", a_boss_debris), ("bomb", a_bomb),
             ("fire_grenade", a_fire_grenade), ("ice_grenade", a_ice_grenade), ("turret", a_turret), ("trap", a_trap)]
    for name, fn in steps:
        if only and name not in only:
            continue
        fn()
    L.write_spec(OUT, W, H, (AX, AY), ANIMS, extra={
        "groundRow": {"turret_deploy": GROUND_TURRET, "turret_idle": GROUND_TURRET, "turret_shoot": GROUND_TURRET,
                      "trap_open": GROUND_TRAP, "trap_snap": GROUND_TRAP}})


main()
