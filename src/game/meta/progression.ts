import type { RunState } from '../run';
import type { SaveData } from './save';
import type { ItemId } from '../items/types';
import { ITEMS } from '../items/items';

/**
 * Alchemist (Collector) shop: permanent upgrades bought with cells.
 * Cells are lost on death unless spent here, so the costs are small enough that a
 * decent run affords one or two upgrades per passage.
 */
export interface MetaUpgrade {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** can it be bought now? */
  available(s: SaveData): boolean;
  apply(s: SaveData): void;
  /** has it been bought already? */
  owned(s: SaveData): boolean;
  /** also benefit the run in progress (the save only affects the next run) */
  onBuy?(run: RunState): void;
  /** for unlock upgrades: icon/item id */
  item?: ItemId;
  /** icon animation in the `icons` sheet */
  icon: string;
}

export const META_UPGRADES: MetaUpgrade[] = [
  {
    id: 'flask1', name: '회복 플라스크 +1', desc: '플라스크 충전 +1', cost: 30, icon: 'flask',
    available: (s) => s.upgrades.flask === 0, owned: (s) => s.upgrades.flask >= 1,
    apply: (s) => { s.upgrades.flask = 1; },
    onBuy: (r) => { r.maxFlasks++; r.flasks++; },
  },
  {
    id: 'flask2', name: '회복 플라스크 +2', desc: '플라스크 충전 +1 더', cost: 70, icon: 'flask',
    available: (s) => s.upgrades.flask === 1, owned: (s) => s.upgrades.flask >= 2,
    apply: (s) => { s.upgrades.flask = 2; },
    onBuy: (r) => { r.maxFlasks++; r.flasks++; },
  },
  {
    id: 'gold', name: '비상금', desc: '시작 골드 +100', cost: 25, icon: 'gold',
    available: (s) => s.upgrades.gold === 0, owned: (s) => s.upgrades.gold >= 1,
    apply: (s) => { s.upgrades.gold = 1; },
    onBuy: (r) => { r.gold += 100; },
  },
  ...([
    ['blood_sword', 20], ['spear', 25], ['twin_daggers', 25], ['war_hammer', 35],
    ['ice_grenade', 20], ['turret', 30], ['wolf_trap', 20],
  ] as [ItemId, number][]).map(([item, cost]): MetaUpgrade => ({
    id: 'unlock_' + item, name: '청사진: ' + ITEMS[item].name, desc: '드롭 목록에 추가', cost, item, icon: ITEMS[item].icon,
    available: (s) => !s.unlocked.includes(item), owned: (s) => s.unlocked.includes(item),
    apply: (s) => { s.unlocked.push(item); },
  })),
];

export type BuyResult = 'ok' | 'poor' | 'owned' | 'locked';

/** Why the upgrade cannot be bought right now (null = it can). */
export function buyBlock(u: MetaUpgrade, run: Pick<RunState, 'cells'>, save: SaveData): BuyResult | null {
  if (u.owned(save)) return 'owned';
  if (!u.available(save)) return 'locked';
  if (run.cells < u.cost) return 'poor';
  return null;
}

/** Spend carried cells on an upgrade. The caller persists the save. */
export function buyUpgrade(u: MetaUpgrade, run: RunState, save: SaveData): BuyResult {
  const block = buyBlock(u, run, save);
  if (block) return block;
  run.cells -= u.cost;
  run.cellsSpentThisRun += u.cost;
  u.apply(save);
  u.onBuy?.(run);
  return 'ok';
}

/** How many of the catalogue's items are unlocked (title screen stat). */
export function unlockedCount(save: SaveData): { have: number; total: number } {
  return { have: save.unlocked.length, total: Object.keys(ITEMS).length };
}

/** Initialise a new run from the meta save (flasks, gold, starting equipment). */
export function applyRunStart(run: RunState, save: SaveData): void {
  run.loop = save.loop;
  run.maxFlasks = 1 + save.upgrades.flask;
  run.flasks = run.maxFlasks;
  run.gold = save.upgrades.gold ? 100 : 0;
  run.hp = run.maxHp;
  run.weapons = [{ id: 'rusty_sword', tier: 1, affix: null }, null];
  run.skills = [null, null];
}
