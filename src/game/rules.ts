/**
 * Shared tuning constants that gameplay code AND the codex (도감, ui/codexData.ts) read.
 * Pure data, no imports from game classes, so any module (and the unit tests) can use it.
 * If a number is shown to the player somewhere, it lives here (or in the table of its owner), never copied.
 */

/** A critical hit multiplies the damage of the hit (spear 3rd thrust, dagger hits from behind). */
export const CRIT_MULT = 2;

/** Each item tier above 1 adds this share of the base damage (calcDamage, item cards). */
export const TIER_DMG = 0.25;

/** Item affixes ("접사"). */
export const AFFIX = {
  /** `burn`: seconds of burning and damage per second */
  burnSecs: 3,
  burnDps: 6,
  /** `bleed`: seconds, and the most stacks a target can carry */
  bleedSecs: 3,
  bleedStacks: 5,
  /** `dmg`: damage multiplier */
  dmgMul: 1.2,
  /** `speed`: duration multiplier of swings / the bow draw (0.85 = 15 % faster) */
  speedMul: 0.85,
  /** `heal_on_kill`: share of max HP healed per kill */
  healPct: 0.05,
} as const;

/** Chance that a rolled item carries an affix: `base` at tier 1, `perTier` more per tier, at most `max`. */
export const AFFIX_ROLL = { base: 0.3, perTier: 0.15, max: 0.8 } as const;

/** Scroll of power: per level (one per scroll read) of the chosen colour. */
export const SCROLL = {
  /** damage bonus of that colour's equipment */
  dmgPerLevel: 0.15,
  /** max HP bonus (`baseMaxHp` share) */
  hpPerLevel: { brutality: 0.1, tactics: 0.1, survival: 0.2 },
} as const;

/** Healing flask: share of max HP healed, over this many seconds. */
export const FLASK = { healPct: 0.6, healTime: 0.7 } as const;

/** Food pickups (pickups sheet sprite + share of max HP healed). The chest drops bread, the Matron meat. */
export const FOODS = [
  { id: 'apple', sprite: 'food_apple', healPct: 0.25 },
  { id: 'bread', sprite: 'food_bread', healPct: 0.35 },
  { id: 'meat', sprite: 'food_meat', healPct: 0.5 },
] as const;

/** Enemy scaling: tier 2 (ramparts and later) and elites. */
export const TIER2 = { hp: 1.6, dmg: 1.4 } as const;
export const ELITE = { hp: 3, dmg: 1.25, speed: 1.15, knockbackTaken: 0.5 } as const;

/**
 * 회차 (loops, docs/CONTENT3.md §1, advanced by killing the Iron Matron: docs/CONTENT4.md §0): every loop above the first makes
 * the world harder. `k` = steps above loop 1, capped at loop `cap` (loop 5 and later play like loop 5).
 */
export const LOOP = {
  cap: 5,
  /** enemy / mid-boss / Matron hp and damage: + this share per step */
  hp: 0.3,
  dmg: 0.2,
  /** elite chance of biome levels: + this (absolute) per step */
  elite: 0.05,
  /** golem cost in pieces (`base` in loop 1) and its hp / damage share per step */
  golem: { base: 30, perStep: 15, stat: 0.3 },
} as const;

export const loopK = (loop: number): number => Math.max(0, Math.min(LOOP.cap, Math.floor(loop)) - 1);
export const loopHpMul = (loop: number): number => 1 + LOOP.hp * loopK(loop);
export const loopDmgMul = (loop: number): number => 1 + LOOP.dmg * loopK(loop);
export const loopEliteBonus = (loop: number): number => LOOP.elite * loopK(loop);
export const golemCost = (loop: number): number => LOOP.golem.base + LOOP.golem.perStep * loopK(loop);
export const golemStatMul = (loop: number): number => 1 + LOOP.golem.stat * loopK(loop);

/** hp / damage multipliers of an enemy: tier 2 (ramparts and later), elite, its variant's own factor and the loop. */
export function enemyHpMul(variantHp: number, tier: number, elite: boolean, loop = 1): number {
  return (tier >= 2 ? TIER2.hp : 1) * (elite ? ELITE.hp : 1) * variantHp * loopHpMul(loop);
}
export function enemyDmgMul(variantDmg: number, tier: number, elite: boolean, loop = 1): number {
  return (tier >= 2 ? TIER2.dmg : 1) * (elite ? ELITE.dmg : 1) * variantDmg * loopDmgMul(loop);
}

/**
 * 시체 조각 (corpse pieces, docs/CONTENT3.md §1, docs/CONTENT4.md §3): every kill drops pieces; the carried ones are banked
 * when a 쉼터 is entered (or on victory) and pay for Selma's crafting and the golem.
 */
export const CORPSE = {
  /** pieces dropped per kill */
  drop: { enemy: 1, elite: 3, miniboss: 8, matron: 12 },
  /** a pickup worth this many or more uses the big sprite, and one pickup holds at most this many */
  big: 3,
} as const;

