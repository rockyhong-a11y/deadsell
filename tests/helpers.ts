/**
 * Headless World for unit tests (no DOM). Usage:
 *   const { world, game } = makeTestWorld(map);
 *   world.spawn(entity); world.update(1/60);
 */
import { World } from '../src/game/world';
import { TileMap, T } from '../src/game/tilemap';
import { Input } from '../src/engine/input';
import { Audio } from '../src/engine/audio';
import { SpriteSheet, type AnimDef } from '../src/engine/assets';
import { RunState } from '../src/game/run';
import type { LevelData } from '../src/game/level/types';
import { defaultSave } from '../src/game/meta/save';

const anyAnim = new Proxy({} as Record<string, AnimDef>, {
  get: () => ({ row: 0, frames: 6, fps: 12, loop: false, windup: 2, active: 2, recover: 2 }),
  has: () => true,
});

export function fakeSheet(name = 'fake'): SpriteSheet {
  return new SpriteSheet(name, { width: 128, height: 112 } as any, { image: '', frameW: 128, frameH: 112, anchor: [64, 100], animations: anyAnim }, true);
}

/** A flat room: floor at row h-2, walls left/right. */
export function flatMap(w = 60, h = 18): TileMap {
  const m = new TileMap(w, h);
  for (let x = 0; x < w; x++) { m.set(x, h - 1, T.Solid); m.set(x, h - 2, T.Solid); m.set(x, 0, T.Solid); }
  for (let y = 0; y < h; y++) { m.set(0, y, T.Solid); m.set(w - 1, y, T.Solid); }
  return m;
}

export function makeTestWorld(map: TileMap = flatMap(), seed = 1) {
  const input = new Input();
  const game: any = {
    display: { W: 640, H: 360, worldW: 640, worldH: 360 },
    input,
    audio: new Audio(),
    assets: { sheet: (n: string) => fakeSheet(n), image: () => undefined, json: new Map() },
    save: defaultSave(),
    taps: { add() {}, clear() {}, hit: () => null },
  };
  const run = new RunState(seed);
  run.weapons = [{ id: 'rusty_sword', tier: 1, affix: null }, null];
  const level: LevelData = {
    kind: 'biome', biome: 'prison', seed, map, spawns: [], rooms: [],
    playerStart: { x: 5 * 24, y: (map.h - 2) * 24 },
  };
  const world = new World(game, run, level);
  // minimal UI stand-in: picks the first option of any choice
  (world as any).ui = { modal: false, toast() {}, openChoice: (_t: string, _o: unknown[], pick: (i: number) => void) => pick(0), openAlchemist() {}, openMap() {}, openPause() {}, boss: null };
  game.run = run;
  return { world, game, input, run };
}

/** Run n fixed steps. */
export function steps(world: World, n: number, before?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    before?.(i);
    world.update(1 / 60);
    world.input.endStep(1 / 60);
  }
}
