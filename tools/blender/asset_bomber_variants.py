"""DEADSELL enemy variants of the bomber (docs/CONTENT2.md section 1):
bomber_frost, bomber_cluster, bomber_kamikaze, bomber_alchemist.

blender -b --factory-startup -P tools/blender/asset_bomber_variants.py [-- frost cluster ...] [--quick]
-> build/frames/bomber_<v>/*.png + spec.json   (pack: python3 tools/pack/pack_all.py bomber_frost ...)

Every variant builds the BASE bomber rig through asset_bomber.build() (identical frame size, anchor,
joints and animation table to bomber.png: idle walk throw(5/2/4) hurt death) and then recolours /
removes / adds parts and swaps the hand-held bomb prop.  The base script's own output is not touched
(its render call is suppressed while importing it).  --quick renders only idle + throw (for previews).
"""
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, limb, box, cone  # noqa: E402

_run = L.run
L.run = lambda f: None          # importing the base script must not render the base sheet
import asset_bomber as B  # noqa: E402
L.run = _run

S = B.S
WA = B.WA
U = S * 1.35                    # unit of the held bomb prop (same as asset_bomber)


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
    """Delete objects by exact name (and their .001 duplicates); 'foo*' deletes by prefix."""
    for n in names:
        for ob in objs(n):
            bpy.data.objects.remove(ob, do_unlink=True)


def remat(name, mat):
    for ob in objs(name):
        ob.data.materials[0] = mat


def scale(name, sx, sy, sz):
    for ob in objs(name):
        ob.scale = (sx, sy, sz)


def skirt_band(name, r_top, r_bot, bulge, h, front, back, fz0, fz1, mat, n=16, out=0.004):
    """Band hugging an L.skirt() surface between hem fractions fz0..fz1 (same front/back rule)."""
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


def spikes_ring(name, n, radius, length, base_r, mat, phase=0.0):
    """Cones radiating in the XZ plane around the origin (ice crystals / studs)."""
    out = []
    for k in range(n):
        th = phase + 360.0 * k / n
        a = math.radians(th)
        out.append(cone("%s%d" % (name, k), base_r, 0.0, length, mat,
                        loc=(radius * math.cos(a), 0, radius * math.sin(a)), rot=(0, 90 - th, 0)))
    return out


def set_hand(r, parts):
    """Replace the hand-held bomb prop (joint 'bomb', object name 'bombm')."""
    drop("bombm")
    ob = L.joined("bombm", parts)
    r.attach(ob, "bomb", (0.03 * S, -0.01 * S, -0.04 * S))
    return ob


def hem_puffs(r, mat, h, front, back, rad, n, size, z0=0.0, name="puff"):
    """Fluffy blobs along a skirt hem (z follows the skirt's front/back length rule)."""
    for k in range(n):
        a = 2 * math.pi * (k + 0.5) / n
        ca = math.cos(a)
        ln = front if ca > 0 else back
        ln = 1.0 + (ln - 1.0) * abs(ca)
        r.attach(ellipsoid("%s%d" % (name, k), (size, size * 1.05, size * 0.8), mat), "skirt",
                 (rad * ca, rad * math.sin(a), z0 - h * ln))


# --------------------------------------------------------------------------
# variants.  Each takes (rig, materials) and returns the new hand-held prop 'bombm' and the throw
# smear colour.


