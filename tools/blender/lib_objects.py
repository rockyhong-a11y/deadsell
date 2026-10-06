"""Shared helpers + item models for the props / pickups / projectiles / icons sheets.

Imported by tools/blender/asset_{props,pickups,projectiles,icons}.py (Blender Python).
Nothing here renders on import.

Conventions (in addition to common.py):
  * Model builders return a root Empty ("group") with every part parented under it,
    so a whole model can be moved / rotated / scaled as one.  Builders that need
    animation return (root, parts_dict) with pivot Empties in parts_dict.
  * Weapons are modelled along +Z with the grip/hilt end at the origin
    (same convention as the heroine's sword in _prototype_heroine.py).
  * Projectiles / thrown objects fly toward +X.
  * Frames are rendered one still at a time (render_frame) so any per-frame
    change (materials, rebuilt geometry, visibility) is allowed.
"""
import bpy
import bmesh
import json
import math
import os
import random
import sys
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import common  # noqa: E402
from common import toon, box, ellipsoid, cone, join, reset_scene, add_sun, setup_sprite_camera  # noqa: E402,F401

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FRAMES = os.path.join(ROOT, "build", "frames")
RIM = "#9fe8ff"

# --------------------------------------------------------------------------
# Scene


def new_scene(key_dir=(0.5, 0.6, -0.7), key_energy=3.2, shadows=True):
    """Fresh empty scene with the character key light.  Clears the material cache."""
    sc = reset_scene()
    common._MAT_CACHE.clear()
    try:
        sc.eevee.shadow_cascade_size = "4096"
        sc.eevee.shadow_cube_size = "2048"
    except Exception:
        pass
    key = add_sun(key_dir, energy=key_energy)
    key.data.use_shadow = shadows
    if shadows:
        key.data.shadow_cascade_max_distance = 40.0
    return sc


def camera(frame_w, frame_h, ax, ay, yaw=20.0, pitch=8.0, ppu=common.PX_PER_UNIT):
    return setup_sprite_camera(frame_w, frame_h, ax, ay, yaw_deg=yaw, pitch_deg=pitch, px_per_unit=ppu)


def clean_dir(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".png") or f == "spec.json":
            os.remove(os.path.join(out_dir, f))


def render_frame(out_dir, name, i):
    sc = bpy.context.scene
    sc.render.filepath = os.path.join(out_dir, "%s_%03d.png" % (name, i))
    bpy.ops.render.render(write_still=True)


def write_spec(out_dir, frame_w, frame_h, anchor, anims, extra=None):
    spec = {"frameW": frame_w, "frameH": frame_h, "anchor": list(anchor), "outline": True,
            "colors": 0, "animations": anims}
    if extra:
        spec["extra"] = extra
    with open(os.path.join(out_dir, "spec.json"), "w") as f:
        json.dump(spec, f, indent=1)


def clear_objects(cameras=False):
    """Delete every object except lights (and cameras unless cameras=True); materials stay cached."""
    for ob in list(bpy.data.objects):
        if ob.type == "LIGHT" or (ob.type == "CAMERA" and not cameras):
            continue
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


# --------------------------------------------------------------------------
# Materials

PAL = {
    # name: (base, shadow, light, rim)
    "steel": ("#9aa3b8", "#4f566e", "#e4ebf7", True),
    "steel_dark": ("#6f768c", "#383b54", "#aeb6cb", True),
    "iron": ("#575c70", "#282738", "#8b91a8", True),
    "iron_dark": ("#3b3d4e", "#1c1a29", "#5f6479", True),
    "rust": ("#9a542c", "#4e2426", "#c97a40", False),
    "wood": ("#7a4b2e", "#3b2130", "#a86b3e", True),
    "wood_light": ("#9c663a", "#50302e", "#c98d52", True),
    "wood_dark": ("#53311f", "#2a1621", "#76462a", True),
    "leather": ("#5a3328", "#2c1820", "#7d4a37", True),
    "leather_red": ("#6e2230", "#36101f", "#94303d", True),
    "gold": ("#d9a441", "#8a5527", "#ffe08a", True),
    "coin_mark": ("#ffe08a", "#c08a3a", "#fff6d0", False),
    "brass": ("#b88a3c", "#6a4428", "#e6c06a", True),
    "bronze": ("#a8692f", "#552e28", "#dc9f55", True),
    "bronze_dark": ("#7a4a26", "#3b2022", "#a8692f", True),
    "stone": ("#5f6579", "#30304a", "#8c93ab", True),
    "stone_dark": ("#464a5e", "#232238", "#676d86", True),
    "stone_light": ("#7d849b", "#41425a", "#adb4ca", True),
    "mortar": ("#262536", "#151422", "#33324a", False),
    "bone": ("#d6cfb4", "#857a76", "#fffbe6", True),
    "parchment": ("#e2cd9c", "#98785f", "#fff2cc", True),
    "parchment_dark": ("#b89a6c", "#6e5248", "#d8bf8c", False),
    "cloth_red": ("#9a1f33", "#4f0f2a", "#cf3a48", True),
    "cloth_dark_red": ("#6e1530", "#36091f", "#9a1f33", True),
    "cloth_cream": ("#d9cba9", "#867268", "#f6eed6", True),
    "cloth_purple": ("#6a3a8c", "#341c50", "#9a5ac0", True),
    "cloth_green": ("#2f7a46", "#173a30", "#4fae62", True),
    "cloth_teal": ("#24566a", "#132a3c", "#3d8197", True),
    "black": ("#2a2a38", "#141220", "#4a4a62", True),
    "clay": ("#7e3526", "#3e1622", "#a8513a", True),
    "apple": ("#c62a36", "#6a1030", "#ff6a5e", True),
    "leaf": ("#4c9a3a", "#1f4a32", "#86d058", True),
    "bread": ("#c8873f", "#6e3a2a", "#f0bf6a", True),
    "crust": ("#a0602c", "#55302a", "#c8873f", True),
    "meat": ("#a8402e", "#56182a", "#e0704e", True),
    "potion": ("#d82440", "#7a0e2e", "#ff6a70", True),
    "glass": ("#9fc8d8", "#4e6a8a", "#e6f8ff", False),
    "ice": ("#8fd6f0", "#3a6aa0", "#e8fbff", True),
    "feather": ("#4a2a6a", "#22123a", "#7a4aa0", True),
    "feather_light": ("#8a62b8", "#43286a", "#c0a0e8", True),
    "straw": ("#b39a52", "#5e4a36", "#dcc480", True),
    # corpse market (CONTENT3): bone white, dried blood, red thread, flesh, sacking
    "bone_w": ("#e8dcc4", "#8a7a82", "#fffaea", True),
    "bone_black": ("#2e2836", "#14101c", "#554c66", True),
    "blood_dry": ("#7a1f2a", "#3a0d1c", "#a8343e", True),
    "thread": ("#c8324a", "#6e1430", "#f0586c", True),
    "flesh_pale": ("#d9bba6", "#8e5a6c", "#f8e4d4", True),
    "flesh_dark": ("#b98f86", "#6e4058", "#dcb8a8", True),
    "sack": ("#9a7a52", "#523a30", "#c8a272", True),
    "burlap": ("#b89a68", "#6a5240", "#dcc08a", True),
    "yarn": ("#9c2a3a", "#4a1224", "#cc4458", True),
}


def mat(name):
    base, shadow, light, rim = PAL[name]
    return toon(name, base, shadow, light, rim=RIM if rim else None)


def glow(hexc):
    """Flat unlit emissive colour."""
    return toon("glow_" + hexc.lstrip("#"), "#000000", emission=hexc)


def holdout():
    m = bpy.data.materials.get("HOLDOUT")
    if m:
        return m
    m = bpy.data.materials.new("HOLDOUT")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    h = nt.nodes.new("ShaderNodeHoldout")
    nt.links.new(h.outputs[0], out.inputs[0])
    return m


def set_mat(ob, m):
    """Replace all material slots of `ob` with `m`."""
    if ob.data.materials:
        for i in range(len(ob.data.materials)):
            ob.data.materials[i] = m
    else:
        ob.data.materials.append(m)


# --------------------------------------------------------------------------
# Object plumbing


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    link(e)
    e.location = loc
    e.rotation_euler = [math.radians(a) for a in rot]
    return e


def group(name, objs, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    """Parent parentless `objs` to a new Empty (created at identity) then transform it."""
    e = empty(name)
    for o in objs:
        if o is None or o.parent is not None:
            continue
        o.parent = e
    e.location = loc
    e.rotation_euler = [math.radians(a) for a in rot]
    s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    e.scale = s
    return e


def parent_to(objs, pivot):
    """Parent objs to pivot keeping their current world transform."""
    bpy.context.view_layer.update()
    inv = pivot.matrix_world.inverted()
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = pivot
        o.matrix_parent_inverse = inv
        o.matrix_world = mw
    return pivot


def tree(root):
    return [root] + list(root.children_recursive)


def meshes(root_or_list):
    objs = root_or_list if isinstance(root_or_list, (list, tuple)) else tree(root_or_list)
    out = []
    for o in objs:
        for t in tree(o):
            if t.type == "MESH" and t not in out:
                out.append(t)
    return out


def hide(root, hidden=True):
    for o in tree(root):
        o.hide_render = hidden


def finish(ob, m, smooth=True):
    if m is not None:
        if isinstance(m, (list, tuple)):
            for mm in m:
                ob.data.materials.append(mm)
        else:
            ob.data.materials.append(m)
    for p in ob.data.polygons:
        p.use_smooth = smooth
    return ob


def bm_to_object(bm, name, m, smooth=True, loc=(0, 0, 0), rot=(0, 0, 0), recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    return finish(ob, m, smooth)


# --------------------------------------------------------------------------
# Geometry primitives


def cyl(name, r, h, m, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, r_top=None, depth_scale=1.0, smooth=True):
    """Cylinder/frustum with its base at loc, extending +h along local Z (after rot)."""
    ob = cone(name, r, r if r_top is None else r_top, h, m, loc=loc, rot=rot, segs=segs, depth_scale=depth_scale)
    if not smooth:
        for p in ob.data.polygons:
            p.use_smooth = False
    return ob


def sphere(name, r, m, loc=(0, 0, 0), segs=16, rings=10, scale=(1, 1, 1), rot=(0, 0, 0)):
    return ellipsoid(name, (2 * r * scale[0], 2 * r * scale[1], 2 * r * scale[2]), m, loc=loc, rot=rot,
                     segs=segs, rings=rings)


def torus(name, R, r, m, loc=(0, 0, 0), rot=(0, 0, 0), segs=24, rsegs=8, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=segs,
                                     minor_segments=rsegs, location=(0, 0, 0))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    return finish(ob, m, True)


def lathe(name, profile, m, segs=20, loc=(0, 0, 0), rot=(0, 0, 0), smooth=True, stave_mats=None,
          depth_scale=1.0, ring_mats=None):
    """Surface of revolution about local Z.  profile = [(radius, z), ...] bottom -> top.

    stave_mats: list of materials assigned to vertical strips in turn (barrel staves).
    ring_mats: list (one per profile segment) of material indices into stave_mats/[m].
    """
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / segs),
                                        r * math.sin(2 * math.pi * k / segs) * depth_scale, z))
                          for k in range(segs)])
    for si, (a, b) in enumerate(zip(rings, rings[1:])):
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                f = bm.faces.new((a[0], b[k], b[k2]))
            elif len(b) == 1:
                f = bm.faces.new((a[k], a[k2], b[0]))
            else:
                f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
            if stave_mats:
                f.material_index = k % len(stave_mats)
            if ring_mats:
                f.material_index = ring_mats[si]
    if len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    mats = stave_mats if stave_mats else ([m] if not isinstance(m, (list, tuple)) else m)
    return bm_to_object(bm, name, mats, smooth, loc, rot)


