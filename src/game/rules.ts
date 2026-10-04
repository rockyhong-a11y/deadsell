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

/** hp / damage multipliers of an enemy: tier 2 (ramparts and later), elite, and its variant's own factor. */
export function enemyHpMul(variantHp: number, tier: number, elite: boolean): number {
  return (tier >= 2 ? TIER2.hp : 1) * (elite ? ELITE.hp : 1) * variantHp;
}
export function enemyDmgMul(variantDmg: number, tier: number, elite: boolean): number {
  return (tier >= 2 ? TIER2.dmg : 1) * (elite ? ELITE.dmg : 1) * variantDmg;
}

/** Ordinary loot: [min, max] per kill / chest. */
export const LOOT = {
  enemy: { cells: [1, 2], gold: [2, 6], eliteMult: 4, eliteItemChance: 0.5 },
  chest: { gold: [45, 90], goldPerTier: 15, richMult: 1.5, cells: [2, 5], itemChance: 0.45, foodChance: 0.35 },
} as const;
