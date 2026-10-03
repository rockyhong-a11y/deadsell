import type { LevelSpec } from '../run';
import type { SaveData } from '../meta/save';
import type { World } from '../world';
import type { ItemInstance } from '../items/types';
import type { LevelData, Spawn } from './types';
import { generateBiome } from './generator';
import { buildPassage, buildBossArena } from './special';
import { ENEMY_POOLS, FLYERS, createEnemy } from '../enemies/factory';
import { createBoss } from '../boss/matron';
import { rollItem } from '../items/items';
import { Alchemist, Altar, BossGate, Chest, Deco, ExitDoor, Fountain, Merchant, Pedestal, RoomTracker, ShopItem, Torch, pickDeco, type DecoKind } from '../props';

/**
 * Build the level for a spec: procedural biome (generator.ts), passage or boss arena (special.ts).
 * Deterministic for (spec, seed).
 */
export function buildLevel(spec: LevelSpec, seed: number, _save?: SaveData): LevelData {
  if (spec.kind === 'passage') return buildPassage(spec.biome, seed);
  if (spec.kind === 'boss') return buildBossArena(seed);
  return generateBiome(spec.biome, seed).level;
}

const TORCH_COLOR: Record<string, string> = { prison: '#ffa040', ramparts: '#ffb868', tower: '#ff8450' };

/**
 * Spawn every entity described by the level's spawn list (not the player): enemies (pool weights,
 * elites later in the level), chests, altars, pedestals, the shop, NPCs, the exit door, decoration,
 * torches and - in the boss arena - the boss and the gate. Uses world.rng (seeded per level).
 */
export function populateLevel(world: World, level: LevelData): void {
  const { run, rng } = world;
  const tier = run.tier;
  const biome = level.biome;
  const unlocked = world.game.save.unlocked;
  const rooms = level.rooms;
  const shopCount = new Map<number, number>();
  const shopIds = new Map<number, Set<string>>();

  const spawnEnemy = (s: Spawn, flyer: boolean): void => {
    const room = rooms[s.roomId];
    if (room?.tags.includes('start') || room?.tags.includes('passage')) return;
    const pool = flyer ? FLYERS[biome] : ENEMY_POOLS[biome];
    if (!pool.length) return;
    const kind = flyer ? rng.pick(FLYERS[biome]) : rng.weighted(ENEMY_POOLS[biome], (e) => e.weight).kind;
    const prog = room?.progress ?? 0;
    const eliteChance = Math.max(0, Math.min(0.3, (prog - 0.35) * 0.45)) * (flyer ? 0.5 : 1) + (tier > 1 ? 0.03 : 0);
    const elite = prog > 0.3 && rng.chance(eliteChance);
    // flyers hover: spawn them a little above the marker's floor
    world.spawn(createEnemy(kind, s.x, flyer ? s.y - 70 : s.y, { tier, elite }));
  };

  for (const s of level.spawns) {
    switch (s.type) {
      case 'enemy':
        spawnEnemy(s, false);
        break;
      case 'flyer':
        spawnEnemy(s, true);
        break;
      case 'chest':
        world.spawn(new Chest(s.x, s.y, !!rooms[s.roomId]?.tags.includes('secret')));
        break;
      case 'altar':
        world.spawn(new Altar(s.x, s.y));
        break;
      case 'pedestal':
        world.spawn(new Pedestal(s.x, s.y, rollItem(rng, tier, unlocked)));
        break;
      case 'merchant':
        world.spawn(new Merchant(s.x, s.y));
        break;
      case 'shop': {
        // three slots per shop: weapon, weapon, skill (no duplicates)
        const n = shopCount.get(s.roomId) ?? 0;
        shopCount.set(s.roomId, n + 1);
        const used = shopIds.get(s.roomId) ?? new Set<string>();
        shopIds.set(s.roomId, used);
        const slot = n % 3 === 2 ? 'skill' : 'weapon';
        let inst: ItemInstance = rollItem(rng, tier, unlocked, slot);
        for (let i = 0; i < 6 && used.has(inst.id); i++) inst = rollItem(rng, tier, unlocked, slot);
        used.add(inst.id);
        world.spawn(new ShopItem(s.x, s.y, inst));
        break;
      }
      case 'alchemist':
        world.spawn(new Alchemist(s.x, s.y));
        break;
      case 'fountain':
        world.spawn(new Fountain(s.x, s.y));
        break;
      case 'exit':
        world.spawn(new ExitDoor(s.x, s.y));
        break;
      case 'torch':
        world.spawn(new Torch(s.x, s.y, TORCH_COLOR[biome]));
        break;
      case 'deco': {
        const kind = (s.variant as DecoKind | undefined) ?? pickDeco(rng, biome);
        world.spawn(new Deco(s.x, s.y, kind, rng.chance(0.5)));
        break;
      }
      case 'gate':
        world.spawn(new BossGate(s.x, s.y));
        break;
      case 'boss':
        world.spawn(createBoss(s.x, s.y));
        break;
    }
  }
  world.spawn(new RoomTracker(rooms));
}
