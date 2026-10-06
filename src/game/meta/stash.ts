import type { RunState } from '../run';
import type { SaveData } from './save';
import type { ItemInstance, ItemSlot } from '../items/types';
import { ITEMS } from '../items/items';
import { GRADES, STASH } from '../rules';

/**
 * 보관함 (stash, docs/CONTENT4.md §2): the permanent store of items (`save.stash`, at most `STASH.capacity`, no holes).
 * Everything here changes the save / run only; the caller persists the save.
 */

export const stashCount = (save: Pick<SaveData, 'stash'>): number => save.stash.length;
export const stashFull = (save: Pick<SaveData, 'stash'>): boolean => save.stash.length >= STASH.capacity;

/** Put an item into the stash. False (nothing changes) when it is full. */
export function addToStash(save: Pick<SaveData, 'stash'>, inst: ItemInstance): boolean {
  if (stashFull(save)) return false;
  save.stash.push(inst);
  return true;
}

/** The four equipment slots of a run by kind: weapons (primary, secondary) or skills. */
export const slotsOf = (run: Pick<RunState, 'weapons' | 'skills'>, kind: ItemSlot): (ItemInstance | null)[] => (kind === 'weapon' ? run.weapons : run.skills);

/** Index of the first empty slot for an item of this kind, or -1 when both are taken. */
export const emptySlotFor = (run: Pick<RunState, 'weapons' | 'skills'>, inst: ItemInstance): number => slotsOf(run, ITEMS[inst.id].slot).findIndex((s) => s === null);

/**
 * Equip the stash entry `index` into slot `slot` of its kind. What stood there goes into the stash in the entry's place (an
 * empty slot just frees the stash cell). Returns false when the index or the slot is out of range.
 */
export function equipFromStash(run: Pick<RunState, 'weapons' | 'skills'>, save: Pick<SaveData, 'stash'>, index: number, slot: number): boolean {
  const inst = save.stash[index];
  if (!inst) return false;
  const slots = slotsOf(run, ITEMS[inst.id].slot);
  if (slot < 0 || slot >= slots.length) return false;
  const old = slots[slot];
  slots[slot] = inst;
  if (old) save.stash[index] = old;
  else save.stash.splice(index, 1);
  return true;
}

/** Put the equipped item of slot `slot` into the stash; the slot is empty afterwards (an empty primary weapon is allowed). False when the slot is empty or the stash full. */
export function depositEquipped(run: Pick<RunState, 'weapons' | 'skills'>, save: Pick<SaveData, 'stash'>, kind: ItemSlot, slot: number): boolean {
  const slots = slotsOf(run, kind);
  const inst = slots[slot];
  if (!inst || stashFull(save)) return false;
  slots[slot] = null;
  save.stash.push(inst);
  return true;
}

/** Pieces a salvaged item yields: a normal item `1 + (tier - 1) + (affix ? 1 : 0)`, a unique the salvage value of its grade. */
export function salvageValue(inst: ItemInstance): number {
  const def = ITEMS[inst.id];
  if (def.unique) return def.grade ? GRADES[def.grade].salvage : 1;
  return 1 + (inst.tier - 1) + (inst.affix ? 1 : 0);
}

/** Salvage the stash entry `index` into bank pieces. Returns the pieces gained, or -1 when there is no such entry. */
export function salvageEntry(save: Pick<SaveData, 'stash' | 'pieces'>, index: number): number {
  const inst = save.stash[index];
  if (!inst) return -1;
  const n = salvageValue(inst);
  save.stash.splice(index, 1);
  save.pieces += n;
  return n;
}
