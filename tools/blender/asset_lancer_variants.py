"""DEADSELL enemy variants of the lancer (docs/CONTENT2.md section 1):
lancer_halberd, lancer_paladin, lancer_duelist, lancer_dragoon.

blender -b --factory-startup -P tools/blender/asset_lancer_variants.py [-- halberd paladin ...] [--quick]
-> build/frames/lancer_<v>/*.png + spec.json   (pack: python3 tools/pack/pack_all.py lancer_halberd ...)

Every variant builds the BASE lancer rig through asset_lancer.build() (identical frame size, anchor, joints,
two-hand IK grip and animation table to lancer.png: idle walk charge_windup charge thrust(4/2/3) hurt death)
and then recolours / removes / adds parts and swaps the hand-held weapon prop ('lancem' on joint 'lance',
tip toward local -Z, grip at the origin).  The base script's own output is not touched (its render call is
suppressed while importing it).  --quick renders only idle + thrust (for previews).
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
import asset_lancer as B  # noqa: E402
L.run = _run

S = B.S
WA = B.WA
_orig_finish = B.finish


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


def remat(names, mat):
    for n in names.split():
        for ob in objs(n):
            ob.data.materials[0] = mat


def scale(name, sx, sy, sz):
    for ob in objs(name):
        ob.scale = (sx, sy, sz)


def skirt_band(name, r_top, r_bot, bulge, h, front, back, fz0, fz1, mat, n=18, out=0.004):
    """Band hugging an L.skirt() surface between hem fractions fz0..fz1 (same front/back rule)."""
    import bmesh

    def rad(fz):
        pts = [(0.0, r_top), (0.38, (r_top + r_bot) / 2 + bulge), (1.0, r_bot)]
        for (a, ra), (b, rb) in zip(pts, pts[1:]):
            if fz <= b:
                return ra + (rb - ra) * (fz - a) / (b - a)
        return r_bot

    bm = bmesh.new()
    rings = []
    for fz in (fz0, fz1):
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            ca = math.cos(a)
            ln = front if ca > 0 else back
            ln = 1.0 + (ln - 1.0) * abs(ca)
            r = rad(fz) + out
            ring.append(bm.verts.new((r * ca, r * math.sin(a), -h * fz * ln)))
        rings.append(ring)
    for k in range(n):
        bm.faces.new((rings[0][k], rings[0][(k + 1) % n], rings[1][(k + 1) % n], rings[1][k]))
    return L._mesh_ob(name, bm, mat, smooth=True)


def set_weapon(r, parts):
    """Replace the hand-held weapon (joint 'lance', object 'lancem')."""
    drop("lancem")
    ob = L.joined("lancem", parts)
    r.attach(ob, "lance")
    return ob


def shaft(name, z0, z1, rad, mat, segs=7):
    return L.tube(name, [(0, 0, z0), (0, 0, (z0 + z1) / 2), (0, 0, z1)], [rad, rad * 1.1, rad], mat, segs=segs)


def poly_plate(name, pts, thick, mat, y=0.0, sx=1.0):
    """Flat polygon in the (local) XZ plane extruded along Y; pts are (x, z) pairs, x multiplied by sx."""
    import bmesh
    bm = bmesh.new()
    fr = [bm.verts.new((px * sx, y - thick / 2, pz)) for px, pz in pts]
    bk = [bm.verts.new((px * sx, y + thick / 2, pz)) for px, pz in pts]
    bm.faces.new(fr)
    bm.faces.new(list(reversed(bk)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((fr[i], fr[j], bk[j], bk[i]))
    return L._mesh_ob(name, bm, mat, smooth=False)


def side_leaf(name, length, width, thick, mat, z, direction, tip=0.3, base=0.8):
    """Flat blade in the XZ plane growing from the shaft at height z toward local +X (1) or -X (-1)."""
    f = L.leaf(name, length, width, thick, mat, tip=tip, base=base)
    f.location = (0, 0, z)
    f.rotation_euler = (0, math.radians(-90 * direction), 0)
    return f


# --------------------------------------------------------------------------
# variants.  Each takes (rig, materials) and returns an optional hook(p, sway, flow) run after the base
# finish() (extra joints such as a cape).


def v_halberd(r, M):
    A = r.attach
    iron = L.mat("v_iron", "#7a8296", "#343a52", "#c4ccdc")
    brass = L.mat("v_brass", "#b09a4c", "#5a4a2a", "#ecd884")
    bladem = L.mat("v_blade", "#5a627c", "#262a40", "#8c96b4")
    edgem = L.mat("v_edge", "#eef4ff", "#8e9ab8", "#ffffff")
    rc(M["steel"], "#868ea6", "#3a405a", "#d2dae8")
    rc(M["dsteel"], "#464d66", "#1e2238", "#747e9c")
    rc(M["purple"], "#3a4160", "#181a32", "#5a6488")
    rc(M["purple2"], "#4a5274", "#202440", "#6e7aa0")
    rc(M["gold"], "#a48e48", "#54432a", "#e0ca7a")
    rc(M["leather"], "#4a3a30", "#22181c", "#6c5444")
    rc(M["wood"], "#5e4430", "#2a1c1a", "#8a6a48")
    rc(M["hair"], "#6a4a38", "#2c1c20", "#9a7458")
    # heavier plate: bigger spiked pauldrons, breast + faulds, no plume / no back shield, flat crest
    drop("plume_*", "crest_base", "shieldm", "pauld_t*")
    scale("pauld_*", 1.38, 1.3, 1.4)
    for sd in ("n", "f"):
        A(cone("pspike_" + sd, 0.05 * S, 0.0, 0.17 * S, iron, loc=(0, 0, 0.1 * S)), "sh_" + sd)
        A(ellipsoid("plame_" + sd, (0.26 * S, 0.25 * S, 0.07 * S), M["gold"]), "sh_" + sd, (0.0, 0, 0.1 * S))
        scale("elcop_" + sd, 1.3, 1.3, 1.3)
        scale("kncop_" + sd, 1.25, 1.25, 1.25)
    A(ellipsoid("breast", (0.31 * S, 0.35 * S, 0.34 * S), iron), "chest", (0.03 * S, 0, 0.05 * S))
    A(box("breast_rib", (0.05 * S, 0.3 * S, 0.04 * S), M["gold"], bevel=0.01), "chest", (0.17 * S, 0, 0.02 * S))
    A(ellipsoid("fauld", (0.31 * S, 0.37 * S, 0.1 * S), iron), "hips", (0.0, 0, 0.0))
    scale("helm", 1.14, 1.12, 1.12)
    A(ellipsoid("helm_ridge", (0.32 * S, 0.05 * S, 0.07 * S), iron), "head", (-0.02 * S, 0, 0.3 * S))
    A(box("visor_bar", (0.05 * S, 0.24 * S, 0.04 * S), M["dsteel"], bevel=0.008), "head", (0.115 * S, 0, 0.17 * S))
    A(box("nasal", (0.04 * S, 0.035 * S, 0.14 * S), iron, bevel=0.008), "head", (0.14 * S, 0, 0.08 * S))
    # halberd: haft (kept ~0.2 shorter than the base lance so the thrust frames stay inside the frame), crescent
    # bearded axe facing the way she faces (local -X), pick on the other side, spike on top
    top = -0.84
    dz = 0.18                     # blade profile below is drawn for a longer haft; shift it up by dz
    blade = [(0.1, -0.72), (0.3, -0.6), (0.4, -0.76), (0.45, -0.92), (0.4, -1.08), (0.3, -1.2), (0.1, -1.04),
             (0.07, -0.88)]
    edge = [(0.3, -0.6), (0.4, -0.76), (0.45, -0.92), (0.4, -1.08), (0.3, -1.2), (0.3, -1.1), (0.34, -0.98),
            (0.36, -0.9), (0.34, -0.8), (0.3, -0.7)]
    blade = [(x, z + dz) for x, z in blade]
    edge = [(x, z + dz) for x, z in edge]
    parts = [shaft("haft", 0.78, top - 0.1, 0.032, M["wood"]),
             L.tube("butt", [(0, 0, 0.78), (0, 0, 0.88)], [0.045, 0.012], iron, segs=7),
             cone("spike", 0.05, 0.0, 0.3, iron, loc=(0, 0, top - 0.08), rot=(180, 0, 0)),
             L.disc("collar", 0.065, 0.05, M["gold"], loc=(0, 0, top - 0.06)),
             L.disc("collar2", 0.06, 0.05, M["gold"], loc=(0, 0, -0.4)),
             poly_plate("axe", blade, 0.05, bladem, y=0.0, sx=-1),
             poly_plate("axe_edge", edge, 0.06, edgem, y=-0.012, sx=-1),
             L.disc("axe_bolt", 0.05, 0.07, M["gold"], loc=(0, 0, -0.9 + dz)),
             side_leaf("pick", 0.26, 0.1, 0.04, iron, -0.9 + dz, 1, tip=0.2, base=0.7),
             L.tube("tassel", [(0, 0, -0.4), (0.0, 0.02, -0.52), (0.0, 0.0, -0.64)], [0.03, 0.035, 0.01], M["purple"],
                    segs=5)]
    set_weapon(r, parts)
    return None


def v_paladin(r, M):
    A = r.attach
    holy = L.glow("v_holy", "#ffe36a")
    holy2 = L.glow("v_holy2", "#fff6c0")
    rc(M["steel"], "#ece8f4", "#938fb8", "#ffffff")
    rc(M["dsteel"], "#b8b2d0", "#6c6890", "#eceaf8")
    rc(M["purple"], "#f2ead4", "#aa9c86", "#ffffff")
    rc(M["purple2"], "#fff8e6", "#c6b698", "#ffffff")
    rc(M["gold"], "#ffc92e", "#a86a14", "#fff4a0")
    rc(M["leather"], "#9a7444", "#4c3022", "#c8a06a")
    rc(M["wood"], "#f0e6c8", "#9a8a70", "#ffffff")
    rc(M["hair"], "#ffe8a0", "#b89a50", "#fffce0")
    set_glow(M["eye"], "#ffe070")
    set_glow(M["streak"], "#fff0b0")
    # shield moves from the back to the front: big kite shield with a glowing cross
    drop("shieldm")
    sfield = L.mat("v_sfield", "#d8962a", "#7a4410", "#ffd270")
    sbord = L.mat("v_sbord", "#fff4d0", "#a8905c", "#ffffff")
    sh_ = [B.kite("sp_border", 1.0, 1.04, 0.06, sbord, y=0.0),
           B.kite("sp_field", 0.8, 0.84, 0.06, sfield, y=-0.016, z=0.0),
           box("sp_c1", (0.07, 0.05, 0.58), holy2, loc=(0, -0.05, -0.04)),
           box("sp_c2", (0.3, 0.05, 0.07), holy2, loc=(0, -0.05, 0.1)),
           ellipsoid("sp_boss", (0.1, 0.07, 0.1), holy, loc=(0, -0.055, 0.1))]
    shield = L.joined("shield_front", sh_)
    A(shield, "chest", (0.24 * S, -0.12 * S, -0.1 * S), rot=(0, -6, 0))
    # halo + gold glow on the tabard
    A(L.tube("halo", L.arc_pts((0, 0.07 * S, 0.34 * S), 0.25 * S, 0, 360, 22), 0.028 * S, holy, segs=6, depth=0.7), "head")
    A(ellipsoid("halo_in", (0.46 * S, 0.02, 0.46 * S), holy2), "head", (0.0, 0.1 * S, 0.34 * S))
    remat("tab_gem", holy)
    A(ellipsoid("bust_glow", (0.06 * S, 0.1 * S, 0.1 * S), holy), "chest", (0.15 * S, 0, 0.1 * S))
    # lance: same shape as the base, white-gold with a glowing head ring
    return None


def v_duelist(r, M):
    A = r.attach
    jerkin = L.mat("v_jerkin", "#7e4a2c", "#3a2018", "#aa7648")
    shirt = L.mat("v_shirt", "#f4efe4", "#a89aa0", "#ffffff")
    sash = L.mat("v_sash", "#b02a44", "#58122a", "#e46682")
    pants = L.mat("v_pants", "#2e2a3c", "#12101e", "#4e4868")
    boots = L.mat("v_boots", "#4c3224", "#22140f", "#74503a")
    glove = L.mat("v_glove", "#d8c8a6", "#7a6858", "#fff2d6")
    brass = L.mat("v_brass", "#d6aa44", "#6a4a24", "#fff0a0")
    blade = L.mat("v_blade", "#e4ecf8", "#6a7498", "#ffffff")
    feather = L.mat("v_feather", "#fffaf0", "#b0a0a8", "#ffffff")
    felt = L.mat("v_felt", "#4a2c3c", "#20101e", "#74485e")
    rc(M["purple"], "#b02a44", "#58122a", "#e46682")
    rc(M["purple2"], "#c8405c", "#6a1a34", "#f08098")
    rc(M["gold"], "#d6aa44", "#6a4a24", "#fff0a0")
    rc(M["leather"], "#5a3a28", "#281812", "#80563c")
    rc(M["hair"], "#b04a2c", "#521a1c", "#e88a54")
    rc(M["dsteel"], "#4a3a34", "#201614", "#6e5a50")
    # light leather outfit instead of plate
    drop("helm*", "cheek*", "crest_base", "plume_*", "shieldm", "pauld_*", "gorget", "elcop_*", "kncop_*",
         "bust_trim", "belt", "buckle")
    remat("chestm bust", jerkin)
    remat("waist", sash)
    remat("ua_n ua_f", shirt)
    remat("fa_n fa_f", M["leather"])
    remat("gauntlet_n gauntlet_f hand_n hand_f", glove)
    remat("pelvis thm_n thm_f", pants)
    remat("shin_n shin_f foot_n foot_f", boots)
    A(box("belt2", (0.2 * S, 0.27 * S, 0.06 * S), M["leather"], bevel=0.01), "hips", (0.0, 0, 0.1 * S))
    A(box("buckle2", (0.04 * S, 0.07 * S, 0.06 * S), brass, bevel=0.01), "hips", (0.11 * S, 0, 0.1 * S))
    A(ellipsoid("collar", (0.2 * S, 0.26 * S, 0.1 * S), shirt), "chest", (0.0, 0, 0.2 * S))
    for sd in ("n", "f"):
        A(ellipsoid("cuff_" + sd, (0.1 * S, 0.1 * S, 0.07 * S), shirt), "el_" + sd, (0, 0, -0.02 * S))
        A(ellipsoid("bcuff_" + sd, (0.12 * S, 0.12 * S, 0.1 * S), boots), "kn_" + sd, (0.015 * S, 0, 0.02 * S))
    A(L.tube("x_strap", [(-0.12, -0.15, 0.2), (0.0, -0.165, 0.06), (0.14, -0.14, -0.12)], 0.025 * S, brass, segs=6),
      "chest")
    # wide feathered hat, hair spilling out beneath
    A(ellipsoid("hair_back", (0.27 * S, 0.26 * S, 0.22 * S), M["hair"]), "head", (-0.05 * S, 0, 0.12 * S))
    A(ellipsoid("hair_bang", (0.1 * S, 0.22 * S, 0.06 * S), M["hair"]), "head", (0.07 * S, 0, 0.19 * S))
    A(ellipsoid("hat_crown", (0.26 * S, 0.25 * S, 0.17 * S), felt), "head", (-0.03 * S, 0, 0.28 * S))
    A(ellipsoid("hat_brim", (0.52 * S, 0.42 * S, 0.05 * S), felt), "head", (0.0, 0, 0.215 * S), rot=(0, -5, 0))
    A(ellipsoid("hat_band", (0.275 * S, 0.265 * S, 0.05 * S), sash), "head", (-0.03 * S, 0, 0.235 * S))
    A(L.tube("hat_f1", [(0.04 * S, 0, 0.03 * S), (-0.1 * S, 0, 0.17 * S), (-0.3 * S, 0, 0.21 * S), (-0.5 * S, 0, 0.13 * S)],
             [0.03 * S, 0.055 * S, 0.045 * S, 0.004], feather, segs=6, depth=0.5), "plume")
    A(L.tube("hat_f2", [(0.03 * S, 0, 0.02 * S), (-0.08 * S, 0, 0.11 * S), (-0.24 * S, 0, 0.12 * S), (-0.38 * S, 0, 0.04 * S)],
             [0.025 * S, 0.04 * S, 0.03 * S, 0.004], sash, segs=6, depth=0.5), "plume")
    # cape from the shoulders (new joint 'cape' swings like cloth)
    r.joint("cape", "chest", (-0.2 * S, 0, 1.42 * S))
    cape = L.leaf("cape_m", 0.86 * S, 0.36 * S, 0.035, sash, tip=0.85, base=0.1, curve=0.0)
    A(cape, "cape", (0.0, 0.04 * S, 0.0))
    A(L.leaf("cape_in", 0.5 * S, 0.3 * S, 0.037, M["purple2"], tip=0.85, base=0.1), "cape", (0.0, 0.035 * S, 0.0))
    # rapier: thin blade, brass cup guard
    parts = [L.tube("grip", [(0, 0, 0.16), (0, 0, 0.0)], [0.03, 0.028], M["leather"], segs=6),
             ellipsoid("pommel", (0.08, 0.08, 0.08), brass, loc=(0, 0, 0.18)),
             ellipsoid("cup", (0.2, 0.2, 0.11), brass, loc=(0, 0, -0.035)),
             L.tube("quil", [(-0.15, 0, -0.07), (0.15, 0, -0.07)], 0.014, brass, segs=5),
             L.tube("blade", [(0, 0, -0.08), (0, 0, -0.7), (0, 0, -1.28)], [0.02, 0.016, 0.004], blade, segs=5)]
    set_weapon(r, parts)

    def hook(p, sway, flow):
        torso = p.get("hips", 0) + p.get("spine", 0) + p.get("chest", 0)
        ang = -8 - 52 * flow + 0.7 * sway
        lay = max(0.0, min(1.0, (-p.get("hips", 0) - 30) / 50.0))      # prone (death): cape lies back along her
        L.hang(p, [("cape", ang * (1 - lay) + (-82) * lay)], L.CHEST_CHAIN, 0)
        if lay > 0:
            p["cape"] = -82 - torso * 0 - torso
    return hook


def v_dragoon(r, M):
    A = r.attach
    scl = L.mat("v_scale", "#3a62a8", "#18285a", "#7aa4e0")
    teal = L.mat("v_teal", "#3ccfc0", "#18666e", "#a8fff2")
    wing = L.mat("v_dwing", "#1c2c62", "#0a1030", "#3a56a0")
    silver = L.mat("v_silver", "#e4ecfa", "#8a96b8", "#ffffff")
    rc(M["steel"], "#2c4a88", "#121c46", "#5a84c8")
    rc(M["dsteel"], "#18264a", "#080e22", "#34508a")
    rc(M["purple"], "#1e2e64", "#0a1032", "#3a54a0")
    rc(M["purple2"], "#2e438c", "#101c4c", "#5a78c8")
    rc(M["gold"], "#3ccfc0", "#18666e", "#a8fff2")
    rc(M["leather"], "#262e48", "#0e1220", "#46547a")
    rc(M["wood"], "#2a3050", "#0e1220", "#4a5a88")
    rc(M["hair"], "#e0562c", "#8a2414", "#ff9a5a")
    set_glow(M["eye"], "#ffb030")
    drop("plume_*", "crest_base", "shieldm")
    # scale armour: overlapping teal-blue scale rows on pauldrons, chest and tassets
    for sd in ("n", "f"):
        scale("pauld_t" + sd, 1.0, 1.0, 1.0)
        for k in range(3):
            A(ellipsoid("scp%s%d" % (sd, k), ((0.2 - 0.025 * k) * S, (0.2 - 0.02 * k) * S, 0.07 * S), scl if k % 2 == 0 else teal),
              "sh_" + sd, (0.0, 0, (0.0 - 0.07 * k) * S))
    for k, z in enumerate((0.13, 0.04, -0.05, -0.14)):
        A(ellipsoid("scc%d" % k, (0.27 * S, 0.31 * S, 0.075 * S), scl if k % 2 == 0 else teal), "chest", (0.01 * S, 0, z * S))
    for k, (a, b) in enumerate(((0.28, 0.4), (0.55, 0.67), (0.82, 0.94))):
        A(skirt_band("sk_scale%d" % k, 0.16 * S, 0.29 * S, 0.035 * S, 0.32 * S, 0.88, 1.12, a, b, teal), "skirt")
    # winged helm: two silver wings sweeping back/up + a dragon-fin crest
    for k, (phi, ln) in enumerate(((100, 0.58), (124, 0.5))):
        A(_wing_leaf("hw_n%d" % k, ln * S, silver if k == 0 else teal, phi, -0.14 * S), "head")
        A(_wing_leaf("hw_f%d" % k, ln * S, silver if k == 0 else teal, phi, 0.14 * S), "head")
    A(ellipsoid("fin", (0.3 * S, 0.04 * S, 0.1 * S), teal), "head", (-0.04 * S, 0, 0.3 * S))
    # dragon wings on the back: bone + fanned membrane fingers
    A(L.tube("dw_bone", [(-0.12 * S, 0.1 * S, 0.12 * S), (-0.3 * S, 0.1 * S, 0.3 * S), (-0.46 * S, 0.1 * S, 0.5 * S)],
             [0.04 * S, 0.034 * S, 0.012], teal, segs=6), "chest")
    for k, (phi, ln) in enumerate(((70, 0.5), (92, 0.62), (112, 0.66), (132, 0.56))):
        f = L.leaf("dw_f%d" % k, ln * S, 0.13 * S, 0.025, wing if k % 2 == 0 else scl, tip=0.65, base=0.25)
        f.location = (-0.14 * S, (0.095 + 0.004 * k) * S, 0.12 * S + 0.03 * S * k)
        f.rotation_euler = (0, math.radians(phi), 0)
        A(L.bake(f), "chest")
    # dragon tail with a spade tip
    A(L.tube("tail_m", [(-0.12 * S, 0, -0.04 * S), (-0.3 * S, 0, -0.14 * S), (-0.5 * S, 0, -0.2 * S), (-0.7 * S, 0, -0.14 * S)],
             [0.075 * S, 0.06 * S, 0.04 * S, 0.012 * S], scl, segs=7), "skirt")
    A(L.bake(cone("tail_tip", 0.06 * S, 0.0, 0.18 * S, teal, loc=(-0.7 * S, 0, -0.14 * S), rot=(0, -62, 0))), "skirt")
    # short spear: stout shaft, broad leaf head with barbs, teal tassel
    top = -0.62
    parts = [shaft("sshaft", 0.5, top, 0.034, M["wood"]),
             L.tube("sbutt", [(0, 0, 0.5), (0, 0, 0.58)], [0.045, 0.012], M["dsteel"], segs=7),
             L.leaf("shead", 0.5, 0.17, 0.04, M["steel"], tip=0.5, base=0.3),
             L.leaf("sheadc", 0.4, 0.07, 0.05, silver, tip=0.5, base=0.3),
             L.disc("sring", 0.055, 0.04, teal, loc=(0, 0, top + 0.02)),
             side_leaf("barb1", 0.12, 0.08, 0.03, teal, top + 0.02, 1, tip=0.5, base=0.4),
             side_leaf("barb2", 0.12, 0.08, 0.03, teal, top + 0.02, -1, tip=0.5, base=0.4),
             L.leaf("tass", 0.26, 0.1, 0.02, teal, tip=0.6, base=0.2)]
    parts[2].location = (0, 0, top + 0.03)
    parts[3].location = (0, -0.03, top + 0.03)
    parts[-1].location = (0, 0.01, top + 0.01)
    parts[-1].rotation_euler = (0, math.radians(160), 0)
    set_weapon(r, parts)
    return None


def _wing_leaf(name, length, mat, phi, y):
    f = L.leaf(name, length, 0.13 * S, 0.025, mat, tip=0.55, base=0.3)
    f.location = (-0.05 * S, y, 0.22 * S)
    f.rotation_euler = (0, math.radians(phi), 0)
    return L.bake(f)


VARIANTS = {
    "lancer_halberd": v_halberd,
    "lancer_paladin": v_paladin,
    "lancer_duelist": v_duelist,
    "lancer_dragoon": v_dragoon,
}


# --------------------------------------------------------------------------


def render_variant(vid, setup, quick):
    common._MAT_CACHE.clear()
    B.STREAKS[0][:] = []
    B.STREAKS[1][:] = []
    B.finish = _orig_finish
    r, M, feet = B.build()
    hook = setup(r, M)
    if hook:
        B.finish = lambda p, sway=0.0, flow=0.0: (lambda q: (hook(q, sway, flow), q)[1])(_orig_finish(p, sway, flow))
    sh = L.Sheet(vid, r)
    for gi in (0, 1):
        sh.prop(B.STREAKS[gi][0], False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and not o.name.startswith("streaks")]
    # same animation table as asset_lancer.main()
    sh.render("idle", 8, B.idle, fps=8, loop=True, ground_objs=feet)
    if not quick:
        sh.render("walk", 10, B.walk, fps=10, loop=True, ground_objs=feet)
        sh.render("charge_windup", 6, B.charge_windup, fps=10, ground_objs=feet)
        sh.render("charge", 6, B.charge, fps=14, loop=True, ground_objs=feet,
                  vis_fn=lambda i, n: {"streaks0": i % 2 == 0, "streaks1": i % 2 == 1})
    sh.render("thrust", sum(WA), B.thrust, fps=14, wa=WA, ground_objs=feet)
    if not quick:
        sh.render("hurt", 3, B.hurt, fps=12, ground_objs=feet)
        sh.render("death", 9, B.death, fps=10, grounds=[("hips", allm)])
    sh.write_spec()
    B.finish = _orig_finish


def main():
    args = common.script_args()
    quick = "--quick" in args
    want = [a for a in args if not a.startswith("--")]
    for vid, fn in VARIANTS.items():
        if want and vid.split("_", 1)[1] not in want and vid not in want:
            continue
        render_variant(vid, fn, quick)


L.run(main)
