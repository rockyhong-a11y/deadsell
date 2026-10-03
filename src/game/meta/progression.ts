import type { RunState } from '../run';
import type { SaveData } from './save';
import type { ItemId } from '../items/types';

/**
 * Alchemist (Collector) shop: permanent upgrades bought with cells.
 * OWNER: ui/meta agent — extend the catalogue/UI, keep these exports.
 */
export interface MetaUpgrade {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** can it be bought now? */
  available(s: SaveData): boolean;
  apply(s: SaveData): void;
  /** for unlock upgrades: icon/item id */
  item?: ItemId;
}

export const META_UPGRADES: MetaUpgrade[] = [
  {
    id: 'flask1', name: '회복 플라스크 +1', desc: '영구적으로 플라스크 충전 +1', cost: 30,
    available: (s) => s.upgrades.flask === 0, apply: (s) => { s.upgrades.flask = 1; },
  },
  {
    id: 'flask2', name: '회복 플라스크 +2', desc: '영구적으로 플라스크 충전 +1', cost: 70,
    available: (s) => s.upgrades.flask === 1, apply: (s) => { s.upgrades.flask = 2; },
  },
  {
    id: 'gold', name: '비상금', desc: '시작 골드 +100', cost: 25,
    available: (s) => s.upgrades.gold === 0, apply: (s) => { s.upgrades.gold = 1; },
  },
  ...([
    ['blood_sword', 20], ['spear', 25], ['twin_daggers', 25], ['war_hammer', 35],
    ['ice_grenade', 20], ['turret', 30], ['wolf_trap', 20],
  ] as [ItemId, number][]).map(([item, cost]): MetaUpgrade => ({
    id: 'unlock_' + item, name: '청사진: ' + item, desc: '드롭 목록에 추가', cost, item,
    available: (s) => !s.unlocked.includes(item), apply: (s) => { s.unlocked.push(item); },
  })),
];

/** Initialise a new run from the meta save (flasks, gold, starting equipment). */
export function applyRunStart(run: RunState, save: SaveData): void {
  run.maxFlasks = 1 + save.upgrades.flask;
  run.flasks = run.maxFlasks;
  run.gold = save.upgrades.gold ? 100 : 0;
  run.hp = run.maxHp;
  run.weapons = [{ id: 'rusty_sword', tier: 1, affix: null }, null];
  run.skills = [null, null];
}
