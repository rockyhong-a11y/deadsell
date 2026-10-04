"""Mid-boss 2: the Spider Queen (mb_arachne) sprite sheet.

blender -b --factory-startup -P tools/blender/asset_mb_arachne.py [-- anim ...]
  -> build/frames/mb_arachne/<anim>_###.png + spec.json   (frame 224x176, anchor (112,164))
  then: python3 tools/pack/pack_all.py mb_arachne

A pale woman (long black hair, crown of bone, red glowing eyes) growing out of the front of a huge
black spider body with 8 animated legs (non-humanoid silhouette, ~2.4 u tall, ~4 u long).
Standalone: only shared helpers from common.py / lib_boss.py are imported.  With anim names after
`--` only those are re-rendered.

Animations: idle walk web(w5/a2/r5) leap leap_land(w2/a2/r5) bite(w4/a2/r5) hurt death.
"""
import sys
import os
import math
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import (script_args, reset_scene, add_sun, setup_sprite_camera, toon, ellipsoid, limb,  # noqa: E402
                    cone, join, Rig, ease)
from lib_boss import (FX, anim_render, frames_dir, write_spec, mesh_object, bake, place,  # noqa: E402
                      attach_world, solidify, grid_sheet, tattered, Skin, chain_weights, Pose2D, ROOT, RIM)
from mathutils import Vector  # noqa: E402

ID = "mb_arachne"
FW, FH, AX, AY = 224, 176, 112, 164
ONLY = script_args()
D2R = math.pi / 180.0

reset_scene()
add_sun((0.5, 0.6, -0.7), energy=3.2)
setup_sprite_camera(FW, FH, AX, AY, yaw_deg=20, pitch_deg=4)

# --------------------------------------------------------------------------
# materials


class Mats:
    pass


M = Mats()


def _t(n, b, s, l):  # noqa: E741
    return toon("ar_" + n, b, s, l, rim=RIM)


M.shell = _t("shell", "#241a38", "#0d0819", "#4a3b72")
M.leg = _t("leg", "#4e3c7c", "#1e1338", "#8e78c8")
M.shell2 = _t("shell2", "#3d2e5e", "#170f2a", "#6d5a9c")
M.mark = _t("mark", "#c2334e", "#5c1228", "#ee6a82")
M.bone = _t("bone", "#e6dac0", "#85766a", "#fff6e0")
M.skin = _t("skin", "#dccadb", "#7e6a92", "#f7edf6")
M.hair = _t("hair", "#1c1626", "#09060f", "#453a66")
M.bodice = _t("bodice", "#2c2040", "#110a1d", "#4d3d6c")
M.silk = _t("silk", "#dfe6f0", "#8a93ad", "#ffffff")
M.lips = _t("lips", "#7a2448", "#3a0f26", "#a8406c")
M.mouth = toon("ar_mouth", "#2a0a16", "#16050d", "#3d1020")
M.eye = toon("ar_eye", "#000000", emission="#ff4a4a")
M.eye_hot = toon("ar_eye_hot", "#000000", emission="#ffe0d0")
M.eye8 = toon("ar_eye8", "#000000", emission="#ff8a5a")
M.web = toon("ar_web", "#000000", emission="#eef2fa")
M.web2 = toon("ar_web2", "#000000", emission="#7e8fba")
M.dust = toon("ar_dust", "#8a7a74", "#4a3c48", "#c2b3a2")
M.ring = toon("ar_ring", "#000000", emission="#d9c4ff")
for _v in vars(M).values():
    _v.shadow_method = "NONE"

# --------------------------------------------------------------------------
# rig

SW = 1.16                                   # the woman is modelled at 1.0 and scaled up about her hips
WB = Vector((0.62, 0, 1.2))


def sw(v):
    return tuple(WB + (Vector(v) - WB) * SW + Vector((0, 0, -0.15)))


r = Rig("arachne")
J0 = r.joint
J = lambda n, par, at: J0(n, par, sw(at))  # noqa: E731  (woman joints)
J0("body", "root", (0.3, 0, 1.0))
J0("abd", "body", (-0.3, 0, 1.12))
J("torso", "body", (0.62, 0, 1.2))
J("chest", "torso", (0.65, 0, 1.6))
J("neck", "chest", (0.72, 0, 1.92))
J("head", "neck", (0.78, 0, 2.04))
J("hr0", "head", (0.55, 0, 2.2))
J("hr1", "hr0", (0.3, 0, 1.68))
J("hr2", "hr1", (0.1, 0, 1.22))
for s_, y in (("n", -0.3), ("f", 0.3)):
    J("sh_" + s_, "chest", (0.66, y, 1.86))
    J("el_" + s_, "sh_" + s_, (0.66, y, 1.36))
    J("ha_" + s_, "el_" + s_, (0.66, y, 0.84))
    J0("fg_" + s_, "body", (1.0, y * 0.5, 0.98))
J = J0

