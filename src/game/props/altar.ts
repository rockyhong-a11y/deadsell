import type { Interactable } from '../world';
import { spawnScroll } from '../items/pickups';
import { Prop, drawSoftGlow } from './common';

/** Scroll altar: one use, a scroll of power appears above it. */
export class Altar extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 42;
  used = false;
  private t = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 40;
    this.h = 50;
  }

  init(): void {
    this.useSheet('props', 'altar');
  }

  promptText(): string {
    return '기원하기';
  }

  promptSub(): string | null {
    return '힘의 두루마리';
  }

  canInteract(): boolean {
    return !this.used && !this.dead;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.used = true;
    this.t = 0;
    const w = this.world;
    w.audio.play('scroll');
    w.particles.emit('magic', this.x, this.y - 40, { count: 16, color: '#c58bff' });
    w.shake(2, 0.15);
    spawnScroll(w, this.x, this.y - 54);
  }

  update(dt: number): void {
    super.update(dt);
    this.t += dt;
    if (this.anim) this.anim.speed = this.used ? 0.2 : 1;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false, { alpha: this.used ? 0.8 : 1 });
    if (!this.used) {
      drawSoftGlow(ctx, this.x, this.y - 46, 30, '#c58bff', 0.35 + 0.1 * Math.sin(this.world.time * 4));
      this.world.lights.add(this.x, this.y - 44, 80, '#b58cff', 0.8, 0.1);
    }
  }
}
