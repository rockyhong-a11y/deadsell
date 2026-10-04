"""DEADSELL NPC sprite sheet: Seamstress Selma (corpse seamstress, rest-stop NPC).

    blender -b --factory-startup -P tools/blender/asset_seamstress.py

Tall gaunt corpse seamstress: bone-white skin with stitch lines on cheek and arms, long black hair in a
messy bun pierced with big needles, a brass monocle, a patchwork dress of mismatched fabrics, a
measuring-tape scarf, red thread spools on her belt and huge shears strapped to her back.  She holds a
patch of cloth in the far hand and a needle in the near one; the red thread between them is rebuilt for every
frame (a tube between the needle eye and the stitch).  Writes build/frames/seamstress/{idle,talk,sew}_###.png
+ spec.json (frame 128x128, anchor 64,124; packed to public/assets/sprites/seamstress.png by pack_all.py).
"""
import bpy
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import lib_npc as N  # noqa: E402
import lib_heroine as LH  # noqa: E402
from lib_npc import mat, glow, pend  # noqa: E402

N.AY = 124                     # anchor (64, 124) for the tall NPC sheets (the older NPCs use 116)
K = 1.28                       # 1.75 u native -> 2.24 u body (~72 px), ~2.9 u with the needles and shears
N.setup_scene()
npc = N.NPC("seamstress", K)
rig = npc.rig
J = rig.joint

# ---------------------------------------------------------------------------
# materials
M = {}
M["skin"] = mat("se_skin", "#e7dfd0", "#7e6c8c", "#fffaf2")
M["skin_f"] = mat("se_skin_f", "#cdc4b6", "#695a7a", "#ebe3d6")
M["skin_sh"] = mat("se_skin_sh", "#a89aa4", "#5a4a68", "#cdc2c8", rim=False)
M["socket"] = mat("se_socket", "#3a2844", "#1c1226", "#54405e", rim=False)
M["stitch"] = mat("se_stitch", "#7a1f2a", "#3a0d1c", "#a8343e", rim=False)
M["thread"] = mat("se_thread", "#d6384f", "#7a1530", "#ff6a7a")
M["hair"] = mat("se_hair", "#201a2a", "#0c0912", "#473c5c")
M["hair_d"] = mat("se_hair_d", "#16121e", "#08060c", "#352c46")
M["wine"] = mat("se_wine", "#6e2536", "#32101e", "#a0425a", rim=False)
M["wine_d"] = mat("se_wine_d", "#4d1a2a", "#240c16", "#7a3046", rim=False)
M["slate"] = mat("se_slate", "#41536a", "#1c2434", "#6a82a0", rim=False)
M["mustard"] = mat("se_mustard", "#a8803a", "#523424", "#d8b062", rim=False)
M["moss"] = mat("se_moss", "#4a5e3c", "#202c28", "#74905a", rim=False)
M["charcoal"] = mat("se_charcoal", "#3e3744", "#181420", "#5e566c", rim=False)
M["cream"] = mat("se_cream", "#cfc09a", "#7c6c6a", "#efe2ba", rim=False)
M["tape"] = mat("se_tape", "#eadb9e", "#8a7a70", "#fff4c8", rim=False)
M["tick"] = mat("se_tick", "#2a1e22", "#140c12", "#3c2c32", rim=False)
M["leather"] = mat("se_leather", "#5c3c2c", "#2a1620", "#85583f", rim=False)
M["leather_d"] = mat("se_leather_d", "#3e2830", "#1c1018", "#5a3a3c", rim=False)
M["boot"] = mat("se_boot", "#352a34", "#16101a", "#554456")
M["boot_f"] = mat("se_boot_f", "#271f2a", "#110c14", "#41343f")
M["sole"] = mat("se_sole", "#1c1218", "#0e080e", "#2e2028", rim=False)
M["leg"] = mat("se_leg", "#2e2838", "#14101e", "#4a4260")
M["leg_f"] = mat("se_leg_f", "#231e2c", "#0f0b16", "#3a3248")
M["steel"] = mat("se_steel", "#aab2c6", "#515a76", "#eef2fb")
M["steel_d"] = mat("se_steel_d", "#6f768c", "#383b54", "#aeb6cb")
M["brass"] = mat("se_brass", "#d9a54a", "#7a4a22", "#ffe19a", rim=False)
M["wood"] = mat("se_wood", "#8a6a46", "#40291f", "#b48a58")
M["eye"] = glow("se_eye", "#c4ecff")
M["mouth"] = mat("se_mouth", "#6a2a3c", "#38132a", "#8e4458", rim=False)
M["glint"] = glow("se_glint", "#e6fdff")
M["pin"] = mat("se_pin", "#c8d0e0", "#6a728c", "#f4f7ff", rim=False)
M["linen"] = mat("se_linen", "#b9b4c4", "#6a6078", "#e4e0ec", rim=False)

