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


@anim("idle", 10, loop=True)
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
            wind=(-1.6 - 0.6 * S(TAU * t * 2), 0.5),
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
                  "th_n": ln["th"], "kn_n": ln["kn"], "an_n": ln["an"],
                  "th_f": lf["th"], "kn_f": lf["kn"], "an_f": lf["an"],
                  "sh_n": -48 * sw + 6, "el_n": 88 - 18 * sw, "ha_n": -15,
                  "sh_f": 48 * sw + 6, "el_f": 88 + 18 * sw, "ha_f": -15},
            "hip": (0.04, 0.0),
            "ground": max(0.0, 0.045 * bob),
            "vel": (4.7, 0.0),
        })
    return out


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
    for (a, off), sp in zip(posed, specs):
        scl = {}
        if "sc" in sp:
            scl["root"] = (sp["sc"][0], 1.0, sp["sc"][1])
        rig.pose(a, off, scl)
        L.update()
        m = {}
        for j in ("sh_n", "sh_f", "ha_n", "ha_f", "an_n", "an_f", "head", "chest", "hips"):
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
        return out
    return fx


def render_anim(h, entry):
    name, fps, loop, phases, fn, opts = entry
    specs = fn()
    if phases:
        assert sum(phases) == len(specs), (name, phases, len(specs))
    posed = L.solve_frames(h, specs, fps, loop, pre=opts.get("pre"), wind=opts.get("wind", (0.0, 0.0)),
                           seed_phase=opts.get("seed", 0.0))
    meas = measure(h, posed, specs)
    smears = []
    for i, sp in enumerate(specs):
        for k, sm in enumerate(sp.get("smear", [])):
            smears.append((i, make_smear(h, "smear_%s_%d_%d" % (name, i, k), meas, sm, i)))
    # ponytail ember dims in the last frames of death
    dim = opts.get("dim_from")
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
