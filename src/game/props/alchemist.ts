import type { Interactable } from '../world';
import { Prop, drawSoftGlow } from './common';

/** Morwen the alchemist (meta shop). */
export class Alchemist extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 52;
  private talkT = 0;
  private busy = false;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 24;
    this.h = 56;
    this.z = 1;
  }

  init(): void {
    this.useSheet('alchemist', 'idle');
  }

  promptText(): string {
    return '대화';
  }

  promptSub(): string | null {
    return '연금술사 모르웬';
  }

  canInteract(): boolean {
    return !this.dead && !this.busy;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.talkT = 1.2;
    this.busy = true;
    this.world.audio.play('ui_open');
    this.world.ui.openAlchemist();
    // the UI is modal and pauses the world: allow talking again right away once it closes
    this.busy = false;
  }

  update(dt: number): void {
    super.update(dt);
    if (this.playerNear(130)) this.facePlayer();
    if (this.talkT > 0) this.talkT -= dt;
    this.anim?.play(this.talkT > 0 ? 'talk' : 'idle');
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, this.facing < 0);
    drawSoftGlow(ctx, this.x - 8 * this.facing, this.y - 30, 26, '#4f9dff', 0.22 + 0.06 * Math.sin(this.world.time * 3));
    this.world.lights.add(this.x, this.y - 32, 80, '#5aa8ff', 0.7, 0.12);
  }
}