body_mats = dict(pelvis=M["wine_d"], waist=M["wine"], top=M["wine"], shoulder=M["moss"],
                 sleeve=M["moss"], sleeve_f=M["slate"], cuff=M["mustard"], glove=M["skin"], glove_f=M["skin_f"],
                 leg=M["leg"], leg_f=M["leg_f"], boot=M["boot"], boot_f=M["boot_f"], bootcuff=M["leather"],
                 sole=M["sole"], belt=M["leather"], buckle=M["brass"], skin=M["skin"], eye=M["eye"],
                 mouth=M["mouth"])
E, B, L, C, Y, R, T, P = npc.E, npc.B, npc.L, npc.C, npc.Y, npc.R, npc.T, npc.P

# ---------------------------------------------------------------------------
# gaunt body: narrow ribs and hips, long thin bone-white arms with stitched seams, thin legs (same joint lengths)
E("hips", "pelvis", (0.26, 0.27, 0.22), M["wine_d"], (-0.02, 0, 0.92))
E("spine", "waist", (0.15, 0.18, 0.28), M["wine"], (0.0, 0, 1.07))
E("chest", "ribs", (0.21, 0.24, 0.30), M["wine"], (-0.015, 0, 1.25))
E("chest", "bust", (0.12, 0.2, 0.1), M["wine"], (0.055, 0, 1.225))
E("hips", "belt", (0.255, 0.29, 0.06), M["leather"], (-0.005, 0, 0.985))
B("hips", "buckle", (0.035, 0.06, 0.05), M["brass"], (0.126, 0, 0.985))
for s, y in (("n", -0.15), ("f", 0.15)):
    far = s == "f"
    sl = M["slate"] if far else M["moss"]
    sk = M["skin_f"] if far else M["skin"]
    E("sh_" + s, "pauld_" + s, (0.14, 0.13, 0.12), sl, (0.0, y, 1.375))
    L("sh_" + s, "sleeve_" + s, 0.17, 0.056, 0.05, sl, (0, y, 1.37))
    L("sh_" + s, "ua_" + s, 0.26, 0.04, 0.034, sk, (0, y, 1.37))
    L("el_" + s, "fa_" + s, 0.22, 0.034, 0.029, sk, (0, y, 1.11))
    E("el_" + s, "elbow_" + s, (0.07, 0.07, 0.07), sk, (0, y, 1.11))
    R("sh_" + s, "stitch_ua_" + s, 0.039, 0.0055, M["stitch"], (0, y, 1.17), maj=10, mino=4)
    R("sh_" + s, "stitch_ua2_" + s, 0.037, 0.0055, M["stitch"], (0, y, 1.14), maj=10, mino=4)
    R("el_" + s, "stitch_fa_" + s, 0.034, 0.0055, M["stitch"], (0, y, 1.02), maj=10, mino=4)
    R("el_" + s, "stitch_fa2_" + s, 0.032, 0.0055, M["stitch"], (0, y, 0.99), maj=10, mino=4)
    B("el_" + s, "stitch_fa_l_" + s, (0.008, 0.008, 0.1), M["stitch"], (0.032 if not far else -0.03, y, 1.01))
    E("el_" + s, "cuff_" + s, (0.085, 0.085, 0.05), M["mustard"] if not far else M["wine"], (0, y, 0.935))
    E("ha_" + s, "hand_" + s, (0.085, 0.055, 0.11), sk, (0.008, y, 0.845))
