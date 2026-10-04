import { hitArea } from '../combat';
import type { Player } from '../player/player';
import { createEnemy } from '../enemies/factory';
import { FloorWave } from '../enemies/hazards';
import { warnCircle, warnPath, warnRect } from '../enemies/telegraph';
import { MiniBoss, type AttackStep, type MiniBossSpec } from './base';

/** 처형인 수녀원장 (prison): gaunt nun-executioner with a guillotine-blade cleaver. */
export const ABBESS_SPEC: MiniBossSpec = {
  id: 'mb_abbess',
  name: '처형인 수녀원장',
  biome: 'prison',
  hp: 650,
  w: 46,
  h: 96,
  walk: 54,
  activateRange: 300,
  blood: '#7a2a2a',
  light: '#b8c4ff',
};

export const ABBESS = {
  /** overhead chop + a crack that runs along the floor (jumpable) */
  cleave: { w: 0.85, a: 0.2, r: 0.8, dmg: 20, reach: 98, crackDmg: 10, crackSpeed: 300, crackDist: 230 },
  /** spinning blade dash toward the player's side of the room; spin_end = the recovery */
  spin: { w: 0.9, a: 1.6, r: 1.0, speed: 380, dmg: 16, hw: 46 },
  /** rings the bell: 2 ghouls rise at the marked spots */
  summon: { w: 1.1, a: 0.3, r: 0.9, count: 2, cd: 13 },
} as const;

export type AbbessAttack = 'cleave' | 'spin' | 'summon';

export class Abbess extends MiniBoss {
  private lastSummon = -99;
  private spots: number[] = [];

  constructor(x: number, y: number, tier = 1) {
    super(ABBESS_SPEC, x, y, tier);
  }

  get attackNames(): readonly AbbessAttack[] {
    return ['cleave', 'spin', 'summon'];
  }

  protected moveIdle(dt: number, p: Player): void {
    this.walkIdle(dt, p, 70, 170);
  }

  protected chooseAttack(p: Player): AbbessAttack {
    const d = Math.abs(p.x - this.x);
    const cands: [AbbessAttack, number][] = [
      ['cleave', d < 140 ? 5 : d < 220 ? 1.5 : 0.4],
      ['spin', d >= 120 ? 3 : 1.2],
    ];
    if (this.liveMinions() === 0 && this.world.time - this.lastSummon > ABBESS.summon.cd) cands.push(['summon', 3.5]);
    return this.pickAttack(cands) as AbbessAttack;
  }

  protected attackStep(name: string): AttackStep {
    const ws = this.ws;
    const rs = this.rs;
    switch (name) {
      case 'cleave':
        return { w: ABBESS.cleave.w * ws, a: ABBESS.cleave.a, r: ABBESS.cleave.r * rs };
      case 'spin':
        return { w: ABBESS.spin.w * ws, a: ABBESS.spin.a, r: ABBESS.spin.r * rs, anim: null };
      default:
        return { w: ABBESS.summon.w * ws, a: ABBESS.summon.a, r: ABBESS.summon.r * rs, anim: null };
    }
  }

  protected onAttackBegin(name: string, p: Player): void {
    if (name === 'summon') {
      this.lastSummon = this.world.time;
      const s = this.atk!;
      this.anim?.playFor('summon', s.w + s.a + s.r);
      this.pickSpots(p);
      this.world.audio.play('bell');
    } else if (name === 'spin') this.anim?.play('spin', true);
  }

  /** Two spots on either side of the player (kept off the abbess herself and apart from each other). */
  private pickSpots(p: Player): void {
    const out: number[] = [];
    for (let i = 0; i < ABBESS.summon.count; i++) {
      let x = this.inArena(p.x + (i % 2 ? 1 : -1) * (90 + Math.floor(i / 2) * 60), 50);
      for (let t = 0; t < 4 && (Math.abs(x - this.x) < 50 || out.some((o) => Math.abs(o - x) < 56)); t++) x = this.inArena(x + (x < this.x ? 60 : -60) * (t % 2 ? -1 : 1), 50);
      out.push(x);
    }
    this.spots = out;
  }

  protected windup(name: string, dt: number, p: Player): void {
    super.windup(name, dt, p);
    // the blade winds up slowly
    if (name === 'spin' && this.anim) {
      this.anim.play('spin');
      this.anim.speed = 0.35;
    }
  }

