"""DEADSELL mid-boss: valkyrie knight-captain (발키리 기사단장) -- armoured woman with huge white
feathered wings, a winged helm, a blue cape and a greatsword.  Ramparts mid-boss.

blender -b --factory-startup -P tools/blender/asset_mb_valkyrie.py [-- anim ...]
-> build/frames/mb_valkyrie/<anim>_###.png + spec.json   (frame 224x176, anchor (112,164))
   pack: python3 tools/pack/pack_all.py mb_valkyrie

Animations: idle(loop) walk(loop) slash(w/a/r) fly(loop) dive(w/a/r) wave(w/a/r) hurt death
With anim names after `--` only those animations are re-rendered (iteration); the spec always
lists every animation.

Rig notes
  * 2.5 u tall (S = 1.42 x the heroine skeleton).  The greatsword is a rigid prop on the near hand
    ("sw" joint); its WORLD angle "_sw" (0 = tip down, 90 = level forward, 180 = tip up) and the
    near-hand target "_nx/_nz" (relative to the shoulder) drive a two-handed grip (2-bone IK).
  * Wings are rolled about the body's long axis (X) so the feather fan always trails backwards:
    "wn:x"/"wf:x" = near/far wing roll (0 = folded down, -165 = raised), "wen:x"/"wef:x" = wrist roll,
    "_wt"/"_wtf" = absolute screen-plane tilt of the wing (negative = swept back).
  * Slash / wave swings carry a crescent trail (props fx_tr_*), the charged blade a glow shell.
"""
import math
import os
import sys

import bmesh  # noqa: F401
import bpy  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402
from common import blade as mkblade  # noqa: E402

L.FRAME_W, L.FRAME_H, L.ANCHOR = 224, 176, (112, 164)
ONLY = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

S = 1.42
RIG = None
IN_LEN, OUT_LEN = 0.78, 0.72          # inner / outer wing bone length (u)
LF = 1.72                             # grip -> sword tip
ARM_N = ("root", "hips", "spine", "chest", "sh_n", "el_n", "ha_n")
CHEST_CHAIN = ("root", "hips", "spine", "chest")
FXP = []                              # objects that must not take part in grounding


class Sheet(L.Sheet):
    """Sheet that can re-render only some animations (the spec still lists all of them)."""

    def __init__(self, name, rig):
        if ONLY:
            self.name, self.rig = name, rig
            self.dir = os.path.join(L.ROOT, "build", "frames", name)
            os.makedirs(self.dir, exist_ok=True)
            self.anims, self.props = [], {}
        else:
            L.Sheet.__init__(self, name, rig)

    def render(self, name, frames, pose_fn, fps=12, loop=False, wa=None, **kw):
        if ONLY and name not in ONLY:
            entry = {"name": name, "fps": fps, "loop": loop}
            if wa:
                assert sum(wa) == frames, (name, wa, frames)
                entry.update({"windup": wa[0], "active": wa[1], "recover": wa[2]})
            self.anims.append(entry)
            return
        for f in os.listdir(self.dir):
            if f.startswith(name + "_") and f[len(name) + 1:-4].isdigit():
                os.remove(os.path.join(self.dir, f))
        L.Sheet.render(self, name, frames, pose_fn, fps=fps, loop=loop, wa=wa, **kw)


# --------------------------------------------------------------------------
# geometry


def feather_wing(tag, pal):
    """One wing hanging down from its joint, feathers trailing backward.  -> (inner, outer)."""
    dy = -0.009
    inner, outer = [], []
    inner.append(L.tube(tag + "bi", [(0, 0, 0.05), (0, 0, -0.35), (0.01, 0, -IN_LEN)], [0.08, 0.065, 0.05], pal["bone"], segs=6))
    for k in range(7):                                  # secondaries
        phi = 86 - 8.5 * k
        ln = 0.8 + 0.03 * k
        f = L.leaf("%ssec%d" % (tag, k), ln, 0.27, 0.02, pal["a"] if k % 2 == 0 else pal["b"], tip=0.66, base=0.3)
        f.location = (0, dy * (k + 1), -0.06 - 0.1 * k)
        f.rotation_euler = (0, math.radians(phi), 0)
        inner.append(f)
    for k, z in enumerate((-0.08, -0.26, -0.44, -0.62)):  # coverts (blue tipped)
        f = L.leaf("%scov%d" % (tag, k), 0.44, 0.26, 0.02, pal["blue"] if k % 2 else pal["a"], tip=0.66, base=0.4)
        f.location = (0, dy * (9 + k), z)
        f.rotation_euler = (0, math.radians(70 - 7 * k), 0)
        inner.append(f)
    outer.append(L.tube(tag + "bo", [(0, 0, 0.05), (0, 0, -0.35), (0.0, 0, -OUT_LEN)], [0.06, 0.05, 0.035], pal["bone"], segs=6))
    for k in range(8):                                  # primaries
        phi = 62 - 10.5 * k
        ln = 0.74 + 0.055 * k
        f = L.leaf("%spri%d" % (tag, k), ln, 0.25, 0.02, pal["b"] if k % 2 == 0 else pal["a"], tip=0.64, base=0.25)
        f.location = (0, dy * (k + 1), -0.04 - 0.07 * k)
        f.rotation_euler = (0, math.radians(phi), 0)
        outer.append(f)
    f = L.leaf(tag + "pritip", 1.0, 0.22, 0.02, pal["blue"], tip=0.6, base=0.2)
    f.location = (0.0, dy * 10, -OUT_LEN + 0.05)
    f.rotation_euler = (0, math.radians(-8), 0)
    outer.append(f)
    return L.joined(tag + "wi", inner), L.joined(tag + "wo", outer)