for s, y in (("n", -0.085), ("f", 0.085)):
    far = s == "f"
    lg = M["leg_f"] if far else M["leg"]
    bt = M["boot_f"] if far else M["boot"]
    L("th_" + s, "thigh_" + s, 0.40, 0.07, 0.05, lg, (0, y, 0.90))
    L("kn_" + s, "shin_" + s, 0.41, 0.05, 0.04, lg, (0, y, 0.50))
    L("kn_" + s, "boot_" + s, 0.29, 0.056, 0.047, bt, (0, y, 0.38))
    E("kn_" + s, "bootcuff_" + s, (0.13, 0.13, 0.055), M["leather"], (0, y, 0.375))
    B("an_" + s, "foot_" + s, (0.2, 0.085, 0.08), bt, (0.05, y, 0.04), bevel=0.025)
    B("an_" + s, "sole_" + s, (0.205, 0.09, 0.025), M["sole"], (0.05, y, 0.012))

# face: pale narrow head with sunken sockets, hollow cheeks, a stitched cheek line
npc.face(body_mats)
E("head", "sock_n", (0.05, 0.08, 0.092), M["socket"], (0.103, -0.072, 1.595))
E("head", "sock_f", (0.05, 0.08, 0.092), M["socket"], (0.103, 0.072, 1.595))
E("head", "cheek_n", (0.07, 0.035, 0.08), M["skin_sh"], (0.082, -0.104, 1.535))
E("head", "cheek_f", (0.07, 0.035, 0.08), M["skin_sh"], (0.082, 0.104, 1.535))
T("head", "cheek_stitch", [(0.118, -0.058, 1.532), (0.075, -0.094, 1.537), (0.03, -0.105, 1.545)],
  [0.0075] * 3, M["stitch"], sides=5)
for k, (cx, cy) in enumerate(((0.105, -0.07), (0.075, -0.093), (0.045, -0.103))):
    B("head", "cheek_tick%d" % k, (0.012, 0.008, 0.045), M["stitch"], (cx, cy - 0.003, 1.538), rot=(0, 0, 40))
T("neck", "neck_stitch", [(0.045, -0.025, 1.52), (0.052, -0.03, 1.48)], [0.007] * 2, M["stitch"], sides=4)
R("neck", "neck_ring", 0.05, 0.0075, M["stitch"], (0, 0, 1.47), maj=10, mino=4)
# brass monocle on the near eye with a chain down to the collar
R("head", "monocle", 0.058, 0.0125, M["brass"], (0.13, -0.074, 1.598), (0, 90, 0), maj=14, mino=5)
E("head", "monocle_glint", (0.012, 0.012, 0.03), M["glint"], (0.134, -0.098, 1.628), segs=6, rings=4)
T("head", "monocle_chain", [(0.13, -0.078, 1.538), (0.122, -0.104, 1.48), (0.1, -0.124, 1.41), (0.075, -0.13, 1.35)],
  [0.0065] * 4, M["brass"], sides=4)

