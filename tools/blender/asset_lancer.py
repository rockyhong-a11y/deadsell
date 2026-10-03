"""DEADSELL enemy: lancer (창기병) -- tall armored knight woman: plumed helmet + ponytail, long
lance, kite shield on her back, purple/gold heraldry.  Charges across the screen.

blender -b --factory-startup -P tools/blender/asset_lancer.py
-> build/frames/lancer/*.png + spec.json   (pack: python3 tools/pack/pack_all.py lancer)

Animations: idle walk charge_windup charge(loop) thrust(windup/active/recover) hurt death
The lance is a rigid prop on the near hand ("lance" joint).  Its world angle ("_lance", 0 = tip
down, 90 = level forward, 180 = tip up) is set per pose; when "_two" > 0 the near hand is put at
a shoulder-relative target ("_nx", "_nz") and the far hand on the shaft behind it (2-bone IK).
"""
import math
import os
import sys

import bmesh  # noqa: F401
import bpy  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

S = 1.05
WA = (4, 2, 3)
RIG = None
STREAKS = ([], [])
LANCE_BACK, LANCE_FWD = 0.85, 1.2     # butt / tip distance from the near grip
ARM_N = ("root", "hips", "spine", "chest", "sh_n", "el_n", "ha_n")


def kite(name, sx, sz, thick, mat_, y=0.0, z=0.0):
    """Flat kite-shield polygon in the XZ plane (extruded along Y), scaled by sx/sz."""
    pts = [(-0.21, 0.4), (0.21, 0.4), (0.24, 0.1), (0.0, -0.5), (-0.24, 0.1)]
    bm = bmesh.new()
    fr = [bm.verts.new((px * sx, y - thick / 2, pz * sz + z)) for px, pz in pts]
    bk = [bm.verts.new((px * sx, y + thick / 2, pz * sz + z)) for px, pz in pts]
    bm.faces.new(fr)
    bm.faces.new(list(reversed(bk)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((fr[i], fr[j], bk[j], bk[i]))
    return L._mesh_ob(name, bm, mat_, smooth=False)


def build():
    global RIG
    L.setup_scene()
    M = {
        "skin": L.mat("l_skin", "#efc9b0", "#9a6070", "#fde6d0"),
        "steel": L.mat("l_steel", "#9aa3b8", "#454b68", "#e2eaf6"),
        "dsteel": L.mat("l_dsteel", "#59607a", "#2a2d44", "#8890aa"),
        "purple": L.mat("l_purple", "#6c3b9c", "#2c1852", "#9a66cc"),
        "purple2": L.mat("l_purple2", "#8a54be", "#3c2468", "#b88ae6"),
        "gold": L.mat("l_gold", "#dba93a", "#70482a", "#ffe18a"),
        "leather": L.mat("l_leather", "#503628", "#271a22", "#75503a"),
        "wood": L.mat("l_wood", "#8a5c36", "#44281f", "#b88450"),
        "hair": L.mat("l_hair", "#ece2b8", "#9a8a80", "#ffffff"),
        "eye": L.glow("l_eye", "#ff8a24"),
        "streak": L.glow("l_streak", "#e6dcff"),
    }
    r = L.ERig("lancer")
    RIG = r
    L.skeleton(r, s=S, w=1.0)
    J, A = r.joint, r.attach
    J("pt", "head", (-0.13 * S, 0, 1.66 * S))
    J("pt1", "pt", (-0.13 * S, 0, 1.66 * S - 0.36))
    J("plume", "head", (-0.02 * S, 0, 1.74 * S))
    J("skirt", "hips", (0, 0, 0.94 * S))
    J("tab", "spine", (0.12 * S, 0, 1.14 * S))
    J("lance", "ha_n", (0.0, -0.114 * S, 0.9 * S))

    o = L.body(r, {"skin": M["skin"], "chest": M["steel"], "waist": M["purple"], "pelvis": M["dsteel"],
                   "bust": M["steel"], "ua": M["dsteel"], "fa": M["steel"], "hand": M["dsteel"],
                   "thigh": M["steel"], "shin": M["steel"], "foot": M["dsteel"]},
               s=S, w=1.0, bust=1.18, hip=1.08, arm_r=1.05, leg_r=1.05)
    # tasset skirt (purple, gold hem) + steel belt with gold buckle
    A(L.skirt("skirt_m", 0.16 * S, 0.29 * S, 0.32 * S, M["purple"], n=18, bulge=0.035 * S, front=0.88, back=1.12), "skirt")
    A(L.skirt("skirt_hem", 0.27 * S, 0.29 * S, 0.035 * S, M["gold"], n=18, front=0.88, back=1.12, cap_top=False),
      "skirt", (0, 0, -0.29 * S))
    A(ellipsoid("belt", (0.22 * S, 0.27 * S, 0.06 * S), M["dsteel"]), "hips", (0.0, 0, 0.1 * S))
    A(box("buckle", (0.04 * S, 0.07 * S, 0.06 * S), M["gold"], bevel=0.01), "hips", (0.11 * S, 0, 0.1 * S))
    # front tabard panel with heraldry (swings with the legs)
    A(L.bake(box("tab_m", (0.03 * S, 0.2 * S, 0.5 * S), M["purple"], loc=(0, 0, -0.25 * S), bevel=0.008)), "tab")
    A(L.bake(box("tab_stripe", (0.034 * S, 0.045 * S, 0.5 * S), M["gold"], loc=(0.004 * S, 0, -0.25 * S))), "tab")
    A(L.bake(box("tab_gem", (0.04 * S, 0.1 * S, 0.1 * S), M["gold"], loc=(0.006 * S, 0, -0.2 * S), rot=(45, 0, 0))), "tab")
    # pauldrons, elbow/knee cops
    for sd in ("n", "f"):
        A(ellipsoid("pauld_" + sd, (0.2 * S, 0.19 * S, 0.15 * S), M["steel"]), "sh_" + sd, (0.0, 0, 0.02 * S))
        A(ellipsoid("pauld_t" + sd, (0.21 * S, 0.2 * S, 0.05 * S), M["gold"]), "sh_" + sd, (0.0, 0, 0.075 * S))
        A(ellipsoid("elcop_" + sd, (0.1 * S, 0.1 * S, 0.1 * S), M["gold"]), "el_" + sd, (0.0, 0, 0.0))
        A(ellipsoid("kncop_" + sd, (0.14 * S, 0.14 * S, 0.14 * S), M["gold"]), "kn_" + sd, (0.025 * S, 0, 0.0))
        A(ellipsoid("gauntlet_" + sd, (0.09 * S, 0.08 * S, 0.1 * S), M["steel"]), "ha_" + sd, (0, 0, -0.03 * S))
    A(ellipsoid("gorget", (0.2 * S, 0.24 * S, 0.1 * S), M["steel"]), "chest", (0.01 * S, 0, 0.2 * S))
    A(box("bust_trim", (0.05 * S, 0.22 * S, 0.035 * S), M["gold"], bevel=0.01), "chest", (0.15 * S, 0, 0.015 * S))
    # helmet: open at the lower face (chin shows), visor brow, cheek guards, gold rim
    A(ellipsoid("helm", (0.28 * S, 0.27 * S, 0.24 * S), M["steel"]), "head", (-0.02 * S, 0, 0.17 * S))
    A(ellipsoid("helm_brow", (0.11 * S, 0.24 * S, 0.08 * S), M["steel"]), "head", (0.075 * S, 0, 0.215 * S))
    A(ellipsoid("helm_rim", (0.3 * S, 0.29 * S, 0.035 * S), M["gold"]), "head", (-0.02 * S, 0, 0.115 * S))
    for y in (-0.105, 0.105):
        A(ellipsoid("cheek", (0.11 * S, 0.05 * S, 0.14 * S), M["steel"]), "head", (0.0, y * S, 0.05 * S))
    A(L.tube("crest_base", [(0.04 * S, 0, 0.0), (-0.04 * S, 0, 0.0)], 0.05 * S, M["gold"], depth=0.8), "plume")
    # plume: swept-back purple feather crest (stands up, flows backward)
    PS = 1.4
    A(L.tube("plume_a", [(0.03 * PS, 0, 0.0), (-0.02 * PS, 0, 0.12 * PS), (-0.1 * PS, 0, 0.19 * PS), (-0.22 * PS, 0, 0.19 * PS)],
             [0.05, 0.07, 0.06, 0.008], M["purple"], depth=1.5), "plume")
    A(L.tube("plume_b", [(0.0, -0.025, 0.02), (-0.06 * PS, -0.025, 0.12 * PS), (-0.17 * PS, -0.025, 0.14 * PS)],
             [0.04, 0.045, 0.006], M["purple2"], depth=1.2), "plume")
    # ponytail pulled through the back of the helm
    A(L.tube("pony_a", [(0.0, 0, 0.0), (-0.035, 0, -0.14), (-0.03, 0, -0.34)], [0.065, 0.075, 0.03], M["hair"], depth=0.9), "pt")
    A(L.tube("pony_b", [(0.0, 0, 0.02), (-0.015, 0, -0.14), (0.0, 0, -0.3)], [0.05, 0.04, 0.006], M["hair"], depth=0.9), "pt1")
    A(ellipsoid("pony_tie", (0.08 * S, 0.08 * S, 0.06 * S), M["gold"]), "pt", (0.0, 0, 0.0))
    L.eyes(r, M["eye"], s=S, x=0.115, z=0.108, h=0.05, wdt=0.034, span=0.13)
    # kite shield on the back (face toward the camera), purple field + gold cross
    sh_ = [kite("sh_border", 1.0, 1.0, 0.05, M["gold"], y=0.0),
           kite("sh_field", 0.8, 0.82, 0.05, M["purple"], y=-0.014, z=0.0)]
    cross = [box("sh_c1", (0.05, 0.05, 0.62), M["gold"], loc=(0, -0.03, -0.02)),
             box("sh_c2", (0.3, 0.05, 0.05), M["gold"], loc=(0, -0.03, 0.14)),
             ellipsoid("sh_boss", (0.1, 0.07, 0.1), M["steel"], loc=(0, -0.045, 0.14))]
    sh_ += cross
    shield = L.joined("shieldm", sh_)
    A(shield, "chest", (-0.27 * S, 0.17, -0.1 * S), rot=(0, 14, 0))
    # lance: tip direction = local -Z, grip at the origin
    LB, LF = LANCE_BACK, LANCE_FWD
    shaft_end = -(LF - 0.3)
    parts = [L.tube("shaft", [(0, 0, LB), (0, 0, 0), (0, 0, shaft_end)], [0.03, 0.034, 0.03], M["wood"], segs=7)]
    parts.append(L.tube("butt", [(0, 0, LB), (0, 0, LB + 0.1)], [0.04, 0.012], M["dsteel"], segs=7))
    g = L.disc("guard", 0.11, 0.025, M["gold"], loc=(0, 0, -0.26))
    parts.append(g)
    g2 = L.disc("guard2", 0.075, 0.04, M["gold"], loc=(0, 0, -0.2))
    parts.append(g2)
    head = cone("lhead", 0.052, 0.0, 0.3, M["steel"], loc=(0, 0, shaft_end), rot=(180, 0, 0))
    parts.append(head)
    parts.append(L.disc("lring", 0.045, 0.03, M["gold"], loc=(0, 0, shaft_end + 0.01)))
    pen = L.leaf("pennant", 0.42, 0.2, 0.015, M["purple"], tip=0.6, base=0.2)
    pen.location = (0, 0.01, shaft_end + 0.07)
    pen.rotation_euler = (0, math.radians(158), 0)
    parts.append(pen)
    pen2 = L.leaf("pennant2", 0.2, 0.1, 0.015, M["gold"], tip=0.6, base=0.2)
    pen2.location = (0, -0.005, shaft_end + 0.07)
    pen2.rotation_euler = (0, math.radians(158), 0)
    parts.append(pen2)
    lance = L.joined("lancem", parts)
    A(lance, "lance")
    # charge speed streaks (horizontal, behind her): two alternating sets, attached to the root
    for gi, offs in enumerate((((-0.55, -0.05, 0.5), (-0.75, 0.05, 0.95), (-0.5, 0.0, 1.45), (-0.95, -0.08, 1.2)),
                               ((-0.65, 0.04, 0.35), (-0.5, -0.06, 0.8), (-0.85, 0.06, 1.1), (-0.6, 0.0, 1.7)))):
        sp = []
        for k, (x, y, z) in enumerate(offs):
            ln = 0.4 + 0.2 * ((k + gi) % 2)
            sp.append(L.tube("sl%d_%d" % (gi, k), [(x, y, z), (x - ln * 0.5, y, z), (x - ln, y, z)],
                             [0.004, 0.02, 0.004], M["streak"], depth=0.5, segs=5))
        ob = L.joined("streaks%d" % gi, sp)
        A(ob, "root")
        STREAKS[gi].append(ob)
    feet = [o["foot_n"], o["foot_f"]]
    return r, M, feet


# --------------------------------------------------------------------------
# poses

BASE = {"hips": -2, "spine": 0, "chest": 1, "neck": 0, "head": 0,
        "th_n": 6, "kn_n": -6, "th_f": -6, "kn_f": -5,
        "sh_n": 20, "el_n": 60, "sh_f": 8, "el_f": 14, "ha_n": 0, "ha_f": 0,
        "hips.dz": -0.01, "_lance": 174, "_two": 0, "_nx": 0.4, "_nz": -0.3}


def finish(p, sway=0.0, flow=0.0):
    """flow: 0 = hanging (standing), 1 = streaming backward (sprinting)."""
    # IK for the two-handed lance grip
    two = p.pop("_two", 0.0)
    nx_, nz_ = p.pop("_nx", 0.4), p.pop("_nz", -0.3)
    lance = p.pop("_lance", 174)
    if two > 0.01:
        fk = {k: p.get(k, 0.0) for k in ("sh_n", "el_n", "sh_f", "el_f")}
        RIG.pose(*L.split(p))
        nsx, nsz = L.joint_xz(RIG, "sh_n")
        L.ik2(RIG, p, "sh_n", "el_n", "ha_n", (nsx + nx_, nsz + nz_), bend=1.0)
        RIG.pose(*L.split(p))
        hx, hz = L.joint_xz(RIG, "ha_n")
        a = math.radians(lance)
        d = (math.sin(a), -math.cos(a))
        fsx, fsz = L.joint_xz(RIG, "sh_f")
        L.ik2(RIG, p, "sh_f", "el_f", "ha_f", (hx - 0.3 * d[0], hz - 0.3 * d[1]), bend=1.0)
        for k in fk:     # blend FK -> IK while the grip comes on
            p[k] = fk[k] + (p[k] - fk[k]) * min(1.0, two)
    p["ha_n"] = 0.0
    L.hang(p, [("lance", 0.0)], ARM_N, lance)
    L.hang(p, [("pt", -10 - 55 * flow + sway), ("pt1", -6 - 62 * flow + sway * 1.3)], L.HEAD_CHAIN, 0)
    L.hang(p, [("plume", 6 + 36 * flow + sway * 0.6)], L.HEAD_CHAIN, 0)
    p["skirt"] = -0.5 * p.get("hips", 0) - 10 * flow
    p["tab"] = -(p.get("hips", 0) + p.get("spine", 0)) * 0.6 + 0.35 * max(0, max(p.get("th_n", 0), p.get("th_f", 0)) - 10) - 14 * flow
    return p


def idle(i, n):
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    p = dict(BASE)
    p.update({"chest": 1 + 1.5 * s, "head": -1 * s, "sh_n": 20 + 2 * s, "sh_f": 8 + 2 * s,
              "hips.dz": -0.01 - 0.01 * (1 - c), "_lance": 174 + 1.5 * s})
    L.feet_flat(p)
    return finish(p, 4 * c)


def walk(i, n):
    t = i / n
    a = 2 * math.pi * t
    s, c = math.sin(a), math.cos(a)
    p = dict(BASE)
    p.update(L.walk_legs(t, stride=24, knee=42))
    p.update({"hips": -3, "spine": -1, "chest": 1 + 1.5 * c, "sh_n": 22 + 4 * s, "el_n": 60,
              "sh_f": 8 + 22 * s, "el_f": 18 + 8 * max(0, -s), "hips.dz": -0.02 + 0.025 * abs(c),
              "_lance": 174 + 3 * s})
    p["an_n"] -= 3
    p["an_f"] -= 3
    return finish(p, 7 * c, flow=0.1)


CROUCH = {"hips": -16, "spine": -8, "chest": -8, "neck": 10, "head": 8, "th_n": 44, "kn_n": -70,
          "th_f": -34, "kn_f": -56, "hips.dz": -0.1, "_lance": 100, "_two": 1.0, "_nx": 0.4, "_nz": -0.3,
          "sh_n": 20, "el_n": 60, "sh_f": 8, "el_f": 14}


def charge_windup(i, n):
    t = i / (n - 1)
    keys = [(0.0, dict(BASE)),
            (0.4, L.merge(BASE, {"hips": -10, "spine": -4, "chest": -4, "neck": 6, "head": 4, "th_n": 28, "kn_n": -44,
                                 "th_f": -20, "kn_f": -34, "hips.dz": -0.06, "_lance": 128, "_two": 0.6,
                                 "_nx": 0.3, "_nz": -0.34})),
            (0.75, dict(CROUCH)),
            (1.0, L.merge(CROUCH, {"hips": -20, "spine": -10, "chest": -10, "th_n": 50, "kn_n": -80, "th_f": -40,
                                   "kn_f": -66, "hips.dz": -0.14, "_lance": 94, "_nx": 0.42}))]
    p = L.keys_at(keys, t)
    if i >= n - 2:     # coiled tremble
        p["chest"] += 1.5 * (-1) ** i
        p["_lance"] += 1.5 * (-1) ** i
    L.feet_flat(p)
    p["hips.dx"] = -0.1 * t
    return finish(p, 3 * (-1) ** i * t, flow=0.25 * t)


def charge(i, n):
    t = i / n
    a = 2 * math.pi * t
    s, c = math.sin(a), math.cos(a)
    p = dict(BASE)
    p.update(L.walk_legs(t, stride=46, knee=72, lift=1.1))
    p.update({"hips": -20, "spine": -6, "chest": -6, "neck": 12, "head": 8, "hips.dz": -0.05 + 0.06 * abs(c),
              "hips.dx": -0.1, "_lance": 90 + 1.5 * s, "_two": 1.0, "_nx": 0.4, "_nz": -0.3 + 0.012 * c,
              "sh_n": 20, "el_n": 60, "sh_f": 8, "el_f": 14})
    p["an_n"] -= 8
    p["an_f"] -= 8
    return finish(p, 6 * s, flow=1.0)


READY = {"hips": -10, "spine": -4, "chest": -4, "neck": 6, "head": 4, "th_n": 30, "kn_n": -44, "th_f": -26,
         "kn_f": -36, "hips.dz": -0.06, "hips.dx": -0.1, "_lance": 94, "_two": 1.0, "_nx": 0.4, "_nz": -0.3,
         "sh_n": 20, "el_n": 60, "sh_f": 8, "el_f": 14}
THRUST = [
    (0.00, READY),
    (0.3, L.merge(READY, {"hips": -4, "spine": 2, "chest": 2, "th_n": 22, "kn_n": -36, "_nx": 0.2, "_nz": -0.33,
                          "hips.dx": -0.16})),
    # wound back: lance drawn, weight on the rear leg
    (0.45, L.merge(READY, {"hips": 2, "spine": 6, "chest": 6, "neck": 0, "head": 0, "th_n": 14, "kn_n": -26,
                           "th_f": -34, "kn_f": -44, "_lance": 98, "_nx": 0.12, "_nz": -0.36, "hips.dx": -0.2})),
    # lunge: arm and lance fully extended
    (0.5, L.merge(READY, {"hips": -16, "spine": -8, "chest": -8, "neck": 10, "head": 8, "th_n": 46, "kn_n": -60,
                          "th_f": -30, "kn_f": -16, "_lance": 89, "_nx": 0.5, "_nz": -0.26, "hips.dx": 0.0})),
    (0.65, L.merge(READY, {"hips": -18, "spine": -9, "chest": -9, "neck": 11, "head": 9, "th_n": 50, "kn_n": -66,
                           "th_f": -32, "kn_f": -12, "_lance": 88, "_nx": 0.54, "_nz": -0.25, "hips.dx": 0.02})),
    (0.85, L.merge(READY, {"hips": -12, "th_n": 38, "kn_n": -52, "_nx": 0.46, "_nz": -0.28, "hips.dx": -0.06})),
    (1.0, READY),
]


def thrust(i, n):
    p = L.keys_at(THRUST, L.phase_t(i, *WA))
    L.feet_flat(p)
    return finish(p, -6 if i >= WA[0] else 2, flow=0.5 if WA[0] <= i < WA[0] + WA[1] else 0.2)


def hurt(i, n):
    k = [(0.0, L.merge(BASE, {"hips": 4, "spine": 6, "chest": 10, "neck": -8, "head": -18, "sh_n": 40, "el_n": 50,
                              "sh_f": 34, "el_f": 40, "hips.dx": -0.07, "th_n": 3, "th_f": -3, "_lance": 190})),
         (0.5, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 6, "neck": -4, "head": -9, "sh_n": 30, "el_n": 56,
                              "sh_f": 20, "el_f": 28, "hips.dx": -0.04, "_lance": 182})),
         (1.0, dict(BASE))]
    p = L.keys_at(k, i / (n - 1) * 0.85)
    L.feet_flat(p)
    return finish(p, 10)


