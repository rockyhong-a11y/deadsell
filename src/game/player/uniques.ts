import { Entity } from '../entity';
import type { Actor } from '../entity';
import { hitArea, type DamageInfo, type HitReport } from '../combat';
import type { ItemInstance } from '../items/types';
import type { Player } from './player';
import { Golem, type DollSpec } from '../allies/golem';
import { circleHitsBox } from '../enemies/projectiles';
import { TILE } from '../../engine/config';
import { clamp, overlaps } from '../../engine/math';
import { ARC_LIFE, drawArcs, explode, nearestEnemy, sgn, type Arc, type Feel } from './projectiles';

/**
 * Entities of the unique items of grades A to SSS (docs/CONTENT4.md §5.3): a homing wisp (혼불 활, 신더의 불씨검), the returning glaive
 * (쌍월 칼날), the floor shockwave (여교도관의 종철퇴), the chain lightning (폭풍 지팡이), and the skills 역병 향로, 죽음의 구슬, 사슬 감옥,
 * 누더기 인형, 핏빛 비 and 마지막 종. Their numbers live in weapons.ts / skills.ts and come in as specs, like the older projectiles.
 */

/** angle difference wrapped to -PI..PI */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------------------
/** A homing wisp's numbers: speed (px/s), turn rate (rad/s) and seconds it lives. */
export interface WispSpec { speed: number; turn: number; life: number }
/** Its colours: the glow and the bright core. */
export interface WispLook { color: string; core: string }

/** how far (px) a wisp sees a target, and how long (s) it ignores the enemy it came from */
const WISP_SIGHT = 260;
const WISP_AVOID = 0.3;

/**
 * A small flame that flies at `ang`, turning toward the nearest enemy within `WISP_SIGHT` px as fast as `spec.turn` lets it, and hurts
 * the first enemy it touches (혼불 활: the tap shot, 신더의 불씨검: the ember). `avoid` = the enemy it was released from, which it ignores at first.
 */
export class Wisp extends Entity {
  z = 30;
  physics = false;
  alwaysActive = true;
  private t = 0;
  private ang: number;
  private trail: { x: number; y: number }[] = [];

  constructor(
    x: number, y: number, ang: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number,
    readonly spec: WispSpec, readonly look: WispLook, readonly feel: Feel, readonly avoid: Actor | null = null,
  ) {
    super(x, y);
    this.ang = ang;
    this.w = 8;
    this.h = 8;
  }

  get bounds() {
    return { x: this.x - 4, y: this.y - 4, w: 8, h: 8 };
  }

  /** the direction it flies in now (rad) */
  get heading(): number {
    return this.ang;
  }

  /**
   * the enemy it is chasing: the nearest one in sight. The enemy it came from is left alone while another one is in sight (an ember flies on to
   * the next one) and, with nobody else, for the first moments.
   */
  private target(): Actor | null {
    let best: Actor | null = null;
    let bd = WISP_SIGHT;
    let origin: Actor | null = null;
    for (const a of this.world.actors) {
      if (a.team !== 'enemy' || !a.targetable) continue;
      const d = Math.hypot(a.cx - this.x, a.cy - this.y);
      if (d >= WISP_SIGHT) continue;
      if (a === this.avoid) origin = a;
      else if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best ?? (this.t >= WISP_AVOID ? origin : null);
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.world;
    const sp = this.spec;
    if (this.t >= sp.life || this.owner.dead) {
      this.dead = true;
      return;
    }
    const tgt = this.target();
    if (tgt) this.ang += clamp(wrap(Math.atan2(tgt.cy - this.y, tgt.cx - this.x) - this.ang), -sp.turn * dt, sp.turn * dt);
    const n = Math.max(1, Math.ceil((sp.speed * dt) / 5));
    for (let i = 0; i < n; i++) {
      this.x += (Math.cos(this.ang) * sp.speed * dt) / n;
      this.y += (Math.sin(this.ang) * sp.speed * dt) / n;
      if (w.map.solidAt(this.x, this.y)) {
        w.particles.emit('spark', this.x, this.y, { count: 4, color: this.look.color });
        this.dead = true;
        return;
      }
      const infos = new Map<Actor, DamageInfo>();
      const reports = hitArea(w, this.bounds, 'player', (a) => {
        if (a === this.avoid && this.t < WISP_AVOID) return null;
        const info = this.owner.damageInfo(this.item, this.base, { kind: 'ranged', dir: sgn(a.x - this.x), knockback: 40, hitstun: 0.1 });
        infos.set(a, info);
        return info;
      });
      if (reports.length) {
        for (const r of reports) this.owner.onDealt(r, this.item, infos.get(r.target)!, this.feel);
        w.particles.emit('magic', this.x, this.y, { count: 5, color: this.look.color });
        this.dead = true;
        return;
      }
    }
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > 6) this.trail.length = 6;
    if (Math.random() < dt * 20) w.particles.emit('magic', this.x, this.y, { count: 1, color: this.look.color });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      ctx.globalAlpha = 0.5 * (1 - i / this.trail.length);
      ctx.fillStyle = this.look.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2 - i * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.look.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.look.core;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.world.lights.add(this.x, this.y, 24, this.look.color, 0.7);
  }
}