# ---------------------------------------------------------------------------
# hair: cap + back + bangs + a long near lock, messy bun pierced with big needles
E("head", "hair_cap", (0.27, 0.245, 0.22), M["hair"], (-0.03, 0, 1.685))
E("head", "hair_back", (0.23, 0.23, 0.31), M["hair_d"], (-0.1, 0, 1.565))
E("head", "bangs", (0.11, 0.21, 0.065), M["hair"], (0.085, 0, 1.7), (0, 28, 0))
E("head", "lock_f", (0.055, 0.045, 0.19), M["hair_d"], (0.045, 0.103, 1.53), (0, -6, 0))
J("lockn1", "head", (-0.09, -0.115, 1.58))
J("lockn2", "lockn1", (-0.10, -0.125, 1.40))
J("lockn3", "lockn2", (-0.11, -0.125, 1.22))
L("lockn1", "lockn_a", 0.19, 0.052, 0.046, M["hair"], (-0.09, -0.115, 1.58))
L("lockn2", "lockn_b", 0.19, 0.046, 0.04, M["hair_d"], (-0.10, -0.125, 1.40))
L("lockn3", "lockn_c", 0.2, 0.04, 0.0, M["hair"], (-0.11, -0.125, 1.22))
E("head", "bun", (0.21, 0.2, 0.2), M["hair"], (-0.17, 0, 1.83))
E("head", "bun_l1", (0.16, 0.07, 0.11), M["hair_d"], (-0.2, -0.1, 1.88), (0, 0, 18))
E("head", "bun_l2", (0.14, 0.07, 0.1), M["hair"], (-0.13, 0.1, 1.9), (0, 0, -22))
E("head", "bun_l3", (0.1, 0.1, 0.12), M["hair_d"], (-0.23, 0.02, 1.92))
R("head", "bun_tie", 0.092, 0.013, M["thread"], (-0.17, 0, 1.79), (0, 14, 0), maj=14, mino=4)
BUN = (-0.17, 0.0, 1.83)
for k, (ang, ln, dy) in enumerate(((40, 0.62, -0.03), (130, 0.56, 0.03))):      # two needles pierce the bun, crossed
    a = math.radians(ang)
    d = (math.cos(a), math.sin(a))
    pts = [(BUN[0] + d[0] * ln * f, BUN[1] + dy, BUN[2] + d[1] * ln * f) for f in (-0.5, -0.4, 0.4, 0.5)]
    T("head", "pin%d" % k, pts, [0.003, 0.024, 0.024, 0.003], M["pin"], sides=5)
    E("head", "pinbead%d" % k, (0.06, 0.06, 0.06), M["thread"], (pts[3][0] - d[0] * 0.02, pts[3][1] - 0.01, pts[3][2] - d[1] * 0.02),
      segs=8, rings=5)

# ---------------------------------------------------------------------------
# patchwork dress: long skirt of mismatched sectors (own pivots so it can swing), stitched patches, ragged hem
J("sk_f", "hips", (0, 0, 0.99))
J("sk_b", "hips", (0, 0, 0.99))
SK_TOP, SK_R0, SK_R1 = 0.99, 0.15, 0.335
FRONT = ((-100, -58, "wine", 0.64), (-58, -20, "mustard", 0.69), (-20, 22, "slate", 0.62), (22, 62, "moss", 0.7),
         (62, 100, "wine_d", 0.65))
BACK = ((80, 135, "slate", 0.68), (135, 190, "wine_d", 0.72), (190, 245, "charcoal", 0.66), (245, 282, "moss", 0.7))
for k, (a0, a1, mk, h) in enumerate(FRONT):
    npc.skirt("sk_f", "sk_f%d" % k, a0, a1, SK_R0, SK_R0 + (SK_R1 - SK_R0) * h / 0.7, h, 0.024, M[mk], SK_TOP, segs=5, sy=1.1)
for k, (a0, a1, mk, h) in enumerate(BACK):
    npc.skirt("sk_b", "sk_b%d" % k, a0, a1, SK_R0 + 0.01, SK_R0 + 0.02 + (SK_R1 - SK_R0) * h / 0.7, h, 0.024, M[mk], SK_TOP, segs=6,
              sy=1.1, flare_back=0.05)


def skirt_r(z):
    return SK_R0 + (SK_R1 - SK_R0) * (SK_TOP - z) / 0.7


def patch(name, ang, z, w, h, mk, rz=0.0, edge="thread"):
    """Flat stitched patch on the front skirt at angle `ang` (deg, 0 = straight ahead), centre height z."""
    a = math.radians(ang)
    tilt = -math.degrees(math.atan2(SK_R1 - SK_R0, 0.7))
    for nm, dr, sz, mk_ in ((name + "_edge", 0.0, 0.018, edge), (name, 0.004, 0.0, mk)):
        r = skirt_r(z) + dr
        B("sk_f", nm, (0.012, w + sz, h + sz), M[mk_], (r * math.cos(a), r * math.sin(a) * 1.1, z), rot=(rz, tilt, ang), bevel=0.003)


