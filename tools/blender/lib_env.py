"""Environment (tiles / parallax) helpers for Blender scripts.

Environment art is rendered as *G-buffers* instead of final colours: every
object shares one emission material whose output is switched between two
passes, and `tools/pack/post_*.py` turns the passes into toon-shaded pixel art
with a per-biome palette (so palettes, coloured lights and fog can be tuned in
Python without re-rendering).

  <name>_n.png   RGB = world normal * 0.5 + 0.5          A = coverage (hard, no AA)
  <name>_d.png   R = depth (0 = nearest .. 255 = farthest, range per render)
                 G = per-object random id (0..255)  -> stone / plank identity
                 B = material id (see MAT below)

Conventions
  * Front orthographic camera looking along +Y: screen right = +X, screen up = +Z.
  * Tiles: 1 Blender unit = 1 tile = 24 px (PPU).  Backgrounds pass their own ppu.
  * Everything is rendered with EEVEE, 1 sample, filter 0 -> exact pixel centres.
    Periodic (seamless) textures are made by duplicating geometry at +-period.
"""
import bpy
import bmesh
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

PPU = 24
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ENV_OUT = os.path.join(ROOT, "build", "env")

# material ids (B channel of the data pass); post_*.py maps them to palettes
MAT = {
    "stone": 1, "stone2": 2, "mortar": 3, "back": 4, "back2": 5, "backmortar": 6,
    "lip": 7, "wood": 8, "iron": 9, "moss": 10, "cloth": 11, "glow": 12, "brick": 13,
    "rubble": 14, "bronze": 15, "rope": 16, "void": 17, "trim": 18, "gold": 19,
    "far": 20, "far2": 21, "roof": 22, "leaf": 23, "bone": 24, "crack": 25,
}

_G = {}


# --------------------------------------------------------------------------
# scene + G-buffer material


def new_scene():
    sc = common.reset_scene()
    sc.view_settings.view_transform = "Raw"
    sc.render.dither_intensity = 0.0
    _G.clear()
    m = bpy.data.materials.new("GBUF")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nrm = nt.nodes.new("ShaderNodeVectorMath")
    nrm.operation = "MULTIPLY_ADD"
    nrm.inputs[1].default_value = (0.5, 0.5, 0.5)
    nrm.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(geo.outputs["Normal"], nrm.inputs[0])
    cd = nt.nodes.new("ShaderNodeCameraData")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.clamp = True
    nt.links.new(cd.outputs["View Z Depth"], mr.inputs[0])
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_type = "OBJECT"
    at.attribute_name = "matid"
    div = nt.nodes.new("ShaderNodeMath")
    div.operation = "DIVIDE"
    div.inputs[1].default_value = 255.0
    nt.links.new(at.outputs["Fac"], div.inputs[0])
    rid = nt.nodes.new("ShaderNodeAttribute")
    rid.attribute_type = "OBJECT"
    rid.attribute_name = "rid"
    div2 = nt.nodes.new("ShaderNodeMath")
    div2.operation = "DIVIDE"
    div2.inputs[1].default_value = 255.0
    nt.links.new(rid.outputs["Fac"], div2.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(mr.outputs[0], comb.inputs[0])
    nt.links.new(div2.outputs[0], comb.inputs[1])
    nt.links.new(div.outputs[0], comb.inputs[2])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[1].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs[0])
    _G.update(mat=m, nt=nt, em=em, nrm=nrm, data=comb, mr=mr, rid=0)
    return sc


def gmat():
    return _G["mat"]


def tag(ob, matid, rid=None):
    """Assign the G-buffer material + material id (+ object id) to an object."""
    if isinstance(matid, str):
        matid = MAT[matid]
    ob["matid"] = int(matid)
    if rid is None:
        _G["rid"] = (_G["rid"] * 97 + 61) % 251 + 1
        rid = _G["rid"]
    ob["rid"] = int(rid) % 256
    ob.data.materials.clear()
    ob.data.materials.append(gmat())
    return ob


def clear():
    """Remove every mesh object (keeps material / camera)."""
    for ob in list(bpy.data.objects):
        if ob.type in ("MESH", "CURVE", "EMPTY"):
            bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def _camera():
    sc = bpy.context.scene
    if sc.camera is None:
        cam = bpy.data.cameras.new("EnvCam")
        cam.type = "ORTHO"
        cam.clip_start = 0.1
        cam.clip_end = 500
        ob = bpy.data.objects.new("EnvCam", cam)
        sc.collection.objects.link(ob)
        sc.camera = ob
    return sc.camera


