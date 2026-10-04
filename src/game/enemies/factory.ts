import type { Actor } from '../entity';
import { Ghoul } from './ghoul';
import { Jailer } from './jailer';
import { Archer } from './archer';
import { Bomber } from './bomber';
import { Harpy } from './harpy';
import { Lancer } from './lancer';
import type { EnemyOpts } from './base';
import { ENEMY_DEFS, ENEMY_POOLS, FLYERS, pickEnemy, type EnemyKind } from './variants';

export type { EnemyKind, BaseKind, VariantId } from './variants';
export type { EnemyOpts } from './base';
/**
 * Which enemies appear in which biome (weights; 'flyer' spawn markers use FLYERS). Derived from the
 * variant table (variants.ts); level building uses the depth-aware `pickEnemy` instead.
 */
export { ENEMY_POOLS, FLYERS, pickEnemy };

/**
 * Create an enemy of the given kind - one of the six bases or any of the 24 variants (variants.ts).
 * `tier` 2 = ×1.6 hp, ×1.4 damage; `elite` = ×3 hp, aura (no size change).
 */
export function createEnemy(kind: EnemyKind, x: number, y: number, opts: Partial<EnemyOpts> = {}): Actor {
  const def = ENEMY_DEFS[kind];
  if (!def) throw new Error(`unknown enemy kind: ${kind}`);
  const v = def.variant ? def : null;
  switch (def.base) {
    case 'ghoul':
      return new Ghoul(x, y, opts, v);
    case 'jailer':
      return new Jailer(x, y, opts, v);
    case 'archer':
      return new Archer(x, y, opts, v);
    case 'bomber':
      return new Bomber(x, y, opts, v);
    case 'harpy':
      return new Harpy(x, y, opts, v);
    case 'lancer':
      return new Lancer(x, y, opts, v);
  }
}
