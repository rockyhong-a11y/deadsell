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
                      ellipsoid, bake, attach_world, solidify, ROOT)
from common import join  # noqa: E402

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
# closed eyelids (shown instead of the glowing eyes when she is stunned / dead)
for k, y in enumerate((-0.09, 0.09)):
    lid = attach_world(rig, ellipsoid("lid%d" % k, (0.05, 0.11, 0.024), MT.mouth, loc=(0.307, y, 3.79),
                                      segs=10, rings=6), "head")
    fx.add("lid%d" % k, lid, default=False)

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
    ang, W = P.solve(spec, off)
    fg = p.get("far_grip")
    if fg:
        # far hand grips the near hand (weight fg[2], default 1): blend FK arm <-> IK arm
        hx, hz, ha = W["ha_n"]
        g = dict(spec)
        g["ik_sh_f"] = (hx + fg[0], hz + fg[1], ha, -1)
        ang_g, W_g = P.solve(g, off)
        w = fg[2] if len(fg) > 2 else 1.0
        for j in ("sh_f", "el_f", "ha_f"):
            ang[j] = ang[j] + (ang_g[j] - ang[j]) * w
        if w >= 0.5:
            W = W_g
    for s in ("n", "f"):
        a = (ang.get("sh_" + s, 0.0) + 180.0) % 360.0 - 180.0
        ang["pa_" + s] = max(-45.0, min(55.0, 0.35 * a))
    bx, bz, ba = W["bell"]
    return ang, off, {}, tw, W, (bx, bz, ba)


def lerp(a, b, t):
    if a is None and b is None:
        return None
    if a is None:
        a = (b[0], b[1], 0.0)          # far_grip fading in
    if b is None:
        b = (a[0], a[1], 0.0)          # far_grip fading out
    if isinstance(a, tuple) and len(a) == 2:
        a = a + (1.0,)
    if isinstance(b, tuple) and len(b) == 2:
        b = b + (1.0,)
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
                if k == "far_grip":
                    out[k] = lerp(p0.get(k), p1.get(k), u)
                elif k in p0 and k in p1:
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
# FX: smear crescents, impact dust, stars, roar arcs, embers

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
    solidify(ob, 0.06)
    return ob


def make_smear(name, fn, n, i0, i1, inner_r=0.25, steps=10, mat=None):
    """Smear following the bell between fractional frames i0 -> i1 (tail -> head)."""
    inner, outer = [], []
    for k in range(steps + 1):
        fi = i0 + (i1 - i0) * k / steps
        res = fn(fi, n)
        bx, bz, ba = res[5]
        cx, cz = bell_tip(bx, bz, ba)
        mx, mz = bx + (cx - bx) * inner_r, bz + (cz - bz) * inner_r
        ox, oz = rot(ba, 0.0, -1.1)
        outer.append((bx + ox * 1.0, bz + oz * 1.0))
        inner.append((mx, mz))
    return smear_mesh(name, inner, outer, mat or MT.smear)


def make_dust(name, x, scale=1.0, seed=0, y=-0.85):
    import random
    rnd = random.Random(seed)
    parts = []
    for k in range(7):
        dx = (k - 3) * 0.32 * scale + rnd.uniform(-0.08, 0.08)
        s = (0.36 - abs(k - 3) * 0.05) * scale
        ob = ellipsoid(name + "_p%d" % k, (s * 1.4, 0.4, s), MT.dust,
                       loc=(x + dx, y, 0.06 + s * 0.4 + rnd.uniform(0, 0.08)), segs=8, rings=6)
        parts.append(bake(ob))
    for k in range(5):
        dx = (k - 2) * 0.45 * scale + rnd.uniform(-0.1, 0.1)
        h = (0.5 + rnd.uniform(0, 0.45) - abs(k - 2) * 0.1) * scale
        ob = ellipsoid(name + "_r%d" % k, (0.13, 0.13, 0.11), MT.rock,
                       loc=(x + dx, y - 0.05, h), rot=(rnd.uniform(0, 90), rnd.uniform(0, 90), 0), segs=6, rings=4)
        parts.append(bake(ob))
    return join(parts, name)


def make_stars(name, cx, cz, phase, n=3, rx=0.62, rz=0.12, s=0.17):
    """Ring of 4-point sparkles orbiting (cx, cz) -- the 'dizzy' marker."""
    parts = []
    for k in range(n):
        a = phase + 2 * math.pi * k / n
        x, z = cx + rx * math.cos(a), cz + rz * math.sin(a)
        sc = s * (0.8 + 0.25 * math.sin(a))
        w = sc * 0.3
        pts = [(0, sc), (w, w), (sc, 0), (w, -w), (0, -sc), (-w, -w), (-sc, 0), (-w, w)]
        verts = [(x, -0.95, z)] + [(x + px, -0.95, z + pz) for px, pz in pts]
        faces = [(0, 1 + j, 1 + (j + 1) % 8) for j in range(8)]
        ob = mesh_object("%s_s%d" % (name, k), verts, faces, MT.star, smooth_shade=False)
        solidify(ob, 0.03)
        parts.append(ob)
    return join(parts, name)


