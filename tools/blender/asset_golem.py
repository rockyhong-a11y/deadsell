"""DEADSELL ally: rag golem (누더기 골렘) -- female rag-doll giant sewn from burlap, sacking and corpse-pale patches.

blender -b --factory-startup -P tools/blender/asset_golem.py
-> build/frames/golem/*.png + spec.json   (pack: python3 tools/pack/pack_all.py golem)

Frame 128x128, anchor (64,124) = centre of the feet.  ~2.9 u (~92 px) tall, ~1.6x the heroine.
Burlap body, long braids of dark-red yarn, two mismatched button eyes that glow cyan (Cinder's ember), a stitched
smile, oversized arms with bandaged fists, a ragged apron-skirt.

Animations: idle(6) walk(8) attack(8: windup 3 / active 2 / recover 3, two-fist overhead slam) hurt(3) jump(2)
death(8: collapses into a heap of rags) assemble(8: the heap rises, = death reversed) pile(1: the heap)
"""
import bpy
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import lib_enemies as L  # noqa: E402
import lib_npc as N  # noqa: E402
import lib_heroine as LH  # noqa: E402
import lib_boss as LB  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

L.FRAME_W, L.FRAME_H, L.ANCHOR = 128, 128, (64, 124)
N.AY = 124                       # lib_npc scene = warm key from the upper front, so the face is lit
TAU = 2 * math.pi
WA = (3, 2, 3)

# bone lengths (world units, 1 u = 32 px)
HIP_Z = 0.98
L1, L2 = 0.44, 0.41          # thigh, shin
ANK_Z = 0.13                 # ankle joint height above the sole


