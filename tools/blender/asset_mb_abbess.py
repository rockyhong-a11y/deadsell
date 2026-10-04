"""Mid-boss 1: the Executioner Abbess (mb_abbess) sprite sheet.

blender -b --factory-startup -P tools/blender/asset_mb_abbess.py [-- anim ...]
  -> build/frames/mb_abbess/<anim>_###.png + spec.json   (frame 224x176, anchor (112,164))
  then: python3 tools/pack/pack_all.py mb_abbess

A gaunt, ~3 u tall nun-executioner: black habit, white wimple, black veil, iron mask over the eyes
(glowing slits), chain rosary and a giant guillotine-blade cleaver.  Standalone: only shared helpers
from common.py / lib_boss.py are imported.  With anim names after `--` only those are re-rendered.

Animations: idle walk cleave(w7/a2/r6) spin spin_end summon hurt death.
"""
import sys
import os
import math
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import (script_args, reset_scene, add_sun, setup_sprite_camera, toon, ellipsoid, limb,  # noqa: E402
                    box, join, Rig, ease)
from lib_boss import (FX, anim_render, frames_dir, write_spec, mesh_object, bake, place,  # noqa: E402
                      attach_world, solidify, lathe, chain_links, grid_sheet, tattered, Skin,
                      chain_weights, Pose2D, resample, ROOT, RIM)
from mathutils import Vector  # noqa: E402

ID = "mb_abbess"
FW, FH, AX, AY = 224, 176, 112, 164
ONLY = script_args()
D2R = math.pi / 180.0

reset_scene()
add_sun((0.5, 0.6, -0.7), energy=3.2)
setup_sprite_camera(FW, FH, AX, AY, yaw_deg=20, pitch_deg=4)

# --------------------------------------------------------------------------
# materials


class Mats:
    pass


M = Mats()


def _t(n, b, s, l):  # noqa: E741
    return toon("ab_" + n, b, s, l, rim=RIM)


M.habit = _t("habit", "#262131", "#0e0b17", "#463f5c")
M.habit2 = _t("habit2", "#3b3350", "#17122a", "#625a84")
M.white = _t("white", "#e9e4ee", "#8d85a0", "#ffffff")
M.skin = _t("skin", "#cbb6bd", "#6c5570", "#ebdce1")
M.iron = _t("iron", "#5d6680", "#272a3c", "#a8b3cc")
M.iron_d = _t("iron_d", "#3a3e54", "#16172a", "#636c8a")
M.steel = _t("steel", "#8b97b3", "#394161", "#cfdaf0")
M.wood = _t("wood", "#5a3a30", "#241217", "#86584a")
M.blood = _t("blood", "#8a2230", "#3f0e1e", "#c03a4c")
M.bone = _t("bone", "#d9cdb4", "#7f7061", "#f7efd9")
M.bronze = _t("bronze", "#a86f38", "#4f2b2b", "#e8ac5c")
M.silver = _t("silver", "#c9d2e4", "#58607c", "#ffffff")
M.mouth = toon("ab_mouth", "#2a0a16", "#16050d", "#3d1020")
M.edge = toon("ab_edge", "#000000", emission="#f4f9ff")
M.eye = toon("ab_eye", "#000000", emission="#b8c4ff")
M.eye_hot = toon("ab_eye_hot", "#000000", emission="#ffffff")
M.smear = toon("ab_smear", "#000000", emission="#e4ebff")
M.smear2 = toon("ab_smear2", "#000000", emission="#9fb4ff")
M.dust = toon("ab_dust", "#8a7a74", "#4a3c48", "#c2b3a2")
for _v in vars(M).values():
    _v.shadow_method = "NONE"

# --------------------------------------------------------------------------
# rig + model

r = Rig("abbess")
J = r.joint
J("hips", "root", (0, 0, 1.42))
J("skirt", "hips", (0, 0, 1.72))
J("spine", "hips", (0, 0, 1.78))
J("chest", "spine", (0, 0, 2.14))
J("neck", "chest", (0.04, 0, 2.5))
J("head", "neck", (0.07, 0, 2.64))
J("mask", "head", (0.2, 0, 2.8))
for s_, y in (("n", -0.3), ("f", 0.3)):
    J("sh_" + s_, "chest", (0, y, 2.36))
    J("el_" + s_, "sh_" + s_, (0, y, 1.74))
    J("ha_" + s_, "el_" + s_, (0, y, 1.12))
for s_, y in (("n", -0.15), ("f", 0.15)):
    J("th_" + s_, "hips", (0, y, 1.42))
    J("kn_" + s_, "th_" + s_, (0, y, 0.78))
    J("an_" + s_, "kn_" + s_, (0, y, 0.12))
J("wp", "chest", (0.4, -0.38, 1.5))
J("tab", "hips", (0.34, 0, 1.72))
J("tab1", "tab", (0.4, 0, 1.15))
J("ros", "hips", (0.2, -0.5, 1.72))
J("ros1", "ros", (0.24, -0.5, 1.15))
J("vl0", "head", (-0.2, 0, 2.9))
J("vl1", "vl0", (-0.42, 0, 2.4))
J("vl2", "vl1", (-0.5, 0, 1.9))
J("bell", "ha_f", (0.0, 0.3, 1.02))

P = Pose2D(r, {"th_n": ("kn_n", "an_n", 1), "th_f": ("kn_f", "an_f", 1),
               "sh_n": ("el_n", "ha_n", -1), "sh_f": ("el_f", "ha_f", -1)})
A = lambda ob, j: attach_world(r, ob, j)  # noqa: E731


def E(name, size, mat, loc, rot=(0, 0, 0), segs=14, rings=8):
    return bake(ellipsoid(name, size, mat, loc=loc, rot=rot, segs=segs, rings=rings))


def seg(name, p0, p1, r0, r1, mat, depth=1.0, segs=10):
    d = Vector(p1) - Vector(p0)
    th = math.degrees(math.atan2(-d.x, -d.z))
    ob = limb(name, d.length, r0, r1, mat, depth_scale=depth, segs=segs)
    return place(ob, tuple(p0), rot=(0, th, 0))