def crescent(name, pivot, a_tail, a_head, r_out, w_head, mat_, y=-0.34, steps=9):
    """Swing-trail crescent: sword-angle sweep a_tail -> a_head (deg, 0 = down, 90 = forward) around
    `pivot` (x, z); thin at the tail, `w_head` wide at the head."""
    bm = bmesh.new()
    outer, inner = [], []
    for k in range(steps + 1):
        s = k / steps
        a = math.radians(a_tail + (a_head - a_tail) * s)
        w = w_head * s ** 0.85
        for lst, rr in ((outer, r_out), (inner, r_out - w)):
            lst.append(bm.verts.new((pivot[0] + rr * math.sin(a), y, pivot[1] - rr * math.cos(a))))
    for k in range(steps):
        bm.faces.new((outer[k], outer[k + 1], inner[k + 1], inner[k]))
    ob = L._mesh_ob(name, bm, mat_, smooth=False)
    FXP.append(ob)
    return ob


def build():
    global RIG
    L.setup_scene()
    M = {
        "skin": L.mat("v_skin", "#f1cfba", "#a06c7c", "#fff0e0"),
        "armor": L.mat("v_armor", "#cdd6ea", "#5f6d96", "#f6f9ff"),
        "darm": L.mat("v_darm", "#6f7fa6", "#303b5e", "#a4b2d4"),
        "blue": L.mat("v_blue", "#2c58b8", "#12296a", "#5f8de6"),
        "blue2": L.mat("v_blue2", "#4678d6", "#1c3a82", "#7fa8f2"),
        "gold": L.mat("v_gold", "#e2b24a", "#7c5228", "#fff0a0"),
        "leather": L.mat("v_leather", "#5a3c2e", "#2a1c22", "#7c5640"),
        "hair": L.mat("v_hair", "#f2de9c", "#aa8a5a", "#fff7d0"),
        "steel": L.mat("v_steel", "#e4ecfa", "#7886ae", "#ffffff"),
        "fuller": L.mat("v_fuller", "#8f9fc8", "#434f7a", "#c4d2f0"),
        # wings: near / far
        "wa": L.mat("v_wa", "#f7f3ec", "#aaa8c6", "#ffffff"),
        "wb": L.mat("v_wb", "#e3e9f8", "#8c9ac4", "#ffffff"),
        "wbl": L.mat("v_wbl", "#8db4f0", "#4a68b8", "#c4dcff"),
        "wbone": L.mat("v_wbone", "#cdd4ea", "#6a76a0", "#eef2ff"),
        "fwa": L.mat("v_fwa", "#dcd8e4", "#8886a8", "#f4f2fa"),
        "fwb": L.mat("v_fwb", "#c8d0e6", "#6e7aa4", "#e6ecfa"),
        "fwbl": L.mat("v_fwbl", "#6e98d8", "#3a549c", "#a4c4f0"),
        "fwbone": L.mat("v_fwbone", "#a8b0cc", "#525e88", "#ccd4ee"),
        "eye": L.glow("v_eye", "#8fe8ff"),
        "glow": L.glow("v_glow", "#9fe8ff"),
        "trail": L.glow("v_trail", "#e8fbff"),
        "trail2": L.glow("v_trail2", "#8ad8ff"),
        "streak": L.glow("v_streak", "#eaf6ff"),
        "fea": L.mat("v_fea", "#fbf8f2", "#b4b2d0", "#ffffff"),
    }
    r = L.ERig("valkyrie")
    RIG = r
    L.skeleton(r, s=S, w=1.0, sh_w=0.125)
    J, A = r.joint, r.attach
    ha = r.world_rest["ha_n"]
    J("sw", "ha_n", (ha.x, ha.y, ha.z))
    J("pt", "head", (-0.13 * S, 0, 1.66 * S))
    J("pt1", "pt", (-0.13 * S, 0, 1.66 * S - 0.5))
    J("skirt", "hips", (0, 0, 0.94 * S))
    J("tab", "spine", (0.12 * S, 0, 1.14 * S))
    J("cp0", "chest", (-0.17 * S, 0.0, 1.42 * S))
    J("cp1", "cp0", (-0.17 * S, 0.0, 1.42 * S - 0.62))
    for sd, y in (("n", 0.05), ("f", 0.13)):
        J("w" + sd, "chest", (-0.1 * S, y, 1.4 * S))
        J("we" + sd, "w" + sd, (-0.1 * S, y, 1.4 * S - IN_LEN))
    for k in range(4):                       # loose feathers (death)
        J("fx%d" % k, "root", (0, 0, 0))

    o = L.body(r, {"skin": M["skin"], "chest": M["armor"], "waist": M["blue"], "pelvis": M["darm"],
                   "bust": M["armor"], "ua": M["darm"], "fa": M["armor"], "hand": M["darm"],
                   "thigh": M["armor"], "shin": M["armor"], "foot": M["darm"]},
               s=S, w=1.0, bust=1.12, hip=1.06, arm_r=1.18, leg_r=1.12)
    # tasset skirt (blue, gold hem), belt, tabard
    A(L.skirt("skirt_m", 0.16 * S, 0.3 * S, 0.5 * S, M["blue"], n=18, bulge=0.04 * S, front=0.86, back=1.12), "skirt")
    A(L.skirt("skirt_hem", 0.285 * S, 0.3 * S, 0.04 * S, M["gold"], n=18, front=0.86, back=1.12, cap_top=False),
      "skirt", (0, 0, -0.46 * S))
    A(ellipsoid("belt", (0.22 * S, 0.27 * S, 0.06 * S), M["darm"]), "hips", (0.0, 0, 0.1 * S))
    A(box("buckle", (0.045 * S, 0.075 * S, 0.065 * S), M["gold"], bevel=0.01), "hips", (0.115 * S, 0, 0.1 * S))
    A(L.bake(box("tab_m", (0.03 * S, 0.2 * S, 0.62 * S), M["blue"], loc=(0, 0, -0.31 * S), bevel=0.008)), "tab")
    A(L.bake(box("tab_stripe", (0.036 * S, 0.05 * S, 0.62 * S), M["gold"], loc=(0.004 * S, 0, -0.31 * S))), "tab")
    A(L.bake(box("tab_gem", (0.04 * S, 0.11 * S, 0.11 * S), M["gold"], loc=(0.007 * S, 0, -0.22 * S), rot=(45, 0, 0))), "tab")
    # pauldrons, cops, gauntlets, gorget, breastplate trim
    for sd in ("n", "f"):
        A(ellipsoid("pauld_" + sd, (0.21 * S, 0.2 * S, 0.16 * S), M["armor"]), "sh_" + sd, (0.0, 0, 0.02 * S))
        A(ellipsoid("pauld_t" + sd, (0.22 * S, 0.21 * S, 0.05 * S), M["gold"]), "sh_" + sd, (0.0, 0, 0.082 * S))
        A(ellipsoid("pauld_u" + sd, (0.2 * S, 0.19 * S, 0.1 * S), M["blue2"]), "sh_" + sd, (0.0, 0, -0.07 * S))
        A(ellipsoid("elcop_" + sd, (0.105 * S, 0.105 * S, 0.105 * S), M["gold"]), "el_" + sd, (0.0, 0, 0.0))
        A(ellipsoid("kncop_" + sd, (0.15 * S, 0.15 * S, 0.15 * S), M["gold"]), "kn_" + sd, (0.025 * S, 0, 0.0))
        A(ellipsoid("gaunt_" + sd, (0.1 * S, 0.09 * S, 0.11 * S), M["armor"]), "ha_" + sd, (0, 0, -0.03 * S))
    A(ellipsoid("gorget", (0.21 * S, 0.25 * S, 0.1 * S), M["armor"]), "chest", (0.01 * S, 0, 0.2 * S))
    A(box("bust_trim", (0.05 * S, 0.23 * S, 0.035 * S), M["gold"], bevel=0.01), "chest", (0.155 * S, 0, 0.015 * S))
    A(ellipsoid("chest_gem", (0.05 * S, 0.06 * S, 0.06 * S), M["blue2"]), "chest", (0.165 * S, 0, 0.11 * S))
    # winged helm: skull, brow guard, gold rim, cheek guards, swept feather fins at the temples
    A(ellipsoid("helm", (0.29 * S, 0.28 * S, 0.25 * S), M["armor"]), "head", (-0.02 * S, 0, 0.17 * S))
    A(ellipsoid("helm_brow", (0.12 * S, 0.25 * S, 0.08 * S), M["armor"]), "head", (0.08 * S, 0, 0.215 * S))
    A(ellipsoid("helm_rim", (0.31 * S, 0.3 * S, 0.035 * S), M["gold"]), "head", (-0.02 * S, 0, 0.115 * S))
    A(ellipsoid("helm_crest", (0.3 * S, 0.05 * S, 0.06 * S), M["gold"]), "head", (-0.02 * S, 0, 0.295 * S))
    for y in (-0.108, 0.108):
        A(ellipsoid("cheek", (0.115 * S, 0.05 * S, 0.14 * S), M["armor"]), "head", (0.0, y * S, 0.05 * S))
    for y in (-0.15, 0.15):
        fins = []
        for k, (phi, ln) in enumerate(((100, 0.42), (116, 0.52), (132, 0.44))):
            f = L.leaf("fin%d" % k, ln, 0.17, 0.02, M["fea"] if k != 1 else M["wbl"], tip=0.5, base=0.25)
            f.location = (-0.03 * S, y * S - 0.006 * k * (1 if y < 0 else -1), (0.17 + 0.02 * k) * S)
            f.rotation_euler = (0, math.radians(phi), 0)
            fins.append(f)
        A(L.joined("fins_%d" % (y > 0), fins), "head")
    # golden ponytail through the back of the helm
    A(L.tube("pony_a", [(0.0, 0, 0.0), (-0.035, 0, -0.18), (-0.03, 0, -0.5)], [0.085, 0.1, 0.04], M["hair"], depth=0.9), "pt")
    A(L.tube("pony_b", [(0.0, 0, 0.02), (-0.015, 0, -0.18), (0.0, 0, -0.46)], [0.07, 0.055, 0.008], M["hair"], depth=0.9), "pt1")
    A(ellipsoid("pony_tie", (0.1 * S, 0.1 * S, 0.07 * S), M["gold"]), "pt", (0.0, 0, 0.0))
    L.eyes(r, M["eye"], s=S, x=0.126, z=0.108, h=0.058, wdt=0.04, span=0.14)
    # cape: flat panels behind her back (blue, gold hem)
    A(L.skirt("cape_a", 0.1, 0.27, 0.66, M["blue"], n=14, depth=0.14, jag=0.0, front=0.92, back=1.1, cap_top=True),
      "cp0", (-0.15, 0, 0.0))
    A(L.skirt("cape_b", 0.27, 0.31, 0.62, M["blue2"], n=14, depth=0.14, jag=0.07, seed=4, front=0.92, back=1.1,
              cap_top=False), "cp1", (-0.15, 0, 0.0))
    A(L.skirt("cape_hem", 0.12, 0.2, 0.04, M["gold"], n=14, depth=0.14, cap_top=False), "cp0", (-0.15, 0, -0.04))
    # wings
    for sd in ("n", "f"):
        pal = ({"a": M["wa"], "b": M["wb"], "blue": M["wbl"], "bone": M["wbone"]} if sd == "n" else
               {"a": M["fwa"], "b": M["fwb"], "blue": M["fwbl"], "bone": M["fwbone"]})
        wi, wo = feather_wing(sd, pal)
        A(wi, "w" + sd)
        A(wo, "we" + sd)
        A(ellipsoid("wroot_" + sd, (0.2 * S, 0.14 * S, 0.22 * S), pal["a"]), "w" + sd, (0, 0, -0.04))
    # greatsword: grip at the origin, blade along -Z, winged guard
    parts = [L.tube("grip", [(0, 0, 0.26), (0, 0, -0.06)], [0.04, 0.04], M["leather"], segs=7)]
    parts.append(ellipsoid("pommel", (0.13, 0.13, 0.13), M["gold"], loc=(0, 0, 0.3)))
    parts.append(box("guard", (0.1, 0.34, 0.075), M["gold"], loc=(0, 0, -0.08), bevel=0.02))
    for sgn in (-1, 1):
        for k, (phi, ln) in enumerate(((158, 0.34), (130, 0.3))):
            f = L.leaf("gf", ln, 0.09, 0.02, M["fea"], tip=0.5, base=0.3)
            f.location = (0.0, sgn * 0.14 - sgn * 0.01 * k, -0.07)
            f.rotation_euler = (0, math.radians(phi), 0)
            parts.append(f)
    for nm, w_, t_, ln, z0, mt in (("bl", 0.2, 0.032, 1.58, -0.12, M["steel"]), ("fu", 0.06, 0.04, 1.28, -0.16, M["fuller"])):
        b = mkblade(nm, ln, w_, t_, mt, tip=0.1 if nm == "bl" else 0.0)
        b.location = (0, 0, z0)
        b.rotation_euler = (math.pi, 0, 0)
        b.location = (0, 0, z0)
        parts.append(b)
    sw = L.joined("greatsword", parts)
    A(sw, "sw")
    # blade glow shell (charge telegraph): a bigger blade behind the real one
    g = mkblade("glow_shell", 1.72, 0.34, 0.02, M["glow"], tip=0.12)
    g.location = (0, 0.03, -0.1)
    g.rotation_euler = (math.pi, 0, 0)
    gs = L.joined("fx_glow", [g])
    A(gs, "sw")
    FXP.append(gs)
    # dive streaks (world-aligned in hips space)
    streaks = ([], [])
    for gi, offs in enumerate((((-0.7, -0.1, 0.35), (-1.1, 0.06, 0.8), (-0.55, 0.0, 1.3), (-1.4, -0.08, 1.05)),
                               ((-0.9, 0.04, 0.15), (-0.6, -0.06, 0.62), (-1.2, 0.06, 1.2), (-0.85, 0.0, 1.55)))):
        sp = []
        for k, (x, y, z) in enumerate(offs):
            ln = 0.7 + 0.35 * ((k + gi) % 2)
            sp.append(L.tube("sl%d_%d" % (gi, k), [(x, y - 0.3, z + 0.0), (x - ln * 0.5, y - 0.3, z + ln * 0.4), (x - ln, y - 0.3, z + ln * 0.8)],
                             [0.004, 0.022, 0.004], M["streak"], depth=0.5, segs=5))
        ob = L.joined("fx_streaks%d" % gi, sp)
        A(ob, "hips", (0, 0, -0.92 * S))
        streaks[gi].append(ob)
        FXP.append(ob)
    # loose feathers (death)
    feathers = []
    for k in range(4):
        f = L.leaf("fx_feather%d" % k, 0.4 + 0.06 * (k % 2), 0.12, 0.015, M["fea"], tip=0.5, base=0.3)
        ob = L.joined("fx_feather%d" % k, [f])
        A(ob, "fx%d" % k)
        FXP.append(ob)
        feathers.append(ob)
    feet = [o["foot_n"], o["foot_f"]]
    return r, M, feet, streaks, feathers