def build():
    N.setup_scene()
    M = {
        "burlap": L.mat("g_burlap", "#b89a68", "#5e4636", "#e0c68e"),
        "sack": L.mat("g_sack", "#8e6e48", "#42291f", "#b98e5a"),
        "sack_l": L.mat("g_sack_l", "#c9ad78", "#6a5240", "#ecd6a0"),
        "pale": L.mat("g_pale", "#dccab6", "#7e6878", "#f7ecdf"),
        "blue": L.mat("g_blue", "#586b7e", "#262f40", "#82989e"),
        "wine": L.mat("g_wine", "#7c2c3c", "#38101e", "#ac4a5c"),
        "yarn": L.mat("g_yarn", "#92243a", "#430f1e", "#c8445c"),
        "yarn_d": L.mat("g_yarn_d", "#6c1a2c", "#300b16", "#9c3248"),
        "band": L.mat("g_band", "#dcd2b6", "#8a7c7c", "#f8f0d8"),
        "band_d": L.mat("g_band_d", "#b6a688", "#6a5a58", "#d8c8a6"),
        "stitch": L.mat("g_stitch", "#42101c", "#200810", "#5e1c2c", rim=False),
        "leather": L.mat("g_leather", "#4a3028", "#22141a", "#6e4a3a"),
        "brass": L.mat("g_brass", "#c29a42", "#6a4426", "#f0d078"),
        "straw": L.mat("g_straw", "#dcc27c", "#8a7050", "#fff0b0", rim=False),
        "dust": L.mat("g_dust", "#c4b49a", "#7a6a6c", "#ece0c8", rim=False),
        "smear": L.glow("g_smear", "#fff0d8"),
        "eye": L.glow("g_eye", "#4fe3ff"),
        "eye_hot": L.glow("g_eye_hot", "#e6fdff"),
        "eye_dim": L.mat("g_eye_dim", "#3a4650", "#1a2028", "#566470", rim=False),
    }
    r = L.ERig("golem")
    J = r.joint
    J("body", "root", (0, 0, 0))
    J("hips", "body", (0, 0, HIP_Z))
    J("spine", "hips", (0, 0, 1.2))
    J("chest", "spine", (0, 0, 1.5))
    J("neck", "chest", (0, 0, 1.98))
    J("head", "neck", (0, 0, 2.1))
    for s, y in (("n", -1), ("f", 1)):
        J("sh_" + s, "chest", (0, y * 0.52, 1.9))
        J("el_" + s, "sh_" + s, (0, y * 0.52, 1.34))
        J("ha_" + s, "el_" + s, (0, y * 0.52, 0.82))
        J("th_" + s, "hips", (0, y * 0.27, HIP_Z))
        J("kn_" + s, "th_" + s, (0, y * 0.27, HIP_Z - L1))
        J("an_" + s, "kn_" + s, (0, y * 0.27, HIP_Z - L1 - L2))
        J("bt_" + s, "ha_" + s, (0.05, y * 0.52, 0.78))         # loose bandage tail
        # braid chain
        pts = [(-0.4, y * 0.34, 2.36), (-0.48, y * 0.36, 1.98), (-0.52, y * 0.37, 1.62), (-0.54, y * 0.37, 1.28)]
        prev = "head"
        for k, p in enumerate(pts):
            J("br%s%d" % (s, k), prev, p)
            prev = "br%s%d" % (s, k)
    J("ap", "hips", (0, 0, 1.22))
    J("heap", "root", (0, 0, 0))

    def attach(ob, joint):
        return LB.attach_world(r, ob, joint)

    def E(j, name, size, m, loc, rot=(0, 0, 0), segs=16, rings=10):
        return attach(ellipsoid(name, size, m, loc=loc, rot=rot, segs=segs, rings=rings), j)

    def B(j, name, size, m, loc, rot=(0, 0, 0), bevel=0.0):
        return attach(box(name, size, m, loc=loc, rot=rot, bevel=bevel), j)

    def Lm(j, name, length, r0, r1, m, loc, rot=(0, 0, 0), depth=1.0, segs=12):
        ob = limb(name, length, r0, r1, m, depth_scale=depth, segs=segs)
        ob.location = loc
        ob.rotation_euler = [math.radians(a) for a in rot]
        return attach(ob, j)

    def C(j, name, rb, rt, h, m, loc, rot=(0, 0, 0), segs=10):
        return attach(cone(name, rb, rt, h, m, loc=loc, rot=rot, segs=segs), j)

    def Y(j, name, rad, h, m, loc, rot=(0, 0, 0), segs=16, scale=(1, 1, 1)):
        return attach(LH.cyl(name, rad, h, m, loc=loc, rot=rot, segs=segs, scale=scale), j)

    def R(j, name, rad, rr, m, loc, rot=(0, 0, 0), scale=(1, 1, 1), maj=16, mino=6):
        return attach(LH.torus(name, rad, rr, m, loc=loc, rot=rot, scale=scale, maj=maj, mino=mino), j)

    def T(j, name, pts, radii, m, sides=6, flat=1.0, caps=True):
        return attach(LH.tube(name, pts, radii, m, sides=sides, flat=flat, caps=caps), j)

    def patch(j, name, c, rx, rz, m, ry=0.06, tilt=0.0):
        """Stitched patch on the near side: a flat blob + a dark thread ring round its edge."""
        E(j, name, (2 * rx, 2 * ry, 2 * rz), m, c, (0, tilt, 0), segs=14, rings=8)
        R(j, name + "_st", rx * 0.92, 0.017, M["stitch"], (c[0], c[1] - ry * 0.88, c[2]), (90, 0, tilt),
          scale=(1.0, rz / rx, 1.0), maj=18, mino=4)

    # ---- head ---------------------------------------------------------------------------------------
    HC = (0.03, 0.0, 2.47)
    E("head", "skull", (0.92, 0.88, 0.84), M["burlap"], HC, segs=22, rings=14)
    E("head", "jaw", (0.62, 0.7, 0.4), M["burlap"], (0.12, 0, 2.28), segs=14, rings=8)
    patch("head", "cheek_patch", (0.2, -0.4, 2.3), 0.2, 0.17, M["pale"], ry=0.06, tilt=-8)
    patch("head", "temple_patch", (-0.1, -0.41, 2.68), 0.16, 0.12, M["blue"], ry=0.05)
    E("head", "nose", (0.17, 0.15, 0.13), M["sack_l"], (0.47, -0.01, 2.4), segs=10, rings=6)
    for k, y in enumerate((-0.45, 0.45)):
        E("head", "ear%d" % k, (0.14, 0.12, 0.28), M["sack"], (-0.02, y, 2.46))
    # eyes: two mismatched buttons.  lit = cyan ember, dim = dead brass
    eyes = {}
    for s, (y, rad, z) in (("n", (-0.2, 0.15, 2.53)), ("f", (0.2, 0.105, 2.5))):
        x = 0.4 if s == "n" else 0.42
        R("head", "eye_ring_" + s, rad + 0.015, 0.03, M["brass"], (x, y, z), (0, 90, 0), maj=16, mino=5)
        Y("head", "eye_back_" + s, rad + 0.01, 0.05, M["leather"], (x - 0.01, y, z), (0, 90, 0), segs=16)
        eyes["lit_" + s] = Y("head", "eye_lit_" + s, rad * 0.86, 0.07, M["eye"], (x + 0.015, y, z), (0, 90, 0), segs=14)
        eyes["hot_" + s] = Y("head", "eye_hot_" + s, rad * 0.45, 0.08, M["eye_hot"], (x + 0.02, y - 0.012, z + 0.02), (0, 90, 0), segs=10)
        eyes["dim_" + s] = Y("head", "eye_dim_" + s, rad * 0.86, 0.07, M["eye_dim"], (x + 0.015, y, z), (0, 90, 0), segs=14)
        if s == "n":      # four-hole button cross
            B("head", "eye_x1", (0.03, 0.02, 0.2), M["stitch"], (x + 0.055, y, z), (0, 0, 45))
            B("head", "eye_x2", (0.03, 0.02, 0.2), M["stitch"], (x + 0.055, y, z), (0, 0, -45))
        else:             # cross-stitch over the small eye
            B("head", "eye_x3", (0.03, 0.18, 0.025), M["stitch"], (x + 0.055, y, z))
            B("head", "eye_x4", (0.03, 0.025, 0.18), M["stitch"], (x + 0.055, y, z))
    # stitched smile with cross ticks
    sm = [(0.43, -0.3, 2.3), (0.47, -0.2, 2.2), (0.5, -0.1, 2.16), (0.51, 0.0, 2.15), (0.5, 0.1, 2.16), (0.47, 0.2, 2.2),
          (0.43, 0.3, 2.3)]
    T("head", "smile", sm, [0.032] * len(sm), M["stitch"], sides=5)
    for k, p in enumerate(sm[1:-1]):
        B("head", "smile_tick%d" % k, (0.03, 0.034, 0.17), M["stitch"], (p[0] + 0.006, p[1], p[2] + 0.005))
    # yarn hair: cap, fringe, back mass
    E("head", "hair_cap", (1.0, 0.94, 0.62), M["yarn"], (-0.03, 0, 2.7), segs=20, rings=10)
    E("head", "hair_back", (0.6, 0.92, 0.96), M["yarn_d"], (-0.3, 0, 2.42), segs=16, rings=10)
    E("head", "fringe", (0.36, 0.84, 0.16), M["yarn"], (0.34, 0, 2.86), (0, 28, 0))
    for k, (y, h) in enumerate(((-0.34, 0.3), (-0.17, 0.36), (0.0, 0.32), (0.17, 0.36), (0.34, 0.28))):
        E("head", "bang%d" % k, (0.12, 0.17, h), M["yarn"] if k % 2 else M["yarn_d"], (0.4, y, 2.78 - h * 0.35), (0, 6, 0), segs=8, rings=6)
    for k, (c, a) in enumerate(((0.1, 0.6), (-0.1, 0.3))):      # yarn knots
        R("head", "yarn_knot%d" % k, 0.07, 0.025, M["yarn_d"], (-0.05 + c, -0.3 + 0.1 * a, 2.92), (80, 0, 20 * k), maj=10, mino=4)
    # ---- braids -------------------------------------------------------------------------------------
    for s, y in (("n", -1), ("f", 1)):
        pts = [(-0.4, y * 0.34, 2.36), (-0.48, y * 0.36, 1.98), (-0.52, y * 0.37, 1.62), (-0.54, y * 0.37, 1.28)]
        for k in range(3):
            a, b = pts[k], pts[k + 1]
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
            jn = "br%s%d" % (s, k)
            E(jn, "braid_%s%d" % (s, k), (0.34, 0.32, 0.46), M["yarn"] if k % 2 == 0 else M["yarn_d"], mid, segs=12, rings=8)
            for sg in (-1, 1):   # plait V
                E(jn, "braid_pl_%s%d_%d" % (s, k, sg), (0.12, 0.1, 0.3), M["yarn_d"] if k % 2 == 0 else M["yarn"],
                  (mid[0] + 0.12, mid[1] + sg * 0.06, mid[2] + 0.03), (0, 0, sg * 25), segs=8, rings=5)
        E("br%s2" % s, "braid_tip_" + s, (0.26, 0.24, 0.3), M["yarn"], (pts[3][0], pts[3][1], pts[3][2] - 0.06), segs=10, rings=6)
        R("br%s2" % s, "braid_tie_" + s, 0.12, 0.03, M["wine"], (pts[3][0], pts[3][1], pts[3][2] + 0.1), maj=12, mino=5)
        E("br%s2" % s, "braid_bow_" + s, (0.2, 0.24, 0.12), M["wine"], (pts[3][0], pts[3][1], pts[3][2] + 0.1), segs=8, rings=5)
    # ---- neck / torso -------------------------------------------------------------------------------
    E("neck", "neck_m", (0.54, 0.6, 0.5), M["burlap"], (0.0, 0, 2.02), segs=14, rings=8)
    R("neck", "collar", 0.3, 0.08, M["band_d"], (0.0, 0, 1.99), maj=18, mino=6)
    R("neck", "collar_st", 0.3, 0.02, M["stitch"], (0.0, 0, 2.06), maj=18, mino=4)
    E("hips", "pelvis", (1.04, 1.1, 0.76), M["sack"], (-0.02, 0, 1.06))
    E("spine", "waist", (0.82, 0.9, 0.62), M["sack"], (0.0, 0, 1.38))
    E("chest", "chest_m", (1.0, 1.1, 0.84), M["sack"], (-0.02, 0, 1.74))
    E("chest", "bust", (0.5, 0.92, 0.44), M["sack_l"], (0.3, 0, 1.72), segs=14, rings=8)
    patch("spine", "belly_patch", (0.12, -0.46, 1.36), 0.24, 0.2, M["pale"], ry=0.07)
    patch("chest", "chest_patch", (-0.18, -0.52, 1.8), 0.2, 0.17, M["blue"], ry=0.06, tilt=8)
    patch("hips", "hip_patch", (0.14, -0.52, 1.06), 0.17, 0.2, M["wine"], ry=0.06, tilt=-6)
    T("spine", "belly_seam", [(0.42, 0.0, 1.12), (0.44, 0.0, 1.3), (0.43, 0.0, 1.5), (0.44, 0.0, 1.68)], [0.02] * 4, M["stitch"], sides=5)
    for k, z in enumerate((1.18, 1.3, 1.42, 1.54, 1.66)):
        B("spine" if z < 1.5 else "chest", "seam_tick%d" % k, (0.02, 0.15, 0.025), M["stitch"], (0.44, 0.0, z))
    # stuffing poking out of torn seams
    for k, (j, p, rot) in enumerate((("chest", (0.0, -0.5, 2.0), (-30, 0, 10)), ("chest", (0.1, -0.54, 2.02), (-50, 0, -10)),
                                     ("hips", (0.3, -0.5, 0.9), (-80, 0, 0)), ("chest", (0.05, 0.5, 2.0), (30, 0, 0)))):
        C(j, "stuff%d" % k, 0.06, 0.0, 0.2, M["straw"], p, rot, segs=5)
    # ---- ragged apron skirt -------------------------------------------------------------------------
    SK_Z, SK_R0, SK_R1 = 1.22, 0.5, 0.78
    sectors = (((-100, -60), "sack_l", 0.66), ((-60, -20), "band_d", 0.78), ((-20, 20), "sack_l", 0.7), ((20, 60), "pale", 0.8),
               ((60, 100), "sack_l", 0.64), ((80, 140), "band_d", 0.7), ((140, 220), "sack", 0.74), ((220, 280), "band_d", 0.68))
    for k, ((a0, a1), mk, h) in enumerate(sectors):
        ob = LH.skirt_panel("apron%d" % k, a0, a1, SK_R0, SK_R0 + (SK_R1 - SK_R0) * h / 0.8, h, 0.04, M[mk], segs=5, sy=1.1)
        LH.place(ob, (0, 0, SK_Z))
        attach(ob, "ap")
    patch("ap", "apron_patch", (0.55, -0.42, 0.9), 0.15, 0.16, M["wine"], ry=0.04, tilt=-50)
    # hem rags (pendulums)
    for k in range(6):
        a = math.radians(-100 + 40 * k)
        rr = SK_R0 + (SK_R1 - SK_R0) * 0.78
        x, y = rr * math.cos(a), rr * math.sin(a) * 1.1
        jn = "rg%d" % k
        J(jn, "ap", (x, y, 0.5))
        B(jn, "rag%d" % k, (0.05, 0.2, 0.28), M["band_d"] if k % 2 else M["sack"], (x, y, 0.38), (0, 0, math.degrees(a)), bevel=0.01)
        C(jn, "rag_tip%d" % k, 0.1, 0.0, 0.1, M["band_d"] if k % 2 else M["sack"], (x, y, 0.2), (0, 0, math.degrees(a)), segs=4)
    # ---- arms ---------------------------------------------------------------------------------------
    for s, y in (("n", -1), ("f", 1)):
        far = s == "f"
        ua = M["burlap"]
        fa = M["pale"]
        E("sh_" + s, "shoulder_" + s, (0.46, 0.44, 0.42), M["blue"] if far else M["burlap"], (0.0, y * 0.52, 1.88))
        Lm("sh_" + s, "ua_" + s, 0.58, 0.19, 0.17, ua, (0, y * 0.52, 1.88))
        E("el_" + s, "elbow_" + s, (0.38, 0.38, 0.34), M["sack"], (0, y * 0.52, 1.34))
        Lm("el_" + s, "fa_" + s, 0.52, 0.17, 0.15, fa, (0, y * 0.52, 1.34))
        R("sh_" + s, "ua_st_" + s, 0.185, 0.02, M["stitch"], (0, y * 0.52, 1.6), maj=14, mino=4)
        if not far:
            patch("sh_" + s, "ua_patch", (0.0, y * 0.52 - 0.17, 1.62), 0.1, 0.12, M["wine"], ry=0.04)
        # bandaged wrist + big fist
        for k, z in enumerate((1.0, 0.94, 0.88, 0.82)):
            R("el_" + s, "wrap_%s%d" % (s, k), 0.175, 0.032, M["band"] if k % 2 == 0 else M["band_d"], (0, y * 0.52, z), maj=14, mino=5)
        E("ha_" + s, "fist_" + s, (0.58, 0.54, 0.56), M["band"], (0.03, y * 0.52, 0.56), segs=16, rings=10)
        for k, (z, rot, mk) in enumerate(((0.7, 18, "band_d"), (0.58, -16, "band_d"), (0.46, 14, "band_d"))):
            R("ha_" + s, "fwrap_%s%d" % (s, k), 0.255 - 0.02 * abs(z - 0.58) * 5, 0.03, M[mk],
              (0.03, y * 0.52, z), (rot, 0, 0), scale=(1.0, 1.0, 1.0), maj=16, mino=5)
        for k in range(3):   # knuckle stitches
            B("ha_" + s, "knuckle_%s%d" % (s, k), (0.02, 0.025, 0.12), M["stitch"], (0.3, y * 0.52 + (k - 1) * 0.12, 0.58))
        # loose bandage tail
        B("bt_" + s, "bandage_tail_" + s, (0.05, 0.16, 0.34), M["band"], (0.05, y * 0.52 - y * 0.0, 0.62), (0, 0, 0), bevel=0.008)
    # ---- legs ---------------------------------------------------------------------------------------
    feet = []
    for s, y in (("n", -1), ("f", 1)):
        yy = y * 0.27
        far = s == "f"
        Lm("th_" + s, "thigh_" + s, 0.46, 0.22, 0.19, M["sack"], (0, yy, HIP_Z))
        E("kn_" + s, "knee_" + s, (0.34, 0.34, 0.3), M["sack"], (0.02, yy, HIP_Z - L1))
        Lm("kn_" + s, "shin_" + s, 0.36, 0.19, 0.15, M["burlap"], (0, yy, HIP_Z - L1))
        R("kn_" + s, "shin_st_" + s, 0.175, 0.02, M["stitch"], (0, yy, 0.34), maj=14, mino=4)
        if not far:
            patch("kn_" + s, "knee_patch", (0.12, yy - 0.15, HIP_Z - L1 + 0.0), 0.1, 0.1, M["wine"], ry=0.04)
        feet.append(E("an_" + s, "foot_" + s, (0.74, 0.4, 0.3), M["sack"], (0.17, yy, 0.17), segs=14, rings=8))
        E("an_" + s, "toe_" + s, (0.34, 0.36, 0.24), M["pale"], (0.46, yy, 0.13), segs=10, rings=6)
        feet.append(B("an_" + s, "sole_" + s, (0.78, 0.42, 0.05), M["leather"], (0.17, yy, 0.03), bevel=0.02))
    # ---- heap of rags (death / pile): lumps of cloth, stuffing, a yarn coil, a fist and a foot, one dead button eye ----
    heap = [((-0.5, -0.05, 0.26), (1.1, 1.0, 0.56), "sack"), ((0.5, 0.0, 0.22), (1.1, 0.95, 0.46), "burlap"),
            ((0.0, -0.35, 0.36), (1.0, 0.8, 0.62), "sack_l"), ((-0.05, 0.28, 0.42), (0.9, 0.8, 0.66), "band_d"),
            ((0.85, -0.3, 0.15), (0.6, 0.55, 0.3), "pale"), ((-0.95, 0.12, 0.15), (0.6, 0.55, 0.3), "wine"),
            ((0.05, 0.0, 0.68), (0.8, 0.72, 0.5), "burlap"), ((-0.4, -0.45, 0.5), (0.5, 0.42, 0.4), "blue"),
            ((0.42, -0.4, 0.48), (0.5, 0.4, 0.36), "wine")]
    for k, (loc, sz, mk) in enumerate(heap):
        E("heap", "heap%d" % k, sz, M[mk], loc, (0, 0, 14 * k), segs=12, rings=8)
    for k, (loc, rot) in enumerate((((0.1, -0.58, 0.58), (-70, 0, 20)), ((-0.6, -0.3, 0.56), (-60, 0, -30)),
                                    ((0.62, -0.42, 0.62), (-85, 0, 10)), ((-0.1, 0.35, 0.8), (40, 0, 0)),
                                    ((0.3, 0.1, 0.92), (-20, 0, 15)))):
        C("heap", "heap_stuff%d" % k, 0.07, 0.0, 0.26, M["straw"], loc, rot, segs=5)
    E("heap", "heap_fist", (0.56, 0.5, 0.46), M["band"], (1.0, -0.52, 0.22), segs=12, rings=8)
    R("heap", "heap_fist_w", 0.24, 0.03, M["band_d"], (1.0, -0.52, 0.22), (0, 70, 0), maj=14, mino=5)
    E("heap", "heap_foot", (0.66, 0.4, 0.28), M["sack"], (-1.0, -0.5, 0.15), segs=12, rings=8)
    E("heap", "heap_toe", (0.3, 0.34, 0.22), M["pale"], (-1.28, -0.5, 0.12), segs=10, rings=6)
    R("heap", "heap_yarn", 0.26, 0.085, M["yarn"], (-0.1, -0.52, 0.26), (60, 0, 10), scale=(1.0, 1.0, 1.0), maj=14, mino=6)
    R("heap", "heap_yarn2", 0.2, 0.07, M["yarn_d"], (0.25, -0.6, 0.2), (75, 0, -20), maj=14, mino=6)
    R("heap", "heap_roll", 0.18, 0.05, M["band"], (0.62, 0.22, 0.2), (80, 0, 0), maj=14, mino=5)
    # a dead button eye on top of the heap
    R("heap", "heap_eye_ring", 0.16, 0.035, M["brass"], (0.2, -0.64, 0.72), (80, 0, 0), maj=16, mino=5)
    Y("heap", "heap_eye", 0.14, 0.05, M["eye_dim"], (0.2, -0.65, 0.72), (80, 0, 0), segs=14)
    # ---- smear + dust for the slam -------------------------------------------------------------------
    smear = L.tube("slam_smear", L.arc_pts((0.1, -0.75, 1.85), 1.35, 105, -25, 10),
                   [0.01, 0.07, 0.12, 0.15, 0.17, 0.17, 0.15, 0.12, 0.07, 0.01], M["smear"], depth=0.35)
    attach(smear, "chest")
    dust = []
    for k, (x, z, sz) in enumerate(((0.9, 0.1, 0.3), (1.2, 0.2, 0.4), (1.55, 0.12, 0.28), (0.65, 0.05, 0.22), (1.35, 0.5, 0.2), (1.0, 0.4, 0.16))):
        dust.append(attach(ellipsoid("dust%d" % k, (sz, sz * 0.9, sz * 0.8), M["dust"], loc=(x, -0.2 + 0.1 * (k % 3), z), segs=8, rings=6), "root"))
    return r, M, feet, eyes, smear, dust


