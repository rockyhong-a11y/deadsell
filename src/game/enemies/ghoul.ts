import { TILE } from '../../engine/config';
import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { warnRect } from './telegraph';

const SPEC = { hp: 40, w: 18, h: 42, patrol: 30, chase: 68, aura: '#ff9b2e', blood: '#5f8f4a' };

/** 구울: shambles, speeds up while chasing, claw swipe with a short lunge. */
export class Ghoul extends Enemy {
  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}) {
    super('ghoul', x, y, opts, SPEC);
    this.cooldownPause = 0.4;
  }

  protected chaseMove(_dt: number, p: Player): void {
    const dx = p.x - this.x;
    // shambling at first, then a frantic run
    const speed = (SPEC.chase + Math.min(42, this.chaseT * 34)) * this.speedMult;
    if (Math.abs(dx) > 6 && this.walk(Math.sign(dx), speed, TILE * 2, true)) this.play('walk');
    else {
      this.vx = 0;
      this.play('idle');
    }
  }

  protected shouldAttack(p: Player): boolean {
    return Math.abs(p.x - this.x) < 50 * this.scale && Math.abs(p.y - this.y) < 38;
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    this.beginAttack(0.55, 0.14, 0.45, 'attack');
    this.attackCd = 1.1;
  }

  protected onActiveStart(): void {
    this.vx = this.facing * 235 * this.speedMult;
    this.world.fx.slash(this.x + this.facing * 22, this.y - this.h * 0.55, { dir: this.facing, radius: 32, from: -1.0, to: 0.9, color: '#ffb36a' });
    this.world.audio.play('swing', { vol: 0.6 });
  }

  protected onActive(): void {
    const f = this.facing;
    hitArea(
      this.world,
      { x: f > 0 ? this.x - 4 : this.x - 42 * this.scale, y: this.y - this.h, w: 46 * this.scale, h: this.h },
      'enemy',
      { amount: this.dmg(9), dir: f, kind: 'melee', source: this, knockback: 190, hitstun: 0.25 },
      this.hitSet,
    );
  }

  protected onRecoverStart(): void {
    this.vx *= 0.3;
  }

  protected drawTelegraph(ctx: CanvasRenderingContext2D, p: number): void {
    const f = this.facing;
    const reach = 52 * this.scale;
    warnRect(ctx, f > 0 ? this.x : this.x - reach, this.y - this.h, reach, this.h, p, this.time);
  }
}