# --------------------------------------------------------------------------
# poses

BASE = {"hips": -4, "spine": -1, "chest": 0, "neck": 2, "head": 0,
        "th_n": 12, "kn_n": -10, "th_f": -8, "kn_f": -9,
        "sh_n": 20, "el_n": 60, "sh_f": 8, "el_f": 14, "hips.dz": -0.01,
        "_sw": 30, "_two": 1.0, "_nx": 0.4, "_nz": -0.42,
        "_wt": -6, "_wtf": -10, "wn:x": -8, "wf:x": 14, "wen:x": -4, "wef:x": 8, "wen": 0, "wef": 0}


def acc(p, *ks):
    return sum(p.get(k, 0.0) for k in ks)


def finish(p, sway=0.0, flow=0.0):
    """flow: 0 = hanging cape/hair, 1 = streaming backward."""
    two = p.pop("_two", 0.0)
    nx_, nz_ = p.pop("_nx", 0.4), p.pop("_nz", -0.42)
    sw = p.pop("_sw", 30)
    if two > 0.01:
        fk = {k: p.get(k, 0.0) for k in ("sh_n", "el_n", "sh_f", "el_f")}
        RIG.pose(*L.split(p))
        nsx, nsz = L.joint_xz(RIG, "sh_n")
        L.ik2(RIG, p, "sh_n", "el_n", "ha_n", (nsx + nx_, nsz + nz_), bend=1.0)
        RIG.pose(*L.split(p))
        hx, hz = L.joint_xz(RIG, "ha_n")
        a = math.radians(sw)
        d = (math.sin(a), -math.cos(a))
        L.ik2(RIG, p, "sh_f", "el_f", "ha_f", (hx - 0.3 * d[0], hz - 0.3 * d[1]), bend=1.0)
        for k in fk:
            p[k] = fk[k] + (p[k] - fk[k]) * min(1.0, two)
    p["ha_n"] = 0.0
    L.hang(p, [("sw", 0.0)], ARM_N, sw)
    L.hang(p, [("pt", -10 - 60 * flow + sway), ("pt1", -6 - 60 * flow + sway * 1.3)], L.HEAD_CHAIN, 0)
    L.hang(p, [("cp0", -5 - 55 * flow + sway * 0.5), ("cp1", -3 - 25 * flow + sway * 0.8)], CHEST_CHAIN, 0)
    torso = acc(p, "root", "hips", "spine", "chest")
    p["wn"] = p.pop("_wt", -6) - torso
    p["wf"] = p.pop("_wtf", -10) - torso
    for sd in ("n", "f"):                      # folded wings close like a fan (x scale), open wings fan out
        op = min(1.0, abs(p.get("w%s:x" % sd, 0.0)) / 75.0)
        p["w%s.sx" % sd] = 0.4 + 0.6 * op
        p["w%s.sz" % sd] = 0.5 + 0.5 * op
    p["skirt"] = -0.5 * p.get("hips", 0) - 8 * flow
    p["tab"] = -(p.get("hips", 0) + p.get("spine", 0)) * 0.6 + 0.35 * max(0, max(p.get("th_n", 0), p.get("th_f", 0)) - 10) - 12 * flow
    return p