def slab(name, pts, thick, mat, y=0.0):
    """Flat plate from (x, z) points, thickness along Y."""
    import bmesh
    verts = [(x, y, z) for x, z in pts]
    ob = mesh_object(name, verts, [tuple(range(len(pts)))], mat, smooth_shade=False)
    solidify(ob, thick, 0.0)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


# ---- legs (mostly hidden by the robe; boots peek out)
for s_, y in (("n", -0.15), ("f", 0.15)):
    A(seg("thigh_" + s_, (0, y, 1.42), (0, y, 0.78), 0.13, 0.1, M.habit), "th_" + s_)
    A(seg("shin_" + s_, (0, y, 0.78), (0, y, 0.14), 0.1, 0.075, M.habit), "kn_" + s_)
    A(E("boot_" + s_, (0.5, 0.2, 0.2), M.iron_d, (0.1, y, 0.1)), "an_" + s_)
    A(E("bootcap_" + s_, (0.2, 0.2, 0.15), M.iron, (0.3, y, 0.09)), "an_" + s_)

# ---- robe (rigid flared skirt) + hem trim + front scapular panels
robe = lathe("robe", [(0.2, 1.8), (0.27, 1.62), (0.35, 1.3), (0.45, 0.95), (0.55, 0.6), (0.63, 0.3)],
             M.habit, segs=22, sy=0.92)
A(robe, "skirt")
trim = lathe("robe_trim", [(0.625, 0.36), (0.645, 0.3), (0.625, 0.24)], M.blood, segs=22, sy=0.92)
solidify(trim, 0.02)
A(trim, "skirt")
fold = lathe("robe_fold", [(0.3, 1.6), (0.43, 1.0), (0.58, 0.5), (0.64, 0.32)], M.habit2, segs=22,
             a0=200, a1=310, sy=0.92)
solidify(fold, 0.02)
A(fold, "skirt")


def panel(name, x0, z0, z1, w0, w1, mat, jag=None):
    rows = []
    n = 6
    for k in range(4):
        v = k / 3
        row = []
        for c in range(n + 1):
            u = c / n * 2 - 1
            half = w0 + (w1 - w0) * v
            z = z0 + (z1 - z0) * v - ((jag[c] if jag else 0) if k == 3 else 0)
            row.append((x0 + 0.04 * v - 0.05 * u * u, u * half, z))
        rows.append(row)
    return grid_sheet(name, rows, mat, 0.03)


A(panel("tab0", 0.42, 1.8, 1.14, 0.2, 0.24, M.habit2), "tab")
A(panel("tab1", 0.47, 1.22, 0.5, 0.24, 0.27, M.habit2, jag=[0.0, 0.16, 0.04, 0.2, 0.03, 0.14, 0.0]), "tab1")
A(E("tab_cross_v", (0.04, 0.04, 0.34), M.bone, (0.5, 0, 1.45)), "tab")
A(E("tab_cross_h", (0.04, 0.2, 0.05), M.bone, (0.5, 0, 1.52)), "tab")
A(chain_links("belt_cord", [(0.0, -0.28, 1.74), (0.27, -0.2, 1.74), (0.34, 0.0, 1.74), (0.27, 0.2, 1.74),
                            (0.0, 0.28, 1.74), (-0.27, 0.2, 1.74), (-0.34, 0, 1.74), (-0.27, -0.2, 1.74)],
              M.iron_d, R=0.04, r=0.018, step=0.1, closed=True), "hips")

# ---- rosary: bone beads on a chain with a silver cross, swinging at the near hip
pts = [Vector((0.2, -0.5, 1.72)), Vector((0.23, -0.5, 1.44)), Vector((0.24, -0.5, 1.15)),
       Vector((0.25, -0.5, 0.88)), Vector((0.26, -0.5, 0.66))]
for k, (p, d) in enumerate(resample(pts[:3], 0.115)):
    A(E("bead_a%d" % k, (0.1, 0.1, 0.1) if k % 3 else (0.13, 0.13, 0.13), M.bone, tuple(p), segs=8, rings=6), "ros")
for k, (p, d) in enumerate(resample(pts[2:], 0.115)):
    A(E("bead_b%d" % k, (0.1, 0.1, 0.1) if k % 3 else (0.13, 0.13, 0.13), M.bone, tuple(p), segs=8, rings=6), "ros1")
A(E("cross_v", (0.06, 0.05, 0.4), M.silver, (0.26, -0.5, 0.45)), "ros1")
A(E("cross_h", (0.06, 0.26, 0.07), M.silver, (0.26, -0.5, 0.53)), "ros1")

# ---- torso (gaunt)
A(E("waist", (0.34, 0.4, 0.55), M.habit, (0.0, 0, 1.95)), "hips")
A(E("ribs", (0.4, 0.5, 0.6), M.habit, (0.0, 0, 2.2)), "chest")
A(E("bib", (0.18, 0.46, 0.5), M.white, (0.14, 0, 2.28)), "chest")
A(E("bib_low", (0.14, 0.34, 0.28), M.white, (0.16, 0, 2.02)), "chest")
A(E("collar", (0.46, 0.54, 0.16), M.white, (0.04, 0, 2.5), rot=(0, 6, 0)), "chest")
for s_, y in (("n", -0.3), ("f", 0.3)):
    A(E("shoulder_" + s_, (0.3, 0.3, 0.3), M.habit, (0, y, 2.34)), "sh_" + s_)
    A(seg("uarm_" + s_, (0, y, 2.34), (0, y, 1.76), 0.095, 0.085, M.habit), "sh_" + s_)
    A(E("elbow_" + s_, (0.2, 0.2, 0.2), M.habit, (0, y, 1.74)), "el_" + s_)
    A(seg("farm_" + s_, (0, y, 1.74), (0, y, 1.2), 0.08, 0.17, M.habit), "el_" + s_)
    A(E("cuff_" + s_, (0.34, 0.34, 0.08), M.habit2, (0, y, 1.2)), "el_" + s_)
    A(E("fist_" + s_, (0.15, 0.15, 0.17), M.skin, (0.01, y, 1.08)), "ha_" + s_)
    A(E("fing_" + s_, (0.12, 0.17, 0.08), M.skin, (0.08, y, 1.06)), "ha_" + s_)

