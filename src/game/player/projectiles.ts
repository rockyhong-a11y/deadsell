import { Entity } from '../entity';
import type { Actor } from '../entity';
import { hitArea, type DamageInfo, type HitReport } from '../combat';
import type { ItemInstance } from '../items/types';
import type { Player } from './player';
import { moveBody } from '../physics';
import { GRAVITY, MAX_FALL, TILE } from '../../engine/config';
import { approach, overlaps, type AABB } from '../../engine/math';
import type { Sfx } from '../../engine/audio';
import type { ParticlePreset } from '../fx/particles';
import { Arrow as EnemyArrow, Bolt, Bomb, circleHitsBox } from '../enemies/projectiles';
import { WebBlob } from '../miniboss/hazards';
import { AFFIX } from '../rules';

/** How a hit should feel (hit-stop seconds, camera shake, sfx, and the sfx volume when it should be quiet: a flame ticks many times a second). */
export interface Feel { hitstop: number; shake: number; sfx?: Sfx; vol?: number }

export const sgn = (v: number) => (v < 0 ? -1 : 1);
/** unique items (docs/CONTENT3.md §5): bone-white outline / sparks */
const BONE = '#f0e6d2';

// ---------------------------------------------------------------------------
/**
 * What sets a shot apart from the plain arrow: it pierces every enemy in its path (골수 활: each is hit once), vanishes after `range` px
 * (중석궁), is drawn with an `outline` colour and `scale` (서리 활, 중석궁) or as a spinning `knife` (투척 단검), or bursts into soul fire
 * where it lands (혼불 활: `burst` = radius px, damage base, burn seconds).
 */
export interface ArrowOpts { pierce?: boolean; range?: number; outline?: string; scale?: number; knife?: boolean; burst?: { radius: number; base: number; burn: number } }

/** Arrow shot by the heroine or her turret: hits the first enemy, sticks in walls (see `ArrowOpts`). */
export class Arrow extends Entity {
  z = 30;
  physics = false;
  alwaysActive = true;
  private life = 1.6;
  private stuck = 0;
  private ang: number;
  private spin = 0;
  private burst = false;
  private readonly pierced: Set<number> | undefined;

  constructor(
    x: number, y: number, vx: number, vy: number,
    readonly owner: Player, readonly item: ItemInstance, readonly info: DamageInfo, readonly feel: Feel,
    readonly opts: ArrowOpts = {},
  ) {
    super(x, y);
    this.w = 6;
    this.h = 6;
    this.vx = vx;
    this.vy = vy;
    this.ang = Math.atan2(vy, vx);
    this.facing = sgn(vx);
    this.pierced = opts.pierce ? new Set<number>() : undefined;
    if (opts.range) this.life = opts.range / (Math.hypot(vx, vy) || 1);
  }

  get bounds() {
    return { x: this.x - 3, y: this.y - 3, w: 6, h: 6 };
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.play('arrow');
  }

  update(dt: number): void {
    if (this.stuck > 0) {
      this.stuck -= dt;
      if (this.stuck <= 0) this.dead = true;
      return;
    }
    this.life -= dt;
    this.spin += dt * 32;
    if (this.life <= 0) {
      this.dead = true;
      return;
    }
    const w = this.world;
    const n = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 5));
    for (let i = 0; i < n; i++) {
      this.x += (this.vx * dt) / n;
      this.y += (this.vy * dt) / n;
      if (w.map.solidAt(this.x, this.y)) {
        this.stuck = 0.45;
        this.vx = this.vy = 0;
        w.particles.emit('spark', this.x, this.y, { dir: -Math.cos(this.ang) > 0 ? 1 : -1, count: 4 });
        w.audio.play('arrow_hit', { vol: 0.5 });
        this.soulBurst();
        return;
      }
      const reports = hitArea(w, this.bounds, 'player', this.info, this.pierced);
      if (reports.length) {
        for (const r of reports) {
          this.owner.onDealt(r, this.item, this.info, { sfx: 'arrow_hit', ...this.feel });
          if (this.info.freeze && r.result.applied) w.particles.emit('ice', r.target.x, r.target.cy, { count: 6 });
        }
        if (!this.opts.pierce) {
          this.dead = true;
          this.soulBurst();
          return;
        }
      }
    }
  }

  /** a soul fire arrow bursts once, where it hit something or stuck in a wall */
  private soulBurst(): void {
    const b = this.opts.burst;
    if (!b || this.burst) return;
    this.burst = true;
    explode(this.owner, this.item, this.x, this.y, { radius: b.radius, base: b.base, kind: 'soul', extra: { burn: b.burn, burnDps: AFFIX.burnDps } });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const o = this.opts;
    const alpha = this.stuck > 0 ? Math.min(1, this.stuck * 4) : 1;
    if (o.knife) {
      // a small steel blade tumbling end over end
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(this.x), Math.round(this.y));
      ctx.rotate(this.stuck > 0 ? this.ang : this.ang + this.spin);
      ctx.fillStyle = '#120a1a';
      ctx.fillRect(-6, -3, 12, 6);
      ctx.fillStyle = '#e8f4ff';
      ctx.beginPath();
      ctx.moveTo(-1, -2);
      ctx.lineTo(7, 0);
      ctx.lineTo(-1, 2);
      ctx.fill();
      ctx.fillStyle = '#7a1f2a';
      ctx.fillRect(-6, -1, 5, 2);
      ctx.restore();
      return;
    }
    this.anim?.draw(ctx, this.x, this.y, false, { rotation: this.ang, alpha, outline: o.outline ?? (o.pierce ? BONE : undefined), scale: o.scale });
    if (o.outline && this.stuck <= 0) this.world.lights.add(this.x, this.y, 20, o.outline, 0.5);
  }
}

// ---------------------------------------------------------------------------
/** Short-lived light/glow burst (explosions). */
class Glow extends Entity {
  z = 31;
  physics = false;
  private t = 0;
  constructor(x: number, y: number, private r: number, private color: string, private life = 0.4) {
    super(x, y);
  }
  update(dt: number): void {
    this.t += dt;
    if (this.t >= this.life) this.dead = true;
  }
  draw(): void {
    const k = 1 - this.t / this.life;
    this.world.lights.add(this.x, this.y, this.r * (1.2 + 0.6 * (1 - k)), this.color, 1.2 * k);
  }
}

/** Grenade numbers (shown in the codex): blast radius, burn (fire) / freeze (ice) seconds. */
export const GRENADE = {
  fire: { radius: 40, burn: 4, burnDps: 6 },
  ice: { radius: 60, freeze: 3 },
} as const;

/** Every kind of blast `explode` makes. */
export type BlastKind = 'fire' | 'ice' | 'corpse' | 'stun' | 'magnet' | 'cluster' | 'wave' | 'toll' | 'soul' | 'death';

