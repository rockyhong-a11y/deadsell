import type { Camera } from '../../engine/camera';
import { CHUNK_H, CHUNK_W, TILE } from '../../engine/config';
import type { BgDef } from '../../engine/assets';
import type { World } from '../world';

/**
 * LevelRenderer: sky + parallax + back walls (drawBack, screen space), terrain (drawTiles,
 * world space) and an optional foreground (drawFront, world space).
 *
 * The autotile / decoration / parallax contract is docs/TILES.md; `Autotiler` below is a literal
 * port of the reference implementation in tools/pack/post_tiles.py (tests/render.test.ts checks
 * both against tests/render_golden.json).  Static terrain and back wall are pre-rendered into
 * cached canvases per 32 x 18 tile chunk, rebuilt only when the tiles around a chunk change.
 */

// ---------------------------------------------------------------------------------------------
// data types (public/assets/tiles/<biome>.json)

/** [sx, sy, sw, sh, ox, oy]: source rect in the atlas image + draw offset from the cell origin. */
export type Region = [number, number, number, number, number, number];

export interface TileAtlas {
  biome: string;
  tile: number;
  pad: number;
  fill: Region[];
  fillMid: Region[];
  fillDeep: Region[];
  top: Region[];
  topMoss: Region[];
  topDeco: Region[];
  drip: Region[];
  bottom: Region[];
  left: Region[];
  right: Region[];
  outer: Record<'tl' | 'tr' | 'bl' | 'br', Region>;
  inner: Record<'tl' | 'tr' | 'bl' | 'br', Region>;
  platform: { l: Region; m: Region[]; r: Region; single: Region };
  spikes: { up: Region[]; down: Region; left: Region; right: Region };
  breakable: Region[];
  backwall: Region[];
  backCrack: Region[];
  backdeco: {
    arch: Region; window: Region; chain: Region; special: Region; niche: Region; special2: Region; slit: Region;
    pillar: { bot: Region; mid: Region; top: Region };
    size: Record<string, [number, number]>;
    chance: Record<string, number>;
    pillar_chance: number;
    /** masks (alpha > 0 = hole) erased from the back wall before the piece is drawn: see-through openings */
    holes?: Record<string, Region>;
  };
  cfg: {
    moss_chance: number; deco_chance: number; drip_chance: number; crack_chance: number;
    shadow_a: number; shadow_w: [number, number, number];
  };
  colors: { sky: string; solid: string; lip: string; back: string; deep: string; shadow: string; glow: string };
  image: string;
}

export type Pass = 'back' | 'hole' | 'fill' | 'edge' | 'detail' | 'prop';
export interface Op { pass: Pass; r: Region; px: number; py: number }
export interface DecorItem { name: string; x: number; y: number; w: number; h: number }
export interface Strip { x: number; y: number; w: number; h: number; side: 't' | 'l' | 'r' | 'b' }

/** Anything shaped like TileMap. */
export interface MapLike { w: number; h: number; tiles: Uint8Array; bg: Uint8Array }

// ---------------------------------------------------------------------------------------------
// variant hash (docs/TILES.md "Variant hashing")

