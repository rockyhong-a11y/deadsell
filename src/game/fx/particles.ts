import type { Camera } from '../../engine/camera';
import { TILE } from '../../engine/config';
import type { TileMap } from '../tilemap';
import { T } from '../tilemap';
import { glowSink, type GlowSink } from './glow';

/**
 * Particle system (world space). Pooled structure-of-arrays storage with a hard
 * cap (MAX_PARTICLES): no allocation in steady state. Pixel-art rendering: integer
 * positions, 1–3 px squares, pixel-stepped streaks, small octagon blobs for big
 * puffs, colour ramps over life instead of smooth alpha where possible.
 *
 * Glowing presets are drawn with additive blending and also push a small light
 * into `glowSink`, which the lighting pass adds to its light map (so embers, cells
 * and explosions stay bright and light their surroundings in dark biomes).
 *
 * Optional extras (additive API):
 *  - `setMap(map)`  enables floor/wall collision (debris bounces, blood settles on floors
 *                   and walls, drips splash). Without a map those particles just fall and fade.
 *  - `ambient(biome, camera, dt?, map?)` emits biome atmosphere around the view; call it
 *                   once per simulation step (prison: water drips + dust motes, ramparts: wind
 *                   leaves + dust streaks, tower: rising embers, passage: warm motes).
 *  - `count` active particle count; `MAX_PARTICLES` the pool size.
 */
export type ParticlePreset =
  | 'hit' | 'blood' | 'spark' | 'dust' | 'land' | 'jump' | 'roll' | 'cell' | 'gold' | 'fire' | 'ice'
  | 'smoke' | 'explosion' | 'embers' | 'heal' | 'debris' | 'death' | 'parry' | 'magic' | 'slam' | 'drip';

export const PARTICLE_PRESETS: readonly ParticlePreset[] = [
  'hit', 'blood', 'spark', 'dust', 'land', 'jump', 'roll', 'cell', 'gold', 'fire', 'ice',
  'smoke', 'explosion', 'embers', 'heal', 'debris', 'death', 'parry', 'magic', 'slam', 'drip',
];

export interface EmitOpts {
  /** -1/1 main direction (hits spray away from the attacker) */
  dir?: number;
  color?: string;
  count?: number;
  /** scales the preset's speed/size */
  power?: number;
  /** emission area (px) centred on (x, y); particles start anywhere inside it */
  w?: number;
  h?: number;
  /** velocity inherited from the emitter (px/s), added to every particle */
  vx?: number;
  vy?: number;
  /** main direction in radians (0 = right, -PI/2 = up); overrides `dir` for directional presets */
  angle?: number;
  /** life multiplier */
  life?: number;
}

export const MAX_PARTICLES = 1500;
/** cap for ambient atmosphere particles (they never crowd out combat effects) */
const AMBIENT_CAP = 110;

// flags
const ADD = 1;
const STREAK = 2;
const BOUNCE = 4;
const SETTLE = 8;
const WOBBLE = 16;
const FADE = 32;
const FADEIN = 64;
const CROSS = 128;
const TRAIL = 256;
const SPLASH = 512;
const AMBIENT = 1024;
const INVIS = 2048;
const SETTLED = 4096;
const COLLIDE = BOUNCE | SETTLE | SPLASH;

interface Ramp {
  c: string[];
  /** light colour pushed into the glow sink */
  glow: string;
}

