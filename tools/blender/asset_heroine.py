"""DEADSELL heroine sprite sheet: Cinder, the Ashen Prisoner.

    blender -b --factory-startup -P tools/blender/asset_heroine.py [-- anim anim ...]

Writes build/frames/heroine/<anim>_###.png + spec.json (frame 128x112, anchor 64,100).
With no arguments every animation is rendered from scratch.
"""
import sys
import os
import math
import json
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib  # noqa: E402
import common  # noqa: E402
import lib_heroine as L  # noqa: E402
importlib.reload(common)
importlib.reload(L)
from mathutils import Vector, Quaternion  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "build", "frames", "heroine")
FW, FH, AX, AY = 128, 112, 64, 100

plant = L.plant
S = math.sin
C = math.cos
TAU = 2 * math.pi

# ---------------------------------------------------------------------------
# registry

ANIMS = []          # (name, fps, loop, phases, builder, opts)


def anim(name, fps, loop=False, phases=None, **opts):
    def deco(fn):
        ANIMS.append((name, fps, loop, phases, fn, opts))
        return fn
    return deco


def lerp(a, b, t):
    return a + (b - a) * t


def keys(table, t):
    """table: [(t, {k: v}), ...] piecewise-linear (smoothstep) sample."""
    return common.sample_keys(table, t)


def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out


# ---------------------------------------------------------------------------
# stances


def stance(**kw):
    """Base grounded frame spec."""
    sp = {"a": {}, "fn": plant(0.08), "ff": plant(-0.21), "ground": 0.0, "vel": (0.0, 0.0)}
    sp.update(kw)
    return sp


# ---------------------------------------------------------------------------
# locomotion


@anim("tpose", 10, loop=True, test=True)
def a_tpose():
    return [{"a": {"sh_n": 20, "sh_f": -20, "el_n": 10, "el_f": 10}, "ground": 0.0}]


@anim("idle", 10, loop=True,
      chain={"pony": dict(base=-72.0, base_stiff=0.25, curl=[0, 17, 16, 15, 12, 10],
                          stiff=[0.0, 0.07, 0.06, 0.05, 0.05, 0.04], flutter=3.0),
             "sa": dict(base=-16.0, flutter=5.0), "sb": dict(base=-8.0, flutter=4.0)})
def a_idle():
    out = []
    n = 8
    for i in range(n):
        t = i / n
        s = S(TAU * t)
        s2 = S(TAU * t - 0.6)
        out.append(stance(
            hip=(0.0, -0.045 - 0.012 * s),
            a={"hips": -4, "spine": 1 + 1.5 * s, "chest": 2 + 2.0 * s, "neck": -2 - 1.5 * s, "head": 1.0 * s2,
               "sh_n": 12 + 4 * s2, "el_n": 28 + 4 * s2, "ha_n": -15,
               "sh_f": -14 + 4 * s2, "el_f": 32 + 3 * s2, "ha_f": -10},
            fn=plant(0.09), ff=plant(-0.22, 0),
            wind=(-0.55 - 0.25 * S(TAU * t * 2), 0.0),
        ))
    return out


RUN_LEG = [(0.0, {"th": 30, "kn": -12, "an": 10}),
           (0.12, {"th": 16, "kn": -42, "an": 0}),
           (0.27, {"th": -10, "kn": -24, "an": -12}),
           (0.42, {"th": -40, "kn": -20, "an": -38}),
           (0.56, {"th": -30, "kn": -100, "an": -30}),
           (0.71, {"th": 18, "kn": -122, "an": -12}),
           (0.86, {"th": 55, "kn": -72, "an": 4}),
           (1.0, {"th": 30, "kn": -12, "an": 10})]


def run_leg(ph):
    ph = ph % 1.0
    return common.sample_keys(RUN_LEG, ph, easing=lambda u: u)


@anim("run", 14, loop=True)
def a_run():
    out = []
    n = 10
    for i in range(n):
        t = i / n
        ln = run_leg(t)
        lf = run_leg(t + 0.5)
        sw = C(TAU * t)
        bob = C(2 * TAU * (t - 0.42))
        out.append({
            "a": {"hips": -14, "spine": -8, "chest": -5 + 3 * S(TAU * t), "neck": 9, "head": 9 + 2 * bob,
                  "th_n": ln["th"] + 12, "kn_n": ln["kn"], "an_n": ln["an"],
                  "th_f": lf["th"] + 12, "kn_f": lf["kn"], "an_f": lf["an"],
                  "sh_n": -48 * sw + 6, "el_n": 88 - 18 * sw, "ha_n": -15,
                  "sh_f": 48 * sw + 6, "el_f": 88 + 18 * sw, "ha_f": -15},
            "hip": (0.04, 0.0),
            "ground": max(0.0, 0.045 * bob),
            "vel": (4.7, 0.0),
        })
    return out


# ---------------------------------------------------------------------------
# frame helpers for the combat poses


