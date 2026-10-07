import { TILE } from '../../engine/config';
import type { AABB } from '../../engine/math';
import { Actor, Entity } from '../entity';
import { hitArea } from '../combat';
import type { World } from '../world';
import { circleHitsBox } from '../enemies/projectiles';
import { warnCircle } from '../enemies/telegraph';

/**
 * Hazards of the four mid-bosses (docs/CONTENT2.md section 2): the spider queen's web blob + the root it
 * causes, the valkyrie's floor sword-beam, the witch's homing moon orbs and falling moon shards.
 * All of them hurt only the player, are `alwaysActive` and short lived; none depends on sprite sheets.
 */

// ---------------------------------------------------------------------------
// web

/** Holds the player's feet in place for a while (they can still attack and jump): the web blob's effect. */
export class WebRoot extends Entity {
  left: number;
  private pinX: number;
  private t = 0;

  constructor(x: number, secs: number) {
    super(x, 0);
    this.pinX = x;
    this.left = secs;
    this.physics = false;
    this.alwaysActive = true;
    this.z = 40;
  }

  update(dt: number): void {
    const p = this.world.player;
    this.t += dt;
    this.left -= dt;
    if (!p || this.left <= 0 || p.dying) {
      this.dead = true;
      return;
    }
    // a hit that knocks her back frees the pin point (she stays rooted where she lands)
    if (p.state === 'hurt' || p.state === 'dead') this.pinX = p.x;
    else {
      p.x = this.pinX;
      p.vx = 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const p = this.world.player;
    if (!p) return;
    const fade = Math.min(1, this.left / 0.3);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    ctx.save();
    ctx.globalAlpha = 0.85 * fade;
    ctx.strokeStyle = '#e9edf5';
    ctx.lineWidth = 1;
    // strands from the feet up the legs, and a net on the floor
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 7, y);
      ctx.lineTo(x + i * 3, y - 14 - (i === 0 ? 6 : 0));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(x, y - 1, 15, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y - 1, 8, 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Root the player for `secs` (refreshes a running root). */
export function rootPlayer(world: World, secs: number): void {
  const p = world.player;
  if (!p) return;
  const cur = world.entities.find((e): e is WebRoot => e instanceof WebRoot && !e.dead);
  if (cur) {
    cur.left = Math.max(cur.left, secs);
    return;
  }
  world.spawn(new WebRoot(p.x, secs));
  world.fx.text(p.x, p.y - p.h - 10, '속박!', '#e9edf5');
  world.particles.emit('smoke', p.x, p.y - 8, { count: 6, color: '#e9edf5' });
}

/** The spider queen's web blob: a straight, fairly slow shot; a hit hurts a little and roots the target. */
export class WebBlob extends Entity {
  life = 2.6;
  private hit = new Set<number>();
  private t = 0;

  constructor(x: number, y: number, vx: number, vy: number, readonly damage: number, readonly rootT: number, readonly source: Actor | null) {
    super(x, y);
    this.vx = vx;
    this.vy = vy;
    this.w = 14;
    this.h = 14;
    this.z = 30;
    this.physics = false;
    this.alwaysActive = true;
  }

  get bounds(): AABB {
    return { x: this.x - 7, y: this.y - 7, w: 14, h: 14 };
  }
  get cy(): number {
    return this.y;
  }

  update(dt: number): void {
    this.life -= dt;
    this.t += dt;
    const w = this.world;
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 6));
    for (let i = 0; i < steps && !this.dead; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      if (w.map.solidAt(this.x, this.y)) {
        this.splat();
        return;
      }
      const reports = hitArea(
        w,
        this.bounds,
        'enemy',
        { amount: this.damage, dir: this.vx >= 0 ? 1 : -1, kind: 'ranged', source: this.source, knockback: 60, hitstun: 0.12 },
        this.hit,
      );
      if (reports.length) {
        for (const r of reports) if (r.result.applied) rootPlayer(w, this.rootT);
        this.splat();
        return;
      }
    }
    if (this.life <= 0) this.splat();
  }

  private splat(): void {
    this.world.particles.emit('smoke', this.x, this.y, { count: 5, color: '#e9edf5' });
    this.world.audio.play('arrow_hit', { vol: 0.4, pitch: 0.7 });
    this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    ctx.save();
    ctx.fillStyle = '#120a1a';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9edf5';
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#aab4c8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
    // trailing strands
    ctx.globalAlpha = 0.5;
    const d = Math.hypot(this.vx, this.vy) || 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(Math.round(x - (this.vx / d) * 16), Math.round(y - (this.vy / d) * 16));
    ctx.stroke();
    ctx.restore();
    this.world.lights.add(this.x, this.y, 16, '#dfe8ff', 0.3);
  }
}

// ---------------------------------------------------------------------------
// sword beam

/**
 * The valkyrie's sword beam: a low crescent that runs along the floor in `dir`. It only hurts things
 * standing on the floor (jump it); dies at walls, ledges and after `maxDist`.
 */
export class SwordBeam extends Entity {
  private left: number;
  private hit = new Set<number>();
  private t = 0;
  private dustT = 0;