# ---- head: wimple, face, iron mask with glowing slits, veil cap
A(seg("neckm", (0.05, 0, 2.44), (0.07, 0, 2.6), 0.1, 0.09, M.skin), "neck")
A(E("headm", (0.34, 0.27, 0.4), M.skin, (0.14, 0, 2.66)), "head")
A(E("chin", (0.18, 0.18, 0.2), M.skin, (0.16, 0, 2.5)), "head")
A(E("mouthin", (0.05, 0.14, 0.03), M.mouth, (0.255, 0, 2.52)), "head")
A(E("wimple", (0.46, 0.44, 0.58), M.white, (-0.05, 0, 2.7)), "head")
A(E("wimple_chin", (0.3, 0.4, 0.2), M.white, (0.0, 0, 2.5)), "head")
A(E("brow_band", (0.36, 0.34, 0.1), M.white, (0.1, 0, 2.9), rot=(0, -8, 0)), "head")
A(E("cap", (0.56, 0.5, 0.34), M.habit, (-0.05, 0, 2.9), rot=(0, 8, 0)), "head")
A(E("cap_peak", (0.24, 0.3, 0.3), M.habit, (-0.2, 0, 3.0), rot=(0, 28, 0)), "head")
A(E("mask_plate", (0.2, 0.38, 0.19), M.iron_d, (0.25, 0, 2.8)), "mask")
A(E("mask_ridge", (0.1, 0.07, 0.2), M.iron, (0.32, 0, 2.76), rot=(0, 10, 0)), "mask")
A(E("mask_strap", (0.4, 0.38, 0.06), M.iron, (0.05, 0, 2.8)), "mask")
eyes = [A(E("eye%d" % k, (0.05, 0.12, 0.04), M.eye, (0.325, y, 2.815), segs=8, rings=6), "mask")
        for k, y in enumerate((-0.09, 0.09))]
hots = [A(E("eyeh%d" % k, (0.07, 0.16, 0.06), M.eye_hot, (0.33, y, 2.815), segs=8, rings=6), "mask")
        for k, y in enumerate((-0.09, 0.09))]
socks = [A(E("sock%d" % k, (0.05, 0.1, 0.1), M.eye, (0.26, y, 2.78), segs=8, rings=6), "head")
         for k, y in enumerate((-0.09, 0.09))]

# ---- veil (skinned cloth with a ragged hem)
sk = Skin(r, "abbess_skin")
sk.bone("vl0", r.world_rest["vl1"])
sk.bone("vl1", r.world_rest["vl2"])
sk.bone("vl2", r.world_rest["vl2"] + Vector((-0.06, 0, -0.5)))
sk.build()
NC, NR = 16, 12
hem = tattered(NC, 0.34, pattern=[0.1, 0.8, 0.3, 1.0, 0.1, 0.6, 0.0, 0.9, 0.4, 0.7, 0.05, 0.95, 0.3, 0.6, 0.1, 0.85, 0.2])
rows = []
for k in range(NR + 1):
    v = k / NR
    row = []
    for c in range(NC + 1):
        u = c / NC * 2 - 1
        half = 0.26 + 0.2 * v
        xc = -0.2 - 0.34 * v ** 0.9 - 0.1 * (1 - u * u) * (0.4 + v)
        z = 2.94 - 1.5 * v - hem[c] * (v ** 8)
        row.append((xc, u * half, z))
    rows.append(row)
sk.bind(grid_sheet("veil", rows, M.habit, 0.04), chain_weights([("vl0", 2.9), ("vl1", 2.4), ("vl2", 1.9)]))

# ---- the cleaver (modelled with its grip pivot at wp, pole along +Z, blade edge toward +X)
WP0 = r.world_rest["wp"]
WY = WP0.y


def wpt(s, w, y=0.0):
    return (WP0.x + w, WY + y, WP0.z + s)


A(seg("pole", wpt(-0.22, 0), wpt(1.05, 0), 0.05, 0.05, M.wood), "wp")
A(E("pommel", (0.14, 0.14, 0.14), M.iron_d, wpt(-0.26, 0)), "wp")
for k, s in enumerate((0.15, 0.3, 0.45, 0.6, 0.75)):
    A(E("grip%d" % k, (0.1, 0.1, 0.05), M.habit2, wpt(s, 0)), "wp")
A(E("guard", (0.34, 0.12, 0.08), M.iron, wpt(1.0, 0.1)), "wp")
BLADE = [(1.02, -0.16), (1.02, 0.56), (2.06, 0.56), (2.3, -0.16)]
A(slab("blade", [(WP0.x + w, WP0.z + s) for s, w in BLADE], 0.07, M.steel, WY), "wp")
A(slab("blade_edge", [(WP0.x + w, WP0.z + s) for s, w in ((1.04, 0.5), (1.04, 0.58), (2.08, 0.58), (2.08, 0.5))],
       0.09, M.edge, WY), "wp")
A(box("blade_spine", (0.1, 0.1, 1.3), M.iron_d, loc=wpt(1.66, -0.15), bevel=0.02), "wp")
for k, (s, w) in enumerate(((1.15, -0.1), (1.6, -0.1), (2.1, -0.1), (1.15, 0.2))):
    A(E("bolt%d" % k, (0.07, 0.04, 0.07), M.iron, wpt(s, w, -0.05), segs=8, rings=6), "wp")
for k, (s, w, sz) in enumerate(((1.5, 0.3, (0.1, 0.03, 0.34)), (1.9, 0.12, (0.07, 0.03, 0.22)),
                                (1.3, 0.46, (0.07, 0.03, 0.18)))):
    A(E("stain%d" % k, sz, M.blood, wpt(s, w, -0.045), segs=8, rings=6), "wp")

# ---- hand bell (summon)
bell_prof = [(0.0, -0.04), (0.06, -0.05), (0.09, -0.1), (0.15, -0.2), (0.2, -0.32), (0.25, -0.42), (0.2, -0.44),
             (0.17, -0.41), (0.14, -0.32), (0.09, -0.2), (0.0, -0.12)]
