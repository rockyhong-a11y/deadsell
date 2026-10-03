import { FIXED_DT } from '../../engine/config';
import { hitArea, type DamageInfo, type DamageResult } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { warnRect } from './telegraph';

const SPEC = { hp: 90, w: 24, h: 46, patrol: 24, chase: 48, aura: '#ff5a5a', blood: '#8a3a3a' };

/**
 * 여간수: tower shield blocks frontal non-unblockable damage. Hurt from behind, by ground slams,
 * explosions, traps and damage over time, and while its shield is down (mace swing / recovery).
 * Attack: shield bash + mace, 0.7 s windup.
 */
export class Jailer extends Enemy {
  private blockT = 0;
  private textCd = 0;
  private turnT = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}) {
    super('jailer', x, y, opts, SPEC);
    this.cooldownPause = 0.5;
    this.knockbackTaken = this.elite ? 0.3 : 0.6;
  }

  /** Is the shield raised (able to block) right now? */
  get shieldUp(): boolean {
    if (this.dying || this.incapacitated) return false;
    return this.state !== 'active' && this.state !== 'recover' && this.state !== 'hurt';
  }

  private attackerInFront(info: DamageInfo): boolean {
    if (info.dir) return info.dir === -this.facing;
    if (info.source) return (info.source.x - this.x) * this.facing > 0;
    return false;
  }

  protected intercept(info: DamageInfo): DamageResult | null {
    if (!this.shieldUp || info.unblockable) return null;
    if (info.kind === 'dot' || info.kind === 'explosion' || info.kind === 'trap' || info.kind === 'hazard') return null;
    if (!this.attackerInFront(info)) return null;
    const w = this.world;
    this.blockT = 0.22;
    this.flash = 0;
    const sx = this.x + this.facing * (this.w / 2 + 3);
    const sy = this.y - this.h * 0.55;
    w.particles.emit('spark', sx, sy, { dir: this.facing, count: 7 });
    w.audio.play('block');
    if (this.textCd <= 0) {
      w.fx.text(this.x, this.headY, '막힘', '#c9d6e8');
      this.textCd = 0.3;
    }
    if (this.state !== 'windup') this.anim?.playFor('block', 0.22);
    // pushback: the jailer slides back a little, the attacker is nudged away
    if (this.onGround) this.vx = -this.facing * 70;
    if (info.source && info.source !== this) info.source.vx = this.facing * 130;
    return { applied: false, amount: 0, killed: false, blocked: true };
  }

  update(dt: number): void {
    if (this.textCd > 0) this.textCd -= dt;
    if (this.blockT > 0) this.blockT -= dt;
    super.update(dt);
  }

  protected play(name: string): void {
    // keep the block pose for its short duration instead of snapping back to walk/idle
    if (this.blockT > 0 && this.anim?.name === 'block' && (name === 'idle' || name === 'walk')) return;
    super.play(name);
  }

  /** The jailer turns slowly: slipping behind it (a roll) buys time to hit the unshielded back. */
  protected facePlayer(p: { x: number }): void {
    if (this.state === 'alert' || this.state === 'patrol') {
      super.facePlayer(p);
      return;
    }
    const want = p.x > this.x ? 1 : -1;
    if (want === this.facing) {
      this.turnT = 0;
      return;
    }
    this.turnT += FIXED_DT;
    if (this.turnT >= (this.elite ? 0.4 : 0.6)) {
      this.facing = want;
      this.turnT = 0;
    }
  }

  protected shouldAttack(p: Player): boolean {
    const front = (p.x - this.x) * this.facing > 0;
    return front && Math.abs(p.x - this.x) < 58 * this.scale && Math.abs(p.y - this.y) < 38;
  }

  protected startAttack(): void {
    this.beginAttack(0.7, 0.2, 0.7, 'attack');
    this.attackCd = 1.2;
  }

  protected onActiveStart(): void {
    this.world.fx.slash(this.x + this.facing * 24, this.y - this.h * 0.6, { dir: this.facing, radius: 38, from: -1.3, to: 0.7, color: '#d8dde8' });
    this.world.audio.play('swing_heavy', { vol: 0.7 });
    this.vx = this.facing * 80;
  }

  protected onActive(): void {
    const f = this.facing;
    hitArea(
      this.world,
      { x: f > 0 ? this.x - 4 : this.x - 62 * this.scale, y: this.y - this.h - 4, w: 66 * this.scale, h: this.h + 4 },
      'enemy',
      { amount: this.dmg(12), dir: f, kind: 'melee', source: this, knockback: 280, hitstun: 0.3 },
      this.hitSet,
    );
  }

  protected drawTelegraph(ctx: CanvasRenderingContext2D, p: number): void {
    const reach = 58 * this.scale;
    warnRect(ctx, this.facing > 0 ? this.x : this.x - reach, this.y - this.h - 4, reach, this.h + 4, p, this.time);
  }
}