# --------------------------------------------------------------------------
# poses (flat dicts, see lib_enemies.split)

RIG = None


def legs(hip_dx=0.0, hip_dz=0.0, xn=0.12, xf=-0.12, ln=0.0, lf=0.0, hips_ang=0.0, toe_n=0.0, toe_f=0.0):
    """Planted-foot IK for both legs.  hip offset (dx, dz); foot targets x (world) and lift above the ground."""
    p = {}
    for s, tx, lift, toe in (("n", xn, ln, toe_n), ("f", xf, lf, toe_f)):
        up, lo, low = LH.ik2((hip_dx, HIP_Z + hip_dz), (tx, ANK_Z + lift), L1, L2, hips_ang, -1)
        p["th_" + s] = up
        p["kn_" + s] = lo
        p["an_" + s] = LH.angnorm(-low) + toe
    p["hips.dx"] = hip_dx
    p["hips.dz"] = hip_dz
    return p


BASE_ARMS = {"sh_n": 17, "el_n": 16, "sh_f": 12, "el_f": 18}


def sway(p, t, amp=1.0, w=1):
    """Secondary motion: braids, rags and bandage tails hang and lag."""
    for s, ph in (("n", 0.0), ("f", 0.2)):
        for k in range(3):
            p["br%s%d" % (s, k)] = amp * 4.0 * math.sin(TAU * (w * t - 0.18 * k - ph))
    for k in range(6):
        p["rg%d" % k] = amp * 5.0 * math.sin(TAU * (w * t - 0.1 * k)) + (2 if k % 2 else -2)
    for s in ("n", "f"):
        p["bt_" + s] = amp * 6.0 * math.sin(TAU * (w * t - 0.3))
    p["ap"] = amp * 1.5 * math.sin(TAU * (w * t - 0.2))
    return p


