"""DEADSELL enemy variants of the ghoul (docs/CONTENT2.md section 1):
ghoul_plague, ghoul_frenzy, ghoul_shackled, ghoul_wraith.

blender -b --factory-startup -P tools/blender/asset_ghoul_variants.py [-- plague frenzy ...] [--quick]
-> build/frames/ghoul_<v>/*.png + spec.json   (pack: python3 tools/pack/pack_all.py ghoul_plague ...)

Every variant builds the BASE ghoul rig through asset_ghoul.build() (so frame size, anchor, joints,
animation names, frame counts and windup/active/recover are identical to ghoul.png) and then
recolours / removes / adds parts.  The base script's own output is not touched (its render call is
suppressed while importing it).  --quick renders only idle + attack (for previews).
"""
import json
import math
import os
import random
import subprocess
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import lib_enemies as L  # noqa: E402
from lib_enemies import ellipsoid, box, cone  # noqa: E402

_run = L.run
L.run = lambda f: None          # importing the base script must not render the base sheet
import asset_ghoul as B  # noqa: E402
L.run = _run

S = B.S
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


# --------------------------------------------------------------------------
# variants.  Each takes (rig, materials, feet, smear) and returns a context dict:
#   wrap(fn, kind) -> pose fn      lift(kind) -> lift_fn or None      post -> post-process spec


def v_plague(r, M, feet, sm):
    A = r.attach
    rc(M["skin"], "#a6b85c", "#4a5a34", "#d6e48a")
    rc(M["dress"], "#5d6c36", "#2a3820", "#869a52")
    rc(M["rag"], "#46522a", "#202a16", "#66783c")
    rc(M["hair"], "#46401f", "#1e1a0e", "#6c6234")
    rc(M["claw"], "#c9bf7c", "#6e6440", "#efe6a6")
    set_glow(M["eye"], "#9bff2e")
    set_glow(M["smear"], "#d2ff8a")
    pus = L.mat("v_pus", "#f0e87a", "#b0a040", "#ffffc0")
    sore = L.mat("v_sore", "#b4503c", "#5a1e28", "#d87a5a")
    moss = L.mat("v_moss", "#3e5a2a", "#1c2a18", "#62883e")
    # bloated belly + hunched hump
    A(ellipsoid("belly", (0.5 * S, 0.44 * S, 0.5 * S), M["skin"]), "spine", (0.1 * S, 0, -0.07 * S))
    A(ellipsoid("belly_sore", (0.2 * S, 0.2 * S, 0.16 * S), sore), "spine", (0.27 * S, -0.1 * S, -0.1 * S))
    A(ellipsoid("hump", (0.34 * S, 0.34 * S, 0.34 * S), M["skin"]), "chest", (-0.15 * S, 0, 0.1 * S))
    A(ellipsoid("hump_rag", (0.2 * S, 0.3 * S, 0.22 * S), M["dress"]), "chest", (-0.2 * S, 0, 0.0))
    # swollen shoulder tumours
    for sd, dz in (("n", 0.02), ("f", 0.0)):
        A(ellipsoid("tumor_" + sd, (0.2 * S, 0.17 * S, 0.17 * S), M["skin"]), "sh_" + sd, (0.01 * S, 0, dz * S))
    # pustules (yellow) and moss patches
    cx, cz = 0.1 * S, -0.07 * S
    for k, (a, y) in enumerate(((-50, -0.13), (-15, -0.15), (25, -0.14), (62, -0.12), (100, -0.1), (160, -0.1))):
        rr = 0.17 * S
        A(ellipsoid("pus%d" % k, (0.075 * S, 0.06 * S, 0.075 * S), pus), "spine",
          (cx + rr * math.cos(math.radians(a)), y * S, cz + rr * math.sin(math.radians(a))))
    A(ellipsoid("pus_n", (0.07 * S, 0.06 * S, 0.07 * S), pus), "sh_n", (0.03 * S, -0.1 * S, 0.04 * S))
    A(ellipsoid("pus_f", (0.07 * S, 0.06 * S, 0.07 * S), pus), "sh_f", (0.03 * S, -0.1 * S, 0.04 * S))
    A(ellipsoid("pus_h1", (0.07 * S, 0.05 * S, 0.07 * S), pus), "head", (0.075 * S, -0.1 * S, 0.1 * S))
    A(ellipsoid("pus_h2", (0.06 * S, 0.05 * S, 0.06 * S), sore), "head", (0.02 * S, -0.15 * S, 0.2 * S))
    A(ellipsoid("pus_k", (0.08 * S, 0.07 * S, 0.08 * S), sore), "kn_n", (0.04 * S, -0.04 * S, 0.0))
    A(ellipsoid("moss", (0.22 * S, 0.3 * S, 0.08 * S), moss), "head", (-0.04 * S, 0, 0.27 * S))
    # thinner hair: drop two locks so the scalp shows
    drop("hf_lock2", "hb_lock0")
    # drooping slime strip from the mouth/chin
    A(L.tube("drool", [(0.1 * S, -0.02 * S, 0.0), (0.12 * S, -0.02 * S, -0.1 * S), (0.12 * S, -0.02 * S, -0.2 * S)],
             [0.02 * S, 0.018 * S, 0.01 * S], moss, depth=0.8), "head", (0, 0, 0.0))
    return {}


