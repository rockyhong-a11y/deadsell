import { approach, clamp, easeOutCubic } from '../../engine/math';
import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { warnCircle, warnLine, warnPath, warnRect } from '../enemies/telegraph';
import { MiniBoss, type AttackStep, type MiniBossSpec } from './base';
import { SwordBeam } from './hazards';

/** 발키리 기사단장 (ramparts): armoured knight with large white wings, winged helm, greatsword, blue cape. */
export const VALKYRIE_SPEC: MiniBossSpec = {
  id: 'mb_valkyrie',
  name: '발키리 기사단장',
  biome: 'ramparts',
  hp: 900,
  w: 46,
  h: 100,
  walk: 72,
  activateRange: 320,
  blood: '#8a3040',
  light: '#9fd0ff',
};

export const VALKYRIE = {
  /** 2-hit greatsword combo; the second swing follows after a short (still visible) windup */
  slash: { w1: 0.7, a1: 0.18, w2: 0.38, a2: 0.2, r: 0.85, dmg: [14, 18], reach: 114, step: 200 },
  /** takes off (`rise`), hovers over the player (the last `aim` s the line is locked), dives along it; `height` keeps the sprite (the art already lifts her ~30 px) inside the screen */
  dive: { rise: 0.5, w: 1.3, aim: 0.35, a: 0.6, r: 0.95, height: 96, speed: 700, dmg: 22, radius: 56 },
  /** sword beam along the floor (jump it) */
  wave: { w: 0.8, a: 0.25, r: 0.75, dmg: 13, speed: 330, dist: 760 },
} as const;

export type ValkyrieAttack = 'slash' | 'dive' | 'wave';

export class Valkyrie extends MiniBoss {
  /** index of the swing of the slash combo in progress */
  swing = 0;
  private diveTx = 0;
  private diveFy = 0;
  private diveLocked = false;
  private landed = false;
  private beams: SwordBeam[] = [];

  constructor(x: number, y: number, tier = 1) {
    super(VALKYRIE_SPEC, x, y, tier);
  }

  get attackNames(): readonly ValkyrieAttack[] {
    return ['slash', 'dive', 'wave'];
  }

  protected moveIdle(dt: number, p: Player): void {
    this.walkIdle(dt, p, 80, 140);
  }

  protected chooseAttack(p: Player): ValkyrieAttack {
    const d = Math.abs(p.x - this.x);
    const cands: [ValkyrieAttack, number][] = [
      ['slash', d < 150 ? 5 : d < 210 ? 1.5 : 0.2],
      ['dive', d >= 100 ? 3 : 1.2],
      ['wave', d >= 180 ? 4 : d >= 100 ? 1.5 : 0.8],
    ];
    return this.pickAttack(cands) as ValkyrieAttack;
  }

  protected attackStep(name: string): AttackStep {
    const ws = this.ws;
    const rs = this.rs;
    if (name === 'slash') {
      const S = VALKYRIE.slash;
      this.queue.push({ w: S.w2 * ws, a: S.a2, r: S.r * rs });
      return { w: S.w1 * ws, a: S.a1, r: 0 };
    }
    if (name === 'dive') return { w: VALKYRIE.dive.w * ws, a: VALKYRIE.dive.a, r: VALKYRIE.dive.r * rs, anim: null };
    return { w: VALKYRIE.wave.w * ws, a: VALKYRIE.wave.a, r: VALKYRIE.wave.r * rs };
  }

  protected onAttackBegin(name: string, p: Player): void {
    this.swing = 0;
    if (name === 'dive') {
      this.physics = false;
      this.vx = this.vy = 0;
      this.diveLocked = false;
      this.landed = false;
      this.diveTx = this.inArena(p.x, 50);
      this.diveFy = this.groundY;
      this.anim?.play('fly', true);
    }
  }

  protected onChainStep(): void {
    this.swing = 1;
    this.faceToward(this.world.player);
    this.lockedFacing = this.facing;
  }

  protected windup(name: string, dt: number, p: Player): void {
    if (name !== 'dive') return super.windup(name, dt, p);
    const D = VALKYRIE.dive;
    const s = this.atk!;
    const k = clamp(this.stateT / (D.rise * this.ws), 0, 1);
    this.y = this.groundY - D.height * easeOutCubic(k) + (k >= 1 ? Math.sin(this.time * 9) * 2 : 0);
    if (!this.diveLocked) {
      if (this.stateT < s.w - D.aim) {
        if (p.targetable) this.diveTx = this.inArena(p.x, 50);
        this.x = approach(this.x, this.diveTx, 270 * dt);
        this.faceToward({ x: this.diveTx });
      } else {
        // lock the line: from here to the floor under the spot she saw you at
        this.diveLocked = true;
        this.diveFy = this.world.map.floorBelow(this.diveTx, this.groundY - 40, 700) ?? this.groundY;
        this.faceToward({ x: this.diveTx });
        this.anim?.playPhased('dive', D.aim, s.a, s.r);
        this.world.audio.play('telegraph', { pitch: 1.4 });
      }
    }
  }

