import { clamp, easeOutCubic, sign } from '../../engine/math';
import { TILE } from '../../engine/config';
import type { Player } from '../player/player';
import { warnCircle } from '../enemies/telegraph';
import { MiniBoss, type AttackStep, type MiniBossSpec } from './base';
import { MoonOrb, MoonShard } from './hazards';

/** 달의 마녀 (ramparts): a floating witch (no visible feet) with a crescent-moon staff and glowing orb familiars. */
export const WITCH_SPEC: MiniBossSpec = {
  id: 'mb_witch',
  name: '달의 마녀',
  biome: 'ramparts',
  hp: 900,
  w: 40,
  h: 96,
  walk: 64,
  activateRange: 340,
  blood: '#b8c8ff',
  light: '#9fb8ff',
};

export const WITCH = {
  /** px she hovers above the floor */
  hover: 14,
  /** 3 slow homing orbs (a swing or an arrow pops one) */
  orb: { w: 0.8, a: 0.3, r: 0.7, dmg: 10, count: 3, speed: 105, turn: 1.5, life: 4.5, spread: 0.55 },
  /** teleports to another spot of the arena (the destination is marked) */
  blink: { w: 0.6, a: 0.12, r: 0.5, fromPlayer: 150, minMove: 120 },
  /** moon shards fall at marked spots (the first on the player) */
  shards: { w: 0.95, a: 0.9, r: 0.8, dmg: 13, count: 5, radius: 30, gap: 0.16 },
} as const;

export type WitchAttack = 'orb' | 'blink' | 'shards';

export class Witch extends MiniBoss {
  private blinkTx = 0;
  private orbs: MoonOrb[] = [];

  constructor(x: number, y: number, tier = 1) {
    super(WITCH_SPEC, x, y, tier);
    this.physics = false;
  }

  get attackNames(): readonly WitchAttack[] {
    return ['orb', 'blink', 'shards'];
  }

  init(): void {
    super.init();
    this.blinkTx = this.x;
    this.y = this.groundY - WITCH.hover;
  }

  /** the arena floor under her (she hovers above it) */
  private get floorY(): number {
    return this.groundY;
  }

  update(dt: number): void {
    if (this.state !== 'dying') {
      // float: gentle bob, drifts by vx (physics is off)
      this.y = this.floorY - WITCH.hover - 3 * Math.sin(this.time * 2.2);
      this.x = this.inArena(this.x + this.vx * dt, 30);
    }
    super.update(dt);
  }

  protected moveIdle(dt: number, p: Player): void {
    if (p.targetable) this.faceToward(p);
    const dx = p.x - this.x;
    const d = Math.abs(dx);
    const sp = this.spec.walk;
    if (!p.targetable) this.vx = 0;
    else if (d > 300) this.vx = sign(dx) * sp;
    else if (d < 170) this.vx = -sign(dx) * sp * 1.1;
    else this.vx = 0;
    this.anim?.play('float');
  }

  protected chooseAttack(p: Player): WitchAttack {
    const d = Math.abs(p.x - this.x);
    const cands: [WitchAttack, number][] = [
      ['orb', d > 120 ? 4 : 1.5],
      ['shards', 3.5],
      ['blink', d < 120 ? 7 : 1],
    ];
    return this.pickAttack(cands) as WitchAttack;
  }

  protected attackStep(name: string): AttackStep {
    const ws = this.ws;
    const rs = this.rs;
    if (name === 'orb') return { w: WITCH.orb.w * ws, a: WITCH.orb.a, r: WITCH.orb.r * rs };
    if (name === 'blink') return { w: WITCH.blink.w * ws, a: WITCH.blink.a, r: WITCH.blink.r * rs };
    return { w: WITCH.shards.w * ws, a: WITCH.shards.a, r: WITCH.shards.r * rs };
  }

  protected onAttackBegin(name: string, p: Player): void {
    if (name === 'blink') this.blinkTx = this.pickBlinkSpot(p);
    else if (name === 'shards') this.spawnShards(p);
  }

  /** A spot of the arena away from the player and from where she is. */
  private pickBlinkSpot(p: Player): number {
    const rng = this.world.rng;
    const B = WITCH.blink;
    for (let i = 0; i < 12; i++) {
      const x = this.inArena(rng.range(this.arenaL, this.arenaR), 60);
      if (Math.abs(x - p.x) >= B.fromPlayer && Math.abs(x - this.x) >= B.minMove) return x;
    }
    // fall back to the arena end that is farthest from the player
    return this.inArena(p.x < (this.arenaL + this.arenaR) / 2 ? this.arenaR : this.arenaL, 70);
  }

