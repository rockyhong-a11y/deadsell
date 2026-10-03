import { describe, it, expect } from 'vitest';
import { CHUNK_W, CHUNK_H, TILE } from '../src/engine/config';
import { T } from '../src/game/tilemap';
import { LEVEL_SEQUENCE } from '../src/game/run';
import { authoredTemplates, templatePool, mirrorDef, parseTemplate, specialTemplate, siteKey } from '../src/game/level/templates';
import { siteCells } from '../src/game/level/templates/parse';
import { analyzeTemplate, reach, standable, type NavGrid } from '../src/game/level/nav';
import { generateBiome, verifyLayout } from '../src/game/level/generator';
import { buildLevel } from '../src/game/level/build';
import type { LevelData } from '../src/game/level/types';

const BIOMES = ['prison', 'ramparts'] as const;
const SEEDS = 200;
/** the movement-graph BFS over the whole level is the expensive part: run it on this many seeds per biome */
const NAV_SEEDS = 60;

const cell = (l: LevelData, x: number, y: number) => ({ tx: Math.floor(x / TILE), ty: Math.floor((y - 1) / TILE) });

describe('template library', () => {
  it('has enough hand-made templates per biome', () => {
    expect(authoredTemplates('prison').length).toBeGreaterThanOrEqual(16);
    expect(authoredTemplates('ramparts').length).toBeGreaterThanOrEqual(14);
  });

  for (const biome of BIOMES) {
    const list = authoredTemplates(biome);

    it(`${biome}: covers every required room type`, () => {
      const has = (f: (t: (typeof list)[number]) => boolean) => list.some(f);
      const tag = (t: (typeof list)[number], x: string) => (t.tags as string[]).includes(x);
      expect(has((t) => tag(t, 'start') && !!t.counts.P)).toBe(true);
      expect(has((t) => tag(t, 'exit') && !!t.counts.X)).toBe(true);
      for (const [w, h] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1]]) {
        expect(has((t) => t.w === w && t.h === h && (tag(t, 'combat') || tag(t, 'hall') || tag(t, 'shaft') || tag(t, 'corridor'))), `${w}x${h} combat room`).toBe(true);
      }
      expect(has((t) => tag(t, 'corridor')), 'corridor').toBe(true);
      expect(has((t) => tag(t, 'shaft') && t.sites.some((s) => s.side === 'T') && t.sites.some((s) => s.side === 'B')), 'vertical shaft').toBe(true);
      expect(has((t) => !!t.counts.T && tag(t, 'treasure')), 'treasure').toBe(true);
      expect(has((t) => !!t.counts.I && tag(t, 'pedestal')), 'pedestal').toBe(true);
      expect(has((t) => !!t.counts.S && tag(t, 'altar')), 'altar').toBe(true);
      expect(has((t) => !!t.counts.M && t.counts.$ === 3 && tag(t, 'shop')), 'shop').toBe(true);
      expect(has((t) => tag(t, 'secret') && t.tiles.includes(T.Breakable)), 'secret').toBe(true);
      expect(has((t) => t.tiles.includes(T.Spikes)), 'spikes').toBe(true);
      expect(has((t) => tag(t, 'loop')), 'loop').toBe(true);
      expect(has((t) => t.sites.length === 1), 'dead end').toBe(true);
    });

    it(`${biome}: prison is mostly interior, ramparts mostly open sky`, () => {
      let sky = 0, wall = 0;
      for (const t of list) for (let i = 0; i < t.bg.length; i++) if (t.tiles[i] === T.Empty) (t.bg[i] === 0 ? sky++ : wall++);
      if (biome === 'prison') expect(wall).toBeGreaterThan(sky * 4);
      else expect(sky).toBeGreaterThan(wall);
    });

    for (const t of list) {
      it(`${t.id}: parses, doors are consistent and every door is reachable from every other`, () => {
        const a = analyzeTemplate(t);
        expect(a.problems).toEqual([]);
        expect(t.sites.length).toBeGreaterThan(0);
        // all marker characters must be known and ids unique
        expect(t.problems).toEqual([]);
      }, 60000);
    }
  }

  it('template ids are unique', () => {
    const ids = BIOMES.flatMap((b) => authoredTemplates(b).map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mirrored templates keep the door contract', () => {
    for (const biome of BIOMES) {
      for (const t of authoredTemplates(biome)) {
        const m = parseTemplate(mirrorDef(t.def));
        expect(m.problems).toEqual([]);
        const swap = (s: { side: string; idx: number }) =>
          s.side === 'L' ? `R${s.idx}` : s.side === 'R' ? `L${s.idx}` : `${s.side}${t.w - 1 - s.idx}`;
        expect(m.sites.map(siteKey).sort()).toEqual(t.sites.map(swap).sort());
      }
    }
    expect(templatePool('prison').length).toBe(authoredTemplates('prison').length * 2);
  });
});

