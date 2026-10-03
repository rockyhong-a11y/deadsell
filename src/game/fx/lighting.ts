import type { Camera } from '../../engine/camera';
import { fxEnv, glowSink } from './glow';
import { parseHex } from './particles';

/**
 * Immediate-mode 2D lighting: everything that glows calls `add()` every frame (usually from its
 * draw()); `render()` darkens the scene with the biome's ambient colour and punches coloured
 * light into it, then clears the list.
 *
 * Pipeline (all at the world-buffer resolution, nothing allocated per frame):
 *  1. light map: a half-resolution offscreen canvas filled with the ambient colour; every visible
 *     light (+ every emissive particle halo from `glowSink`) is added with 'lighter' using cached
 *     radial-gradient sprites (one per quantised colour and radius bucket). Flicker modulates
 *     intensity and radius with a sum of sines.
 *  2. composite: the light map is drawn over the scene with 'multiply' (bilinear upscale, so the
 *     light stays smooth while the scene stays pixel-crisp). Where light >= white the scene keeps
 *     its full brightness; coloured light tints it (warm torch pools, cold player glow).
 *  3. bloom: strong lights get an additive halo drawn straight onto the scene.
 *  4. vignette: a cached radial gradient darkens the corners.
 *
 * Ambient is clamped so the scene never goes pitch black (the player must always read).
 */
export interface Light { x: number; y: number; r: number; color: string; intensity: number; flicker: number; }

export type LevelKind = 'biome' | 'passage' | 'boss';

export interface Mood {
  /** multiply colour where there is no light */
  ambient: string;
  /** 0..1 corner darkening */
  vignette: number;
  /** multiplier on the additive bloom of strong lights */
  bloom: number;
  /** slow ambient breathing (0 = none), e.g. firelight in the tower */
  breathe?: number;
  /** emissive-particle atmosphere key for `Particles.ambient` */
  atmosphere: string;
}

/** Per-biome look. Ambient is the *minimum* brightness, lights add on top of it. */
export const MOODS: Record<string, Mood> = {
  // sunken prison: deep teal-green, wet and gloomy
  prison: { ambient: '#86b2a7', vignette: 0.42, bloom: 1, atmosphere: 'prison' },
  // moonlit ramparts: purple-blue, lighter and airy
  ramparts: { ambient: '#a4a8dc', vignette: 0.34, bloom: 0.8, atmosphere: 'ramparts' },
  // bell tower: dark red-orange, firelit
  tower: { ambient: '#b27a72', vignette: 0.5, bloom: 1.25, breathe: 0.07, atmosphere: 'tower' },
  // passage: warm, safe, golden
  passage: { ambient: '#c9b08e', vignette: 0.28, bloom: 1.1, atmosphere: 'passage' },
};
const DEFAULT_MOOD: Mood = { ambient: '#7a7a8a', vignette: 0.4, bloom: 1, atmosphere: '' };

/** Lowest ambient channel value (0..255): keeps the scene readable. */
const MIN_AMBIENT = 52;
const MAX_LIGHTS = 96;
/** light-map scale relative to the world buffer */
const LM = 0.5;
const BUCKETS = [16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512];
const MAX_SPRITES = 120;

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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
    /* fall through */
  }
  return null;
}

function bucketFor(r: number): number {
  for (const b of BUCKETS) if (r <= b) return b;
  return BUCKETS[BUCKETS.length - 1];
}

/** quantise to 4 bits per channel so a few hundred ad-hoc colours share sprites */
function quant(color: string): { key: number; r: number; g: number; b: number } {
  const [r, g, b] = parseHex(color);
  const qr = (r + 8) >> 4, qg = (g + 8) >> 4, qb = (b + 8) >> 4;
  return { key: (Math.min(15, qr) << 8) | (Math.min(15, qg) << 4) | Math.min(15, qb), r: Math.min(255, qr * 17), g: Math.min(255, qg * 17), b: Math.min(255, qb * 17) };
}

const FALLOFF: [number, number][] = [[0, 1], [0.1, 0.82], [0.25, 0.58], [0.45, 0.32], [0.65, 0.14], [0.85, 0.04], [1, 0]];

export class Lighting {
  /** colour multiplied over the scene where there is no light; null = lighting off */
  ambient: string | null = null;
  /** corner darkening 0..1 */
  vignette = 0.4;
  /** bloom multiplier (0 disables the additive halos) */
  bloom = 1;
  /** master switch for the light-map pass (weak devices can turn it off; flat tint is used then) */
  enabled = true;

  private mood: Mood = DEFAULT_MOOD;
  private baseRGB: [number, number, number] = [122, 122, 138];
  private ambStr = '';
  private ambKey = -1;

  // light list: preallocated objects, reused every frame
  private readonly pool: Light[] = [];
  private n = 0;

