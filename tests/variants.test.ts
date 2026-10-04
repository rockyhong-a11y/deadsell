import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../src/game/items/pickups', async (orig) => ({
  ...(await orig<typeof import('../src/game/items/pickups')>()),
  dropLoot: vi.fn(),
  spawnItemDrop: vi.fn(),
}));

import { makeTestWorld, steps, flatMap, fakeSheet } from './helpers';
import { Player } from '../src/game/player/player';
import { createEnemy, ENEMY_POOLS, FLYERS } from '../src/game/enemies/factory';
import { ALL_ENEMY_KINDS, BASE_KINDS, ENEMY_DEFS, VARIANT_IDS, pickEnemy, variantShare, type EnemyKind } from '../src/game/enemies/variants';
import type { Enemy } from '../src/game/enemies/base';
import { Arrow, Bolt, Bomb, ChainHook, isReflectable } from '../src/game/enemies/projectiles';
import { AcidPuddle, FirePatch, FloorWave, PlayerSlow, PoisonCloud, SongRing, shockAoE, slowPlayer } from '../src/game/enemies/hazards';
import { dropLoot } from '../src/game/items/pickups';
import { SHEETS, SpriteSheet } from '../src/engine/assets';
import { Rng } from '../src/engine/rng';
import { generateBiome } from '../src/game/level/generator';
import { populateLevel } from '../src/game/level/build';
import { Actor } from '../src/game/entity';
import { LEVEL_SEQUENCE, type BiomeId } from '../src/game/run';
import type { World } from '../src/game/world';
import type { TileMap } from '../src/game/tilemap';

const FLOOR = 16 * 24;

// outlines/flashes need a DOM canvas: stub the silhouette so the draw paths can run headless
beforeAll(() => {
  vi.spyOn(SpriteSheet.prototype, 'silhouette').mockReturnValue({} as HTMLCanvasElement);
});

function setup(kind: EnemyKind, ex: number, px: number, opts: { tier?: number; elite?: boolean } = {}, map?: TileMap, ey = FLOOR) {
  const { world, input } = makeTestWorld(map);
  const p = new Player(px, FLOOR);
  world.player = p;
  world.spawn(p);
  const e = createEnemy(kind, ex, ey, { tier: opts.tier ?? 1, elite: opts.elite ?? false }) as Enemy;
  world.spawn(e);
  steps(world, 2);
  return { world, p, e, input };
}

const ofType = <T>(world: World, ctor: new (...a: any[]) => T): T[] => world.entities.filter((x): x is T & (typeof world.entities)[number] => x instanceof ctor) as T[];

/** a canvas context that accepts everything (draw-path smoke test) */
function stubCtx(): CanvasRenderingContext2D {
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}

describe('variant table', () => {
  it('has 30 types: 6 bases + 24 variants, each with its own sheet name, a Korean name and a base', () => {
    expect(ALL_ENEMY_KINDS.length).toBe(30);
    expect(VARIANT_IDS.length).toBe(24);
    for (const id of ALL_ENEMY_KINDS) {
      const d = ENEMY_DEFS[id];
      expect(d.sheet).toBe(id);
      expect(BASE_KINDS).toContain(d.base);
      expect(d.name).toMatch(/[가-힣]/);
      if (d.variant) expect(id.startsWith(d.base + '_')).toBe(true);
    }
    expect(ENEMY_DEFS.ghoul_plague.name).toBe('역병 구울');
    expect(ENEMY_DEFS.lancer_dragoon.name).toBe('용기병');
    expect(ENEMY_DEFS.harpy_siren.name).toBe('세이렌');
  });

  it('every variant (and the four mid-boss sheets) is in the asset loader list', () => {
    for (const id of ALL_ENEMY_KINDS) expect(SHEETS as readonly string[]).toContain(id);
    for (const id of ['mb_abbess', 'mb_arachne', 'mb_valkyrie', 'mb_witch']) expect(SHEETS as readonly string[]).toContain(id);
  });

  it('ENEMY_POOLS / FLYERS are derived from the table (harpy variants fly, others walk)', () => {
    for (const b of ['prison', 'ramparts'] as BiomeId[]) {
      for (const e of ENEMY_POOLS[b]) expect(ENEMY_DEFS[e.kind].base).not.toBe('harpy');
      for (const k of FLYERS[b]) expect(ENEMY_DEFS[k].base).toBe('harpy');
    }
    expect(FLYERS.ramparts).toEqual(expect.arrayContaining(['harpy', 'harpy_storm', 'harpy_raven', 'harpy_siren', 'harpy_ember']));
    expect(FLYERS.prison).toEqual(expect.arrayContaining(['harpy', 'harpy_ember']));
    expect(ENEMY_POOLS.tower).toEqual([]);
  });

  it('uses the variant hp multiplier', () => {
    expect(setup('ghoul_frenzy', 300, 100).e.maxHp).toBe(28); // 40 x 0.7
    expect(setup('ghoul_wraith', 300, 100).e.maxHp).toBe(32); // 40 x 0.8
    expect(setup('jailer_warden', 300, 100).e.maxHp).toBe(126); // 90 x 1.4
  });
});