def make_arcs(name, cx, cz, radii, a0, a1, mat=None, width=0.07):
    parts = []
    for k, r in enumerate(radii):
        verts, faces = [], []
        N = 9
        for j in range(N + 1):
            a = math.radians(a0 + (a1 - a0) * j / N)
            for rr in (r, r + width * (1 + 0.6 * k)):
                verts.append((cx + rr * math.cos(a), -0.95, cz + rr * math.sin(a)))
        for j in range(N):
            b = 2 * j
            faces.append((b, b + 2, b + 3, b + 1))
        ob = mesh_object("%s_a%d" % (name, k), verts, faces, mat or MT.smear2, smooth_shade=False)
        solidify(ob, 0.04)
        parts.append(ob)
    return join(parts, name)


def make_embers(name, cx, cz, seed, n=9, spread=0.7):
    import random
    rnd = random.Random(seed)
    parts = []
    for k in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(0.18, spread)
        s = rnd.uniform(0.06, 0.13)
        ob = ellipsoid("%s_e%d" % (name, k), (s, s, s * 1.3), MT.ember if k % 2 else MT.eye_hot,
                       loc=(cx + d * math.cos(a), -0.8 + rnd.uniform(-0.2, 0.1), cz + d * math.sin(a) * 1.2),
                       segs=6, rings=4)
        parts.append(bake(ob))
    return join(parts, name)


# --------------------------------------------------------------------------
# animations

ANIMS = []


def anim(name, n, fps, loop=False, phases=None, keys=None, post=None):
    """Register an animation.  keys: callable -> [(t, pose[, ease])]; sampled at i/(n-1)
    (loops: caller supplies a procedural fn instead)."""
    def deco(fn):
        ANIMS.append(dict(name=name, n=n, fps=fps, loop=loop, phases=phases, fn=fn))
        return fn
    return deco


def keyed_fn(get_keys, n, post=None, loop=False):
    cache = []

    def fn(i, n_):
        if not cache:
            cache.append(get_keys())
        t = (i / n_) if loop else (i / (n_ - 1))
        p = keyed(cache[0], t)
        if p.get("far_grip") is None:
            p.pop("far_grip", None)
        if post:
            post(p, i, n_)
        return resolve(p)
    return fn


def register(name, n, fps, fn, loop=False, phases=None):
    ANIMS.append(dict(name=name, n=n, fps=fps, loop=loop, phases=phases, fn=fn))


def shake(p, i, amp=0.025, ch=1.0):
    s = (-1) ** int(round(i))
    ox, oy, oz = p["off_hips"]
    p["off_hips"] = (ox + amp * s, oy, oz)
    p["chest"] = p.get("chest", 0.0) + ch * s


def feet(nx, fx, nz=0.17, fz=0.17, nd=0.0, fd=0.0):
    return {"ik_th_n": (nx, nz, nd), "ik_th_f": (fx, fz, fd)}


def O(x=0.0, z=0.0):
    return (x, 0.0, z)


# ---- idle: heavy breathing, bell resting on the floor, chain slack
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


register("idle", 8, 7, a_idle, loop=True)


# ---- walk: heavy stomp, bell dragged behind on the floor
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


register("walk", 10, 9, a_walk, loop=True)

# ==========================================================================
# SLAM  (overhead bell slam)  windup 7 / active 2 / recover 5
# ==========================================================================
SLAM_W, SLAM_A, SLAM_R = 7, 2, 5
SL = {}


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
    SL.update(lift=lift, swing=swing, high=high, high2=high2, mid=mid, impact=impact, settle=settle,
              rise=rise, end=end)
    n = SLAM_W + SLAM_A + SLAM_R
    f = lambda k: k / (n - 1)  # noqa: E731
    return [(f(0), lift), (f(1), swing, "o"), (f(2), high, "o"), (f(6), high2, "s"),
            (f(7), mid, "i"), (f(8), impact, "i"), (f(9), settle, "o"), (f(11), rise, "s"), (f(13), end, "s")]


def _slam_post(p, i, n):
    if 2 <= i <= 6 and float(i).is_integer():
        p["off_hips"] = (p["off_hips"][0] + 0.03 * (-1) ** int(i), 0, p["off_hips"][2])


a_slam = keyed_fn(_slam_keys, SLAM_W + SLAM_A + SLAM_R, _slam_post)
register("slam", SLAM_W + SLAM_A + SLAM_R, 12, a_slam, phases=(SLAM_W, SLAM_A, SLAM_R))


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


# ==========================================================================
# SWEEP  (low horizontal bell swing, reach ~120 px)  windup 6 / active 2 / recover 5
# ==========================================================================
SWEEP_W, SWEEP_A, SWEEP_R = 6, 2, 5
SWEEP_N = SWEEP_W + SWEEP_A + SWEEP_R