  constructor(x: number, floorY: number, readonly dir: 1 | -1, readonly speed: number, readonly damage: number, readonly source: Actor | null, maxDist = 760) {
    super(x, floorY);
    this.left = maxDist;
    this.w = 24;
    this.h = 30;
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
      this.dustT = 0.07;
      this.world.particles.emit('spark', this.x, this.y - 4, { dir: -this.dir, count: 1, color: '#bfe3ff' });
    }
    this.world.lights.add(this.x, this.y - 12, 36, '#9fd0ff', 0.7, 0.25);
    hitArea(
      this.world,
      this.bounds,
      'enemy',
      { amount: this.damage, dir: this.dir, kind: 'hazard', source: this.source, unblockable: true, knockback: 190, knockup: 150, hitstun: 0.3 },
      this.hit,
    );
  }

  private fizzle(): void {
    this.world.particles.emit('spark', this.x, this.y - 8, { count: 5, color: '#bfe3ff' });
    this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const d = this.dir;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#7fb8ff';
    ctx.fillRect(x - d * 38 - (d > 0 ? 0 : 0), y - 4, 38, 4);
    ctx.globalAlpha = 1;
    // crescent: outer dark rim, pale blade, white edge
    const grow = 1 + 0.08 * Math.sin(this.t * 30);
    for (const [r, col] of [[17, '#120a1a'], [15, '#8fc4ff'], [10, '#f2fbff']] as [number, string][]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, r * 0.55 * grow, r * grow, 0, d > 0 ? -Math.PI / 2 : Math.PI / 2, d > 0 ? Math.PI / 2 : -Math.PI / 2, false);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// moon orbs

/**
 * One of the witch's slow homing orbs. It is a (1 hp) enemy-team Actor, so it can be cut down with a
 * swing or an arrow; otherwise it homes in at a limited turn rate and bursts on the player or a wall.
 */
export class MoonOrb extends Actor {
  life: number;
  private ang: number;
  private hit = new Set<number>();
  private t = 0;

  constructor(x: number, y: number, angle: number, readonly damage: number, readonly speed: number, readonly turn: number, life: number, readonly source: Actor | null) {
    super(x, y);
    this.ang = angle;
    this.life = life;
    this.maxHp = this.hp = 1;
    this.w = 14;
    this.h = 14;
    this.z = 30;
    this.physics = false;
    this.alwaysActive = true;
    this.knockbackTaken = 0;
    this.bloodColor = '#cfe6ff';
  }

  get bounds(): AABB {
    return { x: this.x - 7, y: this.y - 7, w: 14, h: 14 };
  }
  get cy(): number {
    return this.y;
  }

  /** a swing or an arrow pops it */
  die(): void {
    this.dying = true;
    this.pop(false);
  }

  private pop(onPlayer: boolean): void {
    if (this.dead) return;
    this.dead = true;
    const w = this.world;
    w.particles.emit('magic', this.x, this.y, { count: 10, color: '#cfe6ff' });
    w.fx.ring(this.x, this.y, { radius: 18, color: '#cfe6ff', life: 0.2 });
    w.audio.play(onPlayer ? 'hit' : 'arrow_hit', { vol: 0.4, pitch: 1.4 });
  }

  update(dt: number): void {
    if (this.dead) return;
    this.t += dt;
    this.life -= dt;
    const w = this.world;
    const p = w.player;
    if (p && p.targetable) {
      // steer toward the player's chest at a limited turn rate
      const want = Math.atan2(p.cy - this.y, p.x - this.x);
      let d = want - this.ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const max = this.turn * dt;
      this.ang += Math.max(-max, Math.min(max, d));
    }
    this.vx = Math.cos(this.ang) * this.speed;
    this.vy = Math.sin(this.ang) * this.speed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (w.map.solidAt(this.x, this.y)) return this.pop(false);
    const reports = hitArea(
      w,
      this.bounds,
      'enemy',
      { amount: this.damage, dir: this.vx >= 0 ? 1 : -1, kind: 'ranged', source: this.source, knockback: 110, hitstun: 0.2 },
      this.hit,
    );
    if (reports.length) return this.pop(true);
    if (this.life <= 0) this.pop(false);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 12);
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.life / 0.4);
    ctx.fillStyle = '#120a1a';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7fa8ff';
    ctx.beginPath();
    ctx.arc(x, y, 6.5 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.world.lights.add(this.x, this.y, 26, '#8fb8ff', 0.7 + 0.2 * pulse);
  }
}

// ---------------------------------------------------------------------------
// moon shards

/**
 * A moon shard that falls at a marked spot: the red ground circle shows from the moment it is created;
 * after `delay` seconds the crystal drops from `topY` and bursts on landing.
 */
export class MoonShard extends Entity {
  private age = 0;
  private falling = false;
  private hit = new Set<number>();
  private spin = 0;