export function hash01(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pick<R>(list: R[], r: number): R {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

// ---------------------------------------------------------------------------------------------
// the autotiler (pure, no DOM)

export class Autotiler {
  private plan: DecorItem[] | null = null;

  constructor(readonly m: MapLike, readonly atlas: TileAtlas) {}

  tile(x: number, y: number): number {
    const m = this.m;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 1;
    return m.tiles[y * m.w + x];
  }

  /** Solid-like = Solid or Breakable. Out of bounds counts as solid. */
  solid(x: number, y: number): boolean {
    const t = this.tile(x, y);
    return t === 1 || t === 4;
  }

  private isWall(x: number, y: number): boolean {
    return this.m.bg[y * this.m.w + x] === 1;
  }

  /** 1..3: Chebyshev distance to the nearest non-solid cell (capped at 3). */
  depthTier(x: number, y: number): number {
    for (let r = 1; r <= 2; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (!this.solid(x + dx, y + dy)) return r;
    return 3;
  }

  /** Back-wall decoration plan for the whole map (computed once, deterministic). */
  decor(): DecorItem[] {
    if (this.plan) return this.plan;
    const { m, atlas } = this;
    const deco = atlas.backdeco;
    const occ = new Uint8Array(m.w * m.h);
    const free = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < m.w && y < m.h && this.tile(x, y) === 0 && this.isWall(x, y) && !occ[y * m.w + x];
    const freeRect = (x: number, y: number, w: number, h: number): boolean => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!free(x + i, y + j)) return false;
      return true;
    };
    const mark = (x: number, y: number, w: number, h: number): void => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) occ[(y + j) * m.w + x + i] = 1;
    };
    const plan: DecorItem[] = [];
    // pass 1: pillars (2 wide, floor to ceiling, 3..14 tall)
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w - 1; x++) {
        if (!(this.solid(x, y - 1) && this.solid(x + 1, y - 1))) continue;
        if (!(free(x, y) && free(x + 1, y))) continue;
        let L = 0;
        while (free(x, y + L) && free(x + 1, y + L)) L++;
        if (!(L >= 3 && L <= 14 && this.solid(x, y + L) && this.solid(x + 1, y + L))) continue;
        if (hash01(x, y, 12) < deco.pillar_chance) {
          plan.push({ name: 'pillar_top', x, y, w: 2, h: 1 });
          for (let k = 1; k < L - 1; k++) plan.push({ name: 'pillar_mid', x, y: y + k, w: 2, h: 1 });
          plan.push({ name: 'pillar_bot', x, y: y + L - 1, w: 2, h: 1 });
          mark(x, y, 2, L);
        }
      }
    // pass 2: floor-anchored pieces (bottom-left at (x, y), cell below is solid)
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        if (!(free(x, y) && this.solid(x, y + 1))) continue;
        const r = hash01(x, y, 13);
        let acc = 0;
        for (const name of ['arch', 'special']) {
          const p = deco.chance[name];
          const [w, h] = deco.size[name];
          if (acc <= r && r < acc + p && freeRect(x, y - h + 1, w, h)) {
            plan.push({ name, x, y: y - h + 1, w, h });
            mark(x, y - h + 1, w, h);
            break;
          }
          acc += p;
        }
      }
    // pass 3: wall pieces (top-left at (x, y)); chains hang from a solid ceiling
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        if (!free(x, y)) continue;
        const r = hash01(x, y, 14);
        let acc = 0;
        for (const name of ['window', 'slit', 'niche', 'special2', 'chain']) {
          const p = deco.chance[name];
          const [w, h] = deco.size[name];
          if (acc <= r && r < acc + p) {
            let ok = freeRect(x, y, w, h);
            if (name === 'chain') ok = ok && this.solid(x, y - 1);
            if (ok) {
              plan.push({ name, x, y, w, h });
              mark(x, y, w, h);
            }
            break;
          }
          acc += p;
        }
      }
    this.plan = plan;
    return plan;
  }

  private decorRegion(name: string): Region {
    const d = this.atlas.backdeco;
    if (name.startsWith('pillar_')) return d.pillar[name.slice(7) as 'bot' | 'mid' | 'top'];
    return (d as unknown as Record<string, Region>)[name];
  }

  /** Back wall, cracks and decoration for the cell rect [x0, x1) x [y0, y1). */
  backOps(x0: number, y0: number, x1: number, y1: number): Op[] {
    const { m, atlas } = this;
    const ops: Op[] = [];
    const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(m.w, x1), cy1 = Math.min(m.h, y1);
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        if (m.bg[y * m.w + x] === 1 && !this.solid(x, y)) {
          ops.push({ pass: 'back', r: atlas.backwall[(y & 3) * 8 + (x & 7)], px: x * TILE, py: y * TILE });
          if (hash01(x, y, 11) < atlas.cfg.crack_chance)
            ops.push({ pass: 'back', r: pick(atlas.backCrack, hash01(x, y, 15)), px: x * TILE, py: y * TILE });
        }
      }
    const items = this.decor().filter((it) => !(it.x + it.w <= x0 || it.x >= x1 || it.y + it.h <= y0 || it.y >= y1));
    const holes = atlas.backdeco.holes;
    if (holes)
      for (const it of items) {
        const hr = holes[it.name];
        if (hr) ops.push({ pass: 'hole', r: hr, px: it.x * TILE, py: it.y * TILE });
      }
    for (const it of items) ops.push({ pass: 'back', r: this.decorRegion(it.name), px: it.x * TILE, py: it.y * TILE });
    return ops;
  }

  /** Ambient shadow strips cast by solid tiles onto the back wall. */
  shadowStrips(x0: number, y0: number, x1: number, y1: number): Strip[] {
    const { m, atlas } = this;
    const out: Strip[] = [];
    const G = atlas.cfg.shadow_w;
    const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(m.w, x1), cy1 = Math.min(m.h, y1);
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        if (m.bg[y * m.w + x] !== 1 || this.solid(x, y)) continue;
        if (this.solid(x, y - 1)) out.push({ x: x * TILE, y: y * TILE, w: TILE, h: G[0], side: 't' });
        if (this.solid(x - 1, y)) out.push({ x: x * TILE, y: y * TILE, w: G[1], h: TILE, side: 'l' });
        if (this.solid(x + 1, y)) out.push({ x: x * TILE + TILE - G[1], y: y * TILE, w: G[1], h: TILE, side: 'r' });
        if (this.solid(x, y + 1)) out.push({ x: x * TILE, y: y * TILE + TILE - G[2], w: TILE, h: G[2], side: 'b' });
      }
    return out;
  }

  /** Terrain draw lists (fill, edge, detail, prop; each in raster order) for cell rect [x0,x1) x [y0,y1). */
  terrainOps(x0: number, y0: number, x1: number, y1: number): Record<'fill' | 'edge' | 'detail' | 'prop', Op[]> {
    const { m, atlas } = this;
    const cfg = atlas.cfg;
    const res = { fill: [] as Op[], edge: [] as Op[], detail: [] as Op[], prop: [] as Op[] };
    const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(m.w, x1), cy1 = Math.min(m.h, y1);
    // fills
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        const t = m.tiles[y * m.w + x];
        if (t === 1) {
          const d = this.depthTier(x, y);
          const tier = d === 1 ? atlas.fill : d === 2 ? atlas.fillMid : atlas.fillDeep;
          res.fill.push({ pass: 'fill', r: tier[(y & 3) * 8 + (x & 7)], px: x * TILE, py: y * TILE });
        } else if (t === 4) {
          res.fill.push({ pass: 'fill', r: pick(atlas.breakable, hash01(x, y, 31)), px: x * TILE, py: y * TILE });
        }
      }
    // edges
    const e = res.edge;
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        if (m.tiles[y * m.w + x] !== 1) continue;
        const px = x * TILE, py = y * TILE;
        const N = !this.solid(x, y - 1), S = !this.solid(x, y + 1);
        const W = !this.solid(x - 1, y), E = !this.solid(x + 1, y);
        if (S) e.push({ pass: 'edge', r: pick(atlas.bottom, hash01(x, y, 2)), px, py });
        if (W) e.push({ pass: 'edge', r: pick(atlas.left, hash01(x, y, 3)), px, py });
        if (E) e.push({ pass: 'edge', r: pick(atlas.right, hash01(x, y, 4)), px, py });
        if (N) {
          if (hash01(x >> 1, y, 5) < cfg.moss_chance) e.push({ pass: 'edge', r: pick(atlas.topMoss, hash01(x, y, 6)), px, py });
          else e.push({ pass: 'edge', r: pick(atlas.top, hash01(x, y, 7)), px, py });
        }
        const o = atlas.outer;
        if (N && W) e.push({ pass: 'edge', r: o.tl, px, py });
        if (N && E) e.push({ pass: 'edge', r: o.tr, px, py });
        if (S && W) e.push({ pass: 'edge', r: o.bl, px, py });
        if (S && E) e.push({ pass: 'edge', r: o.br, px, py });
        const i = atlas.inner;
        if (!N && !W && !this.solid(x - 1, y - 1)) e.push({ pass: 'edge', r: i.tl, px, py });
        if (!N && !E && !this.solid(x + 1, y - 1)) e.push({ pass: 'edge', r: i.tr, px, py });
        if (!S && !W && !this.solid(x - 1, y + 1)) e.push({ pass: 'edge', r: i.bl, px, py });
        if (!S && !E && !this.solid(x + 1, y + 1)) e.push({ pass: 'edge', r: i.br, px, py });
      }
    // details on top of the lips / under the ceilings
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        if (m.tiles[y * m.w + x] !== 1) continue;
        const px = x * TILE, py = y * TILE;
        if (!this.solid(x, y - 1) && hash01(x, y, 8) < cfg.deco_chance)
          res.detail.push({ pass: 'detail', r: pick(atlas.topDeco, hash01(x, y, 9)), px, py });
        if (!this.solid(x, y + 1) && hash01(x, y, 10) < cfg.drip_chance)
          res.detail.push({ pass: 'detail', r: pick(atlas.drip, hash01(x, y, 16)), px, py });
      }
    // props: platforms + spikes
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        const t = m.tiles[y * m.w + x];
        const px = x * TILE, py = y * TILE;
        if (t === 2) {
          const lc = this.tile(x - 1, y) === 2 || this.solid(x - 1, y);
          const rc = this.tile(x + 1, y) === 2 || this.solid(x + 1, y);
          const pl = atlas.platform;
          const r = !lc && !rc ? pl.single : !lc ? pl.l : !rc ? pl.r : pick(pl.m, hash01(x, y, 17));
          res.prop.push({ pass: 'prop', r, px, py });
        } else if (t === 3) {
          const sp = atlas.spikes;
          let r: Region;
          if (this.solid(x, y + 1)) r = pick(sp.up, hash01(x, y, 18));
          else if (this.solid(x, y - 1)) r = sp.down;
          else if (this.solid(x - 1, y)) r = sp.right;
          else if (this.solid(x + 1, y)) r = sp.left;
          else r = pick(sp.up, hash01(x, y, 18));
          res.prop.push({ pass: 'prop', r, px, py });
        }
      }
    return res;
  }

  /** The complete draw list for the whole map, in the order of the reference implementation. */
  all(): Op[] {
    const m = this.m;
    const t = this.terrainOps(0, 0, m.w, m.h);
    return [...this.backOps(0, 0, m.w, m.h), ...t.fill, ...t.edge, ...t.detail, ...t.prop];
  }
}

