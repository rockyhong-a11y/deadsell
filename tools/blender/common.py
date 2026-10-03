"""Shared Blender helpers for the 3D -> pixel-art sprite pipeline.

Run inside Blender:  blender -b --factory-startup -P tools/blender/<script>.py -- <args>

Conventions (every asset script relies on these):
  * 1 Blender unit = PX_PER_UNIT (32) game pixels.  A 1.75 u tall woman -> 56 px.
  * Characters stand on the origin, feet at z=0, FACING +X.  The game mirrors
    sprites for left-facing, so only right-facing frames are rendered.
  * The camera looks from -Y toward +Y (screen right = +X, screen up = +Z),
    optionally yawed toward the character's front for a slight 3/4 view.
  * Rigs are hierarchies of Empty "joints".  Rest pose = identity rotation, so
    a joint's only animated channel is usually its screen-plane swing.
    swing(deg) > 0  ==  counter-clockwise as seen by the camera.
      - limb hanging down: + swings it FORWARD (toward +X)
      - spine pointing up: + leans it BACKWARD
  * Toon materials output an exact flat colour (Emission of a constant ramp), so
    frames are crisp; render.filter_size = 0 and 1 TAA sample disable AA.
"""
import bpy
import math
import os
import sys
from mathutils import Vector, Euler

PX_PER_UNIT = 32

# --------------------------------------------------------------------------
# CLI


def script_args():
    """Arguments after `--` on the blender command line."""
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    return []


# --------------------------------------------------------------------------
# Scene


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.film_transparent = True
    sc.render.filter_size = 0.0
    sc.eevee.taa_render_samples = 1
    sc.eevee.use_soft_shadows = False
    sc.eevee.use_bloom = False
    sc.eevee.use_gtao = False
    sc.eevee.use_ssr = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.resolution_percentage = 100
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.07, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    return sc


def add_sun(direction=(0.6, -0.5, -0.8), energy=3.0, color=(1, 0.95, 0.9), name="Key"):
    """Sun light shining along `direction` (world)."""
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = energy
    ld.color = color
    ld.use_shadow = True
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    d = Vector(direction).normalized()
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def setup_sprite_camera(frame_w, frame_h, anchor_x, anchor_y, yaw_deg=20.0, pitch_deg=4.0,
                        px_per_unit=PX_PER_UNIT, target=(0.0, 0.0, 0.0)):
    """Orthographic camera whose pixel (anchor_x, anchor_y) (from top-left) is world `target`.

    Returns the camera object.  Frame size is in game pixels.
    """
    sc = bpy.context.scene
    sc.render.resolution_x = frame_w
    sc.render.resolution_y = frame_h
    cam = bpy.data.cameras.new("SpriteCam")
    cam.type = "ORTHO"
    cam.ortho_scale = max(frame_w, frame_h) / px_per_unit
    cam.clip_start = 0.01
    cam.clip_end = 200
    ob = bpy.data.objects.new("SpriteCam", cam)
    sc.collection.objects.link(ob)
    sc.camera = ob
    # Shift so that the anchor pixel lands on the target.
    big = max(frame_w, frame_h)
    cam.shift_x = (frame_w / 2 - anchor_x) / big
    cam.shift_y = (anchor_y - frame_h / 2) / big
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    dist = 30.0
    # Camera sits in front (-Y), rotated toward the character's front (+X).
    pos = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    ob.location = Vector(target) + pos
    ob.rotation_euler = (-pos).to_track_quat("-Z", "Y").to_euler()
    return ob


# --------------------------------------------------------------------------
# Materials


def _hex(c):
    if isinstance(c, str):
        c = c.lstrip("#")
        rgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    else:
        rgb = list(c[:3])
    # sRGB -> linear so the rendered PNG shows exactly the requested colour
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb]
    return (lin[0], lin[1], lin[2], 1.0)


_MAT_CACHE = {}


