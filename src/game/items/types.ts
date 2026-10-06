import type { ItemColor } from '../combat';
import type { Grade } from '../rules';

/**
 * Item ids (docs/DESIGN.md §5, docs/CONTENT4.md §5): 63 kinds, 33 ordinary (weapons: the 7 of the base game then the 14 of
 * CONTENT4, skills: 4 then 8) and 30 unique ones (the 10 of docs/CONTENT3.md §5, then A to SSS).
 */
export const ITEM_IDS = [
  'rusty_sword', 'blood_sword', 'spear', 'twin_daggers', 'war_hammer',
  'hunter_bow', 'old_shield',
  'fire_grenade', 'ice_grenade', 'turret', 'wolf_trap',
  'bone_cleaver', 'reaper_scythe', 'stitch_needle', 'widow_fangs', 'coffin_lid', 'marrow_bow',
  'corpse_bomb', 'bone_spikes', 'soul_lantern', 'chain_hook',
  // ordinary weapons and skills of docs/CONTENT4.md §5.1 / §5.2
  'broadsword', 'frantic_sword', 'rapier', 'sadist_stiletto', 'grave_shovel', 'torch', 'leather_whip', 'iron_katana',
  'multi_bow', 'ice_bow', 'heavy_crossbow', 'throwing_knives', 'fire_staff', 'spiked_shield',
  'stun_grenade', 'magnet_grenade', 'cluster_grenade', 'tesla_coil', 'flame_turret', 'phaser', 'wave_of_denial', 'tornado',
  // uniques of grade A, S, SS, SSS (docs/CONTENT4.md §5.3)
  'grave_bell', 'leech_whip', 'bone_rampart', 'plague_censer', 'bone_turret',
  'executioner_blade', 'storm_staff', 'moon_glaives', 'death_orb', 'chain_prison',
  'matron_flail', 'soulfire_bow', 'bell_aegis', 'rag_doll', 'crimson_rain',
  'selma_shears', 'ember_blade', 'ninefold_whip', 'last_bell', 'requiem',
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
  /** dropped by a mid-boss: a crafting material of its own (docs/CONTENT4.md §4); kept when equipped / dropped / stashed */
  mb?: true;
}

/** An item in the permanent stash (`save.stash`, docs/CONTENT4.md §2). */
export type StashEntry = ItemInstance;

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
  /** unique item (docs/CONTENT3.md §5): a fixed signature effect, crafted at Selma only (docs/CONTENT4.md §4), never rolled, no affix */
  unique?: boolean;
  /** uniques only: their grade C..SSS (docs/CONTENT4.md §4) */
  grade?: Grade;
}

export const STARTER_UNLOCKS: ItemId[] = ['rusty_sword', 'hunter_bow', 'old_shield', 'fire_grenade'];

/** Unique items by grade, C to SSS, five each (docs/CONTENT3.md §5, docs/CONTENT4.md §4 / §5.3): crafted by Selma, never rolled. */
export const UNIQUE_IDS: readonly ItemId[] = [
  'bone_cleaver', 'stitch_needle', 'coffin_lid', 'bone_spikes', 'chain_hook',
  'reaper_scythe', 'widow_fangs', 'marrow_bow', 'corpse_bomb', 'soul_lantern',
  'grave_bell', 'leech_whip', 'bone_rampart', 'plague_censer', 'bone_turret',
  'executioner_blade', 'storm_staff', 'moon_glaives', 'death_orb', 'chain_prison',
  'matron_flail', 'soulfire_bow', 'bell_aegis', 'rag_doll', 'crimson_rain',
  'selma_shears', 'ember_blade', 'ninefold_whip', 'last_bell', 'requiem',
];
