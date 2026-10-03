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


# ==========================================================================
# THE IRON MATRON  (boss model, shared by asset_matron.py and asset_portrait.py)
# ==========================================================================

class Model:
    pass


def matron_materials(cast=False):
    M = Model()
    M.iron = toon("mt_iron", "#5d6680", "#272a3c", "#a8b3cc", rim=RIM)
    M.iron_d = toon("mt_iron_d", "#3a3e54", "#16172a", "#636c8a", rim=RIM)
    M.bronze = toon("mt_bronze", "#a86f38", "#4f2b2b", "#e8ac5c", rim=RIM)
    M.leather = toon("mt_leather", "#4d3034", "#22151f", "#714a45", rim=RIM)
    M.mail = toon("mt_mail", "#403d55", "#1c1a2c", "#67657f", rim=RIM)
    M.red = toon("mt_red", "#82202f", "#3b0d24", "#b0343d", rim=RIM)
    M.cape = toon("mt_cape", "#33264a", "#150f24", "#52406c", rim=RIM)
    M.cape_in = toon("mt_cape_in", "#5a1a2c", "#2a0b1e", "#7d2638", rim=RIM)
    M.skin = toon("mt_skin", "#dcb5a5", "#8c6376", "#f4d8c9", rim=RIM)
    M.lips = toon("mt_lips", "#8a2a3e", "#4a1128", "#b0405a")
    M.hair = toon("mt_hair", "#93392a", "#431526", "#c8553b", rim=RIM)
    M.mouth = toon("mt_mouth", "#2a0a16", "#16050d", "#3d1020")
    M.bell = toon("mt_bell", "#4f566d", "#1e1f31", "#929db8", rim=RIM)
    M.eye = toon("mt_eye", "#000000", emission="#ffb23d")
    M.eye_hot = toon("mt_eye_hot", "#000000", emission="#fff0a8")
    M.ember = toon("mt_ember", "#000000", emission="#ff9a3a")
    M.ember_d = toon("mt_ember_d", "#000000", emission="#c8401c")
    M.smear = toon("mt_smear", "#000000", emission="#ffe7bf")
    M.smear2 = toon("mt_smear2", "#000000", emission="#ffb066")
    M.dust = toon("mt_dust", "#8a7a74", "#4a3c48", "#c2b3a2")
    M.rock = toon("mt_rock", "#5a5266", "#2a2434", "#86809a", rim=RIM)
    if not cast:
        for v in vars(M).values():
            v.shadow_method = "NONE"
    return M


MATRON_LIMBS = {
    "th_n": ("kn_n", "an_n", 1), "th_f": ("kn_f", "an_f", 1),
    "sh_n": ("el_n", "ha_n", -1), "sh_f": ("el_f", "ha_f", -1),
    "fl0": ("fl1", "bell", 0),
}


