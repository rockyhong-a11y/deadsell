import { TILE } from '../../engine/config';
import { Entity, type Actor } from '../entity';
import { hitArea } from '../combat';
import type { Player } from '../player/player';
import type { World } from '../world';

/**
 * Small ground hazards left by enemy variants (poison cloud, acid puddle, fire patch), the siren's
 * slow ring + the player-slow effect, the warden's floor shockwave and an unblockable AoE helper.
 * All of them hurt only the player (enemy team), are `alwaysActive` and short lived.
 */

/** Circle (cx, cy, r) vs an actor's hurtbox. */
function circleTouches(a: Actor, cx: number, cy: number, r: number): boolean {
  const b = a.hurtbox();
  const nx = Math.max(b.x, Math.min(cx, b.x + b.w));
  const ny = Math.max(b.y, Math.min(cy, b.y + b.h));
  return (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) <= r * r;
}

/** Is the actor standing on / just above the floor strip [x - hw, x + hw] at floor level `y`? */
function onFloorStrip(a: Actor, x: number, y: number, hw: number): boolean {
  return Math.abs(a.x - x) <= hw + a.w / 2 - 2 && a.y >= y - 10 && a.y <= y + 8;
}

// ---------------------------------------------------------------------------
// zones

/** A timed area that ticks on the player while it stands inside. */
abstract class Zone extends Entity {
  protected age = 0;
  protected tickT = 0;
  protected tickEvery = 0.5;

  constructor(x: number, floorY: number, readonly radius: number, readonly life: number, protected source: Actor | null = null) {
    super(x, floorY);
    this.w = radius * 2;
    this.h = 12;
    this.z = 6;
    this.physics = false;
    this.alwaysActive = true;
  }

  /** 1 while healthy, fading to 0 over the last 0.5 s. */
  protected get fade(): number {
    return Math.max(0, Math.min(1, (this.life - this.age) / 0.5));
  }

  protected abstract inside(p: Player): boolean;
  protected abstract tick(p: Player): void;
  protected ambient(_dt: number): void {}

  /** Seconds the zone has existed. */
  get elapsed(): number {
    return this.age;
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    this.tickT += dt;
    while (this.tickT >= this.tickEvery) {
      this.tickT -= this.tickEvery;
      const p = this.world.player;
      if (p && p.targetable && this.inside(p)) this.tick(p);
    }
    this.ambient(dt);
  }
}

/** Poison cloud (plague ghoul's death): r ≈ 40 px, 3 s, 4 dmg/s while the player is inside it. */
export class PoisonCloud extends Zone {
  private dps: number;

  constructor(x: number, floorY: number, o: { radius?: number; life?: number; dps?: number; source?: Actor | null } = {}) {
    super(x, floorY, o.radius ?? 40, o.life ?? 3, o.source ?? null);
    this.dps = o.dps ?? 4;
  }

  protected inside(p: Player): boolean {
    return circleTouches(p, this.x, this.y - this.radius * 0.45, this.radius);
  }

