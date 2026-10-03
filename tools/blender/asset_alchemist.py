"""DEADSELL NPC sprite sheet: Alchemist Morwen (meta NPC, Collector role).

    blender -b --factory-startup -P tools/blender/asset_alchemist.py

Tall hooded alchemist woman, plague-beak mask pushed up on her head (face visible), long
wine-red coat with a bandolier and belt of glowing blue vials, huge backpack carrying a glass
tank of glowing blue cells.  Writes build/frames/alchemist/{idle,talk}_###.png + spec.json
(frame 128x128, anchor 64,116; packed to public/assets/sprites/alchemist.png by pack_all.py).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_npc as N  # noqa: E402
from lib_npc import mat, glow, pend  # noqa: E402

K = 1.12                       # 1.75 u native -> ~1.96 u body, ~2.2 u with the raised mask
N.setup_scene()
npc = N.NPC("alchemist", K)
rig = npc.rig
J = rig.joint

# ---------------------------------------------------------------------------
# materials
M = {}
M["skin"] = mat("al_skin", "#c58a64", "#7d4a5a", "#ecb890")
M["coat"] = mat("al_coat", "#5c2a4a", "#2a1126", "#92487a")
M["coat_d"] = mat("al_coat_d", "#431d37", "#1d0b1c", "#6a3058")
M["lining"] = mat("al_lining", "#8b3a52", "#451a30", "#c05a70")
M["brass"] = mat("al_brass", "#d9a54a", "#7a4a22", "#ffe19a", rim=False)
M["leather"] = mat("al_leather", "#8a5a34", "#40231f", "#bb8049")
M["leather_d"] = mat("al_leather_d", "#58382a", "#2a1620", "#7e5239")
M["glove"] = mat("al_glove", "#3d2c38", "#1a1020", "#5e4660")
M["glove_f"] = mat("al_glove_f", "#2c2030", "#140c1a", "#463650")
M["boot"] = mat("al_boot", "#3a2a38", "#1a1122", "#5c4560")
M["boot_f"] = mat("al_boot_f", "#2a1f2c", "#130c18", "#443448")
M["sole"] = mat("al_sole", "#1c1218", "#0e080e", "#2e2028", rim=False)
M["trouser"] = mat("al_trouser", "#2c2238", "#161022", "#463a58")
M["trouser_f"] = mat("al_trouser_f", "#211a2c", "#100b1a", "#372e48")
M["hair"] = mat("al_hair", "#34244a", "#150e24", "#58428a")
M["bone"] = mat("al_bone", "#e2d6bc", "#8e7d94", "#fff8e6")
M["eye"] = glow("al_eye", "#d9bcff")
M["mouth"] = mat("al_mouth", "#7a2a40", "#40132a", "#a8445c", rim=False)
M["lens"] = glow("al_lens", "#76dcff")
M["vial"] = glow("al_vial", "#4db4ff")
M["vial_hot"] = glow("al_vial_hot", "#b8f0ff")
M["cell"] = glow("al_cell", "#52b8ff")
M["core"] = glow("al_core", "#d2f7ff")
M["glint"] = glow("al_glint", "#b6e8ff")
M["liquid"] = mat("al_liquid", "#1d4f9e", "#0d2458", "#3a88dc")
M["iron"] = mat("al_iron", "#5f6578", "#2b2e3f", "#8f97ac")
M["copper"] = mat("al_copper", "#c06a3c", "#5c2a2a", "#f0a064")

body_mats = dict(pelvis=M["coat_d"], waist=M["coat"], top=M["coat"], shoulder=M["coat"],
                 sleeve=M["coat"], sleeve_f=M["coat_d"], cuff=M["leather"], glove=M["glove"],
                 glove_f=M["glove_f"], leg=M["trouser"], leg_f=M["trouser_f"], boot=M["boot"],
                 boot_f=M["boot_f"], bootcuff=M["leather"], sole=M["sole"], belt=M["leather_d"],
                 buckle=M["brass"], skin=M["skin"], eye=M["eye"], mouth=M["mouth"])
npc.body(body_mats)
npc.face(body_mats)
E, B, L, C, Y, R, T = npc.E, npc.B, npc.L, npc.C, npc.Y, npc.R, npc.T

# ---------------------------------------------------------------------------
# long coat: front / back panels swinging from the hips, brass hem trim, collar, buttons
J("coat_f", "hips", (0, 0, 0.99))
J("coat_b", "hips", (0, 0, 0.99))
HEM_H = 0.64
npc.skirt("coat_f", "coat_f_n", -100, -7, 0.165, 0.31, HEM_H, 0.026, M["coat"], 0.99, segs=8, sy=1.12)
npc.skirt("coat_f", "coat_f_f", 7, 100, 0.165, 0.31, HEM_H, 0.026, M["coat_d"], 0.99, segs=8, sy=1.12)
npc.skirt("coat_f", "coat_f_in", -10, 10, 0.15, 0.285, HEM_H - 0.02, 0.012, M["lining"], 0.985, segs=4, sy=1.12)
npc.skirt("coat_b", "coat_b", 80, 280, 0.172, 0.35, HEM_H, 0.026, M["coat_d"], 0.99, segs=12, sy=1.1, flare_back=0.06)
for nm, a0, a1, rt, rb, fb in (("trim_f", -100, 100, 0.302, 0.318, 0.0), ("trim_b", 80, 280, 0.34, 0.362, 0.06)):
    jn = "coat_f" if nm == "trim_f" else "coat_b"
    npc.skirt(jn, nm, a0, a1, rt, rb, 0.06, 0.012, M["brass"], 0.99 - HEM_H + 0.06, segs=12, sy=1.12 if nm == "trim_f" else 1.1,
              flare_back=fb)
E("chest", "collar", (0.2, 0.27, 0.12), M["coat_d"], (-0.035, 0, 1.465))
E("chest", "collar_f", (0.1, 0.2, 0.06), M["lining"], (0.07, 0, 1.43), (0, 18, 0))
for k, (bx, bz) in enumerate(((0.104, 1.15), (0.097, 1.07), (0.1, 0.99))):
    E("spine" if bz < 1.18 else "chest", "button%d" % k, (0.035, 0.035, 0.035), M["brass"], (bx, 0.0, bz), segs=8, rings=5)

# bandolier with glowing vials (fixed to the chest) ---------------------------------
band = [(0.0, -0.16, 1.385), (0.092, -0.115, 1.275), (0.145, -0.02, 1.185), (0.125, 0.11, 1.075), (0.03, 0.172, 0.985)]
T("chest", "bandolier", band, [0.022] * 5, M["leather_d"], sides=6, flat=0.55)
for k, u in enumerate((0.18, 0.40, 0.62, 0.84)):
    seg = min(3, int(u * 4))
    f = u * 4 - seg
    p = [band[seg][i] + (band[seg + 1][i] - band[seg][i]) * f for i in range(3)]
    p[0] += 0.03
    Y("chest", "bvial%d" % k, 0.03, 0.12, M["vial"], (p[0], p[1], p[2] + 0.035), segs=8)
    C("chest", "bvcap%d" % k, 0.032, 0.02, 0.035, M["brass"], (p[0], p[1], p[2] + 0.095), segs=8)
    E("chest", "bvhot%d" % k, (0.014, 0.014, 0.05), M["vial_hot"], (p[0] + 0.012, p[1] - 0.012, p[2] + 0.04), segs=6, rings=4)

# belt vials (swinging pendulums) + satchel ----------------------------------------
for k, bx in enumerate((0.09, -0.01, -0.12)):
    jn = "bv%d" % k
    J(jn, "hips", (bx, -0.225, 0.97))
    L(jn, "bv_strap%d" % k, 0.05, 0.006, 0.006, M["leather_d"], (bx, -0.225, 0.97), segs=5)
    Y(jn, "bv_vial%d" % k, 0.033, 0.13, M["vial"], (bx, -0.225, 0.885), segs=8)
    C(jn, "bv_cap%d" % k, 0.035, 0.02, 0.035, M["brass"], (bx, -0.225, 0.945), segs=8)
    E(jn, "bv_hot%d" % k, (0.015, 0.015, 0.06), M["vial_hot"], (bx + 0.013, -0.24, 0.89), segs=6, rings=4)
B("hips", "pouch", (0.1, 0.055, 0.11), M["leather"], (0.19, -0.185, 0.90), bevel=0.015)
B("hips", "pouch_flap", (0.105, 0.06, 0.04), M["brass"], (0.19, -0.188, 0.945), bevel=0.01)

# held vial in the near hand -----------------------------------------------------------
Y("ha_n", "held_vial", 0.032, 0.15, M["vial"], (0.055, -0.15, 0.93), segs=8)
C("ha_n", "held_cap", 0.034, 0.022, 0.035, M["brass"], (0.055, -0.15, 1.0), segs=8)
E("ha_n", "held_hot", (0.016, 0.016, 0.07), M["vial_hot"], (0.066, -0.164, 0.93), segs=6, rings=4)

# ---------------------------------------------------------------------------
# hood, hair fringe and the plague-beak mask pushed up on the head
J("hoodtip", "head", (-0.17, 0, 1.66))
E("head", "hood_cap", (0.31, 0.29, 0.27), M["coat"], (-0.045, 0, 1.675))
E("head", "hood_back", (0.28, 0.27, 0.34), M["coat_d"], (-0.1, 0, 1.58))
E("head", "hood_n", (0.15, 0.06, 0.32), M["coat"], (-0.09, -0.128, 1.55), (0, -6, 0))
E("head", "hood_f", (0.15, 0.06, 0.32), M["coat_d"], (-0.09, 0.128, 1.55), (0, -6, 0))
E("head", "hood_rim", (0.08, 0.25, 0.07), M["lining"], (0.075, 0, 1.715), (0, 26, 0))
C("hoodtip", "hood_tip", 0.10, 0.0, 0.30, M["coat_d"], (-0.17, 0, 1.66), (0, -112, 0), segs=10)
E("head", "bangs", (0.10, 0.2, 0.06), M["hair"], (0.085, 0, 1.69), (0, 28, 0))
E("head", "lock_n", (0.055, 0.045, 0.19), M["hair"], (0.045, -0.103, 1.53), (0, -6, 0))
E("head", "lock_f", (0.055, 0.045, 0.17), M["hair"], (0.045, 0.103, 1.53), (0, -6, 0))
# mask: bone plate sitting on top of the hood, beak pointing forward and up
E("head", "mask_plate", (0.23, 0.22, 0.17), M["bone"], (0.035, 0, 1.79), (0, -20, 0))
E("head", "mask_brow", (0.1, 0.23, 0.05), M["leather_d"], (0.11, 0, 1.745), (0, 18, 0))
C("head", "beak", 0.082, 0.014, 0.36, M["bone"], (0.12, 0, 1.805), (0, 66, 0), segs=12, depth=0.9)
C("head", "beak_tip", 0.017, 0.006, 0.07, M["leather_d"], (0.405, 0, 1.935), (0, 66, 0), segs=8)
E("head", "lens_n", (0.07, 0.03, 0.07), M["lens"], (0.07, -0.108, 1.815), (0, 0, 0), segs=10, rings=6)
E("head", "lens_f", (0.07, 0.03, 0.07), M["lens"], (0.07, 0.108, 1.815), (0, 0, 0), segs=10, rings=6)
E("head", "lens_rim_n", (0.09, 0.025, 0.09), M["brass"], (0.065, -0.1, 1.815), segs=10, rings=6)
E("head", "lens_rim_f", (0.09, 0.025, 0.09), M["brass"], (0.065, 0.1, 1.815), segs=10, rings=6)

# ---------------------------------------------------------------------------
# huge backpack + tank of glowing cells
J("pack", "chest", (-0.17, 0, 1.30))
TCX, TCY, TCZ, TR, TH = -0.60, -0.03, 1.58, 0.17, 0.82
J("tank", "pack", (TCX, TCY, TCZ))
B("pack", "pack_body", (0.40, 0.50, 0.64), M["leather"], (-0.38, 0, 1.06), bevel=0.05)
B("pack", "pack_low", (0.32, 0.42, 0.17), M["leather_d"], (-0.40, 0, 0.67), bevel=0.03)
B("pack", "pack_flap", (0.42, 0.52, 0.09), M["leather_d"], (-0.38, 0, 1.40), bevel=0.03)
for sx in (-0.27, -0.49):
    B("pack", "pack_strap%d" % int(-sx * 100), (0.05, 0.03, 0.70), M["leather_d"], (sx, -0.255, 1.04))
    B("pack", "pack_buckle%d" % int(-sx * 100), (0.065, 0.036, 0.05), M["brass"], (sx, -0.262, 0.86))
B("pack", "pack_belt", (0.40, 0.03, 0.045), M["leather_d"], (-0.38, -0.255, 1.22))
B("pack", "pack_stud", (0.04, 0.036, 0.04), M["brass"], (-0.38, -0.262, 1.22))
Y("pack", "pack_roll", 0.075, 0.46, M["lining"], (-0.40, 0, 0.545), (90, 0, 0), segs=10)
T("chest", "shoulder_strap", [(-0.19, -0.12, 1.40), (-0.07, -0.15, 1.44), (0.04, -0.15, 1.39), (0.09, -0.145, 1.28), (0.075, -0.14, 1.12)],
  [0.025] * 5, M["leather_d"], sides=6, flat=0.45)
# tank
Y("tank", "tank_liquid", TR, TH, M["liquid"], (TCX, TCY, TCZ), segs=18)
E("tank", "tank_top", (TR * 2 * 0.96, TR * 2 * 0.96, 0.09), M["liquid"], (TCX, TCY, TCZ + TH / 2 - 0.02), segs=14, rings=6)
for zz in (-TH / 2 - 0.02, TH / 2 + 0.03):
    Y("tank", "tank_cap%d" % (zz > 0), TR + 0.018, 0.075, M["brass"], (TCX, TCY, TCZ + zz), segs=18)
for zz in (-0.24, 0.0, 0.24):
    R("tank", "tank_band%d" % int(zz * 10), TR + 0.004, 0.014, M["brass"], (TCX, TCY, TCZ + zz), maj=18, mino=5)
Y("tank", "tank_valve", 0.04, 0.09, M["brass"], (TCX, TCY, TCZ + TH / 2 + 0.115), segs=10)
E("tank", "tank_knob", (0.09, 0.09, 0.07), M["copper"], (TCX, TCY, TCZ + TH / 2 + 0.185), segs=10, rings=6)
T("tank", "tank_pipe", [(TCX + 0.0, TCY, TCZ + TH / 2 + 0.12), (TCX + 0.0, TCY, TCZ + TH / 2 + 0.24), (TCX + 0.1, TCY, TCZ + TH / 2 + 0.29),
                       (TCX + 0.2, TCY, TCZ + TH / 2 + 0.24), (TCX + 0.2, TCY, TCZ + TH / 2 + 0.12)], [0.02] * 5, M["copper"], sides=6)
E("tank", "glint", (0.02, 0.022, 0.5), M["glint"], (TCX + (TR + 0.002) * math.cos(math.radians(-142)),
                                                   TCY + (TR + 0.002) * math.sin(math.radians(-142)), TCZ + 0.08), segs=6, rings=5)
# cells (own joints so they can bob and pulse inside the glass)
NCELL = 11
CELLS = []
for k in range(NCELL):
    phi = math.radians(-148 + 108 * ((k * 5) % NCELL) / (NCELL - 1))
    z = TCZ - 0.34 + 0.68 * (k + 0.5) / NCELL
    rad = TR * (0.9 + 0.1 * ((k * 3) % 4) / 3)
    p = (TCX + rad * math.cos(phi), TCY + rad * math.sin(phi), z)
    jn = "cell%d" % k
    J(jn, "tank", p)
    s = 0.075 + 0.022 * ((k * 7) % 4) / 3
    E(jn, "cell%d" % k, (s, s * 0.8, s), M["cell"], p, segs=8, rings=6)
    E(jn, "core%d" % k, (s * 0.45, s * 0.35, s * 0.45), M["core"], (p[0] - 0.01, p[1] - 0.012, p[2] + 0.012), segs=6, rings=4)
    CELLS.append(jn)
# hanging flasks on the near side of the pack (pendulums)
for k, (fx, fz) in enumerate(((-0.27, 0.90), (-0.50, 0.84))):
    jn = "flask%d" % k
    J(jn, "pack", (fx, -0.28, fz + 0.03))
    L(jn, "flask_cord%d" % k, 0.06, 0.007, 0.007, M["leather_d"], (fx, -0.28, fz + 0.04), segs=5)
    E(jn, "flask_body%d" % k, (0.11, 0.11, 0.11), M["vial"], (fx, -0.28, fz - 0.04), segs=10, rings=7)
    Y(jn, "flask_neck%d" % k, 0.025, 0.06, M["brass"], (fx, -0.28, fz + 0.045), segs=8)
    E(jn, "flask_hot%d" % k, (0.04, 0.03, 0.05), M["vial_hot"], (fx + 0.025, -0.33, fz - 0.025), segs=6, rings=4)

# ---------------------------------------------------------------------------
# animation
A_IDLE = 8
A_TALK = 10


def pose(t, talk=False, blink=0.0):
    """Shared pose builder; t = loop phase 0..1."""
    w = 2 if talk else 1
    br = math.sin(N.TAU * t)
    br2 = math.sin(N.TAU * t - 0.7)
    a = {}
    amp = 1.6 if talk else 1.0
    a["spine"] = -2.0 + 1.0 * br
    a["chest"] = -2.0 + 1.5 * br + (1.5 * math.sin(N.TAU * w * t - 0.4) if talk else 0)
    a["neck"] = 3.0 - 1.0 * br2
    a["head"] = -1.5 + 1.2 * br2 + (3.2 * math.sin(N.TAU * 2 * t) if talk else 0.0)
    if talk:
        g = 0.5 - 0.5 * math.cos(N.TAU * t)             # gesture envelope
        a["sh_n"] = 22 + 38 * g
        a["el_n"] = 55 + 18 * g
        a["sh_f"] = -4 + 24 * (0.5 - 0.5 * math.cos(N.TAU * t - 1.2))
        a["el_f"] = 20 + 50 * (0.5 - 0.5 * math.cos(N.TAU * t - 1.2))
    else:
        a["sh_n"] = 20 + 1.5 * br2
        a["el_n"] = 56 + 2.0 * br
        a["sh_f"] = -5 + 1.0 * br2
        a["el_f"] = 18 + 2.0 * br
    a["ha_n"] = -(a["sh_n"] + a["el_n"]) + 4 * math.sin(N.TAU * w * t)   # keep the held vial upright
    a["ha_f"] = -8
    a["coat_f"] = pend(t, 2.2 * amp, 0.15, w)
    a["coat_b"] = -2.0 + pend(t, 3.0 * amp, 0.35, w)
    a["hoodtip"] = pend(t, 4.0 * amp, 0.5, w)
    a["pack"] = pend(t, 0.9 * amp, 0.25, w)
    for k in range(3):
        a["bv%d" % k] = pend(t, 5.0 * amp, 0.2 + 0.17 * k, w)
    for k in range(2):
        a["flask%d" % k] = pend(t, 5.0 * amp, 0.4 + 0.3 * k, w)
    off, sc = {}, {}
    for k, jn in enumerate(CELLS):
        ph = (k * 0.37) % 1.0
        off[jn] = (0.012 * math.sin(N.TAU * (t * w + ph)), 0.0, 0.034 * math.sin(N.TAU * (t * w * (1 if k % 2 else 1) + ph * 1.7)))
        s = 1.0 + 0.16 * math.sin(N.TAU * (t * w + ph * 2.3))
        sc[jn] = (s, s, s)
    hip = (0.0, -0.02 + 0.006 * br)
    a.update(npc.legs(hip_dx=hip[0], hip_dz=hip[1], xn=0.065, xf=-0.11))
    sc["head"] = (1.16, 1.16, 1.16)                       # bigger head reads better at 64 px
    tw = {"head": -26 + (5.0 * math.sin(N.TAU * t) if talk else 1.5 * br2), "neck": -4}
    return npc.frame(a, hip=hip, off=off, sc=sc, tw=tw, blink=blink, lift=1.0 / 32)


def idle_fn(i, n):
    return pose(i / n, False, 0.92 if i == 5 else 0.0)


def talk_fn(i, n):
    return pose(i / n, True, 0.92 if i == 7 else 0.0)


TALK_MOUTH = (0, 1, 1, 0, 1, 0, 1, 1, 0, 1)

npc.render([
    dict(name="idle", n=A_IDLE, fps=8, loop=True, fn=idle_fn),
    dict(name="talk", n=A_TALK, fps=10, loop=True, fn=talk_fn, mouth=lambda i, n: TALK_MOUTH[i % len(TALK_MOUTH)]),
])
print("alchemist done")
