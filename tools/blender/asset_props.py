"""Props sheet: 96x96 frames, anchor (48,92) = bottom-centre (ground contact).

blender -b --factory-startup -P tools/blender/asset_props.py [prop ...]
Writes build/frames/props/<anim>_###.png + spec.json.

Scale is the in-game 32 px / unit (heroine = 56 px).  Sunken-Prison palette:
blue-grey stone, rusty iron, dark wood, gold accents, cyan rune glow.
Hanging props (chains, banner, bell) are drawn hanging from near the top of the
frame; like every prop their anchor is the bottom-centre of the frame.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
import lib_objects as L  # noqa: E402
from lib_objects import bpy, mat, glow, box, cyl, sphere, torus, prism, lathe, tube, ellipsoid, cone  # noqa: E402

OUT = os.path.join(L.FRAMES, "props")
W = H = 96
AX, AY = 48, 92
PPU = L.common.PX_PER_UNIT


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def setup(yaw=20, pitch=8):
    L.clear_objects(cameras=True)
    L.camera(W, H, AX, AY, yaw=yaw, pitch=pitch)


def behind(center, dist):
    _, _, fwd = L.cam_basis()
    return Vector(center) + fwd * dist


def billboard(ob, center, dist):
    L.face_camera(ob)
    ob.location = behind(center, dist)
    return ob


def snap(root):
    L.ground_snap(root)


GLYPHS = [
    [((0, 0), (0, 1)), ((0, 1), (0.55, 0.72)), ((0, 0.6), (0.55, 0.32))],
    [((0.3, 0), (0.6, 0.5)), ((0.6, 0.5), (0.3, 1)), ((0.3, 1), (0, 0.5)), ((0, 0.5), (0.3, 0))],
    [((0, 0), (0.6, 1)), ((0.6, 0), (0, 1))],
    [((0.3, 0), (0.3, 1)), ((0, 0.65), (0.3, 1)), ((0.3, 1), (0.6, 0.65))],
    [((0.3, 0), (0.3, 1)), ((0, 1), (0.3, 0.55)), ((0.3, 0.55), (0.6, 1))],
    [((0, 0), (0, 1)), ((0, 0.5), (0.55, 0.5)), ((0.55, 0), (0.55, 1))],
]


def glyph(name, k, size, m, loc=(0, 0, 0), rot=0.0, w=0.036):
    """Rune made of thin bars in the XZ plane (centred), height = size."""
    objs = []
    for j, (a, b) in enumerate(GLYPHS[k % len(GLYPHS)]):
        ax_, az = (a[0] - 0.3) * size, (a[1] - 0.5) * size
        bx, bz = (b[0] - 0.3) * size, (b[1] - 0.5) * size
        ln = math.hypot(bx - ax_, bz - az) + w
        ang = math.degrees(math.atan2(bx - ax_, bz - az))
        objs.append(box("%s_%d" % (name, j), (w, 0.02, ln), m, loc=((ax_ + bx) / 2, 0, (az + bz) / 2), rot=(0, ang, 0)))
    return L.group(name, objs, loc=loc, rot=(0, rot, 0))


# --------------------------------------------------------------------------
# door_exit


def a_door_exit():
    setup(20, 8)
    OW, SPR = 0.64, 1.3          # half opening width (= arch radius), arch spring height
    PW, D, YF = 0.36, 1.15, -0.3  # pillar width, wall depth, front plane y
    yc = YF + D / 2
    objs = []
    stones = [mat("stone"), mat("stone_light"), mat("stone")]
    # mortar core (shows through the gaps between blocks)
    for sx in (-1, 1):
        objs.append(box("dr_core%d" % sx, (PW - 0.06, D - 0.06, SPR), mat("mortar"),
                        loc=(sx * (OW + PW / 2), yc, SPR / 2)))
    objs.append(prism("dr_archcore", [(OW + 0.03, SPR), (OW + PW - 0.03, SPR)] +
                      [((OW + PW - 0.03) * math.cos(math.pi * k / 12), SPR + (OW + PW - 0.03) * math.sin(math.pi * k / 12))
                       for k in range(1, 12)] + [(-OW - PW + 0.03, SPR), (-OW - 0.03, SPR)] +
                      [((OW + 0.03) * math.cos(math.pi * k / 12), SPR + (OW + 0.03) * math.sin(math.pi * k / 12))
                       for k in range(11, 0, -1)], D - 0.06, mat("mortar"), y0=yc))
    # pillar blocks
    heights = [0.3, 0.26, 0.28, 0.24, 0.22]
    for sx in (-1, 1):
        z = 0.0
        for k, h in enumerate(heights):
            hh = h if k < len(heights) - 1 else SPR - z
            off = 0.03 * ((k + (sx > 0)) % 2)
            objs.append(box("dr_blk%d_%d" % (sx, k), (PW + off, D, hh - 0.035), stones[(k + (sx > 0)) % 3],
                            loc=(sx * (OW + PW / 2 + off / 2), yc, z + hh / 2), bevel=0.025))
            z += hh
        objs.append(box("dr_plinth%d" % sx, (PW + 0.1, D + 0.08, 0.16), mat("stone_dark"),
                        loc=(sx * (OW + PW / 2), yc, 0.08), bevel=0.02))
    # arch voussoirs
    n = 7
    gap = 0.045
    vous = []
    for k in range(n):
        a0 = math.pi * k / n + gap / 2
        a1 = math.pi * (k + 1) / n - gap / 2
        r0, r1 = OW, OW + PW + (0.08 if k == n // 2 else 0.0)
        pts = []
        for s in range(5):
            a = a0 + (a1 - a0) * s / 4
            pts.append((r0 * math.cos(a), SPR + r0 * math.sin(a)))
        for s in range(4, -1, -1):
            a = a0 + (a1 - a0) * s / 4
            pts.append((r1 * math.cos(a), SPR + r1 * math.sin(a)))
        m = mat("stone_light") if k == n // 2 else stones[k % 2]
        ob = prism("dr_vous%d" % k, pts, D + (0.06 if k == n // 2 else 0.0), m, y0=yc, bevel=0.022)
        objs.append(ob)
        vous.append((a0 + a1) / 2)
    # threshold step
    objs.append(box("dr_step", (2 * OW + 0.3, 0.42, 0.08), mat("stone_dark"), loc=(0, YF - 0.12, 0.04), bevel=0.02))
    # runes on voussoirs and pillars (swap material per frame)
    runes = []
    for k, a in enumerate(vous):
        if k == n // 2:
            continue
        rr = OW + PW / 2
        g = glyph("dr_rune%d" % k, k, 0.17, glow("#1d6878"), loc=(rr * math.cos(a), YF - 0.012, SPR + rr * math.sin(a)),
                  rot=-math.degrees(a - math.pi / 2) * 0.0)
        runes.append(g)
    for sx in (-1, 1):
        for j, z in enumerate((0.55, 0.95)):
            runes.append(glyph("dr_prune%d%d" % (sx, j), j + (sx > 0) * 2, 0.17, glow("#1d6878"),
                               loc=(sx * (OW + PW / 2), YF - 0.012, z)))
    # keystone emblem: a gem
    gem = L.star("dr_gem", 0.1, 0.06, 4, glow("#1d6878"), thickness=0.04)
    gem.location = (0, YF - 0.05, SPR + OW + PW / 2 + 0.04)
    gem_core = L.star("dr_gemc", 0.05, 0.03, 4, glow("#1d6878"), thickness=0.04)
    gem_core.location = (0, YF - 0.07, SPR + OW + PW / 2 + 0.04)
    objs += [gem, gem_core]
    # glowing passage behind the doors
    def arch_poly(w, z0, steps=10):
        pts = [(-w, z0), (w, z0)]
        for s in range(steps + 1):
            a = math.pi * s / steps
            pts.append((w * math.cos(a), SPR + w * math.sin(a)))
        return pts
    portal = []
    for li, (inset, col) in enumerate([(0.0, "#1a5a7a"), (0.1, "#2fa0c8"), (0.22, "#7fe4ff"), (0.34, "#e8fdff")]):
        portal.append(prism("dr_portal%d" % li, arch_poly(OW + 0.02 - inset, 0.0 if li == 0 else inset * 0.6), 0.01,
                            glow(col), y0=YF + D - 0.04 - 0.01 * li))
    objs += portal
    # door leaves (hinged on the outer edges, swinging inward / away from the camera)
    yl = YF + 0.22
    pivots = []
    for sx in (-1, 1):
        pv = L.empty("dr_hinge%d" % sx, loc=(sx * OW, yl, 0))
        pivots.append(pv)
        leaf = []
        planks = 3
        pw = (OW - 0.015) / planks
        for p in range(planks):
            # world x range of this plank, measured from the hinge inward
            d0, d1 = p * pw, (p + 1) * pw - 0.018
            xs = [sx * (OW - d0 - (d1 - d0) * s / 4) for s in range(5)]
            top = [(x, SPR + math.sqrt(max(0.0, OW * OW - x * x)) - 0.01) for x in xs]
            pts = [(xs[0], 0.02), (xs[-1], 0.02)] + list(reversed(top))
            leaf.append(prism("dr_plank%d%d" % (sx, p), pts, 0.09, [mat("wood"), mat("wood_light"), mat("wood")][p],
                              y0=yl, bevel=0.012))
        for j, z in enumerate((0.32, 1.12)):
            leaf.append(box("dr_band%d%d" % (sx, j), (OW - 0.06, 0.03, 0.1), mat("iron_dark"),
                            loc=(sx * OW / 2, yl - 0.055, z), bevel=0.01))
            for q in range(3):
                leaf.append(sphere("dr_rivet%d%d%d" % (sx, j, q), 0.024, mat("brass"),
                                   loc=(sx * (0.1 + q * 0.2), yl - 0.075, z), segs=6, rings=4))
        leaf.append(torus("dr_ring%d" % sx, 0.06, 0.016, mat("brass"), loc=(sx * 0.12, yl - 0.08, 0.72),
                          rot=(90, 0, 0), segs=12, rsegs=4))
        leaf.append(box("dr_ringplate%d" % sx, (0.07, 0.02, 0.07), mat("iron"), loc=(sx * 0.12, yl - 0.06, 0.79)))
        L.parent_to(leaf, pv)
    root = L.group("door", objs + pivots + runes, scale=1.0)
    snap(root)
    rune_cols = ["#1d6878", "#2a9ab4", "#4fd0ea", "#7ff6ff", "#9ffaff", "#bffcff", "#bffcff", "#bffcff"]
    for i in range(8):
        t = ease(i / 7)
        pivots[0].rotation_euler = (0, 0, math.radians(102 * t))
        pivots[1].rotation_euler = (0, 0, math.radians(-102 * t))
        m = glow(rune_cols[i])
        for g in runes:
            for o in L.meshes(g):
                L.set_mat(o, m)
        L.set_mat(gem, glow(rune_cols[min(7, i + 1)]))
        L.set_mat(gem_core, glow("#ffffff" if i >= 2 else rune_cols[min(7, i + 2)]))
        L.render_frame(OUT, "door_exit", i)


# --------------------------------------------------------------------------
# chest


def a_chest():
    setup(20, 11)
    BW, BD, BH = 0.9, 0.58, 0.4
    objs = []
    objs.append(box("ch_body", (BW, BD, BH), mat("wood"), loc=(0, 0, BH / 2), bevel=0.02))
    for j, z in enumerate((0.135, 0.27)):
        objs.append(box("ch_groove%d" % j, (BW - 0.06, BD + 0.006, 0.022), mat("wood_dark"), loc=(0, 0, z)))
    objs.append(box("ch_bottom", (BW + 0.03, BD + 0.03, 0.07), mat("iron_dark"), loc=(0, 0, 0.035), bevel=0.01))
    for sx in (-1, 1):
        for sy in (-1, 1):
            objs.append(box("ch_corner%d%d" % (sx, sy), (0.08, 0.08, BH), mat("iron"),
                            loc=(sx * (BW / 2 - 0.02), sy * (BD / 2 - 0.02), BH / 2), bevel=0.012))
        objs.append(box("ch_strap%d" % sx, (0.07, BD + 0.02, BH - 0.02), mat("iron_dark"), loc=(sx * 0.26, 0, BH / 2)))
        objs.append(sphere("ch_rv%d" % sx, 0.022, mat("gold"), loc=(sx * 0.26, -BD / 2 - 0.015, BH - 0.08), segs=6, rings=4))
    objs.append(box("ch_lock", (0.16, 0.03, 0.15), mat("gold"), loc=(0, -BD / 2 - 0.01, BH - 0.1), bevel=0.012))
    objs.append(box("ch_keyhole", (0.03, 0.02, 0.06), mat("mortar"), loc=(0, -BD / 2 - 0.028, BH - 0.11)))
    # treasure glow inside (visible once the lid lifts)
    objs.append(box("ch_inside", (BW - 0.1, BD - 0.1, 0.02), glow("#ffc93a"), loc=(0, 0, BH - 0.03)))
    objs.append(ellipsoid("ch_insidehot", (BW - 0.35, BD - 0.25, 0.04), glow("#fff2b0"), loc=(0, -0.02, BH - 0.02)))
    for k, (x, y) in enumerate([(-0.2, -0.05), (0.15, 0.06), (0.0, -0.12), (0.28, -0.1), (-0.3, 0.1)]):
        c = L.m_coin(0.07, 0.025, "ch_coin%d" % k)
        c.rotation_euler = (math.radians(70 + 15 * k), 0, math.radians(30 * k))
        c.location = (x, y, BH + 0.0)
        objs.append(c)
    # lid (pivot on the back top edge, rotates about X)
    pv = L.empty("ch_hinge", loc=(0, BD / 2 + 0.02, BH))
    lid = []
    LD, LH = BD + 0.04, 0.17

    def arch(r, h, n=8):
        return [(r * math.cos(math.pi * k / n), h * math.sin(math.pi * k / n)) for k in range(n + 1)]
    lid.append(box("ch_lidbase", (BW + 0.04, LD, 0.08), mat("wood"), loc=(0, 0, BH + 0.04), bevel=0.015))
    lid.append(prism("ch_lidtop", arch(LD / 2, LH), BW + 0.04, mat("wood_light"), loc=(0, 0, BH + 0.08), rot=(0, 0, 90)))
    for sx in (-1, 1):
        lid.append(prism("ch_lidband%d" % sx, arch(LD / 2 + 0.015, LH + 0.015), 0.08, mat("iron"),
                         loc=(sx * 0.26, 0, BH + 0.07), rot=(0, 0, 90)))
        lid.append(prism("ch_lidend%d" % sx, arch(LD / 2 + 0.012, LH + 0.012), 0.05, mat("gold"),
                         loc=(sx * (BW / 2 + 0.01), 0, BH + 0.07), rot=(0, 0, 90)))
    lid.append(box("ch_clasp", (0.11, 0.035, 0.16), mat("gold"), loc=(0, -LD / 2 - 0.01, BH + 0.03), bevel=0.012))
    lid.append(box("ch_lidin", (BW - 0.04, 0.02, 0.06), glow("#ffc93a"), loc=(0, -LD / 2 + 0.03, BH + 0.01)))
    L.parent_to(lid, pv)
    rays = []
    for k, (a, ln) in enumerate([(-38, 0.55), (-18, 0.8), (0, 0.95), (20, 0.75), (40, 0.5)]):
        w = 0.05 if k % 2 else 0.07
        ray = prism("ch_ray%d" % k, [(-w * 0.4, 0), (w * 0.4, 0), (w, ln), (-w, ln)], 0.01,
                    glow("#ffe08a" if k % 2 else "#fff4c0"), rot=(0, a, 0))
        rays.append(ray)
    rg = L.group("ch_rays", rays)
    sparks = [L.sparkle("ch_sp%d" % k, 0.16, glow("#fff6c8")) for k in range(3)]
    root = L.group("chest", objs + [pv, rg] + sparks)
    pv.rotation_euler = (0, 0, 0)
    snap(root)
    rg.location = (0, -0.02, BH + 0.06)
    angles = [0, -14, -48, -88, -112, -108]
    rscale = [0, 0, 0.45, 0.8, 1.0, 0.92]
    for i in range(6):
        pv.rotation_euler = (math.radians(angles[i]), 0, 0)
        L.hide(rg, rscale[i] == 0)
        rg.scale = (0.6 + 0.4 * rscale[i], 1, max(0.01, rscale[i]))
        for k, sp in enumerate(sparks):
            vis = (i == 4 and k < 2) or (i == 5 and k > 0) or (i == 3 and k == 1)
            L.hide(sp, not vis)
            sp.location = [(-0.42, -0.4, 0.75), (0.38, -0.4, 0.95), (0.05, -0.4, 1.25)][k]
        L.render_frame(OUT, "chest", i)


# --------------------------------------------------------------------------
# altar (scroll of power)


def a_altar():
    setup(20, 9)
    objs = []
    objs.append(box("al_base", (1.25, 0.7, 0.12), mat("stone_dark"), loc=(0, 0, 0.06), bevel=0.02))
    objs.append(box("al_step", (1.02, 0.6, 0.12), mat("stone"), loc=(0, 0, 0.18), bevel=0.02))
    objs.append(lathe("al_col", [(0.3, 0.24), (0.26, 0.3), (0.22, 0.36), (0.22, 0.62), (0.27, 0.68), (0.3, 0.72)],
                      mat("stone_light"), segs=8, smooth=False))
    objs.append(box("al_top", (0.86, 0.56, 0.11), mat("stone"), loc=(0, 0, 0.775), bevel=0.02))
    objs.append(box("al_trim", (0.9, 0.6, 0.035), mat("gold"), loc=(0, 0, 0.74)))
    ring = torus("al_ring", 0.11, 0.022, glow("#d8a030"), loc=(0, -0.23, 0.48), rot=(90, 0, 0), segs=16, rsegs=4)
    rune = glyph("al_rune", 3, 0.13, glow("#d8a030"), loc=(0, -0.235, 0.48))
    objs += [ring, rune]
    # small candles
    for sx in (-1, 1):
        objs.append(cyl("al_candle%d" % sx, 0.035, 0.12 + 0.03 * (sx > 0), mat("cloth_cream"),
                        loc=(sx * 0.33, -0.12, 0.83), segs=8))
    flames = []
    root = L.group("altar", objs)
    snap(root)
    z0 = root.location.z
    for i in range(6):
        t = 2 * math.pi * i / 6
        extra = []
        bob = 0.045 * math.sin(t)
        sc, rc, cc = L.m_scroll("gold", length=0.38, r=0.07, aura=0.03)
        sc.rotation_euler = (0, math.radians(-12 + 4 * math.sin(t)), 0)
        sc.location = (0, -0.02, z0 + 1.2 + bob)
        extra.append(sc)
        hr = 0.27 + 0.025 * math.sin(t)
        extra.append(billboard(L.disc("al_halo", hr, glow("#5a3a14"), segs=24), sc.location, 0.4))
        extra.append(billboard(L.disc("al_halo2", hr - 0.06, glow("#8a5a18"), segs=24), sc.location, 0.38))
        # light beam from the altar top to the scroll
        beam = prism("al_beam", [(-0.16, 0), (0.16, 0), (0.08, 0.36), (-0.08, 0.36)], 0.01, glow("#8a5a18"))
        extra.append(billboard(beam, (0, 0, z0 + 0.83), 0.2))
        for k in range(2):
            a = t + k * math.pi
            p = Vector((0.36 * math.cos(a), -0.2 * math.sin(a), z0 + 1.2 + 0.18 * math.sin(a + 1.0)))
            extra.append(billboard(L.sparkle("al_sp%d" % k, 0.13 if (i + k) % 2 else 0.19, glow("#fff2b0")), p, -0.4))
        for sx in (-1, 1):
            fl = L.flame("al_fl%d" % sx, 0.13, 0.04, layers=("#ff7a1e", "#ffd45a", "#fff6c8"), seed=i * 3 + sx,
                         sway=0.2 * math.sin(t + sx))
            g = L.group("al_flg%d" % sx, fl)
            g.location = behind((sx * 0.33, -0.12, z0 + 0.95 + 0.03 * (sx > 0)), -0.05)
            extra.append(g)
        m = glow("#ffd860" if i in (1, 2) else "#d8a030")
        for o in L.meshes([ring, rune]):
            L.set_mat(o, m)
        L.render_frame(OUT, "altar", i)
        for e in extra:
            for o in reversed(L.tree(e)):
                bpy.data.objects.remove(o, do_unlink=True)
    del flames


# --------------------------------------------------------------------------
# pedestal


def a_pedestal():
    setup(20, 9)
    objs = [box("pd_base", (1.0, 0.62, 0.1), mat("stone_dark"), loc=(0, 0, 0.05), bevel=0.02),
            box("pd_body", (0.78, 0.5, 0.36), mat("stone"), loc=(0, 0, 0.28), bevel=0.02),
            box("pd_panel", (0.5, 0.02, 0.22), mat("stone_dark"), loc=(0, -0.255, 0.28), bevel=0.005),
            box("pd_top", (0.96, 0.62, 0.1), mat("stone_light"), loc=(0, 0, 0.5), bevel=0.02),
            box("pd_trim", (1.0, 0.66, 0.03), mat("gold"), loc=(0, 0, 0.445))]
    objs.append(glyph("pd_rune", 1, 0.14, glow("#b45cff"), loc=(0, -0.27, 0.28)))
    for sx in (-1, 1):
        objs.append(box("pd_post%d" % sx, (0.1, 0.54, 0.36), mat("stone_light"), loc=(sx * 0.36, 0, 0.28), bevel=0.015))
    root = L.group("pedestal", objs)
    snap(root)
    L.render_frame(OUT, "pedestal", 0)


# --------------------------------------------------------------------------
# torch (bracket at the anchor)


def a_torch():
    setup(20, 8)
    objs = [box("tc_plate", (0.17, 0.04, 0.26), mat("iron"), loc=(0, 0.12, 0.13), bevel=0.012)]
    for z in (0.04, 0.22):
        objs.append(sphere("tc_nail%d" % int(z * 100), 0.022, mat("brass"), loc=(0, 0.09, z), segs=6, rings=4))
    objs.append(tube("tc_arm", [(0, 0.1, 0.12), (0, 0.0, 0.14), (0, -0.1, 0.24), (0, -0.12, 0.3)], 0.025, mat("iron_dark"),
                     segs=6))
    objs.append(cyl("tc_cup", 0.065, 0.13, mat("iron"), loc=(0, -0.12, 0.26), r_top=0.09, segs=10))
    objs.append(torus("tc_cupring", 0.09, 0.016, mat("brass"), loc=(0, -0.12, 0.39), segs=12, rsegs=4))
    objs.append(cyl("tc_stick", 0.04, 0.4, mat("wood"), loc=(0, -0.12, 0.2), r_top=0.045, segs=8))
    objs.append(ellipsoid("tc_wrap", (0.14, 0.14, 0.15), mat("leather"), loc=(0, -0.12, 0.62)))
    objs.append(ellipsoid("tc_char", (0.12, 0.12, 0.06), mat("black"), loc=(0, -0.12, 0.69)))
    root = L.group("torch", objs)
    snap(root)
    z0 = root.location.z
    for i in range(6):
        t = 2 * math.pi * i / 6
        extra = []
        fl = L.flame("tc_fl", 0.5 + 0.05 * math.sin(t * 2), 0.135, seed=20 + i, sway=0.22 * math.sin(t),
                     squash=(1.0 + 0.06 * math.cos(t), 1.0))
        g = L.group("tc_flg", fl)
        g.location = behind((0, -0.12, z0 + 0.66), -0.06)
        extra.append(g)
        rng = random.Random(i)
        for k in range(2):
            ph = (i / 6 + k * 0.5) % 1.0
            p = Vector((0.1 * math.sin(t * 1.5 + k * 2) + (k - 0.5) * 0.12, -0.12, z0 + 1.05 + 0.4 * ph))
            e = box("tc_ember%d" % k, (0.035, 0.03, 0.035), glow("#ffb03a" if ph < 0.5 else "#ff5a1e"))
            extra.append(billboard(e, p, -0.12))
            del rng
            rng = None
        L.render_frame(OUT, "torch", i)
        for e in extra:
            for o in reversed(L.tree(e)):
                bpy.data.objects.remove(o, do_unlink=True)


# --------------------------------------------------------------------------
# fountain (health, glowing red/pink liquid)


def a_fountain():
    setup(20, 10)
    objs = []
    basin = [(0.0, 0.0), (0.78, 0.0), (0.82, 0.04), (0.82, 0.08), (0.78, 0.1), (0.8, 0.26), (0.88, 0.3),
             (0.9, 0.36), (0.8, 0.38), (0.76, 0.3), (0.0, 0.3)]
    objs.append(lathe("fn_basin", basin, mat("stone"), segs=24, smooth=False))
    objs.append(torus("fn_basinrim", 0.86, 0.035, mat("stone_light"), loc=(0, 0, 0.36), segs=28, rsegs=6))
    objs.append(cyl("fn_pool", 0.79, 0.02, glow("#c8204e"), loc=(0, 0, 0.31), segs=28))
    col = [(0.22, 0.3), (0.16, 0.36), (0.12, 0.46), (0.14, 0.56), (0.11, 0.66), (0.1, 0.84), (0.14, 0.92),
           (0.2, 0.96), (0.0, 0.96)]
    objs.append(lathe("fn_col", col, mat("stone_light"), segs=12, smooth=False))
    bowl = [(0.1, 0.94), (0.28, 0.98), (0.4, 1.06), (0.44, 1.12), (0.4, 1.13), (0.35, 1.08), (0.0, 1.08)]
    objs.append(lathe("fn_bowl", bowl, mat("stone"), segs=20, smooth=False))
    objs.append(cyl("fn_bowlpool", 0.37, 0.02, glow("#e0306a"), loc=(0, 0, 1.08), segs=20))
    fin = [(0.09, 1.08), (0.06, 1.16), (0.08, 1.22), (0.05, 1.3), (0.0, 1.32)]
    objs.append(lathe("fn_fin", fin, mat("stone_light"), segs=10, smooth=False))
    gem = L.lathe("fn_gem", [(0.0, 1.3), (0.07, 1.38), (0.0, 1.5)], glow("#ff3a6a"), segs=6, smooth=False)
    objs.append(gem)
    objs.append(sphere("fn_gemhot", 0.025, glow("#ffd0dc"), loc=(-0.02, -0.06, 1.41), segs=6, rings=4))
    # gold bands
    objs.append(torus("fn_band", 0.81, 0.02, mat("gold"), loc=(0, 0, 0.17), segs=28, rsegs=4))
    root = L.group("fountain", objs)
    snap(root)
    z0 = root.location.z
    streams = []
    for k, phi in enumerate((0, 180, -48, -132)):
        a = math.radians(phi)
        pts = []
        for s in range(9):
            u = s / 8
            r = 0.42 + 0.24 * u ** 0.6
            z = 1.11 - 0.8 * u * u
            pts.append(Vector((r * math.cos(a), r * math.sin(a), z0 + z)))
        streams.append(pts)
        tube("fn_stream%d" % k, pts, [0.03] * 9, glow("#ff4d7e"), segs=6, ref=(0, 0, 1))
    for i in range(6):
        extra = []
        for k, pts in enumerate(streams):
            for d in range(2):
                ph = (i / 6 + d / 2 + k * 0.17) % 1.0
                idx = ph * 8
                j = min(7, int(idx))
                p = pts[j].lerp(pts[j + 1], idx - j)
                extra.append(sphere("fn_drop", 0.042, glow("#ffc2d6"), loc=p, segs=6, rings=4))
            end = pts[-1]
            rr = 0.05 + 0.03 * ((i + k) % 3)
            extra.append(torus("fn_splash", rr, 0.016, glow("#ff9ab8"), loc=(end.x, end.y, z0 + 0.33), segs=10, rsegs=3))
        for j in range(2):
            ph = (i / 6 + j / 2) % 1.0
            extra.append(torus("fn_ripple", 0.2 + 0.4 * ph, 0.012, glow("#ff7aa2"), loc=(0, 0, z0 + 0.325),
                               scale=(1, 1, 0.3), segs=24, rsegs=3))
        extra.append(torus("fn_ripple_top", 0.15 + 0.15 * ((i % 3) / 3), 0.012, glow("#ff9ab8"),
                           loc=(0, 0, z0 + 1.095), segs=16, rsegs=3))
        sp = L.sparkle("fn_sp", 0.15 if i % 2 else 0.2, glow("#ffd0dc"))
        extra.append(billboard(sp, (0.04 if i < 3 else -0.08, 0, z0 + 1.5 + 0.03 * (i % 3)), -0.4))
        L.hide(extra[-1], i in (2, 5))
        L.render_frame(OUT, "fountain", i)
        for e in extra:
            for o in reversed(L.tree(e)):
                bpy.data.objects.remove(o, do_unlink=True)


# --------------------------------------------------------------------------
# shop_stall


def a_shop_stall():
    setup(18, 9)
    objs = []
    CW, CD, CH = 2.0, 0.6, 0.72
    objs.append(box("ss_counterback", (CW, CD - 0.06, CH), mat("wood_dark"), loc=(0, 0.03, CH / 2)))
    n = 9
    pw = CW / n
    for k in range(n):
        objs.append(box("ss_plank%d" % k, (pw - 0.025, 0.05, CH - 0.06), [mat("wood"), mat("wood_light")][k % 2],
                        loc=(-CW / 2 + pw * (k + 0.5), -CD / 2 + 0.02, CH / 2), bevel=0.01))
    objs.append(box("ss_top", (CW + 0.16, CD + 0.12, 0.07), mat("wood_light"), loc=(0, 0, CH + 0.035), bevel=0.015))
    objs.append(box("ss_kick", (CW + 0.06, CD + 0.04, 0.08), mat("wood_dark"), loc=(0, 0, 0.04), bevel=0.01))
    # posts
    PH = 2.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            objs.append(box("ss_post%d%d" % (sx, sy), (0.08, 0.08, PH), mat("wood_dark"),
                            loc=(sx * (CW / 2 + 0.02), sy * (CD / 2 - 0.02), PH / 2), bevel=0.012))
    # awning: sloped striped canopy
    stripes = 8
    sw = (CW + 0.36) / stripes
    z_front, z_back, y_front, y_back = PH - 0.12, PH + 0.18, -CD / 2 - 0.25, CD / 2 + 0.05
    slope = math.degrees(math.atan2(z_back - z_front, y_back - y_front))
    ln = math.hypot(z_back - z_front, y_back - y_front)
    for k in range(stripes):
        m = mat("cloth_red") if k % 2 == 0 else mat("cloth_cream")
        objs.append(box("ss_stripe%d" % k, (sw, ln, 0.04), m,
                        loc=(-(CW + 0.36) / 2 + sw * (k + 0.5), (y_front + y_back) / 2, (z_front + z_back) / 2),
                        rot=(slope, 0, 0)))
        # scalloped valance
        pts = [(-sw / 2, 0)] + [(sw / 2 * math.cos(math.pi * s / 6 + math.pi), -0.13 * math.sin(math.pi * s / 6)) for s in
                                range(7)] + [(sw / 2, 0), (sw / 2, 0.06), (-sw / 2, 0.06)]
        objs.append(prism("ss_val%d" % k, pts, 0.03, m, loc=(-(CW + 0.36) / 2 + sw * (k + 0.5), y_front - 0.01, z_front - 0.04)))
    objs.append(box("ss_beam", (CW + 0.4, 0.06, 0.06), mat("wood_dark"), loc=(0, y_front + 0.02, z_front - 0.07)))
    # sign with a coin
    objs.append(box("ss_sign", (0.5, 0.04, 0.26), mat("wood_light"), loc=(0, -CD / 2 - 0.04, CH * 0.55), bevel=0.015))
    objs.append(box("ss_signframe", (0.54, 0.035, 0.3), mat("wood_dark"), loc=(0, -CD / 2 - 0.025, CH * 0.55)))
    coin = L.m_coin(0.09, 0.03, "ss_coin")
    coin.location = (0, -CD / 2 - 0.08, CH * 0.55)
    objs.append(coin)
    # goods on the counter
    for k, (x, col, s) in enumerate([(-0.7, "potion", 0.75), (-0.52, "ice", 0.62), (0.62, "leaf", 0.68)]):
        f = L.m_flask(liquid=col)
        f.scale = (s, s, s)
        f.location = (x, -0.08, CH + 0.07)
        objs.append(f)
    objs.append(ellipsoid("ss_sack", (0.36, 0.3, 0.34), mat("cloth_cream"), loc=(0.22, 0.05, CH + 0.22)))
    objs.append(ellipsoid("ss_sacktop", (0.14, 0.12, 0.1), mat("cloth_cream"), loc=(0.22, 0.05, CH + 0.42)))
    objs.append(torus("ss_sacktie", 0.08, 0.018, mat("cloth_red"), loc=(0.22, 0.05, CH + 0.37), segs=10, rsegs=4))
    objs.append(box("ss_crate", (0.3, 0.26, 0.22), mat("wood_light"), loc=(-0.15, 0.08, CH + 0.18), rot=(0, 0, 12),
                    bevel=0.02))
    for k, x in enumerate((-0.22, -0.1)):
        objs.append(sphere("ss_apple%d" % k, 0.065, mat("apple"), loc=(x, 0.0, CH + 0.35), segs=8, rings=6))
    # lantern hanging from the beam
    lx = CW / 2 - 0.12
    objs.append(cyl("ss_lanrod", 0.012, 0.12, mat("iron"), loc=(lx, y_front + 0.02, z_front - 0.22), segs=4))
    objs.append(box("ss_lantern", (0.13, 0.13, 0.17), glow("#ffc24a"), loc=(lx, y_front + 0.02, z_front - 0.32)))
    objs.append(box("ss_lantop", (0.17, 0.17, 0.05), mat("iron_dark"), loc=(lx, y_front + 0.02, z_front - 0.215)))
    objs.append(box("ss_lanbot", (0.15, 0.15, 0.04), mat("iron_dark"), loc=(lx, y_front + 0.02, z_front - 0.42)))
    objs.append(box("ss_lancore", (0.06, 0.02, 0.09), glow("#fff2c0"), loc=(lx, y_front - 0.06, z_front - 0.32)))
    root = L.group("shop_stall", objs)
    snap(root)
    L.render_frame(OUT, "shop_stall", 0)


# --------------------------------------------------------------------------
# cage


def a_cage():
    setup(20, 9)
    objs = []
    R = 0.48
    objs.append(lathe("cg_base", [(0, 0), (R + 0.06, 0), (R + 0.06, 0.08), (R, 0.12), (0, 0.12)], mat("iron_dark"),
                      segs=16, smooth=False))
    nb = 12
    for k in range(nb):
        a = 2 * math.pi * k / nb + 0.13
        x, y = R * math.cos(a), R * math.sin(a)
        objs.append(cyl("cg_bar%d" % k, 0.026, 1.42, mat("iron"), loc=(x, y, 0.1), segs=6))
    for z in (0.12, 0.85, 1.5):
        objs.append(torus("cg_hoop%d" % int(z * 100), R, 0.03, mat("iron_dark"), loc=(0, 0, z), segs=24, rsegs=5))
    dome = [(R + 0.02, 1.48), (R * 0.9, 1.62), (R * 0.65, 1.74), (R * 0.3, 1.81), (0, 1.83)]
    objs.append(lathe("cg_dome", dome, mat("iron"), segs=16, smooth=False))
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.13
        pts = [(R * math.cos(a), R * math.sin(a), 1.5), (R * 0.75 * math.cos(a), R * 0.75 * math.sin(a), 1.73),
               (0, 0, 1.83)]
        objs.append(tube("cg_rib%d" % k, pts, 0.024, mat("iron_dark"), segs=5))
    objs.append(torus("cg_ring", 0.1, 0.03, mat("iron"), loc=(0, 0, 1.93), rot=(90, 0, 0), segs=12, rsegs=5))
    objs.append(box("cg_lock", (0.11, 0.05, 0.14), mat("brass"), loc=(0.12, -R - 0.03, 0.85), bevel=0.012))
    # prisoner remains inside
    sk = make_skull("cg_skull", loc=(0.06, 0.05, 0.22), rot=(0, 0, 30), s=0.85)
    objs.append(sk)
    for k, (p0, p1) in enumerate([((-0.25, 0.0, 0.14), (0.15, 0.15, 0.15)), ((-0.15, -0.15, 0.14), (0.25, -0.05, 0.16))]):
        objs.append(make_bone("cg_bone%d" % k, p0, p1, 0.03))
    root = L.group("cage", objs)
    snap(root)
    L.render_frame(OUT, "cage", 0)


def make_skull(name, loc=(0, 0, 0), rot=(0, 0, 0), s=1.0):
    b = mat("bone")
    hole = mat("mortar")
    parts = [ellipsoid(name + "_cran", (0.26, 0.24, 0.22), b, loc=(0, 0, 0.13)),
             ellipsoid(name + "_face", (0.15, 0.2, 0.14), b, loc=(0.06, 0, 0.07)),
             box(name + "_jaw", (0.13, 0.16, 0.06), b, loc=(0.05, 0, 0.025), bevel=0.02)]
    for sy in (-1, 1):
        parts.append(ellipsoid(name + "_eye%d" % sy, (0.06, 0.065, 0.06), hole, loc=(0.1, sy * 0.05, 0.11)))
    parts.append(ellipsoid(name + "_nose", (0.03, 0.03, 0.04), hole, loc=(0.135, 0, 0.065)))
    parts.append(box(name + "_teeth", (0.04, 0.12, 0.02), mat("cloth_cream"), loc=(0.12, 0, 0.045)))
    return L.group(name, parts, loc=loc, rot=rot, scale=s)


def make_bone(name, p0, p1, r):
    p0, p1 = Vector(p0), Vector(p1)
    b = mat("bone")
    parts = [tube(name + "_s", [p0, p1], r, b, segs=6)]
    d = (p1 - p0).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    for p in (p0, p1):
        for sgn in (-1, 1):
            parts.append(sphere(name + "_k", r * 1.35, b, loc=p + side * r * 0.9 * sgn, segs=8, rings=5))
    return L.group(name, parts)


# --------------------------------------------------------------------------
# chains (hanging from a ceiling bracket near the top of the frame)


def a_chains():
    setup(18, 6)
    objs = []
    top = 2.72
    objs.append(box("cn_plate", (0.62, 0.16, 0.08), mat("iron_dark"), loc=(0, 0, top), bevel=0.015))
    for sx in (-1, 1):
        objs.append(sphere("cn_bolt%d" % sx, 0.025, mat("brass"), loc=(sx * 0.24, -0.08, top), segs=6, rings=4))
    ll = 0.17
    specs = [(-0.18, 15, "hook"), (0.02, 12, "shackle"), (0.2, 8, "broken")]
    for k, (x, nl, end) in enumerate(specs):
        objs.append(torus("cn_eye%d" % k, 0.045, 0.02, mat("iron"), loc=(x, 0, top - 0.06), rot=(90, 0, 0), segs=10,
                          rsegs=4))
        links = L.chain("cn_ch%d" % k, nl, ll, mat("iron"), start=(x, 0, top - 0.09), direction=(0, 0, -1),
                        r_wire=0.024, twist0=20 * k)
        objs += links
        endz = top - 0.09 - (ll - 2.4 * 0.024) * (nl - 1) - ll
        if end == "hook":
            pts = [(x, 0, endz + 0.03), (x, 0, endz - 0.1), (x + 0.04, 0, endz - 0.2), (x + 0.12, 0, endz - 0.22),
                   (x + 0.17, 0, endz - 0.16), (x + 0.16, 0, endz - 0.1)]
            objs.append(tube("cn_hook", L.catmull(pts, 3), 0.03, mat("iron_dark"), segs=6))
            objs.append(cone("cn_hooktip", 0.03, 0.0, 0.06, mat("steel_dark"), loc=(x + 0.16, 0, endz - 0.1), segs=6))
        elif end == "shackle":
            objs.append(torus("cn_shackle", 0.12, 0.035, mat("iron_dark"), loc=(x, 0, endz - 0.1), rot=(90, 0, 0),
                              segs=16, rsegs=5))
            objs.append(box("cn_shacklepin", (0.06, 0.07, 0.08), mat("brass"), loc=(x, -0.02, endz - 0.0), bevel=0.01))
        else:
            objs.append(torus("cn_broken", 0.06, 0.024, mat("rust"), loc=(x + 0.02, 0, endz - 0.02), rot=(90, 0, 40),
                              segs=10, rsegs=4))
    root = L.group("chains", objs)
    snap(root)
    L.render_frame(OUT, "chains", 0)


# --------------------------------------------------------------------------
# barrel / crates / bones


def a_barrel():
    setup(20, 10)
    prof = [(0.0, 0.0), (0.26, 0.0), (0.29, 0.1), (0.315, 0.25), (0.325, 0.4), (0.315, 0.55), (0.29, 0.7),
            (0.26, 0.8), (0.0, 0.8)]
    objs = [lathe("br_body", prof, None, segs=14, smooth=False, stave_mats=[mat("wood"), mat("wood_light")])]
    for z, r in ((0.07, 0.275), (0.2, 0.307), (0.6, 0.307), (0.73, 0.275)):
        objs.append(torus("br_hoop%d" % int(z * 100), r, 0.022, mat("iron_dark"), loc=(0, 0, z), segs=20, rsegs=4))
    objs.append(cyl("br_lid", 0.24, 0.02, mat("wood_dark"), loc=(0, 0, 0.795), segs=14))
    for k, x in enumerate((-0.08, 0.08)):
        objs.append(box("br_lidgap%d" % k, (0.015, 0.44, 0.012), mat("mortar"), loc=(x, 0, 0.817)))
    objs.append(cyl("br_tap", 0.04, 0.06, mat("brass"), loc=(0.0, -0.3, 0.28), rot=(90, 0, 0), segs=8))
    root = L.group("barrel", objs)
    snap(root)
    L.render_frame(OUT, "barrel", 0)


def make_crate(name, s):
    objs = [box(name + "_core", (s - 0.04, s - 0.04, s - 0.04), mat("wood"), loc=(0, 0, s / 2))]
    w = 0.08
    lm = mat("wood_light")
    h = s / 2 - w / 2
    for a in (-1, 1):
        for b in (-1, 1):
            objs.append(box(name + "_ex", (s, w, w), lm, loc=(0, a * h, s / 2 + b * h), bevel=0.01))
            objs.append(box(name + "_ey", (w, s, w), lm, loc=(a * h, 0, s / 2 + b * h), bevel=0.01))
            objs.append(box(name + "_ez", (w, w, s), lm, loc=(a * h, b * h, s / 2), bevel=0.01))
    diag = math.degrees(math.atan2(s - 2 * w, s - 2 * w))
    objs.append(box(name + "_brace", (w * 0.9, 0.03, (s - 2 * w) * 1.38), mat("wood_light"), loc=(0, -s / 2 + 0.005, s / 2),
                    rot=(0, diag, 0)))
    objs.append(box(name + "_brace2", (w * 0.9, (s - 2 * w) * 1.38, 0.03), mat("wood_light"), loc=(0, 0, s - 0.005),
                    rot=(diag, 0, 0)))
    for sx in (-1, 1):
        objs.append(sphere(name + "_nail", 0.018, mat("iron"), loc=(sx * h, -s / 2 - 0.005, s - w / 2), segs=6, rings=4))
    return L.group(name, objs)


def a_crates():
    setup(20, 10)
    a = make_crate("cr_a", 0.72)
    a.location = (-0.22, 0.05, 0)
    a.rotation_euler = (0, 0, math.radians(4))
    b = make_crate("cr_b", 0.56)
    b.location = (-0.26, 0.1, 0.72)
    b.rotation_euler = (0, 0, math.radians(-14))
    c = make_crate("cr_c", 0.5)
    c.location = (0.45, -0.08, 0)
    c.rotation_euler = (0, 0, math.radians(-12))
    sack = ellipsoid("cr_sack", (0.34, 0.3, 0.28), mat("cloth_cream"), loc=(0.42, -0.06, 0.62))
    root = L.group("crates", [a, b, c, sack])
    snap(root)
    L.render_frame(OUT, "crates", 0)


def a_bones():
    setup(20, 14)
    objs = [make_skull("bn_skull", loc=(0.1, -0.08, 0.06), rot=(0, -8, -25), s=1.0)]
    objs.append(make_skull("bn_skull2", loc=(-0.38, 0.14, 0.0), rot=(0, 15, 160), s=0.75))
    bones = [((-0.55, -0.1, 0.04), (-0.05, 0.05, 0.05)), ((0.25, 0.05, 0.04), (0.65, -0.1, 0.05)),
             ((-0.2, -0.2, 0.04), (0.3, -0.25, 0.12)), ((-0.65, 0.1, 0.05), (-0.25, -0.15, 0.1)),
             ((0.35, 0.15, 0.04), (0.55, 0.25, 0.25))]
    for k, (p0, p1) in enumerate(bones):
        objs.append(make_bone("bn_bone%d" % k, p0, p1, 0.035))
    for k in range(3):
        a0 = -0.2 + 0.12 * k
        pts = [(a0, 0.2, 0.03), (a0 + 0.08, 0.1, 0.16), (a0 + 0.12, -0.02, 0.18), (a0 + 0.1, -0.1, 0.1)]
        objs.append(tube("bn_rib%d" % k, L.catmull(pts, 2), 0.022, mat("bone"), segs=5))
    objs.append(ellipsoid("bn_dirt", (1.3, 0.55, 0.06), mat("stone_dark"), loc=(0, 0, 0.0)))
    root = L.group("bones", objs)
    snap(root)
    L.render_frame(OUT, "bones", 0)


# --------------------------------------------------------------------------
# banner (tattered, sways)


def _pip(x, z, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1 + 1e-12) + x1:
            inside = not inside
    return inside


def a_banner():
    setup(18, 6)
    BW, BH, TOP = 0.92, 2.25, 2.62
    nx, nz = 28, 64
    dx, dz = BW / nx, BH / nz
    rng = random.Random(9)
    cut = []
    for i in range(nx):
        u = (i + 0.5) / nx
        v = 0.36 * (1 - abs(u - 0.5) * 2)              # swallowtail notch (depth from the bottom)
        v += rng.uniform(0.0, 0.08)
        if i in (5, 6, 20):
            v += 0.22
        cut.append(v)
    holes = [((-0.22, 1.7), 0.06), ((0.24, 1.95), 0.05), ((0.05, 2.08), 0.04)]   # (x, depth), radius
    bell = [(-0.03, 0.0), (0.03, 0.0), (0.03, 0.04), (0.09, 0.07), (0.11, 0.12), (0.12, 0.22), (0.16, 0.3),
            (0.17, 0.34), (-0.17, 0.34), (-0.16, 0.3), (-0.12, 0.22), (-0.11, 0.12), (-0.09, 0.07), (-0.03, 0.04)]
    E0 = 0.52   # emblem top (depth below top)
    bm = bmesh.new()
    verts = {}
    for i in range(nx + 1):
        for j in range(nz + 1):
            verts[(i, j)] = bm.verts.new((-BW / 2 + i * dx, 0, TOP - j * dz))
    for i in range(nx):
        for j in range(nz):
            x = -BW / 2 + (i + 0.5) * dx
            depth = (j + 0.5) * dz
            if depth > BH - cut[i]:
                continue
            if any((x - hx) ** 2 + (depth - hz) ** 2 < hr * hr for (hx, hz), hr in holes):
                continue
            f = bm.faces.new((verts[(i, j)], verts[(i + 1, j)], verts[(i + 1, j + 1)], verts[(i, j + 1)]))
            u = (i + 0.5) / nx
            mi = 0
            if u < 0.08 or u > 0.92 or (0.06 < depth < 0.14):
                mi = 1
            ed = depth - E0
            if _pip(x, ed, bell) or (x * x + (ed - 0.39) ** 2 < 0.04 ** 2):
                mi = 2
            r = math.hypot(x, ed - 0.18)
            if 0.27 < r < 0.31:
                mi = 2
            f.material_index = mi
    # drop unused verts
    for v in list(bm.verts):
        if not v.link_faces:
            bm.verts.remove(v)
    cloth = L.bm_to_object(bm, "bn_cloth", [mat("cloth_dark_red"), mat("gold"), mat("gold")], smooth=False, recalc=False)
    base = [v.co.copy() for v in cloth.data.vertices]
    objs = [cloth]
    objs.append(cyl("bn_rod", 0.03, BW + 0.24, mat("iron_dark"), loc=(-(BW + 0.24) / 2, 0, TOP + 0.02), rot=(0, 90, 0),
                    segs=8))
    for sx in (-1, 1):
        objs.append(sphere("bn_fin%d" % sx, 0.05, mat("brass"), loc=(sx * (BW / 2 + 0.14), 0, TOP + 0.02), segs=8, rings=6))
        objs.append(tube("bn_cord%d" % sx, [(sx * (BW / 2 - 0.02), 0, TOP + 0.03), (0, 0, TOP + 0.24)], 0.014,
                         mat("leather"), segs=4))
    objs.append(sphere("bn_nail", 0.035, mat("brass"), loc=(0, 0.0, TOP + 0.25), segs=6, rings=4))
    root = L.group("banner", objs)
    snap(root)
    me = cloth.data
    for f in range(6):
        t = 2 * math.pi * f / 6
        for v, b in zip(me.vertices, base):
            d = max(0.0, (TOP - b.z) / BH)
            u = (b.x + BW / 2) / BW
            sway = 0.07 * math.sin(t - d * 2.2) * d ** 1.4
            fold = 0.05 * math.sin(2 * math.pi * u * 1.5 + t - d * 3.0) * (0.3 + d)
            v.co = Vector((b.x + sway + 0.02 * math.sin(t + u * 3) * d, b.y + fold, b.z + 0.02 * d * math.cos(t)))
        me.update()
        L.render_frame(OUT, "banner", f)


# --------------------------------------------------------------------------
# boss_gate (portcullis rises)


def a_boss_gate():
    setup(12, 8)
    OW, OH = 0.76, 2.0     # half opening width, opening height
    PW, D = 0.4, 0.8
    objs = []
    for sx in (-1, 1):
        z = 0.0
        for k, h in enumerate((0.42, 0.4, 0.44, 0.38, 0.36)):
            off = 0.04 * ((k + (sx > 0)) % 2)
            objs.append(box("bg_blk%d%d" % (sx, k), (PW + off, D, h - 0.035), [mat("stone_dark"), mat("stone")][k % 2],
                            loc=(sx * (OW + PW / 2 + off / 2), 0, z + h / 2), bevel=0.025))
            z += h
        objs.append(box("bg_core%d" % sx, (PW - 0.06, D - 0.06, OH), mat("mortar"), loc=(sx * (OW + PW / 2), 0, OH / 2)))
        # slot the gate runs in
        objs.append(box("bg_slot%d" % sx, (0.06, 0.12, OH), mat("iron_dark"), loc=(sx * (OW - 0.01), 0, OH / 2)))
    LW = 2 * (OW + PW) + 0.1
    objs.append(box("bg_lintel", (LW, D + 0.08, 0.42), mat("stone"), loc=(0, 0, OH + 0.21), bevel=0.03))
    objs.append(box("bg_lintel2", (LW + 0.06, D + 0.12, 0.1), mat("stone_dark"), loc=(0, 0, OH + 0.46), bevel=0.02))
    # bronze bell emblem with ember eyes on the lintel
    objs.append(lathe("bg_bell", [(0.0, 0.0), (0.14, 0.0), (0.15, 0.03), (0.1, 0.08), (0.09, 0.2), (0.05, 0.26),
                                  (0.0, 0.27)], mat("bronze"), loc=(0, -D / 2 - 0.08, OH + 0.06), segs=12, smooth=False))
    for sx in (-1, 1):
        objs.append(glyph("bg_rune%d" % sx, 2 + (sx > 0), 0.17, glow("#ff5a2a"), loc=(sx * 0.55, -D / 2 - 0.052, OH + 0.21)))
        objs.append(cone("bg_spike%d" % sx, 0.06, 0.0, 0.16, mat("iron"), loc=(sx * (OW + PW / 2), 0, OH + 0.51), segs=6))
    objs.append(box("bg_chainbox", (0.3, 0.2, 0.12), mat("iron_dark"), loc=(-(OW + PW / 2), -D / 2 - 0.08, OH - 0.25),
                    bevel=0.015))
    root = L.group("boss_gate", objs)
    snap(root)
    z0 = root.location.z
    gate_objs = []
    for i in range(8):
        for o in gate_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        gate_objs = []
        lift = 1.88 * ease(i / 7)
        ztop = OH + 0.15
        bottom = lift + 0.12
        xs = [-OW + 0.1 + k * (2 * OW - 0.2) / 6 for k in range(7)]
        for k, x in enumerate(xs):
            if ztop - bottom > 0.01:
                gate_objs.append(box("bg_v%d" % k, (0.075, 0.075, ztop - bottom), mat("iron"),
                                     loc=(x, 0.04, z0 + (ztop + bottom) / 2), bevel=0.012))
            gate_objs.append(cone("bg_tip%d" % k, 0.05, 0.0, 0.16, mat("steel_dark"), loc=(x, 0.04, z0 + bottom + 0.01),
                                  rot=(180, 0, 0), segs=4))
        zz = bottom + 0.08
        while zz < OH:
            gate_objs.append(box("bg_h", (2 * OW - 0.06, 0.06, 0.07), mat("iron_dark"), loc=(0, 0.0, z0 + zz), bevel=0.01))
            for x in xs:
                gate_objs.append(sphere("bg_rv", 0.03, mat("brass"), loc=(x, -0.03, z0 + zz), segs=6, rings=4))
            zz += 0.42
        L.render_frame(OUT, "boss_gate", i)


# --------------------------------------------------------------------------
# bell (boss arena decor, hangs from a yoke + chain)


def a_bell():
    setup(18, 7)
    objs = []
    prof = [(0.0, 0.14), (0.86, 0.14), (0.95, 0.16), (0.98, 0.21), (0.92, 0.28), (0.82, 0.42), (0.71, 0.66),
            (0.64, 0.94), (0.6, 1.24), (0.58, 1.46), (0.52, 1.62), (0.38, 1.73), (0.2, 1.78), (0.0, 1.79)]
    objs.append(lathe("bl_body", prof, mat("bronze"), segs=28))
    objs.append(lathe("bl_mouth", [(0.0, 0.135), (0.86, 0.135), (0.0, 0.135)], mat("mortar"), segs=28))
    for z, r, m in ((0.27, 0.93, "bronze_dark"), (0.36, 0.86, "gold"), (1.3, 0.6, "bronze_dark"), (1.42, 0.59, "gold")):
        objs.append(torus("bl_band%d" % int(z * 100), r, 0.024, mat(m), loc=(0, 0, z), segs=32, rsegs=5))
    # inscription glyphs on the waist (front half)
    for k in range(9):
        a = -math.pi / 2 + (k - 4) * 0.21
        r = 0.62
        g = glyph("bl_gl%d" % k, k, 0.1, mat("bronze_dark"), loc=(r * math.cos(a), r * math.sin(a) - 0.005, 1.36), w=0.03)
        g.rotation_euler = (0, 0, a + math.pi / 2)
        objs.append(g)
    # relief emblem: an ember eye
    objs.append(ellipsoid("bl_emb", (0.3, 0.06, 0.18), mat("bronze_dark"), loc=(0, -0.7, 0.85)))
    objs.append(ellipsoid("bl_embeye", (0.12, 0.06, 0.08), glow("#ff6a2a"), loc=(0, -0.73, 0.85)))
    # patina streaks
    for k, (a, z, ln) in enumerate([(-1.2, 1.2, 0.4), (-1.75, 1.0, 0.55), (-2.2, 1.25, 0.35), (-0.9, 0.95, 0.3)]):
        r = 0.64 if z > 1.0 else 0.68
        objs.append(ellipsoid("bl_pat%d" % k, (0.07, 0.03, ln), L.toon("patina", "#3f8a7a", "#1f4a4e", "#6ab8a0", rim=L.RIM),
                              loc=(r * math.cos(a), r * math.sin(a), z), rot=(0, 0, math.degrees(a) + 90)))
    # clapper
    objs.append(cyl("bl_clapper_rod", 0.03, 0.4, mat("iron_dark"), loc=(0, 0, 0.1), segs=6))
    objs.append(sphere("bl_clapper", 0.1, mat("iron"), loc=(0, 0, 0.08), segs=10, rings=6))
    # crown (canons) + yoke beam
    for sy in (-1, 1):
        objs.append(torus("bl_canon%d" % sy, 0.12, 0.035, mat("bronze"), loc=(0, sy * 0.06, 1.86), rot=(90, 0, 0),
                          segs=12, rsegs=5))
    objs.append(box("bl_yoke", (1.15, 0.28, 0.22), mat("wood_dark"), loc=(0, 0, 2.02), bevel=0.03))
    for sx in (-1, 1):
        objs.append(box("bl_strap%d" % sx, (0.08, 0.3, 0.3), mat("iron"), loc=(sx * 0.2, 0, 1.98), bevel=0.012))
        objs.append(cone("bl_yokecap%d" % sx, 0.1, 0.06, 0.08, mat("iron"), loc=(sx * 0.58, 0, 2.02), rot=(0, 90 * sx, 0),
                         segs=8))
    # chains from the yoke up to a ceiling ring
    for sx in (-1, 1):
        objs += L.chain("bl_ch%d" % sx, 5, 0.16, mat("iron"), start=(sx * 0.4, 0, 2.12),
                        direction=(-sx * 0.38, 0, 1), r_wire=0.024, twist0=10)
    objs.append(torus("bl_topring", 0.09, 0.03, mat("iron_dark"), loc=(0, 0, 2.78), rot=(90, 0, 0), segs=12, rsegs=5))
    # a loose chain draped across the bell (Bell of Chains)
    pts = []
    for k in range(12):
        u = k / 11
        a = -math.pi / 2 - 0.9 + 1.8 * u
        z = 1.25 - 0.55 * u + 0.12 * math.sin(math.pi * u)
        r = 0.63 + 0.12 * (1.25 - z)
        pts.append(Vector((r * math.cos(a) * 1.04, r * math.sin(a) * 1.04, z)))
    for k in range(len(pts) - 1):
        d = pts[k + 1] - pts[k]
        objs += L.chain("bl_drape%d" % k, 1, d.length + 0.06, mat("iron"), start=pts[k], direction=d, r_wire=0.022,
                        twist0=90 * (k % 2))
    root = L.group("bell", objs)
    snap(root)
    L.render_frame(OUT, "bell", 0)


ANIMS = [
    ("door_exit", a_door_exit, 12, False),
    ("chest", a_chest, 12, False),
    ("altar", a_altar, 8, True),
    ("pedestal", a_pedestal, 1, False),
    ("torch", a_torch, 10, True),
    ("fountain", a_fountain, 8, True),
    ("shop_stall", a_shop_stall, 1, False),
    ("cage", a_cage, 1, False),
    ("chains", a_chains, 1, False),
    ("barrel", a_barrel, 1, False),
    ("crates", a_crates, 1, False),
    ("bones", a_bones, 1, False),
    ("banner", a_banner, 6, True),
    ("boss_gate", a_boss_gate, 10, False),
    ("bell", a_bell, 1, False),
]


def main():
    only = L.common.script_args()
    if only:
        os.makedirs(OUT, exist_ok=True)
    else:
        L.clean_dir(OUT)
    L.new_scene(shadows=True)
    for name, fn, fps, loop in ANIMS:
        if only and name not in only:
            continue
        fn()
    L.write_spec(OUT, W, H, (AX, AY), [{"name": n, "fps": f, "loop": lp} for n, _, f, lp in ANIMS])


main()
