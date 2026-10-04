"""DEADSELL enemy variants of the archer (docs/CONTENT2.md section 1):
archer_fire, archer_volley, archer_crossbow, archer_shadow.

blender -b --factory-startup -P tools/blender/asset_archer_variants.py [-- fire volley ...] [--quick]
-> build/frames/archer_<v>/*.png + spec.json   (pack: python3 tools/pack/pack_all.py archer_fire ...)

Every variant builds the BASE archer rig through asset_archer.build() (identical frame size, anchor,
joints, bow-string constraints and animation table to archer.png: idle walk shoot(6/2/4) hurt death)
and then recolours / removes / adds parts.  The base script's own output is not touched (its render
call is suppressed while importing it).  --quick renders only idle + shoot (for previews).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, box, cone  # noqa: E402

_run = L.run
L.run = lambda f: None          # importing the base script must not render the base sheet
import asset_archer as B  # noqa: E402
L.run = _run

WA = B.WA


# --------------------------------------------------------------------------
# helpers (same block in asset_{ghoul,jailer,archer}_variants.py)


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


def drop(*names):
    for n in names:
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)


def hide(*names):
    for n in names:
        bpy.data.objects[n].hide_render = True


def scale(name, sx, sy, sz):
    bpy.data.objects[name].scale = (sx, sy, sz)


def tips():
    """(x, top z, bottom z) of the bow tips in the 'bow' joint's space."""
    amax = math.asin(B.BOW_HALF / B.BOW_R)
    return B.BOW_R * math.cos(amax) - B.BOW_R + 0.02, B.BOW_HALF - 0.04, -B.BOW_HALF - 0.04


def make_prod(r, mat, thick=1.0):
    """Replace the bow limbs by a thicker one (crossbow prod)."""
    drop("bow_m")
    amax = math.asin(B.BOW_HALF / B.BOW_R)
    n = 13
    pts = []
    for k in range(n):
        a = -amax + 2 * amax * k / (n - 1)
        pts.append((B.BOW_R * math.cos(a) - B.BOW_R, 0, B.BOW_R * math.sin(a)))
    rad = [(0.014 + 0.02 * (1 - abs(k - (n - 1) / 2) / ((n - 1) / 2))) * thick for k in range(n)]
    bow = L.tube("prod_m", pts, rad, mat, segs=6)
    bow.location = (0.02, 0, -0.04)
    L.bake(bow)
    return r.attach(bow, "bow")


def make_arrow(r, M, length, rad, head_len, head_r, fletch_len, head_mat=None):
    """Replace the arrow prop (hangs down from the 'arrow' joint, tip toward -Z)."""
    drop("arrowm")
    ar = [L.limb("shaft", length, rad, rad, M["wood"])]
    head = cone("arrowhead", head_r, 0.0, head_len, head_mat or M["steel"], rot=(180, 0, 0))
    head.location = (0, 0, -(length - 0.02))
    ar.append(head)
    for k, rot in enumerate((0, 90)):
        f = L.leaf("afl%d" % k, fletch_len, 0.05, 0.012, M["fletch"], tip=0.2)
        f.location = (0, 0, -0.02)
        f.rotation_euler = (0, 0, math.radians(rot))
        ar.append(f)
    arrow = L.joined("arrowm", ar)
    r.attach(arrow, "arrow", (0, 0, 0.04))
    return arrow


def flame(name, pts, radii, mat, depth=0.9):
    return L.tube(name, pts, radii, mat, segs=7, depth=depth)


# --------------------------------------------------------------------------
# variants.  Each takes (rig, materials, feet, arrow) and returns a context dict:
#   arrow       replacement arrow prop (optional)
#   arrow_props names of extra objects that are visible exactly while the arrow is