def KEYS(i, n, frames):
    """frames: [(frame_index, pose)] -> interpolated pose at frame i of n."""
    return L.keys_at([(f / (n - 1), q) for f, q in frames], i / (n - 1))


def idle(i, n):
    t = 2 * math.pi * i / n
    s, c = math.sin(t), math.cos(t)
    p = L.merge(BASE, {"chest": 1.3 * s, "head": -1 * s, "hips.dz": -0.01 - 0.012 * (1 - c), "_sw": 30 + 2.5 * s,
                       "_nz": -0.42 + 0.012 * s, "wn:x": -8 - 4 * s, "wf:x": 14 + 4 * s, "wen:x": -4 - 3 * c})
    L.feet_flat(p)
    return finish(p, 4 * c)


def walk(i, n):
    t = i / n
    a = 2 * math.pi * t
    s, c = math.sin(a), math.cos(a)
    p = dict(BASE)
    p.update(L.walk_legs(t, stride=22, knee=40))
    p.update({"hips": -5, "spine": -1, "chest": 1 + 1.4 * c, "hips.dz": -0.02 + 0.03 * abs(c),
              "_sw": 42 + 4 * s, "_nz": -0.4 + 0.015 * c, "wn:x": -10 - 6 * s, "wf:x": 16 + 6 * s,
              "_wt": -10, "_wtf": -14, "wen:x": -4 - 5 * c})
    p["an_n"] -= 3
    p["an_f"] -= 3
    return finish(p, 7 * c, flow=0.12)