CAM_Y = -100.0


def render(path_prefix, x0, ztop, w_px, h_px, ppu=PPU, near=-4.0, far=12.0):
    """Render world rect x in [x0, x0+w/ppu], z in [ztop-h/ppu, ztop] (front ortho).

    near/far: world-Y range mapped to depth 0..1 (objects outside are clamped).
    Writes <path_prefix>_n.png and <path_prefix>_d.png.
    """
    sc = bpy.context.scene
    sc.render.resolution_x = int(w_px)
    sc.render.resolution_y = int(h_px)
    cam = _camera()
    cam.data.ortho_scale = max(w_px, h_px) / ppu
    cam.data.shift_x = 0
    cam.data.shift_y = 0
    cam.location = (x0 + w_px / ppu / 2.0, CAM_Y, ztop - h_px / ppu / 2.0)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    mr = _G["mr"]
    mr.inputs[1].default_value = near - CAM_Y
    mr.inputs[2].default_value = far - CAM_Y
    os.makedirs(os.path.dirname(path_prefix), exist_ok=True)
    nt, em = _G["nt"], _G["em"]
    for suffix, src in (("_n", _G["nrm"]), ("_d", _G["data"])):
        nt.links.new(src.outputs[0], em.inputs[0])
        sc.render.filepath = path_prefix + suffix + ".png"
        bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------------------
# geometry


def _obj_from_bm(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def block(w, h, d, loc, matid="stone", bevel=0.06, chip=0.0, seed=0, rot=(0, 0, 0),
          segs=1, rid=None, taper=0.0):
    """Chamfered box (w along X, h along Z, d along Y) centred on loc.

    chip > 0 jitters vertices for a hand-cut / broken stone look.
    taper > 0 shrinks the top face (for battlements, cliffs).
    """
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co
        k = 1.0 - taper if z > 0 else 1.0
        v.co = (x * w * k, y * d, z * h)
    if bevel > 0:
        b = min(bevel, w * 0.45, h * 0.45, d * 0.45)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=segs, affect="EDGES",
                        profile=0.5, clamp_overlap=True)
    if chip > 0:
        for v in bm.verts:
            v.co.x += rnd.uniform(-chip, chip)
            v.co.z += rnd.uniform(-chip, chip)
            if v.co.y < 0:
                v.co.y += rnd.uniform(-chip, chip) * 0.6
    ob = _obj_from_bm(bm, "blk")
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    return tag(ob, matid, rid)


def cylinder(r, h, loc, matid="stone", segs=20, axis="Z", rid=None, r2=None, cap=True):
    """Cylinder / frustum centred on loc along axis (Z = vertical, X = horizontal)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs,
                          radius1=r, radius2=r if r2 is None else r2, depth=h)
    ob = _obj_from_bm(bm, "cyl")
    if axis == "X":
        ob.rotation_euler = (0, math.pi / 2, 0)
    elif axis == "Y":
        ob.rotation_euler = (math.pi / 2, 0, 0)
    ob.location = loc
    return tag(ob, matid, rid)


def torus(R, r, loc, rot=(0, 0, 0), matid="iron", segs=12, rsegs=6, rid=None, sx=1.0):
    bm = bmesh.new()
    for i in range(segs):
        a = 2 * math.pi * i / segs
        for j in range(rsegs):
            b = 2 * math.pi * j / rsegs
            x = (R + r * math.cos(b)) * math.cos(a) * sx
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            bm.verts.new((x, y, z))
    bm.verts.ensure_lookup_table()
    for i in range(segs):
        for j in range(rsegs):
            a = i * rsegs + j
            b = ((i + 1) % segs) * rsegs + j
            c = ((i + 1) % segs) * rsegs + (j + 1) % rsegs
            d = i * rsegs + (j + 1) % rsegs
            bm.faces.new((bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]))
    bm.normal_update()
    ob = _obj_from_bm(bm, "torus")
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    for p in ob.data.polygons:
        p.use_smooth = True
    return tag(ob, matid, rid)


def chain(x, ztop, zbot, link=0.16, thick=0.035, y=0.0, matid="iron", rid=None, sway=0.0):
    """Vertical chain of interlocking links (alternately face-on / edge-on) from ztop
    down to zbot.  `link` = outer length of one link."""
    obs = []
    R = link / 2 - thick
    step = 2 * R - thick * 0.6
    n = max(1, int((ztop - zbot - link) / step) + 1)
    for i in range(n):
        z = ztop - link / 2 - i * step
        xx = x + sway * math.sin(i * 0.5)
        rot = (90, 0, 0) if i % 2 == 0 else (90, 0, 90)
        obs.append(torus(R, thick, (xx, y, z), rot=rot, matid=matid, rid=rid, sx=0.6))
    return obs


def lathe(profile, loc, matid="bronze", segs=24, rid=None):
    """Surface of revolution around Z. profile = [(radius, z), ...] top -> bottom."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(bm, "lathe")
    ob.location = loc
    for p in ob.data.polygons:
        p.use_smooth = True
    return tag(ob, matid, rid)