def v_frost(r, M):
    A = r.attach
    fur = L.mat("v_fur", "#f0f6ff", "#92a8d0", "#ffffff")
    ice = L.mat("v_ice", "#b4e2ff", "#4c7ec0", "#f0fcff")
    icecore = L.glow("v_icecore", "#46d4ff")
    icehl = L.glow("v_icehl", "#e6fdff")
    rc(M["skin"], "#f6dcd0", "#a07088", "#fff0ea")
    rc(M["dress"], "#4a7cc0", "#203c78", "#8cc4f2")
    rc(M["apron"], "#e4eeff", "#8aa0c8", "#ffffff")
    rc(M["stain"], "#a8c8ee", "#5a74a0", "#d8ecff")
    rc(M["leather"], "#3c4868", "#1a2036", "#667496")
    rc(M["dark"], "#26324e", "#10162a", "#44547a")
    rc(M["hair"], "#9cd0ff", "#4676c0", "#e4f4ff")
    # frost bombs on the bandolier: glowing cyan cores with ice-white caps
    for k in range(3):
        remat("band_bomb%d" % k, icecore)
        remat("band_cap%d" % k, fur)
    # drop the wild spikes / goggles, wear a big fur ushanka with ear flaps and a pom
    drop("spike*", "hair_cap", "bangs", "gog_*")
    A(ellipsoid("hat", (0.31 * S, 0.31 * S, 0.19 * S), fur), "head", (-0.02 * S, 0, 0.26 * S))
    A(ellipsoid("hat_brim", (0.34 * S, 0.345 * S, 0.1 * S), fur), "head", (-0.02 * S, 0, 0.205 * S))
    A(ellipsoid("hat_pom", (0.1 * S, 0.1 * S, 0.1 * S), fur), "head", (-0.05 * S, 0, 0.39 * S))
    for y in (-0.15, 0.15):
        A(ellipsoid("flap", (0.1 * S, 0.075 * S, 0.17 * S), fur), "head", (-0.04 * S, y * S, 0.06 * S))
    A(ellipsoid("hat_gem", (0.05 * S, 0.06 * S, 0.06 * S), icecore), "head", (0.145 * S, 0, 0.255 * S))
    # fur collar + cuffs + hem
    A(ellipsoid("collar", (0.3 * S, 0.37 * S, 0.14 * S), fur), "chest", (0.0, 0, 0.2 * S))
    A(ellipsoid("collar_f", (0.14 * S, 0.3 * S, 0.1 * S), fur), "chest", (0.1 * S, 0, 0.14 * S))
    for sd in ("n", "f"):
        A(ellipsoid("cuff_" + sd, (0.14 * S, 0.14 * S, 0.1 * S), fur), "sh_" + sd, (0, 0, -0.07 * S))
    hem_puffs(r, fur, 0.27 * S, 0.9, 1.1, 0.255 * S, 14, 0.1 * S, z0=0.01 * S, name="hem")
    # frost bomb in hand: glowing core, ice-crystal studs
    parts = [ellipsoid("bomb_m", (0.19 * U, 0.19 * U, 0.19 * U), icecore),
             ellipsoid("bomb_hl", (0.06 * U, 0.05 * U, 0.06 * U), icehl, loc=(0.03 * U, -0.075 * U, 0.04 * U))]
    parts += spikes_ring("bsp", 8, 0.085 * U, 0.075 * U, 0.032 * U, ice, phase=22.5)
    parts.append(cone("bsp_top", 0.036 * U, 0.0, 0.11 * U, ice, loc=(0, 0, 0.08 * U)))
    return set_hand(r, parts), "#c8f4ff"


