"""Shared helpers for the six enemy sprite scripts (asset_ghoul.py ... asset_lancer.py).

Everything here builds on common.py (scene, camera, toon materials, Rig,
render_animation).  Additions:

  * ERig       Rig whose pose dicts also accept roll ("joint:x") and twist ("joint:z") keys.
  * flat poses one dict of floats per key pose:   "th_n": 30 (swing), "wing:x": 10 (roll),
               "hips.dz": -0.05 (offset), "head.s": 1.1 (uniform scale) ... so a whole pose
               (angles + offsets + scales) interpolates with common.sample_keys.
  * geometry   tube() (swept polyline), skirt() (frustum with torn hem), leaf() (feather /
               plate), claw(); all return linked, smooth-shaded mesh objects.
  * female body standard joint skeleton + base body meshes with proportion parameters.
  * grounding  ground(): shifts the root so the lowest vertex of the given meshes sits on
               z = 0 (feet exactly on the anchor row in every frame).
  * output     Sheet: wipes build/frames/<name>/, renders animations with per-frame prop
               visibility, writes spec.json for tools/pack/pack_all.py.

Enemies face +X; 1 u = 32 px; frame 128x112, anchor (64,100) = feet centre at the origin.
"""
import bpy
import bmesh
import json
import math
import os
import random
import shutil
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from common import (Rig, toon, ellipsoid, limb, box, cone, join, reset_scene, add_sun,  # noqa: E402,F401
                    setup_sprite_camera, render_animation, sample_keys, ease, _link, _finish)
from mathutils import Vector  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
RIM = "#9fe8ff"
FRAME_W, FRAME_H = 128, 112
ANCHOR = (64, 100)


# --------------------------------------------------------------------------
# scene


def setup_scene():
    """Same light + camera as the heroine prototype (warm key, cool rim in materials)."""
    reset_scene()
    add_sun((0.5, 0.6, -0.7), energy=3.2)
    setup_sprite_camera(FRAME_W, FRAME_H, ANCHOR[0], ANCHOR[1], yaw_deg=20, pitch_deg=4)


def mat(name, base, shadow=None, light=None, rim=True, **kw):
    return toon(name, base, shadow, light, rim=RIM if rim else None, **kw)


def glow(name, color, strength=1.0):
    return toon(name, "#000000", emission=color, emission_strength=strength)


# --------------------------------------------------------------------------
# rig with roll / twist keys and flat pose dicts


class ERig(Rig):
    def pose(self, angles, offsets=None, scales=None, twists=None):
        plain, rolls, tw = {}, {}, dict(twists or {})
        for k, v in angles.items():
            if k.endswith(":x"):
                rolls[k[:-2]] = v
            elif k.endswith(":z"):
                tw[k[:-2]] = v
            else:
                plain[k] = v
        Rig.pose(self, plain, offsets, scales, tw)
        for j, a in rolls.items():
            if j in self.joints:
                self.joints[j].rotation_euler.x = math.radians(a)


def split(flat):
    """flat pose dict -> (angles, offsets, scales) for ERig.pose / render_animation."""
    ang, off, sc = {}, {}, {}
    for k, v in flat.items():
        if "." in k:
            j, c = k.split(".", 1)
            if c in ("dx", "dy", "dz"):
                o = list(off.get(j, (0.0, 0.0, 0.0)))
                o["xyz".index(c[1])] = v
                off[j] = tuple(o)
            elif c == "s":
                sc[j] = (v, v, v)
            elif c in ("sx", "sy", "sz"):
                s = list(sc.get(j, (1.0, 1.0, 1.0)))
                s["xyz".index(c[1])] = v
                sc[j] = tuple(s)
        else:
            ang[k] = v
    return ang, off, sc


def merge(*dicts):
    out = {}
    for d in dicts:
        out.update(d)
    return out


def add(base, extra):
    """base + extra (summing shared keys)."""
    out = dict(base)
    for k, v in extra.items():
        out[k] = out.get(k, 0.0) + v
    return out