// ---------------------------------------------------------------------------------------------
// parallax placement (docs/TILES.md "Parallax"); pure so it can be tested

export interface LayerPlacement { x0: number; y: number; step: number }

/**
 * Where to draw a parallax layer of size (iw, ih): copies at x0, x0 + step, ... < viewW; top edge y.
 * Layers are anchored to the BOTTOM of the screen when the camera is at the lowest point of the level
 * and slide down (towards their top) as the camera climbs, at `vpar` x the camera movement.
 */
export function layerPlacement(
  parallax: number, vpar: number, yOff: number, iw: number, ih: number,
  viewX: number, viewY: number, viewH: number, boundsH: number,
): LayerPlacement {
  const maxY = Math.max(0, boundsH - viewH);
  const slide = Math.min(Math.max(0, ih - viewH), Math.max(0, (maxY - viewY) * vpar));
  const y = Math.round(viewH - ih + slide + yOff);
  const sx = Math.floor(viewX * parallax);
  const x0 = 0 - (((sx % iw) + iw) % iw);
  return { x0, y, step: iw };
}

// ---------------------------------------------------------------------------------------------
// the renderer

const FLAT: Record<string, { sky: string; solid: string; lip: string; back: string }> = {
  prison: { sky: '#050a10', solid: '#1d323a', lip: '#58a39e', back: '#0d161d' },
  ramparts: { sky: '#120e2a', solid: '#57547a', lip: '#b9b6e0', back: '#171430' },
  tower: { sky: '#100607', solid: '#361612', lip: '#d86a28', back: '#0b0506' },
};

