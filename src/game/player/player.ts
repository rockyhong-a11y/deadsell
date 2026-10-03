import { Actor, type Entity } from '../entity';
import type { DamageInfo } from '../combat';
import { hitArea } from '../combat';
import { approach } from '../../engine/math';
import type { Interactable } from '../world';

/**
 * The heroine. OWNER: player agent — this is a minimal stub (walk/jump/one slash)
 * so the core can be exercised. Keep the public fields used by the HUD:
 * hp/maxHp, recoverable, nearInteract, skillCooldown/skillCooldownMax, useFlask().
 */
export class Player extends Actor {
  team = 'player' as const;
  /** "rally" segment of HP that can be won back by attacking */
  recoverable = 0;
  nearInteract: (Interactable & Entity) | null = null;
  skillCooldown: [number, number] = [0, 0];
  skillCooldownMax: [number, number] = [1, 1];
  private atk = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 14;
    this.h = 40;
    this.z = 20;
    this.alwaysActive = true;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('heroine'));
    this.maxHp = this.world.run.maxHp;
    this.hp = Math.min(this.world.run.hp, this.maxHp);
  }

  useFlask(): boolean {
    const run = this.world.run;
    if (run.flasks <= 0 || this.hp >= this.maxHp) return false;
    run.flasks--;
    this.heal(Math.round(this.maxHp * 0.6));
    return true;
  }

  update(dt: number): void {
    const inp = this.world.input;
    this.updateStatus(dt);
    if (!this.dying) {
      this.vx = approach(this.vx, inp.moveX * 150, 2400 * dt);
      if (inp.moveX) this.facing = inp.moveX > 0 ? 1 : -1;
      if (inp.pressed('jump') && this.onGround) this.vy = -456;
      if (inp.pressed('attack1') && this.atk <= 0) {
        this.atk = 0.35;
        hitArea(this.world, { x: this.facing > 0 ? this.x : this.x - 44, y: this.y - 40, w: 44, h: 36 }, 'player', { amount: 12, dir: this.facing, kind: 'melee', knockback: 120 });
      }
      if (inp.pressed('heal')) this.useFlask();
      if (inp.pressed('interact')) this.nearInteract?.interact();
    }
    if (this.atk > 0) this.atk -= dt;
    super.update(dt);
    this.nearInteract = this.world.nearestInteractable(this.x, this.y - 20);
    this.anim?.play(this.atk > 0 ? 'sword_1' : !this.onGround ? (this.vy < 0 ? 'jump' : 'fall') : Math.abs(this.vx) > 10 ? 'run' : 'idle');
    this.world.run.hp = this.hp;
  }

  die(info: DamageInfo): void {
    super.die(info);
    this.world.emit({ type: 'playerDied' });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawSprite(ctx);
  }
}
