import type { Sfx } from '../../engine/audio';
import type { ItemId } from '../items/types';

/**
 * Data-driven weapons (docs/DESIGN.md §5). Pure data: the Player interprets it.
 * Boxes are relative to the player's feet: `x` = offset in FRONT of the body centre
 * (negative = behind), `y` = offset of the box top from the feet (negative = up).
 */
export interface Rect { x: number; y: number; w: number; h: number }

export interface SlashSpec {
  radius: number;
  /** arc angles (rad) for a right-facing swing; 0 = forward, -PI/2 = up */
  from: number;
  to: number;
  color: string;
  width?: number;
  life?: number;
}

export interface MeleeHit {
  /** heroine animation (DESIGN §8.2) */
  anim: string;
  windup: number;
  active: number;
  recover: number;
  damage: number;
  box: Rect;
  /** forward speed (px/s) during windup+active on the ground; air attacks never lunge */
  lunge: number;
  knockback: number;
  knockup?: number;
  stun?: number;
  crit?: 'always' | 'behind';
  /** whip: a target the hit reaches into the outer `tip` px of its box takes a crit */
  tip?: number;
  /** a thrown volley instead of the box (throwing knives): sent out when the windup ends */
  shoot?: Volley;
  hitstop: number;
  shake: number;
  swing: Sfx;
  hit: Sfx;
  slash: SlashSpec;
}

/** What a thrown hit sends out: `count` knives `gap` px above each other, flying `speed` px/s for `range` px, each making its target bleed `bleed` s. */
export interface Volley { count: number; gap: number; speed: number; range: number; bleed: number }

/**
 * Hold the attack `charge` s and let go: she dashes `distance` px at `speed` px/s, invulnerable, and every enemy on the way takes
 * `damage` (철 도); `recover` s of follow-through afterwards. Letting go earlier is the tap: `hits[0]`.
 */
export interface DashSpec { charge: number; distance: number; speed: number; damage: number; knockback: number; recover: number }

export interface MeleeWeapon {
  kind: 'melee';
  hits: MeleeHit[];
  /** idle time after the last recover before the combo resets */
  resetDelay: number;
  /** bleed duration applied by every hit (blood sword, 뼈 도살검) */
  bleed?: number;
  /** unique signatures (docs/CONTENT3.md §5): every hit crits against a bleeding target / for this many seconds after a roll / after taking damage */
  critBleeding?: boolean;
  critAfterRoll?: number;
  critAfterHurt?: number;
  /** unique signature: share of max HP healed by each kill of this weapon */
  healOnKill?: number;
  /** every hit ignites its target for this many seconds (횃불) */
  burn?: number;
  /** every hit crits while her HP is below this share of max HP (광란의 검) */
  critBelowHp?: number;
  /** only the first hit within this many seconds after a roll crits (레이피어) */
  critFirstAfterRoll?: number;
  /** hits crit against a target that burns / is frozen / is stunned (가학의 단검, 무덤 삽) */
  critVs?: ('burn' | 'freeze' | 'stun')[];
  /** hold-to-charge dash slash (철 도) */
  dash?: DashSpec;
}

export interface BowWeapon {
  kind: 'bow';
  /** damage of a fully drawn arrow */
  damage: number;
  drawTime: number;
  /** damage fraction of a tap shot */
  minFrac: number;
  minSpeed: number;
  maxSpeed: number;
  moveScale: number;
  /** unique signature: a fully drawn arrow pierces every enemy in its path (each is hit once) */
  pierce?: boolean;
  /** a fully drawn shot is `n` arrows fanned over +-`spread` degrees, each `frac` of the damage (연발 활, 중석궁) */
  volley?: { n: number; spread: number; frac: number };
  /** every arrow freezes what it hits for this many seconds (서리 활) */
  freeze?: number;
  /** arrows vanish after this many px (중석궁) */
  range?: number;
  /** how its arrows are drawn: an outline colour and a size */
  look?: { outline?: string; scale?: number };
}