patch("pat1", -40, 0.6, 0.11, 0.13, "cream")
patch("pat2", -8, 0.7, 0.1, 0.1, "wine")
patch("pat3", 38, 0.58, 0.12, 0.12, "cream", rz=8)
patch("pat4", 80, 0.66, 0.08, 0.14, "mustard")
patch("pat5", -82, 0.7, 0.09, 0.11, "slate")
# bodice details: lacing and a stitched seam down the front
for k, z in enumerate((1.3, 1.24, 1.18, 1.12)):
    for sg in (-1, 1):
        B("chest" if z > 1.18 else "spine", "lace%d_%d" % (k, sg), (0.016, 0.075, 0.012), M["thread"], (0.108 if z > 1.18 else 0.099, 0.0, z),
          rot=(sg * 28, 0, 0))
B("chest", "bodice_patch", (0.02, 0.1, 0.1), M["mustard"], (0.095, -0.13, 1.2), rot=(0, 0, 18))
B("chest", "bodice_patch2", (0.02, 0.09, 0.07), M["slate"], (0.08, -0.17, 1.31), rot=(0, 8, 24))

# ---------------------------------------------------------------------------
# measuring-tape scarf: wrap + a long front tail (ticks across every segment)
E("chest", "tape_wrap", (0.18, 0.25, 0.085), M["tape"], (-0.012, 0, 1.45))
E("chest", "tape_wrap2", (0.17, 0.24, 0.05), M["tape"], (0.008, 0, 1.4))
for k, z in enumerate((1.46, 1.44, 1.42)):
    B("chest", "tape_tick_w%d" % k, (0.2, 0.034, 0.008), M["tick"], (-0.01, 0.0, z))
SC_A = [(0.075, -0.135, 1.37), (0.09, -0.135, 1.27), (0.095, -0.135, 1.17), (0.09, -0.135, 1.07)]
prev = "chest"
for k, p in enumerate(SC_A):
    jn = "tpA%d" % k
    J(jn, prev, p)
    prev = jn
    if k < len(SC_A) - 1:
        nxt = SC_A[k + 1]
        cz = (p[2] + nxt[2]) / 2
        B(jn, "tpA_seg%d" % k, (0.045, 0.13, abs(p[2] - nxt[2]) + 0.015), M["tape"], ((p[0] + nxt[0]) / 2, p[1], cz))
        for t in range(4):
            B(jn, "tpA_tick%d_%d" % (k, t), (0.049, 0.134, 0.01 if t % 2 == 0 else 0.006), M["tick"],
              ((p[0] + nxt[0]) / 2, p[1], cz + 0.045 - t * 0.03))
B("tpA2", "tpA_end", (0.05, 0.13, 0.03), M["mustard"], (SC_A[3][0], SC_A[3][1], SC_A[3][2] + 0.01))

# ---------------------------------------------------------------------------
# red thread spools hanging from the belt (pendulums) + a pin cushion
for k, bx in enumerate((0.1, 0.0, -0.1)):
    jn = "spool%d" % k
    J(jn, "hips", (bx, -0.215, 0.975))
    L(jn, "spool_strap%d" % k, 0.05, 0.006, 0.006, M["leather_d"], (bx, -0.215, 0.975), segs=5)
    Y(jn, "spool_core%d" % k, 0.036, 0.075, M["thread"], (bx, -0.215, 0.905), segs=10)
    for dz in (-0.045, 0.045):
        Y(jn, "spool_fl%d_%d" % (k, dz > 0), 0.05, 0.014, M["wood"], (bx, -0.215, 0.905 + dz), segs=10)
B("hips", "pouch", (0.1, 0.055, 0.12), M["leather"], (0.19, -0.2, 0.9), bevel=0.015)
B("hips", "pouch_flap", (0.105, 0.06, 0.04), M["leather_d"], (0.19, -0.203, 0.95), bevel=0.01)