// ---------------------------------------------------------------- colours
function parseHex(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(v)) return [255, 255, 255];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Mix colour a toward b by t (0..1). */
export function mixColor(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

const RAMPS: Ramp[] = [];
const RAMP_IDS = new Map<string, number>();

function defRamp(key: string, c: string[], glow?: string): number {
  const id = RAMPS.length;
  RAMPS.push({ c, glow: glow ?? c[Math.min(1, c.length - 1)] });
  RAMP_IDS.set(key, id);
  return id;
}

/** Ramp generated from a single colour: bright core → colour → dark (cached). */
function rampFor(color: string, kind: 'glow' | 'solid' = 'solid'): number {
  const key = kind + color;
  const id = RAMP_IDS.get(key);
  if (id !== undefined) return id;
  const c =
    kind === 'glow'
      ? [mixColor(color, '#ffffff', 0.75), mixColor(color, '#ffffff', 0.35), color, mixColor(color, '#000000', 0.35)]
      : [mixColor(color, '#ffffff', 0.2), color, mixColor(color, '#000000', 0.3), mixColor(color, '#000000', 0.5)];
  return defRamp(key, c, color);
}

const R = {
  spark: defRamp('spark', ['#ffffff', '#fff6c8', '#ffd84a', '#ff9a2a', '#c8501a'], '#ffb040'),
  white: defRamp('white', ['#ffffff', '#ffffff', '#fff4d8', '#ffe0a0'], '#fff0c0'),
  blood: defRamp('blood', ['#d82a3c', '#a81a2c', '#7c1020', '#5a0a16']),
  dust: defRamp('dust', ['#bdb4aa', '#a39b93', '#8a837d', '#6e6964']),
  cell: defRamp('cell', ['#ffffff', '#c8f8ff', '#6fe0ff', '#2fa8e8', '#1f6fb8'], '#4fd8ff'),
  gold: defRamp('gold', ['#ffffff', '#fff2a8', '#ffd23f', '#e09a20', '#a0601a'], '#ffc830'),
  fire: defRamp('fire', ['#fff8d0', '#ffe060', '#ffa830', '#ff6a1a', '#c8300e', '#5a1408'], '#ff8a2a'),
  ice: defRamp('ice', ['#ffffff', '#e0fbff', '#a8ecff', '#6ac8ec', '#3a8cc0'], '#8fe3ff'),
  smoke: defRamp('smoke', ['#6e6874', '#5a5460', '#47424d', '#35313a']),
  soot: defRamp('soot', ['#4a4044', '#3a3236', '#2a2428', '#1e1a1e']),
  debris: defRamp('debris', ['#a39a90', '#857b72', '#675f58', '#4f4843']),
  heal: defRamp('heal', ['#ffffff', '#d0ffc8', '#86e878', '#4aa83e'], '#7ee070'),
  healRed: defRamp('healRed', ['#ffffff', '#ffd0d0', '#ff7a7a', '#d03a48'], '#ff6a6a'),
  magic: defRamp('magic', ['#ffffff', '#f0c8ff', '#c07af0', '#8a3ad0', '#4a1a80'], '#b070f0'),
  dark: defRamp('dark', ['#3a2438', '#2c1a2c', '#1e121e', '#140a14']),
  water: defRamp('water', ['#e0f6ff', '#a8dcec', '#78b8d0', '#5a98b4'], '#9fd8ea'),
  ember: defRamp('ember', ['#ffe8a0', '#ffb040', '#ff7a20', '#d84a14', '#7a2010'], '#ff8a2a'),
  mote: defRamp('mote', ['#d8eee8', '#c0dcd6', '#a6c8c2']),
  warmMote: defRamp('warmMote', ['#ffe8c8', '#f0d0a8', '#d8b088']),
  leaf: defRamp('leaf', ['#a0482a', '#8a3a24', '#6e2c1e', '#4e2018']),
  wind: defRamp('wind', ['#d8d8f0', '#c0c0e0', '#a8a8d0']),
  parry: defRamp('parry', ['#ffffff', '#fffbe0', '#fff0a0', '#ffd860', '#ffa040'], '#fff0b0'),
  flash: defRamp('flash', ['#ffffff', '#fff8d8', '#ffe8a0'], '#ffe8b0'),
  fireball: defRamp('fireball', ['#ffffff', '#fff2b0', '#ffd050', '#ff9a2a', '#e8541a', '#9a2a10', '#4a1a14'], '#ff9a3a'),
};

// ---------------------------------------------------------------- helpers
const rnd = Math.random;
const rr = (a: number, b: number) => a + rnd() * (b - a);
const ri = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));

export class Particles {
  /** tile map for floor collision (blood/debris/drips); see setMap() */
  map: TileMap | null = null;
  /** where glowing particles push their lights (shared with Lighting by default) */
  glow: GlowSink = glowSink;
  /** global multiplier on emitted counts (lower it on weak devices) */
  density = 1;

  private n = 0;
  private steal = 0;
  private time = 0;
  private ambN = 0;
  private ambAcc = new Float32Array(6);
  private readonly x = new Float32Array(MAX_PARTICLES);
  private readonly y = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly max = new Float32Array(MAX_PARTICLES);
  private readonly s0 = new Float32Array(MAX_PARTICLES);
  private readonly s1 = new Float32Array(MAX_PARTICLES);
  private readonly g = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly alpha = new Float32Array(MAX_PARTICLES);
  private readonly glowR = new Float32Array(MAX_PARTICLES);
  /** streak length factor, or wobble amplitude */
  private readonly aux = new Float32Array(MAX_PARTICLES);
  private readonly phase = new Float32Array(MAX_PARTICLES);
  private readonly ramp = new Uint16Array(MAX_PARTICLES);
  private readonly flags = new Uint16Array(MAX_PARTICLES);

  /** Number of live particles. */
  get count(): number {
    return this.n;
  }

  /** Enable tile collision (blood settles, debris bounces, drips splash). */
  setMap(map: TileMap | null): void {
    this.map = map;
  }

