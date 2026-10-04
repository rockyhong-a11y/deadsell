import type { Sfx } from '../../engine/audio';
import type { ItemId, ItemInstance } from '../items/types';
import type { Player } from './player';
import { BoneSpikes, ChainHook, Grenade, SoulFlames, Turret, WolfTrap } from './projectiles';

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

/**
 * Base damage per skill (fire grenade blast, ice grenade blast, one turret arrow, wolf trap bite; and of the unique skills of
 * docs/CONTENT3.md §5: 시체 폭탄 blast, one 뼈 가시, one 영혼 등불 touch, 사슬 갈고리 hit).
 */
export const SKILL_BASE = {
  fire_grenade: 30, ice_grenade: 8, turret: 7, wolf_trap: 20,
  corpse_bomb: 40, bone_spikes: 18, soul_lantern: 10, chain_hook: 12,
} as const;
export type SkillId = keyof typeof SKILL_BASE;

/** 시체 폭탄: blast radius (px); each enemy the blast kills bursts once more (`chain`, no further levels). */
export const CORPSE_BOMB = { radius: 56, chain: { radius: 44, base: 20 } } as const;
/** 뼈 가시: spikes (one every `interval` s, `spacing` px apart along the floor in front), knock-up speed, spike box (px), seconds a spike hurts / stays. */
export const BONE_SPIKES = { count: 5, interval: 0.08, spacing: 28, knockup: 220, w: 14, h: 34, active: 0.12, life: 0.55 } as const;
/** 영혼 등불: flames, orbit radius (px) and speed (rad/s), seconds they last, burn seconds / per second, seconds between two hits on one enemy. */
export const SOUL_LANTERN = { flames: 3, radius: 34, spin: 3.4, life: 8, burn: 2, burnDps: 6, hitCd: 0.4 } as const;
/** 사슬 갈고리: reach and speed (px, px/s), pull speed, stun seconds; enemies with `knockbackTaken` below `pullMinKnockback` are only stunned. */
export const CHAIN_HOOK = { range: 220, speed: 560, pullSpeed: 520, stun: 1, pullMinKnockback: 0.3 } as const;

function lob(p: Player, item: ItemInstance, type: 'fire' | 'ice' | 'corpse', base: number): void {
  const vx = p.facing * 235 + p.vx * 0.35;
  const g = new Grenade(p.x + p.facing * 8, p.y - 30, vx, -270, p, item, type, base, type === 'corpse' ? CORPSE_BOMB : undefined);
  p.world.spawn(g);
}

export const SKILLS: Partial<Record<ItemId, SkillDef>> = {
  fire_grenade: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'fire', SKILL_BASE.fire_grenade) },
  ice_grenade: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'ice', SKILL_BASE.ice_grenade) },
  turret: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new Turret(p.x + p.facing * 18, p.y, p, it, SKILL_BASE.turret, p.facing)); },
  },
  wolf_trap: {
    anim: 'deploy', castTime: 0.45, fireAt: 0.22, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new WolfTrap(p.x + p.facing * 20, p.y, p, it, SKILL_BASE.wolf_trap)); },
  },
  corpse_bomb: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'corpse', SKILL_BASE.corpse_bomb) },
  bone_spikes: {
    anim: 'deploy', castTime: 0.45, fireAt: 0.22, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new BoneSpikes(p.x, p.y, p, it, SKILL_BASE.bone_spikes, p.facing, BONE_SPIKES)); },
  },
  soul_lantern: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new SoulFlames(p, it, SKILL_BASE.soul_lantern, SOUL_LANTERN)); },
  },
  chain_hook: {
    anim: 'throw', castTime: 0.3, fireAt: 0.1, sfx: 'throw', moveScale: 0.5,
    use: (p, it) => { p.world.spawn(new ChainHook(p.x + p.facing * 10, p.y - 30, p, it, SKILL_BASE.chain_hook, p.facing, CHAIN_HOOK)); },
  },
};
