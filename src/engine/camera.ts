import { damp } from './math';

/** World camera. (x, y) = top-left of the view in world pixels. */
export class Camera {
  x = 0;
  y = 0;
  w: number;
  h: number;
  /** level bounds in pixels */
  boundsW = Infinity;
  boundsH = Infinity;
  private shakeMag = 0;
  private shakeTime = 0;
  private shakeDur = 0;
  shakeX = 0;
  shakeY = 0;
  private lookAhead = 0;
  /** extra zoom-free offset, e.g. for boss intro pans */
  override: { x: number; y: number } | null = null;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  setBounds(w: number, h: number): void {
    this.boundsW = w;
    this.boundsH = h;
  }

  /** Snap so that (tx, ty) is framed immediately. */
  snap(tx: number, ty: number): void {
    this.x = tx - this.w / 2;
    this.y = ty - this.h * 0.6;
    this.clamp();
  }

  /**
   * Smoothly follow a target (feet position). Horizontal look-ahead in the
   * facing direction, vertical framing biased so the player sits slightly below centre.
   */
  follow(tx: number, ty: number, facing: number, vy: number, dt: number): void {
    if (this.override) {
      this.x += (this.override.x - this.w / 2 - this.x) * damp(4, dt);
      this.y += (this.override.y - this.h / 2 - this.y) * damp(4, dt);
    } else {
      this.lookAhead += (facing * 40 - this.lookAhead) * damp(2.5, dt);
      const gx = tx + this.lookAhead - this.w / 2;
      const fallBias = vy > 200 ? Math.min(60, (vy - 200) * 0.25) : 0;
      const gy = ty - this.h * 0.58 + fallBias;
      this.x += (gx - this.x) * damp(9, dt);
      this.y += (gy - this.y) * damp(vy > 300 ? 12 : 6, dt);
    }
    this.clamp();
    this.updateShake(dt);
  }

  clamp(): void {
    this.x = this.boundsW <= this.w ? (this.boundsW - this.w) / 2 : Math.max(0, Math.min(this.boundsW - this.w, this.x));
    this.y = this.boundsH <= this.h ? (this.boundsH - this.h) / 2 : Math.max(0, Math.min(this.boundsH - this.h, this.y));
  }

  shake(mag: number, dur = 0.2): void {
    if (mag >= this.shakeMag * (this.shakeTime / Math.max(0.001, this.shakeDur))) {
      this.shakeMag = mag;
      this.shakeDur = dur;
      this.shakeTime = dur;
    }
  }

  private updateShake(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / this.shakeDur);
      const m = this.shakeMag * k * k;
      this.shakeX = (Math.random() * 2 - 1) * m;
      this.shakeY = (Math.random() * 2 - 1) * m;
    } else {
      this.shakeX = this.shakeY = 0;
    }
  }

  /** Integer view origin used for drawing (includes shake). */
  get viewX(): number {
    return Math.round(this.x + this.shakeX);
  }
  get viewY(): number {
    return Math.round(this.y + this.shakeY);
  }
}