def toon(name, base, shadow=None, light=None, rim=None, rim_dir=(-1.0, 0.0, 0.35),
         shadow_at=0.32, light_at=0.78, emission=None, emission_strength=1.0):
    """Cel material: 3 flat bands (shadow/base/light) + optional directional rim.

    Colours are hex strings ('#aabbcc').  `emission` makes the part a flat
    unlit colour (eyes, flames, glowing runes).
    """
    key = (name,)
    if key in _MAT_CACHE:
        return _MAT_CACHE[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if emission:
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[0].default_value = _hex(emission)
        em.inputs[1].default_value = emission_strength
        nt.links.new(em.outputs[0], out.inputs[0])
        _MAT_CACHE[key] = m
        return m
    shadow = shadow or _darken(base, 0.55)
    light = light or _lighten(base, 0.25)
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diff.inputs[0].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = _hex(shadow)
    els[1].position = shadow_at
    els[1].color = _hex(base)
    e3 = els.new(light_at)
    e3.color = _hex(light)
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs[0], bw.inputs[0])
    nt.links.new(bw.outputs[0], ramp.inputs[0])
    col = ramp.outputs[0]
    if rim:
        # rim = facing-edge mask * (normal . rim_dir) thresholded
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs[0].default_value = 0.35
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        dot = nt.nodes.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        dot.inputs[1].default_value = Vector(rim_dir).normalized()
        nt.links.new(geo.outputs["Normal"], dot.inputs[0])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(lw.outputs["Facing"], mul.inputs[0])
        nt.links.new(dot.outputs["Value"], mul.inputs[1])
        thr = nt.nodes.new("ShaderNodeMath")
        thr.operation = "GREATER_THAN"
        thr.inputs[1].default_value = 0.42
        nt.links.new(mul.outputs[0], thr.inputs[0])
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MIX"
        mix.inputs[2].default_value = _hex(rim)
        nt.links.new(thr.outputs[0], mix.inputs[0])
        nt.links.new(col, mix.inputs[1])
        col = mix.outputs[0]
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[1].default_value = 1.0
    nt.links.new(col, em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    _MAT_CACHE[key] = m
    return m


def _darken(hexc, f):
    c = hexc.lstrip("#")
    r, g, b = [int(c[i:i + 2], 16) for i in (0, 2, 4)]
    # shift shadows slightly toward purple/blue like Dead Cells
    r, g, b = r * f * 0.92, g * f * 0.9, b * f * 1.08 + 6
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(v))) for v in (r, g, b))


def _lighten(hexc, f):
    c = hexc.lstrip("#")
    r, g, b = [int(c[i:i + 2], 16) for i in (0, 2, 4)]
    r, g, b = r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f * 0.8
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(v))) for v in (r, g, b))


# --------------------------------------------------------------------------
# Geometry primitives (all return a mesh Object, already linked, smooth shaded)