def build_matron(q=1):
    """Build the rigged Iron Matron.  q = mesh quality multiplier (portrait uses 3)."""
    M = matron_materials()
    S = lambda n: max(6, int(n * q))  # noqa: E731

    def E(name, size, mat, loc, rot=(0, 0, 0), segs=16, rings=10):
        ob = ellipsoid(name, size, mat, loc=loc, rot=rot, segs=S(segs), rings=S(rings))
        return bake(ob)

    def L(name, length, r0, r1, mat, loc, rot=(0, 0, 0), depth=1.0, segs=12):
        ob = limb(name, length, r0, r1, mat, depth_scale=depth, segs=S(segs))
        return place(ob, loc, rot)

    def C(name, rb, rt, h, mat, loc, rot=(0, 0, 0), segs=12, depth=1.0):
        ob = cone(name, rb, rt, h, mat, loc=(0, 0, 0), rot=rot, segs=S(segs), depth_scale=depth)
        ob.location = loc
        return bake(ob)

    r = Rig("matron")
    J = r.joint
    J("hips", "root", (0, 0, 1.95))
    J("spine", "hips", (0, 0, 2.35))
    J("chest", "spine", (0, 0, 2.80))
    J("neck", "chest", (0.04, 0, 3.36))
    J("head", "neck", (0.06, 0, 3.50))
    J("jaw", "head", (0.10, 0, 3.64))
    J("braid", "head", (-0.25, 0, 3.70))
    J("braid1", "braid", (-0.29, 0, 3.38))
    J("braid2", "braid1", (-0.31, 0, 3.02))
    J("braid3", "braid2", (-0.32, 0, 2.66))
    J("braid4", "braid3", (-0.33, 0, 2.30))
    for s, y in (("n", -0.58), ("f", 0.58)):
        J("pa_" + s, "chest", (0, y, 3.18))
        J("sh_" + s, "chest", (0, y, 3.14))
        J("el_" + s, "sh_" + s, (0, y, 2.40))
        J("ha_" + s, "el_" + s, (0, y, 1.74))
    J("fl0", "ha_n", (0, -0.58, 1.62))
    J("fl1", "fl0", (0, -0.58, 1.20))
    J("bell", "fl1", (0, -0.58, 0.78))
    J("collar", "chest", (-0.12, 0, 3.30))
    J("cape", "chest", (-0.32, 0, 3.12))
    J("cape1", "cape", (-0.40, 0, 2.40))
    J("cape2", "cape1", (-0.46, 0, 1.64))
    J("cape3", "cape2", (-0.50, 0, 0.88))
    for s, y in (("n", -0.27), ("f", 0.27)):
        J("th_" + s, "hips", (0, y, 1.86))
        J("kn_" + s, "th_" + s, (0, y, 1.00))
        J("an_" + s, "kn_" + s, (0, y, 0.17))
    J("tab", "hips", (0.33, 0, 1.86))
    J("tab1", "tab", (0.34, 0, 1.22))
    J("skb", "hips", (-0.30, 0, 1.84))
    A = lambda ob, j: attach_world(r, ob, j)  # noqa: E731

    # ---------------- legs
    for s, y in (("n", -0.27), ("f", 0.27)):
        A(L("thigh_" + s, 0.86, 0.25, 0.19, M.mail, (0, y, 1.86)), "th_" + s)
        A(E("tasset_" + s, (0.36, 0.2, 0.56), M.iron, (0.13, y * 1.45, 1.52), rot=(14 if y < 0 else -14, -8, 0)), "th_" + s)
        A(E("tasset_r_" + s, (0.37, 0.21, 0.07), M.bronze, (0.13, y * 1.45, 1.27), rot=(14 if y < 0 else -14, -8, 0)), "th_" + s)
        A(E("kneecop_" + s, (0.32, 0.3, 0.3), M.iron, (0.1, y, 1.0)), "kn_" + s)
        A(C("kneespk_" + s, 0.07, 0.0, 0.17, M.iron_d, (0.22, y, 1.02), rot=(0, 90, 0), segs=8), "kn_" + s)
        A(L("greave_" + s, 0.83, 0.2, 0.145, M.iron, (0, y, 1.0)), "kn_" + s)
        A(E("cuff_" + s, (0.3, 0.3, 0.14), M.iron_d, (0.0, y, 0.24)), "an_" + s)
        A(E("sabaton_" + s, (0.58, 0.3, 0.22), M.iron, (0.12, y, 0.09)), "an_" + s)
        A(E("toe_" + s, (0.24, 0.26, 0.17), M.iron_d, (0.36, y, 0.065)), "an_" + s)

    # ---------------- hips / skirt
    A(E("pelvis", (0.72, 0.82, 0.52), M.leather, (-0.03, 0, 1.98)), "hips")
    A(E("belt", (0.8, 0.9, 0.13), M.leather, (0.0, 0, 2.12)), "hips")
    A(box("buckle", (0.07, 0.16, 0.14), M.bronze, loc=(0.4, 0, 2.12), bevel=0.02), "hips")
    A(C("fauld", 0.5, 0.41, 0.48, M.iron, (-0.02, 0, 1.62), depth=1.12, segs=16), "hips")
    A(C("fauld2", 0.53, 0.5, 0.06, M.bronze, (-0.02, 0, 1.6), depth=1.12, segs=16), "hips")
    # back skirt: tattered dark red cloth behind the legs
    rows = []
    hem = tattered(10, 0.22, seed=3)
    for k in range(6):
        v = k / 5
        row = []
        for c in range(11):
            u = c / 10 * 2 - 1
            half = 0.46 + 0.1 * v
            x = -0.22 - 0.2 * v - 0.12 * (1 - u * u)
            z = 1.9 - 0.95 * v - (hem[c] if k == 5 else 0)
            row.append((x, u * half, z))
        rows.append(row)
    A(grid_sheet("backskirt", rows, M.red, 0.04), "skb")
    # front tabard (2 rigid panels)
    def panel(name, x0, z0, z1, w0, w1, jag=None, mat=M.red):
        rows = []
        n = 6
        for k in range(4):
            v = k / 3
            row = []
            for c in range(n + 1):
                u = c / n * 2 - 1
                half = w0 + (w1 - w0) * v
                z = z0 + (z1 - z0) * v - ((jag[c] if jag else 0) if k == 3 else 0)
                row.append((x0 + 0.02 * v - 0.05 * u * u, u * half, z))
            rows.append(row)
        return grid_sheet(name, rows, mat, 0.035)
    A(panel("tabard0", 0.38, 2.0, 1.15, 0.2, 0.22), "tab")
    A(panel("tabard1", 0.39, 1.26, 0.62, 0.22, 0.24, jag=[0.0, 0.16, 0.05, 0.2, 0.02, 0.14, 0.0]), "tab1")
    A(E("tab_emb", (0.04, 0.14, 0.17), M.bronze, (0.41, 0, 1.62)), "tab")
    # belt chain loop + hanging chain at the near hip
    A(chain_links("chain_belt", ellipse_pts((0.0, 0, 2.02), 0.44, 0.5, tilt_x=-8, n=48), M.iron_d,
                  R=0.045, r=0.019, step=0.11, closed=True), "hips")
    A(chain_links("chain_hang", catenary((0.32, -0.44, 2.02), (-0.34, -0.42, 2.0), 0.48), M.iron_d,
                  R=0.045, r=0.019, step=0.11), "hips")

    # ---------------- torso
    A(E("waist", (0.56, 0.68, 0.6), M.leather, (0.0, 0, 2.36)), "spine")
    A(E("waistband0", (0.6, 0.72, 0.07), M.iron_d, (0.0, 0, 2.24)), "spine")
    A(E("waistband1", (0.6, 0.72, 0.07), M.iron_d, (0.0, 0, 2.44)), "spine")
    A(E("breast", (0.8, 0.96, 0.8), M.iron, (-0.01, 0, 2.93)), "chest")
    A(E("bust", (0.4, 0.8, 0.36), M.iron, (0.22, 0, 2.86)), "chest")
    A(E("bust_rim", (0.42, 0.82, 0.06), M.bronze, (0.2, 0, 2.7), rot=(0, -6, 0)), "chest")
    A(E("neckline", (0.56, 0.74, 0.1), M.bronze, (0.06, 0, 3.22), rot=(0, 14, 0)), "chest")
    A(E("gorget", (0.48, 0.54, 0.28), M.iron, (0.03, 0, 3.32)), "chest")
    A(chain_links("chain_sash", ellipse_pts((0.0, 0, 2.62), 0.47, 0.62, tilt_x=38, n=56), M.iron_d,
                  R=0.045, r=0.019, step=0.11, closed=True), "chest")
    # high collar (queenly) behind the head
    col = lathe("collar_m", [(0.34, 3.18), (0.40, 3.45), (0.50, 3.78)], M.cape_in, segs=S(14),
                a0=100, a1=260)
    solidify(col, 0.05)
    col.location = (-0.04, 0, 0)
    A(col, "collar")

    # ---------------- head
    A(L("neckm", 0.32, 0.14, 0.14, M.skin, (0.04, 0, 3.52)), "neck")
    A(E("headm", (0.40, 0.36, 0.46), M.skin, (0.10, 0, 3.74)), "head")
    A(E("nose", (0.08, 0.07, 0.11), M.skin, (0.3, 0, 3.71), rot=(0, 15, 0)), "head")
    A(E("mouthin", (0.1, 0.17, 0.08), M.mouth, (0.25, 0, 3.6)), "head")
    A(E("lip_u", (0.06, 0.15, 0.04), M.lips, (0.285, 0, 3.625)), "head")
    A(E("chin", (0.26, 0.27, 0.18), M.skin, (0.19, 0, 3.575)), "jaw")
    A(E("lip_l", (0.06, 0.14, 0.04), M.lips, (0.28, 0, 3.6)), "jaw")
    eyes = []
    for y in (-0.085, 0.085):
        eyes.append(A(E("eye%d" % len(eyes), (0.05, 0.08, 0.045), M.eye, (0.285, y, 3.775)), "head"))
    hot = []
    for y in (-0.085, 0.085):
        hot.append(A(E("eyeh%d" % len(hot), (0.06, 0.1, 0.06), M.eye_hot, (0.29, y, 3.775)), "head"))
    # helm
    A(E("helm", (0.47, 0.45, 0.36), M.iron, (0.05, 0, 3.93)), "head")
    A(E("helm_back", (0.36, 0.44, 0.46), M.iron, (-0.07, 0, 3.76)), "head")
    A(E("brow", (0.16, 0.36, 0.08), M.iron_d, (0.25, 0, 3.835), rot=(0, 12, 0)), "head")
    for s, y in (("n", -0.19), ("f", 0.19)):
        A(E("cheek_" + s, (0.24, 0.08, 0.28), M.iron, (0.12, y, 3.7), rot=(0, -10, 0)), "head")
    ring = lathe("crownband", [(0.245, 3.84), (0.255, 3.9), (0.245, 3.96)], M.bronze, segs=S(20), sy=0.97)
    solidify(ring, 0.03)
    ring.location = (0.06, 0, 0)
    A(ring, "head")
    for k in range(10):
        a = 360 * k / 10
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        front = (1 + ca) / 2  # 1 at front, 0 at back
        h = 0.16 + 0.2 * front ** 2
        A(C("spike%d" % k, 0.055, 0.0, h, M.iron_d, (0.06 + 0.24 * ca, 0.23 * sa, 3.93),
            rot=(-16 * sa, 16 * ca, 0), segs=8), "head")
    A(E("braidroot", (0.2, 0.2, 0.22), M.hair, (-0.25, 0, 3.7)), "braid")
    bj = ["braid", "braid1", "braid2", "braid3", "braid4"]
    for k, j in enumerate(bj):
        x0, z0 = r.world_rest[j].x, r.world_rest[j].z
        if k + 1 < len(bj):
            x1, z1 = r.world_rest[bj[k + 1]].x, r.world_rest[bj[k + 1]].z
        else:
            x1, z1 = x0 - 0.01, z0 - 0.3
        w = 0.17 - 0.018 * k
        for t, dy in ((0.28, -0.03), (0.72, 0.03)):
            A(E("plait_%d_%d" % (k, t * 100), (w, w, 0.24), M.hair,
                (x0 + (x1 - x0) * t, dy, z0 + (z1 - z0) * t), rot=(0, 0, 0)), j)
        if k > 0:
            A(E("bring%d" % k, (w + 0.04, w + 0.04, 0.06), M.bronze, (x0, 0, z0)), j)
    A(C("braidtip", 0.1, 0.0, 0.2, M.hair, (-0.34, 0, 2.02), rot=(180, 0, 0), segs=8), "braid4")
    A(E("braidweight", (0.12, 0.12, 0.12), M.iron_d, (-0.34, 0, 2.08)), "braid4")

    # ---------------- arms
    for s, y in (("n", -0.58), ("f", 0.58)):
        sg = -1 if y < 0 else 1
        A(E("paul_" + s, (0.76, 0.62, 0.54), M.iron, (0.0, y * 1.06, 3.24)), "pa_" + s)
        A(E("paul2_" + s, (0.7, 0.58, 0.38), M.iron_d, (0.0, y * 1.1, 3.02)), "pa_" + s)
        A(E("paulr_" + s, (0.78, 0.64, 0.07), M.bronze, (0.0, y * 1.07, 3.08)), "pa_" + s)
        for k, (dx, h) in enumerate(((-0.2, 0.26), (0.02, 0.36), (0.22, 0.26))):
            A(C("pspk_%s%d" % (s, k), 0.075, 0.0, h, M.iron_d, (dx, y * 1.12, 3.4),
                rot=(sg * -22, 10 * (dx / 0.2), 0), segs=8), "pa_" + s)
        A(L("uarm_" + s, 0.74, 0.17, 0.15, M.mail, (0, y, 3.14)), "sh_" + s)
        A(E("elb_" + s, (0.26, 0.26, 0.24), M.iron, (-0.04, y, 2.4)), "el_" + s)
        A(L("farm_" + s, 0.62, 0.17, 0.14, M.iron, (0, y, 2.36)), "el_" + s)
        A(E("vcuff_" + s, (0.36, 0.36, 0.14), M.iron_d, (0.0, y, 2.2)), "el_" + s)
        A(E("fist_" + s, (0.3, 0.28, 0.3), M.iron_d, (0.03, y, 1.64)), "ha_" + s)
        A(E("knuck_" + s, (0.1, 0.26, 0.2), M.bronze, (0.16, y, 1.64)), "ha_" + s)
    # chain coiled around the near forearm (she holds the slack)
    A(chain_links("chain_coil", helix((0, -0.58, 0), 0.2, 2.18, 1.86, 2.2, n=60), M.iron_d,
                  R=0.04, r=0.017, step=0.1), "el_n")
    # broken shackle on the far wrist
    A(lathe("shackle", [(0.18, 1.83), (0.21, 1.87), (0.18, 1.91), (0.16, 1.87), (0.18, 1.83)], M.iron_d, segs=S(12)), "ha_f")
    A(chain_links("chain_shackle", [(0.0, 0.58 + 0.2, 1.85), (-0.05, 0.6 + 0.24, 1.6), (-0.1, 0.62 + 0.24, 1.42)],
                  M.iron_d, R=0.04, r=0.017, step=0.1), "ha_f")

    # ---------------- flail: chain + bell
    y = -0.58
    A(chain_links("chain_fl0", [(0, y, 1.66), (0, y, 1.20)], M.iron_d, R=0.055, r=0.024, step=0.135,
                  ref=(1, 0, 0)), "fl0")
    A(chain_links("chain_fl1", [(0, y, 1.20), (0, y, 0.80)], M.iron_d, R=0.055, r=0.024, step=0.135,
                  ref=(1, 0, 0)), "fl1")
    H = 0.86
    top = 0.78 - 0.12
    prof = [(0, top - 0.44), (0.22, top - 0.5), (0.38, top - 0.68), (0.47, top - H + 0.03),
            (0.54, top - H), (0.575, top - H + 0.05), (0.535, top - H + 0.14), (0.46, top - 0.6),
            (0.41, top - 0.42), (0.38, top - 0.26), (0.33, top - 0.12), (0.24, top - 0.04),
            (0.12, top - 0.005), (0, top)]
    bellm = lathe("bellm", prof, [M.bell, M.ember_d], segs=S(20), band_mats=[1, 1, 1] + [0] * 10)
    bellm.location = (0, y, 0)
    parts = [bake(bellm)]
    for nm, rr, zz, mn in (("bell_bow", 0.52, top - H + 0.12, 0.035), ("bell_band", 0.4, top - 0.3, 0.03)):
        tor = lathe(nm, [(rr, zz - mn), (rr + mn, zz), (rr, zz + mn), (rr - mn * 0.5, zz), (rr, zz - mn)], M.bronze, segs=S(20))
        tor.location = (0, y, 0)
        parts.append(bake(tor))
    for k in range(8):
        a = 360 * k / 8 + 22.5
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        sp = C("bspk%d" % k, 0.065, 0.0, 0.17, M.iron_d, (0.4 * ca, y + 0.4 * sa, top - 0.5),
               rot=(0, 90, a), segs=8)
        parts.append(sp)
    clap = E("clapper", (0.2, 0.2, 0.2), M.ember, (0, y, top - H + 0.04))
    parts.append(clap)
    loop = lathe("bell_loop", [(0.06, 0.0), (0.09, 0.03), (0.06, 0.06), (0.03, 0.03), (0.06, 0.0)], M.iron_d, segs=S(10))
    place(loop, (0, y, top + 0.06), rot=(90, 0, 0))
    parts.append(loop)
    bell = join(parts, "bell_obj")
    A(bell, "bell")

    # ---------------- cape (skinned cloth)
    sk = Skin(r, "matron_skin")
    sk.bone("cape", r.world_rest["cape1"])
    sk.bone("cape1", r.world_rest["cape2"])
    sk.bone("cape2", r.world_rest["cape3"])
    sk.bone("cape3", r.world_rest["cape3"] + Vector((-0.05, 0, -0.6)))
    sk.build()
    hem = tattered(16, 0.42, pattern=[0.1, 0.85, 0.35, 1.0, 0.15, 0.6, 0.05, 0.9, 0.4, 0.7, 0.0, 0.95, 0.3, 0.55, 0.12, 0.8, 0.25])
    rows = []
    NR = 12
    for k in range(NR + 1):
        v = k / NR
        row = []
        for c in range(17):
            u = c / 16 * 2 - 1
            half = 0.62 + 0.3 * v
            xs = -0.12 - 0.22 * v
            xc = -0.46 - 0.34 * v
            x = xs + (xc - xs) * (1 - u * u)
            z = 3.3 - 2.72 * v - hem[c] * (v ** 6)
            row.append((x, u * half, z))
        rows.append(row)
    capeo = grid_sheet("capem", rows, [M.cape], 0.045)
    sk.bind(capeo, chain_weights([("cape", 3.12), ("cape1", 2.40), ("cape2", 1.64), ("cape3", 0.88)]))

    m = Model()
    m.rig, m.M, m.skin = r, M, sk
    m.eyes, m.eyes_hot = eyes, hot
    m.P = Pose2D(r, MATRON_LIMBS)
    m.bell_top = top
    m.bell_H = H
    return m
