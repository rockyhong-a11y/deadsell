"""Shared helpers for the boss / NPC sprite scripts (asset_matron, asset_alchemist,
asset_merchant, asset_portrait).  Imported by those scripts; never run directly.

Adds on top of common.py:
  * geometry: lathe (surfaces of revolution), chain links, tattered cloth sheets
  * world-space modelling: build a part at its world rest position, then
    `attach_world` re-expresses it in a joint's space
  * Skin: smooth cloth skinned to rig joints (armature bones that follow the Empties)
  * Pose2D: planar FK + 2-bone IK (legs, arms, flail chain) so planted feet
    stay exactly on the floor and attacks hit exact world positions
  * frame-dir / spec.json helpers
"""
import bpy
import bmesh
import json
import math
import os
from mathutils import Vector, Matrix

from common import (toon, ellipsoid, limb, box, cone, join, Rig, setup_sprite_camera,
                    add_sun, reset_scene, render_animation, sample_keys, ease, lerp_pose,
                    keyed_visibility, PX_PER_UNIT)

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
RIM = "#9fe8ff"

# --------------------------------------------------------------------------
# small utils


def bake(ob):
    """Apply the object's own transform to its mesh (object ends at identity)."""
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    if scale:
        ob.scale = scale
    return bake(ob)


def attach_world(rig, ob, joint):
    """`ob` is modelled at its world rest position; parent it to `joint` keeping it there."""
    bake(ob)
    ob.data.transform(Matrix.Translation(-rig.world_rest[joint]))
    ob.parent = rig.joints[joint]
    ob.location = (0, 0, 0)
    ob.rotation_euler = (0, 0, 0)
    return ob


def smooth(ob, on=True):
    for p in ob.data.polygons:
        p.use_smooth = on
    return ob