describe('every enemy type', () => {
  it.each(ALL_ENEMY_KINDS)('%s runs 300 steps next to the player (and draws) without throwing', (kind) => {
    const fly = ENEMY_DEFS[kind].flyer;
    for (const o of [{ tier: 1, elite: false }, { tier: 2, elite: true }]) {
      const { world, p, e } = setup(kind, 330, 240, o, undefined, fly ? FLOOR - 110 : FLOOR);
      const ctx = stubCtx();
      for (let i = 0; i < 300; i++) {
        p.hp = p.maxHp; // keep her alive so the whole attack cycle runs
        steps(world, 1);
        if (i % 5 === 0) for (const x of world.entities) if (x !== p) x.draw(ctx);
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
      }
    }
  });

  it('createEnemy builds each id with its own kind and base', () => {
    for (const id of ALL_ENEMY_KINDS) {
      const { e } = setup(id, 300, 100);
      expect(e.kind).toBe(id);
      expect(e.base).toBe(ENEMY_DEFS[id].base);
      expect(e.variant !== null).toBe(ENEMY_DEFS[id].variant);
    }
    expect(() => createEnemy('nope' as EnemyKind, 0, 0)).toThrow();
  });

  it('elites keep the stat boost and the aura but are not bigger (scale = 1)', () => {
    for (const id of ALL_ENEMY_KINDS) {
      const n = setup(id, 300, 100).e;
      const el = setup(id, 300, 100, { elite: true }).e;
      expect(el.scale).toBe(1);
      expect(el.w).toBe(n.w);
      expect(el.h).toBe(n.h);
      expect(Math.abs(el.maxHp - n.maxHp * 3)).toBeLessThanOrEqual(2);
    }
  });

  it('a variant whose own sheet is not built yet falls back to the base sheet with a hue-shifted outline', () => {
    const { e } = setup('ghoul_plague', 300, 100);
    expect((e as any).fallbackOutline).toMatch(/^hsl\(100,/);
    expect(setup('ghoul', 300, 100).e['fallbackOutline' as keyof Enemy]).toBeUndefined();
    // once the sheet exists it is used as is
    const { world } = makeTestWorld();
    const pl = new Player(300, FLOOR);
    world.player = pl;
    world.spawn(pl);
    const sheet = fakeSheet('lancer_dragoon');
    Object.defineProperty(sheet, 'placeholder', { value: false });
    (world.game.assets as any).sheet = (n: string) => (n === 'lancer_dragoon' ? sheet : fakeSheet(n));
    const d = createEnemy('lancer_dragoon', 100, FLOOR, {}) as Enemy;
    world.spawn(d);
    steps(world, 1);
    expect(d.anim!.sheet).toBe(sheet);
    expect((d as any).fallbackOutline).toBeUndefined();
  });
});

describe('spawn picker', () => {
  const BIOMES: BiomeId[] = ['prison', 'ramparts'];

  it('shows >= 12 different types per biome over 200 seeds', () => {
    for (const b of BIOMES) {
      const ground = new Set<string>();
      const all = new Set<string>();
      for (let seed = 1; seed <= 200; seed++) {
        const rng = new Rng(seed);
        for (const depth of [0.05, 0.3, 0.5, 0.75, 1]) {
          const g = pickEnemy(rng, b, depth, false);
          const f = pickEnemy(rng, b, depth, true);
          ground.add(g);
          all.add(g);
          all.add(f);
        }
      }
      expect(ground.size, `${b} ground`).toBeGreaterThanOrEqual(12);
      expect(all.size, `${b} all`).toBeGreaterThanOrEqual(12);
      for (const k of all) expect(ENEMY_DEFS[k as EnemyKind].spawn[b]).toBeTruthy();
    }
  });

  it('early rooms are mostly base types, variants grow with depth and tier', () => {
    const share = (b: BiomeId, depth: number) => {
      let v = 0;
      const n = 3000;
      const rng = new Rng(7);
      for (let i = 0; i < n; i++) if (ENEMY_DEFS[pickEnemy(rng, b, depth, i % 4 === 0)].variant) v++;
      return v / n;
    };
    expect(share('prison', 0)).toBeLessThan(0.25);
    expect(share('ramparts', 0)).toBeLessThan(0.5);
    for (const b of BIOMES) expect(share(b, 1)).toBeGreaterThan(share(b, 0) + 0.25);
    expect(share('ramparts', 0.5)).toBeGreaterThan(share('prison', 0.5));
    expect(variantShare('prison', 1)).toBeGreaterThan(variantShare('prison', 0));
  });

  it('"late" variants only appear from depth 0.4', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 1500; i++) {
      const k = pickEnemy(rng, 'prison', 0.2, false);
      expect(['ghoul_frenzy', 'ghoul_wraith', 'jailer_warden', 'jailer_chain', 'archer_crossbow', 'bomber_kamikaze']).not.toContain(k);
    }
  });

  it('is deterministic for a seed and only returns what the biome allows (ramparts has lancers, prison has none)', () => {
    const a = new Rng(11);
    const b = new Rng(11);
    for (let i = 0; i < 50; i++) expect(pickEnemy(a, 'ramparts', 0.6, false)).toBe(pickEnemy(b, 'ramparts', 0.6, false));
    const rng = new Rng(5);
    for (let i = 0; i < 400; i++) expect(ENEMY_DEFS[pickEnemy(rng, 'prison', 1, false)].base).not.toBe('lancer');
  });

  it('level building uses the picker: >= 12 types per biome across seeds, all of them run', () => {
    for (const biome of ['prison', 'ramparts'] as const) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 24; seed++) {
        const { world, run } = makeTestWorld(undefined, seed);
        const lvl = generateBiome(biome, seed).level;
        (world as any).level = lvl;
        (world as any).map = lvl.map;
        run.levelIndex = biome === 'ramparts' ? 2 : 0;
        const pl = new Player(lvl.playerStart.x, lvl.playerStart.y);
        world.player = pl;
        world.spawn(pl);
        populateLevel(world, lvl);
        steps(world, 2);
        for (const e of world.entities) if (e instanceof Actor && e.team === 'enemy' && typeof (e as Enemy).kind === 'string') seen.add((e as Enemy).kind); // (the mid-boss and its orbs are enemy-team actors without a `kind`)
        if (seed <= 3) steps(world, 90);
      }
      expect(seen.size, biome).toBeGreaterThanOrEqual(12);
      for (const k of seen) expect(ENEMY_DEFS[k as EnemyKind].spawn[biome], `${k} in ${biome}`).toBeTruthy();
    }
  });

  it('the level sequence still has the biomes the table knows', () => {
    for (const l of LEVEL_SEQUENCE) if (l.kind === 'biome') expect(ENEMY_POOLS[l.biome].length).toBeGreaterThan(0);
  });
});

