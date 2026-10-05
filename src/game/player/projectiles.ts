import { Entity } from '../entity';
import type { Actor } from '../entity';
import { hitArea, type DamageInfo, type HitReport } from '../combat';
import type { ItemInstance } from '../items/types';
import type { Player } from './player';
import { moveBody } from '../physics';
import { GRAVITY, MAX_FALL, TILE } from '../../engine/config';
import { approach, overlaps } from '../../engine/math';
import type { Sfx } from '../../engine/audio';

/** How a hit should feel (hit-stop seconds, camera shake, sfx). */
export interface Feel { hitstop: number; shake: number; sfx?: Sfx }

const sgn = (v: number) => (v < 0 ? -1 : 1);
/** unique items (docs/CONTENT3.md §5): bone-white outline / sparks */
const BONE = '#f0e6d2';

// ---------------------------------------------------------------------------
/**
 * Arrow shot by the heroine or her turret: hits the first enemy, sticks in walls. A `pierce` arrow (a fully drawn 골수 활
 * shot) flies on through every enemy and hits each one once.
 */
export class Arrow extends Entity {
  z = 30;
  physics = false;
  alwaysActive = true;
  private life = 1.6;
  private stuck = 0;
  private ang: number;
  private readonly pierced: Set<number> | undefined;

  constructor(
    x: number, y: number, vx: number, vy: number,
    readonly owner: Player, readonly item: ItemInstance, readonly info: DamageInfo, readonly feel: Feel,
    readonly pierce = false,
  ) {
    super(x, y);
    this.w = 6;
    this.h = 6;
    this.vx = vx;
    this.vy = vy;
    this.ang = Math.atan2(vy, vx);
    this.facing = sgn(vx);
    this.pierced = pierce ? new Set<number>() : undefined;
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
      const reports = hitArea(w, this.bounds, 'player', this.info, this.pierced);
      if (reports.length) {
        for (const r of reports) this.owner.onDealt(r, this.item, this.info, { sfx: 'arrow_hit', ...this.feel });
        if (!this.pierce) {
          this.dead = true;
          return;
        }
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false, { rotation: this.ang, alpha: this.stuck > 0 ? Math.min(1, this.stuck * 4) : 1, outline: this.pierce ? BONE : undefined });
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

/** Grenade numbers (shown in the codex): blast radius, burn (fire) / freeze (ice) seconds. */
export const GRENADE = {
  fire: { radius: 40, burn: 4, burnDps: 6 },
  ice: { radius: 60, freeze: 3 },
} as const;

export interface ExplosionOpts {
  radius: number;
  base: number;
  kind: 'fire' | 'ice' | 'corpse';
}

/** 시체 폭탄 numbers (skills.ts `CORPSE_BOMB`): blast radius, and the one chain burst of every enemy the blast kills. */
export interface BombSpec {
  radius: number;
  chain: { radius: number; base: number };
}

/** Circle AoE around (x, y): damages (and burns / freezes) every enemy in range. */
export function explode(owner: Player, item: ItemInstance, x: number, y: number, o: ExplosionOpts): HitReport[] {
  const w = owner.world;
  const fire = o.kind === 'fire';
  const corpse = o.kind === 'corpse';
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
      knockback: fire ? 170 : corpse ? 150 : 60,
      knockup: fire ? 140 : corpse ? 120 : 0,
      ...(fire ? { burn: GRENADE.fire.burn, burnDps: GRENADE.fire.burnDps } : corpse ? {} : { freeze: GRENADE.ice.freeze, hitstun: 0 }),
    });
    infos.set(t, info);
    return info;
  });
  for (const r of reports) owner.onDealt(r, item, infos.get(r.target)!, { hitstop: 0.06, shake: 2 });
  w.particles.emit(fire || corpse ? 'explosion' : 'ice', x, y, { count: fire || corpse ? 28 : 22, power: o.radius / 40 });
  if (corpse) w.particles.emit('debris', x, y, { count: 8, color: BONE, power: o.radius / 40 });
  w.fx.ring(x, y, { radius: o.radius, color: fire ? '#ffb347' : corpse ? BONE : '#9fe8ff', life: 0.3 });
  if (!fire && !corpse) w.fx.screenFlash('#bfefff', 0.1, 0.25);
  w.shake(fire || corpse ? 4 : 2.5, 0.25);
  w.audio.play(fire || corpse ? 'explosion' : 'freeze');
  w.spawn(new Glow(x, y, o.radius * 2.4, fire ? '#ff8a3c' : corpse ? '#ff6a5a' : '#8fe3ff'));
  return reports;
}

