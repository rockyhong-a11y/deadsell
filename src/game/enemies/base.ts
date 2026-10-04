import { TILE } from '../../engine/config';
import { approach, clamp, sign } from '../../engine/math';
import { Actor } from '../entity';
import type { DamageInfo, DamageResult } from '../combat';
import type { Player } from '../player/player';
import { dropLoot, spawnItemDrop } from '../items/pickups';
import { rollItem } from '../items/items';
import { warnBang } from './telegraph';
import type { BaseKind, EnemyDef, EnemyKind } from './variants';
import { CORPSE, ELITE, LOOT, enemyDmgMul, enemyHpMul } from '../rules';

export type { BaseKind, EnemyKind } from './variants';

export interface EnemyOpts {
  /** 1 = prison, 2 = ramparts (scales hp/damage) */
  tier: number;
  elite: boolean;
}

export interface EnemySpec {
  hp: number;
  /** hitbox (unscaled) */
  w: number;
  h: number;
  patrol: number;
  chase: number;
  /** elite aura outline colour */
  aura: string;
  blood?: string;
}

export type EnemyState = 'patrol' | 'alert' | 'chase' | 'windup' | 'active' | 'recover' | 'cooldown' | 'hurt' | 'dying';

export const AGGRO_RANGE = 260;
export const ALERT_TIME = 0.4;
export const DEATH_TIME = 0.7;
/** Elites keep the stat boost and the aura but are NOT bigger (they are not mid-bosses). */
export const ELITE_SCALE = 1;

export interface AttackPlan {
  w: number;
  a: number;
  r: number;
}

/** A follow-up swing of a combo (see `queue`). */
export interface AttackStep extends AttackPlan {
  anim?: string;
}

/**
 * Common enemy brain: patrol → alert → chase → attack (windup → active → recover) → cooldown.
 * Subclasses override the do*() movement hooks and the attack hooks; the base owns timing,
 * hit-stun interruption, knockback, death, loot and the telegraph rendering.
 */
export abstract class Enemy extends Actor {
  /** type id (a base kind or a variant id); also the sheet name */
  readonly kind: EnemyKind;
  /** the base AI / fallback sheet */
  readonly base: BaseKind;
  /** variant table row, null for the six base types */
  readonly variant: EnemyDef | null;
  /** variant ability tag ('' for bases) */
  readonly ab: string;
  readonly tier: number;
  readonly elite: boolean;
  readonly spec: EnemySpec;
  /** damage multiplier (tier + elite + loop) */
  dmgMult: number;
  /** speed multiplier (elites are a bit faster) */
  readonly speedMult: number;
  /** draw scale (always 1: elites are not bigger) */
  readonly scale: number;

  state: EnemyState = 'patrol';
  stateT = 0;
  /** seconds until the next attack may start */
  attackCd = 0.6;
  /** idle pause after an attack (state 'cooldown') */
  protected cooldownPause = 0.35;
  protected atk: AttackPlan | null = null;
  protected hitSet = new Set<number>();
  protected homeX: number;
  protected patrolDir: 1 | -1 = 1;
  protected patrolPause = 0;
  protected patrolTimer = 0;
  protected lostT = 0;
  protected chaseT = 0;
  protected time = 0;
  /** distance within which the player is noticed */
  aggroRange = AGGRO_RANGE;
  /** follow-up swings of the current attack (combos); `endActive` starts the next one */
  protected queue: AttackStep[] = [];
  /** frontal guard: 'shield' blocks like the jailer's, 'parry' deflects the first hit after each attack */
  protected guard: 'shield' | 'parry' | null = null;
  protected parryReady = false;
  protected blockT = 0;
  protected textCd = 0;
  /** hits never push it (but they still interrupt) */
  protected kbImmune = false;
  /** self-destructed: no rewards */
  protected noLoot = false;
  /** outline colour while a variant runs on its base sheet (own sheet not built yet) */
  protected fallbackOutline: string | undefined;