# ---------------------------------------------------------------------------
# huge shears strapped on the back (crossed blades, ring handles bound in red), held by a chest strap
J("shears", "chest", (-0.27, 0, 1.3))
PV = (-0.42, 0.0, 1.5)                       # pivot screw (world rest)
AXD = math.radians(22)                       # shears lean back 22 deg
AX_UP = (-math.sin(AXD), math.cos(AXD))
OPEN = math.radians(8)


def rot2(v, a):
    return (v[0] * math.cos(a) - v[1] * math.sin(a), v[0] * math.sin(a) + v[1] * math.cos(a))


def blade_pts(d, length, w0, w1=0.0):
    """XZ polygon from the pivot along direction d (unit 2D) for `length`: a slim blade, flat spine, tapering to a point."""
    perp = (-d[1], d[0])
    p0 = (PV[0], PV[2])
    tip = (p0[0] + d[0] * length, p0[1] + d[1] * length)
    return [(p0[0] + perp[0] * w0 * 0.3, p0[1] + perp[1] * w0 * 0.3), (p0[0] - perp[0] * w0, p0[1] - perp[1] * w0),
            (p0[0] + d[0] * length * 0.85 - perp[0] * w0 * 0.55, p0[1] + d[1] * length * 0.85 - perp[1] * w0 * 0.55),
            (tip[0], tip[1]), (p0[0] + d[0] * length * 0.5 + perp[0] * w0 * 0.3, p0[1] + d[1] * length * 0.5 + perp[1] * w0 * 0.3)]


for side, a, yy in (("a", OPEN, -0.016), ("b", -OPEN, 0.016)):
    d = rot2(AX_UP, a)                       # blade direction (up-back)
    back = (-d[0], -d[1])                    # handle direction (down-front)
    sgn = 1 if side == "a" else -1
    P("shears", "blade_" + side, blade_pts(d, 0.7, 0.055 * sgn, 0.0), 0.022, M["steel"], loc=(0, yy, 0))
    p_end = (PV[0] + back[0] * 0.42, PV[2] + back[1] * 0.42)
    T("shears", "shank_" + side, [(PV[0], yy, PV[2]), (p_end[0], yy, p_end[1])], [0.032, 0.028], M["steel_d"], sides=6)
    rc = (PV[0] + back[0] * 0.51, PV[2] + back[1] * 0.51)
    R("shears", "ring_" + side, 0.085, 0.022, M["brass"], (rc[0], yy, rc[1]), (90, 0, 0), scale=(1.0, 1.0, 1.25), maj=14, mino=5)
E("shears", "pivot_screw", (0.075, 0.05, 0.075), M["brass"], (PV[0], -0.035, PV[2]), segs=8, rings=5)
for z in (1.2, 1.62):
    B("shears", "shear_band%d" % int(z * 100), (0.12, 0.09, 0.05), M["leather_d"],
      (PV[0] - (z - PV[2]) * math.tan(AXD), 0.0, z), rot=(0, -math.degrees(AXD), 0))
T("chest", "shear_strap", [(-0.2, -0.07, 1.42), (-0.06, -0.14, 1.44), (0.05, -0.15, 1.38), (0.095, -0.145, 1.26), (0.07, -0.14, 1.1)],
  [0.024] * 5, M["leather_d"], sides=6, flat=0.45)
T("chest", "shear_strap_b", [(-0.24, -0.07, 1.4), (-0.2, -0.1, 1.28), (-0.14, -0.14, 1.16), (-0.05, -0.14, 1.04)],
  [0.022] * 4, M["leather_d"], sides=6, flat=0.45)

