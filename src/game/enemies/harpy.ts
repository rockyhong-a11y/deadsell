import { approach, clamp } from '../../engine/math';
import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { warnLine } from './telegraph';

const SPEC = { hp: 30, w: 22, h: 28, patrol: 40, chase: 120, aura: '#c77dff', blood: '#6a3a8a' };
const DIVE_SPEED = 360;
const DIVE_MAX = 0.9;

/**
 * 하피: flyer (no gravity, still collides with tiles). Hovers above/near the player with a bob,
 * then dives along a telegraphed line (windup 0.6 s), recovers (vulnerable) and returns.
 * Entity position = talons.
 */
export class Harpy extends Enemy {
  private bob = 0;
  private side: 1 | -1 = 1;
  private diveX = 1;
  private diveY = 0;
  private diveLen = 0;
  private diveStart = { x: 0, y: 0 };
  private aimX = 0;
  private aimY = 0;
  private altitude: number;
  private homeY = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}) {
    super('harpy', x, y, opts, SPEC);
    this.gravityScale = 0;
    this.cooldownPause = 0.5;
    this.aggroRange = 300;
    this.altitude = 96;
    this.attackCd = 1.2;
  }

  init(): void {
    super.init();
    this.homeY = this.y;
    this.bob = this.world.rng.range(0, 6.28);
    this.side = this.world.rng.chance(0.5) ? 1 : -1;
    this.play('fly');
  }

  /** Smooth steering toward a point; speed eases off near the target. */
  private steer(tx: number, ty: number, speed: number, dt: number, accel = 520): void {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    const k = clamp(d / 36, 0, 1);
    const wx = d > 0.001 ? (dx / d) * speed * k : 0;
    const wy = d > 0.001 ? (dy / d) * speed * k : 0;
    this.vx = approach(this.vx, wx, accel * dt);
    this.vy = approach(this.vy, wy, accel * dt);
  }

  private hoverTarget(p: Player): { x: number; y: number } {
    return { x: p.x + this.side * 110, y: Math.max(48 + this.h, p.y - this.altitude) + Math.sin(this.time * 3 + this.bob) * 9 };
  }

  protected doPatrol(dt: number, p: Player): void {
    if (this.sees(p)) {
      this.notice(p);
      return;
    }
    if (this.stateT < 0.03) this.homeY = this.y; // (re)entering patrol: hover where we are
    const tx = this.homeX + Math.sin(this.time * 0.7 + this.bob) * 70;
    const ty = this.homeY + Math.sin(this.time * 2.1 + this.bob) * 6;
    this.steer(tx, ty, SPEC.patrol, dt, 200);
    if (Math.abs(this.vx) > 4) this.facing = this.vx > 0 ? 1 : -1;
    this.play('fly');
  }

  protected doChase(dt: number, p: Player): void {
    if (!this.trackTarget(dt, p)) return;
    this.facePlayer(p);
    this.hoverNear(dt, p);
    const dx = Math.abs(p.x - this.x);
    if (this.attackCd <= 0 && this.y < p.y - 30 && dx < 260 && this.sees(p)) this.startAttack(p);
  }

  protected doCooldown(dt: number, p: Player): void {
    this.facePlayer(p);
    this.hoverNear(dt, p);
  }

  private hoverNear(dt: number, p: Player): void {
    if (this.hitWallX) this.side = this.hitWallX > 0 ? -1 : 1;
    const t = this.hoverTarget(p);
    this.steer(t.x, t.y, SPEC.chase * this.speedMult, dt);
    this.play('fly');
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    this.updateAim(p);
    this.beginAttack(0.6, DIVE_MAX, 0.6);
    this.anim?.playFor('dive_windup', 0.6);
    this.attackCd = 2.4 + this.world.rng.range(0, 1.2);
  }

  private updateAim(p: Player): void {
    this.aimX = p.x;
    this.aimY = p.y - p.h * 0.5;
  }

  protected onWindup(dt: number, p: Player): void {
    // hold position, trembling; the dive line tracks the player and locks for the last 30 %
    this.vx = approach(this.vx, 0, 900 * dt);
    this.vy = approach(this.vy, 0, 900 * dt);
    if (this.telegraph < 0.7) {
      this.updateAim(p);
      this.facePlayer(p);
    }
  }

  private diveVector(): { x: number; y: number; len: number } {
    const dx = this.aimX - this.x;
    const dy = this.aimY - (this.y - this.h / 2);
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d, len: d + 70 };
  }

  protected onActiveStart(): void {
    const v = this.diveVector();
    this.diveX = v.x;
    this.diveY = v.y;
    this.diveLen = v.len;
    this.diveStart = { x: this.x, y: this.y };
    this.vx = v.x * DIVE_SPEED * this.speedMult;
    this.vy = v.y * DIVE_SPEED * this.speedMult;
    this.play('dive');
    this.world.audio.play('swing', { vol: 0.6, pitch: 1.3 });
  }

  protected onActive(): void {
    const b = this.bounds;
    hitArea(
      this.world,
      { x: b.x - 4, y: b.y - 2, w: b.w + 8, h: b.h + 6 },
      'enemy',
      { amount: this.dmg(10), dir: this.vx >= 0 ? 1 : -1, kind: 'melee', source: this, knockback: 230, knockup: 100, hitstun: 0.25 },
      this.hitSet,
    );
    // keep the straight line (collisions zero a component of the velocity)
    const travelled = Math.hypot(this.x - this.diveStart.x, this.y - this.diveStart.y);
    if (this.hitWallX || this.hitCeiling || this.onGround || travelled >= this.diveLen) this.endActive();
    else {
      this.vx = this.diveX * DIVE_SPEED * this.speedMult;
      this.vy = this.diveY * DIVE_SPEED * this.speedMult;
    }
  }

  protected onRecoverStart(): void {
    this.anim?.playFor('recover', this.atk?.r ?? 0.6);
  }

  protected onRecover(dt: number): void {
    this.vx = approach(this.vx, 0, 700 * dt);
    this.vy = approach(this.vy, 0, 700 * dt);
  }

  protected drawOverlay(ctx: CanvasRenderingContext2D): void {
    const p = this.telegraph;
    if (p < 0) return;
    const v = this.diveVector();
    const sx = this.x;
    const sy = this.y - this.h / 2;
    warnLine(ctx, sx, sy, sx + v.x * v.len, sy + v.y * v.len, 0.35 + 0.65 * p, p > 0.7 ? 2 : 1, undefined, p > 0.7 ? 0 : 4);
  }
}
