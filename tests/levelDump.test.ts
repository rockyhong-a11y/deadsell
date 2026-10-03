import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generateBiome } from '../src/game/level/generator';
import { buildLevel } from '../src/game/level/build';
import { LEVEL_SEQUENCE } from '../src/game/run';

const OUT = '/tmp/claude-0/-home-user-deadsell/2e20d018-5e63-5dfa-9cd9-3128d1dbbaa6/scratchpad/lvl/';

it('dump levels', () => {
  if (!process.env.DUMP_LEVELS) return;
  const seeds = (process.env.DUMP_LEVELS || '1,2').split(',').map(Number);
  for (const biome of ['prison', 'ramparts'] as const) {
    for (const seed of seeds) {
      const g = generateBiome(biome, seed);
      const l = g.level;
      writeFileSync(OUT + `lvl_${biome}_${seed}.json`, JSON.stringify({
        w: l.map.w, h: l.map.h, tiles: Array.from(l.map.tiles), bg: Array.from(l.map.bg), spawns: l.spawns, rooms: l.rooms, start: l.playerStart, stats: g.stats,
      }));
      console.log(biome, seed, l.map.w, l.map.h, JSON.stringify(g.stats), l.rooms.map((r) => r.templateId).join(' '));
    }
  }
  for (const spec of LEVEL_SEQUENCE.filter((s) => s.kind !== 'biome').slice(0, 3)) {
    const l = buildLevel(spec, 5);
    writeFileSync(OUT + `lvl_${spec.kind}_${spec.biome}.json`, JSON.stringify({
      w: l.map.w, h: l.map.h, tiles: Array.from(l.map.tiles), bg: Array.from(l.map.bg), spawns: l.spawns, rooms: l.rooms, start: l.playerStart,
    }));
  }
});
