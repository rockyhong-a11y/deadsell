import type { Actor } from '../entity';
import type { BiomeId } from '../run';
import { Ghoul } from './ghoul';
import { Jailer } from './jailer';
import { Archer } from './archer';
import { Bomber } from './bomber';
import { Harpy } from './harpy';
import { Lancer } from './lancer';
import type { EnemyKind, EnemyOpts } from './base';

export type { EnemyKind, EnemyOpts } from './base';

/** Which enemies appear in which biome (weights). 'flyer' spawn markers use FLYERS. */
export const ENEMY_POOLS: Record<BiomeId, { kind: EnemyKind; weight: number }[]> = {
  prison: [{ kind: 'ghoul', weight: 5 }, { kind: 'jailer', weight: 2 }, { kind: 'archer', weight: 2 }, { kind: 'bomber', weight: 1.5 }],
  ramparts: [{ kind: 'lancer', weight: 3 }, { kind: 'archer', weight: 2 }, { kind: 'bomber', weight: 2 }, { kind: 'jailer', weight: 1.5 }, { kind: 'ghoul', weight: 1 }],
  tower: [],
};
export const FLYERS: Record<BiomeId, EnemyKind[]> = { prison: ['harpy'], ramparts: ['harpy'], tower: [] };

/** Create an enemy of the given kind. `tier` 2 = ×1.6 hp, ×1.4 damage; `elite` = ×3 hp, 1.3× scale, aura. */
export function createEnemy(kind: EnemyKind, x: number, y: number, opts: Partial<EnemyOpts> = {}): Actor {
  switch (kind) {
    case 'ghoul':
      return new Ghoul(x, y, opts);
    case 'jailer':
      return new Jailer(x, y, opts);
    case 'archer':
      return new Archer(x, y, opts);
    case 'bomber':
      return new Bomber(x, y, opts);
    case 'harpy':
      return new Harpy(x, y, opts);
    case 'lancer':
      return new Lancer(x, y, opts);
  }
}
