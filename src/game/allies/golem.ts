import { Actor } from '../entity';
import { hitArea, type DamageInfo } from '../combat';
import { approach, overlaps, sign } from '../../engine/math';
import { groundUnder } from '../physics';
import type { RunState } from '../run';
import type { World } from '../world';
import type { Player } from '../player/player';
import { GOLEM, TIER_DMG, golemStatMul } from '../rules';

/** hp and damage of the golem in a loop (docs/CONTENT3.md §4): its own base times the loop factor (damage also times the item tier) */
export const golemMaxHp = (loop: number): number => Math.round(GOLEM.hp * golemStatMul(loop));
export const golemDamage = (loop: number, tier: number): number => Math.round(GOLEM.damage * (1 + TIER_DMG * (tier - 1)) * golemStatMul(loop));

/** A new golem at full health: stores it in the run so it follows the heroine through the levels. */
export function newGolemState(run: Pick<RunState, 'loop' | 'golem'>): { hp: number; maxHp: number } {
  const max = golemMaxHp(run.loop);
  return (run.golem = { hp: max, maxHp: max });
}

/**
 * The golem the run carries into a level (if any), beside the heroine: restored from `run.golem`, healed to full in every
 * 쉼터 (`passage` levels). Returns it, or null when the run has none.
 */
export function spawnRunGolem(world: World, player: Player, levelKind: 'biome' | 'passage' | 'boss'): Golem | null {
  const slot = world.run.golem;
  if (!slot) return null;
  if (levelKind === 'passage') slot.hp = slot.maxHp;
  const g = new Golem(player.x - 40, player.y, slot);
  g.facing = player.facing;
  return world.spawn(g);
}

/** where the heroine is */
type Pos = { x: number; y: number; facing: number };

type Mode = 'free' | 'windup' | 'active' | 'recover' | 'dying';

/** the bone-brown of the rag particles */
const RAG = '#b89a72';
/** the cyan of Cinder's ember in the golem's button eyes */
const EMBER = '#4fe3ff';

/**
 * 누더기 골렘, the rag golem Selma stitches (docs/CONTENT3.md §4): a `player`-team Actor that follows the heroine, slams the
 * nearest enemy and falls apart when its hp is gone. Enemies keep targeting the heroine, but their melee / area attacks
 * (`hitArea`) hit it. Its hp lives in `run.golem` (written back every step), so it persists between the levels of a run.
 */
export class Golem extends Actor {
  team = 'player' as const;
  mode: Mode = 'free';
  /** the enemy it is fighting, if any */
  target: Actor | null = null;
  private time = 0;
  private stateT = 0;
  private attackCd = 0.6;
  private jumpCd = 0;
  private hurtT = 0;
  private dropT = 0;
  private lockedFacing: 1 | -1 = 1;
  private hitSet = new Set<number>();
  /** world time of the last hit it took (the hp bar shows for a while after) */
  private lastHit = -99;
  /** best distance to the heroine seen since it last made progress, and for how long it has not improved */
  private bestDist = Infinity;
  private stuckT = 0;