def v_cluster(r, M):
    A = r.attach
    yel = L.mat("v_yel", "#f0bc1c", "#8a5a14", "#fff27a")
    blk = L.mat("v_blk", "#2a2832", "#100e18", "#4c4858")
    burlap = L.mat("v_burlap", "#b89c62", "#5e4a36", "#e4cc8c")
    rc(M["dress"], "#ecb81c", "#8a5a14", "#fff27a")
    rc(M["apron"], "#2c2a34", "#121018", "#4c4858")
    rc(M["stain"], "#ecb81c", "#8a5a14", "#fff27a")
    rc(M["dark"], "#3c3a48", "#181624", "#5c586c")
    rc(M["leather"], "#4a3a30", "#22181c", "#6e5646")
    rc(M["hair"], "#262a3c", "#0e101c", "#464e68")
    rc(M["bomb"], "#2c2a36", "#100e18", "#4c4860")
    rc(M["cap"], "#f0bc1c", "#8a5a14", "#fff27a")
    # black hazard bands on the skirt
    for k, (a, b) in enumerate(((0.42, 0.56), (0.74, 0.88))):
        A(skirt_band("haz%d" % k, 0.15 * S, 0.26 * S, 0.03 * S, 0.27 * S, 0.9, 1.1, a, b, blk, n=18), "skirt")
    # no goggles / spikes: yellow hard hat with a black ridge and a lamp, hair tufts at the back
    drop("spike*", "hair_cap", "bangs", "gog_*", "satchel*")
    A(ellipsoid("hh", (0.3 * S, 0.29 * S, 0.2 * S), yel), "head", (-0.02 * S, 0, 0.255 * S))
    A(ellipsoid("hh_brim", (0.37 * S, 0.31 * S, 0.04 * S), yel), "head", (0.025 * S, 0, 0.2 * S))
    A(ellipsoid("hh_ridge", (0.3 * S, 0.075 * S, 0.215 * S), blk), "head", (-0.02 * S, 0, 0.258 * S))
    A(ellipsoid("hh_lamp", (0.06 * S, 0.09 * S, 0.07 * S), M["spark"]), "head", (0.14 * S, 0, 0.27 * S))
    A(ellipsoid("short_hair", (0.26 * S, 0.25 * S, 0.14 * S), M["hair"]), "head", (-0.07 * S, 0, 0.1 * S))
    # big bomb sack on the back with bomblets poking out
    A(ellipsoid("sack", (0.3 * S, 0.34 * S, 0.4 * S), burlap), "chest", (-0.3 * S, 0.0, -0.02 * S))
    A(ellipsoid("sack_tie", (0.17 * S, 0.2 * S, 0.06 * S), M["leather"]), "chest", (-0.3 * S, 0, 0.17 * S))
    A(ellipsoid("sack_patch", (0.05 * S, 0.17 * S, 0.14 * S), yel), "chest", (-0.145 * S, 0, -0.06 * S))
    for k, (dx, dy, dz) in enumerate(((-0.0, -0.06, 0.0), (0.06, 0.05, 0.02), (-0.06, 0.03, -0.01))):
        A(ellipsoid("blt%d" % k, (0.13 * S, 0.13 * S, 0.13 * S), M["bomb"]), "chest",
          ((-0.3 + dx) * S, dy * S, (0.26 + dz) * S))
        A(ellipsoid("bltc%d" % k, (0.06 * S, 0.06 * S, 0.04 * S), yel), "chest",
          ((-0.3 + dx) * S, dy * S, (0.33 + dz) * S))
    A(ellipsoid("blt_spark", (0.07 * S, 0.07 * S, 0.07 * S), M["spark"]), "chest", (-0.33 * S, 0.02 * S, 0.4 * S))
    # cluster bomb in hand: yellow shell, black belt, three bomblets stuck on
    parts = [ellipsoid("bomb_m", (0.2 * U, 0.2 * U, 0.2 * U), yel),
             L.tube("belt", L.arc_pts((0, 0, 0), 0.1 * U, 0, 360, 14, plane="xy"), 0.024 * U, blk, segs=6),
             ellipsoid("bomb_hl", (0.05 * U, 0.05 * U, 0.04 * U), M["lens"], loc=(0.04 * U, -0.07 * U, 0.05 * U))]
    for k, (x, y, z) in enumerate(((0.1, -0.015, 0.045), (-0.09, -0.03, 0.06), (0.025, -0.1, -0.06))):
        parts.append(ellipsoid("bl%d" % k, (0.085 * U, 0.085 * U, 0.085 * U), blk, loc=(x * U, y * U, z * U)))
        parts.append(ellipsoid("blc%d" % k, (0.04 * U, 0.04 * U, 0.03 * U), M["cap"],
                               loc=(x * U, y * U, (z + 0.045) * U)))
    cap = L.limb("bomb_cap", 0.03 * U, 0.035 * U, 0.035 * U, blk)
    cap.location = (0, 0, 0.1 * U)
    parts += [cap,
              L.tube("fuse", [(0, 0, 0.1 * U), (0.025 * U, 0, 0.145 * U), (0.0, 0, 0.18 * U)], 0.012 * U, M["leather"]),
              ellipsoid("spark", (0.08 * U, 0.08 * U, 0.08 * U), M["spark"], loc=(0, 0, 0.19 * U)),
              ellipsoid("spark2", (0.12 * U, 0.04 * U, 0.035 * U), M["spark2"], loc=(0, 0, 0.19 * U), rot=(0, 45, 0)),
              ellipsoid("spark3", (0.12 * U, 0.04 * U, 0.035 * U), M["spark2"], loc=(0, 0, 0.19 * U), rot=(0, -45, 0))]
    return set_hand(r, parts), "#fff0a0"


