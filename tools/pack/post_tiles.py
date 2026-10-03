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


def shade(gb, pal, key=(-0.4, -0.75, 0.55), amb=0.15, th=(0.32, 0.6, 0.81, 0.97),
          rim=None, grit=0.06, seed=1, rid_var=0.12, outline_depth=0.02, wrap=False):
    """Toon-shade a G-buffer.  pal: {matid: [c0..c4]} dark->bright (hex or rgb).

    rim: optional (dir, threshold, {matid: colour}) secondary coloured light: pixels whose
         normal faces `dir` above threshold get that colour (Dead Cells style coloured rim).
    Returns RGBA uint8 array.
    """
    N, A, mat, rid, depth = gb["N"], gb["A"], gb["mat"], gb["rid"], gb["depth"]
    h, w = A.shape
    L = norm(key)
    I = amb + (1 - amb) * np.clip((N * L).sum(-1), 0, 1)
    # per-object brightness variation (stable by rid)
    rv = ((rid * 37 + 11) % 17) / 16.0 - 0.5
    I = I + rv * rid_var
    rng = np.random.default_rng(seed)
    if grit:
        I = I + (rng.random((h, w)) < grit) * rng.choice([-0.12, 0.1], size=(h, w))
    band = np.zeros((h, w), np.int32)
    for t in th:
        band += (I > t).astype(np.int32)
    # outline: darker pixel where a neighbour (rolled, periodic if wrap) is a different object
    # and further away -> creates separated stones; also cavity where deeper than neighbours
    def nb(a, dy, dx):
        if wrap:
            return np.roll(np.roll(a, dy, 0), dx, 1)
        p = np.pad(a, 1, mode="edge")
        return p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
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
