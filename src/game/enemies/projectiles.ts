import type { AABB } from '../../engine/math';
import { Entity, type Actor } from '../entity';
import type { DamageInfo, Team } from '../combat';
import { hitArea } from '../combat';
import { moveBody } from '../physics';
import type { World } from '../world';
import { warnCircle } from './telegraph';
import { AcidPuddle } from './hazards';

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
  o: { knockback?: number; knockup?: number; team?: Team; shake?: number; freeze?: number; burn?: number; color?: string } = {},
): void {
  const power = Math.max(0.6, radius / 44);
  const frost = !!o.freeze;
  const color = o.color ?? (frost ? '#8fe3ff' : '#ffb35a');
  if (frost) {
    world.particles.emit('ice', x, y, { count: 18, power });
    world.particles.emit('smoke', x, y - 6, { count: 3 });
  } else {
    world.particles.emit('explosion', x, y, { power });
    world.particles.emit('smoke', x, y - 6, { count: 6 });
  }
  world.audio.play(frost ? 'freeze' : 'explosion');
  world.fx.ring(x, y, { radius, color, life: 0.3 });
  world.lights.add(x, y, radius * 2.2, frost ? '#8fe3ff' : '#ff9a4a', 1.2);
  const px = world.player;
  if (px) {
    const d = Math.hypot(px.x - x, px.cy - y);
    world.shake((o.shake ?? 6) * Math.max(0.35, 1 - d / 400), 0.3);
  }
  world.fx.screenFlash(frost ? '#bdefff' : '#ffcf8a', 0.06, 0.18);
  hitArea(
    world,
    { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 },
    o.team ?? 'enemy',
    (t) => {
      if (!circleHitsBox(x, y, radius, t.hurtbox())) return null;
      const dir = t.x >= x ? 1 : -1;
      const info: DamageInfo = { amount: damage, dir, kind: 'explosion', source, unblockable: true, knockback: o.knockback ?? 260, knockup: o.knockup ?? 170, hitstun: 0.3 };
      if (o.freeze) info.freeze = o.freeze;
      if (o.burn) info.burn = o.burn;
      return info;
    },
    new Set<number>(),
  );
}

// ---------------------------------------------------------------------------

export interface ArrowOpts {
  /** sets the target on fire (seconds) */
  burn?: number;
  burnDps?: number;
  /** 'fire' = burning tip + flame trail, 'feather' = the storm harpy's feather */
  style?: 'arrow' | 'fire' | 'feather';
  life?: number;
}

/** Enemy arrow. Centre-anchored; (x, y) is the arrow's centre. */
export class Arrow extends Entity implements Reflectable {
  readonly kind = 'ranged' as const;
  readonly reflectable = true as const;
  team: Team = 'enemy';
  damage: number;
  source: Actor | null;
  life = 3;
  reflected = false;
  readonly burn: number;
  readonly burnDps: number;
  readonly style: 'arrow' | 'fire' | 'feather';
  private hit = new Set<number>();
  private trailT = 0;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, source: Actor | null = null, o: ArrowOpts = {}) {
    super(x, y);
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.source = source;
    this.burn = o.burn ?? 0;
    this.burnDps = o.burnDps ?? 5;
    this.style = o.style ?? (o.burn ? 'fire' : 'arrow');
    if (o.life) this.life = o.life;
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
      if (this.burn > 0) {
        info.burn = this.burn;
        info.burnDps = this.burnDps;
      }
      const reports = hitArea(this.world, this.bounds, this.team, info, this.hit);
      if (reports.some((r) => r.result.applied || r.result.blocked || r.result.parried)) {
        this.world.audio.play('arrow_hit', { vol: 0.6 });
        this.dead = true;
        return;
      }
    }
    if (this.life <= 0) this.dead = true;
    if (this.style === 'fire' && !this.reflected) {
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.05;
        this.world.particles.emit('fire', this.x, this.y, { count: 1 });
      }
    }
    this.anim?.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const rot = Math.atan2(this.vy, this.vx);
    if (this.style === 'feather') {
      // grey-white feather with a storm-blue tip
      ctx.save();
      ctx.translate(Math.round(this.x), Math.round(this.y));
      ctx.rotate(rot);
      ctx.fillStyle = '#120a1a';
      ctx.fillRect(-8, -3, 16, 6);
      ctx.fillStyle = this.reflected ? '#8fe3ff' : '#e9f0f7';
      ctx.fillRect(-7, -2, 12, 4);
      ctx.fillStyle = '#6aa8ff';
      ctx.fillRect(3, -2, 4, 4);
      ctx.restore();
      this.world.lights.add(this.x, this.y, 16, '#9fc8ff', 0.4);
      return;
    }
    if (!this.anim) return;
    const fire = this.style === 'fire' && !this.reflected;
    this.anim.draw(ctx, this.x, this.y, false, { rotation: rot, outline: this.reflected ? '#8fe3ff' : fire ? '#ff7a2a' : undefined });
    this.world.lights.add(this.x, this.y, fire ? 26 : 18, this.reflected ? '#8fe3ff' : fire ? '#ff8a3a' : '#ff6a40', fire ? 0.8 : 0.5);
  }
}

