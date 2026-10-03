import type { Actor } from '../entity';
import { createEnemy } from '../enemies/factory';

/**
 * The Iron Matron boss. OWNER: enemies/boss agent.
 * Must emit {type:'bossStart'} when the fight begins and {type:'bossDefeated'} when she dies.
 */
export function createBoss(x: number, y: number): Actor {
  return createEnemy('jailer', x, y, { tier: 3, elite: true });
}