LEG_HIP = [0.85, 0.5, 0.1, -0.25]
LEG_KNEE = [(1.6, 1.22), (1.15, 1.28), (-0.55, 1.72), (-1.15, 1.62)]
LEG_FOOT = [1.95, 1.35, -0.75, -1.8]
LEG_BEND = [1, 1, -1, -1]
LEGS = []          # (name, i, side)
limbs = {"sh_n": ("el_n", "ha_n", -1), "sh_f": ("el_f", "ha_f", -1)}
for i in range(4):
    for s_, y in (("n", -0.74 - 0.1 * (i // 2)), ("f", 0.74 + 0.1 * (i // 2))):
        hx = LEG_HIP[i] + (0.04 if s_ == "f" else 0.0)
        n0 = "l%d%s" % (i + 1, s_)
        J(n0, "body", (hx, y, 0.98))
        J(n0 + "k", n0, (LEG_KNEE[i][0] + (0.04 if s_ == "f" else 0), y, LEG_KNEE[i][1]))
        J(n0 + "f", n0 + "k", (LEG_FOOT[i] + (0.08 if s_ == "f" else 0), y, 0.06))
        limbs[n0] = (n0 + "k", n0 + "f", LEG_BEND[i])
        LEGS.append((n0, i, s_))


class LegPose(Pose2D):
    """Pose2D whose 2-bone IK also works for limbs that do NOT hang straight down at rest (spider legs)."""

    def _ik(self, j, tgt, ang, W, pa, off):
        mid, end, bend = self.limbs[j]
        if len(tgt) > 3:
            bend = tgt[3]
        L1 = self.length(j, mid)
        L2 = self.length(mid, end)
        l1x, l1z = self.local_rest(mid)
        l2x, l2z = self.local_rest(end)
        rho1 = math.degrees(math.atan2(l1x, -l1z))
        rho2 = math.degrees(math.atan2(l2x, -l2z))
        px, pz, _ = W[j]
        dx, dz = tgt[0] - px, tgt[1] - pz
        dist = math.hypot(dx, dz) or 1e-6
        d = max(abs(L1 - L2) + 0.15, min(L1 + L2 - 1e-4, dist))
        beta = math.degrees(math.atan2(dx, -dz))
        g = math.degrees(math.acos(max(-1, min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))))
        phi1 = beta + g if bend == 1 else beta - g
        kz = pz - L1 * math.cos(math.radians(phi1))
        alt = beta - g if bend == 1 else beta + g
        if kz < pz - 0.05 and pz - L1 * math.cos(math.radians(alt)) > kz:
            phi1, kz = alt, pz - L1 * math.cos(math.radians(alt))   # never fold the knee down through the floor
        kx = px + L1 * math.sin(math.radians(phi1))
        ex, ez = px + dx / dist * d, pz + dz / dist * d
        phi2 = math.degrees(math.atan2(ex - kx, -(ez - kz)))
        ang[j] = (phi1 - rho1) - pa
        ang[mid] = (phi2 - rho2) - (phi1 - rho1)
        W[j] = (px, pz, phi1 - rho1)


P = LegPose(r, limbs)
A = lambda ob, j: attach_world(r, ob, j)  # noqa: E731
CAB = Vector((-1.0, 0, 1.0))


def scale_about(ob, c, k):
    from mathutils import Matrix
    bake(ob)
    ob.data.transform(Matrix.Translation(c) @ Matrix.Scale(k, 4) @ Matrix.Translation(-c))
    return ob


def drop(ob):
    ob.data.transform(__import__("mathutils").Matrix.Translation((0, 0, -0.15)))
    return ob


Aw = lambda ob, j: attach_world(r, drop(scale_about(ob, WB, SW)), j)  # noqa: E731  (woman parts)
Ab = lambda ob, j: attach_world(r, scale_about(ob, CAB, 0.9), j)  # noqa: E731  (abdomen parts)


def E(name, size, mat, loc, rot=(0, 0, 0), segs=14, rings=8):
    return bake(ellipsoid(name, size, mat, loc=loc, rot=rot, segs=segs, rings=rings))


def seg(name, p0, p1, r0, r1, mat, depth=1.0, segs=10):
    d = Vector(p1) - Vector(p0)
    th = math.degrees(math.atan2(-d.x, -d.z))
    ob = limb(name, d.length, r0, r1, mat, depth_scale=depth, segs=segs)
    return place(ob, tuple(p0), rot=(0, th, 0))


def spike(name, base, tip, rad, mat, segs=6):
    """Cone from `base` to `tip` (planar in XZ at constant y)."""
    d = Vector(tip) - Vector(base)
    th = math.degrees(math.atan2(-d.x, -d.z))
    ob = cone(name, rad, 0.0, d.length, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=segs)
    # cone() points +Z; rotate so +Z -> d
    ob.rotation_euler = (0, math.radians(th + 180.0), 0)
    ob.location = base
    return bake(ob)


# ---- 8 legs
for n0, i, s_ in LEGS:
    y = r.world_rest[n0].y
    hp, kp, fp = r.world_rest[n0], r.world_rest[n0 + "k"], r.world_rest[n0 + "f"]
    A(E(n0 + "_coxa", (0.26, 0.2, 0.26), M.shell2, tuple(hp)), n0)
    A(seg(n0 + "_fem", tuple(hp), tuple(kp), 0.1, 0.08, M.leg), n0)
    A(E(n0 + "_knee", (0.2, 0.2, 0.2), M.bone, tuple(kp)), n0 + "k")
    A(seg(n0 + "_tib", tuple(kp), tuple(fp), 0.075, 0.03, M.leg), n0 + "k")
    mid = (kp + fp) * 0.5
    A(E(n0 + "_band", (0.16, 0.16, 0.16), M.bone if i in (0, 3) else M.shell2, tuple(kp.lerp(fp, 0.28)),
        segs=8, rings=6), n0 + "k")
    A(spike(n0 + "_hair", tuple(kp.lerp(fp, 0.55) + Vector((0.0, 0, 0.0))),
            tuple(kp.lerp(fp, 0.55) + Vector((0.16 if i < 2 else -0.16, 0, 0.12))), 0.03, M.shell2, segs=5),
      n0 + "k")
    A(E(n0 + "_tip", (0.09, 0.09, 0.09), M.bone, tuple(fp + Vector((0, 0, 0.02))), segs=8, rings=6), n0 + "f")

# ---- cephalothorax, abdomen, markings
A(E("ceph", (1.5, 1.0, 0.7), M.shell, (0.35, 0, 0.98)), "body")
A(E("ceph_front", (0.6, 0.7, 0.5), M.shell, (0.95, 0, 0.96)), "body")
A(E("petiole", (0.5, 0.4, 0.4), M.shell2, (-0.3, 0, 1.1)), "body")
Ab(E("abdomen", (2.0, 1.36, 1.5), M.shell, (-1.12, 0, 1.2), rot=(0, 10, 0)), "abd")
Ab(E("abd_top", (1.3, 0.9, 0.7), M.shell2, (-1.0, 0, 1.78), rot=(0, 10, 0)), "abd")
Ab(E("hg_a", (0.36, 0.05, 0.3), M.mark, (-1.0, -0.69, 1.4), rot=(0, 10, 0), segs=8, rings=6), "abd")
Ab(E("hg_b", (0.3, 0.05, 0.3), M.mark, (-1.28, -0.66, 1.0), rot=(0, 10, 0), segs=8, rings=6), "abd")
Ab(E("hg_c", (0.12, 0.05, 0.16), M.mark, (-1.14, -0.7, 1.22), rot=(0, 10, 0), segs=8, rings=6), "abd")
for k, (x, z, sz) in enumerate(((-0.45, 1.62, 0.14), (-0.7, 1.82, 0.12), (-1.6, 1.72, 0.12), (-1.85, 1.25, 0.1),
                                (-0.5, 0.95, 0.1))):
    Ab(E("spot%d" % k, (sz, 0.04, sz), M.bone, (x, -0.62 - (0.04 if z > 1.5 else 0), z), segs=8, rings=6), "abd")
for k in range(7):
    x = -0.55 - 0.26 * k
    z = 1.95 + 0.06 * math.sin(k * 0.9) - 0.08 * k * 0.3
    Ab(spike("abd_spk%d" % k, (x, 0.0, z - 0.1), (x - 0.1, 0.0, z + 0.2 - 0.02 * k), 0.05, M.shell2, segs=5), "abd")
Ab(E("spinneret_a", (0.2, 0.14, 0.14), M.shell2, (-2.1, -0.08, 0.98)), "abd")
Ab(E("spinneret_b", (0.2, 0.14, 0.14), M.shell2, (-2.1, 0.08, 0.9)), "abd")
# eye cluster + fangs (chelicerae)
for k, (x, y, z, sz) in enumerate(((1.13, -0.16, 1.2, 0.1), (1.17, -0.3, 1.1, 0.08), (1.13, 0.16, 1.2, 0.1),
                                    (1.17, 0.3, 1.1, 0.08), (1.19, -0.08, 1.07, 0.07), (1.19, 0.08, 1.07, 0.07))):
    A(E("eye8_%d" % k, (sz, sz, sz), M.eye8, (x, y, z), segs=8, rings=6), "body")
for s_, y in (("n", -0.14), ("f", 0.14)):
    A(E("fang_root_" + s_, (0.2, 0.18, 0.24), M.shell2, (1.0, y, 1.0)), "fg_" + s_)
    A(spike("fang_" + s_, (1.0, y, 0.98), (1.2, y, 0.5), 0.075, M.shell, segs=6), "fg_" + s_)
    A(spike("fang_tip_" + s_, (1.14, y, 0.66), (1.22, y, 0.44), 0.045, M.bone, segs=6), "fg_" + s_)

# ---- woman: bodice, skin, bone crown, hair, red eyes, clawed arms
Aw(E("skirt_bodice", (0.78, 0.86, 0.4), M.bodice, (0.6, 0, 1.32)), "torso")
Aw(E("waist", (0.4, 0.46, 0.5), M.bodice, (0.64, 0, 1.52)), "torso")
Aw(E("chest_m", (0.46, 0.58, 0.5), M.bodice, (0.66, 0, 1.76)), "chest")
Aw(E("bust", (0.34, 0.5, 0.3), M.bodice, (0.77, 0, 1.74)), "chest")
Aw(E("bodice_trim", (0.5, 0.6, 0.07), M.silk, (0.66, 0, 1.52)), "torso")
for k, z in enumerate((1.6, 1.74, 1.88)):
    Aw(E("rib%d" % k, (0.06, 0.4, 0.04), M.bone, (0.9, 0, z), segs=8, rings=4), "chest")
Aw(E("chest_skin", (0.3, 0.44, 0.3), M.skin, (0.68, 0, 1.98)), "chest")
Aw(seg("neckm", (0.72, 0, 1.9), (0.76, 0, 2.06), 0.1, 0.09, M.skin), "neck")
Aw(E("headm", (0.34, 0.3, 0.42), M.skin, (0.8, 0, 2.15)), "head")
Aw(E("chin", (0.2, 0.2, 0.18), M.skin, (0.86, 0, 2.0)), "head")
Aw(E("mouthin", (0.05, 0.12, 0.04), M.mouth, (0.97, 0, 2.03), segs=8, rings=6), "head")
Aw(E("lip", (0.05, 0.14, 0.03), M.lips, (0.975, 0, 2.05), segs=8, rings=6), "head")
Aw(E("nose", (0.06, 0.05, 0.08), M.skin, (0.97, 0, 2.12), segs=8, rings=6), "head")
eyes = [Aw(E("eye%d" % k, (0.05, 0.1, 0.06), M.eye, (0.955, y, 2.17), segs=8, rings=6), "head")
        for k, y in enumerate((-0.09, 0.09))]
hots = [Aw(E("eyeh%d" % k, (0.07, 0.14, 0.09), M.eye_hot, (0.96, y, 2.17), segs=8, rings=6), "head")
        for k, y in enumerate((-0.09, 0.09))]
Aw(E("hair_cap", (0.5, 0.46, 0.46), M.hair, (0.7, 0, 2.27), rot=(0, 10, 0)), "head")
Aw(E("bangs", (0.2, 0.34, 0.18), M.hair, (0.9, 0, 2.34), rot=(0, -20, 0)), "head")
Aw(E("lock_n", (0.16, 0.08, 0.5), M.hair, (0.82, -0.2, 2.02)), "head")
Aw(E("lock_f", (0.16, 0.08, 0.5), M.hair, (0.82, 0.2, 2.02)), "head")
Aw(E("crown_band", (0.5, 0.44, 0.07), M.bone, (0.76, 0, 2.36), rot=(0, 8, 0)), "head")
for k, (dx, dy, h, lean) in enumerate(((0.16, 0.0, 0.26, 18), (0.06, -0.15, 0.24, -6), (0.06, 0.15, 0.24, -6),
                                       (-0.1, -0.17, 0.2, -14), (-0.1, 0.17, 0.2, -14), (-0.16, 0.0, 0.17, -22))):
    Aw(spike("crown%d" % k, (0.76 + dx, dy, 2.38), (0.76 + dx + 0.14 * math.sin(lean * D2R) * 2.0, dy * 0.9, 2.38 + h),
            0.055, M.bone, segs=6), "head")
for s_, y in (("n", -0.3), ("f", 0.3)):
    Aw(E("shoulder_" + s_, (0.26, 0.26, 0.26), M.skin, (0.66, y, 1.86)), "sh_" + s_)
    Aw(seg("uarm_" + s_, (0.66, y, 1.86), (0.66, y, 1.38), 0.1, 0.085, M.skin), "sh_" + s_)
    Aw(E("elb_" + s_, (0.16, 0.16, 0.16), M.skin, (0.66, y, 1.36)), "el_" + s_)
    Aw(seg("farm_" + s_, (0.66, y, 1.36), (0.66, y, 0.88), 0.085, 0.06, M.skin), "el_" + s_)
    Aw(E("glove_" + s_, (0.2, 0.2, 0.2), M.shell2, (0.67, y, 0.86)), "ha_" + s_)
    for k, dy in enumerate((-0.07, 0.0, 0.07)):
        Aw(spike("claw_%s%d" % (s_, k), (0.7, y + dy, 0.8), (0.76 + 0.03 * k, y + dy, 0.5), 0.032, M.bone, segs=5),
          "ha_" + s_)

# ---- hair (skinned cloth: falls behind the torso over the spider's back, ragged tips)
sk = Skin(r, "arachne_skin")
sk.bone("hr0", r.world_rest["hr1"])
sk.bone("hr1", r.world_rest["hr2"])
sk.bone("hr2", r.world_rest["hr2"] + Vector((-0.1, 0, -0.4)))
sk.build()
NC, NR = 16, 12
hem = tattered(NC, 0.36, pattern=[0.1, 0.9, 0.3, 1.0, 0.0, 0.7, 0.2, 0.95, 0.4, 0.8, 0.05, 1.0, 0.3, 0.65, 0.1, 0.9, 0.2])
rows = []
for k in range(NR + 1):
    v = k / NR
    row = []
    for c in range(NC + 1):
        u = c / NC * 2 - 1
        half = 0.26 + 0.16 * v
        xc = 0.5 - 0.55 * v ** 0.9 - 0.06 * (1 - u * u)
        z = 2.3 - 1.38 * v - hem[c] * (v ** 7)
        row.append(sw((xc, u * half, z)))
    rows.append(row)
sk.bind(grid_sheet("hair", rows, M.hair, 0.045),
        chain_weights([("hr0", r.world_rest["hr0"].z), ("hr1", r.world_rest["hr1"].z), ("hr2", r.world_rest["hr2"].z)]))


# --------------------------------------------------------------------------
# pose resolution


def resolve(p):
    spec, off, tw = {}, {}, {}
    for k, v in p.items():
        if k.startswith("off_"):
            off[k[4:]] = v
        elif k.startswith("tw_"):
            tw[k[3:]] = v
        elif k in ("nh", "fh"):
            spec["ik_sh_" + k[0]] = (v[0], v[1], None, -1)
        elif k.startswith("ik_") and len(v) == 2:
            spec[k] = (v[0], v[1], None)
        else:
            spec[k] = v
    ang, W = P.solve(spec, off)
    # the hair never reaches below the floor when the head drops
    ha = W["hr0"][2] * D2R
    hs = max(0.3, min(1.0, (W["hr0"][1] - 0.05) / (2.0 * max(0.3, math.cos(ha)))))
    return ang, off, {"hr0": (1, 1, hs)}, tw, W


EASES = {"s": ease, "l": lambda t: t, "i": lambda t: t * t, "o": lambda t: 1 - (1 - t) * (1 - t),
         "h": lambda t: 0.0}


def lerp(a, b, t):
    if isinstance(a, tuple) and isinstance(b, tuple) and len(a) == len(b):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    if isinstance(a, tuple) or isinstance(b, tuple):
        return b
    return a + (b - a) * t


def keyed(keys, t):
    if t <= keys[0][0]:
        return dict(keys[0][1])
    for k0, k1 in zip(keys, keys[1:]):
        t0, p0, t1, p1 = k0[0], k0[1], k1[0], k1[1]
        if t0 <= t <= t1:
            u = EASES[k1[2] if len(k1) > 2 else "s"](0 if t1 == t0 else (t - t0) / (t1 - t0))
            out = {}
            for k in set(p0) | set(p1):
                if k in p0 and k in p1:
                    out[k] = lerp(p0[k], p1[k], u)
                else:
                    out[k] = p1[k] if k in p1 else p0[k]
            return out
    return dict(keys[-1][1])


def merge(*ds, **kw):
    out = {}
    for d in ds:
        out.update(d)
    out.update(kw)
    return out


# --------------------------------------------------------------------------
# reference poses

FZ = 0.06


def stand(dx=(0, 0, 0, 0), lift=None):
    """Planted feet at the nominal spots; dx shifts the feet of leg i (0..3)."""
    d = {}
    for n0, i, s_ in LEGS:
        fx = LEG_FOOT[i] + (0.08 if s_ == "f" else 0.0) + dx[i]
        d["ik_" + n0] = (fx, FZ + (lift or {}).get(n0, 0.0))
    return d


def base(**kw):
    p = {"off_body": (0, 0, 0), "body": 0, "abd": 0, "torso": -4, "chest": -4, "neck": 6, "head": 3,
         "nh": (1.12, 1.32), "fh": (1.0, 1.5), "fg_n": 0, "fg_f": 0,
         "hr0@": -4, "hr1@": -3, "hr2@": -2}
    p.update(stand())
    p.update(kw)
    return p


IDLE = base()
ANIMS = []


def register(name, n, fps, fn, loop=False, phases=None):
    ANIMS.append(dict(name=name, n=n, fps=fps, loop=loop, phases=phases, fn=fn))


def keyed_fn(keys, post=None):
    def fn(i, n):
        p = keyed(keys, float(i))
        if post:
            post(p, i, n)
        return resolve(p)
    return fn


def jitter(p, i, amp=0.02, ch=1.0):
    s = (-1) ** int(i)
    ox, oy, oz = p["off_body"]
    p["off_body"] = (ox + amp * s, oy, oz)
    p["chest"] = p.get("chest", 0.0) + ch * s


# ---- idle: slow breathing, claws flexing, legs shifting
def a_idle(i, n):
    t = i / n * 2 * math.pi
    s, c = math.sin(t), math.cos(t)
    p = base(off_body=(0, 0, 0.03 * s), body=1.0 * s, abd=2.5 * c, torso=-4 + 1.5 * s, chest=-4 + 2 * s,
             head=3 - 2 * s, neck=6 + 1 * s)
    p["nh"] = (1.12 + 0.05 * c, 1.32 + 0.06 * s)
    p["fh"] = (1.0 - 0.04 * s, 1.5 - 0.05 * c)
    p["fg_n"], p["fg_f"] = 6 * (0.5 + 0.5 * s), 6 * (0.5 - 0.5 * s)
    p["hr0@"], p["hr1@"], p["hr2@"] = -4 + 3 * s, -3 + 4 * c, -2 + 5 * s
    # two legs tap the floor
    lift = {"l1n": 0.10 * max(0.0, math.sin(t * 1.0)), "l2f": 0.10 * max(0.0, -math.sin(t * 1.0)),
            "l4n": 0.07 * max(0.0, math.cos(t)), "l3f": 0.07 * max(0.0, -math.cos(t))}
    p.update(stand(lift=lift))
    return resolve(p)


register("idle", 8, 7, a_idle, loop=True)


# ---- walk: tetrapod scuttle (legs 1n 2f 3n 4f / 1f 2n 3f 4n), 3 steps per loop
def foot_x(ph, A_, lift_):
    ph %= 1.0
    if ph < 0.5:
        u = ph / 0.5
        return A_ - 2 * A_ * u, 0.0
    u = (ph - 0.5) / 0.5
    return -A_ + 2 * A_ * ease(u), lift_ * math.sin(math.pi * u)


def a_walk(i, n):
    t = i / n
    p = base(off_body=(0.04, 0, -0.03 * abs(math.sin(2 * math.pi * 3 * t / 2 * 2))), body=-2 + 1.5 * math.sin(2 * math.pi * 3 * t),
             torso=-7 + 1.5 * math.sin(2 * math.pi * 3 * t), head=3, abd=3 * math.sin(2 * math.pi * 3 * t + 1))
    for n0, k, s_ in LEGS:
        grp = 0.0 if (k % 2 == 0) == (s_ == "n") else 0.5
        dx, lz = foot_x(t * 3 + grp, 0.26, 0.42)
        fx = LEG_FOOT[k] + (0.08 if s_ == "f" else 0.0) + dx
        p["ik_" + n0] = (fx, FZ + lz)
    sw = math.sin(2 * math.pi * t * 3)
    p["nh"] = (1.2 + 0.1 * sw, 1.3)
    p["fh"] = (1.1 - 0.1 * sw, 1.45)
    p["hr0@"], p["hr1@"], p["hr2@"] = -10 + 4 * sw, -9 + 5 * sw, -7 + 6 * sw
    p["fg_n"], p["fg_f"] = 4 * sw, -4 * sw
    return resolve(p)


register("walk", 12, 12, a_walk, loop=True)

# ---- web: rears up, abdomen raised, spins a web ball between the hands, thrusts it forward
HAND_B = (1.3, 1.52)
W0 = base(off_body=(-0.1, 0, -0.1), body=3, abd=-12, torso=-2, chest=0, nh=(0.8, 1.35), fh=(0.7, 1.6),
          **stand(dx=(-0.1, -0.1, -0.1, -0.1)))
W1 = base(off_body=(-0.18, 0, -0.02), body=16, abd=-46, torso=8, chest=10, neck=8, head=6, fg_n=26, fg_f=26,
          nh=(0.95, 2.3), fh=(0.75, 2.5), **stand(dx=(-0.15, -0.1, -0.05, -0.05)))
W2 = merge(W1, {"nh": (1.25, 1.75), "fh": (1.2, 1.95), "body": 15, "abd": -44, "chest": 8})
W3 = merge(W2, {"nh": (1.33, 1.5), "fh": (1.3, 1.64), "body": 16, "abd": -46, "chest": 8, "head": 6})
W4 = merge(W3, {"nh": (1.36, 1.5), "fh": (1.34, 1.58), "body": 17, "abd": -48, "chest": 10, "head": 8,
                "off_body": (-0.2, 0, -0.02)})
for _w in (W1, W2, W3, W4):      # rearing: the front legs come off the floor
    _w.update({"ik_l1n": (1.6, 1.0), "ik_l1f": (1.72, 1.12), "ik_l2n": (1.2, 0.5), "ik_l2f": (1.3, 0.6)})
W5 = base(off_body=(0.12, 0, -0.1), body=-4, abd=10, torso=-14, chest=-14, neck=8, head=2,
          nh=(1.75, 1.3), fh=(1.7, 1.42), fg_n=20, fg_f=20, **stand(dx=(0.2, 0.1, 0.05, 0.05)))
W6 = merge(W5, {"off_body": (0.2, 0, -0.14), "nh": (2.0, 1.22), "fh": (1.95, 1.34), "torso": -18, "chest": -16})
W7 = merge(W6, {"off_body": (0.14, 0, -0.1), "nh": (1.9, 1.15), "fh": (1.85, 1.25), "abd": 6, "torso": -12})
WK = [(0, IDLE), (1, W0), (2, W1), (3, W2), (4, W3), (5, W4), (6, W5, "i"), (7, W6), (9, W7), (11, IDLE)]


def web_post(p, i, n):
    if i in (4, 5):
        jitter(p, i, 0.015, 1.0)


register("web", 12, 12, keyed_fn(WK, web_post), phases=(5, 2, 5))

# ---- leap (crouch + take-off + air; the game moves the sprite) and leap_land (touch-down)
LC1 = base(off_body=(-0.05, 0, -0.18), body=-4, abd=8, torso=-10, chest=-6, nh=(0.5, 1.2), fh=(0.45, 1.3),
           **stand(dx=(-0.1, -0.05, 0.0, 0.05)))
LC2 = base(off_body=(-0.12, 0, -0.34), body=-8, abd=14, torso=-16, chest=-10, head=8, nh=(0.2, 1.1), fh=(0.1, 1.2),
           fg_n=18, fg_f=18, **stand(dx=(-0.25, -0.1, 0.05, 0.15)))
LC3 = merge(LC2, {"off_body": (-0.15, 0, -0.4), "body": -10, "abd": 18, "torso": -18, "chest": -12,
                  "nh": (0.0, 1.0), "fh": (-0.1, 1.1)})
LL = base(off_body=(0.1, 0, 0.45), body=14, abd=-16, torso=2, chest=2, neck=6, head=-2, nh=(1.5, 2.1), fh=(1.4, 2.2),
          fg_n=30, fg_f=30,
          **{"ik_l1n": (2.3, 0.7), "ik_l1f": (2.45, 0.8), "ik_l2n": (1.9, 0.35), "ik_l2f": (2.0, 0.45),
             "ik_l3n": (-0.3, 0.2), "ik_l3f": (-0.2, 0.3), "ik_l4n": (-1.3, 0.25), "ik_l4f": (-1.2, 0.35),
             "hr0@": 20, "hr1@": 24, "hr2@": 26})
LA = merge(LL, {"off_body": (0.2, 0, 0.55), "body": 8, "abd": -8, "nh": (1.7, 1.9), "fh": (1.6, 2.0),
                "ik_l1n": (2.0, 0.55), "ik_l1f": (2.1, 0.62), "ik_l2n": (1.6, 0.2), "ik_l2f": (1.7, 0.28),
                "ik_l3n": (-0.2, 0.15), "ik_l3f": (-0.1, 0.22), "ik_l4n": (-1.25, 0.2), "ik_l4f": (-1.1, 0.28),
                "hr0@": 12, "hr1@": 14, "hr2@": 16})
LD = merge(LL, {"off_body": (0.2, 0, 0.5), "body": -2, "abd": 4, "torso": -10, "chest": -10, "nh": (1.55, 1.1),
                "fh": (1.45, 1.2), "fg_n": 10, "fg_f": 10,
                "ik_l1n": (1.95, 0.3), "ik_l1f": (2.05, 0.32), "ik_l2n": (1.4, 0.1), "ik_l2f": (1.5, 0.12),
                "ik_l3n": (-0.6, 0.1), "ik_l3f": (-0.5, 0.12), "ik_l4n": (-1.7, 0.12), "ik_l4f": (-1.6, 0.14),
                "hr0@": 16, "hr1@": 20, "hr2@": 22})
LK = [(0, IDLE), (2, LC1), (4, LC2), (5, LC3), (6, LL, "i"), (7, LA), (8, LA, "h"), (9, LD)]


def leap_post(p, i, n):
    if i in (4, 5):
        jitter(p, i, 0.015, 1.0)


register("leap", 10, 12, keyed_fn(LK, leap_post))

LND = merge(LD, {"off_body": (0.0, 0, -0.42), "body": -4, "abd": 6, "torso": -6, "chest": -6, "head": 4, "nh": (1.3, 1.0),
                 "fh": (1.2, 1.1), "fg_n": -40, "fg_f": -40,
                 **stand(dx=(0.1, 0.25, -0.1, -0.2)), **{"hr0@": 28, "hr1@": 32, "hr2@": 36}})
LND2 = merge(LND, {"off_body": (0.0, 0, -0.34), "torso": -9, "chest": -9, "hr0@": 8, "hr1@": 6, "hr2@": 4})
LNK = [(0, LD), (1, merge(LD, {"off_body": (0.2, 0, 0.25), "ik_l1n": (1.95, 0.12), "ik_l1f": (2.05, 0.14),
                               "ik_l2n": (1.4, 0.06), "ik_l2f": (1.5, 0.06), "ik_l3n": (-0.7, 0.06),
                               "ik_l3f": (-0.6, 0.06), "ik_l4n": (-1.75, 0.06), "ik_l4f": (-1.65, 0.06)})),
       (2, LND, "i"), (3, LND), (4, LND2), (5, merge(LND2, {"off_body": (0, 0, -0.3), "torso": -7})),
       (6, merge(IDLE, {"off_body": (0, 0, -0.18), "torso": -7})), (7, merge(IDLE, {"off_body": (0, 0, -0.06)})),
       (8, IDLE)]


def land_post(p, i, n):
    if i in (2, 3):
        jitter(p, i, 0.02, 1.5)


register("leap_land", 9, 12, keyed_fn(LNK, land_post), phases=(2, 2, 5))

# ---- bite: rears back with fangs spread, lunges, snaps
B0 = base(off_body=(-0.1, 0, 0.0), body=6, abd=-3, torso=-1, chest=0, neck=4, head=2, fg_n=24, fg_f=24,
          nh=(0.9, 1.5), fh=(0.8, 1.65), **stand(dx=(-0.1, -0.05, 0, 0)))
B1 = base(off_body=(-0.28, 0, 0.1), body=20, abd=-10, torso=8, chest=10, neck=-4, head=-8, fg_n=50, fg_f=50,
          nh=(0.5, 2.35), fh=(0.35, 2.5),
          **merge(stand(dx=(-0.2, -0.1, -0.05, -0.05)),
                  {"ik_l1n": (1.5, 1.2), "ik_l1f": (1.6, 1.35), "ik_l2n": (1.1, 0.06), "ik_l2f": (1.2, 0.06),
                   "hr0@": 14, "hr1@": 16, "hr2@": 16}))
B2 = merge(B1, {"off_body": (-0.34, 0, 0.14), "body": 24, "abd": -14, "torso": 12, "chest": 12, "fg_n": 62, "fg_f": 62,
                "nh": (0.4, 2.45), "fh": (0.25, 2.6), "head": -12, "ik_l1n": (1.7, 1.45), "ik_l1f": (1.8, 1.6)})
B3 = merge(B2, {"off_body": (-0.36, 0, 0.14), "fg_n": 70, "fg_f": 70, "body": 25})
B4 = base(off_body=(0.55, 0, -0.2), body=-12, abd=-4, torso=-24, chest=-18, neck=14, head=14, fg_n=0, fg_f=0,
          nh=(1.9, 1.15), fh=(1.8, 1.3), **stand(dx=(0.4, 0.3, 0.3, 0.3)),
          **{"hr0@": -32, "hr1@": -30, "hr2@": -24})
B5 = merge(B4, {"off_body": (0.8, 0, -0.26), "body": -14, "torso": -28, "chest": -20, "nh": (2.1, 1.0),
                "fh": (2.0, 1.12)})
B6 = merge(B5, {"off_body": (0.75, 0, -0.22), "body": -10})
BK = [(0, IDLE), (1, B0), (2, B1), (3, B2), (4, B3), (5, B4, "i"), (6, B5), (7, B6), (9, merge(IDLE, {"off_body": (0.2, 0, -0.06)})),
      (10, IDLE)]


def bite_post(p, i, n):
    if i in (3, 4):
        jitter(p, i, 0.018, 1.5)


register("bite", 11, 12, keyed_fn(BK, bite_post), phases=(4, 2, 5))


# ---- hurt
def hurt_pose(k):
    ks = [dict(off_body=(-0.2, 0, 0.06), body=10, abd=-5, torso=12, chest=14, neck=-10, head=-16, fg_n=44, fg_f=44,
               nh=(0.4, 2.3), fh=(0.3, 2.45), **{"hr0@": 28, "hr1@": 24, "hr2@": 20}),
          dict(off_body=(-0.28, 0, 0.0), body=14, abd=-7, torso=16, chest=16, neck=-12, head=-20, fg_n=50, fg_f=50,
               nh=(0.35, 2.4), fh=(0.2, 2.55), **{"hr0@": 36, "hr1@": 30, "hr2@": 24}),
          dict(off_body=(-0.12, 0, 0.0), body=5, abd=-2, torso=2, chest=4, neck=-2, head=-6, fg_n=20, fg_f=20,
               nh=(0.9, 1.6), fh=(0.8, 1.8)),
          dict(off_body=(-0.03, 0, 0.0), body=1, abd=2, torso=-3, chest=-3, neck=4, head=2, fg_n=8, fg_f=8)]
    d = merge(IDLE, ks[k])
    if k < 2:
        d.update(stand(dx=(-0.1, -0.05, 0.0, 0.0)))
    return d


register("hurt", 4, 14, lambda i, n: resolve(hurt_pose(i)))

# ---- death: rears up screaming, convulses, legs buckle and splay, then curl up over the body
ND = 16


def curl(dx_front=0.0, h=0.0, amt=1.0):
    """Leg feet pulled in and up around the body (the dead-spider curl).  amt 0..1 blends from standing."""
    d = {}
    tgt = [(1.3, 1.65), (0.8, 1.85), (-0.55, 1.85), (-0.9, 1.65)]
    for n0, i, s_ in LEGS:
        fx = LEG_FOOT[i] + (0.08 if s_ == "f" else 0.0)
        tx, tz = tgt[i]
        tx += (0.12 if s_ == "f" else 0.0)
        d["ik_" + n0] = (fx + (tx - fx) * amt, FZ + (tz + h - FZ) * amt)
    return d


DK = [
    (0, merge(IDLE, dict(off_body=(-0.2, 0, 0.06), body=12, abd=-6, torso=14, chest=16, neck=-10, head=-18,
                         fg_n=50, fg_f=50, nh=(0.4, 2.3), fh=(0.3, 2.45),
                         **{"hr0@": 30, "hr1@": 26, "hr2@": 22}))),
    (2, merge(IDLE, dict(off_body=(-0.35, 0, 0.18), body=24, abd=-14, torso=16, chest=18, neck=-12, head=-22,
                         fg_n=64, fg_f=64, nh=(0.3, 2.6), fh=(0.1, 2.7),
                         **{"ik_l1n": (1.5, 1.4), "ik_l1f": (1.6, 1.55), "ik_l2n": (1.1, 1.0), "ik_l2f": (1.2, 1.15),
                            "hr0@": 36, "hr1@": 30, "hr2@": 26}))),
    (4, merge(IDLE, dict(off_body=(-0.3, 0, 0.1), body=18, abd=-10, torso=10, chest=12, neck=-8, head=-14,
                         fg_n=40, fg_f=40, nh=(0.5, 2.4), fh=(0.35, 2.5),
                         **{"ik_l1n": (1.35, 1.0), "ik_l1f": (1.45, 1.1), "ik_l2n": (1.0, 0.5), "ik_l2f": (1.1, 0.4)}))),
    (6, merge(IDLE, dict(off_body=(-0.15, 0, -0.1), body=8, abd=-3, torso=4, chest=2, neck=0, head=-6, fg_n=30,
                         fg_f=30, nh=(0.7, 2.0), fh=(0.6, 2.1), **stand(dx=(-0.3, -0.4, -0.1, 0.1)),
                         **{"hr0@": 12, "hr1@": 10, "hr2@": 8}))),
    (8, merge(IDLE, dict(off_body=(-0.1, 0, -0.42), body=4, abd=-4, torso=20, chest=14, neck=10, head=14, fg_n=20,
                         fg_f=20, nh=(0.4, 1.4), fh=(0.2, 1.5),
                         **stand(dx=(0.3, 0.4, -0.5, -0.6), lift={"l1n": 0.0}),
                         **{"hr0@": -16, "hr1@": -14, "hr2@": -12}))),
    (10, merge(IDLE, dict(off_body=(-0.05, 0, -0.52), body=2, abd=-4, torso=30, chest=22, neck=14, head=20, fg_n=10,
                          fg_f=10, nh=(0.2, 1.1), fh=(0.0, 1.2), **curl(0, 0, 0.3),
                          **{"hr0@": -14, "hr1@": -10, "hr2@": -8}))),
    (13, merge(IDLE, dict(off_body=(-0.02, 0, -0.56), body=0, abd=-4, torso=44, chest=26, neck=10, head=18, fg_n=0,
                          fg_f=0, nh=(0.1, 0.9), fh=(-0.1, 1.0), **curl(0, 0, 0.9),
                          **{"hr0@": -22, "hr1@": -20, "hr2@": -16}))),
    (15, merge(IDLE, dict(off_body=(-0.02, 0, -0.58), body=0, abd=-4, torso=48, chest=28, neck=12, head=20, fg_n=0,
                          fg_f=0, nh=(0.05, 0.85), fh=(-0.15, 0.95), **curl(0, 0.05, 1.0),
                          **{"hr0@": -24, "hr1@": -22, "hr2@": -18}))),
]


def death_post(p, i, n):
    if 2 <= i <= 6:
        jitter(p, i, 0.03, 2.0)
        for n0, k, s_ in LEGS:
            x, z = p["ik_" + n0][:2]
            p["ik_" + n0] = (x + 0.06 * (-1) ** (i + k), z + 0.06 * (-1) ** (i + k + 1) * (1 if z > 0.2 else 0.0))


register("death", ND, 8, keyed_fn(DK, death_post))

# --------------------------------------------------------------------------
# FX: web ball, silk strands, dust, rings


def make_web_ball(name, cx, cz, rad, y=-0.6):
    parts = [E(name + "_core", (rad * 2, rad * 2, rad * 2), M.web, (cx, y, cz), segs=12, rings=8)]
    for k, rot_ in enumerate(((0, 0, 0), (0, 60, 0), (0, -60, 0), (90, 0, 0))):
        parts.append(E("%s_r%d" % (name, k), (rad * 2.3, rad * 0.16, rad * 2.3), M.web2, (cx, y + 0.05, cz),
                       rot=rot_, segs=14, rings=4))
    return join(parts, name)


def make_strand(name, p0, p1, y=-0.6, th=0.04):
    d = Vector((p1[0] - p0[0], 0, p1[1] - p0[1]))
    L = max(0.05, d.length)
    ob = E(name, (L, th, th), M.web, ((p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2),
           rot=(0, -math.degrees(math.atan2(d.z, d.x)), 0), segs=6, rings=4)
    return ob


def make_dust(name, x, scale=1.0, seed=0, y=-0.7, spread=0.3):
    rnd = random.Random(seed)
    parts = []
    for k in range(7):
        dx = (k - 3) * spread * scale + rnd.uniform(-0.08, 0.08)
        s = (0.34 - abs(k - 3) * 0.05) * scale
        parts.append(E(name + "_p%d" % k, (s * 1.4, 0.4, s), M.dust,
                       (x + dx, y, 0.06 + s * 0.4 + rnd.uniform(0, 0.08)), segs=8, rings=6))
    return join(parts, name)


def make_ring(name, cx, rx, y=-0.3):
    """Flat shock ring on the floor (an ellipse seen nearly edge-on)."""
    verts, faces = [], []
    N = 24
    for j in range(N + 1):
        a = math.pi * j / N
        for rr in (rx, rx + 0.1):
            verts.append((cx + rr * math.cos(a), y, 0.06 + 0.45 * rr * math.sin(a) * 0.5))
    for j in range(N):
        b = 2 * j
        faces.append((b, b + 2, b + 3, b + 1))
    ob = mesh_object(name, verts, faces, M.ring, smooth_shade=False)
    solidify(ob, 0.05)
    return ob


def make_arcs(name, cx, cz, radii, a0, a1, mat=None, width=0.06, y=-0.9):
    parts = []
    for k, rr0 in enumerate(radii):
        verts, faces = [], []
        N = 9
        for j in range(N + 1):
            a = math.radians(a0 + (a1 - a0) * j / N)
            for rr in (rr0, rr0 + width * (1 + 0.5 * k)):
                verts.append((cx + rr * math.cos(a), y, cz + rr * math.sin(a)))
        for j in range(N):
            b = 2 * j
            faces.append((b, b + 2, b + 3, b + 1))
        ob = mesh_object("%s_a%d" % (name, k), verts, faces, mat or M.web, smooth_shade=False)
        solidify(ob, 0.04)
        parts.append(ob)
    return join(parts, name)


fx = FX()
for k, ob in enumerate(hots):
    fx.add("hot%d" % k, ob, default=False)
for k, ob in enumerate(eyes):
    fx.add("eye%d" % k, ob, default=True)
BY = {a["name"]: a for a in ANIMS}


def hands_mid(res):
    W = res[4]
    hx = (W["ha_n"][0] + W["ha_f"][0]) / 2
    hz = (W["ha_n"][1] + W["ha_f"][1]) / 2
    return hx, hz


def setup_fx(name):
    a = BY[name]
    fn, n = a["fn"], a["n"]
    if name == "web":
        radii = {2: 0.12, 3: 0.2, 4: 0.3, 5: 0.4}
        for i, rad in radii.items():
            hx, hz = hands_mid(fn(i, n))
            fx.add("ball%d" % i, make_web_ball("ball%d" % i, hx + 0.12, hz + 0.02, rad))
        for i in (1, 2, 3, 4):
            res = fn(i, n)
            W = res[4]
            fx.add("strand%d" % i, make_strand("strand%d" % i, (W["ha_n"][0], W["ha_n"][1]),
                                               (W["ha_f"][0], W["ha_f"][1])))
        hx, hz = hands_mid(fn(6, n))
        fx.add("ball6", make_web_ball("ball6", hx + 0.35, hz, 0.34))
        fx.add("dust_w", make_dust("dust_w", -0.4, 0.5, 3, y=0.4))
    elif name == "leap":
        fx.add("dust_t0", make_dust("dust_t0", 0.2, 0.9, 4, y=-0.5, spread=0.4))
        fx.add("dust_t1", make_dust("dust_t1", 0.2, 1.3, 5, y=-0.5, spread=0.4))
    elif name == "leap_land":
        fx.add("dust_l0", make_dust("dust_l0", 0.3, 1.0, 6, y=-0.5, spread=0.5))
        fx.add("dust_l1", make_dust("dust_l1", 0.3, 1.5, 7, y=-0.5, spread=0.5))
        fx.add("ring_l0", make_ring("ring_l0", 0.3, 1.4))
        fx.add("ring_l1", make_ring("ring_l1", 0.3, 2.1))
    elif name == "bite":
        W = fn(5, n)[4]
        fx.add("snap", make_arcs("snap", W["fg_n"][0] + 0.1, max(0.8, W["fg_n"][1] + 0.3), [0.3, 0.5], -95, 15, mat=M.web))
        fx.add("dust_b", make_dust("dust_b", 1.2, 0.6, 8, y=-0.6))
    elif name == "death":
        fx.add("dust_d0", make_dust("dust_d0", 0.2, 1.0, 9, y=-0.55, spread=0.5))
        fx.add("dust_d1", make_dust("dust_d1", 0.2, 1.6, 10, y=-0.55, spread=0.55))
        fx.add("dust_d2", make_dust("dust_d2", -0.6, 1.3, 11, y=-0.55, spread=0.55))


def vis(name):
    def f(i, n):
        s = {"eye0", "eye1"}
        if name == "web":
            if 1 <= i <= 5:
                s = {"hot0", "hot1"}
            if i in (2, 3, 4, 5):
                s.add("ball%d" % i)
            if i in (1, 2, 3, 4):
                s.add("strand%d" % i)
            if i == 6:
                s |= {"ball6", "hot0", "hot1"}
        elif name == "leap":
            if i >= 3:
                s = {"hot0", "hot1"}
            if i == 6:
                s |= {"dust_t0"}
            if i == 7:
                s |= {"dust_t1"}
        elif name == "leap_land":
            if i <= 3:
                s = {"hot0", "hot1"}
            if i == 2:
                s |= {"dust_l0", "ring_l0"}
            if i == 3:
                s |= {"dust_l1", "ring_l1"}
            if i == 4:
                s |= {"dust_l1"}
        elif name == "bite":
            if 1 <= i <= 6:
                s = {"hot0", "hot1"}
            if i in (5, 6):
                s.add("snap")
            if i in (6, 7):
                s.add("dust_b")
        elif name == "hurt":
            s = {"hot0", "hot1"} if i < 2 else {"eye0", "eye1"}
        elif name == "death":
            s = {"hot0", "hot1"} if i < 4 else ({"eye0", "eye1"} if i < 12 else (set() if i > 13 else {"eye0"}))
            if i == 7:
                s.add("dust_d0")
            if i in (8, 9):
                s.add("dust_d1")
            if i == 10:
                s.add("dust_d2")
        return s
    return f


out = os.path.join(ROOT, "build", "frames", ID)
if ONLY:
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.rsplit("_", 1)[0] in ONLY:
            os.remove(os.path.join(out, f))
else:
    out = frames_dir(ID)

for a in ANIMS:
    if ONLY and a["name"] not in ONLY:
        continue
    setup_fx(a["name"])
    fn = a["fn"]
    anim_render(r, fx, a["name"], a["n"], lambda i, n, fn=fn: fn(i, n)[:4], out, vis(a["name"]))

spec_anims = []
for a in ANIMS:
    e = {"name": a["name"], "fps": a["fps"], "loop": a["loop"]}
    if a["phases"]:
        e["windup"], e["active"], e["recover"] = a["phases"]
    spec_anims.append(e)
write_spec(out, FW, FH, (AX, AY), spec_anims)
print(ID, "done")

if os.environ.get("DIAG"):
    # debug helper: DIAG="anim:frame" prints the solved leg joints for that pose (no extra renders)
    an, fi = os.environ["DIAG"].split(":")
    res = BY[an]["fn"](int(fi), BY[an]["n"])
    for n0, i, s_ in LEGS:
        W = res[4]
        print("DIAG", n0, "hip", [round(v, 2) for v in W[n0][:2]], "knee", [round(v, 2) for v in W[n0 + "k"][:2]],
              "foot", [round(v, 2) for v in W[n0 + "f"][:2]])