DEATH = [
    (0.00, L.merge(BASE, {"hips": 4, "spine": 6, "chest": 10, "neck": -8, "head": -18, "sh_n": 40, "el_n": 50,
                          "sh_f": 34, "el_f": 40, "hips.dx": -0.07, "_lance": 190})),
    # knees give way, lance tips forward
    (0.35, L.merge(BASE, {"hips": -8, "spine": -12, "chest": -12, "neck": 10, "head": 20, "th_n": 80, "kn_n": -140,
                          "th_f": 70, "kn_f": -130, "sh_n": 50, "el_n": 40, "sh_f": 30, "el_f": 24, "_lance": 130})),
    # pitches forward
    (0.65, L.merge(BASE, {"hips": -52, "spine": -10, "chest": -8, "neck": 10, "head": 14, "th_n": 40, "kn_n": -70,
                          "th_f": 34, "kn_f": -62, "sh_n": 100, "el_n": 20, "sh_f": 70, "el_f": 20, "_lance": 104})),
    # face down, lance on the floor ahead of her
    (0.85, L.merge(BASE, {"hips": -88, "spine": -2, "chest": -2, "neck": 6, "head": 12, "th_n": 6, "kn_n": -16,
                          "th_f": 2, "kn_f": -24, "sh_n": 168, "el_n": 14, "sh_f": 30, "el_f": 10, "_lance": 92})),
    (1.00, L.merge(BASE, {"hips": -90, "spine": 0, "chest": 0, "neck": 4, "head": 10, "th_n": 4, "kn_n": -10,
                          "th_f": 0, "kn_f": -18, "sh_n": 176, "el_n": 6, "sh_f": 14, "el_f": 6, "_lance": 90})),
]


