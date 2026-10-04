import { GRAVITY, MAX_FALL } from '../engine/config';
import type { AABB } from '../engine/math';
import { AnimPlayer, type SpriteSheet } from '../engine/assets';
import { moveBody, type Body } from './physics';
import type { World } from './world';
import type { DamageInfo, DamageResult, Team } from './combat';
import { AFFIX } from './rules';

let nextId = 1;

/**
 * Base entity. Position (x, y) is the centre-bottom of its box (= sprite anchor).
 * Lifecycle: world.spawn(e) → e.init() once → e.update(dt) every step → e.draw(ctx) every frame.
 * Set `dead = true` to have the world remove it.
 */
export abstract class Entity implements Body {
  readonly id = nextId++;
  world!: World;
  x = 0;
  y = 0;
  w = 16;
  h = 16;
  vx = 0;
  vy = 0;
  onGround = false;
  onPlatform = false;
  hitWallX = 0;
  hitCeiling = false;
  dropThrough = false;
  noClip = false;
  facing: 1 | -1 = 1;
  dead = false;
  /** draw order: lower first. Props 0, pickups 5, enemies 10, player 20, projectiles 30 */
  z = 10;
  /** apply gravity + tile collision in the default update */
  physics = true;
  gravityScale = 1;
  /** keep updating even when far off screen */
  alwaysActive = false;
  anim: AnimPlayer | null = null;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /** Called once when spawned into a world. */
  init(): void {}

  update(dt: number): void {
    if (this.physics) this.stepPhysics(dt);
    this.anim?.update(dt);
  }

  stepPhysics(dt: number): void {
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * this.gravityScale * dt);
    moveBody(this, this.world.map, dt);
  }

  abstract draw(ctx: CanvasRenderingContext2D): void;

  setSheet(sheet: SpriteSheet): void {
    this.anim = new AnimPlayer(sheet);
  }

  get bounds(): AABB {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }
  get cx(): number {
    return this.x;
  }
  get cy(): number {
    return this.y - this.h / 2;
  }

  /** Called when removed from the world. */
  onRemove(): void {}
}

/** Status effects shared by everything that can be hurt. */
export interface Status {
  burn: number; // seconds left
  burnDps: number;
  bleed: number; // seconds left
  bleedStacks: number;
  freeze: number; // seconds left (no actions)
  stun: number; // seconds left (no actions)
  dotTimer: number;
}

/** Something with HP that participates in combat. */
export abstract class Actor extends Entity {
  team: Team = 'enemy';
  hp = 10;
  maxHp = 10;
  /** seconds of invulnerability left */
  invuln = 0;
  /** seconds of white hit-flash left */
  flash = 0;
  /** seconds of hit-stun left (actions interrupted) */
  hitstun = 0;
  /** 1 = full knockback, 0 = immovable */
  knockbackTaken = 1;
  /** playing a death animation: not targetable, removed when it finishes */
  dying = false;
  status: Status = { burn: 0, burnDps: 0, bleed: 0, bleedStacks: 0, freeze: 0, stun: 0, dotTimer: 0 };

  /** Can be hit right now? */
  get targetable(): boolean {
    return !this.dead && !this.dying;
  }

  /** The box attacks test against (defaults to the body box). */
  hurtbox(): AABB {
    return this.bounds;
  }

  /** Frozen/stunned/hit-stunned actors take no actions. */
  get incapacitated(): boolean {
    return this.status.freeze > 0 || this.status.stun > 0 || this.hitstun > 0;
  }

  /**
   * Chance for subclasses to block/parry/modify an incoming hit.
   * Return null to take it normally, or a result to short-circuit.
   */
  protected intercept(_info: DamageInfo): DamageResult | null {
    return null;
  }

