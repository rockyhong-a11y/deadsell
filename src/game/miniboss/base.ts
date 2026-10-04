import { TILE } from '../../engine/config';
import { approach, clamp, sign } from '../../engine/math';
import { Actor } from '../entity';
import type { DamageInfo, DamageResult } from '../combat';
import { groundUnder } from '../physics';
import type { Player } from '../player/player';
import { dropLoot, spawnItemDrop } from '../items/pickups';
import { rollItem } from '../items/items';
import { warnBang } from '../enemies/telegraph';
import { CORPSE, TIER2, loopDmgMul, loopHpMul } from '../rules';

export type MiniBossId = 'mb_abbess' | 'mb_arachne' | 'mb_valkyrie' | 'mb_witch';

/** Tuning + identity of one mid-boss (docs/CONTENT2.md section 2). Sheet name = id. */
export interface MiniBossSpec {
  id: MiniBossId;
  /** Korean display name (name card + HP bar) */
  name: string;
  biome: 'prison' | 'ramparts';
  /** hp before tier scaling (prison ~650, ramparts ~900) */
  hp: number;
  /** hurt box (px) */
  w: number;
  h: number;
  /** walking / floating speed px/s */
  walk: number;
  /** wakes up when the player is within this many px (horizontally) */
  activateRange: number;
  blood: string;
  /** eye / aura light colour */
  light: string;
}

export type MiniState = 'dormant' | 'intro' | 'idle' | 'windup' | 'active' | 'recover' | 'stunned' | 'dying';

/** Timings (seconds) of one attack or of one swing of a combo. `anim` = sheet animation to stretch over them. */
export interface AttackStep {
  w: number;
  a: number;
  r: number;
  /** animation name played phased (windup/active/recover); null = the boss plays its own */
  anim?: string | null;
}

export const MB = {
  /** the intro (name card) in which she cannot be hurt */
  intro: 1.1,
  /** below this share of max hp the boss is enraged: shorter windups / pauses */
  rageAt: 0.4,
  /** longest a parry stun may hold the boss, and the immunity that follows it */
  stunMax: 1.6,
  stunImmune: 3,
  deathAt: 1.3,
  deathTotal: 1.9,
  cells: [10, 15],
  gold: [60, 100],
} as const;

const NO_HIT: DamageResult = { applied: false, amount: 0, killed: false };

/**
 * Common brain of the mid-bosses: dormant until the player is near (or hits it) -> short intro with the
 * name card (`minibossStart`) -> idle (move) / attack (windup -> active -> recover, optionally a
 * queue of follow-up swings) -> death with a big burst (`minibossDefeated`, one weapon + one skill drop).
 *
 * Every attack is telegraphed (windup pose + red flash/outline + floor markers from `drawMarkers`),
 * damage only exists from the active phase on. Knockback 0; hit-stun and freeze do not apply, only a
 * parry / stun briefly interrupts it. Subclasses supply the numbers, `chooseAttack`, `attackStep` and
 * the hooks; nothing here depends on frame counts of the sheet.
 */
export abstract class MiniBoss extends Actor {
  readonly spec: MiniBossSpec;
  readonly tier: number;
  /** damage multiplier of the tier (prison 1, ramparts 1.4) and the loop */
  dmgMult: number;

  state: MiniState = 'dormant';
  stateT = 0;
  /** name of the attack in progress (null while idle) */
  attack: string | null = null;
  /** recent attacks (never the same one 3x in a row) */
  history: string[] = [];
  started = false;
  defeatedEmitted = false;

  /** seconds until the next attack may be chosen */
  gapT = 1;
  protected time = 0;
  protected atk: AttackStep | null = null;
  /** follow-up swings of the current attack (combos) */
  protected queue: AttackStep[] = [];
  protected hitSet = new Set<number>();
  protected lockedFacing: 1 | -1 = 1;
  protected arenaL = 0;
  protected arenaR = 0;
  protected groundY = 0;
  protected walking = false;
  protected hurtT = 0;
  protected stunCd = 0;
  protected deathFxT = 0;
  protected minions: Actor[] = [];
  private stepT = 0;

