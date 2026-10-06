import type { SaveData } from './save';
import type { ItemId, ItemInstance } from '../items/types';
import { ITEMS } from '../items/items';
import { UNIQUE_IDS } from '../items/types';
import { CRAFT, CRAFT_MIN_TIER, GRADE_IDS, STASH, type Grade, type Material } from '../rules';

/**
 * Crafting uniques at Selma (docs/CONTENT4.md §4): every grade has a recipe in `CRAFT` (stash entries, bell shards, bank pieces).
 * The materials are taken from the stash automatically: the cheapest qualifying entries (lowest tier, then without an affix,
 * then not from a mid-boss, then the oldest = the lowest index). Pure functions on the save; the caller persists it.
 */

/** The unique items of a grade, in `UNIQUE_IDS` order (five each). */
export const uniquesOf = (grade: Grade): ItemId[] => UNIQUE_IDS.filter((id) => ITEMS[id].grade === grade);

/** Does this stash entry satisfy a material line? (uniques are never ordinary materials, ordinary items never a unique line) */
export function qualifies(inst: ItemInstance, m: Material): boolean {
  const def = ITEMS[inst.id];
  if (m.what === 'unique') return !!def.unique && def.grade === m.grade;
  if (def.unique) return false;
  switch (m.what) {
    case 'any': return true;
    case 'affix': return inst.affix !== null;
    case 'tier': return inst.tier >= CRAFT_MIN_TIER;
    case 'mb': return !!inst.mb;
  }
}

/** The order the lines claim entries in: the most specific first, so a mid-boss item is not spent on a plain "any" line. */
const CLAIM_RANK: Record<Material['what'], number> = { unique: 0, mb: 1, tier: 2, affix: 3, any: 4 };

/** Cheapest first: lowest tier, no affix, not from a mid-boss, oldest. */
const byCost = (stash: readonly ItemInstance[]) => (a: number, b: number): number => {
  const x = stash[a], y = stash[b];
  return x.tier - y.tier || Number(x.affix !== null) - Number(y.affix !== null) || Number(!!x.mb) - Number(!!y.mb) || a - b;
};

/** One line of the recipe as the craft screen shows it: what it asks for and how much of it there is. */
export interface CraftLine {
  label: string;
  have: number;
  need: number;
  ok: boolean;
}

/** What crafting a grade would do right now. `picks` = the stash indices that would be consumed, `shardPicks` = the indices into `save.shards`. */
export interface CraftPlan {
  grade: Grade;
  lines: CraftLine[];
  /** every line is met */
  ok: boolean;
  picks: number[];
  shardPicks: number[];
}

/** Player-facing label of a material line. */
export function materialLabel(m: Material): string {
  switch (m.what) {
    case 'any': return '아이템 (유니크 제외)';
    case 'affix': return '접사가 붙은 아이템';
    case 'tier': return `티어 ${CRAFT_MIN_TIER} 이상 아이템`;
    case 'mb': return '중간 보스 아이템';
    case 'unique': return `${m.grade}급 유니크`;
  }
}

/** Label of the bell shard line of a recipe. */
export const shardLabel = (minLoop: number): string => (minLoop > 1 ? `종탑의 파편 (${minLoop}회차 이상)` : '종탑의 파편');

/**
 * Plan a craft: for every line the entries that are still free for it (`have` counts the ones not claimed by a more specific
 * line), the cheapest `need` of them as `picks`, the bell shards (the lowest loops that are good enough) and the bank pieces.
 */
export function planCraft(grade: Grade, save: Pick<SaveData, 'stash' | 'shards' | 'pieces'>): CraftPlan {
  const r = CRAFT[grade];
  const taken = new Set<number>();
  const picks: number[] = [];
  const have = new Map<Material, number>();
  const order = [...r.items].sort((a, b) => CLAIM_RANK[a.what] - CLAIM_RANK[b.what]);
  for (const m of order) {
    const free = save.stash.map((_, i) => i).filter((i) => !taken.has(i) && qualifies(save.stash[i], m));
    have.set(m, free.length);
    for (const i of free.sort(byCost(save.stash)).slice(0, m.n)) {
      taken.add(i);
      picks.push(i);
    }
  }
  const lines: CraftLine[] = r.items.map((m) => ({ label: materialLabel(m), have: have.get(m) ?? 0, need: m.n, ok: (have.get(m) ?? 0) >= m.n }));
  let shardPicks: number[] = [];
  if (r.shards) {
    const good = save.shards.map((loop, i) => ({ loop, i })).filter((s) => s.loop >= r.shards!.minLoop).sort((a, b) => a.loop - b.loop || a.i - b.i);
    shardPicks = good.slice(0, r.shards.n).map((s) => s.i);
    lines.push({ label: shardLabel(r.shards.minLoop), have: good.length, need: r.shards.n, ok: good.length >= r.shards.n });
  }
  lines.push({ label: '시체 조각', have: save.pieces, need: r.pieces, ok: save.pieces >= r.pieces });
  return { grade, lines, ok: lines.every((l) => l.ok), picks, shardPicks };
}

export type CraftResult = { ok: true; item: ItemInstance } | { ok: false; reason: 'unknown' | 'materials' | 'full' };

/**
 * Craft the unique `id` of `grade`: consumes the planned stash entries, bell shards and bank pieces and puts the unique (the grade's
 * tier, no affix) into the stash. Nothing changes unless it works.
 */
export function craftUnique(save: Pick<SaveData, 'stash' | 'shards' | 'pieces'>, grade: Grade, id: ItemId): CraftResult {
  if (!GRADE_IDS.includes(grade) || !ITEMS[id]?.unique || ITEMS[id].grade !== grade) return { ok: false, reason: 'unknown' };
  const plan = planCraft(grade, save);
  if (!plan.ok) return { ok: false, reason: 'materials' };
  // the unique takes the place of what is consumed (there are always at least two entries to consume)
  if (save.stash.length - plan.picks.length >= STASH.capacity) return { ok: false, reason: 'full' };
  for (const i of [...plan.picks].sort((a, b) => b - a)) save.stash.splice(i, 1);
  for (const i of [...plan.shardPicks].sort((a, b) => b - a)) save.shards.splice(i, 1);
  save.pieces -= CRAFT[grade].pieces;
  const item: ItemInstance = { id, tier: CRAFT[grade].tier, affix: null };
  save.stash.push(item);
  return { ok: true, item };
}

/** The recipe of a grade as one line (codex pages): `접사가 붙은 아이템 3개 + 시체 조각 20 → 티어 2`. */
export function recipeText(grade: Grade): string {
  const r = CRAFT[grade];
  const parts = r.items.map((m) => `${materialLabel(m)} ${m.n}개`);
  if (r.shards) parts.push(`${shardLabel(r.shards.minLoop)} ${r.shards.n}개`);
  parts.push(`시체 조각 ${r.pieces}`);
  return `${parts.join(' + ')} → 티어 ${r.tier}`;
}
