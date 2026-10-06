/**
 * Asset loading + sprite sheets (format: docs/DESIGN.md §8.1).
 * Missing files never crash the game: a placeholder sheet is substituted.
 */

export interface AnimDef {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
  windup?: number;
  active?: number;
  recover?: number;
}

export interface SheetManifest {
  image: string;
  frameW: number;
  frameH: number;
  anchor: [number, number];
  animations: Record<string, AnimDef>;
}

export interface DrawOpts {
  alpha?: number;
  /** 0..1 white overlay (hit flash) */
  flash?: number;
  /** colour of the flash overlay (default white) */
  flashColor?: string;
  scale?: number;
  /** draw a 1px coloured outline/aura around the sprite */
  outline?: string;
  /** composite operation for the main draw (e.g. 'lighter') */
  blend?: GlobalCompositeOperation;
  rotation?: number;
  /** draw the frame as a solid silhouette of this colour instead of its pixels (after-images) */
  tint?: string;
}

/** max cached frame silhouettes per sheet (a 288×224 boss frame is ~0.26 MB) */
const SILHOUETTE_CACHE = 96;

export class SpriteSheet {
  readonly name: string;
  readonly img: CanvasImageSource;
  readonly frameW: number;
  readonly frameH: number;
  readonly ax: number;
  readonly ay: number;
  readonly anims: Record<string, AnimDef>;
  readonly placeholder: boolean;
  /** per-frame silhouettes, LRU (Map keeps insertion order); see silhouette() */
  private silhouettes = new Map<string, HTMLCanvasElement>();

  constructor(name: string, img: CanvasImageSource, m: SheetManifest, placeholder = false) {
    this.name = name;
    this.img = img;
    this.frameW = m.frameW;
    this.frameH = m.frameH;
    this.ax = m.anchor[0];
    this.ay = m.anchor[1];
    this.anims = m.animations;
    this.placeholder = placeholder;
  }

  has(anim: string): boolean {
    return anim in this.anims;
  }

  /** The animation to play for `name`: itself, or its fallback while the art for it is not in the sheet (`ANIM_FALLBACK`). */
  resolve(name: string): string {
    return resolveAnim(this, name);
  }

  anim(name: string): AnimDef {
    return this.anims[name] ?? this.anims[Object.keys(this.anims)[0]] ?? { row: 0, frames: 1, fps: 1, loop: true };
  }

  /**
   * Solid-colour silhouette of ONE frame (source rect sx, sy), cached per colour + frame.
   * Per frame, not per sheet: a whole-sheet copy of the boss sheet is 65 MB, and iOS Safari caps the
   * total canvas memory of a page (~384 MB), so whole-sheet copies broke rendering on iPhones.
   * The cache is bounded; evicted canvases are shrunk to 0×0 so the browser frees their memory at once.
   */
  silhouette(color: string, sx: number, sy: number): HTMLCanvasElement {
    const key = `${color}|${sx}|${sy}`;
    let c = this.silhouettes.get(key);
    if (c) {
      this.silhouettes.delete(key);
      this.silhouettes.set(key, c);
      return c;
    }
    c = document.createElement('canvas');
    c.width = this.frameW;
    c.height = this.frameH;
    const x = c.getContext('2d')!;
    x.drawImage(this.img, sx, sy, this.frameW, this.frameH, 0, 0, this.frameW, this.frameH);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    this.silhouettes.set(key, c);
    if (this.silhouettes.size > SILHOUETTE_CACHE) {
      const oldest = this.silhouettes.keys().next().value as string;
      const old = this.silhouettes.get(oldest)!;
      old.width = old.height = 0;
      this.silhouettes.delete(oldest);
    }
    return c;
  }