bl = lathe("bellm", bell_prof, M.bronze, segs=14)
bl.location = (0.0, 0.3, 1.02)
BELL_OBS = [A(bake(bl), "bell"),
            A(E("bell_clap", (0.1, 0.1, 0.1), M.smear2, (0.0, 0.3, 0.6), segs=8, rings=6), "bell"),
            A(E("bell_handle", (0.06, 0.06, 0.16), M.bronze, (0.0, 0.3, 1.1), segs=8, rings=6), "bell")]

# --------------------------------------------------------------------------
# weapon helpers (pole direction for world angle a: (-sin a, cos a); edge normal (cos a, sin a))
WPTS = [(-0.26, 0.0), (1.02, -0.16), (1.02, 0.56), (2.06, 0.56), (2.3, -0.16), (2.3, 0.0)]


def wdir(a):
    return -math.sin(a * D2R), math.cos(a * D2R)


def wpoint(wp, s, w):
    a = wp[2]
    c, sn = math.cos(a * D2R), math.sin(a * D2R)
    return wp[0] - s * sn + w * c, wp[1] + s * c + w * sn


def plant_z(a):
    c, sn = math.cos(a * D2R), math.sin(a * D2R)
    return 0.04 - min(s * c + w * sn for s, w in WPTS)


def tip_x(a):
    c, sn = math.cos(a * D2R), math.sin(a * D2R)
    return max(-s * sn + w * c for s, w in WPTS)


# --------------------------------------------------------------------------
# pose resolution


def rot(a, x, z):
    c, s = math.cos(a * D2R), math.sin(a * D2R)
    return x * c - z * s, x * s + z * c


GRIP = (0.2, 0.62)


def to_local(W, parent, joint, wx, wz):
    px, pz, pa = W[parent]
    lx, lz = rot(-pa, wx - px, wz - pz)
    rx, rz = P.local_rest(joint)
    return (lx - rx, 0.0, lz - rz)


def resolve(p):
    spec, off, tw = {}, {}, {}
    wp = None
    mk = None
    hand = {}
    for k, v in p.items():
        if k.startswith("off_"):
            off[k[4:]] = v
        elif k.startswith("tw_"):
            tw[k[3:]] = v
        elif k == "wp":
            wp = v
        elif k == "mk":
            mk = v
        elif k in ("nh", "fh", "nhw", "fhw"):
            hand[k] = v
        else:
            spec[k] = v
    if wp:
        wp = (wp[0], max(wp[1], plant_z(wp[2]) - 0.01), wp[2])
    ang, W = P.solve(spec, off)
    if wp:
        off["wp"] = to_local(W, "chest", "wp", wp[0], wp[1])
        spec["wp@"] = wp[2]
    if mk:
        off["mask"] = to_local(W, "head", "mask", mk[0], mk[1])
        spec["mask@"] = mk[2]
    if wp or mk:
        dx, dz = wdir(wp[2]) if wp else (0, 0)
        for side, gi in (("n", 0), ("f", 1)):
            tgt = hand.get(side + "h", (0.0, 1.0))
            w = hand.get(side + "hw", 0.0)
            if wp:
                gx, gz = wp[0] + GRIP[gi] * dx, wp[1] + GRIP[gi] * dz
                tgt = (gx + (tgt[0] - gx) * w, gz + (tgt[1] - gz) * w)
            spec["ik_sh_" + side] = (tgt[0], tgt[1], None, -1)
        ang, W = P.solve(spec, off)
    # the robe / tabard / rosary never sink below the floor when the hips drop or tip over
    top, sa_ = W["skirt"][1], W["skirt"][2]
    k = max(0.0, min(1.0, (abs(sa_) - 20) / 30.0))
    sx, sy = 1.0 - 0.6 * k, 1.0 + 0.3 * k          # lying down: the robe spreads flat on the floor
    cs = math.cos(sa_ * D2R)
    sz = 1.0
    if cs > 0.2:
        sz = max(0.3, min(1.0, (top - 0.03 - 0.63 * sx * abs(math.sin(sa_ * D2R))) / (1.42 * cs)))
    scl = (sx, sy, sz)
    tabs = max(0.4, min(1.0, (W["tab"][1] - 0.03) / 1.52))
    rc = math.cos(W["ros"][2] * D2R)
    ros = 1.0 if rc < 0.25 else max(0.35, min(1.0, (W["ros"][1] - 0.06) / (1.35 * rc)))
    vls = 1.0
    if abs(ang.get("hips", 0.0)) > 20:
        vls = max(0.35, min(1.0, (W["vl0"][1] - 0.08) / 1.5))
    return (ang, off, {"skirt": scl, "tab": (1, 1, tabs), "ros": (1, 1, ros), "vl0": (1, 1, vls)}, tw, W,
            (wp or (0, 0, 0)))


# --------------------------------------------------------------------------
# keyframe sampling

EASES = {"s": ease, "l": lambda t: t, "i": lambda t: t * t, "o": lambda t: 1 - (1 - t) * (1 - t),
         "h": lambda t: 0.0}


def lerp(a, b, t):
    if isinstance(a, tuple) and isinstance(b, tuple) and len(a) == len(b):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    if isinstance(a, tuple) or isinstance(b, tuple):
        return b
    return a + (b - a) * t


def keyed(keys, t):
    """keys: [(time, pose[, ease])]; the ease applies to the segment ENDING at that key."""
    if t <= keys[0][0]:
        return dict(keys[0][1])
    for k0, k1 in zip(keys, keys[1:]):
        t0, p0, t1, p1 = k0[0], k0[1], k1[0], k1[1]
        if t0 <= t <= t1:
            u = EASES[k1[2] if len(k1) > 2 else "s"](0 if t1 == t0 else (t - t0) / (t1 - t0))
            out = {}
            for k in set(p0) | set(p1):
                if k in p0 and k in p1:
                    out[k] = lerp(p0[k], p1[k], u)
                else:
                    out[k] = p1[k] if k in p1 else p0[k]
            return out
    return dict(keys[-1][1])


def merge(*ds, **kw):
    out = {}
    for d in ds:
        out.update(d)
    out.update(kw)
    return out


