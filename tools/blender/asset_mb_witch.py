"""DEADSELL mid-boss: moon witch (달의 마녀) -- floating woman (no legs, long flowing violet gown that
tapers into a tattered tail), big pointed hat, long silver hair, crescent-moon staff and three glowing
orb familiars.  Ramparts mid-boss.

blender -b --factory-startup -P tools/blender/asset_mb_witch.py [-- anim ...]
-> build/frames/mb_witch/<anim>_###.png + spec.json   (frame 224x176, anchor (112,164))
   pack: python3 tools/pack/pack_all.py mb_witch

Animations: idle(loop) float(loop) orb(w/a/r) blink shards(w/a/r) hurt death
With anim names after `--` only those animations are re-rendered (iteration); the spec always
lists every animation.

Rig notes
  * She hovers: the lowest point of the gown is kept at a small height above the anchor row
    (HOVER + bob); in death she drops onto the floor (hem/body on the anchor row).
  * The staff is a rigid prop on the near hand ("st" joint).  Its WORLD angle "_st" (180 = crescent
    straight up, 90 = pointing forward) and, when "_two" > 0, a shoulder-relative two-handed grip
    target ("_nx", "_nz") are set per pose.
  * Orbs (ob0..2), moon shards (mk0..3), sparkles (sp0..5) are glow props moved with joint offsets.
  * blink: frames 0-3 she collapses into a light streak and vanishes, 4-7 only sparkles + orbs remain
    (the game may move the sprite here), 8-11 she re-forms.
"""
import math
import os
import sys

import bmesh  # noqa: F401
import bpy  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

L.FRAME_W, L.FRAME_H, L.ANCHOR = 224, 176, (112, 164)
ONLY = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

S = 1.4
RIG = None
HOVER = 0.12
ARM_N = ("root", "hips", "spine", "chest", "sh_n", "el_n", "ha_n")
CHEST_CHAIN = ("root", "hips", "spine", "chest")
HIPS_CHAIN = ("root", "hips")
STAFF_TOP = 1.3               # grip -> middle of the crescent


class Sheet(L.Sheet):
    """Sheet that can re-render only some animations (the spec still lists all of them)."""

    def __init__(self, name, rig):
        if ONLY:
            self.name, self.rig = name, rig
            self.dir = os.path.join(L.ROOT, "build", "frames", name)
            os.makedirs(self.dir, exist_ok=True)
            self.anims, self.props = [], {}
        else:
            L.Sheet.__init__(self, name, rig)

    def render(self, name, frames, pose_fn, fps=12, loop=False, wa=None, **kw):
        if ONLY and name not in ONLY:
            entry = {"name": name, "fps": fps, "loop": loop}
            if wa:
                assert sum(wa) == frames, (name, wa, frames)
                entry.update({"windup": wa[0], "active": wa[1], "recover": wa[2]})
            self.anims.append(entry)
            return
        for f in os.listdir(self.dir):
            if f.startswith(name + "_") and f[len(name) + 1:-4].isdigit():
                os.remove(os.path.join(self.dir, f))
        L.Sheet.render(self, name, frames, pose_fn, fps=fps, loop=loop, wa=wa, **kw)


# --------------------------------------------------------------------------
# geometry


def hat_parts(M, tag):
    """Big witch hat in joint space: brim at z=0, cone up.  -> (base objects, tip objects)"""
    base = [ellipsoid(tag + "brim", (1.3, 1.24, 0.08), M["hat"], loc=(0.04, 0, 0.0), segs=24, rings=6),
            ellipsoid(tag + "brim_t", (1.24, 1.18, 0.03), M["hat2"], loc=(0.04, 0, 0.035), segs=24, rings=4),
            cone(tag + "cone", 0.36, 0.12, 0.55, M["hat"], loc=(0.0, 0, 0.02), segs=16),
            L.disc(tag + "band", 0.345, 0.08, M["gold"], loc=(0, 0, 0.11), segs=18)]
    # crescent buckle on the front of the band
    pts = L.arc_pts((0.34, 0.0, 0.11), 0.08, 100, 340, 9)
    base.append(L.tube(tag + "buckle", [(p[0], p[1], p[2]) for p in pts], [0.006, 0.02, 0.026, 0.026, 0.024, 0.02, 0.014, 0.008, 0.004], M["gold"], segs=5))
    tip = [cone(tag + "tip", 0.125, 0.0, 0.52, M["hat"], loc=(0.0, 0, 0.0), segs=12),
           ellipsoid(tag + "tipball", (0.08, 0.08, 0.08), M["gold"], loc=(0, 0, 0.5), segs=8, rings=5)]
    return L.joined(tag + "base", base), L.joined(tag + "tipm", tip)


def sparkle(name, size, mat_):
    a = ellipsoid(name + "a", (size * 0.22, size * 0.22, size), mat_, segs=6, rings=4)
    b = ellipsoid(name + "b", (size, size * 0.22, size * 0.22), mat_, segs=6, rings=4)
    return L.joined(name, [a, b])


def shard(name, size, mat_):
    """small floating moon-crystal: a thin crescent."""
    pts = L.arc_pts((0, 0, 0), size, 40, 320, 10)
    return L.tube(name, pts, [0.004, 0.02, 0.04, 0.05, 0.05, 0.05, 0.05, 0.04, 0.02, 0.004], mat_, segs=5)