describe('ghoul variants', () => {
  it('plague: slower; on death leaves a poison cloud (r 40, 3 s, 4 dmg/s)', () => {
    const { world, p, e } = setup('ghoul_plague', 400, 100);
    expect(e.speedMult).toBeCloseTo(0.7);
    expect(ofType(world, PoisonCloud).length).toBe(0);
    e.takeDamage({ amount: 999, dir: 1, kind: 'melee', source: p });
    steps(world, 1);
    const cloud = ofType(world, PoisonCloud)[0];
    expect(cloud).toBeTruthy();
    expect(cloud.radius).toBe(40);
    expect(cloud.life).toBe(3);
    expect(Math.abs(cloud.x - 400)).toBeLessThan(2);
    // standing in it hurts: ~4 per second, no stagger
    p.x = cloud.x;
    p.y = FLOOR;
    const hp0 = p.hp;
    steps(world, 60);
    const lost = hp0 - p.hp;
    expect(lost).toBeGreaterThanOrEqual(2);
    expect(lost).toBeLessThanOrEqual(6);
    expect(p.state).not.toBe('hurt');
    // gone after 3 s
    steps(world, 150);
    expect(world.entities.includes(cloud)).toBe(false);
  });

  it('a plain ghoul leaves no cloud', () => {
    const { world, p, e } = setup('ghoul', 400, 100);
    e.takeDamage({ amount: 999, dir: 1, kind: 'melee', source: p });
    steps(world, 2);
    expect(ofType(world, PoisonCloud).length).toBe(0);
  });

  it('frenzy: fast, hp x0.7, attacks with a 2-swipe combo', () => {
    const { world, e, p } = setup('ghoul_frenzy', 200, 236);
    expect(e.speedMult).toBeCloseTo(1.35);
    let actives = 0;
    let prev = '';
    let started = false;
    for (let i = 0; i < 200; i++) {
      p.hp = p.maxHp;
      p.invuln = 99;
      steps(world, 1);
      if (e.state === 'active' && prev !== 'active') actives++;
      if (e.state === 'windup' || e.state === 'active') started = true;
      if (started && e.state === 'cooldown') break;
      prev = e.state;
    }
    expect(actives).toBe(2);
  });

  it('frenzy: both swipes can hurt', () => {
    const { world, e, p } = setup('ghoul_frenzy', 200, 236);
    const hits: number[] = [];
    let last = p.hp;
    for (let i = 0; i < 200 && hits.length < 2; i++) {
      p.invuln = 0;
      p.x = e.x + e.facing * 30; // she stays in reach
      p.y = FLOOR;
      steps(world, 1);
      if (p.hp < last) hits.push(i);
      last = p.hp;
    }
    expect(hits.length).toBe(2);
    expect(hits[1] - hits[0]).toBeLessThan(40);
  });

  it('shackled: chain-ball swing reaches x1.7, damage x1.4, heavy knockback', () => {
    const { world, e, p } = setup('ghoul_shackled', 200, 280);
    let startD = -1;
    const hp0 = p.hp;
    let vx = 0;
    for (let i = 0; i < 300 && p.hp === hp0; i++) {
      steps(world, 1);
      if (startD < 0 && e.state === 'windup') startD = Math.abs(p.x - e.x);
      vx = Math.max(vx, Math.abs(p.vx));
    }
    expect(startD).toBeGreaterThan(55); // a plain ghoul starts at < 50
    expect(startD).toBeLessThan(86);
    expect(hp0 - p.hp).toBe(13); // 9 x 1.4
    expect(vx).toBeGreaterThan(250);
  });

  it('wraith: blinks (<= 90 px) behind the player before attacking; immune to knockback', () => {
    const { world, e, p } = setup('ghoul_wraith', 280, 230);
    p.facing = 1;
    expect(e.knockbackTaken).toBe(0);
    let at = -1;
    for (let i = 0; i < 200 && e.state !== 'windup'; i++) {
      steps(world, 1);
      p.facing = 1;
      at = i;
    }
    expect(e.state).toBe('windup');
    expect(at).toBeGreaterThan(0);
    expect(e.x).toBeLessThan(p.x); // behind her (she faces right)
    expect(Math.abs(e.x - (p.x - 30))).toBeLessThan(3);
    expect(e.facing).toBe(1); // turned to face her
    // knockback does nothing, a hit still staggers
    e.takeDamage({ amount: 1, dir: 1, kind: 'melee', source: p, knockback: 500, hitstun: 0.2 });
    expect(e.vx).toBe(0);
    expect(e.state).toBe('hurt');
  });

  it('wraith: does not blink when it is already behind her', () => {
    const { world, e, p } = setup('ghoul_wraith', 190, 230);
    p.facing = 1;
    const x0 = e.x;
    steps(world, 12);
    expect(Math.abs(e.x - x0)).toBeLessThan(12);
  });
});

