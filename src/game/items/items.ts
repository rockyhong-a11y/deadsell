import type { Rng } from '../../engine/rng';
import type { ItemDef, ItemId, ItemInstance, AffixId } from './types';
import { WEAPONS, type MeleeWeapon } from '../player/weapons';
import { BONE_SPIKES, CHAIN_HOOK, CORPSE_BOMB, SKILL_BASE, SOUL_LANTERN } from '../player/skills';
import { COLOR_HEX } from '../combat';
import { AFFIX, AFFIX_ROLL, TIER_DMG, loopPriceMul } from '../rules';

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
  // unique items (docs/CONTENT3.md §5): the 시체 상점 only. Numbers of the signatures: player/weapons.ts, player/skills.ts
  bone_cleaver: { id: 'bone_cleaver', name: '뼈 도살검', desc: '적중 출혈, 출혈 적 치명타', color: 'brutality', slot: 'weapon', kind: 'melee', icon: 'bone_cleaver', unique: true },
  reaper_scythe: { id: 'reaper_scythe', name: '사신의 낫', desc: '처치할 때마다 체력 회복', color: 'brutality', slot: 'weapon', kind: 'melee', icon: 'reaper_scythe', unique: true },
  stitch_needle: { id: 'stitch_needle', name: '재봉 바늘', desc: '구르기 직후 치명타', color: 'tactics', slot: 'weapon', kind: 'melee', icon: 'stitch_needle', unique: true },
  widow_fangs: { id: 'widow_fangs', name: '과부의 송곳니', desc: '피격 직후 치명타', color: 'tactics', slot: 'weapon', kind: 'melee', icon: 'widow_fangs', unique: true },
  coffin_lid: { id: 'coffin_lid', name: '관 뚜껑', desc: '패링하면 충격파', color: 'survival', slot: 'weapon', kind: 'shield', icon: 'coffin_lid', unique: true },
  marrow_bow: { id: 'marrow_bow', name: '골수 활', desc: '완전히 당기면 관통', color: 'tactics', slot: 'weapon', kind: 'bow', icon: 'marrow_bow', unique: true },
  corpse_bomb: { id: 'corpse_bomb', name: '시체 폭탄', desc: '쓰러진 적이 다시 폭발', color: 'brutality', slot: 'skill', kind: 'skill', icon: 'corpse_bomb', cooldown: 12, unique: true },
  bone_spikes: { id: 'bone_spikes', name: '뼈 가시', desc: '앞으로 줄지어 솟는다', color: 'tactics', slot: 'skill', kind: 'skill', icon: 'bone_spikes', cooldown: 9, unique: true },
  soul_lantern: { id: 'soul_lantern', name: '영혼 등불', desc: '주위를 도는 영혼불', color: 'survival', slot: 'skill', kind: 'skill', icon: 'soul_lantern', cooldown: 16, unique: true },
  chain_hook: { id: 'chain_hook', name: '사슬 갈고리', desc: '첫 적을 끌어당긴다', color: 'tactics', slot: 'skill', kind: 'skill', icon: 'chain_hook', cooldown: 7, unique: true },
};

/** Name colour of unique items (item cards, prompts, toasts, the codex) and the tag that goes with it. */
export const UNIQUE_COLOR = '#f0d9a0';
export const UNIQUE_TAG = '유니크';

/** Colour an item is shown in (name, glow): its stat colour, or the unique colour. */
export function itemColor(id: ItemId): string {
  return ITEMS[id].unique ? UNIQUE_COLOR : COLOR_HEX[ITEMS[id].color];
}

export const AFFIX_NAMES: Record<AffixId, string> = {
  burn: '적중 시 화상',
  bleed: '적중 시 출혈',
  dmg: '피해 +20%',
  speed: '공격 속도 +15%',
  heal_on_kill: '처치 시 체력 회복',
};

export const COLOR_NAMES = { brutality: '잔혹', tactics: '전술', survival: '생존' } as const;

/** Which affixes make sense for an item (shields only block; skills have no swing speed; unique items never roll one). */
export function affixPool(id: ItemId): AffixId[] {
  if (ITEMS[id].unique) return [];
  const kind = ITEMS[id].kind;
  if (kind === 'shield') return ['heal_on_kill'];
  if (kind === 'skill') return ['dmg', 'heal_on_kill'];
  if (kind === 'bow') return ['burn', 'bleed', 'dmg', 'speed', 'heal_on_kill'];
  return ['burn', 'bleed', 'dmg', 'speed', 'heal_on_kill'];
}

/**
 * Roll a random item from the unlocked pool for the given tier. Unique items are never in the pool (only the 시체 상점 sells them).
 * `opts.guaranteeAffix` (mid-boss drops) always rolls an affix; the rng call sequence of a normal roll is unchanged.
 */
export function rollItem(
  rng: Rng,
  tier: number,
  unlocked: readonly ItemId[],
  slot?: 'weapon' | 'skill',
  opts: { guaranteeAffix?: boolean } = {},
): ItemInstance {
  const known = unlocked.filter((id) => ITEMS[id] && !ITEMS[id].unique);
  const pool = known.filter((id) => !slot || ITEMS[id].slot === slot);
  const fallback: ItemId = slot === 'skill' ? 'fire_grenade' : 'rusty_sword';
  const id = rng.pick(pool.length ? pool : [fallback]);
  const affixes = affixPool(id);
  const roll = rng.chance(Math.min(AFFIX_ROLL.max, AFFIX_ROLL.base + AFFIX_ROLL.perTier * (tier - 1)));
  const affix = roll || opts.guaranteeAffix ? rng.pick(affixes) : null;
  return { id, tier, affix };
}

