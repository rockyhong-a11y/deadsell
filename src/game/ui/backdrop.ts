import type { Assets, BgDef } from '../../engine/assets';
import { COL, SZ, text } from './draw';

/** Drifting embers drawn into the low-res world buffer (pixel look). */
export class Embers {
  private p: { x: number; y: number; vy: number; vx: number; ph: number; s: number; c: string }[] = [];
  private seed: number;

  constructor(private count = 64, private colors: string[] = ['#ff9a3c', '#ffd27a', '#9fe8ff'], seed = 7) {
    this.seed = seed;
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number, W: number, H: number): void {
    while (this.p.length < this.count) {
      this.p.push({ x: this.rnd() * W, y: this.rnd() * H, vy: -(6 + this.rnd() * 18), vx: (this.rnd() - 0.5) * 6, ph: this.rnd() * 6.28, s: this.rnd() < 0.2 ? 2 : 1, c: this.colors[Math.floor(this.rnd() * this.colors.length)] });
    }
    for (const e of this.p) {
      e.ph += dt * (1 + e.s * 0.3);
      e.y += e.vy * dt;
      e.x += (e.vx + Math.sin(e.ph) * 8) * dt;
      if (e.y < -4) { e.y = H + 4; e.x = this.rnd() * W; }
      if (e.x < -4) e.x = W + 4;
      if (e.x > W + 4) e.x = -4;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.p) {
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(e.ph * 2.3));
      ctx.fillStyle = e.c;
      ctx.fillRect(Math.round(e.x), Math.round(e.y), e.s, e.s);
    }
    ctx.restore();
  }
}

/** Vertical gradient fill of the whole world buffer. */
export function gradientBg(ctx: CanvasRenderingContext2D, W: number, H: number, stops: [number, string][]): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Parallax biome background (bg/<biome>.json layers) slowly drifting sideways.
 * Returns false when the art is missing so the caller can use a gradient instead.
 */
export function drawBiomeBg(ctx: CanvasRenderingContext2D, assets: Assets, biome: string, W: number, H: number, t: number): boolean {
  const def = assets.json.get(`bg/${biome}.json`) as BgDef | undefined;
  if (!def || !def.layers?.some((l) => l.img)) return false;
  ctx.fillStyle = def.sky || '#07060b';
  ctx.fillRect(0, 0, W, H);
  for (const l of def.layers) {
    const img = l.img;
    if (!img) continue;
    const drift = t * 6 * (l.parallax + 0.2);
    // fill the view height when the layer is shorter
    const sc = Math.max(1, H / img.height);
    const iw = img.width * sc;
    const ih = img.height * sc;
    const y = sc > 1 ? 0 : l.y || 0;
    const x0 = -(drift % iw);
    for (let x = x0; x < W; x += iw) ctx.drawImage(img, Math.round(x), Math.round(y), Math.ceil(iw), Math.ceil(ih));
  }
  return true;
}

/** Darkening vignette over the world buffer so overlay text stays readable. */
export function vignette(ctx: CanvasRenderingContext2D, W: number, H: number, strength = 0.6, tint = '7,6,11'): void {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, `rgba(${tint},0)`);
  g.addColorStop(1, `rgba(${tint},${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export interface Stat {
  label: string;
  value: string;
  color?: string;
}

/** Row of "label / big value" pairs centred on cx. */
export function statRow(c: CanvasRenderingContext2D, stats: Stat[], cx: number, y: number, colW: number, alpha = 1): void {
  const x0 = cx - (stats.length * colW) / 2 + colW / 2;
  stats.forEach((s, i) => {
    const x = x0 + i * colW;
    text(c, s.label, x, y, { align: 'center', color: COL.dim, alpha });
    text(c, s.value, x, y + 22, { size: SZ.l, bold: true, align: 'center', color: s.color ?? COL.text, alpha });
  });
}