  /** Draw frame `frame` of `anim` with its anchor at world (x, y). flip = face left. */
  draw(ctx: CanvasRenderingContext2D, anim: string, frame: number, x: number, y: number, flip = false, o: DrawOpts = {}): void {
    const a = this.anim(anim);
    const f = Math.max(0, Math.min(a.frames - 1, frame | 0));
    const sx = f * this.frameW;
    const sy = a.row * this.frameH;
    const s = o.scale ?? 1;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (o.rotation) ctx.rotate(o.rotation);
    ctx.scale(flip ? -s : s, s);
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    const dx = -this.ax;
    const dy = -this.ay;
    if (o.outline) {
      const sil = this.silhouette(o.outline, sx, sy);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        ctx.drawImage(sil, dx + ox, dy + oy);
      }
    }
    if (o.blend) ctx.globalCompositeOperation = o.blend;
    if (o.tint) ctx.drawImage(this.silhouette(o.tint, sx, sy), dx, dy);
    else ctx.drawImage(this.img, sx, sy, this.frameW, this.frameH, dx, dy, this.frameW, this.frameH);
    if (o.flash && o.flash > 0) {
      ctx.globalAlpha = (o.alpha ?? 1) * Math.min(1, o.flash);
      ctx.drawImage(this.silhouette(o.flashColor ?? '#ffffff', sx, sy), dx, dy);
    }
    ctx.restore();
  }
}

/**
 * Animations of the heroine that a sheet may not have drawn yet (docs/CONTENT4.md §5): the name they fall back to, in order,
 * until one exists in the sheet. Every `AnimPlayer` resolves the name it is asked to play through this table.
 */
export const ANIM_FALLBACK: Record<string, string[]> = {
  whip_1: ['spear_1'], whip_2: ['spear_2'],
  heavy_1: ['hammer_1'], heavy_2: ['hammer_2'], heavy_3: ['sword_3'],
  cast: ['throw'],
  sprint: ['run'],
};

/** `name` if the sheet has it, else the first of its fallbacks the sheet has, else `name` (the sheet then plays its first animation). */
export function resolveAnim(sheet: Pick<SpriteSheet, 'has'>, name: string): string {
  if (sheet.has(name)) return name;
  return ANIM_FALLBACK[name]?.find((n) => sheet.has(n)) ?? name;
}

/**
 * Plays animations of a sheet. Three timing modes:
 *  - play(name):            native fps (loops or holds last frame)
 *  - playFor(name, secs):   stretch the whole animation over `secs`
 *  - playPhased(name, w, a, r): stretch the sheet's windup/active/recover frame
 *                           ranges over the given gameplay durations (attacks)
 */
export class AnimPlayer {
  sheet: SpriteSheet;
  name = '';
  t = 0;
  speed = 1;
  private duration = 0;
  private phases: [number, number, number] | null = null;

  constructor(sheet: SpriteSheet) {
    this.sheet = sheet;
  }

  get def(): AnimDef {
    return this.sheet.anim(this.name);
  }

  play(name: string, restart = false): void {
    name = this.sheet.resolve(name);
    if (this.name === name && !restart && this.duration === 0 && !this.phases) return;
    this.name = name;
    this.t = 0;
    this.duration = 0;
    this.phases = null;
  }

  playFor(name: string, secs: number): void {
    this.name = this.sheet.resolve(name);
    this.t = 0;
    this.duration = Math.max(0.001, secs);
    this.phases = null;
  }

  playPhased(name: string, windup: number, active: number, recover: number): void {
    this.name = this.sheet.resolve(name);
    this.t = 0;
    this.duration = 0;
    this.phases = [windup, active, recover];
  }

  update(dt: number): void {
    this.t += dt * this.speed;
  }

  /** True once a non-looping animation reached its end. */
  get finished(): boolean {
    const d = this.def;
    if (this.phases) return this.t >= this.phases[0] + this.phases[1] + this.phases[2];
    if (this.duration) return this.t >= this.duration;
    return !d.loop && this.t * d.fps >= d.frames;
  }