def torso(lean=0.0, head=0.0):
    """lean > 0 = forward lean (deg).  The head counter-rotates so she keeps looking ahead."""
    return {"hips": -0.40 * lean, "spine": -0.30 * lean, "chest": -0.30 * lean,
            "neck": 0.30 * lean, "head": 0.40 * lean + head}


def F(lean=0.0, a=None, hip=(0.0, 0.0), fn=None, ff=None, hn=None, hf=None, show=(), vel=(0.0, 0.0),
      ground=0.0, head=0.0, **kw):
    aa = {"sh_n": 8, "el_n": 25, "ha_n": -10, "sh_f": -10, "el_f": 25, "ha_f": -10}
    aa.update(torso(lean, head))
    aa.update(a or {})
    sp = {"a": aa, "hip": hip, "fn": fn or plant(0.12), "ff": ff or plant(-0.2), "ground": ground,
          "vel": vel, "show": list(show)}
    if hn is not None:
        sp["hn"] = hn
    if hf is not None:
        sp["hf"] = hf
    sp.update(kw)
    return sp


def SM(prop, frm, **kw):
    d = {"prop": prop, "from": frm}
    d.update(kw)
    return d


def grip(prop, t, bend=1):
    return ("grip", prop, t, None, bend)


def dust(x, z=0.04, sx=1.0, sz=1.0):
    return ("obj", "dust_l", (x, -0.1, z), (sx, 1.0, sz), 0.0)


# ---------------------------------------------------------------------------
# SWORD

SWORD = ["sword"]


@anim("sword_1", 16, phases=(3, 2, 2))
def a_sword_1():
    return [
        F(-8, hip=(-0.04, -0.06), fn=plant(0.14), ff=plant(-0.26), hn=(-0.28, 1.5, 135), show=SWORD),
        F(-12, hip=(-0.07, -0.04), fn=plant(0.12), ff=plant(-0.28, -10), hn=(-0.34, 1.80, 165), show=SWORD),
        F(-2, hip=(0.0, -0.08), fn=plant(0.26), ff=plant(-0.26, -6), hn=(0.12, 1.85, 100), show=SWORD, vel=(1.0, 0)),
        F(14, hip=(0.10, -0.12), fn=plant(0.40), ff=plant(-0.30, -25), hn=(0.55, 1.40, 26), show=SWORD,
          vel=(3.0, 0), smear=[SM("sword", 2, dir=-1, width=0.20)]),
        F(20, hip=(0.15, -0.16), fn=plant(0.44), ff=plant(-0.28, -35), hn=(0.66, 0.98, -14), show=SWORD, vel=(3.2, 0)),
        F(18, hip=(0.12, -0.14), fn=plant(0.42), ff=plant(-0.28, -30), hn=(0.52, 0.78, -44), show=SWORD, vel=(1.5, 0)),
        F(6, hip=(0.04, -0.08), fn=plant(0.28), ff=plant(-0.22), hn=(0.30, 1.0, -5), show=SWORD, vel=(0.5, 0)),
    ]


@anim("sword_2", 16, phases=(2, 2, 3))
def a_sword_2():
    return [
        F(10, hip=(0.05, -0.12), fn=plant(0.34), ff=plant(-0.22, -10), hn=(0.30, 0.82, -45), show=SWORD),
        F(6, hip=(-0.02, -0.16), fn=plant(0.30), ff=plant(-0.28, -15), hn=(-0.20, 0.75, -150), show=SWORD),
        F(10, hip=(0.10, -0.10), fn=plant(0.40), ff=plant(-0.28, -30), hn=(0.56, 1.18, 16), show=SWORD,
          vel=(3.0, 0), smear=[SM("sword", 1, dir=1, width=0.22)]),
        F(4, hip=(0.06, -0.04), fn=plant(0.32), ff=plant(-0.2, -40), hn=(0.30, 1.55, 78), show=SWORD, vel=(2.0, 0.5)),
        F(-6, hip=(0.0, 0.0), fn=plant(0.24), ff=plant(-0.18, -20), hn=(-0.05, 1.70, 130), show=SWORD, vel=(0.5, 0)),
        F(0, hip=(0.0, -0.03), fn=plant(0.2), ff=plant(-0.2), hn=(0.0, 1.45, 100), show=SWORD),
        F(5, hip=(0.02, -0.06), fn=plant(0.22), ff=plant(-0.22), hn=(0.2, 1.05, 35), show=SWORD),
    ]


