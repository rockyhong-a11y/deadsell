import { Entity } from '../entity';
import type { Actor } from '../entity';
import { hitArea, type DamageInfo, type HitReport } from '../combat';
import type { ItemInstance } from '../items/types';
import type { Player } from './player';
import { moveBody } from '../physics';
import { GRAVITY, MAX_FALL } from '../../engine/config';
import { approach, overlaps } from '../../engine/math';
import type { Sfx } from '../../engine/audio';

/** How a hit should feel (hit-stop seconds, camera shake, sfx). */
export interface Feel { hitstop: number; shake: number; sfx?: Sfx }

const sgn = (v: number) => (v < 0 ? -1 : 1);

// ---------------------------------------------------------------------------
/** Arrow shot by the heroine or her turret: hits the first enemy, sticks in walls. */
export class Arrow extends Entity {
  z = 30;
  physics = false;
  alwaysActive = true;
  private life = 1.6;
  private stuck = 0;
  private ang: number;

  constructor(
    x: number, y: number, vx: number, vy: number,
    readonly owner: Player, readonly item: ItemInstance, readonly info: DamageInfo, readonly feel: Feel,
  ) {
    super(x, y);
    this.w = 6;
    this.h = 6;
    this.vx = vx;
    this.vy = vy;
    this.ang = Math.atan2(vy, vx);
    this.facing = sgn(vx);
  }

  get bounds() {
    return { x: this.x - 3, y: this.y - 3, w: 6, h: 6 };
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.play('arrow');
  }

  update(dt: number): void {
    if (this.stuck > 0) {
      this.stuck -= dt;
      if (this.stuck <= 0) this.dead = true;
      return;
    }
    this.life -= dt;
    if (this.life <= 0) {
      this.dead = true;
      return;
    }
    const w = this.world;
    const n = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 5));
    for (let i = 0; i < n; i++) {
      this.x += (this.vx * dt) / n;
      this.y += (this.vy * dt) / n;
      if (w.map.solidAt(this.x, this.y)) {
        this.stuck = 0.45;
        this.vx = this.vy = 0;
        w.particles.emit('spark', this.x, this.y, { dir: -Math.cos(this.ang) > 0 ? 1 : -1, count: 4 });
        w.audio.play('arrow_hit', { vol: 0.5 });
        return;
      }
      const reports = hitArea(w, this.bounds, 'player', this.info);
      if (reports.length) {
        for (const r of reports) this.owner.onDealt(r, this.item, this.info, { sfx: 'arrow_hit', ...this.feel });
        this.dead = true;
        return;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false, { rotation: this.ang, alpha: this.stuck > 0 ? Math.min(1, this.stuck * 4) : 1 });
  }
}

// ---------------------------------------------------------------------------
/** Short-lived light/glow burst (explosions). */
class Glow extends Entity {
  z = 31;
  physics = false;
  private t = 0;
  constructor(x: number, y: number, private r: number, private color: string, private life = 0.4) {
    super(x, y);
  }
  update(dt: number): void {
    this.t += dt;
    if (this.t >= this.life) this.dead = true;
  }
  draw(): void {
    const k = 1 - this.t / this.life;
    this.world.lights.add(this.x, this.y, this.r * (1.2 + 0.6 * (1 - k)), this.color, 1.2 * k);
  }
}

export interface ExplosionOpts {
  radius: number;
  base: number;
  kind: 'fire' | 'ice';
}

