"""DEADSELL enemy: harpy (하피) -- woman whose arms are large dark-violet feathered wings, taloned
legs, wild hair.  Flies and dives.

blender -b --factory-startup -P tools/blender/asset_harpy.py
-> build/frames/harpy/*.png + spec.json   (pack: python3 tools/pack/pack_all.py harpy)

Animations: fly(loop) dive_windup dive(loop) recover hurt death        (anchor = talons)
Wings are screen-plane swings of the joints sh/el/ha (shoulder, wrist, tip).  Wing and
hair/tail angles are given as ABSOLUTE world swing angles in the pose dicts ("_wn", "_wf",
"_en", "_ef", "_hair", "_tail") and converted to joint angles in finish().
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

S = 0.8                 # body scale: 1.4 u standing = 45 px
RIG = None
STREAKS = ([], [])
IN_LEN, OUT_LEN = 0.5, 0.45      # inner / outer wing bone length (u)
FS = 0.88                        # feather length factor


def feather_wing(M, side, pal):
    """Build one wing: returns (inner_obj, outer_obj) hanging down from their joints."""
    # both wings sit BEHIND the torso (y > 0) so the woman stays readable; layers are staggered in y.
    dy = -0.012      # later feathers sit toward the camera (-Y)
    inner, outer = [], []
    bone = L.tube("w_bone_in", [(0, 0, 0.03), (0, 0, -0.3), (0.01, 0, -IN_LEN)], [0.06, 0.05, 0.04], pal["dark"], segs=6)
    inner.append(bone)
    for k in range(6):                      # secondaries trail behind the arm
        phi = 80 - 9 * k
        ln = (0.40 + 0.015 * k) * FS
        f = L.leaf("sec%d" % k, ln, 0.125, 0.02, pal["a"] if k % 2 == 0 else pal["b"], tip=0.45, base=0.3)
        f.location = (0, dy * (k + 1), -0.05 - 0.075 * k)
        f.rotation_euler = (0, math.radians(phi), 0)
        inner.append(f)
    for k, z in enumerate((-0.07, -0.18, -0.29)):   # coverts on top (pink accent on the leading row)
        f = L.leaf("cov%d" % k, 0.2 * FS, 0.13, 0.02, pal["trim"] if k != 1 else pal["b"], tip=0.5, base=0.4)
        f.location = (0.0, dy * (8 + k), z)
        f.rotation_euler = (0, math.radians(62 - 6 * k), 0)
        inner.append(f)
    bone2 = L.tube("w_bone_out", [(0, 0, 0.03), (0, 0, -0.3), (0.0, 0, -OUT_LEN)], [0.05, 0.04, 0.03], pal["dark"], segs=6)
    outer.append(bone2)
    for k in range(7):                      # primaries fan out
        phi = 56 - 9.5 * k
        ln = (0.42 + 0.032 * k) * FS
        f = L.leaf("pri%d" % k, ln, 0.115, 0.02, pal["b"] if k % 2 == 0 else pal["a"], tip=0.5, base=0.25)
        f.location = (0, dy * (k + 1), -0.04 - 0.06 * k)
        f.rotation_euler = (0, math.radians(phi), 0)
        outer.append(f)
    f = L.leaf("pri_tip", 0.66 * FS, 0.1, 0.02, pal["trim"], tip=0.55, base=0.2)
    f.location = (0.0, dy * 9, -OUT_LEN + 0.04)
    f.rotation_euler = (0, math.radians(-6), 0)
    outer.append(f)
    return L.joined("wing_in_%d" % side, inner), L.joined("wing_out_%d" % side, outer)


def build():
    global RIG
    L.setup_scene()
    M = {
        "skin": L.mat("h_skin", "#e8c4cc", "#9a6a86", "#fbe6e8"),
        "bodice": L.mat("h_bodice", "#d8a53c", "#7a4a2c", "#ffd878"),
        "fea": L.mat("h_fea", "#4a2b82", "#1e1140", "#7653b8"),
        "fea2": L.mat("h_fea2", "#6a3fae", "#2c1856", "#9a74d6"),
        "dark": L.mat("h_dark", "#33205c", "#170d30", "#4f3a86"),
        "trim": L.mat("h_trim", "#d65a97", "#6e2050", "#ff95c3"),
        "scale": L.mat("h_scale", "#b8a06a", "#5a4a4a", "#e8d79c"),
        "talon": L.mat("h_talon", "#efe0b8", "#8a7466", "#fffbe8"),
        "hair": L.mat("h_hair", "#d9c6f2", "#7a6aa8", "#ffffff"),
        # far wing: pushed toward the shadow tones so it sits behind the body
        "fa": L.mat("h_fa", "#3a2268", "#190d34", "#5d3f98"),
        "fb": L.mat("h_fb", "#4c2f84", "#201046", "#7a5cb6"),
        "fdark": L.mat("h_fdark", "#2a1850", "#120a26", "#3f2e72"),
        "ftrim": L.mat("h_ftrim", "#a8447a", "#521a40", "#d878ac"),
        "eye": L.glow("h_eye", "#ff9a2e"),
        "streak": L.glow("h_streak", "#d8c8ff"),
    }
    r = L.ERig("harpy")
    RIG = r
    L.skeleton(r, s=S, w=0.95, arms=False)
    J, A = r.joint, r.attach
    # wings: attached at the shoulder blades, hang straight down at rest
    wz = 1.36 * S
    for sd, y in (("n", 0.16), ("f", 0.27)):
        J("sh_" + sd, "chest", (-0.05 * S, y, wz))
        J("el_" + sd, "sh_" + sd, (-0.05 * S, y, wz - IN_LEN))
        J("ha_" + sd, "el_" + sd, (-0.05 * S, y, wz - IN_LEN - OUT_LEN))
    J("hb", "head", (-0.1 * S, 0, 1.62 * S))
    J("hb1", "hb", (-0.1 * S, 0, 1.62 * S - 0.3))
    J("skirt", "hips", (0, 0, 0.93 * S))
    J("tail", "hips", (-0.1 * S, 0, 0.95 * S))

    o = L.body(r, {"skin": M["skin"], "chest": M["bodice"], "waist": M["skin"], "pelvis": M["fea2"],
                   "bust": M["bodice"], "thigh": M["fea"], "shin": M["scale"], "foot": M["scale"]},
               s=S, w=1.06, bust=1.15, hip=1.12, arms=False, feet=False, leg_r=0.88)
    # wings
    for sd, side in (("n", -1), ("f", 1)):
        pal = ({"a": M["fea"], "b": M["fea2"], "dark": M["dark"], "trim": M["trim"]} if sd == "n" else
               {"a": M["fa"], "b": M["fb"], "dark": M["fdark"], "trim": M["ftrim"]})
        wi, wo = feather_wing(M, side, pal)
        A(wi, "sh_" + sd)
        A(wo, "el_" + sd)
        # shoulder fluff hides the wing root
        A(ellipsoid("rootfluff_" + sd, (0.17 * S, 0.14 * S, 0.2 * S), pal["a"]), "sh_" + sd, (0, 0, -0.04))
    # neck ruff + bandeau details
    A(ellipsoid("ruff", (0.27 * S, 0.33 * S, 0.1 * S), M["fea2"]), "chest", (0.0, 0, 0.11 * S))
    A(ellipsoid("sash", (0.2 * S, 0.26 * S, 0.05 * S), M["trim"]), "spine", (0.0, 0, 0.06 * S))
    # feather skirt + tail feathers
    A(L.skirt("skirt_m", 0.17 * S, 0.3 * S, 0.22 * S, M["fea2"], n=16, jag=0.05, seed=9, bulge=0.025, front=0.8,
              back=1.2), "skirt")
    tl = []
    for k, (phi, ln) in enumerate(((4, 0.5), (24, 0.56), (46, 0.5))):
        f = L.leaf("tail%d" % k, ln, 0.13, 0.02, M["fea2"] if k % 2 else M["fea"], tip=0.5, base=0.3)
        f.location = (0, -0.012 * k, 0)
        f.rotation_euler = (0, math.radians(phi), 0)
        tl.append(f)
    A(L.joined("tailm", tl), "tail")
    # feathered thighs, knee tufts, scaly shins, talons
    for sd in ("n", "f"):
        A(ellipsoid("pants_" + sd, (0.17 * S, 0.15 * S, 0.34 * S), M["fea"]), "th_" + sd, (0.0, 0, -0.2 * S))
        A(ellipsoid("tuft_" + sd, (0.1 * S, 0.1 * S, 0.12 * S), M["fea2"]), "kn_" + sd, (-0.03 * S, 0, -0.02 * S))
        parts = [ellipsoid("pad", (0.15 * S, 0.1 * S, 0.06 * S), M["scale"], loc=(0.03 * S, 0, -0.02 * S))]
        for k, (ang, ln, y) in enumerate(((8, 0.2, 0.0), (-28, 0.2, -0.045), (-55, 0.17, 0.045))):
            a = math.radians(ang)
            d = (math.cos(a), math.sin(a))
            pts = [(0.04 * S, y * S, -0.02 * S), (0.04 * S + d[0] * ln * S * 0.55, y * S, -0.02 * S + d[1] * ln * S * 0.55),
                   (0.04 * S + d[0] * ln * S, y * S, -0.02 * S + d[1] * ln * S),
                   (0.04 * S + d[0] * ln * S * 1.12, y * S, -0.02 * S + d[1] * ln * S - 0.05 * S)]
            parts.append(L.tube("toe%d" % k, pts, [0.03 * S, 0.026 * S, 0.02 * S, 0.004], M["talon"], segs=5))
        parts.append(L.tube("hallux", [(0.0, 0, -0.02 * S), (-0.07 * S, 0, -0.03 * S), (-0.11 * S, 0, -0.08 * S)],
                            [0.026 * S, 0.02 * S, 0.004], M["talon"], segs=5))
        A(L.joined("talon_" + sd, parts), "an_" + sd, (0.0, 0, -0.03 * S))
    # head: wild lilac hair (spikes radiate up/back), bangs, long streaming locks, head feathers
    A(ellipsoid("hair_cap", (0.27 * S, 0.26 * S, 0.22 * S), M["hair"]), "head", (-0.03 * S, 0, 0.165 * S))
    A(ellipsoid("bangs", (0.1 * S, 0.22 * S, 0.07 * S), M["hair"]), "head", (0.075 * S, 0, 0.2 * S))
    rnd = random.Random(5)
    for k, (ang, ln) in enumerate(((86, 0.24), (110, 0.3), (134, 0.34), (158, 0.34), (182, 0.28), (122, 0.28), (146, 0.3))):
        a_ = math.radians(ang)
        y = (rnd.random() - 0.5) * 0.26
        d = (math.cos(a_), math.sin(a_))
        base = (-0.03 + 0.07 * d[0], y, 0.165 + 0.08 * d[1])
        mid = (base[0] + d[0] * ln * 0.5, y * 1.2, base[2] + d[1] * ln * 0.5 + 0.03)
        tipp = (base[0] + d[0] * ln, y * 1.4, base[2] + d[1] * ln - 0.03)
        A(L.tube("spike%d" % k, [tuple(c * S for c in base), tuple(c * S for c in mid), tuple(c * S for c in tipp)],
                 [0.07 * S, 0.05 * S, 0.004], M["hair"], segs=6), "head")
    for k, (y, ln, rr) in enumerate(((-0.06, 0.5, 0.085), (0.0, 0.58, 0.09), (0.07, 0.44, 0.075))):
        A(L.tube("lock%d" % k, [(0, y * S, 0), (-0.03 * S, y * S, -0.15), (-0.02 * S, y * S, -ln * 0.6)],
                 [rr * S, rr * S * 0.9, 0.012], M["hair"], depth=0.9), "hb")
        A(L.tube("lockb%d" % k, [(0, y * S, 0), (-0.02 * S, y * S, -0.14), (0.0, y * S, -ln * 0.5)],
                 [rr * S * 0.9, rr * S * 0.6, 0.006], M["hair"], depth=0.9), "hb1")
    for y in (-0.1, 0.1):
        f = L.leaf("hfeather", 0.3 * S / 0.8, 0.1, 0.02, M["trim"], tip=0.5, base=0.3)
        f.location = (-0.07 * S, y * S, 0.3 * S)
        f.rotation_euler = (0, math.radians(-125), 0)
        A(L.joined("hfeather_%d" % (y > 0), [f]), "head")
    L.eyes(r, M["eye"], s=S, x=0.108, z=0.115, h=0.055, wdt=0.03, span=0.12)
    # dive speed streaks (in hips space so they follow the lean): two alternating sets
    for gi, offs in enumerate((((0.34, -0.1, 0.9), (0.46, 0.05, 1.15), (-0.5, -0.08, 1.3), (-0.62, 0.1, 1.55)),
                               ((0.4, 0.08, 1.0), (0.3, -0.06, 1.3), (-0.55, 0.1, 1.12), (-0.7, -0.08, 1.4)))):
        parts = []
        for k, (x, y, z) in enumerate(offs):
            ln = 0.5 + 0.18 * ((k + gi) % 2)
            parts.append(L.tube("st%d_%d" % (gi, k), [(x, y, z), (x, y, z + ln * 0.5), (x, y, z + ln)],
                                [0.004, 0.022, 0.004], M["streak"], depth=0.5, segs=5))
        ob = L.joined("streaks%d" % gi, parts)
        A(ob, "hips", (0, 0, -0.92 * S))
        STREAKS[gi].append(ob)
    feet = [x for x in r.joints["root"].children_recursive if x.type == "MESH" and x.name.startswith("talon_")]
    return r, M, feet


# --------------------------------------------------------------------------
# poses

FLY = {"hips": -8, "spine": -4, "chest": -4, "neck": 4, "head": 6,
       "th_n": 16, "kn_n": -34, "th_f": 4, "kn_f": -26, "an_n": 28, "an_f": 24,
       "_wn": -88, "_wf": -96, "_en": 0, "_ef": 0, "_hair": -35, "_tail": -25}

DIVE = {"hips": 32, "spine": 4, "chest": 6, "neck": -22, "head": -18,
        "th_n": 12, "kn_n": -6, "th_f": 22, "kn_f": -12, "an_n": -55, "an_f": -50,
        "_wn": -160, "_wf": -150, "_en": 18, "_ef": 12, "_hair": -152, "_tail": -146,
        "hips.dx": -0.2}

WIND = {"hips": -22, "spine": -8, "chest": -10, "neck": 10, "head": 14,
        "th_n": 58, "kn_n": -104, "th_f": 46, "kn_f": -92, "an_n": 40, "an_f": 36,
        "_wn": -172, "_wf": -146, "_en": 14, "_ef": 20, "_hair": -70, "_tail": -40}


def finish(p, sway=0.0):
    acc = lambda *ks: sum(p.get(k, 0.0) for k in ks)   # noqa: E731
    torso = acc("hips", "spine", "chest")
    for sd in ("n", "f"):
        p["sh_" + sd] = p.pop("_w" + sd, -88) - torso
        p["el_" + sd] = p.pop("_e" + sd, 0)
        p["ha_" + sd] = p.get("ha_" + sd, 0) + 0.3 * p["el_" + sd]
    h = p.pop("_hair", -35)
    L.hang(p, [("hb", h + sway), ("hb1", h + 24 + sway * 0.6)], L.HEAD_CHAIN, 0)   # absolute angles
    p["tail"] = p.pop("_tail", -25) - acc("hips") + sway * 0.4
    p["skirt"] = -0.5 * p.get("hips", 0)
    p["head.s"] = 1.15
    return p


def wingflap(a, lag=0.0):
    """(shoulder angle, elbow flex) of the flap cycle at phase a (rad)."""
    sh = -88 + 78 * math.sin(a - lag) + 8 * math.sin(2 * (a - lag))
    el = -22 * math.cos(a - lag) + 6
    return sh, el


def fly(i, n):
    a = 2 * math.pi * i / n
    p = dict(FLY)
    shn, eln = wingflap(a)
    shf, elf = wingflap(a, 0.3)
    p.update({"_wn": shn, "_en": eln, "_wf": shf - 10, "_ef": elf,
              "th_n": 16 + 6 * math.sin(a - 0.8), "kn_n": -34 - 6 * math.sin(a - 0.8),
              "th_f": 4 + 6 * math.sin(a - 1.1), "kn_f": -26 - 6 * math.sin(a - 1.1),
              "chest": -4 + 2 * math.sin(a), "head": 6 - 3 * math.sin(a)})
    return finish(p, 6 * math.sin(a - 1.0))


def dive_windup(i, n):
    t = i / (n - 1)
    keys = [(0.0, dict(FLY)),
            (0.4, L.merge(WIND, {"_wn": -125, "_wf": -135, "hips": -14, "th_n": 36, "kn_n": -66, "th_f": 28, "kn_f": -56,
                                 "an_n": 34, "an_f": 30})),
            (1.0, dict(WIND))]
    p = L.keys_at(keys, t)
    if i >= n - 2:     # coiled tremble at the peak
        k = (-1) ** i
        p["_wn"] += 4 * k
        p["_wf"] -= 4 * k
        p["hips.dz"] = 0.015 * k
    return finish(p, 4 if i % 2 else -4)


def dive(i, n):
    a = 2 * math.pi * i / n
    p = dict(DIVE)
    p.update({"_wn": DIVE["_wn"] + 7 * math.sin(a), "_wf": DIVE["_wf"] - 7 * math.sin(a), "_en": 18 + 6 * math.cos(a),
              "th_n": 12 + 3 * math.sin(a), "th_f": 22 - 3 * math.sin(a)})
    return finish(p, 8 * math.sin(a))


def recover(i, n):
    t = i / (n - 1)
    keys = [(0.0, L.merge(DIVE, {"_wn": -138, "_wf": -128, "hips": 26, "hips.dx": -0.15})),
            (0.5, L.merge(FLY, {"_wn": -100, "_wf": -112, "_en": -10, "_ef": -6, "hips": 12, "neck": -8, "head": -4,
                                "th_n": 22, "kn_n": -22, "th_f": 14, "kn_f": -16, "an_n": 10, "an_f": 8,
                                "_hair": -100, "_tail": -90})),
            (1.0, L.merge(FLY, {"_wn": -36, "_wf": -48, "_en": -14, "_ef": -10}))]
    p = L.keys_at(keys, t)
    return finish(p, 6)


HURT0 = L.merge(FLY, {"hips": 12, "spine": 8, "chest": 12, "neck": -10, "head": -22, "th_n": 34, "kn_n": -22,
                      "th_f": 26, "kn_f": -30, "an_n": 20, "an_f": 20, "_wn": -150, "_wf": -164, "_en": 30, "_ef": 24,
                      "_hair": -70, "_tail": -60, "hips.dx": -0.07})


def hurt(i, n):
    keys = [(0.0, HURT0),
            (0.5, L.merge(FLY, {"hips": 6, "spine": 4, "chest": 6, "head": -10, "_wn": -118, "_wf": -130,
                                "_en": 14, "_ef": 10, "hips.dx": -0.04})),
            (1.0, dict(FLY))]
    p = L.keys_at(keys, i / (n - 1) * 0.85)
    return finish(p, 10)


DEATH = [
    (0.00, HURT0),
    # wings spasm up, body tips back
    (0.25, L.merge(HURT0, {"hips": 28, "spine": 6, "chest": 8, "neck": -14, "head": -24, "th_n": 50, "kn_n": -40,
                           "th_f": 38, "kn_f": -50, "_wn": -170, "_wf": -135, "_en": 40, "_ef": 30, "hips.dx": -0.12})),
    # wings fold, she drops
    (0.5, L.merge(HURT0, {"hips": 52, "spine": 6, "chest": 6, "neck": -10, "head": -16, "th_n": 64, "kn_n": -70,
                          "th_f": 52, "kn_f": -76, "_wn": -118, "_wf": -96, "_en": 80, "_ef": 70, "hips.dx": -0.2})),
    # lands on her back, wings crumpled under/behind
    (0.8, L.merge(HURT0, {"hips": 86, "spine": 2, "chest": 2, "neck": -6, "head": -10, "th_n": 40, "kn_n": -70,
                          "th_f": 30, "kn_f": -80, "_wn": -90, "_wf": -70, "_en": 110, "_ef": 100, "hips.dx": -0.25})),
    (1.0, L.merge(HURT0, {"hips": 90, "spine": 0, "chest": 0, "neck": -4, "head": -8, "th_n": 26, "kn_n": -60,
                          "th_f": 18, "kn_f": -74, "_wn": -86, "_wf": -64, "_en": 116, "_ef": 108, "hips.dx": -0.25})),
]


def death(i, n):
    f = i / (n - 1)
    p = L.keys_at(DEATH, f)
    for sd in ("n", "f"):
        p["an_" + sd] = 30 * min(1, f * 2)
    p["_hair"] = p["_hair"] * (1 - f) - 175 * f * 0 + (-95) * f
    p["_tail"] = p["_tail"] * (1 - f) - 88 * f
    return finish(p, 0)


def main():
    r, M, feet = build()
    sh = L.Sheet("harpy", r)
    for gi in (0, 1):
        sh.prop(STREAKS[gi][0], False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and not o.name.startswith("streaks")]
    sh.render("fly", 8, fly, fps=12, loop=True, ground_objs=feet,
              lift_fn=lambda i, n: 0.05 - 0.05 * math.cos(2 * math.pi * i / n) * 0.8)
    sh.render("dive_windup", 6, dive_windup, fps=10, ground_objs=feet, lift_fn=lambda i, n: 0.05)
    sh.render("dive", 4, dive, fps=14, loop=True, ground_objs=feet,
              vis_fn=lambda i, n: {"streaks0": i % 2 == 0, "streaks1": i % 2 == 1})
    sh.render("recover", 4, recover, fps=10, ground_objs=feet, lift_fn=lambda i, n: 0.05)
    sh.render("hurt", 3, hurt, fps=12, ground_objs=feet, lift_fn=lambda i, n: 0.05)
    sh.render("death", 9, death, fps=10, grounds=[("hips", allm)])
    sh.write_spec()


L.run(main)