def _sweep_keys():
    n = SWEEP_N
    f = lambda k: k / (n - 1)  # noqa: E731
    wide = feet(-0.78, 0.82)
    c0 = merge(IDLE, {"off_hips": O(0.0, -0.2), "chest": -10, "bw": 0.5, "ca": 8, "ba": 8})
    c1 = merge(IDLE, wide, cloth(braid=(-45, -14, -6, -4, -2), cape=(-4, -6, -8, -9)), {
        "off_hips": O(-0.12, -0.38), "hips": -2, "spine": 0, "chest": 0, "head": 8,
        "sh_n@": -58, "el_n": 22, "ca": -60, "ba": -60, "bw": 0.0, "cl": 1.0,
        "sh_f@": -30, "el_f": 30, "far_grip": (0.05, -0.16, 0.6)})
    c2 = merge(c1, feet(-0.9, 0.9), cloth(braid=(-34, -8, -2, 0, 0), cape=(2, 3, 4, 4)), {
        "off_hips": O(-0.3, -0.52), "hips": 6, "spine": 6, "chest": 14, "neck": 0, "head": 2,
        "sh_n@": -100, "el_n": 8, "ca": -104, "ba": -104, "far_grip": (0.05, -0.15, 1.0)})
    c3 = merge(c2, {"off_hips": O(-0.36, -0.56), "chest": 20, "spine": 8, "hips": 8,
                    "sh_n@": -112, "el_n": 6, "ca": -116, "ba": -116})
    mid = merge(c3, cloth(braid=(-55, -30, -20, -15, -10), cape=(-20, -28, -34, -38)), feet(-0.8, 1.0), {
        "off_hips": O(0.1, -0.66), "hips": -8, "spine": -8, "chest": -10, "head": 6,
        "sh_n@": 12, "el_n": 6, "ca": 22, "ba": 24})
    ext = merge(mid, cloth(braid=(-62, -36, -24, -18, -12), cape=(-28, -36, -42, -46)), feet(-0.7, 1.12), {
        "off_hips": O(0.55, -0.78), "hips": -12, "spine": -14, "chest": -22, "neck": 8, "head": 8,
        "sh_n@": 64, "el_n": -4, "ca": 76, "ba": 80})
    ov = merge(ext, cloth(braid=(-30, -10, -4, -2, 0), cape=(-14, -20, -26, -30)), {
        "off_hips": O(0.62, -0.8), "hips": -14, "chest": -26, "sh_n@": 72, "ca": 86, "ba": 90,
        "bw": 1.0, "bpx": 3.15, "bpz": gz(90)})
    r1 = merge(ov, {"off_hips": O(0.5, -0.66), "chest": -20, "ba": 88, "bpx": 2.8, "bpz": gz(88),
                    "far_grip": None, "sh_n@": 60, "sh_f@": 30, "el_f": 30})
    r2 = merge(r1, feet(-0.5, 1.0), {"off_hips": O(0.36, -0.46), "hips": -8, "spine": -8, "chest": -14,
                                      "ba": 70, "bpx": 2.3, "bpz": gz(70), "sh_n@": 40, "head": 12})
    r3 = merge(r2, feet(-0.4, 0.8), {"off_hips": O(0.2, -0.26), "chest": -10, "ba": 30, "bpx": 1.7, "bpz": gz(30),
                                      "sh_n@": 28, "el_n": 30, "sh_f@": -10})
    end = merge(IDLE, {"bpx": 1.2, "ba": 0.0})
    return [(f(0), c0), (f(1), c1, "s"), (f(2), c2, "o"), (f(5), c3, "s"), (f(6), mid, "i"), (f(7), ext, "l"),
            (f(8), ov, "o"), (f(9), r1, "s"), (f(10), r2, "s"), (f(11), r3, "s"), (f(12), end, "s")]


a_sweep = keyed_fn(_sweep_keys, SWEEP_N,
                   lambda p, i, n: shake(p, i, 0.03, 1.0) if (3 <= i <= 5 and float(i).is_integer()) else None)
register("sweep", SWEEP_N, 12, a_sweep, phases=(SWEEP_W, SWEEP_A, SWEEP_R))


def sweep_vis(i, n):
    v = {"eye0", "eye1"}
    if 1 <= i <= 7:
        v |= {"hot0", "hot1"}
    if i == 6:
        v.add("smear_sweep_a")
    if i == 7:
        v |= {"smear_sweep_b", "dust_sweep"}
    return v


# ==========================================================================
# CHARGE WINDUP  (drops the near shoulder, digs in)
# ==========================================================================
CW_N = 8


def _cw_keys():
    n = CW_N
    f = lambda k: k / (n - 1)  # noqa: E731
    base_bell = {"bw": 1.0, "ca": -40, "ba": -70, "bpx": -1.2, "bpz": gz(-70)}
    s0 = merge(IDLE, {"off_hips": O(0, -0.2), "chest": -12})
    s1 = merge(IDLE, base_bell, feet(-0.85, 0.5), cloth(braid=(-50, -16, -8, -5, -3)), {
        "off_hips": O(-0.1, -0.46), "hips": -8, "spine": -10, "chest": -18, "neck": 10, "head": 12,
        "sh_n@": -32, "el_n": 18, "sh_f@": 22, "el_f": 40, "bpx": -0.9})
    s2 = merge(s1, feet(-1.0, 0.62), cloth(braid=(-64, -30, -20, -14, -10), cape=(-8, -10, -12, -14)), {
        "off_hips": O(0.0, -0.64), "hips": -12, "spine": -12, "chest": -26, "neck": 16, "head": 14,
        "sh_n@": -56, "el_n": 10, "sh_f@": 52, "el_f": 38, "bpx": -1.25, "ba": -78, "bpz": gz(-78)})
    return [(f(0), s0), (f(2), s1, "s"), (f(4), s2, "o"), (f(7), s2, "s")]


def _cw_post(p, i, n):
    if i >= 4:
        shake(p, i, 0.025, 1.2)


a_cw = keyed_fn(_cw_keys, CW_N, _cw_post)
register("charge_windup", CW_N, 10, a_cw)