// ---------------------------------------------------------------------------
/**
 * Thrown fire / ice grenade: arcs, bounces, explodes on contact or after a short fuse. The 시체 폭탄 (`corpse`) is the same
 * flight with a bone outline; its blast has no status, but every enemy it kills bursts once more (`bomb.chain`).
 */
export class Grenade extends Entity {
  z = 30;
  alwaysActive = true;
  private fuse = -1;
  private t = 0;
  private spin = 0;

  constructor(
    x: number, y: number, vx: number, vy: number, readonly owner: Player, readonly item: ItemInstance,
    readonly type: 'fire' | 'ice' | 'corpse', readonly base: number, readonly bomb?: BombSpec,
  ) {
    super(x, y);
    this.w = 8;
    this.h = 8;
    this.vx = vx;
    this.vy = vy;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.play(this.type === 'ice' ? 'ice_grenade' : 'fire_grenade');
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
    if (Math.random() < dt * 24) w.particles.emit(this.type === 'ice' ? 'ice' : 'fire', this.x, this.y - 4, { count: 1 });
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
    const o = this.owner;
    if (this.type === 'corpse' && this.bomb) {
      const reports = explode(o, this.item, this.x, this.y - 4, { radius: this.bomb.radius, base: this.base, kind: 'corpse' });
      // one chain level: what the blast killed bursts again (those bursts chain no further)
      for (const r of reports) if (r.result.killed) explode(o, this.item, r.target.cx, r.target.cy, { radius: this.bomb.chain.radius, base: this.bomb.chain.base, kind: 'corpse' });
      return;
    }
    const kind = this.type === 'ice' ? 'ice' : 'fire';
    explode(o, this.item, this.x, this.y - 4, { radius: GRENADE[kind].radius, base: this.base, kind });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y - 4, false, { rotation: this.spin, outline: this.type === 'corpse' ? BONE : undefined });
    this.world.lights.add(this.x, this.y - 4, 34, this.type === 'ice' ? '#8fe3ff' : '#ff8a3c', 0.7, 0.2);
  }
}

// ---------------------------------------------------------------------------
/** Crossbow turret: deploys, then shoots arrows at the nearest enemy within 220 px for 10 s. */
export class Turret extends Entity {
  z = 15;
  static readonly LIFE = 10;
  static readonly RANGE = 220;
  /** seconds between two shots */
  static readonly INTERVAL = 0.7;
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
      this.cd = Turret.INTERVAL;
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
    this.anim?.draw(ctx, this.x, this.y - 6, false, { alpha: this.armed || this.victim ? fade : 0.6 });
  }
}

// ---------------------------------------------------------------------------
// the unique skills of docs/CONTENT3.md §5. Their numbers live in skills.ts (`BONE_SPIKES`, `SOUL_LANTERN`, `CHAIN_HOOK`); the
// entities get them as a spec so the two files do not import each other.

/** 뼈 가시 numbers: how many spikes, seconds between two, px between two, knock-up speed, box (px), seconds a spike hurts / stays. */
export interface SpikeSpec { count: number; interval: number; spacing: number; knockup: number; w: number; h: number; active: number; life: number }

interface Spike { x: number; y: number; t0: number; hit: Set<number> }

