import type { BiomeId } from '../run';
import type { Rng } from '../../engine/rng';

/**
 * Enemy variant table (docs/CONTENT2.md §1): 6 bases + 24 variants = 30 enemy types.
 * Pure data + the spawn picker; the behaviour twists live in the base AIs (enemies/*.ts), which read
 * `ability` and `p` (ability params). Keep this file free of imports from the enemy classes.
 */
export type BaseKind = 'ghoul' | 'jailer' | 'archer' | 'bomber' | 'harpy' | 'lancer';
export type VariantId =
  | 'ghoul_plague' | 'ghoul_frenzy' | 'ghoul_shackled' | 'ghoul_wraith'
  | 'jailer_warden' | 'jailer_torch' | 'jailer_spear' | 'jailer_chain'
  | 'archer_fire' | 'archer_volley' | 'archer_crossbow' | 'archer_shadow'
  | 'bomber_frost' | 'bomber_cluster' | 'bomber_kamikaze' | 'bomber_alchemist'
  | 'harpy_storm' | 'harpy_raven' | 'harpy_siren' | 'harpy_ember'
  | 'lancer_halberd' | 'lancer_paladin' | 'lancer_duelist' | 'lancer_dragoon';
/** Every enemy type id; also the sprite sheet name (`assets.sheet(id)`). */
export type EnemyKind = BaseKind | VariantId;

export const BASE_KINDS: readonly BaseKind[] = ['ghoul', 'jailer', 'archer', 'bomber', 'harpy', 'lancer'];

/** Where / from which level progress (`depth` 0..1) an enemy may spawn, and how often. */
export interface Placement {
  w: number;
  /** earliest `depth` (0..1) at which it shows up ("late" variants use 0.4) */
  min?: number;
}

export interface EnemyDef {
  id: EnemyKind;
  base: BaseKind;
  /** Korean display name */
  name: string;
  /** sprite sheet name (= id) */
  sheet: string;
  /** false for the six bases */
  variant: boolean;
  /** hp / damage / speed multipliers on top of the base spec */
  hp: number;
  dmg: number;
  speed: number;
  /** behaviour tag read by the base AI ('' = the base behaviour) */
  ability: string;
  /** ability parameters */
  p: Record<string, number>;
  /** hue (deg) of the outline used while the variant's own sheet is not built yet */
  hue: number;
  flyer?: boolean;
  spawn: Partial<Record<BiomeId, Placement>>;
}

const LATE = 0.4;

function def(
  id: EnemyKind,
  base: BaseKind,
  name: string,
  o: { hp?: number; dmg?: number; speed?: number; ability?: string; p?: Record<string, number>; hue?: number; spawn: Partial<Record<BiomeId, Placement>> },
): EnemyDef {
  return {
    id, base, name, sheet: id, variant: id !== base,
    hp: o.hp ?? 1, dmg: o.dmg ?? 1, speed: o.speed ?? 1,
    ability: o.ability ?? '', p: o.p ?? {}, hue: o.hue ?? 0,
    flyer: base === 'harpy',
    spawn: o.spawn,
  };
}

const P = (w: number, min = 0): Placement => ({ w, min });