def build():
    global RIG
    L.setup_scene()
    M = {
        "skin": L.mat("w_skin", "#f4dccf", "#a4788a", "#fff2e8"),
        "dress": L.mat("w_dress", "#4c3a9a", "#1e1558", "#7e66d6"),
        "dress2": L.mat("w_dress2", "#33266e", "#150f3e", "#5a48a8"),
        "lining": L.mat("w_lining", "#a066cc", "#58328e", "#cc9cf0"),
        "silver": L.mat("w_silver", "#dce4f6", "#6e7aa2", "#ffffff"),
        "gold": L.mat("w_gold", "#eac45a", "#84582a", "#fff4aa"),
        "hat": L.mat("w_hat", "#32277a", "#150f40", "#5e4eb8"),
        "hat2": L.mat("w_hat2", "#4a3c9a", "#1c1458", "#7a68d4"),
        "hair": L.mat("w_hair", "#e8eefc", "#8a96c0", "#ffffff"),
        "wood": L.mat("w_wood", "#52365c", "#26182c", "#80608a"),
        "eye": L.glow("w_eye", "#d8b8ff"),
        "orb": L.glow("w_orb", "#a284ff"),
        "core": L.glow("w_core", "#f0fcff"),
        "cglow": L.glow("w_cglow", "#9fe8ff"),
        "shard": L.glow("w_shard", "#b4f2ff"),
        "spark": L.glow("w_spark", "#f4eeff"),
        "flash": L.glow("w_flash", "#d8ccff"),
    }
    r = L.ERig("witch")
    RIG = r
    L.skeleton(r, s=S, w=0.92, legs=False, sh_w=0.12)
    J, A = r.joint, r.attach
    ha = r.world_rest["ha_n"]
    J("st", "ha_n", (ha.x, ha.y, ha.z))
    hz = 1.52 * S
    J("ht", "head", (0.0, 0, hz + 0.2 * S))
    J("ht1", "ht", (0.0, 0, hz + 0.2 * S + 0.55))
    J("hr0", "head", (-0.1 * S, 0, hz + 0.12 * S))
    J("hr1", "hr0", (-0.1 * S, 0, hz + 0.12 * S - 0.5))
    J("hr2", "hr1", (-0.1 * S, 0, hz + 0.12 * S - 1.0))
    J("sk0", "hips", (0, 0, 0.935 * S))
    J("sk1", "sk0", (0, 0, 0.935 * S - 0.42))
    J("sk2", "sk1", (0, 0, 0.935 * S - 0.82))
    J("as0", "hips", (-0.12, 0, 0.935 * S))
    J("as1", "as0", (-0.12, 0, 0.935 * S - 0.5))
    J("sc0", "chest", (-0.04 * S, 0, 1.42 * S))
    J("sc1", "sc0", (-0.04 * S, 0, 1.42 * S - 0.4))
    J("hatfx", "root", (0, 0, 0))
    for k in range(3):
        J("ob%d" % k, "root", (0, 0, 0))
    for k in range(4):
        J("mk%d" % k, "root", (0, 0, 0))
    for k in range(6):
        J("sp%d" % k, "root", (0, 0, 0))
    J("flash", "root", (0, 0, 0))

    L.body(r, {"skin": M["skin"], "chest": M["dress2"], "waist": M["dress"], "pelvis": M["dress"],
               "bust": M["dress2"], "ua": M["dress"], "fa": M["dress"], "hand": M["skin"]},
           s=S, w=0.92, bust=1.05, hip=0.92, legs=False, feet=False, arm_r=0.9)
    # gown: three stacked frusta that sway independently (tattered tail), silver hems
    A(L.skirt("sk0m", 0.18, 0.32, 0.44, M["dress"], n=20, bulge=0.02, depth=0.85), "sk0")
    A(L.skirt("sk1m", 0.32, 0.42, 0.42, M["dress"], n=20, depth=0.85, cap_top=False), "sk1")
    A(L.skirt("sk2m", 0.42, 0.5, 0.5, M["dress"], n=20, depth=0.8, jag=0.13, seed=3, back=1.3, front=0.88,
              cap_top=False), "sk2")
    A(L.skirt("sk2l", 0.4, 0.49, 0.56, M["lining"], n=20, depth=0.76, jag=0.1, seed=7, back=1.28, front=0.9,
              cap_top=False), "sk2", (0.0, 0, -0.04))
    # sash trailing from the waist, scarf trailing from the neck
    A(L.tube("as0m", [(0, 0, 0), (-0.04, 0, -0.25), (-0.06, 0, -0.5)], [0.06, 0.07, 0.05], M["lining"], depth=0.35), "as0")
    A(L.tube("as1m", [(0, 0, 0), (-0.02, 0, -0.25), (0.0, 0, -0.55)], [0.05, 0.05, 0.004], M["lining"], depth=0.35), "as1")
    A(L.tube("sc0m", [(0, 0, 0), (-0.02, 0, -0.2), (-0.04, 0, -0.4)], [0.05, 0.055, 0.045], M["silver"], depth=0.4), "sc0")
    A(L.tube("sc1m", [(0, 0, 0), (-0.01, 0, -0.2), (0.0, 0, -0.45)], [0.045, 0.04, 0.004], M["silver"], depth=0.4), "sc1")
    A(ellipsoid("belt", (0.2 * S, 0.24 * S, 0.06 * S), M["silver"]), "hips", (0.0, 0, 0.1 * S))
    # shoulder mantle + moon brooch + bell cuffs
    for sd in ("n", "f"):
        A(ellipsoid("mantle_" + sd, (0.2 * S, 0.17 * S, 0.12 * S), M["dress2"]), "sh_" + sd, (0.0, 0, 0.02 * S))
        A(ellipsoid("mantle_t" + sd, (0.21 * S, 0.18 * S, 0.03 * S), M["silver"]), "sh_" + sd, (0.0, 0, 0.06 * S))
        A(cone("cuff_" + sd, 0.115, 0.05, 0.22, M["dress2"], segs=12), "el_" + sd, (0, 0, -0.235 * S))
        A(L.disc("cuff_t" + sd, 0.115, 0.035, M["silver"], segs=14), "el_" + sd, (0, 0, -0.235 * S))
    pts = L.arc_pts((0.15 * S, 0, 0.06 * S), 0.07, 110, 330, 9)
    A(L.tube("brooch", pts, [0.006, 0.02, 0.028, 0.03, 0.03, 0.028, 0.02, 0.012, 0.004], M["gold"], segs=5), "chest")
    A(ellipsoid("collar", (0.2 * S, 0.25 * S, 0.07 * S), M["silver"]), "chest", (0.01 * S, 0, 0.2 * S))
    # hair: cap, bangs, long silver mane streaming down the back, face-framing locks
    A(ellipsoid("hair_cap", (0.26 * S, 0.25 * S, 0.2 * S), M["hair"]), "head", (-0.025 * S, 0, 0.14 * S))
    A(ellipsoid("bangs", (0.1 * S, 0.22 * S, 0.07 * S), M["hair"]), "head", (0.075 * S, 0, 0.2 * S))
    A(L.tube("hr0m", [(0, 0, 0), (-0.03, 0, -0.25), (-0.04, 0, -0.5)], [0.12, 0.13, 0.115], M["hair"], depth=0.75), "hr0")
    A(L.tube("hr1m", [(0, 0, 0), (-0.02, 0, -0.25), (-0.01, 0, -0.5)], [0.115, 0.11, 0.09], M["hair"], depth=0.75), "hr1")
    A(L.tube("hr2m", [(0, 0, 0), (0.0, 0, -0.3), (0.02, 0, -0.62)], [0.09, 0.075, 0.008], M["hair"], depth=0.75), "hr2")
    for y in (-0.12, 0.12):
        A(L.tube("lock", [(0.03 * S, y * S, 0.08 * S), (0.02 * S, y * S * 1.05, -0.12 * S), (0.0, y * S, -0.4 * S)],
                 [0.05 * S, 0.045 * S, 0.006], M["hair"], depth=0.8), "head")
    L.eyes(r, M["eye"], s=S, x=0.116, z=0.1, h=0.042, wdt=0.03, span=0.12)
    # hat (head copy + flying copy for the death) -- base on "ht", drooping tip on "ht1"
    hb, hti = hat_parts(M, "hat_")
    A(hb, "ht")
    A(hti, "ht1")
    hb2, hti2 = hat_parts(M, "fx_hat_")
    hti2.location = (0, 0, 0.55)           # rigid copy: the tip sits on top of the cone
    hat2 = L.joined("fx_hatfx", [hb2, hti2])
    A(hat2, "hatfx")
    # crescent-moon staff: grip at the origin, business end along -Z
    parts = [L.tube("shaft", [(0, 0, 1.0), (0, 0, 0), (0, 0, -1.15)], [0.034, 0.034, 0.03], M["wood"], segs=7)]
    parts.append(ellipsoid("butt", (0.09, 0.09, 0.11), M["gold"], loc=(0, 0, 1.02), segs=8, rings=5))
    parts.append(L.disc("collar_s", 0.06, 0.04, M["gold"], loc=(0, 0, -1.15)))
    for sgn, pr in ((1, 0.0), ):
        pts = L.arc_pts((0, 0, -1.3), 0.28, -40, 220, 14)
        rad = [0.006, 0.02, 0.035, 0.048, 0.056, 0.06, 0.062, 0.062, 0.06, 0.056, 0.048, 0.035, 0.02, 0.006]
        parts.append(L.tube("moon", [(p[0], p[1], p[2]) for p in pts], rad, M["gold"], segs=7))
    parts.append(ellipsoid("gem", (0.2, 0.18, 0.2), M["orb"], loc=(0, 0, -1.35), segs=12, rings=8))
    parts.append(ellipsoid("gem2", (0.1, 0.1, 0.1), M["core"], loc=(0.03, -0.06, -1.37), segs=8, rings=6))
    staff = L.joined("staff", parts)
    A(staff, "st")
    pts = L.arc_pts((0, 0.04, -1.3), 0.28, -40, 220, 14)
    glow_c = L.tube("fx_cglow", [(p[0], p[1], p[2]) for p in pts], [0.01, 0.045, 0.075, 0.1, 0.11, 0.115, 0.118, 0.118, 0.115, 0.11, 0.1, 0.075, 0.045, 0.01],
                    M["cglow"], segs=7)
    gl = L.joined("fx_cglow", [glow_c, ellipsoid("fx_cg2", (0.34, 0.1, 0.34), M["cglow"], loc=(0, 0.05, -1.35), segs=10, rings=6)])
    A(gl, "st")
    # orb familiars: violet shell + bright core (core offset toward the camera)
    orbs = []
    for k in range(3):
        o1 = ellipsoid("fx_orb%d" % k, (0.3, 0.3, 0.3), M["orb"], segs=12, rings=8)
        o2 = ellipsoid("fx_orbc%d" % k, (0.15, 0.15, 0.15), M["core"], loc=(0.03, -0.1, 0.03), segs=8, rings=6)
        ob = L.joined("fx_orb%d" % k, [o1, o2])
        A(ob, "ob%d" % k)
        orbs.append(ob)
    shards = []
    for k in range(4):
        sh_ = shard("fx_shard%d" % k, 0.24, M["shard"])
        ob = L.joined("fx_shard%d" % k, [sh_])
        A(ob, "mk%d" % k)
        shards.append(ob)
    sparks = []
    for k in range(6):
        sp = sparkle("fx_spark%d" % k, 0.16 + 0.04 * (k % 3), M["spark"])
        A(sp, "sp%d" % k)
        sparks.append(sp)
    fl = ellipsoid("fx_flash", (0.75, 0.5, 1.9), M["flash"], segs=14, rings=10)
    fl = L.joined("fx_flash", [fl])
    A(fl, "flash")
    dress_objs = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and
                  o.name.split(".")[0] in ("sk0m", "sk1m", "sk2m", "sk2l")]
    return r, M, dress_objs, orbs, shards, sparks, fl, gl, hat2