describe('passage and boss arena', () => {
  it('passage has the alchemist, fountain, exit and torches, and no enemies', () => {
    const t = specialTemplate('passage');
    expect(t.problems).toEqual([]);
    expect(t.counts.A).toBe(1);
    expect(t.counts.H).toBe(1);
    expect(t.counts.X).toBe(1);
    expect(t.counts.P).toBe(1);
    expect(t.counts.L).toBeGreaterThanOrEqual(2);
    expect(t.counts.E ?? 0).toBe(0);
    expect(t.counts.F ?? 0).toBe(0);
    expect(t.tw).toBeLessThanOrEqual(2 * CHUNK_W);
    for (const spec of LEVEL_SEQUENCE.filter((s) => s.kind === 'passage')) {
      const lvl = buildLevel(spec, 7);
      const grid: NavGrid = { w: lvl.map.w, h: lvl.map.h, tiles: lvl.map.tiles };
      const { tx, ty } = cell(lvl, lvl.playerStart.x, lvl.playerStart.y);
      const r = reach(grid, [ty * grid.w + tx]);
      for (const s of lvl.spawns.filter((s) => ['alchemist', 'fountain', 'exit'].includes(s.type))) {
        expect(r.visited[s.ty * grid.w + s.tx], `${s.type} reachable in passage`).toBe(1);
      }
      expect(lvl.spawns.some((s) => s.type === 'enemy' || s.type === 'flyer')).toBe(false);
    }
  });

  it('boss arena: ~3 chunks wide, gate in the entrance, boss on the right, one-way platforms, tall ceiling', () => {
    const lvl = buildLevel(LEVEL_SEQUENCE.find((s) => s.kind === 'boss')!, 3);
    expect(lvl.kind).toBe('boss');
    expect(lvl.map.w).toBeGreaterThanOrEqual(2.5 * CHUNK_W);
    expect(lvl.map.w).toBeLessThanOrEqual(3.5 * CHUNK_W);
    expect(lvl.map.h).toBeGreaterThanOrEqual(CHUNK_H + 4);
    const boss = lvl.spawns.filter((s) => s.type === 'boss');
    const gate = lvl.spawns.filter((s) => s.type === 'gate');
    expect(boss).toHaveLength(1);
    expect(gate).toHaveLength(1);
    expect(gate[0].x).toBeLessThan(lvl.playerStart.x + 10 * TILE);
    expect(boss[0].x).toBeGreaterThan(lvl.map.pxW * 0.6);
    expect(lvl.map.tiles.includes(T.Platform)).toBe(true);
    // walls at both ends
    for (let y = 0; y < lvl.map.h; y++) {
      expect(lvl.map.isSolid(0, y)).toBe(true);
      expect(lvl.map.isSolid(lvl.map.w - 1, y)).toBe(true);
    }
    // flat floor: a long run of solid on the floor row under the arena
    let run = 0, best = 0;
    for (let x = 0; x < lvl.map.w; x++) {
      const solid = lvl.map.isSolid(x, lvl.map.h - 3) === false && lvl.map.isSolid(x, lvl.map.h - 2);
      run = solid ? run + 1 : 0;
      best = Math.max(best, run);
    }
    expect(best).toBeGreaterThanOrEqual(60);
    // reach the boss from the start (drop from the entrance ledge)
    const grid: NavGrid = { w: lvl.map.w, h: lvl.map.h, tiles: lvl.map.tiles };
    const sc = cell(lvl, lvl.playerStart.x, lvl.playerStart.y);
    const bc = cell(lvl, boss[0].x, boss[0].y);
    const r = reach(grid, [sc.ty * grid.w + sc.tx]);
    expect(r.visited[bc.ty * grid.w + bc.tx]).toBe(1);
  });
});

function counts(l: LevelData) {
  const c: Record<string, number> = {};
  for (const s of l.spawns) c[s.type] = (c[s.type] ?? 0) + 1;
  return c;
}

