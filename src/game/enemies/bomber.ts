import { TILE } from '../../engine/config';
import { clamp } from '../../engine/math';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { Bomb, BOMB_RADIUS, explode, lobVelocity, type BombOpts } from './projectiles';
import { warnCircle } from './telegraph';
import type { EnemyDef } from './variants';

const SPEC = { hp: 35, w: 16, h: 40, patrol: 26, chase: 58, aura: '#ffd23f', blood: '#a05a2a' };
const MIN_DIST = 110;
const MAX_DIST = 250;

/**
 * 폭탄마: keeps its distance and lobs bombs that land near the player (0.8 s fuse, r 44 red warning circle).
 * Variants: frost (bombs freeze 2 s, damage x0.6), cluster (bomb splits into 3 bomblets on landing),
 * kamikaze (runs at the player and self-destructs), alchemist (flask leaves an acid puddle).
 */
export class Bomber extends Enemy {
  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}, variant: EnemyDef | null = null) {
    super('bomber', x, y, opts, SPEC, variant);
    this.cooldownPause = 0.2;
    this.aggroRange = this.ab === 'kamikaze' ? 300 : 280;
  }

  private get kamikaze(): boolean {
    return this.ab === 'kamikaze';
  }

  protected chaseMove(_dt: number, p: Player): void {
    const dx = p.x - this.x;
    if (this.kamikaze) {
      // charges straight in
      if (Math.abs(dx) > 4 && this.walk(Math.sign(dx), SPEC.chase * this.speedMult, TILE * 2, true)) this.play('walk');
      else {
        this.vx = 0;
        this.play('idle');
      }
      return;
    }
    const d = Math.abs(dx);
    const dir = Math.sign(dx);
    const sp = this.speedMult;
    let moved = false;
    if (d < MIN_DIST) moved = this.walk(-dir, 78 * sp, 4, false);
    else if (d > MAX_DIST || !this.sees(p)) moved = this.walk(dir, SPEC.chase * sp, TILE, true);
    else this.vx = 0;
    if (!moved) this.vx = 0;
    this.play(moved ? 'walk' : 'idle');
  }

  protected doCooldown(dt: number, p: Player): void {
    this.facePlayer(p);
    this.chaseMove(dt, p);
  }

  protected shouldAttack(p: Player): boolean {
    const d = Math.abs(p.x - this.x);
    if (this.kamikaze) return d < 44 && Math.abs(p.y - this.y) < 44;
    // too close and there is room to back off: retreat first, shoot later
    if (d < MIN_DIST && this.pathAhead(-Math.sign(p.x - this.x), 4) === 'ok') return false;
    return d > 50 && d < 290 && Math.abs(p.y - this.y) < 170 && this.sees(p);
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    if (this.kamikaze) {
      // light the fuse: stands and flashes, then goes off
      this.beginAttack(this.pr('fuse', 0.55), 0.05, 0.2, 'throw');
      this.world.audio.play('telegraph', { vol: 0.8, pitch: 1.4 });
      this.attackCd = 5;
      return;
    }
    this.beginAttack(0.55, 0.12, 0.6, 'throw');
    this.attackCd = 2.3;
  }

  /** Kamikaze: the blast (unblockable, r 50, dmg x1.5) - and she dies doing it. */
  private selfDestruct(): void {
    this.noLoot = true;
    this.hp = 0;
    explode(this.world, this.x, this.y - 12, this.pr('radius', 50), this.dmg(14), this, { knockback: 300, knockup: 200, shake: 7 });
    this.die({ amount: 0, dir: 0, kind: 'explosion' });
  }

  protected onWindup(dt: number, p: Player): void {
    super.onWindup(dt, p);
    if (this.telegraph < 0.7) this.facePlayer(p);
  }

  protected onActiveStart(p: Player): void {
    if (this.kamikaze) {
      this.selfDestruct();
      return;
    }
    const w = this.world;
    const x0 = this.x + this.facing * 10 * this.scale;
    const y0 = this.y - this.h * 0.8;
    // aim slightly ahead of where the player is running, with a little scatter ("lands near the player")
    let tx = p.x + p.vx * 0.35 + w.rng.range(-16, 16);
    tx = clamp(tx, this.x - 300, this.x + 300);
    const ground = w.map.floorBelow(tx, p.y - 30, 420) ?? p.y;
    const T = clamp(Math.abs(tx - x0) / 250, 0.5, 0.95);
    const v = lobVelocity(x0, y0, tx, ground - 5, T);
    const o: BombOpts = { damage: this.dmg(14), radius: BOMB_RADIUS, source: this, targetX: tx, targetY: ground };
    switch (this.ab) {
      case 'frost':
        o.freeze = this.pr('freeze', 2);
        o.tint = '#8fe3ff';
        break;
      case 'cluster':
        o.split = Math.round(this.pr('split', 3));
        o.bombletDamage = Math.max(1, Math.round(this.dmg(14) * this.pr('bombletDmg', 0.55)));
        o.bombletRadius = this.pr('bombletR', 30);
        o.radius = 36;
        o.tint = '#ffd23f';
        break;
      case 'alchemist': {
        const r = this.pr('puddleR', 36);
        o.puddle = { radius: r, life: this.pr('puddleLife', 2.5), dps: this.pr('puddleDps', 6) };
        o.radius = r;
        o.fuse = 0.3;
        o.tint = '#7dff5a';
        break;
      }
      default:
    }
    w.spawn(new Bomb(x0, y0, v.vx, v.vy, o));
    w.audio.play('throw', { vol: 0.7 });
  }

  protected drawTelegraph(ctx: CanvasRenderingContext2D, p: number): void {
    // the kamikaze's blast radius
    if (this.kamikaze) warnCircle(ctx, this.x, this.y, this.pr('radius', 50), p, this.time);
  }

  protected drawOverlay(): void {
    if (!this.kamikaze || this.dying) return;
    // burning fuse on her back
    const fx = this.x - this.facing * 9 * this.scale;
    const fy = this.y - this.h * 0.85;
    if (Math.random() < 0.5) this.world.particles.emit('spark', fx, fy, { count: 1 });
    this.world.lights.add(fx, fy, 26, '#ff7a3a', 0.6, 0.6);
  }
}
