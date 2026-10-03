"""Tile-set post-processing: shade the Blender G-buffers, paint 2D details, assemble
public/assets/tiles/<biome>.png + .json and write the mock-room previews.

usage: python3 tools/pack/post_tiles.py [biome ...]

Inputs : build/env/tiles/<biome>/*_{n,d}.png + pieces.json   (tools/blender/asset_tiles.py)
Outputs: public/assets/tiles/<biome>.png/.json, build/preview/env_<biome>.png
The autotile contract implemented by `autotile()` / `plan_decor()` below is docs/TILES.md and is
mirrored 1:1 by src/game/level/render.ts (tests/render.test.ts checks both against a golden file).

This module also hosts the shared G-buffer helpers (load_gbuf / shade / ...) used by post_bg.py.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ENV = os.path.join(ROOT, "build", "env")
OUT = os.path.join(ROOT, "public", "assets")
PREVIEW = os.path.join(ROOT, "build", "preview")

TILE = 24
PAD = 12

MAT = {
    "stone": 1, "stone2": 2, "mortar": 3, "back": 4, "back2": 5, "backmortar": 6,
    "lip": 7, "wood": 8, "iron": 9, "moss": 10, "cloth": 11, "glow": 12, "brick": 13,
    "rubble": 14, "bronze": 15, "rope": 16, "void": 17, "trim": 18, "gold": 19,
    "far": 20, "far2": 21, "roof": 22, "leaf": 23, "bone": 24, "crack": 25,
}


# ======================================================================================
# shared G-buffer helpers


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_gbuf(prefix):
    n = np.asarray(Image.open(prefix + "_n.png").convert("RGBA")).astype(np.float32)
    d = np.asarray(Image.open(prefix + "_d.png").convert("RGBA"))
    N = n[..., :3] / 255.0 * 2 - 1
    ln = np.linalg.norm(N, axis=-1, keepdims=True)
    N = N / np.maximum(ln, 1e-6)
    return {"N": N, "A": n[..., 3] > 127, "depth": d[..., 0].astype(np.float32) / 255.0,
            "rid": d[..., 1].astype(np.int32), "mat": d[..., 2].astype(np.int32)}


def norm(v):
    v = np.asarray(v, np.float32)
    return v / np.linalg.norm(v)


def _nb(a, dy, dx, wrap):
    h, w = a.shape[:2]
    if wrap:
        return np.roll(np.roll(a, dy, 0), dx, 1)
    p = np.pad(a, ((1, 1), (1, 1)) + ((0, 0),) * (a.ndim - 2), mode="edge")
    return p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]


def shade(gb, pal, key=(-0.4, -0.75, 0.55), amb=0.15, th=(0.32, 0.6, 0.81, 0.97),
          rim=None, grit=0.05, seed=1, shift=(0.12, 0.1), wrap=False, edge=True):
    """Toon-shade a G-buffer.  pal: {matid: [c0..cN]} dark->bright (hex).

    * band = number of thresholds `th` below the lambert intensity of light `key`
    * shift = (p_down, p_up): fraction of objects (by rid) shifted one band down / up
    * grit: density of 2x2 pits (one band darker) on lit faces
    * edge: object boundaries facing down/right get one band darker (crisper stones)
    * rim: optional (dir, threshold, {matid: hex}) coloured secondary light
    Returns RGBA uint8.
    """
    N, A, mat, rid = gb["N"], gb["A"], gb["mat"], gb["rid"]
    h, w = A.shape
    L = norm(key)
    I = amb + (1 - amb) * np.clip((N * L).sum(-1), 0, 1)
    band = np.zeros((h, w), np.int32)
    for t in th:
        band += (I > t).astype(np.int32)
    hsh = ((rid.astype(np.int64) * 2654435761) % 4294967296) / 4294967296.0
    band -= ((hsh < shift[0]) & (rid > 0)).astype(np.int32)
    band += ((hsh > 1 - shift[1]) & (rid > 0)).astype(np.int32)
    if grit:
        rng = np.random.default_rng(seed)
        g = rng.random(((h + 1) // 2, (w + 1) // 2)) < grit
        g = np.repeat(np.repeat(g, 2, 0), 2, 1)[:h, :w]
        g &= rng.random((h, w)) < 0.7
        band -= (g & (band >= 2)).astype(np.int32)
    if edge:
        for dy, dx in ((1, 0), (0, 1)):
            o = _nb(rid, -dy, -dx, wrap)
            oa = _nb(A, -dy, -dx, wrap)
            band -= ((o != rid) & oa & A & (band > 1)).astype(np.int32)
    out = np.zeros((h, w, 4), np.uint8)
    for m, cols in pal.items():
        mm = (mat == m) & A
        if not mm.any():
            continue
        cols = np.array([hexc(c) if isinstance(c, str) else c for c in cols], np.uint8)
        b = np.clip(band, 0, len(cols) - 1)
        out[mm, :3] = cols[b[mm]]
        out[mm, 3] = 255
    if rim is not None:
        rdir, rth, rcols = rim
        R = (N * norm(rdir)).sum(-1)
        for m, c in rcols.items():
            mm = (mat == m) & A & (R > rth)
            out[mm, :3] = hexc(c)
    return out


def save_zoom(arr, path, z=4, bg=None):
    im = Image.fromarray(arr) if isinstance(arr, np.ndarray) else arr
    if bg is not None:
        b = Image.new("RGBA", im.size, bg)
        b.alpha_composite(im.convert("RGBA"))
        im = b
    im.resize((im.width * z, im.height * z), Image.NEAREST).save(path)


def outline(arr, color, wrap_x=False):
    """1 px 4-neighbour outline around every opaque region (writes into transparent pixels)."""
    a = arr[..., 3] > 0
    out = arr.copy()
    grow = np.zeros_like(a)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        h, w = a.shape
        if wrap_x:
            sh = np.roll(np.roll(a, dy, 0), dx, 1)
            if dy:
                sh[0 if dy > 0 else -1, :] = False
        else:
            sh = np.zeros_like(a)
            ys = slice(max(dy, 0), h + min(dy, 0))
            yd = slice(max(-dy, 0), h + min(-dy, 0))
            xs = slice(max(dx, 0), w + min(dx, 0))
            xd = slice(max(-dx, 0), w + min(-dx, 0))
            sh[ys, xs] = a[yd, xd]
        grow |= sh
    m = grow & ~a
    out[m, :3] = hexc(color) if isinstance(color, str) else color
    out[m, 3] = 255
    return out


def lerp_rgb(arr, tint, k):
    out = arr.copy()
    t = np.array(hexc(tint), np.float32)
    rgb = out[..., :3].astype(np.float32)
    out[..., :3] = np.clip(rgb * (1 - k) + t * k, 0, 255).astype(np.uint8)
    return out


def tone(arr, mul=1.0, tint=None, k=0.0):
    out = arr.copy()
    rgb = out[..., :3].astype(np.float32) * mul
    if tint:
        rgb = rgb * (1 - k) + np.array(hexc(tint), np.float32) * k
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


# ======================================================================================
# palettes


def P5(*c):
    return list(c)


PAL = {
    "prison": dict(
        key=(-0.35, -0.5, 0.8), th=(0.30, 0.56, 0.78, 0.95), outline="#04080b",
        sky="#050a10", solid="#1d323a", lipc="#58a39e", back="#0d161d", deep="#04080c",
        shadow="#02050a", glowc="#46e0c0", rim=((0, -0.25, 1.0), 0.9, "#8fe8c8"),
        mats={
            "stone": P5("#0a1015", "#121d24", "#1d323a", "#2c4c56", "#4a7a80"),
            "stone2": P5("#0d1214", "#17201f", "#243530", "#35504a", "#587a6c"),
            "mortar": P5(*["#04070a"] * 5),
            "lip": P5("#0e1c22", "#1c3a42", "#2f6068", "#58a39e", "#a6e8c2"),
            "rubble": P5("#0c1216", "#17262c", "#27414a", "#3d6670", "#6aa0a0"),
            "back": P5("#05090c", "#080e13", "#0b141a", "#0f1b22", "#14242d"),
            "back2": P5("#06090d", "#0a1015", "#0e171d", "#121f27", "#182a34"),
            "backmortar": P5(*["#03060a"] * 5),
            "trim": P5("#0a1218", "#12202a", "#1d3440", "#2c5060", "#477a8a"),
            "wood": P5("#150e0b", "#241812", "#3b2819", "#5a3d24", "#7f5832"),
            "iron": P5("#090c10", "#141a22", "#242e3b", "#3f5064", "#7690a8"),
            "moss": P5("#0b1608", "#17300f", "#2a5a17", "#4a8a24", "#8cc83a"),
            "glow": P5("#1d6a63", "#2fa89a", "#57e0c4", "#9ff5e0", "#e0fff6"),
            "bone": P5("#1a1a1e", "#3b3b40", "#77756f", "#b9b39c", "#ece3c4"),
            "void": P5(*["#020407"] * 5),
            "cloth": P5("#1a1020", "#2a1830", "#40264a", "#5c3868", "#7c5088"),
            "gold": P5("#2a2008", "#4a380e", "#7a5c1a", "#b08a2c", "#e0c050"),
            "bronze": P5("#1c1208", "#3a2410", "#6a4418", "#a06a24", "#d49a40"),
            "rope": P5("#1a140c", "#2e2414", "#4a3a20", "#6c5632", "#907a48"),
            "brick": P5("#0a1015", "#121d24", "#1d323a", "#2c4c56", "#4a7a80"),
            "crack": P5(*["#04070a"] * 5),
        },
        plant=P5("#0b1608", "#17300f", "#2a5a17", "#4a8a24", "#8cc83a"),
        drip=P5("#0b1608", "#17300f", "#2a5a17", "#4a8a24", "#a6e84a"),
    ),
    "ramparts": dict(
        key=(-0.35, -0.5, 0.8), th=(0.30, 0.56, 0.78, 0.95), outline="#0b0916",
        sky="#120e2a", solid="#57547a", lipc="#b9b6e0", back="#171430", deep="#0b0a1c",
        shadow="#05030e", glowc="#a89cff", rim=((0.3, -0.25, 1.0), 0.9, "#e4e8ff"),
        mats={
            "stone": P5("#171629", "#2a2842", "#454264", "#6f6c94", "#a8a4cc"),
            "stone2": P5("#1a1a2c", "#2e2f48", "#4a4d6c", "#77799c", "#b0b4d0"),
            "mortar": P5(*["#0c0a18"] * 5),
            "lip": P5("#26244a", "#4a4878", "#7c78ac", "#b9b6e0", "#f0eeff"),
            "rubble": P5("#1a1830", "#2e2c4a", "#4c4a70", "#7a78a0", "#aeacd0"),
            "back": P5("#07060f", "#0b0a18", "#100e22", "#16132f", "#1d1a3d"),
            "back2": P5("#080710", "#0d0b1c", "#131127", "#1a1636", "#231f48"),
            "backmortar": P5(*["#060410"] * 5),
            "trim": P5("#100e22", "#1b1a38", "#2c2a52", "#434070", "#645f94"),
            "wood": P5("#1a1218", "#2a1c22", "#40292c", "#5e3d38", "#82573f"),
            "iron": P5("#0a0a12", "#161622", "#262636", "#42425c", "#74789c"),
            "moss": P5("#0a1a14", "#12382a", "#1f6040", "#38a060", "#78e090"),
            "glow": P5("#3a3a80", "#5a58b8", "#8a88e8", "#c0bcff", "#f4f2ff"),
            "bone": P5("#1a1a22", "#3b3b48", "#77768a", "#b9b6c8", "#ece8f4"),
            "void": P5(*["#05040c"] * 5),
            "cloth": P5("#2a0e2a", "#4a1640", "#7a2060", "#b03a7a", "#e0709c"),
            "gold": P5("#3a2a10", "#6a4a1a", "#a87a28", "#e0b040", "#fff0a0"),
            "bronze": P5("#2a1a10", "#523020", "#8a5030", "#c08040", "#f0b868"),
            "rope": P5("#1a140c", "#2e2414", "#4a3a20", "#6c5632", "#907a48"),
            "brick": P5("#171629", "#2a2842", "#454264", "#6f6c94", "#a8a4cc"),
            "crack": P5(*["#0c0a18"] * 5),
        },
        plant=P5("#0a1a14", "#12382a", "#1f6040", "#38a060", "#8ae890"),
        drip=P5("#0a1a14", "#12382a", "#1f6040", "#38a060", "#8ae890"),
    ),
    "tower": dict(
        key=(-0.35, -0.5, 0.8), th=(0.30, 0.56, 0.78, 0.95), outline="#0a0405",
        sky="#100607", solid="#361612", lipc="#d86a28", back="#0b0506", deep="#050202",
        shadow="#030101", glowc="#ff8a2a", rim=((0, 0.2, -1.0), 0.55, "#ff7a2a"),
        mats={
            "stone": P5("#100807", "#1f0d0b", "#361612", "#582519", "#8a3f22"),
            "stone2": P5("#120a0a", "#221211", "#3a1d18", "#5c3025", "#8a5033"),
            "brick": P5("#100807", "#1f0d0b", "#361612", "#582519", "#8a3f22"),
            "mortar": P5(*["#050202"] * 5),
            "lip": P5("#240d09", "#4a1a10", "#8a3418", "#d86a28", "#ffc060"),
            "rubble": P5("#180b09", "#2c1511", "#4a241a", "#73382a", "#a45a38"),
            "back": P5("#040203", "#080405", "#0d0607", "#140909", "#1d0e0b"),
            "back2": P5("#050203", "#090405", "#0f0708", "#170b0c", "#22100d"),
            "backmortar": P5(*["#030102"] * 5),
            "trim": P5("#0e0708", "#1a0d0e", "#2c1614", "#44241e", "#663a2a"),
            "wood": P5("#14100c", "#241a12", "#3a2a1a", "#58402a", "#7c5a38"),
            "iron": P5("#07080a", "#12141a", "#232830", "#3c4452", "#6c7a8c"),
            "moss": P5("#1a0c06", "#3a1a0a", "#7a3410", "#c06a1c", "#ffb040"),
            "glow": P5("#8a2808", "#d8501a", "#ff8a2a", "#ffc060", "#fff2c0"),
            "bone": P5("#1a1414", "#3b3030", "#77665c", "#b99f88", "#ecd8c0"),
            "void": P5(*["#030102"] * 5),
            "cloth": P5("#2a0808", "#4a1010", "#7a1c18", "#b02e22", "#e05a38"),
            "gold": P5("#3a2408", "#6a420e", "#a8701c", "#e0a030", "#fff0a0"),
            "bronze": P5("#2a1408", "#5a2c10", "#a05a1c", "#e0922c", "#ffd070"),
            "rope": P5("#1a140c", "#2e2414", "#4a3a20", "#6c5632", "#907a48"),
            "crack": P5(*["#050202"] * 5),
        },
        plant=P5("#1a0c06", "#3a1a0a", "#7a3410", "#c06a1c", "#ffb040"),
        drip=P5("#2a0a04", "#6a1a08", "#c03a10", "#ff7a20", "#ffd060"),
    ),
}

BIOME_CFG = {
    "prison": dict(moss_chance=0.40, deco_chance=0.22, drip_chance=0.30, crack_chance=0.10,
                   shadow_a=0.55),
    "ramparts": dict(moss_chance=0.45, deco_chance=0.18, drip_chance=0.22, crack_chance=0.07,
                     shadow_a=0.50),
    "tower": dict(moss_chance=0.30, deco_chance=0.20, drip_chance=0.20, crack_chance=0.12,
                  shadow_a=0.60),
}


def pal_ids(P):
    return {MAT[k]: v for k, v in P["mats"].items()}


# ======================================================================================
# painting helpers (all on RGBA uint8 arrays)


class Painter:
    def __init__(self, arr):
        self.a = arr
        self.h, self.w = arr.shape[:2]

    def put(self, x, y, c, only_empty=False):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            if only_empty and self.a[y, x, 3] > 0:
                return
            self.a[y, x, :3] = hexc(c) if isinstance(c, str) else c
            self.a[y, x, 3] = 255

    def solid(self, x, y):
        x, y = int(x), int(y)
        return 0 <= x < self.w and 0 <= y < self.h and self.a[y, x, 3] > 0


def paint_tufts(pt, rng, cell_x, base_y, pal, n=3, kind="moss", lo=2, hi=4, xmin=3, xmax=21):
    """Moss mounds / grass blades growing UP from row base_y (inclusive, exclusive of above)."""
    pal = [hexc(c) for c in pal]
    for _ in range(n):
        cx = cell_x + int(rng.integers(xmin, xmax))
        if kind == "moss":
            w = int(rng.integers(4, 9))
            hgt = int(rng.integers(lo, hi + 1))
            for dx in range(-w // 2, w // 2 + 1):
                prof = hgt * (1 - (abs(dx) / (w / 2 + 0.5)) ** 2)
                for dy in range(int(round(prof))):
                    y = base_y - 1 - dy
                    band = 3 if dy >= int(round(prof)) - 1 else (2 if dy > 0 else 1)
                    if (dx + dy) % 5 == 0 and band == 2:
                        band = 1
                    pt.put(cx + dx, y, pal[band])
        else:  # grass blades
            for i in range(int(rng.integers(3, 6))):
                x = cx + i - 2
                hgt = int(rng.integers(lo, hi + 3))
                lean = int(rng.integers(-1, 2))
                for dy in range(hgt):
                    xx = x + (lean if dy > hgt // 2 else 0)
                    pt.put(xx, base_y - 1 - dy, pal[1 + min(3, dy * 3 // max(1, hgt))])


def paint_hang(pt, rng, x0, y0, pal, n=3, lo=3, hi=8, xmin=3, xmax=21, leaf=False):
    """Drips / vines hanging DOWN from row y0."""
    pal = [hexc(c) for c in pal]
    used = set()
    for _ in range(n):
        x = int(rng.integers(xmin, xmax))
        if any(abs(x - u) < 3 for u in used):
            continue
        used.add(x)
        L = int(rng.integers(lo, hi + 1))
        for dy in range(L):
            band = 2 if dy < L - 2 else 3
            if dy == L - 1:
                band = 4
            pt.put(x0 + x, y0 + dy, pal[band])
            if dy < 2:
                pt.put(x0 + x + 1, y0 + dy, pal[2])
            if leaf and dy % 3 == 1:
                pt.put(x0 + x + (1 if dy % 2 else -1), y0 + dy, pal[3])


# ======================================================================================
# deterministic variant hash (docs/TILES.md "Variant hashing") -- keep in sync with render.ts


def _imul(a, b):
    return (a * b) & 0xFFFFFFFF


def hash01(x, y, s):
    x &= 0xFFFFFFFF
    y &= 0xFFFFFFFF
    s &= 0xFFFFFFFF
    h = (_imul(x, 374761393) + _imul(y, 668265263) + _imul(s, 2246822519)) & 0xFFFFFFFF
    h = _imul(h ^ (h >> 13), 1274126177)
    h = h ^ (h >> 16)
    return h / 4294967296.0


# ======================================================================================
# the autotile contract (docs/TILES.md) -- reference implementation


SOLIDS = (1, 4)


class MapView:
    def __init__(self, rows_tiles, rows_bg):
        self.h = len(rows_tiles)
        self.w = len(rows_tiles[0])
        self.t = rows_tiles
        self.bg = rows_bg

    def tile(self, x, y):
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return 1
        return self.t[y][x]

    def solid(self, x, y):
        return self.tile(x, y) in SOLIDS

    def wall(self, x, y):
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return True
        return self.bg[y][x] == 1


def pick(lst, r):
    return lst[min(len(lst) - 1, int(r * len(lst)))]


def depth_tier(m, x, y):
    """1..3: distance (Chebyshev) to the nearest non-solid cell, capped at 3."""
    for r in (1, 2):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if not m.solid(x + dx, y + dy):
                    return r
    return 3


def plan_decor(m, atlas):
    """Back-wall decoration plan: list of (name, x, y, w, h) in tile coords (docs/TILES.md)."""
    deco = atlas["backdeco"]
    occ = [[False] * m.w for _ in range(m.h)]

    def free(x, y):
        return (0 <= x < m.w and 0 <= y < m.h and m.tile(x, y) == 0 and m.bg[y][x] == 1
                and not occ[y][x])

    def free_rect(x, y, w, h):
        return all(free(x + i, y + j) for j in range(h) for i in range(w))

    def mark(x, y, w, h):
        for j in range(h):
            for i in range(w):
                occ[y + j][x + i] = True

    plan = []
    # pass 1: pillars (2 wide, floor to ceiling, 3..14 tall)
    for y in range(m.h):
        for x in range(m.w - 1):
            if not (m.solid(x, y - 1) and m.solid(x + 1, y - 1)):
                continue
            if not (free(x, y) and free(x + 1, y)):
                continue
            L = 0
            while free(x, y + L) and free(x + 1, y + L):
                L += 1
            if not (3 <= L <= 14 and m.solid(x, y + L) and m.solid(x + 1, y + L)):
                continue
            if hash01(x, y, 12) < deco["pillar_chance"]:
                plan.append(("pillar_top", x, y, 2, 1))
                for k in range(1, L - 1):
                    plan.append(("pillar_mid", x, y + k, 2, 1))
                plan.append(("pillar_bot", x, y + L - 1, 2, 1))
                mark(x, y, 2, L)
    # pass 2: floor-anchored pieces (bottom-left at (x, y), cell below is solid)
    for y in range(m.h):
        for x in range(m.w):
            if not (free(x, y) and m.solid(x, y + 1)):
                continue
            r = hash01(x, y, 13)
            acc = 0.0
            for name in ("arch", "special"):
                p = deco["chance"][name]
                w, h = deco["size"][name]
                if acc <= r < acc + p and free_rect(x, y - h + 1, w, h):
                    plan.append((name, x, y - h + 1, w, h))
                    mark(x, y - h + 1, w, h)
                    break
                acc += p
    # pass 3: wall pieces (top-left at (x, y)); chain hangs from a solid ceiling
    for y in range(m.h):
        for x in range(m.w):
            if not free(x, y):
                continue
            r = hash01(x, y, 14)
            acc = 0.0
            for name in ("window", "slit", "niche", "special2", "chain"):
                p = deco["chance"][name]
                w, h = deco["size"][name]
                if acc <= r < acc + p:
                    ok = free_rect(x, y, w, h)
                    if name == "chain":
                        ok = ok and m.solid(x, y - 1)
                    if ok:
                        plan.append((name, x, y, w, h))
                        mark(x, y, w, h)
                    break
                acc += p
    return plan


def autotile(m, atlas):
    """Return the draw list for a map: [(pass, region, px, py)] in draw order.

    pass names: 'back' (back wall + cracks + deco), 'fill', 'edge', 'detail', 'prop'.
    Regions are [sx, sy, sw, sh, ox, oy]; (px, py) = cell origin in pixels; the region is drawn
    at (px + ox, py + oy).  Back-wall shadows are described separately by `back_shadows`.
    """
    cfg = atlas["cfg"]
    ops = []
    T = TILE
    # ---- back layer
    for y in range(m.h):
        for x in range(m.w):
            if m.bg[y][x] == 1 and not m.solid(x, y):
                ops.append(("back", atlas["backwall"][(y & 3) * 8 + (x & 7)], x * T, y * T))
                if hash01(x, y, 11) < cfg["crack_chance"]:
                    ops.append(("back", pick(atlas["backCrack"], hash01(x, y, 15)), x * T, y * T))
    for (name, x, y, w, h) in plan_decor(m, atlas):
        if name.startswith("pillar_"):
            reg = atlas["backdeco"]["pillar"][name[7:]]
        else:
            reg = atlas["backdeco"][name]
        ops.append(("back", reg, x * T, y * T))
    # ---- terrain: fills
    for y in range(m.h):
        for x in range(m.w):
            t = m.tile(x, y)
            if t == 1:
                d = depth_tier(m, x, y)
                tier = (atlas["fill"], atlas["fillMid"], atlas["fillDeep"])[d - 1]
                ops.append(("fill", tier[(y & 3) * 8 + (x & 7)], x * T, y * T))
            elif t == 4:
                ops.append(("fill", pick(atlas["breakable"], hash01(x, y, 31)), x * T, y * T))
    # ---- terrain: edges
    for y in range(m.h):
        for x in range(m.w):
            if m.tile(x, y) != 1:
                continue
            px, py = x * T, y * T
            N, S = not m.solid(x, y - 1), not m.solid(x, y + 1)
            W, E = not m.solid(x - 1, y), not m.solid(x + 1, y)
            if S:
                ops.append(("edge", pick(atlas["bottom"], hash01(x, y, 2)), px, py))
            if W:
                ops.append(("edge", pick(atlas["left"], hash01(x, y, 3)), px, py))
            if E:
                ops.append(("edge", pick(atlas["right"], hash01(x, y, 4)), px, py))
            if N:
                if hash01(x >> 1, y, 5) < cfg["moss_chance"]:
                    ops.append(("edge", pick(atlas["topMoss"], hash01(x, y, 6)), px, py))
                else:
                    ops.append(("edge", pick(atlas["top"], hash01(x, y, 7)), px, py))
            o = atlas["outer"]
            if N and W:
                ops.append(("edge", o["tl"], px, py))
            if N and E:
                ops.append(("edge", o["tr"], px, py))
            if S and W:
                ops.append(("edge", o["bl"], px, py))
            if S and E:
                ops.append(("edge", o["br"], px, py))
            i = atlas["inner"]
            if not N and not W and not m.solid(x - 1, y - 1):
                ops.append(("edge", i["tl"], px, py))
            if not N and not E and not m.solid(x + 1, y - 1):
                ops.append(("edge", i["tr"], px, py))
            if not S and not W and not m.solid(x - 1, y + 1):
                ops.append(("edge", i["bl"], px, py))
            if not S and not E and not m.solid(x + 1, y + 1):
                ops.append(("edge", i["br"], px, py))
    # ---- terrain: details on top
    for y in range(m.h):
        for x in range(m.w):
            if m.tile(x, y) != 1:
                continue
            px, py = x * T, y * T
            if not m.solid(x, y - 1) and hash01(x, y, 8) < cfg["deco_chance"]:
                ops.append(("detail", pick(atlas["topDeco"], hash01(x, y, 9)), px, py))
            if not m.solid(x, y + 1) and hash01(x, y, 10) < cfg["drip_chance"]:
                ops.append(("detail", pick(atlas["drip"], hash01(x, y, 16)), px, py))
    # ---- props: platforms + spikes
    for y in range(m.h):
        for x in range(m.w):
            t = m.tile(x, y)
            px, py = x * T, y * T
            if t == 2:
                lc = m.tile(x - 1, y) == 2 or m.solid(x - 1, y)
                rc = m.tile(x + 1, y) == 2 or m.solid(x + 1, y)
                pl = atlas["platform"]
                if not lc and not rc:
                    reg = pl["single"]
                elif not lc:
                    reg = pl["l"]
                elif not rc:
                    reg = pl["r"]
                else:
                    reg = pick(pl["m"], hash01(x, y, 17))
                ops.append(("prop", reg, px, py))
            elif t == 3:
                sp = atlas["spikes"]
                if m.solid(x, y + 1):
                    reg = pick(sp["up"], hash01(x, y, 18))
                elif m.solid(x, y - 1):
                    reg = sp["down"]
                elif m.solid(x - 1, y):
                    reg = sp["right"]
                elif m.solid(x + 1, y):
                    reg = sp["left"]
                else:
                    reg = pick(sp["up"], hash01(x, y, 18))
                ops.append(("prop", reg, px, py))
    return ops


def back_shadows(m, atlas):
    """Back-wall ambient shadow strips: [(x, y, w, h, side)] in px; gradient from the solid edge."""
    out = []
    T = TILE
    G = atlas["cfg"]["shadow_w"]
    for y in range(m.h):
        for x in range(m.w):
            if m.bg[y][x] != 1 or m.solid(x, y):
                continue
            if m.solid(x, y - 1):
                out.append((x * T, y * T, T, G[0], "t"))
            if m.solid(x - 1, y):
                out.append((x * T, y * T, G[1], T, "l"))
            if m.solid(x + 1, y):
                out.append((x * T + T - G[1], y * T, G[1], T, "r"))
            if m.solid(x, y + 1):
                out.append((x * T, y * T + T - G[2], T, G[2], "b"))
    return out


def compose(m, atlas, atlas_img, bg_base=None, w_px=None, h_px=None):
    """Rasterise the contract exactly as the game does (reference for previews)."""
    W, H = m.w * TILE, m.h * TILE
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0)) if bg_base is None else bg_base.copy()
    ops = autotile(m, atlas)
    sh = back_shadows(m, atlas)
    col = hexc(atlas["colors"]["shadow"])
    a0 = atlas["cfg"]["shadow_a"]

    def blit(reg, px, py):
        sx, sy, sw, shh, ox, oy = reg
        canvas.alpha_composite(atlas_img.crop((sx, sy, sx + sw, sy + shh)), (px + ox, py + oy)) \
            if px + ox >= 0 and py + oy >= 0 else _blit_clipped(canvas, atlas_img, reg, px, py)

    for ps in ("back",):
        for (p, reg, px, py) in ops:
            if p == ps:
                blit(reg, px, py)
    # shadows go after back wall + cracks but they must also dim deco -> draw after all back ops
    for (x, y, w, h, side) in sh:
        g = np.zeros((h, w, 4), np.uint8)
        g[..., :3] = col
        n = {"t": h, "b": h, "l": w, "r": w}[side]
        ramp = (1 - (np.arange(n) + 0.5) / n) ** 1.6
        if side == "t":
            al = ramp[:, None] * np.ones((1, w))
        elif side == "b":
            al = ramp[::-1][:, None] * np.ones((1, w))
        elif side == "l":
            al = np.ones((h, 1)) * ramp[None, :]
        else:
            al = np.ones((h, 1)) * ramp[::-1][None, :]
        g[..., 3] = np.clip(al * a0 * 255, 0, 255).astype(np.uint8)
        canvas.alpha_composite(Image.fromarray(g), (x, y))
    for ps in ("fill", "edge", "detail", "prop"):
        for (p, reg, px, py) in ops:
            if p == ps:
                blit(reg, px, py)
    return canvas


def _blit_clipped(canvas, atlas_img, reg, px, py):
    sx, sy, sw, shh, ox, oy = reg
    dx, dy = px + ox, py + oy
    cx0, cy0 = max(0, -dx), max(0, -dy)
    if cx0 >= sw or cy0 >= shh:
        return
    canvas.alpha_composite(atlas_img.crop((sx + cx0, sy + cy0, sx + sw, sy + shh)), (dx + cx0, dy + cy0))


# ======================================================================================
# atlas assembly


class Atlas:
    """Shelf packer; returns regions [x, y, w, h, ox, oy]."""

    def __init__(self, width=640):
        self.width = width
        self.items = []

    def add(self, im, ox=0, oy=0):
        """Queue an RGBA image; returns a mutable region list filled in by finish()."""
        reg = [0, 0, im.shape[1], im.shape[0], ox, oy]
        self.items.append((im, reg))
        return reg

    def finish(self):
        x = y = rowh = 0
        placed = []
        for im, reg in sorted(self.items, key=lambda it: -it[0].shape[0]):
            h, w = im.shape[:2]
            if x + w > self.width:
                x, y, rowh = 0, y + rowh, 0
            reg[0], reg[1] = x, y
            placed.append((im, x, y))
            x += w
            rowh = max(rowh, h)
        H = y + rowh
        H = (H + 7) // 8 * 8
        out = np.zeros((H, self.width, 4), np.uint8)
        for im, px, py in placed:
            out[py:py + im.shape[0], px:px + im.shape[1]] = im
        return out


def slot(arr, x, y, w, h, pad=PAD):
    """Crop a cell-sized piece with `pad` px on every side (slot of (w+2pad) x (h+2pad))."""
    return arr[y - pad:y + h + pad, x - pad:x + w + pad].copy()


def pieces_of(biome):
    return json.load(open(os.path.join(ENV, "tiles", biome, "pieces.json")))


def shade_group(biome, group, P, **kw):
    gb = load_gbuf(os.path.join(ENV, "tiles", biome, group))
    kk = dict(key=P["key"], th=P["th"])
    kk.update(kw)
    return shade(gb, pal_ids(P), **kk)


def rim_for(P, mats):
    rdir, rth, c = P["rim"]
    return (rdir, rth, {MAT[m]: c for m in mats})


def paint_back_cracks(biome, P, rng):
    """6 translucent-looking crack / stain overlays (opaque pixels, sparse) for the back wall."""
    outs = []
    pal = pal_ids(P)
    dark = hexc(P["mats"]["backmortar"][0])
    lit = hexc(P["mats"]["back"][4])
    plant = P["plant"]
    for k in range(6):
        a = np.zeros((TILE, TILE, 4), np.uint8)
        pt = Painter(a)
        if k < 3:   # crack
            x, y = int(rng.integers(4, 20)), 0
            while y < TILE:
                pt.put(x, y, dark)
                pt.put(x + 1, y, lit) if rng.random() < 0.6 else None
                y += 1
                x += int(rng.integers(-1, 2))
                if rng.random() < 0.08:
                    for j in range(int(rng.integers(3, 7))):
                        pt.put(x + j * (1 if k % 2 else -1), y + j // 2, dark)
        elif k == 3:  # moss patch / glow spot
            paint_tufts(pt, rng, 0, 20, plant, n=3, kind="moss", lo=2, hi=4)
            paint_hang(pt, rng, 0, 4, P["drip"], n=2, lo=3, hi=7)
        elif k == 4:  # missing brick
            for j in range(7):
                for i in range(12):
                    pt.put(5 + i, 8 + j, dark)
            for i in range(12):
                pt.put(5 + i, 8, hexc(P["mats"]["back"][1]))
        else:  # damp streak
            x = int(rng.integers(6, 18))
            for y in range(0, TILE):
                pt.put(x, y, dark)
                if y % 3 == 0:
                    pt.put(x + 1, y, hexc(P["mats"]["back"][2]))
        outs.append(a)
    return outs


def build_biome(biome, quiet=False):
    P = PAL[biome]
    cfg = dict(BIOME_CFG[biome])
    meta = pieces_of(biome)
    rng = np.random.default_rng(sum(map(ord, biome)) * 31 + 7)
    A = Atlas()
    atlas = {"biome": biome, "tile": TILE, "pad": PAD}
    ol = P["outline"]
    ids = pal_ids(P)
    tint = P["deep"]

    # ---------------- fill macros (seamless 8 x 4 cells)
    fw, fh = meta["fill"]
    gb = load_gbuf(os.path.join(ENV, "tiles", biome, "fill"))
    fill = shade(gb, ids, key=P["key"], th=P["th"], wrap=True, seed=3)
    fill = paint_fill_details(biome, P, fill, gb, rng)

    def cells(arr, w, h):
        return [A.add(arr[j * TILE:(j + 1) * TILE, i * TILE:(i + 1) * TILE].copy())
                for j in range(h) for i in range(w)]
    atlas["fill"] = cells(fill, fw, fh)
    atlas["fillMid"] = cells(lerp_rgb(fill, tint, 0.40), fw, fh)
    atlas["fillDeep"] = cells(lerp_rgb(fill, tint, 0.74), fw, fh)

    # ---------------- back wall macro
    gb = load_gbuf(os.path.join(ENV, "tiles", biome, "back"))
    back = shade(gb, ids, key=P["key"], th=P["th"], wrap=True, seed=5, grit=0.03, edge=True)
    atlas["backwall"] = cells(back, fw, fh)
    atlas["backCrack"] = [A.add(c) for c in paint_back_cracks(biome, P, rng)]

    # ---------------- lips
    L = meta["groups"]["lip"]["pieces"]
    lipimg = shade_group(biome, "lip", P, rim=rim_for(P, ["lip"]), grit=0.0, edge=False, seed=9)
    # strip of 8 cells at x = 12.. (periodic) -> work on the strip with wrap for the outline
    sx0, sy0 = L["top0"][0], L["top0"][1]
    strip = np.zeros((TILE + PAD, 8 * TILE, 4), np.uint8)       # PAD rows above the cell
    strip[PAD:, :] = lipimg[sy0:sy0 + TILE, sx0:sx0 + 8 * TILE]
    plain = outline(strip, ol, wrap_x=True)
    top = []
    for k in range(8):
        top.append(A.add(plain[:, k * TILE:(k + 1) * TILE].copy(), 0, -PAD))
    atlas["top"] = top
    mossy = []
    mrng = np.random.default_rng(rng.integers(1 << 30))
    for k in range(8):
        cell = strip[:, k * TILE:(k + 1) * TILE].copy()
        cp = Painter(cell)
        paint_lip_plant(biome, P, cp, mrng, k)
        cell = outline_cell(cell, ol)
        mossy.append(A.add(cell, 0, -PAD))
    atlas["topMoss"] = mossy

    def slot_of(img, name, grp="lip"):
        x, y, w, h = meta["groups"][grp]["pieces"][name]
        s = slot(img, x, y, w, h)
        return s
    atlas["outer"] = {}
    atlas["inner"] = {}
    for c in ("tl", "tr"):
        atlas["outer"][c] = A.add(outline(slot_of(lipimg, "outer_" + c), ol), -PAD, -PAD)
        atlas["inner"][c] = A.add(outline(slot_of(lipimg, "inner_" + c), ol), -PAD, -PAD)

    # ---------------- sides + bottoms
    sideimg = shade_group(biome, "side", P, grit=0.02, seed=11,
                          rim=rim_for(P, ["stone", "stone2", "brick"]) if biome != "tower" else None)
    atlas["left"] = [A.add(outline(slot_of(sideimg, "left%d" % k, "side"), ol), -PAD, -PAD) for k in range(4)]
    atlas["right"] = [A.add(outline(slot_of(sideimg, "right%d" % k, "side"), ol), -PAD, -PAD) for k in range(4)]
    atlas["outer"]["bl"] = A.add(outline(slot_of(sideimg, "outer_bl", "side"), ol), -PAD, -PAD)
    atlas["outer"]["br"] = A.add(outline(slot_of(sideimg, "outer_br", "side"), ol), -PAD, -PAD)
    botimg = shade_group(biome, "bottom", P, grit=0.02, seed=12)
    atlas["bottom"] = [A.add(outline(slot_of(botimg, "bottom%d" % k, "bottom"), ol), -PAD, -PAD) for k in range(8)]
    atlas["inner"]["bl"] = A.add(outline(slot_of(botimg, "inner_bl", "bottom"), ol), -PAD, -PAD)
    atlas["inner"]["br"] = A.add(outline(slot_of(botimg, "inner_br", "bottom"), ol), -PAD, -PAD)

    # ---------------- top deco + drips
    tdimg = shade_group(biome, "topdeco", P, grit=0.0, edge=False, seed=13)
    atlas["topDeco"] = [A.add(outline(slot_of(tdimg, "topdeco%d" % k, "topdeco"), ol), -PAD, -PAD) for k in range(6)]
    drips = []
    drng = np.random.default_rng(rng.integers(1 << 30))
    for k in range(4):
        a = np.zeros((TILE + 2 * PAD, TILE + 2 * PAD, 4), np.uint8)
        paint_drip_piece(biome, P, Painter(a), drng, k)
        drips.append(A.add(outline(a, ol), -PAD, -PAD))
    atlas["drip"] = drips

    # ---------------- platforms
    pimg = shade_group(biome, "platform", P, grit=0.0, seed=14, edge=True,
                       rim=rim_for(P, ["wood", "iron"]) if biome != "tower" else None)
    pn = {}
    for nm in ("l", "m0", "m1", "m2", "r", "single"):
        pn[nm] = A.add(outline(slot_of(pimg, "plat_" + nm, "platform"), ol), -PAD, -PAD)
    atlas["platform"] = {"l": pn["l"], "m": [pn["m0"], pn["m1"], pn["m2"]], "r": pn["r"], "single": pn["single"]}

    # ---------------- spikes
    PADS = meta["groups"]["spikes"]["margin"]
    simg = shade_group(biome, "spikes", P, grit=0.0, edge=False, seed=15, amb=0.42, key=(-0.5, -0.4, 0.6),
                       th=(0.45, 0.62, 0.8, 0.93), rim=rim_for(P, ["iron"]))
    sp = {}
    for nm in ("up0", "up1", "up2", "down", "left", "right"):
        x, y, w, h = meta["groups"]["spikes"]["pieces"]["spike_" + nm]
        sp[nm] = A.add(outline(slot(simg, x, y, w, h, PADS), ol), -PADS, -PADS)
    atlas["spikes"] = {"up": [sp["up0"], sp["up1"], sp["up2"]], "down": sp["down"],
                       "left": sp["left"], "right": sp["right"]}

    # ---------------- breakable
    bimg = shade_group(biome, "breakable", P, grit=0.03, seed=16)
    brk = []
    for k in range(2):
        x, y, w, h = meta["groups"]["breakable"]["pieces"]["break%d" % k]
        cell = bimg[y:y + h, x:x + w].copy()
        cell = paint_breakable(biome, P, cell, k, rng)
        brk.append(A.add(cell))
    atlas["breakable"] = brk

    # ---------------- back decoration
    dimg = shade_group(biome, "deco", P, grit=0.0, seed=17, edge=True,
                       rim=None)
    dimg = tone(dimg, 0.88)
    DP = meta["groups"]["deco"]["pieces"]

    def dec(name):
        x, y, w, h = DP[name]
        return A.add(outline(dimg[y:y + h, x:x + w].copy(), ol) if False else dimg[y:y + h, x:x + w].copy())
    bd = {"arch": dec("arch"), "window": dec("window"), "chain": dec("chain"), "special": dec("special"),
          "niche": dec("niche"), "special2": dec("special2"), "slit": dec("slit"),
          "pillar": {"bot": dec("pillar_bot"), "mid": dec("pillar_mid"), "top": dec("pillar_top")}}
    bd["size"] = {"arch": [3, 4], "window": [2, 2], "chain": [1, 3], "special": [2, 3], "niche": [1, 1],
                  "special2": [2, 2], "slit": [1, 2]}
    bd["chance"] = {"arch": 0.035, "special": 0.03, "window": 0.020, "slit": 0.022, "niche": 0.016,
                    "special2": 0.016, "chain": 0.040}
    bd["pillar_chance"] = 0.12
    atlas["backdeco"] = bd

    # ---------------- finish
    sheet = A.finish()
    atlas["cfg"] = {"moss_chance": cfg["moss_chance"], "deco_chance": cfg["deco_chance"],
                    "drip_chance": cfg["drip_chance"], "crack_chance": cfg["crack_chance"],
                    "shadow_a": cfg["shadow_a"], "shadow_w": [10, 6, 3]}
    atlas["colors"] = {"sky": P["sky"], "solid": P["solid"], "lip": P["lipc"], "back": P["back"],
                       "deep": P["deep"], "shadow": P["shadow"], "glow": P["glowc"]}
    atlas["image"] = biome + ".png"
    return atlas, sheet


# --------------------------------------------------------------------------------------
# per-biome 2D painting


def outline_cell(cell, ol):
    """Outline for a (PAD+TILE) x TILE lip cell without wrapping (only top/bottom sides matter)."""
    big = np.zeros((cell.shape[0], cell.shape[1] + 2, 4), np.uint8)
    big[:, 1:-1] = cell
    # replicate neighbouring columns so the outline does not appear on the cell's own left/right
    big[:, 0] = cell[:, 0]
    big[:, -1] = cell[:, -1]
    o = outline(big, ol)
    return o[:, 1:-1]


def paint_fill_details(biome, P, fill, gb, rng):
    """Biome 2D details on the (periodic) fill: moss on stone tops, soot, cracks, rust."""
    out = fill.copy()
    mat, A = gb["mat"], gb["A"]
    h, w = A.shape
    mortar = (mat == MAT["mortar"]) | ~A
    above_m = np.roll(mortar, 1, 0)       # pixel whose upper neighbour is mortar -> stone top edge
    top_edge = ~mortar & above_m
    pt = Painter(out)
    plant = [hexc(c) for c in P["plant"]]
    if biome == "prison":
        for y in range(h):
            for x in range(w):
                if top_edge[y, x] and rng.random() < 0.20:
                    L = int(rng.integers(3, 9))
                    for i in range(L):
                        xx = (x + i) % w
                        if not mortar[y, xx]:
                            pt.put(xx, y, plant[2 if i % 4 else 3])
                            if rng.random() < 0.5 and not mortar[(y + 1) % h, xx]:
                                pt.put(xx, (y + 1) % h, plant[1])
    elif biome == "ramparts":
        for y in range(h):
            for x in range(w):
                if top_edge[y, x] and rng.random() < 0.05:
                    L = int(rng.integers(2, 6))
                    for i in range(L):
                        xx = (x + i) % w
                        if not mortar[y, xx]:
                            pt.put(xx, y, plant[2 if i % 3 else 3])
        # pale weathering streaks
        for _ in range(10):
            x = int(rng.integers(0, w))
            y0 = int(rng.integers(0, h))
            for i in range(int(rng.integers(5, 12))):
                yy = (y0 + i) % h
                if not mortar[yy, x]:
                    c = out[yy, x, :3].astype(np.int32) - 14
                    out[yy, x, :3] = np.clip(c, 0, 255).astype(np.uint8)
    else:  # tower: ember cracks in the mortar + rivets
        glow = [hexc(c) for c in P["mats"]["glow"]]
        for _ in range(14):
            x = int(rng.integers(0, w))
            y = int(rng.integers(0, h))
            if mortar[y, x] and A[y, x]:
                pt.put(x, y, glow[1])
                if rng.random() < 0.5:
                    pt.put((x + 1) % w, y, glow[2])
    return out


def paint_lip_plant(biome, P, pt, rng, k):
    """Moss mounds / grass / embers on a lip cell array of shape (PAD + TILE, TILE)."""
    base = PAD   # row of the cell top
    plant = P["plant"]
    if biome == "prison":
        paint_tufts(pt, rng, 0, base + 1, plant, n=int(rng.integers(1, 3)), kind="moss", lo=2, hi=4)
        paint_hang(pt, rng, 0, base + 7, P["drip"], n=int(rng.integers(1, 3)), lo=3, hi=9)
    elif biome == "ramparts":
        paint_tufts(pt, rng, 0, base + 1, plant, n=2, kind="grass", lo=3, hi=5, xmin=2, xmax=22)
        paint_hang(pt, rng, 0, base + 7, P["drip"], n=int(rng.integers(1, 3)), lo=4, hi=10, leaf=True)
    else:
        em = [hexc(c) for c in P["mats"]["glow"]]
        for _ in range(int(rng.integers(3, 6))):
            x = int(rng.integers(2, 22))
            pt.put(x, base + 2, em[3])
            if rng.random() < 0.5:
                pt.put(x + 1, base + 2, em[2])
            if rng.random() < 0.4:
                pt.put(x, base - 1 - int(rng.integers(0, 3)), em[4])
        for x in range(2, 22):
            if pt.solid(x, base + 1) and rng.random() < 0.5:
                pt.put(x, base + 1, em[2])


def paint_drip_piece(biome, P, pt, rng, k):
    """Hanging overlay for the underside of a cell (slot is (TILE + 2 PAD)^2; cell bottom at PAD + TILE)."""
    y0 = PAD + TILE - 3
    if biome == "tower":
        # a short hanging chain + glowing drip
        pal = P["mats"]["iron"]
        x = int(rng.integers(6, 18)) + PAD
        L = int(rng.integers(5, 12))
        for i in range(L):
            pt.put(x, y0 + i, pal[3 if i % 2 else 2])
            if i % 2 == 0:
                pt.put(x + 1, y0 + i, pal[2])
        g = P["drip"]
        pt.put(x + 6, y0 + 1, g[3])
        for i in range(2, 6):
            pt.put(x + 6, y0 + i, g[2 if i < 5 else 4])
    else:
        paint_hang(pt, rng, PAD, y0, P["drip"], n=int(rng.integers(2, 4)), lo=4, hi=11,
                   leaf=(biome == "ramparts"))


def paint_breakable(biome, P, cell, k, rng):
    pt = Painter(cell)
    dark = hexc(P["mats"]["mortar"][0])
    lit = hexc(P["mats"]["stone"][4])
    x, y = 12 + int(rng.integers(-3, 3)), 0
    while y < TILE:
        pt.put(x, y, dark)
        pt.put(x + 1, y, dark)
        if y % 2 == 0:
            pt.put(x - 1, y, lit)
        y += 1
        x += int(rng.integers(-1, 2))
        if y in (9, 15):
            for j in range(1, 5):
                pt.put(x + j * (1 if y == 9 else -1), y, dark)
    if biome == "tower":
        glow = hexc(P["mats"]["glow"][2])
        for yy in range(3, 21, 3):
            pt.put(12, yy, glow)
    return outline_edge_darken(cell, P)


def outline_edge_darken(cell, P):
    # 1px dark frame so the breakable reads as an inset block
    c = hexc(P["outline"])
    cell[0, :, :3] = c
    cell[-1, :, :3] = c
    cell[:, 0, :3] = c
    cell[:, -1, :3] = c
    return cell


# ======================================================================================
# preview


def mock_rows(biome):
    """33 x 15 cell mock room (792 x 360 px) exercising every tile type."""
    W_, H_ = 33, 15
    g = [["#"] * W_ for _ in range(H_)]

    def rect(x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                g[y][x] = c
    rect(3, 2, 29, 11, ".")                    # main hall
    rect(0, 8, 3, 11, ".")                     # entrance corridor on the left
    rect(20, 3, 28, 8, ",")                    # open sky / far background window
    rect(9, 8, 13, 11, "#")                    # raised block
    rect(15, 2, 18, 3, "#")                    # ceiling stalactite block
    rect(22, 9, 26, 11, "#")                   # right pedestal
    rect(1, 12, 2, 12, ".")                    # a pit
    rect(5, 6, 7, 6, "=")                      # platforms
    rect(15, 6, 19, 6, "=")
    rect(10, 4, 11, 4, "=")
    rect(23, 6, 23, 6, "=")
    rect(16, 11, 19, 11, "^")                  # spikes on the floor
    rect(14, 11, 14, 11, "^")
    g[11][3] = "x"; g[10][3] = "x"; g[9][3] = "x"   # breakable wall
    g[4][3] = "^"                              # wall spike
    g[3][21] = ","
    return ["".join(r) for r in g]


def ascii_to_map(rows):
    tmap = {"#": 1, "=": 2, "^": 3, "x": 4}
    t, b = [], []
    for r in rows:
        t.append([tmap.get(c, 0) for c in r])
        b.append([0 if c == "," else 1 for c in r])
    return MapView(t, b)


def load_bg_layers(biome):
    p = os.path.join(OUT, "bg", biome + ".json")
    if not os.path.exists(p):
        return None
    return json.load(open(p))


def layer_placement(parallax, vpar, y_off, iw, ih, view_x, view_y, view_h, bounds_h):
    """docs/TILES.md "Parallax": (x0, y, step).  Layers are anchored to the BOTTOM of the screen when
    the camera is at the lowest point of the level and slide down as the camera climbs."""
    max_y = max(0, bounds_h - view_h)
    slide = min(max(0, ih - view_h), max(0.0, (max_y - view_y) * vpar))
    y = int(np.floor(view_h - ih + slide + y_off + 0.5))
    sx = int(np.floor(view_x * parallax))
    return -(sx % iw), y, iw


def compose_parallax(biome, w, h, view_x=0, view_y=None, bounds_h=None):
    """Reference of the parallax contract (docs/TILES.md): sky colour + layers far -> near."""
    d = load_bg_layers(biome)
    base = Image.new("RGBA", (w, h), hexc(d["sky"]) + (255,) if d else (20, 20, 30, 255))
    if not d:
        return base
    bounds_h = bounds_h if bounds_h is not None else h
    view_y = view_y if view_y is not None else max(0, bounds_h - h)
    for l in d["layers"]:
        p = os.path.join(OUT, "bg", l["image"])
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        iw, ih = im.size
        x0, y, step = layer_placement(l["parallax"], l.get("vpar", l["parallax"] * 0.5), l.get("y", 0), iw, ih,
                                      view_x, view_y, h, bounds_h)
        x = x0
        while x < w:
            _paste_clip(base, im, x, y)
            x += step
    return base


def _paste_clip(base, im, x, y):
    W, H = base.size
    sx, sy = max(0, -x), max(0, -y)
    ex, ey = min(im.width, W - x), min(im.height, H - y)
    if ex <= sx or ey <= sy:
        return
    base.alpha_composite(im.crop((sx, sy, ex, ey)), (x + sx, y + sy))


def heroine_frame():
    p = os.path.join(ROOT, "build", "frames", "heroine", "idle_000.png")
    if not os.path.exists(p):
        return None
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import sheet as S
    return S.process(p), (64, 100)


def write_preview(biome, atlas, sheet_img):
    os.makedirs(PREVIEW, exist_ok=True)
    m = ascii_to_map(mock_rows(biome))
    W, H = m.w * TILE, m.h * TILE
    # parallax scene (camera at x=0 of a larger hall) as backdrop
    sky = compose_parallax(biome, W, H, view_x=40)
    rooms = compose(m, atlas, sheet_img, bg_base=sky)
    hf = heroine_frame()
    if hf:
        im, (ax, ay) = hf
        # stand on the floor near the left
        fx, fy = 4 * TILE + 12, 11 * TILE
        rooms.alpha_composite(im, (fx - ax, fy - ay))
    return rooms


# ======================================================================================
# golden file for tests/render.test.ts (synthetic atlas -> exact draw lists)


def synthetic_atlas():
    n = [0]

    def r():
        n[0] += 1
        return [n[0], 0, 1, 1, 0, 0]

    def rs(k):
        return [r() for _ in range(k)]
    a = {"biome": "golden", "tile": TILE, "pad": PAD,
         "fill": rs(32), "fillMid": rs(32), "fillDeep": rs(32), "top": rs(8), "topMoss": rs(8),
         "topDeco": rs(6), "drip": rs(4), "bottom": rs(8), "left": rs(4), "right": rs(4),
         "outer": {k: r() for k in ("tl", "tr", "bl", "br")}, "inner": {k: r() for k in ("tl", "tr", "bl", "br")},
         "platform": {"l": r(), "m": rs(3), "r": r(), "single": r()},
         "spikes": {"up": rs(3), "down": r(), "left": r(), "right": r()},
         "breakable": rs(2), "backwall": rs(32), "backCrack": rs(6)}
    a["backdeco"] = {"arch": r(), "window": r(), "chain": r(), "special": r(), "niche": r(), "special2": r(),
                     "slit": r(), "pillar": {"bot": r(), "mid": r(), "top": r()},
                     "size": {"arch": [3, 4], "window": [2, 2], "chain": [1, 3], "special": [2, 3], "niche": [1, 1],
                              "special2": [2, 2], "slit": [1, 2]},
                     "chance": {"arch": 0.06, "special": 0.05, "window": 0.05, "slit": 0.05, "niche": 0.04,
                                "special2": 0.04, "chain": 0.06},
                     "pillar_chance": 0.5}
    a["cfg"] = {"moss_chance": 0.4, "deco_chance": 0.25, "drip_chance": 0.3, "crack_chance": 0.12,
                "shadow_a": 0.5, "shadow_w": [10, 6, 3]}
    a["colors"] = {"sky": "#000000", "solid": "#222222", "lip": "#888888", "back": "#111111",
                   "deep": "#000000", "shadow": "#000000", "glow": "#ffffff"}
    a["image"] = "golden.png"
    return a


GOLDEN_MAP = [
    "################################################",
    "##....................######,,,,,,,,,,,,,,,,,,,##",
    "##....................######,,,,,,,,,,,,,,,,,,,##",
    "##...===...............#####,,,,,,,,,,,,,,,,,,,##",
    "##.....................#####.........====.......#",
    "##..........####.......####.....................#",
    "##..........####..............##...............##",
    "##...x......####..................==...........##",
    "##...x......####.........^........##.......#######",
    "##....................#########....##............##"[:48],
    "##.......=====........#########..........#####..##",
    "##.....................######...........######..##",
    "#####.........................................####",
    "##..............................^^^^.............#",
    "##.......................#####.#####....###.......#",
    "##.......####............#####.#####....###....###",
    "##.......####........................^...........#",
    "##...........^....###............................#",
    "#####....................................#######",
    "##...............................................#",
    "##.....................###########..........######",
    "##.....................###########..........######",
    "##^^^^..................###########..............#",
    "################################################",
]


def golden_map():
    rows = [r.ljust(48, "#")[:48] for r in GOLDEN_MAP]
    return rows


def write_golden(path):
    rows = golden_map()
    m = ascii_to_map(rows)
    atlas = synthetic_atlas()
    ops = [[p] + list(reg) + [px, py] for (p, reg, px, py) in autotile(m, atlas)]
    plan = [list(it) for it in plan_decor(m, atlas)]
    shadows = [list(s) for s in back_shadows(m, atlas)]
    hashes = [[x, y, sd, hash01(x, y, sd)] for (x, y, sd) in
              ((0, 0, 0), (1, 2, 3), (5, 5, 5), (-1, 7, 2), (123, 456, 31), (-30, -2, 11), (2047, 1023, 17))]
    place = []
    for (par, vpar, yoff, iw, ih, vx, vy, vh, bh) in (
            (0.3, 0.15, 0, 1024, 512, 100, 200, 360, 864), (0.05, 0.05, 0, 1024, 512, -3, 0, 360, 432),
            (0.7, 0.3, 4, 1024, 512, 5000, 500, 360, 1296), (0.0, 0.0, 0, 1024, 512, 777, 100, 360, 432),
            (0.45, 0.2, 0, 1024, 300, 1023, 500, 360, 1296)):
        place.append([par, vpar, yoff, iw, ih, vx, vy, vh, bh] + list(layer_placement(par, vpar, yoff, iw, ih, vx, vy, vh, bh)))
    with open(path, "w") as f:
        json.dump({"atlas": atlas, "rows": rows, "ops": ops, "decor": plan, "shadows": shadows,
                   "hashes": hashes, "placements": place}, f, separators=(",", ":"))
    print("golden: %d ops, %d decor, %d shadows -> %s" % (len(ops), len(plan), len(shadows), path))


def main(biomes):
    os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)
    for b in biomes:
        atlas, sheet = build_biome(b)
        img = Image.fromarray(sheet)
        img.save(os.path.join(OUT, "tiles", b + ".png"), optimize=True)
        with open(os.path.join(OUT, "tiles", b + ".json"), "w") as f:
            json.dump(atlas, f, separators=(",", ":"))
        pv = write_preview(b, atlas, img)
        pv.convert("RGB").save(os.path.join(PREVIEW, "env_%s.png" % b))
        print("post_tiles: %s atlas %dx%d" % (b, img.width, img.height))


if __name__ == "__main__":
    if "--golden" in sys.argv:
        write_golden(os.path.join(ROOT, "tests", "render_golden.json"))
    else:
        main([a for a in sys.argv[1:] if not a.startswith("-")] or ["prison", "ramparts", "tower"])