const DEFS: EnemyDef[] = [
  // ---- ghoul family (prison)
  def('ghoul', 'ghoul', '구울', { spawn: { prison: P(5), ramparts: P(1) } }),
  def('ghoul_plague', 'ghoul', '역병 구울', {
    hp: 1.25, speed: 0.7, ability: 'plague', hue: 100,
    p: { cloudR: 40, cloudLife: 3, cloudDps: 4 },
    spawn: { prison: P(2.2) },
  }),
  def('ghoul_frenzy', 'ghoul', '광란 구울', {
    hp: 0.7, dmg: 0.8, speed: 1.35, ability: 'frenzy', hue: 355,
    p: { swipes: 2 },
    spawn: { prison: P(2, LATE), ramparts: P(1.2) },
  }),
  def('ghoul_shackled', 'ghoul', '족쇄 구울', {
    hp: 1.3, dmg: 1.4, speed: 0.75, ability: 'shackled', hue: 215,
    p: { reach: 1.7, knock: 340 },
    spawn: { prison: P(1.8, 0.15) },
  }),
  def('ghoul_wraith', 'ghoul', '망령 구울', {
    hp: 0.8, ability: 'wraith', hue: 185,
    p: { blink: 90, blinkCd: 4 },
    spawn: { prison: P(1.6, LATE), ramparts: P(1, 0.1) },
  }),

  // ---- jailer family
  def('jailer', 'jailer', '여간수', { spawn: { prison: P(2), ramparts: P(1.5) } }),
  def('jailer_warden', 'jailer', '수석 간수', {
    hp: 1.4, dmg: 1.15, speed: 0.9, ability: 'warden', hue: 270,
    p: { waveSpeed: 230, waveDist: 170, waveDmg: 8 },
    spawn: { prison: P(1.2, LATE), ramparts: P(1) },
  }),
  def('jailer_torch', 'jailer', '횃불 간수', {
    hp: 0.9, dmg: 0.9, speed: 1.05, ability: 'torch', hue: 28,
    p: { burn: 3, burnDps: 5, light: 74 },
    spawn: { prison: P(1.4, 0.1) },
  }),
  def('jailer_spear', 'jailer', '창 간수', {
    hp: 0.95, ability: 'spear', hue: 215,
    p: { reach: 1.6 },
    spawn: { prison: P(1.4, 0.1), ramparts: P(1) },
  }),
  def('jailer_chain', 'jailer', '사슬 간수', {
    hp: 0.95, ability: 'chain', hue: 50,
    p: { hookRange: 180, hookSpeed: 460, hookDmg: 5, pull: 430, noShield: 1 },
    spawn: { prison: P(1.2, LATE), ramparts: P(1) },
  }),

  // ---- archer family
  def('archer', 'archer', '궁수', { spawn: { prison: P(2), ramparts: P(2) } }),
  def('archer_fire', 'archer', '화염 궁수', {
    ability: 'fire', hue: 18,
    p: { burn: 3, burnDps: 5 },
    spawn: { prison: P(1.4, 0.1), ramparts: P(1.4) },
  }),
  def('archer_volley', 'archer', '연사 궁수', {
    hp: 0.9, dmg: 0.75, ability: 'volley', hue: 175,
    p: { arrows: 3, spread: 12, windup: 0.7 },
    spawn: { ramparts: P(1.6) },
  }),
  def('archer_crossbow', 'archer', '석궁수', {
    hp: 1.3, dmg: 1.8, speed: 0.85, ability: 'crossbow', hue: 40,
    p: { windup: 1.2, boltSpeed: 520 },
    spawn: { prison: P(1.2, LATE), ramparts: P(1.4) },
  }),
  def('archer_shadow', 'archer', '그림자 궁수', {
    hp: 0.8, speed: 1.1, ability: 'shadow', hue: 285,
    p: { blinkRange: 120, blinkCd: 3.2, trigger: 90 },
    spawn: { ramparts: P(1.4, 0.15) },
  }),

  // ---- bomber family
  def('bomber', 'bomber', '폭탄마', { spawn: { prison: P(1.5), ramparts: P(2) } }),
  def('bomber_frost', 'bomber', '서리 폭탄마', {
    dmg: 0.6, ability: 'frost', hue: 195,
    p: { freeze: 2 },
    spawn: { ramparts: P(1.6) },
  }),
  def('bomber_cluster', 'bomber', '집속 폭탄마', {
    hp: 1.1, speed: 0.9, ability: 'cluster', hue: 55,
    p: { split: 3, bombletDmg: 0.55, bombletR: 30 },
    spawn: { ramparts: P(1.6) },
  }),
  def('bomber_kamikaze', 'bomber', '자폭병', {
    hp: 0.6, dmg: 1.5, speed: 1.8, ability: 'kamikaze', hue: 5,
    p: { radius: 50, fuse: 0.55 },
    spawn: { prison: P(1.4, LATE), ramparts: P(1.4) },
  }),
  def('bomber_alchemist', 'bomber', '독약사', {
    dmg: 0.5, ability: 'alchemist', hue: 125,
    p: { puddleR: 36, puddleLife: 2.5, puddleDps: 6 },
    spawn: { prison: P(1.2, 0.15) },
  }),

  // ---- harpy family (flyers)
  def('harpy', 'harpy', '하피', { spawn: { prison: P(1), ramparts: P(2) } }),
  def('harpy_storm', 'harpy', '폭풍 하피', {
    hp: 0.9, dmg: 0.8, speed: 0.95, ability: 'storm', hue: 205,
    p: { feathers: 3, spread: 14, windup: 0.65, range: 300, featherSpeed: 250 },
    spawn: { ramparts: P(2, 0.05) },
  }),
  def('harpy_raven', 'harpy', '까마귀 하피', {
    dmg: 1.1, speed: 1.4, ability: 'raven', hue: 350,
    p: { windup: 0.4 },
    spawn: { ramparts: P(2) },
  }),
  def('harpy_siren', 'harpy', '세이렌', {
    speed: 0.9, ability: 'siren', hue: 320,
    p: { songR: 170, songSpeed: 200, slow: 0.4, slowT: 2, songCd: 7, windup: 0.8 },
    spawn: { ramparts: P(1.6, 0.2) },
  }),
  def('harpy_ember', 'harpy', '불꽃 하피', {
    ability: 'ember', hue: 22,
    p: { fireLife: 2, fireW: 46, fireDps: 6 },
    spawn: { prison: P(1, LATE), ramparts: P(1.5) },
  }),

  // ---- lancer family (ramparts)
  def('lancer', 'lancer', '창기병', { spawn: { ramparts: P(3) } }),
  def('lancer_halberd', 'lancer', '미늘창 기사', {
    hp: 1.25, dmg: 0.9, speed: 0.85, ability: 'halberd', hue: 220,
    p: { reach: 70, hits: 2 },
    spawn: { ramparts: P(2) },
  }),
  def('lancer_paladin', 'lancer', '성기사', {
    hp: 1.3, speed: 0.85, ability: 'paladin', hue: 48,
    spawn: { ramparts: P(2, 0.1) },
  }),
  def('lancer_duelist', 'lancer', '결투가', {
    hp: 0.85, dmg: 0.75, speed: 1.2, ability: 'duelist', hue: 305,
    p: { thrusts: 3 },
    spawn: { ramparts: P(2, 0.1) },
  }),
  def('lancer_dragoon', 'lancer', '용기병', {
    hp: 1.1, dmg: 1.2, ability: 'dragoon', hue: 230,
    p: { leapMax: 260, leapMin: 90, leapT: 0.6, aoeR: 52 },
    spawn: { ramparts: P(2, 0.2) },
  }),
];

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = Object.fromEntries(DEFS.map((d) => [d.id, d])) as Record<EnemyKind, EnemyDef>;
export const ALL_ENEMY_KINDS: readonly EnemyKind[] = DEFS.map((d) => d.id);
export const VARIANT_IDS: readonly VariantId[] = DEFS.filter((d) => d.variant).map((d) => d.id as VariantId);

