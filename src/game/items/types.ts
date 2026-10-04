import type { ItemColor } from '../combat';

/** Item ids (docs/DESIGN.md §5). */
export const ITEM_IDS = [
  'rusty_sword', 'blood_sword', 'spear', 'twin_daggers', 'war_hammer',
  'hunter_bow', 'old_shield',
  'fire_grenade', 'ice_grenade', 'turret', 'wolf_trap',
] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export type ItemSlot = 'weapon' | 'skill';
export type ItemKind = 'melee' | 'bow' | 'shield' | 'skill';
export type AffixId = 'burn' | 'bleed' | 'dmg' | 'speed' | 'heal_on_kill';

/** A concrete rolled item (what is stored in inventory / dropped on the floor). */
export interface ItemInstance {
  id: ItemId;
  /** +1 per biome; scales damage */
  tier: number;
  affix: AffixId | null;
}

export interface ItemDef {
  id: ItemId;
  name: string; // Korean display name
  desc: string; // short Korean description
  color: ItemColor;
  slot: ItemSlot;
  kind: ItemKind;
  /** icon animation name in the `icons` sheet */
  icon: string;
  /** skills only: cooldown in seconds */
  cooldown?: number;
}

export const STARTER_UNLOCKS: ItemId[] = ['rusty_sword', 'hunter_bow', 'old_shield', 'fire_grenade'];

/**
 * Unique items (docs/CONTENT3.md §5): sold only by Selma at the 시체 상점, paid in corpse pieces. The shop copes with any
 * number of them (none = three empty "품절" pedestals); the unique-item table fills this list in.
 */
export const UNIQUE_IDS: readonly ItemId[] = [];
