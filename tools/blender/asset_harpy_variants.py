"""DEADSELL enemy variants of the harpy (docs/CONTENT2.md section 1):
harpy_storm, harpy_raven, harpy_siren, harpy_ember.

blender -b --factory-startup -P tools/blender/asset_harpy_variants.py [-- storm raven ...] [--quick]
-> build/frames/harpy_<v>/*.png + spec.json   (pack: python3 tools/pack/pack_all.py harpy_storm ...)

Every variant builds the BASE harpy rig through asset_harpy.build() (identical frame size, anchor, joints
and animation table to harpy.png: fly dive_windup dive recover hurt death) with a re-parametrised wing
builder (feather shape / count / ragged edges / emissive tips) and then recolours / adds parts.  The base
script's own output is not touched (its render call is suppressed while importing it).  --quick renders
only fly + dive_windup + dive (for previews).
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

_run = L.run
L.run = lambda f: None          # importing the base script must not render the base sheet
import asset_harpy as B  # noqa: E402
L.run = _run

S = B.S


# --------------------------------------------------------------------------
# helpers (same block in asset_{bomber,harpy,lancer}_variants.py)


def rc(m, base, shadow=None, light=None, rim=None):
    """Recolour a toon material in place (3 flat bands + optional rim colour)."""
    nt = m.node_tree
    ramp = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].color = common._hex(shadow or common._darken(base, 0.55))
    els[1].color = common._hex(base)
    els[2].color = common._hex(light or common._lighten(base, 0.25))
    if rim:
        mix = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeMixRGB")
        mix.inputs[2].default_value = common._hex(rim)


def set_glow(m, color):
    em = next(n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeEmission")
    em.inputs[0].default_value = common._hex(color)


def objs(prefix):
    """Mesh objects named `prefix` (or its .001 duplicates); 'foo*' matches by prefix.  Joints are Empties."""
    return [o for o in bpy.data.objects if o.type == "MESH" and (
        o.name == prefix or o.name.startswith(prefix + ".")
        or (prefix.endswith("*") and o.name.startswith(prefix[:-1])))]


def drop(*names):
    """Delete mesh objects by exact name (and .001 duplicates); 'foo*' deletes by prefix."""
    for n in names:
        for ob in objs(n):
            bpy.data.objects.remove(ob, do_unlink=True)


def remat(name, mat):
    for ob in objs(name):
        ob.data.materials[0] = mat


def scale(name, sx, sy, sz):
    for ob in objs(name):
        ob.scale = (sx, sy, sz)


# --------------------------------------------------------------------------
# re-parametrised wing (same joints / lengths / layering as asset_harpy.feather_wing)

WING_DEFAULT = dict(sec_w=0.125, sec_tip=0.45, sec_len=0.40, sec_curve=0.0,
                    pri_n=7, pri_w=0.115, pri_tip=0.5, pri_len=0.42, pri_grow=0.192, pri_fan=57.0, pri_curve=0.0,
                    ptip_len=0.66, ptip_w=0.1, jag=0.0, seed=3, glow=None, glow_far=None, glow_from=0.58,
                    glow_secs=False)


def make_wing(cfg):
    c = dict(WING_DEFAULT)
    c.update(cfg)

    def feather_wing(M, side, pal):
        FS, IN, OUT = B.FS, B.IN_LEN, B.OUT_LEN
        rnd = random.Random(c["seed"] * 7 + side)
        gm = None
        if c["glow"]:
            gm = L.glow("v_wglow_%d" % side, c["glow"] if side < 0 else (c["glow_far"] or c["glow"]))
        dy = -0.012
        inner, outer = [], []

        def glow_leaf(nm, ln, wd, loc, phi, tipv, ky):
            """Emissive overlay on the last (1 - glow_from) of a feather (placed along the feather axis)."""
            g0 = c["glow_from"]
            a = math.radians(phi)
            o = (loc[0] - g0 * ln * math.sin(a), loc[1] - 0.006 - 0.0004 * ky, loc[2] - g0 * ln * math.cos(a))
            f = L.leaf(nm, ln * (1 - g0) * 0.97, wd * 0.74, 0.02, gm, tip=tipv, base=0.3, curve=0.0)
            f.location = o
            f.rotation_euler = (0, a, 0)
            return f

        inner.append(L.tube("w_bone_in", [(0, 0, 0.03), (0, 0, -0.3), (0.01, 0, -IN)], [0.06, 0.05, 0.04],
                            pal["dark"], segs=6))
        for k in range(6):
            phi = 80 - 9 * k
            ln = (c["sec_len"] + 0.015 * k) * FS * (1 + c["jag"] * (rnd.random() * 2 - 1))
            f = L.leaf("sec%d" % k, ln, c["sec_w"], 0.02, pal["a"] if k % 2 == 0 else pal["b"], tip=c["sec_tip"],
                       base=0.3, curve=c["sec_curve"])
            f.location = (0, dy * (k + 1), -0.05 - 0.075 * k)
            f.rotation_euler = (0, math.radians(phi), 0)
            inner.append(f)
            if gm and c["glow_secs"]:
                inner.append(glow_leaf("sg%d" % k, ln, c["sec_w"], f.location, phi, c["sec_tip"], k))
        for k, z in enumerate((-0.07, -0.18, -0.29)):
            f = L.leaf("cov%d" % k, 0.2 * FS, 0.13, 0.02, pal["trim"] if k != 1 else pal["b"], tip=0.5, base=0.4)
            f.location = (0.0, dy * (8 + k), z)
            f.rotation_euler = (0, math.radians(62 - 6 * k), 0)
            inner.append(f)
        outer.append(L.tube("w_bone_out", [(0, 0, 0.03), (0, 0, -0.3), (0.0, 0, -OUT)], [0.05, 0.04, 0.03],
                            pal["dark"], segs=6))
        pn = c["pri_n"]
        for k in range(pn):
            phi = 56 - c["pri_fan"] / (pn - 1) * k
            ln = (c["pri_len"] + c["pri_grow"] * k / (pn - 1)) * FS * (1 + c["jag"] * (rnd.random() * 2 - 1))
            f = L.leaf("pri%d" % k, ln, c["pri_w"], 0.02, pal["b"] if k % 2 == 0 else pal["a"], tip=c["pri_tip"],
                       base=0.25, curve=c["pri_curve"])
            f.location = (0, dy * (k + 1), -0.04 - 0.42 * k / pn)
            f.rotation_euler = (0, math.radians(phi), 0)
            outer.append(f)
            if gm:
                outer.append(glow_leaf("pg%d" % k, ln, c["pri_w"], f.location, phi, c["pri_tip"], k))
        ln = c["ptip_len"] * FS
        f = L.leaf("pri_tip", ln, c["ptip_w"], 0.02, pal["trim"], tip=0.55, base=0.2)
        f.location = (0.0, dy * 9, -OUT + 0.04)
        f.rotation_euler = (0, math.radians(-6), 0)
        outer.append(f)
        if gm:
            outer.append(glow_leaf("pgt", ln, c["ptip_w"], f.location, -6, 0.55, 9))
        return L.joined("wing_in_%d" % side, inner), L.joined("wing_out_%d" % side, outer)

    return feather_wing


def flame(name, pts, radii, mat, depth=0.9):
    return L.tube(name, pts, radii, mat, segs=7, depth=depth)


# --------------------------------------------------------------------------
# variants.  Each takes (rig, materials).


def v_storm(r, M):
    A = r.attach
    bolt = L.glow("v_bolt", "#bfe6ff")
    rc(M["skin"], "#e6c8d0", "#96708a", "#fae8ea")
    rc(M["bodice"], "#8e9ab6", "#464e6e", "#d4def4")
    rc(M["fea"], "#c4ccdc", "#6e7a9c", "#f0f4fc")
    rc(M["fea2"], "#9eaac4", "#566290", "#d8e2f6")
    rc(M["dark"], "#5a6488", "#2a3050", "#8c98bc")
    rc(M["trim"], "#3c9cff", "#1a4aa0", "#a8d8ff")
    rc(M["fa"], "#a4aec4", "#5a6688", "#d6deee")
    rc(M["fb"], "#8490ac", "#444e72", "#bcc8e0")
    rc(M["fdark"], "#424c6e", "#1e2442", "#6a769a")
    rc(M["ftrim"], "#2a78d0", "#123a80", "#78b8ff")
    rc(M["scale"], "#aab4c8", "#5a6684", "#e4ecf8")
    rc(M["talon"], "#e0e8f4", "#7a8aa4", "#ffffff")
    rc(M["hair"], "#3468dc", "#16307e", "#86b0ff")
    set_glow(M["eye"], "#ffb040")
    set_glow(M["streak"], "#cfe8ff")
    # crackling lightning bolts crossing the hair + a bolt on the sash
    for k, (y, dx) in enumerate(((-0.1, 0.0), (0.1, 0.05))):
        pts = [(-0.18 * S + dx, y * S, 0.42 * S), (-0.12 * S + dx, y * S, 0.36 * S), (-0.17 * S + dx, y * S, 0.3 * S),
               (-0.09 * S + dx, y * S, 0.22 * S)]
        A(L.tube("hbolt%d" % k, pts, [0.016 * S, 0.02 * S, 0.016 * S, 0.004], bolt, segs=5, depth=0.8), "head")
    A(L.tube("sbolt", [(0.15 * S, -0.04 * S, 0.1 * S), (0.17 * S, -0.04 * S, 0.0), (0.15 * S, -0.04 * S, -0.02 * S),
                       (0.17 * S, -0.04 * S, -0.12 * S)], [0.02 * S, 0.026 * S, 0.02 * S, 0.004], bolt, segs=5), "spine")
    # puffy cloud ruff
    A(ellipsoid("cloud_l", (0.12 * S, 0.12 * S, 0.1 * S), M["fea"]), "chest", (0.1 * S, -0.12 * S, 0.2 * S))
    A(ellipsoid("cloud_r", (0.12 * S, 0.12 * S, 0.1 * S), M["fea"]), "chest", (0.1 * S, 0.12 * S, 0.2 * S))


def v_raven(r, M):
    A = r.attach
    beak = L.mat("v_beak", "#cfc7b8", "#7e7468", "#f6f0e0")
    rc(M["skin"], "#dcc0c8", "#8a6078", "#f6e2e4")
    rc(M["bodice"], "#2c2832", "#100c16", "#5a5268")
    rc(M["fea"], "#26222e", "#0c0a12", "#4a4458")
    rc(M["fea2"], "#38323f", "#12101a", "#625a74")
    rc(M["dark"], "#16141c", "#06050a", "#3a3646")
    rc(M["trim"], "#c82838", "#5a0e1c", "#ff6a6a")
    rc(M["fa"], "#1c1a24", "#08060e", "#38344a")
    rc(M["fb"], "#262230", "#0a0810", "#46405a")
    rc(M["fdark"], "#0e0c14", "#040308", "#2c2838")
    rc(M["ftrim"], "#8a1c2c", "#3c0a14", "#c84050")
    rc(M["scale"], "#3c3646", "#16121e", "#686078")
    rc(M["talon"], "#bcb4a6", "#6a6058", "#eee6d6")
    rc(M["hair"], "#2a2432", "#0c0a12", "#554e68")
    set_glow(M["eye"], "#ff2a2a")
    set_glow(M["streak"], "#ff9a9a")
    scale("eyes", 1.0, 1.25, 1.2)
    # crow-beak half mask under the red eyes
    A(L.bake(cone("beak", 0.07 * S, 0.0, 0.27 * S, beak, loc=(0.07 * S, 0, 0.03 * S), rot=(0, 96, 0))), "head")
    A(ellipsoid("beak_base", (0.09 * S, 0.15 * S, 0.1 * S), beak), "head", (0.08 * S, 0, 0.035 * S))
    # extra tail feathers
    for k, (phi, ln) in enumerate(((-14, 0.46), (66, 0.5))):
        f = L.leaf("tailx%d" % k, ln, 0.13, 0.02, M["fea"], tip=0.5, base=0.3)
        f.location = (0, 0.012 * (k + 1), 0)
        f.rotation_euler = (0, math.radians(phi), 0)
        A(L.joined("tailmx%d" % k, [f]), "tail")


def v_siren(r, M):
    A = r.attach
    shell = L.mat("v_shell", "#ffe2ec", "#d098b0", "#ffffff")
    pearl = L.mat("v_pearl", "#fffaf2", "#b8aab4", "#ffffff")
    star = L.mat("v_star", "#ff9a58", "#a8421e", "#ffd09a")
    rc(M["skin"], "#f6d4d8", "#a8708a", "#fff0ee")
    rc(M["bodice"], "#ffd8e6", "#c48aa6", "#ffffff")
    rc(M["fea"], "#f2bcd0", "#b0728e", "#ffe6ee")
    rc(M["fea2"], "#96dcd6", "#4a9aa6", "#dcfff8")
    rc(M["dark"], "#c692ac", "#7e5272", "#f0c4d8")
    rc(M["trim"], "#58d4cc", "#228a8e", "#b8fff0")
    rc(M["fa"], "#e8b0c4", "#a06a86", "#f8d6e2")
    rc(M["fb"], "#f4cadb", "#b47a96", "#fff0f6")
    rc(M["fdark"], "#b684a0", "#704868", "#dcaec6")
    rc(M["ftrim"], "#3cb4b0", "#1a6a74", "#90f0e6")
    rc(M["scale"], "#c4e8e4", "#74a0a8", "#f4fffc")
    rc(M["talon"], "#fff0e0", "#a8908a", "#ffffff")
    rc(M["hair"], "#f4d470", "#b08a34", "#fff6b8")
    set_glow(M["eye"], "#ff9a3a")
    # very long blonde hair (replaces the short locks; the 'hb'/'hb1' joints swing it)
    drop("lock*")
    for k, (y, ln, rr) in enumerate(((-0.07, 0.34, 0.1), (0.0, 0.4, 0.108), (0.075, 0.3, 0.092))):
        A(L.tube("lock%d" % k, [(0, y * S, 0), (-0.03 * S, y * S, -0.15), (-0.02 * S, y * S, -ln)],
                 [rr * S, rr * S * 0.95, rr * S * 0.9], M["hair"], depth=0.9), "hb")
        A(L.tube("lockb%d" % k, [(0, y * S, 0.02), (-0.02 * S, y * S, -0.17), (0.01 * S, y * S, -0.3 - 0.07 * k),
                                 (0.0, y * S, -0.44 - 0.08 * k)],
                 [rr * S * 0.95, rr * S * 0.85, rr * S * 0.6, 0.012], M["hair"], depth=0.9), "hb1")
    # shell ornaments: bikini shells, hair shells + starfish, pearl strand, hip shell
    for y in (-0.085, 0.085):
        A(ellipsoid("shell_b", (0.15 * S, 0.14 * S, 0.14 * S), shell), "chest", (0.1 * S, y * S, 0.07 * S))
        A(ellipsoid("shell_br", (0.06 * S, 0.12 * S, 0.035 * S), M["trim"]), "chest", (0.13 * S, y * S, 0.14 * S))
    for y in (-0.145, 0.145):
        A(ellipsoid("shell_h", (0.1 * S, 0.05 * S, 0.12 * S), shell), "head", (0.0, y * S, 0.19 * S))
    for k in range(5):
        a = math.radians(90 + 72 * k)
        A(L.bake(cone("starf%d" % k, 0.03 * S, 0.0, 0.1 * S, star,
                      loc=(0.02 * S + 0.03 * S * math.cos(a), -0.14 * S, 0.27 * S + 0.03 * S * math.sin(a)),
                      rot=(0, 90 - math.degrees(a), 0))), "head")
    for k in range(7):
        a = math.radians(-70 + 25 * k)
        A(ellipsoid("pearl%d" % k, (0.045 * S, 0.045 * S, 0.045 * S), pearl), "chest",
          ((0.1 + 0.05 * math.cos(a)) * S, (-0.06 + 0.0) * S + 0.0, (0.18 + 0.06 * math.sin(a)) * S - 0.04 * S))
    A(ellipsoid("shell_hip", (0.13 * S, 0.12 * S, 0.14 * S), shell), "skirt", (0.09 * S, -0.1 * S, -0.04 * S))
    A(ellipsoid("pearl_hip", (0.05 * S, 0.05 * S, 0.05 * S), pearl), "skirt", (0.13 * S, -0.1 * S, -0.04 * S))


def v_ember(r, M):
    A = r.attach
    fo = L.glow("v_fl_out", "#ff6a1a")
    fm = L.glow("v_fl_mid", "#ffb02a")
    fi = L.glow("v_fl_in", "#fff0a0")
    rc(M["skin"], "#f2c4b0", "#a06068", "#ffe6d6")
    rc(M["bodice"], "#3a2428", "#180e14", "#74464a")
    rc(M["fea"], "#8a2a1a", "#3e1012", "#c8502c")
    rc(M["fea2"], "#d8481c", "#7a1c14", "#ff8a44")
    rc(M["dark"], "#5a1a18", "#26080c", "#923430")
    rc(M["trim"], "#ffc83a", "#c06a14", "#fff0a0")
    rc(M["fa"], "#a42a18", "#480e12", "#d85a30")
    rc(M["fb"], "#c8581c", "#701c12", "#f08a3c")
    rc(M["fdark"], "#44100f", "#1c0608", "#7a2a28")
    rc(M["ftrim"], "#d8a02a", "#8a4210", "#ffe27a")
    rc(M["scale"], "#4c3434", "#1e1216", "#82605a")
    rc(M["talon"], "#ffc060", "#a85a22", "#fff0b0")
    rc(M["hair"], "#ff9a22", "#b8420e", "#ffe070")
    set_glow(M["eye"], "#ffe040")
    set_glow(M["streak"], "#ffa648")
    # flame crown rising from the hair + embers on the shoulders
    for k, (dx, h, rr) in enumerate(((-0.02, 0.42, 0.075), (-0.09, 0.36, 0.062), (0.05, 0.3, 0.055))):
        yy = (k - 1) * 0.07
        A(flame("hf_o%d" % k, [(dx * S, yy * S, 0.28 * S), ((dx - 0.01) * S, yy * S, (0.28 + h * 0.5) * S),
                               ((dx - 0.05) * S, yy * S, (0.28 + h * 0.85) * S), ((dx - 0.12) * S, yy * S, (0.28 + h) * S)],
                [rr * S * 1.1, rr * S * 1.3, rr * S * 0.8, 0.004], fo), "head")
        A(flame("hf_i%d" % k, [(dx * S, yy * S, 0.28 * S), ((dx - 0.01) * S, yy * S, (0.28 + h * 0.4) * S),
                               ((dx - 0.04) * S, yy * S, (0.28 + h * 0.6) * S)],
                [rr * S * 0.7, rr * S * 0.8, 0.004], fm), "head")
    for sd, y in (("n", -0.15), ("f", 0.15)):
        A(ellipsoid("ember_" + sd, (0.09 * S, 0.09 * S, 0.09 * S), fm), "chest", (-0.02 * S, y * S, 0.22 * S))
    A(ellipsoid("ember_sash", (0.05 * S, 0.14 * S, 0.05 * S), fi), "spine", (0.12 * S, 0, 0.06 * S))
    # glowing talon tips / knee embers
    for sd in ("n", "f"):
        A(ellipsoid("kn_ember_" + sd, (0.07 * S, 0.07 * S, 0.07 * S), fm), "kn_" + sd, (0.05 * S, 0, -0.02 * S))


VARIANTS = {
    # id: (setup, wing cfg)
    "harpy_storm": (v_storm, dict(sec_w=0.105, sec_tip=0.7, sec_len=0.42, pri_n=8, pri_w=0.09, pri_tip=0.72,
                                  pri_len=0.46, pri_grow=0.2, ptip_len=0.7, ptip_w=0.085,
                                  glow="#8cd0ff", glow_far="#5aa8f0", glow_from=0.62)),
    "harpy_raven": (v_raven, dict(sec_w=0.115, sec_tip=0.55, sec_len=0.4, pri_n=8, pri_w=0.1, pri_tip=0.6,
                                  pri_len=0.4, pri_grow=0.24, jag=0.16, ptip_len=0.68, seed=5)),
    "harpy_siren": (v_siren, dict(sec_w=0.15, sec_tip=0.25, sec_len=0.38, pri_n=7, pri_w=0.14, pri_tip=0.28,
                                  pri_len=0.4, pri_grow=0.17, ptip_len=0.6, ptip_w=0.13)),
    "harpy_ember": (v_ember, dict(sec_w=0.12, sec_tip=0.6, sec_len=0.38, sec_curve=-0.08, pri_n=7, pri_w=0.105,
                                  pri_tip=0.62, pri_len=0.42, pri_grow=0.2, pri_curve=-0.12, ptip_len=0.68,
                                  ptip_w=0.095, jag=0.1, glow="#ffd23a", glow_far="#ff9a2a", glow_from=0.5,
                                  glow_secs=True, seed=8)),
}


# --------------------------------------------------------------------------


def render_variant(vid, spec, quick):
    setup, wcfg = spec
    common._MAT_CACHE.clear()
    B.STREAKS[0][:] = []
    B.STREAKS[1][:] = []
    orig = B.feather_wing
    B.feather_wing = make_wing(wcfg)
    r, M, feet = B.build()
    B.feather_wing = orig
    setup(r, M)
    sh = L.Sheet(vid, r)
    for gi in (0, 1):
        sh.prop(B.STREAKS[gi][0], False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and not o.name.startswith("streaks")]
    # same animation table as asset_harpy.main()
    sh.render("fly", 8, B.fly, fps=12, loop=True, ground_objs=feet,
              lift_fn=lambda i, n: 0.05 - 0.05 * math.cos(2 * math.pi * i / n) * 0.8)
    sh.render("dive_windup", 6, B.dive_windup, fps=10, ground_objs=feet, lift_fn=lambda i, n: 0.05)
    sh.render("dive", 4, B.dive, fps=14, loop=True, ground_objs=feet,
              vis_fn=lambda i, n: {"streaks0": i % 2 == 0, "streaks1": i % 2 == 1})
    if not quick:
        sh.render("recover", 4, B.recover, fps=10, ground_objs=feet, lift_fn=lambda i, n: 0.05)
        sh.render("hurt", 3, B.hurt, fps=12, ground_objs=feet, lift_fn=lambda i, n: 0.05)
        sh.render("death", 9, B.death, fps=10, grounds=[("hips", allm)])
    sh.write_spec()


def main():
    args = common.script_args()
    quick = "--quick" in args
    want = [a for a in args if not a.startswith("--")]
    for vid, spec in VARIANTS.items():
        if want and vid.split("_", 1)[1] not in want and vid not in want:
            continue
        render_variant(vid, spec, quick)


L.run(main)
