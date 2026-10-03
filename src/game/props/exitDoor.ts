import type { Interactable } from '../world';
import { Prop, drawSoftGlow } from './common';

/** The level exit: interact to walk through (plays the opening animation, then ends the level). */
export class ExitDoor extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 46;
  private opening = false;
  private t = 0;
  private emitted = false;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 40;
    this.h = 80;
    this.z = 0;
  }

  init(): void {
    this.useSheet('props', 'door_exit');
    this.anim!.t = 0;
    this.anim!.speed = 0; // frame 0 = closed until opened
  }

  promptText(): string {
    return '나가기';
  }

  canInteract(): boolean {
    return !this.opening && !this.dead;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.opening = true;
    this.t = 0;
    this.anim!.speed = 1;
    this.anim!.play('door_exit', true);
    this.world.audio.play('door');
  }

  update(dt: number): void {
    super.update(dt);
    if (this.opening) {
      this.t += dt;
      if (!this.emitted && this.t >= 0.55) {
        this.emitted = true;
        this.world.emit({ type: 'levelExit' });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false);
    const pulse = 0.55 + 0.15 * Math.sin(this.world.time * 3);
    drawSoftGlow(ctx, this.x, this.y - 40, 46, '#59d4ff', this.opening ? 0.8 : 0.25 * pulse);
    this.world.lights.add(this.x, this.y - 40, 90, '#6fd8ff', this.opening ? 1.1 : 0.7, 0.05);
  }
}