export interface ShieldWeapon {
  kind: 'shield';
  /** fraction of frontal damage negated while blocking */
  reduction: number;
  parryWindow: number;
  parryStun: number;
  moveScale: number;
  /** unique signature: a parry releases a shockwave around the heroine (radius px, unblockable, stuns) */
  shockwave?: { radius: number; damage: number; stun: number };
  /** a parry also strikes the attacker: damage and bleed seconds (가시 방패) */
  counter?: { damage: number; bleed: number };
}

/**
 * A staff: hold the attack to breathe a flame cone `range` px long (fanning out by `spread` px per px) that hurts every enemy in it
 * for `damage` every `interval` s and burns it for `burn` s (화염 지팡이).
 */
export interface StaffWeapon {
  kind: 'staff';
  moveScale: number;
  flame: { range: number; spread: number; damage: number; interval: number; burn: number };
}

export type WeaponDef = MeleeWeapon | BowWeapon | ShieldWeapon | StaffWeapon;
export type WeaponId =
  | 'rusty_sword' | 'blood_sword' | 'spear' | 'twin_daggers' | 'war_hammer' | 'hunter_bow' | 'old_shield'
  | 'bone_cleaver' | 'reaper_scythe' | 'stitch_needle' | 'widow_fangs' | 'coffin_lid' | 'marrow_bow'
  | 'broadsword' | 'frantic_sword' | 'rapier' | 'sadist_stiletto' | 'grave_shovel' | 'torch' | 'leather_whip' | 'iron_katana'
  | 'multi_bow' | 'ice_bow' | 'heavy_crossbow' | 'throwing_knives' | 'fire_staff' | 'spiked_shield';