interface Chunk { cv: HTMLCanvasElement; sig: number; version: number; used: number; flat: boolean }

const MAX_CACHED = 20; // chunks per canvas kind

export class LevelRenderer {
  private world: World;
  private biome: string;
  private atlas: TileAtlas | null = null;
  private img: HTMLImageElement | undefined;
  private tiler: Autotiler | null = null;
  private back = new Map<number, Chunk>();
  private terrain = new Map<number, Chunk>();
  private shadowCv: Record<'t' | 'l' | 'r' | 'b', HTMLCanvasElement> | null = null;
  private frame = 0;
  private cx = 0;
  private cy = 0;

  constructor(world: World) {
    this.world = world;
    this.biome = world.level.biome;
    this.cx = Math.ceil(world.map.w / CHUNK_W);
    this.cy = Math.ceil(world.map.h / CHUNK_H);
  }

  // ---- lazy asset binding (assets may finish loading after construction) ---------------------
  private bind(): void {
    if (this.atlas) return;
    const a = this.world.assets;
    const json = a.json.get(`tiles/${this.biome}.json`) as TileAtlas | undefined;
    const img = a.image(`tiles/${this.biome}.png`);
    if (json && img && json.fill && json.backwall) {
      this.atlas = json;
      this.img = img;
      this.tiler = new Autotiler(this.world.map, json);
    }
  }