def v_frenzy(r, M, feet, sm):
    A = r.attach
    rc(M["skin"], "#b4aab0", "#6a5870", "#e0d6da")
    rc(M["dress"], "#a8202e", "#4a0e1c", "#d6424c")
    rc(M["rag"], "#6c1220", "#32080f", "#9a2a34")
    rc(M["hair"], "#eae6f4", "#8a84b6", "#ffffff")
    rc(M["claw"], "#f4ead2", "#8a7a6a", "#ffffff")
    rc(M["iron"], "#5a3a40", "#2a1a20", "#8a5a60")
    set_glow(M["eye"], "#ff2418")
    set_glow(M["smear"], "#ffb0a0")
    blood = L.mat("v_blood", "#a0141c", "#4a0810", "#d02a30")
    # emaciated: thin torso and limbs
    for nm in ("pelvis", "waist", "chestm"):
        scale(nm, 0.88, 0.76, 1.0)
    scale("bust", 0.8, 0.8, 0.8)
    for sd in ("n", "f"):
        for nm in ("ua_", "fa_", "thm_", "shin_"):
            scale(nm + sd, 0.7, 0.7, 1.0)
        scale("palm_" + sd, 0.9, 0.9, 1.0)
    # long claws (replace the base ones)
    for sd in ("n", "f"):
        for k in range(3):
            drop("claw_%s%d" % (sd, k))
        for k, (dx, dy, rot, ln) in enumerate(((0.04, -0.03, 34, 0.42), (0.012, -0.01, 12, 0.5),
                                               (-0.016, 0.01, -8, 0.46), (-0.045, 0.03, -28, 0.38))):
            A(L.claw("fclaw_%s%d" % (sd, k), ln * S, 0.021 * S, M["claw"], bend=0.55), "ha_" + sd,
              (dx * S, dy * S, -0.085 * S), rot=(0, rot, 0))
    # wild white hair: spikes radiating from the scalp
    spikes = (
        ((-0.04, 0.0, 0.22), (-0.12, 0.0, 0.38), (-0.26, 0.0, 0.5)),
        ((0.0, -0.06, 0.24), (0.0, -0.07, 0.44), (-0.06, -0.06, 0.62)),
        ((0.05, 0.05, 0.24), (0.11, 0.06, 0.4), (0.24, 0.06, 0.5)),
        ((-0.1, 0.0, 0.14), (-0.28, 0.0, 0.2), (-0.46, 0.0, 0.12)),
        ((-0.08, -0.08, 0.2), (-0.2, -0.1, 0.36), (-0.38, -0.1, 0.42)),
        ((-0.02, 0.08, 0.22), (-0.06, 0.1, 0.42), (-0.14, 0.1, 0.58)),
        ((0.03, -0.1, 0.18), (0.1, -0.12, 0.3), (0.2, -0.12, 0.34)),
    )
    for k, pts in enumerate(spikes):
        A(L.tube("spike%d" % k, [(x * S, y * S, z * S) for x, y, z in pts],
                 [0.075 * S, 0.05 * S, 0.008 * S], M["hair"], depth=0.9), "head")
    # blood: streak down the dress front + stained mouth
    A(ellipsoid("blood_chest", (0.1 * S, 0.14 * S, 0.2 * S), blood), "chest", (0.1 * S, -0.05 * S, 0.0))
    A(ellipsoid("blood_mouth", (0.05 * S, 0.1 * S, 0.06 * S), blood), "head", (0.09 * S, 0, 0.0))
    # bone-white ribs showing through the torn dress
    rib = L.mat("v_rib", "#e8e0cc", "#8a8070", "#fffaea")
    for k in range(3):
        A(L.tube("rib%d" % k, [(0.1 * S, -0.1 * S, 0.0), (0.13 * S, -0.0 * S, 0.0), (0.1 * S, 0.1 * S, 0.0)],
                 [0.017 * S] * 3, rib, segs=5), "chest", (0.0, 0, (0.14 - 0.06 * k) * S))
    return {}


