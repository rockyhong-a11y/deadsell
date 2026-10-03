import { TILE } from '../../engine/config';
import type { AABB } from '../../engine/math';
import { Entity, type Actor } from '../entity';
import { hitArea } from '../combat';
import { circleHitsBox } from '../enemies/projectiles';
import { warnCircle } from '../enemies/telegraph';

/**
 * Floor shockwave from the Matron's slam. A low wedge that runs along the floor in `dir`;
 * it only hurts things standing on the floor, so it is jumped over. Dies at walls / missing floor.
 */
export class Shockwave extends Entity {
  private dir: 1 | -1;
  private speed: number;
  private damage: number;
  private left: number;
  private source: Actor | null;
  private hit = new Set<number>();
  private dustT = 0;
  private t = 0;

  constructor(x: number, floorY: number, dir: 1 | -1, speed: number, damage: number, source: Actor | null, maxDist = 760) {
    super(x, floorY);
    this.dir = dir;
    this.speed = speed;
    this.damage = damage;
    this.source = source;
    this.left = maxDist;
    this.w = 30;
    this.h = 26;
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
    // follow the floor (one-tile steps), die at walls / pits
    const wallX = this.x + this.dir * (this.w / 2);
    if (map.solidAt(wallX, this.y - 8) && map.solidAt(wallX, this.y - 8 - TILE)) return this.fizzle();
    const f = map.floorBelow(this.x, this.y - TILE + 2, TILE * 2 + 4);
    if (f === null || this.left <= 0) return this.fizzle();
    this.y = f;
    this.dustT -= dt;
    if (this.dustT <= 0) {
      this.dustT = 0.05;
      this.world.particles.emit('dust', this.x, this.y, { dir: -this.dir, count: 2 });
    }
    this.world.lights.add(this.x, this.y - 10, 40, '#ff7a3a', 0.8, 0.3);
    hitArea(
      this.world,
      this.bounds,
      'enemy',
      { amount: this.damage, dir: this.dir, kind: 'hazard', source: this.source, unblockable: true, knockback: 240, knockup: 170, hitstun: 0.35 },
      this.hit,
    );
  }

  private fizzle(): void {
    this.world.particles.emit('debris', this.x, this.y - 4, { count: 5 });
    this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const d = this.dir;
    const flick = Math.sin(this.t * 40) > 0 ? 2 : 0;
    ctx.save();
    // trailing glow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ff5a2a';
    ctx.fillRect(x - d * 34 - (d > 0 ? 0 : 0), y - 5, 34, 5);
    ctx.globalAlpha = 1;
    // jagged crest: three spikes growing toward the leading edge
    const spikes: [number, number][] = [[-22, 10], [-11, 18], [0, 26 + flick]];
    for (const [ox, h] of spikes) {
      const bx = x + d * ox;
      ctx.fillStyle = '#120a1a';
      ctx.beginPath();
      ctx.moveTo(bx - 8, y);
      ctx.lineTo(bx + d * 4, y - h - 2);
      ctx.lineTo(bx + 8, y);
      ctx.fill();
      ctx.fillStyle = '#ff7a3a';
      ctx.beginPath();
      ctx.moveTo(bx - 6, y);
      ctx.lineTo(bx + d * 4, y - h);
      ctx.lineTo(bx + 6, y);
      ctx.fill();
      ctx.fillStyle = '#ffe2a8';
      ctx.fillRect(Math.round(bx + d * 4) - 1, y - h, 2, 3);
    }
    ctx.restore();
  }
}

/**
 * Debris that falls at a marked spot (summon / phase-2 rain). The red ground circle is visible from
 * the moment it spawns; after `delay` seconds the rock drops from the ceiling and explodes on landing.
 */
export class Debris extends Entity {
  private delay: number;
  private age = 0;
  private falling = false;
  private groundY: number;
  private radius: number;
  private damage: number;
  private source: Actor | null;
  private hit = new Set<number>();
  private spin = 0;

  constructor(x: number, groundY: number, topY: number, delay: number, damage: number, source: Actor | null, radius = 34) {
    super(x, topY);
    this.groundY = groundY;
    this.delay = delay;
    this.damage = damage;
    this.source = source;
    this.radius = radius;
    this.w = 22;
    this.h = 22;
    this.z = 28;
    this.physics = false;
    this.alwaysActive = true;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim?.play('boss_debris');
  }

  get bounds(): AABB {
    return { x: this.x - 11, y: this.y - 11, w: 22, h: 22 };
  }
  get cy(): number {
    return this.y;
  }

  update(dt: number): void {
    this.age += dt;
    if (!this.falling) {
      if (this.age >= this.delay) {
        this.falling = true;
        this.vy = 120;
        this.world.particles.emit('dust', this.x, this.y + 8, { count: 3 });
      }
      return;
    }
    this.vy = Math.min(680, this.vy + 1900 * dt);
    this.spin += dt * 6;
    const prev = this.y;
    this.y += this.vy * dt;
    // mid-air contact
    hitArea(
      this.world,
      this.bounds,
      'enemy',
      { amount: this.damage, dir: 0, kind: 'hazard', source: this.source, unblockable: true, knockback: 160, hitstun: 0.3 },
      this.hit,
    );
    if (this.y >= this.groundY - 6 && prev < this.groundY + 8) this.land();
  }

  private land(): void {
    const w = this.world;
    this.dead = true;
    w.particles.emit('debris', this.x, this.groundY - 6, { count: 10, power: 1.2 });
    w.particles.emit('land', this.x, this.groundY, { count: 6 });
    w.audio.play('slam', { vol: 0.6 });
    w.fx.ring(this.x, this.groundY - 4, { radius: this.radius, color: '#ffb35a', life: 0.2 });
    w.shake(3, 0.15);
    hitArea(
      w,
      { x: this.x - this.radius, y: this.groundY - this.radius, w: this.radius * 2, h: this.radius },
      'enemy',
      (t) =>
        circleHitsBox(this.x, this.groundY - 6, this.radius, t.hurtbox())
          ? { amount: this.damage, dir: t.x >= this.x ? 1 : -1, kind: 'hazard', source: this.source, unblockable: true, knockback: 200, knockup: 140, hitstun: 0.3 }
          : null,
      this.hit,
    );
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const t = this.world.time;
    if (!this.falling) {
      warnCircle(ctx, this.x, this.groundY, this.radius, Math.min(1, this.age / this.delay), t);
      return;
    }
    // shadow stays on the floor while the rock falls
    warnCircle(ctx, this.x, this.groundY, this.radius, 1, t);
    this.anim?.draw(ctx, this.x, this.y, false, { rotation: this.spin });
    this.world.lights.add(this.x, this.y, 22, '#ff8a4a', 0.4);
  }
}
