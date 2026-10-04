import type { BiomeId } from '../run';
import { Abbess, ABBESS_SPEC } from './abbess';
import { Arachne, ARACHNE_SPEC } from './arachne';
import { Valkyrie, VALKYRIE_SPEC } from './valkyrie';
import { Witch, WITCH_SPEC } from './witch';
import type { MiniBoss, MiniBossId, MiniBossSpec } from './base';

export { MiniBoss, MB, type MiniBossId, type MiniBossSpec, type MiniState, type AttackStep } from './base';
export { Abbess, ABBESS, ABBESS_SPEC } from './abbess';
export { Arachne, ARACHNE, ARACHNE_SPEC } from './arachne';
export { Valkyrie, VALKYRIE, VALKYRIE_SPEC } from './valkyrie';
export { Witch, WITCH, WITCH_SPEC } from './witch';

export const MINIBOSS_SPECS: Record<MiniBossId, MiniBossSpec> = {
  mb_abbess: ABBESS_SPEC,
  mb_arachne: ARACHNE_SPEC,
  mb_valkyrie: VALKYRIE_SPEC,
  mb_witch: WITCH_SPEC,
};

/** The two candidates of each biome (the level seed picks one, see `pickMiniBoss`). */
export const MINIBOSS_POOLS: Partial<Record<BiomeId, readonly MiniBossId[]>> = {
  prison: ['mb_abbess', 'mb_arachne'],
  ramparts: ['mb_valkyrie', 'mb_witch'],
};

export const MINIBOSS_IDS: readonly MiniBossId[] = ['mb_abbess', 'mb_arachne', 'mb_valkyrie', 'mb_witch'];

export const isMiniBoss = (e: unknown): e is MiniBoss => !!e && typeof e === 'object' && 'spec' in e && 'bossId' in e && MINIBOSS_IDS.includes((e as MiniBoss).bossId);

/** (x, y) = bottom-centre (feet) of the boss. `tier` 1 = prison, 2 = ramparts scaling (hp x1.6, damage x1.4). */
export function createMiniBoss(id: MiniBossId, x: number, y: number, tier = 1): MiniBoss {
  switch (id) {
    case 'mb_abbess':
      return new Abbess(x, y, tier);
    case 'mb_arachne':
      return new Arachne(x, y, tier);
    case 'mb_valkyrie':
      return new Valkyrie(x, y, tier);
    case 'mb_witch':
      return new Witch(x, y, tier);
  }
}

/** Which of the biome's two mid-bosses a level uses: a pure function of the level seed. null = this biome has none. */
export function pickMiniBoss(biome: BiomeId, seed: number): MiniBossId | null {
  const pool = MINIBOSS_POOLS[biome];
  if (!pool) return null;
  // cheap integer hash so consecutive seeds do not alternate in lock-step
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return pool[h % pool.length];
}