# --------------------------------------------------------------------------
# poses

BASE = {"hips": 0, "spine": 0, "chest": 0, "neck": 1, "head": 0,
        "sh_n": 14, "el_n": 40, "sh_f": 4, "el_f": 20, "_two": 0.0, "_st": 160, "ht": 0,
        "hips.dz": 0.0}


def acc(p, *ks):
    return sum(p.get(k, 0.0) for k in ks)


def KEYS(i, n, frames):
    return L.keys_at([(f / (n - 1), q) for f, q in frames], i / (n - 1))


def staff_head(p):
    """world (x, z) of the crescent centre for the pose p (flat dict, finished)."""
    RIG.pose(*L.split(p))
    return L.joint_xz(RIG, "st", (0, 0, -1.3))


def finish(p, sway=0.0, flow=0.0, lift=0.0):
    """flow: 0 = gown/hair hang, 1 = streaming backward;  lift: 0..1 = gown/hair billow upward."""
    two = p.pop("_two", 0.0)
    nx_, nz_ = p.pop("_nx", 0.3), p.pop("_nz", 0.3)
    st = p.pop("_st", 160)
    if two > 0.01:
        fk = {k: p.get(k, 0.0) for k in ("sh_n", "el_n", "sh_f", "el_f")}
        RIG.pose(*L.split(p))
        nsx, nsz = L.joint_xz(RIG, "sh_n")
        L.ik2(RIG, p, "sh_n", "el_n", "ha_n", (nsx + nx_, nsz + nz_), bend=1.0)
        RIG.pose(*L.split(p))
        hx, hz = L.joint_xz(RIG, "ha_n")
        a = math.radians(st)
        d = (math.sin(a), -math.cos(a))
        L.ik2(RIG, p, "sh_f", "el_f", "ha_f", (hx - 0.4 * d[0] + 0.0, hz - 0.4 * d[1]), bend=1.0)
        for k in fk:
            p[k] = fk[k] + (p[k] - fk[k]) * min(1.0, two)
    p["ha_n"] = 0.0
    L.hang(p, [("st", 0.0)], ARM_N, st)
    # gown: absolute angles, trailing backward; billowing up (lift) reverses the tail upward
    L.hang(p, [("sk0", -3 - 14 * flow + 14 * lift + sway * 0.4), ("sk1", -7 - 26 * flow + 34 * lift + sway * 0.8),
               ("sk2", -14 - 44 * flow + 60 * lift + sway * 1.3)], HIPS_CHAIN, 0)
    L.hang(p, [("as0", -12 - 40 * flow + 40 * lift + sway), ("as1", -20 - 55 * flow + 60 * lift + sway * 1.4)], HIPS_CHAIN, 0)
    L.hang(p, [("hr0", -8 - 36 * flow + 40 * lift + sway), ("hr1", -14 - 50 * flow + 60 * lift + sway * 1.2),
               ("hr2", -20 - 62 * flow + 80 * lift + sway * 1.5)], L.HEAD_CHAIN, 0)
    L.hang(p, [("sc0", -14 - 50 * flow + 50 * lift + sway), ("sc1", -22 - 60 * flow + 70 * lift + sway * 1.3)], CHEST_CHAIN, 0)
    L.hang(p, [("ht1", -20 - 40 * flow + 10 * lift + sway * 0.8)], L.HEAD_CHAIN + ("ht",), 0)
    return p


