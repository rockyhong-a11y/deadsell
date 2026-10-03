import type { Camera } from '../../engine/camera';
import { TILE } from '../../engine/config';
import type { World } from '../world';
import { T } from '../tilemap';

/**
 * Draws the level: sky/parallax/back walls (drawBack, screen space), terrain
 * (drawTiles, world space) and foreground decoration (drawFront, world space).
 * OWNER: level agent — implement docs/TILES.md with the tileset art; this stub draws flat colours.
 */
export class LevelRenderer {
  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  drawBack(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.fillStyle = '#141a24';
    ctx.fillRect(0, 0, cam.w, cam.h);
  }

  drawTiles(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const m = this.world.map;
    const x0 = Math.max(0, Math.floor(cam.x / TILE)), x1 = Math.min(m.w - 1, Math.floor((cam.x + cam.w) / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE)), y1 = Math.min(m.h - 1, Math.floor((cam.y + cam.h) / TILE));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const t = m.get(tx, ty);
        if (t === T.Empty) continue;
        ctx.fillStyle = t === T.Solid ? '#3a4152' : t === T.Platform ? '#7a5a3a' : t === T.Spikes ? '#b0b8c8' : '#5a4a42';
        if (t === T.Platform) ctx.fillRect(tx * TILE, ty * TILE, TILE, 5);
        else if (t === T.Spikes) ctx.fillRect(tx * TILE, ty * TILE + 14, TILE, 10);
        else ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
  }

  drawFront(_ctx: CanvasRenderingContext2D, _cam: Camera): void {}
}
