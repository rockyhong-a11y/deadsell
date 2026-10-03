import type { RunState } from '../run';
import type { ItemInstance } from '../items/types';
import { ITEMS } from '../items/items';

/**
 * Damage = base x run.damageMult(colour) x (1 + 0.25 x (tier - 1)) x affix(+20 %).
 * Crits (x2) are applied by the caller.
 */
export function calcDamage(run: RunState, item: ItemInstance, base: number): number {
  const color = ITEMS[item.id].color;
  return base * run.damageMult(color) * (1 + 0.25 * (item.tier - 1)) * (item.affix === 'dmg' ? 1.2 : 1);
}