  // -------------------------------------------------------------- pool
  private add(
    x: number, y: number, vx: number, vy: number, life: number, ramp: number,
    s0: number, s1: number, g: number, drag: number, flags: number,
    alpha = 1, glow = 0, aux = 1,
  ): number {
    let i: number;
    if (this.n < MAX_PARTICLES) i = this.n++;
    else {
      // pool full: recycle slots round-robin so new effects always show
      i = this.steal;
      this.steal = (this.steal + 1) % MAX_PARTICLES;
    }
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.ramp[i] = ramp;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.g[i] = g;
    this.drag[i] = drag;
    this.flags[i] = flags;
    this.alpha[i] = alpha;
    this.glowR[i] = glow;
    this.aux[i] = aux;
    this.phase[i] = rnd() * 6.283;
    return i;
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.max[i] = this.max[j];
    this.ramp[i] = this.ramp[j];
    this.s0[i] = this.s0[j];
    this.s1[i] = this.s1[j];
    this.g[i] = this.g[j];
    this.drag[i] = this.drag[j];
    this.flags[i] = this.flags[j];
    this.alpha[i] = this.alpha[j];
    this.glowR[i] = this.glowR[j];
    this.aux[i] = this.aux[j];
    this.phase[i] = this.phase[j];
  }

  // -------------------------------------------------------------- emit
  emit(preset: ParticlePreset, x: number, y: number, o: EmitOpts = {}): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const pw = o.power ?? 1;
    const lm = o.life ?? 1;
    const dir = o.dir ?? 0;
    const dens = this.density;
    const cnt = (def: number) => Math.max(0, Math.round((o.count ?? def) * dens));
    const aw = o.w ?? 0;
    const ah = o.h ?? 0;
    const ivx = o.vx ?? 0;
    const ivy = o.vy ?? 0;
    // main direction angle
    const base = o.angle ?? (dir > 0 ? 0 : dir < 0 ? Math.PI : -Math.PI / 2);
    const px = () => (aw ? x + (rnd() - 0.5) * aw : x);
    const py = () => (ah ? y + (rnd() - 0.5) * ah : y);
    const first = this.n;

