import { TILE } from '../engine/config';
import type { AABB } from '../engine/math';

/** Tile ids (docs/DESIGN.md §6 legend). */
export const T = {
  Empty: 0,
  Solid: 1,
  Platform: 2, // one-way, jump-through
  Spikes: 3, // hazard, not solid
  Breakable: 4, // solid until broken by a player attack
} as const;
export type TileId = (typeof T)[keyof typeof T];

/** Background layer per cell. */
export const BG = {
  Sky: 0, // open: far parallax visible  (template ',')
  Wall: 1, // interior back wall           (template '.', and behind solids)
} as const;

export class TileMap {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly bg: Uint8Array;
  /** minimap fog of war: 1 = explored */
  readonly explored: Uint8Array;
  /** bumped whenever tiles change, so renderers can rebuild caches */
  version = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.bg = new Uint8Array(w * h).fill(BG.Wall);
    this.explored = new Uint8Array(w * h);
  }

  get pxW(): number {
    return this.w * TILE;
  }
  get pxH(): number {
    return this.h * TILE;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  /** Out of bounds counts as solid so nothing escapes the level. */
  get(tx: number, ty: number): TileId {
    if (!this.inBounds(tx, ty)) return T.Solid;
    return this.tiles[ty * this.w + tx] as TileId;
  }

  set(tx: number, ty: number, t: TileId): void {
    if (this.inBounds(tx, ty)) {
      this.tiles[ty * this.w + tx] = t;
      this.version++;
    }
  }

  getBg(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return BG.Wall;
    return this.bg[ty * this.w + tx];
  }

  isSolid(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return t === T.Solid || t === T.Breakable;
  }

  isPlatform(tx: number, ty: number): boolean {
    return this.get(tx, ty) === T.Platform;
  }

  solidAt(px: number, py: number): boolean {
    return this.isSolid(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** Any tile of type `t` overlapping the box? */
  boxHas(box: AABB, t: TileId): boolean {
    const x0 = Math.floor(box.x / TILE);
    const x1 = Math.floor((box.x + box.w - 0.001) / TILE);
    const y0 = Math.floor(box.y / TILE);
    const y1 = Math.floor((box.y + box.h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.get(tx, ty) === t) return true;
    return false;
  }

  boxSolid(box: AABB): boolean {
    const x0 = Math.floor(box.x / TILE);
    const x1 = Math.floor((box.x + box.w - 0.001) / TILE);
    const y0 = Math.floor(box.y / TILE);
    const y1 = Math.floor((box.y + box.h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.isSolid(tx, ty)) return true;
    return false;
  }

  /** Line of sight between two points (solid tiles block). */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / (TILE / 3));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  /** Y (px) of the first floor (solid or platform top) at or below py in column px, or null. */
  floorBelow(px: number, py: number, maxDist = 2000): number | null {
    const tx = Math.floor(px / TILE);
    for (let ty = Math.floor(py / TILE); ty * TILE < py + maxDist && ty < this.h; ty++) {
      const t = this.get(tx, ty);
      if (t === T.Solid || t === T.Breakable || t === T.Platform) return ty * TILE;
    }
    return null;
  }

  reveal(px: number, py: number, radiusTiles: number): void {
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    const r2 = radiusTiles * radiusTiles;
    for (let y = cy - radiusTiles; y <= cy + radiusTiles; y++) {
      if (y < 0 || y >= this.h) continue;
      for (let x = cx - radiusTiles; x <= cx + radiusTiles; x++) {
        if (x < 0 || x >= this.w) continue;
        const dx = x - cx;
        const dy = (y - cy) * 1.4;
        if (dx * dx + dy * dy <= r2) this.explored[y * this.w + x] = 1;
      }
    }
  }
}
