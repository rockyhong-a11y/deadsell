import { TILE } from '../../engine/config';
import type { World } from '../world';
import { isInteractable } from '../world';
import { T, BG } from '../tilemap';
import type { SpawnType } from '../level/types';
import { COL, panel, text, SZ } from './draw';

/** Kinds of points of interest drawn on the maps. */
export type MarkKind = 'exit' | 'shop' | 'altar' | 'chest' | 'alchemist';

export interface MapMark {
  kind: MarkKind;
  tx: number;
  ty: number;
}

const MARK_OF: Partial<Record<SpawnType, MarkKind>> = {
  exit: 'exit', merchant: 'shop', shop: 'shop', altar: 'altar', chest: 'chest', alchemist: 'alchemist',
};

export const MARK_STYLE: Record<MarkKind, { color: string; label: string }> = {
  exit: { color: '#ffffff', label: '출구' },
  shop: { color: '#ffd23f', label: '상점' },
  altar: { color: '#c58bff', label: '제단' },
  chest: { color: '#ff9a3c', label: '상자' },
  alchemist: { color: '#4fd8ff', label: '연금술사' },
};

const COLORS = {
  solid: [0x6e, 0x80, 0xa8],
  platform: [0x9f, 0xb4, 0xd9],
  spikes: [0xd0, 0x40, 0x50],
  wall: [0x26, 0x2d, 0x4a],
  sky: [0x16, 0x1b, 0x30],
};

/**
 * Minimap + full map renderer. The explored part of the level is rasterised into an
 * offscreen canvas at 1 px per tile (refreshed a few times per second) and then
 * scaled with nearest-neighbour by whoever draws it.
 */
export class MapView {
  private canvas: HTMLCanvasElement | null = null;
  private refreshT = 0;
  private marks: MapMark[] = [];
  private markT = 0;

  constructor(private world: World) {}

  /** POIs the player has discovered (explored tile) and that are still relevant. */
  get discovered(): MapMark[] {
    return this.marks;
  }

