"""The Iron Matron (boss) sprite sheet.

blender -b --factory-startup -P tools/blender/asset_matron.py [-- anim ...]
  -> build/frames/matron/<anim>_###.png + spec.json   (frame 288x224, anchor (144,212))

With anim names after `--` only those animations are re-rendered (for iteration);
the spec always lists every animation.
"""
import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import script_args, reset_scene, add_sun, setup_sprite_camera, ease  # noqa: E402
from lib_boss import (build_matron, FX, anim_render, frames_dir, write_spec, mesh_object,  # noqa: E402
                      ellipsoid, bake, ROOT)

FW, FH, AX, AY = 288, 224, 144, 212
ONLY = script_args()

reset_scene()
add_sun((0.5, 0.6, -0.7), energy=3.2)
m = build_matron()
rig, P, MT = m.rig, m.P, m.M
setup_sprite_camera(FW, FH, AX, AY, yaw_deg=20, pitch_deg=4)
fx = FX()
for k, ob in enumerate(m.eyes_hot):
    fx.add("hot%d" % k, ob, default=False)
for k, ob in enumerate(m.eyes):
    fx.add("eye%d" % k, ob, default=True)

CHAIN = P.length("fl0", "fl1") + P.length("fl1", "bell")
D2R = math.pi / 180.0

# --------------------------------------------------------------------------
# bell geometry helpers (local bell frame: axis along -Z from the chain joint)
BELL_PTS = [(0, -0.05), (0.32, -0.18), (-0.32, -0.18), (0.6, -0.7), (-0.6, -0.7),
            (0.64, -1.05), (-0.64, -1.05), (0.6, -1.11), (-0.6, -1.11)]


def rot(a, x, z):
    c, s = math.cos(a * D2R), math.sin(a * D2R)
    return x * c - z * s, x * s + z * c


def bell_world(jx, jz, a):
    return [(jx + rot(a, px, pz)[0], jz + rot(a, px, pz)[1]) for px, pz in BELL_PTS]


def gz(a):
    """Height of the bell joint so that a bell at world angle `a` rests on the floor."""
    return -min(rot(a, px, pz)[1] for px, pz in BELL_PTS) - 0.015


def bell_tip(jx, jz, a):
    """Far end (mouth centre) of the bell."""
    dx, dz = rot(a, 0, -1.08)
    return jx + dx, jz + dz


# --------------------------------------------------------------------------
# pose keys -> joint angles

CLOTH = ("braid", "braid1", "braid2", "braid3", "braid4", "cape", "cape1", "cape2", "cape3", "tab", "tab1")


def resolve(p):
    """p: flat pose dict.  Returns (ang, off, scales, twists, W, bell(x,z,a))."""
    spec, off, tw = {}, {}, {}
    for k, v in p.items():
        if k.startswith("off_"):
            off[k[4:]] = v
        elif k.startswith("tw_"):
            tw[k[3:]] = v
        elif k in ("ca", "cl", "ba", "bpx", "bpz", "bw", "far_grip"):
            continue
        else:
            spec[k] = v
    # pass 1: body + near arm, to know where the near fist is
    ang, W = P.solve(spec, off)
    fx0, fz0, _ = W["fl0"]
    ca, cl = p.get("ca", 0.0), p.get("cl", 1.0)
    tx = fx0 + cl * CHAIN * math.sin(ca * D2R)
    tz = fz0 - cl * CHAIN * math.cos(ca * D2R)
    bw = p.get("bw", 0.0)
    if bw > 0:
        tx = tx + (p["bpx"] - tx) * bw
        tz = tz + (p["bpz"] - tz) * bw
    spec["reach_fl0"] = (tx, tz, p.get("ba", ca))
    if p.get("far_grip"):
        hx, hz, ha = W["ha_n"]
        g = p["far_grip"]
        spec["ik_sh_f"] = (hx + g[0], hz + g[1], ha, -1)
    ang, W = P.solve(spec, off)
    for s in ("n", "f"):
        a = (ang.get("sh_" + s, 0.0) + 180.0) % 360.0 - 180.0
        ang["pa_" + s] = max(-45.0, min(55.0, 0.35 * a))
    bx, bz, ba = W["bell"]
    return ang, off, {}, tw, W, (bx, bz, ba)