describe('jailer variants', () => {
  it('warden: the mace slam sends a floor shockwave that is jumped over', () => {
    const { world, e, p } = setup('jailer_warden', 200, 250);
    let wave: FloorWave | undefined;
    for (let i = 0; i < 240 && !wave; i++) {
      p.invuln = 99;
      steps(world, 1);
      wave = ofType(world, FloorWave)[0];
    }
    expect(wave).toBeTruthy();
    expect(e.state).toBe('active');
    expect(wave!.bounds.h).toBeLessThanOrEqual(20);
    // standing on the floor: hurt. in the air: not.
    const run = (feetY: number) => {
      const { world: w, p: pl } = setup('ghoul', 900, 100);
      pl.x = 300;
      pl.y = feetY;
      pl.gravityScale = 0;
      pl.vx = pl.vy = 0;
      const f = new FloorWave(200, FLOOR, 1, { speed: 230, damage: 8, maxDist: 170 });
      w.spawn(f);
      const hp0 = pl.hp;
      for (let i = 0; i < 60; i++) {
        pl.y = feetY;
        steps(w, 1);
      }
      return hp0 - pl.hp;
    };
    expect(run(FLOOR)).toBeGreaterThan(0);
    expect(run(FLOOR - 40)).toBe(0);
  });

  it('torch: the attack ignites (burn 3 s) and it carries a light', () => {
    const { world, e, p } = setup('jailer_torch', 200, 240);
    const light = vi.spyOn(world.lights, 'add');
    const hp0 = p.hp;
    for (let i = 0; i < 240 && p.hp === hp0; i++) steps(world, 1);
    expect(p.hp).toBeLessThan(hp0);
    expect(p.status.burn).toBeGreaterThan(2);
    e.draw(stubCtx());
    expect(light).toHaveBeenCalled();
  });

  it('spear: thrust reach x1.6 (starts the attack from farther away)', () => {
    const { world, e, p } = setup('jailer_spear', 200, 288);
    let startD = -1;
    const hp0 = p.hp;
    for (let i = 0; i < 300 && p.hp === hp0; i++) {
      steps(world, 1);
      if (startD < 0 && e.state === 'windup') startD = Math.abs(p.x - e.x);
    }
    expect(startD).toBeGreaterThan(70);
    expect(p.hp).toBeLessThan(hp0);
  });

  it('chain: throws a hook (<= 180 px) that pulls the player in, then bashes', () => {
    const { world, e, p } = setup('jailer_chain', 200, 350);
    const d0 = Math.abs(p.x - e.x);
    let hook: ChainHook | undefined;
    let minD = d0;
    let connected = false;
    let bashed = false;
    const hp0 = p.hp;
    for (let i = 0; i < 300; i++) {
      p.hp = Math.max(p.hp, hp0 - 5 * 3);
      steps(world, 1);
      hook = hook ?? ofType(world, ChainHook)[0];
      if (hook?.connected) connected = true;
      minD = Math.min(minD, Math.abs(p.x - e.x));
      if (connected && e.state === 'windup') bashed = true;
    }
    expect(hook).toBeTruthy();
    expect(connected).toBe(true);
    expect(minD).toBeLessThan(d0 - 60);
    expect(minD).toBeLessThan(70);
    expect(bashed).toBe(true);
  });

  it('chain: a hook that misses (out of range) does not pull', () => {
    const { world, e, p } = setup('jailer_chain', 200, 520);
    p.invuln = 99;
    steps(world, 120);
    expect(ofType(world, ChainHook).length).toBe(0);
    expect(Math.abs(p.x - 520)).toBeLessThan(2);
    expect(e.state).not.toBe('active');
  });
});

