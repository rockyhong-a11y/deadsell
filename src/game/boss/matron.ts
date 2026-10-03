import { TILE } from '../../engine/config';
import { approach, clamp, easeOutCubic, sign } from '../../engine/math';
import { Actor } from '../entity';
import type { DamageInfo, DamageResult } from '../combat';
import { hitArea } from '../combat';
import { groundUnder } from '../physics';
import type { Player } from '../player/player';
import { dropLoot, spawnFood, spawnItemDrop } from '../items/pickups';
import { rollItem } from '../items/items';
import { warnCircle, warnPath, warnRect } from '../enemies/telegraph';
import { Debris, Shockwave } from './hazards';

/** Tuning (docs/DESIGN.md §5: 2200 HP, hits 18–30). */
export const MATRON = {
  hp: 2200,
  w: 56,
  h: 116,
  activateRange: 300,
  walk: [58, 78],
  slam: { w: 0.9, a: 0.22, r: 0.8, dmg: 28 },
  wave: { speed: [250, 295], dmg: 18 },
  sweep: { w: 0.7, a: 0.24, r: 0.65, dmg: 22, reach: 130 },
  charge: { w: 0.8, speed: [420, 470], max: 2.2, dmg: 26, stun: 2.0 },
  leap: { rise: 0.55, hang: 0.75, rd: 195, dmg: 30, rx: 108 },
  summon: { w: 0.9, a: 0.35, r: 0.8 },
  debris: { dmg: 18, radius: 34 },
  deathAt: 2.0,
  deathTotal: 3.0,
} as const;

export type BossState = 'dormant' | 'intro' | 'idle' | 'slam' | 'sweep' | 'charge' | 'leap' | 'summon' | 'roar' | 'dying';
export type AttackName = 'slam' | 'sweep' | 'charge' | 'leap' | 'summon';

const NO_HIT: DamageResult = { applied: false, amount: 0, killed: false };

/**
 * 강철 여교도관 — The Iron Matron. Two phases; every attack is telegraphed
 * (windup pose + red flash/outline + ground markers) and followed by a recovery in which she can be punished.
 */
export class Matron extends Actor {
  state: BossState = 'dormant';
  phase: 1 | 2 = 1;
  stateT = 0;
  /** step inside the current attack: 0 windup, 1 active, 2 recover (charge: 3 crash/stun) */
  sub = 0;
  /** recent attacks (never the same one 3× in a row) */
  history: AttackName[] = [];
  started = false;
  defeatedEmitted = false;