def v_shackled(r, M, feet, sm):
    A = r.attach
    rc(M["skin"], "#a39d92", "#5a5668", "#cfc9bc")
    rc(M["dress"], "#6e7078", "#34363f", "#9c9ea8")
    rc(M["rag"], "#4c4e58", "#24262e", "#6e707c")
    rc(M["hair"], "#46362e", "#1e1612", "#6a564a")
    rc(M["iron"], "#9aa0b6", "#3a3e54", "#e2e6f2")
    set_glow(M["smear"], "#e8ecff")
    brass = L.mat("v_brass", "#c8a03c", "#6a4a20", "#ffe080")
    # iron collar + padlock + hanging chain on the chest
    A(L.disc("collar", 0.11 * S, 0.07 * S, M["iron"], segs=14), "neck", (0.0, 0, 0.065 * S))
    A(box("lock", (0.05 * S, 0.06 * S, 0.07 * S), brass, bevel=0.01), "neck", (0.1 * S, 0, 0.06 * S))
    for k in range(4):
        sz = (0.04, 0.02, 0.07) if k % 2 == 0 else (0.02, 0.04, 0.07)
        A(ellipsoid("clink%d" % k, tuple(v * S for v in sz), M["iron"]), "chest",
          (0.14 * S, 0, (0.28 - 0.06 * k) * S))
    # wrist shackles: bigger rings
    for sd in ("n", "f"):
        scale("cuff_" + sd, 1.25, 1.25, 1.0)
    # ball and chain in the near hand
    ha = r.world_rest["ha_n"]
    r.joint("ch0", "ha_n", (ha.x + 0.03 * S, ha.y - 0.03 * S, ha.z - 0.02 * S))
    r.joint("ch1", "ch0", (ha.x + 0.03 * S, ha.y - 0.03 * S, ha.z - 0.02 * S - 0.17 * S))
    for j, base_z in (("ch0", 0.0), ("ch1", 0.0)):
        for k in range(2):
            sz = (0.055, 0.022, 0.1) if k % 2 == 0 else (0.022, 0.055, 0.1)
            A(ellipsoid("link_%s_%d" % (j, k), tuple(v * S for v in sz), M["iron"]), j, (0, 0, -(0.065 + 0.09 * k) * S))
    bc = (0, 0, -0.3 * S)
    A(ellipsoid("ball", (0.33 * S, 0.33 * S, 0.33 * S), M["iron"]), "ch1", bc)
    for k, (a, y) in enumerate(((0, 0), (60, 0), (120, 0), (180, 0), (240, 0), (300, 0))):
        d = (math.sin(math.radians(a)), 0, math.cos(math.radians(a)))
        A(cone("ball_sp%d" % k, 0.06 * S, 0.0, 0.13 * S, M["iron"]), "ch1",
          (bc[0] + d[0] * 0.14 * S, 0, bc[2] + d[2] * 0.14 * S), rot=(0, a, 0))
    A(cone("ball_spy", 0.06 * S, 0.0, 0.13 * S, M["iron"]), "ch1", (0, -0.14 * S, bc[2]), rot=(90, 0, 0))
    A(ellipsoid("ball_hl", (0.1 * S, 0.1 * S, 0.1 * S), brass), "ch1", (0.06 * S, -0.14 * S, bc[2] + 0.07 * S))

    def wrap(fn, kind):
        def f(i, n):
            p = fn(i, n)
            if kind == "attack":
                t = L.phase_t(i, *WA)
                e0 = L.keys_at([(0.0, {"a": 0}), (0.3, {"a": -25}), (0.45, {"a": -45}), (0.5, {"a": -30}),
                                (0.575, {"a": 40}), (0.65, {"a": 88}), (0.8, {"a": 45}), (1.0, {"a": 10})], t)["a"]
                e1 = e0 + (22 if 0.5 <= t <= 0.8 else -8 if t < 0.5 else 0)
                sway = 0
            elif kind == "death":
                f_ = i / (n - 1)
                lie = L.ease(min(1.0, f_ * 1.6))
                e0, e1, sway = 96 * lie, 100 * lie, 0
            else:
                t = i / n
                amp = 8 if kind != "hurt" else 18
                e0 = amp * math.sin(2 * math.pi * t + 0.6)
                e1 = e0 * 1.5 + 4
                sway = 0
            L.hang(p, [("ch0", e0), ("ch1", e1)], ARM_N, sway)
            return p
        return f
    return {"wrap": wrap}