# ---------------------------------------------------------------------------
# needle in the near hand, patch of cloth in the far hand
J("needle_eye", "ha_n", (0.012, -0.15, 0.97))
J("stitch_pt", "ha_f", (0.2, 0.15, 0.85))
NDL = [(0.012, -0.15, 0.97), (0.012, -0.15, 0.5)]
T("ha_n", "needle", [(0.012, -0.15, 0.99), (0.012, -0.15, 0.55)], [0.016, 0.004], M["steel"], sides=5)
T("ha_n", "needle_head", [(0.012, -0.15, 1.02), (0.012, -0.15, 0.97)], [0.02, 0.02], M["steel"], sides=5)
R("ha_n", "needle_eye_ring", 0.026, 0.008, M["steel_d"], (0.012, -0.15, 1.0), (90, 0, 0), scale=(0.7, 1.0, 1.0), maj=10, mino=4)
cloth_loc = (0.1, 0.15, 0.82)
B("ha_f", "cloth_a", (0.26, 0.012, 0.2), M["linen"], (0.14, 0.15, 0.84), rot=(0, 0, 0), bevel=0.004)
B("ha_f", "cloth_b", (0.13, 0.014, 0.11), M["wine"], (0.2, 0.147, 0.8), rot=(0, 0, 6), bevel=0.004)
B("ha_f", "cloth_edge", (0.27, 0.014, 0.014), M["cream"], (0.14, 0.15, 0.935))
for k in range(5):
    B("ha_f", "cloth_st%d" % k, (0.012, 0.016, 0.05), M["thread"], (0.06 + 0.045 * k, 0.15, 0.82), rot=(0, 0, 0))

# ---------------------------------------------------------------------------
# animation helpers
SH_N = (0.0, 1.37)     # near shoulder (x, z) native rest
SH_F = (0.0, 1.37)
L1, L2 = 0.26, 0.22


def arm_ik(target, bend=1.0, parent_swing=0.0):
    up, lo, lo_w = LH.ik2(SH_N, target, L1, L2, parent_swing, bend)
    return up, lo, lo_w


THREAD_LEN = 0.62
THREADS = []


def make_thread(i, n, frame):
    """Build the red thread between the needle eye and the stitch point for the pose that is set right now."""
    bpy.context.view_layer.update()
    p0 = rig.joints["needle_eye"].matrix_world.translation.copy()
    p1 = rig.joints["stitch_pt"].matrix_world.translation.copy()
    d = (p1 - p0).length
    sag = min(0.3, math.sqrt(max(0.0, 0.375 * d * max(0.0, THREAD_LEN - d))))
    pts = []
    for k in range(11):
        t = k / 10
        q = p0 + (p1 - p0) * t
        q = q.copy()
        q.z -= sag * 4 * t * (1 - t)
        q.y = p0.y + (-0.02 - p0.y) * t
        pts.append((q.x, q.y, q.z))
    ob = LH.tube("thread_%d_%d" % (len(THREADS), frame), pts, [0.021] * 11, M["thread"], sides=4)
    THREADS.append((ob, frame))
    return ob


def key_threads(n):
    """Make every thread of this animation visible on its own frame only."""
    for ob, fr in THREADS:
        for f in range(1, n + 1):
            common.keyed_visibility(ob, f, f == fr)


def clear_threads():
    for ob, _ in THREADS:
        bpy.data.objects.remove(ob, do_unlink=True)
    THREADS.clear()


def extra_thread(n):
    def fn(i, nn, frame):
        make_thread(i, nn, frame)
        if i == nn - 1:
            key_threads(nn)
    return fn


def sway(a, t, amp, w=1):
    """Secondary motion for the cloth / hair / tape / spool chains."""
    a["sk_f"] = pend(t, 2.0 * amp, 0.15, w)
    a["sk_b"] = -2.0 + pend(t, 3.0 * amp, 0.35, w)
    a["shears"] = pend(t, 0.8 * amp, 0.25, w)
    for k in range(3):
        a["spool%d" % k] = pend(t, 6.0 * amp, 0.2 + 0.17 * k, w)
    for k in range(3):
        a["tpA%d" % k] = pend(t, 3.0 * amp, 0.1 + 0.14 * k, w) + (3 if k == 0 else 0)
    a["lockn1"] = pend(t, 2.0 * amp, 0.3, w)
    a["lockn2"] = pend(t, 3.0 * amp, 0.45, w)
    a["lockn3"] = pend(t, 4.0 * amp, 0.6, w)


