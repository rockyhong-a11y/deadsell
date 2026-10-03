import type { Interactable } from '../world';
import { Prop, drawSoftGlow } from './common';

/** Healing fountain of the passage: refills the flask charges. */
export class Fountain extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 52;
  private flash = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 56;
    this.h = 40;
  }

  init(): void {
    this.useSheet('props', 'fountain');
  }

  promptText(): string {
    return '마시기';
  }

  promptSub(): string | null {
    const r = this.world.run;
    return `회복 플라스크 ${r.flasks}/${r.maxFlasks}`;
  }

  canInteract(): boolean {
    const r = this.world.run;
    return !this.dead && r.flasks < r.maxFlasks;
  }

  interact(): void {
    if (!this.canInteract()) return;
    const w = this.world;
    w.run.flasks = w.run.maxFlasks;
    this.flash = 0.8;
    w.audio.play('heal');
    w.particles.emit('heal', w.player.x, w.player.y - 24, { count: 12 });
    w.emit({ type: 'toast', text: '회복 플라스크가 가득 찼다', color: '#ff9fb4' });
  }

  update(dt: number): void {
    super.update(dt);
    if (this.flash > 0) this.flash -= dt;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false);
    drawSoftGlow(ctx, this.x, this.y - 28, 38, '#ff6f9a', 0.22 + this.flash * 0.5);
    this.world.lights.add(this.x, this.y - 28, 90, '#ff7ea6', 0.7 + this.flash, 0.08);
  }
}