def hang_chain(p, hang=True):
    """Keep the braids hanging straight down whatever the torso does (cancel the accumulated pitch)."""
    acc = sum(p.get(k, 0.0) for k in ("hips", "spine", "chest", "neck", "head"))
    for s in ("n", "f"):
        a = acc
        for k in range(3):
            j = "br%s%d" % (s, k)
            v = p.get(j, 0.0)
            p[j] = -a + v
            a += p[j]
    return p


KS = 0.94          # whole-rig scale: ~2.85 u (~91 px) from the soles to the top of the hair
HEAD_S = 1.1       # rag-doll head: a little oversized


def finish(p, t=0.0, amp=1.0, w=1, hang=True):
    sway(p, t, amp, w)
    p.setdefault("head:z", -22)
    p.setdefault("neck:z", -4)
    p["root.s"] = KS
    if "head.s" not in p:
        p["head.s"] = HEAD_S
    if "heap.sz" not in p:
        p["heap.s"] = 0.001                 # the rag heap only exists in the death / assemble / pile frames
    if hang:
        hang_chain(p)
    # keep the hanging rags and bandage tails vertical in world space; crouching shortens the rags so they never go under the floor
    shorten = max(0.12, 1.0 + 1.7 * min(0.0, p.get("hips.dz", 0.0)))
    for k in range(6):
        p["rg%d" % k] = p.get("rg%d" % k, 0.0) - p.get("hips", 0.0)
        p["rg%d.sz" % k] = shorten
    for s in ("n", "f"):
        p["bt_" + s] = p.get("bt_" + s, 0.0) - (p.get("hips", 0.0) + p.get("spine", 0.0) + p.get("chest", 0.0) +
                                                p.get("sh_" + s, 0.0) + p.get("el_" + s, 0.0))
    return p