export interface ExplosionOpts {
  radius: number;
  base: number;
  kind: BlastKind;
  /** added to what every enemy in the blast takes (섬광탄: the stun; 거부의 파동: the knockback) */
  extra?: Partial<DamageInfo>;
  /** enemies (ids) it must not hit, and that it adds the ones it hits to (장례 종: a swing's rings hurt each enemy once) */
  already?: Set<number>;
}

/** How each blast hits (knockback / knock-up, status) and how it looks and sounds. */
const BLAST: Record<BlastKind, {
  knockback: number; knockup: number; hit?: Partial<DamageInfo>;
  particle: ParticlePreset; count: number; ring: string; glow: string; shake: number; sfx: Sfx; flash?: string; debris?: string;
}> = {
  fire: { knockback: 170, knockup: 140, hit: { burn: GRENADE.fire.burn, burnDps: GRENADE.fire.burnDps }, particle: 'explosion', count: 28, ring: '#ffb347', glow: '#ff8a3c', shake: 4, sfx: 'explosion' },
  corpse: { knockback: 150, knockup: 120, particle: 'explosion', count: 28, ring: BONE, glow: '#ff6a5a', shake: 4, sfx: 'explosion', debris: BONE },
  ice: { knockback: 60, knockup: 0, hit: { freeze: GRENADE.ice.freeze, hitstun: 0 }, particle: 'ice', count: 22, ring: '#9fe8ff', glow: '#8fe3ff', shake: 2.5, sfx: 'freeze', flash: '#bfefff' },
  stun: { knockback: 40, knockup: 0, particle: 'spark', count: 26, ring: '#fff3a0', glow: '#fff3a0', shake: 2, sfx: 'explosion', flash: '#ffffff' },
  magnet: { knockback: 0, knockup: 0, particle: 'magic', count: 24, ring: '#c690ff', glow: '#b07cff', shake: 3, sfx: 'explosion' },
  cluster: { knockback: 130, knockup: 90, particle: 'explosion', count: 20, ring: '#ffd23f', glow: '#ffc04a', shake: 3, sfx: 'explosion' },
  wave: { knockback: 0, knockup: 60, particle: 'spark', count: 18, ring: '#9bff7a', glow: '#9bff7a', shake: 5, sfx: 'slam' },
  toll: { knockback: 0, knockup: 0, hit: { hitstun: 0 }, particle: 'spark', count: 10, ring: '#d9a066', glow: '#d9a066', shake: 1.5, sfx: 'bell' },
  soul: { knockback: 90, knockup: 50, particle: 'magic', count: 20, ring: '#4fe3ff', glow: '#4fe3ff', shake: 2, sfx: 'explosion' },
  death: { knockback: 120, knockup: 80, particle: 'explosion', count: 16, ring: '#c8324a', glow: '#b02040', shake: 2.5, sfx: 'explosion', debris: '#7a1f2a' },
};

/** 시체 폭탄 numbers (skills.ts `CORPSE_BOMB`): blast radius, and the one chain burst of every enemy the blast kills. */
export interface BombSpec {
  radius: number;
  chain: { radius: number; base: number };
}
/** 섬광탄 numbers: blast radius (px) and stun seconds. */
export interface StunSpec { radius: number; stun: number }
/** 자석 수류탄 numbers: pull radius (px), seconds of pulling, pull speed (px/s), radius (px) of the blast that ends it, and the knockbackTaken below which an enemy is too heavy to pull. */
export interface MagnetSpec { radius: number; pull: number; speed: number; blast: number; minKnockback: number }
/** 집속 수류탄 numbers: blast radius (px), how many bomblets, and each one's damage base, radius (px), side speed and lift (px/s). */
export interface ClusterSpec { radius: number; bomblets: number; bomblet: { base: number; radius: number; speed: number; lift: number } }
export type GrenadeSpec = BombSpec | StunSpec | MagnetSpec | ClusterSpec;

/** Circle AoE around (x, y): damages (and burns / freezes / stuns ...) every enemy in range. */
export function explode(owner: Player, item: ItemInstance, x: number, y: number, o: ExplosionOpts): HitReport[] {
  const w = owner.world;
  const s = BLAST[o.kind];
  const infos = new Map<Actor, DamageInfo>();
  const reports = hitArea(w, { x: x - o.radius, y: y - o.radius, w: o.radius * 2, h: o.radius * 2 }, 'player', (t) => {
    const b = t.hurtbox();
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    if (Math.hypot(nx - x, ny - y) > o.radius) return null;
    const info = owner.damageInfo(item, o.base, {
      kind: 'explosion',
      unblockable: true,
      dir: sgn(t.x - x),
      knockback: s.knockback,
      knockup: s.knockup,
      ...s.hit,
      ...o.extra,
    });
    infos.set(t, info);
    return info;
  }, o.already);
  for (const r of reports) owner.onDealt(r, item, infos.get(r.target)!, { hitstop: 0.06, shake: 2 });
  w.particles.emit(s.particle, x, y, { count: s.count, power: o.radius / 40 });
  if (s.debris) w.particles.emit('debris', x, y, { count: 8, color: s.debris, power: o.radius / 40 });
  w.fx.ring(x, y, { radius: o.radius, color: s.ring, life: 0.3 });
  if (s.flash) w.fx.screenFlash(s.flash, 0.1, 0.25);
  w.shake(s.shake, 0.25);
  w.audio.play(s.sfx);
  w.spawn(new Glow(x, y, o.radius * 2.4, s.glow));
  return reports;
}

/** Move an enemy `step` px toward (tx, ty) (ty = null: sideways only) unless a wall is in the way. True when it moved. */
export function dragToward(a: Actor, tx: number, ty: number | null, step: number): boolean {
  const dx = tx - a.x;
  const dy = ty === null ? 0 : ty - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1) return false;
  const k = Math.min(1, step / d);
  const nx = a.x + dx * k;
  const ny = a.y + dy * k;
  if (a.world.map.boxSolid({ x: nx - a.w / 2, y: ny - a.h, w: a.w, h: a.h - 2 })) return false;
  a.x = nx;
  a.y = ny;
  return true;
}

// ---------------------------------------------------------------------------
export type GrenadeType = 'fire' | 'ice' | 'corpse' | 'stun' | 'magnet' | 'cluster' | 'bomblet';