def v_fire(r, M, feet, arrow):
    A = r.attach
    rc(M["cloak"], "#b02c28", "#58101e", "#e2524a")
    rc(M["cloak_in"], "#7c1e26", "#380e1c", "#aa3a40")
    rc(M["leather"], "#5e3c2a", "#2a1618", "#8c5c3c")
    rc(M["dark"], "#3c2a30", "#1c1218", "#5c4650")
    rc(M["boot"], "#4a2a22", "#241014", "#6e4034")
    rc(M["hair"], "#f2c446", "#9c6a22", "#fff2a8")
    rc(M["wood"], "#5c2a24", "#26101a", "#cc5a1e")
    rc(M["fletch"], "#ff9c2c", "#a24412", "#ffd468")
    rc(M["steel"], "#ffb444", "#c4501a", "#fff0a0", rim="#fff0a0")
    set_glow(M["eye"], "#ffe040")
    fo = L.glow("v_fl_out", "#ff5a12")
    fm = L.glow("v_fl_mid", "#ffa22a")
    fi = L.glow("v_fl_in", "#fff0a0")
    # burning arrow head (only while the arrow is nocked)
    f1 = flame("fa_out", [(0, 0, -0.97), (0, 0, -0.84), (0, 0, -0.68), (0.0, 0, -0.5)], [0.05, 0.085, 0.055, 0.006], fo)
    f2 = flame("fa_mid", [(0, 0, -0.95), (0, 0, -0.84), (0, 0, -0.7)], [0.035, 0.06, 0.005], fm)
    f3 = flame("fa_in", [(0, 0, -0.93), (0, 0, -0.85), (0, 0, -0.78)], [0.02, 0.035, 0.004], fi)
    for f in (f1, f2, f3):
        A(f, "arrow")
    # embers: glowing bow tips with a flame on the upper tip
    tx, tz_top, tz_bot = tips()
    A(flame("bt_out", [(tx, 0, tz_top), (tx + 0.01, 0, tz_top + 0.08), (tx + 0.03, 0, tz_top + 0.2),
                       (tx + 0.07, 0, tz_top + 0.3)], [0.045, 0.06, 0.04, 0.005], fo), "bow")
    A(flame("bt_in", [(tx, 0, tz_top), (tx + 0.01, 0, tz_top + 0.06), (tx + 0.03, 0, tz_top + 0.14)],
            [0.03, 0.04, 0.004], fm), "bow")
    A(ellipsoid("bt_ember", (0.075, 0.075, 0.075), fm), "bow", (tx, 0, tz_bot))
    # flaming arrows poking out of the quiver
    qm = bpy.data.objects["quiverm"]
    for k, (dx, dy, ln) in enumerate(((0.0, -0.02, 0.2), (0.035, 0.02, 0.15), (-0.035, 0.01, 0.17))):
        a = flame("qf_o%d" % k, [(dx, dy, 0.56), (dx, dy, 0.6), (dx, dy, 0.6 + ln * 0.6), (dx + 0.01, dy, 0.6 + ln)],
                  [0.04, 0.055, 0.04, 0.005], fo)
        a.parent = qm
        b = flame("qf_i%d" % k, [(dx, dy, 0.57), (dx, dy, 0.62), (dx, dy, 0.6 + ln * 0.55)], [0.025, 0.035, 0.004], fm)
        b.parent = qm
    # glowing red-hot rune strip on the belt
    A(ellipsoid("ember_belt", (0.05, 0.12, 0.04), fm), "hips", (0.2, 0, 0.07))
    return {"arrow_props": ["fa_out", "fa_mid", "fa_in"]}


def v_volley(r, M, feet, arrow):
    A = r.attach
    teal = L.mat("v_teal", "#26b8b0", "#0e5a68", "#80f0e4")
    rc(M["cloak"], "#a88a5e", "#56402e", "#d8bc88")
    rc(M["cloak_in"], "#705a3e", "#2e2420", "#98805a")
    rc(M["leather"], "#7a5030", "#3a2420", "#a87a4c")
    rc(M["dark"], "#34424e", "#161c26", "#566676")
    rc(M["boot"], "#5a3c2a", "#2a1a1c", "#80583e")
    rc(M["hair"], "#efe5b6", "#a69a70", "#ffffff")
    rc(M["wood"], "#b08850", "#563a2c", "#dcb870")
    rc(M["fletch"], "#26b8b0", "#0e5a68", "#80f0e4")
    # teal scarf: wrap + knot + two trailing tails that flow with the cloak
    A(ellipsoid("scarf", (0.27, 0.36, 0.12), teal), "chest", (0.0, 0, 0.26))
    A(ellipsoid("scarf_knot", (0.11, 0.1, 0.11), teal), "chest", (0.1, -0.13, 0.2))
    A(L.tube("scarf_t1", [(0, 0, 0.04), (-0.03, 0, -0.18), (-0.06, 0, -0.42)], [0.06, 0.07, 0.045], teal, depth=0.45),
      "cape", (0.0, -0.17, 0.0))
    A(L.tube("scarf_t2", [(0, 0, 0.02), (-0.03, 0, -0.12), (-0.07, 0, -0.3)], [0.05, 0.06, 0.035], teal, depth=0.45),
      "cape", (0.03, -0.21, 0.0))
    # second quiver (crossed behind the first)
    qm = bpy.data.objects["quiverm"]
    q2 = qm.copy()
    bpy.context.scene.collection.objects.link(q2)
    q2.name = "quiverm2"
    q2.parent = r.joints["chest"]
    q2.location = (-0.14, -0.06, -0.06)
    q2.rotation_euler = (0, math.radians(18), 0)
    # three-arrow fan: two extra arrows spread +-9 degrees from the nocked one
    extra = []
    for sgn in (-1, 1):
        c = arrow.copy()
        bpy.context.scene.collection.objects.link(c)
        c.parent = r.joints["arrow"]
        c.location = (0, 0.0, 0.04)
        c.rotation_euler = (0, math.radians(9 * sgn), 0)
        extra.append(c.name)
    return {"arrow_props": extra}


