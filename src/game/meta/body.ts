import type { RunState } from '../run';
import { MAX_LOOP, type SaveData } from './save';
import { CORPSE } from '../rules';

/**
 * Cinder's body (docs/CONTENT3.md §1): Selma sews the carried pieces (`run.pieces`) into `save.body`.
 * The pieces she has sewn are permanent; the whole body (100) clears the loop.
 */

/** What a sew does right now. `surplus` = carried pieces beyond what the body needs; they are lost when the body is completed. */
export interface SewPlan {
  /** pieces that go into the body (never more than it still needs) */
  n: number;
  /** does this sew complete the body? */
  completes: boolean;
  surplus: number;
}

/** The outcome of a sew: the plan that was carried out and, when it made the body whole, the loop that was cleared. */
export interface SewResult {
  plan: SewPlan;
  cleared: LoopInfo | null;
}

/** A loop that was just cleared: its number and how many runs it took. */
export interface LoopInfo {
  loop: number;
  runs: number;
}

export function sewPlan(pieces: number, body: number): SewPlan {
  const need = CORPSE.body - body;
  return { n: Math.max(0, Math.min(pieces, need)), completes: pieces >= need, surplus: Math.max(0, pieces - need) };
}

/** Pieces the body still needs. */
export const bodyNeed = (body: number): number => CORPSE.body - body;

/** The next loop starts: the body is empty again and the run counter restarts. The caller persists the save. */
export function completeLoop(save: SaveData): LoopInfo {
  const info = { loop: save.loop, runs: save.loopRuns };
  save.loop = Math.min(MAX_LOOP, save.loop + 1);
  save.body = 0;
  save.loopRuns = 0;
  return info;
}

/**
 * Sew every carried piece into the body. A sew that completes the body clears the loop (`cleared`) and the surplus is lost.
 * Changes `run` and `save`; the caller persists the save.
 */
export function sewPieces(run: RunState, save: SaveData): SewResult {
  const plan = sewPlan(run.pieces, save.body);
  if (plan.n <= 0) return { plan, cleared: null };
  run.pieces = plan.completes ? 0 : run.pieces - plan.n;
  run.piecesSewn += plan.n;
  save.body += plan.n;
  return { plan, cleared: plan.completes ? completeLoop(save) : null };
}