SLASH_WA = (5, 6, 4)
SLASH = [
    (0, dict(BASE)),
    # gather: weight back, sword rising, wings snapping open
    (2, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 4, "head": -2, "th_n": 8, "kn_n": -18, "th_f": -22, "kn_f": -28,
                       "_sw": 120, "_nx": 0.25, "_nz": -0.1, "hips.dx": -0.1, "_wt": -30, "_wtf": -40, "wn:x": -70,
                       "wf:x": 80, "wen:x": -20, "wef:x": 20})),
    # WIND-UP peak (telegraph): sword high behind the head, glowing, wings thrown up
    (4, L.merge(BASE, {"hips": 5, "spine": 9, "chest": 10, "neck": -4, "head": -7, "th_n": 6, "kn_n": -22, "th_f": -32,
                       "kn_f": -40, "_sw": 238, "_nx": -0.08, "_nz": 0.42, "hips.dx": -0.2, "hips.dz": -0.04,
                       "_wt": -14, "_wtf": -26, "wn:x": -158, "wf:x": 140, "wen:x": -8, "wef:x": 10})),
    # hit 1: overhead chop forward and down
    (5, L.merge(BASE, {"hips": -8, "spine": -4, "chest": -4, "th_n": 30, "kn_n": -40, "th_f": -22, "kn_f": -22,
                       "_sw": 140, "_nx": 0.28, "_nz": 0.18, "hips.dx": -0.04, "hips.dz": -0.06, "_wt": -26, "_wtf": -36,
                       "wn:x": -120, "wf:x": 112, "wen:x": -6})),
    (6, L.merge(BASE, {"hips": -22, "spine": -10, "chest": -10, "neck": 8, "head": 8, "th_n": 54, "kn_n": -64,
                       "th_f": -36, "kn_f": -14, "_sw": 60, "_nx": 0.58, "_nz": -0.28, "hips.dx": 0.1, "hips.dz": -0.14,
                       "_wt": -46, "_wtf": -54, "wn:x": -78, "wf:x": 76, "wen:x": 4})),
    (7, L.merge(BASE, {"hips": -24, "spine": -10, "chest": -10, "neck": 9, "head": 9, "th_n": 56, "kn_n": -66,
                       "th_f": -36, "kn_f": -12, "_sw": 42, "_nx": 0.58, "_nz": -0.3, "hips.dx": 0.12, "hips.dz": -0.12,
                       "_wt": -52, "_wtf": -60, "wn:x": -68, "wf:x": 68})),
    # hit 2: rising cut from low to high
    (8, L.merge(BASE, {"hips": -14, "spine": -4, "chest": -2, "th_n": 40, "kn_n": -50, "th_f": -30, "kn_f": -26,
                       "_sw": 76, "_nx": 0.5, "_nz": -0.24, "hips.dx": 0.08, "hips.dz": -0.1, "_wt": -40, "_wtf": -48,
                       "wn:x": -90, "wf:x": 88})),
    (9, L.merge(BASE, {"hips": -4, "spine": 2, "chest": 4, "th_n": 30, "kn_n": -36, "th_f": -26, "kn_f": -28,
                       "_sw": 126, "_nx": 0.42, "_nz": 0.06, "hips.dx": 0.02, "hips.dz": -0.06, "_wt": -26, "_wtf": -36,
                       "wn:x": -128, "wf:x": 118})),
    (10, L.merge(BASE, {"hips": 3, "spine": 6, "chest": 8, "neck": -2, "head": -4, "th_n": 22, "kn_n": -30, "th_f": -28,
                        "kn_f": -34, "_sw": 172, "_nx": 0.26, "_nz": 0.32, "hips.dx": -0.06, "hips.dz": -0.04,
                        "_wt": -14, "_wtf": -22, "wn:x": -150, "wf:x": 134})),
    (14, dict(BASE)),
]


def slash(i, n):
    p = KEYS(i, n, SLASH)
    if i == 4 or i == 3:                       # coiled tremble at the peak
        p["_sw"] += 2.5 * (-1) ** i
        p["chest"] += 1.2 * (-1) ** i
    L.feet_flat(p)
    act = SLASH_WA[0] <= i < SLASH_WA[0] + SLASH_WA[1]
    return finish(p, -6 if i >= SLASH_WA[0] else 2, flow=0.5 if act else 0.15)


def flap(a, lag=0.0):
    """(near roll, far roll, wrist roll) of a wing beat at phase a."""
    s = math.sin(a - lag)
    return -100 + 62 * s, 96 - 60 * math.sin(a - lag - 0.5), -10 + 14 * math.cos(a - lag)