def cw_vis(i, n):
    v = {"eye0", "eye1"}
    if i >= 2:
        v |= {"hot0", "hot1"}
    if i >= 4:
        v.add("dust_cw_%d" % (i % 2))
    return v


# ==========================================================================
# CHARGE  (shoulder-first sprint, loop)
# ==========================================================================
def a_charge(i, n):
    t = i / n
    w = 2 * math.pi * t
    S, LIFT = 1.5, 0.6

    def foot(ph):
        ph %= 1.0
        if ph < 0.5:
            u = ph / 0.5
            return (S / 2 - S * u + 0.2, 0.17, 0.0)
        u = (ph - 0.5) / 0.5
        e = ease(u)
        return (-S / 2 + S * e + 0.2, 0.17 + LIFT * math.sin(math.pi * u), -25 * math.sin(math.pi * u))
    u2 = (2 * t) % 1.0
    bob = -0.62 + 0.09 * math.sin(math.pi * u2)
    ba = -84 + 4 * math.sin(2 * w)
    p = merge(IDLE, cloth(braid=(-82 + 4 * math.sin(2 * w), -70, -66, -62, -60),
                          cape=(-40 + 3 * math.sin(2 * w), -52 + 4 * math.cos(2 * w), -62 + 4 * math.sin(2 * w), -68),
                          tab=(-14, -20)))
    p.update({
        "off_hips": O(0.55, bob), "hips": -14, "spine": -14, "chest": -22 + 2 * math.sin(2 * w), "neck": 16,
        "head": 14, "tw_head": -10,
        "ik_th_n": foot(t), "ik_th_f": foot(t + 0.5),
        "sh_n@": -62 + 6 * math.sin(w), "el_n": 8, "ha_n": -10,
        "sh_f@": 74 + 5 * math.sin(w), "el_f": 76,
        "bw": 1.0, "ca": -60, "ba": ba, "bpx": -1.35 + 0.08 * math.sin(2 * w),
        "bpz": gz(ba) + 0.16 * max(0.0, math.sin(2 * w + 1.0)),
    })
    return resolve(p)


register("charge", 8, 16, a_charge, loop=True)


def charge_vis(i, n):
    return {"eye0", "eye1", "hot0", "hot1"}


# ==========================================================================
# CRASH  (slams into the wall, stunned: dark eyes, dizzy stars, slumped)
# ==========================================================================
CR_N = 12


def _crash_keys():
    n = CR_N
    f = lambda k: k / (n - 1)  # noqa: E731
    bell_back = {"bw": 1.0, "ca": -40, "ba": -70, "bpx": -1.3, "bpz": gz(-70)}
    hit = merge(IDLE, bell_back, feet(-0.5, 0.52), cloth(braid=(-30, -20, -12, -8, -5), cape=(-14, -18, -22, -24)), {
        "off_hips": O(0.4, -0.5), "hips": -14, "spine": -14, "chest": -34, "neck": 18, "head": 8, "tw_head": -6,
        "sh_n@": -40, "el_n": 20, "sh_f@": 64, "el_f": 60})
    rec = merge(hit, feet(-0.78, 0.3), cloth(braid=(-70, -30, -18, -10, -6), cape=(6, 8, 10, 10)), {
        "off_hips": O(-0.1, -0.3), "hips": 6, "spine": 6, "chest": 10, "neck": 12, "head": 30, "jaw": -16,
        "sh_n@": -24, "el_n": 10, "sh_f@": 14, "el_f": 12})
    stag = merge(rec, feet(-1.0, 0.0), cloth(braid=(-50, -18, -8, -4, -2), cape=(2, 4, 6, 6)), {
        "off_hips": O(-0.3, -0.26), "hips": 8, "spine": 4, "chest": 14, "neck": 10, "head": 24, "jaw": -6,
        "sh_n@": 20, "el_n": 24, "sh_f@": -30, "el_f": 24})
    buck = merge(stag, feet(-0.8, 0.12), {
        "off_hips": O(-0.28, -0.46), "hips": -2, "spine": -4, "chest": -6, "neck": 14, "head": 20, "jaw": 0,
        "sh_n@": 12, "el_n": 16, "sh_f@": 8, "el_f": 26})
    slump = merge(IDLE, feet(-0.7, 0.16), cloth(braid=(-30, -10, -4, -2, 0), cape=(-2, -3, -4, -4)), {
        "off_hips": O(-0.1, -0.56), "hips": -10, "spine": -12, "chest": -26, "neck": 22, "head": 34, "jaw": 0,
        "tw_head": -10, "sh_n@": 24, "el_n": 22, "ha_n": -10, "sh_f@": 22, "el_f": 26, "bpx": 1.0})
    return [(f(0), hit), (f(1), rec, "o"), (f(2), stag, "s"), (f(3), buck, "s"), (f(4), slump, "s"),
            (f(11), slump, "s")]


def _crash_post(p, i, n):
    if i >= 5:
        t = (i - 5) / 6.0 * 2 * math.pi
        p["chest"] += 5 * math.sin(t)
        p["head"] += 6 * math.sin(t + 0.8)
        p["spine"] += 2 * math.sin(t)
        p["tw_head"] = -10 + 8 * math.sin(t + 1.5)
        p["off_hips"] = (p["off_hips"][0] + 0.05 * math.sin(t), 0, p["off_hips"][2])


