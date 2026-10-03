import { Actor } from '../entity';
import type { DamageInfo } from '../combat';
import { hitArea } from '../combat';

export type EnemyKind = 'ghoul' | 'jailer' | 'archer' | 'bomber' | 'harpy' | 'lancer';

import type { BiomeId } from '../run';

/** Which enemies appear in which biome (weights). 'flyer' spawn markers use FLYERS. */
export const ENEMY_POOLS: Record<BiomeId, { kind: EnemyKind; weight: number }[]> = {
  prison: [{ kind: 'ghoul', weight: 5 }, { kind: 'jailer', weight: 2 }, { kind: 'archer', weight: 2 }, { kind: 'bomber', weight: 1.5 }],
  ramparts: [{ kind: 'lancer', weight: 3 }, { kind: 'archer', weight: 2 }, { kind: 'bomber', weight: 2 }, { kind: 'jailer', weight: 1.5 }, { kind: 'ghoul', weight: 1 }],
  tower: [],
};
export const FLYERS: Record<BiomeId, EnemyKind[]> = { prison: ['harpy'], ramparts: ['harpy'], tower: [] };

export interface EnemyOpts {
  /** 1 = prison, 2 = ramparts (scales hp/damage) */
  tier: number;
  elite: boolean;
}

/**
 * Create an enemy. OWNER: enemies agent — this stub makes a dumb walker so the core runs.
 */
export function createEnemy(kind: EnemyKind, x: number, y: number, opts: EnemyOpts): Actor {
  return new StubEnemy(kind, x, y, opts);
}

class StubEnemy extends Actor {
  private kind: EnemyKind;
  private cd = 1;

  constructor(kind: EnemyKind, x: number, y: number, _o: EnemyOpts) {
    super(x, y);
    this.kind = kind;
    this.w = 16;
    this.h = 40;
    this.hp = this.maxHp = 40;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet(this.kind));
  }

  update(dt: number): void {
    this.updateStatus(dt);
    const p = this.world.player;
    if (!this.dying && !this.incapacitated) {
      const dx = p.x - this.x;
      this.facing = dx > 0 ? 1 : -1;
      this.vx = Math.abs(dx) > 30 ? this.facing * 40 : 0;
      this.cd -= dt;
      if (this.cd <= 0 && Math.abs(dx) < 40) {
        this.cd = 1.5;
        hitArea(this.world, { x: this.x - 30, y: this.y - 40, w: 60, h: 40 }, 'enemy', { amount: 8, dir: this.facing, kind: 'melee', knockback: 150 });
      }
    } else if (!this.dying) this.vx *= 0.9;
    super.update(dt);
    this.anim?.play(this.dying ? 'death' : Math.abs(this.vx) > 1 ? 'walk' : 'idle');
    if (this.dying && this.anim?.finished) this.dead = true;
  }

  die(info: DamageInfo): void {
    super.die(info);
    this.vx = 0;
    this.anim?.play('death', true);
    this.world.emit({ type: 'enemyKilled', enemy: this, elite: false });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawSprite(ctx);
  }
}
