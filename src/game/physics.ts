import { TILE } from '../engine/config';
import type { TileMap } from './tilemap';
import { T } from './tilemap';

/**
 * Kinematic body. Position (x, y) = centre-bottom (feet), size w × h.
 * AABB = [x - w/2, x + w/2] × [y - h, y].
 */
export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
  onPlatform: boolean;
  /** -1/1 when blocked by a wall this step, else 0 */
  hitWallX: number;
  hitCeiling: boolean;
  /** ignore one-way platforms while true */
  dropThrough: boolean;
  /** pass through solid tiles (ghosts, some projectiles) */
  noClip?: boolean;
}

const EPS = 0.001;

/** Move a body by its velocity for `dt`, resolving collisions axis by axis. */
export function moveBody(b: Body, map: TileMap, dt: number): void {
  b.hitWallX = 0;
  b.hitCeiling = false;
  if (b.noClip) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.onGround = b.onPlatform = false;
    return;
  }
  moveX(b, map, b.vx * dt);
  moveY(b, map, b.vy * dt);
}

function moveX(b: Body, map: TileMap, dx: number): void {
  if (dx === 0) return;
  const half = b.w / 2;
  const ty0 = Math.floor((b.y - b.h + EPS) / TILE);
  const ty1 = Math.floor((b.y - EPS) / TILE);
  // step at most half a tile at a time so fast bodies cannot tunnel
  let remaining = dx;
  while (remaining !== 0) {
    const step = Math.max(-TILE / 2, Math.min(TILE / 2, remaining));
    remaining -= step;
    const nx = b.x + step;
    const edge = step > 0 ? nx + half - EPS : nx - half + EPS;
    const tx = Math.floor(edge / TILE);
    let blocked = false;
    for (let ty = ty0; ty <= ty1; ty++) {
      if (map.isSolid(tx, ty)) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      b.x = step > 0 ? tx * TILE - half : (tx + 1) * TILE + half;
      b.vx = 0;
      b.hitWallX = step > 0 ? 1 : -1;
      return;
    }
    b.x = nx;
  }
}

function moveY(b: Body, map: TileMap, dy: number): void {
  b.onGround = false;
  b.onPlatform = false;
  if (dy === 0) {
    // still check support so standing bodies report onGround
    dy = 0.01;
  }
  const half = b.w / 2;
  const tx0 = Math.floor((b.x - half + EPS) / TILE);
  const tx1 = Math.floor((b.x + half - EPS) / TILE);
  let remaining = dy;
  while (remaining !== 0) {
    const step = Math.max(-TILE / 2, Math.min(TILE / 2, remaining));
    remaining -= step;
    const prevBottom = b.y;
    const ny = b.y + step;
    if (step > 0) {
      const ty = Math.floor((ny - EPS) / TILE);
      const prevTy = Math.floor((prevBottom - EPS) / TILE);
      let land = false;
      let plat = false;
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = map.get(tx, ty);
        if (t === T.Solid || t === T.Breakable) {
          land = true;
          plat = false;
          break;
        }
        // one-way: only when we were above its top last step
        if (t === T.Platform && !b.dropThrough && prevTy < ty && b.vy >= 0) {
          land = true;
          plat = true;
        }
      }
      if (land) {
        b.y = ty * TILE;
        if (b.vy > 0) b.vy = 0;
        b.onGround = true;
        b.onPlatform = plat;
        return;
      }
      b.y = ny;
    } else {
      const top = ny - b.h;
      const ty = Math.floor((top + EPS) / TILE);
      let blocked = false;
      for (let tx = tx0; tx <= tx1; tx++) {
        if (map.isSolid(tx, ty)) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        b.y = (ty + 1) * TILE + b.h;
        if (b.vy < 0) b.vy = 0;
        b.hitCeiling = true;
        return;
      }
      b.y = ny;
    }
  }
  if (dy === 0.01) b.y -= 0.01;
}

/** Is there floor (solid or platform) directly under the body's left/right foot? */
export function groundUnder(b: Body, map: TileMap, offsetX: number): boolean {
  const tx = Math.floor((b.x + offsetX) / TILE);
  const ty = Math.floor((b.y + 1) / TILE);
  const t = map.get(tx, ty);
  return t === T.Solid || t === T.Breakable || t === T.Platform;
}
