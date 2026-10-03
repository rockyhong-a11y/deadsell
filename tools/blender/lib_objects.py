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


def m_scroll(color="red", length=0.4, r=0.075):
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
    return group("scroll_" + color, parts), ring, core


def m_cell(r=0.11):
    parts = [sphere("cell_core", r, glow("#4fd8ff"), segs=16, rings=10)]
    parts.append(sphere("cell_hot", r * 0.5, glow("#e6fdff"), loc=(-r * 0.25, -r * 0.7, r * 0.25), segs=10, rings=6))
    return group("cell", parts)


def m_coin(r=0.15, th=0.04, name="coin"):
    g = mat("gold")
    parts = [cyl(name + "_body", r, th, g, loc=(0, th / 2, 0), rot=(90, 0, 0), segs=20)]
    for sy in (-1, 1):
        parts.append(torus(name + "_rim%d" % sy, r * 0.84, 0.014, mat("brass"), loc=(0, sy * th / 2, 0),
                           rot=(90, 0, 0), segs=20, rsegs=4))
        parts.append(box(name + "_mark%d" % sy, (r * 0.62, 0.014, r * 0.62), mat("brass"), loc=(0, sy * th / 2, 0),
                         rot=(0, 45, 0), bevel=0.008))
    return group(name, parts)


def m_turret():
    """Small crossbow turret.  Returns (root, parts) with pivots for animation.

    Pivots: 'hub' (z = deploy height), 'leg0..2' (splay), 'head' (pitch/recoil),
    'limb_n'/'limb_f' (bow arms fold), plus objects 'string', 'bolt', 'eye', 'flash'.
    """
    P = {}
    root = empty("turret")
    hub = empty("t_hub")
    hub.parent = root
    P["hub"] = hub
    hub_objs = [cyl("t_hubm", 0.09, 0.1, mat("iron"), loc=(0, 0, -0.05), segs=12)]
    hub_objs.append(torus("t_hubring", 0.09, 0.014, mat("brass"), loc=(0, 0, 0.05), segs=12, rsegs=4))
    for o in hub_objs:
        o.parent = hub
    # legs (pivot at hub, hanging down & outward)
    for i, a in enumerate((-90 + 60, -90 - 60, 90)):
        lp = empty("t_leg%d" % i)
        lp.parent = hub
        lp.rotation_euler = (0, 0, math.radians(a))
        P["leg%d" % i] = lp
        sw = empty("t_legsw%d" % i)
        sw.parent = lp
        P["legsw%d" % i] = sw
        leg = box("t_legm%d" % i, (0.05, 0.05, 0.36), mat("wood"), loc=(0, 0, -0.18), bevel=0.01)
        foot = cone("t_foot%d" % i, 0.035, 0.0, 0.06, mat("iron"), loc=(0, 0, -0.36), rot=(180, 0, 0), segs=6)
        band = box("t_legband%d" % i, (0.06, 0.06, 0.03), mat("iron"), loc=(0, 0, -0.1))
        for o in (leg, foot, band):
            o.parent = sw
    # post + head
    post = cyl("t_post", 0.035, 0.16, mat("iron_dark"), loc=(0, 0, 0.0), segs=10)
    post.parent = hub
    head = empty("t_head")
    head.parent = hub
    head.location = (0, 0, 0.17)
    P["head"] = head
    ho = []
    ho.append(box("t_stock", (0.46, 0.08, 0.07), mat("wood_light"), loc=(-0.04, 0, 0.0), bevel=0.012))
    ho.append(box("t_rail", (0.32, 0.03, 0.02), mat("wood_dark"), loc=(0.02, 0, 0.045)))
    ho.append(box("t_box", (0.16, 0.11, 0.1), mat("iron"), loc=(-0.2, 0, -0.01), bevel=0.015))
    ho.append(box("t_plate", (0.03, 0.18, 0.14), mat("iron"), loc=(0.12, 0, 0.0), bevel=0.01))
    for o in ho:
        o.parent = head
    eye = sphere("t_eye", 0.032, glow("#c97aff"), loc=(-0.2, -0.06, 0.0), segs=10, rings=6)
    eye.parent = head
    P["eye"] = eye
    eye2 = sphere("t_eyehot", 0.015, glow("#f4dcff"), loc=(-0.205, -0.085, 0.006), segs=8, rings=4)
    eye2.parent = head
    P["eye_hot"] = eye2
    # bow limbs at the front, spreading toward +/-Y (near = -Y)
    for side, sy in (("n", -1), ("f", 1)):
        lp = empty("t_limb_" + side)
        lp.parent = head
        lp.location = (0.2, 0, 0.01)
        P["limb_" + side] = lp
        pts = [Vector((0, 0, 0)), Vector((-0.02, sy * 0.1, 0)), Vector((-0.07, sy * 0.2, 0)), Vector((-0.12, sy * 0.25, 0))]
        lm = tube("t_limbm_" + side, catmull(pts, 3), [0.022, 0.02, 0.016, 0.012, 0.012, 0.011, 0.01, 0.01, 0.01, 0.01],
                  mat("steel_dark"), segs=6, ref=(0, 0, 1))
        lm.parent = lp
        tip = sphere("t_limbtip_" + side, 0.018, mat("brass"), loc=(-0.12, sy * 0.25, 0), segs=8, rings=4)
        tip.parent = lp
    # string: rebuilt by set_turret()
    bolt = []
    bolt.append(cyl("t_bolt", 0.012, 0.3, mat("wood_dark"), loc=(-0.1, 0, 0.065), rot=(0, 90, 0), segs=6))
    bolt.append(cone("t_bolthead", 0.028, 0.0, 0.07, mat("steel"), loc=(0.2, 0, 0.065), rot=(0, 90, 0), segs=6))
    bolt.append(prism("t_boltfl", [(0, 0), (0.06, 0), (0.02, 0.04)], 0.01, mat("cloth_purple"), loc=(-0.1, 0, 0.075)))
    bg = group("t_boltg", bolt)
    bg.parent = head
    P["bolt"] = bg
    fl = star("t_flash", 0.1, 0.035, 5, glow("#f0d0ff"))
    fl2 = star("t_flash2", 0.06, 0.025, 5, glow("#ffffff"), loc=(0, -0.01, 0))
    fg = group("t_flashg", [fl, fl2], loc=(0.3, -0.05, 0.06))
    fg.parent = head
    P["flash"] = fg
    P["root"] = root
    P["string"] = None
    return root, P


