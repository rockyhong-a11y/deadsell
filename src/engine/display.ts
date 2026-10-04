import { UI_H } from './config';
import { DEFAULT_GFX, buildOverlay, computeLayout, cssFilterOf, overlayOf, smoothOf, type GfxSettings, type ScreenLayout } from './filters';

/**
 * Display = three layers, two spaces.
 *  - `worldCanvas`/`wctx`: the low-res world buffer (worldW × worldH). Everything pixel-art goes here. Its height is a
 *            setting (288 / 360 / 432), so it changes how much of the level is visible.
 *  - `screen`: a canvas element BEHIND the UI. The world buffer is blitted to it (nearest neighbour, or bilinear),
 *            followed by the CRT / LCD overlay; colour filters are CSS filters on this element only.
 *  - `ui`:   the visible, transparent, full-resolution canvas ON TOP (receives the pointer events). UI is drawn in a
 *            fixed virtual space W × 360 (W = 480..800 from the screen aspect) at device resolution, so text stays
 *            crisp and the HUD has the SAME on-screen size at every world resolution and with every filter.
 * Pointer/touch coordinates are converted to that UI space with `toVirtual`.
 */
export class Display {
  /** the UI canvas (top layer, pointer events) */
  readonly canvas: HTMLCanvasElement;
  readonly ui: CanvasRenderingContext2D;
  /** the world layer behind the UI (blit target + filters) */
  readonly screen: HTMLCanvasElement;
  readonly sctx: CanvasRenderingContext2D;
  readonly worldCanvas: HTMLCanvasElement;
  readonly wctx: CanvasRenderingContext2D;
  /** UI virtual size */
  W = 480;
  readonly H = UI_H;
  /** world buffer size */
  worldW = 480;
  worldH = 360;
  /** device pixels per UI virtual pixel */
  scale = 1;
  /** CSS pixels per UI virtual pixel */
  cssScale = 1;
  /** current graphics settings (use `applyGfx` to change) */
  gfx: GfxSettings = { ...DEFAULT_GFX };
  layout: ScreenLayout | null = null;
  onResize: (() => void) | null = null;
  private cssW = 0;
  private cssH = 0;
  private dirty = true;
  private overlay: HTMLCanvasElement | null = null;
  private overlayKey = '';
  private bloom: HTMLCanvasElement | null = null;
  private bloomCtx: CanvasRenderingContext2D | null = null;
  private view = { x: 0, y: 0, w: 1, h: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ui = canvas.getContext('2d')!;
    this.screen = document.createElement('canvas');
    this.screen.id = 'screen';
    this.screen.setAttribute('aria-hidden', 'true');
    canvas.parentElement?.insertBefore(this.screen, canvas);
    this.sctx = this.screen.getContext('2d', { alpha: false })!;
    this.worldCanvas = document.createElement('canvas');
    this.wctx = this.worldCanvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 100));
  }

  /** Change graphics options; takes effect immediately (re-fits the picture, rebuilds the overlay). */
  applyGfx(g: Partial<GfxSettings>): void {
    const next = { ...this.gfx, ...g };
    if (next.filter === this.gfx.filter && next.resolution === this.gfx.resolution && next.fit === this.gfx.fit && next.quality === this.gfx.quality) return;
    this.gfx = next;
    this.dirty = true;
    this.resize();
  }

  resize(): void {
    // the canvas box (not the window): it is inset by the safe area on notched phones
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    if (!this.dirty && cssW === this.cssW && cssH === this.cssH) return;
    this.dirty = false;
    this.cssW = cssW;
    this.cssH = cssH;
    const dpr = this.gfx.quality === 'saver' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const devW = Math.max(1, Math.round(cssW * dpr));
    const devH = Math.max(1, Math.round(cssH * dpr));
    const L = computeLayout(devW, devH, this.gfx);
    this.layout = L;
    this.W = L.uiW;
    this.worldW = L.worldW;
    this.worldH = L.worldH;
    if (this.worldCanvas.width !== L.worldW) this.worldCanvas.width = L.worldW;
    if (this.worldCanvas.height !== L.worldH) this.worldCanvas.height = L.worldH;
    // assigning width/height clears the canvases (the screen canvas to opaque black = the letterbox)
    for (const c of [this.canvas, this.screen]) {
      c.width = devW;
      c.height = devH;
    }
    this.scale = L.scale;
    this.cssScale = L.scale / dpr;
    this.view = { x: L.offsetX, y: L.offsetY, w: Math.round(L.viewW), h: Math.round(L.viewH) };
    this.wctx.imageSmoothingEnabled = false;
    this.applyScreenStyle();
    this.onResize?.();
  }

  private applyScreenStyle(): void {
    const f = this.gfx.filter;
    const css = cssFilterOf(f);
    this.screen.style.filter = css === 'none' ? '' : css;
    this.screen.style.imageRendering = smoothOf(f) ? 'auto' : 'pixelated';
    const kind = overlayOf(f);
    const key = kind ? `${kind}:${this.view.w}x${this.view.h}:${this.worldW}x${this.worldH}` : '';
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      this.overlay = kind ? buildOverlay(kind, this.view.w, this.view.h, this.worldW, this.worldH) : null;
    }
    if (f === 'crt') {
      if (!this.bloom) {
        this.bloom = document.createElement('canvas');
        this.bloomCtx = this.bloom.getContext('2d');
      }
      const bw = Math.max(1, Math.ceil(this.worldW / 4));
      const bh = Math.max(1, Math.ceil(this.worldH / 4));
      if (this.bloom.width !== bw) this.bloom.width = bw;
      if (this.bloom.height !== bh) this.bloom.height = bh;
    }
  }

  /** Offset of the picture inside the device canvas (letterboxing), in device px. */
  get offsetX(): number {
    return this.view.x;
  }
  get offsetY(): number {
    return this.view.y;
  }

  /** Blit the world buffer to the screen layer (+ overlay), clear the UI layer and prepare it for virtual-space drawing. */
  present(): void {
    const s = this.sctx;
    const v = this.view;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    s.imageSmoothingEnabled = smoothOf(this.gfx.filter);
    s.drawImage(this.worldCanvas, 0, 0, this.worldW, this.worldH, v.x, v.y, v.w, v.h);
    if (this.gfx.filter === 'crt' && this.bloom && this.bloomCtx) {
      // phosphor glow: a quarter-size copy of the picture, stretched back over it additively
      this.bloomCtx.imageSmoothingEnabled = true;
      this.bloomCtx.drawImage(this.worldCanvas, 0, 0, this.bloom.width, this.bloom.height);
      s.imageSmoothingEnabled = true;
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = 0.17;
      s.drawImage(this.bloom, 0, 0, this.bloom.width, this.bloom.height, v.x, v.y, v.w, v.h);
      s.globalCompositeOperation = 'source-over';
      s.globalAlpha = 1;
    }
    if (this.overlay) s.drawImage(this.overlay, v.x, v.y);
    const c = this.ui;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.beginUI();
  }

  /** Set the UI transform (virtual coords → device pixels). */
  beginUI(): void {
    const c = this.ui;
    c.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    c.imageSmoothingEnabled = false;
  }

  /** UI virtual pixels per world pixel (HUD elements that follow world objects convert with this). */
  get uiPerWorld(): number {
    return this.H / this.worldH;
  }

  /** Convert client (CSS) coordinates to virtual coordinates. */
  toVirtual(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, rect.width);
    const dx = (clientX - rect.left) * dpr;
    const dy = (clientY - rect.top) * dpr;
    return { x: (dx - this.offsetX) / this.scale, y: (dy - this.offsetY) / this.scale };
  }
}