def idle(i, n):
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    p = L.merge(BASE, {"chest": 1.2 * s, "head": -1.5 * s, "hips": 1.5 * s, "_st": 160 + 2 * s, "ht": 2 * s,
                       "sh_n": 14 + 2 * s, "el_n": 40 - 3 * s, "sh_f": 4 + 3 * c, "el_f": 20 + 4 * c})
    p = finish(p, 5 * c, flow=0.08)
    p.update(orbs(i, n, speed=1.0, R=0.95, zc=1.9))
    return p


def hover_idle(i, n):
    return HOVER + 0.06 * math.sin(2 * math.pi * i / n)


def orbs(i, n, speed=1.0, R=0.95, zc=1.9, scale=1.0, base=0.0):
    out = {}
    for k in range(3):
        th = 2 * math.pi * (speed * i / n + k / 3.0 + base)
        out["ob%d.dx" % k] = R * math.cos(th) + 0.05
        out["ob%d.dz" % k] = zc + 0.3 * math.sin(th) + 0.18 * (k - 1)
        out["ob%d.dy" % k] = -0.7 * math.sin(th)
        out["ob%d.s" % k] = scale * (0.85 + 0.15 * math.cos(th))
    return out


def float_(i, n):
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    p = L.merge(BASE, {"hips": -7, "spine": -3, "chest": -3 + 1.2 * s, "neck": 3, "head": 2 - 1.5 * s, "ht": -4 + 3 * s,
                       "sh_n": 26 + 3 * s, "el_n": 52, "sh_f": -10 + 4 * c, "el_f": 24, "_st": 150 + 2 * s,
                       "hips.dx": 0.0})
    p = finish(p, 6 * c, flow=0.75)
    p.update(orbs(i, n, speed=1.0, R=1.0, zc=1.8, base=0.1))
    for k in range(3):                                 # familiars trail behind a little
        p["ob%d.dx" % k] -= 0.45
    return p


