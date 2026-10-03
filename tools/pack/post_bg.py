"""Parallax background post-processing.

usage: python3 tools/pack/post_bg.py [biome ...]

Shades the Blender G-buffers from build/env/bg/<biome>/ (tools/blender/asset_bg.py), adds the
numpy-painted parts (sky gradients, stars, moon, clouds, mountains, fog, light shafts, embers)
and writes public/assets/bg/<biome>_<n>.png (1024 x 512, horizontally seamless) +
public/assets/bg/<biome>.json  {"sky", "layers": [{"image","parallax","y","vpar","repeatX"}]}
(layer order = far -> near).  Positioning contract: docs/TILES.md "Parallax".
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post_tiles import ENV, OUT, hexc, load_gbuf, shade, MAT  # noqa: E402

W, H = 1024, 512


# ======================================================================================
# helpers


def R(dark, bright, n=5, gamma=1.0):
    d, b = np.array(hexc(dark), float), np.array(hexc(bright), float)
    return [tuple(int(round(v)) for v in d + (b - d) * (i / (n - 1)) ** gamma) for i in range(n)]


def rgb(c):
    return np.array(hexc(c) if isinstance(c, str) else c, np.float32)


def fnoise(h, w, rng, beta=2.0, sx=1.0, sy=1.0):
    """Periodic (wraps in both axes) 1/f^beta noise in 0..1; sx > 1 stretches features along x."""
    F = np.fft.fft2(rng.standard_normal((h, w)))
    fy = np.fft.fftfreq(h)[:, None] * sy
    fx = np.fft.fftfreq(w)[None, :] * sx
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    n = np.fft.ifft2(F / f ** beta).real
    n -= n.min()
    return n / max(n.max(), 1e-6)


def vgrad(stops, h=H, w=W):
    """Vertical gradient from [(t, '#hex'), ...] (t in 0..1 of the layer height) -> float RGB."""
    ys = np.linspace(0, 1, h)
    out = np.zeros((h, 3), np.float32)
    ts = [s[0] for s in stops]
    for ch in range(3):
        out[:, ch] = np.interp(ys, ts, [rgb(s[1])[ch] for s in stops])
    return np.repeat(out[:, None, :], w, 1)


def over(base, top_rgb, top_a):
    """Alpha-composite float layers. base: (h,w,4) float 0..255 (rgb + alpha 0..1)."""
    a = np.clip(top_a, 0, 1)[..., None]
    ba = base[..., 3:4]
    oa = a + ba * (1 - a)
    rgbo = (top_rgb * a + base[..., :3] * ba * (1 - a)) / np.maximum(oa, 1e-6)
    out = np.concatenate([rgbo, oa], -1)
    return out


def to_img(layer):
    a = layer[..., 3]
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = np.clip(layer[..., :3], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(a > 0.5, 255, 0).astype(np.uint8)
    return out


def empty():
    return np.zeros((H, W, 4), np.float32)


def posterize(x, levels):
    return np.floor(np.clip(x, 0, 0.9999) * levels) / (levels - 1)


def load_layer(biome, name, pal, **kw):
    gb = load_gbuf(os.path.join(ENV, "bg", biome, name))
    kw.setdefault("wrap", True)
    kw.setdefault("grit", 0.0)
    img = shade(gb, pal, **kw)
    return gb, img


def depth_fog(layer_rgb, gb, color, k):
    d = np.clip(gb["depth"] * k, 0, 1)[..., None]
    return layer_rgb * (1 - d) + rgb(color) * d


def shafts(xs, widths, slope, h=H, w=W, grow=0.18, fade_pow=0.9, levels=4):
    """Soft diagonal light shafts (periodic in x) -> alpha 0..1 (posterised)."""
    X = np.arange(w, dtype=np.float32)[None, :]
    Y = np.arange(h, dtype=np.float32)[:, None]
    acc = np.zeros((h, w), np.float32)
    for x0, wd in zip(xs, widths):
        for off in (-w, 0, w):
            c = x0 + off + slope * Y
            ww = wd + grow * Y
            t = 1 - np.abs(X - (c + ww / 2)) / (ww / 2)
            acc = np.maximum(acc, np.clip(t, 0, 1) ** 0.6)
    acc *= np.clip(1 - Y / (h * 1.05), 0, 1) ** fade_pow
    return posterize(acc, levels) if levels else acc


def embers(rng, density, color_pal, ymin=0.0, w=W, h=H):
    """Sparse ember pixels (1-2 px) -> (rgb float, alpha)"""
    a = np.zeros((h, w), np.float32)
    col = np.zeros((h, w, 3), np.float32)
    n = int(density)
    for _ in range(n):
        y = int(h * (ymin + (1 - ymin) * rng.random() ** 0.6))
        x = int(rng.integers(0, w))
        c = rgb(color_pal[int(rng.integers(1, len(color_pal)))])
        for dx, dy in ((0, 0),) if rng.random() < 0.6 else ((0, 0), (1, 0)):
            a[y % h, (x + dx) % w] = 1
            col[y % h, (x + dx) % w] = c
    return col, a


def brickify(img, mask, rng, ch=11, cw=(22, 38), line=0.55, var=0.10, seed=0):
    """Overlay running-bond masonry on masked pixels of an RGB image (periodic in x)."""
    out = img.copy().astype(np.float32)
    rr = np.random.default_rng(seed)
    row = 0
    y = 0
    while y < H:
        x = int(rr.integers(0, cw[1]))
        xs = []
        while x < W + cw[1]:
            xs.append(x)
            x += int(rr.integers(*cw))
        xs = [v % W for v in xs]
        h = ch
        for i, x0 in enumerate(xs):
            x1 = (xs[(i + 1) % len(xs)]) if i + 1 < len(xs) else xs[0] + W
            if x1 <= x0:
                x1 += W
            k = 1 + var * (rr.random() * 2 - 1)
            cols = np.arange(x0, x1) % W
            seg = np.ix_(np.arange(y, min(H, y + h)), cols)
            m = mask[seg]
            out[seg] = np.where(m[..., None], out[seg] * k, out[seg])
            # vertical joint
            jm = mask[y:min(H, y + h), x0 % W]
            out[y:min(H, y + h), x0 % W][jm] *= (1 - line * 0.6)
        # horizontal joint at the bottom row of the course
        yy = min(H - 1, y + h - 1)
        out[yy][mask[yy]] *= (1 - line)
        y += h
        row += 1
    return np.clip(out, 0, 255)


def lift(img, g):
    if g == 1.0:
        return img
    out = img.copy()
    m = out[..., 3] > 0
    out[..., :3][m] = np.clip(np.power(out[..., :3][m].astype(np.float32) / 255.0, g) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return out


LIFT = {"prison": 0.82, "ramparts": 1.0, "tower": 0.85}   # gamma < 1 lifts the darks (the game multiplies by ambient)


def write_layers(biome, layers, sky, params):
    os.makedirs(os.path.join(OUT, "bg"), exist_ok=True)
    meta = {"sky": sky, "layers": []}
    g = LIFT[biome]
    layers = [lift(l, g) for l in layers]
    for i, (img, p) in enumerate(zip(layers, params)):
        name = "%s_%d.png" % (biome, i)
        Image.fromarray(img).save(os.path.join(OUT, "bg", name), optimize=True)
        meta["layers"].append({"image": name, "parallax": p[0], "y": 0, "vpar": p[1], "repeatX": True})
    with open(os.path.join(OUT, "bg", biome + ".json"), "w") as f:
        json.dump(meta, f, indent=1)


# ======================================================================================
# PRISON


def build_prison():
    rng = np.random.default_rng(101)
    ys = np.arange(H)[:, None]

    # ---- L0: far hall (opaque)
    pal0 = {MAT["far"]: R("#07131a", "#1a3a42"), MAT["far2"]: R("#0a1a21", "#2a5961"),
            MAT["mortar"]: R("#05100f", "#05100f"), MAT["void"]: R("#000000", "#000000")}
    gb, im = load_layer("prison", "0", pal0, key=(-0.3, -0.6, 0.7), th=(0.35, 0.6, 0.8, 0.95))
    base = vgrad([(0, "#03080c"), (0.45, "#0a1a22"), (0.8, "#14363e"), (1, "#1f5a60")])
    # beyond-the-arches glow
    n = fnoise(H, W, rng, 2.2, sx=2.0)
    glow = vgrad([(0, "#040b10"), (0.4, "#0b242c"), (0.75, "#1d5f66"), (1, "#3ea0a0")])
    glow = glow * (0.8 + 0.4 * n[..., None])
    layer = np.concatenate([base, np.ones((H, W, 1), np.float32)], -1)
    solid = (gb["A"]) & (gb["mat"] != MAT["void"])
    opening = (gb["A"]) & (gb["mat"] == MAT["void"])
    layer[opening, :3] = glow[opening]
    layer[solid, :3] = im[solid, :3]
    # haze: depth + bottom fog
    fogc = rgb("#1c4f56")
    hz = np.clip((ys - 260) / 250.0, 0, 1) ** 1.4
    layer[..., :3] = layer[..., :3] * (1 - 0.55 * hz[..., None]) + fogc * 0.55 * hz[..., None]
    # distant hanging lamps / glints
    L0 = to_img(layer)

    # ---- L1: pillars + arches + chains, light shafts, fog
    pal1 = {MAT["stone"]: R("#04090d", "#22454d"), MAT["wood"]: R("#0b0807", "#2a1c12"),
            MAT["iron"]: R("#05080c", "#2b3e4c"), MAT["mortar"]: R("#03070a", "#03070a"),
            MAT["far2"]: R("#07101a", "#20404a")}
    gb, im = load_layer("prison", "1", pal1, key=(-0.4, -0.55, 0.7), th=(0.33, 0.58, 0.8, 0.95),
                        rim=((0.1, -0.2, 1.0), 0.88, {MAT["stone"]: "#6fd8c8", MAT["wood"]: "#6a8a70"}))
    layer = empty()
    layer[gb["A"], :3] = im[gb["A"], :3]
    layer[gb["A"], 3] = 1
    sh = shafts([60, 330, 600, 880], [34, 22, 40, 26], 0.55)
    layer = over(layer, np.broadcast_to(rgb("#7ff0d8"), (H, W, 3)), sh * 0.30)
    fogm = fnoise(H, W, rng, 2.6, sx=3.0) ** 1.5
    fa = np.clip((ys - 340) / 172.0, 0, 1) ** 1.2 * (0.35 + 0.65 * fogm)
    layer = over(layer, np.broadcast_to(rgb("#2e7a7a"), (H, W, 3)), posterize(fa, 5) * 0.55)
    L1 = to_img(layer)

    # ---- L2: cell block
    pal2 = {MAT["back"]: R("#04080b", "#152a32"), MAT["trim"]: R("#050b10", "#1e3a45"),
            MAT["iron"]: R("#05080e", "#35566a"), MAT["wood"]: R("#0a0706", "#2a1c10"),
            MAT["mortar"]: R("#02050a", "#02050a"), MAT["void"]: R("#010203", "#010203")}
    gb, im = load_layer("prison", "2", pal2, key=(-0.4, -0.5, 0.75), th=(0.33, 0.58, 0.8, 0.95),
                        rim=((0.1, -0.2, 1.0), 0.88, {MAT["trim"]: "#4fb0a8", MAT["back"]: "#2f6a6a"}))
    layer = empty()
    layer[gb["A"], :3] = im[gb["A"], :3]
    layer[gb["A"], 3] = 1
    # glowing depth inside the cells (dim green-teal)
    vo = gb["A"] & (gb["mat"] == MAT["void"])
    cellglow = vgrad([(0, "#05100f"), (1, "#0f3a38")])
    layer[vo, :3] = cellglow[vo]
    fogm = fnoise(H, W, rng, 2.4, sx=3.0) ** 1.4
    fa = np.clip((ys - 420) / 92.0, 0, 1) ** 1.1 * (0.3 + 0.7 * fogm)
    layer = over(layer, np.broadcast_to(rgb("#235f60"), (H, W, 3)), posterize(fa, 4) * 0.6)
    L2 = to_img(layer)

    # ---- L3: near silhouettes
    pal3 = {MAT["trim"]: R("#020406", "#0b151a"), MAT["wood"]: R("#050303", "#150e0a"),
            MAT["iron"]: R("#020306", "#0f1a22")}
    gb, im = load_layer("prison", "3", pal3, key=(-0.4, -0.5, 0.75), th=(0.33, 0.58, 0.8, 0.95),
                        rim=((-1.0, -0.1, 0.25), 0.93, {MAT["trim"]: "#2c7f84", MAT["iron"]: "#3a8c92",
                                                       MAT["wood"]: "#3a5a52"}))
    layer = empty()
    layer[gb["A"], :3] = im[gb["A"], :3]
    layer[gb["A"], 3] = 1
    L3 = to_img(layer)

    write_layers("prison", [L0, L1, L2, L3], "#050a10",
                 [(0.05, 0.05), (0.16, 0.10), (0.36, 0.18), (0.62, 0.28)])


# ======================================================================================
# RAMPARTS


def mountains(rng, base_y, amp, freqs, color_bands, seed_shift=0):
    """Periodic mountain silhouette with banded shading -> (rgb, alpha) float."""
    x = np.arange(W, dtype=np.float32)
    prof = np.zeros(W, np.float32)
    for k, (f, a) in enumerate(freqs):
        ph = rng.random() * 6.283
        prof += a * np.abs(np.sin(2 * np.pi * f * x / W + ph)) ** (1.3 - 0.1 * k)
    prof = prof / prof.max() * amp
    top = base_y - prof
    ys = np.arange(H, dtype=np.float32)[:, None]
    a = (ys >= top[None, :]).astype(np.float32)
    # shade: lighter near the ridge line (moon-lit), darker below
    depth = (ys - top[None, :])
    cols = np.zeros((H, W, 3), np.float32)
    for i, (lim, c) in enumerate(color_bands):
        m = depth >= lim
        cols[m] = rgb(c)
    return cols, a


def build_ramparts():
    rng = np.random.default_rng(202)
    ys = np.arange(H)[:, None]

    # ---- L0: sky + stars + moon (opaque)
    sky = vgrad([(0, "#060520"), (0.35, "#140f3e"), (0.62, "#2c1a5c"), (0.82, "#5a2a74"),
                 (1, "#8a3a80")])
    # fine banding: posterise each channel a bit so the gradient reads as pixel-art steps
    sky = np.floor(sky / 6) * 6
    layer = np.concatenate([sky, np.ones((H, W, 1), np.float32)], -1)
    # stars
    n_st = 420
    for _ in range(n_st):
        y = int(H * rng.random() ** 1.7 * 0.8)
        x = int(rng.integers(0, W))
        b = rng.random()
        c = rgb("#ffffff") if b > 0.7 else rgb("#b8b4ff") if b > 0.35 else rgb("#6a64b8")
        layer[y, x, :3] = c
        if b > 0.93:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                layer[(y + dy) % H, (x + dx) % W, :3] = c * 0.55
    # moon
    mx, my, mr = 612, 238, 74
    X, Y = np.meshgrid(np.arange(W), np.arange(H))
    d = np.sqrt((X - mx) ** 2 + (Y - my) ** 2)
    halo = np.clip(1 - (d - mr) / 150.0, 0, 1) ** 2.2
    layer = over(layer, np.broadcast_to(rgb("#6a5ce0"), (H, W, 3)), posterize(halo, 7) * 0.45)
    halo2 = np.clip(1 - (d - mr) / 46.0, 0, 1) ** 2
    layer = over(layer, np.broadcast_to(rgb("#b4acff"), (H, W, 3)), posterize(halo2, 5) * 0.5)
    disc = d <= mr
    nz = fnoise(H, W, rng, 2.0)
    lx, ly = (X - mx) / mr, (Y - my) / mr
    shade_t = np.clip(0.55 + 0.45 * (-lx * 0.55 - ly * 0.55), 0, 1)       # lit from the upper left
    moon_cols = [rgb("#8e88c4"), rgb("#b4b0e0"), rgb("#d8d6f4"), rgb("#f0eeff")]
    k = np.clip((shade_t * 3.2 + (nz - 0.5) * 1.1), 0, 3.99).astype(int)
    mcol = np.array(moon_cols)[k]
    # maria (dark patches) and craters
    for (cx, cy, rr) in ((-0.3, -0.1, 0.32), (0.25, 0.3, 0.26), (0.1, -0.4, 0.2), (-0.1, 0.5, 0.14)):
        m = ((lx - cx) ** 2 + (ly - cy) ** 2) < rr ** 2
        mcol[m & disc] = mcol[m & disc] * 0.78
    for _ in range(14):
        cx, cy = (rng.random() * 1.6 - 0.8), (rng.random() * 1.6 - 0.8)
        if cx * cx + cy * cy > 0.7:
            continue
        rr = rng.uniform(0.04, 0.09)
        ring = np.abs(np.sqrt((lx - cx) ** 2 + (ly - cy) ** 2) - rr) < 0.014
        mcol[ring & disc] = mcol[ring & disc] * 0.82
    # dark edge ring (outline)
    ring = (d > mr - 2.2) & disc
    mcol[ring] = mcol[ring] * 0.72
    layer[disc, :3] = mcol[disc]
    L0 = to_img(layer)

    # ---- L1: clouds
    layer = empty()
    cn = fnoise(H, W, rng, 2.6, sx=5.0, sy=1.0)
    band = np.exp(-(((ys - 215) / 80.0) ** 2))[:, :] + 0.55 * np.exp(-(((ys - 360) / 60.0) ** 2))
    dens = cn * 1.3 * (0.35 + 0.65 * band) - 0.30
    cloud = dens > 0.28
    # banded shading by density + vertical position (lit from moon at the upper right of each puff)
    up = np.roll(dens, 3, 0)
    lit = cloud & ((dens - up) < -0.010)
    dark = cloud & (dens > 0.55)
    cols = np.zeros((H, W, 3), np.float32)
    cols[cloud] = rgb("#3a2a6a")
    cols[cloud & (dens > 0.38)] = rgb("#2a1f56")
    cols[dark] = rgb("#1c1442")
    cols[lit] = rgb("#7a68c0")
    layer[..., :3] = cols
    layer[..., 3] = cloud.astype(np.float32)
    # moon-lit edges brighten near the moon
    dm = np.sqrt((np.arange(W)[None, :] - 612) ** 2 + (ys - 238) ** 2)
    lit2 = lit & (dm < 260)
    layer[lit2, :3] = rgb("#b0a4f0")
    L1 = to_img(layer)

    # ---- L2: far mountains + castle
    layer = empty()
    mc, ma = mountains(rng, 440, 170, [(2, 1.0), (5, 0.45), (11, 0.2)],
                       [(0, "#3a2268"), (6, "#2c1a58"), (40, "#201446")])
    layer[..., :3] = mc
    layer[..., 3] = ma
    # haze / snow-lit ridge line
    top = np.argmax(ma > 0, axis=0)
    for x in range(W):
        if top[x] > 0:
            layer[top[x], x, :3] = rgb("#7a66c4")
            layer[top[x] + 1, x, :3] = rgb("#5a4aa0")
    pal2 = {MAT["far"]: R("#241552", "#4a3a88"), MAT["far2"]: R("#2c1a5e", "#5a4a9a"),
            MAT["roof"]: R("#1a1040", "#3c2c7a"), MAT["iron"]: R("#1a1a3a", "#3a3a6a"),
            MAT["cloth"]: R("#4a1040", "#9a3a78"), MAT["glow"]: ["#c0883a", "#e0a850", "#f6c870", "#ffe4a0", "#fff4cc"],
            MAT["mortar"]: R("#160d36", "#160d36")}
    gb, im = load_layer("ramparts", "2", pal2, key=(0.35, -0.5, 0.75), th=(0.35, 0.6, 0.8, 0.95),
                        rim=((0.6, -0.2, 0.5), 0.6, {MAT["far"]: "#7a6ad0", MAT["far2"]: "#7a6ad0",
                                                    MAT["roof"]: "#6a5ac0"}))
    m = gb["A"]
    rgbc = im[..., :3].astype(np.float32)
    wall = m & ((gb["mat"] == MAT["far"]) | (gb["mat"] == MAT["far2"]))
    rgbc = brickify(rgbc, wall, rng, ch=9, cw=(14, 24), line=0.38, var=0.07, seed=3)
    layer[m, :3] = rgbc[m]
    layer[m, 3] = 1
    # fog at the foot of the castle
    fogm = fnoise(H, W, rng, 2.4, sx=4.0) ** 1.3
    fa = np.clip((ys - 400) / 112.0, 0, 1) ** 1.1 * (0.4 + 0.6 * fogm)
    layer = over(layer, np.broadcast_to(rgb("#6a3a8a"), (H, W, 3)), posterize(fa, 4) * 0.7)
    L2 = to_img(layer)

    # ---- L3: near battlements (moonlit stone)
    pal3 = {MAT["stone"]: R("#120f26", "#4c4888"), MAT["stone2"]: R("#161230", "#56529a"),
            MAT["roof"]: R("#0e0a22", "#34306a"), MAT["cloth"]: R("#2a0a2c", "#a03a7a"),
            MAT["gold"]: R("#3a2a10", "#e0b040"), MAT["glow"]: ["#c0883a", "#e0a850", "#f6c870", "#ffe4a0", "#fff4cc"],
            MAT["iron"]: R("#0a0a16", "#34345a"), MAT["mortar"]: R("#0a0818", "#0a0818")}
    gb, im = load_layer("ramparts", "3", pal3, key=(0.35, -0.5, 0.8), th=(0.33, 0.58, 0.8, 0.95),
                        rim=((0.5, -0.2, 1.0), 0.86, {MAT["stone"]: "#b8b4ff", MAT["stone2"]: "#b8b4ff",
                                                     MAT["roof"]: "#8a84e0"}))
    layer = empty()
    m = gb["A"]
    wall = m & ((gb["mat"] == MAT["stone"]) | (gb["mat"] == MAT["stone2"]))
    rgbc = brickify(im[..., :3].astype(np.float32), wall, rng, ch=13, cw=(22, 40), line=0.5, var=0.09, seed=5)
    layer[m, :3] = rgbc[m]
    layer[m, 3] = 1
    L3 = to_img(layer)

    write_layers("ramparts", [L0, L1, L2, L3], "#120e2a",
                 [(0.01, 0.02), (0.05, 0.06), (0.16, 0.14), (0.42, 0.28)])


# ======================================================================================
# TOWER


def build_tower():
    rng = np.random.default_rng(303)
    ys = np.arange(H)[:, None]
    emb = ["#ff5a1a", "#ff7a20", "#ffa030", "#ffd060", "#fff0a0"]

    def glow_up(layer, strength=0.8, start=0.45, color="#ff6a1c", power=1.8):
        t = np.clip((ys - H * start) / (H * (1 - start)), 0, 1) ** power
        t = np.broadcast_to(t, (H, W)) * (0.7 + 0.5 * fnoise(H, W, rng, 2.4, sx=3.0))
        return over(layer, np.broadcast_to(rgb(color), (H, W, 3)), posterize(np.clip(t, 0, 1), 7) * strength)

    # ---- L0: far hollow tower (opaque)
    pal0 = {MAT["far"]: R("#0c0506", "#2a100d"), MAT["far2"]: R("#120708", "#3a1810"),
            MAT["mortar"]: R("#080304", "#080304"), MAT["void"]: R("#a02c0a", "#ff9a30"),
            MAT["trim"]: R("#120708", "#3a1810")}
    gb, im = load_layer("tower", "0", pal0, key=(0.05, -0.4, -0.85), th=(0.3, 0.55, 0.78, 0.94),
                        rim=((0.0, -0.1, -1.0), 0.5, {MAT["far2"]: "#a8381a", MAT["far"]: "#8a2a14"}))
    base = vgrad([(0, "#030102"), (0.4, "#0e0506"), (0.7, "#26090a"), (0.9, "#6a1a0a"), (1, "#a8380e")])
    layer = np.concatenate([base, np.ones((H, W, 1), np.float32)], -1)
    m = gb["A"]
    layer[m, :3] = im[m, :3]
    # louvre slits glow like furnace vents
    vo = m & (gb["mat"] == MAT["void"])
    vg = vgrad([(0.2, "#701c08"), (0.6, "#c8501a"), (1, "#ffa040")])
    layer[vo, :3] = vg[vo]
    layer = glow_up(layer, 0.75, 0.40)
    L0 = to_img(layer)

    # ---- L1: trusses + bells
    pal1 = {MAT["wood"]: R("#0a0605", "#3a2014"), MAT["iron"]: R("#06070a", "#303844"),
            MAT["bronze"]: R("#1a0c05", "#9a5a1c"), MAT["gold"]: R("#2a1808", "#d09030"),
            MAT["stone"]: R("#0a0505", "#2e1410"), MAT["mortar"]: R("#050202", "#050202")}
    gb, im = load_layer("tower", "1", pal1, key=(0.1, -0.4, -0.85), th=(0.3, 0.55, 0.78, 0.94),
                        rim=((0.0, -0.1, -1.0), 0.45, {MAT["bronze"]: "#ff8a2a", MAT["wood"]: "#c0501c",
                                                      MAT["iron"]: "#a04a28", MAT["stone"]: "#8a3018"}))
    layer = empty()
    m = gb["A"]
    layer[m, :3] = im[m, :3]
    layer[m, 3] = 1
    layer = glow_up(layer, 0.55, 0.55)
    ec, ea = embers(rng, 90, emb, 0.2)
    layer = over(layer, ec, ea * 0.9)
    layer[..., :3] *= 0.86
    L1 = to_img(layer)

    # ---- L2: big bells + gears
    pal2 = {MAT["wood"]: R("#080403", "#2e1a10"), MAT["iron"]: R("#050609", "#262d38"),
            MAT["bronze"]: R("#1a0a04", "#a8601c"), MAT["gold"]: R("#2a1808", "#e0a030"),
            MAT["mortar"]: R("#050202", "#050202")}
    gb, im = load_layer("tower", "2", pal2, key=(0.1, -0.4, -0.85), th=(0.3, 0.55, 0.78, 0.94),
                        rim=((0.0, -0.1, -1.0), 0.4, {MAT["bronze"]: "#ffa040", MAT["wood"]: "#d0601c",
                                                     MAT["iron"]: "#b05a2c"}))
    layer = empty()
    m = gb["A"]
    layer[m, :3] = im[m, :3]
    layer[m, 3] = 1
    layer = glow_up(layer, 0.5, 0.65)
    ec, ea = embers(rng, 70, emb, 0.35)
    layer = over(layer, ec, ea)
    layer[..., :3] *= 0.9
    L2 = to_img(layer)

    # ---- L3: near silhouettes
    pal3 = {MAT["wood"]: R("#030201", "#140a06"), MAT["iron"]: R("#020203", "#101216")}
    gb, im = load_layer("tower", "3", pal3, key=(0.0, -0.4, -0.85), th=(0.3, 0.55, 0.78, 0.94),
                        rim=((0.0, -0.2, -1.0), 0.35, {MAT["wood"]: "#e0701c", MAT["iron"]: "#c85a20"}))
    layer = empty()
    m = gb["A"]
    layer[m, :3] = im[m, :3]
    layer[m, 3] = 1
    ec, ea = embers(rng, 60, emb, 0.3)
    layer = over(layer, ec, ea)
    L3 = to_img(layer)

    write_layers("tower", [L0, L1, L2, L3], "#100607",
                 [(0.04, 0.05), (0.16, 0.10), (0.38, 0.18), (0.66, 0.28)])


BUILD = {"prison": build_prison, "ramparts": build_ramparts, "tower": build_tower}


def main(biomes):
    for b in biomes:
        BUILD[b]()
        print("post_bg: %s done" % b)


if __name__ == "__main__":
    main(sys.argv[1:] or list(BUILD))