def prism(points, y0, y1, matid="stone", rid=None, loc=(0, 0, 0)):
    """Extrude a convex-or-not polygon given in the XZ plane (list of (x,z)) from y0 to y1."""
    bm = bmesh.new()
    f = [bm.verts.new((x, y0, z)) for x, z in points]
    b = [bm.verts.new((x, y1, z)) for x, z in points]
    try:
        bm.faces.new(f)
        bm.faces.new(list(reversed(b)))
    except ValueError:
        pass
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], f[j], b[j], b[i]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(bm, "prism")
    ob.location = loc
    return tag(ob, matid, rid)


def arch_ring(cx, cz, r_in, r_out, y0, y1, n=9, matid="stone", gap=0.02, chip=0.01, seed=0,
              a0=0.0, a1=180.0, rid_base=None):
    """Semicircular ring of wedge stones (voussoirs) centred at (cx, cz)."""
    rnd = random.Random(seed)
    obs = []
    for i in range(n):
        t0 = math.radians(a0 + (a1 - a0) * i / n) + gap / max(r_in, 0.1)
        t1 = math.radians(a0 + (a1 - a0) * (i + 1) / n) - gap / max(r_in, 0.1)
        ri = r_in
        ro = r_out + (0.06 if i == n // 2 else 0.0)
        pts = [(cx + ri * math.cos(t0), cz + ri * math.sin(t0)),
               (cx + ro * math.cos(t0), cz + ro * math.sin(t0)),
               (cx + ro * math.cos(t1), cz + ro * math.sin(t1)),
               (cx + ri * math.cos(t1), cz + ri * math.sin(t1))]
        pts = [(x + rnd.uniform(-chip, chip), z + rnd.uniform(-chip, chip)) for x, z in pts]
        ob = prism(pts, y0, y1, matid=matid,
                   rid=None if rid_base is None else rid_base + i * 7)
        # chamfer the front a little so voussoirs read separately
        mod = ob.modifiers.new("bev", "BEVEL")
        mod.width = 0.03
        mod.segments = 1
        obs.append(ob)
    return obs


def periodic(make, x, z, w, h, px, pz):
    """Call make(dx, dz) for the original and every copy needed so that an object
    with extents [x-w/2, x+w/2] x [z-h/2, z+h/2] tiles with period (px, pz).
    px/pz may be None (no repetition on that axis)."""
    xs = [0.0]
    zs = [0.0]
    if px:
        if x - w / 2 < 0:
            xs.append(px)
        if x + w / 2 > px:
            xs.append(-px)
    if pz:
        if z - h / 2 < 0:
            zs.append(pz)
        if z + h / 2 > pz:
            zs.append(-pz)
    out = []
    for dx in xs:
        for dz in zs:
            out.append(make(dx, dz))
    return out


def courses(rnd, period_w, period_h, heights, lengths, unit=1.0 / PPU):
    """Random running-bond layout that tiles with (period_w, period_h) (pixels).

    heights/lengths: (min_px, max_px).  Returns [(x_px, z_px, w_px, h_px), ...] with
    (x, z) = bottom-left corner, z measured upward from the period bottom.
    """
    rows = []
    total = 0
    while True:
        hh = rnd.randint(*heights)
        if total + hh >= period_h - heights[0]:
            hh = period_h - total
            rows.append(hh)
            break
        rows.append(hh)
        total += hh
    out = []
    z = 0
    for hh in rows:
        x0 = rnd.randint(0, lengths[1])
        x = 0
        cuts = [x0 % period_w]
        while True:
            L = rnd.randint(*lengths)
            nxt = cuts[-1] + L
            if nxt >= cuts[0] + period_w - lengths[0]:
                break
            cuts.append(nxt)
        for i, c in enumerate(cuts):
            e = cuts[i + 1] if i + 1 < len(cuts) else cuts[0] + period_w
            out.append((c, z, e - c, hh))
        z += hh
    return out


def save_meta(path, data):
    import json
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1)