# --------------------------------------------------------------------------
# reference poses

A_REST = -128
WPX_REST = 0.42


def rest_wp(dz=0.0, a=A_REST, px=WPX_REST):
    return (px, plant_z(a) + dz, a)


def base(**kw):
    p = {"off_hips": (0.0, 0, 0.0), "hips": -3, "spine": -7, "chest": -5, "neck": 8, "head": 6,
         "ik_th_n": (-0.2, 0.12, 0.0), "ik_th_f": (0.25, 0.12, 0.0),
         "tab@": 3, "tab1@": 0, "ros@": 0, "ros1@": 0, "vl0@": -4, "vl1@": -3, "vl2@": -2,
         "wp": rest_wp(), "nh": (0.3, 1.2), "nhw": 0.0, "fh": (0.3, 1.2), "fhw": 0.0}
    p.update(kw)
    return p


IDLE = base()

ANIMS = []


def register(name, n, fps, fn, loop=False, phases=None):
    ANIMS.append(dict(name=name, n=n, fps=fps, loop=loop, phases=phases, fn=fn))


def keyed_fn(keys, post=None, loop=False):
    def fn(i, n):
        t = (i / n) if loop else (i / (n - 1))
        p = keyed(keys, t * (n if loop else n - 1))
        if post:
            post(p, i, n)
        return resolve(p)
    return fn


def jitter(p, i, amp=0.02, ch=1.0):
    s = (-1) ** int(i)
    ox, oy, oz = p["off_hips"]
    p["off_hips"] = (ox + amp * s, oy, oz)
    p["chest"] = p.get("chest", 0.0) + ch * s


# ---- idle: slow breathing, cleaver tip resting on the floor ahead
def a_idle(i, n):
    t = i / n * 2 * math.pi
    s, c = math.sin(t), math.cos(t)
    p = base(off_hips=(0, 0, -0.03 + 0.03 * s), chest=-5 + 2.2 * s, spine=-7 + 1.0 * s, head=6 - 2.5 * s,
             neck=8 + 1.5 * s)
    p["wp"] = rest_wp(0.0, A_REST + 1.2 * s)
    p["vl0@"], p["vl1@"], p["vl2@"] = -4 + 3 * s, -3 + 4 * c, -2 + 5 * s
    p["tab@"], p["ros@"], p["ros1@"] = 3 + 2 * s, 3 * s, 4 * c
    return resolve(p)


register("idle", 8, 7, a_idle, loop=True)


# ---- walk: slow, relentless stalk; cleaver carried low
def foot_cycle(ph, S=0.78, lift=0.3):
    ph %= 1.0
    if ph < 0.6:
        u = ph / 0.6
        return (S / 2 - S * u, 0.12, 0.0)
    u = (ph - 0.6) / 0.4
    return (-S / 2 + S * ease(u), 0.12 + lift * math.sin(math.pi * u), -10 * math.sin(math.pi * u))


def a_walk(i, n):
    t = i / n
    s2 = math.sin(4 * math.pi * t)
    c1 = math.cos(2 * math.pi * t)
    fn_, ff_ = foot_cycle(t), foot_cycle(t + 0.5)
    bob = -abs(math.sin(2 * math.pi * t)) * 0.06
    p = base(off_hips=(0.05, 0, bob), hips=-5 + 2 * c1, spine=-9 + 2 * s2, chest=-6, head=7 - 2 * s2)
    p["ik_th_n"] = fn_
    p["ik_th_f"] = ff_
    p["wp"] = (0.5, 1.95 + 0.1 * s2, -116 + 4 * c1)
    sw = math.sin(2 * math.pi * t)
    p["vl0@"], p["vl1@"], p["vl2@"] = -14 + 4 * sw, -12 + 6 * sw, -8 + 7 * sw
    p["tab@"], p["tab1@"] = 6 + 8 * sw, 4 + 10 * sw
    p["ros@"], p["ros1@"] = 10 * sw, 14 * sw
    return resolve(p)


register("walk", 10, 9, a_walk, loop=True)

# ---- cleave: overhead chop (frames 0-6 windup, 7-8 active, 9-14 recover)
A_UP, A_BACK = 22, 40
WIND_A = base(off_hips=(-0.05, 0, -0.14), hips=-1, spine=-3, chest=2, neck=4, head=0,
              ik_th_n=(-0.34, 0.12, 0.0), ik_th_f=(0.34, 0.12, 0.0), wp=(0.25, 2.0, -25))
WIND_B = base(off_hips=(-0.12, 0, -0.1), hips=4, spine=8, chest=10, neck=-6, head=-8,
              ik_th_n=(-0.4, 0.12, 0.0), ik_th_f=(0.3, 0.12, 0.0), wp=(0.2, 2.55, A_UP))
WIND_C = merge(WIND_B, {"wp": (0.05, 2.7, A_BACK), "spine": 11, "chest": 14, "off_hips": (-0.16, 0, -0.06),
                        "vl0@": 18, "vl1@": 16, "vl2@": 12, "tab@": 12, "ros@": 14})
SWING = base(off_hips=(0.2, 0, -0.18), hips=-6, spine=-14, chest=-16, neck=8, head=6,
             ik_th_n=(-0.42, 0.12, 0.0), ik_th_f=(0.62, 0.12, 0.0), wp=(0.55, 2.15, -45),
             **{"vl0@": -40, "vl1@": -35, "vl2@": -24, "tab@": -16})
IMP_A = -98
HIT = base(off_hips=(0.34, 0, -0.34), hips=-10, spine=-22, chest=-20, neck=14, head=14,
           ik_th_n=(-0.5, 0.12, 0.0), ik_th_f=(0.85, 0.12, 0.0), wp=(3.02 - tip_x(IMP_A), plant_z(IMP_A), IMP_A),
           **{"vl0@": -46, "vl1@": -40, "vl2@": -30, "tab@": -22, "tab1@": -14, "ros@": -26, "ros1@": -30})
STRAIN = merge(HIT, {"off_hips": (0.3, 0, -0.3), "spine": -26, "chest": -22, "head": 18, "neck": 16})
PULL = merge(HIT, {"wp": (0.85, plant_z(-110) + 0.15, -110), "off_hips": (0.2, 0, -0.2), "spine": -16, "chest": -12,
                   "ik_th_f": (0.7, 0.12, 0.0), "head": 14})