def v_crossbow(r, M, feet, arrow):
    A = r.attach
    brass = L.mat("v_brass", "#cca444", "#6e4c20", "#ffe688")
    steel2 = L.mat("v_steel2", "#8a94ac", "#3c4260", "#dce4f6")
    rc(M["cloak"], "#4c3c34", "#241a1e", "#78604e")
    rc(M["cloak_in"], "#32282a", "#161014", "#52403c")
    rc(M["leather"], "#6a4a34", "#301e1e", "#98704c")
    rc(M["dark"], "#2c2c38", "#14121c", "#484658")
    rc(M["boot"], "#3c2c26", "#1c1216", "#5c443a")
    rc(M["hair"], "#2c2230", "#100c16", "#4c4054")
    rc(M["wood"], "#6a4a34", "#2c1c1c", "#92684a")
    rc(M["steel"], "#c4ccdc", "#5a627c", "#ffffff")
    rc(M["fletch"], "#e0b040", "#7a5420", "#ffe488")
    set_glow(M["eye"], "#ffb830")
    # heavy crossbow: stout steel prod + long stock + brass fittings (replaces the longbow)
    make_prod(r, steel2, thick=1.9)
    drop("bow_grip")
    A(box("cb_stock", (0.66, 0.085, 0.11), M["wood"], bevel=0.02), "bow", (-0.27, 0, -0.045))
    A(box("cb_rail", (0.6, 0.05, 0.04), brass, bevel=0.01), "bow", (-0.25, 0, 0.02))
    A(box("cb_butt", (0.1, 0.1, 0.17), M["leather"], bevel=0.02), "bow", (-0.6, 0, -0.07))
    A(box("cb_block", (0.12, 0.1, 0.17), brass, bevel=0.015), "bow", (0.0, 0, -0.04))
    tx, tz_top, tz_bot = tips()
    for z in (tz_top, tz_bot):
        A(ellipsoid("cb_cap", (0.07, 0.07, 0.07), brass), "bow", (tx, 0, z))
    # heavy bolt
    arrow = make_arrow(r, M, 0.66, 0.02, 0.17, 0.05, 0.1, head_mat=steel2)
    # armoured vest + pauldrons + brass buckle
    A(ellipsoid("vest", (0.3, 0.35, 0.34), steel2), "chest", (0.01, 0, 0.05))
    A(ellipsoid("vest_trim", (0.31, 0.37, 0.05), brass), "chest", (0.01, 0, -0.08))
    for sd in ("n", "f"):
        A(ellipsoid("paul_" + sd, (0.2, 0.19, 0.13), steel2), "sh_" + sd, (0.0, 0, 0.02))
    A(box("buckle", (0.05, 0.08, 0.06), brass, bevel=0.01), "hips", (0.2, 0, 0.07))
    # brass goggles on the hood (strap + two big lenses)
    glass = L.glow("v_glass", "#ffc03c")
    A(ellipsoid("g_strap", (0.31, 0.3, 0.05), M["boot"]), "head", (-0.02, 0, 0.13))
    for y in (-0.085, 0.085):
        A(L.disc("g_rim%+d" % int(y * 100), 0.088, 0.06, brass, rot=(0, 90, 0), segs=14), "head", (0.115, y, 0.125))
        A(L.disc("g_lens%+d" % int(y * 100), 0.062, 0.07, glass, rot=(0, 90, 0), segs=12), "head", (0.12, y, 0.125))
    A(ellipsoid("g_bridge", (0.05, 0.06, 0.03), brass), "head", (0.115, 0, 0.13))
    return {"arrow": arrow, "arrow_props": []}