/** 뼈 가시: spikes of bone erupt from the floor in front of the heroine, one after the other; each hurts every enemy over it once. */
export class BoneSpikes extends Entity {
  z = 6;
  physics = false;
  alwaysActive = true;
  readonly spikes: Spike[] = [];
  private t = 0;
  /** nothing more can erupt (all of them are out, or a wall / pit is in the way) */
  private done = false;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec: SpikeSpec) {
    super(x, y);
    this.facing = face;
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.world;
    const sp = this.spec;
    while (!this.done && this.spikes.length < sp.count && this.t >= this.spikes.length * sp.interval) this.erupt();
    for (const k of this.spikes) {
      if (this.t - k.t0 > sp.active) continue;
      const box = { x: k.x - sp.w / 2, y: k.y - sp.h, w: sp.w, h: sp.h };
      const infos = new Map<Actor, DamageInfo>();
      const reports = hitArea(w, box, 'player', (t) => {
        const info = this.owner.damageInfo(this.item, this.base, { kind: 'trap', unblockable: true, dir: this.facing, knockback: 40, knockup: sp.knockup });
        infos.set(t, info);
        return info;
      }, k.hit);
      for (const r of reports) this.owner.onDealt(r, this.item, infos.get(r.target)!, { hitstop: 0.04, shake: 1, sfx: 'hit_heavy' });
    }
    const last = this.spikes.length ? this.spikes[this.spikes.length - 1].t0 : 0;
    if ((this.done || this.spikes.length >= sp.count) && this.t - last > sp.life) this.dead = true;
  }

  /** the next spike, `spacing` px further along the floor; a wall or a pit ends the line */
  private erupt(): void {
    const w = this.world;
    const x = this.x + this.facing * this.spec.spacing * (this.spikes.length + 1);
    const floor = w.map.solidAt(x, this.y - 10) ? null : w.map.floorBelow(x, this.y - 4, 3 * TILE);
    if (floor === null) {
      this.done = true;
      return;
    }
    this.spikes.push({ x, y: floor, t0: this.t, hit: new Set() });
    w.particles.emit('debris', x, floor - 2, { count: 3, color: BONE });
    w.particles.emit('dust', x, floor, { count: 2 });
    w.audio.play('hit_heavy', { vol: 0.35, pitch: 1.3 });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sp = this.spec;
    for (const k of this.spikes) {
      const age = this.t - k.t0;
      const h = sp.h * Math.min(1, age / 0.06) * Math.min(1, Math.max(0, (sp.life - age) / 0.15));
      if (h < 1) continue;
      const hw = sp.w / 2;
      ctx.beginPath();
      ctx.moveTo(k.x - hw, k.y);
      ctx.lineTo(k.x - hw * 0.3, k.y - h * 0.55);
      ctx.lineTo(k.x, k.y - h);
      ctx.lineTo(k.x + hw * 0.35, k.y - h * 0.5);
      ctx.lineTo(k.x + hw, k.y);
      ctx.closePath();
      ctx.fillStyle = '#e8dcc4';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#120a1a';
      ctx.stroke();
      ctx.fillStyle = '#7a1f2a';
      ctx.fillRect(Math.round(k.x - hw), Math.round(k.y - 3), sp.w, 3);
      if (age < 0.2) this.world.lights.add(k.x, k.y - 12, 26, '#ffe9c8', 0.35 * (1 - age / 0.2));
    }
  }
}

/** 영혼 등불 numbers: flames, orbit radius (px) and speed (rad/s), seconds they last, burn seconds / per second, per-target cooldown. */
export interface FlameSpec { flames: number; radius: number; spin: number; life: number; burn: number; burnDps: number; hitCd: number }

/** the orbit is centred this far above the heroine's feet; a flame is a 12 px box */
const ORBIT_Y = 26;
const FLAME_BOX = 12;