CK = [(0, IDLE), (2, WIND_A), (4, WIND_B), (6, WIND_C, "o"), (7, SWING, "i"), (8, HIT, "i"), (9, HIT, "h"),
      (11, STRAIN), (13, PULL), (14, IDLE)]


def cleave_post(p, i, n):
    if i in (5, 6):
        jitter(p, i, 0.015, 1.5)
    if i in (10, 11):
        jitter(p, i, 0.02, 1.0)


register("cleave", 15, 12, keyed_fn(CK, cleave_post), phases=(7, 2, 6))


# ---- spin: the upper body whirls about the vertical axis with the cleaver held out flat
def a_spin(i, n, slow=0.0):
    t = i / n
    psi = 360.0 * t
    sa = math.sin(2 * math.pi * t * 2)
    p = base(off_hips=(0.05, 0, -0.14), hips=-4, spine=-14, chest=-6, neck=10, head=2,
             ik_th_n=(0.3 * sa - 0.05, 0.12 + 0.18 * max(0, -sa), 0.0),
             ik_th_f=(-0.3 * sa + 0.15, 0.12 + 0.18 * max(0, sa), 0.0))
    p["wp"] = (-0.42, 1.78, -90)
    p["tw_spine"] = psi
    p["vl0@"], p["vl1@"], p["vl2@"] = -62, -74, -80
    p["tab@"], p["tab1@"] = -40, -50
    p["ros@"], p["ros1@"] = 38, 50
    return resolve(p)


register("spin", 8, 16, a_spin, loop=True)


def a_spin_end(i, n):
    t = i / (n - 1)
    u = 1 - t
    psi = -190.0 * u * u
    wob = math.sin(t * math.pi * 3) * (1 - t)
    k = [(0, base(off_hips=(0.12, 0, -0.2), hips=-6, spine=-18, chest=-8, neck=12, head=8, wp=(-0.42, 1.78, -90))),
         (0.35, base(off_hips=(0.22, 0, -0.3), hips=-8, spine=-24, chest=-12, neck=14, head=14,
                     ik_th_n=(-0.5, 0.12, 0.0), ik_th_f=(0.6, 0.12, 0.0), wp=(0.42, 1.4, -112))),
         (0.7, base(off_hips=(0.05, 0, -0.2), hips=-4, spine=-20, chest=-14, neck=12, head=16,
                    ik_th_n=(-0.3, 0.12, 0.0), ik_th_f=(0.4, 0.12, 0.0), wp=rest_wp(0, -128, 0.5))),
         (1.0, IDLE)]
    p = keyed(k, t)
    p["tw_spine"] = psi
    p["off_hips"] = (p["off_hips"][0], 0, p["off_hips"][2] + 0.03 * wob)
    p["chest"] += 4 * wob
    p["head"] += 5 * wob
    f = 1 - t
    p["vl0@"], p["vl1@"], p["vl2@"] = -50 * f - 4, -60 * f - 3, -62 * f - 2
    p["tab@"], p["tab1@"] = -30 * f + 3, -34 * f
    p["ros@"], p["ros1@"] = 34 * f, 44 * f
    return resolve(p)


register("spin_end", 8, 10, a_spin_end)

# ---- summon: plants the cleaver, raises the hand-bell and rings it
PLANT_A = -178
PL = (0.72, 2.34, PLANT_A)
S0 = base(wp=PL, off_hips=(0.05, 0, -0.1), spine=-9, chest=-6, fh=(0.12, 1.0), fhw=1.0)
S1 = merge(S0, {"fh": (0.35, 2.55), "off_hips": (-0.02, 0, -0.06), "spine": 2, "chest": 4,
                "neck": 0, "head": -6, "bell@": 8})
S2 = merge(S0, {"fh": (0.12, 3.35), "off_hips": (-0.1, 0, -0.02), "spine": 10, "chest": 12,
                "neck": -6, "head": -12, "bell@": 20, "vl0@": 14, "vl1@": 16, "vl2@": 12, "ros@": 14})
SK = [(0, merge(IDLE, {"bell@": 0})), (2, merge(S0, {"bell@": 0})), (4, S1), (5, S2), (7, S2), (9, S1),
      (11, merge(IDLE, {"bell@": 0}))]


def summon_post(p, i, n):
    if 5 <= i <= 8:
        sg = 1 if i % 2 else -1
        p["bell@"] = 42 * sg
        p["fh"] = (p["fh"][0] + 0.06 * sg, p["fh"][1] + 0.05 * (1 - sg) / 2)
        jitter(p, i, 0.012, 1.2)


register("summon", 12, 8, keyed_fn(SK, summon_post))


# ---- hurt: head snaps back, cleaver dips
def hurt_pose(k):
    ks = [(0, dict(off_hips=(-0.2, 0, 0.0), hips=6, spine=12, chest=14, neck=-10, head=-14,
                   wp=(0.35, plant_z(-110), -110), **{"vl0@": 22, "vl1@": 20, "vl2@": 14, "tab@": 14, "ros@": 18})),
          (1, dict(off_hips=(-0.26, 0, -0.04), hips=8, spine=17, chest=18, neck=-12, head=-16,
                   wp=(0.25, plant_z(-100) + 0.2, -100), **{"vl0@": 28, "vl1@": 24, "vl2@": 16, "tab@": 18})),
          (2, dict(off_hips=(-0.12, 0, -0.04), hips=2, spine=4, chest=6, neck=-2, head=-4, wp=rest_wp(0.1))),
          (3, dict(off_hips=(-0.02, 0, -0.02), hips=-2, spine=-4, chest=-3, neck=4, head=2, wp=rest_wp(0.02)))]
    return merge(IDLE, ks[k][1])


register("hurt", 4, 14, lambda i, n: resolve(hurt_pose(i)))

# ---- death: staggers, drops the cleaver, the mask pops off, kneels, topples backward
ND = 16
D = {}
D[0] = merge(IDLE, dict(off_hips=(-0.2, 0, 0.0), hips=6, spine=14, chest=16, neck=-10, head=-16,
                        wp=(0.35, plant_z(-105), -105)))
