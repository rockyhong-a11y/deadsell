import { TILE } from '../../engine/config';
import { hitArea } from '../combat';
import type { DamageInfo } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { PoisonCloud } from './hazards';
import { warnRect } from './telegraph';
import { ATTACK_DMG, BASE_STATS, type EnemyDef } from './variants';

const SPEC = { hp: BASE_STATS.ghoul.hp, w: 18, h: 42, patrol: 30, chase: 68, aura: BASE_STATS.ghoul.aura, blood: '#5f8f4a' };

/**
 * 구울: shambles, speeds up while chasing, claw swipe with a short lunge.
 * Variants (docs/CONTENT2.md): plague (slow, poison cloud on death), frenzy (fast, 2-swipe combo),
 * shackled (chain-ball swing, reach x1.7, heavy knockback), wraith (blinks behind the player, no knockback).
 */
export class Ghoul extends Enemy {
  private blinkCd = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}, variant: EnemyDef | null = null) {
    super('ghoul', x, y, opts, SPEC, variant);
    this.cooldownPause = 0.4;
    if (this.ab === 'wraith') {
      this.kbImmune = true;
      this.knockbackTaken = 0;
    }
    if (this.ab === 'frenzy') this.cooldownPause = 0.25;
  }

  /** reach multiplier (shackled 1.7) */
  private get reach(): number {
    return this.pr('reach', 1) * this.scale;
  }

  update(dt: number): void {
    if (this.blinkCd > 0) this.blinkCd -= dt;
    super.update(dt);
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

  /** Wraith: where to blink to (just behind the player), or null when she is already behind / out of range. */
  private behindX(p: Player): number | null {
    const tx = p.x - p.facing * 30;
    if ((this.x - p.x) * p.facing < 0) return null; // already behind her
    if (Math.abs(tx - this.x) > this.pr('blink', 90)) return null;
    return tx;
  }

  protected shouldAttack(p: Player): boolean {
    const level = Math.abs(p.y - this.y) < 38;
    if (this.ab === 'wraith' && this.blinkCd <= 0 && level && Math.abs(p.x - this.x) < 130 && this.behindX(p) !== null) return true;
    return Math.abs(p.x - this.x) < 50 * this.reach && level;
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    switch (this.ab) {
      case 'wraith': {
        if (this.blinkCd <= 0) {
          const tx = this.behindX(p);
          this.blinkCd = this.pr('blinkCd', 4);
          if (tx !== null && this.blinkTo(tx)) {
            this.facePlayer(p);
            this.beginAttack(0.5, 0.14, 0.45, 'attack');
            this.attackCd = 1.1;
            return;
          }
        }
        if (Math.abs(p.x - this.x) >= 50 * this.reach) {
          this.attackCd = 0.4;
          return;
        }
        this.beginAttack(0.55, 0.14, 0.45, 'attack');
        break;
      }
      case 'frenzy':
        // two quick swipes
        this.beginAttack(0.4, 0.12, 0.1, 'attack');
        this.queue.push({ w: 0.2, a: 0.12, r: 0.4, anim: 'attack' });
        break;
      case 'shackled':
        this.beginAttack(0.7, 0.16, 0.55, 'attack');
        break;
      default:
        this.beginAttack(0.55, 0.14, 0.45, 'attack');
    }
    this.attackCd = this.ab === 'frenzy' ? 0.9 : 1.1;
  }

  protected onChainStep(): void {
    this.facePlayer(this.player);
  }

  protected onActiveStart(): void {
    const big = this.ab === 'shackled';
    this.vx = this.facing * (big ? 150 : 235) * this.speedMult;
    this.world.fx.slash(this.x + this.facing * 22 * (big ? 1.5 : 1), this.y - this.h * 0.55, {
      dir: this.facing,
      radius: 32 * (big ? 1.7 : 1),
      from: big ? -1.5 : -1.0,
      to: big ? 1.1 : 0.9,
      color: this.ab === 'frenzy' ? '#ff7a7a' : big ? '#c9d0da' : '#ffb36a',
    });
    this.world.audio.play(big ? 'swing_heavy' : 'swing', { vol: 0.6 });
    if (big) this.world.shake(2, 0.12);
  }

  protected onActive(): void {
    const f = this.facing;
    const r = this.reach;
    const info: DamageInfo = { amount: this.dmg(ATTACK_DMG.ghoul), dir: f, kind: 'melee', source: this, knockback: this.pr('knock', 190), hitstun: 0.25 };
    hitArea(this.world, { x: f > 0 ? this.x - 4 : this.x - 42 * r, y: this.y - this.h, w: 46 * r, h: this.h }, 'enemy', info, this.hitSet);
  }

  protected onRecoverStart(): void {
    this.vx *= 0.3;
  }

  die(info: DamageInfo): void {
    super.die(info);
    if (this.ab === 'plague') this.leaveCloud();
  }

  /** Plague ghoul: a poison cloud where she falls. */
  private leaveCloud(): void {
    const w = this.world;
    const fy = w.map.floorBelow(this.x, this.y - 6, 160) ?? this.y;
    w.particles.emit('smoke', this.x, this.y - this.h * 0.5, { count: 10 });
    w.spawn(new PoisonCloud(this.x, fy, { radius: this.pr('cloudR', 40), life: this.pr('cloudLife', 3), dps: this.pr('cloudDps', 4) }));
  }

  protected drawTelegraph(ctx: CanvasRenderingContext2D, p: number): void {
    const f = this.facing;
    const reach = 52 * this.reach;
    warnRect(ctx, f > 0 ? this.x : this.x - reach, this.y - this.h, reach, this.h, p, this.time);
  }

  protected drawOverlay(): void {
    if (this.dying) return;
    if (this.ab === 'plague') this.world.lights.add(this.x, this.cy, 34, '#7dff5a', 0.28, 0.2);
    else if (this.ab === 'wraith') this.world.lights.add(this.x, this.cy, 36, '#7fe8ff', 0.3, 0.2);
  }
}
