import { GRAVITY } from '../../engine/config';
import { clamp } from '../../engine/math';
import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { shockAoE } from './hazards';
import { warnCircle, warnPath, warnRect } from './telegraph';
import { ATTACK_DMG, BASE_STATS, type EnemyDef } from './variants';

const SPEC = { hp: BASE_STATS.lancer.hp, w: 20, h: 48, patrol: 28, chase: 66, aura: BASE_STATS.lancer.aura, blood: '#8a5a8a' };
const CHARGE_SPEED = 330;
const CHARGE_MAX = 1.2;

type Mode = 'thrust' | 'charge' | 'sweep' | 'duel' | 'leap';

/**
 * 창기병: charges (0.7 s glowing windup + floor line) when the player is level and within 300 px,
 * runs until a wall / ledge / 1.2 s, then is stunned-open for ~1 s. Close range: spear thrust.
 * Variants: halberd (no charge, wide 2-hit sweep), paladin (frontal shield, still charges),
 * duelist (3-thrust combo, parries the first hit after each attack), dragoon (leaps onto the player).
 */
export class Lancer extends Enemy {
  private mode: Mode = 'thrust';
  private dustT = 0;
  private chargeFrom = 0;
  /** index of the swing inside a combo */
  private swing = 0;
  private leapX = 0;
  private leapGroundY = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}, variant: EnemyDef | null = null) {
    super('lancer', x, y, opts, SPEC, variant);
    this.cooldownPause = 0.4;
    this.aggroRange = 300;
    if (this.ab === 'paladin') this.guard = 'shield';
    else if (this.ab === 'duelist') {
      this.guard = 'parry';
      this.cooldownPause = 0.3;
    }
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
    const dy = Math.abs(p.y - this.y);
    switch (this.ab) {
      case 'halberd':
        return dy < 36 && dx < (this.pr('reach', 70) + 6) * this.scale;
      case 'duelist':
        return dy < 36 && dx < 84 * this.scale;
      case 'dragoon':
        if (dy < 36 && dx < 62 * this.scale) return true;
        return dy < 70 && dx >= this.pr('leapMin', 90) && dx <= this.pr('leapMax', 260) && this.sees(p);
      default:
    }
    if (dy >= 36) return false;
    if (dx < 62 * this.scale) return true;
    if (dx >= 130 && dx <= 300) return this.sees(p);
    return false;
  }

  /** Follow-ups of a combo: the first swing starts now, the rest are queued (`endActive` chains them). */
  private combo(n: number, first: { w: number; a: number; r: number }, next: { w: number; a: number; r: number }, anim: string): void {
    this.swing = 0;
    const lastR = next.r;
    this.beginAttack(first.w, first.a, n === 1 ? lastR : first.r, anim);
    for (let i = 1; i < n; i++) this.queue.push({ w: next.w, a: next.a, r: i === n - 1 ? lastR : first.r, anim });
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    this.parryReady = false;
    const dx = Math.abs(p.x - this.x);
    if (this.ab === 'halberd') {
      this.mode = 'sweep';
      this.combo(Math.round(this.pr('hits', 2)), { w: 0.6, a: 0.14, r: 0.12 }, { w: 0.28, a: 0.16, r: 0.7 }, 'thrust');
      this.attackCd = 1.2;
    } else if (this.ab === 'duelist') {
      this.mode = 'duel';
      this.combo(Math.round(this.pr('thrusts', 3)), { w: 0.35, a: 0.1, r: 0.1 }, { w: 0.14, a: 0.1, r: 0.55 }, 'thrust');
      this.attackCd = 0.9;
    } else if (this.ab === 'dragoon' && dx >= 62 * this.scale) {
      this.mode = 'leap';
      this.leapX = p.x;
      this.leapGroundY = p.y;
      this.beginAttack(0.65, 1.3, 0.8);
      this.anim?.playFor('charge_windup', 0.65);
      this.attackCd = 3.2;
    } else if (dx < 62 * this.scale) {
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

  protected onChainStep(): void {
    this.swing++;
    this.facePlayer(this.player);
  }

  protected onWindup(dt: number, p: Player): void {
    super.onWindup(dt, p);
    if (this.mode === 'leap' && this.telegraph < 0.65) {
      // the landing marker follows the player, then locks for the last third
      const max = this.pr('leapMax', 260);
      this.leapX = clamp(p.x, this.x - max, this.x + max);
      this.leapGroundY = p.y;
      this.facePlayer(p);
    }
  }

  protected onActiveStart(): void {
    const w = this.world;
    if (this.mode === 'sweep') {
      this.vx = this.facing * 40;
      const hi = this.swing === 0;
      w.audio.play('swing_heavy', { vol: 0.7, pitch: hi ? 1 : 1.15 });
      w.fx.slash(this.x + this.facing * 30, this.y - this.h * 0.6, { dir: this.facing, radius: 52, from: hi ? -1.7 : 0.9, to: hi ? 0.5 : -1.1, color: '#dfe6f2', width: 3 });
      return;
    }
    if (this.mode === 'duel') {
      this.vx = this.facing * 150;
      w.audio.play('stab', { vol: 0.6, pitch: 1 + 0.12 * this.swing });
      w.fx.slash(this.x + this.facing * 34, this.y - this.h * 0.55, { dir: this.facing, radius: 34, from: -0.2, to: 0.2, color: '#f1e2ff' });
      return;
    }
    if (this.mode === 'leap') {
      const T = this.pr('leapT', 0.6);
      const gy = w.map.floorBelow(this.leapX, this.leapGroundY - 30, 400) ?? this.y;
      this.vx = (this.leapX - this.x) / T;
      this.vy = (gy - this.y - 0.5 * GRAVITY * T * T) / T;
      this.onGround = false;
      this.facing = this.vx >= 0 ? 1 : -1;
      this.play('charge');
      w.audio.play('swing_heavy', { vol: 0.8, pitch: 0.8 });
      w.particles.emit('dust', this.x, this.y, { count: 8, dir: -this.facing });
      return;
    }
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
    if (this.mode === 'sweep') {
      const reach = this.pr('reach', 70) * this.scale;
      this.vx *= 0.9;
      hitArea(
        this.world,
        { x: f > 0 ? this.x - 8 : this.x - reach, y: this.y - this.h - 6, w: reach + 8, h: this.h + 6 },
        'enemy',
        { amount: this.dmg(ATTACK_DMG.poke), dir: f, kind: 'melee', source: this, knockback: 250, hitstun: 0.3 },
        this.hitSet,
      );
      return;
    }
    if (this.mode === 'duel') {
      this.vx *= 0.88;
      hitArea(
        this.world,
        { x: f > 0 ? this.x : this.x - 68 * this.scale, y: this.y - this.h * 0.8, w: 68 * this.scale, h: this.h * 0.5 },
        'enemy',
        { amount: this.dmg(ATTACK_DMG.poke), dir: f, kind: 'melee', source: this, knockback: 150, hitstun: 0.2 },
        this.hitSet,
      );
      return;
    }
    if (this.mode === 'leap') {
      // airborne until she lands; the landing is the attack
      if (this.onGround && this.stateT > 0.12) {
        this.vx = 0;
        shockAoE(this.world, this.x, this.y, this.pr('aoeR', 52), this.dmg(ATTACK_DMG.charge), this, { knockback: 240, knockup: 200 });
        this.endActive();
      }
      return;
    }
    if (this.mode === 'thrust') {
      this.vx *= 0.9;
      hitArea(
        this.world,
        { x: f > 0 ? this.x : this.x - 70 * this.scale, y: this.y - this.h * 0.8, w: 70 * this.scale, h: this.h * 0.5 },
        'enemy',
        { amount: this.dmg(ATTACK_DMG.poke), dir: f, kind: 'melee', source: this, knockback: 220, hitstun: 0.25 },
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
      { amount: this.dmg(ATTACK_DMG.charge), dir: f, kind: 'melee', source: this, knockback: 320, hitstun: 0.3 },
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
    if (this.mode === 'sweep') {
      const reach = this.pr('reach', 70) * this.scale;
      warnRect(ctx, f > 0 ? this.x - 8 : this.x - reach, this.y - this.h - 6, reach + 8, this.h + 6, p, this.time);
      return;
    }
    if (this.mode === 'duel') {
      const reach = 70 * this.scale;
      warnRect(ctx, f > 0 ? this.x : this.x - reach, this.y - this.h * 0.8, reach, this.h * 0.5, p, this.time);
      return;
    }
    if (this.mode === 'leap') {
      const gy = this.world.map.floorBelow(this.leapX, this.leapGroundY - 30, 400) ?? this.y;
      warnCircle(ctx, this.leapX, gy, this.pr('aoeR', 52), p, this.time);
      return;
    }
    if (this.mode === 'thrust') {
      const reach = 72 * this.scale;
      warnRect(ctx, f > 0 ? this.x : this.x - reach, this.y - this.h * 0.8, reach, this.h * 0.5, p, this.time);
      return;
    }
    const run = this.chargeRunway();
    const x1 = this.x + f * run;
    warnPath(ctx, this.x, x1, this.y, f, p, this.time);
  }

  protected drawOverlay(): void {
    if (this.dying) return;
    if (this.ab === 'paladin') this.world.lights.add(this.x, this.cy, 52, '#ffd86a', 0.4, 0.1);
    else if (this.ab === 'dragoon') this.world.lights.add(this.x, this.cy, 30, '#5a8cff', 0.2);
  }
}
