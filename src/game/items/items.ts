import type { Rng } from '../../engine/rng';
import type { ItemDef, ItemId, ItemInstance, AffixId } from './types';
import { WEAPONS, type MeleeWeapon } from '../player/weapons';

/**
 * Item catalogue + rolling. OWNER: player agent.
 * Weapon numbers live in player/weapons.ts, skill numbers in player/skills.ts;
 * this file holds identity (name, colour, slot, cooldown) and the Korean text.
 */
export const ITEMS: Record<ItemId, ItemDef> = {
  rusty_sword: { id: 'rusty_sword', name: '녹슨 검', desc: '균형 잡힌 3연격', color: 'brutality', slot: 'weapon', kind: 'melee', icon: 'rusty_sword' },
  blood_sword: { id: 'blood_sword', name: '피의 검', desc: '출혈을 일으키는 2연격', color: 'brutality', slot: 'weapon', kind: 'melee', icon: 'blood_sword' },
  spear: { id: 'spear', name: '창', desc: '긴 사거리, 3타 치명타', color: 'brutality', slot: 'weapon', kind: 'melee', icon: 'spear' },
  twin_daggers: { id: 'twin_daggers', name: '쌍단검', desc: '빠른 4연격, 뒤에서 치명타', color: 'tactics', slot: 'weapon', kind: 'melee', icon: 'twin_daggers' },
  war_hammer: { id: 'war_hammer', name: '전쟁 망치', desc: '느리지만 광역 기절', color: 'survival', slot: 'weapon', kind: 'melee', icon: 'war_hammer' },
  hunter_bow: { id: 'hunter_bow', name: '사냥꾼의 활', desc: '길게 눌러 조준, 떼면 발사', color: 'tactics', slot: 'weapon', kind: 'bow', icon: 'hunter_bow' },
  old_shield: { id: 'old_shield', name: '낡은 방패', desc: '막기, 타이밍 맞추면 패링', color: 'survival', slot: 'weapon', kind: 'shield', icon: 'old_shield' },
  fire_grenade: { id: 'fire_grenade', name: '화염 수류탄', desc: '폭발 + 화상', color: 'tactics', slot: 'skill', kind: 'skill', icon: 'fire_grenade', cooldown: 10 },
  ice_grenade: { id: 'ice_grenade', name: '얼음 수류탄', desc: '주변 적 빙결', color: 'tactics', slot: 'skill', kind: 'skill', icon: 'ice_grenade', cooldown: 12 },
  turret: { id: 'turret', name: '석궁 포탑', desc: '자동으로 적을 사격', color: 'tactics', slot: 'skill', kind: 'skill', icon: 'turret', cooldown: 14 },
  wolf_trap: { id: 'wolf_trap', name: '늑대 덫', desc: '밟은 적을 속박', color: 'tactics', slot: 'skill', kind: 'skill', icon: 'wolf_trap', cooldown: 8 },
};

export const AFFIX_NAMES: Record<AffixId, string> = {
  burn: '적중 시 화상',
  bleed: '적중 시 출혈',
  dmg: '피해 +20%',
  speed: '공격 속도 +15%',
  heal_on_kill: '처치 시 체력 회복',
};

export const COLOR_NAMES = { brutality: '잔혹', tactics: '전술', survival: '생존' } as const;

/** Which affixes make sense for an item (shields only block; skills have no swing speed). */
export function affixPool(id: ItemId): AffixId[] {
  const kind = ITEMS[id].kind;
  if (kind === 'shield') return ['heal_on_kill'];
  if (kind === 'skill') return ['dmg', 'heal_on_kill'];
  if (kind === 'bow') return ['burn', 'bleed', 'dmg', 'speed', 'heal_on_kill'];
  return ['burn', 'bleed', 'dmg', 'speed', 'heal_on_kill'];
}

/** Roll a random item from the unlocked pool for the given tier. */
export function rollItem(rng: Rng, tier: number, unlocked: readonly ItemId[], slot?: 'weapon' | 'skill'): ItemInstance {
  const known = unlocked.filter((id) => ITEMS[id]);
  const pool = known.filter((id) => !slot || ITEMS[id].slot === slot);
  const fallback: ItemId = slot === 'skill' ? 'fire_grenade' : 'rusty_sword';
  const id = rng.pick(pool.length ? pool : [fallback]);
  const affixes = affixPool(id);
  const affix = rng.chance(Math.min(0.8, 0.3 + 0.15 * (tier - 1))) ? rng.pick(affixes) : null;
  return { id, tier, affix };
}

export function itemName(inst: ItemInstance): string {
  return ITEMS[inst.id].name + (inst.tier > 1 ? ` +${inst.tier - 1}` : '');
}

/** Damage of one swing/shot at this tier (before run stats), for the item card. */
function cardDamage(inst: ItemInstance, base: number): number {
  return Math.round(base * (1 + 0.25 * (inst.tier - 1)) * (inst.affix === 'dmg' ? 1.2 : 1));
}

/** Lines for the item card (description, numbers, affix). */
export function itemLines(inst: ItemInstance): string[] {
  const def = ITEMS[inst.id];
  const out = [def.desc];
  const w = (WEAPONS as Record<string, (typeof WEAPONS)[keyof typeof WEAPONS]>)[inst.id];
  if (w?.kind === 'melee') out.push(`피해 ${(w as MeleeWeapon).hits.map((h) => cardDamage(inst, h.damage)).join(' / ')}`);
  else if (w?.kind === 'bow') out.push(`피해 최대 ${cardDamage(inst, w.damage)} (충전)`);
  else if (w?.kind === 'shield') out.push('정면 피해 -80% · 패링 시 기절 1.5초');
  else if (def.cooldown) out.push(`재사용 ${def.cooldown}초`);
  if (inst.affix) out.push(AFFIX_NAMES[inst.affix]);
  return out;
}

/** Gold price in shops. */
export function itemPrice(inst: ItemInstance): number {
  const base = ITEMS[inst.id].slot === 'skill' ? 100 : 80;
  return base + 60 * (inst.tier - 1) + (inst.affix ? 40 : 0);
}