def lerp(a, b, t):
    if a is None or b is None:
        return b if t >= 0.5 else a
    if isinstance(a, tuple):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a + (b - a) * t


EASES = {
    "s": ease,                                   # smoothstep
    "l": lambda t: t,                             # linear
    "i": lambda t: t * t,                         # ease in (accelerate into impact)
    "o": lambda t: 1 - (1 - t) * (1 - t),         # ease out (decelerate)
    "h": lambda t: 0.0,                           # hold previous key until the next
}


def keyed(keys, t):
    """keys: [(time, pose_dict[, ease])]; ease applies to the segment ENDING at that key."""
    if t <= keys[0][0]:
        return dict(keys[0][1])
    for k0, k1 in zip(keys, keys[1:]):
        t0, p0 = k0[0], k0[1]
        t1, p1 = k1[0], k1[1]
        if t0 <= t <= t1:
            e = EASES[k1[2] if len(k1) > 2 else "s"]
            u = e(0 if t1 == t0 else (t - t0) / (t1 - t0))
            out = {}
            for k in set(p0) | set(p1):
                if k in p0 and k in p1:
                    out[k] = lerp(p0[k], p1[k], u)
                else:
                    out[k] = p1[k] if k in p1 else p0[k]
            return out
    return dict(keys[-1][1])


def merge(*ds, **kw):
    out = {}
    for d in ds:
        out.update(d)
    out.update(kw)
    return out


# --------------------------------------------------------------------------
# reference poses

def cloth(braid=(-50, -16, -8, -5, -3), cape=(-2, -3, -4, -5), tab=(0, 0)):
    d = {}
    for j, v in zip(CLOTH[:5], braid):
        d[j + "@"] = v
    for j, v in zip(CLOTH[5:9], cape):
        d[j + "@"] = v
    d["tab@"], d["tab1@"] = tab
    return d


STANCE_N = (-0.34, 0.17, 0.0)   # near (right) foot back
STANCE_F = (0.40, 0.17, 0.0)    # far (left) foot forward

IDLE = merge(
    cloth(),
    {"off_hips": (0.0, 0, -0.1), "hips": -4, "spine": -5, "chest": -8, "neck": 6, "head": 10, "jaw": 0,
     "ik_th_n": STANCE_N, "ik_th_f": STANCE_F,
     "sh_n@": 22, "el_n": 38, "ha_n": -10,
     "sh_f@": -14, "el_f": 28, "ha_f": 0,
     "ca": 20.0, "cl": 0.8, "ba": 0.0, "bpx": 1.0, "bpz": gz(0.0), "bw": 1.0,
     "tw_head": -18, "tw_neck": 0})


# --------------------------------------------------------------------------
# FX: smear crescents and impact dust, generated from the pose functions

FX_OBS = []


def smear_mesh(name, inner, outer, mat):
    """Crescent ribbon between two point paths (tail first), at the bell's depth (slightly behind)."""
    n = len(inner)
    verts, faces = [], []
    y = -0.6 + 0.35
    for k in range(n):
        u = k / (n - 1)
        w = u ** 0.6  # taper toward the tail
        ix, iz = inner[k]
        ox, oz = outer[k]
        verts.append((ox + (ix - ox) * w, y, oz + (iz - oz) * w))
        verts.append((ox, y, oz))
    for k in range(n - 1):
        a = 2 * k
        faces.append((a, a + 2, a + 3, a + 1))
    ob = mesh_object(name, verts, faces, mat, smooth_shade=False)
    from lib_boss import solidify
    solidify(ob, 0.06)
    return ob


def make_smear(name, fn, n, i0, i1, inner_r=0.25, steps=10):
    """Smear following the bell between fractional frames i0 -> i1 (tail -> head)."""
    inner, outer = [], []
    for k in range(steps + 1):
        fi = i0 + (i1 - i0) * k / steps
        res = fn(fi, n)
        bx, bz, ba = res[5]
        cx, cz = bell_tip(bx, bz, ba)
        mx, mz = bx + (cx - bx) * inner_r, bz + (cz - bz) * inner_r
        # outer edge: mouth rim on the far side of travel
        ox, oz = rot(ba, 0.0, -1.1)
        outer.append((bx + ox * 1.0, bz + oz * 1.0))
        inner.append((mx, mz))
    ob = smear_mesh(name, inner, outer, MT.smear)
    return ob