def death(i, n):
    f = i / (n - 1)
    p = L.keys_at(DEATH, f)
    for sd in ("n", "f"):
        p["an_" + sd] = 30 * min(1, f * 2)
    p["hips.dx"] = p.get("hips.dx", 0) - 0.62 * L.ease(min(1.0, f * 1.2))
    p = finish(p, 0)
    c = max(0.0, 1 - 1.6 * f)      # hair and plume stop hanging and lie flat
    p["pt"] = p["pt"] * c + 20 * (1 - c)
    p["pt1"] = p["pt1"] * c
    return p


def main():
    r, M, feet = build()
    sh = L.Sheet("lancer", r)
    for gi in (0, 1):
        sh.prop(STREAKS[gi][0], False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and not o.name.startswith("streaks")]
    sh.render("idle", 8, idle, fps=8, loop=True, ground_objs=feet)
    sh.render("walk", 10, walk, fps=10, loop=True, ground_objs=feet)
    sh.render("charge_windup", 6, charge_windup, fps=10, ground_objs=feet)
    sh.render("charge", 6, charge, fps=14, loop=True, ground_objs=feet,
              vis_fn=lambda i, n: {"streaks0": i % 2 == 0, "streaks1": i % 2 == 1})
    sh.render("thrust", sum(WA), thrust, fps=14, wa=WA, ground_objs=feet)
    sh.render("hurt", 3, hurt, fps=12, ground_objs=feet)
    sh.render("death", 9, death, fps=10, grounds=[("hips", allm)])
    sh.write_spec()


L.run(main)