def fly(i, n):
    a = 2 * math.pi * i / n
    rn, rf, we = flap(a)
    p = L.merge(BASE, {"hips": -8, "spine": -4, "chest": -3, "neck": 4, "head": 2, "th_n": 24, "kn_n": -38,
                       "th_f": 6, "kn_f": -28, "an_n": 26, "an_f": 20, "_sw": 84, "_nx": 0.4, "_nz": -0.34,
                       "wn:x": rn, "wf:x": rf, "wen:x": we, "wef:x": we * 0.8, "_wt": -26, "_wtf": -34,
                       "hips.dz": 0.02 * math.sin(a), "chest": -3 + 1.5 * math.sin(a)})
    return finish(p, 6 * math.sin(a - 1.0), flow=0.35)


def fly_lift(i, n):
    return 0.95 + 0.09 * math.sin(2 * math.pi * i / n - 1.2)


DIVE_WA = (8, 4, 5)
HOVER = L.merge(BASE, {"hips": -10, "spine": -4, "chest": -4, "neck": 4, "head": 2, "th_n": 26, "kn_n": -44, "th_f": 8, "kn_f": -34,
         "an_n": 26, "an_f": 22, "_sw": 150, "_nx": 0.18, "_nz": 0.2, "_wt": -32, "_wtf": -42,
         "wn:x": -168, "wf:x": 150, "wen:x": -6, "wef:x": 8})
DIVE_P = L.merge(BASE, {"hips": -140, "spine": 0, "chest": 0, "neck": 22, "head": 18, "th_n": 14, "kn_n": -10, "th_f": 4, "kn_f": -6,
          "an_n": 50, "an_f": 46, "_sw": 40, "_nx": 0.42, "_nz": -0.46, "hips.dx": -0.3, "_wt": -140, "_wtf": -150,
          "wn:x": -30, "wf:x": 40, "wen:x": -4, "wef:x": 4})
DIVE = [
    (0, dict(BASE)),
    # crouch: wings snapped half open, sword pulled back
    (1, L.merge(BASE, {"hips": -24, "spine": -10, "chest": -8, "neck": 8, "head": 6, "th_n": 52, "kn_n": -86,
                       "th_f": -30, "kn_f": -64, "_sw": 90, "_nx": 0.3, "_nz": -0.3, "hips.dz": -0.2, "hips.dx": -0.08,
                       "_wt": -40, "_wtf": -50, "wn:x": -80, "wf:x": 86})),
    (2, L.merge(BASE, {"hips": -30, "spine": -12, "chest": -10, "neck": 10, "head": 8, "th_n": 62, "kn_n": -100,
                       "th_f": -38, "kn_f": -76, "_sw": 110, "_nx": 0.24, "_nz": -0.22, "hips.dz": -0.28, "hips.dx": -0.12,
                       "_wt": -22, "_wtf": -34, "wn:x": -156, "wf:x": 140, "wen:x": -6})),
    # spring and up-beat
    (3, L.merge(HOVER, {"hips": 4, "spine": 2, "chest": 2, "th_n": 14, "kn_n": -26, "th_f": 4, "kn_f": -18, "_sw": 130,
                        "wn:x": -52, "wf:x": 60, "_wt": -16, "_wtf": -24, "an_n": 20, "an_f": 18})),
    (4, L.merge(HOVER, {"wn:x": -170, "wf:x": 152})),
    (5, L.merge(HOVER, {"wn:x": -50, "wf:x": 58, "_wt": -14, "_wtf": -22, "_sw": 158})),
    (6, L.merge(HOVER, {"wn:x": -172, "wf:x": 154, "_sw": 164})),
    # WIND-UP peak (telegraph): hovering high, wings wide, sword levelled along the dive line, torso tipping
    (7, L.merge(HOVER, {"hips": -34, "spine": -6, "chest": -6, "neck": 14, "head": 12, "th_n": 20, "kn_n": -20,
                        "th_f": 8, "kn_f": -16, "_sw": 72, "_nx": 0.52, "_nz": -0.2, "wn:x": -176, "wf:x": 158,
                        "_wt": -24, "_wtf": -34, "hips.dx": -0.1})),
    (8, dict(DIVE_P)),
    (11, L.merge(DIVE_P, {"hips": -134, "_sw": 44, "_wt": -134, "_wtf": -142, "hips.dx": 0.2})),
    # recover: crash landing in a crouch, then rise
    (12, L.merge(BASE, {"hips": -42, "spine": -14, "chest": -12, "neck": 10, "head": 10, "th_n": 70, "kn_n": -110,
                        "th_f": -44, "kn_f": -80, "_sw": 82, "_nx": 0.5, "_nz": -0.4, "hips.dz": -0.34, "hips.dx": 0.2,
                        "_wt": -60, "_wtf": -70, "wn:x": -100, "wf:x": 100})),
    (14, L.merge(BASE, {"hips": -16, "spine": -6, "chest": -4, "th_n": 38, "kn_n": -56, "th_f": -18, "kn_f": -34,
                        "hips.dz": -0.12, "hips.dx": 0.1, "_wt": -22, "_wtf": -32, "wn:x": -60, "wf:x": 64, "_sw": 56})),
    (16, dict(BASE)),
]


def dive(i, n):
    p = KEYS(i, n, DIVE)
    if i == 6 or i == 7:
        p["_sw"] += 2 * (-1) ** i
        p["hips.dz"] = p.get("hips.dz", 0) + 0.015 * (-1) ** i
    if i <= 2 or i >= 12:
        L.feet_flat(p)
    return finish(p, 4 if i % 2 else -4, flow=0.9 if 8 <= i <= 11 else (0.3 if 3 <= i <= 7 else 0.1))


def dive_lift(i, n):
    # root height: crouch on the floor, hover high (windup), dive down the line, land
    h = {0: 0, 1: 0, 2: 0, 3: 0.25, 4: 0.55, 5: 0.7, 6: 0.85, 7: 0.9, 8: 0.95, 9: 0.65, 10: 0.32, 11: 0.03, 12: 0.0}
    return h.get(i, 0.0)


