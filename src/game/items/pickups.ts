import type { World } from '../world';
import type { ItemInstance } from './types';

/**
 * Pickups: cells, gold, food, scrolls, dropped items. OWNER: player agent.
 * Stub implementations — keep these exported functions.
 */

/** Scatter cells and gold from a defeated enemy / opened chest. */
export function dropLoot(_world: World, _x: number, _y: number, _loot: { cells?: number; gold?: number }): void {}

/** Drop an item on the floor (interactable: pick up / swap). */
export function spawnItemDrop(_world: World, _x: number, _y: number, _inst: ItemInstance): void {}

/** Drop a food pickup (heals). */
export function spawnFood(_world: World, _x: number, _y: number, _healPct = 0.35): void {}

/** Drop a scroll of power (on pickup the player chooses a stat). */
export function spawnScroll(_world: World, _x: number, _y: number): void {}