  /** Markers + falling crystals: the first on the player's x, the rest spread over the arena. */
  private spawnShards(p: Player): void {
    const w = this.world;
    const S = WITCH.shards;
    const n = S.count + (this.rage ? 2 : 0);
    const delay = this.atk!.w;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      let x = i === 0 ? this.inArena(p.x, 30) : this.inArena(w.rng.range(this.arenaL, this.arenaR), 40);
      for (let t = 0; t < 8 && xs.some((o) => Math.abs(o - x) < 56); t++) x = this.inArena(x + (w.rng.chance(0.5) ? 60 : -60), 40);
      xs.push(x);
      const floor = w.map.floorBelow(x, this.groundY - 40, 700) ?? this.groundY;
      let top = floor - 40;
      while (top > 0 && !w.map.solidAt(x, top - 8) && floor - top < 360) top -= TILE / 2;
      w.spawn(new MoonShard(x, floor, Math.max(8, top + 14), delay + i * S.gap, this.dmg(S.dmg), this, S.radius));
    }
  }

  protected activeStart(name: string, p: Player): void {
    const w = this.world;
    const f = this.facing;
    if (name === 'orb') {
      const O = WITCH.orb;
      const ox = this.x + f * 28;
      const oy = this.y - 66;
      const n = O.count + (this.rage ? 1 : 0);
      const base = Math.atan2(p.cy - oy, p.x - ox);
      this.orbs = this.orbs.filter((o) => !o.dead);
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : ((i / (n - 1)) * 2 - 1) * O.spread;
        const orb = new MoonOrb(ox, oy, base + off, this.dmg(O.dmg), O.speed, O.turn, O.life, this);
        this.orbs.push(orb);
        w.spawn(orb);
      }
      w.audio.play('freeze', { vol: 0.5, pitch: 1.5 });
      w.fx.ring(ox, oy, { radius: 26, color: '#cfe6ff', life: 0.25 });
      w.particles.emit('magic', ox, oy, { count: 10, color: '#cfe6ff' });
    } else if (name === 'blink') {
      const w0 = this.world;
      w0.particles.emit('magic', this.x, this.y - 50, { count: 14, color: '#9fb8ff' });
      w0.fx.ring(this.x, this.y - 40, { radius: 34, color: '#9fb8ff', life: 0.25 });
      this.x = this.inArena(this.blinkTx, 30);
      this.vx = 0;
      this.faceToward(p);
      w0.particles.emit('magic', this.x, this.y - 50, { count: 14, color: '#9fb8ff' });
      w0.fx.ring(this.x, this.y - 40, { radius: 40, color: '#cfe6ff', life: 0.3 });
      w0.audio.play('roll', { vol: 0.6, pitch: 1.7 });
    } else if (name === 'shards') {
      w.audio.play('boss_roar', { vol: 0.4, pitch: 1.6 });
      w.shake(3, 0.3);
    }
  }

  protected attackDone(name: string): void {
    // right after a blink she follows up quickly
    if (name === 'blink' && this.state === 'idle') this.gapT = 0.25;
  }

  protected onInterrupt(): void {
    // she is already floating
  }

  protected clearConjured(): void {
    for (const o of this.orbs) o.dead = true;
    this.orbs = [];
    for (const e of this.world.entities) if (e instanceof MoonShard) e.dead = true;
  }

  protected drawAlpha(): number {
    if (this.attack !== 'blink') return 1;
    if (this.state === 'windup') return 1 - 0.65 * easeOutCubic(this.telegraph);
    if (this.state === 'active') return 0.2;
    if (this.state === 'recover') return clamp(0.2 + 0.8 * (this.stateT / Math.max(0.01, this.atk?.r ?? 0.5)), 0.2, 1);
    return 1;
  }

  protected drawMarkers(ctx: CanvasRenderingContext2D, p: number): void {
    // the shard spots are drawn by the shards themselves; the blink shows its destination
    if (this.attack === 'blink') {
      const fl = this.groundY;
      warnCircle(ctx, this.blinkTx, fl, 34, p, this.time, '#9fb8ff');
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.3 * p;
      ctx.strokeStyle = '#cfe6ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(this.blinkTx - 14) + 0.5, Math.round(fl - 90) + 0.5, 28, 90);
      ctx.restore();
    }
  }

  protected drawExtra(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dying') return;
    // two orb familiars circling her
    const w = this.world;
    for (let i = 0; i < 2; i++) {
      const a = this.time * 2.4 + i * Math.PI;
      const x = Math.round(this.x + Math.cos(a) * 30);
      const y = Math.round(this.y - 62 + Math.sin(a) * 9);
      ctx.save();
      ctx.globalAlpha = this.drawAlpha();
      ctx.fillStyle = '#120a1a';
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#bcd6ff';
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      w.lights.add(x, y, 22, '#9fb8ff', 0.6);
    }
  }
}