def v_shadow(r, M, feet, arrow):
    A = r.attach
    bone = L.mat("v_mask", "#ece8f6", "#b4aad0", "#ffffff")
    glowp = L.glow("v_purple", "#c458ff")
    rc(M["cloak"], "#1c1a2c", "#080812", "#3a3658", rim="#c490ff")
    rc(M["cloak_in"], "#100e1c", "#05050c", "#2a2640", rim="#c490ff")
    rc(M["leather"], "#262234", "#0c0a14", "#443c5c", rim="#c490ff")
    rc(M["dark"], "#161422", "#08060e", "#2c2840", rim="#c490ff")
    rc(M["boot"], "#1c1826", "#0a0810", "#38304c", rim="#c490ff")
    rc(M["hair"], "#3a2850", "#150e22", "#6a4a8c")
    rc(M["wood"], "#2a2036", "#0e0a16", "#5a4478", rim="#c490ff")
    rc(M["string"], "#c890ff", "#7a50a8", "#f0dcff")
    rc(M["steel"], "#8a60c0", "#3a2060", "#e0b8ff")
    rc(M["fletch"], "#8a3cc0", "#3a1060", "#c070f0")
    set_glow(M["eye"], "#d060ff")
    # bone-white half mask over the face with glowing slit eyes
    A(ellipsoid("mask", (0.075, 0.23, 0.26), bone), "head", (0.082, 0, 0.115))
    A(ellipsoid("mask_brow", (0.08, 0.2, 0.05), M["dark"]), "head", (0.082, 0, 0.2))
    A(ellipsoid("mask_cheek", (0.075, 0.06, 0.1), M["dark"]), "head", (0.088, 0, 0.0))
    # taller, sharper hood + ragged shadow cape ends trailing like smoke
    scale("hood_point", 1.4, 1.0, 1.4)
    for k, (y, ln, dx) in enumerate(((-0.1, 0.5, -0.3), (0.0, 0.62, -0.42), (0.1, 0.46, -0.28))):
        A(L.tube("smoke%d" % k, [(0, y, 0), (dx * 0.4, y, -ln * 0.5), (dx, y, -ln)], [0.06, 0.05, 0.006],
                 M["cloak"], segs=6, depth=0.5), "cape1", (-0.02, 0, -0.45))
    scale("cape_hem", 0.32, 1.0, 1.6)
    # purple glow on the bow tips
    tx, tz_top, tz_bot = tips()
    for z in (tz_top, tz_bot):
        A(ellipsoid("bt_glow", (0.07, 0.07, 0.07), glowp), "bow", (tx, 0, z))
    return {"arrow_props": []}


VARIANTS = {
    "archer_fire": (v_fire, None),
    "archer_volley": (v_volley, (0.5, 0.75)),          # short bow: (half length, arc radius)
    "archer_crossbow": (v_crossbow, (0.5, 0.6)),
    "archer_shadow": (v_shadow, None),
}


# --------------------------------------------------------------------------


def render_variant(vid, spec, quick):
    setup, bow = spec
    common._MAT_CACHE.clear()
    B.STRINGS[:] = []
    base_half, base_r = B.BOW_HALF, B.BOW_R
    if bow:
        B.BOW_HALF, B.BOW_R = bow
    r, M, feet, arrow = B.build()
    ctx = setup(r, M, feet, arrow) or {}
    B.BOW_HALF, B.BOW_R = base_half, base_r
    arrow = ctx.get("arrow", arrow)
    sh = L.Sheet(vid, r)
    sh.prop(arrow, False)
    arrow_names = [arrow.name]
    for nm in ctx.get("arrow_props", []):
        sh.prop(bpy.data.objects[nm], False)
        arrow_names.append(nm)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and o.name not in B.STR_NAMES()]
    INF = {}

    def strings(i, n, frame, src):
        for ob in B.STRINGS:
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

    def shoot_pose(i, n):
        p, kw = B.shoot(i, n)
        INF[i] = p.pop("_inf", 0)
        return B.finish(p, 0, **kw)

    # same animation table as asset_archer.main()
    sh.render("idle", 8, B.idle, fps=8, loop=True, ground_objs=feet, extra_fn=plain)
    if not quick:
        sh.render("walk", 10, B.walk, fps=10, loop=True, ground_objs=feet, extra_fn=plain)
    sh.render("shoot", sum(WA), shoot_pose, fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {nm: 1 <= i < WA[0] for nm in arrow_names},
              extra_fn=lambda i, n, frame: strings(i, n, frame, INF))
    if not quick:
        sh.render("hurt", 3, B.hurt, fps=12, ground_objs=feet, extra_fn=plain)
        sh.render("death", 9, B.death, fps=10, grounds=[("hips", allm)], extra_fn=plain)
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