/** 누더기 골렘 (rag golem, docs/CONTENT3.md §4). Hp and damage are multiplied by `golemStatMul(loop)`; damage also by the item tier. */
export const GOLEM = {
  hp: 300,
  damage: 26,
  /** hitbox (px) */
  w: 30,
  h: 64,
  slam: { windup: 0.45, active: 0.1, recover: 0.5, cooldown: 1.2, w: 72, h: 56, knockback: 180, stun: 0.6 },
  /** enemies this close (horizontally / vertically) to the golem are attacked */
  aggro: { x: 140, y: 70 },
  /** ... unless their hurtbox is more than this many px above the top of the slam box (a flyer it could not hit) */
  reachSlack: 12,
  /** speed (px/s), the band it keeps behind the heroine, jump speed */
  follow: { speed: 110, near: 40, far: 90, jump: 420 },
  /** teleports back when farther than `dist` from the heroine, or without progress for `stuck` s; reappears `behind` px behind her */
  leash: { dist: 360, stuck: 2.5, behind: 40 },
  invuln: 0.35,
  knockbackTaken: 0.2,
  /** seconds the rag pile stays after it fell; the hp bar shows this long after a hit */
  pileFade: 3,
  barSecs: 3,
  /** the hp bar: width, and its height above the feet (just over the sprite's head, which is taller than the hitbox) */
  barW: 36,
  barY: 104,
} as const;

/** Ordinary loot: [min, max] per kill / chest. */
export const LOOT = {
  enemy: { cells: [1, 2], gold: [2, 6], eliteMult: 4, eliteItemChance: 0.5 },
  chest: { gold: [45, 90], goldPerTier: 15, richMult: 1.5, cells: [2, 5], itemChance: 0.45, foodChance: 0.35 },
} as const;

/**
 * 질주 (sprint, docs/CONTENT4.md §1): holding a direction on the ground for `runUp` s starts it (speed x `mult`); `streakKills`
 * kills within `streakWindow` s of each other start the 광란 질주 (frenzy): for `frenzyTime` s every movement is a sprint at once,
 * each further kill refreshing it. Releasing the direction for less than `endGrace` s does not end it (touch jitter).
 */
export const SPRINT = {
  runUp: 0.9,
  mult: 1.6,
  /** jumping out of a sprint keeps the horizontal sprint speed until landing (or turning) */
  airKeep: true,
  streakKills: 3,
  streakWindow: 2.5,
  frenzyTime: 5,
  endGrace: 0.12,
  /** after-images: seconds between stored frames, how many are drawn, their alpha (newest to oldest) and tints */
  after: { interval: 0.05, count: 4, alpha: [0.35, 0.08], color: '#4fe3ff', frenzyColor: '#ff4a6a' },
  /** frames of the `sprint` animation where a foot lands (a dust puff each) */
  footFrames: [0, 4],
} as const;

/** 보관함 (stash, docs/CONTENT4.md §2): permanent, `capacity` items in a `cols`-wide grid; `shardCap` = most bell shards a save keeps. */
export const STASH = { capacity: 24, cols: 6, shardCap: 99 } as const;

/** Unique item grades, lowest first (docs/CONTENT4.md §4). */
export const GRADE_IDS = ['C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
export type Grade = (typeof GRADE_IDS)[number];

/** Per grade: badge colour (`outline` = a second ring), pieces a salvaged unique yields, and its power target (DPS over the same family's normal item at equal tier). */
export const GRADES: Record<Grade, { color: string; outline?: string; salvage: number; power: number }> = {
  C: { color: '#9aa4b2', salvage: 5, power: 0.15 },
  B: { color: '#5ec24a', salvage: 10, power: 0.2 },
  A: { color: '#4f9dff', salvage: 20, power: 0.3 },
  S: { color: '#b05be8', salvage: 35, power: 0.45 },
  SS: { color: '#ff9a3d', salvage: 55, power: 0.6 },
  SSS: { color: '#ff4a58', outline: '#ffd23f', salvage: 80, power: 0.8 },
};

/**
 * One stash line of a recipe: `n` entries that are not uniques - any, with an affix, of tier `CRAFT_MIN_TIER` or more, or dropped by a
 * mid-boss (`mb`) - or `n` uniques of one grade.
 */
export type Material = { n: number; what: 'any' | 'affix' | 'tier' | 'mb' } | { n: number; what: 'unique'; grade: Grade };

/** What a unique of a grade costs: stash lines, bell shards (`minLoop` = the loop they must have been won in), bank pieces; `tier` = the crafted unique's item tier. */
export interface Recipe {
  items: Material[];
  shards: { n: number; minLoop: number } | null;
  pieces: number;
  tier: number;
}

/** The `tier` material line asks for items of at least this tier. */
export const CRAFT_MIN_TIER = 2;

/** Crafting at Selma (docs/CONTENT4.md §4). Crafted uniques carry no affix. */
export const CRAFT: Record<Grade, Recipe> = {
  C: { items: [{ n: 3, what: 'any' }], shards: null, pieces: 10, tier: 1 },
  B: { items: [{ n: 3, what: 'affix' }], shards: null, pieces: 20, tier: 2 },
  A: { items: [{ n: 2, what: 'tier' }, { n: 1, what: 'mb' }], shards: null, pieces: 35, tier: 2 },
  S: { items: [{ n: 1, what: 'unique', grade: 'A' }, { n: 2, what: 'mb' }], shards: { n: 1, minLoop: 1 }, pieces: 50, tier: 3 },
  SS: { items: [{ n: 1, what: 'unique', grade: 'S' }, { n: 1, what: 'unique', grade: 'A' }], shards: { n: 2, minLoop: 2 }, pieces: 80, tier: 3 },
  SSS: { items: [{ n: 1, what: 'unique', grade: 'SS' }, { n: 1, what: 'unique', grade: 'S' }], shards: { n: 3, minLoop: 3 }, pieces: 120, tier: 4 },
};
