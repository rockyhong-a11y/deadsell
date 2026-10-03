import type { DamageInfo } from '../combat';
import { COLOR_HEX } from '../combat';
import { FONT } from '../../engine/config';
import { mixColor } from './particles';

/**
 * Combat feedback: damage numbers, floating text, slash trails, shock rings, screen flash.
 *
 *  - Damage numbers use a built-in 3x5 pixel digit font (crisp at any integer scale, 1 px dark
 *    outline, two-tone shading) cached in tiny per-colour atlases. They pop (scale +1 for a few
 *    frames), arc up with drag and fade out. Normal hits = 2x, crits = 3x yellow with "!", dots
 *    = 1x coloured, damage taken by the player = 2x red. Texts that are not digits (Korean labels)
 *    use the game font at its native 11 px (or 22 px for size >= 1.5) with a 1 px outline.
 *  - Slash trails are pixel-stepped crescents (one fillRect per pixel row/column, no overdraw):
 *    the head sweeps `from -> to` in the first ~45 % of the life while the tail chases it, the
 *    leading edge is white-hot, the body is the weapon colour. Very short arcs (spear thrusts)
 *    render as tapered stab streaks. Drawn additively under a brighter core.
 *  - Rings are pixel ellipses drawn with horizontal spans; optional `flat` squashes them into
 *    ground shockwaves.
 *  - Everything lives in fixed pools: nothing is allocated per frame.
 *
 * Render order contract: `draw()` runs after the light map (world space, camera transform set by
 * the caller), `drawScreen()` last (screen space).
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

export interface RingOpts {
  radius: number;
  color?: string;
  life?: number;
  /** line thickness at the start (px); default scales with the radius */
  width?: number;
  /** vertical squash 0.2..1 (1 = circle); use ~0.3 for ground shockwaves */
  flat?: number;
}

const OUTLINE = '#120a1a';
const GLYPHS = '0123456789!+-';
const FONT_ROWS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '!': ['010', '010', '010', '000', '010'],
  '+': ['000', '010', '111', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
};
const BITMAP_RE = /^[0-9!+\-]+$/;

const MAX_POPS = 64;
const MAX_SLASHES = 20;
const MAX_RINGS = 16;

interface Pop {
  on: boolean;
  x: number; y: number; vx: number; vy: number; drag: number;
  age: number; life: number;
  text: string; color: string;
  /** bitmap scale (digits) or font size multiplier (text) */
  scale: number;
  bitmap: boolean;
  /** pop (scale + 1) duration and shake duration */
  pop: number;
  shake: number;
}

interface SlashFx {
  on: boolean;
  x: number; y: number; dir: number; r: number; from: number; to: number; w: number;
  age: number; life: number;
  stab: boolean;
  c0: string; c1: string; c2: string; c3: string; glow: string;
}

interface RingFx {
  on: boolean;
  x: number; y: number; r: number; age: number; life: number; w: number; flat: number;
  color: string; hot: string;
}

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
interface Atlas { canvas: Canvas2D; cw: number; ch: number; }

const atlases = new Map<string, Atlas | null>();

function makeCanvas(w: number, h: number): Canvas2D | null {
  try {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch {
    /* no canvas */
  }
  return null;
}

/** Digit atlas for a colour and integer scale (null when no canvas is available). */
function atlasFor(color: string, scale: number): Atlas | null {
  const key = color + '|' + scale;
  const hit = atlases.get(key);
  if (hit !== undefined) return hit;
  const cw = 3 * scale + 2;
  const ch = 5 * scale + 2;
  const canvas = makeCanvas(cw * GLYPHS.length, ch);
  const g = canvas?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!canvas || !g) {
    atlases.set(key, null);
    return null;
  }
  const top = mixColor(color, '#ffffff', 0.3);
  const bottom = mixColor(color, '#000000', 0.2);
  for (let gi = 0; gi < GLYPHS.length; gi++) {
    const rows = FONT_ROWS[GLYPHS[gi]];
    const ox = gi * cw + 1;
    g.fillStyle = OUTLINE;
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++) if (rows[y][x] === '1') g.fillRect(ox + x * scale - 1, 1 + y * scale - 1, scale + 2, scale + 2);
    for (let y = 0; y < 5; y++) {
      g.fillStyle = y < 3 ? top : bottom;
      for (let x = 0; x < 3; x++) if (rows[y][x] === '1') g.fillRect(ox + x * scale, 1 + y * scale, scale, scale);
    }
  }
  const a = { canvas, cw, ch };
  atlases.set(key, a);
  return a;
}

