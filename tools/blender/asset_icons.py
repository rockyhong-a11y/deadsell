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


def i_golem():
    r = L.m_golem_head()
    orient(r, 0, twist=-12)
    return [r]


# ---- CONTENT4: 14 normal weapons, 8 normal skills, 20 uniques, bell shard, stash --------------------------

def i_broadsword():
    r = L.m_broadsword()
    orient(r, 40, twist=-10)
    return [r]


def i_frantic_sword():
    r = L.m_frantic_sword()
    orient(r, 45, twist=-12)
    return [r]


def i_rapier():
    r = L.m_rapier()
    orient(r, 50, twist=-8)
    return [r]


def i_sadist_stiletto():
    r = L.m_sadist_stiletto()
    orient(r, 42, twist=-10)
    return [r]


def i_grave_shovel():
    r = L.m_grave_shovel()
    orient(r, 38, twist=-10)
    return [r]


def i_torch():
    r = L.m_torch()
    orient(r, 25, twist=-8)
    bpy.context.view_layer.update()
    top = r.matrix_world @ Vector((0, 0, 0.8))
    fl = L.flame("tc_fl", 0.62, 0.17, layers=("#a8201c", "#ff5a1e", "#ffb43a", "#fff2b0"), seed=4, sway=0.15)
    fg = L.group("tc_flg", fl, loc=top)
    h = halo("tc_h", "disc", top + Vector((0, 0, 0.22)), dist=0.3, r=0.3, col="#7a1c14")
    return [r, fg, h]


def i_leather_whip():
    r = L.m_leather_whip()
    orient(r, 18, twist=-10)
    return [r]


def i_iron_katana():
    r = L.m_iron_katana()
    orient(r, 52, twist=-8)
    return [r]


def i_multi_bow():
    r = L.m_multi_bow()
    orient(r, 45, twist=0)
    return [r]


def i_ice_bow():
    r = L.m_ice_bow()
    orient(r, 45, twist=0)
    h = halo("ib_h", "star", (0, 0, 0.0), dist=0.35, r=0.34, r_in=0.09, n=6, col="#2a78d8")
    h2 = halo("ib_h2", "star", (0, 0, 0.0), dist=0.3, r=0.26, r_in=0.07, n=6, col="#a8ecff", phase=math.pi / 6)
    return [r, h, h2]


def i_heavy_crossbow():
    r = L.m_heavy_crossbow()
    orient(r, 40, twist=-8, loc=(0, 0, -0.3))
    return [r]


def i_throwing_knives():
    ks = []
    for i, tilt in enumerate((4, 42, 80)):
        k = L.m_throwing_knife("tk%d" % i)
        orient(k, tilt, twist=-8, loc=(0.1 * (i - 1), -0.05 * i, 0.0))
        ks.append(k)
    return ks


def i_fire_staff():
    r = L.m_fire_staff()
    orient(r, 32, twist=-8)
    bpy.context.view_layer.update()
    top = r.matrix_world @ Vector((0, 0, 1.0))
    fgs = []
    for k, (ang, h, sw) in enumerate(((-40, 0.62, -0.25), (0, 0.85, 0.1), (40, 0.62, 0.3))):
        fl = L.flame("fst_fl%d" % k, h, 0.15, layers=("#a8201c", "#ff5a1e", "#ffb43a", "#fff2b0"), seed=7 + k, sway=sw)
        fg = L.group("fst_flg%d" % k, fl, loc=top + Vector((0.0, -0.02 * k, 0.0)), rot=(0, ang, 0))
        fgs.append(fg)
    h = halo("fst_h", "disc", top + Vector((0, 0, 0.12)), dist=0.3, r=0.34, col="#7a1c14")
    return [r, h] + fgs


def i_spiked_shield():
    r = L.m_spiked_shield()
    orient(r, 0, twist=-24, lean=-8)
    return [r]


def i_stun_grenade():
    r = L.m_stun_grenade()
    orient(r, 22, twist=-12, loc=(0, 0, -0.1), scale=1.25)
    h1 = halo("sg_h1", "star", (0.0, 0, 0.25), dist=0.4, r=0.52, r_in=0.15, n=8, col="#c89a20")
    h2 = halo("sg_h2", "star", (0.0, 0, 0.25), dist=0.35, r=0.36, r_in=0.1, n=8, col="#fff2a0", phase=math.pi / 8)
    return [r, h1, h2]


def i_magnet_grenade():
    r = L.m_magnet_grenade()
    orient(r, 0, twist=-14)
    return [r]


def i_cluster_grenade():
    r = L.m_cluster_grenade()
    orient(r, 0, twist=-14)
    sp = L.spark("cg_sp", 0.18, 0.3, Vector((-0.02, -0.05, 0.36)))
    for i, (x, z) in enumerate(((-0.34, 0.35), (0.38, 0.39), (-0.3, -0.18), (0.34, -0.15))):
        sp += L.spark("cg_sp%d" % i, 0.07, 0.2 * i, Vector((x, -0.08, z)))
    return [r] + sp