/** Sprite, outline, light and trail of each thrown grenade (the bomblet is a small fire grenade). */
const LOOK: Record<GrenadeType, { anim: string; outline?: string; light: string; trail: ParticlePreset; scale?: number }> = {
  fire: { anim: 'fire_grenade', light: '#ff8a3c', trail: 'fire' },
  ice: { anim: 'ice_grenade', light: '#8fe3ff', trail: 'ice' },
  corpse: { anim: 'fire_grenade', outline: BONE, light: '#ff8a3c', trail: 'fire' },
  stun: { anim: 'ice_grenade', outline: '#fff3a0', light: '#fff3a0', trail: 'spark' },
  magnet: { anim: 'ice_grenade', outline: '#c690ff', light: '#b07cff', trail: 'magic' },
  cluster: { anim: 'fire_grenade', outline: '#ffd23f', light: '#ffc04a', trail: 'fire' },
  bomblet: { anim: 'fire_grenade', light: '#ff8a3c', trail: 'fire', scale: 0.6 },
};
/** seconds a bomblet flies before it bursts, wherever it is */
export const BOMBLET_FUSE = 0.5;

/**
 * Thrown grenade: arcs, bounces, bursts on contact with an enemy or after a short fuse. The kinds differ in what the burst does:
 * fire / ice (status blasts), 시체 폭탄 (what it kills bursts again: `BombSpec`), 섬광탄 (stun), 자석 수류탄 (a `MagnetWell` pulls
 * enemies in first), 집속 수류탄 (splits into bomblets that burst after `BOMBLET_FUSE` s, never on contact).
 */
export class Grenade extends Entity {
  z = 30;
  alwaysActive = true;
  private fuse = -1;
  private t = 0;
  private spin = 0;

  constructor(
    x: number, y: number, vx: number, vy: number, readonly owner: Player, readonly item: ItemInstance,
    readonly type: GrenadeType, readonly base: number, readonly spec?: GrenadeSpec,
  ) {
    super(x, y);
    this.w = 8;
    this.h = 8;
    this.vx = vx;
    this.vy = vy;
    if (type === 'bomblet') this.fuse = BOMBLET_FUSE;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.play(LOOK[this.type].anim);
  }

  stepPhysics(dt: number): void {
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
    const pvx = this.vx;
    const pvy = this.vy;
    moveBody(this, this.world.map, dt);
    if (this.onGround) {
      if (this.fuse < 0) this.fuse = 0.45;
      if (pvy > 70) {
        this.vy = -pvy * 0.38;
        this.onGround = false;
      }
      this.vx = approach(this.vx, 0, 500 * dt);
    }
    if (this.hitWallX) this.vx = -pvx * 0.4;
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    this.spin += dt * 9 * sgn(this.vx || 1);
    const w = this.world;
    if (Math.random() < dt * 24) w.particles.emit(LOOK[this.type].trail, this.x, this.y - 4, { count: 1 });
    if (this.type !== 'bomblet') {
      const box = this.bounds;
      for (const a of w.actors) {
        if (a.team !== 'enemy' || !a.targetable) continue;
        if (overlaps(box, a.hurtbox())) return this.boom();
      }
    }
    if (this.fuse >= 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) return this.boom();
    }
    if (this.t > 2.4 || this.y > w.map.pxH + 60) this.boom();
  }

  private boom(): void {
    if (this.dead) return;
    this.dead = true;
    const o = this.owner;
    const x = this.x;
    const y = this.y - 4;
    switch (this.type) {
      case 'corpse': {
        const bomb = this.spec as BombSpec;
        const reports = explode(o, this.item, x, y, { radius: bomb.radius, base: this.base, kind: 'corpse' });
        // one chain level: what the blast killed bursts again (those bursts chain no further)
        for (const r of reports) if (r.result.killed) explode(o, this.item, r.target.cx, r.target.cy, { radius: bomb.chain.radius, base: bomb.chain.base, kind: 'corpse' });
        break;
      }
      case 'stun': {
        const s = this.spec as StunSpec;
        explode(o, this.item, x, y, { radius: s.radius, base: this.base, kind: 'stun', extra: { stun: s.stun, hitstun: 0 } });
        break;
      }
      case 'magnet':
        this.world.spawn(new MagnetWell(o, this.item, x, y, this.base, this.spec as MagnetSpec));
        break;
      case 'cluster': {
        const c = this.spec as ClusterSpec;
        explode(o, this.item, x, y, { radius: c.radius, base: this.base, kind: 'cluster' });
        for (let i = 0; i < c.bomblets; i++) {
          const k = c.bomblets > 1 ? (i / (c.bomblets - 1)) * 2 - 1 : 0; // -1 .. 1 across the fan
          this.world.spawn(new Grenade(x, y - 4, k * c.bomblet.speed, -c.bomblet.lift, o, this.item, 'bomblet', c.bomblet.base, c));
        }
        break;
      }
      case 'bomblet': {
        const c = this.spec as ClusterSpec;
        explode(o, this.item, x, y, { radius: c.bomblet.radius, base: this.base, kind: 'cluster' });
        break;
      }
      default:
        explode(o, this.item, x, y, { radius: GRENADE[this.type].radius, base: this.base, kind: this.type });
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const l = LOOK[this.type];
    this.anim?.draw(ctx, this.x, this.y - 4, false, { rotation: this.spin, outline: l.outline, scale: l.scale });
    this.world.lights.add(this.x, this.y - 4, 34, l.light, 0.7, 0.2);
  }
}

/** 자석 수류탄: for `pull` s every enemy within `radius` is dragged to the centre (and held), then the centre bursts. */
export class MagnetWell extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  private t = 0;

  constructor(readonly owner: Player, readonly item: ItemInstance, x: number, y: number, readonly base: number, readonly spec: MagnetSpec) {
    super(x, y);
  }

  update(dt: number): void {
    this.t += dt;
    const sp = this.spec;
    const w = this.world;
    if (Math.random() < dt * 40) {
      const a = Math.random() * Math.PI * 2;
      w.particles.emit('magic', this.x + Math.cos(a) * sp.radius * 0.8, this.y + Math.sin(a) * sp.radius * 0.5, { count: 1, color: '#c690ff' });
    }
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable || !circleHitsBox(this.x, this.y, sp.radius, a.hurtbox())) continue;
      // too heavy to move (mid-bosses, the Matron): only the blast reaches them
      if (a.knockbackTaken < sp.minKnockback) continue;
      a.status.stun = Math.max(a.status.stun, 0.2);
      a.vx = 0;
      // flyers are drawn in on both axes, the rest along the floor
      dragToward(a, this.x, a.gravityScale === 0 ? this.y : null, sp.speed * dt);
    }
    if (this.t >= sp.pull) {
      this.dead = true;
      explode(this.owner, this.item, this.x, this.y, { radius: sp.blast, base: this.base, kind: 'magnet' });
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sp = this.spec;
    const k = Math.min(1, this.t / sp.pull);
    ctx.save();
    ctx.lineWidth = 2;
    // rings closing in on the centre
    for (let i = 0; i < 3; i++) {
      const f = (this.t * 2.2 + i / 3) % 1;
      ctx.globalAlpha = 0.65 * (1 - f) * (0.4 + 0.6 * k);
      ctx.strokeStyle = i === 1 ? '#e8d8ff' : '#b07cff';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, sp.radius * (1 - f), sp.radius * (1 - f) * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8d8ff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3 + 3 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.world.lights.add(this.x, this.y, sp.radius * 1.2, '#b07cff', 0.7);
  }
}