def float_lift(i, n):
    return HOVER + 0.07 * math.sin(2 * math.pi * i / n + 0.5)


# ---- orb: 3 slow homing orbs ----------------------------------------------------
ORB_WA = (6, 3, 5)
ORB = [
    (0, dict(BASE)),
    # gather: staff swings up, the far hand opens, orbs begin to converge
    (2, L.merge(BASE, {"hips": 2, "spine": 3, "chest": 4, "head": -3, "ht": -4, "_st": 176, "sh_n": 40, "el_n": 70,
                       "sh_f": 30, "el_f": 60})),
    # WIND-UP peak (telegraph): staff raised and tilted toward the target, back arched, orbs ringed at the crescent
    (5, L.merge(BASE, {"hips": 5, "spine": 8, "chest": 9, "neck": -4, "head": -7, "ht": -10, "_st": 150, "_two": 1.0,
                       "_nx": 0.2, "_nz": 0.46, "hips.dx": -0.1, "hips.dz": 0.05, "sh_f": 70, "el_f": 40})),
    # thrust: staff snaps forward, orbs released
    (6, L.merge(BASE, {"hips": -6, "spine": -3, "chest": -4, "head": 4, "ht": 6, "_st": 112, "_two": 1.0, "_nx": 0.5,
                       "_nz": 0.18, "hips.dx": 0.08})),
    (8, L.merge(BASE, {"hips": -9, "spine": -5, "chest": -6, "head": 6, "ht": 8, "_st": 98, "_two": 1.0, "_nx": 0.56,
                       "_nz": 0.08, "hips.dx": 0.14})),
    (13, dict(BASE)),
]


def orb(i, n):
    p = KEYS(i, n, ORB)
    if i in (4, 5):
        p["_st"] += 2 * (-1) ** i
    act = ORB_WA[0] <= i < ORB_WA[0] + ORB_WA[1]
    p = finish(p, -6 if i >= ORB_WA[0] else 2, flow=0.5 if act else 0.1, lift=0.25 if i in (4, 5) else 0.0)
    hx, hz = staff_head(p)
    if i < ORB_WA[0]:                                    # orbs spiral in to the crescent
        u = L.ease(i / (ORB_WA[0] - 1))
        for k in range(3):
            th = 2 * math.pi * (i / n + k / 3.0) * (1 - u) + 2 * math.pi * (k / 3.0 + 0.25) * u
            R0, z0 = 0.95, 1.9
            orx, orz = R0 * math.cos(th) + 0.05, z0 + 0.3 * math.sin(th) + 0.18 * (k - 1)
            ring = 0.34
            tx, tz = hx + ring * math.cos(2 * math.pi * k / 3 + 1.6), hz + ring * math.sin(2 * math.pi * k / 3 + 1.6) * 0.9
            p["ob%d.dx" % k] = orx + (tx - orx) * u
            p["ob%d.dz" % k] = orz + (tz - orz) * u
            p["ob%d.dy" % k] = -0.7 * math.sin(th) * (1 - u) - 0.25 * u
            p["ob%d.s" % k] = 0.9 + 0.7 * u
    else:
        j = i - ORB_WA[0]                                # 0.. : released in a fan
        dist = (0.4, 0.9, 1.3)[j] if j < 3 else 1.5
        for k, ang in enumerate((34, 4, -26)):
            a = math.radians(ang)
            p["ob%d.dx" % k] = hx + dist * math.cos(a)
            p["ob%d.dz" % k] = hz + dist * math.sin(a)
            p["ob%d.dy" % k] = -0.3
            p["ob%d.s" % k] = 1.6 - 0.1 * j
    return p