  constructor(kind: BaseKind, x: number, y: number, opts: Partial<EnemyOpts>, spec: EnemySpec, variant: EnemyDef | null = null) {
    super(x, y);
    this.base = kind;
    this.variant = variant;
    this.kind = variant ? variant.id : kind;
    this.ab = variant?.ability ?? '';
    this.spec = spec;
    this.tier = opts.tier ?? 1;
    this.elite = !!opts.elite;
    this.scale = this.elite ? ELITE_SCALE : 1;
    this.w = Math.round(spec.w * this.scale);
    this.h = Math.round(spec.h * this.scale);
    this.maxHp = this.hp = Math.round(spec.hp * enemyHpMul(variant?.hp ?? 1, this.tier, this.elite));
    this.dmgMult = enemyDmgMul(variant?.dmg ?? 1, this.tier, this.elite);
    this.speedMult = (this.elite ? ELITE.speed : 1) * (variant?.speed ?? 1);
    this.knockbackTaken = this.elite ? ELITE.knockbackTaken : 1;
    if (spec.blood) this.bloodColor = spec.blood;
    this.homeX = x;
    this.patrolDir = x % 2 < 1 ? 1 : -1;
    this.facing = this.patrolDir;
    this.z = 10;
  }

  init(): void {
    const assets = this.world.assets;
    let sheet = assets.sheet(this.kind);
    if (this.variant && sheet.placeholder) {
      // own sheet not built yet: the base sheet with a hue-shifted outline, so it still reads differently
      sheet = assets.sheet(this.base);
      this.fallbackOutline = `hsl(${this.variant.hue}, 85%, 58%)`;
    }
    this.setSheet(sheet);
    // 회차: stronger in every loop after the first (the run knows which one it is)
    const loop = this.world.run.loop;
    if (loop > 1) {
      this.maxHp = this.hp = Math.round(this.spec.hp * enemyHpMul(this.variant?.hp ?? 1, this.tier, this.elite, loop));
      this.dmgMult = enemyDmgMul(this.variant?.dmg ?? 1, this.tier, this.elite, loop);
    }
    this.homeX = this.x;
    this.patrolTimer = this.world.rng.range(2, 5);
    this.anim?.play('idle');
  }

  // ------------------------------------------------------------ helpers

  /** Ability parameter from the variant table (`def` when the enemy is a base type). */
  protected pr(key: string, def = 0): number {
    return this.variant?.p[key] ?? def;
  }

  protected dmg(base: number): number {
    return Math.max(1, Math.round(base * this.dmgMult));
  }

  protected setState(s: EnemyState): void {
    this.state = s;
    this.stateT = 0;
  }

  protected get player(): Player {
    return this.world.player;
  }

  protected facePlayer(p: { x: number }): void {
    const d = p.x - this.x;
    if (Math.abs(d) > 2) this.facing = d > 0 ? 1 : -1;
  }

  /** Head position (for markers / "!" text). */
  protected get headY(): number {
    return this.y - this.h - 6;
  }

  /** Can this enemy notice the player right now? (range + line of sight) */
  protected sees(p: Player): boolean {
    if (!p.targetable) return false;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    if (Math.hypot(dx, dy * 1.2) > this.aggroRange) return false;
    return this.world.map.lineOfSight(this.x, this.y - this.h * 0.75, p.x, p.y - p.h * 0.6);
  }

  /**
   * Is the way ahead walkable? Blocked by a wall (taller than a hop) or by a drop deeper than `maxDrop` px.
   * Returns 'hop' if there is a one-tile step the walker can jump.
   */
  protected pathAhead(dir: number, maxDrop = 6): 'ok' | 'hop' | 'blocked' {
    const map = this.world.map;
    const ax = this.x + dir * (this.w / 2 + 3);
    let res: 'ok' | 'hop' = 'ok';
    if (map.solidAt(ax, this.y - 5)) {
      if (map.solidAt(ax, this.y - 5 - TILE) || map.solidAt(this.x, this.y - this.h - TILE + 6)) return 'blocked';
      res = 'hop';
    }
    if (this.onGround && res === 'ok' && map.floorBelow(ax, this.y + 1, maxDrop + 3) === null) return 'blocked';
    return res;
  }