const q4 = (a: number) => Math.round(a * 4) / 4;

export class Fx {
  private pops: Pop[] = [];
  private slashes: SlashFx[] = [];
  private rings: RingFx[] = [];
  private flashColor = '#fff';
  private flashT = 0;
  private flashDur = 0;
  private flashAlpha = 0;
  private time = 0;
  private popCursor = 0;
  private slashCursor = 0;
  private ringCursor = 0;
  private readonly colorCache = new Map<string, [string, string, string, string]>();

  constructor() {
    for (let i = 0; i < MAX_POPS; i++) this.pops.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, drag: 0, age: 0, life: 1, text: '', color: '#fff', scale: 2, bitmap: true, pop: 0, shake: 0 });
    for (let i = 0; i < MAX_SLASHES; i++) this.slashes.push({ on: false, x: 0, y: 0, dir: 1, r: 0, from: 0, to: 0, w: 4, age: 0, life: 0.12, stab: false, c0: '#fff', c1: '#fff', c2: '#fff', c3: '#fff', glow: '#fff' });
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ on: false, x: 0, y: 0, r: 0, age: 0, life: 0.3, w: 2, flat: 1, color: '#fff', hot: '#fff' });
  }

  /** number of live numbers / slashes / rings (tests, debug) */
  get activeNumbers(): number {
    let n = 0;
    for (const p of this.pops) if (p.on) n++;
    return n;
  }
  get activeSlashes(): number {
    let n = 0;
    for (const s of this.slashes) if (s.on) n++;
    return n;
  }
  get activeRings(): number {
    let n = 0;
    for (const r of this.rings) if (r.on) n++;
    return n;
  }
  get flashing(): boolean {
    return this.flashT > 0;
  }

  // ------------------------------------------------------------ numbers
  private allocPop(): Pop {
    for (let k = 0; k < MAX_POPS; k++) {
      const p = this.pops[(this.popCursor + k) % MAX_POPS];
      if (!p.on) {
        this.popCursor = (this.popCursor + k + 1) % MAX_POPS;
        return p;
      }
    }
    // all busy: recycle the oldest
    let o = this.pops[0];
    for (const p of this.pops) if (p.age / p.life > o.age / o.life) o = p;
    return o;
  }

  /** Stack numbers that spawn on top of each other upwards instead of overlapping. */
  private stackOffset(x: number, y: number): number {
    let n = 0;
    for (const p of this.pops) if (p.on && p.age < 0.22 && Math.abs(p.x - x) < 14 && Math.abs(p.y - y) < 10) n++;
    return Math.min(3, n) * 9;
  }

  /** Dead Cells style damage number. White = your hit, item-colour = coloured weapon, red = you are hit. */
  damageNumber(x: number, y: number, amount: number, info: DamageInfo): void {
    const dot = info.kind === 'dot' || !!info.dotType;
    const toPlayer = !dot && (info.source?.team === 'enemy' || info.kind === 'hazard');
    let color = '#ffffff';
    let scale = 2;
    let life = 0.8;
    let vy = -92;
    let drag = 3.6;
    let pop = 0.05;
    let shake = 0;
    let text = String(Math.max(0, Math.round(amount)));
    if (info.crit && !dot) {
      color = '#ffd23f';
      scale = 3;
      life = 1.0;
      vy = -115;
      drag = 3;
      pop = 0.09;
      shake = 0.16;
      text += '!';
    } else if (dot) {
      color = info.dotType === 'bleed' ? '#ff3b5c' : info.dotType === 'burn' ? '#ff8a3c' : '#ffb35a';
      scale = 1;
      life = 0.6;
      vy = -42;
      drag = 2.5;
      pop = 0;
    } else if (toPlayer) {
      color = '#ff4a58';
      scale = amount >= 25 ? 3 : 2;
      life = 0.9;
      vy = -80;
      shake = 0.12;
      pop = 0.07;
    } else if (info.color) {
      color = COLOR_HEX[info.color];
    }
    const jx = (Math.random() - 0.5) * 10;
    const p = this.allocPop();
    p.on = true;
    p.x = x + jx;
    p.y = y - this.stackOffset(x + jx, y);
    p.vx = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 16) * (dot ? 0.5 : 1);
    p.vy = vy;
    p.drag = drag;
    p.age = 0;
    p.life = life;
    p.text = text;
    p.color = color;
    p.scale = scale;
    p.bitmap = true;
    p.pop = pop;
    p.shake = shake;
  }

  /** Floating text (labels, pickups, "!" alerts). Digits/+/-/! use the pixel font, anything else the game font. */
  text(x: number, y: number, text: string, color = '#ffffff', opts: { size?: number; life?: number } = {}): void {
    const size = opts.size ?? 1;
    const p = this.allocPop();
    const bitmap = BITMAP_RE.test(text);
    p.on = true;
    p.x = x;
    p.y = y - this.stackOffset(x, y);
    p.vx = 0;
    p.vy = -34 * (size > 1 ? 1.2 : 1);
    p.drag = 1.6;
    p.age = 0;
    p.life = opts.life ?? 0.9;
    p.text = text;
    p.color = color;
    p.scale = bitmap ? (size >= 1.5 ? 3 : 2) : size >= 1.5 ? 2 : 1;
    p.bitmap = bitmap;
    p.pop = bitmap ? 0.05 : 0;
    p.shake = 0;
  }

  // ------------------------------------------------------------ slashes / rings
  private colors(color: string): [string, string, string, string] {
    let c = this.colorCache.get(color);
    if (!c) {
      c = [mixColor(color, '#ffffff', 0.85), mixColor(color, '#ffffff', 0.5), color, mixColor(color, '#2a1038', 0.45)];
      if (this.colorCache.size > 64) this.colorCache.clear();
      this.colorCache.set(color, c);
    }
    return c;
  }

  /** Crescent arc around (x, y); see SlashOpts. Short arcs become thrust streaks. */
  slash(x: number, y: number, o: SlashOpts): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let s: SlashFx | null = null;
    for (let k = 0; k < MAX_SLASHES; k++) {
      const c = this.slashes[(this.slashCursor + k) % MAX_SLASHES];
      if (!c.on) {
        s = c;
        this.slashCursor = (this.slashCursor + k + 1) % MAX_SLASHES;
        break;
      }
    }
    if (!s) s = this.slashes[this.slashCursor++ % MAX_SLASHES];
    const color = o.color ?? '#ffffff';
    const cs = this.colors(color);
    s.on = true;
    s.x = x;
    s.y = y;
    s.dir = o.dir < 0 ? -1 : 1;
    s.r = o.radius;
    s.from = o.from;
    s.to = o.to;
    s.w = Math.max(2, o.width ?? Math.round(Math.max(3, o.radius * 0.12)));
    s.life = Math.max(0.05, o.life ?? 0.12);
    s.age = 0;
    s.stab = Math.abs(o.to - o.from) * o.radius < 24;
    s.c0 = cs[0];
    s.c1 = cs[1];
    s.c2 = cs[2];
    s.c3 = cs[3];
    s.glow = color;
  }

  /** Expanding shockwave ring. */
  ring(x: number, y: number, o: RingOpts): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let r: RingFx | null = null;
    for (let k = 0; k < MAX_RINGS; k++) {
      const c = this.rings[(this.ringCursor + k) % MAX_RINGS];
      if (!c.on) {
        r = c;
        this.ringCursor = (this.ringCursor + k + 1) % MAX_RINGS;
        break;
      }
    }
    if (!r) r = this.rings[this.ringCursor++ % MAX_RINGS];
    const color = o.color ?? '#ffffff';
    r.on = true;
    r.x = x;
    r.y = y;
    r.r = Math.max(4, o.radius);
    r.life = Math.max(0.08, o.life ?? 0.3);
    r.age = 0;
    r.w = Math.max(1, Math.round(o.width ?? Math.min(5, Math.max(2, o.radius / 36))));
    r.flat = Math.max(0.15, Math.min(1, o.flat ?? 1));
    r.color = color;
    r.hot = mixColor(color, '#ffffff', 0.7);
  }

  /** Full-screen flash (boss hits, parries). A weaker flash never cuts a stronger running one. */
  screenFlash(color: string, dur = 0.12, alpha = 0.5): void {
    if (this.flashT > 0 && alpha < this.flashAlpha * (this.flashT / this.flashDur)) return;
    this.flashColor = color;
    this.flashT = this.flashDur = Math.max(0.01, dur);
    this.flashAlpha = alpha;
  }

  // ------------------------------------------------------------ simulation
  update(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    for (const p of this.pops) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.on = false;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const s of this.slashes) if (s.on && (s.age += dt) >= s.life) s.on = false;
    for (const r of this.rings) if (r.on && (r.age += dt) >= r.life) r.on = false;
    if (this.flashT > 0) this.flashT -= dt;
  }

  // ------------------------------------------------------------ drawing
  /** world-space layer (camera transform applied) */
  draw(ctx: CanvasRenderingContext2D): void {
    let vx0 = -Infinity, vy0 = -Infinity, vx1 = Infinity, vy1 = Infinity;
    const tr = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (tr && ctx.canvas && tr.a === 1 && tr.d === 1) {
      vx0 = -tr.e - 8;
      vy0 = -tr.f - 8;
      vx1 = vx0 + ctx.canvas.width + 16;
      vy1 = vy0 + ctx.canvas.height + 16;
    }
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    // additive layer: rings and slash glow/body
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) if (r.on) this.drawRing(ctx, r, vx0, vy0, vx1, vy1);
    for (const s of this.slashes) if (s.on && s.x > vx0 - 120 && s.x < vx1 + 120 && s.y > vy0 - 120 && s.y < vy1 + 120) this.drawSlash(ctx, s, 0);
    ctx.globalCompositeOperation = 'source-over';
    for (const s of this.slashes) if (s.on && s.x > vx0 - 120 && s.x < vx1 + 120 && s.y > vy0 - 120 && s.y < vy1 + 120) this.drawSlash(ctx, s, 1);
    ctx.globalAlpha = 1;
    // numbers on top
    let fontSet = 0;
    for (const p of this.pops) {
      if (!p.on || p.x < vx0 - 40 || p.x > vx1 + 40 || p.y < vy0 - 20 || p.y > vy1 + 20) continue;
      const rem = p.life - p.age;
      const a = rem < 0.25 ? q4(rem / 0.25) : 1;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      let px = Math.round(p.x);
      const py = Math.round(p.y);
      if (p.shake > 0 && p.age < p.shake) px += Math.sin(p.age * 120) > 0 ? 1 : -1;
      const white = p.pop > 0 && p.age < 0.04 && p.scale >= 3;
      if (p.bitmap) {
        let sc = p.scale;
        if (p.age < p.pop) sc += 1;
        this.drawDigits(ctx, p.text, px, py, white ? '#ffffff' : p.color, sc);
      } else {
        const size = p.scale >= 2 ? 22 : 11;
        if (fontSet !== size) {
          ctx.font = `${size}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          fontSet = size;
        }
        ctx.fillStyle = OUTLINE;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) ctx.fillText(p.text, px + ox, py + oy);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, px, py);
      }
    }
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
  }

  /** draw a digit string centred on x, baseline at y (bitmap font; falls back to text without a canvas) */
  private drawDigits(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale: number): void {
    const atlas = atlasFor(color, scale);
    if (!atlas) {
      ctx.font = `bold ${5 * scale + 2}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = OUTLINE;
      ctx.fillText(text, x + 1, y + 1);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      return;
    }
    const adv = 3 * scale + 1;
    const total = text.length * adv - 1;
    let gx = x - (total >> 1);
    const gy = y - 5 * scale;
    for (let i = 0; i < text.length; i++, gx += adv) {
      const gi = GLYPHS.indexOf(text[i]);
      if (gi < 0) continue;
      ctx.drawImage(atlas.canvas as CanvasImageSource, gi * atlas.cw, 0, atlas.cw, atlas.ch, gx - 1, gy - 1, atlas.cw, atlas.ch);
    }
  }

  private drawRing(ctx: CanvasRenderingContext2D, rg: RingFx, vx0: number, vy0: number, vx1: number, vy1: number): void {
    const p = rg.age / rg.life;
    const e = 1 - Math.pow(1 - p, 3);
    const R = rg.r * (0.2 + 0.8 * e);
    const cx = Math.round(rg.x);
    const cy = Math.round(rg.y);
    if (cx + R < vx0 || cx - R > vx1 || cy + R * rg.flat < vy0 || cy - R * rg.flat > vy1) return;
    const a = q4(p < 0.4 ? 1 : (1 - p) / 0.6);
    if (a <= 0) return;
    const thick = Math.max(1, Math.round(rg.w * (1 - p * 0.7)));
    // soft fill flash for big blasts
    if (rg.r >= 60 && p < 0.2) {
      ctx.globalAlpha = 0.16 * (1 - p / 0.2);
      ctx.fillStyle = rg.color;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * rg.flat, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = p < 0.25 ? rg.hot : rg.color;
    this.ringSpans(ctx, cx, cy, R, thick, rg.flat, vy0, vy1);
    if (rg.r >= 40 && R > 12) {
      // lagging echo ring
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = rg.color;
      this.ringSpans(ctx, cx, cy, R * 0.82, 1, rg.flat, vy0, vy1);
    }
  }

  private ringSpans(ctx: CanvasRenderingContext2D, cx: number, cy: number, ro: number, t: number, flat: number, vy0: number, vy1: number): void {
    const ri = Math.max(0, ro - t);
    const ry = Math.ceil(ro * flat);
    const y0 = Math.max(-ry, Math.floor(vy0 - cy));
    const y1 = Math.min(ry, Math.ceil(vy1 - cy));
    for (let dy = y0; dy <= y1; dy++) {
      const u = dy / flat;
      const o2 = ro * ro - u * u;
      if (o2 < 0) continue;
      const ox = Math.round(Math.sqrt(o2));
      const i2 = ri * ri - u * u;
      const y = cy + dy;
      if (i2 <= 0) ctx.fillRect(cx - ox, y, ox * 2 + 1, 1);
      else {
        const ix = Math.round(Math.sqrt(i2));
        const w = Math.max(1, ox - ix + 1);
        ctx.fillRect(cx - ox, y, w, 1);
        ctx.fillRect(cx + ix, y, w, 1);
      }
    }
  }

  /** pass 0 = additive glow underlay, pass 1 = crisp body with a white-hot leading edge */
  private drawSlash(ctx: CanvasRenderingContext2D, s: SlashFx, pass: number): void {
    const p = s.age / s.life;
    const headT = 1 - Math.pow(1 - Math.min(1, p / 0.45), 3);
    let tailT = p < 0.25 ? 0 : Math.pow((p - 0.25) / 0.75, 1.6);
    if (tailT > headT - 0.02) tailT = Math.max(0, headT - 0.02);
    if (p > 0.97 || headT <= tailT) return;
    const fade = p > 0.6 ? q4((1 - p) / 0.4) : 1;
    if (fade <= 0) return;
    const cx = Math.round(s.x);
    const cy = Math.round(s.y);
    const wBase = pass === 0 ? s.w * 1.7 + 2 : s.w;
    ctx.globalAlpha = pass === 0 ? 0.22 * fade : fade;
    if (pass === 0) ctx.fillStyle = s.glow;
    const mid = (s.from + s.to) / 2;
    const span = s.to - s.from;
    if (s.stab) {
      // thrust streak along the middle direction
      const phi = s.dir > 0 ? mid : Math.PI - mid;
      const co = Math.cos(phi), si = Math.sin(phi);
      const major = Math.max(Math.abs(co), Math.abs(si));
      const r0 = s.r * 0.3;
      const r1 = s.r * (0.95 + 0.1 * p);
      const d0 = r0 + (r1 - r0) * tailT;
      const d1 = r0 + (r1 - r0) * headT;
      const stepD = 1 / major;
      const horiz = Math.abs(co) >= Math.abs(si);
      let lastBand = -1;
      for (let d = d0; d <= d1; d += stepD) {
        const u = (d - r0) / Math.max(1, r1 - r0);
        const h = Math.max(1, Math.round(wBase * (1 - u * 0.85)));
        const x = s.x + co * d;
        const y = s.y + si * d;
        if (pass === 1) {
          const dd = (d1 - d) / Math.max(1, d1 - d0);
          const band = dd < 0.18 ? 0 : dd < 0.45 ? 1 : dd < 0.8 ? 2 : 3;
          if (band !== lastBand) {
            ctx.fillStyle = band === 0 ? s.c0 : band === 1 ? s.c1 : band === 2 ? s.c2 : s.c3;
            lastBand = band;
          }
        }
        if (horiz) ctx.fillRect(Math.round(x), Math.round(y - h / 2), 1, h);
        else ctx.fillRect(Math.round(x - h / 2), Math.round(y), h, 1);
      }
      return;
    }
    // crescent
    const rMid = s.r * (0.94 + 0.1 * p);
    const aSpan = Math.abs(span);
    let u = tailT;
    let lastBand = -1;
    const uEnd = headT;
    let guard = 0;
    while (u <= uEnd && guard++ < 400) {
      const a = s.from + span * u;
      const phi = s.dir > 0 ? a : Math.PI - a;
      const co = Math.cos(phi), si = Math.sin(phi);
      const th = Math.max(1, wBase * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.6));
      const ro = rMid + th * 0.5;
      const ri = Math.max(0, rMid - th * 0.5);
      if (pass === 1) {
        const dd = (uEnd - u) / Math.max(0.01, uEnd - tailT);
        const band = dd < 0.12 ? 0 : dd < 0.34 ? 1 : dd < 0.7 ? 2 : 3;
        if (band !== lastBand) {
          ctx.fillStyle = band === 0 ? s.c0 : band === 1 ? s.c1 : band === 2 ? s.c2 : s.c3;
          lastBand = band;
        }
      }
      if (Math.abs(co) >= Math.abs(si)) {
        // radial mostly horizontal: one row per step
        const y = Math.round(cy + rMid * si);
        const dy = y - cy;
        const xo = Math.sqrt(Math.max(0, ro * ro - dy * dy));
        const xi = Math.sqrt(Math.max(0, ri * ri - dy * dy));
        const sx = co >= 0 ? 1 : -1;
        const x0 = Math.round(cx + sx * xi);
        const x1 = Math.round(cx + sx * Math.max(xo, xi + 1));
        ctx.fillRect(Math.min(x0, x1), y, Math.max(1, Math.abs(x1 - x0)), 1);
      } else {
        const x = Math.round(cx + rMid * co);
        const dx = x - cx;
        const yo = Math.sqrt(Math.max(0, ro * ro - dx * dx));
        const yi = Math.sqrt(Math.max(0, ri * ri - dx * dx));
        const sy = si >= 0 ? 1 : -1;
        const y0 = Math.round(cy + sy * yi);
        const y1 = Math.round(cy + sy * Math.max(yo, yi + 1));
        ctx.fillRect(x, Math.min(y0, y1), 1, Math.max(1, Math.abs(y1 - y0)));
      }
      // advance one pixel along the tangent's major axis
      u += 1 / (aSpan * rMid * Math.max(Math.abs(co), Math.abs(si)));
    }
  }

  /** screen-space layer (after lighting) */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.flashT > 0) {
      const k = this.flashT / this.flashDur;
      ctx.globalAlpha = this.flashAlpha * k * k * (3 - 2 * k);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  clear(): void {
    for (const p of this.pops) p.on = false;
    for (const s of this.slashes) s.on = false;
    for (const r of this.rings) r.on = false;
    this.flashT = 0;
  }
}
