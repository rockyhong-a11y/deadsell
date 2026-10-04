"""DEADSELL enemy variants of the jailer (docs/CONTENT2.md section 1):
jailer_warden, jailer_torch, jailer_spear, jailer_chain.

blender -b --factory-startup -P tools/blender/asset_jailer_variants.py [-- warden torch ...] [--quick]
-> build/frames/jailer_<v>/*.png + spec.json   (pack: python3 tools/pack/pack_all.py jailer_warden ...)

Every variant builds the BASE jailer rig through asset_jailer.build() (identical frame size, anchor,
joints and animation table to jailer.png: idle walk attack(5/3/4) block hurt death) and then
recolours / removes / adds parts.  The base script's own output is not touched (its render call is
suppressed while importing it).  --quick renders only idle + attack (for previews).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

_run = L.run
L.run = lambda f: None          # importing the base script must not render the base sheet
import asset_jailer as B  # noqa: E402
L.run = _run

WA = B.WA
ARM_N = ("root", "hips", "spine", "chest", "sh_n", "el_n", "ha_n")


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


def swap_slot(ob, old_name, new_mat):
    for s in ob.material_slots:
        if s.material is not None and s.material.name == old_name:
            s.material = new_mat


def ring(name, r, tube, mat, z=0.0, segs=6, n=14, squash=1.0):
    """Closed loop (torus-like) around the local Z axis."""
    pts = [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n) * squash, z) for k in range(n + 1)]
    return L.tube(name, pts, [tube] * len(pts), mat, segs=segs, cap=False)


def world_pose_angle(p, chain):
    return sum(p.get(k, 0.0) for k in chain)


def chain_links(r, M_mat, joint, count, s=1.0, spacing=0.09, first=0.065, tag=""):
    A = r.attach
    for k in range(count):
        sz = (0.055, 0.022, 0.1) if k % 2 == 0 else (0.022, 0.055, 0.1)
        A(ellipsoid("lk_%s%s_%d" % (tag, joint, k), tuple(v * s for v in sz), M_mat), joint,
          (0, 0, -(first + spacing * k) * s))


# --------------------------------------------------------------------------
# weapons


def make_mace(M, mat_head, mat_fl, mat_shaft, flanges=6, big=1.0):
    parts = [L.limb("mc_h", 0.5, 0.03, 0.03, mat_shaft)]
    parts[0].location = (0, 0, 0.44)
    parts.append(ellipsoid("mc_head", (0.2 * big, 0.2 * big, 0.26 * big), mat_head, loc=(0, 0, 0.56)))
    for k in range(flanges):
        a = k * 2 * math.pi / flanges + 0.3
        parts.append(box("mc_fl%d" % k, (0.05, 0.075 * big, 0.2 * big), mat_fl,
                         loc=(0.1 * big * math.cos(a), 0.1 * big * math.sin(a), 0.56)))
    parts.append(cone("mc_tip", 0.05, 0.0, 0.12, mat_head, loc=(0, 0, 0.67 * big)))
    parts.append(ellipsoid("mc_pommel", (0.06, 0.06, 0.05), mat_head, loc=(0, 0, -0.06)))
    return L.joined("macem2", parts)


def v_common_hair(M, base, shadow, light):
    rc(M["hair"], base, shadow, light)


# --------------------------------------------------------------------------
# variants.  Each takes (rig, materials, feet, smear, shield) and returns a context dict:
#   wrap(fn, kind) -> pose fn      shield -> shield object (for the death grounding)


def v_warden(r, M, feet, sm, shield):
    A = r.attach
    rc(M["plate"], "#3c3c4c", "#14141e", "#6c6c88")
    rc(M["iron"], "#4c4c60", "#181824", "#82829e")
    rc(M["rust"], "#c09a3c", "#5a3a1c", "#f6d878")
    rc(M["tabard"], "#5c1426", "#2a0614", "#8c2a40")
    rc(M["leather"], "#2e2630", "#120c18", "#52465a")
    rc(M["wood"], "#34283a", "#150e1c", "#58486a")
    rc(M["hair"], "#d4d4e4", "#7c7c9c", "#ffffff")
    set_glow(M["smear"], "#ffd890")
    brass = M["rust"]
    swap_slot(shield, "j_iron", brass)
    shield.scale = (1.0, 1.28, 1.3)
    # horned helm: ivory horns curving up and forward, no crest
    drop("helm_crest")
    ivory = L.mat("v_ivory", "#ece2c4", "#8c8068", "#fffbea")
    for y, rr, dy in ((-0.1, 0.06, -0.02), (0.1, 0.05, 0.02)):
        pts = [(-0.02, y, 0.2), (-0.07, y * 1.5 + dy, 0.31), (-0.05, y * 1.7 + dy, 0.45), (0.06, y * 1.7 + dy, 0.55)]
        A(L.tube("horn%+d" % int(y * 100), pts, [rr, rr * 0.8, rr * 0.55, 0.01], ivory, segs=7), "head")
    # heavy armour: huge spiked pauldrons, tassets, gorget plate
    for sd in ("n", "f"):
        scale("pauld_" + sd, 1.35, 1.3, 1.35)
        scale("pauld2_" + sd, 1.35, 1.3, 1.3)
        A(cone("pspike_" + sd, 0.06, 0.0, 0.17, M["iron"]), "sh_" + sd, (0.0, 0, 0.1), rot=(0, -18, 0))
        A(ellipsoid("tasset_" + sd, (0.21, 0.19, 0.3), M["plate"]), "th_" + sd, (0.02, 0, -0.17))
        A(ellipsoid("tasset_tr_" + sd, (0.2, 0.16, 0.05), brass), "th_" + sd, (0.02, 0, -0.01))
    scale("plate_bust", 1.2, 1.1, 1.2)
    A(ellipsoid("plate_back", (0.18, 0.3, 0.32), M["plate"]), "chest", (-0.13, 0, 0.0))
    # cape-like dark tabard hem trim (brass)
    scale("tab_trim", 1.0, 1.0, 1.4)
    # bigger spike on the shield boss
    sp = cone("sh_spike", 0.07, 0.0, 0.2, L.mat("v_spike", "#c09a3c", "#5a3a1c", "#f6d878", rim=False), rot=(0, 90, 0))
    sp.parent = shield
    sp.location = (0.08, 0, 0.0)
    # flanged mace
    drop("macem")
    mace = make_mace(M, M["iron"], brass, M["leather"], flanges=6, big=1.2)
    A(mace, "ha_n", (0.0, -0.02, -0.05), rot=(0, 100, 0))
    return {}


def v_torch(r, M, feet, sm, shield):
    A = r.attach
    rc(M["plate"], "#7e5a3a", "#38221c", "#b08658")
    rc(M["iron"], "#5c4636", "#2a1a16", "#86684c")
    rc(M["rust"], "#c8702c", "#5e2a1c", "#f09a50")
    rc(M["tabard"], "#4a4028", "#201a14", "#74683e")
    rc(M["leather"], "#3a2a22", "#1a100e", "#5c463a")
    rc(M["wood"], "#3c2e28", "#1a1210", "#5c4a40")
    rc(M["hair"], "#2c2228", "#100a14", "#4c3e4c")
    set_glow(M["smear"], "#ffc060")
    fl_o = L.glow("v_fl_out", "#ff6a14")
    fl_m = L.glow("v_fl_mid", "#ffa828")
    fl_i = L.glow("v_fl_in", "#fff0a0")
    drop("helm_crest", "brim")
    hide("cheek_guard")
    soot = L.mat("v_soot", "#2c1e1a", "#120a0a", "#4a3630")
    # soot-blackened scarf over the shoulders
    A(ellipsoid("scarf", (0.3, 0.38, 0.1), M["rust"]), "chest", (0.0, 0, 0.22))
    # torch (replaces the mace): wooden haft, oily rag head, living flame that stays upright
    drop("macem")
    parts = [L.limb("tc_h", 0.52, 0.028, 0.028, M["wood"])]
    parts[0].location = (0, 0, 0.44)
    parts.append(ellipsoid("tc_head", (0.15, 0.15, 0.22), soot, loc=(0, 0, 0.5)))
    for k in range(3):
        parts.append(ellipsoid("tc_band%d" % k, (0.17, 0.17, 0.035), M["rust"], loc=(0, 0, 0.42 + 0.075 * k)))
    A(L.joined("torchm", parts), "ha_n", (0.0, -0.02, -0.05), rot=(0, 100, 0))
    ha = r.world_rest["ha_n"]
    tip = (ha.x + 0.49, ha.y - 0.02, ha.z - 0.137)
    r.joint("fl", "ha_n", tip)
    A(L.tube("fl_out", [(0, 0, -0.02), (0, 0, 0.1), (0.04, 0, 0.26), (0.08, 0, 0.4)],
             [0.09, 0.115, 0.07, 0.006], fl_o, segs=8, depth=0.9), "fl")
    A(L.tube("fl_mid", [(0, 0, 0.0), (0, 0, 0.09), (0.02, 0, 0.2), (0.05, 0, 0.3)],
             [0.06, 0.08, 0.045, 0.005], fl_m, segs=8, depth=0.9), "fl")
    A(L.tube("fl_in", [(0.0, 0, 0.0), (0.0, 0, 0.07), (0.015, 0, 0.14)], [0.035, 0.045, 0.004], fl_i, segs=6,
             depth=0.9), "fl")
    A(L.tube("fl_side", [(-0.04, 0, 0.12), (-0.1, 0, 0.2), (-0.15, 0, 0.3)], [0.04, 0.035, 0.004], fl_o, segs=6,
             depth=0.8), "fl")
    A(ellipsoid("spark1", (0.035, 0.035, 0.035), fl_i), "fl", (0.18, 0, 0.46))
    A(ellipsoid("spark2", (0.025, 0.025, 0.025), fl_m), "fl", (-0.1, 0, 0.5))

    def wrap(fn, kind):
        def f(i, n):
            p = fn(i, n)
            acc = world_pose_angle(p, ARM_N)
            ph = i * 2.3
            p["fl"] = -acc + 7 * math.sin(ph)
            p["fl.sz"] = 1.0 + 0.2 * math.sin(ph * 1.3 + 1.0)
            p["fl.sx"] = 1.0 + 0.12 * math.sin(ph + 2.0)
            return p
        return f
    return {"wrap": wrap}


def v_spear(r, M, feet, sm, shield):
    A = r.attach
    rc(M["plate"], "#a0acc2", "#4a5470", "#e4eefc")
    rc(M["iron"], "#aab6cc", "#505a76", "#eef4ff")
    rc(M["rust"], "#d8b244", "#7c5c20", "#fff2a4")
    rc(M["tabard"], "#2a54ac", "#10226a", "#4c84dc")
    rc(M["leather"], "#383044", "#18121e", "#58486a")
    rc(M["wood"], "#8a6a44", "#442c20", "#b48c5c")
    rc(M["hair"], "#4e3024", "#22120e", "#7a5440")
    set_glow(M["smear"], "#d8ecff")
    gold = M["rust"]
    blue = M["tabard"]
    # helm: blue horsehair plume instead of the crest
    drop("helm_crest")
    A(L.tube("plume", [(0.0, 0, 0.0), (-0.05, 0, 0.1), (-0.2, 0, 0.12), (-0.34, 0, 0.0)],
             [0.045, 0.06, 0.055, 0.01], blue, segs=7, depth=1.3), "head", (-0.015, 0, 0.27))
    A(ellipsoid("plume_base", (0.1, 0.07, 0.07), gold), "head", (-0.015, 0, 0.27))
    # blue cape-sash
    A(L.tube("sash", [(-0.02, -0.15, 0.3), (0.06, -0.19, 0.1), (0.14, -0.15, -0.12)], [0.05, 0.055, 0.05], blue,
             segs=6, depth=0.5), "chest")
    # round shield (replaces the tower shield)
    drop("shieldm")
    parts = [L.disc("rs_rim", 0.43, 0.06, gold, rot=(0, 90, 0), segs=20),
             L.disc("rs_face", 0.37, 0.09, blue, loc=(0.005, 0, 0), rot=(0, 90, 0), segs=20),
             L.disc("rs_ring", 0.25, 0.1, gold, loc=(0.01, 0, 0), rot=(0, 90, 0), segs=20),
             L.disc("rs_in", 0.21, 0.11, blue, loc=(0.015, 0, 0), rot=(0, 90, 0), segs=20),
             ellipsoid("rs_boss", (0.11, 0.16, 0.16), gold, loc=(0.06, 0, 0))]
    new_shield = L.joined("shieldm", parts)
    A(new_shield, "shield", (0, 0, 0), rot=(0, 0, -52))
    # spear (replaces the mace): the spear joint keeps a world orientation, tip toward -Z
    drop("macem")
    r.joint("sp", "ha_n", tuple(r.world_rest["ha_n"]))
    sp = [L.limb("spr_s", 1.0, 0.024, 0.024, M["wood"])]
    sp[0].location = (0, 0, -0.25)
    head = cone("spr_head", 0.07, 0.0, 0.27, M["iron"], rot=(180, 0, 0), depth_scale=0.4)
    head.location = (0, 0, -0.74)
    sp.append(head)
    sp.append(box("spr_lug", (0.03, 0.17, 0.035), M["iron"], loc=(0, 0, -0.74)))
    sp.append(ellipsoid("spr_collar", (0.07, 0.07, 0.1), gold, loc=(0, 0, -0.7)))
    sp.append(ellipsoid("spr_butt", (0.05, 0.05, 0.08), gold, loc=(0, 0, 0.36)))
    pen = L.leaf("spr_pen", 0.26, 0.15, 0.015, blue, tip=0.3)
    pen.location = (0, 0, -0.64)
    pen.rotation_euler = (0, math.radians(90), 0)
    sp.append(pen)
    A(L.joined("spearm", sp), "sp", (0.0, -0.02, -0.02))

    def wrap(fn, kind):
        def f(i, n):
            p = fn(i, n)
            if kind == "attack":
                t = L.phase_t(i, *WA)
                a = L.keys_at([(0.0, {"a": 135}), (0.2, {"a": 128}), (0.45, {"a": 112}), (0.5, {"a": 98}),
                               (0.575, {"a": 86}), (0.65, {"a": 82}), (0.8, {"a": 100}), (1.0, {"a": 135})], t)["a"]
            elif kind == "block":
                a = 140
            elif kind == "hurt":
                a = 160 - 10 * (i / 2)
            elif kind == "death":
                a = L.keys_at([(0.0, {"a": 150}), (0.4, {"a": 130}), (0.7, {"a": 100}), (1.0, {"a": 92})],
                              i / (n - 1))["a"]
            elif kind == "walk":
                a = 140 + 5 * math.sin(2 * math.pi * i / n)
            else:
                a = 142 + 3 * math.sin(2 * math.pi * i / n)
            p["sp"] = -world_pose_angle(p, ARM_N) + a
            return p
        return f
    return {"wrap": wrap, "shield": new_shield}


def v_chain(r, M, feet, sm, shield):
    A = r.attach
    rc(M["plate"], "#8c92a0", "#3a3e52", "#c6ccda")
    rc(M["iron"], "#7a8092", "#33374a", "#bcc2d4")
    rc(M["rust"], "#5a5e72", "#25283a", "#8a8ea4")
    rc(M["tabard"], "#5e3484", "#2a1244", "#8c58b8")
    rc(M["leather"], "#2c2836", "#12101a", "#4c4460")
    rc(M["wood"], "#4a3a52", "#1e1624", "#6a5a74")
    rc(M["hair"], "#2a2630", "#100e16", "#4a4458")
    set_glow(M["smear"], "#e4e8ff")
    steel = L.mat("v_steel", "#aab0c4", "#444a62", "#f0f4ff")
    # mail coif instead of the kettle helm: drop crest and brim, keep the dome
    drop("helm_crest", "brim")
    scale("helm", 1.0, 1.0, 1.05)
    # chain bandolier across the chest + chain coil on the near forearm
    for k in range(8):
        f = k / 7
        x, z = -0.1 + 0.22 * f, 0.28 - 0.34 * f
        sz = (0.1, 0.045, 0.12) if k % 2 == 0 else (0.045, 0.1, 0.12)
        A(ellipsoid("band%d" % k, sz, steel), "chest", (x, -0.17 - 0.015 * math.sin(math.pi * f), z), rot=(0, 30, 0))
    for k, z in enumerate((-0.03, -0.085, -0.14)):
        A(ring("coil%d" % k, 0.075, 0.026, steel, z=0.0, n=14), "el_n", (0.0, 0, z))
    # chain draped from the belt
    for k in range(5):
        sz = (0.09, 0.04, 0.11) if k % 2 == 0 else (0.04, 0.09, 0.11)
        A(ellipsoid("belt_lk%d" % k, sz, steel), "skirt", (0.17, -0.2, -0.04 - 0.09 * k))
    # hook (replaces the mace): short haft with a big steel J-hook
    drop("macem")
    parts = [L.limb("hk_h", 0.34, 0.03, 0.03, M["leather"])]
    parts[0].location = (0, 0, 0.3)
    hook = [(0, 0, 0.3), (0.02, 0, 0.42), (0.1, 0, 0.5), (0.2, 0, 0.5), (0.27, 0, 0.42), (0.27, 0, 0.32)]
    parts.append(L.tube("hk_j", hook, [0.04, 0.036, 0.034, 0.03, 0.026, 0.02], steel, segs=6))
    parts.append(cone("hk_barb", 0.04, 0.0, 0.12, steel, loc=(0.27, 0, 0.3), rot=(180, 0, 0)))
    parts.append(ellipsoid("hk_eye", (0.09, 0.05, 0.09), steel, loc=(0, 0, -0.02)))
    A(L.joined("hookm", parts), "ha_n", (0.0, -0.02, -0.05), rot=(0, 100, 0))
    # loose chain with an iron weight swinging from the near hand
    ha = r.world_rest["ha_n"]
    r.joint("ch0", "ha_n", (ha.x + 0.02, ha.y - 0.04, ha.z - 0.04))
    r.joint("ch1", "ch0", (ha.x + 0.02, ha.y - 0.04, ha.z - 0.04 - 0.2))
    chain_links(r, steel, "ch0", 2, s=1.3, spacing=0.09)
    chain_links(r, steel, "ch1", 2, s=1.3, spacing=0.09)
    A(ellipsoid("wt", (0.2, 0.2, 0.22), steel), "ch1", (0, 0, -0.32))
    A(cone("wt_sp", 0.06, 0.0, 0.12, steel), "ch1", (0, 0, -0.4), rot=(180, 0, 0))

    def wrap(fn, kind):
        def f(i, n):
            p = fn(i, n)
            if kind == "attack":
                t = L.phase_t(i, *WA)
                e0 = L.keys_at([(0.0, {"a": 0}), (0.3, {"a": -25}), (0.45, {"a": -40}), (0.5, {"a": -20}),
                                (0.575, {"a": 50}), (0.65, {"a": 85}), (0.8, {"a": 40}), (1.0, {"a": 8})], t)["a"]
                e1 = e0 + (20 if 0.5 <= t <= 0.8 else -8 if t < 0.5 else 0)
            elif kind == "death":
                lie = L.ease(min(1.0, i / (n - 1) * 1.5))
                e0, e1 = 20 * lie, 40 * lie
            else:
                amp = 7 if kind != "hurt" else 16
                e0 = amp * math.sin(2 * math.pi * i / n + 0.6)
                e1 = e0 * 1.4 + 3
            L.hang(p, [("ch0", e0), ("ch1", e1)], ARM_N, 0)
            return p
        return f
    return {"wrap": wrap}


VARIANTS = {"jailer_warden": v_warden, "jailer_torch": v_torch, "jailer_spear": v_spear, "jailer_chain": v_chain}


# --------------------------------------------------------------------------


def render_variant(vid, setup, quick):
    common._MAT_CACHE.clear()
    r, M, feet, sm, shield = B.build()
    B.RIG = r
    ctx = setup(r, M, feet, sm, shield) or {}
    shield = ctx.get("shield", shield)
    wrap = ctx.get("wrap", lambda fn, kind: fn)
    sh = L.Sheet(vid, r)
    sh.prop(sm, False)
    allm = [o for o in r.joints["root"].children_recursive
            if o.type == "MESH" and o.name not in ("smear", "shieldm") and o.parent is not shield]
    # same animation table as asset_jailer.main()
    sh.render("idle", 8, wrap(B.idle, "idle"), fps=8, loop=True, ground_objs=feet)
    if not quick:
        sh.render("walk", 10, wrap(B.walk, "walk"), fps=9, loop=True, ground_objs=feet)
    sh.render("attack", sum(WA), wrap(B.attack, "attack"), fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {"smear": i == WA[0] + 1})
    if not quick:
        sh.render("block", 4, wrap(B.block, "block"), fps=12, ground_objs=feet)
        sh.render("hurt", 3, wrap(B.hurt, "hurt"), fps=12, ground_objs=feet)
        sh.render("death", 9, wrap(B.death, "death"), fps=10, grounds=[("hips", allm), ("shield", [shield])])
    sh.write_spec()


def main():
    args = common.script_args()
    quick = "--quick" in args
    want = [a for a in args if not a.startswith("--")]
    for vid, fn in VARIANTS.items():
        if want and vid.split("_", 1)[1] not in want and vid not in want:
            continue
        render_variant(vid, fn, quick)


L.run(main)