def base_pose(t, mode, ik_n, ik_f, blink=0.0, w=1):
    """mode: 'idle' | 'talk' | 'sew'.  t = loop phase 0..1; ik_n / ik_f = near / far hand targets (native x, z)."""
    br = math.sin(N.TAU * t)
    br2 = math.sin(N.TAU * t - 0.7)
    a = {}
    a["spine"] = -2.0 + 1.0 * br
    a["chest"] = -3.0 + 1.5 * br
    a["neck"] = 4.0 - 1.0 * br2
    a["head"] = -2.0 + 1.2 * br2
    tw_head = -24
    if mode == "talk":
        a["head"] += 3.0 * math.sin(N.TAU * 2 * t)
        tw_head += 5.0 * math.sin(N.TAU * t)
    elif mode == "sew":
        a["neck"] = 9 + 3 * math.sin(N.TAU * t)
        a["head"] = -6 - 3 * math.sin(N.TAU * t - 0.6)
        a["chest"] = -4 + 2 * math.sin(N.TAU * t)
        tw_head = -30
    ps = a["spine"] + a["chest"]
    up, lo, low = arm_ik(ik_n, 1.0, ps)
    a["sh_n"], a["el_n"], a["ha_n"] = up, lo, 6.0 + 3 * br
    a["sh_n"] += 0.0
    upf, lof, lowf = LH.ik2(SH_F, ik_f, L1, L2, ps, 1.0)
    a["sh_f"], a["el_f"] = upf, lof
    a["ha_f"] = -lowf + 8
    sway(a, t, 1.0 if mode != "talk" else 1.5, w)
    hip = (0.0, -0.02 + 0.006 * br)
    a.update(npc.legs(hip_dx=hip[0], hip_dz=hip[1], xn=0.065, xf=-0.11))
    sc = {"head": (1.14, 1.14, 1.14)}
    tw = {"head": tw_head, "neck": -4}
    return npc.frame(a, hip=hip, sc=sc, tw=tw, blink=blink, lift=1.0 / 32)


A_IDLE, A_TALK, A_SEW = 6, 6, 8


def idle_fn(i, n):
    t = i / n
    near = (0.30 + 0.004 * math.sin(N.TAU * t), 1.17 + 0.012 * math.sin(N.TAU * t - 0.5))
    far = (0.27, 1.0 + 0.008 * math.sin(N.TAU * t - 1.0))
    return base_pose(t, "idle", near, far, 0.92 if i == 4 else 0.0)


def talk_fn(i, n):
    t = i / n
    g = 0.5 - 0.5 * math.cos(N.TAU * t)
    near = (0.26 + 0.16 * g, 1.18 + 0.18 * math.sin(N.TAU * t - 0.4))     # needle hand gestures while she talks
    far = (0.25, 1.0 + 0.03 * math.sin(N.TAU * 2 * t))
    return base_pose(t, "talk", near, far, 0.92 if i == 3 else 0.0, w=1)


# needle hand: pierce the cloth, then pull the thread out in a big arc above the cloth and come back down
SEW_PATH = [(0.35, 1.08), (0.40, 1.22), (0.42, 1.38), (0.36, 1.52), (0.26, 1.58), (0.28, 1.46), (0.34, 1.28), (0.36, 1.15)]


def sew_fn(i, n):
    t = i / n
    near = SEW_PATH[i % len(SEW_PATH)]
    far = (0.3, 1.04 + 0.012 * math.sin(N.TAU * t))
    return base_pose(t, "sew", near, far, 0.0)


TALK_MOUTH = (0, 1, 1, 0, 1, 0)

npc.render([
    dict(name="idle", n=A_IDLE, fps=6, loop=True, fn=idle_fn, extra=extra_thread(A_IDLE), done=clear_threads),
    dict(name="talk", n=A_TALK, fps=8, loop=True, fn=talk_fn, mouth=lambda i, n: TALK_MOUTH[i % len(TALK_MOUTH)],
         extra=extra_thread(A_TALK), done=clear_threads),
    dict(name="sew", n=A_SEW, fps=10, loop=True, fn=sew_fn, extra=extra_thread(A_SEW), done=clear_threads),
])
print("seamstress done")