D[2] = merge(IDLE, dict(off_hips=(-0.4, 0, -0.1), hips=8, spine=20, chest=20, neck=-14, head=-22,
                        wp=(0.55, 1.5, -88), fh=(0.0, 2.4), fhw=1.0,
                        **{"vl0@": 30, "vl1@": 28, "vl2@": 20, "tab@": 20, "ros@": 24}))
D[4] = merge(IDLE, dict(off_hips=(-0.35, 0, -0.45), hips=6, spine=16, chest=16, neck=-6, head=-18,
                        ik_th_n=(-0.7, 0.12, 0.0), ik_th_f=(0.0, 0.12, 0.0), wp=(0.9, plant_z(-96) + 0.45, -96),
                        fh=(0.1, 2.6), fhw=1.0, nh=(0.2, 2.2), nhw=1.0,
                        **{"vl0@": 18, "vl1@": 14, "vl2@": 10}))
D[7] = merge(IDLE, dict(off_hips=(-0.5, 0, -0.65), hips=2, spine=4, chest=8, neck=-8, head=-26,
                        ik_th_n=(-1.0, 0.12, 0.0), ik_th_f=(-0.3, 0.12, 0.0), wp=(0.95, plant_z(-96), -96),
                        fh=(0.3, 2.3), fhw=1.0, nh=(0.0, 1.5), nhw=1.0))
D[10] = merge(IDLE, dict(off_hips=(-0.45, 0, -0.9), hips=44, spine=10, chest=8, neck=-6, head=-10,
                         ik_th_n=(0.5, 0.12, 0.0), ik_th_f=(0.8, 0.12, 0.0), wp=(0.95, plant_z(-96), -96),
                         fh=(-0.6, 1.5), fhw=1.0, nh=(-0.4, 1.2), nhw=1.0,
                         **{"vl0@": 40, "vl1@": 50, "vl2@": 50, "tab@": 30, "tab1@": 40, "ros@": 40}))
D[12] = merge(IDLE, dict(off_hips=(-0.25, 0, -0.92), hips=84, spine=2, chest=0, neck=0, head=-4,
                         ik_th_n=(0.55, 0.14, 0.0), ik_th_f=(0.62, 0.12, 0.0), wp=(0.95, plant_z(-96), -96),
                         fh=(-1.05, 1.05), fhw=1.0, nh=(-0.85, 0.95), nhw=1.0,
                         **{"vl0@": -66, "vl1@": -74, "vl2@": -76, "tab@": 78, "tab1@": 84, "ros@": 76,
                            "ros1@": 82}))
D[15] = merge(D[12], dict(off_hips=(-0.25, 0, -0.93), head=-1,
                          **{"vl0@": -70, "vl1@": -78, "vl2@": -80, "tab@": 82, "tab1@": 86, "ros@": 80,
                             "ros1@": 86}))
D[5] = merge(D[4], dict(wp=(0.95, plant_z(-96), -96)))
DK = [(k, D[k]) for k in sorted(D)]
MASK0 = []


def death_pose(i, n):
    p = keyed(DK, float(i))
    if i >= 6:
        # the mask pops off at frame 6 and flies up/forward, then clatters on the floor
        if not MASK0:
            W = resolve(keyed(DK, 6.0))[4]
            MASK0.append((W["mask"][0], W["mask"][1]))
        x0, z0 = MASK0[0]
        tau = (i - 6) * 0.125
        z = z0 + 3.4 * tau - 7.0 * tau * tau
        p["mk"] = (x0 + 1.5 * tau, max(0.12, z), 340.0 * min(tau, 0.8))
    return resolve(p)


register("death", ND, 8, death_pose)

# --------------------------------------------------------------------------
# FX: smears, dust, rings, streaks


def ribbon(name, inner, outer, mat, y=-0.5, thick=0.06, taper=True):
    n = len(inner)
    verts, faces = [], []
    for k in range(n):
        w = (k / (n - 1)) ** 0.6 if taper else 1.0
        ix, iz = inner[k]
        ox, oz = outer[k]
        verts.append((ox + (ix - ox) * w, y, oz + (iz - oz) * w))
        verts.append((ox, y, oz))
    for k in range(n - 1):
        a = 2 * k
        faces.append((a, a + 2, a + 3, a + 1))
    ob = mesh_object(name, verts, faces, mat, smooth_shade=False)
    solidify(ob, thick)
    return ob


def make_smear(name, fn, n, i0, i1, steps=9, mat=None, s_in=2.0, s_out=2.34, w_in=0.4, w_out=0.6):
    inner, outer = [], []
    for k in range(steps + 1):
        fi = i0 + (i1 - i0) * k / steps
        pose = None
        # sample the animation at a fractional frame by resolving a blended pose
        res = fn(fi, n)
        wp = res[5]
        ix, iz = wpoint(wp, s_in, w_in)
        ox, oz = wpoint(wp, s_out, w_out)
        inner.append((ix, max(0.1, iz)))
        outer.append((ox, max(0.1, oz)))
    return ribbon(name, inner, outer, mat or M.smear, y=WY - 0.12)


def make_dust(name, x, scale=1.0, seed=0, y=-0.7):
    rnd = random.Random(seed)
    parts = []
    for k in range(7):
        dx = (k - 3) * 0.3 * scale + rnd.uniform(-0.08, 0.08)
        s = (0.34 - abs(k - 3) * 0.05) * scale
        parts.append(E(name + "_p%d" % k, (s * 1.4, 0.4, s), M.dust,
                       (x + dx, y, 0.06 + s * 0.4 + rnd.uniform(0, 0.08)), segs=8, rings=6))
    return join(parts, name)