  private time = 0;
  private gapT = 1;
  private pendingPhase2 = false;
  private timing = { w: 0, a: 0, r: 0 };
  private hitSet = new Set<number>();
  private arenaL = 0;
  private arenaR = 0;
  private groundY = 0;
  private leapTx = 0;
  private lastSummon = -99;
  private stepT = 0;
  private lockedFacing: 1 | -1 = 1;
  private deathFxT = 0;
  private walking = false;
  private roarT = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = MATRON.w;
    this.h = MATRON.h;
    this.maxHp = this.hp = MATRON.hp;
    this.knockbackTaken = 0;
    this.alwaysActive = true;
    this.z = 10;
    this.bloodColor = '#7a2a2a';
    this.facing = -1;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('matron'));
    this.anim?.play('idle');
    this.groundY = this.y;
  }

  onRemove(): void {
    const cam = this.world.camera;
    if (cam.override && this.started) cam.override = null;
  }

  // ------------------------------------------------------------ derived

  /** Windup multiplier (phase 2 = ×0.8). */
  private get ws(): number {
    return this.phase === 2 ? 0.8 : 1;
  }
  /** Recovery multiplier. */
  private get rs(): number {
    return this.phase === 2 ? 0.85 : 1;
  }
  private get p2(): number {
    return this.phase === 2 ? 1 : 0;
  }

  private scanArena(): void {
    const map = this.world.map;
    let lx = this.x;
    let rx = this.x;
    while (lx > 0 && !map.solidAt(lx, this.y - 40)) lx -= TILE / 2;
    while (rx < map.pxW && !map.solidAt(rx, this.y - 40)) rx += TILE / 2;
    this.arenaL = (Math.floor(lx / TILE) + 1) * TILE;
    this.arenaR = Math.floor(rx / TILE) * TILE;
  }

  /** Where her bell-flail head is, roughly (lights + sfx). */
  bellPos(): { x: number; y: number } {
    const f = this.facing;
    const t = this.time;
    const rest = { x: this.x + f * 52 + Math.sin(t * 2) * 5, y: this.y - 34 };
    if (this.state === 'slam') {
      if (this.sub === 0) {
        const k = easeOutCubic(clamp(this.stateT / this.timing.w, 0, 1));
        return { x: rest.x + (this.x - f * 18 - rest.x) * k, y: rest.y + (this.y - 150 - rest.y) * k };
      }
      return { x: this.x + f * 112, y: this.y - 14 };
    }
    if (this.state === 'sweep') {
      if (this.sub === 0) return { x: this.x - f * 72, y: this.y - 74 };
      if (this.sub === 1) return { x: this.x + f * 112, y: this.y - 52 };
    }
    return rest;
  }

  // ------------------------------------------------------------ damage

  protected intercept(_info: DamageInfo): DamageResult | null {
    if (this.state === 'dormant') {
      this.startIntro();
      return NO_HIT;
    }
    if (this.state === 'intro' || this.state === 'roar' || this.state === 'dying') return NO_HIT;
    return null;
  }

  protected onHurt(): void {
    if (this.phase === 1 && !this.pendingPhase2 && this.hp <= this.maxHp * 0.5) this.pendingPhase2 = true;
  }

  die(info: DamageInfo): void {
    super.die(info);
    const w = this.world;
    this.setState('dying');
    this.physics = true;
    this.gravityScale = 1;
    this.vx = 0;
    this.status.burn = this.status.bleed = 0;
    this.anim?.playFor('death', MATRON.deathTotal);
    if (w.camera.override) w.camera.override = null;
    w.addHitstop(0.3);
    w.shake(10, 0.6);
    w.fx.screenFlash('#ffffff', 0.25, 0.5);
    w.audio.play('boss_roar');
    w.audio.play('boss_slam');
    w.particles.emit('explosion', this.x, this.y - 60, { power: 2 });
    w.particles.emit('death', this.x, this.y - 60, { power: 2, count: 40 });
    w.emit({ type: 'enemyKilled', enemy: this, elite: true });
    // lots of loot
    dropLoot(w, this.x, this.y - 50, { cells: 30, gold: 120 });
    const unlocked = w.game.save.unlocked;
    spawnItemDrop(w, this.x - 40, this.y - 30, rollItem(w.rng, 3, unlocked));
    spawnItemDrop(w, this.x + 40, this.y - 30, rollItem(w.rng, 3, unlocked));
    spawnFood(w, this.x, this.y - 30, 0.5);
  }

  // ------------------------------------------------------------ state helpers

  private setState(s: BossState, sub = 0): void {
    this.state = s;
    this.stateT = 0;
    this.sub = sub;
  }

  private faceToward(p: { x: number }): void {
    const d = p.x - this.x;
    if (Math.abs(d) > 4) this.facing = d > 0 ? 1 : -1;
  }

  /** Walk in `dir` unless a wall or ledge is right there. */
  private moveToward(dir: number, speed: number): boolean {
    const map = this.world.map;
    if (dir === 0) return false;
    const ahead = this.x + dir * (this.w / 2 + 6);
    if (map.solidAt(ahead, this.y - 20) || !groundUnder(this, map, dir * (this.w / 2 + 6))) {
      this.vx = 0;
      return false;
    }
    this.vx = dir * speed;
    return true;
  }

  private stepSound(dt: number): void {
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = this.phase === 2 ? 0.42 : 0.55;
      this.world.audio.play('boss_step', { vol: 0.8 });
      this.world.shake(1.6, 0.12);
      this.world.particles.emit('dust', this.x - this.facing * 10, this.y, { count: 3 });
    }
  }

  // ------------------------------------------------------------ main update

  update(dt: number): void {
    this.updateStatus(dt);
    // she shrugs off stuns and freezes (the crash is her only opening), burn/bleed still work
    this.status.stun = 0;
    this.status.freeze = 0;
    this.hitstun = 0;
    this.stateT += dt;
    this.time += dt;
    if (this.arenaR === 0) this.scanArena();
    const p = this.world.player;
    this.walking = false;

    if (this.state === 'dying') {
      this.updateDying(dt);
      super.update(dt);
      return;
    }
    if (this.pendingPhase2) this.enterRoar();

    switch (this.state) {
      case 'dormant':
        this.vx = 0;
        this.anim?.play('idle');
        if (Math.abs(p.x - this.x) < MATRON.activateRange && Math.abs(p.y - this.y) < 260 && p.targetable) this.startIntro();
        break;
      case 'intro':
        this.updateIntro();
        break;
      case 'idle':
        this.updateIdle(dt, p);
        break;
      case 'slam':
      case 'sweep':
      case 'summon':
        this.updatePhased(dt);
        break;
      case 'charge':
        this.updateCharge(dt);
        break;
      case 'leap':
        this.updateLeap(dt, p);
        break;
      case 'roar':
        this.updateRoar();
        break;
      default:
        break;
    }
    if (this.walking) this.stepSound(dt);
    super.update(dt);
  }

  // ------------------------------------------------------------ intro

  private startIntro(): void {
    if (this.state !== 'dormant') return;
    this.setState('intro');
    this.vx = 0;
    this.faceToward(this.world.player);
  }

  private updateIntro(): void {
    const w = this.world;
    this.vx = 0;
    if (this.stateT < 0.05 || !w.camera.override) w.camera.override = { x: this.x, y: this.y - 70 };
    if (this.sub === 0 && this.stateT >= 0.7) {
      this.sub = 1;
      this.anim?.playFor('roar', 1.7);
      w.audio.play('boss_roar');
      w.audio.play('bell');
      w.shake(6, 1.4);
      w.fx.ring(this.x, this.y - 60, { radius: 150, color: '#ffb35a', life: 0.6 });
      w.particles.emit('dust', this.x, this.y, { count: 14, w: 100 });
      if (!this.started) {
        this.started = true;
        w.emit({ type: 'bossStart', boss: this });
      }
    } else if (this.sub === 0) this.anim?.play('idle');
    if (this.sub === 1 && this.stateT >= 2.6) {
      w.camera.override = null;
      this.gapT = 0.8;
      this.setState('idle');
    }
  }

  // ------------------------------------------------------------ idle / choosing attacks

  private updateIdle(dt: number, p: Player): void {
    this.gapT -= dt;
    if (p.targetable) this.faceToward(p);
    const dx = p.x - this.x;
    const d = Math.abs(dx);
    const sp = MATRON.walk[this.p2];
    let moving = false;
    if (!p.targetable) this.vx = approach(this.vx, 0, 600 * dt);
    else if (d > 170) moving = this.moveToward(sign(dx), sp);
    else if (d < 70) moving = this.moveToward(-sign(dx), sp * 0.6);
    else this.vx = approach(this.vx, 0, 900 * dt);
    if (!moving && Math.abs(this.vx) < 1) this.vx = 0;
    this.walking = moving;
    this.anim?.play(moving ? 'walk' : 'idle');
    if (this.gapT <= 0 && p.targetable) this.chooseAttack(p);
  }

  private chooseAttack(p: Player): void {
    const d = Math.abs(p.x - this.x);
    const cands: [AttackName, number][] = [
      ['slam', d < 220 ? 4 : 1.2],
      ['sweep', d < 150 ? 5 : d < 200 ? 1 : 0],
      ['charge', d >= 170 ? 4.5 : d >= 110 ? 1 : 0],
      ['leap', d >= 110 ? 3 : 1.5],
    ];
    if (this.phase === 2 && this.world.time - this.lastSummon > 7) cands.push(['summon', 2.5]);
    const h = this.history;
    const ok = cands.filter(([n, wt]) => wt > 0 && !(h.length >= 2 && h[h.length - 1] === n && h[h.length - 2] === n));
    const pick = this.world.rng.weighted(ok.length ? ok : cands, (c) => c[1])[0];
    this.startAttack(pick, p);
  }

  /** Public so tests can force a specific attack. */
  startAttack(a: AttackName, p: Player = this.world.player): void {
    this.history.push(a);
    if (this.history.length > 6) this.history.shift();
    this.faceToward(p);
    this.lockedFacing = this.facing;
    this.vx = 0;
    this.hitSet = new Set();
    switch (a) {
      case 'slam':
        this.beginPhased('slam', MATRON.slam.w * this.ws, MATRON.slam.a, MATRON.slam.r * this.rs);
        break;
      case 'sweep':
        this.beginPhased('sweep', MATRON.sweep.w * this.ws, MATRON.sweep.a, MATRON.sweep.r * this.rs);
        break;
      case 'summon':
        this.lastSummon = this.world.time;
        this.beginPhased('summon', MATRON.summon.w * this.ws, MATRON.summon.a, MATRON.summon.r * this.rs, false);
        this.anim?.playFor('summon', MATRON.summon.w * this.ws + MATRON.summon.a + MATRON.summon.r * this.rs);
        this.spawnDebris(5, p.x, 0.9 * this.ws + 0.25);
        break;
      case 'charge':
        this.setState('charge', 0);
        this.timing = { w: MATRON.charge.w * this.ws, a: MATRON.charge.max, r: 0.9 * this.rs };
        this.anim?.playFor('charge_windup', this.timing.w);
        this.world.audio.play('telegraph');
        break;
      case 'leap':
        this.setState('leap', 0);
        this.groundY = this.y;
        this.physics = false;
        this.vy = 0;
        this.leapTx = p.x;
        this.anim?.playFor('leap', MATRON.leap.rise);
        this.world.audio.play('boss_step');
        break;
    }
  }

  private beginPhased(name: 'slam' | 'sweep' | 'summon', w: number, a: number, r: number, play = true): void {
    this.setState(name, 0);
    this.timing = { w, a, r };
    if (play) this.anim?.playPhased(name, w, a, r);
    this.world.audio.play('telegraph');
  }

  private endAttack(): void {
    this.physics = true;
    this.gapT = this.phase === 2 ? this.world.rng.range(0.4, 0.8) : this.world.rng.range(0.9, 1.4);
    this.setState('idle');
  }

  // ------------------------------------------------------------ slam / sweep / summon

  private updatePhased(dt: number): void {
    const t = this.timing;
    this.vx = approach(this.vx, 0, 1200 * dt);
    this.facing = this.lockedFacing;
    if (this.sub === 0 && this.stateT >= t.w) {
      this.sub = 1;
      this.stateT = 0;
      this.hitSet = new Set();
      this.onActiveStart();
    }
    if (this.sub === 1) {
      this.onActive();
      if (this.stateT >= t.a) {
        this.sub = 2;
        this.stateT = 0;
      }
    } else if (this.sub === 2 && this.stateT >= t.r) this.endAttack();
  }

  private onActiveStart(): void {
    const w = this.world;
    const f = this.facing;
    if (this.state === 'slam') {
      w.audio.play('boss_slam');
      w.audio.play('slam');
      w.audio.play('bell');
      w.shake(9, 0.4);
      w.addHitstop(0.04);
      w.particles.emit('slam', this.x + f * 110, this.y, { dir: f, count: 18 });
      w.particles.emit('debris', this.x + f * 110, this.y - 8, { count: 10 });
      w.fx.ring(this.x + f * 110, this.y - 6, { radius: 80, color: '#ffb35a', life: 0.3 });
      const sp = MATRON.wave.speed[this.p2];
      w.spawn(new Shockwave(this.x + f * 150, this.y, f, sp, MATRON.wave.dmg, this));
      w.spawn(new Shockwave(this.x - f * 40, this.y, f > 0 ? -1 : 1, sp, MATRON.wave.dmg, this));
    } else if (this.state === 'sweep') {
      w.audio.play('swing_heavy');
      w.audio.play('bell');
      w.shake(5, 0.2);
      w.fx.slash(this.x + f * 60, this.y - 45, { dir: f, radius: 90, from: -0.9, to: 0.5, color: '#ffd9a0', width: 5, life: 0.2 });
    } else if (this.state === 'summon') {
      w.audio.play('boss_roar', { vol: 0.7 });
      w.shake(5, 0.4);
    }
  }

  private onActive(): void {
    const f = this.facing;
    if (this.state === 'slam') {
      hitArea(
        this.world,
        { x: f > 0 ? this.x + 8 : this.x - 148, y: this.y - 90, w: 140, h: 90 },
        'enemy',
        { amount: MATRON.slam.dmg, dir: f, kind: 'melee', source: this, unblockable: true, knockback: 320, knockup: 210, hitstun: 0.45 },
        this.hitSet,
      );
    } else if (this.state === 'sweep') {
      hitArea(
        this.world,
        { x: f > 0 ? this.x - 8 : this.x - MATRON.sweep.reach + 8, y: this.y - 70, w: MATRON.sweep.reach, h: 70 },
        'enemy',
        { amount: MATRON.sweep.dmg, dir: f, kind: 'melee', source: this, knockback: 340, hitstun: 0.4 },
        this.hitSet,
      );
    }
  }

  // ------------------------------------------------------------ charge

  private updateCharge(dt: number): void {
    const w = this.world;
    const t = this.timing;
    const f = this.lockedFacing;
    this.facing = f;
    if (this.sub === 0) {
      // windup: stomping in place, red glow
      this.vx = approach(this.vx, 0, 1200 * dt);
      if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) w.shake(1.5, 0.1);
      if (this.stateT >= t.w) {
        this.sub = 1;
        this.stateT = 0;
        this.hitSet = new Set();
        this.anim?.play('charge');
        w.audio.play('boss_roar', { vol: 0.6 });
      }
    } else if (this.sub === 1) {
      const sp = MATRON.charge.speed[this.p2];
      const ledge = !groundUnder(this, w.map, f * (this.w / 2 + 10));
      this.vx = f * sp;
      if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) {
        w.audio.play('boss_step', { vol: 0.8 });
        w.shake(2.5, 0.1);
        w.particles.emit('dust', this.x - f * 20, this.y, { dir: -f, count: 3 });
      }
      hitArea(
        w,
        { x: f > 0 ? this.x - 30 : this.x - 54, y: this.y - 100, w: 84, h: 100 },
        'enemy',
        { amount: MATRON.charge.dmg, dir: f, kind: 'melee', source: this, unblockable: true, knockback: 380, knockup: 150, hitstun: 0.4 },
        this.hitSet,
      );
      if (this.hitWallX === f) this.crash();
      else if (ledge || this.stateT >= t.a) {
        // ran out of road: skids to a stop, recovers
        this.sub = 2;
        this.stateT = 0;
        this.anim?.play('idle');
      }
    } else if (this.sub === 2) {
      this.vx = approach(this.vx, 0, 900 * dt);
      if (this.stateT >= t.r) this.endAttack();
    } else if (this.sub === 3) {
      // crashed into the wall: stunned and wide open
      this.vx = 0;
      if (this.stateT >= MATRON.charge.stun) {
        this.endAttack();
        this.gapT = 0.5;
      }
    }
  }

  private crash(): void {
    const w = this.world;
    this.sub = 3;
    this.stateT = 0;
    this.vx = 0;
    this.anim?.playFor('crash', MATRON.charge.stun);
    w.audio.play('boss_slam');
    w.audio.play('slam');
    w.shake(12, 0.5);
    w.addHitstop(0.06);
    w.particles.emit('slam', this.x + this.facing * 30, this.y - 60, { count: 18, dir: -this.facing });
    w.particles.emit('debris', this.x + this.facing * 30, this.y - 70, { count: 14 });
    w.fx.text(this.x, this.y - this.h - 14, '기절!', '#ffd23f');
    if (this.phase === 2) this.spawnDebris(2, w.player.x, 0.9);
  }

  // ------------------------------------------------------------ leap

  private updateLeap(dt: number, p: Player): void {
    const w = this.world;
    const L = MATRON.leap;
    const speed = 420;
    const clampX = (x: number) => clamp(x, this.arenaL + 50, this.arenaR - 50);
    if (this.sub === 0) {
      // rise (physics off): up and toward the player
      const k = clamp(this.stateT / L.rise, 0, 1);
      this.y = this.groundY - L.rd * easeOutCubic(k);
      this.leapTx = clampX(p.x);
      this.x = approach(this.x, this.leapTx, speed * dt);
      this.faceToward({ x: this.leapTx });
      if (k >= 1) {
        this.sub = 1;
        this.stateT = 0;
        this.anim?.play('leap_fall');
      }
    } else if (this.sub === 1) {
      // hang above the player with the shadow marker; tracks until the last 0.25 s
      const hang = L.hang * this.ws;
      this.y = this.groundY - L.rd + Math.sin(this.stateT * 14) * 2;
      if (this.stateT < hang - 0.25) this.leapTx = clampX(p.x);
      this.x = approach(this.x, this.leapTx, speed * dt);
      if (this.stateT >= hang) {
        this.sub = 2;
        this.stateT = 0;
        this.vy = 260;
        this.world.audio.play('telegraph');
      }
    } else if (this.sub === 2) {
      // fall
      this.vy = Math.min(1100, this.vy + 3200 * dt);
      this.y += this.vy * dt;
      const floor = w.map.floorBelow(this.x, this.groundY - L.rd - 10, 900) ?? this.groundY;
      if (this.y >= floor) {
        this.y = floor;
        this.vy = 0;
        this.physics = true;
        this.sub = 3;
        this.stateT = 0;
        this.hitSet = new Set();
        const ra = MATRON.leap.rx;
        this.anim?.playFor('leap_land', 0.9 * this.rs);
        w.audio.play('boss_slam');
        w.audio.play('slam');
        w.shake(11, 0.45);
        w.addHitstop(0.05);
        w.particles.emit('slam', this.x, this.y, { count: 22 });
        w.particles.emit('debris', this.x, this.y - 6, { count: 12, w: 60 });
        w.fx.ring(this.x, this.y - 6, { radius: ra, color: '#ffb35a', life: 0.3 });
        hitArea(
          w,
          { x: this.x - ra, y: this.y - 64, w: ra * 2, h: 64 },
          'enemy',
          { amount: L.dmg, dir: 1, kind: 'melee', source: this, unblockable: true, knockback: 330, knockup: 220, hitstun: 0.45 },
          this.hitSet,
        );
      }
    } else if (this.sub === 3) {
      this.vx = approach(this.vx, 0, 900 * dt);
      if (this.stateT >= 0.9 * this.rs) this.endAttack();
    }
  }

  // ------------------------------------------------------------ phase 2

  private enterRoar(): void {
    const w = this.world;
    this.pendingPhase2 = false;
    if (this.phase === 2) return;
    // whatever she was doing, she stops and roars
    if (this.state === 'leap') {
      this.y = this.groundY;
      this.vy = 0;
    }
    this.physics = true;
    this.phase = 2;
    this.setState('roar');
    this.vx = 0;
    this.roarT = 2.1;
    this.invuln = 0;
    this.anim?.playFor('roar', this.roarT);
    w.audio.play('boss_roar');
    w.audio.play('bell');
    w.shake(10, 1.5);
    w.fx.screenFlash('#ff9a5a', 0.5, 0.55);
    w.fx.ring(this.x, this.y - 60, { radius: 200, color: '#ff7a3a', life: 0.7 });
    w.particles.emit('slam', this.x, this.y, { count: 20 });
    // chains / debris rain over the arena
    this.spawnDebris(6, w.player.x, 1.0, true);
  }

  private updateRoar(): void {
    this.vx = 0;
    if (this.stateT >= this.roarT) {
      this.gapT = 0.6;
      this.setState('idle');
    }
  }

  /**
   * Debris at marked spots: the first lands on the player's current x, the rest spread over the arena.
   * Markers show immediately; rocks fall one after the other starting at `delay`.
   */
  private spawnDebris(n: number, aroundX: number, delay: number, spread = false): void {
    const w = this.world;
    const rng = w.rng;
    const map = w.map;
    const lo = this.arenaL + 40;
    const hi = this.arenaR - 40;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      let x = i === 0 ? aroundX : spread ? rng.range(lo, hi) : aroundX + (i % 2 ? 1 : -1) * (50 + Math.floor(i / 2) * 55) + rng.range(-12, 12);
      x = clamp(x, lo, hi);
      // keep markers apart so every rock is readable
      for (let tries = 0; tries < 6 && xs.some((o) => Math.abs(o - x) < 44); tries++) x = clamp(x + (rng.chance(0.5) ? 48 : -48), lo, hi);
      xs.push(x);
      const floor = map.floorBelow(x, this.groundY - 40, 700) ?? this.groundY;
      let top = floor - 40;
      while (top > 0 && !map.solidAt(x, top - 8) && floor - top < 360) top -= TILE / 2;
      w.spawn(new Debris(x, floor, Math.max(8, top + 14), delay + i * 0.22, MATRON.debris.dmg, this, MATRON.debris.radius));
    }
  }

  // ------------------------------------------------------------ death

  private updateDying(dt: number): void {
    const w = this.world;
    this.vx = approach(this.vx, 0, 700 * dt);
    this.deathFxT -= dt;
    if (this.deathFxT <= 0) {
      this.deathFxT = 0.11;
      const rx = this.x + w.rng.range(-36, 36);
      const ry = this.y - w.rng.range(10, 110);
      w.particles.emit(w.rng.chance(0.5) ? 'explosion' : 'death', rx, ry, { power: 1.1 + this.stateT * 0.25 });
      w.shake(4 + this.stateT * 1.5, 0.15);
      if (w.rng.chance(0.3)) w.audio.play('explosion', { vol: 0.5 });
    }
    if (!this.defeatedEmitted && this.stateT >= MATRON.deathAt) {
      this.defeatedEmitted = true;
      w.fx.screenFlash('#ffffff', 0.35, 0.7);
      w.shake(14, 0.8);
      w.particles.emit('explosion', this.x, this.y - 60, { power: 3 });
      w.particles.emit('death', this.x, this.y - 60, { power: 3, count: 60 });
      w.emit({ type: 'bossDefeated', boss: this });
    }
    if (this.stateT >= MATRON.deathTotal) {
      if (!this.defeatedEmitted) {
        this.defeatedEmitted = true;
        w.emit({ type: 'bossDefeated', boss: this });
      }
      this.dead = true;
    }
  }

  // ------------------------------------------------------------ drawing

  /** 0..1 progress through the current windup, or -1. */
  private get telegraph(): number {
    const t = this.timing;
    if ((this.state === 'slam' || this.state === 'sweep' || this.state === 'summon') && this.sub === 0) return clamp(this.stateT / Math.max(0.01, t.w), 0, 1);
    if (this.state === 'charge' && this.sub === 0) return clamp(this.stateT / Math.max(0.01, t.w), 0, 1);
    if (this.state === 'leap' && (this.sub === 1 || this.sub === 2)) return this.sub === 2 ? 1 : clamp(this.stateT / (MATRON.leap.hang * this.ws), 0, 1);
    return -1;
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, p: number): void {
    const f = this.facing;
    const t = this.time;
    const gy = this.state === 'leap' ? this.groundY : this.y;
    if (this.state === 'slam') {
      warnRect(ctx, f > 0 ? this.x + 8 : this.x - 148, gy - 90, 140, 90, p, t);
      // shockwave lanes: arrows pointing both ways along the floor
      warnPath(ctx, this.x + f * 150, this.x + f * 150 + f * 90, gy, f, p * 0.8, t, 4);
      warnPath(ctx, this.x - f * 40, this.x - f * 40 - f * 90, gy, -f, p * 0.8, t, 4);
    } else if (this.state === 'sweep') {
      warnRect(ctx, f > 0 ? this.x - 8 : this.x - MATRON.sweep.reach + 8, gy - 70, MATRON.sweep.reach, 70, p, t);
    } else if (this.state === 'charge') {
      const wallX = f > 0 ? this.arenaR : this.arenaL;
      warnPath(ctx, this.x, wallX, gy, f, p, t, 8);
    } else if (this.state === 'leap') {
      // floor shadow marker where she will land
      const tx = this.leapTx;
      const fl = this.world.map.floorBelow(tx, gy - 40, 700) ?? gy;
      warnCircle(ctx, tx, fl, MATRON.leap.rx, this.sub === 2 ? 1 : 0.25 + 0.6 * p, t);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.35 * p;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(Math.round(tx), Math.round(fl) - 1, 40, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.anim) return;
    const w = this.world;
    const tele = this.telegraph;
    if (tele >= 0) this.drawMarkers(ctx, tele);
    let flash = 0;
    let flashColor = '#ffffff';
    if (this.flash > 0) flash = 1;
    else if (tele >= 0 && this.state !== 'summon') {
      flash = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * (14 + 10 * tele)));
      flashColor = '#ff3b30';
    } else if (this.state === 'roar') {
      flash = 0.2 + 0.2 * Math.sin(this.time * 20);
      flashColor = '#ff9a5a';
    }
    const outline = tele >= 0 && this.state !== 'summon' ? '#ff3b30' : this.phase === 2 && !this.dying ? '#ff7a2a' : undefined;
    this.anim.draw(ctx, this.x, this.y, this.facing < 0, { flash, flashColor, outline });

    // stunned stars
    if (this.state === 'charge' && this.sub === 3) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(Math.round(this.x + Math.cos(a) * 26) - 2, Math.round(this.y - this.h - 6 + Math.sin(a) * 6) - 2, 4, 4);
      }
    }

    // lights: glowing ember eyes + the bell
    if (!this.dying || this.stateT < 1.5) {
      const intensity = this.state === 'roar' ? 1.4 : tele >= 0 ? 1.1 : 0.85;
      w.lights.add(this.x + this.facing * 22, this.y - 100, 38, '#ff7a2a', intensity, 0.25);
      const b = this.bellPos();
      w.lights.add(b.x, b.y, 54, '#ffb55a', 0.5 + (tele >= 0 ? 0.3 : 0), 0.15);
    }
  }
}

/** Create The Iron Matron at (x, y) = her feet. Emits bossStart / bossDefeated (once each). */
export function createBoss(x: number, y: number): Actor {
  return new Matron(x, y);
}