@anim("sword_3", 14, phases=(3, 2, 3))
def a_sword_3():
    g = grip("sword", -0.06)
    return [
        F(-6, hip=(-0.02, -0.04), fn=plant(0.16), ff=plant(-0.24), hn=(0.05, 1.5, 100), hf=g, show=SWORD),
        F(-12, hip=(-0.06, 0.0), fn=plant(0.12, -10), ff=plant(-0.26, -15), hn=(-0.05, 1.85, 125), hf=g, show=SWORD),
        F(-16, hip=(-0.08, 0.02), fn=plant(0.10, -15), ff=plant(-0.26, -20), hn=(-0.10, 1.95, 142), hf=g, show=SWORD),
        F(22, hip=(0.20, -0.20), fn=plant(0.50), ff=plant(-0.25, -30), hn=(0.58, 1.22, 12), hf=g, show=SWORD,
          vel=(3.4, -0.5), smear=[SM("sword", 2, dir=-1, width=0.24)]),
        F(28, hip=(0.24, -0.26), fn=plant(0.54), ff=plant(-0.24, -35), hn=(0.62, 0.78, -36), hf=g, show=SWORD,
          vel=(3.0, -1.0), fx=[("obj", "spark", (1.22, -0.2, 0.14), (1.2, 1, 1.2), 20),
                              dust(0.9, 0.05, 1.2, 1.0)]),
        F(26, hip=(0.22, -0.24), fn=plant(0.52), ff=plant(-0.24, -35), hn=(0.55, 0.74, -48), hf=g, show=SWORD,
          vel=(1.0, 0), fx=[dust(1.0, 0.06, 1.5, 1.2)]),
        F(18, hip=(0.14, -0.16), fn=plant(0.44), ff=plant(-0.24, -20), hn=(0.48, 0.86, -25), hf=g, show=SWORD),
        F(6, hip=(0.04, -0.08), fn=plant(0.26), ff=plant(-0.22), hn=(0.3, 1.0, 5), show=SWORD),
    ]


# ---------------------------------------------------------------------------
# SPEAR

SPEAR = ["spear"]


@anim("spear_1", 16, phases=(2, 2, 2))
def a_spear_1():
    return [
        F(-6, hip=(-0.08, -0.08), fn=plant(0.2), ff=plant(-0.3, -10), hn=(-0.25, 1.18, 6), hf=grip("spear", 0.6), show=SPEAR),
        F(-10, hip=(-0.12, -0.10), fn=plant(0.18), ff=plant(-0.32, -15), hn=(-0.4, 1.15, 4), hf=grip("spear", 0.75), show=SPEAR),
        F(14, hip=(0.18, -0.12), fn=plant(0.52), ff=plant(-0.30, -30), hn=(0.38, 1.12, 3), hf=grip("spear", 0.12), show=SPEAR,
          vel=(3.5, 0)),
        F(16, hip=(0.20, -0.12), fn=plant(0.55), ff=plant(-0.30, -32), hn=(0.46, 1.12, 2), hf=grip("spear", 0.1), show=SPEAR,
          vel=(3.0, 0)),
        F(8, hip=(0.12, -0.10), fn=plant(0.45), ff=plant(-0.28, -20), hn=(0.2, 1.12, 4), hf=grip("spear", 0.35), show=SPEAR,
          vel=(1.0, 0)),
        F(3, hip=(0.05, -0.07), fn=plant(0.30), ff=plant(-0.26), hn=(0.0, 1.1, 10), hf=grip("spear", 0.5), show=SPEAR),
    ]


@anim("spear_2", 16, phases=(2, 2, 2))
def a_spear_2():
    return [
        F(4, hip=(-0.02, -0.18), fn=plant(0.30), ff=plant(-0.28, -10), hn=(-0.30, 0.9, -8), hf=grip("spear", 0.55), show=SPEAR),
        F(8, hip=(0.0, -0.2), fn=plant(0.32), ff=plant(-0.30, -15), hn=(-0.36, 0.84, -14), hf=grip("spear", 0.65), show=SPEAR),
        F(10, hip=(0.14, -0.12), fn=plant(0.50), ff=plant(-0.28, -35), hn=(0.34, 1.3, 20), hf=grip("spear", 0.12), show=SPEAR,
          vel=(3.0, 1.0)),
        F(8, hip=(0.16, -0.08), fn=plant(0.52), ff=plant(-0.28, -40), hn=(0.42, 1.36, 24), hf=grip("spear", 0.1), show=SPEAR,
          vel=(2.5, 1.0)),
        F(4, hip=(0.10, -0.08), fn=plant(0.42), ff=plant(-0.26, -20), hn=(0.2, 1.2, 14), hf=grip("spear", 0.35), show=SPEAR),
        F(2, hip=(0.04, -0.06), fn=plant(0.28), ff=plant(-0.24), hn=(0.0, 1.1, 8), hf=grip("spear", 0.5), show=SPEAR),
    ]