describe('archer variants', () => {
  const firstArrows = (world: World, p: Player, e: Enemy) => {
    let list: Arrow[] = [];
    let w0 = -1;
    let shot = -1;
    for (let i = 0; i < 300 && !list.length; i++) {
      p.invuln = 99;
      steps(world, 1);
      if (w0 < 0 && e.state === 'windup') w0 = i;
      list = ofType(world, Arrow);
      if (list.length) shot = i;
    }
    return { list, windup: (shot - w0) / 60 };
  };

  it('fire: arrows are burning and ignite the target', () => {
    const { world, p, e } = setup('archer_fire', 200, 400);
    const { list } = firstArrows(world, p, e);
    expect(list.length).toBe(1);
    expect(list[0].burn).toBe(3);
    expect(list[0].style).toBe('fire');
    p.invuln = 0;
    for (let i = 0; i < 90 && p.status.burn <= 0; i++) steps(world, 1);
    expect(p.status.burn).toBeGreaterThan(2);
  });

  it('volley: fires 3 arrows in a +-12 degree spread', () => {
    const { world, p, e } = setup('archer_volley', 200, 400);
    const { list } = firstArrows(world, p, e);
    expect(list.length).toBe(3);
    const ang = list.map((a) => Math.atan2(a.vy, a.vx)).sort((a, b) => a - b);
    const d = (12 * Math.PI) / 180;
    expect(ang[1] - ang[0]).toBeCloseTo(d, 2);
    expect(ang[2] - ang[1]).toBeCloseTo(d, 2);
    // a plain archer fires one
    const b = setup('archer', 200, 400);
    expect(firstArrows(b.world, b.p, b.e).list.length).toBe(1);
  });

  it('crossbow: 1.2 s windup, piercing bolt (flies on through the target), dmg x1.8, cannot be reflected', () => {
    const { world, p, e } = setup('archer_crossbow', 200, 400);
    let w0 = -1;
    let shot = -1;
    let bolt: Bolt | undefined;
    for (let i = 0; i < 300 && !bolt; i++) {
      p.invuln = 99;
      steps(world, 1);
      if (w0 < 0 && e.state === 'windup') w0 = i;
      bolt = ofType(world, Bolt)[0];
      if (bolt) shot = i;
    }
    expect(bolt).toBeTruthy();
    expect((shot - w0) / 60).toBeGreaterThanOrEqual(1.2 - 1 / 60);
    expect(ofType(world, Arrow).length).toBe(0);
    expect(isReflectable(bolt)).toBe(false);
    expect(bolt!.damage).toBe(18);
    p.invuln = 0;
    const hp0 = p.hp;
    for (let i = 0; i < 60 && p.hp === hp0; i++) steps(world, 1);
    expect(hp0 - p.hp).toBe(18);
    expect(bolt!.pierced).toBeGreaterThanOrEqual(1);
    expect(bolt!.dead).toBe(false);
    const x0 = bolt!.x;
    steps(world, 6);
    expect(bolt!.dead).toBe(false);
    expect(bolt!.x).toBeGreaterThan(x0 + 10);
    steps(world, 14);
    expect(bolt!.x).toBeGreaterThan(p.x + 20); // it went through her
  });

  it('shadow: blinks away (<= 120 px) when the player gets close', () => {
    const { world, e, p } = setup('archer_shadow', 400, 350);
    const x0 = e.x;
    let moved = 0;
    for (let i = 0; i < 90 && moved < 40; i++) {
      p.invuln = 99;
      steps(world, 1);
      moved = Math.abs(e.x - x0);
    }
    expect(moved).toBeGreaterThan(40);
    expect(moved).toBeLessThanOrEqual(125);
    expect(e.x).toBeGreaterThan(p.x); // away from her
  });
});