export function enemyDef(id: EnemyKind): EnemyDef {
  return ENEMY_DEFS[id];
}

/** The variant def of an id, or null for the six base types. */
export function variantDef(id: EnemyKind): EnemyDef | null {
  const d = ENEMY_DEFS[id];
  return d && d.variant ? d : null;
}

// ---------------------------------------------------------------------------- pools

const BIOMES: BiomeId[] = ['prison', 'ramparts', 'tower'];

function entries(biome: BiomeId, flyer: boolean): { def: EnemyDef; pl: Placement }[] {
  const out: { def: EnemyDef; pl: Placement }[] = [];
  for (const d of DEFS) {
    const pl = d.spawn[biome];
    if (pl && !!d.flyer === flyer) out.push({ def: d, pl });
  }
  return out;
}

/** Static weights: ground enemies per biome (`kind` + `weight`) - kept for callers that just want a pool. */
export const ENEMY_POOLS: Record<BiomeId, { kind: EnemyKind; weight: number }[]> = Object.fromEntries(
  BIOMES.map((b) => [b, entries(b, false).map((e) => ({ kind: e.def.id, weight: e.pl.w }))]),
) as Record<BiomeId, { kind: EnemyKind; weight: number }[]>;

/** Flying enemies per biome (harpy + its variants). */
export const FLYERS: Record<BiomeId, EnemyKind[]> = Object.fromEntries(
  BIOMES.map((b) => [b, entries(b, true).map((e) => e.def.id)]),
) as Record<BiomeId, EnemyKind[]>;

/** Share of spawns that are variants at level progress `depth` (0..1): grows with depth, higher in the ramparts. */
export function variantShare(biome: BiomeId, depth01: number): number {
  const d = Math.max(0, Math.min(1, depth01));
  const tier = biome === 'ramparts' ? 0.18 : biome === 'tower' ? 0.3 : 0;
  return Math.max(0, Math.min(0.88, 0.12 + 0.55 * d + tier));
}

/**
 * Pick the enemy type for a spawn marker. Early rooms are mostly base types; variants (and the "late"
 * ones, from depth 0.4) grow with `depth01` and with the tier of the biome. Deterministic for the rng.
 * Returns '' (as never) only for biomes without any enemies - callers check `ENEMY_POOLS[biome].length`.
 */
export function pickEnemy(rng: Rng, biome: BiomeId, depth01: number, flyer: boolean): EnemyKind {
  const all = entries(biome, flyer);
  const d = Math.max(0, Math.min(1, depth01));
  const bases = all.filter((e) => !e.def.variant);
  const vars = all.filter((e) => e.def.variant && d >= (e.pl.min ?? 0));
  if (!all.length) return (flyer ? 'harpy' : 'ghoul');
  const useVariant = vars.length > 0 && (bases.length === 0 || rng.chance(variantShare(biome, d)));
  const group = useVariant ? vars : bases.length ? bases : vars;
  return rng.weighted(group, (e) => e.pl.w).def.id;
}