# ---- shards: moon shards fall at marked spots ------------------------------------
SH_WA = (7, 3, 5)
SHARDS = [
    (0, dict(BASE)),
    (2, L.merge(BASE, {"hips": 3, "spine": 5, "chest": 6, "head": -4, "ht": -6, "_st": 170, "_two": 1.0, "_nx": 0.24,
                       "_nz": 0.06, "hips.dz": 0.04})),
    # WIND-UP peak (telegraph): staff held straight up with both hands, body arched back, gown/hair billowing up
    (6, L.merge(BASE, {"hips": 6, "spine": 10, "chest": 12, "neck": -8, "head": -12, "ht": -14, "_st": 164,
                       "_two": 1.0, "_nx": 0.22, "_nz": 0.16, "hips.dz": 0.08})),
    # stab down: staff points forward-down at the target spots
    (7, L.merge(BASE, {"hips": -6, "spine": -4, "chest": -5, "head": 5, "ht": 8, "_st": 130, "_two": 1.0, "_nx": 0.4,
                       "_nz": 0.3, "hips.dz": 0.04})),
    (9, L.merge(BASE, {"hips": -12, "spine": -7, "chest": -8, "head": 8, "ht": 10, "_st": 74, "_two": 1.0, "_nx": 0.52,
                       "_nz": -0.1, "hips.dx": 0.12, "hips.dz": -0.02})),
    (14, dict(BASE)),
]


def shards(i, n):
    p = KEYS(i, n, SHARDS)
    if i in (5, 6):
        p["_st"] += 2 * (-1) ** i
        p["chest"] += 1.2 * (-1) ** i
    act = SH_WA[0] <= i < SH_WA[0] + SH_WA[1]
    lift = 1.0 if 4 <= i <= 6 else (0.55 if i == 3 or act else (0.3 if i == 2 else 0.0))
    p = finish(p, -5 if i >= SH_WA[0] else 2, flow=0.4 if act else 0.0, lift=lift)
    p.update(orbs(i, n, speed=1.0, R=1.0, zc=1.9) if i < 3 else {})
    hx, hz = staff_head(p)
    # shards: appear above the crescent while charging, fly up and away when released
    for k in range(4):
        if i < SH_WA[0]:
            u = max(0.0, (i - 2) / 4.0)
            th = 2 * math.pi * (k / 4.0 + 0.1 * i)
            R = 0.5 * u
            p["mk%d.dx" % k] = hx + R * math.cos(th)
            p["mk%d.dz" % k] = hz + 0.1 + 0.4 * math.sin(th) * u
            p["mk%d.dy" % k] = -0.4 * math.sin(th)
            p["mk%d.s" % k] = 0.4 + 0.6 * u
            p["mk%d" % k] = 360 * (0.18 * i + k / 4.0)
        else:
            j = i - SH_WA[0] + 1
            p["mk%d.dx" % k] = hx + (-0.9 + 0.45 * k) * (0.5 + 0.2 * j) + 0.2
            p["mk%d.dz" % k] = min(3.9, hz + 0.5 + 0.3 * j + 0.14 * k)
            p["mk%d.dy" % k] = -0.3
            p["mk%d.s" % k] = max(0.4, 1.0 - 0.13 * j)
            p["mk%d" % k] = 360 * (0.18 * i + k / 4.0)
    return p


# ---- blink: vanish and re-form ---------------------------------------------------
BLINK_N = 12