def i_tesla_coil():
    r = L.m_tesla_coil()
    orient(r, 0, twist=-14)
    bs = []
    for k, (p1, seed) in enumerate((((0.62, 1.1), 3), ((-0.6, 1.14), 5), ((0.1, 1.5), 9), ((0.5, 0.45), 4))):
        bs.append(L.zap("tc_z%d" % k, (0.0, 0.88), p1, "#4fe3ff", w=0.05, n=4, jitter=0.16, seed=seed, y=-0.1))
        bs.append(L.zap("tc_zc%d" % k, (0.0, 0.88), p1, "#e6fdff", w=0.02, n=4, jitter=0.16, seed=seed, y=-0.12))
    return [r] + bs


def i_flame_turret():
    r = L.m_flame_turret()
    orient(r, 0, twist=-10)
    fl = L.flame("ft_fl", 0.75, 0.2, layers=("#a8201c", "#ff5a1e", "#ffb43a", "#fff2b0"), seed=2, sway=0.1)
    fg = L.group("ft_flg", fl, loc=(0.4, -0.03, 0.1), rot=(0, 90, 0))
    return [r, fg]


def i_phaser():
    r = L.m_phaser()
    orient(r, 0, twist=-10)
    return [r]


def i_wave_of_denial():
    r = L.m_wave_of_denial()
    orient(r, 0, twist=-10)
    return [r]


def i_tornado():
    r = L.m_tornado()
    orient(r, 0, twist=-10)
    return [r]


def i_grave_bell():
    r = L.m_grave_bell()
    orient(r, 22, twist=-8)
    return [r]


def i_leech_whip():
    r = L.m_leech_whip()
    orient(r, 20, twist=-8)
    return [r]


def i_bone_rampart():
    r = L.m_bone_rampart()
    orient(r, 0, twist=-14, lean=-6)
    return [r]


def i_plague_censer():
    r = L.m_plague_censer()
    orient(r, 0, twist=-10)
    return [r]


def i_bone_turret():
    r = L.m_bone_turret()
    orient(r, 0, twist=0)
    return [r]


def i_executioner_blade():
    r = L.m_executioner_blade()
    orient(r, 40, twist=-10)
    return [r]


def i_storm_staff():
    r = L.m_storm_staff()
    orient(r, 30, twist=-8)
    bpy.context.view_layer.update()
    top = r.matrix_world @ Vector((0, 0, 1.0))
    bs = []
    for k, (dx, dz, seed) in enumerate(((0.5, 0.3, 3), (-0.45, 0.4, 5), (0.15, 0.62, 9), (0.4, -0.2, 4))):
        a, b = (top.x, top.z), (top.x + dx, top.z + dz)
        bs.append(L.zap("ss_z%d" % k, a, b, "#4fe3ff", w=0.05, n=4, jitter=0.16, seed=seed, y=-0.1))
        bs.append(L.zap("ss_zc%d" % k, a, b, "#e6fdff", w=0.02, n=4, jitter=0.16, seed=seed, y=-0.12))
    return [r] + bs


def i_moon_glaives():
    a = L.m_moon_glaive("mga", 1.0)
    b = L.m_moon_glaive("mgb", 1.0)
    orient(a, 28, twist=-6, loc=(-0.2, 0, -0.1))
    orient(b, -12, twist=6, loc=(0.22, -0.08, 0.14), scale=0.9)
    return [a, b]


def i_death_orb():
    r = L.m_death_orb()
    orient(r, 0, twist=-8)
    h = halo("do_h", "disc", (0, 0, 0.0), dist=0.35, r=0.5, col="#0f4a78")
    return [r, h]


def i_chain_prison():
    r = L.m_chain_prison()
    orient(r, 0, twist=-12)
    return [r]


def i_matron_flail():
    r = L.m_matron_flail()
    orient(r, 32, twist=-8)
    return [r]


def i_soulfire_bow():
    r, tu, td = L.m_soulfire_bow()
    orient(r, 45, twist=0)
    bpy.context.view_layer.update()
    mw = r.matrix_world
    objs = [r]
    cy = ("#1a6aa8", "#2fb4e8", "#8af0ff", "#e6fdff")
    for k, tip in enumerate((tu, td)):
        w = mw @ tip
        fl = L.flame("sf_tip%d" % k, 0.6, 0.16, layers=cy, seed=3 + k, sway=0.2 - 0.4 * k)
        objs.append(L.group("sf_tipg%d" % k, fl, loc=w + Vector((0, 0, 0.02))))
    fwd = mw.to_3x3() @ Vector((1, 0, 0))
    for k, off in enumerate((0.0, 0.22)):
        c = mw @ Vector((0.62 + off, 0, 0.0)) + Vector((0.0, -0.05 * k, 0.17 * (1 - 2 * k)))
        fl = L.flame("sf_wisp%d" % k, 0.34, 0.1, layers=cy, seed=8 + k, sway=0.3)
        objs.append(L.group("sf_wispg%d" % k, fl, loc=c))
    return objs


