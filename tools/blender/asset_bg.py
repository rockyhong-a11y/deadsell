"""Parallax background source renders (G-buffers) for the three biomes.

blender -b --factory-startup -P tools/blender/asset_bg.py [-- biome ...]

Writes build/env/bg/<biome>/<layer>_{n,d}.png (1024 x 512, horizontally periodic);
tools/pack/post_bg.py shades them, adds sky / moon / clouds / fog / light shafts and writes
public/assets/bg/<biome>_<n>.png + <biome>.json.

Coordinates in this file are PIXELS measured from the layer's top-left (y down); 24 px = 1 unit.
Everything is built on the plane y = 0 (camera looks along +Y); smaller y is nearer the camera.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_env as E  # noqa: E402

W, H = 1024, 512
U = 1.0 / E.PPU
PER = W * U
NEAR, FAR = -4.0, 8.0


def wx(x):
    return x * U


def wz(y):
    return (H - y) * U


def out(biome, name):
    return os.path.join(E.ENV_OUT, "bg", biome, name)


def rep(make, cx, w):
    """Periodic helper: make(dx) is called for the object and every wrapped copy."""
    return E.periodic(lambda dx, dz: make(dx), wx(cx), 0, wx(w), 0, PER, None)


def wall_plane(mat, y=2.0):
    E.block(PER + 6, H * U + 2, 0.5, (PER / 2, y, H * U / 2), matid=mat, bevel=0, rid=1)


# --------------------------------------------------------------------------------------
# primitives


def column(cx, w, y0, y1, mat="far2", y=0.0, base=True, cap=True, segs=18, rid=None):
    """Round column from y0 (top) to y1 (bottom) with drum joints, base and capital."""
    def mk(dx):
        h = (y1 - y0) * U
        E.cylinder(w / 2 * U, h, (wx(cx) + dx, y, wz((y0 + y1) / 2)), matid=mat, segs=segs, rid=rid)
        n = max(1, int((y1 - y0) / 96))
        for i in range(1, n):
            zz = wz(y0 + (y1 - y0) * i / n)
            E.cylinder(w / 2 * U + 0.03, 3 * U, (wx(cx) + dx, y, zz), matid="mortar", segs=segs, rid=3)
        if base:
            E.block((w + 16) * U, 14 * U, 0.9, (wx(cx) + dx, y - 0.05, wz(y1 - 7)), matid=mat,
                    bevel=2 * U, rid=rid)
            E.block((w + 8) * U, 10 * U, 0.8, (wx(cx) + dx, y - 0.05, wz(y1 - 19)), matid=mat,
                    bevel=2 * U, rid=rid)
        if cap:
            E.block((w + 16) * U, 14 * U, 0.9, (wx(cx) + dx, y - 0.05, wz(y0 + 7)), matid=mat,
                    bevel=2 * U, rid=rid)
            E.block((w + 8) * U, 10 * U, 0.8, (wx(cx) + dx, y - 0.05, wz(y0 + 19)), matid=mat,
                    bevel=2 * U, rid=rid)
    rep(mk, cx, w + 24)


def arch(cx, spring_y, span, thick, y0=-0.2, y1=0.4, mat="far2", n=11, seed=0):
    """Semicircular arch ring (voussoirs) centred on cx, springing at spring_y."""
    r_in = span / 2

    def mk(dx):
        E.arch_ring(wx(cx) + dx, wz(spring_y), r_in * U, (r_in + thick) * U, y0, y1, n=n, matid=mat,
                    seed=seed, chip=0.015)
    rep(mk, cx, span + 2 * thick)


def opening(cx, w, spring_y, bottom_y, y=1.0, mat="void"):
    """Dark arched opening (rect + semicircle) cut into a wall plane."""
    def mk(dx):
        pts = [(wx(cx - w / 2) + dx, wz(bottom_y))]
        for i in range(0, 13):
            a = math.pi - math.pi * i / 12
            pts.append((wx(cx) + dx + math.cos(a) * w / 2 * U, wz(spring_y) + math.sin(a) * w / 2 * U))
        pts.append((wx(cx + w / 2) + dx, wz(bottom_y)))
        E.prism(pts, y, y + 0.2, matid=mat, rid=2)
    rep(mk, cx, w + 4)


def bars(cx, w, y0, y1, mat="iron", y=-0.1, gap=9, thick=2.2, rails=(0.25, 0.7)):
    def mk(dx):
        n = int(w / gap)
        for i in range(n + 1):
            x = cx - w / 2 + i * w / n
            E.cylinder(thick / 2 * U, (y1 - y0) * U, (wx(x) + dx, y, wz((y0 + y1) / 2)), matid=mat,
                       segs=6, rid=40)
        for r in rails:
            E.block(w * U, 3 * U, 0.1, (wx(cx) + dx, y, wz(y0 + (y1 - y0) * r)), matid=mat,
                    bevel=0.3 * U, rid=41)
    rep(mk, cx, w + 8)


def hang_chain(x, y0, y1, link=0.2, thick=0.04, y=-0.2, mat="iron"):
    def mk(dx):
        E.chain(wx(x) + dx, wz(y0), wz(y1), link=link, thick=thick, y=y, matid=mat, rid=44)
    rep(mk, x, 12)


def beam(cx, y, w, h, mat="wood", rot=0.0, d=0.8, yy=-0.1, seed=1, bevel=2.0):
    def mk(dx):
        E.block(w * U, h * U, d, (wx(cx) + dx, yy, wz(y)), matid=mat, bevel=bevel * U, chip=0.6 * U,
                seed=seed, rot=(0, rot, 0))
    rep(mk, cx, w * abs(math.cos(math.radians(rot))) + h + 40)


def bell(cx, ytop, r_px, mat="bronze", y=-0.2):
    """Hanging bell: crown at ytop (px), mouth radius r_px; chain not included."""
    s = r_px * U / 0.62

    def mk(dx):
        prof = [(0.0, 0.0), (0.1, -0.02), (0.18, -0.12), (0.26, -0.45), (0.33, -0.85), (0.44, -1.2),
                (0.56, -1.45), (0.62, -1.62), (0.6, -1.7), (0.5, -1.68), (0.0, -1.68)]
        ob = E.lathe([(r * s, z * s) for r, z in prof], (wx(cx) + dx, y, wz(ytop)), matid=mat, segs=22)
        E.block(0.5 * s, 0.14 * s, 0.5 * s, (wx(cx) + dx, y, wz(ytop) + 0.05 * s), matid="iron",
                bevel=1 * U, rid=60)
        E.cylinder(0.07 * s, 0.9 * s, (wx(cx) + dx, y, wz(ytop) - 1.5 * s), matid="iron", segs=8, rid=61)
        E.lathe([(0.0, 0.1 * s), (0.1 * s, 0.07 * s), (0.14 * s, -0.04 * s), (0.1 * s, -0.16 * s),
                 (0.0, -0.2 * s)], (wx(cx) + dx, y, wz(ytop) - 1.95 * s), matid="iron", segs=12, rid=62)
        # moulding bands
        for z in (-0.85, -1.2):
            E.torus(0.48 * s if z == -1.2 else 0.34 * s, 0.025 * s, (wx(cx) + dx, y, wz(ytop) + z * s),
                    rot=(0, 0, 0), matid="gold", segs=22, rsegs=5, rid=63)
    rep(mk, cx, r_px * 2 + 20)


def gear(cx, cy, r_px, teeth=14, mat="iron", y=0.0, depth=0.35, hub="bronze", spokes=6):
    def mk(dx):
        pts = []
        n = teeth * 4
        for i in range(n):
            a = 2 * math.pi * i / n
            k = i % 4
            rr = r_px * U if k in (1, 2) else r_px * 0.84 * U
            pts.append((wx(cx) + dx + rr * math.cos(a), wz(cy) + rr * math.sin(a)))
        E.prism(pts, y, y + depth, matid=mat, rid=70)
        E.cylinder(r_px * 0.22 * U, depth + 0.2, (wx(cx) + dx, y - 0.05 + depth / 2, wz(cy)), matid=hub,
                   segs=16, axis="Y", rid=71)
        for i in range(spokes):
            a = math.pi * i / spokes
            E.block(r_px * 1.5 * U, 4 * U, 0.15, (wx(cx) + dx, y - 0.08, wz(cy)), matid=mat, bevel=0.4 * U,
                    rot=(0, math.degrees(a), 0), rid=72)
    rep(mk, cx, r_px * 2 + 10)


def tower(cx, w, y_top, y_bot, roof_h=0, mat="far", roof="roof", y=0.0, windows=0, win_mat="glow",
          crenel=False):
    """Round tower (cylinder) with optional conical roof, battlement ring and lit windows."""
    def mk(dx):
        E.cylinder(w / 2 * U, (y_bot - y_top) * U, (wx(cx) + dx, y, wz((y_top + y_bot) / 2)), matid=mat,
                   segs=14, rid=None)
        if roof_h:
            E.cylinder(w / 2 * U + 0.16, roof_h * U, (wx(cx) + dx, y, wz(y_top - roof_h / 2)), matid=roof,
                       segs=14, r2=0.0, rid=None)
        if crenel:
            E.cylinder(w / 2 * U + 0.14, 8 * U, (wx(cx) + dx, y - 0.05, wz(y_top + 4)), matid=mat, segs=14)
            n = max(4, int(w / 9))
            for i in range(n):
                a = 2 * math.pi * i / n
                if math.cos(a) < -0.2:
                    continue
                E.block(5 * U, 7 * U, 0.3, (wx(cx) + dx + math.sin(a) * (w / 2 + 3) * U, y - 0.2 - 0.05,
                                            wz(y_top - 3)), matid=mat, bevel=0.5 * U)
        for i in range(windows):
            wy = y_top + 24 + i * ((y_bot - y_top - 40) / max(1, windows))
            E.block(6 * U, 11 * U, 0.1, (wx(cx) + dx + (4 if i % 2 else -4) * U, y - w / 2 * U * 0.93 - 0.03,
                                         wz(wy)), matid=win_mat, bevel=0, rid=90)
    rep(mk, cx, w + 30)


def crenellated_wall(x0, x1, y_top, y_bot, mat="far", y=0.0, merlon=14, gap=10, mh=12, seed=1,
                     windows=False):
    rnd = random.Random(seed)

    def mk(dx):
        E.block((x1 - x0) * U, (y_bot - y_top) * U, 0.8, (wx((x0 + x1) / 2) + dx, y, wz((y_top + y_bot) / 2)),
                matid=mat, bevel=1.0 * U, rid=None)
        x = x0
        while x + merlon <= x1:
            E.block(merlon * U, mh * U, 0.8, (wx(x + merlon / 2) + dx, y, wz(y_top - mh / 2)), matid=mat,
                    bevel=1.0 * U, rid=None)
            x += merlon + gap
        if windows:
            x = x0 + 30
            while x < x1 - 20:
                E.block(5 * U, 10 * U, 0.1, (wx(x) + dx, y - 0.45, wz(y_top + 28)), matid="glow", bevel=0,
                        rid=91)
                x += rnd.randint(46, 90)
    rep(mk, (x0 + x1) / 2, x1 - x0 + 20)


def stone_wall(x0, x1, y_top, y_bot, mat="far", y=0.0, rows=None, seed=3):
    """Brick-coursed wall (rough lines so it reads as masonry even at low contrast)."""
    rnd = random.Random(seed)
    rows = rows or int((y_bot - y_top) / 16)
    ch = (y_bot - y_top) / rows

    def mk(dx):
        for r in range(rows):
            x = x0 - rnd.randint(0, 30)
            while x < x1:
                L = rnd.randint(28, 52)
                a, b = max(x, x0), min(x + L, x1)
                if b - a > 6:
                    E.block((b - a - 1.5) * U, (ch - 1.5) * U, 0.5,
                            (wx((a + b) / 2) + dx, y + rnd.uniform(-0.03, 0.03), wz(y_top + (r + 0.5) * ch)),
                            matid=mat, bevel=1.2 * U, chip=0.6 * U, seed=rnd.randrange(999),
                            rid=rnd.randrange(1, 255))
                x += L
    rep(mk, (x0 + x1) / 2, x1 - x0 + 20)
    E.block((x1 - x0) * U, (y_bot - y_top) * U, 0.1, (wx((x0 + x1) / 2), y + 0.4, wz((y_top + y_bot) / 2)),
            matid="mortar", bevel=0, rid=0)


# --------------------------------------------------------------------------------------
# PRISON


def prison_0():
    wall_plane("far")
    N, S = 8, 128
    for k in range(N):
        cx = k * S + S / 2
        opening(cx, 84, 218, 470)
        arch(cx, 218, 84, 16, mat="far2", seed=k)
    for k in range(N):
        column(k * S, 44, 0, 470, mat="far2")
    E.block(PER + 4, 50 * U, 0.8, (PER / 2, -0.2, wz(490)), matid="far2", bevel=0, rid=5)
    # coursed wall detail above the arches
    for k in range(N):
        for r in range(4):
            E.block(S * 0.5 * U, 2 * U, 0.1, (wx(k * S + S / 2 + (r % 2) * 20) , 0.6, wz(26 + r * 36)),
                    matid="mortar", bevel=0, rid=6)


def prison_1():
    for k in range(4):
        cx = 128 + 256 * k
        column(cx, 60, 0, 512, mat="stone")
        arch(cx + 128, 300, 196, 22, mat="stone", y0=-0.3, y1=0.5, n=13, seed=k)
        # spandrel infill between arches (dark masonry) so the arch reads as a solid structure
    for k in range(4):
        bx = 256 + 256 * k
        hang_chain(bx, 170, 330 if k % 2 == 0 else 270, link=0.22, thick=0.045)
        beam(bx, 400 if k % 2 == 0 else 360, 196, 14, mat="wood", seed=k)
        if k % 2 == 0:
            for i in range(3):
                hang_chain(bx - 70 + i * 70, 407, 470 - i * 12, link=0.16, thick=0.032)


def prison_2():
    # cell block wall
    stone_wall(0, W, 340, 512, mat="back", y=0.1, seed=5)
    cells = 8
    S = W / cells
    for k in range(cells):
        cx = k * S + S / 2
        opening(cx, 70, 398, 500, y=0.5)
        bars(cx, 62, 388, 500, rails=(0.22, 0.62, 0.9))
        arch(cx, 398, 70, 14, mat="trim", y0=-0.25, y1=0.3, n=9, seed=k)
    for k in range(cells):
        E.block(S * U, 12 * U, 0.9, (wx(k * S + S / 2), -0.1, wz(338)), matid="trim", bevel=2 * U, rid=9)
    for x in (140, 520, 880):
        hang_chain(x, 0, 190 + (x % 50), link=0.2, thick=0.04)
    # a broken balcony railing
    for i in range(12):
        E.block(4 * U, 30 * U, 0.2, (wx(300 + i * 16), -0.1, wz(322)), matid="wood", bevel=0.5 * U, rid=12)
    beam(396, 305, 200, 8, mat="wood", seed=9)


def prison_3():
    for cx in (210, 790):
        column(cx, 96, 0, 512, mat="trim", base=True, cap=False)
    for x0 in (470, 560):
        for i in range(4):
            hang_chain(x0 + i * 14, 0, 150 + 60 * ((i * 7 + x0) % 4), link=0.18, thick=0.04)
    beam(515, 40, 220, 12, mat="wood", seed=5)


# --------------------------------------------------------------------------------------
# RAMPARTS


def ramparts_2():
    """Distant castle on crags: towers with lit windows + keeps (hazy, 'far' materials)."""
    rnd = random.Random(21)
    base = 470
    # curtain walls
    crenellated_wall(40, 330, 400, base, mat="far", seed=1, merlon=10, gap=8, mh=9)
    crenellated_wall(560, 900, 410, base, mat="far", seed=2, merlon=10, gap=8, mh=9)
    # towers
    for cx, w, top, roof in ((90, 38, 300, 56), (210, 30, 330, 46), (300, 46, 270, 64),
                             (610, 40, 290, 60), (720, 28, 340, 40), (840, 52, 250, 72),
                             (470, 70, 200, 90), (960, 36, 330, 50)):
        tower(cx, w, top, base, roof_h=roof, mat="far2", roof="roof", windows=int((base - top) / 60),
              crenel=False)
    # keep
    for k, (x0, x1, top) in enumerate(((430, 510, 230),)):
        crenellated_wall(x0, x1, top, base, mat="far2", seed=7, merlon=9, gap=7, mh=9, windows=True)
    # tiny flags
    for cx, top in ((90, 244), (300, 206), (840, 178), (470, 110)):
        def mk(dx, cx=cx, top=top):
            E.cylinder(0.03, 22 * U * 2, (wx(cx) + dx, 0, wz(top - 20)), matid="iron", segs=5)
            E.block(18 * U, 9 * U, 0.05, (wx(cx + 10) + dx, 0, wz(top - 36)), matid="cloth", bevel=0)
        rep(mk, cx, 40)
    E.block(PER + 4, 60 * U, 0.8, (PER / 2, 0.1, wz(500)), matid="far", bevel=0, rid=3)


def ramparts_3():
    """Near battlements, banners and a broken tower."""
    rnd = random.Random(33)
    base = 512
    # long curtain wall with crenellations
    crenellated_wall(0, W, 400, base, mat="stone", seed=4, merlon=18, gap=14, mh=16, y=0.0)
    stone_wall(0, W, 416, base, mat="stone", y=-0.12, seed=8)
    # round towers
    for cx, w, top in ((150, 82, 250), (600, 96, 220), (880, 70, 290)):
        tower(cx, w, top, base, roof_h=0, mat="stone2", crenel=True, windows=3)
    # tower 2 gets a conical roof
    tower(380, 70, 270, base, roof_h=86, mat="stone2", roof="roof", windows=3)
    # banners hanging from the wall
    for x in (260, 470, 740, 980):
        def mk(dx, x=x):
            E.block(26 * U, 56 * U, 0.04, (wx(x) + dx, -0.3, wz(450)), matid="cloth", bevel=0, rid=80)
            E.block(30 * U, 4 * U, 0.1, (wx(x) + dx, -0.32, wz(422)), matid="gold", bevel=0.3 * U, rid=81)
        rep(mk, x, 40)


# --------------------------------------------------------------------------------------
# TOWER


def tower_0():
    wall_plane("far")
    # giant stone ribs / arches receding into the dark
    for k in range(4):
        cx = 128 + 256 * k
        column(cx, 70, 0, 512, mat="far2", base=False, cap=False)
        arch(cx + 128, 200, 170, 30, mat="far2", n=13, seed=k)
    # tall louvre slits
    for k in range(8):
        x = 64 + 128 * k
        opening(x, 26, 150, 330, y=1.2)
    # distant beams
    beam(256, 410, 256, 22, mat="far2", seed=2)
    beam(768, 380, 256, 22, mat="far2", seed=3)
    E.block(PER + 4, 60 * U, 1.0, (PER / 2, -0.1, wz(500)), matid="far2", bevel=0, rid=5)


def tower_1():
    """Great timber trusses, iron bands, chains and mid-distance bells."""
    for k in range(2):
        cx = 256 + 512 * k
        beam(cx, 96, 470, 34, mat="wood", seed=k, bevel=3)
        beam(cx, 96, 470, 6, mat="iron", seed=k, yy=-0.4)
        beam(cx - 120, 230, 260, 24, mat="wood", rot=-38, seed=5 + k)
        beam(cx + 120, 230, 260, 24, mat="wood", rot=38, seed=7 + k)
        bell(cx, 190, 40, mat="bronze")
        hang_chain(cx, 112, 158, link=0.2, thick=0.04)
        bell(cx - 190, 300, 26, mat="bronze")
        hang_chain(cx - 190, 112, 262, link=0.16, thick=0.035)
        bell(cx + 190, 330, 30, mat="bronze")
        hang_chain(cx + 190, 112, 292, link=0.16, thick=0.035)
    for x in (30, 520):
        column(x, 56, 0, 512, mat="stone", base=True, cap=True)


def tower_2():
    """Big bells on yokes + gear works."""
    for cx, ytop, r in ((200, 230, 70), (610, 190, 84), (930, 260, 58)):
        beam(cx, ytop - 78, r * 2 + 80, 30, mat="wood", seed=int(cx), bevel=3)
        beam(cx, ytop - 78, r * 2 + 80, 5, mat="iron", seed=1, yy=-0.4)
        hang_chain(cx - r - 28, ytop - 62, ytop - 40)
        bell(cx, ytop, r, mat="bronze")
        hang_chain(cx, ytop - 63, ytop - 6, link=0.24, thick=0.05)
    gear(410, 420, 62, teeth=16, mat="iron", y=0.3)
    gear(500, 380, 40, teeth=11, mat="bronze", y=0.5)
    gear(800, 450, 74, teeth=18, mat="iron", y=0.3, hub="bronze")
    for x in (80, 330, 720, 990):
        hang_chain(x, 0, 120 + (x * 7) % 90, link=0.22, thick=0.045)


def tower_3():
    for x in (110, 640):
        beam(x, 60, 20, 520, mat="iron", rot=0, seed=1, bevel=1.5, d=0.6)  # iron stanchion
    for x0 in (340, 800):
        for i in range(3):
            hang_chain(x0 + i * 12, 0, 120 + i * 40 + (x0 % 50), link=0.24, thick=0.05)
    beam(450, 440, 380, 26, mat="wood", seed=8, rot=-2, bevel=3)
    beam(900, 120, 260, 22, mat="wood", seed=9, rot=4, bevel=3)


BIOMES = {
    "prison": [("0", prison_0), ("1", prison_1), ("2", prison_2), ("3", prison_3)],
    "ramparts": [("2", ramparts_2), ("3", ramparts_3)],
    "tower": [("0", tower_0), ("1", tower_1), ("2", tower_2), ("3", tower_3)],
}


def build(biome):
    for name, fn in BIOMES[biome]:
        E.new_scene()
        fn()
        E.render(out(biome, name), 0, H * U, W, H, near=NEAR, far=FAR)
        print("asset_bg: %s layer %s" % (biome, name))


if __name__ == "__main__":
    args = E.common.script_args()
    for b in (args or list(BIOMES)):
        build(b)