// ---------------------------------------------------------------------------
/** 쌍월 칼날 numbers: how far out (px) and how fast (px/s) it flies; it comes back at 1.2 times that speed. */
export interface GlaiveSpec { range: number; speed: number }

/**
 * 쌍월 칼날: a crescent blade thrown ahead; it flies `range` px (or until a wall), turns and comes back to her hand, hurting every enemy
 * once on the way out and once more on the way back. It is gone when it reaches her (or after a few seconds).
 */
export class Glaive extends Entity {
  z = 30;
  physics = false;
  alwaysActive = true;
  state: 'out' | 'back' = 'out';
  private dist = 0;
  private t = 0;
  private spin = 0;
  private readonly seen: Record<'out' | 'back', Set<number>> = { out: new Set(), back: new Set() };

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec: GlaiveSpec) {
    super(x, y);
    this.facing = face;
    this.w = 18;
    this.h = 18;
  }

  get bounds() {
    return { x: this.x - 9, y: this.y - 9, w: 18, h: 18 };
  }

  update(dt: number): void {
    this.t += dt;
    this.spin += dt * 24;
    const w = this.world;
    const sp = this.spec;
    if (this.owner.dying || this.owner.dead || this.t > 3) {
      this.dead = true;
      return;
    }
    if (this.state === 'out') {
      const nx = this.x + this.facing * sp.speed * dt;
      if (w.map.solidAt(nx + this.facing * 8, this.y)) {
        this.state = 'back';
        w.particles.emit('spark', this.x, this.y, { dir: -this.facing, count: 4 });
      } else {
        this.x = nx;
        this.dist += sp.speed * dt;
        if (this.dist >= sp.range) this.state = 'back';
      }
    } else {
      const hx = this.owner.x;
      const hy = this.owner.y - 24;
      const dx = hx - this.x;
      const dy = hy - this.y;
      const d = Math.hypot(dx, dy);
      const step = sp.speed * 1.2 * dt;
      if (d <= step + 6) {
        w.particles.emit('spark', hx, hy, { count: 3, color: '#bfe4ff' });
        this.dead = true;
        return;
      }
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }
    const infos = new Map<Actor, DamageInfo>();
    const dir = this.state === 'out' ? this.facing : -this.facing;
    const reports = hitArea(w, this.bounds, 'player', (a) => {
      const info = this.owner.damageInfo(this.item, this.base, { kind: 'ranged', dir, knockback: 60, hitstun: 0.12 });
      infos.set(a, info);
      return info;
    }, this.seen[this.state]);
    for (const r of reports) {
      this.owner.onDealt(r, this.item, infos.get(r.target)!, { hitstop: 0.04, shake: 1, sfx: 'hit' });
      if (r.result.applied) w.particles.emit('spark', r.target.cx, r.target.cy, { dir, count: 4, color: '#bfe4ff' });
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    ctx.rotate(this.spin * this.facing);
    // a pair of crescents back to back: dark rim, pale moon-steel blade
    for (const [lw, col] of [[4, '#120a1a'], [2, '#e8f4ff']] as const) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = col;
      for (const k of [0, Math.PI]) {
        ctx.beginPath();
        ctx.arc(0, 0, 7, k - 0.2, k + Math.PI * 0.75);
        ctx.stroke();
      }
    }
    ctx.restore();
    this.world.lights.add(this.x, this.y, 30, '#bfe4ff', 0.6);
  }
}

