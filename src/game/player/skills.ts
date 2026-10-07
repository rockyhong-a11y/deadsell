import type { Sfx } from '../../engine/audio';
import type { Actor } from '../entity';
import type { ItemId, ItemInstance } from '../items/types';
import type { Player } from './player';
import { BoneSpikes, ChainHook, FlameTurret, Grenade, SoulFlames, TeslaCoil, Tornado, Turret, WolfTrap, denialWave, type GrenadeSpec, type GrenadeType } from './projectiles';
import { ChainPrison, DeathOrb, NeedleRain, PlagueAura, lastBell, summonDoll } from './uniques';
import { TILE } from '../../engine/config';
import { T } from '../tilemap';

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
 * 위상 전이 does no damage; and of the unique skills of grades A to SSS (§5.3): one 역병 향로 tick (every 0.5 s: 8 a second), one 뼈 포탑 shard,
 * the 죽음의 구슬 burst, the 사슬 감옥 blow, the 누더기 인형's slam, one 핏빛 비 needle and the 마지막 종 toll; 진혼곡 does no damage).
 */
export const SKILL_BASE = {
  fire_grenade: 30, ice_grenade: 8, turret: 7, wolf_trap: 20,
  corpse_bomb: 40, bone_spikes: 18, soul_lantern: 10, chain_hook: 12,
  stun_grenade: 6, magnet_grenade: 24, cluster_grenade: 18, tesla_coil: 6, flame_turret: 4, wave_of_denial: 12, tornado: 3,
  plague_censer: 4, bone_turret: 14, death_orb: 20, chain_prison: 20, rag_doll: 40, crimson_rain: 5, last_bell: 120,
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

/**
 * The unique skills of docs/CONTENT4.md §5.3 (A to SSS). The power target of their grade (A +30 %, S +45 %, SS +60 %, SSS +80 %) is measured in damage
 * per second of cooldown on one target against the ordinary skill of their family (turret 7.1, tornado 2.0, cluster grenade 4.7): the 뼈 포탑 does 9.6,
 * the 역병 향로 2.7 on everyone around her, the 핏빛 비 about 10 with its bleed; the others are utility whose cooldown is their price.
 */

/** 역병 향로: seconds it lasts, radius (px) around her and seconds between ticks (a tick hurts for `SKILL_BASE.plague_censer`). */
export const PLAGUE_CENSER = { life: 6, radius: 72, interval: 0.5 } as const;
/** 뼈 포탑: a turret that stands `life` s, sees `range` px and fires a piercing, bone-white shard every `interval` s. */
export const BONE_TURRET = { life: 10, range: 220, interval: 0.9, pierce: true, outline: '#f0e6d2' } as const;
/** 죽음의 구슬: seconds it floats, px ahead of her, how close (px) to it an enemy must die, the burst it makes (radius px, damage base) and the share of max HP it heals. */
export const DEATH_ORB = { life: 8, ahead: 56, reach: 90, burst: { radius: 48, base: 20 }, heal: 0.02 } as const;
/** 사슬 감옥: radius (px) around her, seconds the chains hold, and the knockbackTaken below which an enemy is too heavy to be held in place. */
export const CHAIN_PRISON = { radius: 120, root: 2.5, minKnockback: CHAIN_HOOK.pullMinKnockback } as const;
/** 누더기 인형: scale of the golem sprite, seconds it stays, its hp, the speed of its slam (a multiple of the golem's durations) and seconds between two slams. */
export const RAG_DOLL = { scale: 0.5, life: 10, hp: 150, tempo: 0.6, cooldown: 1.1 } as const;
/** 핏빛 비: seconds it rains, the stretch ahead of her it covers (px from, px to), seconds between two volleys, bleed seconds of a needle and the height (px) of the rain. */
export const CRIMSON_RAIN = { life: 2, from: 16, reach: 160, interval: 0.1, bleed: 2, height: 130 } as const;
/** 마지막 종: the damage base a boss or mid-boss takes (everything else takes `SKILL_BASE.last_bell`) and the seconds everything else is stunned. */
export const LAST_BELL = { boss: 40, stun: 2 } as const;
/** 진혼곡: seconds it lasts, the share of the other skill's cooldown each kill gives back, the share of max HP each hit heals and the seconds before the next heal. */
export const REQUIEM = { life: 6, refund: 0.3, heal: 0.01, healCd: 0.1 } as const;

function lob(p: Player, item: ItemInstance, type: GrenadeType, base: number, spec?: GrenadeSpec): void {
  const vx = p.facing * 235 + p.vx * 0.35;
  p.world.spawn(new Grenade(p.x + p.facing * 8, p.y - 30, vx, -270, p, item, type, base, spec));
}

/** how far (px) below a flying target a phaser landing may look for the floor */
const PHASE_DROP = 4 * TILE;

/**
 * Where she would stand at `x` beside `target`: on its own level when it stands on the floor, else on the floor below that spot
 * (a flyer hangs in the air). Null when there is no floor under it (a pit) or the box would overlap a wall or spikes.
 */
function phaseSpot(p: Player, target: Actor, x: number): number | null {
  const map = p.world.map;
  let y = target.y;
  if (!target.onGround) {
    const f = map.floorBelow(x, target.y, PHASE_DROP);
    if (f === null) return null;
    y = f;
  } else {
    const f = map.floorBelow(x, y - 4, 12);
    if (f === null || Math.abs(f - y) > 6) return null;
  }
  const box = { x: x - p.w / 2, y: y - p.h, w: p.w, h: p.h };
  if (map.boxSolid({ ...box, h: box.h - 2 }) || map.boxHas(box, T.Spikes)) return null;
  // not through a wall: the spot is in sight of the enemy
  return map.lineOfSight(target.cx, target.cy, x, y - p.h / 2) ? y : null;
}

/**
 * 위상 전이: she appears right behind the nearest enemy in reach and in sight (the side it does not face; the other side when that
 * has no room or no floor), stunning it, and her next weapon hit crits. A target behind a wall, or one with no floor to land on at
 * either side (a pit, spikes), is skipped for the next nearest. False when none is left: nothing happens and the cooldown is kept.
 */
function phase(p: Player): boolean {
  const w = p.world;
  const cy = p.y - p.h / 2;
  const targets = w.actors
    .filter((a) => a.team === 'enemy' && a.targetable)
    .map((a) => ({ a, d: Math.hypot(a.cx - p.x, a.cy - cy) }))
    .filter(({ a, d }) => d < PHASER.range && w.map.lineOfSight(p.x, cy, a.cx, a.cy))
    .sort((u, v) => u.d - v.d);
  for (const { a: target } of targets) {
    const gap = target.w / 2 + p.w / 2 + 4;
    const behind = -target.facing;
    for (const side of [behind, -behind]) {
      const x = target.x + side * gap;
      const y = phaseSpot(p, target, x);
      if (y === null) continue;
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
  // unique skills of grades A to SSS (docs/CONTENT4.md §5.3)
  plague_censer: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new PlagueAura(p, it, SKILL_BASE.plague_censer, PLAGUE_CENSER)); },
  },
  bone_turret: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new Turret(p.x + p.facing * 18, p.y, p, it, SKILL_BASE.bone_turret, p.facing, BONE_TURRET)); },
  },
  death_orb: {
    anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5,
    use: (p, it) => { p.world.spawn(new DeathOrb(p, it, DEATH_ORB)); },
  },
  chain_prison: {
    anim: 'deploy', castTime: 0.45, fireAt: 0.22, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.world.spawn(new ChainPrison(p, it, SKILL_BASE.chain_prison, CHAIN_PRISON)); },
  },
  rag_doll: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { summonDoll(p, it, SKILL_BASE.rag_doll, RAG_DOLL); },
  },
  crimson_rain: {
    anim: 'throw', castTime: 0.34, fireAt: 0.12, sfx: 'throw', moveScale: 0.5,
    use: (p, it) => { p.world.spawn(new NeedleRain(p.x, p.y, p.facing, p, it, SKILL_BASE.crimson_rain, CRIMSON_RAIN)); },
  },
  last_bell: {
    anim: 'deploy', castTime: 0.6, fireAt: 0.3, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { lastBell(p, it, SKILL_BASE.last_bell, LAST_BELL); },
  },
  requiem: {
    anim: 'deploy', castTime: 0.5, fireAt: 0.25, sfx: 'throw', moveScale: 0.25,
    use: (p, it) => { p.startRequiem(it); },
  },
};
