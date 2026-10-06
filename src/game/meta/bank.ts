import type { LevelSpec, RunState } from '../run';
import { MAX_LOOP, type SaveData } from './save';
import { STASH } from '../rules';

/**
 * The permanent bank of 시체 조각 (docs/CONTENT4.md §3): the pieces a run carries are lost on death, but entering a 쉼터 or
 * winning the run moves them into `save.pieces`, where they pay for Selma's crafting and the golem.
 */

/** Move every carried piece into the bank. Returns how many that was. The caller persists the save. */
export function bankPieces(run: Pick<RunState, 'pieces'>, save: Pick<SaveData, 'pieces'>): number {
  const n = Math.max(0, Math.floor(run.pieces));
  run.pieces = 0;
  save.pieces += n;
  return n;
}

/** Entering a level: a 쉼터 (`passage`) banks the carried pieces, every other level leaves them. Returns how many were banked. */
export function bankOnEntry(run: Pick<RunState, 'pieces'>, save: Pick<SaveData, 'pieces'>, kind: LevelSpec['kind']): number {
  return kind === 'passage' ? bankPieces(run, save) : 0;
}

/** What winning a run did: the pieces banked, the loop that was won and the one that starts next. */
export interface WinInfo {
  banked: number;
  loop: number;
  nextLoop: number;
}

/**
 * The Iron Matron fell (docs/CONTENT4.md §0): bank the carried pieces, keep a 종탑의 파편 tagged with the loop it was won in
 * (a save holds at most `STASH.shardCap`: the lowest one makes room) and move the save on to the next loop.
 * The caller persists the save.
 */
export function winRun(run: RunState, save: SaveData): WinInfo {
  const banked = bankPieces(run, save);
  const loop = run.loop;
  save.shards.push(loop);
  if (save.shards.length > STASH.shardCap) save.shards.splice(save.shards.indexOf(Math.min(...save.shards)), 1);
  save.loop = Math.min(MAX_LOOP, loop + 1);
  return { banked, loop, nextLoop: save.loop };
}