/** 영혼 등불: soul flames orbit the heroine for a while; a flame that touches an enemy hurts and burns it (each enemy at most every `hitCd` s). */
export class SoulFlames extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  private t = 0;
  private lastHit = new Map<number, number>();

  constructor(readonly owner: Player, readonly item: ItemInstance, readonly base: number, readonly spec: FlameSpec) {
    super(owner.x, owner.y);
  }

  /** where flame `i` is now */
  flame(i: number): { x: number; y: number } {
    const a = this.spec.spin * this.t + (i * Math.PI * 2) / this.spec.flames;
    return { x: this.owner.x + Math.cos(a) * this.spec.radius, y: this.owner.y - ORBIT_Y + Math.sin(a) * this.spec.radius };
  }

  update(dt: number): void {
    this.t += dt;
    this.x = this.owner.x;
    this.y = this.owner.y;
    const w = this.world;
    const sp = this.spec;
    if (this.t >= sp.life || this.owner.dying || this.owner.dead) {
      this.dead = true;
      return;
    }
    for (let i = 0; i < sp.flames; i++) {
      const f = this.flame(i);
      const box = { x: f.x - FLAME_BOX / 2, y: f.y - FLAME_BOX / 2, w: FLAME_BOX, h: FLAME_BOX };
      if (Math.random() < dt * 18) w.particles.emit('fire', f.x, f.y, { count: 1, color: '#4fe3ff' });
      for (const a of w.actors) {
        if (a.team !== 'enemy' || !a.targetable || !overlaps(box, a.hurtbox())) continue;
        const prev = this.lastHit.get(a.id);
        if (prev !== undefined && this.t - prev < sp.hitCd) continue;
        this.lastHit.set(a.id, this.t);
        const info = this.owner.damageInfo(this.item, this.base, { kind: 'explosion', unblockable: true, dir: sgn(a.x - this.owner.x), knockback: 0, hitstun: 0.1, burn: sp.burn, burnDps: sp.burnDps });
        this.owner.onDealt({ target: a, result: a.takeDamage(info) }, this.item, info, { hitstop: 0.02, shake: 0, sfx: 'hit' });
        w.particles.emit('magic', f.x, f.y, { count: 4, color: '#4fe3ff' });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = this.spec.life - this.t;
    const alpha = left < 1 ? 0.4 + 0.6 * Math.abs(Math.sin(this.t * 16)) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < this.spec.flames; i++) {
      const f = this.flame(i);
      const fl = Math.sin(this.t * 22 + i * 2) * 1.2;
      for (const [r, col] of [[5, '#4fe3ff'], [3, '#d8fbff']] as const) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(f.x, f.y + 2, r - 1, 0, Math.PI * 2);
        ctx.moveTo(f.x - r + 1, f.y + 2);
        ctx.quadraticCurveTo(f.x - r * 0.5, f.y - r, f.x + fl * 0.4, f.y - r * 2.2 - fl);
        ctx.quadraticCurveTo(f.x + r * 0.5, f.y - r, f.x + r - 1, f.y + 2);
        ctx.fill();
      }
      this.world.lights.add(f.x, f.y, 34, '#4fe3ff', 0.65 * alpha, 0.15);
    }
    ctx.restore();
  }
}

/** 사슬 갈고리 numbers: reach (px), flight and pull speed (px/s), stun seconds, and the knockbackTaken below which a target is not pulled. */
export interface HookSpec { range: number; speed: number; pullSpeed: number; stun: number; pullMinKnockback: number }

/**
 * 사슬 갈고리: a hook flies straight ahead; the first enemy it touches is hurt and stunned and, unless it is too heavy
 * (`knockbackTaken` below `pullMinKnockback`), dragged to the heroine. Otherwise the chain reels back in.
 */
