import { VIEW_H, VIEW_W_MAX, VIEW_W_MIN } from './config';

/**
 * Two-layer display.
 *  - `wctx`: the low-res world buffer (W × 360). Everything pixel-art goes here.
 *  - `ui`:   the visible full-resolution canvas. After the world buffer is blitted
 *            (nearest-neighbour), UI is drawn on top in the SAME virtual coordinate
 *            space (W × 360) but at device resolution, so text stays crisp.
 * Pointer/touch coordinates are converted to that virtual space with `toVirtual`.
 */
export class Display {
  readonly canvas: HTMLCanvasElement;
  readonly ui: CanvasRenderingContext2D;
  readonly worldCanvas: HTMLCanvasElement;
  readonly wctx: CanvasRenderingContext2D;
  W = VIEW_W_MIN;
  readonly H = VIEW_H;
  /** device pixels per virtual pixel */
  scale = 1;
  /** CSS pixels per virtual pixel */
  cssScale = 1;
  private cssW = 0;
  private cssH = 0;
  onResize: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ui = canvas.getContext('2d', { alpha: false })!;
    this.worldCanvas = document.createElement('canvas');
    this.wctx = this.worldCanvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 100));
  }

  resize(): void {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    if (cssW === this.cssW && cssH === this.cssH) return;
    this.cssW = cssW;
    this.cssH = cssH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aspect = cssW / Math.max(1, cssH);
    this.W = Math.round(Math.min(VIEW_W_MAX, Math.max(VIEW_W_MIN, VIEW_H * aspect)));
    this.worldCanvas.width = this.W;
    this.worldCanvas.height = this.H;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    // Fit W×H into the screen (letterbox only when the aspect is outside the clamp range).
    this.cssScale = Math.min(cssW / this.W, cssH / this.H);
    this.scale = this.cssScale * dpr;
    this.wctx.imageSmoothingEnabled = false;
    this.onResize?.();
  }

  /** Offset of the virtual view inside the device canvas (letterboxing), in device px. */
  get offsetX(): number {
    return Math.round((this.canvas.width - this.W * this.scale) / 2);
  }
  get offsetY(): number {
    return Math.round((this.canvas.height - this.H * this.scale) / 2);
  }

  /** Copy the world buffer to the screen and prepare `ui` for virtual-space drawing. */
  present(): void {
    const c = this.ui;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    if (this.offsetX > 0 || this.offsetY > 0) {
      c.fillStyle = '#000';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    c.drawImage(this.worldCanvas, 0, 0, this.W, this.H, this.offsetX, this.offsetY, this.W * this.scale, this.H * this.scale);
    this.beginUI();
  }

  /** Set the UI transform (virtual coords → device pixels). */
  beginUI(): void {
    const c = this.ui;
    c.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    c.imageSmoothingEnabled = false;
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
