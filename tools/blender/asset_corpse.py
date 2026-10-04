"""Corpse sheet (시체 조각): 24x24 frames, anchor (12,22) = ground contact, bottom-centre.

blender -b --factory-startup -P tools/blender/asset_corpse.py
Writes build/frames/corpse/<anim>_###.png + spec.json.

piece      6 f loop  a stitched chunk of the dead: pale flesh lump, bone end, dark-red cross stitches,
                     a cyan ember glint; turns a full 360 deg over the loop
piece_big  6 f loop  the same at ~1.4x (drops worth >= 3 pieces)
The model (lib_objects.m_corpse_piece) is shared with the HUD / codex icon.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector  # noqa: E402
import lib_objects as L  # noqa: E402

OUT = os.path.join(L.FRAMES, "corpse")
W = H = 24
AX, AY = 12, 22
PPU = L.common.PX_PER_UNIT
N = 6


def setup(yaw=15, pitch=14):
    L.clear_objects(cameras=True)
    L.camera(W, H, AX, AY, yaw=yaw, pitch=pitch)


def behind(center, dist):
    _, _, fwd = L.cam_basis()
    return Vector(center) + fwd * dist


def snap(root, row=AY - 1):
    """Sit the lowest visible pixel of root on `row`."""
    L.ground_snap(root, [root], lift=-(row - AY) / PPU)


def a_piece(name, scale):
    for i in range(N):
        setup()
        root = L.m_corpse_piece(scale)
        # turn in place: a full turn over the loop, with a slight tilt so the cut end shows
        root.rotation_euler = (0, math.radians(-8), math.radians(360.0 * i / N + 20))
        snap(root)
        if i in (1, 4):
            # ember twinkle (camera-facing plus sign)
            sp = L.sparkle("cp_tw", 0.14 * scale, L.glow("#e6fdff"))
            sp.location = behind(Vector((0.1, 0, 0.3 * scale)), -0.3)
            L.face_camera(sp)
        L.render_frame(OUT, name, i)


ANIMS = [
    {"name": "piece", "fps": 10, "loop": True},
    {"name": "piece_big", "fps": 10, "loop": True},
]


def main():
    only = L.common.script_args()
    if only:
        os.makedirs(OUT, exist_ok=True)
    else:
        L.clean_dir(OUT)
    L.new_scene(shadows=False)
    if not only or "piece" in only:
        a_piece("piece", 0.66)
    if not only or "piece_big" in only:
        a_piece("piece_big", 0.92)
    L.write_spec(OUT, W, H, (AX, AY), ANIMS)


main()