  get frame(): number {
    const d = this.def;
    if (this.phases) {
      const counts = phaseCounts(d);
      let t = this.t;
      let start = 0;
      for (let i = 0; i < 3; i++) {
        const dur = this.phases[i];
        if (t < dur || i === 2) {
          const frac = dur > 0 ? Math.min(0.999, t / dur) : 0.999;
          return Math.min(d.frames - 1, start + Math.floor(frac * counts[i]));
        }
        t -= dur;
        start += counts[i];
      }
    }
    if (this.duration) return Math.min(d.frames - 1, Math.floor((this.t / this.duration) * d.frames));
    const f = Math.floor(this.t * d.fps);
    return d.loop ? f % d.frames : Math.min(d.frames - 1, f);
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, flip: boolean, o?: DrawOpts): void {
    this.sheet.draw(ctx, this.name, this.frame, x, y, flip, o);
  }
}

function phaseCounts(d: AnimDef): [number, number, number] {
  if (d.windup !== undefined && d.active !== undefined && d.recover !== undefined) return [d.windup, d.active, d.recover];
  const w = Math.max(1, Math.round(d.frames * 0.4));
  const a = Math.max(1, Math.round(d.frames * 0.2));
  return [w, a, Math.max(0, d.frames - w - a)];
}

// ---------------------------------------------------------------------------

export const SHEETS = [
  'heroine', 'ghoul', 'jailer', 'archer', 'bomber', 'harpy', 'lancer', 'matron',
  'alchemist', 'merchant', 'projectiles', 'pickups', 'props', 'icons',
  // enemy variants (docs/CONTENT2.md §1): a missing sheet falls back to the base sheet + hue outline
  'ghoul_plague', 'ghoul_frenzy', 'ghoul_shackled', 'ghoul_wraith',
  'jailer_warden', 'jailer_torch', 'jailer_spear', 'jailer_chain',
  'archer_fire', 'archer_volley', 'archer_crossbow', 'archer_shadow',
  'bomber_frost', 'bomber_cluster', 'bomber_kamikaze', 'bomber_alchemist',
  'harpy_storm', 'harpy_raven', 'harpy_siren', 'harpy_ember',
  'lancer_halberd', 'lancer_paladin', 'lancer_duelist', 'lancer_dragoon',
  // mid-bosses (docs/CONTENT2.md §2)
  'mb_abbess', 'mb_arachne', 'mb_valkyrie', 'mb_witch',
  // corpse pieces, Selma and the rag golem (docs/CONTENT3.md §6): a missing sheet falls back to a placeholder box
  'corpse', 'seamstress', 'golem',
  // the stash chest (docs/CONTENT4.md §6)
  'stash',
] as const;
export type SheetName = (typeof SHEETS)[number];
export const BIOMES_ART = ['prison', 'ramparts', 'tower'] as const;

const PLACEHOLDER_SIZE: Record<string, [number, number, number, number, string]> = {
  heroine: [128, 112, 64, 100, '#3fc6d8'],
  matron: [288, 224, 144, 212, '#b5482f'],
  alchemist: [128, 128, 64, 116, '#4f8de0'],
  merchant: [128, 128, 64, 116, '#d9a441'],
  corpse: [24, 24, 12, 22, '#e8d7c3'],
  seamstress: [128, 128, 64, 124, '#c8324a'],
  golem: [128, 128, 64, 124, '#b89a72'],
  stash: [64, 80, 32, 78, '#4fe3ff'],
  projectiles: [48, 48, 24, 24, '#ffd27a'],
  pickups: [24, 24, 12, 22, '#4fd8ff'],
  props: [96, 96, 48, 92, '#7b6a58'],
  icons: [32, 32, 16, 16, '#aaaaaa'],
};

export interface BgLayer { image: string; parallax: number; y: number; repeatX: boolean; img?: HTMLImageElement; [k: string]: unknown; }
export interface BgDef { sky: string; layers: BgLayer[]; [k: string]: unknown; }