export function itemName(inst: ItemInstance): string {
  return ITEMS[inst.id].name + (inst.tier > 1 ? ` +${inst.tier - 1}` : '');
}

/** Damage of one swing/shot at this tier (before run stats), for the item card. */
function cardDamage(inst: ItemInstance, base: number): number {
  return Math.round(base * (1 + TIER_DMG * (inst.tier - 1)) * (inst.affix === 'dmg' ? AFFIX.dmgMul : 1));
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const num = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * The signature effect of a unique item as one line, from the tables of weapons.ts / skills.ts (item card and codex).
 * `dmg` maps a base damage to what is shown (the card scales it by the item's tier; the codex shows the base).
 */
export function signatureText(id: ItemId, dmg: (base: number) => number = (b) => b): string {
  const w = (WEAPONS as Record<string, (typeof WEAPONS)[keyof typeof WEAPONS]>)[id];
  if (w?.kind === 'melee') {
    if (w.critBleeding) return `적중 시 출혈 ${num(w.bleed ?? 0)}초 · 출혈 중인 적에게 치명타`;
    if (w.healOnKill) return `처치 시 최대 체력의 ${pct(w.healOnKill)} 회복`;
    if (w.critAfterRoll) return `구르기 후 ${num(w.critAfterRoll)}초간 모든 공격이 치명타`;
    if (w.critAfterHurt) return `피격 후 ${num(w.critAfterHurt)}초간 모든 공격이 치명타`;
  } else if (w?.kind === 'shield' && w.shockwave) {
    return `패링 시 충격파 (반경 ${w.shockwave.radius}px, 피해 ${dmg(w.shockwave.damage)}, 기절 ${num(w.shockwave.stun)}초)`;
  } else if (w?.kind === 'bow' && w.pierce) return '완전히 당긴 화살이 경로의 모든 적을 관통';
  switch (id) {
    case 'corpse_bomb': return `폭발 (반경 ${CORPSE_BOMB.radius}px, 피해 ${dmg(SKILL_BASE.corpse_bomb)}) · 처치한 적은 다시 폭발 (반경 ${CORPSE_BOMB.chain.radius}px, 피해 ${dmg(CORPSE_BOMB.chain.base)})`;
    case 'bone_spikes': return `뼈 가시 ${BONE_SPIKES.count}개가 ${num(BONE_SPIKES.interval)}초 간격으로 ${BONE_SPIKES.spacing}px씩 솟는다 (개당 피해 ${dmg(SKILL_BASE.bone_spikes)})`;
    case 'soul_lantern': return `영혼불 ${SOUL_LANTERN.flames}개가 ${num(SOUL_LANTERN.life)}초간 주위를 돈다 (닿으면 피해 ${dmg(SKILL_BASE.soul_lantern)} + 화상 ${num(SOUL_LANTERN.burn)}초)`;
    case 'chain_hook': return `${CHAIN_HOOK.range}px 앞의 첫 적을 끌어온다 (피해 ${dmg(SKILL_BASE.chain_hook)}, 기절 ${num(CHAIN_HOOK.stun)}초)`;
    default: return '';
  }
}

/** Lines for the item card (description, numbers, signature of a unique, affix). */
export function itemLines(inst: ItemInstance): string[] {
  const def = ITEMS[inst.id];
  const out = [def.desc];
  const w = (WEAPONS as Record<string, (typeof WEAPONS)[keyof typeof WEAPONS]>)[inst.id];
  if (w?.kind === 'melee') out.push(`피해 ${(w as MeleeWeapon).hits.map((h) => cardDamage(inst, h.damage)).join(' / ')}`);
  else if (w?.kind === 'bow') out.push(`피해 최대 ${cardDamage(inst, w.damage)} (충전)`);
  else if (w?.kind === 'shield') out.push(`정면 피해 -${pct(w.reduction)} · 패링 시 기절 ${num(w.parryStun)}초`);
  else if (def.cooldown) out.push(`재사용 ${def.cooldown}초`);
  if (def.unique) out.push(signatureText(inst.id, (b) => cardDamage(inst, b)));
  if (inst.affix) out.push(AFFIX_NAMES[inst.affix]);
  return out;
}

/** Gold price in shops. */
export function itemPrice(inst: ItemInstance): number {
  const base = ITEMS[inst.id].slot === 'skill' ? 100 : 80;
  return base + 60 * (inst.tier - 1) + (inst.affix ? 40 : 0);
}

/** 시체 상점 base price (pieces, loop 1) of each unique item (docs/CONTENT3.md §5). */
export const UNIQUE_PRICE: Partial<Record<ItemId, number>> = {
  bone_cleaver: 22, reaper_scythe: 26, stitch_needle: 22, widow_fangs: 24, coffin_lid: 20, marrow_bow: 24,
  corpse_bomb: 18, bone_spikes: 16, soul_lantern: 20, chain_hook: 16,
};

/** What Selma asks for a unique item in the given loop: its base price times the loop multiplier, rounded. */
export function uniquePrice(id: ItemId, loop: number): number {
  return Math.round((UNIQUE_PRICE[id] ?? 20) * loopPriceMul(loop));
}