export class ChainHook extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  state: 'out' | 'back' | 'pull' = 'out';
  victim: Actor | null = null;
  private dist = 0;
  private pullT = 0;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec: HookSpec) {
    super(x, y);
    this.facing = face;
    this.w = 8;
    this.h = 8;
  }

  /** the hand the chain hangs from */
  private get hand(): { x: number; y: number } {
    return { x: this.owner.x + this.owner.facing * 8, y: this.owner.y - 30 };
  }

  update(dt: number): void {
    if (this.owner.dying || this.owner.dead) {
      this.dead = true;
      return;
    }
    if (this.state === 'out') this.fly(dt);
    else if (this.state === 'pull') this.pull(dt);
    else this.reel(dt);
  }

  private fly(dt: number): void {
    const w = this.world;
    const sp = this.spec;
    const n = Math.max(1, Math.ceil((sp.speed * dt) / 5));
    for (let i = 0; i < n; i++) {
      this.x += (this.facing * sp.speed * dt) / n;
      this.dist += (sp.speed * dt) / n;
      if (w.map.solidAt(this.x, this.y)) {
        this.state = 'back';
        w.particles.emit('spark', this.x, this.y, { dir: -this.facing, count: 3 });
        return;
      }
      const box = { x: this.x - 5, y: this.y - 5, w: 10, h: 10 };
      const hit = w.actors.find((a) => a.team === 'enemy' && a.targetable && overlaps(box, a.hurtbox()));
      if (hit) {
        this.grab(hit);
        return;
      }
      if (this.dist >= sp.range) {
        this.state = 'back';
        return;
      }
    }
  }

  private grab(a: Actor): void {
    const w = this.world;
    const info = this.owner.damageInfo(this.item, this.base, { kind: 'ranged', unblockable: true, dir: this.facing, knockback: 0, stun: this.spec.stun });
    const res = a.takeDamage(info);
    this.owner.onDealt({ target: a, result: res }, this.item, info, { hitstop: 0.05, shake: 1.5, sfx: 'hit' });
    w.audio.play('trap', { vol: 0.7 });
    w.particles.emit('spark', this.x, this.y, { count: 6 });
    if (res.applied && !res.killed && a.knockbackTaken >= this.spec.pullMinKnockback) {
      this.victim = a;
      this.state = 'pull';
    } else this.state = 'back';
  }

  /** drag the victim to just in front of the heroine (stopping at walls) */
  private pull(dt: number): void {
    const a = this.victim!;
    const o = this.owner;
    this.pullT += dt;
    if (a.dead || !a.targetable) {
      this.dead = true;
      return;
    }
    // the stun starts when the pull ends: it is held at its full length while the victim is dragged
    a.vx = 0;
    a.status.stun = Math.max(a.status.stun, this.spec.stun);
    if (this.pullT > 0.8) {
      this.dead = true;
      return;
    }
    const gx = o.x + o.facing * (o.w / 2 + a.w / 2 + 6);
    const dx = gx - a.x;
    const dy = o.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= 2) {
      this.dead = true;
      return;
    }
    const k = Math.min(1, (this.spec.pullSpeed * dt) / d);
    const nx = a.x + dx * k;
    const ny = a.y + dy * k;
    if (this.world.map.boxSolid({ x: nx - a.w / 2, y: ny - a.h, w: a.w, h: a.h - 2 })) {
      this.dead = true;
      return;
    }
    a.x = nx;
    a.y = ny;
    this.x = a.x;
    this.y = a.y - a.h / 2;
  }

  private reel(dt: number): void {
    const h = this.hand;
    const dx = h.x - this.x;
    const dy = h.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.spec.speed * 1.4 * dt;
    if (d <= step) {
      this.dead = true;
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.hand;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#120a1a';
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#a9a39a';
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    // the hook: a rusty claw curving back from its tip (mirrored when facing left)
    ctx.translate(this.x, this.y);
    ctx.scale(this.facing, 1);
    for (const [lw, col] of [[3, '#120a1a'], [1.5, '#b8845a']] as const) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(-1, 0, 4, -Math.PI / 2, Math.PI * 0.6);
      ctx.lineTo(1, 5);
      ctx.stroke();
    }
    ctx.restore();
  }
}