a_crash = keyed_fn(_crash_keys, CR_N, _crash_post)
register("crash", CR_N, 8, a_crash)


def crash_vis(i, n):
    v = set()
    if i <= 2:
        v |= {"eye0", "eye1", "hot0", "hot1"}
    elif i == 3:
        v |= {"eye0", "eye1"}
    else:
        v |= {"lid0", "lid1"}
    if i <= 1:
        v.add("dust_crash_%d" % i)
    if i >= 3:
        v.add("stars_crash_%d" % i)
    return v


# ==========================================================================
# LEAP  (crouch + launch)  /  LEAP_FALL (bell raised)  /  LEAP_LAND (w2/a2/r6)
# ==========================================================================
LP_N = 8


def _fall_pose():
    return merge(IDLE, feet(-0.28, 0.34, 0.6, 0.46, -14, -8),
                 cloth(braid=(-86, -62, -52, -46, -42), cape=(-26, -44, -58, -70)), {
        "off_hips": O(0.02, 0.05), "hips": -3, "spine": 4, "chest": 6, "neck": 0, "head": -4,
        "sh_n@": -168, "el_n": 12, "ha_n": -10, "sh_f@": -166, "el_f": 16,
        "ca": -172, "cl": 1.0, "ba": -174, "bw": 0.0, "far_grip": (0.05, -0.14, 1.0)})


def _leap_keys():
    n = LP_N
    f = lambda k: k / (n - 1)  # noqa: E731
    fall = _fall_pose()
    c0 = merge(IDLE, {"off_hips": O(0, -0.3), "chest": -14, "bw": 0.4, "ca": -20, "ba": -20, "head": 8})
    c1 = merge(IDLE, feet(-0.5, 0.52), cloth(braid=(-46, -14, -6, -3, -2), cape=(-8, -10, -12, -12)), {
        "off_hips": O(-0.1, -0.78), "hips": -8, "spine": -12, "chest": -22, "neck": 10, "head": 6,
        "sh_n@": -70, "el_n": 12, "sh_f@": -56, "el_f": 22, "bw": 0.0, "ca": -76, "cl": 1.0, "ba": -78})
    c2 = merge(c1, {"off_hips": O(-0.14, -0.86), "chest": -26, "sh_n@": -80, "ca": -86, "ba": -88, "hips": -10})
    launch = merge(fall, feet(-0.12, 0.1, 0.24, 0.3, -20, -8), {
        "off_hips": O(0.1, -0.04), "hips": -2, "spine": 0, "chest": 0, "head": 2,
        "sh_n@": -140, "el_n": 12, "sh_f@": -136, "el_f": 18, "ca": -142, "ba": -144,
        "far_grip": (0.05, -0.14, 0.6)})
    return [(f(0), c0), (f(1), c1, "s"), (f(2), c2, "o"), (f(3), c2, "s"), (f(4), launch, "i"),
            (f(5), fall, "o"), (f(7), fall, "s")]


a_leap = keyed_fn(_leap_keys, LP_N)
register("leap", LP_N, 14, a_leap)


def leap_vis(i, n):
    v = {"eye0", "eye1"}
    if i >= 1:
        v |= {"hot0", "hot1"}
    if i == 4:
        v.add("dust_leap")
    return v


def a_leap_fall(i, n):
    t = i / n * 2 * math.pi
    s, c = math.sin(t), math.cos(t)
    p = _fall_pose()
    p.update(cloth(braid=(-86 + 6 * s, -62 + 6 * c, -52 + 8 * s, -46 + 8 * c, -42 + 8 * s),
                   cape=(-26 + 3 * s, -44 + 5 * c, -58 + 6 * s, -70 + 8 * c)))
    p["off_hips"] = O(0.02, 0.05 + 0.04 * s)
    p["chest"] = 6 + 1.5 * s
    p["ik_th_n"] = (-0.28 + 0.05 * c, 0.6 + 0.04 * s, -14)
    p["ik_th_f"] = (0.34 - 0.05 * c, 0.46 - 0.04 * s, -8)
    return resolve(p)


register("leap_fall", 4, 10, a_leap_fall, loop=True)

LL_W, LL_A, LL_R = 2, 2, 6
LL_N = LL_W + LL_A + LL_R


def _land_keys():
    _slam_keys() if not SL else None
    n = LL_N
    f = lambda k: k / (n - 1)  # noqa: E731
    fall = _fall_pose()
    air = merge(fall, feet(-0.3, 0.3, 0.3, 0.26, -10, -6), {"off_hips": O(0.1, -0.18), "hips": -6})
    mid = merge(SL["mid"], feet(-0.6, 0.66), {"off_hips": O(0.12, -0.55), "hips": -8, "chest": -8})
    imp = merge(SL["impact"], feet(-0.74, 0.98), {"off_hips": O(0.36, -0.8), "hips": -18, "spine": -14,
                                                   "chest": -18, "head": 18, "bpx": 2.2})
    hold = merge(imp, {"off_hips": O(0.34, -0.84), "chest": -20, "head": 22})
    rise = merge(SL["rise"], feet(-0.6, 0.9), {"off_hips": O(0.24, -0.5), "hips": -10, "far_grip": None})
    return [(f(0), air), (f(1), mid, "i"), (f(2), imp, "i"), (f(3), hold, "o"), (f(5), rise, "s"),
            (f(9), SL["end"], "s")]