def i_bell_aegis():
    r = L.m_bell_aegis()
    orient(r, 0, twist=-24, lean=-8)
    return [r]


def i_rag_doll():
    r = L.m_rag_doll()
    orient(r, 0, twist=-14)
    return [r]


def i_crimson_rain():
    r = L.m_crimson_rain()
    orient(r, 0, twist=-10)
    return [r]


def i_selma_shears():
    r = L.m_selma_shears()
    orient(r, 36, twist=-8)
    return [r]


def i_ember_blade():
    r = L.m_ember_blade()
    orient(r, 42, twist=-10)
    bpy.context.view_layer.update()
    mw = r.matrix_world
    sp = []
    for k, (z, x) in enumerate(((0.35, -0.2), (0.62, 0.2), (0.88, -0.17))):
        sp += L.spark("eb_sp%d" % k, 0.08, 0.2 * k, mw @ Vector((x, -0.05, z)), cols=("#4fe3ff", "#e6fdff"))
    return [r] + sp


def i_ninefold_whip():
    r = L.m_ninefold_whip()
    orient(r, 12, twist=-6)
    return [r]


def i_last_bell():
    r = L.m_last_bell()
    orient(r, 0, twist=-12)
    return [r]


def i_requiem():
    r = L.m_requiem()
    orient(r, 10, twist=-14)
    return [r]


def i_bell_shard():
    r = L.m_bell_shard()
    orient(r, 14, twist=-20, lean=-10)
    return [r]


def i_stash():
    root, P = L.m_stash()
    orient(root, 0, twist=0)
    return [root]


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
    ("golem", i_golem, 10, 8),
    # CONTENT4: normal weapons
    ("broadsword", i_broadsword, 15, 10),
    ("frantic_sword", i_frantic_sword, 15, 10),
    ("rapier", i_rapier, 15, 10),
    ("sadist_stiletto", i_sadist_stiletto, 15, 10),
    ("grave_shovel", i_grave_shovel, 15, 10),
    ("torch", i_torch, 15, 10),
    ("leather_whip", i_leather_whip, 15, 10),
    ("iron_katana", i_iron_katana, 15, 10),
    ("multi_bow", i_multi_bow, 20, 10),
    ("ice_bow", i_ice_bow, 20, 10),
    ("heavy_crossbow", i_heavy_crossbow, 15, 10),
    ("throwing_knives", i_throwing_knives, 10, 10),
    ("fire_staff", i_fire_staff, 15, 10),
    ("spiked_shield", i_spiked_shield, 15, 10),
    # CONTENT4: normal skills
    ("stun_grenade", i_stun_grenade, 15, 12),
    ("magnet_grenade", i_magnet_grenade, 15, 10),
    ("cluster_grenade", i_cluster_grenade, 15, 12),
    ("tesla_coil", i_tesla_coil, 15, 10),
    ("flame_turret", i_flame_turret, 35, 14),
    ("phaser", i_phaser, 15, 10),
    ("wave_of_denial", i_wave_of_denial, 15, 10),
    ("tornado", i_tornado, 15, 22),
    # CONTENT4: uniques, grade A and S (weapons, then skills)
    ("grave_bell", i_grave_bell, 15, 10),
    ("leech_whip", i_leech_whip, 15, 10),
    ("bone_rampart", i_bone_rampart, 15, 10),
    ("plague_censer", i_plague_censer, 15, 10),
    ("bone_turret", i_bone_turret, 35, 14),
    ("executioner_blade", i_executioner_blade, 15, 10),
    ("storm_staff", i_storm_staff, 15, 10),
    ("moon_glaives", i_moon_glaives, 10, 10),
    ("death_orb", i_death_orb, 15, 10),
    ("chain_prison", i_chain_prison, 15, 10),
    # CONTENT4: uniques, grade SS and SSS (weapons, then skills), bell shard
    ("matron_flail", i_matron_flail, 15, 10),
    ("soulfire_bow", i_soulfire_bow, 20, 10),
    ("bell_aegis", i_bell_aegis, 15, 10),
    ("rag_doll", i_rag_doll, 15, 10),
    ("crimson_rain", i_crimson_rain, 15, 10),
    ("selma_shears", i_selma_shears, 15, 10),
    ("ember_blade", i_ember_blade, 15, 10),
    ("ninefold_whip", i_ninefold_whip, 15, 10),
    ("last_bell", i_last_bell, 15, 10),
    ("requiem", i_requiem, 15, 10),
    ("bell_shard", i_bell_shard, 15, 10),
    # CONTENT4: codex icon of the stash (same model as the stash prop sheet)
    ("stash", i_stash, 20, 8),
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