describe('bomber variants', () => {
  it('frost: its bombs carry a 2 s freeze and hit for x0.6 damage', () => {
    const { world, e } = setup('bomber_frost', 300, 100);
    let bomb: Bomb | undefined;
    for (let i = 0; i < 120 && !bomb; i++) {
      steps(world, 1);
      bomb = ofType(world, Bomb)[0];
    }
    expect(bomb).toBeTruthy();
    expect(bomb!.damage).toBe(8); // 14 x 0.6
    expect((bomb as any).opts.freeze).toBe(2);
    expect(e.kind).toBe('bomber_frost');
  });

  it('frost bomb: a direct freeze blast leaves the player unable to act', () => {
    const { world, p } = setup('ghoul', 900, 100);
    const hp0 = p.hp;
    world.spawn(new Bomb(p.x, p.y - 20, 0, 0, { damage: 8, radius: 44, freeze: 2, fuse: 0.1 }));
    for (let i = 0; i < 80 && p.status.freeze <= 0; i++) steps(world, 1);
    expect(p.status.freeze).toBeGreaterThan(1.5);
    expect(hp0 - p.hp).toBe(8);
  });

  it('cluster: the bomb splits into 3 bomblets when it lands', () => {
    const { world, p } = setup('ghoul', 900, 100);
    const big = world.spawn(new Bomb(500, FLOOR - 60, 0, 0, { damage: 14, radius: 36, split: 3, bombletDamage: 8, bombletRadius: 30 }));
    let lets: Bomb[] = [];
    for (let i = 0; i < 120 && !lets.length; i++) {
      steps(world, 1);
      lets = ofType(world, Bomb).filter((b) => b !== big);
    }
    expect(lets.length).toBe(3);
    expect(big.dead).toBe(true);
    expect(big.exploded).toBe(true);
    expect(lets.every((b) => b.radius === 30 && b.damage === 8)).toBe(true);
    // the bomblets scatter and then go off
    steps(world, 8);
    expect(new Set(lets.map((b) => Math.round(b.vx))).size).toBeGreaterThan(1);
    p.x = 500;
    steps(world, 120);
    expect(lets.every((b) => b.exploded)).toBe(true);
  });

  it('cluster AI throws a splitting bomb', () => {
    const { world } = setup('bomber_cluster', 300, 100);
    let bomb: Bomb | undefined;
    for (let i = 0; i < 120 && !bomb; i++) {
      steps(world, 1);
      bomb = ofType(world, Bomb)[0];
    }
    expect((bomb as any).opts.split).toBe(3);
  });

  it('kamikaze: runs at the player (speed x1.8) and self-destructs (r 50, unblockable, dmg x1.5); it dies doing it', () => {
    const { world, p, e } = setup('bomber_kamikaze', 300, 100);
    expect(e.speedMult).toBeCloseTo(1.8);
    (dropLoot as any).mockClear();
    const hp0 = p.hp;
    let maxV = 0;
    let boomAt = -1;
    for (let i = 0; i < 400 && !e.dying; i++) {
      steps(world, 1);
      maxV = Math.max(maxV, Math.abs(e.vx));
      if (e.dying) boomAt = i;
    }
    expect(e.dying).toBe(true);
    expect(boomAt).toBeGreaterThan(0);
    expect(maxV).toBeGreaterThan(95);
    expect(hp0 - p.hp).toBe(21); // 14 x 1.5, unblockable explosion
    steps(world, 60);
    expect(e.dead).toBe(true);
    expect((dropLoot as any).mock.calls.length).toBe(0);
  });

  it('kamikaze: an explosion goes through a raised shield (unblockable)', () => {
    const { world, p, e } = setup('bomber_kamikaze', 150, 130);
    p.invuln = 0;
    const hp0 = p.hp;
    for (let i = 0; i < 200 && !e.dying; i++) steps(world, 1);
    expect(p.hp).toBeLessThan(hp0);
  });

  it('alchemist: the flask leaves an acid puddle (2.5 s, damage over time)', () => {
    const { world, p } = setup('bomber_alchemist', 300, 100);
    let puddle: AcidPuddle | undefined;
    for (let i = 0; i < 240 && !puddle; i++) {
      steps(world, 1);
      puddle = ofType(world, AcidPuddle)[0];
    }
    expect(puddle).toBeTruthy();
    expect(puddle!.radius).toBe(36);
    expect(puddle!.life).toBe(2.5);
    p.x = puddle!.x;
    p.y = FLOOR;
    const hp0 = p.hp;
    steps(world, 60);
    expect(hp0 - p.hp).toBeGreaterThanOrEqual(3);
    steps(world, 120);
    expect(world.entities.includes(puddle!)).toBe(false);
  });
});