def v_kamikaze(r, M):
    A = r.attach
    red = L.mat("v_red", "#d0382a", "#701618", "#ff7a5a")
    band = L.mat("v_band", "#ecdfc2", "#8a7a70", "#fff8e6")
    rc(M["dress"], "#982e24", "#40121a", "#d4603e")
    rc(M["dark"], "#3a1c28", "#180c14", "#5c3446")
    rc(M["leather"], "#4a2c26", "#201014", "#74483a")
    rc(M["hair"], "#2a2230", "#0e0a14", "#4e4260")
    rc(M["bomb"], "#2c2a36", "#100e18", "#4c4860")
    rc(M["cap"], "#d0282a", "#6a0e1c", "#ff6a58")
    set_glow(M["eye"], "#ffd030")
    # no satchel / apron / bandolier / goggles / sleeves: bare arms with bandages, ragged skirt
    drop("satchel*", "apron*", "band_*", "strap", "gog_*", "sleeve_*", "skirt_m")
    for sd in ("n", "f"):
        remat("ua_" + sd, M["skin"])
        A(ellipsoid("wrap_" + sd, (0.1 * S, 0.1 * S, 0.1 * S), band), "el_" + sd, (0, 0, -0.07 * S))
        A(ellipsoid("wrap2_" + sd, (0.09 * S, 0.09 * S, 0.08 * S), band), "el_" + sd, (0, 0, -0.16 * S))
    A(L.skirt("skirt_m", 0.15 * S, 0.27 * S, 0.27 * S, M["dress"], n=14, bulge=0.03 * S, front=0.9, back=1.1,
              jag=0.085 * S, seed=21), "skirt")
    # crazed: red headband with flying tails, wide glowing eyes
    A(ellipsoid("headband", (0.275 * S, 0.27 * S, 0.06 * S), red), "head", (-0.02 * S, 0, 0.21 * S))
    A(ellipsoid("hb_knot", (0.07 * S, 0.07 * S, 0.07 * S), red), "head", (-0.15 * S, 0.0, 0.21 * S))
    for k, (yy, ln) in enumerate(((-0.04, 0.34), (0.05, 0.26))):
        A(L.tube("hb_tail%d" % k, [(0, yy * S, 0), (-0.03 * S, yy * S, -ln * 0.5), (-0.02 * S, yy * S, -ln)],
                 [0.04 * S, 0.035 * S, 0.004], red, depth=0.5), "hairb", (-0.04 * S, 0, 0.0))
    scale("eyes", 1.3, 1.45, 1.7)
    # dynamite sticks strapped across the belly
    A(L.tube("dstrap", [(0.0, -0.15, 0.14), (0.1, -0.16, 0.0), (0.16, -0.12, -0.18)], 0.03 * S, M["leather"], segs=6),
      "chest", (0, 0, 0))
    for k, (x, z, rot) in enumerate(((0.07, 0.02, -20), (0.115, -0.07, -20), (0.15, -0.16, -20))):
        A(L.disc("dyn%d" % k, 0.04 * S, 0.22 * S, red, segs=10), "chest", (x * S, -0.19 * S, z * S), rot=(0, rot, 0))
        A(L.disc("dynb%d" % k, 0.043 * S, 0.035 * S, M["dark"], segs=10), "chest",
          (x * S, -0.19 * S, z * S), rot=(0, rot, 0))
    # the big bomb strapped to her back, fuse burning over the shoulder
    A(ellipsoid("back_bomb", (0.42 * S, 0.4 * S, 0.42 * S), M["bomb"]), "chest", (-0.32 * S, 0.0, -0.04 * S))
    A(ellipsoid("back_band", (0.43 * S, 0.12 * S, 0.43 * S), red), "chest", (-0.32 * S, 0.0, -0.04 * S))
    A(ellipsoid("back_hl", (0.09 * S, 0.06 * S, 0.1 * S), M["lens"]), "chest", (-0.22 * S, -0.17 * S, 0.04 * S))
    A(L.limb("back_cap", 0.06 * S, 0.06 * S, 0.06 * S, M["cap"]), "chest", (-0.3 * S, 0, 0.2 * S))
    A(L.tube("back_fuse", [(-0.3 * S, 0, 0.19 * S), (-0.4 * S, 0, 0.27 * S), (-0.5 * S, 0, 0.34 * S),
                           (-0.56 * S, 0, 0.44 * S)], 0.018 * S, M["leather"], segs=5), "chest")
    A(ellipsoid("back_spark", (0.15 * S, 0.15 * S, 0.15 * S), M["spark"]), "chest", (-0.56 * S, 0, 0.46 * S))
    A(ellipsoid("back_spk2", (0.26 * S, 0.06 * S, 0.055 * S), M["spark2"]), "chest", (-0.56 * S, 0, 0.46 * S),
      rot=(0, 45, 0))
    A(ellipsoid("back_spk3", (0.26 * S, 0.06 * S, 0.055 * S), M["spark2"]), "chest", (-0.56 * S, 0, 0.46 * S),
      rot=(0, -45, 0))
    A(L.tube("bstrap1", [(-0.12 * S, -0.15 * S, 0.2 * S), (-0.2 * S, -0.2 * S, 0.0), (-0.24 * S, -0.16 * S, -0.2 * S)],
             0.028 * S, M["leather"], segs=6), "chest")
    # lit dynamite bundle in hand
    parts = []
    for k, (x, y) in enumerate(((-0.05, 0.0), (0.05, 0.0), (0.0, -0.045))):
        parts.append(L.disc("hd%d" % k, 0.045 * U, 0.2 * U, red, loc=(x * U, y * U, 0.0), segs=10))
    parts.append(L.disc("hd_band", 0.085 * U, 0.04 * U, M["dark"], loc=(0, -0.01 * U, 0.0), segs=12))
    parts += [L.tube("fuse", [(0, 0, 0.1 * U), (0.03 * U, 0, 0.15 * U), (0.0, 0, 0.19 * U)], 0.012 * U, M["leather"]),
              ellipsoid("spark", (0.09 * U, 0.09 * U, 0.09 * U), M["spark"], loc=(0, 0, 0.2 * U)),
              ellipsoid("spark2", (0.13 * U, 0.04 * U, 0.035 * U), M["spark2"], loc=(0, 0, 0.2 * U), rot=(0, 45, 0)),
              ellipsoid("spark3", (0.13 * U, 0.04 * U, 0.035 * U), M["spark2"], loc=(0, 0, 0.2 * U), rot=(0, -45, 0))]
    return set_hand(r, parts), "#ffc860"


