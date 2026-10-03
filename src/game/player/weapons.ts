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
  hitstop: number;
  shake: number;
  swing: Sfx;
  hit: Sfx;
  slash: SlashSpec;
}

export interface MeleeWeapon {
  kind: 'melee';
  hits: MeleeHit[];
  /** idle time after the last recover before the combo resets */
  resetDelay: number;
  /** bleed duration applied by every hit (blood sword) */
  bleed?: number;
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
}

export interface ShieldWeapon {
  kind: 'shield';
  /** fraction of frontal damage negated while blocking */
  reduction: number;
  parryWindow: number;
  parryStun: number;
  moveScale: number;
}

export type WeaponDef = MeleeWeapon | BowWeapon | ShieldWeapon;
export type WeaponId = 'rusty_sword' | 'blood_sword' | 'spear' | 'twin_daggers' | 'war_hammer' | 'hunter_bow' | 'old_shield';

const RED = '#ff7a6a';
const STEEL = '#e8f4ff';
const PURPLE = '#c690ff';
const GREEN = '#9bff7a';

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
};

export function weaponDef(id: ItemId): WeaponDef | null {
  return (WEAPONS as Record<string, WeaponDef>)[id] ?? null;
}