def blink(i, n):
    p = dict(BASE)
    # per-frame: (squash x, stretch z, flash scale, arms, hat)
    tab = {
        0: dict(sx=1.0, sz=1.0, fl=0.0, arm=1.0),
        1: dict(sx=0.8, sz=1.04, fl=0.7, arm=1.0),
        2: dict(sx=0.36, sz=1.08, fl=1.0, arm=1.0),
        3: dict(sx=0.1, sz=1.1, fl=0.8, arm=1.0),
        4: dict(sx=0.01, sz=0.01, fl=0.0, arm=0.0),
        5: dict(sx=0.01, sz=0.01, fl=0.0, arm=0.0),
        6: dict(sx=0.01, sz=0.01, fl=0.0, arm=0.0),
        7: dict(sx=0.01, sz=0.01, fl=0.0, arm=0.0),
        8: dict(sx=0.1, sz=1.1, fl=0.8, arm=0.0),
        9: dict(sx=0.4, sz=1.06, fl=1.0, arm=0.0),
        10: dict(sx=0.9, sz=0.96, fl=0.6, arm=0.0),
        11: dict(sx=1.0, sz=1.0, fl=0.0, arm=0.0),
    }[i]
    wrap = 1.0 if i in (0, 1) else (0.5 if i == 2 else 0.0)
    p.update({"hips": 2 * wrap, "chest": 4 * wrap, "head": 8 * wrap, "ht": -8 * wrap, "sh_n": 14 + 60 * wrap,
              "el_n": 40 + 80 * wrap, "sh_f": 4 + 62 * wrap, "el_f": 20 + 100 * wrap, "_st": 160 - 20 * wrap})
    if i >= 8:                                          # re-forming: arms flare open, hat tilts
        r_ = (i - 8) / 3.0
        p.update({"sh_n": 14 + 40 * (1 - r_), "el_n": 40, "sh_f": 4 + 30 * (1 - r_), "chest": -3 * (1 - r_),
                  "_st": 160 + 6 * (1 - r_)})
    p = finish(p, 0, flow=0.2, lift=0.8 if i in (2, 3, 8, 9) else 0.0)
    p["hips.sx"] = tab["sx"]
    p["hips.sy"] = max(0.01, tab["sx"] * 1.2)
    p["hips.sz"] = tab["sz"]
    p["flash.dz"] = 1.45
    p["flash.dx"] = 0.0
    p["flash.s"] = max(0.001, tab["fl"])
    # familiars keep circling the (empty) spot
    p.update(orbs(i, n, speed=1.4, R=0.85, zc=1.7, scale=1.0))
    # sparkles: burst outward while she is gone
    for k in range(6):
        if 2 <= i <= 9:
            u = (i - 2) / 7.0
            ph = 2 * math.pi * (k / 6.0)
            R = 0.2 + 0.7 * math.sin(math.pi * u) ** 0.8
            p["sp%d.dx" % k] = R * math.cos(ph + 1.5 * u) * 0.9
            p["sp%d.dz" % k] = 1.45 + R * math.sin(ph + 1.5 * u) * 1.1
            p["sp%d.dy" % k] = -0.3
            p["sp%d.s" % k] = 0.5 + 1.0 * math.sin(math.pi * u) * (0.6 + 0.4 * ((k + i) % 2))
        else:
            p["sp%d.s" % k] = 0.01
    return p


def blink_lift(i, n):
    return HOVER + 0.04 * math.sin(2 * math.pi * i / n)


# ---- hurt -------------------------------------------------------------------------
HURT_K = [
    (0, L.merge(BASE, {"hips": 5, "spine": 8, "chest": 10, "neck": -8, "head": -16, "ht": -16, "sh_n": 44, "el_n": 30,
                       "sh_f": 40, "el_f": 40, "hips.dx": -0.12, "_st": 180})),
    (1, L.merge(BASE, {"hips": 3, "spine": 5, "chest": 6, "neck": -4, "head": -9, "ht": -8, "sh_n": 28, "el_n": 40,
                       "sh_f": 20, "hips.dx": -0.07, "_st": 170})),
    (3, dict(BASE)),
]


def hurt(i, n):
    p = KEYS(i, n, HURT_K)
    p = finish(p, 12 if i == 0 else 6, flow=0.4 if i == 0 else 0.15, lift=0.3 if i == 0 else 0.0)
    p.update(orbs(i, n, speed=1.5, R=1.0 + 0.1 * (i == 0), zc=1.9))
    return p


# ---- death ------------------------------------------------------------------------
DEATH = [
    # hit: thrown back, hat lifting off, staff flung out
    (0, L.merge(BASE, {"hips": 8, "spine": 8, "chest": 12, "neck": -10, "head": -18, "ht": -18, "sh_n": 60, "el_n": 20,
                       "sh_f": 50, "el_f": 30, "hips.dx": -0.14, "_st": 190})),
    (2, L.merge(BASE, {"hips": 26, "spine": 6, "chest": 8, "neck": -8, "head": -16, "ht": -20, "sh_n": 70, "el_n": 14,
                       "sh_f": 60, "el_f": 24, "hips.dx": -0.3, "hips.dz": 0.12, "_st": 215})),
    # tumbling backward
    (5, L.merge(BASE, {"hips": 66, "spine": 4, "chest": 6, "neck": -6, "head": -10, "ht": -20, "sh_n": 100, "el_n": 14,
                       "sh_f": 90, "el_f": 24, "hips.dx": -0.5, "hips.dz": 0.1, "_st": 236})),
    # on her back on the floor, gown spread
    (8, L.merge(BASE, {"hips": 92, "spine": 2, "chest": 4, "neck": 0, "head": -6, "ht": -10, "sh_n": 120, "el_n": 10,
                       "sh_f": 108, "el_f": 18, "hips.dx": -0.62, "_st": 250})),
    (13, L.merge(BASE, {"hips": 94, "spine": 0, "chest": 2, "neck": 2, "head": -3, "ht": -4, "sh_n": 128, "el_n": 6,
                        "sh_f": 114, "el_f": 12, "hips.dx": -0.66, "_st": 262})),
]
HAT_PATH = {2: (-0.15, 3.35, 12), 3: (-0.5, 3.75, 44), 4: (-0.9, 3.7, 90), 5: (-1.25, 3.2, 150), 6: (-1.55, 2.4, 210),
            7: (-1.8, 1.5, 250), 8: (-1.95, 0.75, 292), 9: (-2.0, 0.36, 322), 10: (-2.02, 0.3, 336), 11: (-2.02, 0.3, 338),
            12: (-2.02, 0.3, 338), 13: (-2.02, 0.3, 338)}


