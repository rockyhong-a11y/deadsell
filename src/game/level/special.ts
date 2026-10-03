import { TILE } from '../../engine/config';
import { TileMap } from '../tilemap';
import type { BiomeId } from '../run';
import { specialTemplate } from './templates';
import { MARKER_SPAWN } from './generator';
import type { LevelData, Spawn } from './types';

function fromTemplate(id: 'passage' | 'boss_arena', kind: LevelData['kind'], biome: BiomeId, seed: number): LevelData {
  const t = specialTemplate(id);
  const map = new TileMap(t.tw, t.th);
  map.tiles.set(t.tiles);
  map.bg.set(t.bg);
  const spawns: Spawn[] = [];
  let playerStart = { x: 3 * TILE, y: (t.th - 2) * TILE };
  for (const m of t.markers) {
    const wx = m.tx * TILE + TILE / 2, wy = (m.ty + 1) * TILE;
    if (m.ch === 'P') {
      playerStart = { x: wx, y: wy };
      continue;
    }
    const type = MARKER_SPAWN[m.ch];
    if (type) spawns.push({ type, x: wx, y: wy, tx: m.tx, ty: m.ty, roomId: 0 });
  }
  return {
    kind, biome, seed, map, spawns, playerStart,
    rooms: [{ id: 0, templateId: t.id, x: 0, y: 0, w: t.tw, h: t.th, tags: [...t.tags, 'start'], progress: 0 }],
  };
}

/** Passage: alchemist + fountain + exit door, nothing hostile. Looks like the biome it follows. */
export function buildPassage(biome: BiomeId, seed: number): LevelData {
  return fromTemplate('passage', 'passage', biome, seed);
}

/** Boss arena "Bell of Chains": a gate closes the entrance corridor when the fight starts. */
export function buildBossArena(seed: number): LevelData {
  const lvl = fromTemplate('boss_arena', 'boss', 'tower', seed);
  // the gate fills the last two columns (10..11) of the raised entrance vestibule (rows 14..17)
  lvl.spawns.push({ type: 'gate', x: 11 * TILE, y: 18 * TILE, tx: 10, ty: 17, roomId: 0 });
  // the bell hangs from the ceiling block above the middle of the arena
  lvl.spawns.push({ type: 'deco', variant: 'bell', x: 48 * TILE, y: 3 * TILE + 92, tx: 47, ty: 6, roomId: 0 });
  return lvl;
}