// ---------------------------------------------------------------------------
/** What makes another turret differ from the crossbow turret: seconds it stands, reach (px), seconds between shots, piercing shards (뼈 포탑) and their outline colour. */
export interface TurretSpec { life: number; range: number; interval: number; pierce?: boolean; outline?: string }

/** Crossbow turret: deploys, then shoots arrows at the nearest enemy within 220 px for 10 s (a `TurretSpec` changes that). */
export class Turret extends Entity {
  z = 15;
  static readonly LIFE = 10;
  static readonly RANGE = 220;
  /** seconds between two shots */
  static readonly INTERVAL = 0.7;
  private t = 0;
  private cd = 0.55;
  private shootT = 0;
  private readonly life: number;
  private readonly range: number;
  private readonly interval: number;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec?: TurretSpec) {
    super(x, y);
    this.w = 20;
    this.h = 24;
    this.facing = face;
    this.life = spec?.life ?? Turret.LIFE;
    this.range = spec?.range ?? Turret.RANGE;
    this.interval = spec?.interval ?? Turret.INTERVAL;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.playFor('turret_deploy', 0.5);
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    const w = this.world;
    if (this.t >= this.life) {
      w.particles.emit('smoke', this.x, this.y - 12, { count: 8 });
      this.dead = true;
      return;
    }
    if (this.t < 0.5) return;
    if (this.shootT > 0) {
      this.shootT -= dt;
      if (this.shootT <= 0) this.anim!.play('turret_idle', true);
    } else if (this.anim!.name !== 'turret_idle') this.anim!.play('turret_idle', true);
    this.cd -= dt;
    const target = this.pickTarget();
    if (target) this.facing = target.x >= this.x ? 1 : -1;
    if (target && this.cd <= 0) {
      this.cd = this.interval;
      this.shootT = 0.3;
      this.anim!.playFor('turret_shoot', 0.3);
      const sx = this.x + this.facing * 12;
      const sy = this.y - 14;
      const tb = target.hurtbox();
      const dx = tb.x + tb.w / 2 - sx;
      const dy = tb.y + tb.h * 0.45 - sy;
      const d = Math.hypot(dx, dy) || 1;
      const speed = 480;
      const info = this.owner.damageInfo(this.item, this.base, { kind: 'ranged', dir: sgn(dx) });
      w.spawn(new Arrow(sx, sy, (dx / d) * speed, (dy / d) * speed, this.owner, this.item, info, { hitstop: 0.02, shake: 0 }, { pierce: this.spec?.pierce, outline: this.spec?.outline }));
      w.audio.play('turret', { vol: 0.6 });
      w.particles.emit('spark', sx, sy, { dir: this.facing, count: 2 });
    }
  }

  private pickTarget(): Actor | null {
    const w = this.world;
    let best: Actor | null = null;
    let bd = this.range;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable) continue;
      const d = Math.hypot(a.cx - this.x, a.cy - (this.y - 14));
      if (d < bd && w.map.lineOfSight(this.x, this.y - 14, a.cx, a.cy)) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = this.life - this.t;
    const alpha = left < 1.2 ? 0.45 + 0.55 * Math.abs(Math.sin(this.t * 14)) : 1;
    // the turret sheet is centred (anchor 24,24): lift it so the base sits on the floor
    this.anim?.draw(ctx, this.x, this.y - 14, this.facing < 0, { alpha, outline: this.spec?.outline });
    this.world.lights.add(this.x, this.y - 14, 26, this.spec?.outline ?? '#ffd27a', 0.4);
  }
}

// ---------------------------------------------------------------------------
/** Wolf trap: arms after a moment; the first enemy to step on it is rooted for 3 s and hurt. */
export class WolfTrap extends Entity {
  z = 6;
  static readonly ROOT = 3;
  private t = 0;
  private victim: Actor | null = null;
  private pinX = 0;
  private snapT = 0;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number) {
    super(x, y);
    this.w = 30;
    this.h = 12;
  }

  get armed(): boolean {
    return this.t >= 0.4 && !this.victim;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('projectiles'));
    this.anim!.play('trap_open');
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    const w = this.world;
    if (this.victim) {
      this.snapT += dt;
      const v = this.victim;
      if (v.dead || !v.targetable || this.snapT > WolfTrap.ROOT + 0.4) {
        if (this.snapT > WolfTrap.ROOT + 0.4 || v.dead || v.dying) this.dead = true;
        return;
      }
      if (this.snapT < WolfTrap.ROOT) {
        v.vx = 0;
        v.x = this.pinX;
        v.status.stun = Math.max(v.status.stun, 0.2);
      }
      return;
    }
    if (this.t > 30) {
      this.dead = true;
      return;
    }
    if (!this.armed) return;
    const box = this.bounds;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable || !overlaps(box, a.hurtbox())) continue;
      this.snap(a);
      break;
    }
  }

  private snap(a: Actor): void {
    const w = this.world;
    this.victim = a;
    this.pinX = a.x;
    this.snapT = 0;
    this.anim!.playFor('trap_snap', 0.25);
    const info = this.owner.damageInfo(this.item, this.base, { kind: 'trap', unblockable: true, dir: 0, stun: WolfTrap.ROOT, hitstun: 0.1, knockback: 0 });
    const res = a.takeDamage(info);
    this.owner.onDealt({ target: a, result: res }, this.item, info, { hitstop: 0.05, shake: 1.5, sfx: 'hit' });
    w.audio.play('trap');
    w.particles.emit('spark', this.x, this.y - 6, { count: 8 });
    // a trap never lets go early: make sure the root sticks even if damage was absorbed
    if (res.applied) a.status.stun = Math.max(a.status.stun, WolfTrap.ROOT);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const fade = this.victim ? Math.min(1, (WolfTrap.ROOT + 0.4 - this.snapT) * 3) : 1;
    this.anim?.draw(ctx, this.x, this.y - 6, false, { alpha: this.armed || this.victim ? fade : 0.6 });
  }
}

// ---------------------------------------------------------------------------
// the unique skills of docs/CONTENT3.md §5. Their numbers live in skills.ts (`BONE_SPIKES`, `SOUL_LANTERN`, `CHAIN_HOOK`); the
// entities get them as a spec so the two files do not import each other.

/** 뼈 가시 numbers: how many spikes, seconds between two, px between two, knock-up speed, box (px), seconds a spike hurts / stays. */
export interface SpikeSpec { count: number; interval: number; spacing: number; knockup: number; w: number; h: number; active: number; life: number }

interface Spike { x: number; y: number; t0: number; hit: Set<number> }

