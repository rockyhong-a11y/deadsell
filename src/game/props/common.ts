import { FONT, TILE } from '../../engine/config';
import { AnimPlayer } from '../../engine/assets';
import { Entity } from '../entity';
import type { World } from '../world';
import { T } from '../tilemap';

/** Base class of everything placed by populateLevel that is not a creature: no physics, drawn behind actors. */
export abstract class Prop extends Entity {
  z = 0;
  physics = false;

  /** Attach a sheet from the asset store (placeholder sheets are substituted when art is missing). */
  protected useSheet(sheet: string, anim: string): AnimPlayer {
    const s = this.world.assets.sheet(sheet);
    this.anim = new AnimPlayer(s);
    this.anim.play(anim);
    return this.anim;
  }

  /** Does the player stand within `r` px (horizontally) and roughly on the same level? */
  protected playerNear(r: number): boolean {
    const p = this.world.player;
    return !!p && Math.abs(p.x - this.x) < r && Math.abs(p.y - this.y) < 64;
  }

  /** Face the player (NPCs). */
  protected facePlayer(): void {
    const p = this.world.player;
    if (p && Math.abs(p.x - this.x) > 6) this.facing = p.x > this.x ? 1 : -1;
  }
}

/** Y (px) of the underside of the first solid tile above (x, y), or null. */
export function ceilingAbove(world: World, x: number, y: number, maxTiles = 14): number | null {
  const tx = Math.floor(x / TILE);
  const ty0 = Math.floor((y - 1) / TILE);
  for (let ty = ty0; ty >= Math.max(0, ty0 - maxTiles); ty--) {
    if (world.map.isSolid(tx, ty)) return (ty + 1) * TILE;
  }
  return null;
}

/** Outlined pixel text in world space (the world buffer is low-res; Galmuri is a pixel font). */
export function drawWorldText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff', size = 11): void {
  ctx.save();
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const rx = Math.round(x), ry = Math.round(y);
  ctx.fillStyle = '#120a1a';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(text, rx + dx, ry + dy);
  ctx.fillStyle = color;
  ctx.fillText(text, rx, ry);
  ctx.restore();
}

/** Speech bubble above an NPC (world space). `y` = bottom of the bubble tail. */
export function drawBubble(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save();
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.ceil(ctx.measureText(text).width) + 12, h = 20;
  const bx = Math.round(x - w / 2), by = Math.round(y - h - 6);
  ctx.fillStyle = 'rgba(20,14,30,0.92)';
  ctx.fillRect(bx, by, w, h);
  ctx.strokeStyle = '#d9b86a';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
  ctx.fillStyle = 'rgba(20,14,30,0.92)';
  ctx.beginPath();
  ctx.moveTo(Math.round(x) - 4, by + h);
  ctx.lineTo(Math.round(x) + 4, by + h);
  ctx.lineTo(Math.round(x), by + h + 5);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, Math.round(x), by + h / 2 + 1);
  ctx.restore();
}

/** Soft additive glow (cheap radial gradient). */
export function drawSoftGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** Tile rectangle (inclusive) -> set all tiles. */
export function fillTiles(world: World, tx0: number, ty0: number, tx1: number, ty1: number, t: number): void {
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) world.map.set(x, y, t as 0 | 1 | 2 | 3 | 4);
}

export const SOLID = T.Solid;