/**
 * Crossbow bolt: heavy and piercing. It is not consumed by what it hits (it passes through the target
 * and flies on until a wall or its life runs out), and it cannot be reflected by a shield.
 */
export class Bolt extends Entity {
  readonly kind = 'ranged' as const;
  readonly reflectable = false as const;
  team: Team = 'enemy';
  damage: number;
  source: Actor | null;
  life = 2;
  /** how many targets it has gone through */
  pierced = 0;
  private hit = new Set<number>();

  constructor(x: number, y: number, vx: number, vy: number, damage: number, source: Actor | null = null) {
    super(x, y);
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.source = source;
    this.w = 10;
    this.h = 10;
    this.z = 30;
    this.physics = false;
  }

  get bounds(): AABB {
    return { x: this.x - 5, y: this.y - 5, w: 10, h: 10 };
  }
  get cy(): number {
    return this.y;
  }

  update(dt: number): void {
    this.life -= dt;
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 6));
    for (let i = 0; i < steps && !this.dead; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      if (this.world.map.solidAt(this.x, this.y)) {
        this.world.particles.emit('spark', this.x, this.y, { dir: -Math.sign(this.vx) || 1, count: 6 });
        this.world.audio.play('arrow_hit', { vol: 0.6 });
        this.dead = true;
        return;
      }
      const reports = hitArea(
        this.world,
        this.bounds,
        this.team,
        { amount: this.damage, dir: this.vx >= 0 ? 1 : -1, kind: 'ranged', source: this.source, knockback: 220, hitstun: 0.25 },
        this.hit,
      );
      for (const r of reports) {
        if (r.result.applied || r.result.blocked || r.result.parried) {
          this.pierced++;
          this.world.audio.play('arrow_hit', { vol: 0.7 });
          this.world.particles.emit('spark', this.x, this.y, { dir: Math.sign(this.vx) || 1, count: 4 });
        }
      }
    }
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    ctx.rotate(Math.atan2(this.vy, this.vx));
    ctx.fillStyle = '#120a1a';
    ctx.fillRect(-13, -3, 24, 6);
    ctx.fillStyle = '#6b5a48';
    ctx.fillRect(-12, -2, 18, 4);
    ctx.fillStyle = '#e0b04a';
    ctx.beginPath();
    ctx.moveTo(5, -4);
    ctx.lineTo(13, 0);
    ctx.lineTo(5, 4);
    ctx.fill();
    ctx.restore();
    this.world.lights.add(this.x, this.y, 20, '#ffd27a', 0.5);
  }
}

/**
 * Chain hook (chain jailer): flies out up to `range` px; if it hits the player it drags her toward the
 * thrower (until she is `stopAt` px away or the pull times out). `connected` tells the thrower to bash.
 */
export class ChainHook extends Entity {
  connected = false;
  private owner: Actor;
  private dx: number;
  private dy: number;
  private range: number;
  private speed: number;
  private damage: number;
  private pull: number;
  private travelled = 0;
  private pulling = 0;
  private stopAt: number;
  private hit = new Set<number>();

  constructor(x: number, y: number, dx: number, dy: number, owner: Actor, o: { range: number; speed: number; damage: number; pull: number; stopAt?: number }) {
    super(x, y);
    const l = Math.hypot(dx, dy) || 1;
    this.dx = dx / l;
    this.dy = dy / l;
    this.owner = owner;
    this.range = o.range;
    this.speed = o.speed;
    this.damage = o.damage;
    this.pull = o.pull;
    this.stopAt = o.stopAt ?? 44;
    this.w = 10;
    this.h = 10;
    this.z = 31;
    this.physics = false;
    this.alwaysActive = true;
  }

  get bounds(): AABB {
    return { x: this.x - 5, y: this.y - 5, w: 10, h: 10 };
  }
  get cy(): number {
    return this.y;
  }

  /** is the hook still out (flying or dragging)? */
  get busy(): boolean {
    return !this.dead;
  }