def v_wraith(r, M, feet, sm):
    A = r.attach
    rc(M["skin"], "#d4eeff", "#7ea4d8", "#ffffff", rim="#ffffff")
    rc(M["dress"], "#a4ccf2", "#5c84c4", "#dcf2ff", rim="#ffffff")
    rc(M["rag"], "#88b2e4", "#4a6cae", "#c4e2fa", rim="#ffffff")
    rc(M["hair"], "#4a6aae", "#22346a", "#8cb2e8", rim="#e0f4ff")
    rc(M["claw"], "#eef8ff", "#8aa8d0", "#ffffff")
    set_glow(M["eye"], "#38f0ff")
    set_glow(M["smear"], "#bff4ff")
    drop("cuff_n", "cuff_f", "skirt_m", "skirt_rag", "rag_strip", "strap")
    hide("thm_n", "thm_f", "shin_n", "shin_f", "foot_n", "foot_f")     # legs stay for grounding only
    mist = L.mat("v_mist", "#b4d8f8", "#6a90cc", "#e8f8ff", rim="#ffffff")
    # long tattered dress that floats: tapers to ragged wisps trailing behind
    A(L.skirt("wskirt", 0.15 * S, 0.12 * S, 0.84 * S, M["dress"], n=18, jag=0.1 * S, seed=5, bulge=0.07 * S,
              front=0.75, back=1.15, xoff=-0.2 * S), "skirt")
    A(L.skirt("wskirt2", 0.155 * S, 0.1 * S, 0.7 * S, mist, n=14, jag=0.14 * S, seed=9, bulge=0.05 * S,
              front=0.7, back=1.2, xoff=-0.3 * S), "skirt", (-0.01 * S, 0, 0.02 * S))
    A(ellipsoid("wtorso", (0.3 * S, 0.3 * S, 0.3 * S), M["dress"]), "spine", (0, 0, -0.08 * S))
    for k, (y, ln, dx) in enumerate(((-0.1, 0.9, -0.28), (0.0, 1.05, -0.4), (0.1, 0.8, -0.24))):
        A(L.tube("wisp%d" % k, [(0, y * S, 0), ((dx * 0.3) * S, y * S, -ln * 0.4 * S), (dx * S, y * S, -ln * S)],
                 [0.05 * S, 0.04 * S, 0.006 * S], mist, depth=0.5), "skirt", (-0.04 * S, 0, -0.1 * S))
    # tattered sleeves hanging off the forearms
    for sd in ("n", "f"):
        A(L.tube("sleeve_" + sd, [(0, 0, 0.02 * S), (-0.02 * S, 0, -0.14 * S), (-0.05 * S, 0, -0.3 * S)],
                 [0.06 * S, 0.05 * S, 0.008 * S], M["rag"], depth=0.8), "el_" + sd, (0, 0, -0.02 * S))

    def lift(kind):
        base = 0.15
        if kind in ("idle", "walk"):
            return lambda i, n: base + 0.025 * math.sin(2 * math.pi * i / n)
        if kind == "death":
            return None
        return lambda i, n: base
    return {"lift": lift, "post": "wraith"}


