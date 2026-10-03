import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import goldenJson from './render_golden.json';
import { Autotiler, LevelRenderer, hash01, layerPlacement, type MapLike, type Op, type TileAtlas } from '../src/game/level/render';
import { TileMap, T } from '../src/game/tilemap';
import { Camera } from '../src/engine/camera';
import { TILE } from '../src/engine/config';
import { makeTestWorld } from './helpers';

/**
 * The autotile contract (docs/TILES.md) is implemented twice: tools/pack/post_tiles.py (reference, used for
 * the previews) and src/game/level/render.ts.  tests/render_golden.json is written by
 * `python3 tools/pack/post_tiles.py --golden` (synthetic atlas whose regions are [id,0,1,1,0,0]).
 */
interface Golden {
  atlas: TileAtlas;
  rows: string[];
  ops: [string, ...number[]][];
  decor: [string, number, number, number, number][];
  shadows: [number, number, number, number, string][];
  hashes: [number, number, number, number][];
  placements: number[][];
}
const golden = goldenJson as unknown as Golden;

function mapFromRows(rows: string[]): MapLike {
  const h = rows.length, w = rows[0].length;
  const tiles = new Uint8Array(w * h), bg = new Uint8Array(w * h);
  const code: Record<string, number> = { '#': 1, '=': 2, '^': 3, x: 4 };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      tiles[y * w + x] = code[c] ?? 0;
      bg[y * w + x] = c === ',' ? 0 : 1;
    }
  return { w, h, tiles, bg };
}

const opKey = (o: Op): string => JSON.stringify([o.pass, ...o.r, o.px, o.py]);

describe('variant hash', () => {
  it('matches the python reference (incl. negative coordinates)', () => {
    for (const [x, y, s, v] of golden.hashes) expect(hash01(x, y, s)).toBe(v);
  });
  it('is uniform-ish and in [0,1)', () => {
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = hash01(i % 50, (i / 50) | 0, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(Math.abs(sum / 2000 - 0.5)).toBeLessThan(0.05);
  });
});

describe('autotiler vs python reference', () => {
  const m = mapFromRows(golden.rows);
  const at = new Autotiler(m, golden.atlas);

  it('produces the same ordered draw list', () => {
    const got = at.all().map(opKey);
    const want = golden.ops.map((o) => JSON.stringify(o.slice(0, 1).concat(o.slice(1, 7) as never, o.slice(7) as never)));
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) throw new Error(`op ${i}: ${got[i]} != ${want[i]}`);
  });

  it('plans the same back-wall decoration', () => {
    const got = at.decor().map((d) => [d.name, d.x, d.y, d.w, d.h]);
    expect(got).toEqual(golden.decor);
    expect(got.length).toBeGreaterThan(10);
  });

  it('computes the same back-wall shadow strips', () => {
    const got = at.shadowStrips(0, 0, m.w, m.h).map((s) => [s.x, s.y, s.w, s.h, s.side]);
    expect(got).toEqual(golden.shadows);
  });

  it('chunk-rect queries are a consistent subset of the whole-map list', () => {
    const all = new Set(at.all().map(opKey));
    const part = at.terrainOps(10, 4, 30, 16);
    for (const list of [part.fill, part.edge, part.detail, part.prop]) for (const o of list) expect(all.has(opKey(o))).toBe(true);
    for (const o of at.backOps(10, 4, 30, 16)) expect(all.has(opKey(o))).toBe(true);
  });
});