  protected activeStart(name: string): void {
    const w = this.world;
    const f = this.facing;
    if (name === 'slash') {
      const S = VALKYRIE.slash;
      this.vx = f * S.step;
      w.audio.play('swing_heavy');
      w.shake(3.5, 0.15);
      w.fx.slash(this.x + f * 56, this.y - 56, {
        dir: f,
        radius: 72,
        from: this.swing === 0 ? -1.2 : 1.0,
        to: this.swing === 0 ? 0.8 : -0.9,
        color: '#e6f4ff',
        width: 5,
        life: 0.2,
      });
    } else if (name === 'wave') {
      const W = VALKYRIE.wave;
      w.audio.play('swing_heavy', { pitch: 0.8 });
      w.audio.play('boss_slam', { vol: 0.5 });
      w.shake(4, 0.2);
      w.fx.slash(this.x + f * 60, this.y - 40, { dir: f, radius: 84, from: -1.0, to: 1.2, color: '#9fd0ff', width: 6, life: 0.22 });
      const beam = new SwordBeam(this.x + f * 56, this.y, f, W.speed, this.dmg(W.dmg), this, W.dist);
      this.beams = this.beams.filter((b) => !b.dead);
      this.beams.push(beam);
      w.spawn(beam);
    } else if (name === 'dive') {
      w.audio.play('boss_roar', { vol: 0.6, pitch: 1.3 });
      w.shake(3, 0.2);
    }
  }

  private slashBox() {
    const R = VALKYRIE.slash.reach;
    return { x: this.facing > 0 ? this.x - 6 : this.x + 6 - R, y: this.y - 100, w: R, h: 100 };
  }

  protected active(name: string, dt: number, p: Player): void {
    if (name === 'slash') {
      hitArea(
        this.world,
        this.slashBox(),
        'enemy',
        { amount: this.dmg(VALKYRIE.slash.dmg[this.swing] ?? 16), dir: this.facing, kind: 'melee', source: this, knockback: 300, hitstun: 0.35 },
        this.hitSet,
      );
      super.active(name, dt, p);
    } else if (name === 'dive') {
      const D = VALKYRIE.dive;
      const w = this.world;
      const dx = this.diveTx - this.x;
      const dy = this.diveFy - this.y;
      const dist = Math.hypot(dx, dy);
      const step = D.speed * dt;
      if (dist <= step || dist < 1) {
        this.x = this.diveTx;
        this.y = this.diveFy;
        this.land();
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        if (Math.floor(this.stateT * 40) !== Math.floor((this.stateT - dt) * 40)) w.particles.emit('spark', this.x, this.y - 60, { count: 2, color: '#dff0ff' });
        hitArea(
          w,
          { x: this.x - 26, y: this.y - 96, w: 52, h: 96 },
          'enemy',
          { amount: this.dmg(D.dmg), dir: sign1(dx), kind: 'melee', source: this, unblockable: true, knockback: 280, knockup: 180, hitstun: 0.4 },
          this.hitSet,
        );
      }
    } else super.active(name, dt, p);
  }

  /** The dive touches down: ring + burst around the landing spot (shares the dive's hit set). */
  private land(): void {
    if (this.landed) return;
    this.landed = true;
    const D = VALKYRIE.dive;
    const w = this.world;
    this.physics = true;
    this.vy = 0;
    this.vx = 0;
    w.audio.play('boss_slam');
    w.audio.play('slam');
    w.shake(9, 0.4);
    w.addHitstop(0.04);
    w.particles.emit('slam', this.x, this.y, { count: 16 });
    w.particles.emit('debris', this.x, this.y - 6, { count: 8, w: 50 });
    w.fx.ring(this.x, this.y - 6, { radius: D.radius, color: '#cfe6ff', life: 0.3, flat: 0.4 });
    hitArea(
      w,
      { x: this.x - D.radius, y: this.y - 64, w: D.radius * 2, h: 64 },
      'enemy',
      { amount: this.dmg(D.dmg), dir: 1, kind: 'melee', source: this, unblockable: true, knockback: 290, knockup: 200, hitstun: 0.4 },
      this.hitSet,
    );
    this.endActiveNow();
  }

  protected activeEnd(name: string): void {
    if (name !== 'dive') return;
    if (!this.landed) {
      // ran out of time in the air: touch down without a burst
      this.landed = true;
      this.y = this.world.map.floorBelow(this.x, this.groundY - 160, 800) ?? this.groundY;
      this.physics = true;
      this.vy = 0;
    }
  }

  protected attackDone(): void {
    this.physics = true;
  }

  protected clearConjured(): void {
    for (const b of this.beams) b.dead = true;
    this.beams = [];
  }

  protected drawMarkers(ctx: CanvasRenderingContext2D, p: number): void {
    const f = this.facing;
    const t = this.time;
    const gy = this.groundY;
    const name = this.attack;
    if (name === 'slash') {
      const b = this.slashBox();
      warnRect(ctx, b.x, b.y, b.w, b.h, p, t);
    } else if (name === 'wave') {
      const edge = f > 0 ? this.arenaR - 10 : this.arenaL + 10;
      const end = f > 0 ? Math.min(edge, this.x + f * (56 + VALKYRIE.wave.dist)) : Math.max(edge, this.x + f * (56 + VALKYRIE.wave.dist));
      warnPath(ctx, this.x + f * 56, end, this.y, f, p, t, 6);
    } else if (name === 'dive') {
      const fl = this.diveLocked ? this.diveFy : this.world.map.floorBelow(this.diveTx, this.groundY - 40, 700) ?? gy;
      const a = this.diveLocked ? 1 : 0.35;
      warnLine(ctx, this.x, this.y - 40, this.diveTx, fl - 10, a, 2, '#ff3b30', 4);
      warnCircle(ctx, this.diveTx, fl, VALKYRIE.dive.radius, this.diveLocked ? 0.4 + 0.6 * p : 0.2 + 0.3 * p, t);
    }
  }
}

const sign1 = (v: number): 1 | -1 => (v >= 0 ? 1 : -1);
