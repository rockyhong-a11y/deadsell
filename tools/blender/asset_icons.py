"""Item icons sheet: 32x32 frames, anchor (16,16), one 1-frame animation per item id.

blender -b --factory-startup -P tools/blender/asset_icons.py
Writes build/frames/icons/<id>_000.png + spec.json.

Every icon is the 3D item model (same builders as the in-world items, lib_objects.py)
rendered at a dramatic diagonal angle and auto-framed to fill the cell with a 1 px
margin for the outline.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Matrix, Vector  # noqa: E402
from lib_objects import *  # noqa: E402,F401,F403
import lib_objects as L  # noqa: E402

OUT = os.path.join(L.FRAMES, "icons")
W = H = 32


def orient(root, tilt=45.0, twist=0.0, lean=0.0, loc=(0, 0, 0), scale=1.0):
    """tilt: clockwise screen-plane rotation of the +Z weapon axis (45 = blade to upper-right)."""
    root.matrix_world = (Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(tilt), 4, "Y") @
                         Matrix.Rotation(math.radians(twist), 4, "Z") @ Matrix.Rotation(math.radians(lean), 4, "X") @
                         Matrix.Scale(scale, 4))


def behind(center, dist):
    _, _, fwd = L.cam_basis()
    return Vector(center) + fwd * dist


def halo(name, shape, center, dist=0.35, **kw):
    """Camera-facing glow shape placed `dist` behind center.  shape: 'disc' or 'star'."""
    if shape == "disc":
        ob = L.disc(name, kw["r"], L.glow(kw["col"]), segs=kw.get("segs", 24))
    else:
        ob = L.star(name, kw["r"], kw["r_in"], kw["n"], L.glow(kw["col"]), phase=kw.get("phase", 0.0))
    L.face_camera(ob)
    ob.location = behind(center, dist)
    return ob


# --------------------------------------------------------------------------
# Icon builders: each returns a list of root objects to frame


def i_rusty_sword():
    r = L.m_rusty_sword()
    orient(r, 45, twist=-12)
    return [r]


def i_blood_sword():
    r = L.m_blood_sword(aura=True)
    orient(r, 45, twist=-12)
    return [r]


def i_spear():
    r = L.m_spear(length=0.78, shaft_r=0.042)
    orient(r, 45, twist=-10)
    return [r]


def i_twin_daggers():
    a = L.m_dagger("da")
    b = L.m_dagger("db")
    orient(a, 40, twist=-10, loc=(0, -0.04, 0))
    orient(b, -40, twist=10, loc=(0, 0.06, 0))
    # cross the blades a little above the guards
    for ob, s in ((a, 1), (b, -1)):
        ob.matrix_world = Matrix.Translation(Vector((-s * 0.0, 0, 0))) @ ob.matrix_world
    bpy.context.view_layer.update()
    for ob in (a, b):
        d = ob.matrix_world.to_3x3() @ Vector((0, 0, 1))
        ob.location = ob.location - d * 0.12
    return [a, b]


def i_war_hammer():
    r = L.m_war_hammer(haft=0.95)
    orient(r, 45, twist=28)
    return [r]


def i_hunter_bow():
    r = L.m_hunter_bow(string_r=0.02, curve=1.25, thick=1.15)
    orient(r, 45, twist=0)
    # a nocked arrow makes the silhouette read as "bow" instantly
    ar = L.m_arrow(length=1.0)
    orient(ar, 45 - 90, loc=(0, -0.05, 0))
    bpy.context.view_layer.update()
    return [r, ar]


def i_old_shield():
    r = L.m_old_shield()
    orient(r, 0, twist=-28, lean=-8)
    return [r]


def i_fire_grenade():
    r = L.m_fire_grenade()
    orient(r, 15, loc=(0, 0, -0.04))
    back = L.flame("fg_back", 0.5, 0.22, layers=("#a8201c", "#ff5a1e"), seed=5, sway=0.15)
    bg = L.group("fg_backg", back)
    bg.location = behind((0, 0, -0.17), 0.3)
    f = L.flame("fg_flame", 0.17, 0.05, seed=3, sway=-0.3, loc=(0.0, -0.02, 0.0))
    fg = L.group("fg_flameg", f)
    orient(fg, 15, loc=(0.06, -0.05, 0.16))
    return [r, fg, bg]


def i_ice_grenade():
    r = L.m_ice_grenade()
    orient(r, -15)
    h1 = halo("ig_h1", "star", (0, 0, 0.0), r=0.3, r_in=0.08, n=6, col="#2a78d8")
    h2 = halo("ig_h2", "star", (0, 0, 0.0), dist=0.3, r=0.24, r_in=0.06, n=6, col="#a8ecff", phase=math.pi / 6)
    return [r, h1, h2]


def i_turret():
    root, P = L.m_turret()
    L.set_turret(P, deploy=1.0, draw=1.0)
    return [root]


def i_wolf_trap():
    root, P = L.m_wolf_trap()
    L.set_trap(P, 0.55)
    return [root]


def i_cells():
    objs = []
    for i, (x, z, r) in enumerate([(-0.11, -0.07, 0.1), (0.12, -0.05, 0.08), (0.01, 0.12, 0.075)]):
        c = L.m_cell(r)
        c.location = (x, -0.05 * i, z)
        objs.append(c)
        objs.append(halo("ce_h%d" % i, "disc", (x, -0.05 * i, z), dist=0.25, r=r * 1.4, col="#1666c8"))
    objs.append(halo("ce_sp", "star", (-0.2, 0, 0.1), dist=-0.4, r=0.07, r_in=0.012, n=4, col="#e6fdff"))
    return objs


def i_gold():
    import random
    rng = random.Random(7)
    objs = []
    # heap of flat coins (cone-shaped pile)
    k = 0
    for layer, (n, rad) in enumerate([(9, 0.3), (6, 0.2), (3, 0.1), (1, 0.0)]):
        for j in range(n):
            a = 2 * math.pi * j / max(1, n) + layer
            c = L.m_coin(0.11, 0.035, "gp%d" % k)
            c.rotation_euler = (math.radians(90 + rng.uniform(-18, 18)), math.radians(rng.uniform(-15, 15)),
                                math.radians(rng.uniform(0, 90)))
            c.location = (rad * math.cos(a), rad * math.sin(a) * 0.7, 0.03 + layer * 0.045)
            objs.append(c)
            k += 1
    # two coins standing in front, showing their faces
    c = L.m_coin(0.13, 0.04, "gstand")
    c.rotation_euler = (math.radians(-8), 0, math.radians(-15))
    c.location = (0.16, -0.22, 0.12)
    objs.append(c)
    c = L.m_coin(0.12, 0.04, "gstand2")
    c.rotation_euler = (math.radians(20), math.radians(-25), math.radians(20))
    c.location = (-0.17, -0.18, 0.1)
    objs.append(c)
    return objs


def i_flask():
    r = L.m_flask()
    orient(r, 12)
    return [r]


def i_scroll():
    r, ring, core = L.m_scroll("gold", length=0.42, r=0.08)
    orient(r, -35)
    h = halo("sc_h", "star", (0, 0, 0), r=0.36, r_in=0.06, n=8, col="#d8a030")
    h2 = halo("sc_h2", "disc", (0, 0, 0), dist=0.3, r=0.2, col="#8a5a18")
    return [r, h, h2]


# ---- corpse market (CONTENT3): the ten shop uniques + the currency icon ----------------------------------

def i_bone_cleaver():
    r = L.m_bone_cleaver()
    orient(r, 40, twist=-14)
    return [r]


def i_reaper_scythe():
    r = L.m_reaper_scythe()
    orient(r, 38, twist=-8)
    return [r]


def i_stitch_needle():
    r = L.m_stitch_needle()
    orient(r, 45, twist=-10)
    return [r]


def i_widow_fangs():
    a = L.m_widow_fang("wa")
    b = L.m_widow_fang("wb", mirror=True)
    orient(a, -44, twist=-6, loc=(-0.04, -0.04, 0))
    orient(b, 44, twist=6, loc=(0.04, 0.06, 0))
    return [a, b]


def i_coffin_lid():
    r = L.m_coffin_lid()
    orient(r, 0, twist=-26, lean=-8)
    return [r]


def i_marrow_bow():
    r = L.m_marrow_bow(thick=1.5)
    orient(r, 45, twist=0)
    ar = L.m_arrow(length=1.0, fletch="bone_w")
    orient(ar, 45 - 90, loc=(0, -0.05, 0))
    bpy.context.view_layer.update()
    return [r, ar]


def i_corpse_bomb():
    r, tip = L.m_corpse_bomb()
    orient(r, 0, twist=-10)
    sp = L.spark("cb_sp", 0.2, 0.3, tip + Vector((0, -0.05, 0.03)))
    fl = L.flame("cb_fl", 0.2, 0.065, layers=("#a8201c", "#ff5a1e", "#ffd04a"), seed=2, sway=-0.2,
                 loc=tip + Vector((-0.01, -0.03, -0.01)))
    return [r] + sp + fl


def i_bone_spikes():
    r = L.m_bone_spikes()
    orient(r, 0, twist=-18)
    return [r]


def i_soul_lantern():
    r = L.m_soul_lantern()
    orient(r, 0, twist=-20)
    fl = L.flame("sl_fl", 0.2, 0.07, layers=("#1a6aa8", "#2fb4e8", "#8af0ff", "#e6fdff"), seed=6, sway=0.1,
                 loc=(0.0, -0.1, 0.12))
    h = halo("sl_h", "disc", (0, 0, 0.26), dist=0.3, r=0.26, col="#1666c8")
    return [r, h] + fl


def i_chain_hook():
    r = L.m_chain_hook()
    orient(r, 0, twist=-24)
    return [r]


def i_corpse_piece():
    r = L.m_corpse_piece(1.0)
    orient(r, 24, twist=-24, lean=-16)
    return [r]


ICONS = [
    # id, builder, yaw, pitch
    ("rusty_sword", i_rusty_sword, 15, 10),
    ("blood_sword", i_blood_sword, 15, 10),
    ("spear", i_spear, 15, 10),
    ("twin_daggers", i_twin_daggers, 10, 10),
    ("war_hammer", i_war_hammer, 15, 12),
    ("hunter_bow", i_hunter_bow, 20, 10),
    ("old_shield", i_old_shield, 15, 10),
    ("fire_grenade", i_fire_grenade, 15, 12),
    ("ice_grenade", i_ice_grenade, 15, 12),
    ("turret", i_turret, 50, 22),
    ("wolf_trap", i_wolf_trap, 22, 38),
    ("cells", i_cells, 15, 10),
    ("gold", i_gold, 15, 25),
    ("flask", i_flask, 15, 10),
    ("scroll", i_scroll, 15, 10),
    # CONTENT3: corpse-shop uniques, currency
    ("bone_cleaver", i_bone_cleaver, 15, 10),
    ("reaper_scythe", i_reaper_scythe, 15, 10),
    ("stitch_needle", i_stitch_needle, 15, 10),
    ("widow_fangs", i_widow_fangs, 10, 10),
    ("coffin_lid", i_coffin_lid, 15, 10),
    ("marrow_bow", i_marrow_bow, 20, 10),
    ("corpse_bomb", i_corpse_bomb, 15, 12),
    ("bone_spikes", i_bone_spikes, 15, 18),
    ("soul_lantern", i_soul_lantern, 15, 10),
    ("chain_hook", i_chain_hook, 15, 10),
    ("corpse_piece", i_corpse_piece, 15, 22),
]


def main():
    only = L.common.script_args()
    L.clean_dir(OUT) if not only else os.makedirs(OUT, exist_ok=True)
    L.new_scene(shadows=False)
    for name, fn, yaw, pitch in ICONS:
        if only and name not in only:
            continue
        L.clear_objects(cameras=True)
        L.camera(W, H, W // 2, H // 2, yaw=yaw, pitch=pitch)
        roots = fn()
        L.fit_camera(roots, W, H, margin=1.0)
        L.render_frame(OUT, name, 0)
    L.write_spec(OUT, W, H, (16, 16), [{"name": n, "fps": 1, "loop": False} for n, *_ in ICONS])


main()
