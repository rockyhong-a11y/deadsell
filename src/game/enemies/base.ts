import { TILE } from '../../engine/config';
import { approach, clamp, sign } from '../../engine/math';
import { Actor } from '../entity';
import type { DamageInfo } from '../combat';
import type { Player } from '../player/player';
import { dropLoot, spawnItemDrop } from '../items/pickups';
import { rollItem } from '../items/items';
import { warnBang } from './telegraph';

export type EnemyKind = 'ghoul' | 'jailer' | 'archer' | 'bomber' | 'harpy' | 'lancer';

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
export const ELITE_SCALE = 1.3;

export interface AttackPlan {
  w: number;
  a: number;
  r: number;
}

/**
 * Common enemy brain: patrol → alert → chase → attack (windup → active → recover) → cooldown.
 * Subclasses override the do*() movement hooks and the attack hooks; the base owns timing,
 * hit-stun interruption, knockback, death, loot and the telegraph rendering.
 */
export abstract class Enemy extends Actor {
  readonly kind: EnemyKind;
  readonly tier: number;
  readonly elite: boolean;
  readonly spec: EnemySpec;
  /** damage multiplier (tier + elite) */
  readonly dmgMult: number;
  /** speed multiplier (elites are a bit faster) */
  readonly speedMult: number;
  /** draw scale (elite 1.3) */
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

  constructor(kind: EnemyKind, x: number, y: number, opts: Partial<EnemyOpts>, spec: EnemySpec) {
    super(x, y);
    this.kind = kind;
    this.spec = spec;
    this.tier = opts.tier ?? 1;
    this.elite = !!opts.elite;
    this.scale = this.elite ? ELITE_SCALE : 1;
    this.w = Math.round(spec.w * this.scale);
    this.h = Math.round(spec.h * this.scale);
    const hpMul = (this.tier >= 2 ? 1.6 : 1) * (this.elite ? 3 : 1);
    this.maxHp = this.hp = Math.round(spec.hp * hpMul);
    this.dmgMult = (this.tier >= 2 ? 1.4 : 1) * (this.elite ? 1.25 : 1);
    this.speedMult = this.elite ? 1.15 : 1;
    this.knockbackTaken = this.elite ? 0.5 : 1;
    if (spec.blood) this.bloodColor = spec.blood;
    this.homeX = x;
    this.patrolDir = x % 2 < 1 ? 1 : -1;
    this.facing = this.patrolDir;
    this.z = 10;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet(this.kind));
    this.homeX = this.x;
    this.patrolTimer = this.world.rng.range(2, 5);
    this.anim?.play('idle');
  }

  // ------------------------------------------------------------ helpers

  protected dmg(base: number): number {
    return Math.max(1, Math.round(base * this.dmgMult));
  }

  protected setState(s: EnemyState): void {
    this.state = s;
    this.stateT = 0;
  }

  protected play(name: string): void {
    this.anim?.play(name);
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
    this.setState('recover');
    this.onRecoverStart();
  }

  protected finishAttack(): void {
    this.atk = null;
    this.setState('cooldown');
  }

  protected cancelAttack(): void {
    this.atk = null;
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
    const w = this.world;
    const mult = this.elite ? 4 : 1;
    dropLoot(w, this.x, this.y - this.h / 2, { cells: w.rng.int(1, 2) * mult, gold: w.rng.int(2, 6) * mult });
    if (this.elite && w.rng.chance(0.5)) {
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
    const outline = tele >= 0 ? '#ff3b30' : this.elite ? this.spec.aura : undefined;
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