/** 뼈 가시: spikes of bone erupt from the floor in front of the heroine, one after the other; each hurts every enemy over it once. */
export class BoneSpikes extends Entity {
  z = 6;
  physics = false;
  alwaysActive = true;
  readonly spikes: Spike[] = [];
  private t = 0;
  /** nothing more can erupt (all of them are out, or a wall / pit is in the way) */
  private done = false;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec: SpikeSpec) {
    super(x, y);
    this.facing = face;
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.world;
    const sp = this.spec;
    while (!this.done && this.spikes.length < sp.count && this.t >= this.spikes.length * sp.interval) this.erupt();
    for (const k of this.spikes) {
      if (this.t - k.t0 > sp.active) continue;
      const box = { x: k.x - sp.w / 2, y: k.y - sp.h, w: sp.w, h: sp.h };
      const infos = new Map<Actor, DamageInfo>();
      const reports = hitArea(w, box, 'player', (t) => {
        const info = this.owner.damageInfo(this.item, this.base, { kind: 'trap', unblockable: true, dir: this.facing, knockback: 40, knockup: sp.knockup });
        infos.set(t, info);
        return info;
      }, k.hit);
      for (const r of reports) this.owner.onDealt(r, this.item, infos.get(r.target)!, { hitstop: 0.04, shake: 1, sfx: 'hit_heavy' });
    }
    const last = this.spikes.length ? this.spikes[this.spikes.length - 1].t0 : 0;
    if ((this.done || this.spikes.length >= sp.count) && this.t - last > sp.life) this.dead = true;
  }

  /** the next spike, `spacing` px further along the floor; a wall or a pit ends the line */
  private erupt(): void {
    const w = this.world;
    const x = this.x + this.facing * this.spec.spacing * (this.spikes.length + 1);
    const floor = w.map.solidAt(x, this.y - 10) ? null : w.map.floorBelow(x, this.y - 4, 3 * TILE);
    if (floor === null) {
      this.done = true;
      return;
    }
    this.spikes.push({ x, y: floor, t0: this.t, hit: new Set() });
    w.particles.emit('debris', x, floor - 2, { count: 3, color: BONE });
    w.particles.emit('dust', x, floor, { count: 2 });
    w.audio.play('hit_heavy', { vol: 0.35, pitch: 1.3 });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sp = this.spec;
    for (const k of this.spikes) {
      const age = this.t - k.t0;
      const h = sp.h * Math.min(1, age / 0.06) * Math.min(1, Math.max(0, (sp.life - age) / 0.15));
      if (h < 1) continue;
      const hw = sp.w / 2;
      ctx.beginPath();
      ctx.moveTo(k.x - hw, k.y);
      ctx.lineTo(k.x - hw * 0.3, k.y - h * 0.55);
      ctx.lineTo(k.x, k.y - h);
      ctx.lineTo(k.x + hw * 0.35, k.y - h * 0.5);
      ctx.lineTo(k.x + hw, k.y);
      ctx.closePath();
      ctx.fillStyle = '#e8dcc4';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#120a1a';
      ctx.stroke();
      ctx.fillStyle = '#7a1f2a';
      ctx.fillRect(Math.round(k.x - hw), Math.round(k.y - 3), sp.w, 3);
      if (age < 0.2) this.world.lights.add(k.x, k.y - 12, 26, '#ffe9c8', 0.35 * (1 - age / 0.2));
    }
  }
}

/** 영혼 등불 numbers: flames, orbit radius (px) and speed (rad/s), seconds they last, burn seconds / per second, per-target cooldown. */
export interface FlameSpec { flames: number; radius: number; spin: number; life: number; burn: number; burnDps: number; hitCd: number }

/** the orbit is centred this far above the heroine's feet; a flame is a 12 px box */
const ORBIT_Y = 26;
const FLAME_BOX = 12;

/** 영혼 등불: soul flames orbit the heroine for a while; a flame that touches an enemy hurts and burns it (each enemy at most every `hitCd` s). */
export class SoulFlames extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  private t = 0;
  private lastHit = new Map<number, number>();

  constructor(readonly owner: Player, readonly item: ItemInstance, readonly base: number, readonly spec: FlameSpec) {
    super(owner.x, owner.y);
  }

  /** where flame `i` is now */
  flame(i: number): { x: number; y: number } {
    const a = this.spec.spin * this.t + (i * Math.PI * 2) / this.spec.flames;
    return { x: this.owner.x + Math.cos(a) * this.spec.radius, y: this.owner.y - ORBIT_Y + Math.sin(a) * this.spec.radius };
  }

  update(dt: number): void {
    this.t += dt;
    this.x = this.owner.x;
    this.y = this.owner.y;
    const w = this.world;
    const sp = this.spec;
    if (this.t >= sp.life || this.owner.dying || this.owner.dead) {
      this.dead = true;
      return;
    }
    for (let i = 0; i < sp.flames; i++) {
      const f = this.flame(i);
      const box = { x: f.x - FLAME_BOX / 2, y: f.y - FLAME_BOX / 2, w: FLAME_BOX, h: FLAME_BOX };
      if (Math.random() < dt * 18) w.particles.emit('fire', f.x, f.y, { count: 1, color: '#4fe3ff' });
      for (const a of w.actors) {
        if (a.team !== 'enemy' || !a.targetable || !overlaps(box, a.hurtbox())) continue;
        const prev = this.lastHit.get(a.id);
        if (prev !== undefined && this.t - prev < sp.hitCd) continue;
        this.lastHit.set(a.id, this.t);
        const info = this.owner.damageInfo(this.item, this.base, { kind: 'explosion', unblockable: true, dir: sgn(a.x - this.owner.x), knockback: 0, hitstun: 0.1, burn: sp.burn, burnDps: sp.burnDps });
        this.owner.onDealt({ target: a, result: a.takeDamage(info) }, this.item, info, { hitstop: 0.02, shake: 0, sfx: 'hit' });
        w.particles.emit('magic', f.x, f.y, { count: 4, color: '#4fe3ff' });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = this.spec.life - this.t;
    const alpha = left < 1 ? 0.4 + 0.6 * Math.abs(Math.sin(this.t * 16)) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < this.spec.flames; i++) {
      const f = this.flame(i);
      const fl = Math.sin(this.t * 22 + i * 2) * 1.2;
      for (const [r, col] of [[5, '#4fe3ff'], [3, '#d8fbff']] as const) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(f.x, f.y + 2, r - 1, 0, Math.PI * 2);
        ctx.moveTo(f.x - r + 1, f.y + 2);
        ctx.quadraticCurveTo(f.x - r * 0.5, f.y - r, f.x + fl * 0.4, f.y - r * 2.2 - fl);
        ctx.quadraticCurveTo(f.x + r * 0.5, f.y - r, f.x + r - 1, f.y + 2);
        ctx.fill();
      }
      this.world.lights.add(f.x, f.y, 34, '#4fe3ff', 0.65 * alpha, 0.15);
    }
    ctx.restore();
  }
}