@anim("spear_3", 14, phases=(2, 2, 3))
def a_spear_3():
    return [
        F(-10, hip=(-0.1, -0.14), fn=plant(0.16), ff=plant(-0.34, -10), hn=(-0.38, 1.32, 14), hf=grip("spear", 0.7), show=SPEAR),
        F(-14, hip=(-0.14, -0.18), fn=plant(0.14), ff=plant(-0.36, -15), hn=(-0.44, 1.4, 22), hf=grip("spear", 0.8), show=SPEAR),
        F(20, hip=(0.24, -0.2), fn=plant(0.64), ff=plant(-0.30, -45), hn=(0.42, 1.2, -2), hf=grip("spear", 0.1), show=SPEAR,
          vel=(4.5, 0)),
        F(22, hip=(0.28, -0.22), fn=plant(0.68), ff=plant(-0.30, -48), hn=(0.50, 1.18, -3), hf=grip("spear", 0.08), show=SPEAR,
          vel=(4.0, 0)),
        F(14, hip=(0.20, -0.18), fn=plant(0.58), ff=plant(-0.30, -30), hn=(0.30, 1.14, 2), hf=grip("spear", 0.3), show=SPEAR,
          vel=(1.5, 0)),
        F(8, hip=(0.10, -0.12), fn=plant(0.40), ff=plant(-0.26, -15), hn=(0.1, 1.12, 8), hf=grip("spear", 0.45), show=SPEAR),
        F(2, hip=(0.04, -0.06), fn=plant(0.26), ff=plant(-0.24), hn=(0.0, 1.1, 12), hf=grip("spear", 0.5), show=SPEAR),
    ]


# ---------------------------------------------------------------------------
# DAGGERS

DAG = ["dagger_n", "dagger_f"]


@anim("dagger_1", 20, phases=(1, 1, 2))
def a_dagger_1():
    return [
        F(4, hip=(-0.02, -0.10), fn=plant(0.2), ff=plant(-0.24), hn=(0.05, 1.1, 70), hf=(0.30, 1.0, 20), show=DAG),
        F(14, hip=(0.12, -0.10), fn=plant(0.40), ff=plant(-0.26, -20), hn=(0.56, 1.12, 8), hf=(-0.05, 1.05, 100), show=DAG,
          vel=(2.5, 0), fx=[("trail", 0, "dagger_n", 0, 1.0)]),
        F(8, hip=(0.08, -0.10), fn=plant(0.34), ff=plant(-0.26, -10), hn=(0.40, 1.05, 15), hf=(0.1, 1.05, 60), show=DAG),
        F(3, hip=(0.03, -0.08), fn=plant(0.24), ff=plant(-0.24), hn=(0.28, 1.0, 35), hf=(0.22, 1.0, 40), show=DAG),
    ]


@anim("dagger_2", 20, phases=(1, 1, 2))
def a_dagger_2():
    return [
        F(4, hip=(0.0, -0.10), fn=plant(0.24), ff=plant(-0.22), hn=(0.3, 1.0, 35), hf=(0.0, 1.15, 80), show=DAG),
        F(14, hip=(0.12, -0.10), fn=plant(0.40), ff=plant(-0.26, -20), hn=(-0.05, 1.05, 100), hf=(0.56, 1.15, 5), show=DAG,
          vel=(2.5, 0), fx=[("trail", 1, "dagger_f", 0, 1.0)]),
        F(8, hip=(0.08, -0.10), fn=plant(0.34), ff=plant(-0.26, -10), hn=(0.1, 1.05, 60), hf=(0.4, 1.1, 12), show=DAG),
        F(3, hip=(0.03, -0.08), fn=plant(0.24), ff=plant(-0.24), hn=(0.24, 1.0, 40), hf=(0.28, 1.05, 30), show=DAG),
    ]


@anim("dagger_3", 20, phases=(1, 1, 2))
def a_dagger_3():
    return [
        F(6, hip=(0.0, -0.18), fn=plant(0.26), ff=plant(-0.26, -10), hn=(-0.05, 0.8, -60), hf=(-0.12, 0.85, -70), show=DAG),
        F(12, hip=(0.12, -0.12), fn=plant(0.40), ff=plant(-0.26, -25), hn=(0.50, 1.32, 42), hf=(0.46, 1.12, 22), show=DAG,
          vel=(2.5, 1.0), fx=[("trail", 0, "dagger_n", 0, 1.0), ("trail", 1, "dagger_f", 0, 1.0)]),
        F(6, hip=(0.08, -0.08), fn=plant(0.34), ff=plant(-0.24, -10), hn=(0.38, 1.3, 55), hf=(0.34, 1.1, 40), show=DAG),
        F(2, hip=(0.03, -0.06), fn=plant(0.24), ff=plant(-0.24), hn=(0.28, 1.05, 40), hf=(0.22, 1.0, 40), show=DAG),
    ]