def make_dust(name, x, scale=1.0, seed=0):
    import random
    rnd = random.Random(seed)
    parts = []
    for k in range(7):
        dx = (k - 3) * 0.32 * scale + rnd.uniform(-0.08, 0.08)
        s = (0.36 - abs(k - 3) * 0.05) * scale
        ob = ellipsoid(name + "_p%d" % k, (s * 1.4, 0.4, s), MT.dust,
                       loc=(x + dx, -0.85, 0.06 + s * 0.4 + rnd.uniform(0, 0.08)), segs=8, rings=6)
        parts.append(bake(ob))
    for k in range(5):
        dx = (k - 2) * 0.45 * scale + rnd.uniform(-0.1, 0.1)
        h = (0.5 + rnd.uniform(0, 0.45) - abs(k - 2) * 0.1) * scale
        ob = ellipsoid(name + "_r%d" % k, (0.13, 0.13, 0.11), MT.rock,
                       loc=(x + dx, -0.9, h), rot=(rnd.uniform(0, 90), rnd.uniform(0, 90), 0), segs=6, rings=4)
        parts.append(bake(ob))
    from common import join
    return join(parts, name)


# --------------------------------------------------------------------------
# animations

ANIMS = []


def anim(name, n, fps, loop=False, phases=None):
    def deco(fn):
        ANIMS.append(dict(name=name, n=n, fps=fps, loop=loop, phases=phases, fn=fn))
        return fn
    return deco


def T(i, n):
    return i / (n - 1) if n > 1 else 0.0


# ---- idle: heavy breathing, bell resting on the floor, chain slack
@anim("idle", 8, 7, loop=True)
def a_idle(i, n):
    t = i / n * 2 * math.pi
    s, c = math.sin(t), math.cos(t)
    p = merge(IDLE, cloth(braid=(-50 + 2 * s, -16 + 2 * c, -8 + 2 * s, -5 + 2 * c, -3 + 2 * s),
                          cape=(-2 + s, -3 + 1.5 * c, -4 + 2 * s, -5 + 2.5 * c)))
    p["chest"] = -8 + 2.0 * s
    p["spine"] = -5 + 1.0 * s
    p["head"] = 10 - 2.5 * s
    p["off_hips"] = (0.0, 0, -0.1 + 0.025 * s)
    p["sh_n@"] = 22 + 1.5 * s
    p["sh_f@"] = -14 + 2.5 * s
    p["el_f"] = 28 - 2 * s
    p["cl"] = 0.8
    return resolve(p)


# ---- walk: heavy stomp, bell dragged behind on the floor
@anim("walk", 10, 9, loop=True)
def a_walk(i, n):
    t = i / n
    S = 0.86

    def foot(ph):
        ph %= 1.0
        if ph < 0.6:
            u = ph / 0.6
            return (S / 2 - S * u, 0.17, 0.0)
        u = (ph - 0.6) / 0.4
        e = ease(u)
        return (-S / 2 + S * e, 0.17 + 0.3 * math.sin(math.pi * u), -14 * math.sin(math.pi * min(1.0, u * 1.4)))
    fn_ = foot(t)
    ff_ = foot(t + 0.5)
    u2 = (2 * t) % 1.0
    bob = -0.12 - 0.05 * math.cos(2 * math.pi * (u2 - 0.05))
    w = 2 * math.pi * t
    ba = -28 + 3 * math.sin(2 * w)
    p = merge(IDLE, cloth(braid=(-58 + 5 * math.sin(2 * w), -24 + 4 * math.cos(2 * w), -14, -9, -6),
                          cape=(-6 + 2 * math.sin(2 * w), -9 + 2 * math.cos(2 * w), -12 + 3 * math.sin(2 * w), -14),
                          tab=(-6 * math.sin(w), -8 * math.sin(w))))
    p.update({
        "off_hips": (0.04, 0, bob), "hips": -5 + 2 * math.sin(2 * w), "spine": -5, "chest": -7 + 3 * math.sin(w),
        "neck": 6, "head": 9 - 2 * math.sin(2 * w),
        "ik_th_n": fn_, "ik_th_f": ff_,
        "sh_n@": -16 + 4 * math.sin(w), "el_n": 14, "ha_n": -10,
        "sh_f@": 8 + 22 * math.cos(w + 0.3), "el_f": 30 + 10 * math.cos(w),
        "bw": 1.0, "ba": ba, "bpx": -0.95 + 0.05 * math.sin(2 * w), "bpz": gz(ba) + 0.03 * max(0, math.sin(2 * w)),
    })
    return resolve(p)