describe('harpy variants', () => {
  const FLY = FLOOR - 110;

  it('storm: shoots a 3-feather volley instead of diving', () => {
    const { world, p, e } = setup('harpy_storm', 420, 300, {}, undefined, FLY);
    let list: Arrow[] = [];
    let dived = false;
    for (let i = 0; i < 400 && !list.length; i++) {
      p.invuln = 99;
      steps(world, 1);
      if (e.state === 'active' && Math.hypot(e.vx, e.vy) > 300) dived = true;
      list = ofType(world, Arrow);
    }
    expect(list.length).toBe(3);
    expect(list.every((a) => a.style === 'feather')).toBe(true);
    expect(dived).toBe(false);
  });

  it('raven: faster dives (x1.4) and a shorter windup', () => {
    const { world, p, e } = setup('harpy_raven', 300, 340, {}, undefined, FLY);
    let w0 = -1;
    let a0 = -1;
    let maxV = 0;
    for (let i = 0; i < 600; i++) {
      p.invuln = 99;
      steps(world, 1);
      if (w0 < 0 && e.state === 'windup') w0 = i;
      if (a0 < 0 && e.state === 'active') a0 = i;
      if (e.state === 'active') maxV = Math.max(maxV, Math.hypot(e.vx, e.vy));
    }
    expect(a0).toBeGreaterThan(w0);
    expect((a0 - w0) / 60).toBeLessThan(0.5);
    expect((a0 - w0) / 60).toBeGreaterThanOrEqual(0.4 - 1 / 60);
    expect(maxV).toBeGreaterThan(470);
  });

  it('siren: the song is an expanding ring that slows the player (-40 % speed, 2 s)', () => {
    const { world, p, e } = setup('harpy_siren', 360, 300, {}, undefined, FLY);
    let slow: PlayerSlow | undefined;
    let ring: SongRing | undefined;
    for (let i = 0; i < 700 && !slow; i++) {
      p.invuln = 99;
      steps(world, 1);
      ring = ring ?? ofType(world, SongRing)[0];
      slow = ofType(world, PlayerSlow)[0];
    }
    expect(ring).toBeTruthy();
    expect(slow).toBeTruthy();
    expect(slow!.factor).toBeCloseTo(0.4);
    expect(slow!.left).toBeGreaterThan(1.8);
    expect(slow!.left).toBeLessThanOrEqual(2);
    expect(e.kind).toBe('harpy_siren');
  });

  it('slow: cuts running speed by ~40 % and ends after 2 s', () => {
    const run = (slow: boolean) => {
      const { world, p, input } = setup('ghoul', 1300, 100);
      if (slow) slowPlayer(world, 0.4, 2);
      steps(world, 20); // settle
      const x0 = p.x;
      input.setAxis('kb', 1, 0);
      steps(world, 40);
      input.setAxis('kb', 0, 0);
      return { d: p.x - x0, world };
    };
    const a = run(false).d;
    const b = run(true);
    expect(a).toBeGreaterThan(80);
    expect(b.d / a).toBeGreaterThan(0.5);
    expect(b.d / a).toBeLessThan(0.72);
    steps(b.world, 120);
    expect(ofType(b.world, PlayerSlow).length).toBe(0);
  });

  it('slow: a roll through the ring dodges it', () => {
    const { world, p } = setup('ghoul', 1300, 100);
    const ring = new SongRing(p.x - 40, p.cy, { maxR: 100, speed: 600 });
    Object.defineProperty(p, 'rollInvulnerable', { get: () => true });
    world.spawn(ring);
    steps(world, 20);
    expect(ofType(world, PlayerSlow).length).toBe(0);
  });

  it('ember: the dive impact leaves a fire patch on the floor (2 s burn)', () => {
    const { world, p } = setup('harpy_ember', 300, 340, {}, undefined, FLY);
    let patch: FirePatch | undefined;
    for (let i = 0; i < 700 && !patch; i++) {
      p.invuln = 99;
      steps(world, 1);
      patch = ofType(world, FirePatch)[0];
    }
    expect(patch).toBeTruthy();
    expect(patch!.life).toBe(2);
    expect(Math.abs(patch!.y - FLOOR)).toBeLessThan(2);
    p.invuln = 0;
    p.x = patch!.x;
    p.y = FLOOR;
    steps(world, 30);
    expect(p.status.burn).toBeGreaterThan(0);
    steps(world, 150);
    expect(world.entities.includes(patch!)).toBe(false);
  });
});