  // offscreen light map + cached sprites
  private lm: Canvas2D | null = null;
  private lmc: Ctx2D | null = null;
  private lmW = 0;
  private lmH = 0;
  private readonly sprites = new Map<number, Canvas2D>();
  private vig: Canvas2D | null = null;
  private vigW = 0;
  private vigH = 0;
  private vigA = -1;

  constructor() {
    for (let i = 0; i < MAX_LIGHTS; i++) this.pool.push({ x: 0, y: 0, r: 0, color: '#fff', intensity: 0, flicker: 0 });
  }

  /** Pick ambient darkness and tint for a biome/level kind ('prison' | 'ramparts' | 'tower'). */
  setBiome(biome: string, kind: LevelKind | 'biome' | 'passage' | 'boss' = 'biome'): void {
    const key = kind === 'passage' ? 'passage' : kind === 'boss' ? 'tower' : biome;
    const m = MOODS[key] ?? MOODS[biome] ?? DEFAULT_MOOD;
    this.setMood(m);
    fxEnv.ambient = m.atmosphere;
  }

  /** Apply a custom mood (tests, cinematics). */
  setMood(m: Mood): void {
    this.mood = m;
    this.ambient = m.ambient;
    this.vignette = m.vignette;
    this.bloom = m.bloom;
    const [r, g, b] = parseHex(m.ambient);
    this.baseRGB = [Math.max(MIN_AMBIENT, r), Math.max(MIN_AMBIENT, g), Math.max(MIN_AMBIENT, b)];
    this.ambKey = -1;
  }

  /** Number of lights queued for the next render(). */
  get count(): number {
    return this.n;
  }

  add(x: number, y: number, r: number, color: string, intensity = 1, flicker = 0): void {
    if (this.n >= MAX_LIGHTS || !(r > 0) || !(intensity > 0)) return;
    const l = this.pool[this.n++];
    l.x = x;
    l.y = y;
    l.r = r;
    l.color = color;
    l.intensity = intensity;
    l.flicker = flicker;
  }

  /** Drop all queued lights without drawing (scene change). */
  clear(): void {
    this.n = 0;
    glowSink.reset();
  }