  constructor(spec: MiniBossSpec, x: number, y: number, tier = 1) {
    super(x, y);
    this.spec = spec;
    this.tier = tier;
    this.dmgMult = tier >= 2 ? TIER2.dmg : 1;
    this.w = spec.w;
    this.h = spec.h;
    this.maxHp = this.hp = Math.round(spec.hp * (tier >= 2 ? TIER2.hp : 1));
    this.knockbackTaken = 0;
    this.alwaysActive = true;
    this.z = 10;
    this.bloodColor = spec.blood;
    this.facing = -1;
  }

  /** 'mb_abbess' ... (Entity.id is the numeric entity id) */
  get bossId(): MiniBossId {
    return this.spec.id;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet(this.spec.id));
    // 회차: stronger in every loop after the first
    const loop = this.world.run.loop;
    if (loop > 1) {
      this.maxHp = this.hp = Math.round(this.maxHp * loopHpMul(loop));
      this.dmgMult *= loopDmgMul(loop);
    }
    this.anim?.play('idle');
    this.groundY = this.y;
    this.scanArena();
  }

  // ------------------------------------------------------------ arena

  /**
   * The fighting area: the mid-boss room (minus its two doorways) when the level has one around the
   * boss, else the walls left and right of it.
   */
  protected scanArena(): void {
    const map = this.world.map;
    const room = this.world.level.rooms?.find((r) => r.tags.includes('miniboss') && this.x >= r.x * TILE && this.x < (r.x + r.w) * TILE && this.y > r.y * TILE && this.y <= (r.y + r.h) * TILE);
    if (room) {
      this.arenaL = (room.x + 4) * TILE;
      this.arenaR = (room.x + room.w - 4) * TILE;
      return;
    }
    let lx = this.x;
    let rx = this.x;
    while (lx > 0 && !map.solidAt(lx, this.y - 40)) lx -= TILE / 2;
    while (rx < map.pxW && !map.solidAt(rx, this.y - 40)) rx += TILE / 2;
    this.arenaL = (Math.floor(lx / TILE) + 1) * TILE;
    this.arenaR = Math.floor(rx / TILE) * TILE;
  }

  /** x clamped into the arena with `margin` px to the walls. */
  protected inArena(x: number, margin = 40): number {
    return clamp(x, this.arenaL + margin, this.arenaR - margin);
  }

  /** The arena rectangle (px), for markers and tests. */
  get arena(): { l: number; r: number; floor: number } {
    return { l: this.arenaL, r: this.arenaR, floor: this.groundY };
  }

  // ------------------------------------------------------------ subclass contract

  /** Pick the next attack name for the current situation (never called while the player cannot be hit). */
  protected abstract chooseAttack(p: Player): string;
  /** Timings of an attack (already scaled by `ws` / `rs`); `queue` may be filled for combos. */
  protected abstract attackStep(name: string, p: Player): AttackStep;
  /** Idle behaviour: face / walk / hover. Must call `this.anim.play(...)`. */
  protected moveIdle(dt: number, p: Player): void {
    this.walkIdle(dt, p, 60, 190);
  }
  /** Just after the windup started (aim, marker spots...). */
  protected onAttackBegin(_name: string, _p: Player): void {}
  protected windup(_name: string, dt: number, _p: Player): void {
    this.vx = approach(this.vx, 0, 1200 * dt);
  }
  protected activeStart(_name: string, _p: Player): void {}
  protected active(_name: string, dt: number, _p: Player): void {
    this.vx = approach(this.vx, 0, 900 * dt);
  }
  /** The active phase ends (also before a queued follow-up swing). */
  protected activeEnd(_name: string): void {}
  protected recover(_name: string, dt: number, _p: Player): void {
    this.vx = approach(this.vx, 0, 900 * dt);
  }
  /** The attack is over (recovered or interrupted): restore physics etc. */
  protected attackDone(_name: string): void {}
  /** A parry / stun cut the boss short in the air: let it come down. */
  protected onInterrupt(): void {
    this.physics = true;
  }
  /** Floor markers shown while winding up (`p` = 0..1). */
  protected drawMarkers(_ctx: CanvasRenderingContext2D, _p: number): void {}
  /** Overlay drawn above the sprite. */
  protected drawExtra(_ctx: CanvasRenderingContext2D): void {}
  /** Sprite opacity while alive (the witch fades out when she blinks). */
  protected drawAlpha(): number {
    return 1;
  }
  /** Names of every attack (tests / debug). */
  abstract get attackNames(): readonly string[];

  // ------------------------------------------------------------ derived

  get rage(): boolean {
    return this.hp <= this.maxHp * MB.rageAt;
  }
  /** windup multiplier (enraged = quicker) */
  protected get ws(): number {
    return this.rage ? 0.85 : 1;
  }
  protected get rs(): number {
    return this.rage ? 0.85 : 1;
  }
  protected dmg(base: number): number {
    return Math.max(1, Math.round(base * this.dmgMult));
  }
  /** Windup length (s) the boss would use right now for an attack (tests). */
  windupOf(name: string, p: Player = this.world.player): number {
    const q = this.queue;
    this.queue = [];
    const s = this.attackStep(name, p);
    this.queue = q;
    return s.w;
  }

  // ------------------------------------------------------------ damage

  protected intercept(_info: DamageInfo): DamageResult | null {
    if (this.state === 'dormant') {
      this.engage();
      return NO_HIT;
    }
    if (this.state === 'intro' || this.state === 'dying') return NO_HIT;
    return null;
  }

  protected onHurt(_info: DamageInfo, _amount: number): void {
    // a little flinch while it is just standing around; it never interrupts an attack
    if (this.state === 'idle' && _info.kind !== 'dot') this.hurtT = 0.16;
  }

  die(info: DamageInfo): void {
    super.die(info);
    const w = this.world;
    this.cancelAttack();
    this.attackDone(this.attack ?? '');
    this.attack = null;
    this.setState('dying');
    this.physics = true;
    this.gravityScale = 1;
    this.vx = 0;
    this.status.burn = this.status.bleed = 0;
    this.anim?.playFor('death', MB.deathTotal);
    w.addHitstop(0.25);
    w.shake(9, 0.6);
    w.fx.screenFlash('#ffffff', 0.2, 0.45);
    w.audio.play('boss_roar');
    w.audio.play('boss_slam');
    w.particles.emit('explosion', this.x, this.y - this.h * 0.6, { power: 1.6 });
    w.particles.emit('death', this.x, this.y - this.h * 0.6, { power: 1.6, count: 30 });
    // everything it conjured goes with it
    for (const m of this.minions) if (!m.dead && m.targetable) m.takeDamage({ amount: m.hp + 1, dir: 0, kind: 'hazard' });
    this.minions = [];
    this.clearConjured();
    w.emit({ type: 'enemyKilled', enemy: this, elite: true });
    this.dropRewards();
  }

  /** Remove projectiles / orbs the boss left behind. */
  protected clearConjured(): void {}

  /** Exactly one weapon and one skill (tier + 1, guaranteed affix), plus cells and gold. */
  protected dropRewards(): void {
    const w = this.world;
    const unlocked = w.game.save.unlocked;
    dropLoot(w, this.x, this.y - this.h * 0.5, { cells: w.rng.int(MB.cells[0], MB.cells[1]), gold: w.rng.int(MB.gold[0], MB.gold[1]), pieces: CORPSE.drop.miniboss });
    const tier = this.tier + 1;
    spawnItemDrop(w, this.x - 32, this.y - 30, rollItem(w.rng, tier, unlocked, 'weapon', { guaranteeAffix: true }));
    spawnItemDrop(w, this.x + 32, this.y - 30, rollItem(w.rng, tier, unlocked, 'skill', { guaranteeAffix: true }));
  }

  // ------------------------------------------------------------ state helpers

  protected setState(s: MiniState): void {
    this.state = s;
    this.stateT = 0;
  }

  protected faceToward(p: { x: number }): void {
    const d = p.x - this.x;
    if (Math.abs(d) > 4) this.facing = d > 0 ? 1 : -1;
  }

  /** Walk in `dir` unless a wall, a ledge or the arena edge is right there. */
  protected moveToward(dir: number, speed: number): boolean {
    const map = this.world.map;
    if (dir === 0) return false;
    const reach = this.w / 2 + 6;
    const ahead = this.x + dir * reach;
    if (map.solidAt(ahead, this.y - 20) || !groundUnder(this, map, dir * reach) || ahead < this.arenaL + 8 || ahead > this.arenaR - 8) {
      this.vx = 0;
      return false;
    }
    this.vx = dir * speed;
    return true;
  }

  /** Default idle: keep the player inside a preferred distance band. */
  protected walkIdle(dt: number, p: Player, near: number, far: number): void {
    if (p.targetable) this.faceToward(p);
    const dx = p.x - this.x;
    const d = Math.abs(dx);
    let moving = false;
    if (!p.targetable) this.vx = approach(this.vx, 0, 600 * dt);
    else if (d > far) moving = this.moveToward(sign(dx), this.spec.walk);
    else if (d < near) moving = this.moveToward(-sign(dx), this.spec.walk * 0.6);
    else this.vx = approach(this.vx, 0, 900 * dt);
    if (!moving && Math.abs(this.vx) < 1) this.vx = 0;
    this.walking = moving;
    this.anim?.play(moving ? 'walk' : 'idle');
  }

  protected stepSound(dt: number): void {
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = 0.5;
      this.world.audio.play('boss_step', { vol: 0.5 });
      this.world.shake(0.9, 0.1);
    }
  }

  protected liveMinions(): number {
    this.minions = this.minions.filter((m) => !m.dead && m.targetable);
    return this.minions.length;
  }

  /** Weighted choice that never repeats the same attack three times in a row. */
  protected pickAttack(cands: [string, number][]): string {
    const h = this.history;
    const ok = cands.filter(([n, wt]) => wt > 0 && !(h.length >= 2 && h[h.length - 1] === n && h[h.length - 2] === n));
    return this.world.rng.weighted(ok.length ? ok : cands, (c) => Math.max(0.001, c[1]))[0];
  }

  // ------------------------------------------------------------ main update

  update(dt: number): void {
    this.updateStatus(dt);
    // no hit-stun, no freeze; a parry / stun is the only thing that interrupts it (and is rationed)
    this.hitstun = 0;
    this.status.freeze = 0;
    if (this.stunCd > 0) {
      this.stunCd -= dt;
      this.status.stun = 0;
    }
    if (this.status.stun > MB.stunMax) this.status.stun = MB.stunMax;
    this.stateT += dt;
    this.time += dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.anim) this.anim.speed = 1;
    this.walking = false;
    const p = this.world.player;

    if (this.state === 'dying') {
      this.updateDying(dt);
      super.update(dt);
      return;
    }
    if (this.status.stun > 0 && this.state !== 'dormant' && this.state !== 'intro') this.stagger();

    switch (this.state) {
      case 'dormant':
        this.vx = 0;
        this.anim?.play('idle');
        if (p.targetable && Math.abs(p.x - this.x) < this.spec.activateRange && Math.abs(p.y - this.y) < 220) this.engage();
        break;
      case 'intro':
        this.vx = 0;
        this.anim?.play('idle');
        if (this.stateT >= MB.intro) {
          this.gapT = 0.7;
          this.setState('idle');
        }
        break;
      case 'idle':
        this.updateIdle(dt, p);
        break;
      case 'windup':
        this.windup(this.attack ?? '', dt, p);
        if (this.state === 'windup' && this.atk && this.stateT >= this.atk.w) {
          this.setState('active');
          this.hitSet = new Set();
          this.activeStart(this.attack ?? '', p);
        }
        break;
      case 'active':
        this.active(this.attack ?? '', dt, p);
        if (this.state === 'active' && this.atk && this.stateT >= this.atk.a) this.endActive();
        break;
      case 'recover':
        this.recover(this.attack ?? '', dt, p);
        if (this.state === 'recover' && this.atk && this.stateT >= this.atk.r) this.finishAttack();
        break;
      case 'stunned':
        this.vx = approach(this.vx, 0, 900 * dt);
        if (this.status.stun <= 0) {
          this.stunCd = MB.stunImmune;
          this.gapT = 0.5;
          this.setState('idle');
        }
        break;
      default:
        break;
    }
    if (this.walking) this.stepSound(dt);
    if (this.physics) this.x = clamp(this.x, this.arenaL + this.w / 2, this.arenaR - this.w / 2);
    super.update(dt);
  }

  // ------------------------------------------------------------ intro

  /** Wake up: name card (`minibossStart`), roar, a moment of invulnerability. */
  engage(): void {
    if (this.state !== 'dormant') return;
    const w = this.world;
    this.setState('intro');
    this.vx = 0;
    this.faceToward(w.player);
    w.audio.play('boss_roar', { vol: 0.8 });
    w.shake(4, 0.6);
    w.fx.ring(this.x, this.y - this.h * 0.5, { radius: 110, color: this.spec.light, life: 0.5 });
    w.particles.emit('dust', this.x, this.y, { count: 10, w: 80 });
    if (!this.started) {
      this.started = true;
      w.emit({ type: 'minibossStart', boss: this, name: this.spec.name });
    }
  }

  // ------------------------------------------------------------ idle / attacks

  private updateIdle(dt: number, p: Player): void {
    this.gapT -= dt;
    this.moveIdle(dt, p);
    if (this.hurtT > 0 && !this.walking) this.anim?.play('hurt');
    if (this.gapT <= 0 && p.targetable) this.startAttack(this.chooseAttack(p), p);
  }

  /** Public so tests can force a specific attack. */
  startAttack(name: string, p: Player = this.world.player): void {
    this.history.push(name);
    if (this.history.length > 6) this.history.shift();
    this.faceToward(p);
    this.lockedFacing = this.facing;
    this.vx = 0;
    this.queue = [];
    this.attack = name;
    const step = this.attackStep(name, p);
    this.beginSwing(step);
    this.onAttackBegin(name, p);
  }

  protected beginSwing(step: AttackStep): void {
    this.atk = step;
    this.setState('windup');
    this.hitSet = new Set();
    if (step.anim !== null) this.anim?.playPhased(step.anim ?? this.attack ?? 'idle', step.w, step.a, step.r);
    this.world.audio.play('telegraph');
  }

  private endActive(): void {
    const name = this.attack ?? '';
    this.activeEnd(name);
    if (this.state !== 'active') return;
    const next = this.queue.shift();
    if (next) {
      this.beginSwing(next);
      this.onChainStep();
      return;
    }
    this.setState('recover');
  }

  /** A follow-up swing of a combo just entered its windup. */
  protected onChainStep(): void {}

  protected finishAttack(): void {
    const name = this.attack ?? '';
    this.atk = null;
    this.attack = null;
    this.gapT = this.rage ? this.world.rng.range(0.35, 0.8) : this.world.rng.range(0.8, 1.4);
    this.setState('idle');
    this.attackDone(name);
  }

  protected cancelAttack(): void {
    this.atk = null;
    this.queue = [];
  }

  /** Skip the rest of the active phase (hit a wall, reached the target...). */
  protected endActiveNow(): void {
    if (this.state === 'active' && this.atk) this.stateT = this.atk.a;
  }

  /** Cut short by a parry / stun. */
  private stagger(): void {
    const name = this.attack ?? '';
    const was = this.state;
    this.cancelAttack();
    this.attack = null;
    this.setState('stunned');
    this.vx = 0;
    this.anim?.playFor('hurt', Math.max(0.3, this.status.stun));
    this.onInterrupt();
    if (was === 'windup' || was === 'active' || was === 'recover') this.attackDone(name);
    this.world.fx.text(this.x, this.y - this.h - 14, '기절!', '#ffd23f');
  }

  // ------------------------------------------------------------ death

  private updateDying(dt: number): void {
    const w = this.world;
    this.vx = approach(this.vx, 0, 700 * dt);
    this.deathFxT -= dt;
    if (this.deathFxT <= 0) {
      this.deathFxT = 0.12;
      const rx = this.x + w.rng.range(-this.w * 0.4, this.w * 0.4);
      const ry = this.y - w.rng.range(8, this.h);
      w.particles.emit(w.rng.chance(0.5) ? 'explosion' : 'death', rx, ry, { power: 0.8 + this.stateT * 0.4 });
      w.shake(2.5 + this.stateT * 1.5, 0.12);
      if (w.rng.chance(0.3)) w.audio.play('explosion', { vol: 0.4 });
    }
    if (!this.defeatedEmitted && this.stateT >= MB.deathAt) this.finishDying();
    if (this.stateT >= MB.deathTotal) {
      this.finishDying();
      this.dead = true;
    }
  }

  /** The big burst at the end of the death animation + the defeat event (once). */
  private finishDying(): void {
    if (this.defeatedEmitted) return;
    this.defeatedEmitted = true;
    const w = this.world;
    w.fx.screenFlash('#ffffff', 0.3, 0.6);
    w.shake(11, 0.7);
    w.audio.play('explosion');
    w.particles.emit('explosion', this.x, this.y - this.h * 0.55, { power: 2.4 });
    w.particles.emit('death', this.x, this.y - this.h * 0.55, { power: 2.4, count: 50 });
    w.fx.ring(this.x, this.y - this.h * 0.5, { radius: 150, color: this.spec.light, life: 0.5 });
    w.emit({ type: 'minibossDefeated', boss: this });
  }

  // ------------------------------------------------------------ drawing

  /** 0..1 through the current windup, or -1. */
  protected get telegraph(): number {
    if (this.state !== 'windup' || !this.atk) return -1;
    return clamp(this.stateT / Math.max(0.01, this.atk.w), 0, 1);
  }

  /** Is the boss telegraphing a hit? (windup of a damaging attack) */
  get telegraphing(): boolean {
    return this.telegraph >= 0;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.anim) return;
    const tele = this.telegraph;
    if (tele >= 0) this.drawMarkers(ctx, tele);
    let flash = 0;
    let flashColor = '#ffffff';
    if (this.flash > 0) flash = 1;
    else if (tele >= 0) {
      flash = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * (14 + 10 * tele)));
      flashColor = '#ff3b30';
    } else if (this.state === 'intro') {
      flash = 0.15 + 0.15 * Math.sin(this.time * 20);
      flashColor = '#ffcf9a';
    }
    const outline = tele >= 0 ? '#ff3b30' : this.rage && this.state !== 'dying' ? '#ff7a2a' : undefined;
    let alpha = this.drawAlpha();
    if (this.state === 'dying') alpha = clamp((MB.deathTotal - this.stateT) / 0.4, 0, 1);
    this.anim.draw(ctx, this.x, this.y, this.facing < 0, { flash, flashColor, outline, alpha });
    this.drawExtra(ctx);
    if (this.state === 'stunned') {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(Math.round(this.x + Math.cos(a) * 22) - 2, Math.round(this.y - this.h - 4 + Math.sin(a) * 5) - 2, 4, 4);
      }
    }
    if (tele >= 0) {
      warnBang(ctx, this.x, this.y - this.h - 10, this.time);
      this.world.lights.add(this.x, this.y - this.h * 0.55, 56, '#ff4a30', 0.3 + 0.5 * tele, 0.2);
    } else if (this.state !== 'dying') {
      this.world.lights.add(this.x + this.facing * 10, this.y - this.h * 0.8, 40, this.spec.light, this.state === 'intro' ? 1.2 : 0.7, 0.2);
    }
  }
}