def idle(i, n):
    t = i / n
    br = math.sin(TAU * t)
    br2 = math.sin(TAU * t - 0.8)
    p = dict(BASE_ARMS)
    p.update(legs(0.0, -0.012 * (1 - math.cos(TAU * t)) / 2 * 2, 0.13, -0.12))
    p.update({"spine": -2 + 1.0 * br, "chest": -3 + 1.6 * br, "neck": 1.0 * br2, "head": 1 - 1.5 * br2,
              "sh_n": 17 + 3 * br2, "el_n": 16 + 2 * br, "sh_f": 12 + 2 * br2, "el_f": 18 + 2 * br})
    return finish(p, t)


def walk(i, n):
    t = i / n
    p = dict(BASE_ARMS)
    A, H = 0.34, 0.2
    ft = {}
    for s, ph in (("n", 0.0), ("f", 0.5)):
        u = (t + ph) % 1.0
        if u < 0.5:                            # stance: foot slides back
            x = A * (1 - 4 * u)
            lift = 0.0
            toe = 8 * (1 - abs(2 * (u * 2) - 1)) * 0
        else:                                  # swing: lift and carry forward
            v = (u - 0.5) * 2
            x = -A + 2 * A * common.ease(v)
            lift = H * math.sin(math.pi * v)
        ft[s] = (x, lift)
    c2 = math.cos(2 * TAU * t)
    bob = -0.05 - 0.04 * c2
    p.update(legs(0.05 * math.sin(TAU * t), bob, ft["n"][0], ft["f"][0], ft["n"][1], ft["f"][1]))
    sw = math.sin(TAU * t)
    p.update({"spine": -4 + 1.5 * c2, "chest": -4 + 1.5 * c2, "neck": 1, "head": -2 - 1.5 * c2,
              "sh_n": 20 - 26 * sw, "el_n": 20 + 8 * math.cos(TAU * t), "sh_f": 15 + 26 * sw, "el_f": 20 - 8 * math.cos(TAU * t)})
    return finish(p, t, 1.4)


