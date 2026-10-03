import { Prop, drawSoftGlow } from './common';

/** Wall torch: flickering light + a few embers. */
export class Torch extends Prop {
  private seed: number;
  private emberT = 0;
  readonly color: string;

  constructor(x: number, y: number, color = '#ffa040') {
    super(x, y);
    this.seed = (x * 0.013 + y * 0.007) % 6.28;
    this.color = color;
    this.z = -1;
  }

  init(): void {
    this.useSheet('props', 'torch');
    // desynchronise neighbouring torches
    this.anim!.t = (this.seed / 6.28) * 0.6;
  }

  update(dt: number): void {
    super.update(dt);
    this.emberT -= dt;
    if (this.emberT <= 0) {
      this.emberT = 0.35 + this.world.rng.next() * 0.7;
      this.world.particles.emit('embers', this.x, this.y - 40, { count: 1 });
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false);
    const f = 0.9 + 0.1 * Math.sin(this.world.time * 9 + this.seed) + 0.05 * Math.sin(this.world.time * 23 + this.seed * 3);
    drawSoftGlow(ctx, this.x, this.y - 40, 34, this.color, 0.22 * f);
    this.world.lights.add(this.x, this.y - 40, 130, this.color, f, 0.25);
  }
}
