import { describe, it, expect } from 'vitest';
import { makeTestWorld, steps, flatMap } from './helpers';
import { Player } from '../src/game/player/player';
import { Actor } from '../src/game/entity';
import type { DamageInfo } from '../src/game/combat';
import { TileMap, T } from '../src/game/tilemap';
import { RunState, LEVEL_SEQUENCE } from '../src/game/run';
import { defaultSave, loadSave, MAX_LOOP, type SaveData } from '../src/game/meta/save';
import { applyRunStart, unlockedCount } from '../src/game/meta/progression';
import { bankPieces, winRun } from '../src/game/meta/bank';
import {
  CORPSE, GOLEM, STASH, TIER2, ELITE, golemCost, golemStatMul, loopDmgMul, loopEliteBonus, loopHpMul, loopK, enemyDmgMul, enemyHpMul,
} from '../src/game/rules';
import { createEnemy } from '../src/game/enemies/factory';
import type { Enemy } from '../src/game/enemies/base';
import { ENEMY_DEFS } from '../src/game/enemies/variants';
import { createMiniBoss, MINIBOSS_IDS, MINIBOSS_SPECS, type MiniBoss } from '../src/game/miniboss';
import { createBoss, MATRON, type Matron } from '../src/game/boss/matron';
import { collectAllPieces, collectCoinsInRange, dropLoot, homeAllPieces } from '../src/game/items/pickups';
import { ITEMS, rollItem } from '../src/game/items/items';
import { ITEM_IDS, UNIQUE_IDS, type ItemId } from '../src/game/items/types';
import { Rng } from '../src/engine/rng';
import { hitArea } from '../src/game/combat';
import { Seamstress, SELMA_LINES, GolemPile } from '../src/game/props';
import { Golem, golemDamage, golemMaxHp, newGolemState, spawnRunGolem } from '../src/game/allies/golem';
import { buildLevel, populateLevel } from '../src/game/level/build';
import { generateBiome } from '../src/game/level/generator';
import { hudLayout } from '../src/game/ui/hud';
import { Game } from '../src/game/game';
import { DeathScene } from '../src/game/scenes/deathScene';
import { VictoryScene } from '../src/game/scenes/victoryScene';

const FLOOR = 16 * 24;

/** a world with the heroine on the floor; `events` collects every event, `sounds` every sfx name */
function setup(map: TileMap = flatMap(), x = 120) {
  const t = makeTestWorld(map);
  const p = new Player(x, FLOOR);
  t.world.player = p;
  t.world.spawn(p);
  const sounds: string[] = [];
  t.game.audio.play = (s: string) => { sounds.push(s); };
  const events: { type: string; [k: string]: unknown }[] = [];
  t.world.on((e) => events.push(e as { type: string }));
  // the in-game bits the props call on the Game
  const persisted: number[] = [];
  t.game.persist = () => { persisted.push(t.game.save.pieces); };
  steps(t.world, 3);
  return { ...t, p, sounds, events, persisted };
}

/** a stationary enemy-team target */
class Dummy extends Actor {
  log: DamageInfo[] = [];
  constructor(x: number, y: number, hp = 100000) {
    super(x, y);
    this.w = 16;
    this.h = 40;
    this.hp = this.maxHp = hp;
    this.physics = false;
    this.knockbackTaken = 0;
  }
  takeDamage(info: DamageInfo) {
    if (info.kind !== 'dot') this.log.push(info);
    return super.takeDamage(info);
  }
  update(dt: number) {
    this.updateStatus(dt);
  }
  draw() {}
}

/** every piece pickup lying in the world, as the pieces it holds / the sprite it uses */
const pieceDrops = (world: ReturnType<typeof setup>['world']) =>
  world.entities.filter((e) => e.constructor.name === 'Coin' && (e as unknown as { kind: string }).kind === 'piece') as unknown as { value: number; anim: { name: string } }[];
const piecesLying = (world: ReturnType<typeof setup>['world']) => pieceDrops(world).reduce((a, c) => a + c.value, 0);