  constructor(
    x: number,
    readonly groundY: number,
    topY: number,
    private delay: number,
    readonly damage: number,
    readonly source: Actor | null,
    readonly radius = 30,
  ) {
    super(x, topY);
    this.w = 14;
    this.h = 22;
    this.z = 28;
    this.physics = false;
    this.alwaysActive = true;
  }

  get bounds(): AABB {
    return { x: this.x - 7, y: this.y - 11, w: 14, h: 22 };
  }
  get cy(): number {
    return this.y;
  }

  /** true while the marker is up and the shard has not started to fall */
  get pending(): boolean {
    return !this.falling;
  }

  update(dt: number): void {
    this.age += dt;
    const w = this.world;
    if (!this.falling) {
      if (this.age >= this.delay) {
        this.falling = true;
        this.vy = 140;
        w.particles.emit('magic', this.x, this.y + 4, { count: 4, color: '#cfe6ff' });
      }
      return;
    }
    this.vy = Math.min(720, this.vy + 2100 * dt);
    this.spin += dt * 5;
    const prev = this.y;
    this.y += this.vy * dt;
    hitArea(
      w,
      this.bounds,
      'enemy',
      { amount: this.damage, dir: 0, kind: 'hazard', source: this.source, unblockable: true, knockback: 150, hitstun: 0.25 },
      this.hit,
    );
    if (this.y >= this.groundY - 6 && prev < this.groundY + 8) this.land();
  }

  private land(): void {
    const w = this.world;
    this.dead = true;
    w.particles.emit('magic', this.x, this.groundY - 6, { count: 12, color: '#cfe6ff', power: 1.2 });
    w.particles.emit('land', this.x, this.groundY, { count: 5 });
    w.audio.play('slam', { vol: 0.5, pitch: 1.3 });
    w.fx.ring(this.x, this.groundY - 4, { radius: this.radius, color: '#a9d2ff', life: 0.22, flat: 0.4 });
    w.shake(2.5, 0.12);
    w.lights.add(this.x, this.groundY - 8, this.radius * 2, '#9fd0ff', 0.9, 0.2);
    hitArea(
      w,
      { x: this.x - this.radius, y: this.groundY - this.radius, w: this.radius * 2, h: this.radius },
      'enemy',
      (t) =>
        circleHitsBox(this.x, this.groundY - 6, this.radius, t.hurtbox())
          ? { amount: this.damage, dir: t.x >= this.x ? 1 : -1, kind: 'hazard', source: this.source, unblockable: true, knockback: 170, knockup: 130, hitstun: 0.25 }
          : null,
      this.hit,
    );
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const t = this.world.time;
    if (!this.falling) {
      warnCircle(ctx, this.x, this.groundY, this.radius, Math.min(1, this.age / Math.max(0.01, this.delay)), t);
      return;
    }
    warnCircle(ctx, this.x, this.groundY, this.radius, 1, t);
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(this.spin) * 0.25);
    ctx.fillStyle = '#120a1a';
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.lineTo(-8, 0);
    ctx.lineTo(0, -13);
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#bfe0ff';
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.lineTo(-6, 0);
    ctx.lineTo(0, -11);
    ctx.lineTo(6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-1, -7, 2, 8);
    ctx.restore();
    this.world.lights.add(this.x, this.y, 26, '#a9d2ff', 0.8);
  }
}
