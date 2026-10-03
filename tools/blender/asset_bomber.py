"""DEADSELL enemy: bomber (폭탄마) -- wild-haired alchemist-bomber girl: goggles, apron,
bandolier of round bombs, satchel.  Lobs bombs overhand.

blender -b --factory-startup -P tools/blender/asset_bomber.py
-> build/frames/bomber/*.png + spec.json   (pack: python3 tools/pack/pack_all.py bomber)

Animations: idle walk throw(windup/active/recover) hurt death
The bomb is visible in her hand during the throw wind-up only (the game spawns the
projectile on release).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

S = 0.94
WA = (5, 2, 4)
RIG = None


def build():
    global RIG
    L.setup_scene()
    M = {
        "skin": L.mat("b_skin", "#f0c4a4", "#99606c", "#ffe2cc"),
        "hair": L.mat("b_hair", "#e2487e", "#7e1c4c", "#ff8fb4"),
        "dress": L.mat("b_dress", "#c98a26", "#6a3a26", "#f0b84a"),
        "apron": L.mat("b_apron", "#e4d6b8", "#8e7a74", "#fff6e2"),
        "stain": L.mat("b_stain", "#9c8a6a", "#4e4040", "#bca88a"),
        "leather": L.mat("b_leather", "#6a4229", "#331d22", "#93603a"),
        "dark": L.mat("b_dark", "#2c2638", "#15121e", "#463d58"),
        "brass": L.mat("b_brass", "#c99a3c", "#6c4a2a", "#f6d47a"),
        "lens": L.mat("b_lens", "#4fd1c8", "#1e6a74", "#b6fff4", rim=False),
        "bomb": L.mat("b_bomb", "#34303f", "#16131e", "#5a5470"),
        "cap": L.mat("b_cap", "#b83a32", "#5a1a2a", "#e65a48"),
        "eye": L.glow("b_eye", "#ff8a2a"),
        "spark": L.glow("b_spark", "#ffe36a"),
        "spark2": L.glow("b_spark2", "#ff8a2a"),
        "smear": L.glow("b_smear", "#fff0d0"),
    }
    r = L.ERig("bomber")
    RIG = r
    L.skeleton(r, s=S, w=0.95)
    J, A = r.joint, r.attach
    J("hairb", "head", (-0.12 * S, 0, 1.62 * S))
    J("skirt", "hips", (0, 0, 0.93 * S))
    J("apron", "chest", (0.12 * S, 0, 1.2 * S))
    J("bomb", "ha_n", (0.0, -0.12 * S, 0.9 * S))

    o = L.body(r, {"skin": M["skin"], "chest": M["dress"], "waist": M["dress"], "pelvis": M["dark"],
                   "ua": M["dress"], "fa": M["skin"], "hand": M["leather"], "thigh": M["dark"],
                   "shin": M["dark"], "foot": M["leather"]},
               s=S, w=0.95, bust=1.0, hip=1.08, arm_r=0.95, leg_r=0.95)
    A(L.skirt("skirt_m", 0.15 * S, 0.26 * S, 0.27 * S, M["dress"], n=16, bulge=0.03 * S, front=0.9, back=1.1,
              jag=0.02 * S, seed=4), "skirt")
    # rolled sleeves, boots
    for sd in ("n", "f"):
        A(ellipsoid("sleeve_" + sd, (0.11 * S, 0.11 * S, 0.08 * S), M["apron"]), "el_" + sd, (0, 0, 0.02 * S))
        A(L.limb("boot_" + sd, 0.24 * S, 0.06 * S, 0.055 * S, M["leather"]), "kn_" + sd, (0, 0, -0.17 * S))
    # apron (front panel from chest to above the knees) with a stain, and its waist tie
    A(L.bake(box("apron_m", (0.03 * S, 0.22 * S, 0.62 * S), M["apron"], loc=(0, 0, -0.31 * S), bevel=0.01)),
      "apron", (0.0, 0, 0))
    A(ellipsoid("apron_stain", (0.035 * S, 0.1 * S, 0.08 * S), M["stain"]), "apron", (0.01 * S, 0.02 * S, -0.42 * S))
    A(ellipsoid("apron_tie", (0.22 * S, 0.28 * S, 0.045 * S), M["apron"]), "spine", (0, 0, -0.04 * S))
    # bandolier: strap over the near shoulder + bombs across the torso
    strap = L.tube("strap", [(-0.13, -0.15, 0.2), (0.0, -0.165, 0.08), (0.13, -0.13, -0.05), (0.15, -0.05, -0.22)],
                   0.025 * S, M["leather"], segs=6)
    A(strap, "chest")
    for k, (x, z) in enumerate(((0.03, 0.06), (0.11, -0.02), (0.14, -0.13))):
        A(ellipsoid("band_bomb%d" % k, (0.125 * S, 0.125 * S, 0.125 * S), M["bomb"]), "chest", (x * S, -0.17 * S, z * S))
        A(ellipsoid("band_cap%d" % k, (0.05 * S, 0.05 * S, 0.04 * S), M["cap"]), "chest",
          (x * S, -0.17 * S, (z + 0.07) * S))
    # satchel on the back hip
    A(box("satchel", (0.16 * S, 0.1 * S, 0.17 * S), M["leather"], bevel=0.02), "hips", (-0.17 * S, 0.1 * S, -0.06 * S))
    A(box("satchel_flap", (0.17 * S, 0.11 * S, 0.06 * S), M["stain"], bevel=0.01), "hips",
      (-0.17 * S, 0.1 * S, 0.02 * S))
    # wild spiky hair
    A(ellipsoid("hair_cap", (0.27 * S, 0.26 * S, 0.22 * S), M["hair"]), "head", (-0.03 * S, 0, 0.165 * S))
    A(ellipsoid("bangs", (0.1 * S, 0.22 * S, 0.07 * S), M["hair"]), "head", (0.075 * S, 0, 0.19 * S))
    rnd = random.Random(11)
    # spikes radiate from the crown: angle measured from +X in the XZ plane (90 = up, 180 = back)
    spikes = [(95, 0.27), (118, 0.32), (140, 0.34), (162, 0.32), (184, 0.28), (206, 0.24), (74, 0.2),
              (130, 0.3), (152, 0.3), (172, 0.27)]
    for k, (ang, ln) in enumerate(spikes):
        a_ = math.radians(ang)
        y = (rnd.random() - 0.5) * 0.24
        d = (math.cos(a_), math.sin(a_))
        base = (-0.03 + 0.07 * d[0], y, 0.165 + 0.08 * d[1])
        mid = (base[0] + d[0] * ln * 0.5 + 0.0, y * 1.2, base[2] + d[1] * ln * 0.5 + 0.02)
        tipp = (base[0] + d[0] * ln, y * 1.4, base[2] + d[1] * ln - 0.02)
        A(L.tube("spike%d" % k, [tuple(c * S for c in base), tuple(c * S for c in mid), tuple(c * S for c in tipp)],
                 [0.075 * S, 0.05 * S, 0.004], M["hair"], segs=6), "head")
    # loose tufts hanging down the back of the head (swing with the body)
    for k, (dx, dz, ln) in enumerate(((-0.1, -0.26, 0.3), (-0.2, -0.2, 0.28), (-0.04, -0.32, 0.26))):
        yy = (k - 1) * 0.09
        A(L.tube("hb%d" % k, [(0, yy * S, 0), (dx * 0.5 * S, yy * S, dz * 0.5 * S), (dx * S, (yy * 1.3) * S, dz * S)],
                 [0.07 * S, 0.055 * S, 0.004], M["hair"], segs=6), "hairb")
    # goggles pushed up on the forehead
    A(ellipsoid("gog_band", (0.275 * S, 0.27 * S, 0.05 * S), M["leather"]), "head", (-0.02 * S, 0, 0.235 * S))
    for y in (-0.06, 0.06):
        A(L.disc("gog_rim", 0.075 * S, 0.06 * S, M["brass"], rot=(0, 70, 0)), "head", (0.115 * S, y * S, 0.255 * S))
        A(L.disc("gog_lens", 0.056 * S, 0.065 * S, M["lens"], rot=(0, 70, 0)), "head", (0.126 * S, y * S, 0.257 * S))
    L.eyes(r, M["eye"], s=S, x=0.108, z=0.115, h=0.05, wdt=0.03, span=0.12)
    # bomb in hand with a lit fuse (ball sits in the palm; fuse points up)
    BS = 1.35
    bomb = [ellipsoid("bomb_m", (0.17 * S * BS, 0.17 * S * BS, 0.17 * S * BS), M["bomb"]),
            ellipsoid("bomb_hl", (0.05 * S * BS, 0.05 * S * BS, 0.04 * S * BS), M["lens"],
                      loc=(0.035 * S * BS, -0.06 * S * BS, 0.05 * S * BS)),
            L.limb("bomb_cap", 0.03 * S * BS, 0.035 * S * BS, 0.035 * S * BS, M["cap"]),
            L.tube("fuse", [(0, 0, 0.1 * S * BS), (0.025 * S * BS, 0, 0.145 * S * BS), (0.0, 0, 0.18 * S * BS)],
                   0.012 * S * BS, M["leather"]),
            ellipsoid("spark", (0.08 * S * BS, 0.08 * S * BS, 0.08 * S * BS), M["spark"], loc=(0, 0, 0.19 * S * BS)),
            ellipsoid("spark2", (0.12 * S * BS, 0.04 * S * BS, 0.035 * S * BS), M["spark2"],
                      loc=(0, 0, 0.19 * S * BS), rot=(0, 45, 0)),
            ellipsoid("spark3", (0.12 * S * BS, 0.04 * S * BS, 0.035 * S * BS), M["spark2"],
                      loc=(0, 0, 0.19 * S * BS), rot=(0, -45, 0))]
    bomb[2].location = (0, 0, 0.1 * S * BS)
    bombm = L.joined("bombm", bomb)
    A(bombm, "bomb", (0.03 * S, -0.01 * S, -0.04 * S))
    # throw smear (arc over the head)
    sm = L.tube("smear", L.arc_pts((0, 0, 0), 0.6 * S, 160, 20, 9),
                [0.003, 0.025, 0.04, 0.05, 0.055, 0.05, 0.04, 0.025, 0.003], M["smear"], depth=0.3)
    A(sm, "chest", (0.0, -0.3 * S, 0.12 * S))
    feet = [o["foot_n"], o["foot_f"]]
    return r, M, feet, bombm, sm


BASE = {"hips": -4, "spine": -2, "chest": -2, "neck": 2, "head": 4,
        "th_n": 14, "kn_n": -22, "th_f": -10, "kn_f": -14,
        "sh_n": -14, "el_n": 70, "sh_f": -10, "el_f": 74, "hips.dz": -0.03}


def finish(p, sway=0.0):
    L.hang(p, [("hairb", -10 + sway)], L.HEAD_CHAIN, 0)
    p["skirt"] = -0.45 * p.get("hips", 0)
    p["apron"] = -(p.get("hips", 0) + p.get("spine", 0) + p.get("chest", 0)) * 0.6 + \
        0.35 * max(0, max(p.get("th_n", 0), p.get("th_f", 0)) - 10)
    # bomb keeps upright in the hand
    L.hang(p, [("bomb", 0)], ("root", "hips", "spine", "chest", "sh_n", "el_n", "ha_n"), 0)
    return p


def idle(i, n):
    """Manic little bounce, hands rubbing in front of her."""
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    b = abs(math.sin(t))
    p = dict(BASE)
    p.update({"hips.dz": -0.05 + 0.04 * b, "chest": -2 + 3 * b, "head": 4 - 6 * b + 3 * math.sin(2 * t),
              "th_n": 16 + 6 * (1 - b), "kn_n": -26 - 12 * (1 - b), "th_f": -8 + 6 * (1 - b), "kn_f": -18 - 12 * (1 - b),
              "sh_n": 18 + 8 * s, "el_n": 80 - 10 * s, "sh_f": 14 - 8 * s, "el_f": 84 + 10 * s,
              "ha_n": 10 * c, "ha_f": -10 * c})
    L.feet_flat(p)
    return finish(p, 6 * c)


def walk(i, n):
    """Bouncy skipping walk."""
    t = i / n
    a = 2 * math.pi * t
    s, c = math.sin(a), math.cos(a)
    p = dict(BASE)
    p.update(L.walk_legs(t, stride=30, knee=56))
    p.update({"hips": -6, "spine": -4, "chest": -2 + 3 * c, "head": 4 - 4 * c,
              "sh_n": -34 * s + 4, "el_n": 50 + 20 * max(0, s), "sh_f": 34 * s + 4, "el_f": 50 + 20 * max(0, -s),
              "hips.dz": -0.05 + 0.05 * abs(c)})
    p["an_n"] -= 6
    p["an_f"] -= 6
    return finish(p, 10 * c)


THROW = [
    (0.00, L.merge(BASE, {"sh_n": 20, "el_n": 70, "ha_n": 0})),
    # grab a bomb from the bandolier (it lights)
    (0.10, L.merge(BASE, {"chest": 4, "head": 8, "sh_n": 30, "el_n": 110, "th_n": 18, "kn_n": -30,
                          "hips.dz": -0.05})),
    # wind back: arm swings back, weight on the back leg, lean back
    (0.28, L.merge(BASE, {"hips": 2, "spine": 6, "chest": 8, "neck": -4, "head": -2, "th_n": 30, "kn_n": -20,
                          "th_f": -24, "kn_f": -30, "sh_n": -90, "el_n": -20, "sh_f": 50, "el_f": 30,
                          "hips.dz": -0.06, "hips.dx": -0.04})),
    # cocked overhead-back: bomb up behind the head, free arm pointing at the target
    (0.45, L.merge(BASE, {"hips": 6, "spine": 10, "chest": 14, "neck": -8, "head": -6, "th_n": 34, "kn_n": -16,
                          "th_f": -26, "kn_f": -34, "sh_n": -128, "el_n": -78, "ha_n": 0, "sh_f": 88, "el_f": 6,
                          "hips.dz": -0.05, "hips.dx": -0.08})),
    # release: arm whips over the top (angles keep decreasing: -180 = straight up, -270 = forward)
    (0.50, L.merge(BASE, {"hips": -6, "spine": -8, "chest": -10, "neck": 4, "head": 6, "th_n": 44, "kn_n": -40,
                          "th_f": -20, "kn_f": -12, "sh_n": -215, "el_n": -8, "ha_n": -10, "sh_f": 10, "el_f": 40,
                          "hips.dz": -0.07, "hips.dx": 0.06})),
    (0.65, L.merge(BASE, {"hips": -12, "spine": -12, "chest": -14, "neck": 8, "head": 10, "th_n": 48, "kn_n": -48,
                          "th_f": -22, "kn_f": -10, "sh_n": -275, "el_n": -4, "ha_n": -20, "sh_f": -20, "el_f": 50,
                          "hips.dz": -0.08, "hips.dx": 0.09})),
    (0.82, L.merge(BASE, {"hips": -8, "spine": -6, "chest": -8, "neck": 6, "head": 8, "th_n": 34, "kn_n": -36,
                          "th_f": -16, "kn_f": -14, "sh_n": -318, "el_n": 30, "sh_f": -16, "el_f": 60,
                          "hips.dz": -0.06, "hips.dx": 0.05})),
    (1.00, L.merge(BASE, {"sh_n": BASE["sh_n"] - 360})),
]


def throw(i, n):
    p = L.keys_at(THROW, L.phase_t(i, *WA))
    L.feet_flat(p)
    return finish(p, -8 if i >= WA[0] else 4)


def hurt(i, n):
    k = [(0.0, L.merge(BASE, {"hips": 4, "spine": 8, "chest": 12, "neck": -10, "head": -22, "sh_n": 60, "el_n": 60,
                              "sh_f": 50, "el_f": 70, "hips.dx": -0.08, "th_n": 4, "th_f": -4})),
         (0.5, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 6, "neck": -4, "head": -10, "sh_n": 40, "el_n": 66,
                              "sh_f": 30, "el_f": 72, "hips.dx": -0.05})),
         (1.0, dict(BASE))]
    p = L.keys_at(k, i / (n - 1) * 0.85)
    L.feet_flat(p)
    return finish(p, 12)


DEATH = [
    (0.00, L.merge(BASE, {"hips": 4, "spine": 8, "chest": 12, "neck": -10, "head": -22, "sh_n": 60, "el_n": 60,
                          "sh_f": 50, "el_f": 70, "hips.dx": -0.08})),
    # stumbles back, sits down hard
    (0.35, L.merge(BASE, {"hips": 20, "spine": 10, "chest": 6, "neck": -6, "head": -10, "th_n": 80, "kn_n": -70,
                          "th_f": 70, "kn_f": -80, "sh_n": 40, "el_n": 40, "sh_f": 30, "el_f": 40})),
    # tips over onto her back
    (0.70, L.merge(BASE, {"hips": 60, "spine": 10, "chest": 6, "neck": -8, "head": -12, "th_n": 60, "kn_n": -50,
                          "th_f": 50, "kn_f": -60, "sh_n": 100, "el_n": 30, "sh_f": 70, "el_f": 30})),
    (1.00, L.merge(BASE, {"hips": 88, "spine": 2, "chest": 2, "neck": -2, "head": -6, "th_n": 24, "kn_n": -30,
                          "th_f": 14, "kn_f": -40, "sh_n": 10, "el_n": 20, "sh_f": 4, "el_f": 10})),
]


def death(i, n):
    p = L.keys_at(DEATH, i / (n - 1))
    for sd in ("n", "f"):
        p["an_" + sd] = 20 * min(1, i / (n - 1) * 2)
    p["hips.dx"] = p.get("hips.dx", 0) + 0.25 * L.ease(min(1.0, i / (n - 1) * 1.2))
    p = finish(p, 0)
    f = i / (n - 1)
    if f > 0.5:
        p["hairb"] *= max(0.0, 1 - (f - 0.5) / 0.3)
    return p


def main():
    r, M, feet, bombm, sm = build()
    sh = L.Sheet("bomber", r)
    sh.prop(bombm, False)
    sh.prop(sm, False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and o.name not in ("bombm", "smear")]
    sh.render("idle", 8, idle, fps=10, loop=True, ground_objs=feet)
    sh.render("walk", 8, walk, fps=10, loop=True, ground_objs=feet)
    sh.render("throw", sum(WA), throw, fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {"bombm": 1 <= i < WA[0], "smear": i == WA[0]})
    sh.render("hurt", 3, hurt, fps=12, ground_objs=feet)
    sh.render("death", 9, death, fps=10, grounds=[("hips", allm)])
    sh.write_spec()


L.run(main)