// ---------------------------------------------------------------------------
/** 여교도관의 종철퇴 numbers: damage base, reach (px), speed (px/s) and knockback (px/s) of the wave. */
export interface QuakeSpec { damage: number; range: number; speed: number; knockback: number }

/** the wave is this tall (px) above the floor: an enemy whose feet are higher than that (it jumped, it flies) is over it */
const QUAKE_H = 24;

/**
 * A shockwave that runs along the floor (여교도관의 종철퇴 sends one each way): every enemy it passes through takes the damage once and
 * is thrown away from the slam (`seen` is shared by the two waves of one slam). It dies at a wall, at a pit and after `range` px.
 */
export class Quake extends Entity {
  z = 6;
  physics = false;
  alwaysActive = true;
  private dist = 0;

  constructor(
    x: number, y: number, readonly dir: 1 | -1, readonly owner: Player, readonly item: ItemInstance, readonly spec: QuakeSpec,
    readonly seen: Set<number> = new Set(),
  ) {
    super(x, y);
    this.facing = dir;
    this.w = 20;
    this.h = QUAKE_H;
  }

  update(dt: number): void {
    const w = this.world;
    const sp = this.spec;
    const step = sp.speed * dt;
    const nx = this.x + this.dir * step;
    const floor = w.map.floorBelow(nx, this.y - 6, 3 * TILE);
    if (w.map.solidAt(nx + this.dir * 8, this.y - 8) || floor === null || this.dist >= sp.range) {
      w.particles.emit('dust', this.x, this.y, { count: 4 });
      this.dead = true;
      return;
    }
    this.x = nx;
    this.y = floor;
    this.dist += step;
    if (Math.random() < dt * 40) w.particles.emit('dust', this.x, this.y - 1, { count: 1, vy: -50 });
    const box = { x: this.x - 10, y: this.y - QUAKE_H, w: 20, h: QUAKE_H };
    const infos = new Map<Actor, DamageInfo>();
    const reports = hitArea(w, box, 'player', (a) => {
      const info = this.owner.damageInfo(this.item, sp.damage, { kind: 'trap', unblockable: true, dir: this.dir, knockback: sp.knockback, knockup: 120 });
      infos.set(a, info);
      return info;
    }, this.seen);
    for (const r of reports) this.owner.onDealt(r, this.item, infos.get(r.target)!, { hitstop: 0.05, shake: 2, sfx: 'hit_heavy' });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const k = 1 - this.dist / this.spec.range;
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.65 * k;
    // a crest of light racing over the floor, taller at its head than at its tail
    ctx.fillStyle = '#ff8a3c';
    ctx.beginPath();
    ctx.moveTo(x - this.dir * 22, y);
    ctx.quadraticCurveTo(x - this.dir * 8, y - QUAKE_H * 0.5, x + this.dir * 4, y - QUAKE_H);
    ctx.quadraticCurveTo(x + this.dir * 12, y - QUAKE_H * 0.4, x + this.dir * 10, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff3a0';
    ctx.beginPath();
    ctx.moveTo(x - this.dir * 8, y);
    ctx.quadraticCurveTo(x - this.dir * 2, y - QUAKE_H * 0.4, x + this.dir * 5, y - QUAKE_H * 0.7);
    ctx.quadraticCurveTo(x + this.dir * 6, y - QUAKE_H * 0.2, x + this.dir * 5, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    this.world.lights.add(this.x, this.y - 8, 34, '#ff8a3c', 0.6 * k);
  }
}

// ---------------------------------------------------------------------------
/** 폭풍 지팡이's lightning arcs, on the screen for `ARC_LIFE` s (a short-lived entity: the bolt itself is instant). */
export class LightningArcs extends Entity {
  z = 32;
  physics = false;
  alwaysActive = true;
  constructor(readonly arcs: Arc[]) {
    super(0, 0);
  }
  update(dt: number): void {
    for (const a of this.arcs) a.age += dt;
    if (this.arcs.every((a) => a.age >= ARC_LIFE)) this.dead = true;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    drawArcs(ctx, this.arcs.filter((a) => a.age < ARC_LIFE));
    for (const a of this.arcs) if (a.age < ARC_LIFE) this.world.lights.add(a.x1, a.y1, 28, '#8fe3ff', 0.7 * (1 - a.age / ARC_LIFE));
  }
}

/** 폭풍 지팡이 numbers: reach ahead (px), damage base of the first target, chain bounces after it, how far (px) a bolt jumps, and how much weaker each jump is. */
export interface BoltSpec { range: number; damage: number; chain: number; jump: number; falloff: number }

/**
 * One chain lightning from (x, y) toward `dir`: it strikes the nearest enemy within `range` px ahead that it can see, then jumps to the nearest
 * enemy within `jump` px of that one (never the same twice), up to `chain` times; every jump hits `falloff` weaker. Returns the hits (empty when
 * there is nothing ahead: the staff only breathes).
 */
export function chainLightning(owner: Player, item: ItemInstance, x: number, y: number, dir: 1 | -1, o: BoltSpec): HitReport[] {
  const w = owner.world;
  let first: Actor | null = null;
  let bd = o.range;
  for (const a of w.actors) {
    if (a.team !== 'enemy' || !a.targetable || (a.cx - x) * dir < -8) continue;
    const d = Math.hypot(a.cx - x, a.cy - y);
    if (d < bd && w.map.lineOfSight(x, y, a.cx, a.cy)) {
      bd = d;
      first = a;
    }
  }
  if (!first) return [];
  const hit = new Set<Actor>();
  const arcs: Arc[] = [];
  const out: HitReport[] = [];
  let from = { x, y };
  let target: Actor | null = first;
  for (let i = 0; i <= o.chain && target; i++) {
    hit.add(target);
    const info = owner.damageInfo(item, o.damage * Math.pow(1 - o.falloff, i), { kind: 'explosion', unblockable: true, dir: sgn(target.x - x), knockback: 0, hitstun: 0.08 });
    const r: HitReport = { target, result: target.takeDamage(info) };
    out.push(r);
    owner.onDealt(r, item, info, { hitstop: 0.02, shake: 0.5, sfx: 'hit', vol: 0.5 });
    arcs.push({ x0: from.x, y0: from.y, x1: target.cx, y1: target.cy, age: 0 });
    w.particles.emit('spark', target.cx, target.cy, { count: 4, color: '#9fe8ff' });
    from = { x: target.cx, y: target.cy };
    target = nearestEnemy(w, from.x, from.y, o.jump, hit);
  }
  w.spawn(new LightningArcs(arcs));
  w.audio.play('turret', { vol: 0.5, pitch: 1.6 });
  return out;
}

// ---------------------------------------------------------------------------
/** 역병 향로 numbers: seconds it lasts, radius (px) around her and seconds between the ticks of poison. */
export interface AuraSpec { life: number; radius: number; interval: number }

/** 역병 향로: a cloud of poison around her; every `interval` s every enemy in it takes the damage (unblockable, no stagger). */
export class PlagueAura extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  private t = 0;
  private tick = 0.15;

  constructor(readonly owner: Player, readonly item: ItemInstance, readonly base: number, readonly spec: AuraSpec) {
    super(owner.x, owner.y);
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
    if (Math.random() < dt * 16) w.particles.emit('smoke', this.x + (Math.random() - 0.5) * sp.radius * 1.6, this.y - 6 - Math.random() * 34, { count: 1, color: '#7acb5a' });
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick += sp.interval;
    const cx = this.x;
    const cy = this.y - 20;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable || !circleHitsBox(cx, cy, sp.radius, a.hurtbox())) continue;
      const info = this.owner.damageInfo(this.item, this.base, { kind: 'explosion', unblockable: true, dir: sgn(a.x - cx), knockback: 0, hitstun: 0 });
      this.owner.onDealt({ target: a, result: a.takeDamage(info) }, this.item, info, { hitstop: 0, shake: 0, sfx: 'hit', vol: 0.2 });
      w.particles.emit('magic', a.cx, a.cy, { count: 2, color: '#9be06a' });
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sp = this.spec;
    const left = sp.life - this.t;
    const fade = Math.min(1, left * 2) * Math.min(1, this.t * 5);
    const cx = Math.round(this.x);
    const cy = Math.round(this.y - 20);
    const pulse = 1 + Math.sin(this.t * 4) * 0.04;
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, sp.radius * pulse);
    g.addColorStop(0, 'rgba(120,200,80,0.0)');
    g.addColorStop(0.7, 'rgba(110,190,70,0.14)');
    g.addColorStop(1, 'rgba(140,220,90,0.30)');
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, sp.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(170,240,120,0.55)';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.t * 10;
    ctx.beginPath();
    ctx.arc(cx, cy, sp.radius * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    this.world.lights.add(this.x, this.y - 20, sp.radius, '#7acb5a', 0.35 * fade);
  }
}

