import type { Interactable } from '../world';
import { STASH } from '../rules';
import { Prop, drawSoftGlow } from './common';

/** seconds the lid stays open after the heroine used it */
const OPEN_TIME = 0.9;
/** the cyan of Cinder's ember in the lock */
const LOCK = '#4fe3ff';

/**
 * The 보관함 (docs/CONTENT4.md §2): an upright reliquary coffin with a glowing lock that stands next to the start of the prison and
 * in every 쉼터 (marker `K`). Interacting opens the stash screen (`LevelUI.openStash`).
 */
export class StashChest extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 48;
  private openT = 0;
  private t = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 30;
    this.h = 64;
    this.z = 1;
  }

  init(): void {
    this.useSheet('stash', 'idle');
  }

  promptText(): string {
    return '보관함';
  }

  promptSub(): string | null {
    return `${this.world.game.save.stash.length}/${STASH.capacity}`;
  }

  canInteract(): boolean {
    return !this.dead;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.openT = OPEN_TIME;
    this.anim?.playFor('open', OPEN_TIME * 0.6);
    this.world.audio.play('ui_open');
    this.world.ui.openStash();
  }

  update(dt: number): void {
    super.update(dt);
    this.t += dt;
    if (this.openT > 0) {
      this.openT -= dt;
      if (this.openT <= 0) this.anim?.play('idle', true);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false);
    const open = this.openT > 0;
    drawSoftGlow(ctx, this.x, this.y - 40, open ? 34 : 22, LOCK, (open ? 0.4 : 0.18) + 0.06 * Math.sin(this.t * 3));
    this.world.lights.add(this.x, this.y - 40, open ? 100 : 70, LOCK, open ? 0.8 : 0.5, 0.1);
  }
}