  /** Walk in `dir` at `speed`; stops at walls/ledges (hops 1-tile steps if `hop`). Returns whether it moved. */
  protected walk(dir: number, speed: number, maxDrop = 6, hop = false): boolean {
    if (dir === 0) {
      this.vx = 0;
      return false;
    }
    const path = this.pathAhead(dir, maxDrop);
    if (path === 'blocked' || (path === 'hop' && !hop)) {
      this.vx = 0;
      return false;
    }
    if (path === 'hop' && this.onGround) this.vy = -330;
    this.vx = dir * speed;
    return true;
  }

  // ------------------------------------------------------------ update

  update(dt: number): void {
    if (this.textCd > 0) this.textCd -= dt;
    if (this.blockT > 0) this.blockT -= dt;
    this.updateStatus(dt);
    this.stateT += dt;
    this.time += dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.dying) {
      if (this.anim) this.anim.speed = 1;
      this.vx = approach(this.vx, 0, 700 * dt);
      if (this.stateT >= DEATH_TIME) this.dead = true;
      super.update(dt);
      return;
    }
    if (this.anim) this.anim.speed = this.status.freeze > 0 ? 0 : 1;
    if (this.incapacitated) {
      // stun / freeze / parry-stun applied without a hit still interrupts what we were doing
      if (this.state !== 'hurt') this.flinch();
      this.vx = approach(this.vx, 0, (this.onGround ? 900 : 200) * dt);
      this.whileIncapacitated(dt);
    } else {
      if (this.state === 'hurt') {
        this.setState('chase');
        this.attackCd = Math.max(this.attackCd, 0.5);
      }
      this.think(dt, this.player);
    }
    super.update(dt);
  }

  protected whileIncapacitated(_dt: number): void {}

  /** The state machine. */
  protected think(dt: number, p: Player): void {
    switch (this.state) {
      case 'patrol':
        this.doPatrol(dt, p);
        break;
      case 'alert':
        this.doAlert(dt, p);
        break;
      case 'chase':
        this.chaseT += dt;
        this.doChase(dt, p);
        break;
      case 'cooldown':
        this.doCooldown(dt, p);
        if (this.state === 'cooldown' && this.stateT >= this.cooldownPause) this.setState('chase');
        break;
      case 'windup':
        this.onWindup(dt, p);
        if (this.state === 'windup' && this.atk && this.stateT >= this.atk.w) {
          this.setState('active');
          this.hitSet.clear();
          this.onActiveStart(p);
        }
        break;
      case 'active':
        this.onActive(dt, p);
        if (this.state === 'active' && this.atk && this.stateT >= this.atk.a) this.endActive();
        break;
      case 'recover':
        this.onRecover(dt, p);
        if (this.state === 'recover' && this.atk && this.stateT >= this.atk.r) this.finishAttack();
        break;
      default:
        break;
    }
  }

  // ---- states

  protected doPatrol(dt: number, p: Player): void {
    if (this.sees(p)) {
      this.notice(p);
      return;
    }
    this.patrolTimer -= dt;
    if (this.patrolPause > 0) {
      this.patrolPause -= dt;
      this.vx = 0;
      this.play('idle');
      return;
    }
    if (this.patrolTimer <= 0) {
      this.patrolTimer = this.world.rng.range(3, 6);
      if (this.world.rng.chance(0.5)) {
        this.patrolPause = this.world.rng.range(0.8, 1.6);
        return;
      }
    }
    const away = Math.abs(this.x - this.homeX) > 110 && sign(this.x - this.homeX) === this.patrolDir;
    if (away || this.pathAhead(this.patrolDir, 6) !== 'ok') {
      this.patrolDir = this.patrolDir > 0 ? -1 : 1;
      this.patrolPause = this.world.rng.range(0.5, 1.2);
      this.vx = 0;
      return;
    }
    this.facing = this.patrolDir;
    this.vx = this.patrolDir * this.spec.patrol * this.speedMult;
    this.play('walk');
  }

  /** Switch to alert: "!" above the head + telegraph sound. */
  protected notice(p: { x: number }): void {
    this.setState('alert');
    this.vx = 0;
    this.facePlayer(p);
    this.world.fx.text(this.x, this.headY, '!', '#ff4a3a');
    this.world.audio.play('telegraph', { vol: 0.7 });
    this.onNotice();
  }

  protected onNotice(): void {}

  protected doAlert(_dt: number, p: Player): void {
    this.vx = 0;
    this.facePlayer(p);
    this.play('idle');
    if (this.stateT >= ALERT_TIME) {
      this.setState('chase');
      this.chaseT = 0;
      this.lostT = 0;
    }
  }

  /** Default chase: walk at the player and attack when `shouldAttack` says so. */
  protected doChase(dt: number, p: Player): void {
    if (!this.trackTarget(dt, p)) return;
    this.facePlayer(p);
    if (this.attackCd <= 0 && this.shouldAttack(p)) {
      this.startAttack(p);
      return;
    }
    this.chaseMove(dt, p);
  }

  /** Keeps `lostT`; returns false (and drops back to patrol) when the target was lost for good. */
  protected trackTarget(dt: number, p: Player): boolean {
    if (this.sees(p)) this.lostT = 0;
    else {
      this.lostT += dt;
      if (this.lostT > 4 || !p.targetable) {
        this.setState('patrol');
        this.homeX = this.x;
        this.vx = 0;
        return false;
      }
    }
    return true;
  }

  protected chaseMove(_dt: number, p: Player): void {
    const dx = p.x - this.x;
    const speed = this.spec.chase * this.speedMult;
    if (Math.abs(dx) > 6 && this.walk(sign(dx), speed, TILE * 2, true)) this.play('walk');
    else this.play('idle');
  }

  protected doCooldown(_dt: number, _p: Player): void {
    this.vx = approach(this.vx, 0, 600 * _dt);
    this.play('idle');
  }

  protected shouldAttack(_p: Player): boolean {
    return false;
  }

  protected startAttack(_p: Player): void {}

  // ---- attack framework

  /** Begin windup. `anim` (optional) plays the sheet's windup/active/recover frames stretched over the timings. */
  protected beginAttack(w: number, a: number, r: number, anim?: string): void {
    this.atk = { w, a, r };
    this.setState('windup');
    this.hitSet = new Set();
    this.vx = 0;
    if (anim) this.anim?.playPhased(anim, w, a, r);
  }

  protected endActive(): void {
    if (!this.atk) return;
    const next = this.queue.shift();
    if (next) {
      // combo: straight into the next swing's windup
      this.beginAttack(next.w, next.a, next.r, next.anim);
      this.onChainStep();
      return;
    }
    this.setState('recover');
    this.onRecoverStart();
  }

  protected finishAttack(): void {
    this.atk = null;
    this.setState('cooldown');
    if (this.guard === 'parry') this.parryReady = true;
    this.onAttackDone();
  }

  protected cancelAttack(): void {
    this.atk = null;
    this.queue.length = 0;
  }

  /** A follow-up swing of a combo just entered its windup. */
  protected onChainStep(): void {}
  /** The whole attack (all swings and the recovery) is over. */
  protected onAttackDone(): void {}

  /**
   * Teleport to column `tx` if there is room and floor there (within a step of the current level).
   * Returns whether it blinked. Used by the wraith ghoul and the shadow archer.
   */
  protected blinkTo(tx: number, color = '#9fe9ff'): boolean {
    const map = this.world.map;
    const fy = map.floorBelow(tx, this.y - TILE, TILE * 2.5);
    if (fy === null || fy < this.y - TILE || fy > this.y + TILE) return false;
    if (map.boxSolid({ x: tx - this.w / 2, y: fy - this.h, w: this.w, h: this.h - 1 })) return false;
    const w = this.world;
    w.particles.emit('magic', this.x, this.cy, { count: 8, color });
    w.fx.ring(this.x, this.cy, { radius: 16, color, life: 0.22 });
    this.x = tx;
    this.y = fy;
    this.vx = 0;
    this.vy = 0;
    w.particles.emit('magic', this.x, this.cy, { count: 8, color });
    w.fx.ring(this.x, this.cy, { radius: 20, color, life: 0.28 });
    w.audio.play('roll', { vol: 0.5, pitch: 1.5 });
    return true;
  }

  protected onWindup(_dt: number, _p: Player): void {
    this.vx = approach(this.vx, 0, 900 * _dt);
  }
  protected onActiveStart(_p: Player): void {}
  protected onActive(_dt: number, _p: Player): void {}
  protected onRecoverStart(): void {}
  protected onRecover(dt: number, _p: Player): void {
    this.vx = approach(this.vx, 0, 900 * dt);
  }

  /** 0..1 through the windup, or -1 when not telegraphing. */
  protected get telegraph(): number {
    if (this.state !== 'windup' || !this.atk) return -1;
    return clamp(this.stateT / this.atk.w, 0, 1);
  }

  // ---- damage

  protected onHurt(_info: DamageInfo, _amount: number): void {
    // knockback-immune types (wraith) are not pushed, but a hit still staggers them briefly
    if (this.kbImmune && _info.kind !== 'dot') this.hitstun = Math.max(this.hitstun, Math.min(0.25, _info.hitstun ?? 0.18));
    // elites have super armour while the attack is live
    if (this.elite && this.state === 'active' && this.status.stun <= 0 && this.status.freeze <= 0) {
      this.hitstun = 0;
      return;
    }
    if (!this.incapacitated) {
      // a hit with no hit-stun still wakes the enemy up
      if (this.state === 'patrol' || this.state === 'alert') this.setState('chase');
      return;
    }
    this.flinch();
  }

  /** Interrupt whatever we were doing and play the hurt animation. */
  protected flinch(): void {
    this.cancelAttack();
    this.setState('hurt');
    this.anim?.playFor('hurt', Math.max(0.2, this.hitstun, this.status.stun, this.status.freeze));
    this.attackCd = Math.max(this.attackCd, 0.6);
    this.lostT = 0;
    this.onFlinch();
  }

  protected onFlinch(): void {}

  // ---- frontal guard (jailer / paladin shield, duelist parry)

  /** Is the guard up (able to block) right now? */
  get shieldUp(): boolean {
    if (!this.guard || this.dying || this.incapacitated) return false;
    if (this.guard === 'parry') return this.parryReady && this.state !== 'windup' && this.state !== 'active' && this.state !== 'recover';
    return this.state !== 'active' && this.state !== 'recover' && this.state !== 'hurt';
  }

  protected attackerInFront(info: DamageInfo): boolean {
    if (info.dir) return info.dir === -this.facing;
    if (info.source) return (info.source.x - this.x) * this.facing > 0;
    return false;
  }

  protected intercept(info: DamageInfo): DamageResult | null {
    if (!this.guard || !this.shieldUp || info.unblockable) return null;
    if (info.kind === 'dot' || info.kind === 'explosion' || info.kind === 'trap' || info.kind === 'hazard') return null;
    if (!this.attackerInFront(info)) return null;
    const w = this.world;
    const parry = this.guard === 'parry';
    this.blockT = 0.22;
    this.flash = 0;
    const sx = this.x + this.facing * (this.w / 2 + 3);
    const sy = this.y - this.h * 0.55;
    w.particles.emit(parry ? 'parry' : 'spark', sx, sy, { dir: this.facing, count: 7 });
    w.audio.play(parry ? 'parry' : 'block');
    if (this.textCd <= 0) {
      w.fx.text(this.x, this.headY, parry ? '쳐냄' : '막힘', parry ? '#ffe9a8' : '#c9d6e8');
      this.textCd = 0.3;
    }
    if (parry) this.parryReady = false;
    else if (this.state !== 'windup' && this.anim?.sheet.has('block')) this.anim.playFor('block', 0.22);
    // pushback: the guard slides back a little, the attacker is nudged away
    if (this.onGround) this.vx = -this.facing * (parry ? 40 : 70);
    if (info.source && info.source !== this) info.source.vx = this.facing * 130;
    return { applied: false, amount: 0, killed: false, blocked: true };
  }

  protected play(name: string): void {
    // keep the block pose for its short duration instead of snapping back to walk/idle
    if (this.blockT > 0 && this.anim?.name === 'block' && (name === 'idle' || name === 'walk')) return;
    this.anim?.play(name);
  }

  die(info: DamageInfo): void {
    super.die(info);
    this.cancelAttack();
    this.setState('dying');
    this.anim?.playFor('death', DEATH_TIME);
    const w = this.world;
    w.particles.emit('death', this.x, this.cy, { dir: info.dir });
    w.audio.play('enemy_death');
    w.emit({ type: 'enemyKilled', enemy: this, elite: this.elite });
    this.dropRewards();
  }

  protected dropRewards(): void {
    if (this.noLoot) return;
    const w = this.world;
    const L = LOOT.enemy;
    const mult = this.elite ? L.eliteMult : 1;
    dropLoot(w, this.x, this.y - this.h / 2, {
      cells: w.rng.int(L.cells[0], L.cells[1]) * mult,
      gold: w.rng.int(L.gold[0], L.gold[1]) * mult,
      pieces: this.elite ? CORPSE.drop.elite : CORPSE.drop.enemy,
    });
    if (this.elite && w.rng.chance(L.eliteItemChance)) {
      spawnItemDrop(w, this.x, this.y - 10, rollItem(w.rng, w.run.tier, w.game.save.unlocked));
    }
  }

  // ------------------------------------------------------------ drawing

  /** Ground / area markers drawn under the sprite while winding up. */
  protected drawTelegraph(_ctx: CanvasRenderingContext2D, _p: number): void {}

  /** Extra overlay drawn above the sprite (aim lines etc.) at any time. */
  protected drawOverlay(_ctx: CanvasRenderingContext2D): void {}

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.anim) return;
    const tele = this.telegraph;
    if (tele >= 0) this.drawTelegraph(ctx, tele);
    const frozen = this.status.freeze > 0;
    let flash = 0;
    let flashColor = '#ffffff';
    if (this.flash > 0) flash = 1;
    else if (frozen) {
      flash = 0.45;
      flashColor = '#8fe3ff';
    } else if (tele >= 0) {
      flash = 0.18 + 0.4 * (0.5 + 0.5 * Math.sin(this.time * (14 + 10 * tele)));
      flashColor = '#ff3b30';
    }
    const outline = tele >= 0 ? '#ff3b30' : this.elite ? this.spec.aura : this.fallbackOutline;
    let alpha = 1;
    if (this.dying) alpha = clamp((DEATH_TIME - this.stateT) / 0.3, 0, 1);
    this.anim.draw(ctx, this.x, this.y, this.facing < 0, { flash, flashColor, scale: this.scale, outline, alpha });
    this.drawOverlay(ctx);
    if (tele >= 0) {
      warnBang(ctx, this.x, this.headY - 2, this.time);
      this.world.lights.add(this.x, this.cy, 46, '#ff4a30', 0.25 + 0.5 * tele, 0.2);
    } else if (this.elite && !this.dying) {
      this.world.lights.add(this.x, this.cy, 44, this.spec.aura, 0.35);
    }
  }
}