    switch (preset) {
      case 'hit': {
        const spread = dir || o.angle !== undefined ? 0.85 : Math.PI;
        const n = cnt(9);
        for (let i = 0; i < n; i++) {
          const a = base + rr(-spread, spread) - 0.2;
          const s = rr(140, 360) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s + ivy, rr(0.1, 0.26) * lm, R.spark, 1, 1, 420, 5, ADD | STREAK, 1, i < 3 ? 10 : 0, 1.2);
        }
        // short bright white slash streak along the hit direction
        const sa = base + rr(-0.15, 0.15);
        this.add(x, y, Math.cos(sa) * 620, Math.sin(sa) * 620, 0.07 * lm, R.white, 2, 1, 0, 2, ADD | STREAK, 1, 18, 1.7);
        this.add(x, y, -Math.cos(sa) * 260, -Math.sin(sa) * 260, 0.05 * lm, R.white, 1, 1, 0, 2, ADD | STREAK, 0.8, 0, 1.2);
        // droplets of the target's colour
        const br = o.color ? rampFor(o.color) : R.blood;
        const nb = Math.round(ri(3, 5) * dens);
        for (let i = 0; i < nb; i++) {
          const a = base + rr(-0.7, 0.4) - 0.35;
          const s = rr(50, 170) * pw;
          this.add(px(), py(), Math.cos(a) * s, Math.sin(a) * s - 40, rr(0.45, 0.8) * lm, br, ri(1, 2), 1, 900, 0.5, SETTLE | FADE);
        }
        break;
      }
      case 'blood': {
        const br = o.color ? rampFor(o.color) : R.blood;
        const n = cnt(12);
        const spread = dir ? 0.8 : 1.4;
        const b = dir ? base - 0.45 * dir : -Math.PI / 2;
        for (let i = 0; i < n; i++) {
          const a = b + rr(-spread, spread);
          const s = rr(50, 210) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s - 30 + ivy, rr(0.5, 0.95) * lm, br, ri(1, 3), 1, 950, 0.4, SETTLE | FADE);
        }
        break;
      }
      case 'spark': {
        const n = cnt(12);
        const spread = dir || o.angle !== undefined ? 1.0 : Math.PI;
        for (let i = 0; i < n; i++) {
          const a = base + rr(-spread, spread) - (dir ? 0.3 : 0);
          const s = rr(150, 400) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s + ivy, rr(0.18, 0.42) * lm, R.spark, 1, 1, 650, 2.5, ADD | STREAK | BOUNCE, 1, i < 2 ? 12 : 0, 1);
        }
        this.add(x, y, 0, 0, 0.08, R.flash, 3, 1, 0, 0, ADD, 1, 28);
        break;
      }
      case 'dust': {
        const n = cnt(5);
        const r = o.color ? rampFor(o.color) : R.dust;
        for (let i = 0; i < n; i++) {
          const s = rr(10, 40) * pw;
          const a = rr(0, Math.PI * 2);
          this.add(px(), py(), Math.cos(a) * s + dir * 20 + ivx, Math.sin(a) * s * 0.5 - 12 + ivy, rr(0.35, 0.65) * lm, r, 2, ri(3, 4), -10, 3, FADE, 0.55);
        }
        break;
      }
      case 'land': {
        const n = cnt(8);
        const r = o.color ? rampFor(o.color) : R.dust;
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? 1 : -1;
          const s = rr(35, 95) * pw;
          this.add(x + side * rr(2, 7), y - rr(0, 2), side * s, -rr(5, 24), rr(0.3, 0.5) * lm, r, 2, ri(3, 4), -6, 5, FADE, 0.6);
        }
        break;
      }
      case 'jump': {
        const n = cnt(5);
        const r = o.color ? rampFor(o.color) : R.dust;
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? 1 : -1;
          this.add(x + side * rr(1, 5), y - 1, side * rr(15, 45) * pw - dir * 15, rr(-6, 14), rr(0.22, 0.38) * lm, r, 2, 3, 0, 5, FADE, 0.5);
        }
        break;
      }
      case 'roll': {
        const n = cnt(4);
        const r = o.color ? rampFor(o.color) : R.dust;
        for (let i = 0; i < n; i++) {
          this.add(x - dir * rr(4, 10), y - rr(0, 3), -dir * rr(25, 75) * pw, -rr(4, 22), rr(0.25, 0.42) * lm, r, 2, ri(3, 4), -8, 4, FADE, 0.5);
        }
        break;
      }
      case 'cell': {
        const r = o.color ? rampFor(o.color, 'glow') : R.cell;
        const n = cnt(8);
        for (let i = 0; i < n; i++) {
          const a = rr(0, Math.PI * 2);
          const s = rr(30, 110) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s - 30 + ivy, rr(0.55, 1.0) * lm, r, ri(1, 2), 1, -40, 2.2, ADD | TRAIL | FADE, 1, i < 4 ? 12 : 0);
        }
        break;
      }
      case 'gold': {
        const n = cnt(7);
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + rr(-1.2, 1.2);
          const s = rr(30, 100) * pw;
          const cross = i % 3 === 0;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s + ivy, rr(0.3, 0.6) * lm, R.gold, cross ? 2 : 1, 1, 220, 2, ADD | FADE | (cross ? CROSS : 0), 1, i < 2 ? 9 : 0);
        }
        break;
      }
      case 'fire': {
        const r = o.color ? rampFor(o.color, 'glow') : R.fire;
        const n = cnt(2);
        for (let i = 0; i < n; i++) {
          this.add(px() + rr(-3, 3), py() + rr(-2, 2), rr(-14, 14) + ivx, -rr(30, 75) * pw + ivy, rr(0.3, 0.65) * lm, r, ri(2, 3), 1, -50, 1.5, ADD | WOBBLE, 1, i === 0 ? 11 : 0, 22);
        }
        break;
      }
      case 'ice': {
        const n = cnt(10);
        const spread = dir || o.angle !== undefined ? 1.0 : Math.PI;
        for (let i = 0; i < n; i++) {
          const a = base + rr(-spread, spread) - 0.2;
          const s = rr(70, 230) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s - 20 + ivy, rr(0.3, 0.6) * lm, R.ice, ri(1, 2), 1, 520, 1.5, ADD | STREAK | BOUNCE | FADE, 1, i < 3 ? 10 : 0, 0.7);
        }
        break;
      }
      case 'smoke': {
        const n = cnt(5);
        const r = o.color ? rampFor(o.color) : R.smoke;
        for (let i = 0; i < n; i++) {
          this.add(px() + rr(-4, 4), py() + rr(-3, 3), rr(-18, 18) * pw + ivx, -rr(16, 42) * pw + ivy, rr(0.8, 1.4) * lm, r, ri(3, 4), ri(5, 7), -12, 1.2, FADE | FADEIN | WOBBLE, 0.5, 0, 8);
        }
        break;
      }
      case 'explosion': {
        const k = Math.sqrt(pw);
        // light flash (invisible, only lights the light map) + white-hot core
        this.add(x, y, 0, 0, 0.3 * lm, R.flash, 1, 1, 0, 0, ADD | INVIS | FADE, 1, 120 * k);
        for (let i = 0; i < 3; i++) this.add(x + rr(-4, 4), y + rr(-4, 4), 0, 0, rr(0.07, 0.11), R.flash, Math.round(16 * k), 4, 0, 0, ADD, 1, 0);
        // fireball
        const nf = cnt(Math.round(30 * k));
        for (let i = 0; i < nf; i++) {
          const a = rr(0, Math.PI * 2);
          const s = rr(40, 230) * pw;
          this.add(x + rr(-5, 5), y + rr(-5, 5), Math.cos(a) * s, Math.sin(a) * s - 40, rr(0.22, 0.55) * lm, R.fireball, ri(3, 6), 1, -80, 4.5, ADD, 1, i < 5 ? 18 : 0);
        }
        // sparks
        const ns = Math.round(12 * k * dens);
        for (let i = 0; i < ns; i++) {
          const a = rr(0, Math.PI * 2);
          const s = rr(200, 420) * pw;
          this.add(x, y, Math.cos(a) * s, Math.sin(a) * s - 60, rr(0.25, 0.6) * lm, R.spark, 1, 1, 700, 1.8, ADD | STREAK | BOUNCE, 1, 0, 1);
        }
        // smoke
        const nsm = Math.round(10 * k * dens);
        for (let i = 0; i < nsm; i++) {
          const a = rr(0, Math.PI * 2);
          const s = rr(20, 90) * pw;
          this.add(x + rr(-8, 8), y + rr(-8, 8), Math.cos(a) * s, Math.sin(a) * s * 0.6 - 30, rr(0.9, 1.7) * lm, R.soot, ri(5, 8), ri(9, 12), -25, 2.2, FADE | FADEIN | WOBBLE, 0.6, 0, 10);
        }
        // debris
        const nd = Math.round(8 * k * dens);
        for (let i = 0; i < nd; i++) {
          const a = -Math.PI / 2 + rr(-1.3, 1.3);
          const s = rr(150, 340) * pw;
          this.add(x, y, Math.cos(a) * s, Math.sin(a) * s, rr(0.8, 1.4) * lm, R.soot, ri(2, 3), 2, 1200, 0.3, BOUNCE | FADE);
        }
        break;
      }
      case 'embers': {
        const n = cnt(6);
        for (let i = 0; i < n; i++) {
          this.add(px() + rr(-6, 6), py() + rr(-6, 6), rr(-12, 12) + ivx, -rr(15, 45) * pw + ivy, rr(1.2, 2.6) * lm, R.ember, ri(1, 2), 1, -6, 0.6, ADD | WOBBLE | FADE | FADEIN, 1, i < 3 ? 7 : 0, 16);
        }
        break;
      }
      case 'heal': {
        const n = cnt(14);
        for (let i = 0; i < n; i++) {
          const red = o.color ? false : i % 3 === 2;
          const r = o.color ? rampFor(o.color, 'glow') : red ? R.healRed : R.heal;
          const cross = i % 4 === 0;
          this.add(px() + rr(-9, 9), py() + rr(-14, 4), rr(-18, 18) + ivx, -rr(35, 95) * pw + ivy, rr(0.55, 1.0) * lm, r, cross ? 2 : ri(1, 2), 1, -30, 1.8, ADD | WOBBLE | FADE | (cross ? CROSS : 0), 1, i < 4 ? 10 : 0, 14);
        }
        break;
      }
      case 'debris': {
        const n = cnt(6);
        const r = o.color ? rampFor(o.color) : R.debris;
        for (let i = 0; i < n; i++) {
          const a = (dir ? base - dir * 0.6 : -Math.PI / 2) + rr(-1.0, 1.0);
          const s = rr(80, 240) * pw;
          this.add(px() + rr(-6, 6), py() + rr(-6, 6), Math.cos(a) * s + ivx, Math.sin(a) * s - 40 + ivy, rr(0.8, 1.5) * lm, r, ri(2, 3), 2, 1150, 0.3, BOUNCE | FADE);
        }
        // a puff of grit
        for (let i = 0; i < Math.round(3 * dens); i++) this.add(x + rr(-6, 6), y + rr(-6, 6), rr(-25, 25), -rr(5, 25), rr(0.4, 0.7), R.dust, 2, 4, -5, 3, FADE, 0.45);
        break;
      }
      case 'death': {
        const n = cnt(16);
        const c = o.color ? rampFor(o.color, 'glow') : rampFor('#ff7a3c', 'glow');
        for (let i = 0; i < n; i++) {
          const a = rr(0, Math.PI * 2);
          const s = rr(20, 90) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s - 30 + ivy, rr(0.5, 1.0) * lm, R.dark, ri(2, 4), 1, -50, 2.5, FADE | WOBBLE, 0.9, 0, 10);
        }
        const nc = Math.round(n * 0.7);
        for (let i = 0; i < nc; i++) {
          const a = rr(0, Math.PI * 2);
          const s = rr(30, 120) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s - 40 + ivy, rr(0.45, 0.9) * lm, c, ri(1, 2), 1, -70, 2.5, ADD | TRAIL | FADE, 1, i < 4 ? 10 : 0);
        }
        break;
      }
      case 'parry': {
        const n = cnt(18);
        const r = o.color ? rampFor(o.color, 'glow') : R.parry;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rr(-0.08, 0.08);
          const s = rr(230, 300) * pw;
          this.add(x + Math.cos(a) * 3, y + Math.sin(a) * 3, Math.cos(a) * s, Math.sin(a) * s, rr(0.16, 0.24) * lm, r, 1, 1, 0, 7, ADD | STREAK, 1, i % 4 === 0 ? 10 : 0, 1.4);
        }
        this.add(x, y, 0, 0, 0.18, R.flash, 1, 1, 0, 0, ADD | INVIS | FADE, 1, 70);
        this.add(x, y, 0, 0, 0.07, R.flash, 7, 2, 0, 0, ADD, 1, 0);
        break;
      }
      case 'magic': {
        const n = cnt(10);
        const r = o.color ? rampFor(o.color, 'glow') : R.magic;
        for (let i = 0; i < n; i++) {
          const a = rr(0, Math.PI * 2);
          const s = rr(15, 70) * pw;
          this.add(px(), py(), Math.cos(a) * s + ivx, Math.sin(a) * s - 25 + ivy, rr(0.5, 0.95) * lm, r, ri(1, 2), 1, -40, 2, ADD | WOBBLE | FADE | (i % 4 === 0 ? CROSS : 0), 1, i < 3 ? 10 : 0, 14);
        }
        break;
      }
      case 'slam': {
        const n = cnt(22);
        const r = o.color ? rampFor(o.color) : R.dust;
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? 1 : -1;
          const s = rr(70, 260) * pw;
          this.add(x + side * rr(0, 10), y - rr(0, 3), side * s, -rr(8, 45) * pw, rr(0.35, 0.65) * lm, r, ri(2, 3), ri(4, 6), 30, 4, FADE, 0.65);
        }
        for (let i = 0; i < Math.round(8 * dens); i++) {
          const a = -Math.PI / 2 + rr(-1.1, 1.1);
          const s = rr(120, 260) * pw;
          this.add(x + rr(-10, 10), y - 2, Math.cos(a) * s, Math.sin(a) * s, rr(0.6, 1.1) * lm, R.debris, 2, 2, 1150, 0.3, BOUNCE | FADE);
        }
        this.add(x, y - 6, 0, 0, 0.12, R.flash, 1, 1, 0, 0, ADD | INVIS | FADE, 0.8, 50);
        break;
      }
      case 'drip': {
        const n = cnt(1);
        for (let i = 0; i < n; i++) this.add(px(), py(), ivx, 10 + ivy, 2.2 * lm, R.water, 1, 1, 650, 0, STREAK | SPLASH | FADE, 0.85, 0, 1.4);
        break;
      }
    }
    // inherited velocity for presets that did not apply it themselves is harmless to skip
    if (first === this.n && this.n >= MAX_PARTICLES) return;
  }

  private splash(x: number, y: number): void {
    const n = ri(2, 3);
    for (let i = 0; i < n; i++) this.add(x + rr(-1, 1), y - 1, rr(-35, 35), -rr(30, 70), rr(0.15, 0.28), R.water, 1, 1, 600, 0, FADE, 0.8);
  }

  // -------------------------------------------------------------- ambient atmosphere
  /**
   * Biome atmosphere around the camera view. Call once per simulation step
   * (e.g. from the level renderer or scene update) with the step's dt.
   * biome: 'prison' | 'ramparts' | 'tower' | 'passage' (unknown = nothing).
   */
  ambient(biome: string, cam: Pick<Camera, 'x' | 'y' | 'w' | 'h'>, dt = 1 / 60, map?: TileMap | null): void {
    if (map) this.map = map;
    if (this.ambN >= AMBIENT_CAP) return;
    const acc = this.ambAcc;
    const vx0 = cam.x;
    const vy0 = cam.y;
    const W = cam.w;
    const H = cam.h;
    switch (biome) {
      case 'prison': {
        acc[0] += dt * 1.8;
        while (acc[0] >= 1) {
          acc[0] -= 1;
          this.ambientDrip(vx0 + rnd() * W, vy0 + rnd() * H);
        }
        acc[1] += dt * 5;
        while (acc[1] >= 1) {
          acc[1] -= 1;
          this.add(vx0 + rnd() * W, vy0 + rnd() * H, rr(-4, 4), rr(-3, 3), rr(3, 6), R.mote, 1, 1, rr(-2, 2), 0, AMBIENT | WOBBLE | FADE | FADEIN, rr(0.35, 0.6), 0, rr(3, 7));
        }
        break;
      }
      case 'ramparts': {
        acc[0] += dt * 3.2;
        while (acc[0] >= 1) {
          acc[0] -= 1;
          const s = rr(60, 130);
          this.add(vx0 - 6, vy0 + rnd() * H * 0.9, s, rr(-5, 25), (W + 20) / s, R.leaf, 2, 2, 0, 0, AMBIENT | WOBBLE | FADEIN, 0.95, 0, rr(18, 34));
        }
        acc[1] += dt * 4;
        while (acc[1] >= 1) {
          acc[1] -= 1;
          const s = rr(180, 280);
          this.add(vx0 + rnd() * W * 0.5, vy0 + rnd() * H, s, rr(-4, 4), rr(0.5, 0.9), R.wind, 1, 1, 0, 0, AMBIENT | STREAK | FADE | FADEIN, 0.3, 0, 1.6);
        }
        break;
      }
      case 'tower': {
        acc[0] += dt * 7;
        while (acc[0] >= 1) {
          acc[0] -= 1;
          this.add(vx0 + rnd() * W, vy0 + H * rr(0.6, 1.05), rr(-8, 8), -rr(18, 55), rr(3, 6), R.ember, ri(1, 2), 1, -4, 0.3, AMBIENT | ADD | WOBBLE | FADE | FADEIN, 1, rnd() < 0.4 ? 6 : 0, rr(10, 22));
        }
        break;
      }
      case 'passage': {
        acc[0] += dt * 3;
        while (acc[0] >= 1) {
          acc[0] -= 1;
          this.add(vx0 + rnd() * W, vy0 + rnd() * H, rr(-4, 4), rr(-6, 0), rr(3, 6), R.warmMote, 1, 1, -1, 0, AMBIENT | WOBBLE | FADE | FADEIN, rr(0.35, 0.6), 0, rr(4, 8));
        }
        acc[1] += dt * 0.7;
        while (acc[1] >= 1) {
          acc[1] -= 1;
          this.add(vx0 + rnd() * W, vy0 + H * rr(0.7, 1), rr(-6, 6), -rr(15, 35), rr(3, 5), R.ember, 1, 1, -3, 0.3, AMBIENT | ADD | WOBBLE | FADE | FADEIN, 1, 5, 12);
        }
        break;
      }
    }
  }

  /** Find a ceiling above (x, y) and start a drip there (needs the map). */
  private ambientDrip(x: number, y: number): void {
    const m = this.map;
    if (!m) return;
    const tx = Math.floor(x / TILE);
    let ty = Math.floor(y / TILE);
    if (m.isSolid(tx, ty)) return;
    for (let k = 0; k < 10; k++, ty--) {
      if (m.isSolid(tx, ty - 1)) {
        this.add(tx * TILE + 3 + rnd() * (TILE - 6), ty * TILE + 1, 0, 5, 2.4, R.water, 1, 1, 650, 0, STREAK | SPLASH | FADE | AMBIENT, 0.8, 0, 1.4);
        return;
      }
    }
  }

  // -------------------------------------------------------------- simulation
  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const map = this.map;
    const X = this.x, Y = this.y, VX = this.vx, VY = this.vy, L = this.life, F = this.flags;
    let amb = 0;
    let i = 0;
    while (i < this.n) {
      const l = L[i] - dt;
      if (l <= 0) {
        this.kill(i);
        continue;
      }
      L[i] = l;
      let f = F[i];
      if (f & AMBIENT) amb++;
      if (f & SETTLED) {
        i++;
        continue;
      }
      let vx = VX[i];
      let vy = VY[i];
      const d = this.drag[i];
      if (d > 0) {
        const k = 1 / (1 + d * dt);
        vx *= k;
        vy *= k;
      }
      vy += this.g[i] * dt;
      const ox = X[i];
      const oy = Y[i];
      let nx = ox + vx * dt;
      let ny = oy + vy * dt;
      if (f & WOBBLE) {
        const ph = this.phase[i] + this.time * 2.6;
        const amp = this.aux[i];
        nx += Math.sin(ph) * amp * dt;
        ny += Math.cos(ph * 1.37) * amp * 0.35 * dt;
      }
      if (map && f & COLLIDE) {
        const tx = Math.floor(nx / TILE);
        const ty = Math.floor(ny / TILE);
        const t = map.get(tx, ty);
        const solid = t === T.Solid || t === T.Breakable;
        const top = ty * TILE;
        if (solid || (t === T.Platform && vy > 0 && oy <= top)) {
          if (oy <= top && vy >= 0) {
            // floor
            ny = top - 0.5;
            if (f & SPLASH) {
              this.kill(i);
              this.splash(nx, top);
              continue;
            }
            if (f & SETTLE) {
              f |= SETTLED;
              vx = vy = 0;
              const sl = rr(2.5, 4.5);
              L[i] = sl;
              this.max[i] = sl;
            } else {
              vy = -vy * 0.35;
              vx *= 0.6;
              if (vy > -30) vy = 0;
            }
          } else if (solid) {
            const otx = Math.floor(ox / TILE);
            if (otx !== tx) {
              // wall
              nx = ox;
              if (f & SETTLE && rnd() < 0.6) {
                f |= SETTLED;
                vx = vy = 0;
                const sl = rr(1.5, 3);
                L[i] = sl;
                this.max[i] = sl;
              } else vx = -vx * 0.4;
            } else if (vy < 0) {
              ny = oy;
              vy = -vy * 0.3;
            } else {
              this.kill(i);
              continue;
            }
          }
          F[i] = f;
        }
      }
      X[i] = nx;
      Y[i] = ny;
      VX[i] = vx;
      VY[i] = vy;
      i++;
    }
    this.ambN = amb;
  }

  // -------------------------------------------------------------- drawing
  draw(ctx: CanvasRenderingContext2D): void {
    const sink = this.glow;
    sink.reset();
    if (!this.n) return;
    // view culling from the current transform (camera translation)
    let cx0 = -Infinity, cy0 = -Infinity, cx1 = Infinity, cy1 = Infinity;
    const tr = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (tr && ctx.canvas && tr.a === 1 && tr.d === 1) {
      cx0 = -tr.e - 16;
      cy0 = -tr.f - 16;
      cx1 = cx0 + ctx.canvas.width + 32;
      cy1 = cy0 + ctx.canvas.height + 32;
    }
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    this.drawPass(ctx, false, cx0, cy0, cx1, cy1);
    ctx.globalCompositeOperation = 'lighter';
    this.drawPass(ctx, true, cx0, cy0, cx1, cy1);
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevAlpha;
  }

  private drawPass(ctx: CanvasRenderingContext2D, additive: boolean, cx0: number, cy0: number, cx1: number, cy1: number): void {
    const X = this.x, Y = this.y, F = this.flags, sink = this.glow;
    let curColor = '';
    let curAlpha = -1;
    for (let i = 0, n = this.n; i < n; i++) {
      const f = F[i];
      if (((f & ADD) !== 0) !== additive) continue;
      const x = X[i];
      const y = Y[i];
      if (x < cx0 || x > cx1 || y < cy0 || y > cy1) continue;
      const lf = this.life[i] / this.max[i];
      const t = 1 - lf;
      let a = this.alpha[i];
      if (f & FADE) a *= lf < 0.4 ? lf * 2.5 : 1;
      if (f & FADEIN) a *= t < 0.15 ? t / 0.15 : 1;
      const ramp = RAMPS[this.ramp[i]];
      const gr = this.glowR[i];
      if (gr > 0 && sink.n < sink.max) sink.push(x, y, gr * (0.5 + 0.5 * lf), ramp.glow, a);
      if (f & INVIS) continue;
      const aq = Math.round(a * 8) / 8;
      if (aq <= 0) continue;
      const sz = Math.round(this.s0[i] + (this.s1[i] - this.s0[i]) * t);
      if (sz <= 0) continue;
      const cs = ramp.c;
      const color = f & SETTLED ? cs[cs.length - 1] : cs[Math.min(cs.length - 1, (t * cs.length) | 0)];
      if (color !== curColor) {
        ctx.fillStyle = color;
        curColor = color;
      }
      if (aq !== curAlpha) {
        ctx.globalAlpha = aq;
        curAlpha = aq;
      }
      const px = Math.round(x);
      const py = Math.round(y);
      if (f & STREAK) {
        const vx = this.vx[i];
        const vy = this.vy[i];
        const sp = Math.abs(vx) + Math.abs(vy);
        const len = Math.min(12, 1 + ((sp * this.aux[i] * 0.02) | 0));
        if (len <= 1 || sp < 1) {
          ctx.fillRect(px, py, sz, sz);
        } else {
          const ux = -vx / sp;
          const uy = -vy / sp;
          const m = Math.max(Math.abs(ux), Math.abs(uy));
          const sx = ux / m;
          const sy = uy / m;
          for (let k = 0; k < len; k++) ctx.fillRect(Math.round(x + sx * k), Math.round(y + sy * k), sz, sz);
        }
      } else if (f & CROSS) {
        const arm = sz + (Math.sin(this.time * 18 + this.phase[i]) > 0 ? 1 : 0);
        ctx.fillRect(px - arm, py, arm * 2 + 1, 1);
        ctx.fillRect(px, py - arm, 1, arm * 2 + 1);
      } else if (f & TRAIL) {
        ctx.fillRect(px, py, sz, sz);
        const vx = this.vx[i];
        const vy = this.vy[i];
        const sp = Math.abs(vx) + Math.abs(vy);
        if (sp > 20) {
          const ux = -vx / sp;
          const uy = -vy / sp;
          const m = Math.max(Math.abs(ux), Math.abs(uy));
          const tl = sp > 80 ? 4 : 2;
          const tc = cs[Math.min(cs.length - 1, ((t * cs.length) | 0) + 1)];
          ctx.fillStyle = tc;
          ctx.globalAlpha = aq * 0.6;
          for (let k = 1; k <= tl; k++) ctx.fillRect(Math.round(x + (ux / m) * k), Math.round(y + (uy / m) * k), 1, 1);
          ctx.fillStyle = color;
          ctx.globalAlpha = aq;
        }
      } else if (sz >= 4) {
        // pixel octagon blob
        const h = sz >> 1;
        const k = Math.max(1, Math.round(sz * 0.28));
        ctx.fillRect(px - h, py - h + k, sz, sz - 2 * k);
        ctx.fillRect(px - h + k, py - h, sz - 2 * k, sz);
      } else {
        ctx.fillRect(px - (sz >> 1), py - (sz >> 1), sz, sz);
      }
    }
  }

  clear(): void {
    this.n = 0;
    this.steal = 0;
    this.ambN = 0;
    this.glow.reset();
  }
}