/** Circle AoE around (x, y): damages (and burns / freezes) every enemy in range. */
export function explode(owner: Player, item: ItemInstance, x: number, y: number, o: ExplosionOpts): HitReport[] {
  const w = owner.world;
  const fire = o.kind === 'fire';
  const infos = new Map<Actor, DamageInfo>();
  const reports = hitArea(w, { x: x - o.radius, y: y - o.radius, w: o.radius * 2, h: o.radius * 2 }, 'player', (t) => {
    const b = t.hurtbox();
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    if (Math.hypot(nx - x, ny - y) > o.radius) return null;
    const info = owner.damageInfo(item, o.base, {
      kind: 'explosion',
      unblockable: true,
      dir: sgn(t.x - x),
      knockback: fire ? 170 : 60,
      knockup: fire ? 140 : 0,
      ...(fire ? { burn: 4, burnDps: 6 } : { freeze: 3, hitstun: 0 }),
    });
    infos.set(t, info);
    return info;
  });
  for (const r of reports) owner.onDealt(r, item, infos.get(r.target)!, { hitstop: 0.06, shake: 2 });
  w.particles.emit(fire ? 'explosion' : 'ice', x, y, { count: fire ? 28 : 22, power: o.radius / 40 });
  w.fx.ring(x, y, { radius: o.radius, color: fire ? '#ffb347' : '#9fe8ff', life: 0.3 });
  if (!fire) w.fx.screenFlash('#bfefff', 0.1, 0.25);
  w.shake(fire ? 4 : 2.5, 0.25);
  w.audio.play(fire ? 'explosion' : 'freeze');
  w.spawn(new Glow(x, y, o.radius * 2.4, fire ? '#ff8a3c' : '#8fe3ff'));
  return reports;
}

// ---------------------------------------------------------------------------
/** Thrown fire / ice grenade: arcs, bounces, explodes on contact or after a short fuse. */
export class Grenade extends Entity {
  z = 30;
  alwaysActive = true;
  private fuse = -1;
  private t = 0;
  private spin = 0;

  constructor(x: number, y: number, vx: number, vy: number, readonly owner: Player, readonly item: ItemInstance, readonly type: 'fire' | 'ice', readonly base: number) {
    super(x, y);
    this.w = 8;
    this.h = 8;
    this.vx = vx;
    this.vy = vy;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.play(this.type === 'fire' ? 'fire_grenade' : 'ice_grenade');
  }

  stepPhysics(dt: number): void {
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
    const pvx = this.vx;
    const pvy = this.vy;
    moveBody(this, this.world.map, dt);
    if (this.onGround) {
      if (this.fuse < 0) this.fuse = 0.45;
      if (pvy > 70) {
        this.vy = -pvy * 0.38;
        this.onGround = false;
      }
      this.vx = approach(this.vx, 0, 500 * dt);
    }
    if (this.hitWallX) this.vx = -pvx * 0.4;
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    this.spin += dt * 9 * sgn(this.vx || 1);
    const w = this.world;
    if (Math.random() < dt * 24) w.particles.emit(this.type === 'fire' ? 'fire' : 'ice', this.x, this.y - 4, { count: 1 });
    const box = this.bounds;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable) continue;
      if (overlaps(box, a.hurtbox())) return this.boom();
    }
    if (this.fuse >= 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) return this.boom();
    }
    if (this.t > 2.4 || this.y > w.map.pxH + 60) this.boom();
  }

  private boom(): void {
    if (this.dead) return;
    this.dead = true;
    const fire = this.type === 'fire';
    explode(this.owner, this.item, this.x, this.y - 4, { radius: fire ? 40 : 60, base: this.base, kind: this.type });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y - 4, false, { rotation: this.spin });
    this.world.lights.add(this.x, this.y - 4, 34, this.type === 'fire' ? '#ff8a3c' : '#8fe3ff', 0.7, 0.2);
  }
}

