import type { ItemColor } from './combat';
import type { ItemInstance } from './items/types';

export type BiomeId = 'prison' | 'ramparts' | 'tower';

export interface LevelSpec {
  kind: 'biome' | 'passage' | 'boss';
  biome: BiomeId;
  /** Korean display name */
  name: string;
}

/** The fixed order of levels in a run (docs/DESIGN.md §2). */
export const LEVEL_SEQUENCE: LevelSpec[] = [
  { kind: 'biome', biome: 'prison', name: '가라앉은 감옥' },
  { kind: 'passage', biome: 'prison', name: '통로' },
  { kind: 'biome', biome: 'ramparts', name: '달빛 성벽' },
  { kind: 'passage', biome: 'ramparts', name: '통로' },
  { kind: 'boss', biome: 'tower', name: '사슬의 종탑' },
];

/** Everything that persists between the levels of a single run. */
export class RunState {
  seed: number;
  levelIndex = 0;
  baseMaxHp = 100;
  hp = 100;
  flasks = 1;
  maxFlasks = 1;
  stats: Record<ItemColor, number> = { brutality: 0, tactics: 0, survival: 0 };
  /** [primary, secondary] */
  weapons: (ItemInstance | null)[] = [null, null];
  skills: (ItemInstance | null)[] = [null, null];
  gold = 0;
  cells = 0;
  kills = 0;
  /** seconds of play in this run */
  time = 0;
  scrolls = 0;
  cellsSpentThisRun = 0;
  bossDefeated = false;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  get level(): LevelSpec {
    return LEVEL_SEQUENCE[Math.min(this.levelIndex, LEVEL_SEQUENCE.length - 1)];
  }

  /** Item tier for drops on the current level (prison 1, ramparts 2, boss 3). */
  get tier(): number {
    return this.levelIndex >= 2 ? 2 : 1;
  }

  get maxHp(): number {
    const s = this.stats;
    return Math.round(this.baseMaxHp * (1 + 0.1 * (s.brutality + s.tactics) + 0.2 * s.survival));
  }

  /** Damage multiplier for an item of the given colour. */
  damageMult(color: ItemColor): number {
    return 1 + 0.15 * this.stats[color];
  }

  /** Apply a scroll of power: +1 level, HP grows and is healed by the gained amount. */
  addStat(color: ItemColor): void {
    const before = this.maxHp;
    this.stats[color]++;
    this.scrolls++;
    this.hp += this.maxHp - before;
  }
}
