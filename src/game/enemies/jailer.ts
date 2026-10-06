import { FIXED_DT } from '../../engine/config';
import { hitArea, type DamageInfo } from '../combat';
import type { Player } from '../player/player';
import { Enemy, type EnemyOpts } from './base';
import { FloorWave } from './hazards';
import { ChainHook } from './projectiles';
import { warnLine, warnRect } from './telegraph';
import { ATTACK_DMG, BASE_STATS, type EnemyDef } from './variants';

const SPEC = { hp: BASE_STATS.jailer.hp, w: 24, h: 46, patrol: 24, chase: 48, aura: BASE_STATS.jailer.aura, blood: '#8a3a3a' };

type Mode = 'mace' | 'hook';

/**
 * 여간수: tower shield blocks frontal non-unblockable damage (guard logic lives in Enemy). Hurt from
 * behind, by ground slams, explosions, traps and damage over time, and while its shield is down
 * (mace swing / recovery). Attack: shield bash + mace, 0.7 s windup.
 * Variants: warden (mace slam sends a floor shockwave), torch (ignites), spear (reach x1.6),
 * chain (throws a hook that drags the player in, then bashes).
 */
export class Jailer extends Enemy {
  private turnT = 0;
  private mode: Mode = 'mace';
  private hook: ChainHook | null = null;
  private hookCd = 0.3;
  private aimX = 0;
  private aimY = 0;

  constructor(x: number, y: number, opts: Partial<EnemyOpts> = {}, variant: EnemyDef | null = null) {
    super('jailer', x, y, opts, SPEC, variant);
    this.cooldownPause = 0.5;
    this.knockbackTaken = this.elite ? 0.3 : 0.6;
    this.guard = this.pr('noShield') ? null : 'shield';
  }

  /** reach multiplier of the melee swing (spear 1.6) */
  private get reach(): number {
    return this.pr('reach', 1) * this.scale;
  }

  update(dt: number): void {
    if (this.hookCd > 0) this.hookCd -= dt;
    super.update(dt);
  }

  /** The jailer turns slowly: slipping behind it (a roll) buys time to hit the unshielded back. */
  protected facePlayer(p: { x: number }): void {
    if (this.state === 'alert' || this.state === 'patrol') {
      super.facePlayer(p);
      return;
    }
    const want = p.x > this.x ? 1 : -1;
    if (want === this.facing) {
      this.turnT = 0;
      return;
    }
    this.turnT += FIXED_DT;
    if (this.turnT >= (this.elite ? 0.4 : 0.6)) {
      this.facing = want;
      this.turnT = 0;
    }
  }

  private get hookRange(): number {
    return this.pr('hookRange', 180);
  }

  protected shouldAttack(p: Player): boolean {
    const front = (p.x - this.x) * this.facing > 0;
    if (!front) return false;
    const dx = Math.abs(p.x - this.x);
    const melee = dx < 58 * this.reach && Math.abs(p.y - this.y) < 38;
    if (melee) return true;
    if (this.ab === 'chain') return this.hookCd <= 0 && dx >= 80 && dx <= this.hookRange && Math.abs(p.y - this.y) < 40 && this.sees(p);
    return false;
  }

  protected startAttack(p: Player): void {
    const dx = Math.abs(p.x - this.x);
    if (this.ab === 'chain' && dx >= 58 * this.reach) {
      this.mode = 'hook';
      this.aimX = p.x;
      this.aimY = p.cy;
      // windup, then the hook flies for up to ~1 s (ended early when it resolves)
      this.beginAttack(0.6, 1.0, 0.5);
      this.attackCd = 1.2;
      this.hookCd = 3;
      this.hook = null;
      return;
    }
    this.mode = 'mace';
    this.beginAttack(this.ab === 'spear' ? 0.6 : 0.7, this.ab === 'spear' ? 0.16 : 0.2, this.ab === 'spear' ? 0.6 : 0.7, 'attack');
    this.attackCd = 1.2;
  }

  protected onWindup(dt: number, p: Player): void {
    super.onWindup(dt, p);
    // the hook's aim tracks the player, then locks for the last 30 % so it can be dodged
    if (this.mode === 'hook' && this.telegraph < 0.7) {
      this.aimX = p.x;
      this.aimY = p.cy;
    }
  }

  private get hand(): { x: number; y: number } {
    return { x: this.x + this.facing * 12, y: this.y - this.h * 0.6 };
  }