a_land = keyed_fn(_land_keys, LL_N)
register("leap_land", LL_N, 12, a_land, phases=(LL_W, LL_A, LL_R))


def land_vis(i, n):
    v = {"eye0", "eye1"}
    if i <= 4:
        v |= {"hot0", "hot1"}
    if i == 1:
        v.add("smear_land")
    if i == 2:
        v.add("dust_land_a")
    if i == 3:
        v.add("dust_land_b")
    return v


# ==========================================================================
# ROAR  (head back, arms out, shock arcs)
# ==========================================================================
RO_N = 12


def _roar_keys():
    n = RO_N
    f = lambda k: k / (n - 1)  # noqa: E731
    hang = {"bw": 0.0, "ca": -6, "ba": -8, "cl": 1.0}
    in1 = merge(IDLE, {"off_hips": O(0, -0.2), "chest": -14, "hips": -6, "head": 18, "neck": 8,
                       "sh_n@": 34, "el_n": 40, "sh_f@": 10, "el_f": 50, "bw": 0.6, "ca": 14, "ba": 6})
    in2 = merge(in1, {"off_hips": O(0.0, -0.28), "chest": -18, "head": 22, "spine": -8})
    out = merge(IDLE, hang, feet(-0.5, 0.56), cloth(braid=(-30, -8, -4, -2, -2), cape=(6, 10, 12, 12)), {
        "off_hips": O(-0.2, -0.06), "hips": 4, "spine": 8, "chest": 24, "neck": 18, "head": 24, "jaw": -34,
        "tw_head": -12, "sh_n@": -88, "el_n": -6, "ha_n": -10, "sh_f@": 92, "el_f": -8})
    out2 = merge(out, {"chest": 28, "head": 28, "jaw": -28, "off_hips": O(-0.24, -0.04), "sh_n@": -94,
                       "sh_f@": 98})
    done = merge(IDLE, {"jaw": -8, "head": 14, "chest": -4, "sh_n@": 10, "sh_f@": -6, "el_f": 36})
    return [(f(0), IDLE), (f(1), in1, "s"), (f(2), in2, "s"), (f(3), out, "i"), (f(8), out2, "l"),
            (f(10), done, "s"), (f(11), IDLE, "s")]


def _roar_post(p, i, n):
    if 3 <= i <= 8:
        s = (-1) ** i
        p["off_hips"] = (p["off_hips"][0] + 0.025 * s, 0, p["off_hips"][2])
        p["jaw"] = p.get("jaw", 0.0) + 4 * s
        p["chest"] += 1.5 * s


a_roar = keyed_fn(_roar_keys, RO_N, _roar_post)
register("roar", RO_N, 8, a_roar)


def roar_vis(i, n):
    v = {"eye0", "eye1"}
    if 2 <= i <= 9:
        v |= {"hot0", "hot1"}
    if 4 <= i <= 9:
        v.add("arcs_roar_%d" % i)
    return v


# ==========================================================================
# SUMMON  (far fist raised to the ceiling, chains rattle, embers)
# ==========================================================================
SU_N = 12


def _summon_keys():
    n = SU_N
    f = lambda k: k / (n - 1)  # noqa: E731
    up1 = merge(IDLE, {"off_hips": O(0, -0.16), "chest": -2, "head": 10,
                       "sh_f@": 70, "el_f": 22, "sh_n@": 26, "el_n": 40, "bw": 1.0})
    up2 = merge(up1, {"off_hips": O(-0.05, -0.12), "chest": 4, "head": 20, "neck": 10,
                      "sh_f@": 130, "el_f": 8, "sh_n@": 30})
    peak = merge(up2, feet(-0.46, 0.5), cloth(braid=(-34, -10, -4, -2, 0), cape=(2, 4, 6, 6)), {
        "off_hips": O(-0.12, -0.1), "hips": 2, "spine": 4, "chest": 12, "neck": 14, "head": 24, "tw_head": -12,
        "sh_f@": 168, "el_f": -4, "sh_n@": 34, "el_n": 44})
    punch = merge(peak, cloth(braid=(10, 6, 2, 0, -2), cape=(-14, -8, -2, 2)), {
        "off_hips": O(0.14, -0.4), "hips": -10, "spine": -10, "chest": -20, "neck": 6, "head": 14,
        "sh_f@": 60, "el_f": 30, "sh_n@": 20})
    return [(f(0), IDLE), (f(2), up1, "s"), (f(4), up2, "s"), (f(5), peak, "o"), (f(8), peak, "s"),
            (f(9), punch, "i"), (f(10), punch, "s"), (f(11), IDLE, "s")]


def _summon_post(p, i, n):
    if 4 <= i <= 8:
        s = (-1) ** i
        p["off_hips"] = (p["off_hips"][0] + 0.02 * s, 0, p["off_hips"][2])
        p["sh_f@"] += 3 * s
        p["bpz"] = p.get("bpz", 0) + 0.05 * (1 + s)
        p["bw"] = 1.0
    if "ha_f@" not in p:
        pass


a_summon = keyed_fn(_summon_keys, SU_N, _summon_post)
register("summon", SU_N, 8, a_summon)


def summon_vis(i, n):
    v = {"eye0", "eye1"}
    if 3 <= i <= 9:
        v |= {"hot0", "hot1"}
    if 4 <= i <= 8:
        v.add("embers_summon_%d" % i)
    return v