@anim("dagger_4", 18, phases=(1, 2, 2))
def a_dagger_4():
    return [
        F(-8, hip=(-0.08, -0.22), fn=plant(0.20), ff=plant(-0.30, -10), hn=(-0.30, 1.0, 120), hf=(-0.32, 1.12, 100), show=DAG),
        F(18, hip=(0.26, -0.04), fn=plant(0.52, -10), ff=plant(-0.30, -45), hn=(0.50, 1.22, 12), hf=(0.46, 1.04, 4), show=DAG,
          vel=(4.5, 0.5), ground=0.05, fx=[("trail", 0, "dagger_n", 0, 1.2), ("trail", 1, "dagger_f", 0, 1.2)]),
        F(20, hip=(0.32, -0.02), fn=plant(0.56, -10), ff=plant(-0.30, -50), hn=(0.58, 1.18, 8), hf=(0.54, 1.0, 0), show=DAG,
          vel=(4.0, 0.0), ground=0.04),
        F(10, hip=(0.16, -0.12), fn=plant(0.42), ff=plant(-0.26, -20), hn=(0.40, 1.05, 20), hf=(0.34, 0.98, 20), show=DAG),
        F(3, hip=(0.04, -0.08), fn=plant(0.24), ff=plant(-0.24), hn=(0.28, 1.0, 35), hf=(0.22, 1.0, 40), show=DAG),
    ]


# ---------------------------------------------------------------------------
# HAMMER

HAM = ["hammer"]


@anim("hammer_1", 12, phases=(4, 2, 4))
def a_hammer_1():
    g = grip("hammer", 0.22)
    return [
        F(2, hip=(0.0, -0.08), fn=plant(0.22), ff=plant(-0.24), hn=(0.30, 0.95, 40), hf=g, show=HAM),
        F(-6, hip=(-0.03, -0.04), fn=plant(0.18), ff=plant(-0.26), hn=(0.15, 1.35, 75), hf=g, show=HAM),
        F(-12, hip=(-0.06, 0.0), fn=plant(0.14, -10), ff=plant(-0.26, -10), hn=(-0.05, 1.75, 105), hf=g, show=HAM),
        F(-18, hip=(-0.09, 0.02), fn=plant(0.12, -15), ff=plant(-0.28, -20), hn=(-0.15, 1.9, 126), hf=g, show=HAM),
        F(22, hip=(0.18, -0.16), fn=plant(0.50), ff=plant(-0.26, -30), hn=(0.50, 1.28, 12), hf=g, show=HAM,
          vel=(3.0, -1.0), smear=[SM("hammer", 3, dir=-1, width=0.34, bulge=1.02)]),
        F(26, hip=(0.22, -0.22), fn=plant(0.56), ff=plant(-0.26, -35), hn=(0.62, 0.98, -34), hf=g, show=HAM,
          vel=(2.0, -1.0), fx=[dust(1.45, 0.04, 1.6, 1.4), ("obj", "spark", (1.5, -0.2, 0.18), (1.3, 1, 1.3), 10)]),
        F(25, hip=(0.20, -0.22), fn=plant(0.54), ff=plant(-0.26, -35), hn=(0.60, 0.96, -38), hf=g, show=HAM,
          fx=[dust(1.5, 0.06, 2.0, 1.8)]),
        F(20, hip=(0.16, -0.18), fn=plant(0.48), ff=plant(-0.26, -25), hn=(0.50, 1.08, -20), hf=g, show=HAM,
          fx=[dust(1.55, 0.08, 1.8, 2.0)]),
        F(12, hip=(0.10, -0.12), fn=plant(0.36), ff=plant(-0.26, -10), hn=(0.38, 1.1, 5), hf=g, show=HAM),
        F(4, hip=(0.04, -0.08), fn=plant(0.26), ff=plant(-0.24), hn=(0.26, 1.05, 30), hf=g, show=HAM),
    ]


@anim("hammer_2", 12, phases=(3, 2, 4))
def a_hammer_2():
    g = grip("hammer", 0.18)
    return [
        F(4, hip=(0.0, -0.16), fn=plant(0.26), ff=plant(-0.26, -10), hn=(0.12, 0.95, -112), hf=g, show=HAM),
        F(8, hip=(-0.06, -0.22), fn=plant(0.24), ff=plant(-0.34, -15), hn=(0.0, 0.95, -135), hf=g, show=HAM),
        F(10, hip=(-0.04, -0.24), fn=plant(0.24), ff=plant(-0.36, -18), hn=(-0.12, 0.98, -150), hf=g, show=HAM),
        F(18, hip=(0.18, -0.20), fn=plant(0.52), ff=plant(-0.28, -35), hn=(0.50, 0.96, -62), hf=g, show=HAM,
          vel=(3.5, 0), smear=[SM("hammer", 2, dir=1, width=0.34, center=(0.0, 1.0))]),
        F(20, hip=(0.22, -0.18), fn=plant(0.56), ff=plant(-0.28, -40), hn=(0.62, 1.0, -20), hf=g, show=HAM,
          vel=(3.0, 0), fx=[dust(0.9, 0.04, 1.6, 1.2)]),
        F(18, hip=(0.20, -0.16), fn=plant(0.52), ff=plant(-0.28, -35), hn=(0.58, 1.12, 20), hf=g, show=HAM, vel=(1.0, 0)),
        F(12, hip=(0.14, -0.12), fn=plant(0.44), ff=plant(-0.26, -20), hn=(0.46, 1.1, 5), hf=g, show=HAM),
        F(6, hip=(0.08, -0.1), fn=plant(0.34), ff=plant(-0.26, -10), hn=(0.34, 1.0, -10), hf=g, show=HAM),
        F(2, hip=(0.04, -0.08), fn=plant(0.26), ff=plant(-0.24), hn=(0.26, 1.0, 20), hf=g, show=HAM),
    ]


