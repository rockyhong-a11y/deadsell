import type { AABB } from '../../engine/math';
import { Entity, type Actor } from '../entity';
import type { DamageInfo, Team } from '../combat';
import { hitArea } from '../combat';
import { moveBody } from '../physics';
import type { World } from '../world';
import { warnCircle } from './telegraph';

/** Anything a shield can bounce back (arrows). The player's shield looks for `reflect`. */
export interface Reflectable {
  readonly kind: 'ranged';
  readonly reflectable: true;
  team: Team;
  /** `by` is the reflecting team, or the reflecting actor (the player's shield passes itself) */
  reflect(by: Team | { team: Team }): void;
}

export function isReflectable(e: unknown): e is Reflectable & Entity {
  return !!e && (e as Reflectable).reflectable === true && typeof (e as Reflectable).reflect === 'function';
}

/** Circle (cx, cy, r) vs AABB overlap. */
export function circleHitsBox(cx: number, cy: number, r: number, b: AABB): boolean {
  const nx = Math.max(b.x, Math.min(cx, b.x + b.w));
  const ny = Math.max(b.y, Math.min(cy, b.y + b.h));
  return (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) <= r * r;
}

/**
 * Unblockable circular explosion that hurts whoever is NOT on `team` (default: hurts the player).
 * Returns nothing; damage goes through hitArea so shields/rolls behave normally.
 */
export function explode(
  world: World,
  x: number,
  y: number,
  radius: number,
  damage: number,
  source: Actor | null,
  o: { knockback?: number; knockup?: number; team?: Team; shake?: number } = {},
): void {
  const power = Math.max(0.6, radius / 44);
  world.particles.emit('explosion', x, y, { power });
  world.particles.emit('smoke', x, y - 6, { count: 6 });
  world.audio.play('explosion');
  world.fx.ring(x, y, { radius, color: '#ffb35a', life: 0.3 });
  world.lights.add(x, y, radius * 2.2, '#ff9a4a', 1.2);
  const px = world.player;
  if (px) {
    const d = Math.hypot(px.x - x, px.cy - y);
    world.shake((o.shake ?? 6) * Math.max(0.35, 1 - d / 400), 0.3);
  }
  world.fx.screenFlash('#ffcf8a', 0.06, 0.18);
  hitArea(
    world,
    { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 },
    o.team ?? 'enemy',
    (t) => {
      if (!circleHitsBox(x, y, radius, t.hurtbox())) return null;
      const dir = t.x >= x ? 1 : -1;
      return { amount: damage, dir, kind: 'explosion', source, unblockable: true, knockback: o.knockback ?? 260, knockup: o.knockup ?? 170, hitstun: 0.3 };
    },
    new Set<number>(),
  );
}

// ---------------------------------------------------------------------------

/** Enemy arrow. Centre-anchored; (x, y) is the arrow's centre. */
export class Arrow extends Entity implements Reflectable {
  readonly kind = 'ranged' as const;
  readonly reflectable = true as const;
  team: Team = 'enemy';
  damage: number;
  source: Actor | null;
  life = 3;
  reflected = false;
  private hit = new Set<number>();

  constructor(x: number, y: number, vx: number, vy: number, damage: number, source: Actor | null = null) {
    super(x, y);
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.source = source;
    this.w = 8;
    this.h = 8;
    this.z = 30;
    this.physics = false;
  }

  get bounds(): AABB {
    return { x: this.x - 4, y: this.y - 4, w: 8, h: 8 };
  }
  get cy(): number {
    return this.y;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim?.play('arrow');
  }

  /** A shield bounced it back: it now hurts enemies and flies the other way (faster, stronger). */
  reflect(by: Team | { team: Team } = 'player'): void {
    this.team = typeof by === 'string' ? by : by.team;
    this.vx = -this.vx * 1.2;
    this.vy = -this.vy * 1.2;
    this.damage = Math.round(this.damage * 1.5);
    this.hit.clear();
    this.reflected = true;
    this.life = 2.5;
    this.source = null;
    this.world.particles.emit('spark', this.x, this.y, { dir: this.vx > 0 ? 1 : -1, count: 8 });
    this.world.audio.play('parry');
  }