def prism(name, pts, thickness, m, loc=(0, 0, 0), rot=(0, 0, 0), smooth=False, y0=0.0, bevel=0.0):
    """Extrude a 2D polygon given in the XZ plane (screen plane) along Y (depth).

    pts: [(x, z), ...] (any winding).  The slab spans y0 - t/2 .. y0 + t/2.
    """
    area = 0.0
    for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1]):
        area += x1 * z2 - x2 * z1
    if area < 0:
        pts = list(reversed(pts))
    bm = bmesh.new()
    t = thickness / 2
    front = [bm.verts.new((x, y0 - t, z)) for x, z in pts]
    back = [bm.verts.new((x, y0 + t, z)) for x, z in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    ob = bm_to_object(bm, name, m, smooth, loc, rot)
    if bevel > 0:
        bpy.context.view_layer.objects.active = ob
        mod = ob.modifiers.new("bev", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = "ANGLE"
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier="bev")
    return ob


def tube(name, pts, radii, m, segs=8, ref=(0, 1, 0), smooth=True, loc=(0, 0, 0), rot=(0, 0, 0), caps=True):
    """Sweep a circle along polyline pts (3D) with per-point radius."""
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * len(pts)
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    refv = Vector(ref)
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i - 1])
        t.normalize()
        n = t.cross(refv)
        if n.length < 1e-6:
            n = t.cross(Vector((1, 0, 0)))
        n.normalize()
        b = t.cross(n).normalized()
        r = radii[i]
        rings.append([bm.verts.new(p + r * (math.cos(2 * math.pi * k / segs) * n +
                                            math.sin(2 * math.pi * k / segs) * b)) for k in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm_to_object(bm, name, m, smooth, loc, rot)


def catmull(points, per=6):
    """Catmull-Rom resample of a list of 3D points."""
    P = [Vector(p) for p in points]
    P = [P[0]] + P + [P[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in range(per):
            t = s / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return out


def ridged_blade(name, stations, m_left, m_right, t=0.018, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Blade along +Z with a diamond cross-section (central ridge facing the camera).

    stations: [(z, half_width_left, half_width_right), ...] base -> tip; the last
    station may have 0 widths (pointed tip).  Left faces (-X) get m_left, right faces m_right,
    which gives the classic two-tone lit/shaded pixel-art blade.
    """
    bm = bmesh.new()
    rings = []
    for z, wl, wr in stations:
        if wl <= 1e-6 and wr <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            tt = t * min(1.0, (wl + wr) / 0.06)
            rings.append([bm.verts.new((-wl, 0, z)), bm.verts.new((0, -tt, z)),
                          bm.verts.new((wr, 0, z)), bm.verts.new((0, tt, z))])
    # faces: 0 = L-F (left front), 1 = F-R, 2 = R-B, 3 = B-L
    side_mat = [0, 1, 1, 0]
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            k2 = (k + 1) % 4
            if len(b) == 1:
                f = bm.faces.new((a[k], a[k2], b[0]))
            else:
                f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
            f.material_index = side_mat[k]
    if len(rings[0]) == 4:
        f = bm.faces.new(list(reversed(rings[0])))
        f.material_index = 0
    return bm_to_object(bm, name, [m_left, m_right], False, loc, rot)


def star(name, r_out, r_in, n, m, thickness=0.01, loc=(0, 0, 0), rot=(0, 0, 0), phase=0.0):
    pts = []
    for k in range(2 * n):
        a = math.pi / 2 + phase + math.pi * k / n
        r = r_out if k % 2 == 0 else r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    return prism(name, pts, thickness, m, loc=loc, rot=rot)


def disc(name, r, m, loc=(0, 0, 0), segs=24, scale=(1, 1)):
    """Flat disc in the XZ plane (faces the -Y camera); use face_camera() to orient exactly."""
    pts = [(r * scale[0] * math.cos(2 * math.pi * k / segs), r * scale[1] * math.sin(2 * math.pi * k / segs))
           for k in range(segs)]
    return prism(name, pts, 0.002, m, loc=loc)


def face_camera(ob):
    """Rotate ob so its local -Y axis points at the scene camera (for XZ-plane billboards)."""
    cam = bpy.context.scene.camera
    back = cam.matrix_world.col[2].xyz.normalized()  # camera +Z = toward the viewer
    q = (-back).to_track_quat("Y", "Z")
    ob.rotation_euler = q.to_euler()
    return ob


def chain(name, n, link_len, m, start=(0, 0, 0), direction=(0, 0, -1), r_wire=0.022, twist0=0.0,
          width_ratio=0.6):
    """Chain of n oval links from `start` along `direction`, alternating 90 deg twists.

    Even links face the camera (-Y) when the chain is vertical; odd links are edge-on.
    """
    d = Vector(direction).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    n0 = (ref - d * ref.dot(d)).normalized()
    n0 = (Matrix.Rotation(math.radians(twist0), 3, d) @ n0).normalized()
    n1 = d.cross(n0).normalized()
    R = link_len / 2 - r_wire
    step = link_len - 2.4 * r_wire
    objs = []
    for i in range(n):
        nrm = n0 if i % 2 == 0 else n1
        wid = d.cross(nrm).normalized()
        c = Vector(start) + d * (step * i + link_len / 2)
        ob = torus("%s_%d" % (name, i), R, r_wire, m, segs=12, rsegs=6, scale=(width_ratio, 1, 1))
        rotm = Matrix((wid, d, nrm)).transposed()  # columns: local X->wid, Y->d, Z->nrm
        ob.matrix_world = Matrix.Translation(c) @ rotm.to_4x4()
        objs.append(ob)
    return objs


def rocky(name, r, m, seed=1, loc=(0, 0, 0), rot=(0, 0, 0), jitter=0.28, subdiv=1, scale=(1, 1, 1)):
    """Irregular faceted rock (flat shaded)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        f = 1.0 + rng.uniform(-jitter, jitter)
        v.co = Vector((v.co.x * f * scale[0], v.co.y * f * scale[1], v.co.z * f * scale[2]))
    return bm_to_object(bm, name, m, False, loc, rot)


# --------------------------------------------------------------------------
# Camera-space measurement


def cam_basis():
    cam = bpy.context.scene.camera
    mw = cam.matrix_world
    return mw.col[0].xyz.normalized(), mw.col[1].xyz.normalized(), -mw.col[2].xyz.normalized()


def screen_extent(objs):
    """(min_x, max_x, min_y, max_y) in world units on the camera plane (relative to world origin)."""
    bpy.context.view_layer.update()
    right, up, _ = cam_basis()
    xs, ys = [], []
    for o in meshes(objs):
        if o.hide_render:
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            xs.append(w.dot(right))
            ys.append(w.dot(up))
    return min(xs), max(xs), min(ys), max(ys)


def px_bbox(objs, ax, ay, ppu=common.PX_PER_UNIT):
    """Pixel bbox (left, top, right, bottom) of objs in a frame whose anchor (ax, ay) = world origin."""
    x0, x1, y0, y1 = screen_extent(objs)
    return (ax + x0 * ppu, ay - y1 * ppu, ax + x1 * ppu, ay - y0 * ppu)


def ground_snap(root, objs=None, lift=0.0):
    """Move root along world Z so the lowest visible point of objs sits on screen row of the anchor."""
    _, up, _ = cam_basis()
    x0, x1, y0, y1 = screen_extent(objs or [root])
    root.location.z += (lift - y0) / up.z
    bpy.context.view_layer.update()


def fit_camera(objs, frame_w, frame_h, margin=1.0):
    """Ortho camera framing so objs fill the frame (minus `margin` px each side), centred."""
    cam = bpy.context.scene.camera
    cam.data.shift_x = 0
    cam.data.shift_y = 0
    bpy.context.view_layer.update()
    right, up, _ = cam_basis()
    cl = cam.matrix_world.translation
    xs, ys = [], []
    for o in meshes(objs):
        if o.hide_render:
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co - cl
            xs.append(w.dot(right))
            ys.append(w.dot(up))
    bw, bh = max(xs) - min(xs), max(ys) - min(ys)
    big = max(frame_w, frame_h)
    upp = max(bw / (frame_w - 2 * margin), bh / (frame_h - 2 * margin))  # units per pixel
    cam.data.ortho_scale = upp * big
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    cam.data.shift_x = cx / cam.data.ortho_scale
    cam.data.shift_y = cy / cam.data.ortho_scale
    return 1.0 / upp


# --------------------------------------------------------------------------
# Item models (shared by icons / pickups / projectiles; heroine weapon proportions)


def m_rusty_sword():
    st = mat("steel")
    sd = mat("steel_dark")
    # (z, half-width left, half-width right); notches bite into the edges
    stations = [(0.02, 0.05, 0.05), (0.14, 0.05, 0.05), (0.165, 0.05, 0.022), (0.2, 0.05, 0.05),
                (0.33, 0.049, 0.049), (0.355, 0.024, 0.049), (0.385, 0.049, 0.049),
                (0.47, 0.047, 0.047), (0.495, 0.047, 0.025), (0.525, 0.046, 0.046),
                (0.6, 0.043, 0.043), (0.72, 0.0, 0.0)]
    parts = [ridged_blade("rs_blade", stations, st, sd, t=0.02)]
    rust = mat("rust")
    for i, (x, z, s) in enumerate([(-0.022, 0.08, 1.0), (0.02, 0.27, 0.8), (-0.018, 0.45, 0.9),
                                   (0.016, 0.58, 0.7), (0.025, 0.11, 0.6)]):
        parts.append(ellipsoid("rs_rust%d" % i, (0.04 * s, 0.012, 0.05 * s), rust, loc=(x, -0.013, z)))
    parts.append(box("rs_guard", (0.26, 0.07, 0.055), mat("iron"), loc=(0, 0, 0.0), bevel=0.012))
    parts.append(cyl("rs_grip", 0.03, 0.17, mat("leather"), loc=(0, 0, -0.18)))
    for i, z in enumerate((-0.15, -0.1, -0.05)):
        parts.append(torus("rs_wrap%d" % i, 0.031, 0.008, mat("wood_dark"), loc=(0, 0, z), segs=12, rsegs=4))
    parts.append(sphere("rs_pommel", 0.045, mat("iron"), loc=(0, 0, -0.21)))
    return group("rusty_sword", parts)


def m_blood_sword(aura=False):
    hi = glow("#ff3a55")
    lo = glow("#b80f38")
    stations = []
    for i in range(14):
        z = 0.02 + i * 0.05
        w = 0.058 - 0.006 * (i / 13)
        wav = 0.01 * math.sin(i * 1.7)
        stations.append((z, w + wav, w - wav))
    stations.append((0.78, 0.0, 0.0))
    parts = [ridged_blade("bs_blade", stations, hi, lo, t=0.022)]
    parts.append(box("bs_core", (0.016, 0.01, 0.5), glow("#ffc2cc"), loc=(-0.008, -0.022, 0.3)))
    if aura:
        st2 = [(z, wl + 0.03, wr + 0.03) for z, wl, wr in stations[:-1]] + [(0.84, 0.0, 0.0)]
        parts.append(ridged_blade("bs_aura", st2, glow("#6e0a2a"), glow("#6e0a2a"), t=0.01, loc=(0, 0.04, 0)))
    # winged guard
    wing = [(-0.18, 0.08), (-0.1, 0.02), (0.0, 0.0), (0.1, 0.02), (0.18, 0.08), (0.16, -0.0),
            (0.06, -0.045), (-0.06, -0.045), (-0.16, -0.0)]
    parts.append(prism("bs_guard", wing, 0.07, mat("gold"), bevel=0.008))
    parts.append(sphere("bs_gem", 0.032, glow("#ff2a4a"), loc=(0, -0.04, -0.008)))
    parts.append(cyl("bs_grip", 0.03, 0.17, mat("leather_red"), loc=(0, 0, -0.19)))
    for i, z in enumerate((-0.16, -0.11, -0.06)):
        parts.append(torus("bs_wrap%d" % i, 0.031, 0.008, mat("gold"), loc=(0, 0, z), segs=12, rsegs=4))
    parts.append(cone("bs_pommel", 0.05, 0.0, 0.08, mat("gold"), loc=(0, 0, -0.19), rot=(180, 0, 0)))
    return group("blood_sword", parts)


def m_spear(length=1.3, shaft_r=0.032):
    st, sd = mat("steel"), mat("steel_dark")
    parts = [cyl("sp_shaft", shaft_r, length, mat("wood_light"), loc=(0, 0, -length))]
    for i, z in enumerate((-0.42, -0.36)):
        parts.append(torus("sp_wrap%d" % i, shaft_r + 0.003, 0.009, mat("leather"), loc=(0, 0, z), segs=12, rsegs=4))
    parts.append(cyl("sp_socket", 0.045, 0.1, mat("iron"), loc=(0, 0, -0.02), r_top=0.03))
    stations = [(0.07, 0.025, 0.025), (0.12, 0.06, 0.06), (0.2, 0.078, 0.078), (0.28, 0.066, 0.066),
                (0.36, 0.036, 0.036), (0.45, 0.0, 0.0)]
    parts.append(ridged_blade("sp_blade", stations, st, sd, t=0.024))
    # red tassel
    for i, (x, z, s) in enumerate([(-0.03, -0.07, 1.0), (0.025, -0.08, 0.9), (0.0, -0.1, 1.1)]):
        parts.append(ellipsoid("sp_tassel%d" % i, (0.05 * s, 0.05, 0.11 * s), mat("cloth_red"), loc=(x, -0.01, z)))
    parts.append(cone("sp_butt", 0.04, 0.0, 0.07, mat("iron"), loc=(0, 0, -length), rot=(180, 0, 0)))
    return group("spear", parts)


def m_dagger(tag="d", handle="cloth_purple"):
    st, sd = mat("steel"), mat("steel_dark")
    stations = [(0.02, 0.04, 0.04), (0.12, 0.042, 0.04), (0.22, 0.034, 0.03), (0.3, 0.018, 0.012), (0.36, 0.0, 0.0)]
    parts = [ridged_blade(tag + "_blade", stations, st, sd, t=0.018)]
    parts.append(box(tag + "_guard", (0.15, 0.06, 0.04), mat("gold"), loc=(0, 0, 0.0), bevel=0.01))
    parts.append(cyl(tag + "_grip", 0.026, 0.12, mat(handle), loc=(0, 0, -0.13)))
    parts.append(torus(tag + "_pom", 0.03, 0.012, mat("gold"), loc=(0, 0, -0.16), rot=(90, 0, 0), segs=12, rsegs=4))
    return group(tag, parts)


def m_war_hammer(haft=1.05):
    parts = [cyl("wh_haft", 0.042, haft, mat("wood"), loc=(0, 0, -0.42))]
    for i, z in enumerate((-0.36, -0.3, -0.24, -0.18)):
        parts.append(torus("wh_wrap%d" % i, 0.045, 0.012, mat("leather"), loc=(0, 0, z), segs=12, rsegs=4))
    parts.append(cyl("wh_butt", 0.055, 0.07, mat("iron"), loc=(0, 0, -0.47)))
    hz = haft - 0.42 - 0.12
    parts.append(box("wh_head", (0.5, 0.28, 0.3), mat("iron"), loc=(0, 0, hz), bevel=0.035))
    for sx in (-1, 1):
        parts.append(box("wh_face%d" % sx, (0.06, 0.32, 0.34), mat("steel"), loc=(sx * 0.26, 0, hz), bevel=0.02))
        parts.append(box("wh_band%d" % sx, (0.05, 0.3, 0.32), mat("bronze"), loc=(sx * 0.13, 0, hz), bevel=0.012))
    for x in (-0.06, 0.06):
        for z in (hz - 0.08, hz + 0.08):
            parts.append(sphere("wh_rivet", 0.02, mat("gold"), loc=(x, -0.145, z), segs=8, rings=6))
    parts.append(cone("wh_spike", 0.06, 0.0, 0.14, mat("steel"), loc=(0, 0, hz + 0.15)))
    return group("war_hammer", parts)


def m_hunter_bow(string_r=0.012, curve=1.0, thick=1.0):
    """Recurve bow facing +X: the limbs bow toward the archer (-X), tips curl forward,
    the string runs straight between the string-contact points (most -X)."""
    up = [(0.0, 0.0), (-0.03, 0.15), (-0.09, 0.3), (-0.15, 0.43), (-0.19, 0.53), (-0.2, 0.58),
          (-0.185, 0.64), (-0.145, 0.68)]
    up = [(x * curve, z) for x, z in up]
    curve_pts = [Vector((x, 0, -z)) for x, z in reversed(up[1:])] + [Vector((x, 0, z)) for x, z in up]
    pts = catmull(curve_pts, per=4)
    n = len(pts)
    radii = []
    for i in range(n):
        s = abs(i - (n - 1) / 2) / ((n - 1) / 2)
        radii.append((0.05 * (1 - s) + 0.02 * s) * thick)
    parts = [tube("hb_limbs", pts, radii, mat("wood"), segs=8)]
    parts.append(cyl("hb_grip", 0.056 * thick, 0.18, mat("cloth_purple"), loc=(0, 0, -0.09)))
    for z in (-0.09, 0.09):
        parts.append(torus("hb_ring", 0.056 * thick, 0.012, mat("gold"), loc=(0, 0, z), segs=12, rsegs=4))
    cu = Vector((up[5][0] - 0.012, 0, up[5][1]))
    cd = Vector((cu.x, 0, -cu.z))
    tip_u = Vector((up[-1][0], 0, up[-1][1]))
    tip_d = Vector((tip_u.x, 0, -tip_u.z))
    for i, tp in enumerate((tip_u, tip_d)):
        parts.append(sphere("hb_tip%d" % i, 0.026 * thick, mat("gold"), loc=tp, segs=8, rings=6))
    parts.append(tube("hb_string", [tip_u, cu, cd, tip_d], string_r, mat("cloth_cream"), segs=6))
    return group("hunter_bow", parts)


def m_arrow(length=0.82, shaft_r=0.02, fletch="cloth_red"):
    """Arrow along +X, centred on the origin (tip at +length/2)."""
    h = length / 2
    parts = [cyl("ar_shaft", shaft_r, length - 0.1, mat("wood_light"), loc=(-h, 0, 0), rot=(0, 90, 0), segs=6)]
    head = [(0.0, 0.0), (-0.11, 0.055), (-0.085, 0.0), (-0.11, -0.055)]
    parts.append(prism("ar_head", head, 0.025, mat("steel"), loc=(h, 0, 0)))
    parts.append(cyl("ar_ferrule", shaft_r * 1.4, 0.04, mat("iron"), loc=(h - 0.13, 0, 0), rot=(0, 90, 0), segs=6))
    fl = [(0.0, 0.0), (-0.16, 0.0), (-0.2, 0.06), (-0.05, 0.035)]
    for sz in (1, -1):
        parts.append(prism("ar_fl%d" % sz, [(x, sz * z) for x, z in fl], 0.012, mat(fletch),
                           loc=(-h + 0.21, -0.004 * sz, sz * shaft_r * 0.5)))
    parts.append(prism("ar_flc", [(x, z * 0.6) for x, z in fl], 0.012, mat("cloth_cream"),
                       loc=(-h + 0.21, -0.03, 0.0), rot=(90, 0, 0)))
    parts.append(box("ar_nock", (0.03, 0.03, 0.045), mat("cloth_cream"), loc=(-h + 0.0, 0, 0)))
    return group("arrow", parts)


def m_old_shield(R=0.42):
    parts = []
    parts.append(lathe("os_back", [(0, 0.0), (R, 0.0), (R, 0.05), (0, 0.05)], mat("mortar"), segs=28,
                       rot=(90, 0, 0), loc=(0, 0.04, 0)))
    pw = 0.15
    xs = [-R + i * pw for i in range(int(2 * R / pw) + 2)]
    wm = [mat("wood"), mat("wood_light")]
    k = 0
    for x0 in xs:
        x1 = min(x0 + pw - 0.012, R)
        if x0 >= R:
            break
        pts = []
        steps = 6
        for s in range(steps + 1):
            x = x0 + (x1 - x0) * s / steps
            pts.append((x, -math.sqrt(max(0.0, R * R - x * x)) * 0.985))
        for s in range(steps + 1):
            x = x1 - (x1 - x0) * s / steps
            pts.append((x, math.sqrt(max(0.0, R * R - x * x)) * 0.985))
        parts.append(prism("os_plank%d" % k, pts, 0.06, wm[k % 2], y0=0.0, bevel=0.006))
        k += 1
    parts.append(torus("os_rim", R, 0.04, mat("iron"), rot=(90, 0, 0), segs=36, rsegs=8))
    parts.append(ellipsoid("os_boss", (0.22, 0.12, 0.22), mat("steel"), loc=(0, -0.04, 0)))
    parts.append(torus("os_bossring", 0.11, 0.022, mat("iron"), loc=(0, -0.035, 0), rot=(90, 0, 0), segs=20, rsegs=6))
    for i in range(8):
        a = 2 * math.pi * i / 8 + 0.2
        parts.append(sphere("os_rivet%d" % i, 0.022, mat("gold"), loc=(0.33 * math.cos(a), -0.035, 0.33 * math.sin(a)),
                            segs=8, rings=6))
    # a crack / missing chip for "old"
    parts.append(box("os_scratch", (0.012, 0.01, 0.16), mat("wood_dark"), loc=(-0.16, -0.032, 0.12), rot=(0, 25, 0)))
    return group("old_shield", parts)


def flame(name, h, r, layers=("#b8202a", "#ff5a1e", "#ffb43a", "#fff2b0"), seed=0, sway=0.0,
          loc=(0, 0, 0), squash=(1.0, 1.0)):
    """Layered emissive teardrop flame (flat slabs in the XZ plane), base centre at loc.

    Inner layers are smaller, sit lower and slightly in front so all bands show.
    """
    rng = random.Random(seed)
    objs = []
    nl = len(layers)
    for li, col in enumerate(layers):
        f = 1.0 - li * (0.62 / max(1, nl - 1))
        hh = h * f * rng.uniform(0.9, 1.08) * squash[1]
        rr = r * f * squash[0]
        sw = sway * (1.0 + 0.3 * li) + rng.uniform(-0.08, 0.08)
        pts = []
        steps = 10
        for k in range(steps + 1):
            s = k / steps
            w = rr * math.cos(math.pi / 2 * s) ** 1.25
            pts.append((sw * hh * s * s + w, s * hh))
        for k in range(steps - 1, -1, -1):
            s = k / steps
            w = rr * math.cos(math.pi / 2 * s) ** 1.25
            pts.append((sw * hh * s * s - w, s * hh))
        for k in range(1, 8):
            a = math.pi + math.pi * k / 8
            pts.append((rr * math.cos(a), rr * 0.85 * math.sin(a)))
        ob = prism("%s_%d" % (name, li), pts, 0.01, glow(col),
                   loc=(loc[0], loc[1] - 0.012 * li, loc[2] - r * 0.15 * li))
        objs.append(ob)
    return objs


def m_bomb(spark_phase=0):
    parts = [sphere("bomb_body", 0.17, mat("black"), segs=20, rings=12)]
    parts.append(cyl("bomb_cap", 0.065, 0.06, mat("iron"), loc=(0, 0, 0.14)))
    parts.append(torus("bomb_capring", 0.066, 0.014, mat("brass"), loc=(0, 0, 0.2), segs=12, rsegs=4))
    fuse = [(0, 0, 0.19), (0.01, 0, 0.25), (-0.02, 0, 0.3), (-0.06, 0, 0.32)]
    parts.append(tube("bomb_fuse", catmull(fuse, 3), 0.014, mat("straw"), segs=6))
    parts.append(sphere("bomb_shine", 0.03, mat("steel_dark"), loc=(-0.07, -0.12, 0.08), segs=8, rings=6))
    return group("bomb", parts), Vector((-0.065, 0, 0.32))


def spark(name, size, phase, loc, cols=("#ff8a1e", "#ffe27a", "#ffffff")):
    """Fuse spark: layered star shapes (camera-facing)."""
    objs = []
    for li, c in enumerate(cols):
        f = 1.0 - li * 0.32
        ob = star("%s_%d" % (name, li), size * f, size * f * 0.38, 4 if li else 5, glow(c), phase=phase + li * 0.4)
        ob.location = Vector(loc) + Vector((0, -0.01 * (li + 1), 0))
        objs.append(ob)
    return objs


def m_fire_grenade():
    parts = [sphere("fg_body", 0.16, mat("clay"), segs=20, rings=12)]
    # glowing cracks / runes
    g1, g2 = glow("#ff7a1e"), glow("#ffd04a")
    parts.append(torus("fg_band", 0.158, 0.018, mat("bronze"), rot=(90, 0, 0), segs=24, rsegs=6))
    parts.append(torus("fg_band2", 0.158, 0.018, mat("bronze"), rot=(0, 0, 0), segs=24, rsegs=6))
    for i, (x, z, a, L) in enumerate([(-0.07, 0.06, 30, 0.08), (0.06, -0.07, -40, 0.09), (0.08, 0.07, 70, 0.06),
                                      (-0.06, -0.08, -70, 0.06)]):
        ob = box("fg_crack%d" % i, (0.024, 0.02, L), g1, loc=(x, -0.13, z), rot=(0, a, 0))
        parts.append(ob)
    parts.append(sphere("fg_core", 0.035, g2, loc=(0, -0.155, 0), segs=10, rings=6))
    parts.append(cyl("fg_neck", 0.05, 0.06, mat("iron_dark"), loc=(0, 0, 0.14)))
    parts.append(cyl("fg_cork", 0.042, 0.05, mat("wood_light"), loc=(0, 0, 0.19), r_top=0.035))
    return group("fire_grenade", parts)


def m_ice_grenade():
    parts = [sphere("ig_body", 0.15, glow("#5fc8f8"), segs=20, rings=12)]
    parts.append(sphere("ig_hl", 0.075, glow("#d8f6ff"), loc=(-0.05, -0.1, 0.05), segs=12, rings=8))
    parts.append(torus("ig_band", 0.152, 0.02, mat("steel_dark"), rot=(90, 0, 0), segs=24, rsegs=6))
    parts.append(torus("ig_band2", 0.152, 0.02, mat("steel_dark"), rot=(0, 90, 0), segs=24, rsegs=6))
    rng = random.Random(4)
    for i in range(7):
        a = 2 * math.pi * i / 7 + 0.3
        d = Vector((math.cos(a), rng.uniform(-0.5, 0.2), math.sin(a))).normalized()
        L = rng.uniform(0.09, 0.14)
        c = cone("ig_spike%d" % i, 0.035, 0.0, L, mat("ice"), segs=5)
        c.location = d * 0.12
        c.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        parts.append(c)
    parts.append(cyl("ig_cap", 0.05, 0.06, mat("steel_dark"), loc=(0, 0, 0.13)))
    return group("ice_grenade", parts)


def m_flask(liquid="potion"):
    parts = []
    # liquid bulb (lower part) and glass top
    prof_l = [(0.0, 0.0), (0.08, 0.005), (0.125, 0.04), (0.145, 0.1), (0.14, 0.16), (0.12, 0.2), (0.0, 0.2)]
    parts.append(lathe("fl_liquid", prof_l, mat(liquid), segs=20))
    prof_g = [(0.121, 0.198), (0.09, 0.235), (0.05, 0.255), (0.045, 0.33), (0.058, 0.345), (0.058, 0.36),
              (0.0, 0.36)]
    parts.append(lathe("fl_glass", prof_g, mat("glass"), segs=16))
    parts.append(torus("fl_surface", 0.12, 0.008, glow("#ff9aa8"), loc=(0, 0, 0.2), segs=20, rsegs=4))
    parts.append(cyl("fl_cork", 0.045, 0.06, mat("wood_light"), loc=(0, 0, 0.35), r_top=0.05))
    parts.append(torus("fl_tie", 0.05, 0.012, mat("leather"), loc=(0, 0, 0.29), segs=12, rsegs=4))
    parts.append(ellipsoid("fl_shine", (0.03, 0.02, 0.07), glow("#ffffff"), loc=(-0.07, -0.11, 0.12), rot=(0, 25, 0)))
    parts.append(ellipsoid("fl_shine2", (0.018, 0.02, 0.018), glow("#ffffff"), loc=(-0.035, -0.135, 0.06)))
    return group("flask", parts)


SCROLL_COLORS = {
    # ribbon toon, glow ring, glow core
    "red": (("#c81e32", "#5e0a26", "#ff5a5a"), "#d0203c", "#ff7a7a"),
    "purple": (("#8a34c8", "#3e1466", "#c27aff"), "#8a2ad8", "#d9a0ff"),
    "green": (("#28a048", "#0e4a30", "#6ee07a"), "#1fa846", "#8affa0"),
    "gold": (("#d9a441", "#8a5527", "#ffe08a"), "#d08a20", "#ffe08a"),
}


def m_scroll(color="red", length=0.4, r=0.075, aura=0.0):
    rib, ring, core = SCROLL_COLORS[color]
    rm = toon("ribbon_" + color, rib[0], rib[1], rib[2], rim=RIM)
    parts = [cyl("sc_roll", r, length, mat("parchment"), loc=(-length / 2, 0, 0), rot=(0, 90, 0), segs=16)]
    # paper edge lip (the unrolled sheet hugging the roll)
    parts.append(box("sc_lip", (length * 0.96, 0.02, r * 1.2), mat("parchment_dark"), loc=(0, -r * 0.55, -r * 0.45),
                     rot=(20, 0, 0)))
    for sx in (-1, 1):
        parts.append(cyl("sc_knob%d" % sx, r * 0.55, 0.05, mat("wood_dark"), loc=(sx * length / 2, 0, 0),
                         rot=(0, 90 * sx, 0), segs=12))
        parts.append(sphere("sc_knobend%d" % sx, r * 0.5, mat("gold"), loc=(sx * (length / 2 + 0.06), 0, 0), segs=10, rings=6))
    parts.append(torus("sc_ribbon", r + 0.006, 0.02, rm, rot=(0, 90, 0), segs=16, rsegs=6))
    parts.append(prism("sc_tail1", [(0.0, 0.0), (0.035, 0.0), (0.07, -0.13), (0.045, -0.115), (0.03, -0.14)], 0.02, rm,
                       loc=(0, -r - 0.01, -0.02)))
    parts.append(prism("sc_tail2", [(0.0, 0.0), (-0.03, 0.0), (-0.05, -0.12), (-0.03, -0.105), (-0.012, -0.125)], 0.02, rm,
                       loc=(0, -r - 0.012, -0.02)))
    parts.append(cyl("sc_seal", 0.04, 0.02, glow(core), loc=(0, -r - 0.01, 0.0), rot=(90, 0, 0), segs=12))
    if aura:
        # glowing rim: a fatter, depth-flattened copy of the roll + knobs just behind the scroll
        parts.append(cyl("sc_aura", r + aura, length + 0.16 + 2 * aura, glow(ring),
                         loc=(-(length + 0.16) / 2 - aura, 0.05, 0), rot=(0, 90, 0), segs=16, depth_scale=0.3))
    return group("scroll_" + color, parts), ring, core


def m_cell(r=0.11):
    parts = [sphere("cell_core", r, glow("#4fd8ff"), segs=16, rings=10)]
    parts.append(sphere("cell_hot", r * 0.5, glow("#e6fdff"), loc=(-r * 0.25, -r * 0.7, r * 0.25), segs=10, rings=6))
    return group("cell", parts)


def m_coin(r=0.15, th=0.04, name="coin"):
    """Flat-shaded gold coin facing -Y: gold rim, darker inset face, bright square mark."""
    parts = [cyl(name + "_body", r, th, mat("gold"), loc=(0, th / 2, 0), rot=(90, 0, 0), segs=16, smooth=False)]
    for sy in (-1, 1):
        parts.append(cyl(name + "_face%d" % sy, r * 0.72, 0.01, mat("brass"), loc=(0, sy * th / 2, 0),
                         rot=(-90 * sy, 0, 0), segs=16, smooth=False))
        parts.append(box(name + "_mark%d" % sy, (r * 0.42, 0.012, r * 0.42), mat("coin_mark"),
                         loc=(0, sy * (th / 2 + 0.012), 0), rot=(0, 45, 0)))
    return group(name, parts)


def sparkle(name, size, m, loc=(0, 0, 0), w=0.034):
    """Pixel-art twinkle: a thin plus sign (two flat bars) in the XZ plane, centred at loc."""
    a = box(name + "_h", (size, 0.004, w), m, loc=(0, 0, 0))
    b = box(name + "_v", (w, 0.004, size), m, loc=(0, 0, 0))
    c = box(name + "_c", (w * 2, 0.004, w * 2), m, loc=(0, -0.002, 0), rot=(0, 45, 0))
    return group(name, [a, b, c], loc=loc)


def m_turret():
    """Small crossbow turret (faces +X).  Returns (root, P) with pivots for set_turret().

    The bow is mounted vertically at the front of the stock so it reads in side view.
    """
    P = {}
    root = empty("turret")
    hub = empty("t_hub")
    hub.parent = root
    P["hub"] = hub
    for o in (cyl("t_hubm", 0.1, 0.11, mat("iron"), loc=(0, 0, -0.06), segs=12),
              torus("t_hubring", 0.1, 0.016, mat("brass"), loc=(0, 0, 0.045), segs=12, rsegs=4),
              torus("t_hubring2", 0.1, 0.016, mat("brass"), loc=(0, 0, -0.055), segs=12, rsegs=4)):
        o.parent = hub
    for i in range(3):
        lp = empty("t_leg%d" % i)
        lp.parent = hub
        P["leg%d" % i] = lp
        sw = empty("t_legsw%d" % i)
        sw.parent = lp
        P["legsw%d" % i] = sw
        for o in (box("t_legm%d" % i, (0.06, 0.06, 0.36), mat("wood"), loc=(0, 0, -0.18), bevel=0.012),
                  cone("t_foot%d" % i, 0.04, 0.0, 0.07, mat("iron"), loc=(0, 0, -0.35), rot=(180, 0, 0), segs=6),
                  box("t_legband%d" % i, (0.075, 0.075, 0.035), mat("brass"), loc=(0, 0, -0.27)),
                  box("t_legtop%d" % i, (0.075, 0.075, 0.05), mat("iron"), loc=(0, 0, -0.03))):
            o.parent = sw
    post = cyl("t_post", 0.04, 0.17, mat("iron_dark"), loc=(0, 0, 0.0), segs=10)
    post.parent = hub
    head = empty("t_head")
    head.parent = hub
    head.location = (0, 0, 0.18)
    P["head"] = head
    for o in (box("t_stock", (0.5, 0.09, 0.08), mat("wood_light"), loc=(-0.03, 0, 0.0), bevel=0.014),
              box("t_rail", (0.34, 0.035, 0.025), mat("wood_dark"), loc=(0.04, 0, 0.05)),
              box("t_box", (0.17, 0.13, 0.13), mat("iron"), loc=(-0.2, 0, 0.0), bevel=0.02),
              box("t_boxband", (0.04, 0.14, 0.14), mat("brass"), loc=(-0.13, 0, 0.0)),
              box("t_nose", (0.06, 0.11, 0.1), mat("iron"), loc=(0.22, 0, 0.0), bevel=0.012)):
        o.parent = head
    eye = sphere("t_eye", 0.042, glow("#b45cff"), loc=(-0.24, -0.07, 0.01), segs=10, rings=6)
    eye.parent = head
    P["eye"] = eye
    eye2 = sphere("t_eyehot", 0.02, glow("#f4dcff"), loc=(-0.25, -0.1, 0.02), segs=8, rings=4)
    eye2.parent = head
    P["eye_hot"] = eye2
    # vertical bow at the front: upper limb pivot 'limb_u', lower 'limb_d'
    for side, sz in (("u", 1), ("d", -1)):
        lp = empty("t_limb_" + side)
        lp.parent = head
        lp.location = (0.22, 0, 0.0)
        P["limb_" + side] = lp
        pts = [Vector((0, 0, 0)), Vector((-0.02, 0, sz * 0.09)), Vector((-0.07, 0, sz * 0.18)),
               Vector((-0.13, 0, sz * 0.23))]
        lm = tube("t_limbm_" + side, catmull(pts, 3), [0.03, 0.028, 0.024, 0.02, 0.018, 0.016, 0.015, 0.014, 0.013,
                                                         0.012], mat("steel_dark"), segs=6, ref=(0, 1, 0))
        lm.parent = lp
        tip = sphere("t_limbtip_" + side, 0.022, mat("brass"), loc=(-0.13, 0, sz * 0.23), segs=8, rings=4)
        tip.parent = lp
    bolt = [cyl("t_bolt", 0.014, 0.3, mat("wood_dark"), loc=(-0.12, 0, 0.07), rot=(0, 90, 0), segs=6),
            cone("t_bolthead", 0.032, 0.0, 0.08, mat("steel"), loc=(0.18, 0, 0.07), rot=(0, 90, 0), segs=6),
            prism("t_boltfl", [(0, 0), (0.07, 0), (0.02, 0.045)], 0.012, mat("cloth_purple"), loc=(-0.12, 0, 0.08))]
    bg = group("t_boltg", bolt)
    bg.parent = head
    P["bolt"] = bg
    fl = star("t_flash", 0.11, 0.035, 5, glow("#c97aff"))
    fl2 = star("t_flash2", 0.065, 0.025, 5, glow("#ffffff"), loc=(0, -0.01, 0))
    fg = group("t_flashg", [fl, fl2], loc=(0.33, -0.06, 0.06))
    fg.parent = head
    P["flash"] = fg
    P["root"] = root
    P["string"] = None
    return root, P


def set_turret(P, deploy=1.0, draw=1.0, recoil=0.0, bolt=True, flash=False, eye=1.0, bob=0.0):
    """deploy 0 = folded bundle on the ground, 1 = standing.  draw 1 = string pulled back."""
    d = max(0.0, min(1.0, deploy))
    P["hub"].location = (0, 0, 0.1 + 0.27 * d + bob)
    for i, az in enumerate((-35, -145, 90)):
        P["leg%d" % i].rotation_euler = (0, 0, math.radians(az))
        P["legsw%d" % i].rotation_euler = (0, -math.radians(170 - 145 * d), 0)
    head = P["head"]
    head.location = (-recoil * 0.07, 0, 0.18)
    head.rotation_euler = (0, math.radians(-5 * recoil), 0)
    fold = 1 - d
    P["limb_u"].rotation_euler = (0, -math.radians(75 * fold), 0)
    P["limb_d"].rotation_euler = (0, math.radians(75 * fold), 0)
    if P.get("string"):
        bpy.data.objects.remove(P["string"], do_unlink=True)
        P["string"] = None
    bpy.context.view_layer.update()
    inv = head.matrix_world.inverted()
    tu = inv @ bpy.data.objects["t_limbtip_u"].matrix_world.translation
    td = inv @ bpy.data.objects["t_limbtip_d"].matrix_world.translation
    mid = (tu + td) / 2
    nock = Vector((mid.x - 0.16 * draw * d, 0, 0.07 * d + mid.z * (1 - d)))
    s = tube("t_string", [tu, nock, td], 0.011, mat("cloth_cream"), segs=5, ref=(0, 1, 0))
    s.parent = head
    P["string"] = s
    P["flash"].hide_render = not flash
    for o in P["flash"].children_recursive:
        o.hide_render = not flash
    em = 0.7 + 0.3 * eye
    P["eye"].scale = (em, em, em)
    P["eye_hot"].hide_render = eye < 0.5
    hide(P["bolt"], (not bolt) or d < 0.6)


def m_wolf_trap(R=0.3):
    """Bear trap.  Returns (root, P); jaw pivots 'jaw_n' (front) / 'jaw_f' (back) hinge on the X axis."""
    P = {}
    root = empty("wolf_trap")
    parts = [cyl("wt_base", 0.14, 0.035, mat("iron_dark"), segs=16),
             cyl("wt_pan", 0.11, 0.025, mat("brass"), loc=(0, 0, 0.035), segs=16),
             box("wt_bar", (2 * R + 0.1, 0.07, 0.04), mat("iron_dark"), loc=(0, 0, 0.02), bevel=0.012)]
    for sx in (-1, 1):
        # leaf spring: a U loop lying outward from each hinge
        pts = [(sx * (R + 0.02), -0.035, 0.035), (sx * (R + 0.2), -0.05, 0.03), (sx * (R + 0.26), 0.0, 0.03),
               (sx * (R + 0.2), 0.05, 0.03), (sx * (R + 0.02), 0.035, 0.035)]
        parts.append(tube("wt_spring%d" % sx, catmull(pts, 3), 0.024, mat("steel_dark"), segs=6, ref=(0, 0, 1)))
        parts.append(box("wt_hinge%d" % sx, (0.07, 0.1, 0.08), mat("iron"), loc=(sx * R, 0, 0.045), bevel=0.014))
    for o in parts:
        o.parent = root
    for side, sy in (("n", -1), ("f", 1)):
        pv = empty("wt_jaw_" + side)
        pv.parent = root
        pv.location = (0, 0, 0.05)
        P["jaw_" + side] = pv
        pts = [Vector((R * math.cos(math.pi * k / 16), sy * R * math.sin(math.pi * k / 16), 0)) for k in range(17)]
        bar = tube("wt_jawbar_" + side, pts, 0.03, mat("iron"), segs=6, ref=(0, 0, 1))
        bar.parent = pv
        nt = 6
        for k in range(nt):
            a = math.pi * (k + (0.75 if sy > 0 else 0.25)) / nt
            if a <= 0.15 or a >= math.pi - 0.15:
                continue
            c = Vector((R * math.cos(a), sy * R * math.sin(a), 0.015))
            tooth = cone("wt_tooth_%s%d" % (side, k), 0.042, 0.0, 0.13, mat("steel"), segs=4)
            tooth.location = c
            tooth.rotation_euler = (0, 0, a + math.pi / 4)
            tooth.parent = pv
    return root, P


def set_trap(P, closed=0.0):
    """closed 0 = jaws flat & open, 1 = snapped shut (vertical)."""
    a = math.radians(90 * max(0.0, min(1.0, closed)))
    P["jaw_n"].rotation_euler = (-a, 0, 0)  # front jaw (toward -Y) rises up
    P["jaw_f"].rotation_euler = (a, 0, 0)
    off = 0.012 * closed
    P["jaw_n"].location = (0, -off, 0.045)
    P["jaw_f"].location = (0, off, 0.045)


# --------------------------------------------------------------------------
# Corpse market (CONTENT3): the corpse piece and the ten shop uniques.
# Same conventions as the models above: weapons along +Z with the hilt at the origin.


def m_corpse_piece(scale=1.0):
    """A stitched chunk of the dead lying on the ground, long axis along X (turn it about Z).

    Pale flesh in two tones sewn together at x = 0.02 with dark-red cross stitches, a bone end,
    a cyan ember glint tucked into the seam.  Centred on the origin."""
    flesh, flesh_d, bone = mat("flesh_pale"), mat("flesh_dark"), mat("bone_w")
    thread, blood = mat("thread"), mat("blood_dry")
    parts = [sphere("cp_lobe_a", 0.15, flesh, loc=(-0.1, 0, 0.12), segs=14, rings=8, scale=(1.0, 0.83, 0.8)),
             sphere("cp_lobe_b", 0.13, flesh_d, loc=(0.12, 0.01, 0.115), segs=14, rings=8, scale=(1.0, 0.89, 0.85))]
    # lumps and a bruise so it does not read as an egg
    parts.append(sphere("cp_bump_a", 0.065, flesh, loc=(-0.13, 0.02, 0.235), segs=10, rings=6, scale=(1, 0.92, 0.77)))
    parts.append(sphere("cp_bump_b", 0.05, flesh_d, loc=(0.2, -0.04, 0.19), segs=10, rings=6, scale=(1, 1, 0.9)))
    parts.append(sphere("cp_bruise", 0.045, blood, loc=(-0.1, -0.115, 0.1), segs=8, rings=5, scale=(1, 0.33, 0.78)))
    # exposed bone end with a round knob
    parts.append(cyl("cp_bone", 0.05, 0.11, bone, loc=(-0.21, 0, 0.13), rot=(0, 90, 0), segs=8))
    parts.append(sphere("cp_knob", 0.062, bone, loc=(-0.3, 0.0, 0.13), segs=10, rings=6))
    parts.append(sphere("cp_knob2", 0.045, bone, loc=(-0.295, -0.045, 0.1), segs=8, rings=5))
    # seam: dark-red band around the chunk + six cross stitches around it
    parts.append(torus("cp_seam", 0.12, 0.016, blood, loc=(0.02, 0, 0.12), rot=(0, 90, 0), segs=14, rsegs=5))
    for k in range(6):
        pv = empty("cp_pv%d" % k, loc=(0.02, 0, 0.12), rot=(-60 * k, 0, 0))
        for sg in (-1, 1):
            st = box("cp_st%d_%d" % (k, sg), (0.085, 0.014, 0.014), thread, loc=(0, -0.125, 0), rot=(0, sg * 38, 0))
            st.parent = pv
        parts.append(pv)
    parts.append(sphere("cp_ember", 0.032, glow("#4fe3ff"), loc=(0.07, -0.105, 0.15), segs=8, rings=5))
    parts.append(sphere("cp_ember_hot", 0.014, glow("#e6fdff"), loc=(0.065, -0.128, 0.162), segs=6, rings=4))
    for o in parts:                 # centre the lump on the anchor so a turn does not swing it sideways
        o.location.x += 0.04
    return group("corpse_piece", parts, scale=scale)


def crescent_pts(R, a0, a1, w_out, w_in, n=14, taper=1.3):
    """Closed XZ polygon of a curved blade about an arc centre at the origin.

    The centre line runs at radius R from angle a0 to a1 (degrees from +X, either direction); the outer edge sits
    w_out beyond it and the inner edge w_in inside it, both tapering to a point at a1."""
    outer, inner = [], []
    for i in range(n + 1):
        u = i / n
        f = max(0.0, 1.0 - u ** taper) if i < n else 0.0
        a = math.radians(a0 + (a1 - a0) * u)
        outer.append(((R + w_out * f) * math.cos(a), (R + w_out * f) * math.sin(a)))
        inner.append(((R - w_in * f) * math.cos(a), (R - w_in * f) * math.sin(a)))
    return outer + list(reversed(inner[:-1]))


def m_bone_cleaver():
    """Butcher's cleaver of fused bone: slab blade, knuckle bones down the spine, dried blood."""
    bone, bone_d, steel = mat("bone_w"), mat("bone"), mat("steel")
    pts = [(-0.07, 0.03), (-0.07, 0.56), (-0.03, 0.61), (0.1, 0.61), (0.17, 0.55), (0.19, 0.38), (0.17, 0.2),
           (0.13, 0.03)]
    parts = [prism("bc_blade", pts, 0.05, bone, bevel=0.01)]
    edge = [(0.13, 0.03), (0.17, 0.2), (0.19, 0.38), (0.17, 0.55), (0.14, 0.57), (0.15, 0.38), (0.13, 0.2), (0.1, 0.03)]
    parts.append(prism("bc_edge", edge, 0.056, steel))
    for i, z in enumerate((0.1, 0.26, 0.42, 0.58)):
        parts.append(sphere("bc_knuckle%d" % i, 0.04, bone_d, loc=(-0.075, 0, z), segs=8, rings=6))
    parts.append(sphere("bc_hole", 0.034, mat("iron_dark"), loc=(0.02, -0.02, 0.48), segs=10, rings=6,
                        scale=(1, 0.3, 1)))
    parts.append(sphere("bc_blood1", 0.06, mat("blood_dry"), loc=(0.07, -0.026, 0.3), segs=8, rings=6,
                        scale=(1, 0.18, 1.4)))
    parts.append(prism("bc_drip", [(0.1, 0.12), (0.14, 0.12), (0.13, 0.03), (0.115, 0.07), (0.105, 0.02)], 0.01,
                       mat("blood_dry"), y0=-0.026))
    parts.append(box("bc_guard", (0.2, 0.065, 0.05), bone, loc=(0.02, 0, 0.0), bevel=0.012))
    parts.append(cyl("bc_grip", 0.032, 0.2, mat("leather_red"), loc=(0, 0, -0.2)))
    for i, z in enumerate((-0.18, -0.13, -0.08, -0.03)):
        parts.append(torus("bc_wrap%d" % i, 0.034, 0.008, mat("thread"), loc=(0, 0, z), segs=12, rsegs=4))
    parts.append(sphere("bc_pommel", 0.052, bone, loc=(0, 0, -0.22), segs=10, rings=6))
    return group("bone_cleaver", parts)


def m_reaper_scythe(haft=1.1):
    """Long curved scythe: dark blade sweeping back from the top of the haft, stitched grip."""
    steel, steel_d = mat("steel"), mat("steel_dark")
    top = haft * 0.5
    parts = [cyl("rs_haft", 0.046, haft, mat("wood_dark"), loc=(0, 0, -haft * 0.5))]
    for i in range(5):
        parts.append(torus("rs_wrap%d" % i, 0.05, 0.012, mat("thread"), loc=(0, 0, -0.32 + i * 0.06), segs=12,
                           rsegs=4))
    parts.append(cyl("rs_collar", 0.066, 0.12, mat("bone_w"), loc=(0, 0, top - 0.08), r_top=0.052))
    R = 0.62
    blade = crescent_pts(R, 92, 166, 0.03, 0.17)
    parts.append(prism("rs_blade", blade, 0.04, steel_d, loc=(0, 0, top - R + 0.02), bevel=0.006))
    edge = crescent_pts(R - 0.05, 98, 160, 0.0, 0.07)
    parts.append(prism("rs_edge", edge, 0.04, steel, loc=(0, 0, top - R + 0.02), y0=-0.003))
    for i, a in enumerate((0.0, 0.02)):
        parts.append(torus("rs_stitch%d" % i, 0.05, 0.006, mat("thread"), loc=(0, 0, top - 0.1 + 0.05 * i), segs=10,
                           rsegs=4))
    parts.append(prism("rs_rag", [(0.0, 0.0), (0.05, -0.02), (0.07, -0.16), (0.03, -0.13), (0.01, -0.2),
                                  (-0.02, -0.1)], 0.012, mat("cloth_red"), loc=(0.03, -0.042, top - 0.1)))
    parts.append(cone("rs_butt", 0.04, 0.0, 0.07, mat("iron"), loc=(0, 0, -haft * 0.5), rot=(180, 0, 0), segs=8))
    return group("reaper_scythe", parts)


def m_stitch_needle(length=1.15):
    """Spear-length sewing needle, thread-wrapped grip, red thread trailing from the eye."""
    steel, thread = mat("steel"), mat("thread")
    parts = [cone("sn_shaft", 0.05, 0.0, length, steel, loc=(0, 0, 0.1), segs=10)]
    parts.append(box("sn_head", (0.13, 0.04, 0.16), steel, loc=(0, 0, 0.05), bevel=0.012))
    parts.append(torus("sn_eye", 0.05, 0.017, mat("steel_dark"), loc=(0, -0.03, 0.05), rot=(90, 0, 0), segs=14,
                       rsegs=5, scale=(0.8, 1, 1.35)))
    parts.append(cyl("sn_grip", 0.058, 0.22, mat("leather_red"), loc=(0, 0, 0.3), r_top=0.054))
    for i in range(4):
        parts.append(torus("sn_wrap%d" % i, 0.06, 0.012, thread, loc=(0, 0, 0.33 + 0.055 * i), segs=12, rsegs=4))
    path = [(0.0, -0.04, 0.05), (-0.09, -0.06, -0.03), (-0.04, -0.05, -0.12), (0.08, -0.06, -0.14),
            (0.1, -0.05, -0.23), (-0.02, -0.06, -0.27)]
    parts.append(tube("sn_thread", catmull(path, 4), 0.022, thread, segs=6))
    parts.append(sphere("sn_knot", 0.036, thread, loc=(-0.02, -0.06, -0.27), segs=8, rings=5))
    return group("stitch_needle", parts)


def m_widow_fang(tag="wf", mirror=False):
    """One curved black-bone fang dagger.  The blade curves toward +X (-X when mirrored)."""
    bone_b, bone = mat("bone_black"), mat("bone_w")
    R = 0.34
    sg = -1.0 if mirror else 1.0
    pts = [(sg * x, z) for x, z in crescent_pts(R, 180, 100, 0.0, 0.11, taper=1.15)]
    parts = [prism(tag + "_blade", pts, 0.045, bone_b, loc=(sg * R, 0, 0.03), bevel=0.006)]
    ridge = [(sg * x, z) for x, z in crescent_pts(R - 0.02, 178, 112, 0.0, 0.04, taper=1.1)]
    parts.append(prism(tag + "_ridge", ridge, 0.052, mat("steel_dark"), loc=(sg * R, 0, 0.03), y0=-0.002))
    parts.append(torus(tag + "_guard", 0.05, 0.02, bone, loc=(0.0, 0, 0.0), segs=12, rsegs=5, scale=(1.25, 1, 0.8)))
    parts.append(cyl(tag + "_grip", 0.03, 0.15, mat("blood_dry"), loc=(0, 0, -0.15)))
    for i, z in enumerate((-0.12, -0.07, -0.02)):
        parts.append(torus("%s_wrap%d" % (tag, i), 0.032, 0.009, mat("thread"), loc=(0, 0, z), segs=10, rsegs=4))
    parts.append(sphere(tag + "_pom", 0.042, bone, loc=(0, 0, -0.17), segs=8, rings=6))
    return group(tag, parts)


def m_coffin_lid():
    """Narrow coffin lid with iron straps, used as a shield (faces -Y)."""
    wood, wood_l = mat("wood_dark"), mat("wood")
    outline = [(-0.13, 0.5), (0.13, 0.5), (0.24, 0.2), (0.15, -0.5), (-0.15, -0.5), (-0.24, 0.2)]
    inner = [(-0.095, 0.44), (0.095, 0.44), (0.19, 0.18), (0.115, -0.44), (-0.115, -0.44), (-0.19, 0.18)]
    parts = [prism("cl_board", outline, 0.07, wood, bevel=0.012),
             prism("cl_panel", inner, 0.02, wood_l, y0=-0.04)]
    for i, (z, w) in enumerate(((0.3, 0.46), (-0.02, 0.36), (-0.34, 0.3))):
        parts.append(box("cl_strap%d" % i, (w, 0.09, 0.07), mat("steel_dark"), loc=(0, -0.003, z), bevel=0.01))
        for sx in (-1, 1):
            parts.append(sphere("cl_rivet%d_%d" % (i, sx), 0.021, mat("steel"), loc=(sx * (w / 2 - 0.035), -0.05, z),
                                segs=8, rings=5))
    bone = mat("bone_w")
    parts.append(box("cl_cross_v", (0.05, 0.03, 0.26), bone, loc=(0, -0.058, 0.07), bevel=0.008))
    parts.append(box("cl_cross_h", (0.17, 0.03, 0.05), bone, loc=(0, -0.058, 0.13), bevel=0.008))
    parts.append(sphere("cl_core", 0.02, glow("#4fe3ff"), loc=(0, -0.078, 0.13), segs=8, rings=5))
    parts.append(prism("cl_crack", [(0.03, -0.1), (0.07, -0.18), (0.055, -0.26), (0.09, -0.36), (0.07, -0.37),
                                   (0.04, -0.28), (0.05, -0.18), (0.015, -0.1)], 0.01, mat("black"), y0=-0.036))
    return group("coffin_lid", parts)


def m_marrow_bow(string_r=0.016, curve=1.25, thick=1.15):
    """Bow of ribs and sinew: bone limbs studded with rib knobs, red sinew string (like m_hunter_bow)."""
    up = [(0.0, 0.0), (-0.03, 0.15), (-0.09, 0.3), (-0.15, 0.43), (-0.19, 0.53), (-0.2, 0.58),
          (-0.185, 0.64), (-0.145, 0.68)]
    up = [(x * curve, z) for x, z in up]
    curve_pts = [Vector((x, 0, -z)) for x, z in reversed(up[1:])] + [Vector((x, 0, z)) for x, z in up]
    pts = catmull(curve_pts, per=4)
    n = len(pts)
    radii = []
    for i in range(n):
        s = abs(i - (n - 1) / 2) / ((n - 1) / 2)
        radii.append((0.05 * (1 - s) + 0.02 * s) * thick)
    bone = mat("bone_w")
    parts = [tube("mb_limbs", pts, radii, bone, segs=8)]
    for i in range(3, n - 2, 4):                      # rib knobs along both limbs
        rr = radii[i] * 1.0
        parts.append(sphere("mb_knob%d" % i, rr * 1.15, mat("bone"), loc=pts[i] + Vector((-0.012, -0.02, 0)),
                            segs=8, rings=5))
    parts.append(cyl("mb_grip", 0.056 * thick, 0.18, mat("blood_dry"), loc=(0, 0, -0.09)))
    for z in (-0.07, -0.02, 0.03, 0.08):
        parts.append(torus("mb_wrap", 0.058 * thick, 0.011, mat("thread"), loc=(0, 0, z - 0.0), segs=12, rsegs=4))
    cu = Vector((up[5][0] - 0.012, 0, up[5][1]))
    cd = Vector((cu.x, 0, -cu.z))
    tip_u = Vector((up[-1][0], 0, up[-1][1]))
    tip_d = Vector((tip_u.x, 0, -tip_u.z))
    for i, tp in enumerate((tip_u, tip_d)):
        parts.append(sphere("mb_tip%d" % i, 0.03 * thick, mat("bone"), loc=tp, segs=8, rings=6))
    parts.append(tube("mb_string", [tip_u, cu, cd, tip_d], string_r, mat("thread"), segs=6))
    return group("marrow_bow", parts)


def m_corpse_bomb():
    """Stitched leather sack bulging with bones, tied at the neck, with a burning wick.
    Returns (root, wick_tip) with the wick tip in the root's space."""
    sack, sack_d = mat("sack"), mat("burlap")
    parts = [sphere("cb_sack", 0.2, sack, loc=(0, 0, 0.2), segs=18, rings=12, scale=(1.0, 0.92, 1.0)),
             sphere("cb_belly", 0.17, sack_d, loc=(0.03, -0.05, 0.14), segs=14, rings=10, scale=(1.0, 0.8, 0.85))]
    # neck + tie + cord tails
    parts.append(cyl("cb_neck", 0.075, 0.1, sack, loc=(0, 0, 0.36), r_top=0.05))
    parts.append(torus("cb_tie", 0.062, 0.017, mat("thread"), loc=(0, 0, 0.38), segs=12, rsegs=5))
    parts.append(prism("cb_tail1", [(0, 0), (0.025, 0), (0.07, -0.1), (0.045, -0.1)], 0.014, mat("thread"),
                       loc=(0.02, -0.07, 0.385)))
    parts.append(prism("cb_tail2", [(0, 0), (-0.025, 0), (-0.08, -0.07), (-0.055, -0.08)], 0.014, mat("thread"),
                       loc=(-0.02, -0.07, 0.385)))
    # bones poking out of the sack
    bone = mat("bone_w")
    for i, (loc, rot, ln) in enumerate(((Vector((0.12, -0.05, 0.3)), (0, 55, 0), 0.17),
                                         (Vector((-0.14, -0.02, 0.22)), (0, -70, 0), 0.18),
                                         (Vector((0.05, -0.15, 0.06)), (-60, 0, 20), 0.14))):
        parts.append(cyl("cb_bone%d" % i, 0.026, ln, bone, loc=loc, rot=rot, segs=7))
        d = Matrix.Rotation(math.radians(rot[1]), 3, "Y") @ Matrix.Rotation(math.radians(rot[0]), 3, "X") @ Vector((0, 0, ln))
        for sx in (-0.012, 0.03):
            parts.append(sphere("cb_knob%d_%d" % (i, int(sx * 1000)), 0.036, bone, loc=loc + d + Vector((0, sx, 0)),
                                segs=8, rings=5))
    # stitched seam down the front
    seam = [(0.01, -0.2, 0.36), (0.015, -0.195, 0.28), (0.01, -0.2, 0.2), (0.015, -0.195, 0.12), (0.01, -0.185, 0.06)]
    parts.append(tube("cb_seam", catmull(seam, 3), 0.012, mat("blood_dry"), segs=5))
    for i, z in enumerate((0.33, 0.27, 0.21, 0.15, 0.09)):
        for sg in (-1, 1):
            parts.append(box("cb_st%d_%d" % (i, sg), (0.075, 0.012, 0.014), mat("thread"),
                             loc=(0.012, -0.203 + 0.003 * abs(z - 0.2), z), rot=(0, sg * 40, 0)))
    # wick
    wick = [(0.0, 0.0, 0.43), (0.02, 0.0, 0.5), (-0.03, 0.0, 0.56), (-0.08, 0.0, 0.58)]
    parts.append(tube("cb_wick", catmull(wick, 3), 0.014, mat("straw"), segs=6))
    return group("corpse_bomb", parts), Vector((-0.08, 0.0, 0.58))


def m_bone_spikes():
    """Cluster of three bone spikes erupting from a chunk of floor."""
    bone, blood = mat("bone_w"), mat("blood_dry")
    parts = [cyl("bs_floor", 0.3, 0.06, mat("iron_dark"), segs=10, depth_scale=0.7)]
    for i, (x, y, ang, h, r) in enumerate(((0.0, 0.07, -3, 0.66, 0.1), (-0.22, -0.05, -17, 0.46, 0.085),
                                           (0.22, -0.06, 19, 0.42, 0.08))):
        a = math.radians(ang)
        parts.append(cone("bs_spike%d" % i, r, 0.0, h, bone, loc=(x, y, 0.03), rot=(0, ang, 0), segs=7))
        f = 0.6
        parts.append(cone("bs_tip%d" % i, r * (1 - f) * 1.12, 0.0, h * (1 - f) + 0.01, blood,
                          loc=(x + math.sin(a) * h * f, y, 0.03 + math.cos(a) * h * f), rot=(0, ang, 0), segs=7))
        parts.append(torus("bs_base%d" % i, r * 0.85, r * 0.3, mat("bone"), loc=(x, y, 0.05), segs=10, rsegs=5))
    for i, (x, y, s) in enumerate(((-0.37, 0.0, 0.8), (0.37, 0.0, 0.7), (0.05, -0.2, 0.7))):
        parts.append(rocky("bs_rock%d" % i, 0.06 * s, mat("stone_dark"), seed=i + 2, loc=(x, y, 0.05), subdiv=1))
    return group("bone_spikes", parts)


def m_soul_lantern():
    """Small iron lantern with a cyan soul flame.  Flame objects are returned separately."""
    iron, iron_d = mat("iron"), mat("iron_dark")
    parts = [cyl("sl_base", 0.15, 0.05, iron_d, loc=(0, 0, 0.0), r_top=0.12, segs=10),
             cyl("sl_floor", 0.13, 0.03, iron, loc=(0, 0, 0.05), segs=10),
             cyl("sl_glass", 0.115, 0.34, glow("#2a8cc8"), loc=(0, 0, 0.08), r_top=0.125, segs=10),
             cyl("sl_cap", 0.17, 0.04, iron, loc=(0, 0, 0.42), segs=10),
             cone("sl_roof", 0.17, 0.05, 0.12, iron_d, loc=(0, 0, 0.46), segs=10),
             torus("sl_ring", 0.07, 0.015, iron, loc=(0, 0, 0.64), rot=(90, 0, 0), segs=14, rsegs=5),
             sphere("sl_knob", 0.028, iron, loc=(0, 0, 0.59), segs=8, rings=5)]
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.3
        parts.append(cyl("sl_bar%d" % i, 0.014, 0.35, iron, loc=(0.13 * math.cos(a), 0.13 * math.sin(a), 0.08), segs=6))
    for z in (0.15, 0.3):
        parts.append(torus("sl_band%d" % int(z * 10), 0.124, 0.011, iron_d, loc=(0, 0, z), segs=14, rsegs=4))
    return group("soul_lantern", parts)


def m_chain_hook():
    """Rusted hook on a coiled chain.  Hook up, chain looping below."""
    rust, iron = mat("rust"), mat("iron")
    hp = [(0.0, 0, 0.0), (0.0, 0, 0.18), (0.0, 0, 0.3), (0.08, 0, 0.44), (0.21, 0, 0.48), (0.29, 0, 0.38),
          (0.27, 0, 0.26), (0.18, 0, 0.2)]
    hpts = catmull(hp, 4)
    nh = len(hpts)
    radii = [0.062 - 0.05 * max(0.0, (i / (nh - 1) - 0.6) / 0.4) ** 1.2 for i in range(nh)]
    parts = [tube("ch_hook", hpts, radii, rust, segs=7, caps=False)]
    parts.append(cone("ch_barb", 0.06, 0.0, 0.14, rust, loc=(0.18, 0, 0.2), rot=(0, -35, 0), segs=6))
    parts.append(torus("ch_eye", 0.075, 0.024, iron, loc=(0.0, 0, -0.07), rot=(90, 0, 0), segs=12, rsegs=5))
    parts.append(cyl("ch_collar", 0.07, 0.09, iron, loc=(0, 0, -0.01), segs=8))
    # coiled chain: links laid along a loop hanging from the eye
    n = 8
    cr = 0.26
    cx, cz = 0.0, -0.58
    for i in range(n):
        a = math.radians(95 + 330 * i / (n - 1))
        p = Vector((cx + cr * math.cos(a), 0.0, cz + cr * math.sin(a)))
        tang = Vector((-math.sin(a), 0.0, math.cos(a)))
        parts += chain("ch_l%d" % i, 1, 0.19, iron, start=p - tang * 0.095, direction=tang, r_wire=0.032,
                       twist0=0 if i % 2 == 0 else 90, width_ratio=0.62)
    hook = group("ch_hookg", parts[:4], scale=1.6)
    return group("chain_hook", [hook] + parts[4:])


def m_golem_head():
    """Rag golem bust for the codex icon: burlap head, red yarn hair and braids, cyan button eyes, stitched smile
    (faces -Y, toward the camera)."""
    burlap, burlap_l = mat("burlap"), mat("sack")
    yarn, yarn_d = mat("yarn"), mat("blood_dry")
    dark = mat("blood_dry")
    cyan, hot = glow("#4fe3ff"), glow("#e6fdff")
    parts = [sphere("gh_skull", 0.4, burlap, loc=(0, 0, 0.4), segs=18, rings=12, scale=(1.0, 0.95, 0.95)),
             sphere("gh_body", 0.36, burlap_l, loc=(0, 0.02, -0.18), segs=14, rings=10, scale=(1.35, 0.8, 0.7)),
             torus("gh_collar", 0.2, 0.05, mat("bone"), loc=(0, 0, 0.03), segs=14, rsegs=5, scale=(1, 0.9, 1))]
    # yarn hair: cap, fringe, braids with a bow
    parts.append(sphere("gh_cap", 0.43, yarn, loc=(0, 0.03, 0.55), segs=16, rings=10, scale=(1.0, 0.95, 0.62)))
    parts.append(sphere("gh_fringe", 0.3, yarn, loc=(0, -0.2, 0.72), segs=12, rings=8, scale=(1.3, 0.5, 0.35)))
    for i, x in enumerate((-0.27, -0.09, 0.09, 0.27)):
        parts.append(sphere("gh_bang%d" % i, 0.08, yarn if i % 2 else yarn_d, loc=(x, -0.3, 0.62), segs=8, rings=6,
                            scale=(1, 0.8, 1.7)))
    for sx in (-1, 1):
        for k, z in enumerate((0.3, 0.05, -0.2)):
            parts.append(sphere("gh_braid%d_%d" % (sx, k), 0.15, yarn if k % 2 == 0 else yarn_d, loc=(sx * 0.46, 0.02, z),
                                segs=10, rings=8, scale=(1, 1, 1.25)))
        parts.append(torus("gh_tie%d" % sx, 0.12, 0.03, mat("thread"), loc=(sx * 0.46, 0.02, -0.33), segs=12, rsegs=5))
    # button eyes: one big, one small (mismatched), glowing cyan
    for nm, x, rad in (("a", -0.15, 0.125), ("b", 0.16, 0.088)):
        parts.append(torus("gh_ring" + nm, rad + 0.015, 0.025, mat("brass"), loc=(x, -0.375, 0.45), rot=(90, 0, 0), segs=16, rsegs=5))
        parts.append(cyl("gh_eye" + nm, rad * 0.9, 0.06, cyan, loc=(x, -0.37, 0.45), rot=(90, 0, 0), segs=14))
        parts.append(sphere("gh_hot" + nm, rad * 0.4, hot, loc=(x - rad * 0.2, -0.43, 0.48), segs=8, rings=5))
    # nose + stitched smile + cheek patch
    parts.append(sphere("gh_nose", 0.06, mat("sack"), loc=(0.0, -0.4, 0.33), segs=8, rings=6))
    sm = [(-0.2, -0.375, 0.2), (-0.1, -0.395, 0.15), (0.0, -0.4, 0.135), (0.1, -0.395, 0.15), (0.2, -0.375, 0.2)]
    parts.append(tube("gh_smile", sm, 0.016, dark, segs=5))
    for i, (x, z) in enumerate(((-0.14, 0.17), (0.0, 0.155), (0.14, 0.17))):
        parts.append(box("gh_tick%d" % i, (0.02, 0.02, 0.09), dark, loc=(x, -0.4, z + 0.01)))
    parts.append(sphere("gh_patch", 0.1, mat("flesh_pale"), loc=(-0.3, -0.27, 0.27), segs=10, rings=6, scale=(1, 0.3, 1)))
    parts.append(torus("gh_patch_st", 0.09, 0.012, dark, loc=(-0.3, -0.31, 0.27), rot=(90, 0, 0), segs=14, rsegs=4))
    return group("golem_head", parts)


# --------------------------------------------------------------------------
# CONTENT4 (docs/CONTENT4.md 5.1-5.3): 14 normal weapons, 8 normal skills, 20 uniques, bell shard, stash.
# Same conventions as above (weapons along +Z, hilt at the origin).  Normal items are plain steel / wood /
# leather; uniques carry the bone / blood-red thread / cyan ember motifs.

PAL.update({
    "red_enamel": ("#c8283a", "#6a1030", "#ff6a70", True),
    "yellow_enamel": ("#e8c43a", "#8a6a20", "#fff09a", True),
    "dirt": ("#6e4a32", "#33211f", "#946a46", False),
    "ice_steel": ("#8fd0ee", "#3a6aa0", "#eefaff", True),
    "storm_a": ("#c4d8ea", "#6c8ab0", "#f4fbff", True),
    "storm_b": ("#7e9cc0", "#3e5478", "#bcd4e8", True),
    "bell_bronze": ("#b07a30", "#52302a", "#e0aa5c", True),
    "bell_dark": ("#7a4e24", "#3a2024", "#a8742e", True),
    "smoke_green": ("#7cc24a", "#3a6a36", "#b8ee7a", False),
    "soul_wood": ("#5a5a7e", "#2a2942", "#8c8cb4", True),
})


def bone_skull(name, s=1.0, eyes="#4fe3ff", loc=(0, 0, 0), rot=(0, 0, 0), glint=1.0):
    """Small skull facing +X (cranium, jaw, two eye sockets with an ember glint)."""
    b, hole = mat("bone_w"), mat("bone_black")
    parts = [sphere(name + "_cran", 0.13, b, loc=(0, 0, 0.13), segs=12, rings=8, scale=(1.0, 0.92, 0.9)),
             sphere(name + "_face", 0.085, mat("bone"), loc=(0.06, 0, 0.07), segs=10, rings=6, scale=(0.9, 0.85, 0.9)),
             box(name + "_jaw", (0.1, 0.14, 0.05), b, loc=(0.065, 0, 0.02), bevel=0.012)]
    for sy in (-1, 1):
        parts.append(sphere(name + "_eye%d" % sy, 0.036, hole, loc=(0.11, sy * 0.05, 0.12), segs=8, rings=5))
        if eyes:
            parts.append(sphere(name + "_ember%d" % sy, 0.016 * glint, glow(eyes), loc=(0.135, sy * 0.05, 0.125), segs=6, rings=4))
    parts.append(box(name + "_nose", (0.03, 0.03, 0.04), hole, loc=(0.145, 0, 0.075)))
    return group(name, parts, loc=loc, rot=rot, scale=s)


def zap_pts(p0, p1, w=0.035, n=5, jitter=0.12, seed=0):
    """Closed XZ polygon of a lightning bolt from p0 to p1 (a tapering zigzag ribbon)."""
    rng = random.Random(seed)
    a, b = Vector((p0[0], p0[1])), Vector((p1[0], p1[1]))
    d = b - a
    nrm = Vector((-d.y, d.x)).normalized()
    mid = []
    for i in range(n + 1):
        t = i / n
        off = 0.0 if i in (0, n) else rng.choice((-1, 1)) * jitter * d.length * rng.uniform(0.6, 1.0)
        mid.append(a + d * t + nrm * off)
    left, right = [], []
    for i, p in enumerate(mid):
        ww = w * (1.0 - 0.6 * i / n)
        left.append((p + nrm * ww)[:])
        right.append((p - nrm * ww)[:])
    return [tuple(p) for p in left] + [tuple(p) for p in reversed(right)]


def zap(name, p0, p1, col, w=0.035, n=5, jitter=0.12, seed=0, y=0.0):
    return prism(name, zap_pts(p0, p1, w, n, jitter, seed), 0.01, glow(col), y0=y)


def moon_pts(R, r, d, n=16):
    """Closed XZ polygon of a crescent opening toward +X: outer circle R at the origin minus a circle r at (d, 0)."""
    x0 = (R * R - r * r + d * d) / (2 * d)
    y0 = math.sqrt(max(0.0, R * R - x0 * x0))
    a0 = math.atan2(y0, x0)
    pt = math.atan2(y0, x0 - d)
    outer = [(R * math.cos(a), R * math.sin(a)) for a in (a0 + (2 * math.pi - 2 * a0) * i / n for i in range(n + 1))]
    inner = [(d + r * math.cos(p), r * math.sin(p)) for p in ((2 * math.pi - pt) - (2 * math.pi - 2 * pt) * i / n
                                                              for i in range(n + 1))]
    return outer + inner[1:-1]


def bow_model(tag, limb, grip, tip, string, curve=1.25, thick=1.15, wrap=None, string_r=0.016, knobs=None):
    """Recurve bow facing +X (see m_hunter_bow) with caller-chosen materials.
    Returns (root, upper tip, lower tip) with the tips in root space."""
    up = [(0.0, 0.0), (-0.03, 0.15), (-0.09, 0.3), (-0.15, 0.43), (-0.19, 0.53), (-0.2, 0.58),
          (-0.185, 0.64), (-0.145, 0.68)]
    up = [(x * curve, z) for x, z in up]
    curve_pts = [Vector((x, 0, -z)) for x, z in reversed(up[1:])] + [Vector((x, 0, z)) for x, z in up]
    pts = catmull(curve_pts, per=4)
    n = len(pts)
    radii = []
    for i in range(n):
        s = abs(i - (n - 1) / 2) / ((n - 1) / 2)
        radii.append((0.05 * (1 - s) + 0.02 * s) * thick)
    parts = [tube(tag + "_limbs", pts, radii, limb, segs=8)]
    parts.append(cyl(tag + "_grip", 0.056 * thick, 0.18, grip, loc=(0, 0, -0.09)))
    for z in (-0.07, -0.02, 0.03, 0.08):
        parts.append(torus(tag + "_wrap", 0.058 * thick, 0.011, wrap or grip, loc=(0, 0, z), segs=12, rsegs=4))
    if knobs:
        for i in range(3, n - 2, 4):
            parts.append(sphere("%s_knob%d" % (tag, i), radii[i] * 1.15, knobs, loc=pts[i] + Vector((-0.012, -0.02, 0)),
                                segs=8, rings=5))
    cu = Vector((up[5][0] - 0.012, 0, up[5][1]))
    cd = Vector((cu.x, 0, -cu.z))
    tip_u = Vector((up[-1][0], 0, up[-1][1]))
    tip_d = Vector((tip_u.x, 0, -tip_u.z))
    for i, tp in enumerate((tip_u, tip_d)):
        parts.append(sphere("%s_tip%d" % (tag, i), 0.028 * thick, tip, loc=tp, segs=8, rings=6))
    parts.append(tube(tag + "_string", [tip_u, cu, cd, tip_d], string_r, string, segs=6))
    return group(tag, parts), tip_u, tip_d


# ---- 14 normal weapons ---------------------------------------------------------------------------------------

def m_broadsword():
    """Plain two-handed broadsword: very wide parallel blade, straight iron cross, long wrapped grip."""
    st, sd = mat("steel"), mat("steel_dark")
    stations = [(0.04, 0.105, 0.105), (0.72, 0.11, 0.11), (0.84, 0.105, 0.105), (0.92, 0.08, 0.08),
                (0.98, 0.045, 0.045), (1.03, 0.0, 0.0)]
    parts = [ridged_blade("bsw_blade", stations, st, sd, t=0.034)]
    parts.append(box("bsw_guard", (0.5, 0.085, 0.065), mat("iron"), loc=(0, 0, 0.0), bevel=0.014))
    for sx in (-1, 1):
        parts.append(sphere("bsw_cap%d" % sx, 0.05, mat("iron_dark"), loc=(sx * 0.25, 0, 0.0), segs=8, rings=6))
    parts.append(cyl("bsw_grip", 0.034, 0.34, mat("leather"), loc=(0, 0, -0.38)))
    for i in range(6):
        parts.append(torus("bsw_wrap%d" % i, 0.036, 0.008, mat("wood_dark"), loc=(0, 0, -0.35 + 0.055 * i), segs=12, rsegs=4))
    parts.append(sphere("bsw_pommel", 0.058, mat("iron"), loc=(0, 0, -0.42)))
    return group("broadsword", parts)


def m_frantic_sword():
    """Jagged saw-toothed sword with a bat-wing guard and a blood-stained red grip."""
    st, sd = mat("steel"), mat("steel_dark")
    stations = [(0.02, 0.06, 0.06), (0.14, 0.06, 0.055)]
    for i in range(5):
        z0 = 0.16 + i * 0.125
        stations += [(z0, 0.05, 0.05), (z0 + 0.012, 0.125 - 0.008 * i, 0.05), (z0 + 0.1, 0.05, 0.047)]
    stations += [(0.82, 0.04, 0.04), (0.98, 0.0, 0.0)]
    parts = [ridged_blade("fs_blade", stations, st, sd, t=0.024)]
    for i, (x, z, s) in enumerate([(0.012, 0.3, 1.0), (0.012, 0.52, 0.8), (0.012, 0.7, 0.7)]):
        parts.append(ellipsoid("fs_blood%d" % i, (0.04 * s, 0.012, 0.09 * s), mat("blood_dry"), loc=(x, -0.028, z)))
    wing = [(-0.22, 0.1), (-0.14, 0.02), (0.0, 0.0), (0.14, 0.02), (0.22, 0.1), (0.18, -0.02),
            (0.07, -0.05), (-0.07, -0.05), (-0.18, -0.02)]
    parts.append(prism("fs_guard", wing, 0.07, mat("iron_dark"), bevel=0.008))
    parts.append(cyl("fs_grip", 0.032, 0.2, mat("leather_red"), loc=(0, 0, -0.22)))
    for i in range(4):
        parts.append(torus("fs_wrap%d" % i, 0.034, 0.008, mat("thread"), loc=(0, 0, -0.2 + 0.05 * i), segs=12, rsegs=4))
    parts.append(cone("fs_pommel", 0.05, 0.0, 0.1, mat("iron_dark"), loc=(0, 0, -0.22), rot=(180, 0, 0)))
    return group("frantic_sword", parts)


def m_rapier():
    """Long thin blade, brass cup guard with a knuckle bow, red-leather grip."""
    st, sd, brass = mat("steel"), mat("steel_dark"), mat("brass")
    stations = [(0.02, 0.036, 0.036), (0.2, 0.034, 0.034), (0.95, 0.018, 0.018), (1.1, 0.0, 0.0)]
    parts = [ridged_blade("rp_blade", stations, st, sd, t=0.016)]
    parts.append(lathe("rp_cup", [(0.0, -0.04), (0.06, -0.035), (0.115, 0.0), (0.145, 0.05), (0.15, 0.1), (0.0, 0.1)],
                       brass, segs=18))
    parts.append(cyl("rp_cross", 0.017, 0.46, brass, loc=(-0.23, 0, 0.0), rot=(0, 90, 0), segs=8))
    for sx in (-1, 1):
        parts.append(sphere("rp_cross%d" % sx, 0.03, brass, loc=(sx * 0.23, 0, 0.0), segs=8, rings=5))
    bow = [(0.2, 0, 0.0), (0.2, 0, -0.1), (0.14, 0, -0.2), (0.03, 0, -0.27)]
    parts.append(tube("rp_bow", catmull(bow, 4), 0.016, brass, segs=6))
    parts.append(cyl("rp_grip", 0.028, 0.22, mat("leather_red"), loc=(0, 0, -0.26)))
    for i in range(4):
        parts.append(torus("rp_wrap%d" % i, 0.03, 0.007, mat("gold"), loc=(0, 0, -0.24 + 0.05 * i), segs=10, rsegs=4))
    parts.append(sphere("rp_pommel", 0.05, brass, loc=(0, 0, -0.29), segs=10, rings=6))
    return group("rapier", parts)


def m_sadist_stiletto():
    """Needle-thin triangular blade with barbed hooks along one edge, black grip, a bead of blood on the point."""
    st, sd = mat("steel"), mat("steel_dark")
    stations = [(0.02, 0.034, 0.034), (0.14, 0.034, 0.034), (0.62, 0.014, 0.014), (0.8, 0.0, 0.0)]
    parts = [ridged_blade("sd_blade", stations, st, sd, t=0.02)]
    for i, z in enumerate((0.26, 0.4, 0.54)):
        w = 0.034 - 0.02 * (z - 0.14) / 0.48
        parts.append(cone("sd_barb%d" % i, 0.03, 0.0, 0.11, st, loc=(-w, 0, z + 0.04), rot=(0, -125, 0), segs=5))
    parts.append(cyl("sd_guard", 0.075, 0.03, mat("iron_dark"), loc=(0, 0, -0.01), segs=10, depth_scale=0.5))
    parts.append(cyl("sd_grip", 0.03, 0.2, mat("bone_black"), loc=(0, 0, -0.23)))
    for i in range(4):
        parts.append(torus("sd_wrap%d" % i, 0.032, 0.008, mat("thread"), loc=(0, 0, -0.2 + 0.05 * i), segs=10, rsegs=4))
    parts.append(cone("sd_pommel", 0.045, 0.0, 0.09, mat("iron_dark"), loc=(0, 0, -0.23), rot=(180, 0, 0), segs=6))
    parts.append(sphere("sd_drop", 0.032, glow("#ff3a55"), loc=(-0.012, -0.02, 0.8), segs=8, rings=5, scale=(1, 1, 1.3)))
    return group("sadist_stiletto", parts)


def m_grave_shovel():
    """Gravedigger's shovel: T-grip, wooden haft, broad steel spade with a lump of grave dirt and a bone sliver."""
    haft = 0.9
    parts = [cyl("gs_haft", 0.036, haft, mat("wood_light"), loc=(0, 0, 0.0))]
    parts.append(box("gs_grip", (0.26, 0.055, 0.055), mat("wood_dark"), loc=(0, 0, 0.0), bevel=0.012))
    for sx in (-1, 1):
        parts.append(sphere("gs_gripcap%d" % sx, 0.04, mat("iron"), loc=(sx * 0.13, 0, 0.0), segs=8, rings=5))
    parts.append(cyl("gs_cuff", 0.052, 0.14, mat("iron"), loc=(0, 0, haft - 0.02), r_top=0.045))
    spade = [(-0.05, 0.98), (-0.12, 1.02), (-0.21, 1.1), (-0.23, 1.32), (-0.14, 1.52), (0.0, 1.64), (0.14, 1.52),
             (0.23, 1.32), (0.21, 1.1), (0.12, 1.02), (0.05, 0.98)]
    parts.append(prism("gs_spade", spade, 0.034, mat("iron_dark"), bevel=0.01))
    face = [(-0.04, 1.02), (-0.17, 1.12), (-0.19, 1.31), (-0.11, 1.49), (0.0, 1.58), (0.11, 1.49), (0.19, 1.31),
            (0.17, 1.12), (0.04, 1.02)]
    parts.append(prism("gs_face", face, 0.036, mat("steel"), y0=-0.004))
    parts.append(box("gs_rib", (0.05, 0.04, 0.46), mat("steel_dark"), loc=(0.0, -0.02, 1.3)))
    parts.append(box("gs_step", (0.34, 0.07, 0.04), mat("iron"), loc=(0, 0, 1.06), bevel=0.01))
    parts.append(sphere("gs_dirt", 0.085, mat("dirt"), loc=(0.1, -0.04, 1.5), segs=8, rings=6, scale=(1.3, 0.6, 0.9)))
    parts.append(sphere("gs_dirt2", 0.05, mat("dirt"), loc=(-0.11, -0.045, 1.2), segs=8, rings=6, scale=(1.2, 0.6, 0.9)))
    parts.append(cyl("gs_bone", 0.018, 0.13, mat("bone_w"), loc=(0.1, -0.06, 1.38), rot=(0, 50, 0), segs=6))
    return group("grave_shovel", parts)


def m_torch():
    """Wooden stave with a rag-wrapped, tar-soaked head (the flame is added by the icon)."""
    parts = [cyl("tc_haft", 0.034, 0.74, mat("wood"), loc=(0, 0, -0.1), r_top=0.045)]
    parts.append(cyl("tc_head", 0.1, 0.2, mat("burlap"), loc=(0, 0, 0.56), r_top=0.13, segs=12))
    parts.append(sphere("tc_top", 0.12, mat("sack"), loc=(0, 0, 0.77), segs=12, rings=8, scale=(1, 1, 0.55)))
    for z in (0.6, 0.7):
        parts.append(torus("tc_band%d" % int(z * 10), 0.115 + (z - 0.6) * 0.3, 0.014, mat("iron_dark"),
                           loc=(0, 0, z), segs=14, rsegs=4))
    for i, (x, z) in enumerate(((-0.06, 0.64), (0.07, 0.72), (0.0, 0.8))):
        parts.append(sphere("tc_ember%d" % i, 0.03, glow("#ff8a1e"), loc=(x, -0.1, z), segs=6, rings=4))
    parts.append(torus("tc_wrap", 0.04, 0.012, mat("leather"), loc=(0, 0, 0.1), segs=10, rsegs=4))
    parts.append(torus("tc_wrap2", 0.04, 0.012, mat("leather"), loc=(0, 0, 0.0), segs=10, rsegs=4))
    return group("torch", parts)


def m_leather_whip():
    """Wrapped wooden handle with a long leather lash thrown into a loop with a flicking tip."""
    parts = [cyl("lw_handle", 0.04, 0.42, mat("wood_dark"), loc=(0, 0, -0.2))]
    for i in range(6):
        parts.append(torus("lw_wrap%d" % i, 0.043, 0.01, mat("leather"), loc=(0, 0, -0.16 + 0.055 * i), segs=10, rsegs=4))
    parts.append(sphere("lw_cap", 0.052, mat("brass"), loc=(0, 0, -0.21), segs=8, rings=6))
    path = [(0.0, 0.2), (0.0, 0.36), (0.1, 0.52), (0.26, 0.6), (0.44, 0.56), (0.5, 0.4), (0.4, 0.27), (0.25, 0.3),
            (0.2, 0.46), (0.32, 0.58), (0.52, 0.64), (0.7, 0.58), (0.78, 0.42)]
    pts = [Vector((x, -0.015 * i, z)) for i, (x, z) in enumerate(path)]
    cur = catmull(pts, per=5)
    n = len(cur)
    radii = [0.045 - 0.032 * (i / (n - 1)) ** 0.8 for i in range(n)]
    parts.append(tube("lw_lash", cur, radii, mat("leather"), segs=7))
    parts.append(tube("lw_tip", [cur[-1], cur[-1] + Vector((0.07, 0, -0.1))], [0.013, 0.006], mat("cloth_cream"), segs=5))
    return group("leather_whip", parts)


def m_iron_katana():
    """Single-edged curved blade (hamon edge strip), round iron tsuba, red cord-wrapped hilt."""
    L_ = 1.0
    N = 14

    def xc(z):
        return 0.16 * (z / L_) ** 2

    def width(z, side):
        u = z / L_
        base = 0.056 if side < 0 else 0.04
        return base * (1.0 - u ** 6) if u < 0.93 else base * max(0.0, (1.0 - u) / 0.07) * 0.9
    left = [(xc(z) - width(z, -1), z) for z in [0.02 + (L_ - 0.02) * i / N for i in range(N + 1)]]
    right = [(xc(z) + width(z, 1), z) for z in [0.02 + (L_ - 0.02) * i / N for i in range(N + 1)]]
    tip = (xc(L_ + 0.02) + 0.0, L_ + 0.02)
    body = left + [tip] + list(reversed(right))
    parts = [prism("ik_blade", body, 0.026, mat("steel_dark"))]
    mid = [(xc(z) - width(z, -1) * 0.1, z) for z in [0.02 + (L_ - 0.02) * i / N for i in range(N + 1)]]
    edge = left + [tip] + list(reversed(mid))
    parts.append(prism("ik_edge", edge, 0.03, mat("steel"), y0=-0.004))
    parts.append(cyl("ik_tsuba", 0.095, 0.03, mat("iron_dark"), loc=(0, 0, -0.01), segs=14, depth_scale=0.8))
    parts.append(torus("ik_tsubarim", 0.092, 0.012, mat("brass"), loc=(0, 0, 0.005), segs=14, rsegs=4, scale=(1, 0.8, 1)))
    parts.append(cyl("ik_hilt", 0.034, 0.34, mat("cloth_dark_red"), loc=(0, 0, -0.37)))
    for i in range(7):
        parts.append(torus("ik_wrap%d" % i, 0.037, 0.009, mat("thread"), loc=(0, 0, -0.35 + 0.046 * i), segs=10, rsegs=4))
    parts.append(sphere("ik_kashira", 0.045, mat("brass"), loc=(0, 0, -0.38), segs=10, rings=6))
    return group("iron_katana", parts)


def _arrow_fan(root, tag, nock, angles, length=1.0, **kw):
    """Parent arrows to `root`, all nocked at `nock` (root space) and fanned about the screen-plane axis."""
    out = []
    for i, a in enumerate(angles):
        ar = m_arrow(length=length, **kw)
        ar.location = (length / 2, 0, 0)
        pv = group("%s_pv%d" % (tag, i), [ar], rot=(0, a, 0))
        pv.location = Vector(nock) + Vector((0, -0.012 * i, 0))
        pv.parent = root
        out.append(pv)
    return out


def m_multi_bow():
    """Plain wooden bow with three arrows nocked in a fan (full draw fires all three).  Returns (root, nock)."""
    root, tu, td = bow_model("mu", mat("wood_light"), mat("leather"), mat("iron"), mat("cloth_cream"), curve=1.25,
                             thick=1.2, wrap=mat("wood_dark"))
    nock = Vector((-0.27, 0, 0.0))
    _arrow_fan(root, "mu", nock, (9, 0, -9), length=1.0)
    return root


def m_ice_bow():
    """Frost-blue bow of ice-hardened wood with rime spikes on the limbs, an ice arrow nocked."""
    root, tu, td = bow_model("ib", mat("ice_steel"), mat("leather"), mat("steel"), mat("cloth_cream"), curve=1.25,
                             thick=1.25, wrap=mat("steel_dark"))
    for i, (x, z, a, ln) in enumerate(((-0.2, 0.35, -50, 0.16), (-0.27, 0.52, -70, 0.2), (-0.2, -0.38, -125, 0.16),
                                       (-0.26, -0.55, -105, 0.2), (-0.3, 0.1, -95, 0.12))):
        sp = cone("ib_spike%d" % i, 0.035, 0.0, ln, mat("ice"), loc=(x, -0.03, z), rot=(0, a, 0), segs=5)
        sp.parent = root
    _arrow_fan(root, "ib", Vector((-0.27, 0, 0.0)), (0,), length=1.0, fletch="cloth_cream")
    return root


def m_heavy_crossbow():
    """Heavy steel-prod crossbow, axis along +Z (butt at the origin, prod near the top), three bolts nocked."""
    wood, iron = mat("wood"), mat("iron")
    parts = [box("hc_stock", (0.13, 0.11, 1.05), wood, loc=(0, 0, 0.5), bevel=0.02),
             box("hc_rail", (0.045, 0.05, 0.8), mat("wood_dark"), loc=(0, -0.05, 0.62)),
             box("hc_butt", (0.19, 0.14, 0.07), iron, loc=(0, 0, 0.0), bevel=0.014)]
    for z in (0.3, 0.72):
        parts.append(box("hc_band%d" % int(z * 10), (0.155, 0.13, 0.05), mat("iron_dark"), loc=(0, 0, z), bevel=0.01))
    pz = 0.98
    pts = [Vector((x, 0, pz + 0.22 * (abs(x) / 0.62) ** 2)) for x in (-0.62, -0.46, -0.3, -0.15, 0, 0.15, 0.3, 0.46, 0.62)]
    radii = [0.036, 0.046, 0.056, 0.064, 0.068, 0.064, 0.056, 0.046, 0.036]
    parts.append(tube("hc_prod", catmull(pts, 3), [radii[min(8, i // 3)] for i in range(len(catmull(pts, 3)))],
                      mat("steel_dark"), segs=8))
    for sx in (-1, 1):
        parts.append(box("hc_wrap%d" % sx, (0.05, 0.1, 0.09), iron, loc=(sx * 0.2, 0, pz + 0.03), bevel=0.01))
        parts.append(sphere("hc_tip%d" % sx, 0.04, mat("brass"), loc=(sx * 0.62, 0, pz + 0.22), segs=8, rings=5))
    parts.append(torus("hc_stirrup", 0.1, 0.022, iron, loc=(0, 0, 1.12), rot=(90, 0, 0), segs=14, rsegs=5,
                       scale=(0.85, 1, 1.15)))
    parts.append(tube("hc_string", [Vector((-0.62, 0, pz + 0.22)), Vector((0, 0, 0.52)), Vector((0.62, 0, pz + 0.22))],
                      0.02, mat("cloth_cream"), segs=5))
    parts.append(box("hc_trigger", (0.035, 0.05, 0.14), iron, loc=(0, 0.06, 0.38), bevel=0.008))
    root = group("heavy_crossbow", parts)
    for i, a in enumerate((12, 0, -12)):                    # the spread: three of the five bolts show
        bolt = [cyl("hb%d_shaft" % i, 0.022, 0.62, mat("wood_dark"), loc=(0, 0, 0.0), segs=6),
                cone("hb%d_head" % i, 0.05, 0.0, 0.14, mat("steel"), loc=(0, 0, 0.62), segs=5),
                prism("hb%d_fl" % i, [(0, 0), (0.05, -0.02), (0.05, 0.1), (0, 0.13)], 0.012, mat("cloth_red"),
                      loc=(0, 0, 0.0))]
        bg = group("hb%d" % i, bolt, rot=(0, a, 0))
        bg.location = (0, -0.07 - 0.02 * i, 0.5)
        bg.parent = root
    return root


def m_throwing_knife(tag="tk"):
    """Short leaf-bladed throwing knife: leather grip with a ring pommel, hilt at the origin."""
    st, sd = mat("steel"), mat("steel_dark")
    stations = [(0.02, 0.036, 0.036), (0.12, 0.046, 0.046), (0.22, 0.04, 0.04), (0.3, 0.022, 0.022), (0.38, 0.0, 0.0)]
    parts = [ridged_blade(tag + "_blade", stations, st, sd, t=0.016)]
    parts.append(box(tag + "_guard", (0.1, 0.045, 0.03), mat("iron"), loc=(0, 0, 0.0), bevel=0.008))
    parts.append(cyl(tag + "_grip", 0.026, 0.13, mat("leather"), loc=(0, 0, -0.15)))
    for i in range(3):
        parts.append(torus("%s_wrap%d" % (tag, i), 0.028, 0.007, mat("thread"), loc=(0, 0, -0.13 + 0.04 * i), segs=10, rsegs=4))
    parts.append(torus(tag + "_ring", 0.045, 0.014, mat("iron"), loc=(0, 0, -0.21), rot=(90, 0, 0), segs=12, rsegs=4))
    return group(tag, parts)


def m_fire_staff():
    """Gnarled staff ending in a brass claw cage around a big burning orb (flame tongues are added by the icon)."""
    parts = [cyl("fst_haft", 0.034, 1.1, mat("wood_dark"), loc=(0, 0, -0.35), r_top=0.04)]
    for i, z in enumerate((-0.2, -0.12, 0.45)):
        parts.append(torus("fst_wrap%d" % i, 0.04, 0.011, mat("leather_red"), loc=(0, 0, z), segs=10, rsegs=4))
    parts.append(cyl("fst_collar", 0.07, 0.1, mat("brass"), loc=(0, 0, 0.66), r_top=0.055))
    parts.append(sphere("fst_orb", 0.17, glow("#ff6a1e"), loc=(0, 0, 0.93), segs=14, rings=8))
    parts.append(sphere("fst_core", 0.11, glow("#ffd04a"), loc=(-0.03, -0.1, 0.96), segs=10, rings=6))
    parts.append(sphere("fst_hot", 0.05, glow("#fff6c8"), loc=(-0.05, -0.18, 0.99), segs=8, rings=5))
    for sx in (-1, 1):
        claw = [(sx * 0.04, -0.03, 0.72), (sx * 0.25, -0.03, 0.8), (sx * 0.29, -0.03, 1.0), (sx * 0.17, -0.03, 1.15)]
        cur = catmull(claw, 4)
        parts.append(tube("fst_claw%d" % sx, cur, [0.05 - 0.028 * i / (len(cur) - 1) for i in range(len(cur))],
                          mat("gold"), segs=6))
    return group("fire_staff", parts)


def m_spiked_shield(R=0.4):
    """Round steel buckler bristling with rim spikes, a big central spike and riveted iron straps (faces -Y)."""
    iron, steel, dark = mat("iron"), mat("steel"), mat("iron_dark")
    parts = [lathe("ssh_back", [(0, 0.0), (R, 0.0), (R, 0.05), (0, 0.05)], mat("mortar"), segs=28, rot=(90, 0, 0),
                   loc=(0, 0.04, 0)),
             cyl("ssh_disc", R * 0.97, 0.06, iron, loc=(0, 0.03, 0), rot=(90, 0, 0), segs=28),
             torus("ssh_rim", R, 0.045, steel, rot=(90, 0, 0), segs=36, rsegs=8)]
    for k in range(10):                                    # radial spikes round the rim
        a = 2 * math.pi * k / 10 + 0.15
        parts.append(cone("ssh_spike%d" % k, 0.065, 0.0, 0.2, steel, loc=(R * math.cos(a), -0.03, R * math.sin(a)),
                          rot=(0, 90 - math.degrees(a), 0), segs=6))
    parts.append(box("ssh_barh", (2 * R * 0.92, 0.03, 0.09), dark, loc=(0, -0.05, 0.0), bevel=0.008))
    parts.append(box("ssh_barv", (0.09, 0.03, 2 * R * 0.92), dark, loc=(0, -0.052, 0.0), bevel=0.008))
    parts.append(cone("ssh_boss", 0.14, 0.0, 0.3, steel, loc=(0, -0.06, 0.0), rot=(90, 0, 0), segs=10))
    parts.append(torus("ssh_bossring", 0.14, 0.03, dark, loc=(0, -0.07, 0.0), rot=(90, 0, 0), segs=16, rsegs=5))
    for k in range(4):
        a = math.pi / 4 + math.pi * k / 2
        parts.append(sphere("ssh_rivet%d" % k, 0.03, mat("gold"), loc=(0.26 * math.cos(a), -0.075, 0.26 * math.sin(a)),
                            segs=8, rings=5))
    return group("spiked_shield", parts)


# ---- 8 normal skills ---------------------------------------------------------------------------------------

def m_stun_grenade():
    """Steel flash-bang canister with a yellow band, safety lever and pull ring."""
    st = mat("steel_dark")
    parts = [lathe("sg_body", [(0, 0.0), (0.12, 0.0), (0.145, 0.03), (0.145, 0.33), (0.12, 0.37), (0.075, 0.39), (0, 0.39)],
                   st, segs=16),
             cyl("sg_band", 0.149, 0.09, mat("yellow_enamel"), loc=(0, 0, 0.13), segs=16),
             cyl("sg_band2", 0.149, 0.03, mat("black"), loc=(0, 0, 0.2), segs=16),
             cyl("sg_cap", 0.07, 0.09, mat("iron"), loc=(0, 0, 0.38), r_top=0.055, segs=10),
             box("sg_lever", (0.04, 0.045, 0.34), mat("steel"), loc=(0.15, 0, 0.26), bevel=0.01),
             torus("sg_ring", 0.07, 0.014, mat("brass"), loc=(-0.07, 0, 0.5), segs=12, rsegs=4)]
    parts.append(torus("sg_pin", 0.05, 0.01, mat("brass"), loc=(-0.02, 0, 0.45), rot=(90, 0, 0), segs=10, rsegs=4))
    for i in range(3):
        parts.append(box("sg_vent%d" % i, (0.05, 0.02, 0.012), glow("#fff6c8"), loc=(-0.05 + 0.05 * i, -0.15, 0.3 + 0.01 * i)))
    return group("stun_grenade", parts)


def m_magnet_grenade():
    """Red horseshoe magnet with silver pole tips clamped over a small black bomb."""
    R, th = 0.3, 0.17
    outer = [(math.cos(a) * (R + 0.1), math.sin(a) * (R + 0.1)) for a in (math.pi * i / 14 for i in range(15))]
    inner = [(math.cos(a) * (R - 0.1), math.sin(a) * (R - 0.1)) for a in (math.pi * i / 14 for i in range(14, -1, -1))]
    body = outer + [(-(R + 0.1), -0.3), (-(R - 0.1), -0.3)] + inner + [(R - 0.1, -0.3), (R + 0.1, -0.3)]
    parts = [prism("mg_body", body, th, mat("red_enamel"), bevel=0.012)]
    for sx in (-1, 1):
        parts.append(box("mg_pole%d" % sx, (0.2, th + 0.02, 0.17), mat("steel"), loc=(sx * R, 0, -0.26), bevel=0.012))
        parts.append(box("mg_polestripe%d" % sx, (0.2, th + 0.03, 0.03), mat("steel_dark"), loc=(sx * R, 0, -0.2)))
    parts.append(sphere("mg_bomb", 0.14, mat("black"), loc=(0, 0.02, -0.12), segs=14, rings=8))
    parts.append(sphere("mg_shine", 0.04, mat("steel_dark"), loc=(-0.05, -0.08, -0.07), segs=8, rings=5))
    parts.append(tube("mg_fuse", catmull([(0, 0.02, 0.01), (0.02, 0.02, 0.07), (-0.03, 0.02, 0.1)], 3), 0.012,
                      mat("straw"), segs=5))
    return group("magnet_grenade", parts)


def m_cluster_grenade():
    """Fat grooved iron grenade ringed by four small bomblets."""
    iron, dark = mat("iron"), mat("iron_dark")
    parts = [sphere("cg_body", 0.2, dark, loc=(0, 0, 0.0), segs=16, rings=10, scale=(1, 0.9, 1.1))]
    for z in (-0.1, 0.0, 0.1):
        r = math.sqrt(max(0.0, 0.2 ** 2 - z ** 2 / 1.21)) * 1.0
        parts.append(torus("cg_lat%d" % int(z * 100), r, 0.016, iron, loc=(0, 0, z), segs=16, rsegs=4))
    for a in (0, 60, 120):
        parts.append(torus("cg_mer%d" % a, 0.21, 0.016, iron, rot=(90, 0, a), segs=16, rsegs=4, scale=(1, 1, 1.1)))
    parts.append(cyl("cg_cap", 0.06, 0.08, mat("brass"), loc=(0, 0, 0.2), segs=10))
    parts.append(box("cg_lever", (0.035, 0.04, 0.3), mat("steel"), loc=(0.17, 0, 0.1), bevel=0.008))
    for i, (x, z) in enumerate(((-0.34, 0.26), (0.38, 0.3), (-0.3, -0.27), (0.34, -0.24))):
        parts.append(sphere("cg_bl%d" % i, 0.09, mat("iron"), loc=(x, -0.04, z), segs=10, rings=6))
        parts.append(torus("cg_blband%d" % i, 0.086, 0.012, mat("iron_dark"), loc=(x, -0.04, z), rot=(90, 0, 0),
                           segs=12, rsegs=4))
        parts.append(cyl("cg_blcap%d" % i, 0.03, 0.04, mat("brass"), loc=(x, -0.04, z + 0.07), segs=6))
    return group("cluster_grenade", parts)


def m_tesla_coil():
    """Brass-wound tesla coil on an iron plinth, steel toroid on top (the arcs are added by the icon)."""
    parts = [cyl("tc_base", 0.36, 0.1, mat("iron_dark"), loc=(0, 0, 0.0), r_top=0.3, segs=12),
             cyl("tc_plinth", 0.26, 0.14, mat("iron"), loc=(0, 0, 0.1), r_top=0.2, segs=12),
             cyl("tc_core", 0.17, 0.5, mat("bronze_dark"), loc=(0, 0, 0.24), r_top=0.12, segs=12)]
    for i in range(8):
        z = 0.28 + 0.058 * i
        r = 0.18 - 0.0075 * i
        parts.append(torus("tc_wind%d" % i, r, 0.03, mat("bronze"), loc=(0, 0, z), segs=12, rsegs=5))
    parts.append(torus("tc_topring", 0.17, 0.065, mat("steel"), loc=(0, 0, 0.8), segs=16, rsegs=6))
    parts.append(sphere("tc_ball", 0.16, mat("steel"), loc=(0, 0, 0.86), segs=14, rings=8))
    parts.append(sphere("tc_ballhot", 0.07, glow("#e6fdff"), loc=(0, -0.1, 0.9), segs=8, rings=5))
    for sx in (-1, 1):
        parts.append(box("tc_leg%d" % sx, (0.07, 0.07, 0.2), mat("iron"), loc=(sx * 0.3, 0, 0.08), rot=(0, sx * 20, 0)))
    return group("tesla_coil", parts)


def m_flame_turret():
    """Tripod-mounted brass nozzle fed from a red fuel tank (faces +X; the jet is added by the icon)."""
    iron, brass = mat("iron"), mat("brass")
    P = []
    P.append(box("ft_legl", (0.06, 0.06, 0.42), mat("wood"), loc=(-0.12, 0, -0.24), rot=(0, 25, 0), bevel=0.01))
    P.append(box("ft_legr", (0.06, 0.06, 0.42), mat("wood"), loc=(0.12, 0, -0.24), rot=(0, -25, 0), bevel=0.01))
    P.append(box("ft_legb", (0.06, 0.06, 0.4), mat("wood_dark"), loc=(-0.02, 0.06, -0.24), rot=(0, 5, 0), bevel=0.01))
    P.append(cyl("ft_mount", 0.09, 0.12, iron, loc=(0, 0, -0.04), segs=10))
    P.append(cyl("ft_barrel", 0.065, 0.62, iron, loc=(-0.3, 0, 0.1), rot=(0, 90, 0), segs=10))
    for x in (-0.15, 0.05, 0.2):
        P.append(torus("ft_band%d" % int(x * 100), 0.07, 0.014, brass, loc=(x, 0, 0.1), rot=(0, 90, 0), segs=12, rsegs=4))
    P.append(cone("ft_nozzle", 0.1, 0.055, 0.14, brass, loc=(0.32, 0, 0.1), rot=(0, 90, 0), segs=10))
    P.append(cyl("ft_tank", 0.12, 0.34, mat("red_enamel"), loc=(-0.45, 0.02, 0.42), rot=(0, 90, 0), segs=14))
    for sx in (-0.45, -0.11):
        P.append(sphere("ft_tankend%d" % int(sx * 100), 0.12, mat("red_enamel"), loc=(sx, 0.02, 0.42), segs=12, rings=6,
                        scale=(0.5, 1, 1)))
    for x in (-0.37, -0.19):
        P.append(torus("ft_tankband%d" % int(x * 100), 0.123, 0.018, brass, loc=(x, 0.02, 0.42), rot=(0, 90, 0), segs=14,
                       rsegs=4))
    P.append(cyl("ft_tankcap", 0.04, 0.05, brass, loc=(-0.28, 0.02, 0.52), segs=8))
    P.append(tube("ft_hose", catmull([(-0.12, 0, 0.36), (-0.02, 0, 0.3), (0.02, 0, 0.2), (0.05, 0, 0.14)], 3), 0.022,
                  mat("black"), segs=6))
    P.append(box("ft_pilot", (0.05, 0.05, 0.05), glow("#ffd04a"), loc=(0.1, -0.06, 0.18)))
    return group("flame_turret", P)


def m_wave_of_denial():
    """A palm-sized rune disc releasing three expanding arcs of force (flat glow shapes, face the camera)."""
    parts = [star("wd_core", 0.14, 0.05, 8, glow("#e6fffa")),
             star("wd_core2", 0.09, 0.035, 8, glow("#ffffff"), phase=math.pi / 8, loc=(0, -0.01, 0))]
    for i, (R, w, col) in enumerate(((0.3, 0.08, "#8affc8"), (0.5, 0.075, "#4fd8a0"), (0.7, 0.07, "#2a9c78"))):
        pts = []
        n = 12
        for k in range(n + 1):
            a = math.radians(-52 + 104 * k / n)
            pts.append(((R + w) * math.cos(a), (R + w) * math.sin(a)))
        for k in range(n, -1, -1):
            a = math.radians(-52 + 104 * k / n)
            pts.append(((R - w) * math.cos(a), (R - w) * math.sin(a)))
        parts.append(prism("wd_arc%d" % i, pts, 0.01, glow(col), loc=(0, -0.012 * i, 0)))
    return group("wave_of_denial", parts)


def m_tornado():
    """Funnel of stacked storm-grey rings, widening upward, with debris caught in the spiral."""
    parts = []
    n = 8
    for k in range(n):
        u = k / (n - 1)
        R = 0.07 + 0.42 * u ** 0.85
        x = 0.07 * math.sin(k * 1.2)
        parts.append(torus("tn_ring%d" % k, R, 0.07 + 0.03 * u, mat("storm_a" if k % 2 == 0 else "storm_b"),
                           loc=(x, 0, 0.14 * k), segs=16, rsegs=6, scale=(1, 0.7, 0.55)))
    for i, (x, z, s, m) in enumerate(((0.42, 0.55, 1.0, "wood_light"), (-0.45, 0.9, 0.8, "stone"), (0.3, 1.05, 0.7, "wood"),
                                      (-0.2, 0.35, 0.6, "stone_light"))):
        parts.append(box("tn_deb%d" % i, (0.09 * s, 0.06, 0.05 * s), mat(m), loc=(x, -0.2, z), rot=(0, 25 * i, 20 * i)))
    return group("tornado", parts)


def m_phaser():
    """Violet portal ring with a cyan inner ring and a dark void, blink chevrons shooting through it."""
    parts = [torus("ph_ring", 0.34, 0.07, glow("#a45cff"), rot=(90, 0, 0), segs=24, rsegs=6),
             torus("ph_ring2", 0.22, 0.04, glow("#4fe3ff"), loc=(0, -0.01, 0), rot=(90, 0, 0), segs=24, rsegs=6),
             cyl("ph_void", 0.2, 0.01, glow("#2a1060"), loc=(0, 0.0, 0), rot=(90, 0, 0), segs=20)]
    for i, x in enumerate((-0.86, -0.66)):
        ch = [(0.0, 0.17), (0.17, 0.0), (0.0, -0.17), (-0.07, -0.17), (0.1, 0.0), (-0.07, 0.17)]
        parts.append(prism("ph_chev%d" % i, [(x + a + 0.1, b) for a, b in ch], 0.01, glow("#e6fdff" if i else "#8ae8ff"),
                           y0=-0.05))
    for i, (x, z, r) in enumerate(((0.3, 0.38, 0.07), (0.46, -0.2, 0.05), (-0.1, -0.42, 0.06))):
        parts.append(star("ph_sp%d" % i, r, r * 0.35, 4, glow("#e6fdff"), loc=(x, -0.06, z)))
    return group("phaser", parts)


# ---- 20 uniques (A .. SSS), crafted only -----------------------------------------------------------------------

def femur(name, p0, p1, r=0.045):
    """Bone with a knobbed head at each end, drawn in the XZ plane."""
    p0, p1 = Vector(p0), Vector(p1)
    b = mat("bone_w")
    d = (p1 - p0).normalized()
    side = Vector((-d.z, 0, d.x))
    parts = [tube(name + "_s", [p0, p1], [r, r], b, segs=7)]
    for p in (p0, p1):
        for sg in (-1, 1):
            parts.append(sphere(name + "_k", r * 1.4, mat("bone"), loc=p + side * r * 0.85 * sg, segs=8, rings=5))
    return group(name, parts)


def m_grave_bell():
    """Funeral bell for a hammer head: a bone-collared pole with a hook arm from which a cracked bell-bronze bell
    hangs mouth-down, skull relief on the shoulder, bone clapper trailing a cyan ember."""
    bone = mat("bone_w")
    parts = [cyl("gb_haft", 0.042, 1.3, mat("wood_dark"), loc=(0, 0, -0.35))]
    for i in range(4):
        parts.append(torus("gb_wrap%d" % i, 0.045, 0.011, mat("thread"), loc=(0, 0, -0.3 + 0.06 * i), segs=10, rsegs=4))
    parts.append(sphere("gb_pommel", 0.06, bone, loc=(0, 0, -0.37), segs=10, rings=6))
    parts.append(cyl("gb_collar", 0.07, 0.12, bone, loc=(0, 0, 0.8), r_top=0.052))
    arm = [(0.0, 0, 0.92), (0.02, 0, 1.02), (0.12, 0, 1.1), (0.3, 0, 1.1), (0.42, 0, 1.04), (0.44, 0, 0.98)]
    cur = catmull(arm, 4)
    parts.append(tube("gb_arm", cur, [0.04 - 0.008 * i / (len(cur) - 1) for i in range(len(cur))], mat("wood_dark"), segs=7))
    parts.append(sphere("gb_hook", 0.05, bone, loc=(0.44, 0, 0.97), segs=8, rings=5))
    cx, top = 0.44, 0.96
    prof = [(0.34, 0.0), (0.335, 0.04), (0.3, 0.09), (0.24, 0.18), (0.19, 0.3), (0.15, 0.4), (0.11, 0.47), (0.06, 0.52),
            (0.0, 0.54)]
    prof = [(r, z + top - 0.54) for r, z in prof]
    parts.append(lathe("gb_bell", prof, mat("bell_bronze"), segs=18, loc=(cx, 0, 0)))
    parts.append(torus("gb_lip", 0.34, 0.034, mat("bell_dark"), loc=(cx, 0, top - 0.54), segs=18, rsegs=5))
    parts.append(torus("gb_band", 0.2, 0.022, mat("bell_dark"), loc=(cx, 0, top - 0.3), segs=18, rsegs=4))
    parts.append(sphere("gb_clapper", 0.075, bone, loc=(cx, 0, top - 0.6), segs=10, rings=6))
    parts.append(sphere("gb_ember", 0.04, glow("#4fe3ff"), loc=(cx, -0.05, top - 0.63), segs=8, rings=5))
    parts.append(bone_skull("gb_skull", 0.95, loc=(cx, -0.2, top - 0.3), rot=(0, 0, -90)))
    parts.append(prism("gb_crack", [(0.1, 0.0), (0.14, 0.0), (0.1, 0.1), (0.15, 0.2), (0.12, 0.2), (0.07, 0.1)], 0.01,
                       mat("black"), y0=-0.325, loc=(cx, 0, top - 0.52)))
    for i in range(5):
        a = math.radians(-90 + 30 * (i - 2))
        parts.append(sphere("gb_stud%d" % i, 0.03, bone, loc=(cx + 0.325 * math.cos(a), 0.325 * math.sin(a), top - 0.48),
                            segs=6, rings=4))
    return group("grave_bell", parts)


def m_leech_whip():
    """Bone grip and a fat segmented blood-red lash ending in a toothed leech mouth."""
    bone = mat("bone_w")
    parts = [cyl("lh_grip", 0.04, 0.46, bone, loc=(0, 0, -0.22))]
    for i in range(5):
        parts.append(torus("lh_wrap%d" % i, 0.043, 0.011, mat("thread"), loc=(0, 0, -0.18 + 0.065 * i), segs=10, rsegs=4))
    parts.append(sphere("lh_cap", 0.06, mat("blood_dry"), loc=(0, 0, -0.24), segs=8, rings=6))
    path = [(0.0, 0.22), (0.02, 0.42), (0.14, 0.62), (0.36, 0.72), (0.56, 0.62), (0.52, 0.42), (0.64, 0.26), (0.84, 0.22)]
    pts = [Vector((x, -0.01 * i, z)) for i, (x, z) in enumerate(path)]
    cur = catmull(pts, per=5)
    n = len(cur)
    radii = [0.035 + 0.05 * math.sin(math.pi * min(1.0, i / (n - 1) * 1.15)) for i in range(n)]
    parts.append(tube("lh_body", cur, radii, mat("thread"), segs=8))
    for i in range(3, n - 3, 3):
        t = cur[i + 1] - cur[i - 1]
        parts.append(torus("lh_seg%d" % i, radii[i] * 1.06, 0.014, mat("blood_dry"), loc=cur[i], segs=10, rsegs=4,
                           rot=(0, math.degrees(math.atan2(t.x, t.z)), 0)))
    tip = cur[-1]
    tdir = (cur[-1] - cur[-3]).normalized()
    ang = math.degrees(math.atan2(tdir.x, tdir.z))
    parts.append(cone("lh_mouth", 0.07, 0.11, 0.1, mat("blood_dry"), loc=tip - tdir * 0.02, rot=(0, ang, 0), segs=10))
    parts.append(torus("lh_teeth", 0.1, 0.022, bone, loc=tip + tdir * 0.075, rot=(0, ang, 0), segs=10, rsegs=4))
    parts.append(sphere("lh_throat", 0.055, glow("#4fe3ff"), loc=tip + tdir * 0.09, segs=8, rings=5))
    return group("leech_whip", parts)


def m_bone_rampart():
    """Tower shield with a battlemented top, built of rib bones across a dark plate, skull boss with ember eyes."""
    bone, dark = mat("bone_w"), mat("bone_black")
    W, top, low = 0.4, 0.4, 0.32
    pts = [(0.0, -0.5), (W, -0.18), (W, top), (0.27, top), (0.27, low), (0.09, low), (0.09, top), (-0.09, top),
           (-0.09, low), (-0.27, low), (-0.27, top), (-W, top), (-W, -0.18)]
    parts = [prism("br_plate", pts, 0.07, dark, bevel=0.01)]
    for i, z in enumerate((0.22, 0.04, -0.14, -0.3)):
        w = min(W, (z + 0.5) / 0.32 * W) * 0.97
        arc = [Vector((x * w, -0.05 - 0.025 * (1 - x * x), z - 0.06 * (1 - x * x))) for x in (-1, -0.5, 0, 0.5, 1)]
        parts.append(tube("br_rib%d" % i, catmull(arc, 3), 0.045, bone, segs=7))
        for sg, p in ((-1, arc[0]), (1, arc[-1])):
            parts.append(sphere("br_ribknob%d_%d" % (i, sg), 0.058, mat("bone"), loc=p, segs=8, rings=5))
    parts.append(bone_skull("br_skull", 1.5, eyes="#4fe3ff", loc=(0, -0.1, 0.08), rot=(0, 0, -90), glint=1.8))
    for i, z in enumerate((0.34, -0.08)):
        for sx in (-1, 1):
            parts.append(box("br_st%d_%d" % (i, sx), (0.07, 0.014, 0.016), mat("thread"), loc=(sx * 0.3, -0.07, z), rot=(0, 35, 0)))
    return group("bone_rampart", parts)


def m_plague_censer():
    """Hanging dark-steel censer on two chains: brass bands, perforations glowing cyan and green, a red-thread
    tassel and a plume of sickly green smoke."""
    br, dk = mat("steel_dark"), mat("iron_dark")
    parts = [sphere("pc_body", 0.3, br, loc=(0, 0, 0), segs=18, rings=12),
             torus("pc_band", 0.302, 0.034, mat("gold"), segs=18, rsegs=5),
             torus("pc_band2", 0.3, 0.026, mat("brass"), rot=(90, 0, 0), segs=18, rsegs=5),
             sphere("pc_lid", 0.13, br, loc=(0, 0, 0.28), segs=12, rings=6, scale=(1, 1, 0.7)),
             cyl("pc_foot", 0.1, 0.06, mat("gold"), loc=(0, 0, -0.36), r_top=0.07, segs=10)]
    holes = ((0.5, -0.5), (-0.5, -0.1), (0.1, -0.8), (0.55, 0.3), (-0.45, 0.5), (0.0, 0.1), (0.3, -0.25), (-0.2, -0.5))
    for i, (hx, hz) in enumerate(holes):
        hy = -math.sqrt(max(0.01, 1 - hx * hx - hz * hz))
        p = Vector((hx, hy, hz)).normalized() * 0.3
        parts.append(sphere("pc_hole%d" % i, 0.062, glow("#4fe3ff") if i % 2 == 0 else glow("#9ad84a"), loc=p, segs=6,
                            rings=4, scale=(1, 0.5, 1)))
    for sx in (-1, 1):
        parts += chain("pc_chain%d" % sx, 7, 0.17, mat("steel"), start=(sx * 0.22, 0, 0.27), direction=(-sx * 0.22, 0, 0.64),
                       r_wire=0.034, twist0=0, width_ratio=0.7)
    parts.append(torus("pc_top", 0.08, 0.035, mat("steel"), loc=(0, 0, 0.88), rot=(90, 0, 0), segs=12, rsegs=4))
    for i, (x, a) in enumerate(((-0.07, 8), (0.0, 0), (0.07, -8))):
        parts.append(prism("pc_tail%d" % i, [(0, 0), (0.035, 0), (0.045, -0.22), (0.0, -0.18), (-0.035, -0.22)], 0.012,
                           mat("thread"), loc=(x, -0.14, -0.4), rot=(0, a, 0)))
    for i, (x, z, r) in enumerate(((0.34, 0.26, 0.12), (0.48, 0.46, 0.15), (0.38, 0.68, 0.13), (0.5, 0.88, 0.1))):
        parts.append(sphere("pc_smoke%d" % i, r, mat("smoke_green"), loc=(x, 0.06, z), segs=10, rings=6))
    return group("plague_censer", parts)


def m_bone_turret():
    """Skull-headed tripod of femurs spitting a long bone shard (faces +X)."""
    bone = mat("bone_w")
    parts = [femur("bt_legl", (0.0, 0, 0.0), (-0.44, 0, -0.62)), femur("bt_legr", (0.0, 0, 0.0), (0.44, 0, -0.62)),
             femur("bt_legb", (0.0, 0, 0.0), (-0.02, 0.05, -0.64), 0.04)]
    parts.append(sphere("bt_hub", 0.1, mat("bone"), loc=(0, 0, 0.0), segs=10, rings=6))
    parts.append(bone_skull("bt_skull", 2.4, eyes="#4fe3ff", loc=(-0.06, 0, 0.04), glint=2.0))
    parts.append(sphere("bt_jaw_gap", 0.07, mat("black"), loc=(0.33, 0, 0.12), segs=8, rings=5, scale=(0.5, 1.3, 1)))
    parts.append(cone("bt_shard", 0.09, 0.0, 0.8, bone, loc=(0.22, 0, 0.14), rot=(0, 90, 0), segs=6))
    parts.append(cone("bt_shardtip", 0.04, 0.0, 0.26, mat("blood_dry"), loc=(0.76, 0, 0.14), rot=(0, 90, 0), segs=6))
    for i, x in enumerate((0.34, 0.45)):
        parts.append(torus("bt_vert%d" % i, 0.062 - 0.012 * i, 0.016, mat("bone"), loc=(x, 0, 0.14), rot=(0, 90, 0), segs=8,
                           rsegs=4))
    parts.append(box("bt_band", (0.04, 0.4, 0.04), mat("thread"), loc=(-0.1, 0, 0.0)))
    return group("bone_turret", parts)


def m_executioner_blade():
    """Heavy squared-off executioner's greatsword: dark steel, blood-red fuller, bone cross, skull pommel."""
    st, sd = mat("iron"), mat("iron_dark")
    stations = [(0.04, 0.1, 0.1), (0.78, 0.105, 0.105), (0.92, 0.105, 0.105), (0.97, 0.093, 0.093), (1.0, 0.055, 0.055),
                (1.025, 0.0, 0.0)]
    parts = [ridged_blade("ex_blade", stations, st, sd, t=0.034)]
    parts.append(box("ex_fuller", (0.04, 0.012, 0.66), mat("thread"), loc=(0.0, -0.036, 0.42)))
    parts.append(box("ex_edge", (0.012, 0.01, 0.8), mat("steel"), loc=(-0.1, -0.012, 0.5)))
    for i, (x, z, s) in enumerate(((0.05, 0.86, 1.0), (0.07, 0.76, 0.7))):
        parts.append(prism("ex_drip%d" % i, [(x, z), (x + 0.04, z), (x + 0.03, z - 0.12 * s), (x + 0.02, z - 0.08 * s),
                                              (x, z - 0.14 * s)], 0.008, mat("blood_dry"), y0=-0.04))
    parts.append(box("ex_cross", (0.5, 0.085, 0.07), mat("bone_w"), loc=(0, 0, 0.0), bevel=0.016))
    for sx in (-1, 1):
        parts.append(sphere("ex_cap%d" % sx, 0.052, mat("bone"), loc=(sx * 0.25, 0, 0.0), segs=8, rings=6))
    parts.append(cyl("ex_grip", 0.034, 0.38, mat("bone_black"), loc=(0, 0, -0.42)))
    for i in range(6):
        parts.append(torus("ex_wrap%d" % i, 0.037, 0.009, mat("thread"), loc=(0, 0, -0.4 + 0.06 * i), segs=12, rsegs=4))
    parts.append(bone_skull("ex_pommel", 0.9, loc=(0, 0, -0.5), rot=(0, 0, -90), glint=1.4))
    return group("executioner_blade", parts)


def m_storm_staff():
    """Wooden staff with bone prongs holding a cyan storm crystal (arcs are added by the icon)."""
    parts = [cyl("sts_haft", 0.034, 1.1, mat("wood_dark"), loc=(0, 0, -0.4), r_top=0.04)]
    for z in (-0.25, -0.18, 0.4):
        parts.append(torus("sts_wrap%d" % int(z * 100), 0.042, 0.011, mat("thread"), loc=(0, 0, z), segs=10, rsegs=4))
    parts.append(cyl("sts_collar", 0.07, 0.1, mat("bone_w"), loc=(0, 0, 0.64), r_top=0.05))
    parts.append(cone("sts_crys_u", 0.15, 0.0, 0.32, glow("#4fe3ff"), loc=(0, 0, 0.9), segs=6))
    parts.append(cone("sts_crys_d", 0.15, 0.0, 0.2, glow("#1a8ac8"), loc=(0, 0, 0.9), rot=(180, 0, 0), segs=6))
    parts.append(cone("sts_crys_hot", 0.07, 0.0, 0.2, glow("#e6fdff"), loc=(-0.03, -0.1, 0.9), segs=4))
    for sx in (-1, 1):
        prong = [(sx * 0.03, 0, 0.7), (sx * 0.2, 0, 0.78), (sx * 0.22, 0, 0.95), (sx * 0.12, 0, 1.12)]
        cur = catmull(prong, 4)
        parts.append(tube("sts_prong%d" % sx, cur, [0.03 - 0.018 * i / (len(cur) - 1) for i in range(len(cur))],
                          mat("bone_w"), segs=6))
    return group("storm_staff", parts)


def m_moon_glaive(tag="mg", sg=1.0):
    """One crescent blade (opens toward +X, -X when sg < 0): pale steel body, cyan edge, short wrapped bone grip."""
    R, r, d = 0.5, 0.45, 0.13
    body = [(sg * x, z) for x, z in moon_pts(R, r, d)]
    parts = [prism(tag + "_body", body, 0.04, mat("steel"), bevel=0.006)]
    x0 = (R * R - r * r + d * d) / (2 * d)
    a0 = math.atan2(math.sqrt(R * R - x0 * x0), x0)
    edge = []
    for k in range(13):
        a = a0 + (2 * math.pi - 2 * a0) * k / 12
        edge.append((sg * R * math.cos(a), R * math.sin(a)))
    for k in range(12, -1, -1):
        a = a0 + (2 * math.pi - 2 * a0) * k / 12
        edge.append((sg * (R - 0.055) * math.cos(a), (R - 0.055) * math.sin(a)))
    parts.append(prism(tag + "_edge", edge, 0.046, glow("#4fe3ff"), y0=-0.004))
    inner = (d - r)
    parts.append(cyl(tag + "_grip", 0.032, 0.3, mat("bone_w"), loc=(sg * (inner - 0.02), 0, 0), rot=(0, sg * 90, 0), segs=8))
    for i in range(3):
        parts.append(torus("%s_wrap%d" % (tag, i), 0.035, 0.009, mat("thread"), loc=(sg * (inner + 0.05 + 0.07 * i), 0, 0),
                           rot=(0, 90, 0), segs=10, rsegs=4))
    parts.append(sphere(tag + "_pom", 0.045, mat("bone"), loc=(sg * (inner + 0.3), 0, 0), segs=8, rings=5))
    return group(tag, parts)


def m_death_orb():
    """Black orb with a cyan slit eye cradled in bone fingers."""
    bone = mat("bone_w")
    parts = [sphere("do_orb", 0.3, mat("bone_black"), loc=(0, 0, 0), segs=18, rings=12),
             cyl("do_iris", 0.17, 0.01, glow("#4fe3ff"), loc=(0, -0.285, 0.02), rot=(90, 0, 0), segs=18),
             cyl("do_iris2", 0.11, 0.01, glow("#c8f6ff"), loc=(0, -0.292, 0.02), rot=(90, 0, 0), segs=18),
             prism("do_pupil", [(0, 0.15), (0.04, 0.0), (0, -0.15), (-0.04, 0.0)], 0.01, mat("black"), y0=-0.3, loc=(0, 0, 0.02)),
             sphere("do_shine", 0.04, glow("#ffffff"), loc=(-0.12, -0.26, 0.17), segs=6, rings=4)]
    for k, (ang, ln) in enumerate(((-70, 1.0), (-20, 0.9), (30, 0.95), (80, 0.8), (130, 0.9))):
        a = math.radians(ang)
        base = Vector((0.12 * math.cos(a), 0.12 * math.sin(a) - 0.0, -0.46))
        mid = Vector((0.4 * math.cos(a), 0.4 * math.sin(a) * 0.9, -0.22))
        top = Vector((0.36 * math.cos(a), 0.36 * math.sin(a) * 0.9, 0.12 * ln))
        cur = catmull([base, mid, top], 5)
        parts.append(tube("do_claw%d" % k, cur, [0.05 - 0.034 * i / (len(cur) - 1) for i in range(len(cur))], bone, segs=6))
        parts.append(cone("do_claw_tip%d" % k, 0.022, 0.0, 0.09, mat("blood_dry"), loc=top, rot=(0, math.degrees(math.atan2(
            top.x - mid.x, top.z - mid.z)), 0), segs=5))
    parts.append(sphere("do_palm", 0.15, bone, loc=(0, 0.02, -0.5), segs=10, rings=6, scale=(1, 0.8, 0.6)))
    return group("death_orb", parts)


def m_chain_prison():
    """Dark iron padlock with a glowing cyan keyhole, bound across with two heavy steel chains."""
    dark, steel = mat("iron_dark"), mat("steel")
    parts = [box("cpz_body", (0.58, 0.2, 0.44), dark, loc=(0, 0, -0.04), bevel=0.04),
             box("cpz_plate", (0.46, 0.03, 0.34), mat("iron"), loc=(0, -0.105, -0.04), bevel=0.01)]
    sh = [(-0.18, 0, 0.18), (-0.18, 0, 0.3)] + [(0.18 * math.cos(math.pi - math.pi * k / 8), 0, 0.3 + 0.2 * math.sin(math.pi * k / 8))
                                                  for k in range(1, 8)] + [(0.18, 0, 0.3), (0.18, 0, 0.18)]
    parts.append(tube("cpz_shackle", catmull(sh, 2), 0.05, steel, segs=8))
    for sx in (-1, 1):
        parts.append(torus("cpz_tie%d" % sx, 0.054, 0.014, mat("thread"), loc=(sx * 0.18, 0, 0.3), segs=10, rsegs=4, rot=(0, 90, 0)))
    parts.append(cyl("cpz_key", 0.075, 0.014, glow("#4fe3ff"), loc=(0, -0.12, 0.0), rot=(90, 0, 0), segs=14))
    parts.append(box("cpz_slot", (0.04, 0.012, 0.14), mat("black"), loc=(0, -0.13, -0.1)))
    parts.append(sphere("cpz_glint", 0.02, glow("#ffffff"), loc=(-0.025, -0.135, 0.03), segs=6, rings=4))
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(sphere("cpz_rivet%d%d" % (sx, sz), 0.025, mat("gold"), loc=(sx * 0.22, -0.12, -0.04 + sz * 0.14),
                                segs=6, rings=4))
    parts += chain("cpz_chA", 9, 0.17, steel, start=(-0.5, -0.22, 0.46), direction=(1.0, 0, -0.85), r_wire=0.034, twist0=0)
    parts += chain("cpz_chB", 9, 0.17, steel, start=(0.5, -0.27, 0.46), direction=(-1.0, 0, -0.85), r_wire=0.034, twist0=90)
    return group("chain_prison", parts)




def m_matron_flail():
    """Warden's flail: iron-banded haft with a key and a little bronze bell, a heavy chain and a spiked iron ball."""
    iron, dk = mat("iron"), mat("iron_dark")
    parts = [cyl("mf_haft", 0.045, 1.0, mat("wood_dark"), loc=(0, 0, -0.45))]
    for z in (-0.3, 0.05, 0.38):
        parts.append(cyl("mf_band%d" % int(z * 100), 0.056, 0.07, iron, loc=(0, 0, z), segs=10))
    for i in range(3):
        parts.append(torus("mf_wrap%d" % i, 0.049, 0.01, mat("thread"), loc=(0, 0, -0.4 + 0.045 * i), segs=10, rsegs=4))
    parts.append(sphere("mf_cap", 0.065, glow("#4fe3ff"), loc=(0, 0, -0.47), segs=8, rings=6))
    parts.append(torus("mf_ring", 0.07, 0.024, iron, loc=(0, 0, 0.56), rot=(90, 0, 0), segs=12, rsegs=4))
    d = Vector((0.9, 0, -0.4)).normalized()
    start = Vector((0.04, 0, 0.58))
    parts += chain("mf_chain", 5, 0.15, iron, start=start, direction=d, r_wire=0.03)
    c = start + d * 0.56 + d * 0.2
    parts.append(sphere("mf_ball", 0.2, dk, loc=c, segs=14, rings=8))
    pts = [(0, 0, 1), (0, 0, -1), (1, 0, 0), (-1, 0, 0), (0, -1, 0), (0.7, -0.7, 0.2), (-0.7, -0.7, 0.2), (0.6, -0.5, 0.6),
           (-0.6, -0.5, 0.6), (0.6, -0.5, -0.6), (-0.6, -0.5, -0.6), (0.0, -0.7, 0.7), (0.0, -0.7, -0.7)]
    for i, p in enumerate(pts):
        v = Vector(p).normalized()
        parts.append(cone("mf_spike%d" % i, 0.06, 0.0, 0.17, iron, loc=c + v * 0.17, rot=(0, 0, 0), segs=5))
        parts[-1].rotation_euler = v.to_track_quat("Z", "Y").to_euler()
    parts.append(torus("mf_ballband", 0.2, 0.022, mat("blood_dry"), loc=c, rot=(90, 0, 0), segs=14, rsegs=4))
    parts.append(torus("mf_keyring", 0.05, 0.012, mat("brass"), loc=Vector((0.1, -0.06, 0.5)), segs=10, rsegs=4,
                       rot=(90, 0, 0)))
    parts.append(cyl("mf_keyshaft", 0.014, 0.2, mat("brass"), loc=Vector((0.1, -0.06, 0.3)), segs=6))
    parts.append(box("mf_keybit", (0.07, 0.015, 0.045), mat("brass"), loc=Vector((0.13, -0.06, 0.32))))
    return group("matron_flail", parts)


def m_soulfire_bow():
    """Dusk-grey bone bow with a glowing cyan string and a bone arrow nocked.  Returns (root, upper tip, lower tip)."""
    root, tu, td = bow_model("sf", mat("soul_wood"), mat("bone_w"), mat("bone_w"), glow("#4fe3ff"), curve=1.25, thick=1.9,
                             wrap=mat("thread"), string_r=0.02, knobs=mat("steel_dark"))
    _arrow_fan(root, "sf", Vector((-0.27, 0, 0.0)), (0,), length=1.0, fletch="bone_w")
    return root, tu, td


def m_bell_aegis():
    """Bell-shaped shield (faces -Y): bronze bell silhouette with a bone lip, an ember boss and a hanging clapper."""
    half = [(0.09, 0.5), (0.14, 0.45), (0.17, 0.35), (0.2, 0.2), (0.25, 0.02), (0.32, -0.15), (0.4, -0.3), (0.44, -0.4)]
    outline = [(x, z) for x, z in half] + [(-x, z) for x, z in reversed(half)]
    inner = [(x * 0.78, z * 0.9 - 0.02) for x, z in half[:-1]] + [(0.32, -0.3)]
    inner = inner + [(-x, z) for x, z in reversed(inner)]
    parts = [prism("ba_body", outline, 0.08, mat("bell_bronze"), bevel=0.012),
             prism("ba_panel", inner, 0.03, mat("bell_dark"), y0=-0.04)]
    parts.append(prism("ba_lip", [(-0.46, -0.42), (0.46, -0.42), (0.44, -0.3), (-0.44, -0.3)], 0.1, mat("bone_w"), bevel=0.01))
    parts.append(torus("ba_crown", 0.075, 0.03, mat("bell_dark"), loc=(0, 0, 0.55), rot=(90, 0, 0), segs=12, rsegs=4))
    parts.append(torus("ba_boss", 0.12, 0.03, mat("bone_w"), loc=(0, -0.05, 0.0), rot=(90, 0, 0), segs=16, rsegs=5))
    parts.append(cyl("ba_core", 0.1, 0.015, glow("#4fe3ff"), loc=(0, -0.06, 0.0), rot=(90, 0, 0), segs=14))
    parts.append(sphere("ba_hot", 0.04, glow("#e6fdff"), loc=(-0.03, -0.085, 0.03), segs=6, rings=4))
    for z in (0.3, -0.12):
        for sx in (-1, 1):
            w = 0.14 + (0.3 - z) * 0.2
            parts.append(sphere("ba_rv%d_%d" % (int(z * 100), sx), 0.026, mat("bone"), loc=(sx * w * 1.0, -0.05, z), segs=6, rings=4))
    parts.append(sphere("ba_clapper", 0.08, mat("bone_w"), loc=(0, -0.02, -0.5), segs=8, rings=6))
    parts.append(tube("ba_thread", [Vector((0.2, -0.06, 0.36)), Vector((0.18, -0.07, 0.1)), Vector((0.24, -0.06, -0.1))], 0.014,
                      mat("thread"), segs=5))
    return group("bell_aegis", parts)


def m_rag_doll():
    """Stitched burlap doll, arms flung out, red-yarn pigtails, one cyan button eye and one crossed stitch."""
    bur, sack, yarn, dark, thread = mat("burlap"), mat("sack"), mat("yarn"), mat("blood_dry"), mat("thread")
    parts = [sphere("rdl_torso", 0.2, sack, loc=(0, 0, 0.0), segs=12, rings=8, scale=(1.0, 0.75, 1.45)),
             sphere("rdl_head", 0.22, bur, loc=(0, 0, 0.52), segs=14, rings=10, scale=(1.0, 0.9, 0.95)),
             sphere("rdl_cap", 0.235, yarn, loc=(0, 0.03, 0.6), segs=12, rings=8, scale=(1.0, 0.95, 0.6))]
    for sx in (-1, 1):
        parts.append(sphere("rdl_pig%d" % sx, 0.1, yarn, loc=(sx * 0.3, 0, 0.45), segs=8, rings=6, scale=(0.8, 0.8, 1.5)))
        parts.append(torus("rdl_tie%d" % sx, 0.07, 0.02, thread, loc=(sx * 0.28, 0, 0.56), segs=10, rsegs=4, rot=(0, 20 * sx, 0)))
    parts.append(torus("rdl_eyering", 0.075, 0.018, mat("brass"), loc=(-0.08, -0.2, 0.55), rot=(90, 0, 0), segs=12, rsegs=4))
    parts.append(cyl("rdl_eye", 0.06, 0.02, glow("#4fe3ff"), loc=(-0.08, -0.2, 0.55), rot=(90, 0, 0), segs=12))
    parts.append(sphere("rdl_eyehot", 0.02, glow("#ffffff"), loc=(-0.1, -0.225, 0.575), segs=6, rings=4))
    for sg in (-1, 1):
        parts.append(box("rdl_x%d" % sg, (0.1, 0.012, 0.018), dark, loc=(0.09, -0.2, 0.55), rot=(0, 45 * sg, 0)))
    parts.append(tube("rdl_mouth", catmull([(-0.1, -0.2, 0.4), (-0.03, -0.215, 0.37), (0.04, -0.215, 0.37), (0.1, -0.2, 0.4)], 3),
                      0.012, dark, segs=5))
    for i, x in enumerate((-0.06, 0.0, 0.06)):
        parts.append(box("rdl_tick%d" % i, (0.012, 0.012, 0.045), dark, loc=(x, -0.215, 0.385)))
    limbs = (("al", (-0.16, 0, 0.18), (-0.5, 0, 0.44), 0.058, bur), ("ar", (0.16, 0, 0.16), (0.52, 0, 0.0), 0.058, bur),
             ("ll", (-0.09, 0, -0.26), (-0.2, 0, -0.66), 0.066, sack), ("lr", (0.09, 0, -0.26), (0.34, 0, -0.6), 0.066, sack))
    for nm, p0, p1, r, m in limbs:
        parts.append(tube("rdl_" + nm, [Vector(p0), Vector(p1)], r, m, segs=8))
        end = Vector(p1)
        if nm[0] == "a":
            parts.append(sphere("rdl_hand_" + nm, 0.085, mat("flesh_pale"), loc=end, segs=8, rings=6))
            parts.append(torus("rdl_cuff_" + nm, 0.065, 0.015, thread, loc=(Vector(p0) * 0.2 + end * 0.8), segs=10, rsegs=4,
                               rot=(0, math.degrees(math.atan2(p1[0] - p0[0], p1[2] - p0[2])), 0)))
        else:
            parts.append(sphere("rdl_foot_" + nm, 0.095, mat("leather"), loc=end + Vector((0.03 * (1 if nm == "lr" else -1), 0, -0.02)),
                                segs=8, rings=6, scale=(1.2, 1, 0.8)))
    parts.append(sphere("rdl_patch", 0.1, mat("flesh_pale"), loc=(0.06, -0.14, 0.04), segs=10, rings=6, scale=(1, 0.3, 1)))
    for sg in (-1, 1):
        parts.append(box("rdl_ps%d" % sg, (0.13, 0.012, 0.016), thread, loc=(0.06, -0.165, 0.04), rot=(0, 45 * sg, 0)))
    parts.append(tube("rdl_seam", [Vector((-0.02, -0.16, 0.22)), Vector((0.0, -0.17, 0.0)), Vector((-0.02, -0.15, -0.2))], 0.012,
                      dark, segs=5))
    return group("rag_doll", parts)


def m_crimson_rain():
    """A bruise-dark storm cloud shedding a slanting rain of blood-red needles and drops."""
    parts = []
    for i, (x, z, r, m) in enumerate(((-0.28, 0.6, 0.2, "bone_black"), (0.0, 0.7, 0.26, "bone_black"), (0.3, 0.6, 0.21, "bone_black"),
                                      (-0.08, 0.52, 0.2, "blood_dry"), (0.18, 0.5, 0.17, "blood_dry"))):
        parts.append(sphere("cr_cloud%d" % i, r, mat(m), loc=(x, 0.02 * i, z), segs=12, rings=8, scale=(1.1, 0.8, 0.85)))
    parts.append(star("cr_flash", 0.1, 0.03, 4, glow("#4fe3ff"), loc=(0.14, -0.2, 0.62)))
    for i, (x, z0, ln) in enumerate(((-0.45, 0.4, 0.7), (-0.3, 0.3, 0.55), (-0.12, 0.34, 0.75), (0.06, 0.28, 0.6),
                                     (0.22, 0.32, 0.8), (0.4, 0.3, 0.58), (0.52, 0.42, 0.66))):
        pv = group("cr_n%d" % i, [cone("cr_needle%d" % i, 0.04, 0.0, ln, mat("thread"), loc=(0, 0, 0), segs=5),
                                   box("cr_eye%d" % i, (0.03, 0.02, 0.05), mat("bone_w"), loc=(0, 0, 0.03))],
                   rot=(0, 180 + 22, 0))
        pv.location = (x, 0, z0)
        parts.append(pv)
    for i, (x, z) in enumerate(((-0.4, -0.45), (0.1, -0.5), (0.5, -0.4))):
        parts.append(sphere("cr_drop%d" % i, 0.05, glow("#d02a48"), loc=(x, 0, z), segs=8, rings=5, scale=(1, 1, 1.25)))
        parts.append(cone("cr_dropt%d" % i, 0.045, 0.0, 0.09, glow("#d02a48"), loc=(x, 0, z + 0.04), segs=6))
    return group("crimson_rain", parts)


def m_shear_half(tag, sg):
    """One half of the giant shears: blade up the +Z axis from the pivot, shank and a red-wrapped bow ring below it."""
    st, sd = mat("steel"), mat("steel_dark")
    stations = [(0.0, 0.07, 0.07), (0.45, 0.068, 0.068), (0.8, 0.05, 0.05), (1.0, 0.0, 0.0)]
    parts = [ridged_blade(tag + "_blade", stations, st if sg > 0 else sd, sd if sg > 0 else st, t=0.022)]
    parts.append(box(tag + "_shank", (0.07, 0.05, 0.4), sd, loc=(0, 0, -0.2), bevel=0.01))
    parts.append(torus(tag + "_ring", 0.15, 0.045, mat("blood_dry"), loc=(0, 0, -0.5), rot=(90, 0, 0), segs=16, rsegs=6,
                       scale=(0.85, 1, 1.15)))
    for i in range(5):
        a = math.radians(72 * i + 20)
        parts.append(sphere("%s_wrap%d" % (tag, i), 0.036, mat("thread"),
                            loc=(0.15 * 0.85 * math.cos(a), -0.012, -0.5 + 0.15 * 1.15 * math.sin(a)), segs=6, rings=4))
    return group(tag, parts)


def m_selma_shears():
    """Seamstress's giant shears: crossed steel blades with a bone-and-ember pivot and red thread-wrapped bow rings."""
    a = m_shear_half("sha", 1)
    b = m_shear_half("shb", -1)
    a.rotation_euler = (0, math.radians(11), 0)
    b.rotation_euler = (0, math.radians(-11), 0)
    b.location = (0, -0.05, 0)
    parts = [a, b, sphere("sh_pivot", 0.075, mat("bone_w"), loc=(0, -0.1, 0.0), segs=10, rings=6),
             sphere("sh_ember", 0.036, glow("#4fe3ff"), loc=(0, -0.165, 0.0), segs=8, rings=5)]
    thr = [Vector((0.0, -0.11, 0.0)), Vector((-0.08, -0.13, -0.12)), Vector((-0.14, -0.13, -0.3)), Vector((-0.02, -0.12, -0.4)),
           Vector((0.1, -0.13, -0.46))]
    parts.append(tube("sh_thread", catmull(thr, 4), 0.017, mat("thread"), segs=5))
    return group("selma_shears", parts)


def m_ember_blade():
    """Black-bone blade shot through with glowing cyan cracks, bone horn guard, red-wrapped grip, floating embers."""
    stations = [(0.02, 0.06, 0.06), (0.2, 0.062, 0.062), (0.5, 0.058, 0.058), (0.8, 0.05, 0.05), (0.98, 0.0, 0.0)]
    parts = [ridged_blade("eb_blade", stations, mat("bone_black"), mat("black"), t=0.026)]
    parts.append(box("eb_core", (0.034, 0.012, 0.74), glow("#4fe3ff"), loc=(0.0, -0.03, 0.46)))
    parts.append(box("eb_core2", (0.014, 0.014, 0.74), glow("#e6fdff"), loc=(0.0, -0.036, 0.46)))
    for i, (x, z, a, ln) in enumerate(((-0.035, 0.3, 30, 0.12), (0.03, 0.55, -35, 0.13), (-0.03, 0.75, 25, 0.1), (0.035, 0.18, -25, 0.09))):
        parts.append(box("eb_crack%d" % i, (0.016, 0.014, ln), glow("#4fe3ff"), loc=(x, -0.03, z), rot=(0, a, 0)))
    horn = [(-0.24, 0.14), (-0.16, 0.03), (0.0, 0.0), (0.16, 0.03), (0.24, 0.14), (0.19, -0.02), (0.07, -0.05), (-0.07, -0.05),
            (-0.19, -0.02)]
    parts.append(prism("eb_guard", horn, 0.07, mat("bone_w"), bevel=0.008))
    parts.append(sphere("eb_gem", 0.04, glow("#4fe3ff"), loc=(0, -0.045, 0.0), segs=8, rings=5))
    parts.append(cyl("eb_grip", 0.032, 0.2, mat("leather_red"), loc=(0, 0, -0.23)))
    for i in range(4):
        parts.append(torus("eb_wrap%d" % i, 0.034, 0.008, mat("thread"), loc=(0, 0, -0.21 + 0.05 * i), segs=12, rsegs=4))
    parts.append(sphere("eb_pommel", 0.055, mat("bone_w"), loc=(0, 0, -0.25), segs=10, rings=6))
    return group("ember_blade", parts)


def m_ninefold_whip():
    """Bone grip with nine blood-red tails fanning from a bone knot, each ending in a cyan ember bead."""
    bone = mat("bone_w")
    parts = [cyl("nw_grip", 0.04, 0.5, bone, loc=(0, 0, -0.3))]
    for i in range(5):
        parts.append(torus("nw_wrap%d" % i, 0.043, 0.011, mat("thread"), loc=(0, 0, -0.26 + 0.07 * i), segs=10, rsegs=4))
    parts.append(sphere("nw_cap", 0.055, mat("blood_dry"), loc=(0, 0, -0.32), segs=8, rings=6))
    parts.append(sphere("nw_knot", 0.09, bone, loc=(0, 0, 0.22), segs=10, rings=6, scale=(1, 0.9, 0.8)))
    for k in range(9):
        a = math.radians(-46 + 11.5 * k)
        L_ = 0.95 + 0.12 * math.cos(k * 1.7)
        curl = 0.1 * (1 if k % 2 else -1) * (0.6 + 0.4 * math.sin(k))
        pts = []
        for i in range(6):
            t = i / 5
            d = Vector((math.sin(a), 0, math.cos(a)))
            n = Vector((math.cos(a), 0, -math.sin(a)))
            p = Vector((0, -0.006 * k, 0.24)) + d * L_ * t + n * curl * math.sin(math.pi * t * 1.2) * L_ * 0.8
            pts.append(p)
        cur = catmull(pts, per=3)
        m = mat("thread") if k % 2 == 0 else mat("blood_dry")
        parts.append(tube("nw_tail%d" % k, cur, [0.034 - 0.022 * i / (len(cur) - 1) for i in range(len(cur))], m, segs=6))
        parts.append(sphere("nw_bead%d" % k, 0.036, glow("#4fe3ff"), loc=cur[-1], segs=6, rings=4))
    return group("ninefold_whip", parts)


def m_last_bell():
    """Great church bell hanging from a wooden yoke: cracked bronze, cyan ember light under the mouth, bone clapper."""
    br, dk = mat("bell_bronze"), mat("bell_dark")
    prof = [(0.4, 0.0), (0.39, 0.05), (0.34, 0.12), (0.27, 0.27), (0.21, 0.45), (0.16, 0.6), (0.11, 0.7), (0.06, 0.76), (0.0, 0.78)]
    parts = [lathe("lb_bell", prof, br, segs=20),
             torus("lb_lip", 0.4, 0.04, dk, loc=(0, 0, 0.03), segs=20, rsegs=5),
             torus("lb_band1", 0.31, 0.024, dk, loc=(0, 0, 0.2), segs=20, rsegs=4),
             torus("lb_band2", 0.2, 0.022, dk, loc=(0, 0, 0.5), segs=18, rsegs=4)]
    parts.append(box("lb_yoke", (1.0, 0.2, 0.15), mat("wood_dark"), loc=(0, 0, 0.96), bevel=0.03))
    for sx in (-1, 1):
        parts.append(box("lb_strap%d" % sx, (0.08, 0.22, 0.2), mat("iron"), loc=(sx * 0.14, 0, 0.94), bevel=0.012))
        parts.append(cone("lb_cap%d" % sx, 0.1, 0.06, 0.06, mat("iron"), loc=(sx * 0.5, 0, 0.96), rot=(0, 90 * sx, 0), segs=8))
    for sx in (-1, 1):
        parts.append(box("lb_arm%d" % sx, (0.07, 0.1, 0.22), mat("iron_dark"), loc=(sx * 0.08, 0, 0.8), bevel=0.008))
    parts.append(torus("lb_rope", 0.08, 0.02, mat("thread"), loc=(0, 0, 1.12), rot=(90, 0, 0), segs=12, rsegs=4))
    parts.append(sphere("lb_clapper", 0.09, mat("bone_w"), loc=(0, 0, -0.12), segs=10, rings=6))
    parts.append(sphere("lb_ember", 0.05, glow("#4fe3ff"), loc=(0, -0.06, -0.14), segs=8, rings=5))
    parts.append(prism("lb_crack", zap_pts((0.1, 0.65), (0.12, 0.05), w=0.025, n=6, jitter=0.1, seed=4), 0.01, glow("#4fe3ff"),
                       y0=-0.27))
    parts.append(prism("lb_crack2", zap_pts((-0.12, 0.5), (-0.17, 0.08), w=0.02, n=4, jitter=0.1, seed=7), 0.01, glow("#4fe3ff"),
                       y0=-0.31))
    parts.append(bone_skull("lb_skull", 1.2, loc=(0, -0.3, 0.3), rot=(0, 0, -90), glint=1.5))
    return group("last_bell", parts)


def m_requiem():
    """A lyre of curved rib bones with a bone sounding-box, blood-red thread strings and a cyan ember between the horns."""
    bone = mat("bone_w")
    parts = []
    for sx in (-1, 1):
        arm = [(sx * 0.14, 0, -0.34), (sx * 0.36, 0, -0.14), (sx * 0.34, 0, 0.26), (sx * 0.28, 0, 0.56), (sx * 0.4, 0, 0.8)]
        cur = catmull(arm, 4)
        parts.append(tube("rq_arm%d" % sx, cur, [0.062 - 0.026 * i / (len(cur) - 1) for i in range(len(cur))], bone, segs=7))
        parts.append(sphere("rq_horn%d" % sx, 0.06, mat("bone"), loc=arm[-1], segs=8, rings=5))
    parts.append(tube("rq_bar", [Vector((-0.31, 0, 0.5)), Vector((0.31, 0, 0.5))], 0.05, bone, segs=8))
    parts.append(box("rq_box", (0.46, 0.12, 0.22), bone, loc=(0, 0, -0.34), bevel=0.04))
    parts.append(bone_skull("rq_skull", 0.8, loc=(0, -0.1, -0.44), rot=(0, 0, -90), glint=1.4))
    for i, x in enumerate((-0.2, -0.1, 0.0, 0.1, 0.2)):
        parts.append(tube("rq_str%d" % i, [Vector((x * 1.4, -0.05, 0.5)), Vector((x, -0.05, -0.22))], 0.026, mat("thread"), segs=5))
    parts.append(sphere("rq_ember", 0.08, glow("#4fe3ff"), loc=(0, -0.03, 0.78), segs=8, rings=5))
    parts.append(sphere("rq_hot", 0.035, glow("#e6fdff"), loc=(-0.02, -0.09, 0.8), segs=6, rings=4))
    return group("requiem", parts)


def m_bell_shard():
    """A jagged curved shard of the cracked tower bell: bronze outside, dark inside, cyan ember along the break."""
    pts = [(-0.3, -0.34), (-0.12, -0.4), (0.1, -0.3), (0.34, -0.36), (0.3, -0.12), (0.4, 0.1), (0.22, 0.24), (0.26, 0.42),
           (0.0, 0.5), (-0.14, 0.34), (-0.34, 0.3), (-0.26, 0.04), (-0.4, -0.12)]
    parts = [prism("bsh_back", pts, 0.12, mat("bell_dark"), y0=0.03, bevel=0.012),
             prism("bsh_face", [(x * 0.9, z * 0.9) for x, z in pts], 0.06, mat("bell_bronze"), y0=-0.045, bevel=0.01)]
    parts.append(prism("bsh_band", [(-0.3, 0.0), (0.4, 0.04), (0.38, 0.12), (-0.3, 0.09)], 0.065, mat("bell_dark"), y0=-0.05))
    parts.append(prism("bsh_crack", zap_pts((0.3, -0.3), (-0.2, 0.3), w=0.03, n=6, jitter=0.1, seed=2), 0.012, glow("#4fe3ff"), y0=-0.09))
    parts.append(prism("bsh_crack2", zap_pts((0.3, -0.3), (-0.2, 0.3), w=0.012, n=6, jitter=0.1, seed=2), 0.014, glow("#e6fdff"), y0=-0.1))
    for i, (x, z) in enumerate(((-0.2, -0.24), (0.1, -0.2), (0.2, 0.3))):
        parts.append(sphere("bsh_stud%d" % i, 0.03, mat("bone_w"), loc=(x, -0.09, z), segs=6, rings=4))
    parts.append(tube("bsh_thread", [Vector((-0.34, -0.1, 0.3)), Vector((-0.2, -0.1, 0.15)), Vector((-0.3, -0.1, 0.0))], 0.016,
                      mat("thread"), segs=5))
    return group("bell_shard", parts)


# ---- stash prop (CONTENT4 6.3): upright reliquary coffin with iron bands, a skull relief and a cyan lock ---------

STASH_OUTLINE = [(-0.28, 0.14), (0.28, 0.14), (0.46, 1.45), (0.30, 2.05), (-0.30, 2.05), (-0.46, 1.45)]


def _scaled(pts, sx, sz, cz=1.1):
    return [(x * sx, (z - cz) * sz + cz) for x, z in pts]


def m_stash():
    """Standing reliquary coffin (front faces -Y).  Returns (root, P): P['door'] = pivot hinged on the left edge,
    P['lock'] = glow parts of the lock (keyhole + ring), P['leak'] = glow seam round the door, P['inside'] = the
    glow parts of the open interior."""
    P = {}
    wood, wood_d, iron, dark = mat("wood_light"), mat("wood_dark"), mat("iron"), mat("iron_dark")
    O = STASH_OUTLINE
    parts = [box("st_plinth", (0.96, 0.66, 0.14), mat("stone_dark"), loc=(0, 0, 0.07), bevel=0.02),
             box("st_plinth2", (0.84, 0.58, 0.05), mat("stone"), loc=(0, 0, 0.165), bevel=0.012),
             prism("st_shell", _scaled(O, 1.0, 1.0), 0.46, wood_d, bevel=0.015),
             box("st_cap", (0.7, 0.52, 0.09), dark, loc=(0, 0, 2.085), bevel=0.02),
             sphere("st_finial", 0.07, mat("bone_w"), loc=(0, 0, 2.17), segs=8, rings=6)]
    # interior seen through the open door: dark cavity, cyan glow, a skull on a rib cage
    inside = []
    inside.append(prism("st_cavity", _scaled(O, 0.9, 0.955), 0.02, mat("mortar"), y0=-0.235))
    inside.append(prism("st_glow1", _scaled(O, 0.8, 0.92), 0.012, glow("#0e4a68"), y0=-0.248))
    inside.append(prism("st_glow2", _scaled(O, 0.56, 0.78), 0.012, glow("#1a8ab0"), y0=-0.256))
    inside.append(prism("st_glow3", _scaled(O, 0.32, 0.6), 0.012, glow("#6ae8ff"), y0=-0.264))
    ik = bone_skull("st_iskull", 1.1, eyes="#e6fdff", loc=(0, -0.285, 1.35), rot=(0, 0, -90), glint=1.6)
    inside.append(ik)
    for i, z in enumerate((1.18, 1.02, 0.86)):
        arc = [Vector((x * (0.2 - 0.02 * i), -0.285, z - 0.05 * (1 - x * x))) for x in (-1, -0.5, 0, 0.5, 1)]
        inside.append(tube("st_irib%d" % i, catmull(arc, 3), 0.026, mat("bone_w"), segs=6))
    parts += inside
    P["inside"] = inside
    leak = prism("st_leak", _scaled(O, 0.97, 0.985), 0.012, glow("#1a6a8a"), y0=-0.236)
    parts.append(leak)
    P["leak"] = leak
    # door: all in world coordinates first, then parented to the hinge pivot
    hx = -0.4
    door = [prism("st_door", _scaled(O, 0.91, 0.965), 0.1, wood, y0=-0.3, bevel=0.012),
            prism("st_panel", _scaled(O, 0.8, 0.9), 0.03, wood_d, y0=-0.355)]
    for i, z in enumerate((0.44, 1.95, 1.2)):
        w = (0.28 + (0.46 - 0.28) * (z - 0.14) / 1.31) if z < 1.45 else 0.46 - 0.16 * (z - 1.45) / 0.6
        w *= 0.9
        door.append(box("st_band%d" % i, (2 * w, 0.07, 0.11), iron, loc=(0, -0.385, z), bevel=0.012))
        door.append(box("st_bandb%d" % i, (2 * w, 0.05, 0.11), dark, loc=(0, -0.235, z), bevel=0.012))   # inside face
        for sx in (-1, 1):
            door.append(sphere("st_rv%d_%d" % (i, sx), 0.03, mat("gold"), loc=(sx * (w - 0.06), -0.425, z), segs=6, rings=4))
    door.append(box("st_strap", (0.07, 0.05, 1.75), dark, loc=(0, -0.4, 1.1), bevel=0.01))
    LZ = 1.2                      # the lock sits ~38 px above the ground (the code draws its glow at y - 40)
    door.append(bone_skull("st_skull", (0.55, 1.15, 1.15), eyes="#4fe3ff", loc=(0, -0.44, 1.56), rot=(0, 0, -90), glint=1.5))
    door.append(box("st_lock", (0.3, 0.07, 0.34), mat("steel_dark"), loc=(0, -0.45, LZ - 0.03), bevel=0.02))
    sh = [(-0.1, -0.45, LZ + 0.12)] + [(0.1 * math.cos(math.pi - math.pi * k / 6), -0.45, LZ + 0.14 + 0.12 * math.sin(math.pi * k / 6))
                                       for k in range(1, 6)] + [(0.1, -0.45, LZ + 0.12)]
    door.append(tube("st_shackle", catmull(sh, 2), 0.028, mat("steel"), segs=6))
    lockg = [cyl("st_key", 0.055, 0.012, glow("#4fe3ff"), loc=(0, -0.486, LZ + 0.0), rot=(90, 0, 0), segs=14),
             torus("st_keyring", 0.09, 0.016, glow("#4fe3ff"), loc=(0, -0.482, LZ + 0.0), rot=(90, 0, 0), segs=16, rsegs=4),
             cyl("st_lockhalo", 0.16, 0.01, glow("#12384a"), loc=(0, -0.481, LZ - 0.02), rot=(90, 0, 0), segs=16)]
    door += lockg
    door.append(box("st_slot", (0.026, 0.01, 0.09), mat("black"), loc=(0, -0.495, LZ - 0.08)))
    for z in (0.62, 1.38):
        door.append(box("st_hinge%d" % int(z * 10), (0.16, 0.12, 0.14), dark, loc=(hx + 0.02, -0.4, z), bevel=0.014))
    pv = empty("st_hinge", loc=(hx, -0.3, 0.0))
    parent_to(door, pv)
    P["door"] = pv
    P["lock"] = lockg
    root = group("stash", parts + [pv])
    return root, P