def keys_at(keys, t, easing=ease):
    """sample_keys but keys that are missing in a key pose default to the value 0, except
    scale keys (".s", ".sx" ...) which default to 1."""
    allk = set()
    for _, p in keys:
        allk |= set(p)
    full = []
    for tk, p in keys:
        q = {}
        for k in allk:
            q[k] = p.get(k, 1.0 if (".s" in k) else 0.0)
        full.append((tk, q))
    return sample_keys(full, t, easing)


def frames_t(i, n, loop=False):
    """normalised time for frame i of n (loop: 0..(n-1)/n, else 0..1)."""
    if loop:
        return i / n
    return i / max(1, n - 1)


def phase_t(i, w, a, r):
    """Map frame i of a windup/active/recover attack to key time:
    windup frames -> [0, 0.45], active -> [0.5, 0.65], recover -> [0.7, 1]."""
    if i < w:
        return 0.45 * (i / max(1, w - 1))
    i -= w
    if i < a:
        return 0.5 + 0.15 * (i / max(1, a - 1)) if a > 1 else 0.55
    i -= a
    return 0.7 + 0.3 * (i / max(1, r - 1)) if r > 1 else 1.0


# --------------------------------------------------------------------------
# geometry


def _mesh_ob(name, bm, mat_, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    _link(ob)
    return _finish(ob, mat_, smooth)


def tube(name, pts, radii, mat_, segs=8, depth=1.0, cap=True, smooth=True):
    """Tube swept along polyline `pts` with per-point radius; `depth` scales the Y extent
    of the cross-section (flattened ribbons for hair locks, plumes ...)."""
    pts = [Vector(p) for p in pts]
    if isinstance(radii, (int, float)):
        radii = [radii] * len(pts)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        t.normalize()
        ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
        n1 = t.cross(ref).normalized()
        n2 = t.cross(n1).normalized()
        ring = []
        r = max(radii[i], 0.0005)
        for k in range(segs):
            a = 2 * math.pi * k / segs
            off = n1 * (math.cos(a) * r) + n2 * (math.sin(a) * r)
            off = Vector((off.x, off.y * depth, off.z))
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((ra[k], ra[(k + 1) % segs], rb[(k + 1) % segs], rb[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return _mesh_ob(name, bm, mat_, smooth)


def arc_pts(center, radius, a0, a1, n, plane="xz"):
    pts = []
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        if plane == "xz":
            pts.append((center[0] + radius * math.cos(a), center[1], center[2] + radius * math.sin(a)))
        else:
            pts.append((center[0] + radius * math.cos(a), center[1] + radius * math.sin(a), center[2]))
    return pts


def skirt(name, r_top, r_bot, h, mat_, n=16, jag=0.0, depth=1.0, seed=1, bulge=0.0,
          front=1.0, back=1.0, xoff=0.0, cap_top=True):
    """Skirt/dress tube hanging DOWN from z=0 (waist) to z=-h.  r = radius at top / hem.
    jag: torn hem depth (zigzag + random).  bulge: extra radius at mid height (hips).
    front/back: hem length multipliers at +X / -X.  xoff: hem shifted along X (flow)."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    rings = []
    levels = [(0.0, r_top, 0.0), (0.38, (r_top + r_bot) / 2 + bulge, 0.38), (1.0, r_bot, 1.0)]
    for li, (fz, r, fx) in enumerate(levels):
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            ca, sa = math.cos(a), math.sin(a)
            ln = front if ca > 0 else back
            ln = 1.0 + (ln - 1.0) * abs(ca)
            z = -h * fz * ln
            if li == 2 and jag > 0:
                z += (jag if k % 2 else 0.0) + jag * 0.6 * rnd.random()
            ring.append(bm.verts.new((r * ca + xoff * fx, r * sa * depth, z)))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((ra[k], ra[(k + 1) % n], rb[(k + 1) % n], rb[k]))
    if cap_top:
        bm.faces.new(list(reversed(rings[0])))
    return _mesh_ob(name, bm, mat_)


def leaf(name, length, width, thick, mat_, tip=0.35, base=0.35, n=6, curve=0.0):
    """Flat feather/plate hanging DOWN from the origin (-Z), in the XZ plane (faces the camera).
    width profile: rounded base, widest at `base`, pointed tip.  curve bends it toward +X."""
    bm = bmesh.new()
    prof = []
    for i in range(n + 1):
        f = i / n
        if f <= base:
            w = width * (0.45 + 0.55 * math.sin(f / base * math.pi / 2))
        else:
            g = (f - base) / (1 - base)
            w = width * (1 - g ** (1.0 / max(0.2, (1 - tip)))) if g < 1 else 0.0
        prof.append((f, max(w, 0.003)))
    front, back = [], []
    for f, w in prof:
        z = -length * f
        x = curve * length * f * f
        for side, lst in ((-1, front), (1, back)):
            lst.append((bm.verts.new((x - w / 2, side * thick / 2, z)), bm.verts.new((x + w / 2, side * thick / 2, z))))
    for lst in (front, back):
        for (a0, a1), (b0, b1) in zip(lst, lst[1:]):
            bm.faces.new((a0, a1, b1, b0))
    for (fa0, fa1), (fb0, fb1), (ba0, ba1), (bb0, bb1) in zip(front, front[1:], back, back[1:]):
        bm.faces.new((fa0, fb0, bb0, ba0))
        bm.faces.new((fa1, ba1, bb1, fb1))
    bm.faces.new((front[0][0], back[0][0], back[0][1], front[0][1]))
    return _mesh_ob(name, bm, mat_, smooth=False)


def claw(name, length, r, mat_, bend=0.5, segs=6):
    """Curved talon/claw hanging down from origin, curling toward +X."""
    pts = []
    for i in range(5):
        f = i / 4
        a = bend * f * f * 1.6
        pts.append((math.sin(a) * length * f * 0.9, 0, -math.cos(a) * length * f))
    return tube(name, pts, [r, r * 0.8, r * 0.6, r * 0.35, 0.002], mat_, segs=segs)


def bake(ob):
    """Apply the object's location/rotation/scale into its mesh (origin back at 0), so a part
    built with loc=/rot= keeps that placement when attached with Rig.attach."""
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def joined(name, objs):
    """Bake every part, then join them into one object (origin at 0)."""
    for ob in objs:
        bake(ob)
    return join(objs, name)


def disc(name, r, thick, mat_, loc=(0, 0, 0), rot=(0, 0, 0), segs=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=r, depth=thick, location=loc,
                                        rotation=[math.radians(a) for a in rot])
    ob = bpy.context.active_object
    ob.name = name
    return _finish(ob, mat_, smooth=False)


# --------------------------------------------------------------------------
# female base body


def skeleton(r, s=1.0, w=1.0, arms=True, legs=True, sh_w=0.12, hip_w=0.075, arm=1.0):
    """Standard humanoid joints, heroine proportions (1.75 u at s=1).  arm: arm length factor."""
    J = r.joint
    J("hips", "root", (0, 0, 0.92 * s))
    J("spine", "hips", (0, 0, 1.04 * s))
    J("chest", "spine", (0, 0, 1.2 * s))
    J("neck", "chest", (0, 0, 1.44 * s))
    J("head", "neck", (0, 0, 1.52 * s))
    if arms:
        for side, y in (("n", -sh_w * w * s), ("f", sh_w * w * s)):
            J("sh_" + side, "chest", (0, y, 1.38 * s))
            J("el_" + side, "sh_" + side, (0, y, (1.38 - 0.25 * arm) * s))
            J("ha_" + side, "el_" + side, (0, y, (1.38 - 0.46 * arm) * s))
    if legs:
        for side, y in (("n", -hip_w * w * s), ("f", hip_w * w * s)):
            J("th_" + side, "hips", (0, y, 0.9 * s))
            J("kn_" + side, "th_" + side, (0, y, 0.49 * s))
            J("an_" + side, "kn_" + side, (0, y, 0.08 * s))


def body(r, M, s=1.0, w=1.0, bust=1.0, hip=1.0, arms=True, legs=True, feet=True, head=True,
         arm_r=1.0, leg_r=1.0, neck_len=1.0, arm=1.0):
    """Base female body meshes.  M: materials dict with keys
    skin, eye, chest, waist, pelvis, ua, fa, hand, thigh, shin, foot (missing -> skin).
    Returns dict of created objects."""
    g = lambda k: M.get(k) or M["skin"]  # noqa: E731
    A = r.attach
    o = {}
    S = s
    o["pelvis"] = A(ellipsoid("pelvis", (0.27 * S * w * hip, 0.3 * S * w * hip, 0.22 * S), g("pelvis")), "hips", (-0.01 * S, 0, 0))
    o["waist"] = A(ellipsoid("waist", (0.19 * S * w, 0.23 * S * w, 0.24 * S), g("waist")), "spine", (0, 0, 0.03 * S))
    o["chest"] = A(ellipsoid("chestm", (0.25 * S * w, 0.3 * S * w, 0.3 * S), g("chest")), "chest", (0.0, 0, 0.06 * S))
    if bust > 0:
        o["bust"] = A(ellipsoid("bust", (0.15 * S * bust, 0.25 * S * w, 0.13 * S * bust), g("bust") if "bust" in M else g("chest")),
                      "chest", (0.08 * S, 0, 0.06 * S))
    if head:
        o["neck"] = A(limb("neckm", 0.12 * S * neck_len, 0.05 * S, 0.05 * S, g("skin")), "neck", (0, 0, 0.1 * S))
        o["head"] = A(ellipsoid("headm", (0.21 * S, 0.2 * S, 0.24 * S), g("skin")), "head", (0.01 * S, 0, 0.11 * S))
        # small chin/jaw so the face profile reads (slightly pointed, feminine)
        o["jaw"] = A(ellipsoid("jaw", (0.12 * S, 0.13 * S, 0.1 * S), g("skin")), "head", (0.06 * S, 0, 0.03 * S))
    if arms:
        for sd in ("n", "f"):
            o["ua_" + sd] = A(limb("ua_" + sd, 0.24 * S * arm, 0.048 * S * arm_r, 0.04 * S * arm_r, g("ua")), "sh_" + sd)
            o["fa_" + sd] = A(limb("fa_" + sd, 0.2 * S * arm, 0.042 * S * arm_r, 0.033 * S * arm_r, g("fa")), "el_" + sd)
            o["hand_" + sd] = A(ellipsoid("hand_" + sd, (0.07 * S, 0.06 * S, 0.08 * S), g("hand")), "ha_" + sd, (0, 0, -0.03 * S))
    if legs:
        for sd in ("n", "f"):
            o["th_" + sd] = A(limb("thm_" + sd, 0.41 * S, 0.088 * S * leg_r, 0.055 * S * leg_r, g("thigh")), "th_" + sd)
            o["shin_" + sd] = A(limb("shin_" + sd, 0.41 * S, 0.058 * S * leg_r, 0.042 * S * leg_r, g("shin")), "kn_" + sd)
            if feet:
                o["foot_" + sd] = A(box("foot_" + sd, (0.17 * S, 0.075 * S, 0.07 * S), g("foot"), bevel=0.02 * S),
                                    "an_" + sd, (0.04 * S, 0, -0.045 * S))
    return o


def eyes(r, mat_, s=1.0, joint="head", x=0.105, z=0.125, h=0.045, wdt=0.03, span=0.13):
    """Glowing eye strip on the front of the head (reads as 1-2 bright pixels)."""
    return r.attach(ellipsoid("eyes", (wdt * s, span * s, h * s), mat_), joint, (x * s, 0, z * s))


# --------------------------------------------------------------------------
# posing helpers


def world_matrix(ob):
    """World matrix from the ORIGINAL objects' loc/rot/scale (no depsgraph update, so it is
    safe while keyframes are being inserted).  Assumes identity parent-inverse matrices,
    which holds for everything parented through Rig.joint / Rig.attach."""
    m = ob.matrix_basis.copy()
    p = ob.parent
    while p is not None:
        m = p.matrix_basis @ m
        p = p.parent
    return m


def lowest(objs):
    mz = 1e9
    for o in objs:
        mw = world_matrix(o)
        for v in o.data.vertices:
            z = (mw @ v.co).z
            if z < mz:
                mz = z
    return mz


def ground(rig, pose, objs, target=0.0, joint="root"):
    """pose = (angles, offsets, scales).  Adds a z offset to `joint` (root by default) so the
    lowest vertex of `objs` (world space) lands on z = target."""
    ang, off, sc = pose
    rig.pose(ang, off, sc)
    mz = lowest(objs)
    off = dict(off)
    rx, ry, rz = off.get(joint, (0.0, 0.0, 0.0))
    off[joint] = (rx, ry, rz + target - mz)
    return ang, off, sc


HEAD_CHAIN = ("root", "hips", "spine", "chest", "neck", "head")
CHEST_CHAIN = ("root", "hips", "spine", "chest")


def hang(p, joints, chain, sway=0.0):
    """Make dangling joints (hair, braids, cloth) hang down: each joint in `joints`
    [(name, extra_deg), ...] (a parent->child chain) counters the accumulated
    screen-plane rotation of `chain`, plus sway/extra."""
    acc = sum(p.get(k, 0.0) for k in chain)
    for j, extra in joints:
        p[j] = -acc + sway + extra
        acc += p[j]
    return p


def feet_flat(p, toe_n=0.0, toe_f=0.0):
    """Set ankle angles so both feet are level (plus optional toe tilt)."""
    for sd, toe in (("n", toe_n), ("f", toe_f)):
        p["an_" + sd] = -(p.get("root", 0) + p.get("hips", 0) + p.get("th_" + sd, 0) + p.get("kn_" + sd, 0)) + toe
    return p


def joint_xz(rig, name, local=(0.0, 0.0, 0.0)):
    """World (x, z) of a point given in joint `name`'s space (pose must already be applied)."""
    w = world_matrix(rig.joints[name]) @ Vector(local)
    return w.x, w.z


def _down_angle(m):
    """Screen-plane angle (deg, 0 = pointing down, + toward +X) of matrix m's local -Z axis."""
    d = m.to_3x3() @ Vector((0, 0, -1))
    return math.degrees(math.atan2(d.x, -d.z))


def ik2(rig, p, upper, lower, end, target, bend=1.0, end_offset=None):
    """Two-bone screen-plane IK.  Sets p[upper], p[lower] so joint `end` (or end_offset in the
    lower joint's space) reaches world target (x, z).  bend=+1 flexes like an elbow (CCW),
    -1 like a knee.  Returns p (modified)."""
    q = dict(p)
    q[upper] = 0.0
    q[lower] = 0.0
    rig.pose(*split(q))
    mu = world_matrix(rig.joints[upper])
    px, pz = mu.translation.x, mu.translation.z
    phi0 = _down_angle(mu)
    l1 = (rig.world_rest[lower] - rig.world_rest[upper]).length
    if end_offset is not None:
        l2 = Vector(end_offset).length
    else:
        l2 = (rig.world_rest[end] - rig.world_rest[lower]).length
    # account for joint scales (uniform) on the chain parent
    sc = mu.to_scale().x
    l1 *= sc
    l2 *= sc
    tx, tz = target
    dx, dz = tx - px, tz - pz
    d = max(abs(l1 - l2) + 1e-4, min(l1 + l2 - 1e-4, math.hypot(dx, dz)))
    phit = math.degrees(math.atan2(dx, -dz))
    a = math.degrees(math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))))
    b = math.degrees(math.acos(max(-1, min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2)))))
    p[upper] = phit - bend * a - phi0
    p[lower] = bend * (180.0 - b)
    while p[upper] - p.get("_ref_" + upper, 0.0) > 180:
        p[upper] -= 360
    while p[upper] - p.get("_ref_" + upper, 0.0) < -180:
        p[upper] += 360
    return p