# ---------------------------------------------------------------------------
# BOW

BOW = ["bow"]


def bow_pose(draw, lean=-3, **kw):
    """draw 0..1: how far the string hand is pulled back."""
    nx = lerp(0.30, -0.10, draw)
    nz = lerp(1.30, 1.46, draw)
    return F(lean, hip=(-0.02 * draw, -0.08), fn=plant(0.22), ff=plant(-0.24),
             hn=(nx, nz, 90, -1), hf=(0.46, 1.40, 90), show=BOW, **kw)


@anim("bow_draw", 12, loop=False)
def a_bow_draw():
    out = []
    for i, d in enumerate((0.0, 0.35, 0.7, 1.0)):
        out.append(bow_pose(d, fx=[("string", True), ("arrow",)]))
    return out


@anim("bow_shoot", 14, phases=(1, 1, 2))
def a_bow_shoot():
    return [
        bow_pose(1.0, fx=[("string", True), ("arrow",)]),
        F(-5, hip=(-0.04, -0.08), fn=plant(0.22), ff=plant(-0.24), hn=(-0.30, 1.44, 90, -1), hf=(0.50, 1.42, 92), show=BOW,
          fx=[("string", False), ("line", 0, (0.7, -0.3, 1.40), (1.7, -0.3, 1.42), 0.8)], vel=(-0.5, 0)),
        F(-1, hip=(0.0, -0.08), fn=plant(0.22), ff=plant(-0.24), hn=(-0.22, 1.3, 90, -1), hf=(0.44, 1.38, 95), show=BOW,
          fx=[("string", False)]),
        F(2, hip=(0.0, -0.08), fn=plant(0.2), ff=plant(-0.22), hn=(0.05, 1.05, 60), hf=(0.34, 1.18, 90), show=BOW,
          fx=[("string", False)]),
    ]


# ---------------------------------------------------------------------------
# SHIELD

SHD = ["shield"]


@anim("shield_block", 12, loop=False)
def a_shield_block():
    return [
        F(2, hip=(0.0, -0.08), fn=plant(0.2), ff=plant(-0.26), hn=(0.16, 1.34, 180), hf=(-0.1, 1.0, 20), show=SHD),
        F(6, hip=(0.03, -0.12), fn=plant(0.26), ff=plant(-0.28, -5), hn=(0.28, 1.36, 180), hf=(-0.1, 1.0, 20), show=SHD),
        F(8, hip=(0.04, -0.14), fn=plant(0.28), ff=plant(-0.3, -8), hn=(0.32, 1.37, 180), hf=(-0.12, 1.02, 20), show=SHD),
    ]


@anim("shield_parry", 16, phases=(1, 2, 2))
def a_shield_parry():
    return [
        F(-4, hip=(-0.05, -0.12), fn=plant(0.22), ff=plant(-0.30, -5), hn=(0.05, 1.36, 180), hf=(-0.1, 1.0, 20), show=SHD),
        F(14, hip=(0.14, -0.12), fn=plant(0.44), ff=plant(-0.28, -25), hn=(0.52, 1.36, 180), hf=(-0.05, 1.05, 30), show=SHD,
          vel=(3.0, 0), fx=[("obj", "spark", (0.95, -0.3, 1.35), (1.3, 1, 1.3), 0)]),
        F(16, hip=(0.17, -0.12), fn=plant(0.46), ff=plant(-0.28, -28), hn=(0.58, 1.36, 180), hf=(-0.05, 1.05, 30), show=SHD,
          vel=(2.0, 0)),
        F(10, hip=(0.10, -0.12), fn=plant(0.38), ff=plant(-0.28, -15), hn=(0.42, 1.36, 180), hf=(-0.08, 1.0, 20), show=SHD),
        F(4, hip=(0.04, -0.1), fn=plant(0.28), ff=plant(-0.26), hn=(0.30, 1.36, 180), hf=(-0.1, 1.0, 20), show=SHD),
    ]


# ---------------------------------------------------------------------------
# main


def build_scene():
    common.reset_scene()
    # warm key from the upper front (camera side), cool rim from behind is in the materials
    common.add_sun((-0.45, 0.55, -0.70), energy=3.2, color=(1.0, 0.95, 0.88))
    sc = __import__("bpy").context.scene
    sc.eevee.shadow_cube_size = "512"
    sc.eevee.shadow_cascade_size = "1024"
    M = L.make_materials()
    h = L.Heroine(M)
    h.chains = L.make_chains(h)
    common.setup_sprite_camera(FW, FH, AX, AY, yaw_deg=20.0, pitch_deg=4.0)
    return h