  private flat() {
    return FLAT[this.biome] ?? FLAT.prison;
  }

  // ---- public API ------------------------------------------------------------------------------

  /** Screen space: sky colour, parallax layers, back walls. */
  drawBack(ctx: CanvasRenderingContext2D, cam: Camera): void {
    this.frame++;
    this.bind();
    const flat = this.flat();
    const def = this.world.assets.json.get(`bg/${this.biome}.json`) as BgDef | undefined;
    ctx.fillStyle = def?.sky ?? this.atlas?.colors.sky ?? flat.sky;
    ctx.fillRect(0, 0, cam.w, cam.h);
    const vx = cam.viewX, vy = cam.viewY;
    if (def) {
      for (const l of def.layers) {
        const im = l.img;
        if (!im || !im.width) continue;
        const vpar = (l as { vpar?: number }).vpar ?? l.parallax * 0.5;
        const p = layerPlacement(l.parallax, vpar, l.y ?? 0, im.width, im.height, vx, vy, cam.h, this.world.map.pxH);
        if (l.repeatX === false) {
          ctx.drawImage(im, -Math.floor(vx * l.parallax), p.y);
        } else {
          for (let x = p.x0; x < cam.w; x += p.step) ctx.drawImage(im, x, p.y);
        }
      }
    }
    // back walls (pre-rendered chunks)
    const [c0x, c1x, c0y, c1y] = this.visibleChunks(vx, vy, cam.w, cam.h);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const ch = this.getBack(cx, cy);
        ctx.drawImage(ch.cv, cx * CHUNK_W * TILE - vx, cy * CHUNK_H * TILE - vy);
      }
    this.evict(this.back);
  }

  /** World space (ctx already translated by -cam.viewX, -cam.viewY): terrain. */
  drawTiles(ctx: CanvasRenderingContext2D, cam: Camera): void {
    this.bind();
    const vx = cam.viewX, vy = cam.viewY;
    const [c0x, c1x, c0y, c1y] = this.visibleChunks(vx, vy, cam.w, cam.h);
    const pad = this.atlas?.pad ?? 12;
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const ch = this.getTerrain(cx, cy);
        ctx.drawImage(ch.cv, cx * CHUNK_W * TILE - pad, cy * CHUNK_H * TILE - pad);
      }
    this.prefetch(vx, vy, cam.w, cam.h);
    this.evict(this.terrain);
    this.evict(this.back);
  }

  /**
   * World space, after entities. Intentionally empty: darkness, vignette and coloured light are the job of
   * `world.lights` (src/game/fx/lighting.ts), which multiplies the scene after this call.
   */
  drawFront(_ctx: CanvasRenderingContext2D, _cam: Camera): void {}

  // ---- chunks ----------------------------------------------------------------------------------

  private visibleChunks(vx: number, vy: number, w: number, h: number): [number, number, number, number] {
    const cw = CHUNK_W * TILE, ch = CHUNK_H * TILE;
    const x0 = Math.max(0, Math.floor((vx - 12) / cw)), x1 = Math.min(this.cx - 1, Math.floor((vx + w + 12) / cw));
    const y0 = Math.max(0, Math.floor((vy - 12) / ch)), y1 = Math.min(this.cy - 1, Math.floor((vy + h + 12) / ch));
    return [x0, x1, y0, y1];
  }

  /** Checksum of the tiles (+bg) a chunk's pixels depend on (3 cells of margin). */
  private signature(cx: number, cy: number, withBg: boolean): number {
    const m = this.world.map;
    const x0 = Math.max(0, cx * CHUNK_W - 3), x1 = Math.min(m.w, cx * CHUNK_W + CHUNK_W + 3);
    const y0 = Math.max(0, cy * CHUNK_H - 3), y1 = Math.min(m.h, cy * CHUNK_H + CHUNK_H + 3);
    let h = 2166136261;
    for (let y = y0; y < y1; y++) {
      const row = y * m.w;
      for (let x = x0; x < x1; x++) {
        h = Math.imul(h ^ m.tiles[row + x], 16777619);
        if (withBg) h = Math.imul(h ^ (m.bg[row + x] + 7), 16777619);
      }
    }
    return h >>> 0;
  }

  private isFresh(store: Map<number, Chunk>, cx: number, cy: number, withBg: boolean): boolean {
    const ch = store.get(cy * 4096 + cx);
    if (!ch || ch.flat !== !this.tiler) return false;
    const m = this.world.map;
    if (ch.version === m.version) return true;
    if (this.signature(cx, cy, withBg) !== ch.sig) return false;
    ch.version = m.version;
    return true;
  }

  private getChunk(store: Map<number, Chunk>, cx: number, cy: number, withBg: boolean,
    build: (cv: HTMLCanvasElement, cx: number, cy: number) => void, size: [number, number]): Chunk {
    const key = cy * 4096 + cx;
    let ch = store.get(key);
    if (!ch || !this.isFresh(store, cx, cy, withBg)) {
      const cv = ch?.cv ?? document.createElement('canvas');
      cv.width = size[0];
      cv.height = size[1];
      build(cv, cx, cy);
      ch = { cv, sig: this.signature(cx, cy, withBg), version: this.world.map.version, used: this.frame, flat: !this.tiler };
      store.set(key, ch);
    }
    ch.used = this.frame;
    return ch;
  }

  /** Build at most one not-yet-visible chunk canvas just outside the view per frame (no hitches when scrolling). */
  private prefetch(vx: number, vy: number, w: number, h: number): void {
    const cw = CHUNK_W * TILE, chh = CHUNK_H * TILE, M = 260;
    const x0 = Math.max(0, Math.floor((vx - M) / cw)), x1 = Math.min(this.cx - 1, Math.floor((vx + w + M) / cw));
    const y0 = Math.max(0, Math.floor((vy - M) / chh)), y1 = Math.min(this.cy - 1, Math.floor((vy + h + M) / chh));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.isFresh(this.back, cx, cy, true)) { this.getBack(cx, cy); return; }
        if (!this.isFresh(this.terrain, cx, cy, false)) { this.getTerrain(cx, cy); return; }
      }
  }

  private getBack(cx: number, cy: number): Chunk {
    return this.getChunk(this.back, cx, cy, true, (cv, x, y) => this.buildBack(cv, x, y), [CHUNK_W * TILE, CHUNK_H * TILE]);
  }

  private getTerrain(cx: number, cy: number): Chunk {
    const pad = this.atlas?.pad ?? 12;
    return this.getChunk(this.terrain, cx, cy, false, (cv, x, y) => this.buildTerrain(cv, x, y),
      [CHUNK_W * TILE + 2 * pad, CHUNK_H * TILE + 2 * pad]);
  }

  private evict(store: Map<number, Chunk>): void {
    if (store.size <= MAX_CACHED) return;
    const list = [...store.entries()].sort((a, b) => a[1].used - b[1].used);
    while (store.size > MAX_CACHED && list.length) {
      const [k, c] = list.shift()!;
      if (c.used === this.frame) break; // visible this frame
      store.delete(k);
    }
  }

  // ---- chunk painters --------------------------------------------------------------------------

  private blit(c: CanvasRenderingContext2D, op: Op, ox: number, oy: number): void {
    const r = op.r;
    c.drawImage(this.img!, r[0], r[1], r[2], r[3], op.px + r[4] - ox, op.py + r[5] - oy, r[2], r[3]);
  }

  private shadowImages(): Record<'t' | 'l' | 'r' | 'b', HTMLCanvasElement> {
    if (this.shadowCv) return this.shadowCv;
    const a = this.atlas!;
    const col = hexToRgb(a.colors.shadow);
    const mk = (w: number, h: number, side: 't' | 'l' | 'r' | 'b'): HTMLCanvasElement => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const c = cv.getContext('2d')!;
      const id = c.createImageData(w, h);
      const n = side === 't' || side === 'b' ? h : w;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = side === 't' ? y : side === 'b' ? h - 1 - y : side === 'l' ? x : w - 1 - x;
          const al = Math.pow(1 - (i + 0.5) / n, 1.6) * a.cfg.shadow_a;
          const o = (y * w + x) * 4;
          id.data[o] = col[0]; id.data[o + 1] = col[1]; id.data[o + 2] = col[2];
          id.data[o + 3] = Math.max(0, Math.min(255, Math.floor(al * 255)));
        }
      c.putImageData(id, 0, 0);
      return cv;
    };
    const G = a.cfg.shadow_w;
    this.shadowCv = { t: mk(TILE, G[0], 't'), l: mk(G[1], TILE, 'l'), r: mk(G[1], TILE, 'r'), b: mk(TILE, G[2], 'b') };
    return this.shadowCv;
  }

  private buildBack(cv: HTMLCanvasElement, cx: number, cy: number): void {
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, cv.width, cv.height);
    const m = this.world.map;
    const x0 = cx * CHUNK_W, y0 = cy * CHUNK_H, x1 = x0 + CHUNK_W, y1 = y0 + CHUNK_H;
    const ox = x0 * TILE, oy = y0 * TILE;
    if (this.tiler && this.img) {
      for (const op of this.tiler.backOps(x0, y0, x1, y1)) {
        if (op.pass === 'hole') {
          c.globalCompositeOperation = 'destination-out';
          this.blit(c, op, ox, oy);
          c.globalCompositeOperation = 'source-over';
        } else this.blit(c, op, ox, oy);
      }
      const sh = this.shadowImages();
      for (const s of this.tiler.shadowStrips(x0, y0, x1, y1)) c.drawImage(sh[s.side], s.x - ox, s.y - oy);
      return;
    }
    c.fillStyle = this.flat().back;
    for (let y = y0; y < Math.min(y1, m.h); y++)
      for (let x = x0; x < Math.min(x1, m.w); x++)
        if (m.bg[y * m.w + x] === 1 && m.tiles[y * m.w + x] !== 1 && m.tiles[y * m.w + x] !== 4)
          c.fillRect(x * TILE - ox, y * TILE - oy, TILE, TILE);
  }

  private buildTerrain(cv: HTMLCanvasElement, cx: number, cy: number): void {
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, cv.width, cv.height);
    const pad = this.atlas?.pad ?? 12;
    const x0 = cx * CHUNK_W - 1, y0 = cy * CHUNK_H - 1, x1 = cx * CHUNK_W + CHUNK_W + 1, y1 = cy * CHUNK_H + CHUNK_H + 1;
    const ox = cx * CHUNK_W * TILE - pad, oy = cy * CHUNK_H * TILE - pad;
    if (this.tiler && this.img) {
      const t = this.tiler.terrainOps(x0, y0, x1, y1);
      for (const list of [t.fill, t.edge, t.detail, t.prop]) for (const op of list) this.blit(c, op, ox, oy);
      return;
    }
    this.flatTerrain(c, x0, y0, x1, y1, ox, oy);
  }

  /** Fallback when the tileset is missing: flat colours. */
  private flatTerrain(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, ox: number, oy: number): void {
    const m = this.world.map;
    const f = this.flat();
    const solid = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
      const t = m.tiles[y * m.w + x];
      return t === 1 || t === 4;
    };
    for (let y = Math.max(0, y0); y < Math.min(m.h, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(m.w, x1); x++) {
        const t = m.tiles[y * m.w + x];
        if (t === 0) continue;
        const px = x * TILE - ox, py = y * TILE - oy;
        if (t === 1 || t === 4) {
          c.fillStyle = t === 4 ? '#5a4a42' : f.solid;
          c.fillRect(px, py, TILE, TILE);
          if (!solid(x, y - 1)) {
            c.fillStyle = f.lip;
            c.fillRect(px, py, TILE, 4);
          }
        } else if (t === 2) {
          c.fillStyle = '#7a5a3a';
          c.fillRect(px, py, TILE, 5);
        } else if (t === 3) {
          c.fillStyle = '#b0b8c8';
          for (let i = 0; i < 4; i++) {
            c.beginPath();
            c.moveTo(px + i * 6, py + TILE);
            c.lineTo(px + i * 6 + 3, py + 10);
            c.lineTo(px + i * 6 + 6, py + TILE);
            c.fill();
          }
        }
      }
  }
}

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
