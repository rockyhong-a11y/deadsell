import { clamp } from '../../engine/math';
import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { shockAoE } from '../enemies/hazards';
import { warnCircle, warnLine, warnRect } from '../enemies/telegraph';
import { MiniBoss, type AttackStep, type MiniBossSpec } from './base';
import { WebBlob } from './hazards';

/** 거미 여왕 (prison): a woman's upper body on a huge black spider body (~4 u long, ~2.4 u tall). */
export const ARACHNE_SPEC: MiniBossSpec = {
  id: 'mb_arachne',
  name: '거미 여왕',
  biome: 'prison',
  hp: 650,
  w: 112,
  h: 70,
  walk: 96,
  activateRange: 320,
  blood: '#6a4a7a',
  light: '#ff6a6a',
};

export const ARACHNE = {
  /** web blob: a little damage + roots the player */
  web: { w: 0.75, a: 0.2, r: 0.7, dmg: 5, speed: 300, root: 1.2, aimLock: 0.7 },
  /** leap to the player's position (shadow marker follows until `track` s before takeoff) */
  leap: { w: 0.95, air: 0.65, r: 0.85, rise: 150, radius: 64, dmg: 20, track: 0.3 },
  /** short lunge + bite */
  bite: { w: 0.5, a: 0.28, r: 0.65, dmg: 17, lunge: 340, reach: 70 },
} as const;

export type ArachneAttack = 'web' | 'leap' | 'bite';

export class Arachne extends MiniBoss {
  private aim = { x: 0, y: 0 };
  private leapTx = 0;
  private leapX0 = 0;
  private leapY0 = 0;
  private leapFy = 0;

  constructor(x: number, y: number, tier = 1) {
    super(ARACHNE_SPEC, x, y, tier);
  }

  get attackNames(): readonly ArachneAttack[] {
    return ['web', 'leap', 'bite'];
  }

  protected moveIdle(dt: number, p: Player): void {
    this.walkIdle(dt, p, 90, 200);
  }

  protected chooseAttack(p: Player): ArachneAttack {
    const d = Math.abs(p.x - this.x);
    const cands: [ArachneAttack, number][] = [
      ['bite', d < 170 ? 5 : d < 240 ? 1 : 0],
      ['web', d > 160 ? 3.5 : 1.2],
      ['leap', d > 100 ? 3.5 : 1.5],
    ];
    return this.pickAttack(cands) as ArachneAttack;
  }

  protected attackStep(name: string): AttackStep {
    const ws = this.ws;
    const rs = this.rs;
    if (name === 'web') return { w: ARACHNE.web.w * ws, a: ARACHNE.web.a, r: ARACHNE.web.r * rs };
    if (name === 'leap') return { w: ARACHNE.leap.w * ws, a: ARACHNE.leap.air, r: ARACHNE.leap.r * rs, anim: null };
    return { w: ARACHNE.bite.w * ws, a: ARACHNE.bite.a, r: ARACHNE.bite.r * rs };
  }

  /** where the web leaves her (mouth) */
  private mouth(): { x: number; y: number } {
    return { x: this.x + this.facing * 46, y: this.y - 48 };
  }

  protected onAttackBegin(name: string, p: Player): void {
    if (name === 'web') this.aim = { x: p.x, y: p.cy };
    else if (name === 'leap') {
      this.leapTx = this.inArena(p.x, 60);
      const s = this.atk!;
      this.anim?.playFor('leap', s.w + s.a);
    }
  }

  protected windup(name: string, dt: number, p: Player): void {
    super.windup(name, dt, p);
    const s = this.atk!;
    if (name === 'web' && this.stateT < s.w * ARACHNE.web.aimLock && p.targetable) this.aim = { x: p.x, y: p.cy };
    else if (name === 'leap') {
      if (this.stateT < s.w - ARACHNE.leap.track && p.targetable) this.leapTx = this.inArena(p.x, 60);
      this.faceToward({ x: this.leapTx });
    }
  }