def v_alchemist(r, M):
    A = r.attach
    toxic = L.glow("v_toxic", "#5cf08a")
    tox_hl = L.glow("v_toxhl", "#dcffe4")
    glass = L.mat("v_glass", "#a8e6c4", "#3a8a78", "#eafff4")
    cork = L.mat("v_cork", "#a8784a", "#503020", "#d8a470")
    bone = L.mat("v_beak", "#e0d2ac", "#8a7a70", "#fff6dc")
    gold = L.mat("v_gold", "#d8b04a", "#6a4a2a", "#fff0a0")
    rc(M["dress"], "#5e3a94", "#2a1852", "#926ccc")
    rc(M["apron"], "#c8b8dc", "#74648e", "#f2eaff")
    rc(M["stain"], "#58b83c", "#1c5a28", "#a0f070")
    rc(M["leather"], "#4a3040", "#22141c", "#744a5c")
    rc(M["dark"], "#2a2040", "#120c22", "#4a3c68")
    rc(M["hair"], "#46286e", "#1a0e34", "#7a52b0")
    rc(M["lens"], "#58f08a", "#1e8a4c", "#d8ffe4")
    # long robe with a gold hem (replaces the short skirt)
    drop("skirt_m", "satchel*")
    H, FR, BK = 0.44 * S, 0.85, 1.1
    A(L.skirt("skirt_m", 0.15 * S, 0.31 * S, H, M["dress"], n=16, bulge=0.035 * S, front=FR, back=BK, jag=0.03 * S,
              seed=7), "skirt")
    A(skirt_band("robe_trim", 0.15 * S, 0.31 * S, 0.035 * S, H, FR, BK, 0.9, 0.98, gold, n=16), "skirt")
    A(skirt_band("robe_trim2", 0.15 * S, 0.31 * S, 0.035 * S, H, FR, BK, 0.3, 0.36, gold, n=16), "skirt")
    # hood with a peaked back, beaked respirator mask (goggles stay pushed up over the hood)
    drop("spike*", "hair_cap")
    A(ellipsoid("hood", (0.31 * S, 0.3 * S, 0.27 * S), M["dress"]), "head", (-0.04 * S, 0, 0.17 * S))
    A(ellipsoid("hood_rim", (0.12 * S, 0.27 * S, 0.1 * S), M["dress"]), "head", (0.06 * S, 0, 0.2 * S))
    A(L.bake(cone("hood_tip", 0.1 * S, 0.0, 0.24 * S, M["dress"], loc=(-0.12 * S, 0, 0.2 * S), rot=(0, -115, 0))), "head")
    A(L.bake(cone("beak", 0.075 * S, 0.0, 0.26 * S, bone, loc=(0.07 * S, 0, 0.035 * S), rot=(0, 98, 0))), "head")
    A(ellipsoid("beak_base", (0.1 * S, 0.16 * S, 0.13 * S), bone), "head", (0.075 * S, 0, 0.04 * S))
    # flask bandolier (green glow) instead of bombs, big carboy on the back
    for k in range(3):
        drop("band_bomb%d" % k, "band_cap%d" % k)
    for k, (x, z) in enumerate(((0.03, 0.06), (0.11, -0.02), (0.14, -0.13))):
        A(ellipsoid("fl_b%d" % k, (0.12 * S, 0.12 * S, 0.12 * S), toxic), "chest", (x * S, -0.17 * S, z * S))
        A(L.limb("fl_n%d" % k, 0.07 * S, 0.026 * S, 0.026 * S, glass), "chest", (x * S, -0.17 * S, (z + 0.12) * S))
        A(ellipsoid("fl_c%d" % k, (0.05 * S, 0.05 * S, 0.035 * S), cork), "chest", (x * S, -0.17 * S, (z + 0.125) * S))
    A(ellipsoid("carboy", (0.26 * S, 0.24 * S, 0.3 * S), toxic), "hips", (-0.25 * S, 0.0, -0.02 * S))
    A(ellipsoid("carboy_hl", (0.06 * S, 0.05 * S, 0.12 * S), tox_hl), "hips", (-0.17 * S, -0.1 * S, 0.0))
    A(L.limb("carboy_n", 0.14 * S, 0.05 * S, 0.05 * S, glass), "hips", (-0.25 * S, 0, 0.27 * S))
    A(ellipsoid("carboy_c", (0.1 * S, 0.1 * S, 0.06 * S), cork), "hips", (-0.25 * S, 0, 0.28 * S))
    # flask in hand
    parts = [ellipsoid("fl_m", (0.2 * U, 0.2 * U, 0.2 * U), toxic),
             ellipsoid("fl_hl", (0.06 * U, 0.05 * U, 0.08 * U), tox_hl, loc=(0.035 * U, -0.08 * U, 0.03 * U)),
             L.limb("fl_neck", 0.08 * U, 0.03 * U, 0.03 * U, glass),
             ellipsoid("fl_cork", (0.07 * U, 0.07 * U, 0.05 * U), cork, loc=(0, 0, 0.175 * U))]
    parts[2].location = (0, 0, 0.17 * U)
    return set_hand(r, parts), "#c4ffd0"


VARIANTS = {
    "bomber_frost": v_frost,
    "bomber_cluster": v_cluster,
    "bomber_kamikaze": v_kamikaze,
    "bomber_alchemist": v_alchemist,
}


# --------------------------------------------------------------------------


def render_variant(vid, setup, quick):
    common._MAT_CACHE.clear()
    r, M, feet, bombm, sm = B.build()
    bombm2, smear_col = setup(r, M)
    set_glow(M["smear"], smear_col)
    sh = L.Sheet(vid, r)
    sh.prop(bombm2, False)
    sh.prop(sm, False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and o.name not in ("bombm", "smear")]
    # same animation table as asset_bomber.main()
    sh.render("idle", 8, B.idle, fps=10, loop=True, ground_objs=feet)
    if not quick:
        sh.render("walk", 8, B.walk, fps=10, loop=True, ground_objs=feet)
    sh.render("throw", sum(WA), B.throw, fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {"bombm": 1 <= i < WA[0], "smear": i == WA[0]})
    if not quick:
        sh.render("hurt", 3, B.hurt, fps=12, ground_objs=feet)
        sh.render("death", 9, B.death, fps=10, grounds=[("hips", allm)])
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