def mesh_object(name, verts, faces, mat, smooth_shade=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        if isinstance(mat, (list, tuple)):
            for m in mat:
                ob.data.materials.append(m)
        else:
            ob.data.materials.append(mat)
    smooth(ob, smooth_shade)
    return ob


def solidify(ob, thickness, offset=0.0):
    mod = ob.modifiers.new("solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    mod.use_even_offset = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def lathe(name, profile, mat, segs=24, a0=0.0, a1=360.0, band_mats=None, sy=1.0):
    """Surface of revolution around local Z.  profile = [(r, z), ...].

    a0..a1 (deg) allow partial revolves (open shells).  band_mats: optional list
    of material indices per profile band (len(profile)-1); mat may then be a list.
    """
    full = abs(a1 - a0) >= 359.99
    n = segs if full else segs + 1
    verts, faces, fmat = [], [], []
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([len(verts)])
            verts.append((0, 0, z))
            continue
        ring = []
        for k in range(n):
            a = math.radians(a0 + (a1 - a0) * k / segs)
            ring.append(len(verts))
            verts.append((r * math.cos(a), r * math.sin(a) * sy, z))
        rings.append(ring)
    for bi, (r0, r1) in enumerate(zip(rings, rings[1:])):
        m = band_mats[bi] if band_mats else 0
        kmax = segs
        for k in range(kmax):
            k1 = (k + 1) % n if full else k + 1
            if len(r0) == 1 and len(r1) == 1:
                continue
            if len(r0) == 1:
                faces.append((r0[0], r1[k1], r1[k]))
            elif len(r1) == 1:
                faces.append((r0[k], r0[k1], r1[0]))
            else:
                faces.append((r0[k], r0[k1], r1[k1], r1[k]))
            fmat.append(m)
    ob = mesh_object(name, verts, faces, mat)
    for p, m in zip(ob.data.polygons, fmat):
        p.material_index = m
    # consistent normals
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def _torus_into(verts, faces, M, R, r, nmaj=8, nmin=4, sx=1.45):
    base = len(verts)
    for i in range(nmaj):
        a = 2 * math.pi * i / nmaj
        for j in range(nmin):
            b = 2 * math.pi * j / nmin
            x = (R + r * math.cos(b)) * math.cos(a) * sx
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            verts.append(M @ Vector((x, y, z)))
    for i in range(nmaj):
        for j in range(nmin):
            a = base + i * nmin + j
            b = base + ((i + 1) % nmaj) * nmin + j
            c = base + ((i + 1) % nmaj) * nmin + (j + 1) % nmin
            d = base + i * nmin + (j + 1) % nmin
            faces.append((a, b, c, d))


def resample(pts, step):
    """Points every `step` along polyline pts (list of Vector) with tangents."""
    pts = [Vector(p) for p in pts]
    out = []
    seg_len = [(b - a).length for a, b in zip(pts, pts[1:])]
    total = sum(seg_len)
    n = max(1, int(round(total / step)))
    for k in range(n + 1):
        d = total * k / n
        acc = 0
        for (a, b), L in zip(zip(pts, pts[1:]), seg_len):
            if acc + L >= d - 1e-9 or (a, b) == (pts[-2], pts[-1]):
                u = 0 if L == 0 else min(1, (d - acc) / L)
                out.append((a.lerp(b, u), (b - a).normalized()))
                break
            acc += L
    return out


def chain_links(name, pts, mat, R=0.05, r=0.021, step=0.13, sx=1.45, closed=False, ref=(0, 1, 0),
                nmaj=8, nmin=4):
    """Interlocking chain links along polyline `pts` (world or local coords)."""
    if closed:
        pts = list(pts) + [pts[0]]
    samples = resample(pts, step)
    if closed:
        samples = samples[:-1]
    verts, faces = [], []
    refv = Vector(ref)
    for k, (p, d) in enumerate(samples):
        x = d
        n0 = refv - x * refv.dot(x)
        if n0.length < 1e-4:
            n0 = Vector((0, 0, 1)) - x * x.z
        n0.normalize()
        n1 = x.cross(n0)
        z = n0 if k % 2 == 0 else n1
        y = z.cross(x)
        M = Matrix((
            (x.x, y.x, z.x, p.x),
            (x.y, y.y, z.y, p.y),
            (x.z, y.z, z.z, p.z),
            (0, 0, 0, 1)))
        _torus_into(verts, faces, M, R, r, nmaj, nmin, sx)
    return mesh_object(name, verts, faces, mat)


def ellipse_pts(center, a, b, tilt_x=0.0, tilt_y=0.0, n=40, a0=0, a1=360):
    """Points of an ellipse in the XY plane (semi-axes a along X, b along Y), tilted
    about X then Y (degrees), centred at `center`."""
    c = Vector(center)
    Rx = Matrix.Rotation(math.radians(tilt_x), 3, "X")
    Ry = Matrix.Rotation(math.radians(tilt_y), 3, "Y")
    out = []
    for k in range(n):
        t = math.radians(a0 + (a1 - a0) * k / (n if a1 - a0 >= 360 else n - 1))
        v = Vector((a * math.cos(t), b * math.sin(t), 0))
        out.append(c + Ry @ (Rx @ v))
    return out


def catenary(p0, p1, sag, n=14):
    p0, p1 = Vector(p0), Vector(p1)
    out = []
    for k in range(n + 1):
        u = k / n
        p = p0.lerp(p1, u)
        p.z -= sag * 4 * u * (1 - u)
        out.append(p)
    return out


def helix(center, radius, z0, z1, turns, n=60, axis_tilt=0.0):
    out = []
    c = Vector(center)
    for k in range(n + 1):
        u = k / n
        a = 2 * math.pi * turns * u
        out.append(c + Vector((radius * math.cos(a), radius * math.sin(a), z0 + (z1 - z0) * u)))
    return out


def grid_sheet(name, rows, mat, thick=0.035):
    """Quad grid through `rows` (list of equal-length point lists), solidified."""
    verts = [Vector(p) for row in rows for p in row]
    w = len(rows[0])
    faces = []
    for i in range(len(rows) - 1):
        for j in range(w - 1):
            a = i * w + j
            faces.append((a, a + 1, a + w + 1, a + w))
    ob = mesh_object(name, verts, faces, mat)
    if thick:
        solidify(ob, thick, 0.0)
    return ob


def tattered(n, depth, seed=1, pattern=None):
    """Hem offsets (>=0, downward) for n+1 columns: ragged strips with points."""
    if pattern:
        return [pattern[i % len(pattern)] * depth for i in range(n + 1)]
    import random
    rnd = random.Random(seed)
    out = []
    for i in range(n + 1):
        base = 0.15 if i % 2 else 0.75
        out.append(depth * (base + rnd.random() * 0.35))
    return out


# --------------------------------------------------------------------------
# Skinned cloth: armature bones that follow rig Empties (Child Of), so cloth bends smoothly


class Skin:
    def __init__(self, rig, name="skin"):
        self.rig = rig
        data = bpy.data.armatures.new(name)
        self.ob = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(self.ob)
        self.bones = []
        self.pending = []

    def bone(self, joint, tail):
        self.pending.append((joint, Vector(self.rig.world_rest[joint]), Vector(tail)))

    def build(self):
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = self.ob
        self.ob.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        for j, h, t in self.pending:
            eb = self.ob.data.edit_bones.new(j)
            eb.head = h
            eb.tail = t
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.context.view_layer.update()
        for j, h, t in self.pending:
            pb = self.ob.pose.bones[j]
            c = pb.constraints.new("CHILD_OF")
            c.target = self.rig.joints[j]
            c.inverse_matrix = self.rig.joints[j].matrix_world.inverted()
            self.bones.append(j)
        self.ob.hide_render = True

    def bind(self, ob, weight_fn):
        """ob in world rest coords (unparented). weight_fn(world_co) -> {joint: w}."""
        bake(ob)
        groups = {}
        for v in ob.data.vertices:
            ws = weight_fn(v.co)
            tot = sum(ws.values()) or 1.0
            for j, w in ws.items():
                if w <= 0:
                    continue
                if j not in groups:
                    groups[j] = ob.vertex_groups.new(name=j)
                groups[j].add([v.index], w / tot, "REPLACE")
        mod = ob.modifiers.new("skin", "ARMATURE")
        mod.object = self.ob
        return ob


def chain_weights(joints_z):
    """Weight fn blending along a vertical chain: joints_z = [(joint, z_top_of_segment), ...]
    ordered top->bottom; a segment spans from its z to the next joint's z."""
    mids = []
    for k, (j, z) in enumerate(joints_z):
        z_next = joints_z[k + 1][1] if k + 1 < len(joints_z) else z - 0.6
        mids.append((j, (z + z_next) / 2))

    def fn(co):
        z = co.z
        if z >= mids[0][1]:
            return {mids[0][0]: 1.0}
        for (j0, m0), (j1, m1) in zip(mids, mids[1:]):
            if m1 <= z <= m0:
                u = (m0 - z) / (m0 - m1)
                return {j0: 1 - u, j1: u}
        return {mids[-1][0]: 1.0}
    return fn


# --------------------------------------------------------------------------
# Planar FK / IK (screen plane = world XZ; joint swing = CCW rotation)


def _rot(a, x, z):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    return x * c - z * s, x * s + z * c


class Pose2D:
    """Resolve pose specs into local joint angles.

    spec keys:
      'joint': local swing (deg);  'joint@': WORLD swing (deg)
      'ik_<thigh>': (x, z[, foot_world_deg])   ankle target for a leg (thigh joint name)
      'ik_<shoulder>': (x, z[, hand_world_deg[, bend]]) wrist target for an arm
      'reach_<start>': (x, z[, end_world_deg])  2-segment IK for a chain (start joint)
    Offsets are {joint: (dx, dy, dz)} in parent space (like Rig.pose).
    """

    def __init__(self, rig, limbs):
        """limbs: {first_joint: (mid_joint, end_joint, bend)}; bend=+1 knee-like (mid ahead),
        -1 elbow-like (mid behind), 0 = sag (mid lowest)."""
        self.rig = rig
        self.parent = {}
        for n, e in rig.joints.items():
            self.parent[n] = e.parent.name if e.parent else None
        self.order = []
        seen = set()

        def visit(n):
            if n in seen:
                return
            p = self.parent[n]
            if p:
                visit(p)
            seen.add(n)
            self.order.append(n)
        for n in rig.joints:
            visit(n)
        self.rest = {n: (rig.world_rest[n].x, rig.world_rest[n].z) for n in rig.joints}
        self.limbs = limbs

    def local_rest(self, j):
        p = self.parent[j]
        if p is None:
            return self.rest[j]
        return (self.rest[j][0] - self.rest[p][0], self.rest[j][1] - self.rest[p][1])

    def length(self, a, b):
        ax, az = self.rest[a]
        bx, bz = self.rest[b]
        return math.hypot(bx - ax, bz - az)

    def solve(self, spec, off=None):
        off = off or {}
        ang, W = {}, {}
        for j in self.order:
            p = self.parent[j]
            lx, lz = self.local_rest(j)
            o = off.get(j)
            if o:
                lx += o[0]
                lz += o[2]
            if p is None:
                pos, pa = (lx, lz), 0.0
            else:
                px, pz, pa = W[p]
                rx, rz = _rot(pa, lx, lz)
                pos = (px + rx, pz + rz)
            if j in ang:
                a = ang[j]
            elif (j + "@") in spec:
                a = spec[j + "@"] - pa
            else:
                a = spec.get(j, 0.0)
            ang[j] = a
            W[j] = (pos[0], pos[1], pa + a)
            for key in ("ik_" + j, "reach_" + j):
                if key in spec and j in self.limbs:
                    self._ik(j, spec[key], ang, W, pa, off)
        return ang, W

    def _ik(self, j, tgt, ang, W, pa, off):
        mid, end, bend = self.limbs[j]
        if len(tgt) > 3:
            bend = tgt[3]
        L1 = self.length(j, mid)
        L2 = self.length(mid, end)
        px, pz, _ = W[j]
        tx, tz = tgt[0], tgt[1]
        dx, dz = tx - px, tz - pz
        d = math.hypot(dx, dz)
        d = max(abs(L1 - L2) + 1e-4, min(L1 + L2 - 1e-4, d))
        beta = math.degrees(math.atan2(dx, -dz))
        g = math.degrees(math.acos(max(-1, min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))))
        cands = [beta + g, beta - g]
        if bend == 1:
            phi1 = cands[0]
        elif bend == -1:
            phi1 = cands[1]
        else:  # sag: choose the solution whose mid point is lowest
            phi1 = min(cands, key=lambda f: pz - L1 * math.cos(math.radians(f)))
        kx = px + L1 * math.sin(math.radians(phi1))
        kz = pz - L1 * math.cos(math.radians(phi1))
        # clamp target to reachable distance along the original direction
        ux, uz = (dx / (math.hypot(dx, dz) or 1), dz / (math.hypot(dx, dz) or 1))
        ex, ez = px + ux * d, pz + uz * d
        phi2 = math.degrees(math.atan2(ex - kx, -(ez - kz)))
        ang[j] = phi1 - pa
        ang[mid] = phi2 - phi1
        if len(tgt) > 2 and tgt[2] is not None:
            ang[end] = tgt[2] - phi2
        W[j] = (px, pz, phi1)

    def point(self, W, j, local):
        """World (x,z) of a point given in joint j's local (x,z) frame."""
        x, z, a = W[j]
        rx, rz = _rot(a, local[0], local[1])
        return x + rx, z + rz


# --------------------------------------------------------------------------
# frame dir / spec


def frames_dir(name):
    d = os.path.join(ROOT, "build", "frames", name)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.endswith(".png") or f == "spec.json":
            os.remove(os.path.join(d, f))
    return d


def write_spec(out_dir, fw, fh, anchor, anims, extra=None):
    spec = {"frameW": fw, "frameH": fh, "anchor": list(anchor), "outline": True, "colors": 0,
            "animations": anims}
    if extra:
        spec["extra"] = extra
    with open(os.path.join(out_dir, "spec.json"), "w") as f:
        json.dump(spec, f, indent=1)


class FX:
    """Objects whose render visibility is keyed per animation frame."""

    def __init__(self):
        self.obs = {}

    def add(self, key, ob, default=False):
        self.obs[key] = (ob, default)
        ob.hide_render = not default

    def clear(self):
        for ob, default in self.obs.values():
            ob.animation_data_clear()
            ob.hide_render = not default

    def key(self, frame, visible_keys):
        for k, (ob, default) in self.obs.items():
            vis = (k in visible_keys) if visible_keys is not None else default
            keyed_visibility(ob, frame, vis)


def anim_render(rig, fx, name, n, pose_fn, out_dir, vis_fn=None):
    """render_animation + per-frame FX visibility.  vis_fn(i, n) -> set of FX keys shown
    (None = defaults)."""
    fx.clear()

    def extra(i, n_, frame):
        if vis_fn:
            fx.key(frame, vis_fn(i, n_))
    render_animation(rig, name, n, pose_fn, out_dir, extra if vis_fn else None)