# attack: 8 key poses at the frame times (windup 3 / active 2 / recover 3)
def _atk(spine, chest, head, shn, eln, shf, elf, dz, dx, lf=0.0, ln=0.0, xn=0.2, xf=-0.1, extra=None):
    p = {"spine": spine, "chest": chest, "neck": 0.0, "head": head, "sh_n": shn, "el_n": eln, "sh_f": shf, "el_f": elf}
    p.update(legs(dx, dz, xn, xf, ln, lf))
    if extra:
        p.update(extra)
    return p


# Sign conventions (common.py): a joint hanging down swings FORWARD with + angles, a joint pointing up (spine, chest, head)
# leans BACKWARD with + angles.  The world angle of an arm = spine + chest + shoulder (0 = down, 90 = forward, 180 = up).
ATK = [
    _atk(0, 2, 4, 72, 30, 66, 32, -0.12, -0.02),                           # windup 1: crouch, fists start to rise
    _atk(4, 8, 8, 118, 20, 114, 22, -0.08, -0.06),                         # windup 2: arms up
    _atk(8, 16, 12, 156, 10, 152, 12, 0.0, -0.1, xn=0.1, xf=-0.22),        # windup 3: fists high overhead, leaning back
    _atk(-6, -14, -6, 120, 6, 118, 8, -0.1, 0.04, extra={"_smear": 1}),    # active 1: the slam comes down
    _atk(-12, -20, -14, 70, 4, 68, 4, -0.3, 0.12, xn=0.26, xf=-0.06, extra={"_dust": 1}),   # active 2: impact, fists on the floor
    _atk(-11, -19, -14, 68, 5, 66, 5, -0.28, 0.11, xn=0.26, xf=-0.06, extra={"_dust": 1}),  # recover 1: hold
    _atk(-5, -9, -6, 69, 14, 67, 16, -0.18, 0.06, xn=0.2, xf=-0.1),                         # recover 2: pull up
    _atk(-2, -3, -2, 17, 16, 12, 18, -0.04, 0.0, xn=0.13, xf=-0.12),                        # recover 3: back to idle
]


