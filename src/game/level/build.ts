import type { LevelSpec } from '../run';
import type { SaveData } from '../meta/save';
import type { World } from '../world';
import type { LevelData } from './types';
import { TileMap, T, BG } from '../tilemap';
import { TILE } from '../../engine/config';
import { createEnemy } from '../enemies/factory';

/**
 * Build the level for a spec. OWNER: level agent — replace the test room with
 * the template-based generator (biomes), the passage and the boss arena.
 */
export function buildLevel(spec: LevelSpec, seed: number, _save?: SaveData): LevelData {
  const w = 96, h = 18;
  const map = new TileMap(w, h);
  for (let x = 0; x < w; x++) {
    map.set(x, h - 1, T.Solid);
    map.set(x, h - 2, T.Solid);
    map.set(x, 0, T.Solid);
  }
  for (let y = 0; y < h; y++) {
    map.set(0, y, T.Solid);
    map.set(w - 1, y, T.Solid);
  }
  for (let x = 20; x < 28; x++) map.set(x, 12, T.Platform);
  for (let x = 40; x < 46; x++) map.set(x, 13, T.Solid);
  for (let x = 60; x < 64; x++) map.set(x, 15, T.Spikes);
  map.bg.fill(BG.Wall);
  const ground = (h - 2) * TILE;
  return {
    kind: spec.kind,
    biome: spec.biome,
    seed,
    map,
    spawns: [
      { type: 'enemy', x: 30 * TILE, y: ground, tx: 30, ty: h - 3, roomId: 0 },
      { type: 'enemy', x: 52 * TILE, y: ground, tx: 52, ty: h - 3, roomId: 0 },
    ],
    rooms: [{ id: 0, templateId: 'test', x: 0, y: 0, w, h, tags: ['start'] }],
    playerStart: { x: 4 * TILE, y: ground },
  };
}

/** Spawn every entity described by the level's spawn list (not the player). */
export function populateLevel(world: World, level: LevelData): void {
  for (const s of level.spawns) {
    if (s.type === 'enemy') world.spawn(createEnemy('ghoul', s.x, s.y, { tier: 1, elite: false }));
  }
}