def point_at(rig, p, joint, target, rest_dir=-90.0):
    """Swing `joint` so that its local -Z axis points from the joint toward world target (x, z)."""
    q = dict(p)
    q[joint] = 0.0
    rig.pose(*split(q))
    m = world_matrix(rig.joints[joint])
    phi0 = _down_angle(m)
    dx, dz = target[0] - m.translation.x, target[1] - m.translation.z
    p[joint] = math.degrees(math.atan2(dx, -dz)) - phi0
    return p


def walk_legs(t, stride=28.0, knee=48.0, lift=1.0, phase=0.0):
    """Leg swing angles for a walk cycle at normalised time t (0..1)."""
    out = {}
    for sd, ph in (("n", 0.0), ("f", 0.5)):
        a = 2 * math.pi * (t + ph + phase)
        s, c = math.sin(a), math.cos(a)
        th = stride * s
        kn = -knee * lift * max(0.0, c) ** 1.4 - 6 - 6 * max(0.0, -s)
        out["th_" + sd] = th
        out["kn_" + sd] = kn
        out["an_" + sd] = -0.6 * (th + kn) * (1 if c < 0 else 0.4) + 6 * max(0.0, c)
    return out


# --------------------------------------------------------------------------
# output


class Sheet:
    """Collects animations, renders them into build/frames/<name>/ and writes spec.json."""

    def __init__(self, name, rig):
        self.name = name
        self.rig = rig
        self.dir = os.path.join(ROOT, "build", "frames", name)
        if os.path.isdir(self.dir):
            shutil.rmtree(self.dir)
        os.makedirs(self.dir)
        self.anims = []
        self.props = {}      # name -> (object, default visible)

    def prop(self, ob, visible=True):
        """Register an object whose visibility can change per frame."""
        self.props[ob.name] = (ob, visible)
        ob.hide_render = not visible
        return ob

    def render(self, name, frames, pose_fn, fps=12, loop=False, wa=None, vis_fn=None, ground_objs=None,
               ground_fn=None, extra_fn=None, grounds=None, lift_fn=None):
        """pose_fn(i, n) -> flat pose dict.  vis_fn(i, n) -> {object name: visible}.
        ground_objs: meshes whose lowest vertex is kept on z=0 each frame.
        ground_fn(i, n) -> list of meshes (overrides ground_objs per frame) or None (no grounding).
        grounds: [(joint, meshes), ...] -- each group is grounded by shifting that joint (in its
        parent's space; parent must be unrotated), applied after ground_objs.
        lift_fn(i, n) -> z offset added to the root AFTER grounding (flyers bobbing around the anchor).
        wa: (windup, active, recover) for attack animations."""
        for ob, _ in self.props.values():
            ob.animation_data_clear()

        def pf(i, n):
            pose = split(pose_fn(i, n))
            objs = ground_fn(i, n) if ground_fn else ground_objs
            if objs:
                pose = ground(self.rig, pose, objs)
            for j, gobjs in (grounds or []):
                pose = ground(self.rig, pose, gobjs, joint=j)
            if lift_fn:
                ang, off, sc = pose
                off = dict(off)
                rx, ry, rz = off.get("root", (0.0, 0.0, 0.0))
                off["root"] = (rx, ry, rz + lift_fn(i, n))
                pose = (ang, off, sc)
            return pose

        def ef(i, n, frame):
            v = vis_fn(i, n) if vis_fn else {}
            for nm, (ob, dflt) in self.props.items():
                ob.hide_render = not v.get(nm, dflt)
                ob.keyframe_insert("hide_render", frame=frame)
                for fc in ob.animation_data.action.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = "CONSTANT"
            if extra_fn:
                extra_fn(i, n, frame)

        render_animation(self.rig, name, frames, pf, self.dir, extra_fn=ef)
        for ob, _ in self.props.values():
            ad = ob.animation_data
            if ad and ad.action:
                for fc in ad.action.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = "CONSTANT"
        entry = {"name": name, "fps": fps, "loop": loop}
        if wa:
            assert sum(wa) == frames, (name, wa, frames)
            entry.update({"windup": wa[0], "active": wa[1], "recover": wa[2]})
        self.anims.append(entry)

    def write_spec(self, extra=None):
        spec = {"frameW": FRAME_W, "frameH": FRAME_H, "anchor": list(ANCHOR), "outline": True,
                "colors": 0, "out": "sprites/%s.png" % self.name, "animations": self.anims}
        if extra:
            spec["extra"] = extra
        with open(os.path.join(self.dir, "spec.json"), "w") as f:
            json.dump(spec, f, indent=1)
        print("[%s] wrote %d animations -> %s" % (self.name, len(self.anims), self.dir))


def run(main):
    """Run main(); exit non-zero on error so build_assets.sh notices failures."""
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.stdout.flush()
        os._exit(1)