VARIANTS = {"ghoul_plague": v_plague, "ghoul_frenzy": v_frenzy, "ghoul_shackled": v_shackled,
            "ghoul_wraith": v_wraith}


# --------------------------------------------------------------------------
# spectral post-process (dithered dissolve + blue outline); runs in system python (Pillow)

POST = r'''
import sys, os, json
from PIL import Image
d = sys.argv[1]
BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
OUT = (22, 44, 96, 255)
for fn in sorted(os.listdir(d)):
    if not fn.endswith(".png"):
        continue
    name, idx = fn[:-4].rsplit("_", 1)
    im = Image.open(os.path.join(d, fn)).convert("RGBA")
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 110 else (0, 0, 0, 0)
    src = im.copy(); sp = src.load()
    for y in range(h):
        for x in range(w):
            if sp[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and sp[nx, ny][3]:
                        px[x, y] = OUT
                        break
    n = {"death": 9}.get(name, 0)
    tf = (int(idx) / (n - 1)) if n else 0.0
    for y in range(h):
        if n:                                   # death: the whole body dissolves (faint residue stays)
            pr = 0.12 + 0.62 * tf
        else:                                   # alive: the lower dress fades into mist
            pr = min(1.0, max(0.0, (y - 66) / 36.0)) * 0.62
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            if r < 140 and g > 215 and b > 215:      # eye glow stays solid
                continue
            if BAY[y % 4][x % 4] / 16.0 < pr:
                px[x, y] = (0, 0, 0, 0)
    im.save(os.path.join(d, fn))
'''


def post_wraith(vdir):
    subprocess.run(["python3", "-c", POST, vdir], check=True)
    sp = os.path.join(vdir, "spec.json")
    spec = json.load(open(sp))
    spec["outline"] = False            # the post-process already drew a pale-blue outline
    json.dump(spec, open(sp, "w"), indent=1)


# --------------------------------------------------------------------------


def render_variant(vid, setup, quick):
    common._MAT_CACHE.clear()
    r, M, feet, sm = B.build()
    ctx = setup(r, M, feet, sm) or {}
    wrap = ctx.get("wrap", lambda fn, kind: fn)
    lift = ctx.get("lift", lambda kind: None)
    sh = L.Sheet(vid, r)
    sh.prop(sm, False)
    allm = [o for o in r.joints["root"].children_recursive if o.type == "MESH" and o.name != "smear"]
    # same animation table as asset_ghoul.main()
    sh.render("idle", 8, wrap(B.idle, "idle"), fps=8, loop=True, ground_objs=feet, lift_fn=lift("idle"))
    if not quick:
        sh.render("walk", 10, wrap(B.walk, "walk"), fps=10, loop=True, ground_objs=feet, lift_fn=lift("walk"))
    sh.render("attack", sum(WA), wrap(B.attack, "attack"), fps=12, wa=WA, ground_objs=feet,
              vis_fn=lambda i, n: {"smear": i == WA[0]}, lift_fn=lift("attack"))
    if not quick:
        sh.render("hurt", 3, wrap(B.hurt, "hurt"), fps=12, ground_objs=feet, lift_fn=lift("hurt"))
        sh.render("death", 9, wrap(B.death, "death"), fps=10, grounds=[("hips", allm)], lift_fn=lift("death"))
    sh.write_spec()
    if ctx.get("post") == "wraith":
        post_wraith(sh.dir)


def main():
    args = common.script_args()
    quick = "--quick" in args
    want = [a for a in args if not a.startswith("--")]
    for vid, fn in VARIANTS.items():
        if want and vid.split("_", 1)[1] not in want and vid not in want:
            continue
        render_variant(vid, fn, quick)


L.run(main)
