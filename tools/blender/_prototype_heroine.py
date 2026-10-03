import sys, math, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import importlib, common
importlib.reload(common)
from common import *
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "build", "frames", "_prototype")
args = script_args()
YAW = float(args[0]) if args else 20

reset_scene()
add_sun((0.5, 0.6, -0.7), energy=3.2)
RIM = "#9fe8ff"
skin = toon("skin", "#efcbb6", "#a8737f", "#fff0e6", rim=RIM)
hair = toon("hair", "#d8dff0", "#7d7fa8", "#ffffff", rim=RIM)
top = toon("top", "#24566a", "#132a3c", "#3d8197", rim=RIM)
skirt = toon("skirt", "#9a1f33", "#4f0f2a", "#cf3a48", rim=RIM)
legs = toon("legs", "#2a2740", "#15142a", "#423d5e", rim=RIM)
boots = toon("boots", "#5a3328", "#2c1820", "#7d4a37", rim=RIM)
steel = toon("steel", "#9aa3b8", "#4f566e", "#e4ebf7", rim=RIM)
gold = toon("gold", "#d9a441", "#8a5527", "#ffe08a")
scarf = toon("scarf", "#d02c40", "#6e1530", "#ff5a5f", rim=RIM)
eye = toon("eye", "#000000", emission="#8ff7ff")
glow = toon("glow", "#000000", emission="#7ff6ff")

r = Rig()
J = r.joint
J("hips", "root", (0, 0, 0.92))
J("spine", "hips", (0, 0, 1.04))
J("chest", "spine", (0, 0, 1.2))
J("neck", "chest", (0, 0, 1.44))
J("head", "neck", (0, 0, 1.52))
for s, y in (("n", -0.12), ("f", 0.12)):
    J("sh_" + s, "chest", (0, y, 1.38))
    J("el_" + s, "sh_" + s, (0, y, 1.13))
    J("ha_" + s, "el_" + s, (0, y, 0.92))
for s, y in (("n", -0.075), ("f", 0.075)):
    J("th_" + s, "hips", (0, y, 0.9))
    J("kn_" + s, "th_" + s, (0, y, 0.49))
    J("an_" + s, "kn_" + s, (0, y, 0.08))
J("pony", "head", (-0.1, 0, 1.68))
J("pony1", "pony", (-0.2, 0, 1.58))
J("pony2", "pony1", (-0.27, 0, 1.42))
J("scarf", "chest", (-0.06, 0, 1.45))
J("scarf1", "scarf", (-0.26, 0, 1.40))
J("scarf2", "scarf1", (-0.46, 0, 1.33))

A = r.attach
# torso
A(ellipsoid("pelvis", (0.27, 0.3, 0.22), legs), "hips", (-0.01, 0, 0.0))
A(ellipsoid("waist", (0.2, 0.24, 0.24), top), "spine", (0, 0, 0.03))
A(ellipsoid("chestm", (0.27, 0.3, 0.3), top), "chest", (0.0, 0, 0.06))
A(ellipsoid("bust", (0.14, 0.26, 0.13), top), "chest", (0.08, 0, 0.06))
A(cone("skirtc", 0.27, 0.15, 0.3, skirt, loc=(0, 0, -0.27), depth_scale=1.15), "hips", (-0.01, 0, 0))
A(ellipsoid("belt", (0.25, 0.29, 0.06), boots), "hips", (0, 0, 0.06))
A(box("buckle", (0.04, 0.05, 0.05), gold), "hips", (0.12, 0, 0.06))
A(ellipsoid("collar", (0.18, 0.24, 0.07), steel), "chest", (0, 0, 0.2))
# head
A(limb("neckm", 0.12, 0.05, 0.05, skin), "neck", (0, 0, 0.1))
A(ellipsoid("headm", (0.21, 0.2, 0.24), skin), "head", (0.01, 0, 0.11))
A(ellipsoid("hairc", (0.25, 0.23, 0.2), hair), "head", (-0.025, 0, 0.17))
A(ellipsoid("bangs", (0.12, 0.2, 0.11), hair), "head", (0.07, 0, 0.19))
A(ellipsoid("eye", (0.025, 0.12, 0.03), eye), "head", (0.1, 0, 0.12))
# ponytail
A(ellipsoid("pt0", (0.14, 0.12, 0.14), hair), "pony", (0, 0, 0))
A(limb("pt1", 0.17, 0.065, 0.06, hair), "pony1", (0, 0, 0.0), rot=(0, -30, 0))
A(limb("pt2", 0.2, 0.06, 0.03, hair), "pony2", (0, 0, 0))
A(ellipsoid("pt3", (0.05, 0.05, 0.07), glow), "pony2", (0, 0, -0.21))
# scarf
A(limb("sc1", 0.22, 0.05, 0.045, scarf, depth_scale=0.5), "scarf1", (0, 0, 0.04), rot=(0, -80, 0))
A(limb("sc2", 0.22, 0.045, 0.02, scarf, depth_scale=0.5), "scarf2", (0, 0, 0.02), rot=(0, -75, 0))
A(ellipsoid("sc0", (0.2, 0.28, 0.08), scarf), "scarf", (0.04, 0, 0))
# arms
for s in ("n", "f"):
    A(ellipsoid("pauld_" + s, (0.14, 0.12, 0.1), steel), "sh_" + s, (0, 0, 0.0))
    A(limb("ua_" + s, 0.24, 0.048, 0.04, skin), "sh_" + s)
    A(limb("fa_" + s, 0.2, 0.045, 0.035, steel), "el_" + s)
    A(ellipsoid("hand_" + s, (0.07, 0.06, 0.08), skin), "ha_" + s, (0, 0, -0.03))
    A(limb("thm_" + s, 0.41, 0.085, 0.055, legs), "th_" + s)
    A(limb("shin_" + s, 0.41, 0.06, 0.045, boots), "kn_" + s)
    A(box("foot_" + s, (0.17, 0.08, 0.07), boots, bevel=0.02), "an_" + s, (0.04, 0, -0.045))