  // -------------------------------------------------------------- sprites
  private sprite(color: string, bucket: number): { c: Canvas2D | null; q: ReturnType<typeof quant> } {
    const q = quant(color);
    const key = (q.key << 12) | bucket;
    let spr = this.sprites.get(key);
    if (!spr) {
      if (this.sprites.size >= MAX_SPRITES) this.sprites.clear();
      const c = makeCanvas(bucket, bucket);
      const g = c?.getContext('2d') as Ctx2D | null;
      if (!c || !g) return { c: null, q };
      const h = bucket / 2;
      const grad = g.createRadialGradient(h, h, 0, h, h, h);
      for (const [t, a] of FALLOFF) grad.addColorStop(t, `rgba(${q.r},${q.g},${q.b},${a})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, bucket, bucket);
      this.sprites.set(key, c);
      spr = c;
    }
    return { c: spr, q };
  }

  private ensureMap(w: number, h: number): boolean {
    const lw = Math.max(1, Math.ceil(w * LM));
    const lh = Math.max(1, Math.ceil(h * LM));
    if (!this.lm || this.lmW !== lw || this.lmH !== lh) {
      this.lm = makeCanvas(lw, lh);
      this.lmc = (this.lm?.getContext('2d') as Ctx2D | null) ?? null;
      this.lmW = lw;
      this.lmH = lh;
      this.vigA = -1;
    }
    return !!this.lmc;
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
    if (strength <= 0.01) return;
    const a = Math.round(strength * 20);
    if (!this.vig || this.vigW !== w || this.vigH !== h || this.vigA !== a) {
      const vw = Math.max(2, Math.ceil(w * LM)), vh = Math.max(2, Math.ceil(h * LM));
      if (!this.vig || this.vigW !== w || this.vigH !== h) this.vig = makeCanvas(vw, vh);
      const g = this.vig?.getContext('2d') as Ctx2D | null;
      if (!g || !this.vig) return;
      g.clearRect(0, 0, vw, vh);
      const grad = g.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.32, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.52);
      grad.addColorStop(0, 'rgba(6,4,12,0)');
      grad.addColorStop(0.6, `rgba(6,4,12,${(a / 20) * 0.35})`);
      grad.addColorStop(1, `rgba(6,4,12,${(a / 20) * 1.0})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, vw, vh);
      this.vigW = w;
      this.vigH = h;
      this.vigA = a;
    }
    if (this.vig) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.vig as CanvasImageSource, 0, 0, w, h);
    }
  }

  private ambientString(time: number): string {
    const m = this.mood;
    const k = m.breathe ? 1 + m.breathe * (Math.sin(time * 2.1) * 0.6 + Math.sin(time * 5.3 + 1.3) * 0.4) : 1;
    const key = Math.round(k * 64);
    if (key !== this.ambKey || !this.ambStr) {
      this.ambKey = key;
      const b = this.baseRGB;
      const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
      this.ambStr = `rgb(${f(b[0])},${f(b[1])},${f(b[2])})`;
    }
    return this.ambStr;
  }

  // -------------------------------------------------------------- render
  /**
   * Call after the world (entities, particles, foreground) is drawn into `ctx` with an IDENTITY
   * transform. `cam` supplies the view origin; `w`/`h` are the buffer size; `time` drives flicker.
   */
  render(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, time: number): void {
    const n = this.n;
    this.n = 0;
    const sinkN = glowSink.n;
    try {
      if (this.ambient === null || !this.enabled) return;
      if (!this.ensureMap(w, h) || !this.lmc) {
        // no offscreen canvas available: plain tint so the mood still shows
        this.flatTint(ctx, w, h, time);
        return;
      }
      const vx = typeof cam.viewX === 'number' ? cam.viewX : cam.x;
      const vy = typeof cam.viewY === 'number' ? cam.viewY : cam.y;
      const g = this.lmc as CanvasRenderingContext2D;

      // 1. light map
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.fillStyle = this.ambientString(time);
      g.fillRect(0, 0, this.lmW, this.lmH);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const l = this.pool[i];
        let it = l.intensity;
        let r = l.r;
        if (l.flicker > 0) {
          const ph = l.x * 0.131 + l.y * 0.071;
          const f = Math.sin(time * 17.3 + ph) * 0.5 + Math.sin(time * 31.7 + ph * 2.1) * 0.3 + Math.sin(time * 7.1 + ph * 0.7) * 0.2;
          it *= 1 + l.flicker * f;
          r *= 1 + l.flicker * 0.18 * f;
        }
        this.stamp(g, l.x - vx, l.y - vy, r, l.color, it, w, h);
      }
      const bloomK = this.bloom;
      for (let i = 0; i < sinkN; i++) this.stamp(g, glowSink.x[i] - vx, glowSink.y[i] - vy, glowSink.r[i], glowSink.c[i], glowSink.a[i] * 0.9, w, h);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;

      // 2. composite over the scene
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.lm as CanvasImageSource, 0, 0, w, h);

      // 3. bloom of strong lights and bright emissive particles
      if (bloomK > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) {
          const l = this.pool[i];
          if (l.intensity < 0.6) continue;
          let it = l.intensity;
          if (l.flicker > 0) {
            const ph = l.x * 0.131 + l.y * 0.071;
            it *= 1 + l.flicker * (Math.sin(time * 17.3 + ph) * 0.5 + Math.sin(time * 31.7 + ph * 2.1) * 0.3 + Math.sin(time * 7.1 + ph * 0.7) * 0.2);
          }
          this.bloomStamp(ctx, l.x - vx, l.y - vy, l.r * 0.75, l.color, Math.min(0.5, 0.2 * it * bloomK), w, h);
        }
        for (let i = 0; i < sinkN; i++) {
          if (glowSink.r[i] < 20 || glowSink.a[i] < 0.5) continue;
          this.bloomStamp(ctx, glowSink.x[i] - vx, glowSink.y[i] - vy, glowSink.r[i] * 0.8, glowSink.c[i], Math.min(0.45, 0.28 * glowSink.a[i] * bloomK), w, h);
        }
      }

      // 4. vignette
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      this.drawVignette(ctx, w, h, this.vignette);
      ctx.imageSmoothingEnabled = false;
      ctx.restore();
    } finally {
      glowSink.reset();
    }
  }

  /** Add one light sprite into the light map (light-map coordinates are world-view * LM). */
  private stamp(g: CanvasRenderingContext2D, sx: number, sy: number, r: number, color: string, intensity: number, w: number, h: number): void {
    if (r <= 0 || intensity <= 0.01) return;
    if (sx + r < 0 || sy + r < 0 || sx - r > w || sy - r > h) return;
    const bucket = bucketFor(r);
    const { c } = this.sprite(color, bucket);
    if (!c) return;
    const d = r * 2 * LM;
    const x = (sx - r) * LM;
    const y = (sy - r) * LM;
    g.globalAlpha = intensity > 1 ? 1 : intensity;
    g.drawImage(c as CanvasImageSource, x, y, d, d);
    if (intensity > 1) {
      g.globalAlpha = Math.min(1, intensity - 1);
      g.drawImage(c as CanvasImageSource, x, y, d, d);
    }
  }

  private bloomStamp(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number, color: string, alpha: number, w: number, h: number): void {
    if (alpha <= 0.01 || sx + r < 0 || sy + r < 0 || sx - r > w || sy - r > h) return;
    const { c } = this.sprite(color, bucketFor(r));
    if (!c) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(c as CanvasImageSource, sx - r, sy - r, r * 2, r * 2);
  }

  /** Fallback when no offscreen canvas exists: multiply the whole scene by the ambient colour. */
  private flatTint(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this.ambientString(time);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