def death(i, n):
    p = KEYS(i, n, DEATH)
    f = i / (n - 1)
    p = finish(p, 0, flow=max(0.0, 0.6 - f), lift=max(0.0, 0.7 - 1.4 * f))
    if i >= 5:
        c = max(0.0, 1 - (i - 5) / 4.0)                   # hair, gown and sash settle on the floor
        for j in ("hr0", "hr1", "hr2", "sk0", "sk1", "sk2", "as0", "as1", "sc0", "sc1"):
            p[j] = p[j] * c
        p["sk1"] += 4 * (1 - c)
    # orbs burst away in the first frames
    for k in range(3):
        if i < 3:
            th = 2 * math.pi * (i / n + k / 3.0)
            p["ob%d.dx" % k] = (0.95 + 0.5 * i) * math.cos(th) + 0.05 + 0.2 * i * (k - 1)
            p["ob%d.dz" % k] = 1.9 + 0.3 * math.sin(th) + 0.4 * i * (1 if k != 1 else -0.2)
            p["ob%d.dy" % k] = -0.7 * math.sin(th)
            p["ob%d.s" % k] = 1.0 + 0.5 * i
    # hat flies off on its own joint
    if i in HAT_PATH:
        x, z, a = HAT_PATH[i]
        p["hatfx.dx"], p["hatfx.dz"], p["hatfx"] = x, z, a
    # sparkles from the dying orbs and the faded magic
    for k in range(6):
        t0 = 2 + (k % 3)
        if i >= t0 and i < t0 + 6:
            u = (i - t0) / 5.0
            p["sp%d.dx" % k] = -0.6 + 1.0 * (k - 2.5) * 0.45 + 0.1 * math.sin(7 * u + k)
            p["sp%d.dz" % k] = 1.3 + 1.4 * u + 0.2 * k * 0.3 if i < 8 else 0.7 + 1.6 * u
            p["sp%d.dy" % k] = -0.3
            p["sp%d.s" % k] = 1.2 * (1 - u) + 0.2
        else:
            p["sp%d.s" % k] = 0.01
    return p


def main():
    r, M, dress, orbs_, shards_, sparks, flash, cglow, hatfx = build()
    sh = Sheet("mb_witch", r)
    hat_head = [o for o in r.joints["root"].children_recursive if o.name.split(".")[0] in ("hat_base", "hat_tipm")]
    for o in orbs_ + shards_ + sparks:
        sh.prop(o, False)
    sh.prop(flash, False)
    sh.prop(cglow, False)
    sh.prop(hatfx, False)
    for o in hat_head:
        sh.prop(o, True)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and not o.name.startswith("fx_")
            and o.name.split(".")[0] not in ("hat_base", "hat_tipm")]

    def vis(orb_on=None, spark_on=None, shard_on=None, glow=False, flash_on=False, hat_off=False, hatfx_on=False):
        v = {}
        for k in range(3):
            v["fx_orb%d" % k] = bool(orb_on is None or orb_on(k))
        for k in range(6):
            v["fx_spark%d" % k] = bool(spark_on and spark_on(k))
        for k in range(4):
            v["fx_shard%d" % k] = bool(shard_on and shard_on(k))
        v["fx_cglow"] = glow
        v["fx_flash"] = flash_on
        v["fx_hatfx"] = hatfx_on
        for o in hat_head:
            v[o.name] = not hat_off
        return v

    sh.render("idle", 8, idle, fps=7, loop=True, ground_objs=dress, lift_fn=hover_idle,
              vis_fn=lambda i, n: vis())
    sh.render("float", 8, float_, fps=10, loop=True, ground_objs=dress, lift_fn=float_lift,
              vis_fn=lambda i, n: vis())
    sh.render("orb", 14, orb, fps=12, wa=ORB_WA, ground_objs=dress, lift_fn=lambda i, n: HOVER + 0.05 * math.sin(i * 0.9),
              vis_fn=lambda i, n: vis(orb_on=lambda k: i < ORB_WA[0] + 3, glow=3 <= i <= 7))
    sh.render("blink", BLINK_N, blink, fps=14, ground_fn=lambda i, n: dress if i not in (4, 5, 6, 7) else None,
              lift_fn=lambda i, n: HOVER + (0.1 if i in (4, 5, 6, 7) else 0.0),
              vis_fn=lambda i, n: vis(spark_on=lambda k: 2 <= i <= 9, flash_on=i in (1, 2, 3, 8, 9, 10), hat_off=4 <= i <= 7))
    sh.render("shards", 15, shards, fps=12, wa=SH_WA, ground_objs=dress,
              lift_fn=lambda i, n: HOVER + (0.1 if 3 <= i <= 8 else 0.04 * math.sin(i)),
              vis_fn=lambda i, n: vis(orb_on=lambda k: i < 3, shard_on=lambda k: 3 <= i <= 11, glow=3 <= i <= 9))
    sh.render("hurt", 4, hurt, fps=12, ground_objs=dress, lift_fn=lambda i, n: HOVER + (0.05 if i == 0 else 0.0),
              vis_fn=lambda i, n: vis())
    sh.render("death", 14, death, fps=8, grounds=[("hips", allm)],
              vis_fn=lambda i, n: vis(orb_on=lambda k: i < 3, spark_on=lambda k: 2 + (k % 3) <= i < 8 + (k % 3),
                                      hat_off=i >= 2, hatfx_on=i >= 2))
    sh.write_spec()


L.run(main)
