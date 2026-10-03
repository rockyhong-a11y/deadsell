"""(work in progress)"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ENV = os.path.join(ROOT, "build", "env")

MAT = {
    "stone": 1, "stone2": 2, "mortar": 3, "back": 4, "back2": 5, "backmortar": 6,
    "lip": 7, "wood": 8, "iron": 9, "moss": 10, "cloth": 11, "glow": 12, "brick": 13,
    "rubble": 14, "bronze": 15, "rope": 16, "void": 17, "trim": 18, "gold": 19,
    "far": 20, "far2": 21, "roof": 22, "leaf": 23, "bone": 24, "crack": 25,
}


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
        # keep only one pixel of some pits for irregularity
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


if __name__ == "__main__":
    pass
