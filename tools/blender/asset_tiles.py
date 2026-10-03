"""Tile-set source renders (G-buffers) for the three biomes.

blender -b --factory-startup -P tools/blender/asset_tiles.py [-- biome ...]

Writes build/env/tiles/<biome>/<group>_{n,d}.png + pieces.json; then
tools/pack/post_tiles.py shades them and assembles public/assets/tiles/<biome>.png/.json.

Scale: 1 Blender unit = 1 tile = 24 px.  Front orthographic view (lib_env).
A solid cell occupies world [x, x+1] x [z, z+1]; its wall face is the plane y = 0
(the camera looks along +Y, so y < 0 is "in front of the wall").
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_env as E  # noqa: E402

FILL_W, FILL_H = 8, 4          # fill / back-wall macro size in cells (periodic)
LIP_N = 8                      # top lip strip length (periodic, cells)
SIDE_N = 4                     # side quoin strip (cells)
BOT_N = 8                      # underside strip (cells)
U = 1.0 / E.PPU                # one pixel in Blender units


def bseed(b):
    """Deterministic per-biome seed (str hash() is randomised per process)."""
    return sum(ord(c) * (i + 1) for i, c in enumerate(b))


def out(biome, name):
    return os.path.join(E.ENV_OUT, "tiles", biome, name)


class Group:
    """A render made of named pieces laid out on a cell grid (with margins for pads)."""

    def __init__(self, biome, name, w_cells, h_cells, margin_px=12):
        self.biome, self.name = biome, name
        self.w, self.h, self.m = w_cells, h_cells, margin_px
        self.pieces = {}

    def piece(self, name, cx, cz, w=1, h=1):
        """Register piece occupying world cells [cx, cx+w] x [cz, cz+h]."""
        left = int(round(cx * E.PPU)) + self.m
        top = int(round((self.h - (cz + h)) * E.PPU)) + self.m
        self.pieces[name] = [left, top, int(w * E.PPU), int(h * E.PPU)]

    def render(self, meta, near=-4.0, far=12.0):
        m = self.m * U
        E.render(out(self.biome, self.name), -m, self.h + m, self.w * E.PPU + 2 * self.m,
                 self.h * E.PPU + 2 * self.m, near=near, far=far)
        meta["groups"][self.name] = {"pieces": self.pieces, "margin": self.m}


# --------------------------------------------------------------------------
# masonry walls (periodic macros)


def masonry(seed, heights, lengths, gap_px, depth, bevel_px, chip_px, matids, rot_jit=1.5,
            depth_jit_px=0.8, segs=2, mortar="mortar", mortar_y=None, w_cells=FILL_W,
            h_cells=FILL_H, x0=0.0, z0=0.0):
    rnd = random.Random(seed)
    pw, ph = w_cells * E.PPU, h_cells * E.PPU
    lay = E.courses(rnd, pw, ph, heights, lengths)
    for (x, z, w, h) in lay:
        cx, cz = (x + w / 2) * U, (z + h / 2) * U
        sw, sh = (w - gap_px) * U, (h - gap_px) * U
        mat = matids[rnd.randrange(len(matids))]
        s = rnd.randrange(1 << 30)
        rid = rnd.randrange(1, 255)
        dy = rnd.uniform(-depth_jit_px, depth_jit_px) * U
        rot = (rnd.uniform(-rot_jit, rot_jit), rnd.uniform(-rot_jit * 0.6, rot_jit * 0.6),
               rnd.uniform(-rot_jit, rot_jit))

        def mk(ddx, ddz, cx=cx, cz=cz, sw=sw, sh=sh, mat=mat, s=s, rid=rid, dy=dy, rot=rot):
            return E.block(sw, sh, depth, (x0 + cx + ddx, depth / 2 + dy, z0 + cz + ddz),
                           matid=mat, bevel=bevel_px * U, chip=chip_px * U, seed=s, rot=rot,
                           rid=rid, segs=segs)
        E.periodic(mk, cx, cz, sw + 0.1, sh + 0.1, w_cells, h_cells)
    my = mortar_y if mortar_y is not None else bevel_px * U + 2.5 * U
    E.block(w_cells + 4, h_cells + 4, 0.1, (x0 + w_cells / 2, my + 0.05, z0 + h_cells / 2),
            matid=mortar, bevel=0, rid=0)
    return lay


# --------------------------------------------------------------------------
# profile extrusions (lips)


def extrude(profile_px, x0, x1, ztop, matid, rid, end0=True, end1=True, shrink=1.2, seed=0,
            chip=0.0):
    """Extrude a (y_px, z_px) profile along X from x0 to x1 (units).  z is relative to
    ztop.  Ends flagged True get a chamfered (shrunk) cap; middle cross-sections stay
    exactly canonical so cut points tile seamlessly."""
    import bmesh
    rnd = random.Random(seed)
    cy = sum(p[0] for p in profile_px) / len(profile_px)
    cz = sum(p[1] for p in profile_px) / len(profile_px)
    secs = []
    e = 2.0 * U
    xs = [(x0, end0), (x0 + e, False), (x1 - e, False), (x1, end1)]
    for (x, is_end) in xs:
        pts = []
        for (py, pz) in profile_px:
            if is_end:
                py = cy + (py - cy) * (1 - shrink / 8.0)
                pz = cz + (pz - cz) * (1 - shrink / 8.0)
                ddx = rnd.uniform(-chip, chip)
                ddz = rnd.uniform(-chip, chip)
            else:
                ddx = ddz = 0.0
            pts.append((x + ddx * U, py * U, ztop + pz * U + ddz * U))
        secs.append(pts)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in s] for s in secs]
    n = len(profile_px)
    for k in range(len(vs) - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((vs[k][i], vs[k][j], vs[k + 1][j], vs[k + 1][i]))
    bm.faces.new(vs[0])
    bm.faces.new(list(reversed(vs[-1])))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = E._obj_from_bm(bm, "lip")
    return E.tag(ob, matid, rid)


def lip_joints(rnd, n_cells, lo=18, hi=40, avoid=7):
    """Joint x positions (px) of a periodic lip, never within `avoid` px of a cell edge."""
    period = n_cells * E.PPU
    for _ in range(200):
        js = []
        x = rnd.randint(avoid, E.PPU - avoid)
        start = x
        while True:
            js.append(x)
            x += rnd.randint(lo, hi)
            while avoid > x % E.PPU or x % E.PPU > E.PPU - avoid:
                x += 1
            if x >= start + period - lo:
                break
        if start + period - js[-1] >= lo:
            return js
    return [avoid + 3]


# --------------------------------------------------------------------------
# biome parameters

BIOMES = {
    "prison": dict(
        fill=dict(seed=11, heights=(11, 19), lengths=(18, 46), gap_px=1.6, depth=0.5, bevel_px=3.5,
                  chip_px=1.8, matids=["stone", "stone", "stone", "stone", "stone2"], rot_jit=2.5),
        back=dict(seed=21, heights=(8, 12), lengths=(14, 30), gap_px=1.4, depth=0.4, bevel_px=2.0,
                  chip_px=1.0, matids=["back", "back", "back", "back2"], rot_jit=1.5,
                  mortar="backmortar"),
        # lip profile (y px, z px): front faces toward -y; top at z = 0
        lip=[(8, 0), (-1.5, 0), (-4.5, -3.5), (-4.5, -8.5), (-3.5, -10), (8, -10)],
        lip_chip=1.2, plat="wood", quoin=(8, 12), stone_chip=1.6,
    ),
    "ramparts": dict(
        fill=dict(seed=12, heights=(11, 13), lengths=(22, 38), gap_px=1.4, depth=0.5, bevel_px=2.2,
                  chip_px=0.9, matids=["stone", "stone", "stone", "stone2"], rot_jit=1.2),
        back=dict(seed=22, heights=(11, 13), lengths=(24, 40), gap_px=1.3, depth=0.4, bevel_px=1.6,
                  chip_px=0.6, matids=["back", "back", "back2"], rot_jit=0.8, mortar="backmortar"),
        lip=[(8, 0), (-1.5, 0), (-4, -3), (-4, -9.5), (-3, -11), (8, -11)],
        lip_chip=0.6, plat="wood", quoin=(9, 13), stone_chip=0.8,
    ),
    "tower": dict(
        fill=dict(seed=13, heights=(7, 9), lengths=(14, 22), gap_px=1.5, depth=0.4, bevel_px=1.8,
                  chip_px=1.0, matids=["brick", "brick", "brick", "stone2"], rot_jit=1.5),
        back=dict(seed=23, heights=(6, 7), lengths=(12, 18), gap_px=1.3, depth=0.3, bevel_px=1.3,
                  chip_px=0.7, matids=["back", "back", "back2"], rot_jit=1.0, mortar="backmortar"),
        lip=[(8, 0), (-1, 0), (-3.5, -3), (-3.5, -8), (-2.5, -9.5), (8, -9.5)],
        lip_chip=0.8, plat="iron", quoin=(8, 11), stone_chip=1.0,
    ),
}


# --------------------------------------------------------------------------
# pieces


def build_lip(biome, P, meta):
    """Periodic top lip strip (LIP_N cells) + outer/inner lip caps."""
    rnd = random.Random(bseed(biome) + 5)
    E.clear()
    g = Group(biome, "lip", LIP_N + 9, 1, margin_px=12)
    prof = P["lip"]
    js = lip_joints(rnd, LIP_N)
    period = LIP_N * E.PPU
    for i, j0 in enumerate(js):
        j1 = js[i + 1] if i + 1 < len(js) else js[0] + period
        rid = 10 + i * 13
        for d in (-period, 0, period):
            a, b = (j0 + 0.6 + d) * U, (j1 - 0.6 + d) * U
            if b < -0.6 or a > LIP_N + 0.6:
                continue
            extrude(prof, a, b, 1.0, "lip", rid, seed=rid, chip=P["lip_chip"])
    for k in range(LIP_N):
        g.piece("top%d" % k, k, 0)
    base = LIP_N + 1
    # outer tl: lip end protruding 3 px past the left face, canonical cut at x = 12 px
    extrude(prof, base - 3.5 * U, base + 12 * U, 1.0, "lip", 200, end0=True, end1=False,
            seed=3, chip=P["lip_chip"])
    g.piece("outer_tl", base, 0)
    b2 = base + 2
    extrude(prof, b2 + 12 * U, b2 + 1 + 3.5 * U, 1.0, "lip", 201, end0=False, end1=True,
            seed=4, chip=P["lip_chip"])
    g.piece("outer_tr", b2, 0)
    # inner tl: lip arriving from the left neighbour ends 5 px into this cell (tucked)
    b3 = base + 4
    extrude(prof, b3, b3 + 5 * U, 1.0, "lip", 202, end0=False, end1=True, seed=5, shrink=2.0)
    g.piece("inner_tl", b3, 0)
    b4 = base + 6
    extrude(prof, b4 + 19 * U, b4 + 1, 1.0, "lip", 203, end0=True, end1=False, seed=6,
            shrink=2.0)
    g.piece("inner_tr", b4, 0)
    g.render(meta)


def rough(w_px, h_px, d, loc, matid, seed, chip, bevel=2.5, rid=None, rot=None, segs=2):
    rnd = random.Random(seed)
    if rot is None:
        rot = (rnd.uniform(-2, 2), rnd.uniform(-1.5, 1.5), rnd.uniform(-3, 3))
    return E.block(w_px * U, h_px * U, d, loc, matid=matid, bevel=bevel * U, chip=chip * U,
                   seed=seed, rot=rot, rid=rid, segs=segs)


def build_sides(biome, P, meta):
    """Quoin columns for exposed left / right faces (+ bottom outer corner caps).

    Cell-jointed: every block stays inside its cell vertically, so any variant
    stacks on any other.  Blocks protrude 1.5-3 px outside the cell and 1.5 px in
    front of the wall."""
    rnd = random.Random(bseed(biome) + 7)
    E.clear()
    g = Group(biome, "side", 4 * SIDE_N + 4, 1, margin_px=12)
    qmin, qmax = P["quoin"]
    ch = P["stone_chip"]
    for side in ("left", "right"):
        for k in range(SIDE_N):
            cx = (k * 2) + (0 if side == "left" else 2 * SIDE_N)
            if rnd.random() < 0.65:
                cut = rnd.randint(9, 15)
                parts = [(0, cut), (cut, 24)]
            else:
                parts = [(0, 24)]
            for (z0, z1) in parts:
                w = rnd.randint(qmin, qmax)
                out_px = rnd.uniform(1.5, 3.0)
                hh = (z1 - z0) - 1.4
                zc = 1 - (z0 + z1) / 2 * U
                if side == "left":
                    xc = cx + (-out_px + w / 2) * U
                else:
                    xc = cx + 1 + (out_px - w / 2) * U
                rough(w, hh, 0.5, (xc, 0.25 - 1.5 * U, zc), "stone", rnd.randrange(1 << 20), ch,
                      bevel=2.6, rid=rnd.randrange(1, 255))
            g.piece("%s%d" % (side, k), cx, 0)
    b = 4 * SIDE_N
    for i, side in enumerate(("bl", "br")):
        cx = b + i * 2
        w, hh = 12, 11
        if side == "bl":
            xc = cx + (-3 + w / 2) * U
        else:
            xc = cx + 1 + (3 - w / 2) * U
        rough(w, hh, 0.5, (xc, 0.25 - 2 * U, (-3 + hh / 2) * U), "stone", 77 + i, ch,
              bevel=2.6, rid=150 + i)
        g.piece("outer_" + side, cx, 0)
    g.render(meta)


def build_bottom(biome, P, meta):
    """Underside (ceiling) strip: rough stones hanging 1-4 px below the cell (cell-jointed)."""
    rnd = random.Random(bseed(biome) + 9)
    E.clear()
    g = Group(biome, "bottom", 2 * BOT_N + 4, 1, margin_px=12)
    ch = P["stone_chip"]
    for k in range(BOT_N):
        cx = 2 * k
        cuts = [0]
        if rnd.random() < 0.7:
            cuts.append(rnd.randint(8, 16))
        cuts.append(24)
        for a, b in zip(cuts, cuts[1:]):
            hh = rnd.randint(7, 10)
            drop = rnd.uniform(1.0, 3.5)
            rough(b - a - 1.4, hh, 0.5, (cx + (a + b) / 2 * U, 0.25 - 1 * U, (hh / 2 - drop) * U),
                  "stone", rnd.randrange(1 << 20), ch, bevel=2.4, rid=rnd.randrange(1, 255))
        g.piece("bottom%d" % k, cx, 0)
    cx = 2 * BOT_N
    rough(8, 8, 0.5, (cx + 2 * U, 0.25 - 1 * U, 2 * U), "stone", 501, ch, bevel=2.0, rid=91)
    g.piece("inner_bl", cx, 0)
    cx += 2
    rough(8, 8, 0.5, (cx + 1 - 2 * U, 0.25 - 1 * U, 2 * U), "stone", 502, ch, bevel=2.0, rid=92)
    g.piece("inner_br", cx, 0)
    g.render(meta)


def build_topdeco(biome, P, meta):
    """Things sitting on top of a lip (pebbles, bones, broken slabs).  Each fits in one
    cell width; they rise up to 10 px above the cell top."""
    rnd = random.Random(bseed(biome) + 11)
    E.clear()
    g = Group(biome, "topdeco", 12, 1, margin_px=12)
    for k in range(6):
        cx = 2 * k
        kind = k % 3
        if kind == 0:   # pebbles
            for i in range(rnd.randint(2, 4)):
                w = rnd.randint(3, 6)
                h = rnd.randint(2, 4)
                x = rnd.randint(3, 20)
                rough(w, h, 0.15, (cx + x * U, -0.05, 1 + (h / 2 - 0.5) * U), "rubble",
                      rnd.randrange(999), 0.5, bevel=1.0, rid=rnd.randrange(1, 255))
        elif kind == 1:  # broken slab chunk leaning
            w = rnd.randint(8, 12)
            rough(w, 5, 0.2, (cx + rnd.randint(7, 15) * U, -0.05, 1 + 2 * U), "rubble",
                  rnd.randrange(999), 0.8, bevel=1.2, rid=rnd.randrange(1, 255),
                  rot=(0, rnd.choice([-14, 12]), 0))
            rough(3, 3, 0.1, (cx + rnd.randint(3, 20) * U, -0.1, 1 + 1 * U), "rubble", 5, 0.4,
                  bevel=0.8, rid=33)
        else:
            if biome == "prison":   # skull + bone
                x = cx + rnd.randint(8, 15) * U
                E.lathe([(0.0, 0.26), (0.11, 0.24), (0.16, 0.16), (0.17, 0.08), (0.13, 0.0),
                         (0.08, -0.02), (0.0, -0.02)], (x, -0.1, 1 + 0.02), matid="bone",
                        segs=12, rid=60)
                E.block(10 * U, 2 * U, 0.08, (cx + rnd.randint(5, 18) * U, -0.12, 1 + 1 * U),
                        matid="bone", bevel=0.8 * U, rot=(0, 12, 0), rid=61)
            else:
                for i in range(3):
                    rough(rnd.randint(4, 7), rnd.randint(3, 5), 0.15,
                          (cx + rnd.randint(4, 19) * U, -0.06, 1 + 1.5 * U), "rubble",
                          rnd.randrange(999), 0.6, bevel=1.2, rid=rnd.randrange(1, 255))
        g.piece("topdeco%d" % k, cx, 0)
    g.render(meta)


def build_platforms(biome, P, meta):
    """One-way platform pieces: l, m0..m2, r, single (walk surface = cell top)."""
    rnd = random.Random(bseed(biome) + 13)
    E.clear()
    g = Group(biome, "platform", 12, 1, margin_px=12)
    names = ["l", "m0", "m1", "m2", "r", "single"]
    for k, nm in enumerate(names):
        cx = 2 * k
        x0 = 0 if nm not in ("l", "single") else 1
        x1 = 24 if nm not in ("r", "single") else 23
        if P["plat"] == "wood":
            th = 6 if biome == "prison" else 7
            parts = [(x0, 13), (13, x1)] if nm == "m1" else [(x0, x1)]
            for (a, b) in parts:
                E.block((b - a - 0.8) * U, th * U, 0.55, (cx + (a + b) / 2 * U, -0.05,
                                                         1 - th / 2 * U),
                        matid="wood", bevel=1.2 * U, chip=0.5 * U, seed=rnd.randrange(999),
                        rot=(0, rnd.uniform(-0.6, 0.6), 0), rid=rnd.randrange(1, 255), segs=1)
                for xx in (a + 2.5, b - 2.5):   # nails
                    E.cylinder(0.7 * U, 0.1, (cx + xx * U, -0.36, 1 - th / 2 * U), matid="iron",
                               segs=6, axis="Y", rid=7)
            if nm in ("m0", "single", "m2"):
                bx = 12 if nm != "m2" else 6
                E.block(3 * U, (th + 1.2) * U, 0.6, (cx + bx * U, -0.07, 1 - th / 2 * U),
                        matid="iron", bevel=0.6 * U, rid=8)
            if nm in ("l", "single"):
                E.block(3 * U, 14 * U, 0.3, (cx + 5 * U, 0.05, 1 - (th + 7) * U), matid="wood",
                        bevel=0.8 * U, rot=(0, -28, 0), rid=21)
                E.block(5 * U, 3 * U, 0.4, (cx + 4 * U, -0.1, 1 - (th + 1.5) * U), matid="iron",
                        bevel=0.6 * U, rid=22)
            if nm in ("r", "single"):
                E.block(3 * U, 14 * U, 0.3, (cx + 19 * U, 0.05, 1 - (th + 7) * U), matid="wood",
                        bevel=0.8 * U, rot=(0, 28, 0), rid=23)
                E.block(5 * U, 3 * U, 0.4, (cx + 20 * U, -0.1, 1 - (th + 1.5) * U), matid="iron",
                        bevel=0.6 * U, rid=24)
            if biome == "ramparts" and nm in ("m0", "m2"):
                for xx in (4, 20):   # rope lashing
                    E.torus(3.5 * U, 0.8 * U, (cx + xx * U, -0.05, 1 - th / 2 * U),
                            rot=(0, 90, 0), matid="rope", segs=10, rsegs=4, rid=40)
        else:  # iron grate walkway (tower)
            th = 5
            E.block((x1 - x0) * U, th * U, 0.55, (cx + (x0 + x1) / 2 * U, -0.05, 1 - th / 2 * U),
                    matid="iron", bevel=1.0 * U, rid=50, segs=1)
            for xx in range(x0 + 3, x1 - 1, 5):   # rivets
                E.cylinder(0.9 * U, 0.08, (cx + xx * U, -0.34, 1 - 2.5 * U), matid="gold",
                           segs=6, axis="Y", rid=51)
            E.block((x1 - x0) * U, 2 * U, 0.3, (cx + (x0 + x1) / 2 * U, 0.05, 1 - 11 * U),
                    matid="iron", bevel=0.5 * U, rid=52)
            for xx in range(x0, x1 - 3, 8):
                E.block(1.6 * U, 9 * U, 0.2, (cx + (xx + 4) * U, 0.08, 1 - 8 * U), matid="iron",
                        bevel=0.3 * U, rot=(0, 40 if (xx // 8) % 2 else -40, 0), rid=53)
            if nm in ("l", "single"):
                E.block(3 * U, 12 * U, 0.4, (cx + 3 * U, -0.02, 1 - 9 * U), matid="iron",
                        bevel=0.6 * U, rid=54)
            if nm in ("r", "single"):
                E.block(3 * U, 12 * U, 0.4, (cx + 21 * U, -0.02, 1 - 9 * U), matid="iron",
                        bevel=0.6 * U, rid=55)
        g.piece("plat_" + nm, cx, 0)
    g.render(meta)


def spike_row(cx, cz, orient, rnd, hmin=10, hmax=14, n=4, matid="iron", bent=0.0):
    """Row of spikes in cell (cx, cz).  orient: up/down/left/right (pointing direction)."""
    import mathutils
    rot = {"up": 0, "down": 180, "left": -90, "right": 90}[orient]
    ccx, ccz = cx + 0.5, cz + 0.5
    parts = [E.block(23 * U, 3 * U, 0.5, (ccx, 0.1, cz + 1.5 * U), matid=matid, bevel=0.8 * U,
                     rid=70)]
    step = 24.0 / n
    for i in range(n):
        x = cx + (step * (i + 0.5) + rnd.uniform(-0.8, 0.8)) * U
        h = rnd.randint(hmin, hmax) * U
        ob = E.cylinder(2.6 * U, h, (x, 0.1, cz + 3 * U + h / 2), matid=matid, segs=8,
                        r2=0.2 * U, rid=71 + i)
        ob.rotation_euler = (0, math.radians(rnd.uniform(-bent, bent)), 0)
        parts.append(ob)
    R = mathutils.Matrix.Rotation(math.radians(rot), 3, "Y")
    for ob in parts:
        loc = mathutils.Vector(ob.location) - mathutils.Vector((ccx, 0, ccz))
        ob.location = mathutils.Vector((ccx, 0, ccz)) + R @ loc
        e = ob.rotation_euler
        ob.rotation_euler = (e[0], e[1] + math.radians(rot), e[2])
    return parts


def build_spikes(biome, P, meta):
    rnd = random.Random(bseed(biome) + 17)
    E.clear()
    g = Group(biome, "spikes", 12, 1, margin_px=8)
    for k in range(3):
        spike_row(2 * k, 0, "up", rnd, n=4 if k != 1 else 5, bent=6 if k == 2 else 2)
        g.piece("spike_up%d" % k, 2 * k, 0)
    for k, o in enumerate(("down", "left", "right")):
        spike_row(6 + 2 * k, 0, o, rnd, n=4, bent=2)
        g.piece("spike_" + o, 6 + 2 * k, 0)
    g.render(meta)


def build_breakable(biome, P, meta):
    rnd = random.Random(bseed(biome) + 19)
    E.clear()
    g = Group(biome, "breakable", 4, 1, margin_px=6)
    for k in range(2):
        cx = 2 * k
        lay = [(0, 0, 24, 11), (0, 11, 14, 13), (14, 11, 10, 13)]
        for i, (x, z, w, h) in enumerate(lay):
            jit = k
            rot = (0, rnd.uniform(-4, 4) * jit, rnd.uniform(-3, 3) * jit)
            dz = (-rnd.uniform(0, 1.5) * jit) * U
            rough(w - 1.5, h - 1.5, 0.5,
                  (cx + (x + w / 2) * U, 0.25 - 0.5 * U + jit * U * rnd.random(),
                   1 - (z + h / 2) * U + dz),
                  "stone", 900 + i + 10 * k, 1.0 + 1.5 * k, bevel=2.8, rid=180 + i + 10 * k,
                  rot=rot)
        E.block(1.0, 1.0, 0.1, (cx + 0.5, 0.45, 0.5), matid="mortar", bevel=0, rid=0)
        g.piece("break%d" % k, cx, 0)
    g.render(meta)


def build_deco(biome, P, meta):
    """Back-wall decorations (stamps).  All sit on the back-wall plane (y = 0)."""
    rnd = random.Random(bseed(biome) + 23)
    E.clear()
    g = Group(biome, "deco", 19, 4, margin_px=0)
    # --- arch (3 x 4): jambs + voussoirs + dark void recess (+ gate bars in prison)
    ax = 0
    E.block(2.2, 3.4, 0.1, (ax + 1.5, 0.6, 1.7), matid="void", bevel=0, rid=1)
    for side in (0, 1):
        x = ax + (0.33 if side == 0 else 2.67)
        z = 0
        i = 0
        while z < 2.49:
            hh = min(rnd.uniform(0.38, 0.5), 2.5 - z)
            E.block(0.62 if i % 2 else 0.54, hh - 1.4 * U, 0.35,
                    (x + (0.02 if side == 0 else -0.02), 0.0, z + hh / 2), matid="trim",
                    bevel=2 * U, chip=0.8 * U, seed=rnd.randrange(999), rid=rnd.randrange(1, 255),
                    segs=2)
            z += hh
            i += 1
    E.arch_ring(ax + 1.5, 2.5, 0.88, 1.48, -0.17, 0.2, n=7, matid="trim", seed=3, rid_base=100)
    if biome == "prison":
        for i in range(5):
            E.cylinder(0.035, 3.2, (ax + 0.86 + i * 0.32, 0.35, 1.6), matid="iron", segs=6, rid=120)
        for z in (0.5, 2.2):
            E.block(1.8, 0.07, 0.06, (ax + 1.5, 0.33, z), matid="iron", rid=121)
    g.piece("arch", ax, 0, 3, 4)
    # --- window (2 x 2): framed opening, glow inside, bars
    wx = 3
    E.block(1.3, 1.6, 0.1, (wx + 1, 0.5, 1.0), matid="glow", bevel=0, rid=2)
    for (x, z, w, h) in ((wx + 0.2, 0.15, 0.4, 1.45), (wx + 1.8, 0.15, 0.4, 1.45)):
        E.block(w, h, 0.3, (x, 0.0, z + h / 2), matid="trim", bevel=2 * U, chip=0.6 * U,
                seed=rnd.randrange(99), rid=rnd.randrange(1, 255), segs=2)
    E.block(1.9, 0.3, 0.32, (wx + 1, -0.02, 0.15), matid="trim", bevel=2 * U, rid=130, segs=2)
    E.arch_ring(wx + 1, 1.45, 0.55, 0.88, -0.15, 0.15, n=5, matid="trim", seed=5, rid_base=140)
    for i in range(3):
        E.cylinder(0.04, 1.8, (wx + 0.7 + i * 0.3, 0.2, 1.0), matid="iron", segs=6, rid=131)
    E.block(1.3, 0.06, 0.06, (wx + 1, 0.18, 1.1), matid="iron", rid=132)
    g.piece("window", wx, 0, 2, 2)
    # --- pillar (2 wide): base, shaft (seamless vertically), capital, stacked in z 0..3
    px = 5
    cx = px + 1.0
    for (zc, hh, w) in ((0.12, 0.24, 1.9), (0.36, 0.24, 1.6), (0.56, 0.16, 1.35)):
        E.block(w, hh, 0.6, (cx, -0.05, zc), matid="trim", bevel=2.2 * U, chip=0.6 * U,
                seed=int(zc * 100), rid=150 + int(zc * 10), segs=2)
    E.cylinder(0.55, 3.0, (cx, 0.0, 1.5), matid="trim", segs=24, rid=160)
    for zc in (1.0, 2.0):   # drum joints at cell edges -> mid segment tiles vertically
        E.cylinder(0.56, 1.5 * U, (cx, 0.0, zc), matid="backmortar", segs=24, rid=161)
    for (zc, hh, w) in ((2.88, 0.24, 1.9), (2.64, 0.24, 1.6), (2.44, 0.16, 1.35)):
        E.block(w, hh, 0.6, (cx, -0.05, zc), matid="trim", bevel=2.2 * U, chip=0.6 * U,
                seed=int(zc * 100), rid=170 + int(zc * 10), segs=2)
    g.piece("pillar_bot", px, 0, 2, 1)
    g.piece("pillar_mid", px, 1, 2, 1)
    g.piece("pillar_top", px, 2, 2, 1)
    # --- hanging chain (1 x 3)
    chx = 7
    E.chain(chx + 0.5, 3.0, 0.55, link=0.2, thick=0.04, y=-0.1, rid=180)
    E.torus(0.16, 0.045, (chx + 0.5, -0.1, 0.42), rot=(90, 0, 0), matid="iron", rid=181)
    g.piece("chain", chx, 0, 1, 3)
    # --- biome specific 2 x 3 piece
    sx = 8
    if biome == "prison":
        E.block(1.8, 2.8, 0.1, (sx + 1, 0.5, 1.4), matid="void", bevel=0, rid=3)
        for (x, z, w, h) in ((sx + 0.12, 1.5, 0.24, 3.0), (sx + 1.88, 1.5, 0.24, 3.0),
                             (sx + 1, 2.86, 2.0, 0.28)):
            E.block(w, h, 0.3, (x, 0.0, z), matid="trim", bevel=2 * U, chip=0.7 * U,
                    seed=int(x * 10), rid=190 + int(x), segs=2)
        for i in range(6):
            E.cylinder(0.04, 2.7, (sx + 0.35 + i * 0.26, 0.15, 1.35), matid="iron", segs=6,
                       rid=195)
        for z in (0.5, 1.6, 2.5):
            E.block(1.6, 0.08, 0.08, (sx + 1, 0.12, z), matid="iron", bevel=0.01, rid=196)
        E.torus(0.08, 0.03, (sx + 1.5, 0.05, 1.3), rot=(90, 0, 0), matid="iron", rid=197)
    elif biome == "ramparts":
        import bmesh
        E.cylinder(0.05, 1.8, (sx + 1, -0.12, 2.75), matid="iron", segs=8, axis="X", rid=200)
        bm = bmesh.new()
        nx, nz = 10, 16
        vs = []
        for j in range(nz + 1):
            row = []
            for i in range(nx + 1):
                u, v = i / nx, j / nz
                x = sx + 0.3 + 1.4 * u
                z = 2.7 - 2.35 * v
                if v >= 0.999:   # swallow-tail notch
                    z += 0.45 * max(0.0, 1 - abs(u - 0.5) * 2.6)
                y = -0.06 + 0.06 * math.sin(u * 6.0 + v * 2) + 0.03 * math.sin(v * 9)
                row.append(bm.verts.new((x, y, z)))
            vs.append(row)
        for j in range(nz):
            for i in range(nx):
                bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
        bm.normal_update()
        ob = E._obj_from_bm(bm, "banner")
        for p in ob.data.polygons:
            p.use_smooth = True
        E.tag(ob, "cloth", 201)
        # gold emblem on the banner
        E.block(0.5, 0.08, 0.04, (sx + 1, -0.14, 1.8), matid="gold", rid=202)
        E.block(0.08, 0.6, 0.04, (sx + 1, -0.14, 1.7), matid="gold", rid=202)
        E.torus(0.18, 0.035, (sx + 1, -0.14, 1.8), rot=(90, 0, 0), matid="gold", rid=203)
    else:
        E.block(2.0, 0.34, 0.5, (sx + 1, -0.1, 2.6), matid="wood", bevel=1.5 * U, chip=0.6 * U,
                rid=210)
        for x in (sx + 0.25, sx + 1.75):
            E.block(0.16, 0.5, 0.55, (x, -0.12, 2.6), matid="iron", bevel=0.5 * U, rid=211)
        E.chain(sx + 1, 2.43, 1.4, link=0.16, thick=0.03, y=-0.15, rid=212)
        E.lathe([(0.0, 0.42), (0.1, 0.4), (0.16, 0.3), (0.2, 0.1), (0.3, -0.05), (0.32, -0.1),
                 (0.0, -0.1)], (sx + 1, -0.2, 0.95), matid="bronze", segs=20, rid=213)
    g.piece("special", sx, 0, 2, 3)
    # --- niche (1 x 1)
    nx_ = 10
    E.block(0.6, 0.62, 0.1, (nx_ + 0.5, 0.35, 0.5), matid="void", bevel=0, rid=4)
    E.block(0.86, 0.12, 0.3, (nx_ + 0.5, -0.02, 0.1), matid="trim", bevel=1.5 * U, rid=220)
    E.arch_ring(nx_ + 0.5, 0.74, 0.28, 0.44, -0.12, 0.15, n=3, matid="trim", seed=9, rid_base=221)
    for x in (nx_ + 0.12, nx_ + 0.88):
        E.block(0.16, 0.62, 0.3, (x, -0.02, 0.47), matid="trim", bevel=1.2 * U, rid=226)
    if biome == "tower":
        E.block(0.5, 0.5, 0.1, (nx_ + 0.5, 0.3, 0.5), matid="glow", bevel=0, rid=5)
    elif biome == "prison":
        E.lathe([(0.0, 0.2), (0.08, 0.18), (0.12, 0.12), (0.12, 0.05), (0.09, 0.0), (0.0, 0.0)],
                (nx_ + 0.5, 0.1, 0.22), matid="bone", segs=10, rid=227)
    else:
        E.lathe([(0.0, 0.3), (0.06, 0.28), (0.1, 0.18), (0.13, 0.05), (0.0, 0.0)],
                (nx_ + 0.5, 0.05, 0.2), matid="bronze", segs=12, rid=228)
    g.piece("niche", nx_, 0, 1, 1)
    # --- second biome specific 2 x 2
    gx = 11
    if biome == "tower":
        n = 12
        pts = []
        for i in range(n * 2):
            a = math.pi * 2 * i / (n * 2)
            r = 0.84 if i % 2 == 0 else 0.68
            a2 = a + (math.pi / (n * 2)) * 0.5
            pts.append((gx + 1 + r * math.cos(a), 1 + r * math.sin(a)))
            pts.append((gx + 1 + r * math.cos(a2), 1 + r * math.sin(a2)))
        E.prism(pts, -0.1, 0.15, matid="iron", rid=230)
        E.cylinder(0.3, 0.3, (gx + 1, -0.12, 1), matid="bronze", segs=16, axis="Y", rid=231)
        for i in range(4):
            a = math.pi / 2 * i + 0.4
            E.block(0.12, 0.5, 0.1, (gx + 1 + 0.45 * math.cos(a), -0.13, 1 + 0.45 * math.sin(a)),
                    matid="iron", rot=(0, -math.degrees(a) + 90, 0), rid=232)
    elif biome == "ramparts":
        pts = [(gx + 0.35, 1.75), (gx + 1.65, 1.75), (gx + 1.6, 1.0), (gx + 1.0, 0.3),
               (gx + 0.4, 1.0)]
        E.prism(pts, -0.12, 0.05, matid="cloth", rid=240)
        E.block(1.45, 0.14, 0.2, (gx + 1, -0.13, 1.78), matid="gold", bevel=1 * U, rid=241)
        E.block(0.12, 1.2, 0.05, (gx + 1, -0.15, 1.15), matid="gold", rid=242)
        E.block(1.0, 0.12, 0.05, (gx + 1, -0.15, 1.35), matid="gold", rid=242)
    else:
        for x in (gx + 0.5, gx + 1.5):
            E.block(0.22, 0.22, 0.1, (x, -0.02, 1.55), matid="iron", bevel=1 * U, rid=250)
            E.chain(x, 1.5, 0.75, link=0.14, thick=0.03, y=-0.08, rid=251)
            E.torus(0.13, 0.04, (x, -0.1, 0.62), rot=(90, 0, 0), matid="iron", rid=252)
    g.piece("special2", gx, 0, 2, 2)
    # --- slit window (1 x 2)
    tx = 13
    E.block(0.22, 1.2, 0.1, (tx + 0.5, 0.4, 1.0), matid="glow" if biome != "ramparts" else "void",
            bevel=0, rid=6)
    for z in (0.32, 1.68):
        E.block(0.7, 0.2, 0.3, (tx + 0.5, -0.02, z), matid="trim", bevel=1.5 * U, rid=260)
    for x in (tx + 0.27, tx + 0.73):
        E.block(0.22, 1.25, 0.3, (x, -0.02, 1.0), matid="trim", bevel=1.2 * U, chip=0.5 * U,
                rid=261)
    g.piece("slit", tx, 0, 1, 2)
    g.render(meta, near=-2, far=2)


def build(biome):
    P = BIOMES[biome]
    meta = {"biome": biome, "groups": {}, "fill": [FILL_W, FILL_H], "lip_n": LIP_N,
            "side_n": SIDE_N, "bot_n": BOT_N}
    E.new_scene()
    masonry(**P["fill"])
    E.render(out(biome, "fill"), 0, FILL_H, FILL_W * E.PPU, FILL_H * E.PPU)
    E.clear()
    masonry(**P["back"])
    E.render(out(biome, "back"), 0, FILL_H, FILL_W * E.PPU, FILL_H * E.PPU)
    build_lip(biome, P, meta)
    build_sides(biome, P, meta)
    build_bottom(biome, P, meta)
    build_topdeco(biome, P, meta)
    build_platforms(biome, P, meta)
    build_spikes(biome, P, meta)
    build_breakable(biome, P, meta)
    build_deco(biome, P, meta)
    E.save_meta(out(biome, "pieces.json"), meta)
    print("asset_tiles: built", biome)


if __name__ == "__main__":
    args = E.common.script_args()
    for b in (args or list(BIOMES)):
        build(b)
