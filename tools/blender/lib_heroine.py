"""Cinder (the heroine): model, rig and animation machinery.

Shared by asset_heroine.py (sprite sheet) and asset_title.py (title key art).

Machinery on top of common.Rig:
  * planar 2-bone IK for hands/feet (+ weapon aim, flat-foot planting)
  * auto-grounding (lowest sole point -> z = 0)
  * Verlet chains (ponytail, two scarf tails) driven by the rendered body motion
    plus the character's virtual world velocity -> lagged secondary motion
  * skirt panels pushed by the thighs
  * per-frame props / FX (weapons, smears built from the real blade-tip arc,
    bow string + arrow, dust, sparks)

Frame spec (dict) understood by `solve_frames`:
  a     {joint: swing deg}         FK swings (spine, head, ...)
  hip   (dx, dz)                    hips offset from rest
  cog   deg                         whole-body spin about the cog pivot
  cogo  (dx, dz)                    cog pivot offset
  fn/ff (x, z, pitch)               near/far ankle IK target (world), foot pitch (deg, + = toes up)
  hn/hf (x, z, aim[, bend])         near/far wrist IK target + hand/weapon world angle (deg CCW from +X)
        ('grip', prop, t[, aim])    far hand grabs point t (prop-local z) of a held prop
  ground  float|None                shift hips so the lowest sole point sits at this z
  sc    (sx, sz)                    squash/stretch (root scale)
  vel   (vx, vz)                    character world velocity (u/s) for hair/scarf/skirt
  show  [prop names]                visible props this frame
  fx    [fx names]                  extra fx objects this frame
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler, Quaternion

import common
from common import toon, ellipsoid, limb, box, cone, join, Rig

RIM = "#9fe8ff"
D2R = math.pi / 180.0
R2D = 180.0 / math.pi


# ---------------------------------------------------------------------------
# Materials


def make_materials():
    T = toon
    M = {}
    M["skin"] = T("h_skin", "#f4d2be", "#b07583", "#fff4ec", rim=RIM)
    M["skin_f"] = T("h_skin_f", "#cc9c9a", "#7a4b68", "#e6bdb2", rim=RIM)
    M["hair"] = T("h_hair", "#e2e6f4", "#8487b2", "#ffffff", rim=RIM, shadow_at=0.28)
    M["hair_d"] = T("h_hair_d", "#b9bedb", "#6c6e98", "#dfe3f2", rim=RIM)
    M["glow1"] = T("h_glow1", "#000000", emission="#c9fcff")
    M["glow2"] = T("h_glow2", "#000000", emission="#5ff0ff")
    M["glow_dim"] = T("h_glow_dim", "#000000", emission="#3d7f95")
    M["corset"] = T("h_corset", "#245a6e", "#122a3d", "#3f8ea5", rim=RIM)
    M["corset_d"] = T("h_corset_d", "#173d4f", "#0c1c2c", "#2a6278", rim=RIM)
    M["skirt"] = T("h_skirt", "#951d33", "#4a0d29", "#cf3646", rim=RIM)
    M["skirt_d"] = T("h_skirt_d", "#6a1429", "#360a22", "#9a2338", rim=RIM)
    M["legs"] = T("h_legs", "#33304e", "#1a182f", "#514a78", rim=RIM)
    M["legs_f"] = T("h_legs_f", "#211e36", "#110f22", "#36315a", rim=RIM)
    M["boots"] = T("h_boots", "#6a3d2c", "#2f1b22", "#93573c", rim=RIM)
    M["boots_f"] = T("h_boots_f", "#4a2a21", "#22121a", "#6a3d2d", rim=RIM)
    M["sole"] = T("h_sole", "#2a1a1e", "#160c14", "#3c262a")
    M["leather"] = T("h_leather", "#8a5532", "#40231f", "#b97a45", rim=RIM)
    M["leather_f"] = T("h_leather_f", "#5f3a25", "#2e1a1a", "#83532f", rim=RIM)
    M["steel"] = T("h_steel", "#a3adc2", "#4f566f", "#f0f5fd", rim=RIM)
    M["steel_f"] = T("h_steel_f", "#6f7790", "#353a51", "#a7b0c6", rim=RIM)
    M["gold"] = T("h_gold", "#e0ad45", "#8a5527", "#ffe9a0")
    M["scarf"] = T("h_scarf", "#d8303f", "#701532", "#ff6b62", rim=RIM)
    M["scarf_d"] = T("h_scarf_d", "#a51f38", "#52102c", "#d8414c", rim=RIM)
    M["eye"] = T("h_eye", "#000000", emission="#a5fbff")
    M["wood"] = T("h_wood", "#7d5233", "#3b2321", "#a8744a", rim=RIM)
    M["wood_d"] = T("h_wood_d", "#4e3022", "#24151a", "#6d4630", rim=RIM)
    M["iron"] = T("h_iron", "#5f6578", "#2b2e3f", "#8f97ac", rim=RIM)
    M["rust"] = T("h_rust", "#94502c", "#4b2420", "#c0733e")
    M["blade"] = T("h_blade", "#bcc5d6", "#5d6683", "#f7faff", rim=RIM)
    M["string"] = T("h_string", "#000000", emission="#d9d2c0")
    M["fletch"] = T("h_fletch", "#d8303f", "#701532", "#ff6b62")
    M["smear"] = T("h_smear", "#000000", emission="#f2fbff")
    M["smear2"] = T("h_smear2", "#000000", emission="#8eeeff")
    M["flask"] = T("h_flask", "#000000", emission="#ff3f5a")
    M["glass"] = T("h_glass", "#cfe9f2", "#6f8fa8", "#ffffff")
    M["spark"] = T("h_spark", "#000000", emission="#ffd27a")
    M["heal"] = T("h_heal", "#000000", emission="#ff7088")
    M["dust"] = T("h_dust", "#9a95ad", "#5d5873", "#c9c5d6")
    M["cyan"] = T("h_cyan", "#000000", emission="#7ff4ff")
    return M


# ---------------------------------------------------------------------------
# Extra geometry


def _obj_from_bm(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        ob.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def prism(name, pts, thick, mat, z_axis=True):
    """Flat polygon (x, z) pts in the XZ plane, extruded +-thick/2 along Y."""
    bm = bmesh.new()
    t = thick / 2
    front = [bm.verts.new((x, -t, z)) for x, z in pts]
    back = [bm.verts.new((x, t, z)) for x, z in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _obj_from_bm(name, bm, mat)


def tube(name, pts, radii, mat, sides=8, flat=1.0, smooth=True, caps=True):
    """Tube along 3D points with per-point radius (flat scales the Y extent)."""
    bm = bmesh.new()
    rings = []
    P = [Vector(p) for p in pts]
    for i, p in enumerate(P):
        if i == 0:
            d = (P[1] - P[0]).normalized()
        elif i == len(P) - 1:
            d = (P[-1] - P[-2]).normalized()
        else:
            d = (P[i + 1] - P[i - 1]).normalized()
        up = Vector((0, 1, 0))
        side = d.cross(up)
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        up2 = side.cross(d).normalized()
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            off = side * math.cos(a) * radii[i] + up2 * math.sin(a) * radii[i] * flat
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _obj_from_bm(name, bm, mat, smooth)


def skirt_panel(name, a0, a1, r_top, r_bot, h, thick, mat, segs=10, sy=1.1, flare_back=0.0):
    """Partial frustum shell (angles in deg around Z, 0 = +X) from z=0 down to z=-h."""
    bm = bmesh.new()
    rows = []
    for (r, z, inner) in ((r_top, 0.0, False), (r_bot, -h, False), (r_bot - thick, -h, True), (r_top - thick, 0.0, True)):
        row = []
        for k in range(segs + 1):
            a = (a0 + (a1 - a0) * k / segs) * D2R
            rr = r
            zz = z
            if z < 0 and flare_back:
                # longer at the back
                zz = z - flare_back * max(0.0, -math.cos(a))
            row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a) * sy, zz)))
        rows.append(row)
    for i in range(4):
        r0, r1 = rows[i], rows[(i + 1) % 4]
        for k in range(segs):
            bm.faces.new((r0[k], r0[k + 1], r1[k + 1], r1[k]))
    bm.faces.new((rows[0][0], rows[1][0], rows[2][0], rows[3][0]))
    bm.faces.new((rows[3][-1], rows[2][-1], rows[1][-1], rows[0][-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _obj_from_bm(name, bm, mat, smooth=True)


def torus(name, R, r, mat, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), maj=16, mino=6):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=maj, minor_segments=mino)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    ob.location = loc
    ob.rotation_euler = [math.radians(v) for v in rot]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def cyl(name, r, h, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=r, depth=h)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    ob.location = loc
    ob.rotation_euler = [math.radians(v) for v in rot]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.append(mat)
    return ob


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Bake a transform into a mesh object (used before joining)."""
    ob.location = loc
    ob.rotation_euler = [math.radians(v) for v in rot]
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def apply_all(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


# ---------------------------------------------------------------------------
# Model


# chain definitions: (name, parent joint, start (world rest), lengths)
PONY_LEN = [0.12, 0.12, 0.115, 0.11, 0.10, 0.09]
SCARF_A_LEN = [0.12, 0.13, 0.13, 0.13, 0.13, 0.12, 0.11]
SCARF_B_LEN = [0.11, 0.11, 0.11, 0.10, 0.09]


class Heroine:
    def __init__(self, M):
        self.M = M
        self.rig = Rig("heroine")
        self.props = {}       # name -> list of objects (toggle visibility)
        self.prop_root = {}   # name -> object whose matrix defines the prop space
        self.fx = {}          # name -> object (per-frame world placed)
        self.glow_objs = []
        self._build()

    # -- rig -------------------------------------------------------------
    def _build(self):
        M = self.M
        r = self.rig
        J = r.joint
        J("cog", "root", (0, 0, 0.62))
        J("hips", "cog", (0, 0, 0.92))
        J("spine", "hips", (0, 0, 1.03))
        J("chest", "spine", (0, 0, 1.18))
        J("neck", "chest", (0, 0, 1.42))
        J("head", "neck", (0, 0, 1.48))
        for s, y in (("n", -0.15), ("f", 0.15)):
            J("sh_" + s, "chest", (0, y, 1.37))
            J("el_" + s, "sh_" + s, (0, y, 1.11))
            J("ha_" + s, "el_" + s, (0, y, 0.89))
        for s, y in (("n", -0.085), ("f", 0.085)):
            J("th_" + s, "hips", (0, y, 0.90))
            J("kn_" + s, "th_" + s, (0, y, 0.50))
            J("an_" + s, "kn_" + s, (0, y, 0.09))
        J("sk_f", "hips", (0, 0, 0.99))
        J("sk_b", "hips", (0, 0, 0.99))
        # ponytail: rigid tie + simulated chain
        J("pony", "head", (-0.10, 0.0, 1.745))
        x0, z0 = -0.20, 1.735
        prev = "pony"
        self.pony_joints = []
        for i, L in enumerate(PONY_LEN):
            nm = "pt%d" % i
            J(nm, prev, (x0, 0.0, z0))
            z0 -= L
            prev = nm
            self.pony_joints.append(nm)
        # scarf: knot at the back of the neck + two tails
        J("knot", "chest", (-0.11, 0.05, 1.40))
        self.scarf_a, self.scarf_b = [], []
        for tag, lens, y, lst in (("sa", SCARF_A_LEN, 0.07, self.scarf_a), ("sb", SCARF_B_LEN, 0.11, self.scarf_b)):
            x0, z0 = -0.15, 1.37
            prev = "knot"
            for i, L in enumerate(lens):
                nm = "%s%d" % (tag, i)
                J(nm, prev, (x0, y, z0))
                z0 -= L
                prev = nm
                lst.append(nm)
        self._mesh()

    # -- meshes ----------------------------------------------------------
    def _mesh(self):
        M = self.M
        A = self.rig.attach
        # ---------------- torso
        A(ellipsoid("pelvis", (0.30, 0.31, 0.24), M["legs"]), "hips", (-0.02, 0, 0.0))
        A(ellipsoid("waist", (0.19, 0.23, 0.26), M["corset"]), "spine", (0.0, 0, 0.04))
        A(ellipsoid("ribs", (0.25, 0.29, 0.29), M["corset"]), "chest", (-0.015, 0, 0.07))
        A(ellipsoid("bust", (0.16, 0.25, 0.13), M["corset"]), "chest", (0.065, 0, 0.045))
        # corset lacing / front panel (lighter strip) + trim
        A(ellipsoid("corset_trim", (0.215, 0.255, 0.05), M["corset_d"]), "spine", (0.0, 0, -0.05))
        A(box("lace", (0.02, 0.03, 0.14), M["gold"]), "spine", (0.098, -0.0, 0.05))
        # belt + buckle + pouches
        A(ellipsoid("belt", (0.285, 0.325, 0.065), M["leather"]), "hips", (-0.005, 0, 0.065))
        A(box("buckle", (0.035, 0.07, 0.055), M["gold"]), "hips", (0.14, -0.0, 0.065))
        A(box("pouch_n", (0.085, 0.05, 0.09), M["leather"], bevel=0.015), "hips", (0.04, -0.165, 0.01))
        A(box("pouch_b", (0.07, 0.07, 0.08), M["leather_f"], bevel=0.015), "hips", (-0.14, -0.08, 0.02))
        A(box("flap_n", (0.09, 0.055, 0.03), M["gold"]), "hips", (0.04, -0.168, 0.05))
        # skirt panels (front shorter, back longer & flared)
        A(skirt_panel("skirt_f", -100, 100, 0.165, 0.245, 0.25, 0.025, M["skirt"], sy=1.15), "sk_f", (0.0, 0, 0))
        A(skirt_panel("skirt_b", 80, 280, 0.17, 0.27, 0.27, 0.025, M["skirt"], sy=1.12, flare_back=0.07), "sk_b", (0.0, 0, 0))
        A(skirt_panel("skirt_u", 60, 300, 0.15, 0.22, 0.29, 0.02, M["skirt_d"], sy=1.1, flare_back=0.06), "sk_b", (0.0, 0, -0.005))
        # collar / gorget
        A(ellipsoid("collar", (0.18, 0.23, 0.075), M["steel"]), "chest", (0.0, 0, 0.21))
        # scarf wrap around the neck + knot
        A(ellipsoid("scarf_wrap", (0.205, 0.255, 0.085), M["scarf"]), "chest", (-0.005, 0, 0.265))
        A(ellipsoid("scarf_wrap2", (0.17, 0.22, 0.06), M["scarf_d"]), "chest", (0.01, 0, 0.215))
        A(ellipsoid("knot_m", (0.085, 0.09, 0.08), M["scarf"]), "knot", (0.0, 0, 0.0))
        # ---------------- head
        A(limb("neck_m", 0.1, 0.045, 0.048, M["skin"]), "neck", (0, 0, 0.08))
        A(ellipsoid("head_m", (0.235, 0.215, 0.265), M["skin"]), "head", (0.02, 0, 0.115))
        A(ellipsoid("chin", (0.11, 0.13, 0.09), M["skin"]), "head", (0.075, 0, 0.025))
        A(ellipsoid("nose", (0.04, 0.03, 0.045), M["skin"]), "head", (0.14, 0, 0.095))
        A(ellipsoid("eye_n", (0.045, 0.04, 0.05), M["eye"]), "head", (0.11, -0.072, 0.115))
        A(ellipsoid("eye_f", (0.045, 0.04, 0.05), M["eye"]), "head", (0.11, 0.072, 0.115))
        A(ellipsoid("hair_cap", (0.285, 0.265, 0.235), M["hair"]), "head", (-0.025, 0, 0.18))
        A(ellipsoid("hair_back", (0.2, 0.25, 0.25), M["hair_d"]), "head", (-0.085, 0, 0.08))
        A(ellipsoid("bangs", (0.15, 0.25, 0.11), M["hair"]), "head", (0.085, 0, 0.205), (0, 22, 0))
        A(ellipsoid("fringe", (0.07, 0.05, 0.13), M["hair"]), "head", (0.115, -0.07, 0.165), (0, 18, 0))
        A(ellipsoid("lock_n", (0.065, 0.05, 0.21), M["hair"]), "head", (0.045, -0.105, 0.05), (0, -8, 0))
        A(ellipsoid("lock_f", (0.065, 0.05, 0.2), M["hair_d"]), "head", (0.045, 0.105, 0.05), (0, -8, 0))
        # ponytail tie + tuft (rigid, on the pony joint)
        A(torus("tie", 0.045, 0.022, M["scarf"], rot=(0, 70, 0)), "pony", (-0.01, 0, 0))
        A(ellipsoid("tuft", (0.15, 0.13, 0.12), M["hair"]), "pony", (-0.06, 0, 0.005), (0, -15, 0))
        # ponytail chain (thick -> thin, last two segments glow)
        radii = [0.072, 0.07, 0.064, 0.056, 0.046, 0.036]
        for i, nm in enumerate(self.pony_joints):
            L = PONY_LEN[i]
            mat = M["hair"] if i < 4 else (M["glow1"] if i == 4 else M["glow2"])
            r0 = radii[i]
            r1 = radii[i + 1] if i + 1 < len(radii) else 0.024
            ob = A(limb("ptm%d" % i, L, r0, r1, mat, depth_scale=0.8), nm)
            if i >= 4:
                self.glow_objs.append(ob)
        tip = A(ellipsoid("pt_tip", (0.06, 0.05, 0.075), M["glow2"]), self.pony_joints[-1], (0, 0, -PONY_LEN[-1] - 0.01))
        self.glow_objs.append(tip)
        # scarf tails: flat ribbons, wide in the screen plane
        for lst, lens, w0, mat in ((self.scarf_a, SCARF_A_LEN, 0.062, M["scarf"]), (self.scarf_b, SCARF_B_LEN, 0.052, M["scarf_d"])):
            n = len(lst)
            for i, nm in enumerate(lst):
                w = w0 * (1.0 - 0.15 * i / n)
                w1 = w0 * (1.0 - 0.15 * (i + 1) / n)
                if i == n - 1:
                    w1 = w * 0.75
                A(limb("%sm" % nm, lens[i], w, w1, mat, depth_scale=0.32), nm)
        # ---------------- arms
        for s in ("n", "f"):
            far = s == "f"
            sk = M["skin_f"] if far else M["skin"]
            st = M["steel_f"] if far else M["steel"]
            le = M["leather_f"] if far else M["leather"]
            A(ellipsoid("pauld_" + s, (0.155, 0.14, 0.12), st), "sh_" + s, (0.0, 0, 0.005))
            A(ellipsoid("pauld2_" + s, (0.12, 0.13, 0.06), le), "sh_" + s, (0.0, 0, -0.06))
            A(limb("ua_" + s, 0.26, 0.05, 0.044, sk), "sh_" + s)
            A(limb("fa_" + s, 0.22, 0.044, 0.038, sk), "el_" + s)
            A(limb("bracer_" + s, 0.13, 0.053, 0.048, le), "el_" + s, (0, 0, -0.075))
            A(ellipsoid("bband_" + s, (0.1, 0.1, 0.03), st), "el_" + s, (0, 0, -0.08))
            A(ellipsoid("hand_" + s, (0.08, 0.065, 0.085), sk), "ha_" + s, (0.008, 0, -0.035))
        # ---------------- legs
        for s in ("n", "f"):
            far = s == "f"
            lg = M["legs_f"] if far else M["legs"]
            bt = M["boots_f"] if far else M["boots"]
            st = M["steel_f"] if far else M["steel"]
            le = M["leather_f"] if far else M["leather"]
            A(limb("thigh_" + s, 0.40, 0.092, 0.062, lg), "th_" + s)
            A(ellipsoid("kneeg_" + s, (0.085, 0.1, 0.1), st), "kn_" + s, (0.045, 0, 0.0))
            A(limb("shin_" + s, 0.41, 0.058, 0.046, lg), "kn_" + s)
            A(limb("boot_" + s, 0.29, 0.064, 0.053, bt), "kn_" + s, (0, 0, -0.12))
            A(ellipsoid("cuff_" + s, (0.15, 0.145, 0.06), le), "kn_" + s, (0.0, 0, -0.125))
            foot = box("foot_" + s, (0.2, 0.09, 0.085), bt, bevel=0.025)
            A(foot, "an_" + s, (0.05, 0, -0.048))
            A(box("sole_" + s, (0.205, 0.095, 0.025), M["sole"]), "an_" + s, (0.05, 0, -0.078))
        self._props()

    # -- props -------------------------------------------------------------
    def _add_prop(self, name, objs, joint, offset=(0, 0, 0), rot=(0, 0, 0)):
        ob = join(objs, name) if len(objs) > 1 else objs[0]
        ob.name = name
        self.rig.attach(ob, joint, offset, rot)
        self.props[name] = [ob]
        self.prop_root[name] = ob
        return ob

    def _props(self):
        M = self.M
        # ---- rusty sword (along +Z from the grip centre)
        L = 0.74
        w = 0.046
        pts = [(-w, 0.07), (-w, 0.28), (-w + 0.022, 0.31), (-w, 0.34), (-w, L - 0.13), (0.0, L),
               (w, L - 0.17), (w, 0.50), (w - 0.026, 0.47), (w, 0.44), (w, 0.07)]
        bl = prism("sw_blade", pts, 0.022, M["blade"])
        ru1 = box("sw_rust1", (0.05, 0.03, 0.09), M["rust"], loc=(0.008, 0, 0.17))
        ru2 = box("sw_rust2", (0.03, 0.03, 0.05), M["rust"], loc=(-0.02, 0, 0.43))
        grip = box("sw_grip", (0.04, 0.04, 0.13), M["leather"], loc=(0, 0, -0.005))
        pom = ellipsoid("sw_pom", (0.055, 0.055, 0.05), M["iron"], loc=(0, 0, -0.08))
        guard = box("sw_guard", (0.17, 0.05, 0.04), M["iron"], loc=(0, 0, 0.065), bevel=0.01)
        self._add_prop("sword", [bl, ru1, ru2, grip, pom, guard], "ha_n", (0.0, -0.01, -0.04), (0, 90, 0))
        self.tip_local = {"sword": (Vector((0, 0, L)), Vector((0, 0, 0.30)))}
        # ---- spear (grip at the rear hand; tip 1.62 ahead)
        shaft = limb("sp_shaft", 1.55, 0.028, 0.028, M["wood"])
        place(shaft, (0, 0, 1.2))  # limb hangs down from origin: top at 1.2, bottom at -0.35
        tip_pts = [(-0.06, 0.0), (-0.035, 0.2), (0.0, 0.34), (0.035, 0.2), (0.06, 0.0), (0.0, -0.05)]
        tipm = prism("sp_tip", tip_pts, 0.024, M["blade"])
        place(tipm, (0, 0, 1.25))
        sock = cone("sp_sock", 0.035, 0.03, 0.08, M["iron"], loc=(0, 0, 1.18))
        tas = ellipsoid("sp_tassel", (0.07, 0.05, 0.12), M["scarf"], loc=(-0.045, 0, 1.13), rot=(0, 25, 0))
        butt = ellipsoid("sp_butt", (0.05, 0.05, 0.06), M["iron"], loc=(0, 0, -0.36))
        wrap = limb("sp_wrap", 0.12, 0.034, 0.034, M["leather"])
        place(wrap, (0, 0, 0.06))
        self._add_prop("spear", [shaft, tipm, sock, tas, butt, wrap], "ha_n", (0.0, -0.01, -0.04), (0, 90, 0))
        self.tip_local["spear"] = (Vector((0, 0, 1.58)), Vector((0, 0, 1.2)))
        # ---- twin daggers
        for s in ("n", "f"):
            st = M["blade"]
            dp = [(-0.03, 0.04), (-0.03, 0.2), (0.0, 0.31), (0.03, 0.2), (0.03, 0.04)]
            db = prism("dg_blade_" + s, dp, 0.02, st)
            dgr = box("dg_grip_" + s, (0.035, 0.035, 0.1), M["leather"], loc=(0, 0, -0.01))
            dgu = box("dg_guard_" + s, (0.11, 0.045, 0.03), M["gold"], loc=(0, 0, 0.045))
            dpo = ellipsoid("dg_pom_" + s, (0.045, 0.045, 0.04), M["gold"], loc=(0, 0, -0.065))
            self._add_prop("dagger_" + s, [db, dgr, dgu, dpo], "ha_" + s, (0.0, -0.01 if s == "n" else 0.01, -0.04), (0, 90, 0))
            self.tip_local["dagger_" + s] = (Vector((0, 0, 0.31)), Vector((0, 0, 0.12)))
        self.props["daggers"] = self.props["dagger_n"] + self.props["dagger_f"]
        # ---- war hammer (grip at z=0, head at z~0.86)
        hnd = limb("hm_handle", 1.12, 0.032, 0.03, M["wood_d"])
        place(hnd, (0, 0, 0.86))
        w1 = limb("hm_wrap1", 0.14, 0.039, 0.039, M["leather"])
        place(w1, (0, 0, 0.08))
        w2 = limb("hm_wrap2", 0.1, 0.039, 0.039, M["leather"])
        place(w2, (0, 0, 0.62))
        head = box("hm_head", (0.46, 0.25, 0.27), M["iron"], loc=(0.0, 0, 0.88), bevel=0.03)
        face = box("hm_face", (0.05, 0.27, 0.29), M["steel"], loc=(0.235, 0, 0.88), bevel=0.012)
        band1 = box("hm_band1", (0.05, 0.27, 0.29), M["wood_d"], loc=(0.09, 0, 0.88))
        band2 = box("hm_band2", (0.05, 0.27, 0.29), M["wood_d"], loc=(-0.09, 0, 0.88))
        spike = cone("hm_spike", 0.08, 0.0, 0.16, M["steel"], loc=(-0.23, 0, 0.88), rot=(0, -90, 0))
        topk = cone("hm_top", 0.035, 0.0, 0.08, M["steel"], loc=(0, 0, 1.01))
        self._add_prop("hammer", [hnd, w1, w2, head, face, band1, band2, spike, topk], "ha_n", (0.0, -0.02, -0.04), (0, 90, 0))
        self.tip_local["hammer"] = (Vector((0.2, 0, 0.88)), Vector((0, 0, 0.6)))
        # ---- hunter bow (in the far hand; +X of bow space = shooting direction)
        bp = []
        for k in range(-8, 9):
            z = 0.5 * k / 8
            u = abs(z) / 0.5
            x = -0.13 * u * u
            if u > 0.8:
                x += 0.22 * (u - 0.8) ** 1.5 * 3.0
            bp.append((x, 0, z))
        rad = [0.022 + 0.014 * (1 - abs(k) / 8) for k in range(-8, 9)]
        bow = tube("bw_limbs", bp, rad, M["wood"], sides=6)
        bgrip = limb("bw_grip", 0.12, 0.034, 0.034, M["leather"])
        place(bgrip, (0, 0, 0.06))
        self.bow_tips = (Vector(bp[0]), Vector(bp[-1]))
        self._add_prop("bow", [bow, bgrip], "ha_f", (0.0, 0.0, -0.04), (0, 90, 0))
        # string halves and the arrow are world-placed fx
        for nm in ("str_a", "str_b"):
            s = limb(nm, 1.0, 0.016, 0.016, M["string"], segs=6)
            self.fx[nm] = s
        ar_sh = limb("ar_shaft", 0.66, 0.017, 0.017, M["wood"], segs=6)
        place(ar_sh, (0, 0, 0.66))
        ar_hd = prism("ar_head", [(-0.035, 0.0), (0.0, 0.09), (0.035, 0.0)], 0.02, M["steel"])
        place(ar_hd, (0, 0, 0.65))
        ar_f = prism("ar_fl", [(-0.04, 0.0), (0.0, 0.03), (0.0, 0.12), (-0.035, 0.09)], 0.012, M["fletch"])
        ar_f2 = prism("ar_fl2", [(0.04, 0.0), (0.0, 0.03), (0.0, 0.12), (0.035, 0.09)], 0.012, M["fletch"])
        place(ar_f, (0, 0, 0.02))
        place(ar_f2, (0, 0, 0.02))
        self.fx["arrow"] = join([ar_sh, ar_hd, ar_f, ar_f2], "arrow")
        # ---- old shield on the near forearm
        disc = cyl("sh_disc", 0.27, 0.045, M["wood"], segs=20)
        planks = [box("sh_pl%d" % k, (0.012, 0.05, 0.5 * math.sqrt(max(0.0, 1 - (x / 0.27) ** 2))), M["wood_d"], loc=(x, 0, 0))
                  for k, x in enumerate((-0.13, 0.0, 0.13))]
        planks = [place(p, (0, 0, 0), (90, 0, 0)) for p in planks]
        rim = torus("sh_rim", 0.27, 0.028, M["iron"], maj=24, mino=6)
        boss = ellipsoid("sh_boss", (0.13, 0.13, 0.08), M["steel"], loc=(0, 0, 0.03))
        sh = join([disc, rim, boss] + planks, "shield_m")
        # disc normal (+Z) -> forward and toward camera, centred on the forearm
        self._add_prop("shield", [sh], "el_n", (0.03, -0.09, -0.13), (0, 90, -42))
        # ---- flask (heal)
        fb = ellipsoid("fl_body", (0.1, 0.1, 0.115), M["flask"])
        fn = limb("fl_neck", 0.08, 0.025, 0.03, M["glass"])
        place(fn, (0, 0, 0.13))
        fc = box("fl_cork", (0.04, 0.04, 0.04), M["leather"], loc=(0, 0, 0.14))
        self._add_prop("flask", [fb, fn, fc], "ha_n", (0.02, -0.04, -0.06), (0, 0, 0))
        # ---- grenade (throw)
        gb = ellipsoid("gr_body", (0.12, 0.12, 0.12), M["iron"])
        gf = ellipsoid("gr_fuse", (0.04, 0.04, 0.05), M["spark"], loc=(0, 0, 0.07))
        self._add_prop("grenade", [gb, gf], "ha_n", (0.03, -0.04, -0.07), (0, 0, 0))
        # ---- generic fx (world placed per frame)
        self.fx["puff"] = torus("puff", 0.16, 0.035, M["cyan"], scale=(1, 1, 0.35))
        self.fx["dust_l"] = ellipsoid("dust_l", (0.22, 0.12, 0.09), M["dust"])
        self.fx["dust_r"] = ellipsoid("dust_r", (0.22, 0.12, 0.09), M["dust"])
        self.fx["spark"] = prism("spark", [(0, 0.12), (0.03, 0.03), (0.12, 0), (0.03, -0.03), (0, -0.12),
                                           (-0.03, -0.03), (-0.12, 0), (-0.03, 0.03)], 0.02, M["spark"])
        for k in range(4):
            self.fx["heal%d" % k] = ellipsoid("heal%d" % k, (0.045, 0.03, 0.045), M["heal"])
        for k in range(3):
            self.fx["streak%d" % k] = limb("streak%d" % k, 0.4, 0.012, 0.012, M["smear"], segs=6)
        for ob in self.fx.values():
            ob.hide_render = True
        for lst in self.props.values():
            for ob in lst:
                ob.hide_render = True

    def toggle_objects(self):
        out = []
        for k, lst in self.props.items():
            for ob in lst:
                if ob not in out:
                    out.append(ob)
        return out


# ---------------------------------------------------------------------------
# Measurement helpers


def update():
    bpy.context.view_layer.update()


def wpos(rig, j, local=(0, 0, 0)):
    m = rig.joints[j].matrix_world
    p = m @ Vector(local)
    return p


def wswing(rig, j):
    """Screen-plane world swing of a joint (deg): 0 = its local -Z points down, + = CCW."""
    m = rig.joints[j].matrix_world.to_3x3()
    v = m @ Vector((0, 0, -1))
    return math.atan2(v.x, -v.z) * R2D


def obj_swing(ob):
    m = ob.matrix_world.to_3x3()
    v = m @ Vector((0, 0, -1))
    return math.atan2(v.x, -v.z) * R2D


def angnorm(a):
    while a > 180:
        a -= 360
    while a < -180:
        a += 360
    return a


def ik2(base, target, l1, l2, parent_swing, bend):
    """Planar 2-bone IK.  bend=+1: middle joint bends CCW-positive (elbow),
    bend=-1: knee-style.  Returns (upper_local, lower_local, end_world_swing_of_lower)."""
    dx = target[0] - base[0]
    dz = target[1] - base[1]
    d = math.hypot(dx, dz)
    d = max(1e-4, min(d, (l1 + l2) * 0.9995))
    phi = math.atan2(dx, -dz) * R2D
    ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    cb = (l2 * l2 + d * d - l1 * l1) / (2 * l2 * d)
    al = math.acos(max(-1, min(1, ca))) * R2D
    be = math.acos(max(-1, min(1, cb))) * R2D
    if bend > 0:
        up_w = phi - al
        lo_w = phi + be
    else:
        up_w = phi + al
        lo_w = phi - be
    up_l = angnorm(up_w - parent_swing)
    lo_l = angnorm(lo_w - up_w)
    return up_l, lo_l, lo_w


def plant(x, pitch=0.0, lift=0.0):
    """Ankle target so the sole touches the ground (toe or heel pivot)."""
    p = pitch * D2R
    if pitch < 0:
        z = 0.09 * math.cos(p) - 0.15 * math.sin(p)
    elif pitch > 0:
        z = 0.09 * math.cos(p) + 0.05 * math.sin(p)
    else:
        z = 0.09
    return (x, z + lift, pitch)


SOLE_PTS = [(-0.055, -0.09), (0.155, -0.09), (0.155, -0.05), (-0.055, -0.05)]


def lowest_sole(rig):
    lo = 1e9
    for s in ("n", "f"):
        for (x, z) in SOLE_PTS:
            p = wpos(rig, "an_" + s, (x, 0, z))
            lo = min(lo, p.z)
    return lo


# ---------------------------------------------------------------------------
# Secondary motion: Verlet chains


class Chain:
    def __init__(self, joints, lengths, parent, g=16.0, drag=4.0, damp=0.985, stiff=None, curl=None,
                 base=0.0, base_stiff=0.0, flutter=0.0, flutter_k=1.0, wind_gain=1.0):
        self.joints = joints
        self.L = lengths
        self.parent = parent
        self.g = g
        self.drag = drag
        self.damp = damp
        n = len(lengths)
        self.stiff = stiff or [0.0] * n
        self.curl = curl or [0.0] * n
        self.base = base           # preferred first-segment angle relative to the parent swing
        self.base_stiff = base_stiff
        self.flutter = flutter
        self.flutter_k = flutter_k
        self.wind_gain = wind_gain

    def init_points(self, anchor, ref):
        pts = [Vector(anchor)]
        a = ref + self.base
        for k, L in enumerate(self.L):
            a += self.curl[k] if k else 0.0
            pts.append(pts[-1] + Vector((math.sin(a * D2R), -math.cos(a * D2R))) * L)
        self.p = pts
        self.pp = [q.copy() for q in pts]

    def step(self, anchor, ref, air, dt, colliders, floor=0.03):
        p, pp = self.p, self.pp
        p[0] = Vector(anchor)
        pp[0] = Vector(anchor)
        g = Vector((0, -self.g))
        for k in range(1, len(p)):
            v = (p[k] - pp[k]) / dt
            acc = g + (Vector(air) * self.wind_gain - v) * self.drag
            nxt = p[k] + (p[k] - pp[k]) * self.damp + acc * dt * dt
            pp[k] = p[k]
            p[k] = nxt
        # shape (bending) springs
        prev_a = ref + self.base
        for k in range(len(self.L)):
            d = p[k + 1] - p[k]
            cur = math.atan2(d.x, -d.y) * R2D
            if k == 0:
                want = ref + self.base
                s = self.base_stiff
            else:
                want = prev_a + self.curl[k]
                s = self.stiff[k]
            if s > 0:
                diff = angnorm(want - cur)
                cur = cur + diff * s
                tgt = p[k] + Vector((math.sin(cur * D2R), -math.cos(cur * D2R))) * d.length
                p[k + 1] = tgt
            prev_a = cur
        # length constraints
        for _ in range(3):
            for k in range(len(self.L)):
                d = p[k + 1] - p[k]
                ln = d.length or 1e-6
                p[k + 1] = p[k] + d * (self.L[k] / ln)
            for k in range(1, len(p)):
                for (c, r) in colliders:
                    d = p[k] - c
                    if d.length < r:
                        p[k] = c + (d.normalized() if d.length > 1e-6 else Vector((-1, 0))) * r
                if p[k].y < floor:
                    p[k].y = floor

    def angles(self, ref):
        out = []
        prev = ref
        for k in range(len(self.L)):
            d = self.p[k + 1] - self.p[k]
            a = math.atan2(d.x, -d.y) * R2D
            out.append(angnorm(a - prev))
            prev = a
        return out


def make_chains(h):
    pony = Chain(h.pony_joints, PONY_LEN, "pony", g=15.0, drag=3.6, damp=0.985,
                 stiff=[0.0, 0.10, 0.07, 0.05, 0.04, 0.03], curl=[0, 10, 9, 8, 7, 6],
                 base=-62.0, base_stiff=0.22, flutter=5.0, flutter_k=1.0)
    sa = Chain(h.scarf_a, SCARF_A_LEN, "knot", g=13.0, drag=6.0, damp=0.98,
               stiff=[0, 0.05, 0.04, 0.03, 0.03, 0.02, 0.02], curl=[0, -6, -5, -4, -4, -3, -3],
               base=-30.0, base_stiff=0.10, flutter=9.0, flutter_k=1.15, wind_gain=1.0)
    sb = Chain(h.scarf_b, SCARF_B_LEN, "knot", g=14.0, drag=5.0, damp=0.98,
               stiff=[0, 0.05, 0.04, 0.03, 0.03], curl=[0, -4, -4, -3, -3],
               base=-12.0, base_stiff=0.12, flutter=7.0, flutter_k=1.3, wind_gain=0.9)
    return [pony, sa, sb]


COLLIDERS = [("head", (0.02, 0.0, 0.12), 0.165), ("chest", (-0.01, 0.0, 0.06), 0.15),
             ("hips", (-0.02, 0.0, 0.0), 0.16), ("neck", (0.0, 0.0, 0.0), 0.08)]


# ---------------------------------------------------------------------------
# Frame solving


ARM_L1, ARM_L2 = 0.26, 0.22
LEG_L1, LEG_L2 = 0.40, 0.41


def _pose(rig, angles, offsets, scales=None):
    rig.pose(angles, offsets, scales or {})
    update()


def solve_frame(h, spec):
    """Resolve IK / grounding for one frame spec.  Returns dict(angles, offsets, scales, meas)."""
    rig = h.rig
    a = dict(spec.get("a", {}))
    off = {}
    hp = spec.get("hip", (0, 0))
    off["hips"] = (hp[0], 0, hp[1])
    if "cogo" in spec:
        c = spec["cogo"]
        off["cog"] = (c[0], 0, c[1])
    if "cog" in spec:
        a["cog"] = spec["cog"]
    for k, v in spec.get("off", {}).items():
        off[k] = v
    _pose(rig, a, off)
    # --- legs IK
    def legs():
        for s in ("n", "f"):
            t = spec.get("f" + s)
            if t is None:
                continue
            base = wpos(rig, "th_" + s)
            ps = wswing(rig, "hips")
            up, lo, low = ik2((base.x, base.z), (t[0], t[1]), LEG_L1, LEG_L2, ps, -1)
            a["th_" + s] = up
            a["kn_" + s] = lo
            pitch = t[2] if len(t) > 2 else 0.0
            a["an_" + s] = angnorm(pitch - low)
    legs()
    _pose(rig, a, off)
    g = spec.get("ground")
    if g is not None:
        lo = lowest_sole(rig)
        dz = g - lo
        hx, hy, hz = off["hips"]
        off["hips"] = (hx, hy, hz + dz)
        _pose(rig, a, off)
    # --- arms IK (near first, then far may grab a prop on the near hand)
    for s in ("n", "f"):
        t = spec.get("h" + s)
        if t is None:
            continue
        if t[0] == "grip":
            prop = h.prop_root[t[1]]
            tp = prop.matrix_world @ Vector((0, 0, t[2]))
            target = (tp.x, tp.z)
            aim = t[3] if len(t) > 3 else obj_aim(prop)
            bend = t[4] if len(t) > 4 else 1
        else:
            target = (t[0], t[1])
            aim = t[2] if len(t) > 2 else None
            bend = t[3] if len(t) > 3 else 1
        base = wpos(rig, "sh_" + s)
        ps = wswing(rig, "chest")
        up, lo, low = ik2((base.x, base.z), target, ARM_L1, ARM_L2, ps, bend)
        a["sh_" + s] = up
        a["el_" + s] = lo
        if aim is not None:
            # hand local +X axis world angle == low + 90 + ha ... (hand frame: -Z along forearm)
            a["ha_" + s] = angnorm(aim - low)
        _pose(rig, a, off)
    return a, off


def obj_aim(ob):
    """World screen angle (deg CCW from +X) of a prop's local +Z axis."""
    m = ob.matrix_world.to_3x3()
    v = m @ Vector((0, 0, 1))
    return math.atan2(v.z, v.x) * R2D


def skirt_angles(a, vel):
    tn, tf = a.get("th_n", 0.0), a.get("th_f", 0.0)
    fwd = max(tn, tf, 0.0)
    back = min(tn, tf, 0.0)
    vx, vz = vel
    f = fwd * 0.72 - 3.0 * max(0.0, vx) / 4.7
    b = back * 0.62 - 9.0 * max(0.0, vx) / 4.7 + min(0.0, vx) * 1.0
    # falling -> panels lift; rising -> panels drop
    f += max(0.0, -vz) * 1.4
    b -= max(0.0, -vz) * 1.6
    f = max(-10.0, min(f, 75.0))
    b = max(-80.0, min(b, 10.0))
    return f, b


def solve_frames(h, specs, fps, loop, pre=None, wind=(0.0, 0.0), seed_phase=0.0):
    """Turn frame specs into fully posed frames (with chains + skirt)."""
    rig = h.rig
    base = []
    for sp in specs:
        a, off = solve_frame(h, sp)
        # measure chain anchors / refs / colliders on the solved pose
        _pose(rig, a, off)
        meas = {}
        chains = h.chains
        for ch in chains:
            j0 = ch.joints[0]
            p = wpos(rig, j0)
            meas[ch.joints[0]] = (Vector((p.x, p.z)), wswing(rig, ch.parent))
        cols = []
        for (j, lo, r) in COLLIDERS:
            p = wpos(rig, j, lo)
            cols.append((Vector((p.x, p.z)), r))
        meas["cols"] = cols
        base.append((a, off, meas))
    n = len(specs)
    dt_frame = 1.0 / fps
    sub = 12
    dt = dt_frame / sub
    vels = [Vector(sp.get("vel", (0.0, 0.0))) for sp in specs]
    winds = [Vector(sp.get("wind", wind)) for sp in specs]
    chains = h.chains
    # initial state
    for ch in chains:
        anc, ref = base[0][2][ch.joints[0]]
        ch.init_points(anc, ref)
    pre_vel = Vector(pre if pre is not None else vels[0])

    def run_interval(i0, i1, v0, v1, w0, w1, steps):
        for s in range(steps):
            u = (s + 1) / steps
            for ch in chains:
                a0, r0 = base[i0][2][ch.joints[0]]
                a1, r1 = base[i1][2][ch.joints[0]]
                anc = a0.lerp(a1, u)
                ref = r0 + angnorm(r1 - r0) * u
                cols = [(c0.lerp(c1, u), r) for (c0, r), (c1, _) in zip(base[i0][2]["cols"], base[i1][2]["cols"])]
                vel = v0.lerp(v1, u)
                wnd = w0.lerp(w1, u)
                air = -vel + wnd
                ch.step(anc, ref, (air.x, air.y), dt, cols)

    # pre-roll: settle at frame 0
    for _ in range(int(1.2 / dt_frame)):
        run_interval(0, 0, pre_vel, pre_vel, winds[0], winds[0], sub)
    samples = [None] * n
    cycles = 4 if loop else 1
    for c in range(cycles):
        for i in range(n):
            if c == cycles - 1:
                samples[i] = [[q.copy() for q in ch.p] for ch in chains]
            j = (i + 1) % n if loop else min(i + 1, n - 1)
            if not loop and i == n - 1:
                break
            run_interval(i, j, vels[i], vels[j], winds[i], winds[j], sub)
    out = []
    for i in range(n):
        a, off, meas = base[i]
        a = dict(a)
        t = i / n
        for ci, ch in enumerate(chains):
            ch.p = samples[i][ci]
            ref = meas[ch.joints[0]][1]
            angs = ch.angles(ref)
            speed = (vels[i] - winds[i]).length
            amp = ch.flutter * (0.35 + min(1.0, speed / 5.0))
            for k, nm in enumerate(ch.joints):
                fl = 0.0
                if k > 0 and amp > 0:
                    if loop:
                        ph = 2 * math.pi * (2 * t) - k * ch.flutter_k + seed_phase
                    else:
                        ph = 2 * math.pi * (i * 0.23) - k * ch.flutter_k + seed_phase
                    fl = amp * math.sin(ph) * (0.4 + 0.6 * k / len(ch.joints))
                a[nm] = angs[k] + fl
        f, b = skirt_angles(a, tuple(vels[i]))
        a["sk_f"] = a.get("sk_f", 0.0) + f
        a["sk_b"] = a.get("sk_b", 0.0) + b
        out.append((a, off))
    return out


# ---------------------------------------------------------------------------
# Rendering


def _clear_anim(ob):
    if ob.animation_data:
        ob.animation_data_clear()


def _constant(ob):
    if ob.animation_data and ob.animation_data.action:
        for fc in ob.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "CONSTANT"


def set_world_xform(ob, loc, quat=None, scale=(1, 1, 1)):
    ob.location = loc
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = quat or Quaternion()
    ob.scale = scale


def key_xform(ob, f):
    ob.keyframe_insert("location", frame=f)
    ob.keyframe_insert("rotation_quaternion", frame=f)
    ob.keyframe_insert("scale", frame=f)


def segment_xform(ob, p0, p1):
    """Place a limb() mesh (hangs down -Z, length 1) from p0 to p1."""
    d = Vector(p1) - Vector(p0)
    ln = d.length
    q = (-d).normalized().to_track_quat("Z", "Y") if ln > 1e-6 else Quaternion()
    # limb hangs along -Z: we need local -Z -> d  ==  local +Z -> -d
    set_world_xform(ob, Vector(p0), q, (1, 1, max(ln, 1e-3)))


def render_frames(h, name, posed, specs, out_dir, fx_fn=None, extra_objs=()):
    """posed: list of (angles, offsets); specs: frame specs (show / sc).
    fx_fn(i, n, spec) -> {object: (loc, quat, scale) | None}  objects shown this frame
    (None = keep its own transform)."""
    sc = bpy.context.scene
    rig = h.rig
    toggles = h.toggle_objects() + list(h.fx.values()) + list(extra_objs)
    for e in rig.joints.values():
        _clear_anim(e)
    for ob in toggles:
        _clear_anim(ob)
    fx_set = set(id(o) for o in h.fx.values())
    n = len(posed)
    for i, (a, off) in enumerate(posed):
        sp = specs[i]
        f = i + 1
        scl = {}
        if "sc" in sp:
            sx, sz = sp["sc"]
            scl["root"] = (sx, 1.0, sz)
        rig.pose(a, off, scl)
        rig.key(f)
        update()
        vis = set()
        for pname in sp.get("show", []):
            for ob in h.props.get(pname, []):
                vis.add(id(ob))
        fxw = fx_fn(i, n, sp) if fx_fn else {}
        for ob, x in fxw.items():
            vis.add(id(ob))
            if x is not None:
                set_world_xform(ob, x[0], x[1], x[2])
        for ob in toggles:
            if id(ob) in fx_set:
                if ob.rotation_mode != "QUATERNION":
                    ob.rotation_mode = "QUATERNION"
                key_xform(ob, f)
            ob.hide_render = id(ob) not in vis
            ob.keyframe_insert("hide_render", frame=f)
    for e in rig.joints.values():
        _constant(e)
    for ob in toggles:
        _constant(ob)
    sc.frame_start = 1
    sc.frame_end = n
    os.makedirs(out_dir, exist_ok=True)
    for fn in os.listdir(out_dir):
        if fn.startswith(name + "_") and fn[len(name) + 1:-4].isdigit():
            os.remove(os.path.join(out_dir, fn))
    sc.render.filepath = os.path.join(out_dir, name + "_")
    bpy.ops.render.render(animation=True)
    for i in range(n):
        src = os.path.join(out_dir, "%s_%04d.png" % (name, i + 1))
        dst = os.path.join(out_dir, "%s_%03d.png" % (name, i))
        if os.path.exists(src):
            os.replace(src, dst)


# ---------------------------------------------------------------------------
# Smear meshes


def smear_mesh(name, outer, inner, mat):
    """Flat strip between two polylines (world coords)."""
    bm = bmesh.new()
    vo = [bm.verts.new(p) for p in outer]
    vi = [bm.verts.new(p) for p in inner]
    for k in range(len(outer) - 1):
        bm.faces.new((vo[k], vo[k + 1], vi[k + 1], vi[k]))
    return _obj_from_bm(name, bm, mat)
