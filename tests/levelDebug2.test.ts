import { it } from 'vitest';
import { generateBiome } from '../src/game/level/generator';
import { reach, standable, type NavGrid } from '../src/game/level/nav';
import { TILE } from '../src/engine/config';

it('nav time', () => {
  for (const biome of ['prison', 'ramparts'] as const) {
    for (const seed of [1, 2, 3]) {
      const g = generateBiome(biome, seed);
      const m = g.level.map;
      const grid: NavGrid = { w: m.w, h: m.h, tiles: m.tiles };
      const sx = Math.floor(g.level.playerStart.x / TILE), sy = Math.floor((g.level.playerStart.y - 1) / TILE);
      const t0 = Date.now();
      const r = reach(grid, [sy * m.w + sx]);
      let n = 0;
      for (let i = 0; i < r.visited.length; i++) n += r.visited[i];
      const ex = g.level.spawns.find((s) => s.type === 'exit')!;
      console.log(biome, seed, 'start standable', standable(grid, sx, sy), 'nodes', n, 'exit', !!r.visited[ex.ty * m.w + ex.tx], 'ms', Date.now() - t0, m.w, m.h);
    }
  }
}, 120000);
