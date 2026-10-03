"""DEADSELL enemy: jailer (여간수) -- stocky armored warden woman with tower shield + mace.

blender -b --factory-startup -P tools/blender/asset_jailer.py
-> build/frames/jailer/*.png + spec.json   (pack: python3 tools/pack/pack_all.py jailer)

Animations: idle walk attack(shield bash + mace, windup/active/recover) block hurt death
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

S = 1.0
W = 1.3
WA = (5, 3, 4)


def build():
    L.setup_scene()
    M = {
        "skin": L.mat("j_skin", "#e3b79c", "#8c5b6b", "#f9dcc6"),
        "plate": L.mat("j_plate", "#7c6c66", "#3a2c3c", "#b8a294"),
        "rust": L.mat("j_rust", "#9c5532", "#4e2430", "#c97a45"),
        "tabard": L.mat("j_tabard", "#7d1f2c", "#3d0d24", "#ac3442"),
        "hair": L.mat("j_hair", "#d8aa5c", "#835638", "#f6d68e"),
        "leather": L.mat("j_leather", "#4d3429", "#251621", "#6e4b39"),
        "wood": L.mat("j_wood", "#6f4a33", "#352028", "#946a4c"),
        "iron": L.mat("j_iron", "#77737f", "#34303f", "#b8b4c6"),
        "eye": L.glow("j_eye", "#ff6a2c"),
        "smear": L.glow("j_smear", "#ffe2c8"),
    }
    r = L.ERig("jailer")
    L.skeleton(r, s=S, w=W, sh_w=0.13, hip_w=0.08)
    J, A = r.joint, r.attach
    J("braid_n", "head", (-0.02, -0.12, 1.6))
    J("braid_n1", "braid_n", (-0.02, -0.12, 1.36))
    J("braid_f", "head", (-0.09, 0.08, 1.62))
    J("braid_f1", "braid_f", (-0.12, 0.08, 1.38))
    J("shield", "root", (0.37, 0.03, 0.58))
    J("skirt", "hips", (0, 0, 0.94))
    J("tab", "hips", (0.14, 0, 0.9))

    o = L.body(r, {"skin": M["skin"], "chest": M["plate"], "waist": M["leather"], "pelvis": M["tabard"],
                   "ua": M["tabard"], "fa": M["plate"], "hand": M["leather"], "thigh": M["leather"],
                   "shin": M["plate"], "foot": M["leather"]},
               s=S, w=W, bust=1.15, hip=1.15, arm_r=1.25, leg_r=1.22)
    # breastplate: rounded, shaped for the bust, rust patches
    A(ellipsoid("plate_bust", (0.17, 0.27 * W, 0.15), M["plate"]), "chest", (0.085, 0, 0.05))
    A(ellipsoid("plate_rust", (0.08, 0.2, 0.06), M["rust"]), "chest", (0.12, -0.02, -0.03))
    A(ellipsoid("gorget", (0.22, 0.28, 0.08), M["plate"]), "chest", (-0.01, 0, 0.21))
    A(ellipsoid("belt", (0.24 * W, 0.3 * W, 0.07), M["leather"]), "hips", (0.0, 0, 0.08))
    A(box("buckle", (0.04, 0.06, 0.05), M["iron"]), "hips", (0.15, 0, 0.08))
    # skirt + tabard panels (front panel swings with the thighs a little)
    A(L.skirt("skirt_m", 0.17 * W, 0.26 * W, 0.42, M["tabard"], n=16, bulge=0.03, front=0.95, back=1.05), "skirt")
    A(L.bake(box("tab_front", (0.03, 0.2, 0.4), M["tabard"], loc=(0, 0, -0.2), bevel=0.01)), "tab", (0.07, 0, 0.0))
    A(box("tab_trim", (0.035, 0.22, 0.04), M["rust"]), "tab", (0.07, 0, -0.39))
    # pauldrons
    for sd in ("n", "f"):
        A(ellipsoid("pauld_" + sd, (0.23, 0.2, 0.17), M["plate"]), "sh_" + sd, (0, 0, 0.01))
        A(ellipsoid("pauld2_" + sd, (0.19, 0.18, 0.09), M["rust"]), "sh_" + sd, (0, 0, -0.07))
        A(ellipsoid("knee_" + sd, (0.1, 0.1, 0.09), M["plate"]), "kn_" + sd, (0.04, 0, 0.0))
    # head: kettle helmet with brim, braids, face
    A(ellipsoid("helm", (0.27, 0.26, 0.22), M["iron"]), "head", (-0.01, 0, 0.17))
    A(L.disc("brim", 0.165, 0.025, M["iron"], loc=(0, 0, 0)), "head", (-0.005, 0, 0.14))
    A(ellipsoid("helm_band", (0.255, 0.25, 0.045), M["rust"]), "head", (-0.01, 0, 0.165))
    A(box("helm_crest", (0.24, 0.03, 0.06), M["iron"], bevel=0.01), "head", (-0.015, 0, 0.275))
    A(ellipsoid("cheek_guard", (0.1, 0.2, 0.12), M["iron"]), "head", (-0.06, 0, 0.07))
    A(ellipsoid("hair_back", (0.14, 0.22, 0.14), M["hair"]), "head", (-0.07, 0, 0.08))
    for sd in ("n", "f"):
        y = -0.08 if sd == "n" else 0.08
        for k in range(3):
            A(ellipsoid("braid_%s_a%d" % (sd, k), (0.085, 0.08, 0.095), M["hair"]), "braid_" + sd,
              (0, 0, -0.04 - 0.08 * k))
        for k in range(3):
            A(ellipsoid("braid_%s_k%d" % (sd, k), (0.08, 0.075, 0.09), M["hair"]), "braid_" + sd1(sd),
              (-0.005, 0, -0.0 - 0.075 * k))
        A(cone("braid_%s_tip" % sd, 0.04, 0.0, 0.1, M["hair"], rot=(180, 0, 0)), "braid_" + sd1(sd), (0, 0, -0.2))
        A(ellipsoid("braid_%s_tie" % sd, (0.06, 0.06, 0.035), M["tabard"]), "braid_" + sd1(sd), (0, 0, -0.2))
    L.eyes(r, M["eye"], s=S, x=0.108, z=0.115, h=0.05, wdt=0.03, span=0.12)
    # tower shield (face angled toward the camera)
    SH_H, SH_W = 0.86, 0.5
    sh_objs = [box("sh_board", (0.06, SH_W, SH_H), M["wood"], bevel=0.015)]
    for z in (-0.27, 0.27):
        sh_objs.append(box("sh_band", (0.075, SH_W + 0.02, 0.06), M["iron"], loc=(0, 0, z)))
    sh_objs.append(box("sh_rim_t", (0.085, SH_W + 0.04, 0.055), M["iron"], loc=(0, 0, SH_H / 2)))
    sh_objs.append(box("sh_rim_b", (0.085, SH_W + 0.04, 0.055), M["iron"], loc=(0, 0, -SH_H / 2)))
    sh_objs.append(box("sh_rim_l", (0.085, 0.055, SH_H + 0.02), M["iron"], loc=(0, -SH_W / 2, 0)))
    sh_objs.append(box("sh_rim_r", (0.085, 0.055, SH_H + 0.02), M["iron"], loc=(0, SH_W / 2, 0)))
    sh_objs.append(ellipsoid("sh_boss", (0.1, 0.19, 0.19), M["rust"], loc=(0.04, 0, 0.0)))
    sh_objs.append(ellipsoid("sh_boss2", (0.07, 0.09, 0.09), M["iron"], loc=(0.08, 0, 0.0)))
    for z in (-0.27, 0.27):
        for y in (-0.16, 0.0, 0.16):
            sh_objs.append(ellipsoid("sh_rivet", (0.04, 0.035, 0.035), M["rust"], loc=(0.04, y, z)))
    shield = L.joined("shieldm", sh_objs)
    A(shield, "shield", (0, 0, 0), rot=(0, 0, -52))
    # mace (near hand), shaft along +Z then rotated forward
    mace = [L.limb("mace_h", 0.4, 0.025, 0.025, M["leather"])]
    mace[0].location = (0, 0, 0.34)
    mace.append(ellipsoid("mace_head", (0.16, 0.16, 0.18), M["iron"], loc=(0, 0, 0.4)))
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        mace.append(box("mace_fl%d" % k, (0.06, 0.06, 0.17), M["rust"],
                        loc=(0.085 * math.cos(a), 0.085 * math.sin(a), 0.4)))
    mace.append(cone("mace_tip", 0.04, 0.0, 0.08, M["iron"], loc=(0, 0, 0.48)))
    mace.append(ellipsoid("mace_pommel", (0.045, 0.045, 0.04), M["iron"], loc=(0, 0, -0.06)))
    macem = L.joined("macem", mace)
    A(macem, "ha_n", (0.0, -0.02, -0.05), rot=(0, 100, 0))
    # mace swing smear
    sm = L.tube("smear", L.arc_pts((0, 0, 0), 0.72, 150, -20, 9),
                [0.003, 0.03, 0.05, 0.06, 0.065, 0.06, 0.05, 0.03, 0.003], M["smear"], depth=0.3)
    A(sm, "chest", (0.0, -0.3, 0.05))
    feet = [o["foot_n"], o["foot_f"]]
    return r, M, feet, sm, shield


RIG = None


def sd1(sd):
    return sd + "1"


BASE = {"hips": -3, "spine": -2, "chest": 2, "neck": 2, "head": -2,
        "th_n": 16, "kn_n": -20, "th_f": -12, "kn_f": -10,
        "sh_n": 12, "el_n": 62, "ha_n": 6, "sh_f": 48, "el_f": 40,
        "hips.dz": -0.03, "shield": 0, "shield.dx": 0.0, "shield.dz": 0.0}


def finish(p, sway=0.0):
    L.hang(p, [("braid_n", 6), ("braid_n1", 0)], L.HEAD_CHAIN, sway)
    L.hang(p, [("braid_f", 8), ("braid_f1", 0)], L.HEAD_CHAIN, sway * 0.8)
    p["skirt"] = -0.4 * p.get("hips", 0)
    p["tab"] = 0.5 * max(p.get("th_n", 0), p.get("th_f", 0)) - p.get("hips", 0) * 0.5
    # shield follows the hips' bob (it is parented to root so it can be dropped on death)
    p["shield.dz"] = p.get("shield.dz", 0.0) + p.get("hips.dz", 0.0)
    p["shield.dx"] = p.get("shield.dx", 0.0) + p.get("hips.dx", 0.0)
    if RIG is not None and p.pop("_grip", 1.0) > 0.5:
        RIG.pose(*L.split(p))
        L.ik2(RIG, p, "sh_f", "el_f", "ha_f", L.joint_xz(RIG, "shield", (-0.07, 0, 0.06)), bend=1.0)
    return p


def idle(i, n):
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    p = dict(BASE)
    p.update({"chest": 2 + 2 * s, "head": -2 - 2 * s, "sh_n": 12 + 3 * s, "el_n": 62 + 4 * s,
              "hips.dz": -0.03 - 0.012 * (1 - c) / 2, "shield.dz": -0.006 * (1 - c)})
    L.feet_flat(p)
    return finish(p, 3 * s)


def walk(i, n):
    t = i / n
    a = 2 * math.pi * t
    s, c = math.sin(a), math.cos(a)
    p = dict(BASE)
    lg = L.walk_legs(t, stride=24, knee=40)
    p.update(lg)
    p.update({"hips": -5, "chest": 2 + 2 * c, "sh_n": 12 - 14 * s, "el_n": 62 + 6 * s,
              "hips.dz": -0.035 + 0.025 * abs(c), "shield": 2 * s, "shield.dx": 0.02 * s, "hips:z": 0})
    p["an_n"] -= 4
    p["an_f"] -= 4
    return finish(p, 6 * c)


ATK = [
    (0.00, dict(BASE)),
    # coil: shield pulled in, mace raised high behind the head
    (0.20, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 6, "head": -4, "th_n": 26, "kn_n": -34, "th_f": -14,
                          "kn_f": -22, "sh_n": 150, "el_n": 70, "ha_n": 20, "shield.dx": -0.08, "shield": 4,
                          "hips.dz": -0.07})),
    (0.45, L.merge(BASE, {"hips": 6, "spine": 8, "chest": 12, "head": -8, "th_n": 30, "kn_n": -40, "th_f": -16,
                          "kn_f": -28, "sh_n": 186, "el_n": 76, "ha_n": 30, "shield.dx": -0.12, "shield": 6,
                          "hips.dz": -0.09, "hips.dx": -0.06})),
    # active 1: shield bash (lunge, shield thrust forward)
    (0.50, L.merge(BASE, {"hips": -10, "spine": -8, "chest": -6, "head": 8, "th_n": 46, "kn_n": -50, "th_f": -26,
                          "kn_f": -6, "sh_n": 190, "el_n": 60, "ha_n": 30, "shield.dx": 0.26, "shield": -8,
                          "hips.dz": -0.1, "hips.dx": 0.12})),
    # active 2-3: mace comes down over the shield
    (0.575, L.merge(BASE, {"hips": -12, "spine": -10, "chest": -10, "head": 10, "th_n": 48, "kn_n": -52,
                           "th_f": -28, "kn_f": -6, "sh_n": 128, "el_n": 18, "ha_n": 0, "shield.dx": 0.2, "shield": -4,
                           "hips.dz": -0.1, "hips.dx": 0.14})),
    (0.65, L.merge(BASE, {"hips": -14, "spine": -12, "chest": -12, "head": 12, "th_n": 48, "kn_n": -54,
                          "th_f": -28, "kn_f": -6, "sh_n": 84, "el_n": 6, "ha_n": -10, "shield.dx": 0.16, "shield": -2,
                          "hips.dz": -0.1, "hips.dx": 0.15})),
    (0.80, L.merge(BASE, {"hips": -10, "spine": -8, "chest": -8, "head": 8, "th_n": 38, "kn_n": -44,
                          "th_f": -24, "kn_f": -8, "sh_n": 50, "el_n": 30, "shield.dx": 0.08,
                          "hips.dz": -0.08, "hips.dx": 0.1})),
    (1.00, dict(BASE)),
]


def attack(i, n):
    t = L.phase_t(i, *WA)
    p = L.keys_at(ATK, t)
    L.feet_flat(p)
    return finish(p, -10 if i >= WA[0] else 4)


BLOCK = [
    (0.0, dict(BASE)),
    # braced: deep crouch, shield raised and pushed forward, head ducked behind its rim
    (0.33, L.merge(BASE, {"hips": -14, "spine": -10, "chest": -8, "neck": 10, "head": 10, "th_n": 40, "kn_n": -64,
                          "th_f": -26, "kn_f": -30, "sh_n": -24, "el_n": 96, "shield.dx": 0.08, "shield.dz": 0.12,
                          "shield": -5, "hips.dz": -0.14, "hips.dx": -0.02})),
    # impact: shoved back a little
    (0.66, L.merge(BASE, {"hips": -8, "spine": -6, "chest": -4, "neck": 8, "head": 6, "th_n": 34, "kn_n": -60,
                          "th_f": -28, "kn_f": -28, "sh_n": -30, "el_n": 100, "shield.dx": 0.02, "shield.dz": 0.13,
                          "shield": 4, "hips.dz": -0.14, "hips.dx": -0.06})),
    (1.0, L.merge(BASE, {"hips": -14, "spine": -10, "chest": -8, "neck": 10, "head": 10, "th_n": 40, "kn_n": -64,
                         "th_f": -26, "kn_f": -30, "sh_n": -24, "el_n": 96, "shield.dx": 0.07, "shield.dz": 0.12,
                         "shield": -4, "hips.dz": -0.14, "hips.dx": -0.02})),
]


def block(i, n):
    p = L.keys_at(BLOCK, i / (n - 1))
    L.feet_flat(p)
    return finish(p, 0)


def hurt(i, n):
    k = [(0.0, L.merge(BASE, {"hips": 4, "spine": 6, "chest": 10, "neck": -6, "head": -18, "sh_n": 40, "el_n": 80,
                              "shield.dx": -0.06, "shield": 8, "hips.dx": -0.06, "th_n": 6, "th_f": -4})),
         (0.5, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 6, "neck": -4, "head": -10, "sh_n": 30, "el_n": 74,
                              "shield.dx": -0.04, "shield": 5, "hips.dx": -0.04})),
         (1.0, dict(BASE))]
    p = L.keys_at(k, i / (n - 1) * 0.85)
    L.feet_flat(p)
    return finish(p, 10)


DEATH = [
    (0.00, L.merge(BASE, {"hips": 4, "spine": 6, "chest": 10, "neck": -6, "head": -18, "sh_n": 40, "el_n": 80,
                          "shield.dx": -0.06, "shield": 8, "hips.dx": -0.06})),
    # stagger: knees give, shield slips out of her grip and tips forward
    (0.30, L.merge(BASE, {"hips": 10, "spine": 8, "chest": 6, "neck": -4, "head": -16, "th_n": 30, "kn_n": -50,
                          "th_f": 10, "kn_f": -40, "sh_n": 70, "el_n": 40, "sh_f": 60, "el_f": 30,
                          "shield.dx": 0.14, "shield": -30, "hips.dz": -0.1, "_grip": 0})),
    # topples backward like a felled tree
    (0.65, L.merge(BASE, {"hips": 52, "spine": 6, "chest": 4, "neck": -6, "head": -10, "th_n": -12, "kn_n": -30,
                          "th_f": -24, "kn_f": -20, "sh_n": 120, "el_n": 30, "sh_f": 100, "el_f": 30,
                          "shield.dx": 0.3, "shield": -75, "_grip": 0})),
    (0.85, L.merge(BASE, {"hips": 88, "spine": 4, "chest": 2, "neck": -4, "head": -6, "th_n": -18, "kn_n": -14,
                          "th_f": -26, "kn_f": -10, "sh_n": 150, "el_n": 20, "sh_f": 130, "el_f": 20,
                          "shield.dx": 0.38, "shield": -90, "_grip": 0})),
    (1.00, L.merge(BASE, {"hips": 90, "spine": 0, "chest": 0, "neck": -2, "head": -4, "th_n": -10, "kn_n": -8,
                          "th_f": -16, "kn_f": -6, "sh_n": 160, "el_n": 10, "sh_f": 140, "el_f": 14,
                          "shield.dx": 0.4, "shield": -90, "_grip": 0})),
]


def death(i, n):
    p = L.keys_at(DEATH, i / (n - 1))
    p["_grip"] = 1.0 if i == 0 else 0.0
    L.feet_flat(p)
    if i >= 4:
        for sd in ("n", "f"):
            p["an_" + sd] = 20
    p["hips.dx"] = p.get("hips.dx", 0) - 0.12 * L.ease(min(1.0, i / (n - 1) * 1.4))
    return finish(p, 0)


def main():
    global RIG
    r, M, feet, sm, shield = build()
    RIG = r
    sh = L.Sheet("jailer", r)
    sh.prop(sm, False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and o.name not in ("smear", "shieldm")]
    sh.render("idle", 8, idle, fps=8, loop=True, ground_objs=feet)
    sh.render("walk", 10, walk, fps=9, loop=True, ground_objs=feet)
    sh.render("attack", sum(WA), attack, fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {"smear": i == WA[0] + 1})
    sh.render("block", 4, block, fps=12, ground_objs=feet)
    sh.render("hurt", 3, hurt, fps=12, ground_objs=feet)
    sh.render("death", 9, death, fps=10, grounds=[("hips", allm), ("shield", [shield])])
    sh.write_spec()


L.run(main)