  constructor(x: number, y: number, readonly slot: { hp: number; maxHp: number }) {
    super(x, y);
    this.w = GOLEM.w;
    this.h = GOLEM.h;
    this.maxHp = slot.maxHp;
    this.hp = Math.min(slot.hp, slot.maxHp);
    this.knockbackTaken = GOLEM.knockbackTaken;
    this.alwaysActive = true;
    this.z = 15;
    this.bloodColor = RAG;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('golem'));
    this.anim?.play('idle');
    // spawned inside a wall (next to the heroine at a level start): move out
    const p = this.world.player;
    if (p && this.world.map.boxSolid({ x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h - 1 })) this.warpBehind(p);
  }

  // ------------------------------------------------------------ geometry

  /** the box the slam hits: in front of the body */
  slamBox(): { x: number; y: number; w: number; h: number } {
    const S = GOLEM.slam;
    const f = this.mode === 'free' ? this.facing : this.lockedFacing;
    return { x: f > 0 ? this.x + this.w / 2 - 4 : this.x - this.w / 2 + 4 - S.w, y: this.y - S.h, w: S.w, h: S.h };
  }

  /**
   * the nearest targetable enemy in sight within the aggro box around the golem. One that hovers (or perches) so high that its
   * hurtbox is out of the slam's reach from the floor is not worth a windup: it is left to the heroine until it comes down.
   */
  private pickTarget(): Actor | null {
    const w = this.world;
    const reachTop = this.y - GOLEM.slam.h - GOLEM.reachSlack;
    let best: Actor | null = null;
    let bd = Infinity;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable) continue;
      const dx = Math.abs(a.x - this.x);
      if (dx > GOLEM.aggro.x || Math.abs(a.y - this.y) > GOLEM.aggro.y || dx >= bd) continue;
      const hb = a.hurtbox();
      if (hb.y + hb.h < reachTop) continue;
      if (!w.map.lineOfSight(this.x, this.y - this.h * 0.6, a.cx, a.cy)) continue;
      bd = dx;
      best = a;
    }
    return best;
  }

  // ------------------------------------------------------------ update

  update(dt: number): void {
    this.time += dt;
    this.updateStatus(dt);
    this.stateT += dt;
    if (this.dying) {
      this.updateDying(dt);
      return;
    }
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.jumpCd > 0) this.jumpCd -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.dropT > 0 && (this.dropT -= dt) <= 0) this.dropThrough = false;
    if (this.anim) this.anim.speed = this.status.freeze > 0 ? 0 : 1;
    const p = this.world.player;
    if (this.status.stun > 0 || this.status.freeze > 0) {
      // stunned / frozen: the attack in progress is lost
      if (this.mode !== 'free') this.mode = 'free';
      this.vx = approach(this.vx, 0, (this.onGround ? 900 : 200) * dt);
      this.anim?.play(this.onGround ? 'idle' : 'jump');
    } else if (this.mode === 'free') this.think(dt, p);
    else this.attack(dt);
    super.update(dt);
    this.leash(p);
    this.slot.hp = this.hp;
  }

  /** free mode: fight the nearest enemy, else follow the heroine */
  private think(dt: number, p: Pos): void {
    const t = (this.target = this.pickTarget());
    const F = GOLEM.follow;
    if (t) {
      this.faceX(t.x);
      if (this.attackCd <= 0 && overlaps(this.slamBox(), t.hurtbox())) {
        this.startSlam();
        return;
      }
      // close in until the slam reaches
      const gap = Math.abs(t.x - this.x) - (this.w / 2 + GOLEM.slam.w * 0.6);
      this.run(gap > 0 ? sign(t.x - this.x) : 0, t.y < this.y - 8, t.y < this.y - 30, dt);
      return;
    }
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.abs(dx);
    // keep within the band behind her: far = come closer, inside the band = stand still, too close (she walked into it) =
    // step out of her way (never over a ledge); a platform she stands on up to 80 px above is jumped to, one she is far
    // above / below is walked toward (then the leash takes over)
    const level = Math.abs(dy) <= 80;
    let dir = 0;
    if (d > F.far || (!level && d > 6)) dir = sign(dx);
    else if (level && d < F.near && this.onGround) {
      const away = d < 1 ? -p.facing : -sign(dx);
      if (groundUnder(this, this.world.map, away * (this.w / 2 + 6))) dir = away;
    }
    this.run(dir, dir !== 0 && dir === sign(dx) && dy < -8, dy < -30 && level && d < F.far * 1.6, dt);
    // she is lower and we stand on a one-way platform: drop through it
    if (this.onPlatform && dy > 30 && this.dropT <= 0) {
      this.dropThrough = true;
      this.dropT = 0.25;
    }
    if (d > F.far || !level) this.watchProgress(Math.hypot(dx, dy), dt);
    else {
      this.bestDist = Infinity;
      this.stuckT = 0;
    }
  }

  /**
   * Walk in `dir` (0 = stand still). A wall in the way is jumped when the goal is higher (`wallUp`); `hopUp` = a platform
   * above that is meant to be reached: jump from right below it.
   */
  private run(dir: number, wallUp: boolean, hopUp: boolean, dt: number): void {
    const F = GOLEM.follow;
    if (dir !== 0) {
      this.faceX(this.x + dir);
      this.vx = dir * F.speed;
    } else this.vx = approach(this.vx, 0, 900 * dt);
    if (this.onGround && this.jumpCd <= 0 && ((dir !== 0 && wallUp && this.hitWallX === dir) || (dir === 0 && hopUp))) {
      this.vy = -F.jump;
      this.onGround = false;
      this.jumpCd = 0.6;
      this.world.particles.emit('dust', this.x, this.y, { count: 4 });
    }
    if (this.hurtT > 0) this.anim?.play('hurt');
    else this.anim?.play(!this.onGround ? 'jump' : Math.abs(this.vx) > 12 ? 'walk' : 'idle');
  }

  private faceX(x: number): void {
    if (Math.abs(x - this.x) > 3) this.facing = x > this.x ? 1 : -1;
  }

  /** no closer to the heroine for too long = stuck behind something */
  private watchProgress(dist: number, dt: number): void {
    if (dist < this.bestDist - 6) {
      this.bestDist = dist;
      this.stuckT = 0;
    } else this.stuckT += dt;
  }

  // ------------------------------------------------------------ slam

  private startSlam(): void {
    const S = GOLEM.slam;
    this.lockedFacing = this.facing;
    this.mode = 'windup';
    this.stateT = 0;
    this.attackCd = S.cooldown;
    this.hitSet = new Set();
    this.vx = 0;
    this.anim?.playPhased('attack', S.windup, S.active, S.recover);
  }

  private attack(dt: number): void {
    const S = GOLEM.slam;
    const w = this.world;
    this.facing = this.lockedFacing;
    this.vx = approach(this.vx, 0, 1200 * dt);
    if (this.mode === 'windup') {
      if (this.stateT >= S.windup) {
        this.mode = 'active';
        this.stateT = 0;
        const f = this.lockedFacing;
        w.audio.play('slam', { vol: 0.7 });
        w.shake(3, 0.2);
        w.particles.emit('slam', this.x + f * (this.w / 2 + S.w * 0.6), this.y, { dir: f, count: 8 });
        w.particles.emit('debris', this.x + f * (this.w / 2 + S.w * 0.6), this.y - 6, { count: 4, color: RAG });
        w.fx.slash(this.x + f * 26, this.y - 42, { dir: f, radius: 46, from: -1.2, to: 0.6, color: '#e8dcc4', width: 4, life: 0.18 });
      }
    }
    if (this.mode === 'active') {
      const info: DamageInfo = {
        amount: golemDamage(w.run.loop, w.run.tier), dir: this.lockedFacing, kind: 'melee', source: this,
        knockback: S.knockback, stun: S.stun,
      };
      // its slam hurts enemies but is not the heroine's: it does not break secret walls
      const hits = hitArea(w, this.slamBox(), 'player', info, this.hitSet, { breakTiles: false });
      if (hits.some((h) => h.result.applied)) {
        w.addHitstop(0.04);
        w.audio.play('hit_heavy', { vol: 0.8 });
      }
      if (this.stateT >= S.active) {
        this.mode = 'recover';
        this.stateT = 0;
      }
    } else if (this.mode === 'recover' && this.stateT >= S.recover) {
      this.mode = 'free';
      this.stateT = 0;
    }
  }

  // ------------------------------------------------------------ leash

  /** too far away, stuck or off the map: reappear behind the heroine in a puff of rags */
  private leash(p: Pos): void {
    if (this.dying) return;
    const map = this.world.map;
    const L = GOLEM.leash;
    const off = this.y > map.pxH + 40 || this.x < -40 || this.x > map.pxW + 40;
    if (off || Math.hypot(p.x - this.x, p.y - this.y) > L.dist || this.stuckT >= L.stuck) this.warpBehind(p);
  }

  /** put the golem behind the heroine (else in front of her, else on top of her) where it fits; false if nowhere does */
  private warpBehind(p: Pos): boolean {
    const w = this.world;
    for (const tx of [p.x - p.facing * GOLEM.leash.behind, p.x + p.facing * GOLEM.leash.behind, p.x]) {
      if (w.map.boxSolid({ x: tx - this.w / 2, y: p.y - this.h, w: this.w, h: this.h - 1 })) continue;
      w.particles.emit('debris', this.x, this.y - this.h / 2, { count: 8, color: RAG });
      this.x = tx;
      this.y = p.y;
      this.vx = this.vy = 0;
      this.stuckT = 0;
      this.bestDist = Infinity;
      this.mode = 'free';
      w.particles.emit('debris', this.x, this.y - this.h / 2, { count: 8, color: RAG });
      w.particles.emit('dust', this.x, this.y, { count: 6, w: 30 });
      w.audio.play('roll', { vol: 0.5, pitch: 0.7 });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ damage

  protected onHurt(_info: DamageInfo, _amount: number): void {
    this.invuln = GOLEM.invuln;
    this.lastHit = this.time;
    if (this.mode === 'free') this.hurtT = 0.2;
    else this.facing = this.lockedFacing;
  }

  die(info: DamageInfo): void {
    super.die(info);
    const w = this.world;
    this.mode = 'dying';
    this.stateT = 0;
    this.vx = 0;
    this.anim?.play('death');
    w.run.golem = null;
    w.audio.play('enemy_death', { vol: 0.8 });
    w.particles.emit('debris', this.x, this.y - this.h / 2, { count: 14, color: RAG });
    w.emit({ type: 'toast', text: '골렘이 쓰러졌다', color: '#ffb347' });
  }

  /** the heap of rags lies there for a while, then fades */
  private updateDying(dt: number): void {
    this.vx = approach(this.vx, 0, 700 * dt);
    if (this.stateT >= GOLEM.pileFade + 0.6) this.dead = true;
    super.update(dt);
  }

  // ------------------------------------------------------------ drawing

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.anim) return;
    const alpha = this.dying ? Math.max(0, Math.min(1, (GOLEM.pileFade + 0.6 - this.stateT) / 0.6)) : 1;
    this.drawSprite(ctx, { alpha });
    if (this.dying) return;
    this.world.lights.add(this.x, this.y - this.h * 0.7, 50, EMBER, 0.28);
    if (this.time - this.lastHit < GOLEM.barSecs && this.hp > 0) {
      // above her head (the sprite is taller than the hitbox), not across her face
      const bw = GOLEM.barW;
      const bx = Math.round(this.x - bw / 2);
      const by = Math.round(this.y - GOLEM.barY);
      ctx.fillStyle = '#07060b';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = '#2a1424';
      ctx.fillRect(bx, by, bw, 3);
      ctx.fillStyle = EMBER;
      ctx.fillRect(bx, by, Math.max(1, Math.round((bw * this.hp) / this.maxHp)), 3);
    }
  }
}