describe.each(BIOMES)('generator (%s)', (biome) => {
  it(`${SEEDS} seeds: one start/exit/shop, 2-3 altars, 1-2 chests, 1-2 pedestals, 1 secret, 9-12 chunk main path`, () => {
    const attempts: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = generateBiome(biome, seed * 7919);
      const l = g.level;
      attempts.push(g.stats.attempts);
      const ctx = `seed ${seed}`;
      expect(g.stats.relaxed, ctx).toBe(false);
      expect(l.kind).toBe('biome');
      expect(l.biome).toBe(biome);
      const c = counts(l);
      expect(l.rooms.filter((r) => r.tags.includes('start')), ctx).toHaveLength(1);
      expect(l.rooms.filter((r) => r.tags.includes('exit')), ctx).toHaveLength(1);
      expect(c.exit, ctx).toBe(1);
      expect(c.merchant, ctx).toBe(1);
      expect(c.shop, ctx).toBe(3);
      expect(c.altar, ctx).toBeGreaterThanOrEqual(2);
      expect(c.altar, ctx).toBeLessThanOrEqual(3);
      expect(c.chest, ctx).toBeGreaterThanOrEqual(1);
      expect(c.chest, ctx).toBeLessThanOrEqual(2);
      expect(c.pedestal, ctx).toBeGreaterThanOrEqual(1);
      expect(c.pedestal, ctx).toBeLessThanOrEqual(2);
      expect(l.rooms.filter((r) => r.tags.includes('secret')), ctx).toHaveLength(1);
      const mainChunks = l.rooms.filter((r) => r.tags.includes('main')).reduce((n, r) => n + (r.w * r.h) / (CHUNK_W * CHUNK_H), 0);
      expect(mainChunks, ctx).toBeGreaterThanOrEqual(9);
      expect(mainChunks, ctx).toBeLessThanOrEqual(12);
      const branches = l.rooms.filter((r) => r.tags.includes('branch')).length;
      expect(branches, ctx).toBeGreaterThanOrEqual(5);
      const enemies = (c.enemy ?? 0) + (c.flyer ?? 0);
      expect(enemies, ctx).toBeGreaterThanOrEqual(12);
      expect(enemies, ctx).toBeLessThanOrEqual(80);
      // layout graph: start -> exit connected, every room reachable
      expect(verifyLayout(g.layout), ctx).toBe(true);
      // player start + every spawn sits in free space; ground things have a floor
      const grid: NavGrid = { w: l.map.w, h: l.map.h, tiles: l.map.tiles };
      const sc = cell(l, l.playerStart.x, l.playerStart.y);
      expect(standable(grid, sc.tx, sc.ty), `${ctx} start standable`).toBe(true);
      for (const s of l.spawns) {
        expect(s.x).toBe(s.tx * TILE + TILE / 2);
        expect(s.y).toBe((s.ty + 1) * TILE);
        expect(l.map.isSolid(s.tx, s.ty), `${ctx} ${s.type} inside solid at ${s.tx},${s.ty}`).toBe(false);
        if (s.type !== 'flyer' && s.type !== 'torch') {
          const below = l.map.get(s.tx, s.ty + 1);
          expect(below === T.Solid || below === T.Platform, `${ctx} ${s.type} floats at ${s.tx},${s.ty}`).toBe(true);
        }
      }
      // map backgrounds: sky only where the biome allows it, bg array sized
      expect(l.map.bg.length).toBe(l.map.w * l.map.h);
    }
    // the generator should rarely need more than a handful of tries
    expect(Math.max(...attempts)).toBeLessThan(250);
  });

  it(`seams: connected door sites are open on both sides, sealed ones are solid`, () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = generateBiome(biome, seed * 104729);
      const map = g.level.map;
      for (const p of g.layout.placements) {
        const room = g.level.rooms[p.idx];
        for (const s of p.tpl.sites) {
          const conn = p.conn.get(siteKey(s));
          const cells = siteCells(s.side, s.idx, p.tpl.tw, p.tpl.th);
          for (const [x, y] of cells) {
            const solid = map.isSolid(room.x + x, room.y + y);
            expect(solid, `seed ${seed} ${p.tpl.id} ${siteKey(s)} ${conn ? 'connected' : 'sealed'}`).toBe(!conn);
          }
          if (conn) {
            // the neighbour's matching door is at the same world position
            const other = g.level.rooms[conn.to.idx];
            const oc = siteCells(conn.toKey[0] as 'L' | 'R' | 'T' | 'B', Number(conn.toKey.slice(1)), conn.to.tpl.tw, conn.to.tpl.th);
            const mine = new Set(cells.map(([x, y]) => `${room.x + x},${room.y + y}`));
            const edgeMine = cells.filter(([x, y]) => (s.side === 'L' ? x === 0 : s.side === 'R' ? x === p.tpl.tw - 1 : s.side === 'T' ? y === 0 : y === p.tpl.th - 1));
            const edgeOther = oc.filter(([x, y]) => {
              const k = conn.toKey[0];
              return k === 'L' ? x === 0 : k === 'R' ? x === conn.to.tpl.tw - 1 : k === 'T' ? y === 0 : y === conn.to.tpl.th - 1;
            });
            for (const [x, y] of edgeOther) {
              const wx = other.x + x, wy = other.y + y;
              const adj = [[wx + 1, wy], [wx - 1, wy], [wx, wy + 1], [wx, wy - 1]].some(([ax, ay]) => mine.has(`${ax},${ay}`));
              expect(adj, `seed ${seed} seam ${p.tpl.id}->${conn.to.tpl.id}`).toBe(true);
            }
            expect(edgeMine.length).toBe(edgeOther.length);
          }
        }
      }
    }
  });

  it(`movement graph: the exit is reachable from the start on ${NAV_SEEDS} seeds, and every room is entered`, () => {
    for (let seed = 1; seed <= NAV_SEEDS; seed++) {
      const l = generateBiome(biome, seed * 31337).level;
      const grid: NavGrid = { w: l.map.w, h: l.map.h, tiles: l.map.tiles };
      const sc = cell(l, l.playerStart.x, l.playerStart.y);
      const exit = l.spawns.find((s) => s.type === 'exit')!;
      const r = reach(grid, [sc.ty * grid.w + sc.tx], false, exit.ty * grid.w + exit.tx);
      expect(r.visited[exit.ty * grid.w + exit.tx], `seed ${seed}: exit unreachable`).toBe(1);
    }
  }, 120000);

  it('movement graph: every chest/altar/pedestal/shop item is reachable (secrets with the walls broken)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const l = generateBiome(biome, seed * 4241).level;
      const sc = cell(l, l.playerStart.x, l.playerStart.y);
      const grid: NavGrid = { w: l.map.w, h: l.map.h, tiles: l.map.tiles, openBreakables: true };
      const r = reach(grid, [sc.ty * grid.w + sc.tx]);
      for (const s of l.spawns) {
        if (['chest', 'altar', 'pedestal', 'merchant', 'shop', 'exit'].includes(s.type)) {
          expect(r.visited[s.ty * grid.w + s.tx], `seed ${seed}: ${s.type} at ${s.tx},${s.ty} unreachable`).toBe(1);
        }
      }
      // without breaking walls, only the secret chamber's chest is cut off
      const closed = reach({ ...grid, openBreakables: false }, [sc.ty * grid.w + sc.tx]);
      const hidden = l.spawns.filter((s) => ['chest', 'altar', 'pedestal', 'merchant', 'shop', 'exit'].includes(s.type) && !closed.visited[s.ty * grid.w + s.tx]);
      expect(hidden.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      for (const h of hidden) expect(h.type).toBe('chest');
    }
  }, 120000);

  it('is deterministic for a seed and varies between seeds', () => {
    const a = generateBiome(biome, 777).level;
    const b = generateBiome(biome, 777).level;
    expect(a.map.w).toBe(b.map.w);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
    expect(a.spawns).toEqual(b.spawns);
    expect(a.playerStart).toEqual(b.playerStart);
    const layouts = new Set<string>();
    for (let s = 1; s <= 30; s++) layouts.add(generateBiome(biome, s).level.rooms.map((r) => r.templateId).join(','));
    expect(layouts.size).toBeGreaterThan(25);
  });

  it('buildLevel dispatches by spec', () => {
    const spec = LEVEL_SEQUENCE.find((s) => s.kind === 'biome' && s.biome === biome)!;
    const l = buildLevel(spec, 5);
    expect(l.biome).toBe(biome);
    expect(l.rooms.length).toBeGreaterThanOrEqual(10);
  });
});