  protected tick(p: Player): void {
    p.takeDamage({ amount: this.dps * this.tickEvery, dir: 0, kind: 'dot', source: this.source });
    this.world.particles.emit('smoke', p.x, p.y - p.h * 0.6, { count: 2 });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const t = this.age;
    const f = this.fade;
    const r = this.radius;
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const a = i * 1.047 + t * 0.6;
      const ox = Math.cos(a) * r * 0.45;
      const oy = Math.sin(a * 1.3) * r * 0.22;
      ctx.globalAlpha = 0.2 * f;
      ctx.fillStyle = i % 2 ? '#7fd45a' : '#4f9a3a';
      ctx.beginPath();
      ctx.arc(Math.round(this.x + ox), Math.round(this.y - r * 0.45 + oy), r * (0.5 + 0.06 * Math.sin(t * 3 + i)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.5 * f;
    ctx.strokeStyle = '#a6ff7a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(Math.round(this.x), Math.round(this.y) - 1, r, r * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    this.world.lights.add(this.x, this.y - r * 0.4, r * 1.6, '#6dff6a', 0.35 * f, 0.2);
  }
}

/** Acid puddle (alchemist's flask): flat disc on the floor, 2.5 s, damage over time while standing in it. */
export class AcidPuddle extends Zone {
  private dps: number;

  constructor(x: number, floorY: number, o: { radius?: number; life?: number; dps?: number; source?: Actor | null } = {}) {
    super(x, floorY, o.radius ?? 36, o.life ?? 2.5, o.source ?? null);
    this.dps = o.dps ?? 6;
  }

  protected inside(p: Player): boolean {
    return onFloorStrip(p, this.x, this.y, this.radius);
  }

  protected tick(p: Player): void {
    p.takeDamage({ amount: this.dps * this.tickEvery, dir: 0, kind: 'dot', source: this.source });
    this.world.particles.emit('drip', p.x, p.y - 8, { count: 2 });
  }

  protected ambient(dt: number): void {
    if (Math.random() < dt * 6) this.world.particles.emit('drip', this.x + (Math.random() - 0.5) * this.radius * 1.4, this.y - 3, { count: 1 });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const f = this.fade;
    const r = this.radius;
    ctx.save();
    ctx.globalAlpha = 0.55 * f;
    ctx.fillStyle = '#6fbf3a';
    ctx.beginPath();
    ctx.ellipse(Math.round(this.x), Math.round(this.y) - 2, r, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7 * f;
    ctx.fillStyle = '#b6ff6a';
    ctx.beginPath();
    ctx.ellipse(Math.round(this.x), Math.round(this.y) - 3, r * 0.6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // bubbles
    ctx.fillStyle = '#d8ffa8';
    for (let i = 0; i < 4; i++) {
      const ph = (this.age * 1.4 + i * 0.37) % 1;
      ctx.globalAlpha = (1 - ph) * 0.8 * f;
      ctx.fillRect(Math.round(this.x + Math.sin(i * 2.3) * r * 0.6), Math.round(this.y - 3 - ph * 8), 2, 2);
    }
    ctx.restore();
    this.world.lights.add(this.x, this.y - 4, r * 1.4, '#8cff4a', 0.3 * f);
  }
}

/** Fire patch (ember harpy's dive): burns whoever stands in it, 2 s. */
export class FirePatch extends Zone {
  private dps: number;
  private halfW: number;

  constructor(x: number, floorY: number, o: { width?: number; life?: number; dps?: number; source?: Actor | null } = {}) {
    super(x, floorY, (o.width ?? 46) / 2, o.life ?? 2, o.source ?? null);
    this.halfW = this.radius;
    this.dps = o.dps ?? 6;
    this.tickEvery = 0.3;
  }

  protected inside(p: Player): boolean {
    return onFloorStrip(p, this.x, this.y, this.halfW);
  }

  protected tick(p: Player): void {
    p.takeDamage({ amount: 1, dir: 0, kind: 'dot', dotType: 'burn', source: this.source, burn: 1.6, burnDps: this.dps });
  }

  protected ambient(dt: number): void {
    if (Math.random() < dt * 14) this.world.particles.emit('fire', this.x + (Math.random() - 0.5) * this.halfW * 2, this.y - 2, {});
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const f = this.fade;
    const t = this.age;
    ctx.save();
    ctx.globalAlpha = 0.5 * f;
    ctx.fillStyle = '#ff5a1a';
    ctx.fillRect(Math.round(this.x - this.halfW), Math.round(this.y) - 3, Math.round(this.halfW * 2), 3);
    const n = Math.max(3, Math.round(this.halfW / 5));
    for (let i = 0; i < n; i++) {
      const fx = this.x - this.halfW + ((i + 0.5) / n) * this.halfW * 2;
      const h = 6 + 8 * (0.5 + 0.5 * Math.sin(t * 13 + i * 1.9));
      ctx.globalAlpha = 0.9 * f;
      ctx.fillStyle = '#ff7a2a';
      ctx.beginPath();
      ctx.moveTo(Math.round(fx - 4), Math.round(this.y));
      ctx.lineTo(Math.round(fx), Math.round(this.y - h));
      ctx.lineTo(Math.round(fx + 4), Math.round(this.y));
      ctx.fill();
      ctx.fillStyle = '#ffd36a';
      ctx.beginPath();
      ctx.moveTo(Math.round(fx - 2), Math.round(this.y));
      ctx.lineTo(Math.round(fx), Math.round(this.y - h * 0.6));
      ctx.lineTo(Math.round(fx + 2), Math.round(this.y));
      ctx.fill();
    }
    ctx.restore();
    this.world.lights.add(this.x, this.y - 8, this.halfW * 2.2, '#ff7a3a', 0.8 * f, 0.4);
  }
}

// ---------------------------------------------------------------------------
// slow

/**
 * Slows the player (movement −`factor`) for a while. Implemented by cancelling a share of the
 * displacement the player made since the last step, so it needs nothing from the player code.
 */
export class PlayerSlow extends Entity {
  factor: number;
  left: number;
  private lastX = NaN;
  private fxT = 0;

  constructor(factor: number, secs: number) {
    super(0, 0);
    this.factor = factor;
    this.left = secs;
    this.physics = false;
    this.alwaysActive = true;
    this.z = 40;
  }

  update(dt: number): void {
    const p = this.world.player;
    this.left -= dt;
    if (!p || this.left <= 0 || p.dying) {
      this.dead = true;
      return;
    }
    const st = p.state;
    if (!Number.isNaN(this.lastX) && st !== 'hurt' && st !== 'dead' && st !== 'ledge') {
      const dx = p.x - this.lastX;
      if (dx !== 0 && Math.abs(dx) < 12) {
        const nx = p.x - dx * this.factor;
        const b = p.bounds;
        if (!this.world.map.boxSolid({ x: nx - p.w / 2, y: b.y, w: p.w, h: p.h - 1 })) p.x = nx;
      }
    }
    this.lastX = p.x;
    this.fxT -= dt;
    if (this.fxT <= 0 && p.onGround) {
      this.fxT = 0.18;
      this.world.particles.emit('ice', p.x, p.y - 2, { count: 1 });
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const p = this.world.player;
    if (!p) return;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.world.time * 8);
    ctx.strokeStyle = '#8fe3ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(Math.round(p.x), Math.round(p.y) - 1, 11, 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Slow the player by `factor` (0.4 = −40 % speed) for `secs`; refreshes an existing slow. */
export function slowPlayer(world: World, factor: number, secs: number): void {
  const cur = world.entities.find((e): e is PlayerSlow => e instanceof PlayerSlow && !e.dead);
  if (cur) {
    cur.factor = Math.max(cur.factor, factor);
    cur.left = Math.max(cur.left, secs);
    return;
  }
  world.spawn(new PlayerSlow(factor, secs));
}

/** Siren's song: a ring that expands from the singer; the first time its edge passes the player she is slowed. */
export class SongRing extends Entity {
  r = 6;
  private speed: number;
  private maxR: number;
  private slow: number;
  private slowT: number;
  private hit = false;

  constructor(x: number, y: number, o: { maxR?: number; speed?: number; slow?: number; slowT?: number } = {}) {
    super(x, y);
    this.maxR = o.maxR ?? 170;
    this.speed = o.speed ?? 200;
    this.slow = o.slow ?? 0.4;
    this.slowT = o.slowT ?? 2;
    this.physics = false;
    this.alwaysActive = true;
    this.z = 32;
  }

  update(dt: number): void {
    this.r += this.speed * dt;
    const p = this.world.player;
    if (!this.hit && p && p.targetable) {
      const d = Math.hypot(p.x - this.x, p.cy - this.y);
      if (d <= this.r + 4) {
        this.hit = true;
        if (!p.rollInvulnerable && d <= this.maxR + 10) {
          slowPlayer(this.world, this.slow, this.slowT);
          this.world.fx.text(p.x, p.y - p.h - 10, '둔화', '#8fe3ff');
          this.world.particles.emit('magic', p.x, p.cy, { count: 8, color: '#8fe3ff' });
          this.world.audio.play('freeze', { vol: 0.4, pitch: 1.4 });
        }
      }
    }
    if (this.r >= this.maxR) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const k = Math.max(0, 1 - this.r / this.maxR);
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const rr = this.r - i * 9;
      if (rr < 4) continue;
      ctx.globalAlpha = (0.75 - i * 0.2) * (0.35 + 0.65 * k);
      ctx.strokeStyle = i === 0 ? '#ffd6f2' : '#8fe3ff';
      ctx.lineWidth = i === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(Math.round(this.x), Math.round(this.y), rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    this.world.lights.add(this.x, this.y, this.r * 1.3, '#9fd8ff', 0.4 * k);
  }
}

// ---------------------------------------------------------------------------
// shockwave + AoE

/**
 * Warden's small floor shockwave: a low wedge running along the floor. It only hurts things standing on
 * the floor, so it is jumped over. Dies at walls / missing floor / after `maxDist`.
 */
export class FloorWave extends Entity {
  private dir: 1 | -1;
  private speed: number;
  private damage: number;
  private left: number;
  private source: Actor | null;
  private hit = new Set<number>();
  private dustT = 0;
  private t = 0;

  constructor(x: number, floorY: number, dir: 1 | -1, o: { speed?: number; damage: number; maxDist?: number; source?: Actor | null }) {
    super(x, floorY);
    this.dir = dir;
    this.speed = o.speed ?? 230;
    this.damage = o.damage;
    this.left = o.maxDist ?? 170;
    this.source = o.source ?? null;
    this.w = 22;
    this.h = 16;
    this.z = 12;
    this.physics = false;
    this.alwaysActive = true;
  }

  update(dt: number): void {
    this.t += dt;
    const map = this.world.map;
    const step = this.speed * dt;
    this.x += this.dir * step;
    this.left -= step;
    const wallX = this.x + this.dir * (this.w / 2);
    if (map.solidAt(wallX, this.y - 8) && map.solidAt(wallX, this.y - 8 - TILE)) return this.fizzle();
    const f = map.floorBelow(this.x, this.y - TILE + 2, TILE * 2 + 4);
    if (f === null || this.left <= 0) return this.fizzle();
    this.y = f;
    this.dustT -= dt;
    if (this.dustT <= 0) {
      this.dustT = 0.06;
      this.world.particles.emit('dust', this.x, this.y, { dir: -this.dir, count: 2 });
    }
    this.world.lights.add(this.x, this.y - 8, 30, '#ffb35a', 0.6, 0.3);
    hitArea(
      this.world,
      this.bounds,
      'enemy',
      { amount: this.damage, dir: this.dir, kind: 'hazard', source: this.source, unblockable: true, knockback: 200, knockup: 150, hitstun: 0.3 },
      this.hit,
    );
  }

  private fizzle(): void {
    this.world.particles.emit('debris', this.x, this.y - 4, { count: 4 });
    this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const d = this.dir;
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#ffa04a';
    ctx.fillRect(x - d * 22 - (d > 0 ? 0 : 0), y - 4, 22, 4);
    ctx.globalAlpha = 1;
    for (const [ox, h] of [[-12, 8], [-5, 13], [2, 16 + (Math.sin(this.t * 40) > 0 ? 2 : 0)]] as [number, number][]) {
      const bx = x + d * ox;
      ctx.fillStyle = '#120a1a';
      ctx.beginPath();
      ctx.moveTo(bx - 6, y);
      ctx.lineTo(bx + d * 3, y - h - 2);
      ctx.lineTo(bx + 6, y);
      ctx.fill();
      ctx.fillStyle = '#ffb35a';
      ctx.beginPath();
      ctx.moveTo(bx - 4, y);
      ctx.lineTo(bx + d * 3, y - h);
      ctx.lineTo(bx + 4, y);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Unblockable circular ground slam around (x, y): ring + dust + shake, hurts the player. */
export function shockAoE(world: World, x: number, y: number, radius: number, damage: number, source: Actor | null, o: { knockback?: number; knockup?: number } = {}): void {
  world.particles.emit('slam', x, y, { count: 10 });
  world.particles.emit('dust', x, y, { count: 8, w: radius });
  world.audio.play('slam');
  world.fx.ring(x, y - 2, { radius, color: '#ffd9a0', life: 0.3, flat: 0.3 });
  world.lights.add(x, y - 6, radius * 1.8, '#ffb35a', 0.9, 0.2);
  const pl = world.player;
  if (pl) world.shake(5 * Math.max(0.35, 1 - Math.hypot(pl.x - x, pl.cy - y) / 380), 0.25);
  hitArea(
    world,
    { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 },
    'enemy',
    (t) => {
      if (!circleTouches(t, x, y - 6, radius)) return null;
      return { amount: damage, dir: t.x >= x ? 1 : -1, kind: 'melee', source, unblockable: true, knockback: o.knockback ?? 240, knockup: o.knockup ?? 190, hitstun: 0.3 };
    },
    new Set<number>(),
  );
}
