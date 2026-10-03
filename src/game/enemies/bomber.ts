import { TILE } from '../../engine/config';
import { clamp } from '../../engine/math';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { Bomb, BOMB_RADIUS, lobVelocity } from './projectiles';

const SPEC = { hp: 35, w: 16, h: 40, patrol: 26, chase: 58, aura: '#ffd23f', blood: '#a05a2a' };
const MIN_DIST = 110;
const MAX_DIST = 250;

/** 폭탄마: keeps its distance and lobs bombs that land near the player (0.8 s fuse, r 44 red warning circle). */
export class Bomber extends Enemy {
  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}) {
    super('bomber', x, y, opts, SPEC);
    this.cooldownPause = 0.2;
    this.aggroRange = 280;
  }

  protected chaseMove(_dt: number, p: Player): void {
    const dx = p.x - this.x;
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
    return d > 50 && d < 290 && Math.abs(p.y - this.y) < 170 && this.sees(p);
  }

  protected startAttack(p: Player): void {
    this.facePlayer(p);
    this.beginAttack(0.55, 0.12, 0.6, 'throw');
    this.attackCd = 2.3;
  }

  protected onWindup(dt: number, p: Player): void {
    super.onWindup(dt, p);
    if (this.telegraph < 0.7) this.facePlayer(p);
  }

  protected onActiveStart(p: Player): void {
    const w = this.world;
    const x0 = this.x + this.facing * 10 * this.scale;
    const y0 = this.y - this.h * 0.8;
    // aim slightly ahead of where the player is running, with a little scatter ("lands near the player")
    let tx = p.x + p.vx * 0.35 + w.rng.range(-16, 16);
    tx = clamp(tx, this.x - 300, this.x + 300);
    const ground = w.map.floorBelow(tx, p.y - 30, 420) ?? p.y;
    const T = clamp(Math.abs(tx - x0) / 250, 0.5, 0.95);
    const v = lobVelocity(x0, y0, tx, ground - 5, T);
    w.spawn(new Bomb(x0, y0, v.vx, v.vy, { damage: this.dmg(14), radius: BOMB_RADIUS, source: this, targetX: tx, targetY: ground }));
    w.audio.play('throw', { vol: 0.7 });
  }
}