// ---------------------------------------------------------------------------
/** Crossbow turret: deploys, then shoots arrows at the nearest enemy within 220 px for 10 s. */
export class Turret extends Entity {
  z = 15;
  static readonly LIFE = 10;
  static readonly RANGE = 220;
  private t = 0;
  private cd = 0.55;
  private shootT = 0;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1) {
    super(x, y);
    this.w = 20;
    this.h = 24;
    this.facing = face;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.playFor('turret_deploy', 0.5);
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    const w = this.world;
    if (this.t >= Turret.LIFE) {
      w.particles.emit('smoke', this.x, this.y - 12, { count: 8 });
      this.dead = true;
      return;
    }
    if (this.t < 0.5) return;
    if (this.shootT > 0) {
      this.shootT -= dt;
      if (this.shootT <= 0) this.anim!.play('turret_idle', true);
    } else if (this.anim!.name !== 'turret_idle') this.anim!.play('turret_idle', true);
    this.cd -= dt;
    const target = this.pickTarget();
    if (target) this.facing = target.x >= this.x ? 1 : -1;
    if (target && this.cd <= 0) {
      this.cd = 0.7;
      this.shootT = 0.3;
      this.anim!.playFor('turret_shoot', 0.3);
      const sx = this.x + this.facing * 12;
      const sy = this.y - 14;
      const tb = target.hurtbox();
      const dx = tb.x + tb.w / 2 - sx;
      const dy = tb.y + tb.h * 0.45 - sy;
      const d = Math.hypot(dx, dy) || 1;
      const speed = 480;
      const info = this.owner.damageInfo(this.item, this.base, { kind: 'ranged', dir: sgn(dx) });
      w.spawn(new Arrow(sx, sy, (dx / d) * speed, (dy / d) * speed, this.owner, this.item, info, { hitstop: 0.02, shake: 0 }));
      w.audio.play('turret', { vol: 0.6 });
      w.particles.emit('spark', sx, sy, { dir: this.facing, count: 2 });
    }
  }

  private pickTarget(): Actor | null {
    const w = this.world;
    let best: Actor | null = null;
    let bd = Turret.RANGE;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable) continue;
      const d = Math.hypot(a.cx - this.x, a.cy - (this.y - 14));
      if (d < bd && w.map.lineOfSight(this.x, this.y - 14, a.cx, a.cy)) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = Turret.LIFE - this.t;
    const alpha = left < 1.2 ? 0.45 + 0.55 * Math.abs(Math.sin(this.t * 14)) : 1;
    // the turret sheet is centred (anchor 24,24): lift it so the base sits on the floor
    this.anim?.draw(ctx, this.x, this.y - 14, this.facing < 0, { alpha });
    this.world.lights.add(this.x, this.y - 14, 26, '#ffd27a', 0.4);
  }
}

// ---------------------------------------------------------------------------
/** Wolf trap: arms after a moment; the first enemy to step on it is rooted for 3 s and hurt. */
export class WolfTrap extends Entity {
  z = 6;
  static readonly ROOT = 3;
  private t = 0;
  private victim: Actor | null = null;
  private pinX = 0;
  private snapT = 0;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number) {
    super(x, y);
    this.w = 30;
    this.h = 12;
  }

  get armed(): boolean {
    return this.t >= 0.4 && !this.victim;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.play('trap_open');
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    const w = this.world;
    if (this.victim) {
      this.snapT += dt;
      const v = this.victim;
      if (v.dead || !v.targetable || this.snapT > WolfTrap.ROOT + 0.4) {
        if (this.snapT > WolfTrap.ROOT + 0.4 || v.dead || v.dying) this.dead = true;
        return;
      }
      if (this.snapT < WolfTrap.ROOT) {
        v.vx = 0;
        v.x = this.pinX;
        v.status.stun = Math.max(v.status.stun, 0.2);
      }
      return;
    }
    if (this.t > 30) {
      this.dead = true;
      return;
    }
    if (!this.armed) return;
    const box = this.bounds;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable || !overlaps(box, a.hurtbox())) continue;
      this.snap(a);
      break;
    }
  }

  private snap(a: Actor): void {
    const w = this.world;
    this.victim = a;
    this.pinX = a.x;
    this.snapT = 0;
    this.anim!.playFor('trap_snap', 0.25);
    const info = this.owner.damageInfo(this.item, this.base, { kind: 'trap', unblockable: true, dir: 0, stun: WolfTrap.ROOT, hitstun: 0.1, knockback: 0 });
    const res = a.takeDamage(info);
    this.owner.onDealt({ target: a, result: res }, this.item, info, { hitstop: 0.05, shake: 1.5, sfx: 'hit' });
    w.audio.play('trap');
    w.particles.emit('spark', this.x, this.y - 6, { count: 8 });
    // a trap never lets go early: make sure the root sticks even if damage was absorbed
    if (res.applied) a.status.stun = Math.max(a.status.stun, WolfTrap.ROOT);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const fade = this.victim ? Math.min(1, (WolfTrap.ROOT + 0.4 - this.snapT) * 3) : 1;
    this.anim?.draw(ctx, this.x, this.y - 18, false, { alpha: this.armed || this.victim ? fade : 0.6 });
  }
}