// ---------------------------------------------------------------------------
/** 죽음의 구슬 numbers: seconds it lasts, how far (px) ahead of her it floats, how close (px) to it a kill must be, the burst (radius px, damage base) and the share of max HP each burst heals. */
export interface OrbSpec { life: number; ahead: number; reach: number; burst: { radius: number; base: number }; heal: number }

/**
 * 죽음의 구슬: an orb that floats ahead of her. Every enemy that dies within `reach` px of it bursts (the burst can kill the next one, which
 * bursts too) and heals her a little.
 */
export class DeathOrb extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  private t = 0;
  /** which side of her it floats on, -1..1 (it swings across when she turns) */
  private side: number;
  private off: (() => void) | null = null;

  constructor(readonly owner: Player, readonly item: ItemInstance, readonly spec: OrbSpec) {
    super(owner.x + owner.facing * spec.ahead, owner.y - 30);
    this.side = owner.facing;
  }

  init(): void {
    this.off = this.world.on((e) => {
      if (e.type === 'enemyKilled') this.onKill(e.enemy);
    });
  }

  onRemove(): void {
    this.off?.();
    this.off = null;
  }

  private onKill(e: Actor): void {
    if (this.dead || Math.hypot(e.cx - this.x, e.cy - this.y) > this.spec.reach) return;
    const w = this.world;
    const o = this.owner;
    const B = this.spec.burst;
    explode(o, this.item, e.cx, e.cy, { radius: B.radius, base: B.base, kind: 'death' });
    if (!o.dying && this.spec.heal > 0) {
      o.heal(Math.max(1, Math.round(o.maxHp * this.spec.heal)));
      w.particles.emit('heal', o.x, o.y - 24, { count: 4 });
    }
  }

  update(dt: number): void {
    this.t += dt;
    const o = this.owner;
    if (this.t >= this.spec.life || o.dying || o.dead) {
      this.world.particles.emit('smoke', this.x, this.y, { count: 6, color: '#7a1f2a' });
      this.dead = true;
      return;
    }
    this.side += (o.facing - this.side) * Math.min(1, dt * 8);
    this.x = o.x + this.side * this.spec.ahead;
    this.y = o.y - 30 + Math.sin(this.t * 3) * 3;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = this.spec.life - this.t;
    const alpha = left < 1.2 ? 0.45 + 0.55 * Math.abs(Math.sin(this.t * 14)) : 1;
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    // the reach: a faint dashed ring
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(200,50,74,0.28)';
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -this.t * 12;
    ctx.beginPath();
    ctx.arc(x, y, this.spec.reach, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // a dark orb with a blood-red heart and motes circling it
    ctx.fillStyle = '#120a1a';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a1f2a';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff4a58';
    ctx.beginPath();
    ctx.arc(x, y, 3 + Math.sin(this.t * 9) * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd0d8';
    for (let i = 0; i < 3; i++) {
      const a = this.t * 4 + (i * Math.PI * 2) / 3;
      ctx.fillRect(Math.round(x + Math.cos(a) * 13), Math.round(y + Math.sin(a) * 6), 2, 2);
    }
    ctx.restore();
    this.world.lights.add(this.x, this.y, 46, '#ff3b5c', 0.7 * alpha, 0.1);
  }
}

// ---------------------------------------------------------------------------
/** 사슬 감옥 numbers: radius (px) around her, seconds the chains hold, and the knockbackTaken below which an enemy is too heavy to be held in place (it is hurt and stunned only). */
export interface PrisonSpec { radius: number; root: number; minKnockback: number }

interface Captive { a: Actor; x: number; y: number; held: boolean }

/**
 * 사슬 감옥: chains around every enemy within `radius` px of her: it takes the damage, is stunned for `root` s (no actions) and held on the
 * spot for as long. Heavy enemies (the bosses, the wraith) are hurt and stunned as far as their own rules allow, but not held.
 */
export class ChainPrison extends Entity {
  z = 29;
  physics = false;
  alwaysActive = true;
  readonly captives: Captive[] = [];
  private t = 0;

  constructor(readonly owner: Player, readonly item: ItemInstance, readonly base: number, readonly spec: PrisonSpec) {
    super(owner.x, owner.y);
  }

  init(): void {
    const w = this.world;
    const o = this.owner;
    const cx = o.x;
    const cy = o.y - 20;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable || !circleHitsBox(cx, cy, this.spec.radius, a.hurtbox())) continue;
      const info = o.damageInfo(this.item, this.base, { kind: 'trap', unblockable: true, dir: 0, knockback: 0, hitstun: 0.1, stun: this.spec.root });
      const r = { target: a, result: a.takeDamage(info) };
      o.onDealt(r, this.item, info, { hitstop: 0.04, shake: 1.5, sfx: 'trap' });
      if (r.result.killed) continue;
      // (a blow that was absorbed still leaves the chains on)
      a.status.stun = Math.max(a.status.stun, this.spec.root);
      this.captives.push({ a, x: a.x, y: a.y, held: a.knockbackTaken >= this.spec.minKnockback });
    }
    w.fx.ring(cx, o.y - 4, { radius: this.spec.radius, color: '#a9b4c8', life: 0.4, flat: 0.5 });
    w.particles.emit('debris', cx, o.y - 6, { count: 8, color: '#a9b4c8', power: 1.4 });
    w.audio.play('trap', { vol: 0.9, pitch: 0.7 });
    w.shake(3, 0.2);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t >= this.spec.root || this.owner.dead) {
      this.dead = true;
      return;
    }
    for (const c of this.captives) {
      const a = c.a;
      if (a.dead || !a.targetable || !c.held) continue;
      a.vx = 0;
      a.x = c.x;
      // (a flyer is held in the air as well)
      if (a.gravityScale === 0) {
        a.y = c.y;
        a.vy = 0;
      }
      a.status.stun = Math.max(a.status.stun, 0.15);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = this.spec.root - this.t;
    const alpha = Math.min(1, this.t * 8) * (left < 0.5 ? 0.4 + 0.6 * Math.abs(Math.sin(this.t * 16)) : 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (const c of this.captives) {
      const a = c.a;
      if (a.dead || !a.targetable) continue;
      const waist = a.cy;
      // two chains pulled taut from the floor on either side, and a shackle ring at its feet
      for (const side of [-1, 1]) {
        const fx = a.x + side * (a.w / 2 + 22);
        for (const [lw, col, dash] of [[3, '#120a1a', false], [1.5, '#c9d2e0', true]] as const) {
          ctx.lineWidth = lw;
          ctx.strokeStyle = col;
          ctx.setLineDash(dash ? [3, 2] : []);
          ctx.beginPath();
          ctx.moveTo(fx, a.y);
          ctx.lineTo(a.x + side * (a.w / 2 - 1), waist);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#a9b4c8';
      ctx.beginPath();
      ctx.ellipse(a.x, a.y - 1, a.w / 2 + 4, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
/** 누더기 인형 numbers (the rest of a `DollSpec`: its slam damage comes from the skill's base and the item). */
export type DollNumbers = Omit<DollSpec, 'damage'>;

/** 누더기 인형: a half-size rag golem for `life` s next to her; a doll that still stands is replaced. */
export function summonDoll(p: Player, item: ItemInstance, base: number, n: DollNumbers): Golem {
  const w = p.world;
  for (const e of w.entities) if (e instanceof Golem && e.doll) e.dead = true;
  const damage = p.damageInfo(item, base).amount;
  const doll = new Golem(p.x + p.facing * 28, p.y, { hp: n.hp, maxHp: n.hp }, { ...n, damage });
  doll.facing = p.facing;
  w.particles.emit('debris', doll.x, doll.y - 12, { count: 8, color: '#b89a72' });
  w.particles.emit('dust', doll.x, doll.y, { count: 5, w: 20 });
  w.audio.play('roll', { vol: 0.5, pitch: 0.9 });
  return w.spawn(doll);
}

// ---------------------------------------------------------------------------
/** 핏빛 비 numbers: seconds it rains, the stretch ahead of her it covers (px from, px to), seconds between two volleys, bleed seconds, and the height (px) of the rain. */
export interface RainSpec { life: number; from: number; reach: number; interval: number; bleed: number; height: number }

/** 핏빛 비: a rain of blood needles over the stretch ahead of her; every `interval` s everything in it takes the damage and bleeds. */
export class NeedleRain extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  private t = 0;
  private tick = 0.05;
  readonly left: number;
  readonly width: number;

  constructor(x: number, y: number, face: 1 | -1, readonly owner: Player, readonly item: ItemInstance, readonly base: number, readonly spec: RainSpec) {
    super(x, y);
    this.facing = face;
    const a = x + face * spec.from;
    const b = x + face * spec.reach;
    this.left = Math.min(a, b);
    this.width = Math.abs(b - a);
  }

  /** the box every volley hits */
  get area() {
    return { x: this.left, y: this.y - this.spec.height, w: this.width, h: this.spec.height + 4 };
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.world;
    const sp = this.spec;
    if (this.t >= sp.life || this.owner.dying || this.owner.dead) {
      this.dead = true;
      return;
    }
    if (Math.random() < dt * 40) w.particles.emit('blood', this.left + Math.random() * this.width, this.y - 1, { count: 1, power: 0.5 });
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick += sp.interval;
    const infos = new Map<Actor, DamageInfo>();
    const reports = hitArea(w, this.area, 'player', (a) => {
      const info = this.owner.damageInfo(this.item, this.base, { kind: 'trap', unblockable: true, dir: this.facing, knockback: 0, hitstun: 0, bleed: sp.bleed });
      infos.set(a, info);
      return info;
    });
    for (const r of reports) this.owner.onDealt(r, this.item, infos.get(r.target)!, { hitstop: 0, shake: 0, sfx: 'hit', vol: 0.2 });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sp = this.spec;
    const fade = Math.min(1, this.t * 8) * Math.min(1, (sp.life - this.t) * 4);
    const n = Math.max(8, Math.round(this.width / 5));
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < n; i++) {
      // each needle falls on its own phase; where it lands in the stretch changes every pass
      const lap = (this.t * 520 + i * 37) / sp.height;
      const x = this.left + (((Math.floor(lap) * 61 + i * 29) % 97) / 97) * this.width;
      const ty = this.y - sp.height + (lap % 1) * sp.height;
      ctx.strokeStyle = '#ff4a58';
      ctx.beginPath();
      ctx.moveTo(Math.round(x), Math.round(ty - 10));
      ctx.lineTo(Math.round(x - 1), Math.round(ty));
      ctx.stroke();
      ctx.fillStyle = '#ffd0d8';
      ctx.fillRect(Math.round(x - 1), Math.round(ty), 2, 2);
    }
    ctx.restore();
    this.world.lights.add(this.left + this.width / 2, this.y - 20, this.width * 0.7, '#ff3b5c', 0.4 * fade);
  }
}

// ---------------------------------------------------------------------------
/** 마지막 종 numbers: the damage base a boss or mid-boss takes (everything else takes the skill's base) and the stun seconds of the rest. */
export interface BellSpec { boss: number; stun: number }

/** A great bronze bell above the heroine that tolls once as the 마지막 종 goes off, then fades. */
export class GreatBell extends Entity {
  z = 33;
  physics = false;
  alwaysActive = true;
  private t = 0;
  constructor(readonly owner: Player) {
    super(owner.x, owner.y - 74);
  }
  update(dt: number): void {
    this.t += dt;
    this.x = this.owner.x;
    this.y = this.owner.y - 74;
    if (this.t >= 1) this.dead = true;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const k = this.t;
    const alpha = Math.min(1, k * 10) * (1 - Math.max(0, (k - 0.55) / 0.45));
    const swing = Math.sin(k * 22) * 0.3 * (1 - k);
    const s = 1 + 0.25 * Math.max(0, 1 - k * 5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.round(this.x), Math.round(this.y - 14));
    ctx.rotate(swing);
    ctx.scale(s, s);
    // the bell: a dome flaring into a lip, a loop on top, the clapper
    const bell = (inset: number): void => {
      ctx.beginPath();
      ctx.moveTo(-15 + inset, 14);
      ctx.quadraticCurveTo(-13 + inset, -2, -8 + inset, -10);
      ctx.quadraticCurveTo(0, -17 + inset, 8 - inset, -10);
      ctx.quadraticCurveTo(13 - inset, -2, 15 - inset, 14);
      ctx.closePath();
    };
    ctx.fillStyle = '#120a1a';
    bell(-2);
    ctx.fill();
    ctx.fillStyle = '#d9a066';
    bell(0);
    ctx.fill();
    ctx.fillStyle = '#f5d9a0';
    ctx.fillRect(-9, -4, 4, 14);
    ctx.fillStyle = '#7a4a2a';
    ctx.fillRect(-15, 11, 30, 3);
    ctx.fillStyle = '#120a1a';
    ctx.fillRect(-2, -20, 4, 5);
    ctx.fillStyle = '#d9a066';
    ctx.beginPath();
    ctx.arc(0, 18, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.world.lights.add(this.x, this.y, 80, '#ffd9a0', 0.8 * alpha);
  }
}

/**
 * 마지막 종: every enemy on the screen (its hurtbox inside the camera's view) takes `base` damage and is stunned `o.stun` s; a boss or a
 * mid-boss takes `o.boss` and is not stunned. Hurts through the usual damage path, so what dies drops its loot as ever.
 */
export function lastBell(p: Player, item: ItemInstance, base: number, o: BellSpec): HitReport[] {
  const w = p.world;
  const cam = w.camera;
  const view = { x: cam.x, y: cam.y, w: cam.w, h: cam.h };
  const out: HitReport[] = [];
  for (const a of w.actors) {
    if (a.team !== 'enemy' || !a.targetable || !overlaps(view, a.hurtbox())) continue;
    const info = p.damageInfo(item, a.isBoss ? o.boss : base, { kind: 'explosion', unblockable: true, dir: sgn(a.x - p.x), knockback: 0, hitstun: 0.2, stun: a.isBoss ? undefined : o.stun });
    const r: HitReport = { target: a, result: a.takeDamage(info) };
    out.push(r);
    p.onDealt(r, item, info, { hitstop: 0, shake: 0, sfx: 'hit_heavy' });
    // (a blow that was absorbed still leaves the stun on)
    if (!a.isBoss && !r.result.killed) a.status.stun = Math.max(a.status.stun, o.stun);
    w.particles.emit('spark', a.cx, a.cy, { count: 6, color: '#ffd9a0' });
  }
  for (const [i, r] of [0.55, 0.9, 1.3].entries()) w.fx.ring(p.x, p.y - 24, { radius: (cam.w * r) / 2, color: '#ffd9a0', life: 0.5 + i * 0.1, width: 4 - i });
  w.fx.screenFlash('#ffe9b0', 0.25, 0.5);
  w.shake(7, 0.4);
  w.audio.play('bell', { vol: 1, pitch: 0.7 });
  w.spawn(new GreatBell(p));
  return out;
}