def attack(i, n):
    p = dict(ATK[i])
    return finish(p, 0.1 * i, 1.6, hang=True)


def hurt(i, n):
    k = (0, 1, 2)[i]
    ch = (10, 14, 6)[k]
    p = dict(BASE_ARMS)
    p.update(legs((-0.1, -0.12, -0.05)[k], (-0.06, -0.1, -0.04)[k], (0.12, 0.08, 0.12)[k], (-0.12, -0.2, -0.14)[k]))
    p.update({"spine": ch * 0.5, "chest": ch, "head": (16, 20, 8)[k], "sh_n": (34, 40, 22)[k], "el_n": (30, 36, 24)[k],
              "sh_f": (28, 34, 18)[k], "el_f": (30, 34, 22)[k]})
    return finish(p, 0.3 * i, 1.8)


def jump(i, n):
    p = dict(BASE_ARMS)
    if i == 0:      # launch: deep crouch, arms swung back
        p.update(legs(-0.04, -0.3, 0.2, -0.1))
        p.update({"spine": -8, "chest": -12, "head": -4, "sh_n": -10, "el_n": 20, "sh_f": -14, "el_f": 20})
    else:           # airborne: legs tucked, arms thrown up
        p.update(legs(0.0, -0.02, 0.18, -0.06, 0.16, 0.2))
        p.update({"spine": 2, "chest": 4, "head": 2, "sh_n": 64, "el_n": 22, "sh_f": 58, "el_f": 24})
    return finish(p, 0.2 * i, 1.8)


