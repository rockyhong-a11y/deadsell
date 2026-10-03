import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { warnPath, warnRect } from './telegraph';

const SPEC = { hp: 70, w: 20, h: 48, patrol: 28, chase: 66, aura: '#5ec8ff', blood: '#8a5a8a' };
const CHARGE_SPEED = 330;
const CHARGE_MAX = 1.2;

type Mode = 'thrust' | 'charge';

/**
 * 창기병: charges (0.7 s glowing windup + floor line) when the player is level and within 300 px,
 * runs until a wall / ledge / 1.2 s, then is stunned-open for ~1 s. Close range: spear thrust.
 */
export class Lancer extends Enemy {
  private mode: Mode = 'thrust';
  private dustT = 0;
  private chargeFrom = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}) {
    super('lancer', x, y, opts, SPEC);
    this.cooldownPause = 0.4;
    this.aggroRange = 300;
  }

  private get chargeSpeed(): number {
    return CHARGE_SPEED * this.speedMult;
  }

  /** How far (px) a charge in the facing direction could run before a wall or ledge. */
  chargeRunway(): number {
    const map = this.world.map;
    const max = this.chargeSpeed * CHARGE_MAX;
    for (let d = 8; d < max; d += 8) {
      const px = this.x + this.facing * d;
      if (map.solidAt(px + this.facing * (this.w / 2), this.y - 6) || map.solidAt(px + this.facing * (this.w / 2), this.y - this.h * 0.7)) return d;
      if (map.floorBelow(px, this.y + 1, 10) === null) return d;
    }
    return max;
  }

  protected shouldAttack(p: Player): boolean {
    const dx = Math.abs(p.x - this.x);
    const level = Math.abs(p.y - this.y) < 36;
    if (!level) return false;
    if (dx < 62) return true;
    if (dx >= 130 && dx <= 300) return this.sees(p);
    return false;
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    if (Math.abs(p.x - this.x) < 62) {
      this.mode = 'thrust';
      this.beginAttack(0.45, 0.14, 0.55, 'thrust');
      this.attackCd = 0.9;
    } else {
      this.mode = 'charge';
      this.beginAttack(0.7, CHARGE_MAX, 0.95);
      this.anim?.playFor('charge_windup', 0.7);
      this.attackCd = 2.6;
    }
  }

  protected onActiveStart(): void {
    if (this.mode === 'thrust') {
      this.vx = this.facing * 90;
      this.world.audio.play('stab', { vol: 0.7 });
      this.world.fx.slash(this.x + this.facing * 34, this.y - this.h * 0.55, { dir: this.facing, radius: 34, from: -0.25, to: 0.25, color: '#e7d9ff' });
    } else {
      this.chargeFrom = this.x;
      this.play('charge');
      this.world.audio.play('swing_heavy', { vol: 0.7 });
      this.world.particles.emit('dust', this.x, this.y, { dir: -this.facing, count: 6 });
    }
  }

  protected onActive(dt: number): void {
    const f = this.facing;
    if (this.mode === 'thrust') {
      this.vx *= 0.9;
      hitArea(
        this.world,
        { x: f > 0 ? this.x : this.x - 70, y: this.y - this.h * 0.8, w: 70, h: this.h * 0.5 },
        'enemy',
        { amount: this.dmg(11), dir: f, kind: 'melee', source: this, knockback: 220, hitstun: 0.25 },
        this.hitSet,
      );
      return;
    }
    // charge
    this.vx = f * this.chargeSpeed;
    this.dustT -= dt;
    if (this.dustT <= 0) {
      this.dustT = 0.07;
      this.world.particles.emit('dust', this.x - f * 10, this.y, { dir: -f, count: 2 });
    }
    hitArea(
      this.world,
      { x: f > 0 ? this.x - 8 : this.x - 40, y: this.y - this.h, w: 48, h: this.h },
      'enemy',
      { amount: this.dmg(14), dir: f, kind: 'melee', source: this, knockback: 320, hitstun: 0.3 },
      this.hitSet,
    );
    const ledge = this.world.map.floorBelow(this.x + f * (this.w / 2 + 8), this.y + 1, 10) === null;
    if (this.hitWallX === f || ledge || Math.abs(this.x - this.chargeFrom) > this.chargeSpeed * CHARGE_MAX + 4) {
      this.world.shake(this.hitWallX ? 4 : 0, 0.15);
      if (this.hitWallX) {
        this.world.particles.emit('debris', this.x + f * this.w / 2, this.y - this.h * 0.5, { dir: -f, count: 6 });
        this.world.audio.play('slam', { vol: 0.6 });
      }
      this.endActive();
    }
  }

  protected onRecoverStart(): void {
    if (this.mode === 'charge') this.play('idle');
  }

  protected onRecover(dt: number, p: Player): void {
    super.onRecover(dt, p);
    if (this.mode === 'charge') this.vx = Math.sign(this.vx) * Math.max(0, Math.abs(this.vx) - 700 * dt);
  }

  protected drawTelegraph(ctx: CanvasRenderingContext2D, p: number): void {
    const f = this.facing;
    if (this.mode === 'thrust') {
      warnRect(ctx, f > 0 ? this.x : this.x - 72, this.y - this.h * 0.8, 72, this.h * 0.5, p, this.time);
      return;
    }
    const run = this.chargeRunway();
    const x1 = this.x + f * run;
    warnPath(ctx, this.x, x1, this.y, f, p, this.time);
  }
}