  /** Apply damage. All damage in the game goes through here. */
  takeDamage(info: DamageInfo): DamageResult {
    if (!this.targetable || (this.invuln > 0 && info.kind !== 'dot')) return { applied: false, amount: 0, killed: false };
    const pre = this.intercept(info);
    if (pre) return pre;
    const amount = Math.max(1, Math.round(info.amount));
    this.hp -= amount;
    const w = this.world;
    if (info.kind !== 'dot') {
      this.flash = 0.12;
      const kb = (info.knockback ?? 0) * this.knockbackTaken;
      if (kb && info.dir) {
        this.vx = info.dir * kb;
        this.facing = info.dir > 0 ? -1 : 1;
      }
      if (info.knockup && this.knockbackTaken > 0) this.vy = -info.knockup * this.knockbackTaken;
      if (info.stun) this.status.stun = Math.max(this.status.stun, info.stun);
      const hs = info.hitstun ?? 0.18;
      if (hs > 0) this.hitstun = Math.max(this.hitstun, hs * this.knockbackTaken);
    }
    if (info.burn) {
      this.status.burn = Math.max(this.status.burn, info.burn);
      this.status.burnDps = Math.max(this.status.burnDps, info.burnDps ?? 6);
    }
    if (info.bleed) {
      this.status.bleed = Math.max(this.status.bleed, info.bleed);
      this.status.bleedStacks = Math.min(AFFIX.bleedStacks, this.status.bleedStacks + 1);
    }
    if (info.freeze) this.status.freeze = Math.max(this.status.freeze, info.freeze);
    w.fx.damageNumber(this.x, this.y - this.h - 4, amount, info);
    if (info.kind !== 'dot') w.particles.emit('hit', this.x, this.y - this.h * 0.55, { dir: info.dir, color: this.bloodColor });
    const killed = this.hp <= 0;
    if (killed) {
      this.hp = 0;
      this.die(info);
    } else this.onHurt(info, amount);
    return { applied: true, amount, killed };
  }

  /** colour of hit particles */
  bloodColor = '#c8324a';

  protected onHurt(_info: DamageInfo, _amount: number): void {}

  /** Default death: flag dying; subclasses play an animation and set dead when done. */
  die(_info: DamageInfo): void {
    this.dying = true;
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  /** Tick timers + damage over time. Call from subclasses' update(). */
  updateStatus(dt: number): void {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.hitstun > 0) this.hitstun -= dt;
    const s = this.status;
    if (s.freeze > 0) s.freeze -= dt;
    if (s.stun > 0) s.stun -= dt;
    if (s.burn > 0 || s.bleed > 0) {
      s.dotTimer += dt;
      if (s.dotTimer >= 0.5) {
        s.dotTimer -= 0.5;
        let dmg = 0;
        if (s.burn > 0) dmg += s.burnDps * 0.5;
        if (s.bleed > 0) dmg += 2.5 * s.bleedStacks * 0.5;
        if (dmg > 0 && this.targetable) {
          this.takeDamage({ amount: dmg, kind: 'dot', dir: 0, dotType: s.burn > 0 ? 'burn' : 'bleed' });
        }
      }
      if (s.burn > 0) {
        s.burn -= dt;
        if (Math.random() < dt * 20) this.world.particles.emit('fire', this.x + (Math.random() - 0.5) * this.w, this.y - Math.random() * this.h, {});
      }
      if (s.bleed > 0) {
        s.bleed -= dt;
        if (s.bleed <= 0) s.bleedStacks = 0;
      }
    } else s.dotTimer = 0;
  }

  /** Standard sprite draw with hit flash and status tints. */
  drawSprite(ctx: CanvasRenderingContext2D, opts: { scale?: number; outline?: string; alpha?: number } = {}): void {
    if (!this.anim) return;
    const frozen = this.status.freeze > 0;
    this.anim.draw(ctx, this.x, this.y, this.facing < 0, {
      flash: this.flash > 0 ? 1 : frozen ? 0.45 : 0,
      flashColor: this.flash > 0 ? '#ffffff' : '#8fe3ff',
      scale: opts.scale,
      outline: opts.outline,
      alpha: opts.alpha,
    });
  }
}