# death: standing -> stagger -> knees buckle -> slump -> the body deflates into a heap of rags.
# keys: drop, hips dx, spine, chest, head, head twist, arm (shoulder, elbow), foot x (n, f), body z-squash, heap growth
DEATH = [
    dict(drop=-0.04, dx=-0.1, sp=8, ch=14, hd=16, tw=-22, arm=(40, 30), ft=(0.12, -0.2), sq=1.0, hp=0.0),
    dict(drop=-0.2, dx=-0.1, sp=2, ch=0, hd=6, tw=-24, arm=(28, 30), ft=(0.1, -0.12), sq=1.0, hp=0.0),
    dict(drop=-0.4, dx=-0.06, sp=-4, ch=-10, hd=-6, tw=-26, arm=(46, 24), ft=(0.06, -0.06), sq=0.92, hp=0.1),
    dict(drop=-0.5, dx=-0.04, sp=-6, ch=-14, hd=-10, tw=-28, arm=(52, 20), ft=(0.04, -0.04), sq=0.78, hp=0.35),
    dict(drop=-0.5, dx=-0.04, sp=-6, ch=-14, hd=-12, tw=-28, arm=(55, 16), ft=(0.04, -0.04), sq=0.6, hp=0.6),
    dict(drop=-0.5, dx=-0.04, sp=-6, ch=-14, hd=-14, tw=-30, arm=(55, 16), ft=(0.04, -0.04), sq=0.42, hp=0.82),
    dict(drop=-0.5, dx=-0.04, sp=-6, ch=-14, hd=-14, tw=-30, arm=(55, 16), ft=(0.04, -0.04), sq=0.25, hp=0.95),
    dict(drop=-0.5, dx=-0.04, sp=-6, ch=-14, hd=-14, tw=-30, arm=(55, 16), ft=(0.04, -0.04), sq=0.12, hp=1.0),
]


def death_pose(k):
    d = DEATH[k]
    sq = d["sq"]
    p = dict(BASE_ARMS)
    p.update(legs(d["dx"], d["drop"], d["ft"][0], d["ft"][1]))
    p.update({"spine": d["sp"], "chest": d["ch"], "head": d["hd"], "head:z": d["tw"], "sh_n": d["arm"][0], "el_n": d["arm"][1],
              "sh_f": d["arm"][0], "el_f": d["arm"][1] + 4})
    p["body.s"] = sq                        # uniform, so the rotated joints below it do not shear: she sinks into the heap
    p["heap.sz"] = max(0.001, d["hp"])
    p["heap.sx"] = max(0.001, 0.3 + 0.7 * d["hp"])
    p["heap.sy"] = max(0.001, 0.3 + 0.7 * d["hp"])
    return p


def death(i, n):
    return finish(death_pose(i), 0.1 * i, 1.5, hang=False)


def assemble(i, n):
    """The heap rises: death played backwards, but the last frame is the idle stance."""
    if i == n - 1:
        return idle(0, 6)
    return finish(death_pose(n - 1 - i), 0.1 * i, 1.5, hang=False)


def pile(i, n):
    return finish(death_pose(len(DEATH) - 1), 0.0, 0.0, hang=False)


def main():
    global RIG
    r, M, feet, eyes, smear, dust = build()
    RIG = r
    sh = L.Sheet("golem", r)
    for ob in (smear, *dust, eyes["dim_n"], eyes["dim_f"]):
        sh.prop(ob, False)
    for k in ("lit_n", "lit_f", "hot_n", "hot_f"):
        sh.prop(eyes[k], True)

    def vis_alive(i, n):
        return {}

    def eyes_state(lit):
        return {"lit_n": lit, "lit_f": lit, "hot_n": lit, "hot_f": lit, "dim_n": not lit, "dim_f": not lit}

    def vis_attack(i, n):
        v = eyes_state(True)
        v[smear.name] = i == WA[0]
        for d in dust:
            v[d.name] = i in (WA[0] + 1, WA[0] + 2)
        return v

    def vis_death(i, n):
        return eyes_state(i < 3)

    def vis_assemble(i, n):
        return eyes_state(i >= 5)

    # the camera looks 4 deg down, so the near corner of a big sole lands ~1 px below the anchor row: lift the rig a little
    ground = dict(ground_objs=feet, lift_fn=lambda i, n: 0.03)
    sh.render("idle", 6, idle, fps=7, loop=True, **ground)
    sh.render("walk", 8, walk, fps=9, loop=True, **ground)
    sh.render("attack", 8, attack, fps=12, wa=WA, vis_fn=vis_attack, **ground)
    sh.render("hurt", 3, hurt, fps=12, **ground)
    sh.render("jump", 2, jump, fps=8, ground_objs=feet, lift_fn=lambda i, n: (0.03, 0.17)[i])   # frame 1 is airborne: feet tucked up
    # the heap is deep (it reaches towards the camera), so its near edge needs a bit more lift than a standing sole
    gd = dict(ground_objs=feet)
    sh.render("death", 8, death, fps=10, vis_fn=vis_death, lift_fn=lambda i, n: 0.03 + 0.06 * DEATH[i]["hp"], **gd)
    sh.render("assemble", 8, assemble, fps=10, vis_fn=vis_assemble, lift_fn=lambda i, n: 0.03 + 0.06 * DEATH[n - 1 - i]["hp"], **gd)
    sh.render("pile", 1, pile, fps=1, vis_fn=lambda i, n: eyes_state(False), lift_fn=lambda i, n: 0.09, **gd)
    sh.write_spec()


L.run(main)