  update(dt: number): void {
    this.refreshT -= dt;
    this.markT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.25;
      this.rasterise();
    }
    if (this.markT <= 0) {
      this.markT = 0.4;
      this.collectMarks();
    }
  }

  /** force an immediate refresh (opening the full map) */
  refresh(): void {
    this.rasterise();
    this.collectMarks();
  }

  private collectMarks(): void {
    const w = this.world;
    const map = w.map;
    const out: MapMark[] = [];
    for (const s of w.level.spawns) {
      const kind = MARK_OF[s.type];
      if (!kind) continue;
      const tx = s.tx, ty = s.ty;
      if (!map.inBounds(tx, ty) || !map.explored[ty * map.w + tx]) continue;
      // opened chests / used altars stay in the spawn list: hide them once their prop says it is spent
      if (kind === 'chest' || kind === 'altar') {
        let spent = false;
        for (const e of w.entities) {
          if (e.dead || !isInteractable(e)) continue;
          if (Math.abs(e.x - s.x) < 10 && Math.abs(e.y - s.y) < 10 && !e.canInteract()) { spent = true; break; }
        }
        if (spent) continue;
      }
      out.push({ kind, tx, ty });
    }
    this.marks = out;
  }

  private rasterise(): void {
    if (typeof document === 'undefined') return;
    const map = this.world.map;
    if (!this.canvas || this.canvas.width !== map.w || this.canvas.height !== map.h) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = map.w;
      this.canvas.height = map.h;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(map.w, map.h);
    const d = img.data;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = y * map.w + x;
        if (!map.explored[i]) continue;
        const t = map.tiles[i];
        const col = t === T.Solid || t === T.Breakable ? COLORS.solid : t === T.Platform ? COLORS.platform : t === T.Spikes ? COLORS.spikes : map.bg[i] === BG.Sky ? COLORS.sky : COLORS.wall;
        const o = i * 4;
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Draw a map window (clipped to `box`) centred on tile (cx, cy) at `scale` px per tile. */
  private drawWindow(c: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, cxTile: number, cyTile: number, scale: number, markSize: number, pulseT: number): void {
    c.save();
    c.beginPath();
    c.rect(box.x, box.y, box.w, box.h);
    c.clip();
    const ox = Math.round(box.x + box.w / 2 - cxTile * scale);
    const oy = Math.round(box.y + box.h / 2 - cyTile * scale);
    if (this.canvas) {
      c.imageSmoothingEnabled = false;
      c.drawImage(this.canvas, ox, oy, this.world.map.w * scale, this.world.map.h * scale);
    }
    for (const m of this.marks) {
      const x = ox + (m.tx + 0.5) * scale;
      const y = oy + (m.ty + 0.5) * scale;
      const st = MARK_STYLE[m.kind];
      c.fillStyle = COL.ink;
      c.fillRect(Math.round(x - markSize / 2) - 1, Math.round(y - markSize / 2) - 1, markSize + 2, markSize + 2);
      c.fillStyle = st.color;
      c.fillRect(Math.round(x - markSize / 2), Math.round(y - markSize / 2), markSize, markSize);
    }
    const p = this.world.player;
    const px = ox + (p.x / TILE) * scale;
    const py = oy + ((p.y - 20) / TILE) * scale;
    const r = markSize / 2 + 1;
    c.fillStyle = COL.ink;
    c.fillRect(Math.round(px - r) - 1, Math.round(py - r) - 1, r * 2 + 2, r * 2 + 2);
    c.fillStyle = Math.sin(pulseT * 8) > -0.2 ? '#9fe8ff' : '#2a6f80';
    c.fillRect(Math.round(px - r), Math.round(py - r), r * 2, r * 2);
    c.restore();
  }

  /** Corner minimap: local window around the player at 2 px per tile. */
  drawMini(c: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, t: number): void {
    panel(c, box.x - 2, box.y - 2, box.w + 4, box.h + 4, { fill: '#07060b', alpha: 0.55, stroke: COL.line, r: 3 });
    const p = this.world.player;
    this.drawWindow(c, box, p.x / TILE, (p.y - 20) / TILE, 2, 4, t);
  }

  /** Scale used by the full map: as large as fits, at least 2 px per tile. */
  fullScale(viewW: number, viewH: number): number {
    const m = this.world.map;
    return Math.max(2, Math.min(6, Math.floor(Math.min(viewW / m.w, viewH / m.h))));
  }

  /** Full-map content size in virtual px. */
  fullSize(scale: number): { w: number; h: number } {
    return { w: this.world.map.w * scale, h: this.world.map.h * scale };
  }

  /** Draw the whole map (pan = offset of the map centre from the level centre, in tiles). */
  drawFull(c: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, scale: number, panX: number, panY: number, t: number): void {
    const m = this.world.map;
    this.drawWindow(c, box, m.w / 2 + panX, m.h / 2 + panY, scale, Math.max(5, scale + 1), t);
  }

  /** Legend row for the kinds that exist on this level. */
  drawLegend(c: CanvasRenderingContext2D, x: number, y: number): void {
    const kinds = [...new Set(this.marks.map((m) => m.kind))];
    let cx = x;
    for (const k of kinds) {
      const st = MARK_STYLE[k];
      c.fillStyle = COL.ink;
      c.fillRect(cx - 1, y - 4, 10, 10);
      c.fillStyle = st.color;
      c.fillRect(cx, y - 3, 8, 8);
      text(c, st.label, cx + 13, y, { size: SZ.s, color: COL.dim });
      cx += 13 + [...st.label].length * 11 + 14;
    }
    c.fillStyle = COL.ink;
    c.fillRect(cx - 1, y - 4, 10, 10);
    c.fillStyle = '#9fe8ff';
    c.fillRect(cx, y - 3, 8, 8);
    text(c, '현재 위치', cx + 13, y, { size: SZ.s, color: COL.cyan });
  }
}
