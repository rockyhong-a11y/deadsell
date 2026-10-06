"""Stash prop sheet (CONTENT4 6.3): 64x80 frames, anchor (32,78) = bottom-centre (ground contact).

blender -b --factory-startup -P tools/blender/asset_stash.py [anim ...]
Writes build/frames/stash/<anim>_###.png + spec.json (packed to public/assets/sprites/stash.png by pack_all.py).

An upright reliquary coffin on a stone plinth: iron-banded wooden door with a small skull relief and a lock whose
keyhole glows cyan.  idle (6 f loop): the lock and the seam of light round the door pulse.  open (6 f): the door
swings open on its left hinge and cyan light spills out of the cavity (a glow behind it, a pool on the floor).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_objects as L  # noqa: E402
from lib_objects import glow, prism, ellipsoid  # noqa: E402

OUT = os.path.join(L.FRAMES, "stash")
W, H = 64, 80
AX, AY = 32, 78
CY = 1.1                          # centre height of the coffin (rays radiate from here)


def lerp_hex(a, b, t):
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(int(round(x + (y - x) * t)) for x, y in zip(ca, cb))


def setup():
    L.clear_objects(cameras=True)
    L.camera(W, H, AX, AY, yaw=20, pitch=8)
    root, P = L.m_stash()
    L.ground_snap(root)
    return root, P


def pulse(P, p):
    """p 0..1: lock keyhole, ring and the seam of light round the door."""
    L.set_mat(P["lock"][0], glow(lerp_hex("#2a9cc0", "#e6fdff", p)))
    L.set_mat(P["lock"][1], glow(lerp_hex("#1a6a8a", "#4fe3ff", p)))
    L.set_mat(P["lock"][2], glow(lerp_hex("#12384a", "#1a8ab0", p)))
    L.set_mat(P["leak"], glow(lerp_hex("#0e4a68", "#2a9cc0", p)))
    s = 0.9 + 0.2 * p
    P["lock"][1].scale = (s, s, s)
    P["lock"][2].scale = (0.6 + 0.5 * p, 0.6 + 0.5 * p, 0.6 + 0.5 * p)


def a_idle():
    root, P = setup()
    for i in range(6):
        pulse(P, 0.5 + 0.5 * math.sin(2 * math.pi * i / 6 - math.pi / 2))
        L.render_frame(OUT, "idle", i)


def glow_halo(open_t):
    """Cool light behind the coffin that swells as the door opens."""
    a = ellipsoid("st_halo", (1.5, 0.02, 2.3), glow("#0e3a58"), loc=(-0.16, 0.45, CY))
    b = ellipsoid("st_halo2", (1.1, 0.02, 1.75), glow("#145a80"), loc=(-0.16, 0.43, CY))
    for o in (a, b):
        o.scale = (max(0.01, open_t), 1, max(0.01, open_t))
        L.hide(o, open_t <= 0)
    return [a, b]


def a_open():
    root, P = setup()
    door = P["door"]
    ang = [0, -16, -48, -84, -108, -112]
    amt = [0.0, 0.0, 0.35, 0.7, 1.0, 0.95]
    spill = [ellipsoid("st_spill", (1.0, 0.55, 0.04), glow("#0e4a68"), loc=(-0.05, -0.5, 0.02)),
             ellipsoid("st_spill2", (0.62, 0.34, 0.05), glow("#2a9cc0"), loc=(-0.05, -0.48, 0.03))]
    sparks = [L.sparkle("st_sp%d" % k, 0.14, glow("#e6fdff")) for k in range(3)]
    for i in range(6):
        door.rotation_euler = (0, 0, math.radians(ang[i]))
        pulse(P, 1.0 if i < 2 else 0.35)
        halo = glow_halo(amt[i])
        for s in spill:
            L.hide(s, amt[i] <= 0)
            s.scale = (max(0.01, amt[i]), max(0.01, amt[i]), 1)
        for k, sp in enumerate(sparks):
            vis = (i == 4 and k < 2) or (i == 5 and k > 0) or (i == 3 and k == 1)
            L.hide(sp, not vis)
            sp.location = [(-0.5, -0.62, 1.7), (0.42, -0.5, 1.35), (0.1, -0.55, 2.2)][k]
        L.render_frame(OUT, "open", i)
        for o in halo:                    # rebuilt every frame (its scale is the animation), so drop it again
            L.bpy.data.objects.remove(o, do_unlink=True)


ANIMS = [("idle", a_idle, 8, True), ("open", a_open, 10, False)]


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