def make_arcs(name, cx, cz, radii, a0, a1, mat=None, width=0.06, y=-0.9):
    parts = []
    for k, rr0 in enumerate(radii):
        verts, faces = [], []
        N = 9
        for j in range(N + 1):
            a = math.radians(a0 + (a1 - a0) * j / N)
            for rr in (rr0, rr0 + width * (1 + 0.5 * k)):
                verts.append((cx + rr * math.cos(a), y, cz + rr * math.sin(a)))
        for j in range(N):
            b = 2 * j
            faces.append((b, b + 2, b + 3, b + 1))
        ob = mesh_object("%s_a%d" % (name, k), verts, faces, mat or M.smear2, smooth_shade=False)
        solidify(ob, 0.04)
        parts.append(ob)
    return join(parts, name)


def make_streaks(name, seed, zs=(1.5, 2.05), y=-0.8):
    rnd = random.Random(seed)
    parts = []
    for k, z in enumerate(zs):
        L = rnd.uniform(1.0, 1.9)
        x = rnd.uniform(-0.6, 0.6)
        parts.append(E("%s_%d" % (name, k), (L, 0.04, 0.05), M.smear if k % 2 else M.smear2,
                       (x, y - 0.1 * k, z + rnd.uniform(-0.1, 0.1)), segs=8, rings=4))
    return join(parts, name)


fx = FX()
for k, ob in enumerate(hots):
    fx.add("hot%d" % k, ob, default=False)
for k, ob in enumerate(eyes):
    fx.add("eye%d" % k, ob, default=True)
for k, ob in enumerate(socks):
    fx.add("sock%d" % k, ob, default=False)
for k, ob in enumerate(BELL_OBS):
    fx.add("bellp%d" % k, ob, default=False)

BY = {a["name"]: a for a in ANIMS}


def setup_fx(name):
    a = BY[name]
    fn, n = a["fn"], a["n"]
    if name == "cleave":
        fx.add("sm_a", make_smear("sm_a", fn, n, 6.2, 7.0, steps=12))
        tx = HIT["wp"][0] + 2.6
        fx.add("dust_a", make_dust("dust_a", 2.5, 0.7, 1, y=-0.45))
        fx.add("dust_b", make_dust("dust_b", 2.4, 0.95, 2, y=-0.45))
    elif name == "spin" or name == "spin_end":
        if "st0" not in fx.obs:
            for k in range(8):
                fx.add("st%d" % k, make_streaks("st%d" % k, k + 3))
    elif name == "summon":
        for i in range(5, 10):
            fx.add("ring%d" % i, make_arcs("ring%d" % i, 0.35, 3.0, [0.45 + 0.2 * (i - 5), 0.75 + 0.2 * (i - 5)],
                                           -30, 150 if i % 2 else 100))
    elif name == "death":
        fx.add("dust_k", make_dust("dust_k", -0.2, 0.7, 5, y=0.5))
        fx.add("dust_d0", make_dust("dust_d0", -0.7, 1.0, 6, y=0.5))
        fx.add("dust_d1", make_dust("dust_d1", -0.7, 1.5, 7, y=0.5))
        fx.add("dust_w", make_dust("dust_w", 2.4, 0.7, 8, y=0.2))


def vis(name):
    def f(i, n):
        s = {"eye0", "eye1"}
        if name == "cleave":
            if i in (5, 6, 7):
                s = {"hot0", "hot1"}
            if i == 7:
                s.add("sm_a")
            if i == 8:
                s |= {"dust_a"}
            if i in (9, 10):
                s |= {"dust_b"}
            if i == 9:
                s.add("dust_a")
        elif name == "spin":
            s = {"hot0", "hot1", "st%d" % (i % 8)}
        elif name == "spin_end":
            s = {"eye0", "eye1"}
            if i < 2:
                s |= {"st%d" % i}
        elif name == "summon":
            if 3 <= i <= 9:
                s = {"hot0", "hot1"}
            if 5 <= i <= 9:
                s.add("ring%d" % i)
            if 2 <= i <= 10:
                s |= {"bellp0", "bellp1", "bellp2"}
        elif name == "hurt":
            s = {"hot0", "hot1"} if i < 2 else {"eye0", "eye1"}
        elif name == "death":
            s = {"hot0", "hot1"} if i < 3 else ({"eye0", "eye1"} if i < 6 else set())
            if 6 <= i <= 12:
                s |= {"sock0", "sock1"}
            if i == 5:
                s.add("dust_k")
            if i in (12, 13):
                s.add("dust_d0")
            if i == 13:
                s.add("dust_d1")
            if i in (4, 5):
                s.add("dust_w")
        return s
    return f


out = os.path.join(ROOT, "build", "frames", ID)
if ONLY:
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.rsplit("_", 1)[0] in ONLY:
            os.remove(os.path.join(out, f))
else:
    out = frames_dir(ID)

for a in ANIMS:
    if ONLY and a["name"] not in ONLY:
        continue
    setup_fx(a["name"])
    fn = a["fn"]
    anim_render(r, fx, a["name"], a["n"], lambda i, n, fn=fn: fn(i, n)[:4], out, vis(a["name"]))

spec_anims = []
for a in ANIMS:
    e = {"name": a["name"], "fps": a["fps"], "loop": a["loop"]}
    if a["phases"]:
        e["windup"], e["active"], e["recover"] = a["phases"]
    spec_anims.append(e)
write_spec(out, FW, FH, (AX, AY), spec_anims)
print(ID, "done")

if os.environ.get("DIAG"):
    # DIAG="cleave:8" -> print the objects reaching below the floor in that pose
    an, fi = os.environ["DIAG"].split(":")
    res = BY[an]["fn"](int(fi), BY[an]["n"])
    r.pose(res[0], res[1], res[2], res[3])
    bpy.context.view_layer.update()
    for ob in bpy.data.objects:
        if ob.type == "MESH" and not ob.hide_render and ob.parent is not None and ob.parent.type == "EMPTY":
            zs = [(ob.matrix_world @ Vector(c)).z for c in ob.bound_box]
            if min(zs) < -0.03:
                print("DIAG", ob.name, ob.parent.name, round(min(zs), 3))

if os.environ.get("DIAG"):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = bpy.data.objects["veil"].evaluated_get(dg)
    me = ev.to_mesh()
    zs = [(ev.matrix_world @ v.co).z for v in me.vertices]
    print("DIAG veil minz", round(min(zs), 3), "W vl0", res[4]["vl0"], "hips", res[0].get("hips"))
