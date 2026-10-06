import type { Sfx } from '../../engine/audio';
import type { Actor } from '../entity';
import type { ItemId, ItemInstance } from '../items/types';
import type { Player } from './player';
import { BoneSpikes, ChainHook, FlameTurret, Grenade, SoulFlames, TeslaCoil, Tornado, Turret, WolfTrap, denialWave, type GrenadeSpec, type GrenadeType } from './projectiles';

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
  /** `false` = nothing happened (no target in reach): the cooldown is not spent */
  use(p: Player, item: ItemInstance): boolean | void;
}

/**
 * Base damage per skill (fire grenade blast, ice grenade blast, one turret arrow, wolf trap bite; of the unique skills of
 * docs/CONTENT3.md §5: 시체 폭탄 blast, one 뼈 가시, one 영혼 등불 touch, 사슬 갈고리 hit; and of the ordinary skills of
 * docs/CONTENT4.md §5.2: 섬광탄 blast, 자석 수류탄 blast, 집속 수류탄 blast, one 테슬라 코일 zap, one 화염 포탑 tick, 거부의 파동, one 회오리 tick;
 * 위상 전이 does no damage).
 */
export const SKILL_BASE = {
  fire_grenade: 30, ice_grenade: 8, turret: 7, wolf_trap: 20,
  corpse_bomb: 40, bone_spikes: 18, soul_lantern: 10, chain_hook: 12,
  stun_grenade: 6, magnet_grenade: 24, cluster_grenade: 18, tesla_coil: 6, flame_turret: 4, wave_of_denial: 12, tornado: 3,
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

/** 섬광탄: blast radius (px) and stun seconds. */
export const STUN_GRENADE = { radius: 64, stun: 2 } as const;
/** 자석 수류탄: pull radius (px), seconds of pulling, pull speed (px/s), radius (px) of the blast that ends it; enemies with `knockbackTaken` below `minKnockback` are too heavy to pull. */
export const MAGNET_GRENADE = { radius: 96, pull: 0.6, speed: 340, blast: 40, minKnockback: CHAIN_HOOK.pullMinKnockback } as const;
/** 집속 수류탄: blast radius (px), bomblets it splits into, and each one's damage base, burst radius (px), side speed and lift (px/s). */
export const CLUSTER_GRENADE = { radius: 44, bomblets: 4, bomblet: { base: 12, radius: 28, speed: 130, lift: 240 } } as const;
/** 테슬라 코일: seconds it stands, seconds between zaps, reach (px), extra targets a zap chains to and how far (px) it jumps. */
export const TESLA_COIL = { life: 8, interval: 0.5, range: 140, chain: 1, chainRange: 80 } as const;
/** 화염 포탑: seconds it stands, flame length (px), fan-out (px per px, each side), seconds between ticks, burn seconds. */
export const FLAME_TURRET = { life: 6, range: 70, spread: 0.4, interval: 0.2, burn: 2 } as const;
/** 위상 전이: reach (px) to the target, stun seconds on it, and seconds her next hit stays a crit. */
export const PHASER = { range: 160, stun: 1, critWindow: 2 } as const;
/** 거부의 파동: radius (px) and knockback speed (px/s). */
export const WAVE_OF_DENIAL = { radius: 110, knockback: 420 } as const;
/** 회오리: distance (px) and seconds of travel, seconds between ticks, radius and height (px), drag speed (px/s); heavy enemies (`knockbackTaken` below `minKnockback`) are not dragged. */
export const TORNADO = { distance: 200, life: 2, interval: 0.2, radius: 30, height: 64, drag: 170, minKnockback: CHAIN_HOOK.pullMinKnockback } as const;

function lob(p: Player, item: ItemInstance, type: GrenadeType, base: number, spec?: GrenadeSpec): void {
  const vx = p.facing * 235 + p.vx * 0.35;
  p.world.spawn(new Grenade(p.x + p.facing * 8, p.y - 30, vx, -270, p, item, type, base, spec));
}

/**
 * 위상 전이: she appears right behind the nearest enemy in reach (the side it does not face; the other side when a wall is there),
 * stunning it, and her next weapon hit crits. False when there is no enemy to reach or no room behind or in front of it.
 */
function phase(p: Player): boolean {
  const w = p.world;
  let target: Actor | null = null;
  let bd: number = PHASER.range;
  for (const a of w.actors) {
    if (a.team !== 'enemy' || !a.targetable) continue;
    const d = Math.hypot(a.cx - p.x, a.cy - (p.y - p.h / 2));
    if (d < bd) {
      bd = d;
      target = a;
    }
  }
  if (!target) return false;
  const gap = target.w / 2 + p.w / 2 + 4;
  const behind = -target.facing;
  for (const side of [behind, -behind]) {
    const x = target.x + side * gap;
    const y = target.y;
    if (w.map.boxSolid({ x: x - p.w / 2, y: y - p.h, w: p.w, h: p.h - 2 })) continue;
    w.particles.emit('magic', p.x, p.y - 20, { count: 10, color: '#c690ff' });
    w.fx.ring(p.x, p.y - 20, { radius: 24, color: '#c690ff', life: 0.25 });
    p.x = x;
    p.y = y;
    p.vx = p.vy = 0;
    p.facing = (-side) as 1 | -1; // turned toward its back
    target.status.stun = Math.max(target.status.stun, PHASER.stun);
    p.armCrit(PHASER.critWindow);
    w.particles.emit('magic', p.x, p.y - 20, { count: 10, color: '#c690ff' });
    w.fx.ring(p.x, p.y - 20, { radius: 30, color: '#e8d8ff', life: 0.3 });
    w.fx.screenFlash('#c690ff', 0.08, 0.25);
    w.audio.play('roll', { pitch: 1.6 });
    return true;
  }
  return false;
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
  corpse_bomb: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'corpse', SKILL_BASE.corpse_bomb, CORPSE_BOMB) },
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
  // ordinary skills of docs/CONTENT4.md §5.2
  stun_grenade: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'stun', SKILL_BASE.stun_grenade, STUN_GRENADE) },
  magnet_grenade: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'magnet', SKILL_BASE.magnet_grenade, MAGNET_GRENADE) },
  cluster_grenade: { anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5, use: (p, it) => lob(p, it, 'cluster', SKILL_BASE.cluster_grenade, CLUSTER_GRENADE) },
  tesla_coil: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new TeslaCoil(p.x + p.facing * 18, p.y, p, it, SKILL_BASE.tesla_coil, TESLA_COIL)); },
  },
  flame_turret: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new FlameTurret(p.x + p.facing * 18, p.y, p, it, SKILL_BASE.flame_turret, p.facing, FLAME_TURRET)); },
  },
  phaser: { anim: 'throw', castTime: 0.3, fireAt: 0.1, sfx: 'throw', moveScale: 0.5, use: (p) => phase(p) },
  wave_of_denial: {
    anim: 'deploy', castTime: 0.45, fireAt: 0.22, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { denialWave(p, it, SKILL_BASE.wave_of_denial, WAVE_OF_DENIAL); },
  },
  tornado: {
    anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5,
    use: (p, it) => { p.world.spawn(new Tornado(p.x + p.facing * 20, p.y, p, it, SKILL_BASE.tornado, p.facing, TORNADO)); },
  },
};