  protected activeStart(name: string): void {
    const w = this.world;
    const f = this.facing;
    if (name === 'cleave') {
      w.audio.play('boss_slam', { vol: 0.8 });
      w.audio.play('slam');
      w.shake(7, 0.3);
      w.addHitstop(0.03);
      const cx = this.x + f * (ABBESS.cleave.reach - 10);
      w.particles.emit('slam', cx, this.y, { dir: f, count: 14 });
      w.particles.emit('debris', cx, this.y - 6, { count: 8 });
      w.fx.slash(this.x + f * 50, this.y - 56, { dir: f, radius: 70, from: -1.3, to: 0.7, color: '#dfe6ff', width: 5, life: 0.2 });
      const C = ABBESS.cleave;
      w.spawn(new FloorWave(this.x + f * (C.reach + 6), this.y, f, { speed: C.crackSpeed, damage: this.dmg(C.crackDmg), maxDist: C.crackDist, source: this }));
    } else if (name === 'spin') {
      w.audio.play('swing_heavy');
      w.shake(3, 0.3);
      this.anim?.play('spin', true);
    } else if (name === 'summon') {
      w.audio.play('boss_roar', { vol: 0.6 });
      w.audio.play('bell');
      w.shake(4, 0.35);
      w.fx.ring(this.x, this.y - 50, { radius: 120, color: '#b8c4ff', life: 0.4 });
      for (const sx of this.spots) {
        const fy = w.map.floorBelow(sx, this.groundY - 40, 400) ?? this.groundY;
        const g = createEnemy('ghoul', sx, fy, { tier: this.tier, elite: false });
        w.spawn(g);
        this.minions.push(g);
        w.particles.emit('dust', sx, fy, { count: 10, w: 40 });
        w.particles.emit('death', sx, fy - 20, { count: 8, color: '#7e6a9a' });
        w.fx.ring(sx, fy - 4, { radius: 36, color: '#9d86c8', life: 0.35, flat: 0.35 });
      }
    }
  }

  protected active(name: string, dt: number, p: Player): void {
    const f = this.facing;
    if (name === 'cleave') {
      const C = ABBESS.cleave;
      hitArea(
        this.world,
        { x: f > 0 ? this.x + 4 : this.x - 4 - C.reach, y: this.y - 100, w: C.reach, h: 100 },
        'enemy',
        { amount: this.dmg(C.dmg), dir: f, kind: 'melee', source: this, knockback: 300, knockup: 160, hitstun: 0.4 },
        this.hitSet,
      );
      super.active(name, dt, p);
    } else if (name === 'spin') {
      const S = ABBESS.spin;
      this.anim?.play('spin');
      this.vx = f * S.speed;
      if (Math.floor(this.stateT * 12) !== Math.floor((this.stateT - dt) * 12)) {
        this.hitSet = new Set();
        this.world.particles.emit('spark', this.x + f * 30, this.y - 4, { dir: f, count: 2 });
      }
      hitArea(
        this.world,
        { x: this.x - S.hw, y: this.y - 84, w: S.hw * 2, h: 84 },
        'enemy',
        { amount: this.dmg(S.dmg), dir: f, kind: 'melee', source: this, unblockable: true, knockback: 300, knockup: 140, hitstun: 0.35 },
        this.hitSet,
      );
      const edge = f > 0 ? this.arenaR - this.w / 2 - 3 : this.arenaL + this.w / 2 + 3;
      if (this.hitWallX === f || (f > 0 ? this.x >= edge : this.x <= edge)) {
        this.world.shake(6, 0.3);
        this.world.audio.play('slam', { vol: 0.7 });
        this.world.particles.emit('debris', this.x + f * 24, this.y - 40, { count: 8 });
        this.endActiveNow();
      }
    } else super.active(name, dt, p);
  }

  protected activeEnd(name: string): void {
    if (name === 'spin') this.anim?.playFor('spin_end', this.atk?.r ?? 1);
  }

  protected drawMarkers(ctx: CanvasRenderingContext2D, p: number): void {
    const f = this.facing;
    const t = this.time;
    const gy = this.y;
    const name = this.attack;
    if (name === 'cleave') {
      const C = ABBESS.cleave;
      warnRect(ctx, f > 0 ? this.x + 4 : this.x - 4 - C.reach, gy - 100, C.reach, 100, p, t);
      warnPath(ctx, this.x + f * C.reach, this.x + f * (C.reach + C.crackDist), gy, f, p * 0.8, t, 4);
    } else if (name === 'spin') {
      const S = ABBESS.spin;
      const end = f > 0 ? Math.min(this.arenaR - 10, this.x + S.speed * S.a) : Math.max(this.arenaL + 10, this.x - S.speed * S.a);
      warnPath(ctx, this.x, end, gy, f, p, t, 8);
      warnRect(ctx, this.x - S.hw, gy - 84, S.hw * 2, 84, p * 0.6, t);
    } else if (name === 'summon') {
      for (const sx of this.spots) {
        const fy = this.world.map.floorBelow(sx, this.groundY - 40, 400) ?? this.groundY;
        warnCircle(ctx, sx, fy, 28, p, t, '#b58cff');
      }
    }
  }

  protected drawExtra(): void {
    if (this.state === 'windup' && this.attack === 'summon') this.world.lights.add(this.x + this.facing * 24, this.y - 60, 64, '#b8c4ff', 0.4 + 0.5 * this.telegraph, 0.2);
  }
}