WAVE_WA = (6, 3, 5)
WAVE = [
    (0, dict(BASE)),
    (2, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 4, "th_n": 10, "kn_n": -16, "th_f": -18, "kn_f": -24,
                       "_sw": 110, "_nx": 0.3, "_nz": 0.0, "hips.dx": -0.08, "_wt": -26, "_wtf": -36,
                       "wn:x": -90, "wf:x": 90})),
    # WIND-UP peak (telegraph): blade straight up overhead, glowing, wings raised
    (5, L.merge(BASE, {"hips": 6, "spine": 8, "chest": 9, "neck": -6, "head": -8, "th_n": 4, "kn_n": -16, "th_f": -26,
                       "kn_f": -34, "_sw": 183, "_nx": 0.1, "_nz": 0.4, "hips.dx": -0.12, "hips.dz": -0.03,
                       "_wt": -12, "_wtf": -22, "wn:x": -162, "wf:x": 144, "wen:x": -6, "wef:x": 8})),
    (6, L.merge(BASE, {"hips": -10, "spine": -5, "chest": -5, "th_n": 34, "kn_n": -44, "th_f": -24, "kn_f": -22,
                       "_sw": 128, "_nx": 0.4, "_nz": 0.12, "hips.dz": -0.08, "_wt": -34, "_wtf": -44, "wn:x": -110,
                       "wf:x": 104})),
    (7, L.merge(BASE, {"hips": -24, "spine": -10, "chest": -10, "neck": 8, "head": 8, "th_n": 58, "kn_n": -70,
                       "th_f": -38, "kn_f": -12, "_sw": 78, "_nx": 0.62, "_nz": -0.36, "hips.dx": 0.12, "hips.dz": -0.18,
                       "_wt": -50, "_wtf": -58, "wn:x": -72, "wf:x": 72})),
    (8, L.merge(BASE, {"hips": -28, "spine": -10, "chest": -10, "neck": 10, "head": 10, "th_n": 62, "kn_n": -74,
                       "th_f": -40, "kn_f": -10, "_sw": 56, "_nx": 0.66, "_nz": -0.46, "hips.dx": 0.14, "hips.dz": -0.22,
                       "_wt": -56, "_wtf": -64, "wn:x": -64, "wf:x": 64})),
    (10, L.merge(BASE, {"hips": -18, "th_n": 40, "kn_n": -52, "_sw": 46, "_nx": 0.52, "_nz": -0.44, "hips.dz": -0.12,
                        "hips.dx": 0.06, "_wt": -34, "_wtf": -44, "wn:x": -50, "wf:x": 56})),
    (13, dict(BASE)),
]


def wave(i, n):
    p = KEYS(i, n, WAVE)
    if i in (4, 5):
        p["_sw"] += 2 * (-1) ** i
        p["chest"] += 1.2 * (-1) ** i
    L.feet_flat(p)
    act = WAVE_WA[0] <= i < WAVE_WA[0] + WAVE_WA[1]
    return finish(p, -6 if i >= WAVE_WA[0] else 2, flow=0.5 if act else 0.15)


HURT_K = [
    (0, L.merge(BASE, {"hips": 6, "spine": 8, "chest": 10, "neck": -8, "head": -18, "sh_n": 40, "el_n": 50, "sh_f": 34,
                       "el_f": 40, "hips.dx": -0.1, "th_n": 4, "th_f": -4, "_two": 0.0, "_sw": 56, "_wt": -22,
                       "_wtf": -30, "wn:x": -100, "wf:x": 100, "wen:x": -12})),
    (1, L.merge(BASE, {"hips": 4, "spine": 5, "chest": 6, "neck": -5, "head": -10, "_two": 0.5, "hips.dx": -0.06,
                       "_sw": 44, "_wt": -16, "_wtf": -24, "wn:x": -56, "wf:x": 60})),
    (3, dict(BASE)),
]


def hurt(i, n):
    p = KEYS(i, n, HURT_K)
    L.feet_flat(p)
    return finish(p, 10 if i == 0 else 5, flow=0.2)


DEATH = [
    # hit: head thrown back, wings flared wide
    (0, L.merge(BASE, {"hips": 8, "spine": 8, "chest": 12, "neck": -10, "head": -20, "sh_n": 44, "el_n": 40, "sh_f": 34,
                       "el_f": 36, "hips.dx": -0.14, "th_n": 6, "th_f": -6, "_two": 0.2, "_sw": 92, "_wt": -16, "_wtf": -26,
                       "wn:x": -156, "wf:x": 140})),
    (2, L.merge(BASE, {"hips": 2, "spine": 4, "chest": 6, "neck": -6, "head": -12, "th_n": 20, "kn_n": -40, "th_f": -10,
                       "kn_f": -26, "hips.dx": -0.12, "hips.dz": -0.1, "_two": 0.6, "_sw": 56, "_nx": 0.42, "_nz": -0.5,
                       "_wt": -26, "_wtf": -34, "wn:x": -120, "wf:x": 112})),
    # knees give way, sword planted as a crutch
    (4, L.merge(BASE, {"hips": -10, "spine": -8, "chest": -8, "neck": 8, "head": 12, "th_n": 78, "kn_n": -138,
                       "th_f": 62, "kn_f": -130, "hips.dx": -0.1, "hips.dz": -0.2, "_two": 1.0, "_sw": 52, "_nx": 0.4,
                       "_nz": -0.62, "_wt": -22, "_wtf": -28, "wn:x": -70, "wf:x": 74})),
    # kneeling, leaning on the sword, wings sagging
    (6, L.merge(BASE, {"hips": -16, "spine": -12, "chest": -12, "neck": 14, "head": 18, "th_n": 84, "kn_n": -142,
                       "th_f": 70, "kn_f": -136, "hips.dx": 0.0, "hips.dz": -0.2, "_two": 1.0, "_sw": 46, "_nx": 0.44,
                       "_nz": -0.7, "_wt": -12, "_wtf": -16, "wn:x": -30, "wf:x": 40, "wen:x": 12, "wef:x": 16})),
    # sword slips, she pitches forward
    (9, L.merge(BASE, {"hips": -58, "spine": -10, "chest": -8, "neck": 10, "head": 14, "th_n": 52, "kn_n": -88,
                       "th_f": 44, "kn_f": -80, "hips.dx": 0.3, "hips.dz": -0.1, "_two": 0.5, "_sw": 70, "_nx": 0.5,
                       "_nz": -0.6, "sh_n": 100, "el_n": 20, "sh_f": 70, "el_f": 20,
                       "_wt": -30, "_wtf": -40, "wn:x": -74, "wf:x": 78, "wen:x": 14, "wef:x": 18})),
    # face down, sword on the floor ahead, wings splayed over her back
    (13, L.merge(BASE, {"hips": -90, "spine": 0, "chest": 0, "neck": 5, "head": 10, "th_n": 6, "kn_n": -12, "th_f": 2,
                        "kn_f": -22, "hips.dx": 0.55, "sh_n": 172, "el_n": 8, "sh_f": 24, "el_f": 8, "_two": 0.0,
                        "_sw": 90, "_wt": -88, "_wtf": -98, "wn:x": -34, "wf:x": 38, "wen:x": 10, "wef:x": 12})),
]