// ---------------------------------------------------------------------------------------------------------------------
describe('rules: loops, pieces and the golem tables', () => {
  it('the drop table is 1 / 3 / 8 / 12', () => {
    expect(CORPSE.drop).toEqual({ enemy: 1, elite: 3, miniboss: 8, matron: 12 });
  });

  it('loop scaling: k = min(loop, 5) - 1, hp +30 %, damage +20 %, elites +5 points per step', () => {
    expect([1, 2, 3, 5, 6, 40].map(loopK)).toEqual([0, 1, 2, 4, 4, 4]);
    expect(loopK(0)).toBe(0);
    expect(loopHpMul(1)).toBe(1);
    expect(loopHpMul(2)).toBeCloseTo(1.3);
    expect(loopHpMul(3)).toBeCloseTo(1.6);
    expect(loopHpMul(5)).toBeCloseTo(2.2);
    expect(loopHpMul(9)).toBeCloseTo(2.2);
    expect(loopDmgMul(1)).toBe(1);
    expect(loopDmgMul(2)).toBeCloseTo(1.2);
    expect(loopDmgMul(5)).toBeCloseTo(1.8);
    expect(loopEliteBonus(1)).toBe(0);
    expect(loopEliteBonus(2)).toBeCloseTo(0.05);
    expect(loopEliteBonus(5)).toBeCloseTo(0.2);
    expect(loopEliteBonus(12)).toBeCloseTo(0.2);
  });

  it('golem cost is 30 + 15 per step (30 in loop 1)', () => {
    expect([1, 2, 3, 4, 5, 8].map(golemCost)).toEqual([30, 45, 60, 75, 90, 90]);
    expect(golemStatMul(1)).toBe(1);
    expect(golemStatMul(3)).toBeCloseTo(1.6);
    expect(golemStatMul(7)).toBeCloseTo(2.2);
  });

  it('enemy multipliers include the loop (default loop 1 = unchanged)', () => {
    expect(enemyHpMul(1, 2, false)).toBe(TIER2.hp);
    expect(enemyHpMul(1, 1, false, 3)).toBeCloseTo(loopHpMul(3));
    expect(enemyHpMul(1.2, 2, true, 2)).toBeCloseTo(TIER2.hp * ELITE.hp * 1.2 * 1.3);
    expect(enemyDmgMul(1, 2, false)).toBe(TIER2.dmg);
    expect(enemyDmgMul(1, 1, false, 5)).toBeCloseTo(1.8);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('save: loop, shards, the bank and old saves', () => {
  const store = new Map<string, string>();
  const KEY = 'deadsell.save.v1';
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  const load = (d: unknown): SaveData => {
    store.set(KEY, JSON.stringify(d));
    return loadSave();
  };

  it('a new save is loop 1 with an empty bank and no bell shards', () => {
    const s = defaultSave();
    expect([s.loop, s.pieces, s.shards]).toEqual([1, 0, []]);
  });

  it('old saves without the fields load with the defaults; the removed body / loopRuns are ignored', () => {
    const s = load({ version: 1, runs: 7, wins: 2, totalKills: 90 });
    expect([s.loop, s.pieces, s.shards]).toEqual([1, 0, []]);
    expect(s.runs).toBe(7);
    const old = load({ version: 1, loop: 2, body: 63, loopRuns: 9 }) as unknown as Record<string, unknown>;
    expect(old.loop).toBe(2);
    expect('body' in old).toBe(false);
    expect('loopRuns' in old).toBe(false);
    store.clear();
    expect(loadSave().loop).toBe(1);
  });

  it('sanitises: loop is an integer 1..99, shards are loops 1..99, the bank is an integer >= 0, junk falls back', () => {
    expect(load({ loop: 0 }).loop).toBe(1);
    expect(load({ loop: -5 }).loop).toBe(1);
    expect(load({ loop: 2.9 }).loop).toBe(2);
    expect(load({ loop: 1000 }).loop).toBe(MAX_LOOP);
    expect(load({ loop: '3' }).loop).toBe(1);
    expect(load({ loop: null }).loop).toBe(1);
    expect(load({ pieces: 41 }).pieces).toBe(41);
    expect(load({ pieces: -3 }).pieces).toBe(0);
    expect(load({ pieces: 12.7 }).pieces).toBe(12);
    expect(load({ pieces: 'x' }).pieces).toBe(0);
    expect(load({ shards: [1, 3, 2] }).shards).toEqual([1, 3, 2]);
    expect(load({ shards: [0, -4, 2.8, 500, 'a', null, NaN] }).shards).toEqual([1, 1, 2, MAX_LOOP]);
    expect(load({ shards: 'many' }).shards).toEqual([]);
    expect(load({ shards: Array.from({ length: 300 }, () => 2) }).shards).toHaveLength(STASH.shardCap);
    store.clear();
  });

  it('a run starts in the save\'s loop with nothing carried and no golem', () => {
    const s = defaultSave();
    s.loop = 3;
    s.pieces = 50;
    const run = new RunState(5);
    applyRunStart(run, s);
    expect([run.loop, run.pieces, run.golem]).toEqual([3, 0, null]);
    expect(s.pieces).toBe(50);
  });

  it('the passage level is called 쉼터', () => {
    for (const l of LEVEL_SEQUENCE.filter((l) => l.kind === 'passage')) expect(l.name).toBe('쉼터');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the bank: carried pieces are kept at the 쉼터 and on victory (docs/CONTENT4.md §3)', () => {
  const fresh = (pieces: number, bank = 0) => {
    const run = new RunState(1);
    run.pieces = pieces;
    const save = defaultSave();
    save.pieces = bank;
    return { run, save };
  };

  it('banking moves every carried piece into the permanent bank', () => {
    const { run, save } = fresh(37, 10);
    expect(bankPieces(run, save)).toBe(37);
    expect([run.pieces, save.pieces]).toEqual([0, 47]);
    expect(bankPieces(run, save)).toBe(0); // nothing carried: nothing happens
    expect(save.pieces).toBe(47);
  });

  it('winning banks the carried pieces, keeps a bell shard of the loop that was won and starts the next loop', () => {
    const { run, save } = fresh(25, 5);
    run.loop = 2;
    save.loop = 2;
    save.shards = [1];
    const win = winRun(run, save);
    expect(win).toEqual({ banked: 25, loop: 2, nextLoop: 3 });
    expect([run.pieces, save.pieces, save.loop, save.shards]).toEqual([0, 30, 3, [1, 2]]);
  });

  it('the loop number and the shard list stop at their limits', () => {
    const { run, save } = fresh(0);
    run.loop = MAX_LOOP;
    save.loop = MAX_LOOP;
    expect(winRun(run, save).nextLoop).toBe(MAX_LOOP);
    expect(save.shards).toEqual([MAX_LOOP]);
    save.shards = Array.from({ length: STASH.shardCap }, () => 5);
    save.shards[7] = 1;
    run.loop = 3;
    winRun(run, save);
    expect(save.shards).toHaveLength(STASH.shardCap);
    expect(save.shards).not.toContain(1); // the lowest shard made room
    expect(save.shards).toContain(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('drops: every kill drops corpse pieces', () => {
  it('an ordinary enemy drops 1 piece, an elite 3 (a big one)', () => {
    const a = setup();
    const e = createEnemy('ghoul', 300, FLOOR, { tier: 1, elite: false });
    a.world.spawn(e);
    steps(a.world, 2);
    e.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: a.p });
    steps(a.world, 1);
    expect(piecesLying(a.world)).toBe(CORPSE.drop.enemy);
    expect(pieceDrops(a.world)[0].anim.name).toBe('piece');

    const b = setup();
    const el = createEnemy('jailer', 300, FLOOR, { tier: 1, elite: true });
    b.world.spawn(el);
    steps(b.world, 2);
    el.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: b.p, unblockable: true });
    steps(b.world, 1);
    expect(piecesLying(b.world)).toBe(CORPSE.drop.elite);
    expect(pieceDrops(b.world).map((c) => c.anim.name)).toEqual(['piece_big']);
  });

  it('every one of the 30 enemy types drops its piece (a self-destruct drops nothing)', () => {
    for (const id of Object.keys(ENEMY_DEFS)) {
      const t = setup();
      const e = createEnemy(id as keyof typeof ENEMY_DEFS, 400, FLOOR, { tier: 1, elite: false }) as Enemy;
      t.world.spawn(e);
      steps(t.world, 2);
      e.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: t.p, unblockable: true });
      steps(t.world, 1);
      expect(piecesLying(t.world), id).toBe(CORPSE.drop.enemy);
    }
  });

  it('a mid-boss drops 8 pieces, the Iron Matron 12', () => {
    for (const id of MINIBOSS_IDS) {
      const t = setup(flatMap(60, 18), 300);
      const boss = createMiniBoss(id, 700, FLOOR, MINIBOSS_SPECS[id].biome === 'ramparts' ? 2 : 1) as MiniBoss;
      t.world.spawn(boss);
      steps(t.world, 2);
      boss.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: t.p });
      for (let i = 0; i < 400 && boss.state !== 'idle'; i++) steps(t.world, 1);
      (boss as unknown as { gapT: number }).gapT = 999;
      const before = piecesLying(t.world);
      boss.takeDamage({ amount: boss.hp + 999, dir: 1, kind: 'melee', source: t.p });
      steps(t.world, 1);
      const got = piecesLying(t.world) - before;
      expect(got, id).toBeGreaterThanOrEqual(CORPSE.drop.miniboss);
      // (the summoned ghouls of the abbess die with her and drop 1 each)
      if (id !== 'mb_abbess') expect(got, id).toBe(CORPSE.drop.miniboss);
    }
    const t = setup(flatMap(60, 18), 300);
    const m = createBoss(700, FLOOR) as Matron;
    t.world.spawn(m);
    steps(t.world, 2);
    m.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: t.p });
    for (let i = 0; i < 400 && m.state !== 'idle'; i++) steps(t.world, 1);
    (m as unknown as { gapT: number }).gapT = 999;
    m.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: t.p });
    steps(t.world, 1);
    expect(piecesLying(t.world)).toBe(CORPSE.drop.matron);
  });

  it('dropLoot splits pieces into pickups of at most 3 and uses the big sprite from 3 up', () => {
    for (const [n, parts] of [[1, [1]], [3, [3]], [8, [3, 3, 2]], [12, [3, 3, 3, 3]], [0, []]] as [number, number[]][]) {
      const t = setup();
      dropLoot(t.world, 300, FLOOR, { pieces: n });
      steps(t.world, 1);
      expect(pieceDrops(t.world).map((c) => c.value).sort((a, b) => b - a), `${n}`).toEqual(parts);
      for (const c of pieceDrops(t.world)) expect(c.anim.name).toBe(c.value >= CORPSE.big ? 'piece_big' : 'piece');
    }
  });

  it('pieces fly to the heroine and are carried (run.pieces), with a pickup event for the HUD toast', () => {
    const t = setup(flatMap(), 300);
    dropLoot(t.world, 300, FLOOR, { pieces: 8 });
    steps(t.world, 150);
    expect(t.run.pieces).toBe(8);
    expect(piecesLying(t.world)).toBe(0);
    const got = t.events.filter((e) => e.type === 'pickup' && e.what === 'pieces').reduce((a, e) => a + (e.amount as number), 0);
    expect(got).toBe(8);
  });

  it('the boss fell: every piece still lying anywhere is credited at once, and the ones in flight make it too', () => {
    const t = setup(flatMap(130, 18), 120);
    // the heroine is 2800 px from the pile: far beyond the homing range, off screen (such coins are not even updated)
    dropLoot(t.world, 2900, FLOOR, { pieces: CORPSE.drop.matron, cells: 6 });
    steps(t.world, 90);
    expect(piecesLying(t.world)).toBe(CORPSE.drop.matron);
    expect(t.run.pieces).toBe(0);
    // they fly to her from anywhere
    homeAllPieces(t.world);
    steps(t.world, 45);
    const flying = piecesLying(t.world);
    expect(flying).toBe(CORPSE.drop.matron);
    steps(t.world, 600);
    expect(t.run.pieces).toBe(CORPSE.drop.matron);
    expect(t.run.cells).toBe(0); // cells keep the old rules: they stay where they fell
    // ... and what is still on the floor when the victory is called is credited on the spot
    const u = setup(flatMap(130, 18), 120);
    dropLoot(u.world, 2900, FLOOR, { pieces: CORPSE.drop.matron, cells: 6 });
    steps(u.world, 5);
    expect(collectAllPieces(u.world)).toBe(CORPSE.drop.matron);
    expect(u.run.pieces).toBe(CORPSE.drop.matron);
    expect(u.run.cells).toBe(0);
    steps(u.world, 2);
    expect(piecesLying(u.world)).toBe(0);
    expect(collectAllPieces(u.world)).toBe(0);
  });

  it('leaving the level: loot in range is collected at once, however young; loot far away stays', () => {
    const t = setup(flatMap(60, 18), 300);
    dropLoot(t.world, 340, FLOOR, { pieces: 3, cells: 2, gold: 5 }); // just dropped: it only starts homing after 0.4 s
    dropLoot(t.world, 1100, FLOOR, { pieces: 4 }); // well out of range
    steps(t.world, 3);
    expect(t.run.pieces).toBe(0);
    collectCoinsInRange(t.world);
    expect(t.run.pieces).toBe(3);
    expect(t.run.cells).toBe(2);
    expect(t.run.gold).toBeGreaterThan(0);
    steps(t.world, 2);
    expect(piecesLying(t.world)).toBe(4);
    collectCoinsInRange(t.world); // nothing twice
    expect(t.run.pieces).toBe(3);
  });

  it('cells and gold still drop beside the pieces', () => {
    const t = setup();
    dropLoot(t.world, 300, FLOOR, { cells: 4, gold: 10, pieces: 1 });
    steps(t.world, 1);
    const kinds = t.world.entities.filter((e) => e.constructor.name === 'Coin').map((e) => (e as unknown as { kind: string }).kind);
    expect(kinds.filter((k) => k === 'cell')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'gold')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'piece')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('loops make the world harder', () => {
  const hpOf = (loop: number, make: (x: number) => Actor, x = 400) => {
    const t = setup();
    t.run.loop = loop;
    const a = make(x);
    t.world.spawn(a);
    steps(t.world, 2);
    return a;
  };

  it('enemy hp and damage scale with the loop (tier, elite and variant factors stay)', () => {
    for (const loop of [1, 2, 3, 5, 8]) {
      for (const [kind, tier, elite] of [['ghoul', 1, false], ['lancer_paladin', 2, false], ['archer_fire', 2, true]] as const) {
        const e = hpOf(loop, (x) => createEnemy(kind, x, FLOOR, { tier, elite })) as Enemy;
        const def = ENEMY_DEFS[kind];
        const base = createEnemy(kind, 0, 0, { tier, elite }) as Enemy; // loop 1, never spawned
        expect(e.maxHp, `${kind} loop ${loop}`).toBe(Math.round(e.spec.hp * enemyHpMul(def.hp, tier, elite, loop)));
        expect(e.hp).toBe(e.maxHp);
        expect(e.dmgMult, `${kind} loop ${loop}`).toBeCloseTo(base.dmgMult * loopDmgMul(loop));
      }
    }
    // concrete numbers: a ghoul (hp 60?) in loop 3 has 1.6x
    const g1 = hpOf(1, (x) => createEnemy('ghoul', x, FLOOR, {})).maxHp;
    const g3 = hpOf(3, (x) => createEnemy('ghoul', x, FLOOR, {})).maxHp;
    expect(g3).toBe(Math.round(g1 * 1.6));
  });

  it('mid-boss hp and damage scale with the loop', () => {
    for (const id of MINIBOSS_IDS) {
      const tier = MINIBOSS_SPECS[id].biome === 'ramparts' ? 2 : 1;
      const b1 = hpOf(1, (x) => createMiniBoss(id, x, FLOOR, tier)) as MiniBoss;
      const b3 = hpOf(3, (x) => createMiniBoss(id, x, FLOOR, tier)) as MiniBoss;
      expect(b3.maxHp, id).toBe(Math.round(b1.maxHp * 1.6));
      expect(b3.dmgMult, id).toBeCloseTo(b1.dmgMult * 1.4);
    }
  });

  it('the Matron has 2200 hp in loop 1 and +30 % per loop after; her damage grows by 20 % per loop', () => {
    const m1 = hpOf(1, (x) => createBoss(x, FLOOR)) as Matron;
    const m4 = hpOf(4, (x) => createBoss(x, FLOOR)) as Matron;
    expect(m1.maxHp).toBe(MATRON.hp);
    expect(m4.maxHp).toBe(Math.round(MATRON.hp * 1.9));
    // her slam in loop 4 hits for 1.6x
    const t = setup(flatMap(60, 18), 300);
    t.run.loop = 4;
    const m = createBoss(520, FLOOR) as Matron;
    t.world.spawn(m);
    steps(t.world, 2);
    const hits: number[] = [];
    const orig = t.p.takeDamage.bind(t.p);
    t.p.takeDamage = (info: DamageInfo) => { hits.push(info.amount); return orig(info); };
    const priv = m as unknown as { state: string; hitSet: Set<number>; onActive(): void };
    priv.state = 'slam';
    priv.hitSet = new Set();
    t.p.x = m.x + m.facing * 60;
    priv.onActive();
    expect(hits).toEqual([Math.round(MATRON.slam.dmg * loopDmgMul(4))]);
    expect(hits[0]).toBe(45);
  });

  it('the burn / poison / fire hazards enemies leave grow with the loop like their direct hits (+20 % per step)', () => {
    const found = (t: ReturnType<typeof setup>, cls: string) => t.world.entities.find((e) => e.constructor.name === cls) as unknown as { dps?: number; burnDps?: number };
    const cloud = (loop: number) => {
      const t = setup();
      t.run.loop = loop;
      const e = createEnemy('ghoul_plague', 400, FLOOR, { tier: 1, elite: false }) as Enemy;
      t.world.spawn(e);
      steps(t.world, 2);
      e.takeDamage({ amount: 99999, dir: 1, kind: 'melee' });
      steps(t.world, 2);
      return found(t, 'PoisonCloud').dps!;
    };
    const fire = (loop: number) => {
      const t = setup();
      t.run.loop = loop;
      const e = createEnemy('harpy_ember', 400, FLOOR - 20, { tier: 1, elite: false }) as Enemy;
      t.world.spawn(e);
      steps(t.world, 2);
      (e as unknown as { leaveFire(): void }).leaveFire();
      steps(t.world, 1);
      return found(t, 'FirePatch').dps!;
    };
    const arrow = (loop: number) => {
      const t = setup();
      t.run.loop = loop;
      const e = createEnemy('archer_fire', 400, FLOOR, { tier: 1, elite: false }) as Enemy;
      t.world.spawn(e);
      steps(t.world, 2);
      const a = e as unknown as { aimX: number; aimY: number; onActiveStart(): void };
      a.aimX = 300;
      a.aimY = FLOOR - 20;
      e.facing = -1;
      a.onActiveStart();
      steps(t.world, 1);
      return found(t, 'Arrow').burnDps!;
    };
    expect([cloud(1), fire(1), arrow(1)]).toEqual([4, 6, 5]);
    for (const loop of [2, 3, 5, 9]) {
      const k = loopDmgMul(loop);
      expect(cloud(loop), `cloud loop ${loop}`).toBeCloseTo(4 * k);
      expect(fire(loop), `fire loop ${loop}`).toBeCloseTo(6 * k);
      expect(arrow(loop), `burning arrow loop ${loop}`).toBeCloseTo(5 * k);
    }
    expect(cloud(3)).toBeCloseTo(5.6);
  });

  it('elite chance rises by 5 points per loop step in biome levels', () => {
    const level = generateBiome('prison', 11).level;
    const count = (loop: number): number => {
      let elites = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const t = makeTestWorld(level.map, seed);
        const p = new Player(120, FLOOR);
        t.world.player = p;
        t.run.loop = loop;
        populateLevel(t.world, level);
        steps(t.world, 1);
        elites += t.world.entities.filter((e) => (e as Enemy).elite === true).length;
      }
      return elites;
    };
    const [l1, l3, l5, l9] = [count(1), count(3), count(5), count(9)];
    expect(l3).toBeGreaterThan(l1);
    expect(l5).toBeGreaterThan(l3);
    expect(l9).toBe(l5); // the loop ceiling: loop 5 and later play alike
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('쉼터: Selma and the golem pile', () => {
  const tpl = () => buildLevel(LEVEL_SEQUENCE.find((l) => l.kind === 'passage')!, 7);

  it('the passage level has Selma and the golem pile, left to right after the alchemist and the fountain, and no corpse shop', () => {
    const lvl = tpl();
    const by = (type: string) => lvl.spawns.filter((s) => s.type === type);
    expect(by('seamstress')).toHaveLength(1);
    expect(by('golem_pile')).toHaveLength(1);
    expect(lvl.spawns.some((s) => (s.type as string) === 'corpse_shop')).toBe(false);
    const order = ['alchemist', 'fountain', 'seamstress', 'golem_pile', 'exit'].map((t) => by(t)[0].tx);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // nothing stands on the fountain or the door
    const fountain = by('fountain')[0];
    const exit = by('exit')[0];
    for (const s of lvl.spawns.filter((s) => s.type === 'deco' || s.type === 'seamstress' || s.type === 'golem_pile')) {
      expect(Math.abs(s.tx - fountain.tx), `${s.type}@${s.tx} vs the fountain`).toBeGreaterThanOrEqual(3);
      expect(Math.abs(s.tx - exit.tx), `${s.type}@${s.tx} vs the door`).toBeGreaterThanOrEqual(3);
    }
  });

  it('populateLevel spawns the props', () => {
    const t = setup();
    t.world.entities.length = 0;
    populateLevel(t.world, tpl());
    steps(t.world, 1);
    const of = <C>(c: new (...a: never[]) => C) => t.world.entities.filter((e) => e instanceof c) as unknown as C[];
    expect(of(Seamstress as never)).toHaveLength(1);
    expect(of(GolemPile as never)).toHaveLength(1);
  });

  describe('Selma', () => {
    const talk = (bank = 0) => {
      const t = setup();
      t.game.save.pieces = bank;
      const selma = new Seamstress(300, FLOOR);
      t.world.spawn(selma);
      steps(t.world, 2);
      return { ...t, selma };
    };
    it('she talks (6+ lore lines, never the same twice in a row) and shows the banked pieces', () => {
      expect(SELMA_LINES.length).toBeGreaterThanOrEqual(6);
      const a = talk(12);
      expect(a.selma.promptText()).toBe('조합');
      expect(a.selma.promptSub()).toBe('재봉사 셀마 · 시체 조각 12');
      const said = new Set<string>();
      let last = '';
      for (let i = 0; i < 40; i++) {
        a.selma.interact();
        const line = (a.selma as unknown as { line: string }).line;
        expect(SELMA_LINES).toContain(line);
        expect(line).not.toBe(last);
        last = line;
        said.add(line);
      }
      expect(said.size).toBeGreaterThanOrEqual(6);
      expect(a.game.save.pieces).toBe(12);
    });
    it('while her banter line is up the prompt steps aside (it was drawn over the bubble), then comes back', () => {
      const a = talk();
      expect(a.selma.promptText()).toBe('조합');
      a.selma.interact();
      expect(a.selma.promptText()).toBe('');
      steps(a.world, 60 * 3 + 5);
      expect(a.selma.promptText()).toBe('조합');
    });
  });

  describe('the golem pile', () => {
    /** `bank` pieces in the bank; the pieces carried by the run are never used */
    const pile = (bank: number, loop = 1) => {
      const t = setup();
      t.game.save.pieces = bank;
      t.run.pieces = 500;
      t.run.loop = loop;
      const p = new GolemPile(300, FLOOR);
      t.world.spawn(p);
      steps(t.world, 2);
      return { ...t, pile: p };
    };
    it('costs 30 banked pieces in loop 1, 15 more per loop; too few is an error toast', () => {
      const a = pile(29);
      expect(a.pile.promptText()).toBe('누더기 골렘 제작');
      expect(a.pile.promptSub()).toBe('30조각 (맡긴 29) · 조력자 (이번 런 동안 함께 싸움)');
      a.pile.interact();
      expect(a.sounds).toContain('error');
      expect(a.events.find((e) => e.type === 'toast')?.text).toBe('시체 조각이 부족하다');
      expect(a.run.golem).toBeNull();
      expect(a.game.save.pieces).toBe(29);
      expect(pile(0, 3).pile.promptSub()).toContain('60조각');
      const b = pile(59, 3);
      b.pile.interact();
      expect(b.run.golem).toBeNull();
    });
    it('buying pays from the bank (saved at once), not from the carried pieces; the golem is raised from the pile', () => {
      const a = pile(40);
      a.pile.interact();
      expect(a.game.save.pieces).toBe(10);
      expect(a.run.pieces).toBe(500);
      expect(a.persisted).toEqual([10]);
      expect(a.run.golem).toEqual({ hp: GOLEM.hp, maxHp: GOLEM.hp });
      expect(a.events.find((e) => e.type === 'toast')?.text).toBe('누더기 골렘이 일어섰다');
      expect(a.pile.canInteract()).toBe(false);
      expect(a.pile.promptText()).toBe('골렘 수선');
      steps(a.world, 80);
      const golems = a.world.entities.filter((e) => e instanceof Golem) as Golem[];
      expect(golems).toHaveLength(1);
      expect(Math.abs(golems[0].x - 300)).toBeLessThan(80);
      a.pile.interact();
      expect(a.game.save.pieces).toBe(10);
    });
    it('a golem that already follows her leaves nothing to buy', () => {
      const t = setup();
      newGolemState(t.run);
      const p = new GolemPile(300, FLOOR);
      t.world.spawn(p);
      steps(t.world, 2);
      expect(p.canInteract()).toBe(false);
      expect(p.promptSub()).toBe(`체력 ${GOLEM.hp}/${GOLEM.hp}`);
    });
    it('in loop 3 the golem has +60 % hp and damage', () => {
      expect(golemMaxHp(1)).toBe(GOLEM.hp);
      expect(golemMaxHp(3)).toBe(Math.round(GOLEM.hp * 1.6));
      expect(golemDamage(1, 1)).toBe(GOLEM.damage);
      expect(golemDamage(3, 1)).toBe(Math.round(GOLEM.damage * 1.6));
      expect(golemDamage(1, 2)).toBe(Math.round(GOLEM.damage * 1.25));
      const t = setup();
      t.run.loop = 3;
      expect(newGolemState(t.run)).toEqual({ hp: golemMaxHp(3), maxHp: golemMaxHp(3) });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('items: uniques stay out of the random pool', () => {
  it('rollItem never returns a unique, even when the unlocked list names one', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 400; i++) {
      for (const slot of [undefined, 'weapon', 'skill'] as const) {
        const r = rollItem(rng, 1 + (i % 2), ITEM_IDS, slot);
        expect(UNIQUE_IDS.includes(r.id), r.id).toBe(false);
      }
    }
  });
  it('the title\'s unlock count ignores them', () => {
    const total = Object.keys(ITEMS).filter((id) => !UNIQUE_IDS.includes(id as ItemId)).length;
    expect(unlockedCount(defaultSave()).total).toBe(total);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('HUD: the corpse-piece counter', () => {
  for (const W of [480, 640, 800]) {
    it(`sits in the counters row between cells and the pause button (W=${W})`, () => {
      for (const flasks of [1, 3]) {
        const L = hudLayout(W, 360, flasks);
        expect(L.pieces.y).toBe(L.cells.y);
        expect(L.pieces.x).toBeGreaterThan(L.cells.x + 50);
        expect(L.pieces.x + 60).toBeLessThan(L.pause.x);
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
describe('누더기 골렘', () => {
  /** heroine + golem on a flat floor; `golem` stays near the heroine unless told otherwise */
  function arena(opts: { map?: TileMap; gx?: number; px?: number; loop?: number; tier?: number } = {}) {
    const t = setup(opts.map ?? flatMap(80, 18), opts.px ?? 400);
    t.run.loop = opts.loop ?? 1;
    const slot = newGolemState(t.run);
    const g = new Golem(opts.gx ?? 340, FLOOR, slot);
    t.world.spawn(g);
    steps(t.world, 3);
    return { ...t, g, slot };
  }

  it('is a player-team Actor: enemy attacks hit it, the heroine\'s do not', () => {
    const t = arena();
    expect(t.g).toBeInstanceOf(Actor);
    expect(t.g.team).toBe('player');
    expect(t.g.hp).toBe(GOLEM.hp);
    expect(t.g.w).toBe(GOLEM.w);
    expect(t.g.h).toBe(GOLEM.h);
  });

  it('follows the heroine and keeps a distance of 40..90 px', () => {
    const t = arena({ gx: 100, px: 500 });
    steps(t.world, 600);
    const d = Math.abs(t.p.x - t.g.x);
    expect(d).toBeLessThanOrEqual(GOLEM.follow.far + 4);
    expect(d).toBeGreaterThanOrEqual(GOLEM.follow.near - 4);
    t.p.x = 900;
    t.p.vx = 0;
    steps(t.world, 400);
    expect(Math.abs(t.p.x - t.g.x)).toBeLessThanOrEqual(GOLEM.follow.far + 6);
    expect(Math.abs(t.p.x - t.g.x)).toBeGreaterThanOrEqual(GOLEM.follow.near - 4);
    expect(t.g.x).toBeGreaterThan(700);
    // walks at 110 px/s
    t.p.x = t.g.x + 300;
    steps(t.world, 10);
    expect(t.g.vx).toBe(GOLEM.follow.speed);
  });

  it('backs off when she walks into it: it does not stand on top of her (the near edge of the 40..90 band)', () => {
    for (const [gx, px] of [[400, 400], [410, 400], [430, 400], [390, 400]]) {
      const t = arena({ gx, px });
      steps(t.world, 90);
      const d = Math.abs(t.p.x - t.g.x);
      expect(d, `golem ${gx} / heroine ${px}`).toBeGreaterThanOrEqual(GOLEM.follow.near - 3);
      expect(d, `golem ${gx} / heroine ${px}`).toBeLessThanOrEqual(GOLEM.follow.far);
    }
    // exactly on top of her it steps out behind her (the side she is not facing)
    const t = arena({ gx: 400, px: 400 });
    t.p.facing = 1;
    steps(t.world, 90);
    expect(t.g.x).toBeLessThan(t.p.x - GOLEM.follow.near + 3);
    // inside the band it stands still
    const u = arena({ gx: 340, px: 400 });
    steps(u.world, 5);
    const x = u.g.x;
    steps(u.world, 60);
    expect(Math.abs(u.g.x - x)).toBeLessThan(1);
  });

  it('never backs off over a ledge', () => {
    const m = flatMap(80, 18);
    for (let x = 41; x < 79; x++) { m.set(x, 16, T.Empty); m.set(x, 17, T.Empty); } // the floor ends at x = 984
    const t = arena({ map: m, gx: 962, px: 950 });
    steps(t.world, 120);
    expect(t.g.y).toBe(FLOOR);
    expect(t.g.x + GOLEM.w / 2).toBeLessThanOrEqual(984 + 1);
  });

  it('its slam does not break secret walls on its own, the heroine\'s attacks still do', () => {
    const t = arena({ gx: 340, px: 330 });
    const e = new Dummy(400, FLOOR);
    t.world.spawn(e);
    t.world.map.set(17, 15, T.Breakable); // x 408..432, inside the 72 x 56 slam box
    steps(t.world, 150);
    expect(e.log.length).toBeGreaterThanOrEqual(1); // it did slam
    expect(t.world.map.get(17, 15)).toBe(T.Breakable);
    // a player attack through the same function breaks it
    hitArea(t.world, { x: 400, y: FLOOR - 40, w: 40, h: 40 }, 'player', { amount: 1, dir: 1, kind: 'melee' });
    expect(t.world.map.get(17, 15)).not.toBe(T.Breakable);
  });

  it('does not wind up for a flyer hovering out of the slam\'s reach, but does for one it can hit', () => {
    const t = arena({ gx: 340, px: 330 });
    const high = new Dummy(400, FLOOR - GOLEM.aggro.y);
    high.physics = false;
    t.world.spawn(high);
    steps(t.world, 80);
    expect(t.g.target).toBeNull();
    expect(high.log).toHaveLength(0);
    const u = arena({ gx: 340, px: 330 });
    const low = new Dummy(400, FLOOR - 40);
    low.physics = false;
    u.world.spawn(low);
    steps(u.world, 80);
    expect(u.g.target).toBe(low);
    expect(low.log.length).toBeGreaterThanOrEqual(1);
  });

  it('draws its hp bar above its head (the sprite is taller than the hitbox), only after a hit', () => {
    const t = arena();
    (t.g as unknown as { drawSprite(): void }).drawSprite = () => {}; // (the sprite needs a real canvas; only the bar is looked at)
    const rects: number[][] = [];
    const ctx = new Proxy({}, {
      get: (_o, k) => (k === 'fillRect' ? (...a: number[]) => { rects.push(a); } : () => undefined),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    t.g.draw(ctx);
    expect(rects).toHaveLength(0);
    t.g.takeDamage({ amount: 90, dir: 1, kind: 'melee' });
    t.g.draw(ctx);
    expect(rects).toHaveLength(3);
    for (const r of rects) expect(r[1]).toBeLessThanOrEqual(t.g.y - GOLEM.barY + 1);
    expect(rects[1][2]).toBe(GOLEM.barW);
    expect(rects[2][2]).toBe(Math.round((GOLEM.barW * (GOLEM.hp - 90)) / GOLEM.hp));
    expect(GOLEM.barY).toBeGreaterThan(GOLEM.h + 20); // clear of the 64 px hitbox, above the ~96 px sprite
  });

  it('slams the nearest enemy: windup 0.45 s, then damage 26, knockback and stun 0.6 s, then cooldown 1.2 s', () => {
    const t = arena({ gx: 340, px: 300 });
    const e = new Dummy(400, FLOOR);
    const far = new Dummy(470, FLOOR);
    t.world.spawn(e);
    t.world.spawn(far);
    const log: { frame: number; info: DamageInfo }[] = [];
    let frame = 0;
    const orig = e.takeDamage.bind(e);
    e.takeDamage = (i: DamageInfo) => { log.push({ frame, info: i }); return orig(i); };
    for (; frame < 200; frame++) steps(t.world, 1);
    expect(log.length).toBeGreaterThanOrEqual(2);
    const hit = log[0].info;
    expect(hit.amount).toBe(GOLEM.damage);
    expect(hit.kind).toBe('melee');
    expect(hit.knockback).toBe(GOLEM.slam.knockback);
    expect(hit.stun).toBe(GOLEM.slam.stun);
    expect(hit.source).toBe(t.g);
    // the first slam lands after the windup (and the walk), the second one a cooldown later
    expect(log[0].frame / 60).toBeGreaterThanOrEqual(GOLEM.slam.windup);
    const gap = (log[1].frame - log[0].frame) / 60;
    expect(gap).toBeGreaterThanOrEqual(GOLEM.slam.cooldown - 0.05);
    expect(gap).toBeLessThan(GOLEM.slam.cooldown + 0.4);
    expect(t.g.target).toBe(e);
  });

  it('a slam hits everything in its 72 x 56 box once, and never the heroine or enemies out of reach', () => {
    const t = arena({ gx: 340, px: 330 });
    const a = new Dummy(392, FLOOR);
    const b = new Dummy(410, FLOOR);
    const out = new Dummy(520, FLOOR);
    for (const d of [a, b, out]) t.world.spawn(d);
    const php = t.p.hp;
    steps(t.world, 75);
    expect(a.log.length).toBe(1);
    expect(b.log.length).toBe(1);
    expect(out.log.length).toBe(0);
    expect(t.p.hp).toBe(php);
  });

  it('ignores enemies out of the aggro box (140 px across, 70 px up / down) or behind walls', () => {
    const t = arena({ gx: 340, px: 330 });
    const far = new Dummy(340 + GOLEM.aggro.x + 40, FLOOR);
    const high = new Dummy(400, FLOOR - GOLEM.aggro.y - 30);
    high.physics = false;
    t.world.spawn(far);
    t.world.spawn(high);
    steps(t.world, 40);
    expect(t.g.target).toBeNull();
    expect(far.log).toHaveLength(0);
    const m = flatMap(80, 18);
    for (let y = 8; y < 16; y++) m.set(16, y, T.Solid); // a wall between them (tile 16 = x 384..408)
    const w = arena({ map: m, gx: 340, px: 330 });
    const behind = new Dummy(430, FLOOR);
    w.world.spawn(behind);
    steps(w.world, 40);
    expect(w.g.target).toBeNull();
  });

  it('enemy attacks hurt it: hp falls, it is invulnerable for 0.35 s, barely knocked back, and the hp is stored in the run', () => {
    const t = arena();
    const hit = (n: number): DamageInfo => ({ amount: n, dir: 1, kind: 'melee', knockback: 400 });
    expect(t.g.takeDamage(hit(50)).applied).toBe(true);
    expect(t.g.hp).toBe(GOLEM.hp - 50);
    expect(t.g.takeDamage(hit(50)).applied).toBe(false); // i-frames
    steps(t.world, 1);
    expect(t.slot.hp).toBe(GOLEM.hp - 50);
    expect(Math.abs(t.g.vx)).toBeLessThan(400 * GOLEM.knockbackTaken + 1);
    steps(t.world, Math.ceil(GOLEM.invuln * 60) + 2);
    expect(t.g.takeDamage(hit(30)).applied).toBe(true);
    expect(t.g.hp).toBe(GOLEM.hp - 80);
    steps(t.world, 1);
    expect(t.slot.hp).toBe(GOLEM.hp - 80);
    expect(t.g.knockbackTaken).toBe(GOLEM.knockbackTaken);
  });

  it('real enemies attack it when it stands in their swing', () => {
    const t = arena({ gx: 460, px: 300 });
    t.p.invuln = 99;
    const e = createEnemy('ghoul', 500, FLOOR, { tier: 1, elite: false });
    t.world.spawn(e);
    // pin the enemy on the golem: it keeps hunting the heroine but its claws reach the golem too
    let hurt = false;
    for (let i = 0; i < 300 && !hurt; i++) {
      t.p.x = 380;
      steps(t.world, 1);
      hurt = t.g.hp < GOLEM.hp || e.dead || e.dying;
    }
    expect(hurt).toBe(true);
  });

  it('falls apart at 0 hp: death animation, toast, run.golem cleared, the pile fades after 3 s; the heroine is untouched', () => {
    const t = arena();
    const r = t.g.takeDamage({ amount: 9999, dir: 1, kind: 'melee' });
    expect(r.killed).toBe(true);
    expect(t.g.dying).toBe(true);
    expect(t.g.targetable).toBe(false);
    expect(t.run.golem).toBeNull();
    expect(t.events.find((e) => e.type === 'toast')?.text).toBe('골렘이 쓰러졌다');
    steps(t.world, 60 * GOLEM.pileFade);
    expect(t.g.dead).toBe(false);
    steps(t.world, 60);
    expect(t.g.dead).toBe(true);
    expect(t.p.hp).toBe(t.p.maxHp);
    // enemies cannot hit a dead golem
    const e = new Dummy(300, FLOOR);
    t.world.spawn(e);
    steps(t.world, 2);
    expect(t.world.actors.filter((a) => a instanceof Golem && a.targetable)).toHaveLength(0);
  });

  it('persists between levels: the next level\'s golem has the hp it had; every 쉼터 heals it fully', () => {
    const t = arena();
    t.g.takeDamage({ amount: 120, dir: 1, kind: 'melee' });
    steps(t.world, 2);
    expect(t.run.golem!.hp).toBe(GOLEM.hp - 120);
    // a new level (a fresh world sharing the run)
    const next = setup();
    (next.world as unknown as { run: RunState }).run = t.run;
    const g2 = spawnRunGolem(next.world, next.p, 'biome')!;
    steps(next.world, 2);
    expect(g2).toBeInstanceOf(Golem);
    expect(g2.hp).toBe(GOLEM.hp - 120);
    expect(Math.abs(g2.x - next.p.x)).toBeLessThan(60);
    // boss arena too
    expect(spawnRunGolem(next.world, next.p, 'boss')!.hp).toBe(GOLEM.hp - 120);
    // the rest stop heals
    const rest = setup();
    (rest.world as unknown as { run: RunState }).run = t.run;
    const g3 = spawnRunGolem(rest.world, rest.p, 'passage')!;
    steps(rest.world, 2);
    expect(g3.hp).toBe(GOLEM.hp);
    expect(t.run.golem!.hp).toBe(GOLEM.hp);
    // no golem, no spawn
    const none = setup();
    expect(spawnRunGolem(none.world, none.p, 'biome')).toBeNull();
  });

  it('a dead golem is not brought to the next level', () => {
    const t = arena();
    t.g.takeDamage({ amount: 9999, dir: 1, kind: 'melee' });
    const next = setup();
    (next.world as unknown as { run: RunState }).run = t.run;
    expect(spawnRunGolem(next.world, next.p, 'biome')).toBeNull();
  });

  it('leash: more than 360 px away, or off the map, brings it 40 px behind her', () => {
    const t = arena({ gx: 100, px: 700 });
    t.p.facing = 1;
    steps(t.world, 1);
    expect(Math.abs(t.g.x - (t.p.x - GOLEM.leash.behind))).toBeLessThanOrEqual(GOLEM.follow.speed / 60 + 1);
    expect(t.g.y).toBe(FLOOR);
    const u = arena({ gx: 600, px: 400 });
    u.g.y = u.world.map.pxH + 200;
    steps(u.world, 2);
    expect(u.g.y).toBeLessThanOrEqual(FLOOR);
    expect(Math.abs(u.g.x - u.p.x)).toBeLessThan(80);
  });

  it('leash: stuck behind a wall for 2.5 s without progress also brings it back', () => {
    const m = flatMap(80, 18);
    for (let y = 2; y < 16; y++) m.set(10, y, T.Solid); // a tall wall at x 240..264
    const t = arena({ map: m, gx: 150, px: 330 });
    t.p.x = 330;
    let at = -1;
    for (let i = 0; i < 60 * 6 && at < 0; i++) {
      steps(t.world, 1);
      if (t.g.x > 264) at = i;
    }
    expect(at).toBeGreaterThanOrEqual(Math.floor(GOLEM.leash.stuck * 60) - 5);
    expect(at).toBeLessThan(60 * 5);
  });

  it('jumps (420 px/s) over a low wall when the heroine is higher', () => {
    const m = flatMap(80, 18);
    for (let x = 10; x < 40; x++) m.set(x, 15, T.Solid); // the ground rises one tile at x = 240
    const t = arena({ map: m, gx: 190, px: 330 });
    t.p.y = FLOOR - 24; // she stands on the raised ground
    steps(t.world, 5);
    expect(t.p.y).toBe(FLOOR - 24);
    let jumped = false;
    for (let i = 0; i < 200; i++) {
      steps(t.world, 1);
      if (t.g.vy <= -GOLEM.follow.jump + 30) jumped = true;
    }
    expect(jumped).toBe(true);
    expect(t.g.y).toBe(FLOOR - 24); // it stands on the raised ground now, within reach of her
    // a wall of the same height with the heroine on the floor: it does not jump (she is not higher)
    const u = arena({ map: m, gx: 190, px: 190 });
    u.p.x = 190;
    let hops = 0;
    for (let i = 0; i < 90; i++) {
      steps(u.world, 1);
      if (u.g.vy < -100) hops++;
    }
    expect(hops).toBe(0);
  });

  it('drops through a one-way platform when the heroine is below, and stays on it when she is up there too', () => {
    const m = flatMap(80, 18);
    for (let x = 6; x < 20; x++) m.set(x, 12, T.Platform); // a platform 4 tiles above the floor
    const t = arena({ map: m, gx: 200, px: 200 });
    t.g.y = 12 * 24;
    t.g.vy = 0;
    steps(t.world, 90);
    expect(t.g.y).toBe(FLOOR);
    const u = arena({ map: m, gx: 200, px: 260 });
    u.p.y = 12 * 24;
    u.g.y = 12 * 24;
    u.p.vy = u.g.vy = 0;
    steps(u.world, 5);
    expect(u.p.y).toBe(12 * 24);
    steps(u.world, 60);
    expect(u.g.y).toBe(12 * 24);
  });

  it('is stunned by a stun hit: it stops moving and attacking', () => {
    const t = arena({ gx: 250, px: 500 });
    t.g.takeDamage({ amount: 1, dir: 1, kind: 'melee', stun: 1 });
    steps(t.world, 5);
    const x = t.g.x;
    steps(t.world, 30);
    expect(Math.abs(t.g.x - x)).toBeLessThan(2);
    steps(t.world, 60);
    expect(t.g.x).toBeGreaterThan(x + 20);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('run flow: the Game owns the save, the run and the scene changes', () => {
  /** a Game without its devices: only what startRun / playerDied / victory touch */
  function fakeGame() {
    const game = Object.create(Game.prototype) as Game & { made: (() => unknown)[]; persisted: number };
    const g = game as unknown as Record<string, unknown>;
    g.save = defaultSave();
    g.run = null;
    g.persisted = 0;
    g.made = [];
    g.audio = { play() {} };
    g.persist = () => { (game as unknown as { persisted: number }).persisted++; };
    g.goto = (make: () => unknown) => { (game as unknown as { made: (() => unknown)[] }).made.push(make); };
    return game;
  }
  const lastScene = (game: ReturnType<typeof fakeGame>) => game.made[game.made.length - 1]();

  it('a new run carries nothing: pieces 0, no golem, the save\'s loop', () => {
    const game = fakeGame();
    game.save.loop = 3;
    game.save.pieces = 22;
    game.startRun(11);
    expect(game.run!.pieces).toBe(0);
    expect(game.run!.golem).toBeNull();
    expect(game.run!.loop).toBe(3);
    expect([game.save.runs, game.save.pieces]).toEqual([1, 22]);
    game.startRun(12);
    expect(game.save.runs).toBe(2);
  });

  it('dying loses the carried pieces: the bank stays, nothing reaches the save, the next run starts empty', () => {
    const game = fakeGame();
    game.save.pieces = 41;
    game.startRun(1);
    game.run!.pieces = 17;
    game.run!.kills = 9;
    game.playerDied();
    expect(game.save.pieces).toBe(41);
    expect(game.save.totalKills).toBe(9);
    expect(lastScene(game)).toBeInstanceOf(DeathScene);
    game.startRun(2);
    expect(game.run!.pieces).toBe(0);
    expect(game.save.pieces).toBe(41);
  });

  it('winning banks the carried pieces, counts the win once, goes on to the next loop and keeps a bell shard', () => {
    const game = fakeGame();
    game.save.pieces = 30;
    game.startRun(1);
    game.run!.pieces = 25;
    game.run!.kills = 40;
    game.victory();
    expect(game.save.pieces).toBe(55);
    expect(game.run!.pieces).toBe(0);
    expect([game.save.wins, game.save.totalKills, game.save.loop, game.save.shards]).toEqual([1, 40, 2, [1]]);
    expect(game.persisted).toBeGreaterThan(0);
    expect(lastScene(game)).toBeInstanceOf(VictoryScene);
    // the next run is a loop-2 run, and winning that one tags its shard with loop 2
    game.startRun(2);
    expect(game.run!.loop).toBe(2);
    game.victory();
    expect([game.save.wins, game.save.loop, game.save.shards]).toEqual([2, 3, [1, 2]]);
  });
});