  update(dt: number): void {
    this.life -= dt;
    // sub-step so a fast arrow cannot tunnel through a thin wall or a player
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 6));
    for (let i = 0; i < steps && !this.dead; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      if (this.world.map.solidAt(this.x, this.y)) {
        this.world.particles.emit('spark', this.x, this.y, { dir: -Math.sign(this.vx) || 1, count: 4 });
        this.world.audio.play('arrow_hit', { vol: 0.5 });
        this.dead = true;
        return;
      }
      const info: DamageInfo = {
        amount: this.damage,
        dir: this.vx >= 0 ? 1 : -1,
        kind: 'ranged',
        source: this.source,
        knockback: 140,
        hitstun: 0.2,
      };
      const reports = hitArea(this.world, this.bounds, this.team, info, this.hit);
      if (reports.some((r) => r.result.applied || r.result.blocked || r.result.parried)) {
        this.world.audio.play('arrow_hit', { vol: 0.6 });
        this.dead = true;
        return;
      }
    }
    if (this.life <= 0) this.dead = true;
    this.anim?.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.anim) return;
    this.anim.draw(ctx, this.x, this.y, false, { rotation: Math.atan2(this.vy, this.vx), outline: this.reflected ? '#8fe3ff' : undefined });
    this.world.lights.add(this.x, this.y, 18, this.reflected ? '#8fe3ff' : '#ff6a40', 0.5);
  }
}

// ---------------------------------------------------------------------------

const BOMB_G = 900;
export const BOMB_FUSE = 0.8;
export const BOMB_RADIUS = 44;

export interface BombOpts {
  damage: number;
  radius?: number;
  fuse?: number;
  source?: Actor | null;
  /** predicted landing spot (for the early warning ring) */
  targetX?: number;
  targetY?: number;
}

/**
 * Ballistic bomb. Lands, then a 0.8 s fuse with a red ground warning circle, then an
 * unblockable explosion of `radius` px.
 */
export class Bomb extends Entity {
  readonly damage: number;
  readonly radius: number;
  readonly fuseTime: number;
  fuse: number;
  landed = false;
  exploded = false;
  private source: Actor | null;
  private tx: number | null;
  private ty: number | null;
  private age = 0;

  constructor(x: number, y: number, vx: number, vy: number, o: BombOpts) {
    super(x, y);
    this.vx = vx;
    this.vy = vy;
    this.w = 10;
    this.h = 10;
    this.z = 25;
    this.physics = false;
    this.damage = o.damage;
    this.radius = o.radius ?? BOMB_RADIUS;
    this.fuseTime = this.fuse = o.fuse ?? BOMB_FUSE;
    this.source = o.source ?? null;
    this.tx = o.targetX ?? null;
    this.ty = o.targetY ?? null;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim?.play('bomb');
  }

  update(dt: number): void {
    if (this.exploded) return;
    this.age += dt;
    this.vy += (this.vy < 700 ? BOMB_G : 0) * dt;
    const pre = this.vy;
    moveBody(this, this.world.map, dt);
    if (this.onGround) {
      if (!this.landed) {
        this.landed = true;
        this.world.particles.emit('land', this.x, this.y, { count: 4 });
      }
      if (pre > 140) this.vy = -pre * 0.25;
      this.vx *= Math.pow(0.02, dt);
    }
    if (this.hitWallX) this.vx = -this.hitWallX * 40;
    // a bomb that never lands (stuck mid-air) still goes off
    if (this.landed || this.age > 2.5) this.fuse -= dt;
    if (this.fuse <= 0) {
      this.exploded = true;
      this.dead = true;
      explode(this.world, this.x, this.y - 6, this.radius, this.damage, this.source, { knockback: 280, knockup: 190 });
      return;
    }
    this.anim?.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const t = this.world.time;
    if (this.landed) {
      const p = 1 - Math.max(0, this.fuse) / this.fuseTime;
      warnCircle(ctx, this.x, this.y, this.radius, p, t);
      this.world.lights.add(this.x, this.y - 6, 40, '#ff6a30', 0.4 + 0.6 * p, 0.4);
    } else if (this.tx !== null && this.ty !== null) {
      warnCircle(ctx, this.tx, this.ty, this.radius, 0, t);
    }
    this.anim?.draw(ctx, this.x, this.y - this.h / 2, false, { flash: this.landed && Math.sin(t * (14 + 30 * (1 - this.fuse / this.fuseTime))) > 0.6 ? 0.7 : 0, flashColor: '#ff7050' });
  }
}

/** Initial velocity for a ballistic lob from (x0, y0) landing at (x1, y1) after `T` seconds (BOMB_G gravity). */
export function lobVelocity(x0: number, y0: number, x1: number, y1: number, T: number): { vx: number; vy: number } {
  return { vx: (x1 - x0) / T, vy: (y1 - y0 - 0.5 * BOMB_G * T * T) / T };
}