def death(i, n):
    p = KEYS(i, n, DEATH)
    f = i / (n - 1)
    for sd in ("n", "f"):
        p["an_" + sd] = 30 * min(1, f * 2)
    p = finish(p, 0, flow=0)
    c = max(0.0, 1 - 1.5 * f)                      # hair and cape stop hanging and lie down
    p["pt"] = p["pt"] * c + 18 * (1 - c)
    p["pt1"] = p["pt1"] * c
    p["cp0"] = p["cp0"] * c + 80 * (1 - c)
    p["cp1"] = p["cp1"] * c
    # loose feathers drift down from the wings
    for k in range(4):
        t0 = 2 + 2 * k
        u = max(0.0, (i - t0) / 9.0)
        p["fx%d.dx" % k] = -0.5 - 0.4 * k + 0.5 * math.sin(3 * u + k)
        p["fx%d.dz" % k] = 2.6 - 0.45 * k - (2.4 - 0.45 * k) * min(1.0, u) + 0.0
        p["fx%d" % k] = 50 * math.sin(4 * u + k) - 40 + 30 * k
    return p


# --------------------------------------------------------------------------
# trails


def pose_sw(fn, n, i):
    """(sword world angle, grip x/z) of frame i."""
    p = fn(i, n)
    RIG.pose(*L.split(p))
    gx, gz = L.joint_xz(RIG, "sw")
    return gx, gz


def sw_angle(keys, i, n, extra=0.0):
    return KEYS(i, n, keys)["_sw"]


def make_trails(M):
    """crescent props: {(anim, frame): object}"""
    tr = {}
    cfg = [
        # anim, n, keys, frame, tail frame, head width
        ("slash", 15, SLASH, 5, 4, 1.05), ("slash", 15, SLASH, 6, 5, 1.05), ("slash", 15, SLASH, 7, 6, 0.9),
        ("slash", 15, SLASH, 8, 7, 0.9), ("slash", 15, SLASH, 9, 7, 1.05), ("slash", 15, SLASH, 10, 9, 1.05),
        ("wave", 14, WAVE, 6, 5, 1.0), ("wave", 14, WAVE, 7, 6, 1.1), ("wave", 14, WAVE, 8, 7, 0.95),
    ]
    fns = {"slash": slash, "wave": wave}
    for anim, n, keys, fr, tail, w in cfg:
        gx, gz = pose_sw(fns[anim], n, fr)
        a_h = KEYS(fr, n, keys)["_sw"]
        a_t = KEYS(tail, n, keys)["_sw"]
        ob = crescent("fx_tr_%s_%d" % (anim, fr), (gx, gz), a_t, a_h, LF + 0.1, w, M["trail"])
        ob2 = crescent("fx_tr2_%s_%d" % (anim, fr), (gx, gz), a_t + (a_h - a_t) * 0.35, a_h, LF + 0.1, w * 0.45, M["trail2"], y=-0.36)
        tr[(anim, fr)] = (ob, ob2)
    return tr


def main():
    r, M, feet, streaks, feathers = build()
    sh = Sheet("mb_valkyrie", r)
    trails = make_trails(M)
    tro = [o for pair in trails.values() for o in pair]
    for o in tro:
        sh.prop(o, False)
    for k in (0, 1):
        sh.prop(streaks[k][0], False)
    sh.prop([o for o in r.joints["root"].children_recursive if o.name == "fx_glow"][0], False)
    for f in feathers:
        sh.prop(f, False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and not o.name.startswith("fx_")]

    def glow_on(frames):
        return lambda i, n: {"fx_glow": i in frames}

    def trail_vis(anim, extra=None):
        def vf(i, n):
            v = {}
            for (a, fr), pair in trails.items():
                if a == anim:
                    v[pair[0].name] = fr == i
                    v[pair[1].name] = fr == i
            if extra:
                v.update(extra(i, n))
            return v
        return vf

    sh.render("idle", 8, idle, fps=7, loop=True, ground_objs=feet)
    sh.render("walk", 10, walk, fps=9, loop=True, ground_objs=feet)
    sh.render("slash", 15, slash, fps=14, wa=SLASH_WA, ground_objs=feet,
              vis_fn=trail_vis("slash", lambda i, n: {"fx_glow": i in (3, 4)}))
    sh.render("fly", 8, fly, fps=12, loop=True, ground_objs=feet, lift_fn=fly_lift)
    sh.render("dive", 17, dive, fps=12, wa=DIVE_WA, ground_fn=lambda i, n: allm if 8 <= i <= 13 else feet,
              lift_fn=dive_lift,
              vis_fn=lambda i, n: {"fx_glow": i in (6, 7), "fx_streaks0": 8 <= i <= 11 and i % 2 == 0,
                                   "fx_streaks1": 8 <= i <= 11 and i % 2 == 1})
    sh.render("wave", 14, wave, fps=12, wa=WAVE_WA, ground_objs=feet,
              vis_fn=trail_vis("wave", lambda i, n: {"fx_glow": i in (4, 5, 6, 7)}))
    sh.render("hurt", 4, hurt, fps=12, ground_objs=feet)
    sh.render("death", 14, death, fps=8, grounds=[("hips", allm)],
              vis_fn=lambda i, n: {"fx_feather%d" % k: i >= 2 + 2 * k for k in range(4)})
    sh.write_spec()


L.run(main)
