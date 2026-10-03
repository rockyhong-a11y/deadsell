import type { DamageInfo } from '../combat';
import { COLOR_HEX } from '../combat';

/**
 * Combat feedback: damage numbers, floating text, slash trails, shock rings, screen flash.
 * OWNER: fx agent — replace this minimal implementation, keep the public API stable.
 */
export interface SlashOpts {
  /** -1/1 facing */
  dir: number;
  radius: number;
  /** arc start/end angles in radians, measured for a RIGHT-facing swing (0 = forward, -PI/2 = up) */
  from: number;
  to: number;
  color?: string;
  width?: number;
  life?: number;
}

interface Num { x: number; y: number; vy: number; t: number; text: string; color: string; size: number; }

export class Fx {
  private nums: Num[] = [];
  private flashColor = '#fff';
  private flashT = 0;
  private flashDur = 0;
  private flashAlpha = 0;

  damageNumber(x: number, y: number, amount: number, info: DamageInfo): void {
    const color = info.crit ? '#ffd23f' : info.dotType === 'burn' ? '#ff8a3c' : info.dotType === 'bleed' ? '#ff3b5c' : info.color ? COLOR_HEX[info.color] : '#ffffff';
    this.nums.push({ x, y, vy: -60, t: 0.7, text: String(amount), color, size: info.crit ? 2 : 1 });
  }

  text(x: number, y: number, text: string, color = '#ffffff', _opts: { size?: number; life?: number } = {}): void {
    this.nums.push({ x, y, vy: -30, t: 1, text, color, size: 1 });
  }

  slash(_x: number, _y: number, _o: SlashOpts): void {}

  ring(_x: number, _y: number, _o: { radius: number; color?: string; life?: number }): void {}

  /** Full-screen flash (boss hits, parries). */
  screenFlash(color: string, dur = 0.12, alpha = 0.5): void {
    this.flashColor = color;
    this.flashT = this.flashDur = dur;
    this.flashAlpha = alpha;
  }

  update(dt: number): void {
    for (const n of this.nums) {
      n.t -= dt;
      n.y += n.vy * dt;
      n.vy *= 0.92;
    }
    this.nums = this.nums.filter((n) => n.t > 0);
    if (this.flashT > 0) this.flashT -= dt;
  }

  /** world-space layer (camera transform applied) */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    for (const n of this.nums) {
      ctx.font = `${n.size > 1 ? 'bold ' : ''}${8 * n.size + 3}px Galmuri11, sans-serif`;
      ctx.fillStyle = '#120a1a';
      ctx.fillText(n.text, Math.round(n.x) + 1, Math.round(n.y) + 1);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, Math.round(n.x), Math.round(n.y));
    }
  }

  /** screen-space layer (after lighting) */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.flashT > 0) {
      ctx.globalAlpha = this.flashAlpha * (this.flashT / this.flashDur);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  clear(): void {
    this.nums = [];
    this.flashT = 0;
  }
}