describe('autotile rules on a tiny map', () => {
  // floor with a wall rising from it (concave corner), open on both ends
  const rows = [
    '............',
    '............',
    '.......##...',
    '.......##...',
    '..#########.',
    '############',
  ];
  const m = mapFromRows(rows);
  const A = golden.atlas;
  const t = new Autotiler(m, A).terrainOps(0, 0, m.w, m.h);
  const ids = (list: Op[], x: number, y: number): number[] => list.filter((o) => o.px === x * TILE && o.py === y * TILE).map((o) => o.r[0]);
  const isTop = (i: number): boolean => A.top.concat(A.topMoss).some((r) => r[0] === i);

  it('flat floor cell: fill from the 8x4 macro, top lip only', () => {
    expect(ids(t.fill, 4, 4)).toEqual([A.fill[(4 & 3) * 8 + 4][0]]);          // touches open air -> tier 1
    const edge = ids(t.edge, 4, 4);
    expect(edge.length).toBe(1);
    expect(isTop(edge[0])).toBe(true);
  });
  it('depth tiers darken the mass with distance from open air', () => {
    expect(ids(t.fill, 4, 5)).toEqual([A.fillMid[(5 & 3) * 8 + 4][0]]);     // 2 cells from air
    const big = mapFromRows(['.........', ...Array(7).fill('.#######.'), '.........'].map((r) => r.slice(0, 9)));
    const bt = new Autotiler(big, A).terrainOps(0, 0, big.w, big.h);
    expect(bt.fill.find((o) => o.px === 4 * TILE && o.py === 4 * TILE)!.r[0]).toBe(A.fillDeep[(4 & 3) * 8 + 4][0]);   // >= 3 cells deep
    expect(bt.fill.find((o) => o.px === 1 * TILE && o.py === 4 * TILE)!.r[0]).toBe(A.fill[(4 & 3) * 8 + 1][0]);      // surface
  });
  it('left end of the floor: left quoin + top lip + outer tl, no outer tr/bl/br', () => {
    const edge = ids(t.edge, 2, 4);
    expect(edge.some((i) => A.left.some((r) => r[0] === i))).toBe(true);
    expect(edge.some(isTop)).toBe(true);
    expect(edge).toContain(A.outer.tl[0]);
    for (const k of ['tr', 'bl', 'br'] as const) expect(edge).not.toContain(A.outer[k][0]);
  });
  it('right end of the floor gets outer tr', () => {
    const edge = ids(t.edge, 10, 4);
    expect(edge).toContain(A.outer.tr[0]);
    expect(edge.some((i) => A.right.some((r) => r[0] === i))).toBe(true);
  });
  it('concave corner (floor meets wall) gets an inner tl piece and no lip', () => {
    const edge = ids(t.edge, 7, 4);
    expect(edge).toContain(A.inner.tl[0]);
    expect(edge.some(isTop)).toBe(false);
  });
  it('wall top gets lip + both outer top corners on its two cells', () => {
    expect(ids(t.edge, 7, 2)).toContain(A.outer.tl[0]);
    expect(ids(t.edge, 7, 2)).not.toContain(A.outer.tr[0]);
    expect(ids(t.edge, 8, 2)).toContain(A.outer.tr[0]);
    expect(ids(t.edge, 7, 3).some((i) => A.left.some((r) => r[0] === i))).toBe(true);
  });
  it('ceiling underside gets bottom pieces and outer bottom corners at its ends', () => {
    const cm = mapFromRows(['.......', '.#####.', '.......']);
    const ct = new Autotiler(cm, A).terrainOps(0, 0, cm.w, cm.h);
    const e1 = ct.edge.filter((o) => o.px === 1 * TILE && o.py === TILE).map((o) => o.r[0]);
    expect(e1).toContain(A.outer.bl[0]);
    const e3 = ct.edge.filter((o) => o.px === 3 * TILE && o.py === TILE).map((o) => o.r[0]);
    expect(e3.some((i) => A.bottom.some((r) => r[0] === i))).toBe(true);
  });
  it('platform pieces: single / l / m / r', () => {
    const pm = mapFromRows(['.......', '.=.===.', '.......', '#######']);
    const pt = new Autotiler(pm, A).terrainOps(0, 0, pm.w, pm.h);
    const at_ = (x: number) => pt.prop.find((o) => o.px === x * TILE && o.py === TILE)!.r[0];
    expect(at_(1)).toBe(A.platform.single[0]);
    expect(at_(3)).toBe(A.platform.l[0]);
    expect(A.platform.m.map((r) => r[0])).toContain(at_(4));
    expect(at_(5)).toBe(A.platform.r[0]);
  });
  it('spike orientation follows the supporting solid', () => {
    const orient = (rowsS: string[]): number => {
      const sm = mapFromRows(rowsS);
      return new Autotiler(sm, A).terrainOps(0, 0, sm.w, sm.h).prop[0].r[0];
    };
    expect(A.spikes.up.map((r) => r[0])).toContain(orient(['....', '.^..', '####']));
    expect(orient(['####', '.^..', '....'])).toBe(A.spikes.down[0]);
    expect(orient(['....', '#^..', '....'])).toBe(A.spikes.right[0]);
    expect(orient(['....', '..^#', '....'])).toBe(A.spikes.left[0]);
  });
  it('breakable cells draw the breakable art and count as solid for their neighbours', () => {
    const bm = mapFromRows(['....', '.x..', '####']);
    const bt = new Autotiler(bm, A).terrainOps(0, 0, bm.w, bm.h);
    const mine = bt.fill.filter((o) => o.px === TILE && o.py === TILE);
    expect(mine.length).toBe(1);
    expect(A.breakable.map((r) => r[0])).toContain(mine[0].r[0]);
    const e = bt.edge.filter((o) => o.px === TILE && o.py === 2 * TILE).map((o) => o.r[0]);
    expect(e.some(isTop)).toBe(false);
  });
  it('back wall: drawn only where bg is wall and the tile is not solid', () => {
    const bm = mapFromRows(['.,.', '.#.']);
    const ops = new Autotiler(bm, A).backOps(0, 0, 3, 2);
    const cells = ops.filter((o) => A.backwall.some((r) => r[0] === o.r[0])).map((o) => [o.px / TILE, o.py / TILE]);
    expect(cells).toEqual([[0, 0], [2, 0], [0, 1], [2, 1]]);
  });
});