SLAM_W, SLAM_A, SLAM_R = 7, 2, 5


# ---- slam: overhead bell slam (bell raised high behind for 5+ frames)
SLAM_KEYS = None


def _slam_keys():
    """World angles run continuously: back (-90) -> up (-180) -> forward-down (-300 = 60)."""
    lift = merge(IDLE, cloth(braid=(-40, -10, -5, -3, -2), cape=(4, 6, 8, 8)), {
        "off_hips": (-0.06, 0, -0.22), "hips": -6, "spine": -8, "chest": -10, "neck": 8, "head": 6,
        "ik_th_n": (-0.42, 0.17, 0), "ik_th_f": (0.46, 0.17, 0),
        "sh_n@": -40, "el_n": 20, "ha_n": -10,
        "sh_f@": -20, "el_f": 40,
        "ca": -60, "cl": 1.0, "ba": -60, "bw": 0.0})
    swing = merge(lift, cloth(braid=(-30, -6, -2, 0, 0), cape=(-2, -4, -6, -8)), {
        "off_hips": (-0.14, 0, -0.12), "hips": 2, "spine": 4, "chest": 6, "neck": 0, "head": 4,
        "sh_n@": -125, "el_n": 18, "ca": -112, "ba": -110, "sh_f@": -100, "el_f": 40, "far_grip": (0.06, -0.16)})
    high = merge(swing, cloth(braid=(-25, -8, -6, -4, -3), cape=(-6, -8, -10, -12)), {
        "off_hips": (-0.2, 0, -0.14), "hips": 5, "spine": 8, "chest": 11, "neck": 0, "head": 4,
        "ik_th_n": (-0.48, 0.17, 0), "ik_th_f": (0.52, 0.17, 0),
        "sh_n@": -152, "el_n": 14, "ca": -126, "ba": -124, "sh_f@": -150, "el_f": 20})
    high2 = merge(high, {"off_hips": (-0.24, 0, -0.12), "hips": 7, "spine": 10, "chest": 13, "head": 6,
                         "sh_n@": -158, "ca": -132, "ba": -130})
    mid = merge(high, cloth(braid=(-70, -40, -30, -25, -20), cape=(-30, -40, -50, -55)), {
        "off_hips": (0.15, 0, -0.16), "hips": -8, "spine": -6, "chest": -6, "neck": 4, "head": 4,
        "ik_th_n": (-0.52, 0.17, 0), "ik_th_f": (0.64, 0.17, 0),
        "sh_n@": -212, "el_n": 6, "ca": -250, "ba": -252, "sh_f@": -212, "el_f": 6})
    imp_ba = 62
    impact = merge(mid, cloth(braid=(30, 20, 10, 5, 0), cape=(-20, -10, -2, 4), tab=(10, 14)), {
        "off_hips": (0.34, 0, -0.5), "hips": -16, "spine": -12, "chest": -14, "neck": 14, "head": 18,
        "ik_th_n": (-0.58, 0.17, 0), "ik_th_f": (0.86, 0.17, 0),
        "sh_n@": -298, "el_n": 4, "sh_f@": -298, "el_f": 6,
        "ca": -300, "ba": imp_ba - 360, "bw": 1.0, "bpx": 2.15, "bpz": gz(imp_ba)})
    settle = merge(impact, cloth(braid=(10, 6, 2, 0, -2), cape=(-8, -4, 0, 2), tab=(4, 6)), {
        "off_hips": (0.32, 0, -0.54), "chest": -16, "head": 20})
    rise = merge(settle, cloth(braid=(-30, -12, -6, -3, -2), cape=(-4, -4, -4, -4), tab=(0, 0)), {
        "off_hips": (0.2, 0, -0.32), "hips": -10, "spine": -8, "chest": -10, "head": 14,
        "sh_n@": -310, "el_n": 14, "sh_f@": -340, "el_f": 30, "far_grip": None,
        "ba": -330, "bpx": 1.8, "bpz": gz(30)})
    end = merge(IDLE, {"bpx": 1.2, "far_grip": None, "sh_n@": IDLE["sh_n@"] - 360,
                       "sh_f@": IDLE["sh_f@"] - 360, "ba": -360.0, "ca": IDLE["ca"] - 360})
    n = SLAM_W + SLAM_A + SLAM_R
    f = lambda k: k / (n - 1)  # noqa: E731
    return [(f(0), lift), (f(1), swing, "o"), (f(2), high, "o"), (f(6), high2, "s"),
            (f(7), mid, "i"), (f(8), impact, "i"), (f(9), settle, "o"), (f(11), rise, "s"), (f(13), end, "s")]


