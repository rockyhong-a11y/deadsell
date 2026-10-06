import type { AABB } from '../engine/math';
import { overlaps } from '../engine/math';
import type { Actor } from './entity';
import type { World } from './world';

export type Team = 'player' | 'enemy' | 'neutral';
export type ItemColor = 'brutality' | 'tactics' | 'survival';

export interface DamageInfo {
  amount: number;
  /** -1/1 = direction the hit pushes the target; 0 = none */
  dir: number;
  kind: 'melee' | 'ranged' | 'explosion' | 'trap' | 'dot' | 'hazard';
  source?: Actor | null;
  knockback?: number; // px/s horizontal
  knockup?: number; // px/s upward
  stun?: number; // seconds of stun
  hitstun?: number; // seconds of hit-stun (default 0.18)
  crit?: boolean;
  burn?: number; // seconds
  burnDps?: number;
  bleed?: number; // seconds
  freeze?: number; // seconds
  /** shields cannot block it (boss slams, explosions) */
  unblockable?: boolean;
  /** for dot numbers */
  dotType?: 'burn' | 'bleed';
  /** item colour that dealt it (for colour-coded damage numbers) */
  color?: ItemColor;
}

export interface DamageResult {
  applied: boolean;
  amount: number;
  killed: boolean;
  blocked?: boolean;
  parried?: boolean;
}

export interface HitReport {
  target: Actor;
  result: DamageResult;
}

/**
 * Damage every opposing, targetable actor whose hurtbox overlaps `box`.
 * `info` may be a function to customise per target (crits from behind, etc.).
 * `already` (actor ids) prevents multi-hits across the frames of one swing.
 * Player-team attacks also break breakable tiles inside the box, unless `opts.breakTiles` is false (an ally's attack is not
 * the heroine's: the rag golem does not open secret walls on its own).
 */
export function hitArea(
  world: World,
  box: AABB,
  team: Team,
  info: DamageInfo | ((t: Actor) => DamageInfo | null),
  already?: Set<number>,
  opts: { breakTiles?: boolean } = {},
): HitReport[] {
  const out: HitReport[] = [];
  for (const e of world.actors) {
    if (e.team === team || e.team === 'neutral' || !e.targetable) continue;
    if (already?.has(e.id)) continue;
    if (!overlaps(box, e.hurtbox())) continue;
    const di = typeof info === 'function' ? info(e) : info;
    if (!di) continue;
    already?.add(e.id);
    const result = e.takeDamage(di);
    out.push({ target: e, result });
  }
  if (team === 'player' && opts.breakTiles !== false) world.breakTilesIn(box);
  return out;
}

/** Does `attacker` stand behind `target` (relative to the target's facing)? */
export function isBehind(attacker: { x: number }, target: { x: number; facing: number }): boolean {
  return (attacker.x - target.x) * target.facing < 0;
}

export const COLOR_HEX: Record<ItemColor, string> = {
  brutality: '#e2483d',
  tactics: '#a65be8',
  survival: '#5ec24a',
};
