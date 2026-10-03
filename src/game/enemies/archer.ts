import { TILE } from '../../engine/config';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { Arrow } from './projectiles';
import { warnLine } from './telegraph';

const SPEC = { hp: 30, w: 16, h: 42, patrol: 26, chase: 62, aura: '#7dff6a', blood: '#a03a4a' };
const MIN_DIST = 120;
const MAX_DIST = 220;
const ARROW_SPEED = 330;

/** 궁수: keeps 120–220 px away, backs off when approached, aims with a thin red line (0.8 s) and shoots. */
export class Archer extends Enemy {
  private aimX = 0;
  private aimY = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}) {
    super('archer', x, y, opts, SPEC);
    this.cooldownPause = 0.2;
    this.aggroRange = 280;
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
    return d > 40 && d < 280 && Math.abs(p.y - this.y) < 150 && this.sees(p);
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    this.updateAim(p);
    this.beginAttack(0.8, 0.12, 0.55, 'shoot');
    this.attackCd = 1.3;
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
    this.world.spawn(new Arrow(o.x, o.y, dx * ARROW_SPEED, dy * ARROW_SPEED, this.dmg(10), this));
    this.world.audio.play('bow_shoot', { vol: 0.7 });
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
    const l = this.rayLength(ux, uy, 300);
    warnLine(ctx, o.x, o.y, o.x + ux * l, o.y + uy * l, 0.3 + 0.7 * p, p > 0.65 ? 2 : 1);
  }
}