describe('parallax placement', () => {
  it('matches the python reference', () => {
    for (const p of golden.placements) {
      const [par, vpar, yoff, iw, ih, vx, vy, vh, bh, x0, y, step] = p;
      expect(layerPlacement(par, vpar, yoff, iw, ih, vx, vy, vh, bh)).toEqual({ x0, y, step });
    }
  });
  it('bottom-anchored at the lowest camera position, never uncovering the layer', () => {
    const bottom = layerPlacement(0.3, 0.3, 0, 1024, 512, 0, 864 - 360, 360, 864);
    expect(bottom.y).toBe(360 - 512);
    const top = layerPlacement(0.3, 0.5, 0, 1024, 512, 0, 0, 360, 864);
    expect(top.y).toBe(0);
    expect(top.y + 512).toBeGreaterThanOrEqual(360);
    // a layer never leaves a gap at the bottom of the screen
    for (const vy of [0, 100, 300, 504]) expect(layerPlacement(0.3, 0.3, 0, 1024, 512, 0, vy, 360, 864).y + 512).toBeGreaterThanOrEqual(360);
  });
});

// ---- renderer with a fake canvas (no DOM in vitest's node environment) --------------------------

function fakeCanvas() {
  const calls: unknown[][] = [];
  const ctx: any = new Proxy({ calls }, {
    get: (t: any, k: string) => {
      if (k in t) return t[k];
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return (...a: unknown[]) => { calls.push([k, ...a]); };
    },
    set: (t: any, k: string, v: unknown) => { t[k] = v; return true; },
  });
  return { width: 0, height: 0, getContext: () => ctx, ctx, calls };
}

describe('LevelRenderer', () => {
  const g = globalThis as any;
  let prevDoc: unknown;
  beforeAll(() => { prevDoc = g.document; g.document = { createElement: () => fakeCanvas() }; });
  afterAll(() => { g.document = prevDoc; });

  function level(w: number, h: number): TileMap {
    const m = new TileMap(w, h);
    for (let x = 0; x < w; x++) { m.set(x, h - 1, T.Solid); m.set(x, h - 2, T.Solid); m.set(x, 0, T.Solid); }
    return m;
  }

  it('falls back to flat colours when the art is missing and caches chunks', () => {
    const map = level(70, 20);
    const { world } = makeTestWorld(map);
    const r = new LevelRenderer(world);
    const cam = new Camera(640, 360);
    const main = fakeCanvas().ctx;
    expect(() => { r.drawBack(main, cam); r.drawTiles(main, cam); r.drawFront(main, cam); }).not.toThrow();
    const sizeBefore = (r as any).terrain.size;
    expect(sizeBefore).toBeGreaterThan(0);
    const cv = (r as any).terrain.get(0).cv;
    r.drawBack(main, cam);
    r.drawTiles(main, cam);
    expect((r as any).terrain.get(0).cv).toBe(cv);
    // changing a distant tile (version bump) must not rebuild an unaffected chunk
    const sig0 = (r as any).terrain.get(0).sig;
    map.set(60, 10, T.Solid);
    r.drawTiles(main, cam);
    expect((r as any).terrain.get(0).sig).toBe(sig0);
  });

  it('draws with a real-shaped atlas, parallax layers and rebuilds a chunk whose tiles changed', () => {
    const map = level(70, 20);
    const { world, game } = makeTestWorld(map);
    const img = { width: 640, height: 400 } as any;
    game.assets.json.set('tiles/prison.json', golden.atlas);
    game.assets.json.set('bg/prison.json', { sky: '#010203', layers: [{ image: 'a.png', parallax: 0.1, y: 0, repeatX: true, img: { width: 1024, height: 512 } }] });
    game.assets.image = (p: string) => (p === 'tiles/prison.png' ? img : undefined);
    const r = new LevelRenderer(world);
    const cam = new Camera(640, 360);
    const main = fakeCanvas().ctx;
    r.drawBack(main, cam);
    r.drawTiles(main, cam);
    expect(main.calls.some((c: unknown[]) => c[0] === 'drawImage')).toBe(true);
    const ch = (r as any).terrain.get(0);
    const before = ch.sig;
    map.set(5, 8, T.Solid); // inside chunk (0,0)
    r.drawTiles(main, cam);
    expect((r as any).terrain.get(0).sig).not.toBe(before);
    expect(map.get(5, 8)).toBe(T.Solid);
  });
});