const RED = '#ff7a6a';
const STEEL = '#e8f4ff';
const PURPLE = '#c690ff';
const GREEN = '#9bff7a';
const BONE = '#f0e6d2';
const BLOOD = '#ff4a58';
const FIRE = '#ffb347';
const GOLD = '#ffe9a8';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rusty_sword: {
    kind: 'melee',
    resetDelay: 0.3,
    hits: [
      { anim: 'sword_1', windup: 0.07, active: 0.06, recover: 0.15, damage: 14, box: { x: 0, y: -44, w: 46, h: 40 }, lunge: 190, knockback: 90, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 40, from: -1.1, to: 0.8, color: STEEL, width: 7 } },
      { anim: 'sword_2', windup: 0.06, active: 0.06, recover: 0.15, damage: 14, box: { x: 0, y: -44, w: 46, h: 40 }, lunge: 190, knockback: 90, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 40, from: 0.9, to: -0.9, color: STEEL, width: 7 } },
      { anim: 'sword_3', windup: 0.09, active: 0.08, recover: 0.26, damage: 22, box: { x: 0, y: -50, w: 50, h: 46 }, lunge: 260, knockback: 200, knockup: 80, hitstop: 0.07, shake: 2, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 46, from: -2.0, to: 0.9, color: '#ffffff', width: 9, life: 0.2 } },
    ],
  },
  blood_sword: {
    kind: 'melee',
    resetDelay: 0.3,
    bleed: 3,
    hits: [
      { anim: 'sword_1', windup: 0.08, active: 0.06, recover: 0.17, damage: 18, box: { x: 0, y: -44, w: 48, h: 40 }, lunge: 190, knockback: 100, hitstop: 0.06, shake: 1.5, swing: 'swing', hit: 'hit', slash: { radius: 42, from: -1.1, to: 0.8, color: RED, width: 8 } },
      { anim: 'sword_2', windup: 0.1, active: 0.07, recover: 0.27, damage: 28, box: { x: 0, y: -50, w: 52, h: 46 }, lunge: 250, knockback: 210, hitstop: 0.07, shake: 2, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 48, from: -2.0, to: 0.9, color: '#ff4a58', width: 10, life: 0.2 } },
    ],
  },
  spear: {
    kind: 'melee',
    resetDelay: 0.3,
    hits: [
      { anim: 'spear_1', windup: 0.09, active: 0.06, recover: 0.16, damage: 13, box: { x: 4, y: -34, w: 64, h: 16 }, lunge: 120, knockback: 110, hitstop: 0.05, shake: 1, swing: 'stab', hit: 'hit', slash: { radius: 62, from: -0.12, to: 0.12, color: STEEL, width: 4, life: 0.12 } },
      { anim: 'spear_2', windup: 0.09, active: 0.06, recover: 0.16, damage: 13, box: { x: 4, y: -34, w: 64, h: 16 }, lunge: 120, knockback: 110, hitstop: 0.05, shake: 1, swing: 'stab', hit: 'hit', slash: { radius: 62, from: -0.12, to: 0.12, color: STEEL, width: 4, life: 0.12 } },
      { anim: 'spear_3', windup: 0.13, active: 0.07, recover: 0.27, damage: 15, box: { x: 4, y: -38, w: 70, h: 22 }, lunge: 300, knockback: 240, hitstop: 0.08, shake: 3, crit: 'always', swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 68, from: -0.18, to: 0.18, color: '#ffe9a8', width: 6, life: 0.16 } },
    ],
  },
  twin_daggers: {
    kind: 'melee',
    resetDelay: 0.28,
    hits: [
      { anim: 'dagger_1', windup: 0.04, active: 0.04, recover: 0.08, damage: 7, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, crit: 'behind', swing: 'swing', hit: 'hit', slash: { radius: 28, from: -0.9, to: 0.7, color: PURPLE, width: 5, life: 0.1 } },
      { anim: 'dagger_2', windup: 0.04, active: 0.04, recover: 0.08, damage: 7, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, crit: 'behind', swing: 'swing', hit: 'hit', slash: { radius: 28, from: 0.8, to: -0.8, color: PURPLE, width: 5, life: 0.1 } },
      { anim: 'dagger_3', windup: 0.04, active: 0.04, recover: 0.08, damage: 7, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, crit: 'behind', swing: 'swing', hit: 'hit', slash: { radius: 28, from: -0.7, to: 0.8, color: PURPLE, width: 5, life: 0.1 } },
      { anim: 'dagger_4', windup: 0.06, active: 0.05, recover: 0.14, damage: 10, box: { x: 0, y: -44, w: 36, h: 40 }, lunge: 260, knockback: 130, hitstop: 0.06, shake: 1.5, crit: 'behind', swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 32, from: -1.4, to: 0.9, color: '#e6c8ff', width: 7, life: 0.14 } },
    ],
  },
  war_hammer: {
    kind: 'melee',
    resetDelay: 0.35,
    hits: [
      { anim: 'hammer_1', windup: 0.22, active: 0.08, recover: 0.4, damage: 36, box: { x: -8, y: -64, w: 66, h: 64 }, lunge: 100, knockback: 230, knockup: 60, stun: 1.0, hitstop: 0.1, shake: 3, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 54, from: -2.6, to: 0.5, color: GREEN, width: 12, life: 0.24 } },
      { anim: 'hammer_2', windup: 0.2, active: 0.08, recover: 0.42, damage: 44, box: { x: -34, y: -50, w: 100, h: 50 }, lunge: 80, knockback: 280, stun: 1.5, hitstop: 0.1, shake: 3, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 58, from: 0.9, to: -1.6, color: GREEN, width: 12, life: 0.24 } },
    ],
  },
  hunter_bow: {
    kind: 'bow',
    damage: 30,
    drawTime: 0.45,
    minFrac: 0.35,
    minSpeed: 380,
    maxSpeed: 660,
    moveScale: 0.4,
  },
  old_shield: {
    kind: 'shield',
    reduction: 0.8,
    parryWindow: 0.2,
    parryStun: 1.5,
    moveScale: 0.4,
  },

  // ---- unique weapons (docs/CONTENT3.md §5): the base tables sit ~15 % above the DPS of their family's item, the signature on top ----
  bone_cleaver: {
    kind: 'melee',
    resetDelay: 0.3,
    bleed: 3,
    critBleeding: true,
    hits: [
      { anim: 'sword_1', windup: 0.08, active: 0.06, recover: 0.17, damage: 17, box: { x: 0, y: -46, w: 50, h: 42 }, lunge: 190, knockback: 100, hitstop: 0.06, shake: 1.5, swing: 'swing', hit: 'hit', slash: { radius: 44, from: -1.1, to: 0.8, color: BONE, width: 8 } },
      { anim: 'sword_2', windup: 0.08, active: 0.06, recover: 0.17, damage: 17, box: { x: 0, y: -46, w: 50, h: 42 }, lunge: 190, knockback: 100, hitstop: 0.06, shake: 1.5, swing: 'swing', hit: 'hit', slash: { radius: 44, from: 0.9, to: -0.9, color: BLOOD, width: 8 } },
      { anim: 'sword_3', windup: 0.1, active: 0.08, recover: 0.28, damage: 28, box: { x: 0, y: -52, w: 56, h: 48 }, lunge: 260, knockback: 220, knockup: 80, hitstop: 0.08, shake: 2.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 50, from: -2.0, to: 0.9, color: BLOOD, width: 10, life: 0.2 } },
    ],
  },
  reaper_scythe: {
    kind: 'melee',
    resetDelay: 0.35,
    healOnKill: 0.08,
    hits: [
      { anim: 'hammer_1', windup: 0.14, active: 0.08, recover: 0.3, damage: 32, box: { x: -22, y: -60, w: 94, h: 60 }, lunge: 110, knockback: 160, hitstop: 0.08, shake: 2.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 60, from: -2.6, to: 0.5, color: BLOOD, width: 10, life: 0.22 } },
      { anim: 'hammer_2', windup: 0.14, active: 0.08, recover: 0.32, damage: 38, box: { x: -40, y: -52, w: 118, h: 52 }, lunge: 90, knockback: 200, hitstop: 0.08, shake: 2.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 64, from: 0.9, to: -1.7, color: BONE, width: 10, life: 0.22 } },
    ],
  },
  stitch_needle: {
    kind: 'melee',
    resetDelay: 0.3,
    critAfterRoll: 2,
    hits: [
      { anim: 'spear_1', windup: 0.09, active: 0.06, recover: 0.16, damage: 18, box: { x: 4, y: -34, w: 68, h: 16 }, lunge: 120, knockback: 110, hitstop: 0.05, shake: 1, swing: 'stab', hit: 'hit', slash: { radius: 66, from: -0.12, to: 0.12, color: BONE, width: 4, life: 0.12 } },
      { anim: 'spear_2', windup: 0.09, active: 0.06, recover: 0.16, damage: 18, box: { x: 4, y: -34, w: 68, h: 16 }, lunge: 120, knockback: 110, hitstop: 0.05, shake: 1, swing: 'stab', hit: 'hit', slash: { radius: 66, from: -0.12, to: 0.12, color: BONE, width: 4, life: 0.12 } },
      { anim: 'spear_3', windup: 0.13, active: 0.07, recover: 0.27, damage: 28, box: { x: 4, y: -38, w: 74, h: 22 }, lunge: 300, knockback: 240, hitstop: 0.08, shake: 3, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 72, from: -0.18, to: 0.18, color: BLOOD, width: 6, life: 0.16 } },
    ],
  },
  widow_fangs: {
    kind: 'melee',
    resetDelay: 0.28,
    critAfterHurt: 3,
    hits: [
      { anim: 'dagger_1', windup: 0.04, active: 0.04, recover: 0.08, damage: 8, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 28, from: -0.9, to: 0.7, color: BLOOD, width: 5, life: 0.1 } },
      { anim: 'dagger_2', windup: 0.04, active: 0.04, recover: 0.08, damage: 8, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 28, from: 0.8, to: -0.8, color: BLOOD, width: 5, life: 0.1 } },
      { anim: 'dagger_3', windup: 0.04, active: 0.04, recover: 0.08, damage: 8, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 28, from: -0.7, to: 0.8, color: BLOOD, width: 5, life: 0.1 } },
      { anim: 'dagger_4', windup: 0.06, active: 0.05, recover: 0.14, damage: 12, box: { x: 0, y: -44, w: 36, h: 40 }, lunge: 260, knockback: 130, hitstop: 0.06, shake: 1.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 32, from: -1.4, to: 0.9, color: BONE, width: 7, life: 0.14 } },
    ],
  },
  coffin_lid: {
    kind: 'shield',
    reduction: 0.9,
    parryWindow: 0.2,
    parryStun: 1.5,
    moveScale: 0.4,
    shockwave: { radius: 72, damage: 30, stun: 1.5 },
  },
  marrow_bow: {
    kind: 'bow',
    damage: 34,
    drawTime: 0.45,
    minFrac: 0.35,
    minSpeed: 380,
    maxSpeed: 700,
    moveScale: 0.4,
    pierce: true,
  },

  // ---- ordinary weapons of docs/CONTENT4.md §5.1: DPS close to the item of their family (sword ~60, spear ~45, daggers ~50, hammer ~70, hunter bow ~46 a second of full draws)
  broadsword: {
    kind: 'melee',
    resetDelay: 0.4,
    hits: [
      { anim: 'heavy_1', windup: 0.2, active: 0.08, recover: 0.32, damage: 26, box: { x: -24, y: -62, w: 112, h: 62 }, lunge: 110, knockback: 190, knockup: 40, hitstop: 0.08, shake: 2.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 62, from: -2.4, to: 0.6, color: RED, width: 11, life: 0.22 } },
      { anim: 'heavy_2', windup: 0.22, active: 0.08, recover: 0.34, damage: 28, box: { x: -40, y: -54, w: 132, h: 54 }, lunge: 100, knockback: 210, hitstop: 0.08, shake: 2.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 66, from: 0.9, to: -1.7, color: RED, width: 11, life: 0.22 } },
      { anim: 'heavy_3', windup: 0.26, active: 0.1, recover: 0.45, damage: 22, box: { x: -64, y: -64, w: 152, h: 64 }, lunge: 80, knockback: 260, knockup: 100, crit: 'always', hitstop: 0.1, shake: 3.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 70, from: -3.0, to: 0.4, color: GOLD, width: 13, life: 0.26 } },
    ],
  },
  frantic_sword: {
    kind: 'melee',
    resetDelay: 0.3,
    critBelowHp: 0.5,
    hits: [
      { anim: 'sword_1', windup: 0.07, active: 0.06, recover: 0.15, damage: 13, box: { x: 0, y: -44, w: 46, h: 40 }, lunge: 200, knockback: 90, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 40, from: -1.1, to: 0.8, color: BLOOD, width: 7 } },
      { anim: 'sword_2', windup: 0.06, active: 0.06, recover: 0.15, damage: 13, box: { x: 0, y: -44, w: 46, h: 40 }, lunge: 200, knockback: 90, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 40, from: 0.9, to: -0.9, color: BLOOD, width: 7 } },
      { anim: 'sword_3', windup: 0.09, active: 0.08, recover: 0.26, damage: 20, box: { x: 0, y: -50, w: 50, h: 46 }, lunge: 260, knockback: 200, knockup: 80, hitstop: 0.07, shake: 2, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 46, from: -2.0, to: 0.9, color: '#ffffff', width: 9, life: 0.2 } },
    ],
  },
  rapier: {
    kind: 'melee',
    resetDelay: 0.3,
    critFirstAfterRoll: 1.5,
    hits: [
      { anim: 'spear_1', windup: 0.07, active: 0.05, recover: 0.12, damage: 9, box: { x: 4, y: -34, w: 58, h: 14 }, lunge: 180, knockback: 70, hitstop: 0.04, shake: 1, swing: 'stab', hit: 'hit', slash: { radius: 56, from: -0.1, to: 0.1, color: STEEL, width: 3, life: 0.1 } },
      { anim: 'spear_2', windup: 0.07, active: 0.05, recover: 0.12, damage: 9, box: { x: 4, y: -34, w: 58, h: 14 }, lunge: 180, knockback: 70, hitstop: 0.04, shake: 1, swing: 'stab', hit: 'hit', slash: { radius: 56, from: -0.1, to: 0.1, color: STEEL, width: 3, life: 0.1 } },
      { anim: 'spear_3', windup: 0.08, active: 0.06, recover: 0.12, damage: 11, box: { x: 4, y: -36, w: 62, h: 18 }, lunge: 240, knockback: 140, hitstop: 0.06, shake: 2, swing: 'stab', hit: 'hit_heavy', slash: { radius: 60, from: -0.14, to: 0.14, color: '#ffe9a8', width: 4, life: 0.12 } },
    ],
  },
  sadist_stiletto: {
    kind: 'melee',
    resetDelay: 0.28,
    critVs: ['burn', 'freeze', 'stun'],
    hits: [
      { anim: 'dagger_1', windup: 0.04, active: 0.04, recover: 0.08, damage: 6, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 28, from: -0.9, to: 0.7, color: '#ff8fb0', width: 5, life: 0.1 } },
      { anim: 'dagger_2', windup: 0.04, active: 0.04, recover: 0.08, damage: 6, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 28, from: 0.8, to: -0.8, color: '#ff8fb0', width: 5, life: 0.1 } },
      { anim: 'dagger_3', windup: 0.04, active: 0.04, recover: 0.08, damage: 6, box: { x: 0, y: -42, w: 32, h: 36 }, lunge: 220, knockback: 50, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 28, from: -0.7, to: 0.8, color: '#ff8fb0', width: 5, life: 0.1 } },
      { anim: 'dagger_4', windup: 0.06, active: 0.05, recover: 0.14, damage: 9, box: { x: 0, y: -44, w: 36, h: 40 }, lunge: 260, knockback: 130, hitstop: 0.06, shake: 1.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 32, from: -1.4, to: 0.9, color: '#ffd0de', width: 7, life: 0.14 } },
    ],
  },
  grave_shovel: {
    kind: 'melee',
    resetDelay: 0.35,
    critVs: ['stun'],
    hits: [
      { anim: 'heavy_1', windup: 0.2, active: 0.08, recover: 0.38, damage: 22, box: { x: -6, y: -58, w: 66, h: 58 }, lunge: 90, knockback: 160, stun: 0.8, hitstop: 0.08, shake: 2.5, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 54, from: -2.5, to: 0.5, color: '#b79a6a', width: 11, life: 0.22 } },
      { anim: 'heavy_2', windup: 0.22, active: 0.08, recover: 0.4, damage: 24, box: { x: -20, y: -54, w: 84, h: 54 }, lunge: 80, knockback: 200, stun: 0.8, hitstop: 0.09, shake: 3, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 58, from: 0.9, to: -1.6, color: '#b79a6a', width: 11, life: 0.22 } },
    ],
  },
  torch: {
    kind: 'melee',
    resetDelay: 0.3,
    burn: 3,
    hits: [
      { anim: 'sword_1', windup: 0.07, active: 0.06, recover: 0.15, damage: 12, box: { x: 0, y: -44, w: 44, h: 40 }, lunge: 190, knockback: 80, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 38, from: -1.1, to: 0.8, color: FIRE, width: 8 } },
      { anim: 'sword_2', windup: 0.06, active: 0.06, recover: 0.15, damage: 14, box: { x: 0, y: -44, w: 44, h: 40 }, lunge: 190, knockback: 100, hitstop: 0.06, shake: 1.5, swing: 'swing', hit: 'hit', slash: { radius: 38, from: 0.9, to: -0.9, color: '#ff7a2a', width: 8 } },
    ],
  },
  leather_whip: {
    kind: 'melee',
    resetDelay: 0.3,
    hits: [
      { anim: 'whip_1', windup: 0.1, active: 0.06, recover: 0.2, damage: 10, box: { x: 4, y: -40, w: 100, h: 16 }, lunge: 60, knockback: 70, tip: 24, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 100, from: -0.45, to: 0.05, color: '#d8c8a0', width: 4, life: 0.14 } },
      { anim: 'whip_2', windup: 0.09, active: 0.06, recover: 0.22, damage: 12, box: { x: 4, y: -34, w: 100, h: 20 }, lunge: 60, knockback: 90, tip: 24, hitstop: 0.05, shake: 1, swing: 'swing', hit: 'hit', slash: { radius: 100, from: 0.25, to: -0.2, color: '#d8c8a0', width: 4, life: 0.14 } },
    ],
  },
  iron_katana: {
    kind: 'melee',
    resetDelay: 0.3,
    dash: { charge: 0.6, distance: 120, speed: 720, damage: 46, knockback: 220, recover: 0.3 },
    hits: [
      { anim: 'heavy_3', windup: 0.09, active: 0.07, recover: 0.2, damage: 17, box: { x: -30, y: -58, w: 100, h: 58 }, lunge: 150, knockback: 140, hitstop: 0.06, shake: 2, swing: 'swing_heavy', hit: 'hit_heavy', slash: { radius: 58, from: -2.8, to: 0.6, color: STEEL, width: 9, life: 0.18 } },
    ],
  },
  multi_bow: {
    kind: 'bow',
    damage: 28,
    drawTime: 0.5,
    minFrac: 0.35,
    minSpeed: 380,
    maxSpeed: 660,
    moveScale: 0.4,
    volley: { n: 3, spread: 8, frac: 0.45 },
    look: { outline: GOLD },
  },
  ice_bow: {
    kind: 'bow',
    damage: 21,
    drawTime: 0.45,
    minFrac: 0.35,
    minSpeed: 380,
    maxSpeed: 660,
    moveScale: 0.4,
    freeze: 1.2,
    look: { outline: '#9fe8ff' },
  },
  heavy_crossbow: {
    kind: 'bow',
    damage: 28,
    drawTime: 0.7,
    minFrac: 0.35,
    minSpeed: 420,
    maxSpeed: 560,
    moveScale: 0.35,
    range: 160,
    volley: { n: 5, spread: 14, frac: 0.4 },
    look: { outline: '#ff9a3d', scale: 1.3 },
  },
  throwing_knives: {
    kind: 'melee',
    resetDelay: 0.25,
    hits: [
      { anim: 'throw', windup: 0.05, active: 0.04, recover: 0.16, damage: 5, box: { x: 0, y: -40, w: 24, h: 30 }, lunge: 0, knockback: 30, hitstop: 0.02, shake: 0, swing: 'throw', hit: 'hit', slash: { radius: 20, from: -0.1, to: 0.1, color: STEEL, width: 3, life: 0.08 }, shoot: { count: 2, gap: 7, speed: 520, range: 240, bleed: 2 } },
    ],
  },
  fire_staff: {
    kind: 'staff',
    moveScale: 0.3,
    flame: { range: 64, spread: 0.4, damage: 9, interval: 0.15, burn: 2 },
  },
  spiked_shield: {
    kind: 'shield',
    reduction: 0.75,
    parryWindow: 0.2,
    parryStun: 1.5,
    moveScale: 0.4,
    counter: { damage: 40, bleed: 3 },
  },
};

export function weaponDef(id: ItemId): WeaponDef | null {
  return (WEAPONS as Record<string, WeaponDef>)[id] ?? null;
}
