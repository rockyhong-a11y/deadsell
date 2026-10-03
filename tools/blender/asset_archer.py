"""DEADSELL enemy: archer (궁수) -- hooded female archer, dark green cloak, longbow, quiver.

blender -b --factory-startup -P tools/blender/asset_archer.py
-> build/frames/archer/*.png + spec.json   (pack: python3 tools/pack/pack_all.py archer)

Animations: idle walk shoot(windup = full draw, active = release, recover) hurt death
The bow string is two segments with Stretch-To constraints: at rest they meet at the bow's
rest nock point; while drawing (constraint influence keyed to 1) they meet at the drawing hand.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

S = 1.0
WA = (6, 2, 4)
RIG = None
STRINGS = []
BOW_HALF = 0.74      # half length of the bow (tip to grip, along the bow)
BOW_R = 1.0          # arc radius


def build():
    global RIG
    L.setup_scene()
    M = {
        "skin": L.mat("a_skin", "#ebc2a6", "#93606e", "#fbe1cc"),
        "cloak": L.mat("a_cloak", "#2f5238", "#152536", "#4c7d55"),
        "cloak_in": L.mat("a_cloak_in", "#22392c", "#101a28", "#355a40"),
        "leather": L.mat("a_leather", "#76482d", "#3a2028", "#a06a40"),
        "dark": L.mat("a_dark", "#2d2a38", "#16141f", "#46415a"),
        "boot": L.mat("a_boot", "#4f3426", "#271621", "#70503a"),
        "hair": L.mat("a_hair", "#bf5a2c", "#682529", "#ea8a48"),
        "wood": L.mat("a_wood", "#93633a", "#4a2a26", "#c48d52"),
        "string": L.mat("a_string", "#e9e1c8", "#9a9080", "#ffffff", rim=False),
        "steel": L.mat("a_steel", "#a3abbf", "#4f566e", "#e6edf8"),
        "fletch": L.mat("a_fletch", "#c9343a", "#651a2c", "#f05a50"),
        "eye": L.glow("a_eye", "#ffae3a"),
    }
    r = L.ERig("archer")
    RIG = r
    L.skeleton(r, s=S, w=0.95)
    J, A = r.joint, r.attach
    J("hood_tip", "head", (-0.16, 0, 1.66))
    J("lock", "head", (0.04, -0.1, 1.6))
    J("lock1", "lock", (0.05, -0.1, 1.42))
    J("cape", "chest", (-0.11, 0, 1.42))
    J("cape1", "cape", (-0.15, 0, 0.98))
    J("skirt", "hips", (0, 0, 0.94))
    J("bow", "ha_f", (0.0, 0.12, 0.88))
    r.joints["bow"].rotation_mode = "ZYX"   # twist (roll about the bow's length) is applied first
    J("arrow", "ha_n", (0.0, -0.12, 0.88))
    J("nock", "ha_n", (0.0, -0.06, 0.88))

    o = L.body(r, {"skin": M["skin"], "chest": M["leather"], "waist": M["leather"], "pelvis": M["dark"],
                   "ua": M["cloak_in"], "fa": M["leather"], "hand": M["skin"], "thigh": M["dark"],
                   "shin": M["boot"], "foot": M["boot"]},
               s=S, w=0.95, bust=1.05, hip=1.05, arm_r=0.95, leg_r=0.95)
    # bodice lacing, belt, short skirt
    A(box("lace", (0.03, 0.03, 0.2), M["string"]), "chest", (0.135, 0, -0.04))
    A(ellipsoid("belt", (0.21, 0.27, 0.06), M["boot"]), "hips", (0.0, 0, 0.07))
    A(L.skirt("skirt_m", 0.15, 0.24, 0.3, M["cloak_in"], n=16, jag=0.04, seed=2, bulge=0.03, front=0.85, back=1.1),
      "skirt")
    for sd in ("n", "f"):
        A(ellipsoid("cuff_" + sd, (0.1, 0.1, 0.07), M["boot"]), "kn_" + sd, (0.01, 0, -0.06))
    # hood + mantle
    A(ellipsoid("hood", (0.29, 0.28, 0.31), M["cloak"]), "head", (-0.035, 0, 0.13))
    A(ellipsoid("hood_rim", (0.08, 0.27, 0.27), M["cloak_in"]), "head", (0.06, 0, 0.13))
    A(L.tube("hood_point", [(0.05, 0, 0.02), (-0.04, 0, -0.06), (-0.12, 0, -0.14)], [0.07, 0.05, 0.005],
             M["cloak"], depth=1.2), "hood_tip")
    A(ellipsoid("mantle", (0.33, 0.36, 0.17), M["cloak"]), "chest", (-0.01, 0, 0.17))
    A(ellipsoid("bangs", (0.1, 0.18, 0.08), M["hair"]), "head", (0.075, 0, 0.2))
    # long copper hair spilling out of the hood over the near shoulder
    A(L.tube("lock_a", [(0, 0, 0), (0.02, 0, -0.1), (0.02, 0, -0.19)], [0.045, 0.05, 0.045], M["hair"], depth=0.8),
      "lock")
    A(L.tube("lock_b", [(0, 0, 0.02), (0.015, 0, -0.12), (-0.01, 0, -0.22)], [0.05, 0.045, 0.01], M["hair"],
             depth=0.8), "lock1")
    L.eyes(r, M["eye"], s=S, x=0.108, z=0.115, h=0.05, wdt=0.03, span=0.12)
    # cloak (two flowing segments behind the back)
    for nm, j, ln, r0, r1 in (("cape_a", "cape", 0.48, 0.17, 0.2), ("cape_b", "cape1", 0.5, 0.2, 0.22)):
        c = L.tube(nm, [(0, 0, 0.03), (-0.01, 0, -ln * 0.5), (0, 0, -ln)], [r0, (r0 + r1) / 2, r1], M["cloak"],
                   segs=10)
        c.scale = (0.32, 1, 1)
        L.bake(c)
        A(c, j)
    A(L.skirt("cape_hem", 0.2, 0.22, 0.07, M["cloak"], n=10, jag=0.07, seed=5, depth=1.0), "cape1",
      (0, 0, -0.47)).scale = (0.32, 1, 1)
    # quiver on the back with red fletchings
    q = [L.limb("quiver", 0.46, 0.065, 0.055, M["leather"])]
    q[0].location = (0, 0, 0.3)
    q.append(L.disc("quiver_lip", 0.072, 0.03, M["boot"], loc=(0, 0, 0.3)))
    for k, (dx, dy) in enumerate(((0.0, -0.02), (0.03, 0.02), (-0.03, 0.01))):
        q.append(L.leaf("fl%d" % k, 0.12, 0.06, 0.02, M["fletch"], tip=0.3))
        q[-1].rotation_euler = (0, math.radians(180), 0)
        q[-1].location = (dx, dy - 0.03, 0.31)
    qm = L.joined("quiverm", q)
    A(qm, "chest", (-0.16, 0.08, -0.08), rot=(0, -28, 0))
    # longbow: D-shaped arc, grip at the hand, string side toward -X
    pts = []
    n = 13
    amax = math.asin(BOW_HALF / BOW_R)
    for k in range(n):
        a = -amax + 2 * amax * k / (n - 1)
        pts.append((BOW_R * math.cos(a) - BOW_R, 0, BOW_R * math.sin(a)))
    rad = [0.012 + 0.016 * (1 - abs(k - (n - 1) / 2) / ((n - 1) / 2)) for k in range(n)]
    bow = L.tube("bow_m", pts, rad, M["wood"], segs=6)
    bow.location = (0.02, 0, -0.04)
    L.bake(bow)
    grip = ellipsoid("bow_grip", (0.06, 0.06, 0.12), M["boot"])
    A(bow, "bow")
    A(grip, "bow", (0.02, 0, -0.04))
    tip_x = BOW_R * math.cos(amax) - BOW_R + 0.02
    tip_z = BOW_HALF
    J("nock_rest", "bow", (r.world_rest["bow"].x + tip_x, 0.12, r.world_rest["bow"].z - 0.04))
    # string segments (Stretch-To toward nock_rest, then the hand's nock when drawing)
    for nm, tz in (("str_top", tip_z - 0.04), ("str_bot", -tip_z - 0.04)):
        ln = abs(tz - (-0.04))
        ob = L.tube(nm, [(0, 0, 0), (0, ln, 0)], 0.017, M["string"], segs=4)
        A(ob, "bow", (tip_x, 0, tz))
        c1 = ob.constraints.new("STRETCH_TO")
        c1.target = r.joints["nock_rest"]
        c1.rest_length = ln
        c1.volume = "NO_VOLUME"
        c2 = ob.constraints.new("STRETCH_TO")
        c2.target = r.joints["nock"]
        c2.rest_length = ln
        c2.volume = "NO_VOLUME"
        c2.influence = 0.0
        STRINGS.append(ob)
    # arrow (hangs down from the arrow joint; joint is aimed by the pose)
    ar = [L.limb("shaft", 0.84, 0.011, 0.011, M["wood"])]
    head = cone("arrowhead", 0.03, 0.0, 0.09, M["steel"], rot=(180, 0, 0))
    head.location = (0, 0, -0.82)
    ar.append(head)
    for k, rot in enumerate((0, 90)):
        f = L.leaf("afl%d" % k, 0.12, 0.05, 0.012, M["fletch"], tip=0.2)
        f.location = (0, 0, -0.02)
        f.rotation_euler = (0, 0, math.radians(rot))
        ar.append(f)
    arrow = L.joined("arrowm", ar)
    A(arrow, "arrow", (0, 0, 0.04))
    feet = [o["foot_n"], o["foot_f"]]
    return r, M, feet, arrow


ARM_F = ("root", "hips", "spine", "chest", "sh_f", "el_f", "ha_f")
ARM_N = ("root", "hips", "spine", "chest", "sh_n", "el_n", "ha_n")

BASE = {"hips": -2, "spine": 0, "chest": 2, "neck": 0, "head": 0,
        "th_n": 10, "kn_n": -12, "th_f": -10, "kn_f": -6,
        "sh_n": 8, "el_n": 18, "sh_f": 22, "el_f": 22, "ha_f": 0,
        "hips.dz": -0.015, "_bow": 30, "_arrow": 70}


def finish(p, sway=0.0, aim=None, draw=None, draw_bend=1.0, arrow_to_bow=False, cloth=1.0):
    """aim: (dx, dz) target for the bow hand relative to the far shoulder (None = FK angles).
    draw: (dx, dz) target for the string hand relative to the near shoulder."""
    L.hang(p, [("lock", 4), ("lock1", 0)], L.HEAD_CHAIN, sway * 0.6)
    L.hang(p, [("cape", -6 + sway), ("cape1", 3 + sway * 0.5)], L.CHEST_CHAIN, 0)
    if cloth < 1.0:   # cloth/hair stop hanging and lie along the body (death)
        for j, rest in (("cape", -12), ("cape1", 4), ("lock", 20), ("lock1", 0)):
            p[j] = p[j] * cloth + rest * (1 - cloth)
    p["skirt"] = -0.4 * p.get("hips", 0)
    p["hood_tip"] = -6 + sway * 0.4
    if aim is not None or draw is not None:
        RIG.pose(*L.split(p))
        fx, fz = L.joint_xz(RIG, "sh_f")
        nx, nz = L.joint_xz(RIG, "sh_n")
        if aim is not None:
            L.ik2(RIG, p, "sh_f", "el_f", "ha_f", (fx + aim[0], fz + aim[1]), bend=1.0)
        if draw is not None:
            L.ik2(RIG, p, "sh_n", "el_n", "ha_n", (nx + draw[0], nz + draw[1]), bend=draw_bend)
    # bow and arrow orientation are given in world angles (keys _bow / _arrow)
    L.hang(p, [("bow", 0.0)], ARM_F, p.pop("_bow", 0.0))
    arw = p.pop("_arrow", 90.0)
    if arrow_to_bow:
        RIG.pose(*L.split(p))
        L.point_at(RIG, p, "arrow", L.joint_xz(RIG, "bow"))
    else:
        L.hang(p, [("arrow", 0.0)], ARM_N, arw)
    return p


def idle(i, n):
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    p = dict(BASE)
    p.update({"chest": 2 + 2 * s, "head": -1 - 1.5 * s, "sh_n": 8 + 3 * s, "sh_f": 22 + 2 * s,
              "hips.dz": -0.015 - 0.008 * (1 - c)})
    L.feet_flat(p)
    return finish(p, 3 * c)


def walk(i, n):
    t = i / n
    a = 2 * math.pi * t
    s, c = math.sin(a), math.cos(a)
    p = dict(BASE)
    p.update(L.walk_legs(t, stride=26, knee=46))
    p.update({"hips": -4, "spine": -3, "chest": 2 + 2 * c, "sh_n": 8 - 18 * s, "el_n": 22 + 8 * max(0, -s),
              "sh_f": 22 + 10 * s, "hips.dz": -0.03 + 0.03 * abs(c)})
    p["an_n"] -= 4
    p["an_f"] -= 4
    return finish(p, 8 * c)


# shoot: targets for the hands are relative to the shoulders (bow arm far, string arm near)
AIM_POSE = {"hips": -4, "spine": 4, "chest": 6, "neck": -6, "head": -4,
            "th_n": 22, "kn_n": -16, "th_f": -18, "kn_f": -6, "hips.dz": -0.03}
AIM = (0.43, 0.06)      # bow hand, fully extended forward at chin height


def shoot(i, n):
    w, a, rc = WA
    p = L.merge(BASE, AIM_POSE)
    bend, to_bow = 1.0, False
    if i == 0:          # lift the bow, reach back for an arrow
        p = L.merge(BASE, {"chest": 4, "hips.dz": -0.02, "th_n": 16, "th_f": -14})
        aim, draw, bow, arw, inf = (0.3, -0.18), (0.12, -0.2), 20, 60, 0
    elif i < w:         # nock, then draw to the ear; hold (with tremble) at full draw
        aim = AIM
        hx = [0.3, 0.13, -0.03, -0.045, -0.05][min(4, i - 1)]
        draw = (hx, AIM[1])
        bend = 1.0 if i == 1 else -1.0
        bow, arw, inf, to_bow = 0, 90, 1, True
        f = min(1.0, (i - 1) / 2.0)
        p["chest"] += 4 * f
        p["spine"] += 2 * f
        p["head"] -= 2 * f
        if i == w - 1:
            p["chest"] += 1
            draw = (draw[0] - 0.01, draw[1] + 0.008)
    elif i < w + a:     # release: string snaps forward, hand flies back
        k = i - w
        aim = (AIM[0] + 0.01, AIM[1] + 0.01)
        draw = (-0.12 - 0.04 * k, AIM[1] + 0.08 + 0.03 * k)
        bend = -1.0
        bow, arw, inf = 3 + 4 * k, 90, 0
        p["chest"] += 4
        p["head"] -= 4
    else:               # recover: lower the bow
        k = (i - w - a + 1) / rc
        e = L.ease(k)
        aim = (AIM[0] - 0.15 * e, AIM[1] - 0.3 * e)
        draw = (-0.12 + 0.2 * e, AIM[1] + 0.1 - 0.4 * e)
        bend = -1.0 if e < 0.5 else 1.0
        bow, arw, inf = 25 * e, 90, 0
        p = L.keys_at([(0, p), (1, dict(BASE))], e)
    p["_bow"], p["_arrow"] = bow, arw
    p["_inf"] = inf
    L.feet_flat(p)
    return p, dict(aim=aim, draw=draw, draw_bend=bend, arrow_to_bow=to_bow)


def hurt(i, n):
    k = [(0.0, L.merge(BASE, {"hips": 4, "spine": 6, "chest": 10, "neck": -8, "head": -20, "sh_n": 50, "el_n": 60,
                              "sh_f": 50, "el_f": 40, "hips.dx": -0.07, "th_n": 2, "th_f": -2})),
         (0.5, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 6, "neck": -4, "head": -10, "sh_n": 36, "el_n": 46,
                              "sh_f": 40, "el_f": 30, "hips.dx": -0.04})),
         (1.0, dict(BASE))]
    p = L.keys_at(k, i / (n - 1) * 0.85)
    L.feet_flat(p)
    return finish(p, 10)


DEATH = [
    (0.00, L.merge(BASE, {"hips": 4, "spine": 6, "chest": 10, "neck": -8, "head": -20, "sh_n": 50, "el_n": 60,
                          "sh_f": 50, "el_f": 40, "hips.dx": -0.07, "_bow": 30})),
    # knees give way
    (0.35, L.merge(BASE, {"hips": -8, "spine": -14, "chest": -14, "neck": 10, "head": 22, "th_n": 78,
                          "kn_n": -140, "th_f": 70, "kn_f": -132, "sh_n": 14, "el_n": 20, "sh_f": 30, "el_f": 24,
                          "_bow": 70})),
    # pitches forward
    (0.65, L.merge(BASE, {"hips": -52, "spine": -10, "chest": -8, "neck": 10, "head": 14, "th_n": 40,
                          "kn_n": -70, "th_f": 34, "kn_f": -62, "sh_n": 90, "el_n": 20, "sh_f": 70, "el_f": 20,
                          "_bow": 90})),
    # face down on the floor
    (0.85, L.merge(BASE, {"hips": -88, "spine": -2, "chest": -2, "neck": 6, "head": 12, "th_n": 6,
                          "kn_n": -16, "th_f": 2, "kn_f": -24, "sh_n": 170, "el_n": 14, "sh_f": 30, "el_f": 10,
                          "_bow": 92})),
    (1.00, L.merge(BASE, {"hips": -90, "spine": 0, "chest": 0, "neck": 4, "head": 10, "th_n": 4,
                          "kn_n": -10, "th_f": 0, "kn_f": -18, "sh_n": 178, "el_n": 6, "sh_f": 14, "el_f": 6,
                          "_bow": 92})),
]


def death(i, n):
    p = L.keys_at(DEATH, i / (n - 1))
    for sd in ("n", "f"):
        p["an_" + sd] = 30 * min(1, i / (n - 1) * 2)
    p["hips.dx"] = p.get("hips.dx", 0) - 0.62 * L.ease(min(1.0, i / (n - 1) * 1.2))
    p["bow:z"] = 90 * L.ease(min(1.0, max(0.0, (i / (n - 1) - 0.3) / 0.5)))   # dropped bow lies flat
    return finish(p, 0, cloth=max(0.0, 1 - 1.6 * i / (n - 1)))


def main():
    r, M, feet, arrow = build()
    sh = L.Sheet("archer", r)
    sh.prop(arrow, False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and o.name not in STR_NAMES()]
    INF = {}

    def strings(i, n, frame, src):
        for ob in STRINGS:
            if i == 0:
                ob.animation_data_clear()
            c = ob.constraints[1]
            c.influence = src.get(i, 0.0)
            c.keyframe_insert("influence", frame=frame)
            for fc in ob.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"

    def plain(i, n, frame):
        strings(i, n, frame, {})

    sh.render("idle", 8, idle, fps=8, loop=True, ground_objs=feet, extra_fn=plain)
    sh.render("walk", 10, walk, fps=10, loop=True, ground_objs=feet, extra_fn=plain)

    def shoot_pose(i, n):
        p, kw = shoot(i, n)
        INF[i] = p.pop("_inf", 0)
        return finish(p, 0, **kw)

    sh.render("shoot", sum(WA), shoot_pose, fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {"arrowm": 1 <= i < WA[0]},
              extra_fn=lambda i, n, frame: strings(i, n, frame, INF))
    sh.render("hurt", 3, hurt, fps=12, ground_objs=feet, extra_fn=plain)
    sh.render("death", 9, death, fps=10, grounds=[("hips", allm)], extra_fn=plain)
    sh.write_spec()


def STR_NAMES():
    return [o.name for o in STRINGS]


L.run(main)
