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
 * 회차 (loops, docs/CONTENT3.md §1): every loop above the first makes the world harder. `k` = steps above loop 1,
 * capped at loop `cap` (loop 5 and later play like loop 5).
 */
export const LOOP = {
  cap: 5,
  /** enemy / mid-boss / Matron hp and damage: + this share per step */
  hp: 0.3,
  dmg: 0.2,
  /** elite chance of biome levels: + this (absolute) per step */
  elite: 0.05,
  /** corpse-shop prices: + this share per step */
  price: 0.5,
  /** golem cost in pieces (`base` in loop 1) and its hp / damage share per step */
  golem: { base: 30, perStep: 15, stat: 0.3 },
} as const;

export const loopK = (loop: number): number => Math.max(0, Math.min(LOOP.cap, Math.floor(loop)) - 1);
export const loopHpMul = (loop: number): number => 1 + LOOP.hp * loopK(loop);
export const loopDmgMul = (loop: number): number => 1 + LOOP.dmg * loopK(loop);
export const loopEliteBonus = (loop: number): number => LOOP.elite * loopK(loop);
export const loopPriceMul = (loop: number): number => 1 + LOOP.price * loopK(loop);
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
 * 시체 조각 (corpse pieces, docs/CONTENT3.md §1): every kill drops pieces; Selma sews the carried ones into the body.
 * 100 pieces make the body whole = the loop is cleared.
 */
export const CORPSE = {
  /** pieces that complete the body */
  body: 100,
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
  /** speed (px/s), the band it keeps behind the heroine, jump speed */
  follow: { speed: 110, near: 40, far: 90, jump: 420 },
  /** teleports back when farther than `dist` from the heroine, or without progress for `stuck` s; reappears `behind` px behind her */
  leash: { dist: 360, stuck: 2.5, behind: 40 },
  invuln: 0.35,
  knockbackTaken: 0.2,
  /** seconds the rag pile stays after it fell; the hp bar shows this long after a hit */
  pileFade: 3,
  barSecs: 3,
} as const;

/** Ordinary loot: [min, max] per kill / chest. */
export const LOOT = {
  enemy: { cells: [1, 2], gold: [2, 6], eliteMult: 4, eliteItemChance: 0.5 },
  chest: { gold: [45, 90], goldPerTier: 15, richMult: 1.5, cells: [2, 5], itemChance: 0.45, foodChance: 0.35 },
} as const;
