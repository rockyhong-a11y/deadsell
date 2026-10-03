"""DEADSELL enemy: ghoul (구울) -- undead female prisoner, hunched shambler with long claws.

blender -b --factory-startup -P tools/blender/asset_ghoul.py
-> build/frames/ghoul/*.png + spec.json   (pack: python3 tools/pack/pack_all.py ghoul)

Animations: idle walk attack(windup/active/recover) hurt death
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_enemies import *  # noqa: E402,F401,F403
import lib_enemies as L  # noqa: E402

S = 1.1          # body scale (1.75 u standing -> hunched ~1.62 u)
WA = (5, 2, 4)   # attack windup / active / recover


def build():
    L.setup_scene()
    M = {
        "skin": L.mat("g_skin", "#8d9c86", "#4c4e63", "#b9c6ac"),
        "dress": L.mat("g_dress", "#6b5f7c", "#362c4a", "#8f84a3"),
        "rag": L.mat("g_rag", "#544863", "#2a2238", "#74688a"),
        "hair": L.mat("g_hair", "#24212f", "#110e1b", "#433d5a"),
        "claw": L.mat("g_claw", "#e2d7b6", "#8a7466", "#fff6dc"),
        "iron": L.mat("g_iron", "#55566a", "#2a2838", "#8d8fa6"),
        "eye": L.glow("g_eye", "#ffa531"),
        "smear": L.glow("g_smear", "#f2d9ff"),
    }
    r = L.ERig("ghoul")
    L.skeleton(r, s=S, w=0.95, arm=1.18)
    J, A = r.joint, r.attach
    # hair chains (hang from the head, posed to counter its rotation)
    J("hb", "head", (-0.09 * S, 0, 1.70 * S))
    J("hb1", "hb", (-0.12 * S, 0, 1.38 * S))
    J("hf", "head", (0.09 * S, 0, 1.72 * S))
    J("hf1", "hf", (0.13 * S, 0, 1.50 * S))
    J("skirt", "hips", (0, 0, 0.92 * S))

    body = L.body(r, {"skin": M["skin"], "chest": M["dress"], "waist": M["dress"], "pelvis": M["dress"],
                      "bust": M["dress"], "foot": M["skin"]},
                  s=S, w=0.92, bust=0.95, hip=1.05, arm_r=0.85, leg_r=0.8, feet=False, arm=1.18)
    # bare feet (rounded, toes forward)
    for sd in ("n", "f"):
        body["foot_" + sd] = A(ellipsoid("foot_" + sd, (0.17 * S, 0.07 * S, 0.06 * S), M["skin"]), "an_" + sd,
                               (0.05 * S, 0, -0.035 * S))
    # torn dress: sleeveless top + long torn skirt
    A(ellipsoid("strap", (0.2 * S, 0.27 * S, 0.12 * S), M["dress"]), "chest", (-0.01 * S, 0, 0.16 * S))
    A(L.skirt("skirt_m", 0.135 * S, 0.2 * S, 0.46 * S, M["dress"], n=18, jag=0.1 * S, seed=3, bulge=0.05 * S,
              front=0.9, back=1.12), "skirt", (0, 0, 0.0))
    A(L.skirt("skirt_rag", 0.15 * S, 0.19 * S, 0.3 * S, M["rag"], n=14, jag=0.08 * S, seed=7, bulge=0.045 * S),
      "skirt", (-0.01 * S, 0, 0.02 * S))
    A(L.tube("rag_strip", [(0, 0, 0), (-0.04 * S, 0, -0.2 * S), (-0.03 * S, 0, -0.38 * S)],
             [0.035 * S, 0.03 * S, 0.012 * S], M["rag"], depth=0.4), "skirt", (-0.2 * S, -0.06 * S, -0.3 * S))
    # head: hair cap + bangs + long matted locks
    A(ellipsoid("hair_cap", (0.26 * S, 0.245 * S, 0.21 * S), M["hair"]), "head", (-0.025 * S, 0, 0.165 * S))
    A(ellipsoid("bangs", (0.12 * S, 0.22 * S, 0.12 * S), M["hair"]), "head", (0.075 * S, 0, 0.17 * S))
    for i, (y, ln, x) in enumerate(((-0.1, 0.5, 0.01), (0.0, 0.58, -0.02), (0.1, 0.46, 0.0))):
        A(L.tube("hb_lock%d" % i, [(0, y * S, 0), ((x - 0.03) * S, y * S, -0.2 * S), ((x - 0.01) * S, y * S, -ln * S)],
                 [0.085 * S, 0.075 * S, 0.02 * S], M["hair"], depth=0.9), "hb")
    A(ellipsoid("hb_mass", (0.2 * S, 0.24 * S, 0.3 * S), M["hair"]), "hb", (-0.01 * S, 0, -0.12 * S))
    # front locks hanging over the face
    # front locks hang over the cheeks (near + far side) framing a glowing eye
    for i, (x, y, ln, rr) in enumerate(((-0.02, -0.115, 0.42, 0.045), (0.0, 0.105, 0.36, 0.04),
                                        (-0.06, -0.12, 0.5, 0.04))):
        A(L.tube("hf_lock%d" % i, [(x * S, y * S, 0.02 * S), ((x + 0.03) * S, y * S, -0.14 * S),
                                    ((x + 0.035) * S, y * S, -ln * S)],
                 [rr * S, rr * S * 0.9, 0.012 * S], M["hair"], depth=0.7), "hf")
    L.eyes(r, M["eye"], s=S, x=0.115, z=0.12, h=0.065, wdt=0.04, span=0.14)
    # long arms, manacles, claws
    for sd in ("n", "f"):
        A(L.limb("cuff_" + sd, 0.06 * S, 0.048 * S, 0.048 * S, M["iron"]), "el_" + sd, (0, 0, -0.14 * S))
        A(ellipsoid("palm_" + sd, (0.1 * S, 0.075 * S, 0.11 * S), M["skin"]), "ha_" + sd, (0.0, 0, -0.045 * S))
        for k, (dx, dy, rot) in enumerate(((0.035, -0.025, 30), (0.0, 0.0, 5), (-0.035, 0.025, -22))):
            A(L.claw("claw_%s%d" % (sd, k), 0.22 * S, 0.02 * S, M["claw"], bend=0.6), "ha_" + sd,
              (dx * S, dy * S, -0.085 * S), rot=(0, rot, 0))
    # claw swipe smear (only on the first active frame)
    sm = L.tube("smear", L.arc_pts((0, 0, 0), 0.62 * S, 115, -35, 9),
                [0.003, 0.02 * S, 0.035 * S, 0.045 * S, 0.05 * S, 0.045 * S, 0.035 * S, 0.02 * S, 0.003],
                M["smear"], depth=0.3)
    A(sm, "chest", (0.12 * S, -0.25 * S, -0.05 * S))
    feet = [body["foot_n"], body["foot_f"]]
    return r, M, feet, sm


def hang(p, joints, chain, sway=0.0):
    """Make hair joints hang (counter the accumulated screen-plane rotation of their parents)."""
    acc = sum(p.get(k, 0.0) for k in chain)
    for j, extra in joints:
        p[j] = -acc + sway + extra
        acc += p[j]
    return p


HEAD_CHAIN = ("root", "hips", "spine", "chest", "neck", "head")

HUNCH = {"hips": -10, "spine": -14, "chest": -30, "neck": 24, "head": 22,
         "th_n": 22, "kn_n": -34, "th_f": 6, "kn_f": -24,
         "sh_n": 62, "el_n": 22, "sh_f": 50, "el_f": 28, "ha_n": 10, "ha_f": 12,
         "hips.dx": -0.02}


def feet_flat(p, toe_n=0.0, toe_f=0.0):
    for sd, toe in (("n", toe_n), ("f", toe_f)):
        p["an_" + sd] = -(p.get("root", 0) + p.get("hips", 0) + p.get("th_" + sd, 0) + p.get("kn_" + sd, 0)) + toe
    return p


def finish(p, sway=0.0, sway_f=None):
    hang(p, [("hb", 4), ("hb1", 0)], HEAD_CHAIN, sway)
    hang(p, [("hf", -4), ("hf1", 0)], HEAD_CHAIN, sway if sway_f is None else sway_f)
    p["skirt"] = -0.35 * p.get("hips", 0)
    return p


def idle(i, n):
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    p = dict(HUNCH)
    p.update({"spine": -14 + 3 * s, "chest": -30 + 3 * s, "head": 22 - 4 * s + (8 if i in (5,) else 0),
              "sh_n": 62 - 6 * s, "sh_f": 50 - 5 * s, "el_n": 22 + 6 * c, "el_f": 28 + 5 * c,
              "hips.dz": -0.015 + 0.012 * c, "neck": 24 + 2 * c})
    feet_flat(p)
    return finish(p, sway=4 * c)


def walk(i, n):
    t = i / n
    a = 2 * math.pi * t
    s, c = math.sin(a), math.cos(a)
    p = dict(HUNCH)
    legs = L.walk_legs(t, stride=24, knee=44)
    for k, v in legs.items():
        p[k] = v + (14 if k.startswith("th") else -16 if k.startswith("kn") else 0)
    # limp: near leg drags (shorter swing)
    p["th_n"] = p["th_n"] * 0.8
    p.update({"spine": -16 + 4 * abs(s), "chest": -30 + 3 * c, "head": 22 - 5 * abs(c),
              "sh_n": 62 - 18 * s, "sh_f": 50 + 18 * s, "el_n": 26 + 10 * max(0, s), "el_f": 30 + 10 * max(0, -s),
              "hips.dz": -0.03 + 0.03 * abs(c), "neck": 24 + 4 * s})
    p["an_n"] = p.get("an_n", 0) - 14
    p["an_f"] = p.get("an_f", 0) - 14
    return finish(p, sway=8 * c)


ATK = [
    (0.00, dict(HUNCH)),
    # anticipation: sink, arms pulled back low
    (0.15, L.merge(HUNCH, {"hips": -14, "spine": -24, "chest": -18, "th_n": 30, "kn_n": -50, "th_f": 10, "kn_f": -40,
                           "sh_n": -30, "el_n": 40, "sh_f": -20, "el_f": 40, "hips.dz": -0.08})),
    # rear up, both clawed arms raised high overhead (big readable wind-up)
    (0.34, L.merge(HUNCH, {"hips": 0, "spine": 4, "chest": 6, "neck": 0, "head": 2,
                           "th_n": 34, "kn_n": -26, "th_f": -16, "kn_f": -18,
                           "sh_n": 112, "el_n": 52, "sh_f": 160, "el_f": 22, "ha_n": -40, "ha_f": -20,
                           "hips.dz": 0.0, "hips.dx": -0.05})),
    (0.45, L.merge(HUNCH, {"hips": 3, "spine": 6, "chest": 9, "neck": -4, "head": 0,
                           "th_n": 36, "kn_n": -22, "th_f": -18, "kn_f": -14,
                           "sh_n": 118, "el_n": 56, "sh_f": 172, "el_f": 24, "ha_n": -46, "ha_f": -24,
                           "hips.dz": 0.01, "hips.dx": -0.07})),
    # swipe: lunge forward, claws rake down in front
    (0.50, L.merge(HUNCH, {"hips": -16, "spine": -26, "chest": -22, "neck": 22, "head": 18,
                           "th_n": 50, "kn_n": -54, "th_f": -26, "kn_f": -10,
                           "sh_n": 110, "el_n": 4, "sh_f": 96, "el_f": 6, "ha_n": -10, "ha_f": -10,
                           "hips.dx": 0.1, "hips.dz": -0.1})),
    (0.65, L.merge(HUNCH, {"hips": -20, "spine": -30, "chest": -24, "neck": 24, "head": 20,
                           "th_n": 54, "kn_n": -60, "th_f": -30, "kn_f": -8,
                           "sh_n": 62, "el_n": 6, "sh_f": 50, "el_f": 8, "ha_n": -16, "ha_f": -16,
                           "hips.dx": 0.13, "hips.dz": -0.12})),
    (0.80, L.merge(HUNCH, {"hips": -16, "spine": -26, "chest": -22, "neck": 22, "head": 22,
                           "th_n": 44, "kn_n": -54, "th_f": -20, "kn_f": -14,
                           "sh_n": 36, "el_n": 14, "sh_f": 28, "el_f": 18,
                           "hips.dx": 0.08, "hips.dz": -0.1})),
    (1.00, dict(HUNCH)),
]


def attack(i, n):
    t = L.phase_t(i, *WA)
    p = L.keys_at(ATK, t)
    if i == WA[0] - 1:  # hold the peak with a slight tremble
        p["sh_n"] += 4
        p["chest"] += 2
    feet_flat(p)
    return finish(p, sway=-14 if WA[0] <= i < WA[0] + 2 else 6)


def hurt(i, n):
    k = [(0.0, L.merge(HUNCH, {"hips": 2, "spine": 4, "chest": 10, "neck": -10, "head": -24,
                               "sh_n": 80, "el_n": 40, "sh_f": 64, "el_f": 50, "hips.dx": -0.08,
                               "th_n": 10, "kn_n": -20, "th_f": 14, "kn_f": -30})),
         (0.5, L.merge(HUNCH, {"hips": 0, "spine": 0, "chest": 6, "neck": -4, "head": -14,
                               "sh_n": 70, "el_n": 34, "sh_f": 56, "el_f": 40, "hips.dx": -0.06,
                               "th_n": 14, "kn_n": -26, "th_f": 12, "kn_f": -28})),
         (1.0, dict(HUNCH))]
    p = L.keys_at(k, i / (n - 1) * 0.85)
    feet_flat(p)
    return finish(p, sway=12)


DEATH = [
    (0.00, L.merge(HUNCH, {"hips": 2, "spine": 6, "chest": 10, "neck": -10, "head": -24, "sh_n": 80, "el_n": 40,
                           "sh_f": 64, "el_f": 50, "hips.dx": -0.08})),
    # knees buckle
    (0.30, L.merge(HUNCH, {"hips": -6, "spine": -10, "chest": -18, "neck": 10, "head": 30,
                           "th_n": 80, "kn_n": -150, "th_f": 70, "kn_f": -140,
                           "sh_n": 40, "el_n": 20, "sh_f": 30, "el_f": 24})),
    # pitches forward
    (0.60, L.merge(HUNCH, {"hips": -50, "spine": -14, "chest": -16, "neck": 16, "head": 24,
                           "th_n": 44, "kn_n": -80, "th_f": 36, "kn_f": -70,
                           "sh_n": 110, "el_n": 30, "sh_f": 90, "el_f": 30})),
    # face down on the floor, slumped, hair spread
    (0.82, L.merge(HUNCH, {"hips": -88, "spine": -2, "chest": -4, "neck": 8, "head": 12,
                           "th_n": 8, "kn_n": -24, "th_f": 4, "kn_f": -30,
                           "sh_n": 168, "el_n": 16, "sh_f": 160, "el_f": 22})),
    (1.00, L.merge(HUNCH, {"hips": -90, "spine": 0, "chest": 0, "neck": 4, "head": 8,
                           "th_n": 4, "kn_n": -14, "th_f": 2, "kn_f": -20,
                           "sh_n": 178, "el_n": 6, "sh_f": 172, "el_f": 10, "hips.sz": 0.92})),
]


def death(i, n):
    p = L.keys_at(DEATH, i / (n - 1))
    for sd in ("n", "f"):
        p["an_" + sd] = 40 * min(1, i / (n - 1) * 2)
    p["hips.dx"] = p.get("hips.dx", 0) - 0.62 * L.ease(min(1.0, i / (n - 1) * 1.25))
    f = i / (n - 1)
    p = finish(p, sway=0)
    if f > 0.7:  # hair falls onto the floor in front of the head instead of hanging
        for j in ("hb", "hf"):
            p[j] = p[j] * (1 - (f - 0.7) / 0.3) + 0 * (f - 0.7) / 0.3
    return p


def main():
    r, M, feet, sm = build()
    sh = L.Sheet("ghoul", r)
    sh.prop(sm, False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and o.name != "smear"]
    sh.render("idle", 8, idle, fps=8, loop=True, ground_objs=feet)
    sh.render("walk", 10, walk, fps=10, loop=True, ground_objs=feet)
    sh.render("attack", sum(WA), attack, fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {"smear": i == WA[0]})
    sh.render("hurt", 3, hurt, fps=12, ground_objs=feet)
    sh.render("death", 9, death, fps=10, grounds=[("hips", allm)])
    sh.write_spec()


L.run(main)