def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _finish(ob, mat, smooth=True):
    if mat is not None:
        ob.data.materials.append(mat)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def ellipsoid(name, size, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, rings=10):
    """Ellipsoid with full extents `size` = (sx, sy, sz)."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=0.5)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, mat)


def limb(name, length, r_top, r_bot, mat, depth_scale=1.0, segs=12):
    """Tapered round limb hanging DOWN from the origin (top at z=0, bottom at -length).

    Ends are capped with half-spheres so joints overlap cleanly.
    """
    bm_objs = []
    bpy.ops.mesh.primitive_cone_add(vertices=segs, radius1=r_bot, radius2=r_top, depth=length,
                                    location=(0, 0, -length / 2))
    bm_objs.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=8, radius=r_top, location=(0, 0, 0))
    bm_objs.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=8, radius=r_bot, location=(0, 0, -length))
    bm_objs.append(bpy.context.active_object)
    ob = join(bm_objs, name)
    ob.scale = (1, depth_scale, 1)
    # bake location too: the joined object's origin is the cone's (-length/2)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    return _finish(ob, mat)


def box(name, size, mat, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, smooth=False):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.rotation_euler = [math.radians(a) for a in rot]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = ob.modifiers.new("bev", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier="bev")
    return _finish(ob, mat, smooth)


def cone(name, r_bot, r_top, height, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, depth_scale=1.0):
    """Cone/frustum with its BASE at loc and tip/top at loc + height (local z)."""
    bpy.ops.mesh.primitive_cone_add(vertices=segs, radius1=r_bot, radius2=r_top, depth=height,
                                    location=(0, 0, height / 2))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (1, depth_scale, 1)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return _finish(ob, mat)


def blade(name, length, width, thickness, mat, tip=0.25, loc=(0, 0, 0)):
    """Flat blade along +Z from the origin (hilt end) with a pointed tip."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    w, t, L = width / 2, thickness / 2, length
    pts = [(-w, 0), (w, 0), (w, L * (1 - tip)), (0, L), (-w, L * (1 - tip))]
    front = [bm.verts.new((x, -t, z)) for x, z in pts]
    back = [bm.verts.new((x, t, z)) for x, z in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    _link(ob)
    ob.location = loc
    return _finish(ob, mat, smooth=False)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


# --------------------------------------------------------------------------
# Joint rig


class Rig:
    """Hierarchy of Empty joints with rigid mesh parts attached.

    rig.joint('hips', parent='root', at=(0,0,0.95))   # world rest position
    rig.attach(mesh_obj, 'hips', offset=(0,0,0.1))     # mesh in joint space
    rig.pose({'hips': 5, 'thigh_l': 30})               # screen-plane swings (deg)
    """

    def __init__(self, name="rig"):
        self.joints = {}
        self.world_rest = {}
        self.name = name
        self.root = self.joint("root", None, (0, 0, 0))

    def joint(self, name, parent, at):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.05
        _link(e)
        at = Vector(at)
        if parent:
            e.parent = self.joints[parent]
            e.location = at - self.world_rest[parent]
        else:
            e.location = at
        e.rotation_mode = "XYZ"
        self.joints[name] = e
        self.world_rest[name] = at
        return e

    def attach(self, ob, joint, offset=(0, 0, 0), rot=(0, 0, 0)):
        """Parent mesh `ob` (modelled around its own origin) to `joint`."""
        ob.parent = self.joints[joint]
        ob.location = Vector(offset)
        ob.rotation_euler = [math.radians(a) for a in rot]
        return ob

    def reset(self):
        for name, e in self.joints.items():
            e.rotation_euler = (0, 0, 0)
            e.scale = (1, 1, 1)
            if e.parent:
                e.location = self.world_rest[name] - self.world_rest[e.parent.name]
            else:
                e.location = self.world_rest[name]

    def pose(self, angles, offsets=None, scales=None, twists=None):
        """angles: {joint: swing_deg}. offsets: {joint: (dx,dy,dz)} added to rest.
        scales: {joint: (sx,sy,sz)}. twists: {joint: deg about world Z (turn toward camera)}."""
        self.reset()
        for j, a in angles.items():
            if j in self.joints:
                self.joints[j].rotation_euler.y = -math.radians(a)
        for j, t in (twists or {}).items():
            if j in self.joints:
                self.joints[j].rotation_euler.z = math.radians(t)
        for j, d in (offsets or {}).items():
            if j in self.joints:
                self.joints[j].location = self.joints[j].location + Vector(d)
        for j, s in (scales or {}).items():
            if j in self.joints:
                self.joints[j].scale = s

    def key(self, frame):
        for e in self.joints.values():
            e.keyframe_insert("rotation_euler", frame=frame)
            e.keyframe_insert("location", frame=frame)
            e.keyframe_insert("scale", frame=frame)


# --------------------------------------------------------------------------
# Animation helpers


def ease(t):
    """Smoothstep."""
    return t * t * (3 - 2 * t)


def lerp_pose(a, b, t):
    keys = set(a) | set(b)
    return {k: a.get(k, 0.0) + (b.get(k, 0.0) - a.get(k, 0.0)) * t for k in keys}


def lerp_vec_dict(a, b, t):
    keys = set(a) | set(b)
    out = {}
    for k in keys:
        va = a.get(k, (0, 0, 0))
        vb = b.get(k, (0, 0, 0))
        out[k] = tuple(va[i] + (vb[i] - va[i]) * t for i in range(3))
    return out


def sample_keys(keys, t, easing=ease):
    """keys: list of (time 0..1, value-dict).  Piecewise eased interpolation of swing dicts."""
    if t <= keys[0][0]:
        return dict(keys[0][1])
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            u = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            return lerp_pose(p0, p1, easing(u))
    return dict(keys[-1][1])


def render_animation(rig, name, frames, pose_fn, out_dir, extra_fn=None):
    """Render `frames` frames of animation `name` into out_dir/name_###.png.

    pose_fn(i, n) -> (angles, offsets, scales[, twists])  called for i in range(frames).
    extra_fn(i, n) optional: mutate other objects (visibility of weapon/FX parts, etc).
    Uses keyframes + one animation render call (fast).
    """
    sc = bpy.context.scene
    for e in rig.joints.values():
        e.animation_data_clear()
    for i in range(frames):
        res = pose_fn(i, frames)
        angles, offsets, scales = res[0], res[1], res[2]
        twists = res[3] if len(res) > 3 else None
        rig.pose(angles, offsets, scales, twists)
        rig.key(i + 1)
        if extra_fn:
            extra_fn(i, frames, i + 1)
    # constant interpolation: each frame shows exactly the computed pose
    for e in rig.joints.values():
        if e.animation_data and e.animation_data.action:
            for fc in e.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"
    sc.frame_start = 1
    sc.frame_end = frames
    os.makedirs(out_dir, exist_ok=True)
    sc.render.filepath = os.path.join(out_dir, name + "_")
    bpy.ops.render.render(animation=True)
    # Blender writes name_0001.png ...; normalise to name_000.png
    for i in range(frames):
        src = os.path.join(out_dir, "%s_%04d.png" % (name, i + 1))
        dst = os.path.join(out_dir, "%s_%03d.png" % (name, i))
        if os.path.exists(src):
            os.replace(src, dst)


def keyed_visibility(ob, frame, visible):
    ob.hide_render = not visible
    ob.keyframe_insert("hide_render", frame=frame)
    for fc in (ob.animation_data.action.fcurves if ob.animation_data and ob.animation_data.action else []):
        for kp in fc.keyframe_points:
            kp.interpolation = "CONSTANT"
