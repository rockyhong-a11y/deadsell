"""Shared model / rig / render helpers for the NPC sprite sheets and the key-art scripts.

Used by asset_alchemist.py, asset_merchant.py and asset_seamstress.py.  Never run directly.

Everything is modelled in "native" heroine proportions (1.75 u tall woman, rest pose =
arms and legs hanging straight down, facing +X) directly at WORLD rest coordinates and
then attached to the joint it belongs to (lib_boss.attach_world).  The whole rig is
scaled uniformly by `k` through the root joint, so a character's height is just `k * 1.75`.

Animation is plain FK (screen-plane swings), planted-foot IK for the legs
(lib_heroine.ik2) and phase-lagged sinusoids for the secondary motion (cloth, vials,
lantern, scarf tails).  Frames are written by common.render_animation.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import common  # noqa: E402
from common import ellipsoid, limb, box, cone, Rig  # noqa: E402
import lib_heroine as LH  # noqa: E402
import lib_boss as LB  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FW, FH, AX, AY = 128, 128, 64, 116
RIM = LH.RIM
D2R = math.pi / 180.0
TAU = 2 * math.pi


# ---------------------------------------------------------------------------
# materials


def mat(name, base, shadow=None, light=None, rim=True, **kw):
    """Flat 3-band toon material with the cool back rim (same family as the heroine)."""
    return LH.toon_h(name, base, shadow, light, rim=RIM if rim else None, **kw)


def glow(name, color):
    """Flat unlit emissive colour (vials, lanterns, eyes)."""
    return LH.toon_h(name, "#000000", emission=color)


# ---------------------------------------------------------------------------
# scene


def setup_scene(yaw=20.0, pitch=4.0):
    common.reset_scene()
    # warm key from the upper front (camera side); cool rim lives in the materials
    common.add_sun((-0.45, 0.55, -0.70), energy=3.2, color=(1.0, 0.95, 0.88))
    sc = bpy.context.scene
    sc.eevee.shadow_cube_size = "512"
    sc.eevee.shadow_cascade_size = "1024"
    common.setup_sprite_camera(FW, FH, AX, AY, yaw_deg=yaw, pitch_deg=pitch)
    return sc


# ---------------------------------------------------------------------------
# the character


class NPC:
    """Rigged woman built from world-space parts.  `k` scales the whole rig."""

    def __init__(self, name, k=1.0):
        self.name = name
        self.k = k
        self.rig = Rig(name)
        self.vis = {}
        J = self.rig.joint
        J("hips", "root", (0, 0, 0.92))
        J("spine", "hips", (0, 0, 1.03))
        J("chest", "spine", (0, 0, 1.18))
        J("neck", "chest", (0, 0, 1.42))
        J("head", "neck", (0, 0, 1.48))
        J("eye_n", "head", (0.11, -0.072, 1.595))
        J("eye_f", "head", (0.11, 0.072, 1.595))
        for s, y in (("n", -0.15), ("f", 0.15)):
            J("sh_" + s, "chest", (0, y, 1.37))
            J("el_" + s, "sh_" + s, (0, y, 1.11))
            J("ha_" + s, "el_" + s, (0, y, 0.89))
        for s, y in (("n", -0.085), ("f", 0.085)):
            J("th_" + s, "hips", (0, y, 0.90))
            J("kn_" + s, "th_" + s, (0, y, 0.50))
            J("an_" + s, "kn_" + s, (0, y, 0.09))

    # -- part creation helpers (world rest coordinates) -----------------------
    def _at(self, ob, joint):
        LB.attach_world(self.rig, ob, joint)
        return ob

    def E(self, joint, name, size, m, loc, rot=(0, 0, 0), segs=14, rings=9):
        return self._at(ellipsoid(name, size, m, loc=loc, rot=rot, segs=segs, rings=rings), joint)

    def B(self, joint, name, size, m, loc, rot=(0, 0, 0), bevel=0.0):
        return self._at(box(name, size, m, loc=loc, rot=rot, bevel=bevel), joint)

    def L(self, joint, name, length, r0, r1, m, loc, rot=(0, 0, 0), depth=1.0, segs=10):
        ob = limb(name, length, r0, r1, m, depth_scale=depth, segs=segs)
        ob.location = loc
        ob.rotation_euler = [math.radians(a) for a in rot]
        return self._at(ob, joint)

    def C(self, joint, name, rb, rt, h, m, loc, rot=(0, 0, 0), segs=12, depth=1.0):
        return self._at(cone(name, rb, rt, h, m, loc=loc, rot=rot, segs=segs, depth_scale=depth), joint)

    def Y(self, joint, name, r, h, m, loc, rot=(0, 0, 0), segs=16, scale=(1, 1, 1)):
        return self._at(LH.cyl(name, r, h, m, loc=loc, rot=rot, segs=segs, scale=scale), joint)

    def R(self, joint, name, R, r, m, loc, rot=(0, 0, 0), scale=(1, 1, 1), maj=16, mino=6):
        return self._at(LH.torus(name, R, r, m, loc=loc, rot=rot, scale=scale, maj=maj, mino=mino), joint)

    def T(self, joint, name, pts, radii, m, sides=6, flat=1.0, caps=True):
        return self._at(LH.tube(name, pts, radii, m, sides=sides, flat=flat, caps=caps), joint)

    def P(self, joint, name, pts, thick, m, loc=(0, 0, 0), rot=(0, 0, 0)):
        ob = LH.prism(name, pts, thick, m)
        LH.place(ob, loc, rot)
        return self._at(ob, joint)

    def skirt(self, joint, name, a0, a1, r0, r1, h, thick, m, z, segs=12, sy=1.1, flare_back=0.0):
        ob = LH.skirt_panel(name, a0, a1, r0, r1, h, thick, m, segs=segs, sy=sy, flare_back=flare_back)
        LH.place(ob, (0, 0, z))
        return self._at(ob, joint)

    # -- standard anatomy -----------------------------------------------------------
    def body(self, M):
        """Torso, arms and legs.  M keys: pelvis waist top shoulder sleeve sleeve_f cuff glove glove_f
        leg leg_f boot boot_f bootcuff sole belt buckle skin."""
        E, L, B = self.E, self.L, self.B
        E("hips", "pelvis", (0.30, 0.31, 0.24), M["pelvis"], (-0.02, 0, 0.92))
        E("spine", "waist", (0.19, 0.23, 0.26), M["waist"], (0.0, 0, 1.07))
        E("chest", "ribs", (0.25, 0.29, 0.29), M["top"], (-0.015, 0, 1.25))
        E("chest", "bust", (0.16, 0.25, 0.13), M["top"], (0.065, 0, 1.225))
        E("hips", "belt", (0.285, 0.325, 0.065), M["belt"], (-0.005, 0, 0.985))
        B("hips", "buckle", (0.035, 0.07, 0.055), M["buckle"], (0.14, 0, 0.985))
        for s, y in (("n", -0.15), ("f", 0.15)):
            far = s == "f"
            sl = M["sleeve_f"] if far else M["sleeve"]
            gl = M["glove_f"] if far else M["glove"]
            E("sh_" + s, "pauld_" + s, (0.15, 0.14, 0.12), M["shoulder"], (0.0, y, 1.375))
            L("sh_" + s, "ua_" + s, 0.26, 0.052, 0.046, sl, (0, y, 1.37))
            L("el_" + s, "fa_" + s, 0.22, 0.046, 0.040, sl, (0, y, 1.11))
            E("el_" + s, "cuff_" + s, (0.1, 0.1, 0.045), M["cuff"], (0, y, 0.94))
            E("ha_" + s, "hand_" + s, (0.08, 0.065, 0.085), gl, (0.008, y, 0.855))
        for s, y in (("n", -0.085), ("f", 0.085)):
            far = s == "f"
            lg = M["leg_f"] if far else M["leg"]
            bt = M["boot_f"] if far else M["boot"]
            L("th_" + s, "thigh_" + s, 0.40, 0.088, 0.06, lg, (0, y, 0.90))
            L("kn_" + s, "shin_" + s, 0.41, 0.058, 0.046, lg, (0, y, 0.50))
            L("kn_" + s, "boot_" + s, 0.29, 0.064, 0.053, bt, (0, y, 0.38))
            E("kn_" + s, "bootcuff_" + s, (0.15, 0.145, 0.06), M["bootcuff"], (0, y, 0.375))
            B("an_" + s, "foot_" + s, (0.2, 0.09, 0.085), bt, (0.05, y, 0.042), bevel=0.025)
            B("an_" + s, "sole_" + s, (0.205, 0.095, 0.025), M["sole"], (0.05, y, 0.012))

    def face(self, M, blush=False):
        """Head (skin), neck, eyes (own joints so they can blink) and the two mouth states."""
        E = self.E
        E("head", "head_m", (0.235, 0.215, 0.265), M["skin"], (0.02, 0, 1.595))
        E("head", "chin", (0.11, 0.13, 0.09), M["skin"], (0.075, 0, 1.505))
        E("head", "nose", (0.04, 0.03, 0.045), M["skin"], (0.14, 0, 1.575))
        self.L("neck", "neck_m", 0.1, 0.045, 0.048, M["skin"], (0, 0, 1.50))
        E("eye_n", "eye_n", (0.052, 0.045, 0.058), M["eye"], (0.11, -0.072, 1.595))
        E("eye_f", "eye_f", (0.052, 0.045, 0.058), M["eye"], (0.11, 0.072, 1.595))
        self.vis["mouth_c"] = E("head", "mouth_c", (0.026, 0.065, 0.014), M["mouth"], (0.123, 0, 1.532), segs=10, rings=6)
        self.vis["mouth_o"] = E("head", "mouth_o", (0.03, 0.052, 0.04), M["mouth"], (0.123, 0, 1.526), segs=10, rings=6)
        if blush:
            E("head", "blush", (0.045, 0.014, 0.04), M["blush"], (0.108, -0.097, 1.548), segs=8, rings=5)

    # -- animation helpers -----------------------------------------------------
    def legs(self, hip_dx=0.0, hip_dz=0.0, xn=0.06, xf=-0.10):
        """Planted-foot IK for both legs (hips unrotated).  Returns swing angles."""
        a = {}
        for s, tx in (("n", xn), ("f", xf)):
            up, lo, low = LH.ik2((hip_dx, 0.90 + hip_dz), (tx, 0.09), LH.LEG_L1, LH.LEG_L2, 0.0, -1)
            a["th_" + s] = up
            a["kn_" + s] = lo
            a["an_" + s] = LH.angnorm(-low)
        return a

    def frame(self, angles, hip=(0.0, 0.0), off=None, sc=None, tw=None, blink=0.0, lift=0.0):
        """Assemble a render_animation pose tuple (angles, offsets, scales, twists).
        `lift` raises the whole character (world units) to put the soles exactly on the anchor row."""
        o = {"hips": (hip[0], 0.0, hip[1])}
        if lift:
            o["root"] = (0.0, 0.0, lift)
        o.update(off or {})
        s = {"root": (self.k, self.k, self.k)}
        if blink > 0:
            z = max(0.12, 1.0 - blink)
            s["eye_n"] = (1.0, 1.0, z)
            s["eye_f"] = (1.0, 1.0, z)
        s.update(sc or {})
        return angles, o, s, tw or {}

    def mouth(self, frame, open_):
        common.keyed_visibility(self.vis["mouth_c"], frame, not open_)
        common.keyed_visibility(self.vis["mouth_o"], frame, open_)

    # -- output ----------------------------------------------------------------
    def render(self, anims, out_name=None):
        """anims: [dict(name, n, fps, loop, fn(i, n) -> frame tuple, mouth(i, n) -> bool)]"""
        out = os.path.join(ROOT, "build", "frames", out_name or self.name)
        os.makedirs(out, exist_ok=True)
        for fn in os.listdir(out):
            if fn.endswith(".png"):
                os.remove(os.path.join(out, fn))
        for a in anims:
            mf = a.get("mouth")
            xf = a.get("extra")           # optional per-frame hook (frame already posed), e.g. a per-frame thread mesh

            def extra(i, n, frame, mf=mf, xf=xf):
                self.mouth(frame, bool(mf(i, n)) if mf else False)
                if xf:
                    xf(i, n, frame)
            common.render_animation(self.rig, a["name"], a["n"], a["fn"], out, extra)
            if a.get("done"):
                a["done"]()
            print("NPC %s: %s x%d" % (self.name, a["name"], a["n"]))
        spec = {"frameW": FW, "frameH": FH, "anchor": [AX, AY], "outline": True, "colors": 0,
                "animations": [{"name": a["name"], "fps": a["fps"], "loop": a.get("loop", False)} for a in anims]}
        with open(os.path.join(out, "spec.json"), "w") as f:
            json.dump(spec, f, indent=1)
        return out


def pend(t, amp, lag=0.0, harm=1, phase=0.0):
    """Phase-lagged sinusoid for loops: t in 0..1, integer harmonic so the loop closes."""
    return amp * math.sin(TAU * (harm * t - lag) + phase)