# ==========================================================================
# HURT  (short flinch)
# ==========================================================================
HU_N = 4


def _hurt_keys():
    n = HU_N
    f = lambda k: k / (n - 1)  # noqa: E731
    h0 = merge(IDLE, feet(-0.46, 0.36), {"off_hips": O(-0.1, -0.12), "hips": 4, "spine": 2, "chest": 10, "neck": 12,
                                         "head": 26, "jaw": -14, "sh_n@": 8, "sh_f@": -34, "el_f": 20})
    h1 = merge(h0, feet(-0.5, 0.32), {"off_hips": O(-0.18, -0.18), "chest": 15, "head": 32, "jaw": -10,
                                      "tw_head": -26})
    h2 = merge(IDLE, {"off_hips": O(-0.06, -0.14), "chest": 0, "head": 16, "jaw": -4})
    return [(f(0), h0), (f(1), h1, "o"), (f(2), h2, "s"), (f(3), IDLE, "s")]


a_hurt = keyed_fn(_hurt_keys, HU_N)
register("hurt", HU_N, 14, a_hurt)


def hurt_vis(i, n):
    return {"eye0", "eye1", "hot0", "hot1"} if i <= 2 else {"eye0", "eye1"}


# ==========================================================================
# DEATH  (staggers, drops the bell, sinks to her knees, topples forward)
# ==========================================================================
DE_N = 18


def _death_keys():
    n = DE_N
    f = lambda k: k / (n - 1)  # noqa: E731
    K = lambda *a: feet(*a)  # noqa: E731
    d0 = merge(IDLE, feet(-0.46, 0.36), {"off_hips": O(-0.15, -0.14), "hips": 4, "spine": 2, "chest": 14, "neck": 12,
                                         "head": 28, "jaw": -16, "sh_n@": 6, "sh_f@": -34, "el_f": 20})
    d2 = merge(d0, feet(-0.9, 0.06), cloth(braid=(-40, -14, -6, -3, -2), cape=(4, 6, 8, 8)), {
        "off_hips": O(-0.32, -0.22), "hips": 8, "chest": 20, "head": 32, "jaw": -8,
        "sh_n@": 14, "el_n": 14, "sh_f@": -20, "el_f": 18})
    d4 = merge(d2, feet(-0.72, 0.18), cloth(braid=(-16, -6, -2, 0, 0), cape=(-2, -2, -2, -2)), {
        "off_hips": O(-0.16, -0.62), "hips": -8, "spine": -4, "chest": -6, "neck": 14, "head": 26, "jaw": 0,
        "sh_n@": 8, "el_n": 8, "sh_f@": 4, "el_f": 12})
    k1 = merge(d4, feet(-0.66, 0.6, 0.5, 0.17, -72, 0), cloth(braid=(10, 4, 2, 0, 0), cape=(-8, -4, 0, 2)), {
        "off_hips": O(0.04, -0.86), "hips": -6, "spine": -8, "chest": -14, "neck": 18, "head": 34,
        "sh_n@": 6, "el_n": 6, "sh_f@": 2, "el_f": 10})
    k2 = merge(k1, feet(-0.7, -0.42, 0.52, 0.52, -72, -72), {
        "off_hips": O(0.02, -0.94), "chest": -18, "head": 42})
    k3 = merge(k2, {"off_hips": O(0.06, -0.96), "chest": -22, "head": 46, "spine": -10})
    t1 = merge(k3, {"off_hips": O(0.22, -0.98), "hips": -24, "spine": -8, "chest": -10, "head": 40,
                    "sh_n@": 30, "el_n": 14, "sh_f@": 24, "el_f": 12, "bw": 1.0, "bpx": 1.5, "bpz": gz(40),
                    "ba": 40, "ca": 30})
    t2 = merge(t1, cloth(braid=(-30, -20, -14, -10, -8), cape=(-30, -34, -36, -38)), {
        "off_hips": O(0.56, -1.12), "hips": -48, "spine": -10, "chest": -8, "head": 30,
        "sh_n@": 70, "el_n": 8, "sh_f@": 64, "el_f": 8, "bpx": 2.5, "bpz": gz(80), "ba": 80, "ca": 70})
    t3 = merge(t2, cloth(braid=(-60, -50, -46, -44, -42), cape=(-66, -70, -72, -72), tab=(-60, -64)), {
        "off_hips": O(0.92, -1.3), "hips": -72, "spine": -6, "chest": -4, "head": 20, "neck": 6,
        "sh_n@": 100, "el_n": 4, "sh_f@": 92, "el_f": 6, "bpx": 3.1, "bpz": gz(88), "ba": 88, "ca": 82,
        "ik_th_n": (-0.66, 0.5, -72), "ik_th_f": (-0.42, 0.52, -72)})
    t4 = merge(t3, cloth(braid=(-82, -80, -80, -80, -80), cape=(-86, -88, -90, -90), tab=(-84, -88)), {
        "off_hips": O(1.04, -1.46), "hips": -88, "spine": -2, "chest": -2, "head": 10, "neck": 2, "jaw": 4,
        "sh_n@": 112, "sh_f@": 104})
    t5 = merge(t4, {"off_hips": O(1.06, -1.5), "hips": -92, "head": 6})
    return [(f(0), d0), (f(2), d2, "o"), (f(4), d4, "s"), (f(6), k1, "s"), (f(8), k2, "s"), (f(10), k3, "s"),
            (f(11), t1, "i"), (f(12), t2, "i"), (f(13), t3, "i"), (f(14), t4, "i"), (f(15), t5, "o"),
            (f(17), t5, "s")]