def set_turret(P, deploy=1.0, draw=1.0, recoil=0.0, bolt=True, flash=False, eye=1.0, bob=0.0):
    """deploy 0 = folded crate on the ground, 1 = standing.  draw 1 = string pulled back."""
    d = max(0.0, min(1.0, deploy))
    hub = P["hub"]
    hub.location = (0, 0, 0.1 + 0.27 * d + bob)
    for i in range(3):
        # 0 = legs folded up along the post (pointing up), 1 = splayed out
        sw = P["legsw%d" % i]
        sw.rotation_euler = (0, -math.radians(170 - 145 * d), 0)  # swing outward (local +X)
        sw.location = (0, 0, 0)
    for i in range(3):
        lp = P["leg%d" % i]
        lp.rotation_euler.z = math.radians((-30, -150, 90)[i])
    head = P["head"]
    head.location = (-recoil * 0.06, 0, 0.17 + 0.0 * d)
    head.rotation_euler = (0, math.radians(-4 * recoil), 0)
    for side, sy in (("n", -1), ("f", 1)):
        lp = P["limb_" + side]
        fold = (1 - d)
        lp.rotation_euler = (0, 0, math.radians(sy * 70 * fold))
    # string between limb tips -> nock point
    if P.get("string"):
        bpy.data.objects.remove(P["string"], do_unlink=True)
        P["string"] = None
    bpy.context.view_layer.update()
    tips = []
    for side in ("n", "f"):
        ob = bpy.data.objects.get("t_limbtip_" + side)
        tips.append(head.matrix_world.inverted() @ ob.matrix_world.translation)
    mid = (tips[0] + tips[1]) / 2
    nock = Vector((mid.x - 0.17 * draw * d, 0, mid.z + 0.05 * d))
    s = tube("t_string", [tips[0], nock, tips[1]], 0.008, mat("cloth_cream"), segs=5, ref=(0, 0, 1))
    s.parent = head
    P["string"] = s
    hide(P["bolt"], not bolt)
    hide(P["flash"], not flash)
    em = 0.6 + 0.4 * eye
    P["eye"].scale = (em, em, em)
    P["eye_hot"].hide_render = eye < 0.5
    hide(P["bolt"], not bolt or d < 0.6)


def m_wolf_trap(R=0.3):
    """Bear trap.  Returns (root, P) with jaw pivots 'jaw_n' (front) and 'jaw_f' (back) hinged on the X axis."""
    P = {}
    root = empty("wolf_trap")
    parts = []
    parts.append(cyl("wt_base", 0.13, 0.03, mat("iron_dark"), loc=(0, 0, 0.0), segs=16))
    parts.append(cyl("wt_pan", 0.1, 0.02, mat("iron"), loc=(0, 0, 0.03), segs=16))
    parts.append(box("wt_bar", (2 * R + 0.12, 0.06, 0.035), mat("iron_dark"), loc=(0, 0, 0.018), bevel=0.01))
    # springs: flattened loops extending outward on both sides
    for sx in (-1, 1):
        parts.append(torus("wt_spring%d" % sx, 0.09, 0.022, mat("steel_dark"), loc=(sx * (R + 0.16), 0, 0.03),
                           scale=(1.0, 0.55, 1), segs=16, rsegs=6))
        parts.append(box("wt_hinge%d" % sx, (0.06, 0.08, 0.07), mat("iron"), loc=(sx * R, 0, 0.04), bevel=0.012))
    for o in parts:
        o.parent = root
    # jaws: semicircle bars (radius R) with teeth; local frame: hinge axis = X, jaw extends toward -Y when open
    for side, sy in (("n", -1), ("f", 1)):
        pv = empty("wt_jaw_" + side)
        pv.parent = root
        pv.location = (0, 0, 0.045)
        P["jaw_" + side] = pv
        pts = []
        for k in range(17):
            a = math.pi * k / 16
            pts.append(Vector((R * math.cos(a), sy * R * math.sin(a), 0)))
        bar = tube("wt_jawbar_" + side, pts, 0.026, mat("iron"), segs=6, ref=(0, 0, 1))
        bar.parent = pv
        # teeth: point "up" (+Z) when the jaw is open/flat; interleaved between jaws
        nt = 7
        for k in range(nt):
            a = math.pi * (k + (0.5 if sy > 0 else 0.0) + 0.25) / (nt + 0.5)
            if a <= 0.12 or a >= math.pi - 0.12:
                continue
            c = Vector((R * math.cos(a), sy * R * math.sin(a), 0.01))
            tooth = cone("wt_tooth_%s%d" % (side, k), 0.034, 0.0, 0.1, mat("steel"), segs=4)
            tooth.location = c
            tooth.rotation_euler = (0, 0, a)
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