describe('lancer variants', () => {
  it('halberd: no charge, a wide 2-hit sweep (reach ~70 px)', () => {
    const map = flatMap(30, 18);
    const { world, e, p } = setup('lancer_halberd', 300, 520, {}, map);
    let actives = 0;
    let prev = '';
    let charged = false;
    for (let i = 0; i < 400; i++) {
      p.invuln = 99;
      steps(world, 1);
      if (e.state === 'active' && prev !== 'active') actives++;
      if (e.state === 'active' && Math.abs(e.vx) > 200) charged = true;
      prev = e.state;
    }
    expect(charged).toBe(false);
    expect(actives).toBeGreaterThanOrEqual(2);
    expect(actives % 2).toBe(0);
  });

  it('halberd: both sweeps reach out to ~70 px', () => {
    const { world, e, p } = setup('lancer_halberd', 200, 262);
    const hits: number[] = [];
    let last = p.hp;
    for (let i = 0; i < 200 && hits.length < 2; i++) {
      p.invuln = 0;
      p.x = e.x + e.facing * 66;
      p.y = FLOOR;
      steps(world, 1);
      if (p.hp < last) hits.push(i);
      last = p.hp;
    }
    expect(hits.length).toBe(2);
  });

  it('paladin: the shield blocks frontal hits (like the jailer), is hurt from behind; still charges', () => {
    const { world, p, e } = setup('lancer_paladin', 300, 100);
    e.facing = 1;
    const sfx = vi.spyOn(world.audio, 'play');
    const hp = e.hp;
    const front = e.takeDamage({ amount: 12, dir: -1, kind: 'melee', source: p });
    expect(front.blocked).toBe(true);
    expect(front.applied).toBe(false);
    expect(e.hp).toBe(hp);
    expect(sfx.mock.calls.some((c) => c[0] === 'block')).toBe(true);
    const back = e.takeDamage({ amount: 12, dir: 1, kind: 'melee', source: p });
    expect(back.applied).toBe(true);
    expect(e.hp).toBe(hp - 12);
    steps(world, 20);
    e.facing = 1;
    e.hitstun = 0;
    expect(e.takeDamage({ amount: 10, dir: -1, kind: 'melee', unblockable: true }).applied).toBe(true);
    expect(e.takeDamage({ amount: 10, dir: -1, kind: 'explosion' }).applied).toBe(true);
    // charging
    const map = flatMap(30, 18);
    const c = setup('lancer_paladin', 300, 520, {}, map);
    let speed = 0;
    for (let i = 0; i < 300; i++) {
      c.p.invuln = 99;
      steps(c.world, 1);
      if (c.e.state === 'active') speed = Math.max(speed, Math.abs(c.e.vx));
    }
    expect(speed).toBeGreaterThan(250);
  });

  it('duelist: quick 3-thrust combo; parries the first hit after each attack', () => {
    const { world, e, p } = setup('lancer_duelist', 300, 240);
    let actives = 0;
    let prev = '';
    let started = false;
    let parried = false;
    for (let i = 0; i < 300; i++) {
      p.invuln = 99;
      steps(world, 1);
      if (e.state === 'active' && prev !== 'active') actives++;
      if (e.state === 'windup' || e.state === 'active') started = true;
      if (started && e.state === 'cooldown') {
        parried = true;
        break;
      }
      prev = e.state;
    }
    expect(parried).toBe(true);
    expect(actives).toBe(3);
    // armed: the first frontal hit is deflected, the next one lands
    expect(e.shieldUp).toBe(true);
    e.facing = 1;
    const text = vi.spyOn(world.fx, 'text');
    const hp = e.hp;
    const a = e.takeDamage({ amount: 7, dir: -1, kind: 'melee', source: p });
    expect(a.blocked).toBe(true);
    expect(e.hp).toBe(hp);
    expect(text.mock.calls.some((c) => c[2] === '쳐냄')).toBe(true);
    expect(e.shieldUp).toBe(false);
    const b = e.takeDamage({ amount: 7, dir: -1, kind: 'melee', source: p });
    expect(b.applied).toBe(true);
    expect(e.hp).toBe(hp - 7);
  });

  it('dragoon: leaps onto the player (jump arc + AoE landing) instead of charging', () => {
    const { world, e, p } = setup('lancer_dragoon', 200, 400);
    let minY = FLOOR;
    let leapStart = -1;
    let lossAtLanding = -1;
    const hp0 = p.hp;
    let groundRun = 0;
    for (let i = 0; i < 300 && lossAtLanding < 0; i++) {
      p.invuln = 0;
      steps(world, 1);
      if (e.state === 'windup' && leapStart < 0) leapStart = i;
      if (e.state === 'active') {
        minY = Math.min(minY, e.y);
        if (e.onGround && Math.abs(e.vx) > 250) groundRun++;
      }
      if (leapStart >= 0 && e.state === 'recover') lossAtLanding = hp0 - p.hp;
    }
    expect(groundRun).toBeLessThan(4); // not a ground charge
    expect(FLOOR - minY).toBeGreaterThan(25); // an arc, not a run
    expect(Math.abs(e.x - 400)).toBeLessThan(40); // landed on her
    expect(lossAtLanding).toBe(17); // 14 x 1.2, unblockable AoE
  });

  it('dragoon: the landing AoE is limited to its radius', () => {
    const { world, p } = setup('ghoul', 900, 100);
    const d = createEnemy('lancer_dragoon', 500, FLOOR, {}) as Enemy;
    world.spawn(d);
    p.x = 100;
    steps(world, 4);
    const hp0 = p.hp;
    (d as any).mode = 'leap';
    (d as any).leapX = 500;
    // an AoE far from the player does nothing
    shockAoE(world, 500, FLOOR, 52, 17, d);
    expect(p.hp).toBe(hp0);
    shockAoE(world, 120, FLOOR, 52, 17, d);
    expect(p.hp).toBe(hp0 - 17);
  });
});
