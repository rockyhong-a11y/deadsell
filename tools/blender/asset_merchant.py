"""DEADSELL NPC sprite sheet: Merchant Pell (shop NPC).

    blender -b --factory-startup -P tools/blender/asset_merchant.py

Cheerful merchant woman: wide-brim hat with a feather, thick teal scarf, short golden jacket,
plum skirt, tall boots, a huge backpack stacked with goods (bedroll, crate, kettle, pan,
bottles, sack) and a lantern hanging from a hooked pole.  Writes
build/frames/merchant/{idle,talk}_###.png + spec.json (frame 128x128, anchor 64,116).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_npc as N  # noqa: E402
from lib_npc import mat, glow, pend  # noqa: E402

K = 0.93                       # 1.75 u native -> ~1.63 u body, ~1.8 u with the hat
N.setup_scene()
npc = N.NPC("merchant", K)
rig = npc.rig
J = rig.joint

# ---------------------------------------------------------------------------
# materials
M = {}
M["skin"] = mat("pl_skin", "#f0c3a0", "#b2788a", "#fff0e2")
M["skin_f"] = mat("pl_skin_f", "#d6a285", "#8a5a72", "#eac3a8")
M["hair"] = mat("pl_hair", "#b9532a", "#5a1f2e", "#e8843f")
M["hair_d"] = mat("pl_hair_d", "#8f3b27", "#431526", "#c25a30")
M["felt"] = mat("pl_felt", "#7d4e30", "#3a1f24", "#ac7242")
M["felt_d"] = mat("pl_felt_d", "#5d3724", "#2c161e", "#85542f")
M["band"] = mat("pl_band", "#c8352f", "#6a1530", "#f0605a")
M["feather"] = mat("pl_feather", "#2fb8aa", "#146a74", "#86eed8")
M["jacket"] = mat("pl_jacket", "#d49c3a", "#7c4a26", "#f8d06c")
M["jacket_f"] = mat("pl_jacket_f", "#a97426", "#5a3220", "#d09a42")
M["cream"] = mat("pl_cream", "#f2e5c9", "#9a8196", "#fff9ea")
M["scarf"] = mat("pl_scarf", "#2caba4", "#124f66", "#78e0cc")
M["scarf_d"] = mat("pl_scarf_d", "#20888f", "#0e3e58", "#54c0b8")
M["stripe"] = mat("pl_stripe", "#f0e0b0", "#9a8196", "#fff8e0")
M["skirt"] = mat("pl_skirt", "#6c3558", "#34162e", "#9a4c7c")
M["skirt_d"] = mat("pl_skirt_d", "#4e2442", "#26102a", "#753a5e")
M["leg"] = mat("pl_leg", "#3b3050", "#1a1428", "#574a72")
M["leg_f"] = mat("pl_leg_f", "#2c2440", "#140f20", "#44385c")
M["boot"] = mat("pl_boot", "#7c4a2c", "#321c20", "#aa683b")
M["boot_f"] = mat("pl_boot_f", "#58341f", "#26141a", "#7c4a2c")
M["cuffboot"] = mat("pl_cuffboot", "#b07840", "#4a2a24", "#d9a060")
M["sole"] = mat("pl_sole", "#2a1a1e", "#160c14", "#3c262a", rim=False)
M["leather"] = mat("pl_leather", "#8a5532", "#40231f", "#bb7f47")
M["leather_d"] = mat("pl_leather_d", "#52301f", "#26141a", "#75492c")
M["gold"] = mat("pl_gold", "#e3b04a", "#8a5527", "#fff0a8", rim=False)
M["eye"] = mat("pl_eye", "#2a1830", "#120a18", "#4a3050", rim=False)
M["mouth"] = mat("pl_mouth", "#b83a52", "#6a1a38", "#e05a70", rim=False)
M["blush"] = mat("pl_blush", "#ef8f95", "#b0586a", "#ffb4b4", rim=False)
M["canvas"] = mat("pl_canvas", "#6b5846", "#34282e", "#94806a")
M["canvas_d"] = mat("pl_canvas_d", "#4c3d34", "#241a24", "#6e5a48")
M["red"] = mat("pl_red", "#c2364a", "#5a1530", "#ea5e6c")
M["wood"] = mat("pl_wood", "#8f5e36", "#3f2420", "#bf8450")
M["crate"] = mat("pl_crate", "#6f94b4", "#2e4268", "#b4d4ea")
M["copper"] = mat("pl_copper", "#c8703c", "#5c2a2a", "#f6a868")
M["iron"] = mat("pl_iron", "#5f6578", "#2b2e3f", "#8f97ac")
M["iron_d"] = mat("pl_iron_d", "#3c3649", "#1a1626", "#5c5470")
M["sack"] = mat("pl_sack", "#c9b27a", "#6a5a54", "#ecd9a0")
M["rope"] = mat("pl_rope", "#dcc690", "#7a6458", "#fff0c0")
M["g_green"] = mat("pl_g_green", "#4fc29a", "#1f6a5a", "#aaf2d4")
M["g_pink"] = mat("pl_g_pink", "#e0629e", "#7a2a5a", "#ffa8d0")
M["g_blue"] = mat("pl_g_blue", "#5a8ee0", "#2a3f8a", "#a8caff")
M["lamp"] = glow("pl_lamp", "#ffae42")
M["lamp_hot"] = glow("pl_lamp_hot", "#fff0b4")
M["wood_pole"] = mat("pl_pole", "#6a4528", "#2e1c20", "#92602f")

body_mats = dict(pelvis=M["skirt_d"], waist=M["jacket"], top=M["jacket"], shoulder=M["jacket"],
                 sleeve=M["jacket"], sleeve_f=M["jacket_f"], cuff=M["cream"], glove=M["skin"],
                 glove_f=M["skin_f"], leg=M["leg"], leg_f=M["leg_f"], boot=M["boot"], boot_f=M["boot_f"],
                 bootcuff=M["cuffboot"], sole=M["sole"], belt=M["leather"], buckle=M["gold"],
                 skin=M["skin"], eye=M["eye"], mouth=M["mouth"], blush=M["blush"])
npc.body(body_mats)
npc.face(body_mats, blush=True)
E, B, L, C, Y, R, T = npc.E, npc.B, npc.L, npc.C, npc.Y, npc.R, npc.T

# ---------------------------------------------------------------------------
# jacket tails + skirt (panels swing from the hips)
for nm in ("jk_f", "jk_b", "sk_f", "sk_b"):
    J(nm, "hips", (0, 0, 0.99))
npc.skirt("sk_f", "skirt_f", -100, 100, 0.158, 0.27, 0.40, 0.024, M["skirt"], 0.99, segs=12, sy=1.12)
npc.skirt("sk_b", "skirt_b", 80, 280, 0.165, 0.30, 0.42, 0.024, M["skirt_d"], 0.99, segs=12, sy=1.1, flare_back=0.04)
npc.skirt("sk_f", "skirt_trim_f", -100, 100, 0.258, 0.275, 0.05, 0.012, M["gold"], 0.99 - 0.40 + 0.05, segs=12, sy=1.12)
npc.skirt("sk_b", "skirt_trim_b", 80, 280, 0.282, 0.305, 0.05, 0.012, M["gold"], 0.99 - 0.42 + 0.05, segs=12, sy=1.1, flare_back=0.04)
npc.skirt("jk_f", "jk_front", -100, 100, 0.172, 0.215, 0.19, 0.022, M["jacket"], 1.0, segs=12, sy=1.12)
npc.skirt("jk_b", "jk_back", 80, 280, 0.178, 0.23, 0.22, 0.022, M["jacket_f"], 1.0, segs=12, sy=1.1, flare_back=0.03)
for k, (bx, bz) in enumerate(((0.106, 1.15), (0.098, 1.07))):
    E("spine" if bz < 1.18 else "chest", "button%d" % k, (0.035, 0.035, 0.035), M["gold"], (bx, 0.0, bz), segs=8, rings=5)
E("chest", "blouse", (0.06, 0.12, 0.13), M["cream"], (0.115, 0, 1.30), (0, 10, 0))
# coin pouch at the near hip (pendulum)
J("cp", "hips", (0.10, -0.205, 0.98))
L("cp", "cp_cord", 0.05, 0.006, 0.006, M["leather_d"], (0.10, -0.205, 0.98), segs=5)
E("cp", "cp_bag", (0.11, 0.09, 0.12), M["gold"], (0.10, -0.205, 0.89), segs=10, rings=7)
E("cp", "cp_tie", (0.05, 0.05, 0.03), M["leather_d"], (0.10, -0.205, 0.945), segs=8, rings=5)

# ---------------------------------------------------------------------------
# scarf: thick wrap + a long tail hanging in front + a tail flying behind (chains of flat panels)
E("chest", "scarf_wrap", (0.23, 0.30, 0.12), M["scarf"], (-0.01, 0, 1.43))
E("chest", "scarf_wrap2", (0.2, 0.27, 0.07), M["scarf_d"], (0.01, 0, 1.38))
E("chest", "scarf_knot", (0.1, 0.1, 0.1), M["scarf"], (0.075, -0.10, 1.37))
SC_A = [(0.085, -0.135, 1.34), (0.095, -0.135, 1.23), (0.095, -0.135, 1.12), (0.09, -0.135, 1.02)]
SC_B = [(-0.10, -0.12, 1.37), (-0.15, -0.12, 1.28), (-0.19, -0.12, 1.20)]
prev = "chest"
for k, p in enumerate(SC_A):
    jn = "scA%d" % k
    J(jn, prev, p)
    prev = jn
    ln = 0.115 if k < 3 else 0.0
    if k < 3:
        B(jn, "scA_seg%d" % k, (0.12, 0.028, ln + 0.02), M["scarf"] if k != 1 else M["scarf_d"], (p[0], p[1], p[2] - ln / 2))
    else:
        pass
B("scA2", "scA_end", (0.12, 0.03, 0.035), M["stripe"], (SC_A[3][0], SC_A[3][1], SC_A[3][2] + 0.005))
B("scA1", "scA_stripe", (0.122, 0.032, 0.02), M["stripe"], (SC_A[1][0], SC_A[1][1], SC_A[1][2] - 0.03))
prev = "chest"
for k, p in enumerate(SC_B):
    jn = "scB%d" % k
    J(jn, prev, p)
    prev = jn
    if k < 2:
        nxt = SC_B[k + 1]
        E(jn, "scB_seg%d" % k, (0.09, 0.026, 0.14), M["scarf_d"], ((p[0] + nxt[0]) / 2, p[1], (p[2] + nxt[2]) / 2), (0, 18, 0))

# ---------------------------------------------------------------------------
# hat, hair, braid
J("hat", "head", (0.0, 0, 1.70))
J("feather", "hat", (-0.02, -0.15, 1.80))
E("hat", "hat_brim", (0.72, 0.70, 0.05), M["felt"], (0.01, 0, 1.725), (0, -9, 0), segs=20, rings=6)
E("hat", "hat_brim_u", (0.70, 0.68, 0.03), M["felt_d"], (0.01, 0, 1.705), (0, -9, 0), segs=20, rings=5)
E("hat", "hat_crown", (0.30, 0.285, 0.23), M["felt"], (-0.005, 0, 1.825), (0, -6, 0), segs=16, rings=9)
R("hat", "hat_band", 0.143, 0.027, M["band"], (-0.003, 0, 1.768), (0, -6, 0), scale=(1.0, 0.97, 1.0), maj=18, mino=6)
E("hat", "hat_buckle", (0.03, 0.05, 0.05), M["gold"], (0.145, -0.012, 1.772), segs=8, rings=5)
E("head", "bangs", (0.12, 0.2, 0.07), M["hair"], (0.085, 0, 1.675), (0, 28, 0))
E("head", "hair_back", (0.2, 0.25, 0.26), M["hair_d"], (-0.095, 0, 1.57))
E("head", "lock_n", (0.06, 0.05, 0.2), M["hair"], (0.03, -0.105, 1.53), (0, -6, 0))
E("head", "lock_f", (0.06, 0.05, 0.18), M["hair_d"], (0.03, 0.105, 1.53), (0, -6, 0))
prev = "head"
BR = [(-0.11, -0.10, 1.50), (-0.13, -0.11, 1.38), (-0.14, -0.11, 1.27), (-0.145, -0.11, 1.17)]
for k, p in enumerate(BR):
    jn = "br%d" % k
    J(jn, prev, p)
    prev = jn
    if k < 3:
        nxt = BR[k + 1]
        E(jn, "br_seg%d" % k, (0.085, 0.08, 0.15), M["hair"] if k % 2 == 0 else M["hair_d"], ((p[0] + nxt[0]) / 2, p[1], (p[2] + nxt[2]) / 2))
E("br2", "br_tie", (0.075, 0.07, 0.04), M["band"], (BR[3][0], BR[3][1], BR[3][2] + 0.01), segs=8, rings=5)
T("feather", "feather_m", [(-0.02, -0.15, 1.79), (-0.08, -0.17, 1.9), (-0.17, -0.16, 1.96), (-0.25, -0.14, 1.94)],
  [0.02, 0.045, 0.035, 0.012], M["feather"], sides=6, flat=0.35)

# ---------------------------------------------------------------------------
# the huge backpack of goods
J("pack", "chest", (-0.17, 0, 1.30))
J("pot", "pack", (-0.30, -0.30, 1.22))
J("pan", "pack", (-0.55, -0.30, 1.28))
B("pack", "pack_body", (0.38, 0.52, 0.62), M["canvas"], (-0.40, 0, 1.04), bevel=0.05)
B("pack", "pack_low", (0.34, 0.46, 0.14), M["canvas_d"], (-0.42, 0, 0.70), bevel=0.03)
for sx in (-0.27, -0.53):
    B("pack", "pack_strap%d" % int(-sx * 100), (0.05, 0.03, 0.66), M["leather"], (sx, -0.275, 1.04))
    B("pack", "pack_buckle%d" % int(-sx * 100), (0.065, 0.036, 0.05), M["gold"], (sx, -0.282, 0.86))
T("chest", "shoulder_strap", [(-0.19, -0.12, 1.36), (-0.07, -0.15, 1.42), (0.04, -0.15, 1.38), (0.09, -0.145, 1.28), (0.075, -0.14, 1.12)],
  [0.025] * 5, M["leather"], sides=6, flat=0.45)
Y("pack", "bedroll", 0.14, 0.64, M["red"], (-0.40, 0, 1.51), (90, 0, 0), segs=14)
for yy in (-0.2, 0.2):
    Y("pack", "bedroll_strap%d" % (yy > 0), 0.148, 0.045, M["leather_d"], (-0.40, yy, 1.51), (90, 0, 0), segs=14)
Y("pack", "bedroll_end", 0.1, 0.02, M["red"], (-0.40, -0.325, 1.51), (90, 0, 0), segs=12)
B("pack", "crate", (0.28, 0.32, 0.22), M["crate"], (-0.44, 0, 1.76), bevel=0.02)
for zz in (1.69, 1.83):
    B("pack", "crate_band%d" % int(zz * 100), (0.29, 0.33, 0.025), M["gold"], (-0.44, 0, zz))
B("pack", "crate_lid", (0.2, 0.02, 0.16), M["wood"], (-0.44, -0.165, 1.76), bevel=0.01)
E("pack", "kettle_body", (0.2, 0.2, 0.17), M["copper"], (-0.44, 0, 1.95), segs=12, rings=8)
E("pack", "kettle_lid", (0.1, 0.1, 0.06), M["copper"], (-0.44, 0, 2.05), segs=10, rings=5)
C("pack", "kettle_spout", 0.035, 0.02, 0.13, M["copper"], (-0.36, 0.0, 1.95), (0, 62, 0), segs=8)
R("pack", "kettle_handle", 0.07, 0.012, M["iron_d"], (-0.44, 0, 2.07), (90, 0, 0), maj=14, mino=4)
E("pack", "sack", (0.34, 0.42, 0.38), M["sack"], (-0.67, 0.02, 0.86))
E("pack", "sack_tie", (0.13, 0.15, 0.06), M["rope"], (-0.67, 0.02, 1.04))
E("pack", "sack_top", (0.12, 0.14, 0.1), M["sack"], (-0.67, 0.02, 1.1))
# bottles in a side pocket (near side, colourful)
for k, (bx, gm) in enumerate(((-0.24, "g_green"), (-0.34, "g_pink"), (-0.44, "g_blue"))):
    Y("pack", "bottle%d" % k, 0.036, 0.2, M[gm], (bx, -0.295, 0.78), segs=8)
    Y("pack", "bneck%d" % k, 0.017, 0.07, M[gm], (bx, -0.295, 0.9), segs=6)
    Y("pack", "bcork%d" % k, 0.019, 0.03, M["leather"], (bx, -0.295, 0.945), segs=6)
B("pack", "pocket", (0.34, 0.04, 0.12), M["canvas_d"], (-0.34, -0.285, 0.72), bevel=0.01)
# hanging pot and pan (pendulums)
L("pot", "pot_cord", 0.06, 0.007, 0.007, M["rope"], (-0.30, -0.30, 1.22), segs=5)
E("pot", "pot_body", (0.17, 0.15, 0.15), M["copper"], (-0.30, -0.32, 1.09), segs=12, rings=8)
E("pot", "pot_rim", (0.19, 0.17, 0.035), M["iron_d"], (-0.30, -0.32, 1.165), segs=12, rings=5)
L("pan", "pan_cord", 0.05, 0.007, 0.007, M["rope"], (-0.55, -0.30, 1.28), segs=5)
Y("pan", "pan_disc", 0.11, 0.025, M["iron_d"], (-0.55, -0.31, 1.13), (90, 0, 0), segs=14)
L("pan", "pan_handle", 0.20, 0.014, 0.014, M["wood"], (-0.55, -0.31, 1.22), (0, 90, 0), segs=6)
# lantern pole + hanging lantern
POLE = [(-0.60, 0.0, 1.42), (-0.64, 0.0, 1.85), (-0.62, 0.0, 2.15), (-0.46, 0.0, 2.3), (-0.16, 0.0, 2.32), (0.3, 0.0, 2.3),
        (0.56, 0.0, 2.24), (0.62, 0.0, 2.14)]
T("pack", "pole", POLE, [0.024] * len(POLE), M["wood_pole"], sides=6)
J("lan0", "pack", (0.60, 0.0, 2.16))
J("lan1", "lan0", (0.60, 0.0, 2.04))
R("lan0", "hook", 0.03, 0.009, M["iron_d"], (0.60, 0.0, 2.155), (90, 0, 0), maj=10, mino=4)
L("lan0", "lan_chain", 0.1, 0.01, 0.01, M["iron_d"], (0.60, 0.0, 2.14), segs=5)
LZ = 1.86
C("lan1", "lan_cap", 0.12, 0.035, 0.07, M["gold"], (0.60, 0.0, LZ + 0.11), segs=8)
E("lan1", "lan_ring", (0.05, 0.05, 0.04), M["iron_d"], (0.60, 0.0, 2.03), segs=8, rings=5)
E("lan1", "lan_core", (0.18, 0.18, 0.24), M["lamp"], (0.60, 0.0, LZ), segs=10, rings=7)
E("lan1", "lan_hot", (0.09, 0.09, 0.13), M["lamp_hot"], (0.58, -0.04, LZ - 0.005), segs=8, rings=6)
for sx, sy in ((0.085, 0.085), (-0.085, 0.085), (0.085, -0.085), (-0.085, -0.085)):
    B("lan1", "lan_post%d%d" % (sx > 0, sy > 0), (0.02, 0.02, 0.27), M["iron_d"], (0.60 + sx, sy, LZ))
Y("lan1", "lan_base", 0.11, 0.04, M["gold"], (0.60, 0.0, LZ - 0.145), segs=8)

# ---------------------------------------------------------------------------
# animation
A_IDLE = 8
A_TALK = 10


def pose(t, talk=False, blink=0.0):
    w = 2 if talk else 1
    br = math.sin(N.TAU * t)
    br2 = math.sin(N.TAU * t - 0.7)
    amp = 1.7 if talk else 1.0
    a = {}
    a["spine"] = -1.0 + 1.0 * br
    a["chest"] = -1.0 + 1.5 * br + (2.0 * math.sin(N.TAU * w * t - 0.4) if talk else 0)
    a["neck"] = 2.0 - 1.0 * br2
    a["head"] = 1.0 + 1.2 * br2 + (3.5 * math.sin(N.TAU * 2 * t) if talk else 0.0)
    if talk:
        g = 0.5 - 0.5 * math.cos(N.TAU * t)            # gesture envelope: palm out, "come buy"
        a["sh_n"] = -5 + 40 * g
        a["el_n"] = 135 - 70 * g
        a["ha_n"] = -12 * g
        a["sh_f"] = 8 + 4 * math.sin(N.TAU * t)
        a["el_f"] = 28
    else:
        a["sh_n"] = -5 + 1.0 * br2
        a["el_n"] = 135 + 2.0 * br
        a["ha_n"] = 0
        a["sh_f"] = 7 + 1.0 * br2
        a["el_f"] = 30 + 2.0 * br
    a["ha_f"] = -5
    a["jk_f"] = pend(t, 2.0 * amp, 0.15, w)
    a["jk_b"] = -2.0 + pend(t, 2.5 * amp, 0.30, w)
    a["sk_f"] = pend(t, 2.5 * amp, 0.20, w)
    a["sk_b"] = -2.0 + pend(t, 3.5 * amp, 0.40, w)
    a["hat"] = pend(t, 1.4 * amp, 0.1, w)
    a["feather"] = pend(t, 6.0 * amp, 0.35, w)
    a["pack"] = pend(t, 0.9 * amp, 0.25, w)
    a["pot"] = pend(t, 5.0 * amp, 0.45, w)
    a["pan"] = pend(t, 4.0 * amp, 0.65, w)
    a["lan0"] = pend(t, 3.0 * amp, 0.30, w)
    a["lan1"] = pend(t, 7.0 * amp, 0.55, w)
    a["cp"] = pend(t, 6.0 * amp, 0.2, w)
    for k in range(4):
        a["scA%d" % k] = pend(t, 3.5 * amp, 0.18 * (k + 1), w) - (6 if k == 0 else 0)
    for k in range(3):
        a["scB%d" % k] = pend(t, 7.0 * amp, 0.2 * (k + 1), w) - (22 if k == 0 else 0)
    for k in range(4):
        a["br%d" % k] = pend(t, 5.0 * amp, 0.15 * (k + 1), w)
    hip = (0.0, 0.005 * br)
    a.update(npc.legs(hip_dx=hip[0], hip_dz=hip[1], xn=0.07, xf=-0.11))
    sc = {"head": (1.16, 1.16, 1.16)}
    tw = {"head": -24 + (5.0 * math.sin(N.TAU * t) if talk else 1.5 * br2), "neck": -4}
    return npc.frame(a, hip=hip, sc=sc, tw=tw, blink=blink)


def idle_fn(i, n):
    return pose(i / n, False, 0.92 if i == 6 else 0.0)


def talk_fn(i, n):
    return pose(i / n, True, 0.92 if i == 8 else 0.0)


TALK_MOUTH = (0, 1, 1, 0, 1, 1, 0, 1, 0, 1)

npc.render([
    dict(name="idle", n=A_IDLE, fps=8, loop=True, fn=idle_fn),
    dict(name="talk", n=A_TALK, fps=10, loop=True, fn=talk_fn, mouth=lambda i, n: TALK_MOUTH[i % len(TALK_MOUTH)]),
])
print("merchant done")