/** 사슬 갈고리 numbers: reach (px), flight and pull speed (px/s), stun seconds, and the knockbackTaken below which a target is not pulled. */
export interface HookSpec { range: number; speed: number; pullSpeed: number; stun: number; pullMinKnockback: number }

/**
 * 사슬 갈고리: a hook flies straight ahead; the first enemy it touches is hurt and stunned and, unless it is too heavy
 * (`knockbackTaken` below `pullMinKnockback`), dragged to the heroine. Otherwise the chain reels back in.
 */
export class ChainHook extends Entity {
  z = 31;
  physics = false;
  alwaysActive = true;
  state: 'out' | 'back' | 'pull' = 'out';
  victim: Actor | null = null;
  private dist = 0;
  private pullT = 0;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec: HookSpec) {
    super(x, y);
    this.facing = face;
    this.w = 8;
    this.h = 8;
  }

  /** the hand the chain hangs from */
  private get hand(): { x: number; y: number } {
    return { x: this.owner.x + this.owner.facing * 8, y: this.owner.y - 30 };
  }

  update(dt: number): void {
    if (this.owner.dying || this.owner.dead) {
      this.dead = true;
      return;
    }
    if (this.state === 'out') this.fly(dt);
    else if (this.state === 'pull') this.pull(dt);
    else this.reel(dt);
  }

  private fly(dt: number): void {
    const w = this.world;
    const sp = this.spec;
    const n = Math.max(1, Math.ceil((sp.speed * dt) / 5));
    for (let i = 0; i < n; i++) {
      this.x += (this.facing * sp.speed * dt) / n;
      this.dist += (sp.speed * dt) / n;
      if (w.map.solidAt(this.x, this.y)) {
        this.state = 'back';
        w.particles.emit('spark', this.x, this.y, { dir: -this.facing, count: 3 });
        return;
      }
      const box = { x: this.x - 5, y: this.y - 5, w: 10, h: 10 };
      const hit = w.actors.find((a) => a.team === 'enemy' && a.targetable && overlaps(box, a.hurtbox()));
      if (hit) {
        this.grab(hit);
        return;
      }
      if (this.dist >= sp.range) {
        this.state = 'back';
        return;
      }
    }
  }

  private grab(a: Actor): void {
    const w = this.world;
    const info = this.owner.damageInfo(this.item, this.base, { kind: 'ranged', unblockable: true, dir: this.facing, knockback: 0, stun: this.spec.stun });
    const res = a.takeDamage(info);
    this.owner.onDealt({ target: a, result: res }, this.item, info, { hitstop: 0.05, shake: 1.5, sfx: 'hit' });
    w.audio.play('trap', { vol: 0.7 });
    w.particles.emit('spark', this.x, this.y, { count: 6 });
    if (res.applied && !res.killed && a.knockbackTaken >= this.spec.pullMinKnockback) {
      this.victim = a;
      this.state = 'pull';
    } else this.state = 'back';
  }

  /** drag the victim to just in front of the heroine (stopping at walls) */
  private pull(dt: number): void {
    const a = this.victim!;
    const o = this.owner;
    this.pullT += dt;
    if (a.dead || !a.targetable) {
      this.dead = true;
      return;
    }
    // the stun starts when the pull ends: it is held at its full length while the victim is dragged
    a.vx = 0;
    a.status.stun = Math.max(a.status.stun, this.spec.stun);
    if (this.pullT > 0.8) {
      this.dead = true;
      return;
    }
    const gx = o.x + o.facing * (o.w / 2 + a.w / 2 + 6);
    const dx = gx - a.x;
    const dy = o.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= 2) {
      this.dead = true;
      return;
    }
    const k = Math.min(1, (this.spec.pullSpeed * dt) / d);
    const nx = a.x + dx * k;
    const ny = a.y + dy * k;
    if (this.world.map.boxSolid({ x: nx - a.w / 2, y: ny - a.h, w: a.w, h: a.h - 2 })) {
      this.dead = true;
      return;
    }
    a.x = nx;
    a.y = ny;
    this.x = a.x;
    this.y = a.y - a.h / 2;
  }

  private reel(dt: number): void {
    const h = this.hand;
    const dx = h.x - this.x;
    const dy = h.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.spec.speed * 1.4 * dt;
    if (d <= step) {
      this.dead = true;
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.hand;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#120a1a';
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#a9a39a';
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    // the hook: a rusty claw curving back from its tip (mirrored when facing left)
    ctx.translate(this.x, this.y);
    ctx.scale(this.facing, 1);
    for (const [lw, col] of [[3, '#120a1a'], [1.5, '#b8845a']] as const) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(-1, 0, 4, -Math.PI / 2, Math.PI * 0.6);
      ctx.lineTo(1, 5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// ordinary skills of docs/CONTENT4.md §5.2 (and the flame of the 화염 지팡이). Their numbers live in skills.ts / weapons.ts and come in as specs.

const ENEMY_TEAM = 'enemy';
/** half the height (px) of a flame cone at its nozzle */
const NOZZLE = 6;

/** Is the box inside a cone that opens from (x, y) toward `dir`, `range` px long, `spread` px wider (each side) per px? */
function inCone(x: number, y: number, dir: number, range: number, spread: number, b: AABB): boolean {
  const near = dir > 0 ? b.x - x : x - (b.x + b.w);
  const far = dir > 0 ? b.x + b.w - x : x - b.x;
  if (far < 0 || near > range) return false;
  const half = NOZZLE + Math.max(0, near) * spread;
  return b.y < y + half && b.y + b.h > y - half;
}

/** A flame cone's numbers: length (px), fan-out, damage base per tick, seconds of burning. */
export interface ConeSpec { range: number; spread: number; base: number; burn: number }

/**
 * One tick of a flame cone from (x, y) toward `dir` (화염 지팡이, 화염 포탑): every enemy inside takes `base` and burns. Flames are not
 * blockable and do not stagger (the ticks come several times a second), and they hit quietly.
 */
export function flameBurst(owner: Player, item: ItemInstance, x: number, y: number, dir: 1 | -1, o: ConeSpec): HitReport[] {
  const w = owner.world;
  const half = NOZZLE + o.range * o.spread;
  const infos = new Map<Actor, DamageInfo>();
  const reports = hitArea(w, { x: dir > 0 ? x : x - o.range, y: y - half, w: o.range, h: half * 2 }, 'player', (t) => {
    if (!inCone(x, y, dir, o.range, o.spread, t.hurtbox())) return null;
    const info = owner.damageInfo(item, o.base, { kind: 'explosion', unblockable: true, dir, knockback: 0, hitstun: 0, burnDps: AFFIX.burnDps });
    info.burn = Math.max(info.burn ?? 0, o.burn); // (a burn affix can make it longer, never shorter)
    infos.set(t, info);
    return info;
  });
  for (const r of reports) owner.onDealt(r, item, infos.get(r.target)!, { hitstop: 0, shake: 0, sfx: 'hit', vol: 0.25 });
  for (let i = 0; i < 3; i++) {
    const d = 6 + Math.random() * (o.range - 6);
    w.particles.emit('fire', x + dir * d, y + (Math.random() - 0.5) * 2 * (NOZZLE + d * o.spread), { count: 1, vx: dir * 70 });
  }
  return reports;
}

/** Nearest living enemy to (x, y) within `range` px that the point can see (not through walls), optionally not one of `skip`. */
export function nearestEnemy(w: Player['world'], x: number, y: number, range: number, skip?: Set<Actor>): Actor | null {
  let best: Actor | null = null;
  let bd = range;
  for (const a of w.actors) {
    if (a.team !== ENEMY_TEAM || !a.targetable || skip?.has(a)) continue;
    const d = Math.hypot(a.cx - x, a.cy - y);
    if (d < bd && w.map.lineOfSight(x, y, a.cx, a.cy)) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/** 테슬라 코일 numbers: seconds it stands, seconds between zaps, reach (px), extra targets a zap chains to and how far (px) a chain jumps. */
export interface TeslaSpec { life: number; interval: number; range: number; chain: number; chainRange: number }

export interface Arc { x0: number; y0: number; x1: number; y1: number; age: number }
/** seconds a lightning arc stays on screen, and the height (px) of the coil's tip above the floor */
export const ARC_LIFE = 0.14;
const COIL_TOP = 30;

/** The arcs: a jagged line from tip to target, redrawn every frame so it crackles (blue glow, white core), fading with age. */
export function drawArcs(ctx: CanvasRenderingContext2D, arcs: readonly Arc[], alpha = 1): void {
  ctx.save();
  for (const a of arcs) {
    const n = 6;
    const dx = a.x1 - a.x0;
    const dy = a.y1 - a.y0;
    const len = Math.hypot(dx, dy) || 1;
    for (const [lw, col] of [[3, '#4fb8ff'], [1, '#ffffff']] as const) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha * (1 - a.age / ARC_LIFE);
      ctx.beginPath();
      ctx.moveTo(a.x0, a.y0);
      for (let i = 1; i < n; i++) {
        const j = (Math.random() - 0.5) * 10;
        ctx.lineTo(a.x0 + (dx * i) / n - (dy / len) * j, a.y0 + (dy * i) / n + (dx / len) * j);
      }
      ctx.lineTo(a.x1, a.y1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 테슬라 코일: stands for `life` s and zaps the nearest enemy in reach every `interval` s; the bolt jumps on to `chain` more. */
export class TeslaCoil extends Entity {
  z = 15;
  private t = 0;
  private cd = 0.4;
  private arcs: Arc[] = [];

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, readonly spec: TeslaSpec) {
    super(x, y);
    this.w = 18;
    this.h = COIL_TOP;
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.world;
    const sp = this.spec;
    for (const a of this.arcs) a.age += dt;
    this.arcs = this.arcs.filter((a) => a.age < ARC_LIFE);
    if (this.t >= sp.life) {
      w.particles.emit('smoke', this.x, this.y - 14, { count: 8 });
      this.dead = true;
      return;
    }
    this.cd -= dt;
    if (this.cd > 0) return;
    const tx = this.x;
    const ty = this.y - COIL_TOP;
    const first = nearestEnemy(w, tx, ty, sp.range);
    if (!first) {
      this.cd = 0.1; // keep looking
      return;
    }
    this.cd = sp.interval;
    const hit = new Set<Actor>();
    let from = { x: tx, y: ty };
    let target: Actor | null = first;
    for (let i = 0; i <= sp.chain && target; i++) {
      hit.add(target);
      const info = this.owner.damageInfo(this.item, this.base, { kind: 'explosion', unblockable: true, dir: sgn(target.x - this.x), knockback: 0, hitstun: 0.1 });
      this.owner.onDealt({ target, result: target.takeDamage(info) }, this.item, info, { hitstop: 0.02, shake: 0, sfx: 'hit', vol: 0.5 });
      this.arcs.push({ x0: from.x, y0: from.y, x1: target.cx, y1: target.cy, age: 0 });
      w.particles.emit('spark', target.cx, target.cy, { count: 4, color: '#9fe8ff' });
      from = { x: target.cx, y: target.cy };
      target = nearestEnemy(w, from.x, from.y, sp.chainRange, hit);
    }
    w.audio.play('turret', { vol: 0.5, pitch: 1.6 });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = this.spec.life - this.t;
    const alpha = left < 1.2 ? 0.45 + 0.55 * Math.abs(Math.sin(this.t * 14)) : 1;
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const glow = 0.6 + 0.4 * Math.sin(this.t * 18);
    ctx.save();
    ctx.globalAlpha = alpha;
    // iron foot, copper windings narrowing upward, a glowing sphere on top
    ctx.fillStyle = '#120a1a';
    ctx.fillRect(x - 9, y - 6, 18, 6);
    ctx.fillStyle = '#4a4458';
    ctx.fillRect(x - 8, y - 5, 16, 4);
    for (let i = 0; i < 4; i++) {
      const hw = 7 - i * 1.4;
      ctx.fillStyle = '#120a1a';
      ctx.fillRect(Math.round(x - hw - 1), y - 11 - i * 4, Math.round(hw * 2 + 2), 5);
      ctx.fillStyle = i % 2 ? '#b8845a' : '#d9a066';
      ctx.fillRect(Math.round(x - hw), y - 10 - i * 4, Math.round(hw * 2), 3);
    }
    ctx.fillStyle = '#120a1a';
    ctx.beginPath();
    ctx.arc(x, y - COIL_TOP + 1, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = glow > 0.8 ? '#ffffff' : '#9fe8ff';
    ctx.beginPath();
    ctx.arc(x, y - COIL_TOP + 1, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawArcs(ctx, this.arcs, alpha);
    this.world.lights.add(this.x, this.y - COIL_TOP, 40, '#8fe3ff', (0.5 + 0.2 * glow) * alpha);
  }
}

/** 화염 포탑 numbers: seconds it stands, cone length (px) and fan-out, seconds between ticks, burn seconds. */
export interface JetSpec { life: number; range: number; spread: number; interval: number; burn: number }

/** 화염 포탑: stands for `life` s, breathing a flame cone ahead of it (the way she faced) every `interval` s. */
export class FlameTurret extends Entity {
  z = 15;
  private t = 0;
  private cd = 0.3;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec: JetSpec) {
    super(x, y);
    this.w = 22;
    this.h = 20;
    this.facing = face;
  }

  /** where the flame leaves the nozzle */
  get muzzle(): { x: number; y: number } {
    return { x: this.x + this.facing * 13, y: this.y - 11 };
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.world;
    const sp = this.spec;
    if (this.t >= sp.life) {
      w.particles.emit('smoke', this.x, this.y - 10, { count: 8 });
      this.dead = true;
      return;
    }
    this.cd -= dt;
    if (this.cd > 0) return;
    this.cd += sp.interval;
    const m = this.muzzle;
    flameBurst(this.owner, this.item, m.x, m.y, this.facing, { range: sp.range, spread: sp.spread, base: this.base, burn: sp.burn });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const left = this.spec.life - this.t;
    const alpha = left < 1 ? 0.45 + 0.55 * Math.abs(Math.sin(this.t * 14)) : 1;
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(this.facing, 1);
    // a squat iron tank on two feet with a nozzle pointing forward and a pilot flame
    ctx.fillStyle = '#120a1a';
    ctx.fillRect(-12, -18, 22, 18);
    ctx.fillRect(8, -14, 8, 6);
    ctx.fillStyle = '#6a5a52';
    ctx.fillRect(-11, -17, 20, 14);
    ctx.fillStyle = '#8a766a';
    ctx.fillRect(-11, -17, 20, 3);
    ctx.fillStyle = '#4a4040';
    ctx.fillRect(9, -13, 6, 4);
    ctx.fillStyle = '#c8324a';
    ctx.fillRect(-7, -12, 12, 3);
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(15, -13 + (Math.floor(this.t * 14) % 2), 2, 3);
    ctx.restore();
    const m = this.muzzle;
    this.world.lights.add(m.x + this.facing * this.spec.range * 0.4, m.y, this.spec.range * 0.9, '#ff8a3c', 0.6 * alpha);
  }
}

/** Is it a shot an enemy sent at her (an arrow of the enemy team, a bolt, a bomb, a web blob)? */
function isEnemyShot(e: Entity): boolean {
  return (e instanceof EnemyArrow && e.team === ENEMY_TEAM) || e instanceof Bolt || e instanceof Bomb || e instanceof WebBlob;
}

/** 거부의 파동 numbers: radius (px) and the knockback speed it throws every enemy with. */
export interface WaveSpec { radius: number; knockback: number }

/** 거부의 파동: everything in `radius` is thrown away and hurt, and every enemy shot in it is wiped out. */
export function denialWave(owner: Player, item: ItemInstance, base: number, o: WaveSpec): void {
  const w = owner.world;
  const x = owner.x;
  const y = owner.y - 20;
  explode(owner, item, x, y, { radius: o.radius, base, kind: 'wave', extra: { knockback: o.knockback } });
  w.fx.ring(x, y, { radius: o.radius * 0.6, color: '#ffffff', life: 0.22 });
  for (const e of w.entities) {
    if (e.dead || !isEnemyShot(e) || Math.hypot(e.x - x, e.cy - y) > o.radius) continue;
    e.dead = true;
    w.particles.emit('spark', e.x, e.cy, { count: 5, color: '#9bff7a' });
  }
}

/** 회오리 numbers: how far (px) and how long (s) it travels, seconds between ticks, radius and height (px), drag speed (px/s), and the knockbackTaken below which an enemy is too heavy to drag. */
export interface TornadoSpec { distance: number; life: number; interval: number; radius: number; height: number; drag: number; minKnockback: number }

/**
 * 회오리: a vortex that travels along the floor, hurting every enemy inside every `interval` s, holding them stunned and dragging
 * them along with it (heavy ones only take the damage). It ends at a wall.
 */
export class Tornado extends Entity {
  z = 29;
  physics = false;
  alwaysActive = true;
  private t = 0;
  private tick = 0;

  constructor(x: number, y: number, readonly owner: Player, readonly item: ItemInstance, readonly base: number, face: 1 | -1, readonly spec: TornadoSpec) {
    super(x, y);
    this.facing = face;
    this.w = spec.radius * 2;
    this.h = spec.height;
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.world;
    const sp = this.spec;
    if (this.t >= sp.life || this.owner.dying || this.owner.dead) {
      w.particles.emit('dust', this.x, this.y - 6, { count: 8 });
      this.dead = true;
      return;
    }
    const nx = this.x + this.facing * (sp.distance / sp.life) * dt;
    if (w.map.solidAt(nx + this.facing * sp.radius, this.y - 12)) {
      this.dead = true;
      return;
    }
    this.x = nx;
    const floor = w.map.floorBelow(nx, this.y - 6, 3 * TILE);
    if (floor !== null) this.y = floor;
    if (Math.random() < dt * 30) w.particles.emit('dust', this.x + (Math.random() - 0.5) * sp.radius * 2, this.y - 2, { count: 1, vy: -80 });
    this.tick -= dt;
    const hurt = this.tick <= 0;
    if (hurt) this.tick += sp.interval;
    const box = { x: this.x - sp.radius, y: this.y - sp.height, w: sp.radius * 2, h: sp.height };
    for (const a of w.actors) {
      if (a.team !== ENEMY_TEAM || !a.targetable || !overlaps(box, a.hurtbox())) continue;
      if (a.knockbackTaken >= sp.minKnockback) dragToward(a, this.x, null, sp.drag * dt);
      if (!hurt) continue;
      const info = this.owner.damageInfo(this.item, this.base, { kind: 'explosion', unblockable: true, dir: sgn(a.x - this.x), knockback: 0, hitstun: 0, stun: sp.interval + 0.05 });
      this.owner.onDealt({ target: a, result: a.takeDamage(info) }, this.item, info, { hitstop: 0, shake: 0, sfx: 'hit', vol: 0.3 });
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sp = this.spec;
    const left = sp.life - this.t;
    const fade = Math.min(1, left * 3) * Math.min(1, this.t * 6);
    ctx.save();
    ctx.lineWidth = 2;
    // a funnel: stacked ellipses widening upward, each turning at its own speed
    const rings = 7;
    for (let i = 0; i < rings; i++) {
      const f = i / (rings - 1);
      const r = sp.radius * (0.35 + 0.65 * f);
      const cy = this.y - 4 - f * (sp.height - 8);
      const ph = this.t * (9 - f * 3) + i * 1.3;
      ctx.globalAlpha = (0.75 - f * 0.25) * fade;
      ctx.strokeStyle = i % 2 ? '#eaffea' : '#9bff7a';
      ctx.beginPath();
      ctx.ellipse(this.x + Math.sin(ph) * 2, cy, r, r * 0.3, 0, Math.PI * (ph % 2), Math.PI * (ph % 2) + Math.PI * 1.3);
      ctx.stroke();
    }
    ctx.restore();
    this.world.lights.add(this.x, this.y - sp.height / 2, sp.radius * 2, '#9bff7a', 0.35 * fade);
  }
}