  protected activeStart(name: string): void {
    const w = this.world;
    if (name === 'web') {
      const m = this.mouth();
      const base = Math.atan2(this.aim.y - m.y, this.aim.x - m.x);
      const shots = this.rage ? [-0.22, 0, 0.22] : [0];
      for (const off of shots) {
        const a = base + off;
        w.spawn(new WebBlob(m.x, m.y, Math.cos(a) * ARACHNE.web.speed, Math.sin(a) * ARACHNE.web.speed, this.dmg(ARACHNE.web.dmg), ARACHNE.web.root, this));
      }
      w.audio.play('throw', { vol: 0.7, pitch: 0.6 });
      w.particles.emit('smoke', m.x, m.y, { count: 6, color: '#e9edf5' });
    } else if (name === 'leap') {
      this.physics = false;
      this.vx = this.vy = 0;
      this.leapX0 = this.x;
      this.leapY0 = this.y;
      this.leapFy = w.map.floorBelow(this.leapTx, this.y - 40, 600) ?? this.y;
      w.audio.play('boss_step');
      w.shake(3, 0.2);
      w.particles.emit('dust', this.x, this.y, { count: 10, w: 80 });
    } else if (name === 'bite') {
      this.vx = this.facing * ARACHNE.bite.lunge;
      w.audio.play('swing_heavy', { pitch: 1.3 });
      w.fx.slash(this.x + this.facing * 60, this.y - 34, { dir: this.facing, radius: 44, from: -0.7, to: 0.7, color: '#ffd9e0', width: 4, life: 0.16 });
    }
  }

  private biteBox() {
    const f = this.facing;
    const B = ARACHNE.bite;
    return { x: f > 0 ? this.x + this.w / 2 - 30 : this.x - this.w / 2 + 30 - B.reach, y: this.y - 62, w: B.reach, h: 62 };
  }

  protected active(name: string, dt: number, p: Player): void {
    if (name === 'bite') {
      hitArea(
        this.world,
        this.biteBox(),
        'enemy',
        { amount: this.dmg(ARACHNE.bite.dmg), dir: this.facing, kind: 'melee', source: this, knockback: 240, knockup: 120, hitstun: 0.3, bleed: 3 },
        this.hitSet,
      );
      super.active(name, dt, p);
    } else if (name === 'leap') {
      const s = clamp(this.stateT / ARACHNE.leap.air, 0, 1);
      this.x = this.leapX0 + (this.leapTx - this.leapX0) * s;
      this.y = this.leapY0 + (this.leapFy - this.leapY0) * s - ARACHNE.leap.rise * 4 * s * (1 - s);
    } else super.active(name, dt, p);
  }

  protected activeEnd(name: string): void {
    if (name !== 'leap') return;
    const w = this.world;
    this.x = this.leapTx;
    this.y = this.leapFy;
    this.vx = this.vy = 0;
    this.physics = true;
    shockAoE(w, this.x, this.y, ARACHNE.leap.radius, this.dmg(ARACHNE.leap.dmg), this, { knockback: 280, knockup: 200 });
    w.shake(9, 0.4);
    w.addHitstop(0.04);
    w.audio.play('boss_slam');
    w.particles.emit('debris', this.x, this.y - 6, { count: 10, w: 60 });
    const r = this.atk?.r ?? 0.85;
    this.anim?.playPhased('leap_land', 0.1, 0.12, Math.max(0.1, r - 0.22));
  }

  protected drawMarkers(ctx: CanvasRenderingContext2D, p: number): void {
    const t = this.time;
    const name = this.attack;
    if (name === 'web') {
      const m = this.mouth();
      const a = Math.atan2(this.aim.y - m.y, this.aim.x - m.x);
      const shots = this.rage ? [-0.22, 0, 0.22] : [0];
      for (const off of shots) warnLine(ctx, m.x, m.y, m.x + Math.cos(a + off) * 360, m.y + Math.sin(a + off) * 360, 0.3 + 0.5 * p, 2, '#ff3b30', 4);
    } else if (name === 'bite') {
      const b = this.biteBox();
      warnRect(ctx, b.x, b.y, b.w, b.h, p, t);
    } else if (name === 'leap') {
      const fl = this.world.map.floorBelow(this.leapTx, this.groundY - 40, 600) ?? this.groundY;
      warnCircle(ctx, this.leapTx, fl, ARACHNE.leap.radius, 0.25 + 0.7 * p, t);
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.35 * p;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(Math.round(this.leapTx), Math.round(fl) - 1, 44, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