  update(dt: number): void {
    const w = this.world;
    const p = w.player;
    if (this.owner.dead || this.owner.dying) {
      this.dead = true;
      return;
    }
    if (this.pulling > 0) {
      this.pulling -= dt;
      const dir = Math.sign(this.owner.x - p.x) || 1;
      this.x = p.x;
      this.y = p.cy;
      if (Math.abs(this.owner.x - p.x) <= this.stopAt || this.pulling <= 0 || !p.targetable) {
        p.vx = 0;
        this.dead = true;
        return;
      }
      p.vx = dir * this.pull;
      p.facing = dir as 1 | -1;
      return;
    }
    const step = this.speed * dt;
    this.x += this.dx * step;
    this.y += this.dy * step;
    this.travelled += step;
    if (w.map.solidAt(this.x, this.y) || this.travelled >= this.range) {
      if (w.map.solidAt(this.x, this.y)) w.particles.emit('spark', this.x, this.y, { count: 4 });
      this.dead = true;
      return;
    }
    const pdir = Math.sign(this.owner.x - p.x) || 1;
    const reports = hitArea(
      w,
      this.bounds,
      'enemy',
      { amount: this.damage, dir: pdir, kind: 'ranged', source: this.owner, hitstun: 0.3 },
      this.hit,
    );
    for (const r of reports) {
      if (r.target !== p) continue;
      if (r.result.applied) {
        this.connected = true;
        this.pulling = 0.45;
        w.audio.play('hit', { vol: 0.7 });
        w.particles.emit('spark', p.x, p.cy, { dir: pdir, count: 6 });
      } else this.dead = true; // blocked / parried / rolled through: the hook falls away
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const o = this.owner;
    const sx = o.x + o.facing * 10;
    const sy = o.y - o.h * 0.6;
    ctx.save();
    ctx.strokeStyle = '#120a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.round(sx), Math.round(sy));
    ctx.lineTo(Math.round(this.x), Math.round(this.y));
    ctx.stroke();
    ctx.strokeStyle = '#b9c2cf';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(Math.round(sx), Math.round(sy));
    ctx.lineTo(Math.round(this.x), Math.round(this.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d8dde8';
    ctx.beginPath();
    ctx.arc(Math.round(this.x), Math.round(this.y), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
  /** freeze the player this long (frost bomb) */
  freeze?: number;
  /** split into this many bomblets when it lands (cluster bomb) */
  split?: number;
  bombletDamage?: number;
  bombletRadius?: number;
  /** a flask: shatters shortly after landing into an acid puddle instead of exploding */
  puddle?: { radius: number; life: number; dps: number };
  /** outline colour of the sprite (variant bombs) */
  tint?: string;
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
  private opts: BombOpts;

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
    this.opts = o;
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
        if (this.opts.split) {
          this.splitUp();
          return;
        }
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
      const pd = this.opts.puddle;
      if (pd) {
        this.world.particles.emit('drip', this.x, this.y - 6, { count: 8 });
        this.world.particles.emit('smoke', this.x, this.y - 6, { count: 3 });
        this.world.audio.play('hit', { vol: 0.6, pitch: 0.8 });
        this.world.spawn(new AcidPuddle(this.x, this.y, { radius: pd.radius, life: pd.life, dps: pd.dps, source: this.source }));
        return;
      }
      explode(this.world, this.x, this.y - 6, this.radius, this.damage, this.source, { knockback: 280, knockup: 190, freeze: this.opts.freeze });
      return;
    }
    this.anim?.update(dt);
  }

  /** Cluster bomb: bursts into bomblets that hop apart and go off a moment later. */
  private splitUp(): void {
    const n = this.opts.split ?? 3;
    this.exploded = true;
    this.dead = true;
    this.world.audio.play('throw', { vol: 0.6, pitch: 1.3 });
    this.world.particles.emit('spark', this.x, this.y - 8, { count: 6 });
    for (let i = 0; i < n; i++) {
      const vx = (i - (n - 1) / 2) * 90 + this.world.rng.range(-14, 14);
      this.world.spawn(
        new Bomb(this.x, this.y - 8, vx, -230 - this.world.rng.range(0, 40), {
          damage: this.opts.bombletDamage ?? Math.round(this.damage * 0.55),
          radius: this.opts.bombletRadius ?? 30,
          fuse: 0.6 + i * 0.12,
          source: this.source,
          tint: this.opts.tint,
        }),
      );
    }
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
    this.anim?.draw(ctx, this.x, this.y - this.h / 2, false, {
      flash: this.landed && Math.sin(t * (14 + 30 * (1 - this.fuse / this.fuseTime))) > 0.6 ? 0.7 : 0,
      flashColor: '#ff7050',
      outline: this.opts.tint,
    });
  }
}

/** Initial velocity for a ballistic lob from (x0, y0) landing at (x1, y1) after `T` seconds (BOMB_G gravity). */
export function lobVelocity(x0: number, y0: number, x1: number, y1: number, T: number): { vx: number; vy: number } {
  return { vx: (x1 - x0) / T, vy: (y1 - y0 - 0.5 * BOMB_G * T * T) / T };
}