# sword (in near hand)
sword = blade("sword", 0.62, 0.07, 0.02, steel)
hilt = box("hilt", (0.04, 0.03, 0.14), boots, loc=(0, 0, -0.07))
guard = box("guard", (0.04, 0.16, 0.03), gold)
sw = join([sword, hilt, guard], "swordm")
A(sw, "ha_n", (0, -0.03, -0.04), rot=(0, 100, 0))

setup_sprite_camera(128, 112, 64, 100, yaw_deg=YAW, pitch_deg=4)

def run_pose(i, n):
    t = i / n * 2 * math.pi
    s = math.sin(t)
    c = math.cos(t)
    ang = {
        "hips": -12, "spine": -6, "chest": -4, "neck": 6, "head": 4,
        "th_n": 40 * s - 5, "th_f": -40 * s - 5,
        "kn_n": -45 * max(0, -s) - 15 - 25 * max(0, c), "kn_f": -45 * max(0, s) - 15 - 25 * max(0, -c),
        "an_n": 15 * s, "an_f": -15 * s,
        "sh_n": -45 * s, "sh_f": 45 * s, "el_n": 70, "el_f": 70,
        "pony": -60 - 8 * c, "pony1": 25 + 10 * s, "pony2": 10 + 12 * c,
        "scarf": -10 + 6 * s, "scarf1": 8 * c, "scarf2": 10 * s,
    }
    off = {"hips": (0, 0, -0.04 + 0.04 * abs(c))}
    return ang, off, {}

def idle_pose(i, n):
    t = i / n * 2 * math.pi
    s = math.sin(t)
    ang = {"hips": 0, "spine": 2 * s, "chest": 2 + 2 * s, "head": -2,
           "th_n": 12, "th_f": -8, "kn_n": -10, "kn_f": -4, "an_n": -3, "an_f": 12,
           "sh_n": 10 + 3 * s, "sh_f": -6 + 3 * s, "el_n": 25, "el_f": 15,
           "pony": -20 + 4 * s, "pony1": 5, "pony2": 5 * s,
           "scarf": -40 + 4 * s, "scarf1": -20 + 5 * s, "scarf2": -10 + 6 * s}
    return ang, {"hips": (0, 0, -0.02 - 0.01 * s)}, {}

def atk_pose(i, n):
    keys = [(0.0, {"sh_n": 160, "el_n": 30, "chest": 10, "spine": 5, "th_n": 20, "kn_n": -20, "th_f": -20}),
            (0.35, {"sh_n": 170, "el_n": 20, "chest": 15, "spine": 8, "th_n": 25, "kn_n": -25, "th_f": -25}),
            (0.55, {"sh_n": 20, "el_n": 5, "chest": -15, "spine": -10, "th_n": 35, "kn_n": -35, "th_f": -30}),
            (1.0, {"sh_n": -10, "el_n": 20, "chest": -12, "spine": -8, "th_n": 30, "kn_n": -30, "th_f": -28})]
    a = sample_keys(keys, i / max(1, n - 1))
    a.update({"pony": -40, "scarf": -30, "scarf1": -10})
    return a, {"hips": (0.0, 0, -0.06)}, {}

for name, n, fn in (("idle", 8, idle_pose), ("run", 10, run_pose), ("atk", 8, atk_pose)):
    render_animation(r, name, n, fn, OUT + "/y%d" % int(YAW))