export class Assets {
  sheets = new Map<string, SpriteSheet>();
  images = new Map<string, HTMLImageElement>();
  json = new Map<string, any>();
  base = 'assets/';
  loaded = 0;
  total = 0;

  sheet(name: string): SpriteSheet {
    let s = this.sheets.get(name);
    if (!s) {
      s = makePlaceholder(name);
      this.sheets.set(name, s);
    }
    return s;
  }

  image(path: string): HTMLImageElement | undefined {
    return this.images.get(path);
  }

  async loadAll(onProgress?: (p: number) => void): Promise<void> {
    const jobs: Promise<void>[] = [];
    const track = (p: Promise<void>) => {
      this.total++;
      jobs.push(p.finally(() => { this.loaded++; onProgress?.(this.loaded / this.total); }));
    };
    for (const n of SHEETS) track(this.loadSheet(n));
    for (const b of BIOMES_ART) {
      track(this.loadJson(`tiles/${b}.json`).then(() => this.loadImage(`tiles/${b}.png`)).then(() => undefined));
      track(this.loadJson(`bg/${b}.json`).then(async (def: BgDef | null) => {
        if (!def) return;
        await Promise.all(def.layers.map(async (l) => { l.img = await this.loadImage(`bg/${l.image}`); }));
      }));
    }
    track(this.loadImage('ui/title.png').then(() => undefined));
    track(this.loadImage('ui/boss_portrait.png').then(() => undefined));
    track(waitFonts());
    await Promise.all(jobs);
  }

  async loadSheet(name: string): Promise<void> {
    const m = (await this.loadJson(`sprites/${name}.json`)) as SheetManifest | null;
    const img = m ? await this.loadImage(`sprites/${m.image}`) : undefined;
    this.sheets.set(name, m && img ? new SpriteSheet(name, img, m) : makePlaceholder(name));
  }

  async loadJson(path: string): Promise<any> {
    try {
      const r = await fetch(this.base + path);
      if (!r.ok) return null;
      const j = await r.json();
      this.json.set(path, j);
      return j;
    } catch {
      return null;
    }
  }

  loadImage(path: string): Promise<HTMLImageElement | undefined> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images.set(path, img); resolve(img); };
      img.onerror = () => resolve(undefined);
      img.src = this.base + path;
    });
  }
}

function waitFonts(): Promise<void> {
  const fonts = (document as any).fonts;
  if (!fonts?.load) return Promise.resolve();
  return Promise.race([
    Promise.all([fonts.load("11px 'Galmuri11'"), fonts.load("bold 11px 'Galmuri11'")]).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, 3000)),
  ]).catch(() => undefined);
}

function makePlaceholder(name: string): SpriteSheet {
  const [fw, fh, ax, ay, color] = PLACEHOLDER_SIZE[name] ?? [128, 112, 64, 100, '#c04a7a'];
  const c = document.createElement('canvas');
  c.width = fw;
  c.height = fh;
  const x = c.getContext('2d')!;
  const bw = Math.min(fw * 0.4, 22 * (fh / 112) * 1.1);
  const bh = Math.min(ay * 0.9, 54 * (fh / 112));
  x.fillStyle = color;
  x.fillRect(Math.round(ax - bw / 2), Math.round(ay - bh), Math.round(bw), Math.round(bh));
  x.fillStyle = '#ffffff';
  x.fillRect(Math.round(ax + bw / 2 - 6), Math.round(ay - bh + 6), 3, 3);
  const anims = new Proxy({} as Record<string, AnimDef>, {
    get: (_t, _k) => ({ row: 0, frames: 1, fps: 1, loop: true }),
    has: () => true,
  });
  return new SpriteSheet(name, c, { image: '', frameW: fw, frameH: fh, anchor: [ax, ay], animations: anims }, true);
}