  protected onActiveStart(): void {
    const w = this.world;
    if (this.mode === 'hook') {
      const o = this.hand;
      this.hook = w.spawn(
        new ChainHook(o.x, o.y, this.aimX - o.x, this.aimY - o.y, this, {
          range: this.hookRange,
          speed: this.pr('hookSpeed', 460),
          damage: this.dmg(this.pr('hookDmg', 5)),
          pull: this.pr('pull', 430),
        }),
      );
      w.audio.play('throw', { vol: 0.7, pitch: 0.8 });
      return;
    }
    const spear = this.ab === 'spear';
    const torch = this.ab === 'torch';
    w.fx.slash(this.x + this.facing * 24, this.y - this.h * 0.6, {
      dir: this.facing,
      radius: spear ? 54 : 38,
      from: spear ? -0.2 : -1.3,
      to: spear ? 0.2 : 0.7,
      color: torch ? '#ff9a3a' : spear ? '#bcd6ff' : '#d8dde8',
    });
    w.audio.play(spear ? 'stab' : 'swing_heavy', { vol: 0.7 });
    this.vx = this.facing * (spear ? 140 : 80);
    if (this.ab === 'warden') {
      // the slam sends a small shockwave along the floor (jump it)
      const wx = this.x + this.facing * (this.w / 2 + 14);
      w.shake(3, 0.15);
      w.audio.play('slam', { vol: 0.6 });
      w.particles.emit('debris', wx, this.y - 4, { count: 5 });
      w.spawn(
        new FloorWave(wx, this.y, this.facing, {
          speed: this.pr('waveSpeed', 230),
          damage: this.dmg(this.pr('waveDmg', 8)),
          maxDist: this.pr('waveDist', 170),
          source: this,
        }),
      );
    }
  }

  protected onActive(): void {
    if (this.mode === 'hook') {
      const h = this.hook;
      if (!h || h.dead) {
        if (h?.connected) {
          // dragged in: bash her
          this.hook = null;
          this.mode = 'mace';
          this.facePlayer(this.player);
          this.beginAttack(0.28, 0.2, 0.7, 'attack');
        } else this.endActive();
      }
      return;
    }
    const f = this.facing;
    const r = this.reach;
    const info: DamageInfo = { amount: this.dmg(ATTACK_DMG.jailer), dir: f, kind: 'melee', source: this, knockback: 280, hitstun: 0.3 };
    if (this.ab === 'torch') {
      info.burn = this.pr('burn', 3);
      info.burnDps = this.dot(this.pr('burnDps', 5));
    }
    const spear = this.ab === 'spear';
    hitArea(
      this.world,
      spear
        ? { x: f > 0 ? this.x : this.x - 66 * r, y: this.y - this.h * 0.9, w: 66 * r, h: this.h * 0.6 }
        : { x: f > 0 ? this.x - 4 : this.x - 62 * r, y: this.y - this.h - 4, w: 66 * r, h: this.h + 4 },
      'enemy',
      info,
      this.hitSet,
    );
  }

  protected cancelAttack(): void {
    super.cancelAttack();
    if (this.hook) this.hook.dead = true;
    this.hook = null;
  }

  protected drawTelegraph(ctx: CanvasRenderingContext2D, p: number): void {
    if (this.mode === 'hook') {
      const o = this.hand;
      const dx = this.aimX - o.x;
      const dy = this.aimY - o.y;
      const l = Math.hypot(dx, dy) || 1;
      const len = Math.min(this.hookRange, l + 30);
      warnLine(ctx, o.x, o.y, o.x + (dx / l) * len, o.y + (dy / l) * len, 0.35 + 0.65 * p, p > 0.7 ? 2 : 1);
      return;
    }
    if (this.ab === 'spear') {
      const reach = 66 * this.reach;
      warnRect(ctx, this.facing > 0 ? this.x : this.x - reach, this.y - this.h * 0.9, reach, this.h * 0.6, p, this.time);
      return;
    }
    const reach = 58 * this.reach;
    warnRect(ctx, this.facing > 0 ? this.x : this.x - reach, this.y - this.h - 4, reach, this.h + 4, p, this.time);
  }

  protected drawOverlay(): void {
    if (this.dying) return;
    if (this.ab === 'torch') {
      // carries a light: flickering torch flame at the hand
      const o = this.hand;
      this.world.lights.add(o.x, o.y - 8, this.pr('light', 74), '#ff9a3a', 0.8, 0.5);
    }
  }
}
