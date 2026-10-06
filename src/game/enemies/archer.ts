import { TILE } from '../../engine/config';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { Arrow, Bolt } from './projectiles';
import { warnLine } from './telegraph';
import { ATTACK_DMG, BASE_STATS, type EnemyDef } from './variants';

const SPEC = { hp: BASE_STATS.archer.hp, w: 16, h: 42, patrol: 26, chase: 62, aura: BASE_STATS.archer.aura, blood: '#a03a4a' };
const MIN_DIST = 120;
const MAX_DIST = 220;
const ARROW_SPEED = 330;

/**
 * 궁수: keeps 120–220 px away, backs off when approached, aims with a thin red line (0.8 s) and shoots.
 * Variants: fire (burning arrows), volley (3-arrow spread), crossbow (1.2 s windup, piercing bolt),
 * shadow (blinks away when the player gets close).
 */
export class Archer extends Enemy {
  private aimX = 0;
  private aimY = 0;
  private blinkCd = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}, variant: EnemyDef | null = null) {
    super('archer', x, y, opts, SPEC, variant);
    this.cooldownPause = 0.2;
    this.aggroRange = 280;
  }

  update(dt: number): void {
    if (this.blinkCd > 0) this.blinkCd -= dt;
    super.update(dt);
  }

  /** Shadow archer: when the player closes in, blink away (up to 120 px) to a free spot with floor. */
  private tryBlinkAway(p: Player): boolean {
    if (this.ab !== 'shadow' || this.blinkCd > 0) return false;
    const away = Math.sign(this.x - p.x) || -this.facing;
    const max = this.pr('blinkRange', 120);
    for (const k of [1, 0.75, 0.5]) {
      if (this.blinkTo(this.x + away * max * k, '#b36bff')) {
        this.blinkCd = this.pr('blinkCd', 3.2);
        this.facePlayer(p);
        return true;
      }
    }
    this.blinkCd = 0.6;
    return false;
  }

  private get origin(): { x: number; y: number } {
    return { x: this.x + this.facing * 12 * this.scale, y: this.y - this.h * 0.62 };
  }

  /** Keep distance while we wait for the next shot. */
  protected chaseMove(dt: number, p: Player): void {
    const dx = p.x - this.x;
    const d = Math.abs(dx);
    const dir = Math.sign(dx);
    const sp = this.speedMult;
    let moved = false;
    if (d < this.pr('trigger', 0) && this.state !== 'windup' && this.tryBlinkAway(p)) {
      this.play('idle');
      return;
    }
    if (d < MIN_DIST) moved = this.walk(-dir, 84 * sp, 4, false);
    else if (d > MAX_DIST || !this.sees(p)) moved = this.walk(dir, SPEC.chase * sp, TILE, true);
    else this.vx = 0;
    if (!moved) this.vx = 0;
    this.play(moved ? 'walk' : 'idle');
    void dt;
  }

  protected doCooldown(dt: number, p: Player): void {
    this.facePlayer(p);
    this.chaseMove(dt, p);
  }

  protected shouldAttack(p: Player): boolean {
    const d = Math.abs(p.x - this.x);
    // too close and there is room to back off: retreat first, shoot later
    if (d < MIN_DIST && this.pathAhead(-Math.sign(p.x - this.x), 4) === 'ok') return false;
    return d > 40 && d < 280 && Math.abs(p.y - this.y) < 150 && this.sees(p);
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    this.updateAim(p);
    const crossbow = this.ab === 'crossbow';
    this.beginAttack(this.pr('windup', 0.8), 0.12, crossbow ? 0.8 : 0.55, 'shoot');
    this.attackCd = crossbow ? 2.4 : 1.3;
  }

  private updateAim(p: Player): void {
    this.aimX = p.x;
    this.aimY = p.y - p.h * 0.55;
  }

  protected onWindup(dt: number, p: Player): void {
    super.onWindup(dt, p);
    // the aim line follows the player, then locks for the last 35 % so the shot can be dodged
    if (this.telegraph < 0.65) {
      this.updateAim(p);
      this.facePlayer(p);
    }
  }

  protected onActiveStart(): void {
    const o = this.origin;
    let dx = this.aimX - o.x;
    let dy = this.aimY - o.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    if (Math.sign(dx) !== this.facing) dx = this.facing * 0.2; // never shoot backwards through ourselves
    const w = this.world;
    switch (this.ab) {
      case 'crossbow': {
        const sp = this.pr('boltSpeed', 520);
        w.spawn(new Bolt(o.x, o.y, dx * sp, dy * sp, this.dmg(ATTACK_DMG.archer), this));
        w.audio.play('bow_shoot', { vol: 0.9, pitch: 0.7 });
        w.particles.emit('spark', o.x + dx * 8, o.y + dy * 8, { dir: this.facing, count: 4 });
        break;
      }
      case 'volley': {
        const n = Math.max(1, Math.round(this.pr('arrows', 3)));
        const spread = (this.pr('spread', 12) * Math.PI) / 180;
        for (let i = 0; i < n; i++) {
          const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * spread;
          const c = Math.cos(a);
          const sn = Math.sin(a);
          const vx = (dx * c - dy * sn) * ARROW_SPEED;
          const vy = (dx * sn + dy * c) * ARROW_SPEED;
          w.spawn(new Arrow(o.x, o.y, vx, vy, this.dmg(ATTACK_DMG.archer), this));
        }
        w.audio.play('bow_shoot', { vol: 0.8, pitch: 1.1 });
        break;
      }
      case 'fire':
        w.spawn(new Arrow(o.x, o.y, dx * ARROW_SPEED, dy * ARROW_SPEED, this.dmg(ATTACK_DMG.archer), this, { burn: this.pr('burn', 3), burnDps: this.dot(this.pr('burnDps', 5)), style: 'fire' }));
        w.audio.play('bow_shoot', { vol: 0.7 });
        break;
      default:
        w.spawn(new Arrow(o.x, o.y, dx * ARROW_SPEED, dy * ARROW_SPEED, this.dmg(ATTACK_DMG.archer), this));
        w.audio.play('bow_shoot', { vol: 0.7 });
    }
  }

  /** Length of the aim ray until it hits a wall. */
  private rayLength(dx: number, dy: number, max: number): number {
    const o = this.origin;
    const map = this.world.map;
    for (let l = 8; l < max; l += 6) if (map.solidAt(o.x + dx * l, o.y + dy * l)) return l;
    return max;
  }

  protected drawOverlay(ctx: CanvasRenderingContext2D): void {
    const p = this.telegraph;
    if (p < 0) return;
    const o = this.origin;
    const dx = this.aimX - o.x;
    const dy = this.aimY - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const crossbow = this.ab === 'crossbow';
    const l = this.rayLength(ux, uy, crossbow ? 380 : 300);
    warnLine(ctx, o.x, o.y, o.x + ux * l, o.y + uy * l, 0.3 + 0.7 * p, p > 0.65 || crossbow ? 2 : 1);
    if (this.ab === 'volley') {
      // the two outer arrows of the spread
      const sp = (this.pr('spread', 12) * Math.PI) / 180;
      for (const a of [-sp, sp]) {
        const vx = ux * Math.cos(a) - uy * Math.sin(a);
        const vy = ux * Math.sin(a) + uy * Math.cos(a);
        const ll = this.rayLength(vx, vy, 260);
        warnLine(ctx, o.x, o.y, o.x + vx * ll, o.y + vy * ll, 0.2 + 0.5 * p, 1);
      }
    }
  }
}
