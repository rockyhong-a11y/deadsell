import type { Sfx } from '../../engine/audio';
import type { ItemId, ItemInstance } from '../items/types';
import type { Player } from './player';
import { Grenade, Turret, WolfTrap } from './projectiles';

/**
 * Skills (skill1 / skill2). Cooldown lives in ITEMS[id].cooldown; numbers here.
 * `use` runs `fireAt` seconds into the cast animation (so the throw leaves the hand
 * at the right frame).
 */
export interface SkillDef {
  anim: 'throw' | 'deploy';
  castTime: number;
  fireAt: number;
  sfx: Sfx;
  /** movement multiplier while casting */
  moveScale: number;
  use(p: Player, item: ItemInstance): void;
}

function lob(p: Player, item: ItemInstance, type: 'fire' | 'ice', base: number): void {
  const vx = p.facing * 235 + p.vx * 0.35;
  const g = new Grenade(p.x + p.facing * 8, p.y - 30, vx, -270, p, item, type, base);
  p.world.spawn(g);
}

export const SKILLS: Partial<Record<ItemId, SkillDef>> = {
  fire_grenade: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'fire', 30) },
  ice_grenade: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'ice', 8) },
  turret: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new Turret(p.x + p.facing * 18, p.y, p, it, 7, p.facing)); },
  },
  wolf_trap: {
    anim: 'deploy', castTime: 0.45, fireAt: 0.22, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new WolfTrap(p.x + p.facing * 20, p.y, p, it, 20)); },
  },
};
