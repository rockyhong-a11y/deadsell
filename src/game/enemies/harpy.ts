import { approach, clamp } from '../../engine/math';
import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { FirePatch, SongRing } from './hazards';
import { Arrow } from './projectiles';
import { warnLine } from './telegraph';
import { ATTACK_DMG, BASE_STATS, type EnemyDef } from './variants';

const SPEC = { hp: BASE_STATS.harpy.hp, w: 22, h: 28, patrol: 40, chase: 120, aura: BASE_STATS.harpy.aura, blood: '#6a3a8a' };
const DIVE_SPEED = 360;
const DIVE_MAX = 0.9;

type Mode = 'dive' | 'volley' | 'song';

/**
 * 하피: flyer (no gravity, still collides with tiles). Hovers above/near the player with a bob,
 * then dives along a telegraphed line (windup 0.6 s), recovers (vulnerable) and returns.
 * Entity position = talons.
 * Variants: storm (feather volley instead of diving), raven (faster dives, shorter windup),
 * siren (song: expanding ring that slows the player, between dives), ember (dive leaves a fire patch).
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
  private mode: Mode = 'dive';
  private songCd = 2;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}, variant: EnemyDef | null = null) {
    super('harpy', x, y, opts, SPEC, variant);
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

  update(dt: number): void {
    if (this.songCd > 0) this.songCd -= dt;
    super.update(dt);
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
    // the storm harpy stays farther out: it shoots instead of diving
    const off = this.ab === 'storm' ? 170 : 110;
    return { x: p.x + this.side * off, y: Math.max(48 + this.h, p.y - this.altitude) + Math.sin(this.time * 3 + this.bob) * 9 };
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
    if (this.attackCd > 0) return;
    const dx = Math.abs(p.x - this.x);
    if (this.ab === 'storm') {
      if (dx < this.pr('range', 300) && this.sees(p)) this.startAttack(p);
      return;
    }
    if (this.canSing(dx) && this.sees(p)) {
      this.startAttack(p);
      return;
    }
    if (this.y < p.y - 30 && dx < 260 && this.sees(p)) this.startAttack(p);
  }

  private canSing(dx: number): boolean {
    return this.ab === 'siren' && this.songCd <= 0 && dx < this.pr('songR', 170) + 30;
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
    const rng = this.world.rng;
    if (this.ab === 'storm') {
      this.mode = 'volley';
      const w = this.pr('windup', 0.65);
      this.beginAttack(w, 0.12, 0.7);
      this.anim?.playFor('dive_windup', w);
      this.attackCd = 2.2 + rng.range(0, 1);
      return;
    }
    if (this.canSing(Math.abs(p.x - this.x))) {
      this.mode = 'song';
      const w = this.pr('windup', 0.8);
      this.beginAttack(w, 0.15, 0.7);
      this.anim?.playFor('dive_windup', w);
      this.songCd = this.pr('songCd', 7);
      this.attackCd = 1.4;
      return;
    }
    this.mode = 'dive';
    const w = this.pr('windup', 0.6);
    this.beginAttack(w, DIVE_MAX, 0.6);
    this.anim?.playFor('dive_windup', w);
    this.attackCd = 2.4 + rng.range(0, 1.2);
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
    const w = this.world;
    if (this.mode === 'volley') {
      const cy = this.y - this.h / 2;
      let dx = this.aimX - this.x;
      let dy = this.aimY - cy;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const n = Math.max(1, Math.round(this.pr('feathers', 3)));
      const spread = (this.pr('spread', 14) * Math.PI) / 180;
      const sp = this.pr('featherSpeed', 250);
      for (let i = 0; i < n; i++) {
        const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * spread;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        w.spawn(new Arrow(this.x + dx * 10, cy + dy * 10, (dx * c - dy * sn) * sp, (dx * sn + dy * c) * sp, this.dmg(ATTACK_DMG.feather), this, { style: 'feather', life: 2.4 }));
      }
      w.audio.play('swing', { vol: 0.6, pitch: 1.5 });
      w.particles.emit('dust', this.x, cy, { count: 4, dir: this.facing });
      return;
    }
    if (this.mode === 'song') {
      w.spawn(
        new SongRing(this.x, this.y - this.h / 2, {
          maxR: this.pr('songR', 170),
          speed: this.pr('songSpeed', 200),
          slow: this.pr('slow', 0.4),
          slowT: this.pr('slowT', 2),
        }),
      );
      w.audio.play('bell', { vol: 0.7, pitch: 1.6 });
      w.particles.emit('magic', this.x, this.y - this.h / 2, { count: 10, color: '#ffd6f2' });
      return;
    }
    const v = this.diveVector();
    this.diveX = v.x;
    this.diveY = v.y;
    this.diveLen = v.len;
    this.diveStart = { x: this.x, y: this.y };
    this.vx = v.x * DIVE_SPEED * this.speedMult;
    this.vy = v.y * DIVE_SPEED * this.speedMult;
    this.play('dive');
    w.audio.play('swing', { vol: 0.6, pitch: 1.3 });
  }

  protected onActive(): void {
    if (this.mode !== 'dive') {
      // volley / song: a brief hold while the shot leaves
      this.vx *= 0.9;
      this.vy *= 0.9;
      return;
    }
    const b = this.bounds;
    hitArea(
      this.world,
      { x: b.x - 4, y: b.y - 2, w: b.w + 8, h: b.h + 6 },
      'enemy',
      { amount: this.dmg(ATTACK_DMG.harpy), dir: this.vx >= 0 ? 1 : -1, kind: 'melee', source: this, knockback: 230, knockup: 100, hitstun: 0.25 },
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
    if (this.mode === 'dive' && this.ab === 'ember') this.leaveFire();
  }

  /** Ember harpy: the dive impact leaves a burning patch on the floor (2 s). */
  private leaveFire(): void {
    const w = this.world;
    const fy = w.map.floorBelow(this.x, this.y - 6, 60);
    if (fy === null) return;
    w.particles.emit('fire', this.x, fy - 4, { count: 8 });
    w.audio.play('explosion', { vol: 0.35, pitch: 1.6 });
    w.spawn(new FirePatch(this.x, fy, { width: this.pr('fireW', 46), life: this.pr('fireLife', 2), dps: this.dot(this.pr('fireDps', 6)), source: this }));
  }

  protected onRecover(dt: number): void {
    this.vx = approach(this.vx, 0, 700 * dt);
    this.vy = approach(this.vy, 0, 700 * dt);
  }

  protected drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.dying && (this.ab === 'ember' || this.ab === 'raven')) {
      this.world.lights.add(this.x, this.y - this.h / 2, this.ab === 'ember' ? 44 : 24, this.ab === 'ember' ? '#ff8a3a' : '#ff4a4a', this.ab === 'ember' ? 0.6 : 0.25, 0.3);
    }
    const p = this.telegraph;
    if (p < 0) return;
    const sx = this.x;
    const sy = this.y - this.h / 2;
    if (this.mode === 'song') {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.4 * p;
      ctx.strokeStyle = '#ffb3e6';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(Math.round(sx), Math.round(sy), this.pr('songR', 170) * (0.35 + 0.65 * p), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (this.mode === 'volley') {
      const dx = this.aimX - sx;
      const dy = this.aimY - sy;
      const l = Math.hypot(dx, dy) || 1;
      const spread = (this.pr('spread', 14) * Math.PI) / 180;
      const n = Math.max(1, Math.round(this.pr('feathers', 3)));
      for (let i = 0; i < n; i++) {
        const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * spread;
        const ux = (dx / l) * Math.cos(a) - (dy / l) * Math.sin(a);
        const uy = (dx / l) * Math.sin(a) + (dy / l) * Math.cos(a);
        warnLine(ctx, sx, sy, sx + ux * 240, sy + uy * 240, 0.25 + 0.55 * p, 1, undefined, p > 0.7 ? 0 : 4);
      }
      return;
    }
    const v = this.diveVector();
    warnLine(ctx, sx, sy, sx + v.x * v.len, sy + v.y * v.len, 0.35 + 0.65 * p, p > 0.7 ? 2 : 1, undefined, p > 0.7 ? 0 : 4);
  }
}