@anim("slam", SLAM_W + SLAM_A + SLAM_R, 12, phases=(SLAM_W, SLAM_A, SLAM_R))
def a_slam(i, n):
    global SLAM_KEYS
    if SLAM_KEYS is None:
        SLAM_KEYS = _slam_keys()
    p = keyed(SLAM_KEYS, i / (n - 1))
    if 2 <= i <= 6 and float(i).is_integer():
        p["off_hips"] = (p["off_hips"][0] + 0.03 * (-1) ** int(i), 0, p["off_hips"][2])
    if p.get("far_grip") is None:
        p.pop("far_grip", None)
    return resolve(p)


def slam_vis(i, n):
    v = {"eye0", "eye1"}
    if 2 <= i <= 8:
        v |= {"hot0", "hot1"}
    if i == 7:
        v.add("smear_slam_a")
    if i == 8:
        v |= {"smear_slam_b", "dust_slam_a"}
    if i == 9:
        v.add("dust_slam_b")
    return v


# --------------------------------------------------------------------------
# render

def setup_fx_for(name, a):
    fn, n = a["fn"], a["n"]
    if name == "slam":
        fx.add("smear_slam_a", make_smear("smear_slam_a", fn, n, 6.0, 7.0))
        fx.add("smear_slam_b", make_smear("smear_slam_b", fn, n, 7.0, 8.0))
        bx, bz, ba = fn(8, n)[5]
        tx, tz = bell_tip(bx, bz, ba)
        fx.add("dust_slam_a", make_dust("dust_slam_a", tx, 0.8, 1))
        fx.add("dust_slam_b", make_dust("dust_slam_b", tx, 1.15, 2))


VIS = {"slam": slam_vis}

out = os.path.join(ROOT, "build", "frames", "matron")
if ONLY:
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.rsplit("_", 1)[0] in ONLY:
            os.remove(os.path.join(out, f))
else:
    out = frames_dir("matron")

for a in ANIMS:
    if ONLY and a["name"] not in ONLY:
        continue
    setup_fx_for(a["name"], a)
    fn = a["fn"]
    vis = VIS.get(a["name"])
    anim_render(rig, fx, a["name"], a["n"], lambda i, n, fn=fn: fn(i, n)[:4], out, vis)
    # diagnostics: bell lowest point / reach per frame
    for i in range(a["n"]):
        res = fn(i, a["n"])
        bx, bz, ba = res[5]
        pts = bell_world(bx, bz, ba)
        low = min(z for _, z in pts)
        W = res[4]
        feet = min(W["an_n"][1], W["an_f"][1])
        print("DIAG %-14s %2d bell_low=%6.3f bell_maxx=%5.2f bell_maxz=%5.2f ankles_min=%5.3f" % (
            a["name"], i, low, max(x for x, _ in pts), max(z for _, z in pts), feet))

spec_anims = []
for a in ANIMS:
    e = {"name": a["name"], "fps": a["fps"], "loop": a["loop"]}
    if a["phases"]:
        e["windup"], e["active"], e["recover"] = a["phases"]
    spec_anims.append(e)
write_spec(out, FW, FH, (AX, AY), spec_anims)
print("matron done")