def measure(h, posed, specs):
    """World positions per frame used by fx (blade tips, hands, feet)."""
    rig = h.rig
    out = []
    for (a, off, _pts), sp in zip(posed, specs):
        scl = {}
        if "sc" in sp:
            scl["root"] = (sp["sc"][0], 1.0, sp["sc"][1])
        rig.pose(a, off, scl)
        L.update()
        m = {}
        for j in ("sh_n", "sh_f", "el_n", "el_f", "ha_n", "ha_f", "an_n", "an_f", "head", "chest", "hips"):
            m[j] = L.wpos(rig, j).copy()
        for pname, (tip, mid) in h.tip_local.items():
            ob = h.prop_root[pname]
            m[pname] = ((ob.matrix_world @ tip).copy(), (ob.matrix_world @ mid).copy())
        bow = h.prop_root["bow"]
        m["bow_tips"] = tuple((bow.matrix_world @ p).copy() for p in h.bow_tips)
        m["bow_grip"] = (bow.matrix_world @ Vector((0, 0, 0))).copy()
        m["nock"] = L.wpos(rig, "ha_n", (0.03, 0, -0.05)).copy()
        out.append(m)
    return out


def make_smear(h, name, meas, sm, frame):
    """Crescent following the weapon tip arc between two frames."""
    prop = sm["prop"]
    i0 = sm["from"]
    i1 = sm.get("to", frame)
    t0, _ = meas[i0][prop]
    t1, m1 = meas[i1][prop]
    if "center" in sm and isinstance(sm["center"], str):
        c = meas[i1][sm["center"]]
    elif "center" in sm:
        c = Vector((sm["center"][0], 0, sm["center"][1]))
    else:
        c = meas[i1]["sh_n"]
    cx, cz = c.x, c.z
    a0 = math.atan2(t0.z - cz, t0.x - cx)
    a1 = math.atan2(t1.z - cz, t1.x - cx)
    d = sm.get("dir", -1)
    span = a1 - a0
    if d < 0:
        while span > 0:
            span -= 2 * math.pi
    else:
        while span < 0:
            span += 2 * math.pi
    span -= d * math.radians(sm.get("trim", 6))
    r0 = math.hypot(t0.x - cx, t0.z - cz)
    r1 = math.hypot(t1.x - cx, t1.z - cz)
    frac = sm.get("frac", 0.65)
    a0 = a0 + span * (1.0 - frac)
    r0 = lerp(r0, r1, 1.0 - frac)
    span *= frac
    width = sm.get("width", 0.45)
    y = sm.get("y", -0.26)
    K = 14
    outer, inner = [], []
    tan20 = math.tan(math.radians(20))
    for k in range(K + 1):
        u = k / K
        ang = a0 + span * u
        r = lerp(r0, r1, u) * sm.get("bulge", 1.0) ** math.sin(math.pi * u)
        w = width * (math.sin(math.pi * min(1.0, u * 0.85 + 0.12)) ** 0.8) * (0.25 + 0.75 * u)
        ox, oz = cx + r * math.cos(ang), cz + r * math.sin(ang)
        ix, iz = cx + (r - w) * math.cos(ang), cz + (r - w) * math.sin(ang)
        # keep the screen position of the blade plane while moving the strip in front
        dy = meas[i1][prop][0].y - y
        outer.append((ox + dy * tan20, y, oz))
        inner.append((ix + dy * tan20, y, iz))
    return L.smear_mesh(name, outer, inner, h.M[sm.get("mat", "smear")])


def fx_builder(h, meas, specs, smears):
    def fx(i, n, sp):
        out = {}
        for (fi, ob) in smears:
            if fi == i:
                out[ob] = None
        m = meas[i]
        for f in sp.get("fx", []):
            kind = f[0]
            if kind == "string":
                ta, tb = m["bow_tips"]
                nk = m["nock"] if f[1] else (ta + tb) * 0.5
                for nm, tp in (("str_a", ta), ("str_b", tb)):
                    ob = h.fx[nm]
                    d = nk - tp
                    q = (-d).normalized().to_track_quat("Z", "Y")
                    out[ob] = (tp, q, (1, 1, max(d.length, 1e-3)))
            elif kind == "arrow":
                nk = m["nock"]
                g = m["bow_grip"]
                d = (g - nk).normalized()
                q = d.to_track_quat("Z", "Y")
                out[h.fx["arrow"]] = (nk - d * 0.02, q, (1, 1, 1))
            elif kind == "obj":
                # ("obj", fxname, (x, y, z), scale(sx,sy,sz), rot_deg_about_Y)
                ob = h.fx[f[1]]
                rot = f[4] if len(f) > 4 else 0.0
                q = Quaternion((0, 1, 0), -math.radians(rot))
                out[ob] = (Vector(f[2]), q, f[3])
            elif kind == "streak":
                ob = h.fx[f[1]]
                p0 = Vector(f[2])
                out[ob] = (p0, Quaternion((1, 0, 0), math.pi), (1, 1, f[3]))
            elif kind in ("line", "trail"):
                # ("line", k, p0, p1[, w])  /  ("trail", k, prop, from_frame[, w]) : tapered light streak p0 -> p1
                ob = h.fx["streak%d" % f[1]]
                if kind == "line":
                    p0, p1 = Vector(f[2]), Vector(f[3])
                else:
                    p0 = meas[f[3]][f[2]][0].copy()
                    p1 = meas[i][f[2]][0].copy()
                    p0 = p1.lerp(p0, 0.9)
                    p0.y = p1.y = -0.3
                w = f[4] if len(f) > 4 else 1.0
                d = p1 - p0
                q = (-d).normalized().to_track_quat("Z", "Y")
                out[ob] = (p0, q, (w, w, max(d.length, 1e-3)))
        return out
    return fx