def _death_post(p, i, n):
    if 8 <= i <= 10:
        s = (-1) ** i
        p["chest"] += 2 * s
        p["head"] += 3 * s


a_death = keyed_fn(_death_keys, DE_N, _death_post)
register("death", DE_N, 6, a_death)


def death_vis(i, n):
    v = set()
    if i <= 1:
        v |= {"eye0", "eye1", "hot0", "hot1"}
    elif i <= 3:
        v |= {"eye0", "eye1"}
    else:
        v |= {"lid0", "lid1"}
    if i == 5 or i == 7:
        v.add("dust_death_k")
    if i in (14, 15):
        v.add("dust_death_%d" % i)
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
    elif name == "sweep":
        fx.add("smear_sweep_a", make_smear("smear_sweep_a", fn, n, 5.0, 6.0, inner_r=0.1))
        fx.add("smear_sweep_b", make_smear("smear_sweep_b", fn, n, 6.0, 7.0, inner_r=0.1))
        bx, bz, ba = fn(7, n)[5]
        fx.add("dust_sweep", make_dust("dust_sweep", fn(7, n)[4]["an_f"][0] + 0.4, 0.55, 3))
    elif name == "charge_windup":
        for k in range(2):
            fx.add("dust_cw_%d" % k, make_dust("dust_cw_%d" % k, fn(6, n)[4]["an_n"][0] - 0.35, 0.5 + 0.2 * k, 4 + k))
    elif name == "crash":
        wx = fn(0, n)[4]["chest"][0] + 0.75
        fx.add("dust_crash_0", make_dust("dust_crash_0", wx, 0.55, 6, y=-0.95))
        fx.add("dust_crash_1", make_dust("dust_crash_1", wx + 0.05, 0.85, 7, y=-0.95))
        for i in range(3, n):
            Wh = fn(i, n)[4]["head"]
            fx.add("stars_crash_%d" % i, make_stars("stars_crash_%d" % i, Wh[0] + 0.12, Wh[1] + 0.62,
                                                    i * 1.1))
    elif name == "leap":
        fx.add("dust_leap", make_dust("dust_leap", fn(4, n)[4]["an_n"][0] + 0.2, 0.7, 8))
    elif name == "leap_land":
        fx.add("smear_land", make_smear("smear_land", fn, n, 1.0, 2.0))
        bx, bz, ba = fn(2, n)[5]
        tx, tz = bell_tip(bx, bz, ba)
        fx.add("dust_land_a", make_dust("dust_land_a", 0.5, 1.2, 9))
        fx.add("dust_land_b", make_dust("dust_land_b", 0.5, 1.7, 10))
    elif name == "roar":
        for i in range(4, 10):
            Wh = fn(i, n)[4]
            mx, mz = P.point(Wh, "head", (0.34, -0.12))
            rr = 0.35 + 0.28 * (i - 4)
            fx.add("arcs_roar_%d" % i, make_arcs("arcs_roar_%d" % i, mx, mz, [rr, rr + 0.55], -28, 52))
    elif name == "summon":
        for i in range(4, 9):
            Wh = fn(i, n)[4]
            hx, hz = P.point(Wh, "ha_f", (0.0, -0.1))
            fx.add("embers_summon_%d" % i, make_embers("embers_summon_%d" % i, hx, hz + 0.1, i))
    elif name == "death":
        fx.add("dust_death_k", make_dust("dust_death_k", fn(6, n)[4]["an_n"][0] + 0.6, 0.6, 11))
        for i in (14, 15):
            fx.add("dust_death_%d" % i, make_dust("dust_death_%d" % i, fn(i, n)[4]["chest"][0] + 0.4,
                                                  1.0 + 0.5 * (i - 14), 12 + i))


def idle_vis(i, n):
    return {"eye0", "eye1"}


VIS = {"idle": idle_vis, "slam": slam_vis, "sweep": sweep_vis, "charge_windup": cw_vis, "charge": charge_vis,
       "crash": crash_vis, "leap": leap_vis, "leap_land": land_vis, "roar": roar_vis, "summon": summon_vis,
       "hurt": hurt_vis, "death": death_vis}

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
    for i in range(a["n"]):
        res = fn(i, a["n"])
        bx, bz, ba = res[5]
        pts = bell_world(bx, bz, ba)
        low = min(z for _, z in pts)
        W = res[4]
        feet_z = min(W["an_n"][1], W["an_f"][1])
        print("DIAG %-14s %2d bell_low=%6.3f bell_maxx=%5.2f bell_maxz=%5.2f ankles_min=%5.3f" % (
            a["name"], i, low, max(x for x, _ in pts), max(z for _, z in pts), feet_z))

spec_anims = []
for a in ANIMS:
    e = {"name": a["name"], "fps": a["fps"], "loop": a["loop"]}
    if a["phases"]:
        e["windup"], e["active"], e["recover"] = a["phases"]
    spec_anims.append(e)
write_spec(out, FW, FH, (AX, AY), spec_anims)
print("matron done")