def render_anim(h, entry):
    name, fps, loop, phases, fn, opts = entry
    specs = fn()
    if phases:
        assert sum(phases) == len(specs), (name, phases, len(specs))
    h.chains = L.make_chains(h)
    for ch in h.chains:
        for k, v in opts.get("chain", {}).get(ch.joints[0][:2] if ch.joints[0] != "pt0" else "pony", {}).items():
            setattr(ch, k, v)
    posed = L.solve_frames(h, specs, fps, loop, pre=opts.get("pre"), wind=opts.get("wind", (0.0, 0.0)),
                           seed_phase=opts.get("seed", 0.0))
    meas = measure(h, posed, specs)
    if os.environ.get("HARM"):
        for i in range(len(specs)):
            m = meas[i]
            print("ARM %s %d sh(%.2f,%.2f) el(%.2f,%.2f) ha(%.2f,%.2f)" % (name, i, m["sh_n"].x, m["sh_n"].z, m["el_n"].x, m["el_n"].z, m["ha_n"].x, m["ha_n"].z))
    for i, sp in enumerate(specs):
        for pn in sp.get("show", []):
            if pn in meas[i] and isinstance(meas[i][pn], tuple):
                t = meas[i][pn][0]
                print("REACH %s %d %-7s tip x=%5.1f z=%5.1f px" % (name, i, pn, t.x * 32, t.z * 32))
    if os.environ.get("HDEBUG"):
        for i, (a, off, pts) in enumerate(posed):
            row = []
            for p in pts:
                angs = []
                for k in range(len(p) - 1):
                    d = p[k + 1] - p[k]
                    angs.append("%4d" % round(math.degrees(math.atan2(d.x, -d.y))))
                row.append(" ".join(angs))
            print("DBG %s %d | %s" % (name, i, " | ".join(row)))
    smears = []
    for i, sp in enumerate(specs):
        for k, sm in enumerate(sp.get("smear", [])):
            smears.append((i, make_smear(h, "smear_%s_%d_%d" % (name, i, k), meas, sm, i)))
    # ponytail + scarf meshes per frame (ponytail ember dims at the end of death)
    dim = opts.get("dim_from")
    for i, (a, off, pts) in enumerate(posed):
        for ob in L.chain_objects(h, "%s%d" % (name, i), pts, specs[i], phase=i * 0.9,
                                  dim=dim is not None and i >= dim):
            smears.append((i, ob))
    fx = fx_builder(h, meas, specs, smears)
    L.render_frames(h, name, posed, specs, OUT, fx_fn=fx, extra_objs=[o for _, o in smears])
    import bpy
    for _, ob in smears:
        bpy.data.objects.remove(ob, do_unlink=True)
    return len(specs)


def write_spec():
    anims = []
    for name, fps, loop, phases, fn, opts in ANIMS:
        if opts.get("test"):
            continue
        e = {"name": name, "fps": fps, "loop": loop}
        if phases:
            e["windup"], e["active"], e["recover"] = phases
        anims.append(e)
    spec = {"frameW": FW, "frameH": FH, "anchor": [AX, AY], "outline": True, "colors": 0,
            "out": "sprites/heroine.png", "animations": anims}
    with open(os.path.join(OUT, "spec.json"), "w") as f:
        json.dump(spec, f, indent=1)


def main():
    args = common.script_args()
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    if not args:
        for fn in os.listdir(OUT):
            if fn.endswith(".png"):
                os.remove(os.path.join(OUT, fn))
    h = build_scene()
    total = 0
    for entry in ANIMS:
        if args and entry[0] not in args:
            continue
        if not args and entry[5].get("test"):
            continue
        t1 = time.time()
        total += render_anim(h, entry)
        print("HEROINE %-14s %5.1fs" % (entry[0], time.time() - t1))
    write_spec()
    print("HEROINE done: %d frames in %.1fs" % (total, time.time() - t0))


main()
