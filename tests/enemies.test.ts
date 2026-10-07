import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/game/items/pickups', async (orig) => ({
  ...(await orig<typeof import('../src/game/items/pickups')>()),
  dropLoot: vi.fn(),
  spawnItemDrop: vi.fn(),
}));

import { makeTestWorld, steps, flatMap } from './helpers';
import { T } from '../src/game/tilemap';
import { Player } from '../src/game/player/player';
import { createEnemy, ENEMY_POOLS, FLYERS, type BaseKind, type EnemyKind } from '../src/game/enemies/factory';
import type { Enemy } from '../src/game/enemies/base';
import { Jailer } from '../src/game/enemies/jailer';
import { Archer } from '../src/game/enemies/archer';
import { Arrow, Bomb, isReflectable } from '../src/game/enemies/projectiles';
import { dropLoot } from '../src/game/items/pickups';
import type { TileMap } from '../src/game/tilemap';

const FLOOR = 16 * 24;
const KINDS: BaseKind[] = ['ghoul', 'jailer', 'archer', 'bomber', 'harpy', 'lancer'];

function setup(kind: EnemyKind, ex: number, px: number, opts: { tier?: number; elite?: boolean } = {}, map?: TileMap, ey = FLOOR) {
  const { world } = makeTestWorld(map);
  const p = new Player(px, FLOOR);
  world.player = p;
  world.spawn(p);
  const e = createEnemy(kind, ex, ey, { tier: opts.tier ?? 1, elite: opts.elite ?? false }) as Enemy;
  world.spawn(e);
  steps(world, 2);
  return { world, p, e };
}

describe('enemy factory', () => {
  it('keeps the ENEMY_POOLS / FLYERS export shapes and builds every kind', () => {
    expect(ENEMY_POOLS.prison.length).toBeGreaterThan(0);
    expect(ENEMY_POOLS.ramparts.some((e) => e.kind === 'lancer')).toBe(true);
    expect(FLYERS.prison).toContain('harpy');
    const hp = { ghoul: 40, jailer: 65, archer: 30, bomber: 35, harpy: 30, lancer: 70 };
    for (const k of KINDS) {
      const { e } = setup(k, 300, 100);
      expect(e.maxHp).toBe(hp[k]);
    }
  });

  it('scales hp/damage with tier and elite', () => {
    const t2 = setup('ghoul', 300, 100, { tier: 2 }).e;
    expect(t2.maxHp).toBe(64);
    const el = setup('ghoul', 300, 100, { elite: true }).e;
    expect(el.maxHp).toBe(120);
    // elites keep the stat boost and the aura but are not bigger (they are not mid-bosses)
    expect(el.scale).toBe(1);
    expect(el.w).toBe(18);
    expect(el.h).toBe(42);
  });
});

describe('noticing the player', () => {
  it.each(KINDS)('%s notices the player with line of sight and not without', (kind) => {
    // solid wall between them
    const map = flatMap();
    for (let y = 1; y < 16; y++) map.set(12, y, T.Solid);
    const a = setup(kind, 8 * 24, 16 * 24, {}, map);
    steps(a.world, 60);
    expect(a.e.state === 'patrol').toBe(true);
    // same layout without the wall
    const b = setup(kind, 8 * 24, 16 * 24);
    steps(b.world, 8);
    expect(['alert', 'chase', 'windup']).toContain(b.e.state);
  });

  it('does not notice beyond its aggro range', () => {
    const { world, e } = setup('ghoul', 100, 700);
    steps(world, 60);
    expect(e.state).toBe('patrol');
  });

  it('shows "!" and plays the telegraph sound when it notices', () => {
    const { world } = makeTestWorld();
    const p = new Player(330, FLOOR);
    world.player = p;
    world.spawn(p);
    const e = createEnemy('ghoul', 200, FLOOR, { tier: 1, elite: false }) as Enemy;
    world.spawn(e);
    const text = vi.spyOn(world.fx, 'text');
    const sfx = vi.spyOn(world.audio, 'play');
    steps(world, 6);
    expect(e.state).not.toBe('patrol');
    expect(text.mock.calls.some((c) => c[2] === '!')).toBe(true);
    expect(sfx.mock.calls.some((c) => c[0] === 'telegraph')).toBe(true);
  });
});

describe('attack timing', () => {
  it('ghoul only damages after at least the 0.55 s windup', () => {
    const { world, p, e } = setup('ghoul', 200, 236);
    let windupAt = -1;
    let hitAt = -1;
    const hp0 = p.hp;
    for (let i = 0; i < 240 && hitAt < 0; i++) {
      steps(world, 1);
      if (windupAt < 0 && e.state === 'windup') windupAt = i;
      if (p.hp < hp0) hitAt = i;
    }
    expect(windupAt).toBeGreaterThanOrEqual(0);
    expect(hitAt).toBeGreaterThan(windupAt);
    expect((hitAt - windupAt) / 60).toBeGreaterThanOrEqual(0.55 - 1 / 60);
    expect(hp0 - p.hp).toBe(9);
  });

  it('tier 2 hits 1.4× harder', () => {
    const { world, p } = setup('ghoul', 200, 236, { tier: 2 });
    const hp0 = p.hp;
    steps(world, 120);
    expect(hp0 - p.hp).toBe(13);
  });

  it('hit-stun interrupts the windup of a normal enemy', () => {
    const { world, p, e } = setup('ghoul', 200, 236);
    for (let i = 0; i < 120 && e.state !== 'windup'; i++) steps(world, 1);
    expect(e.state).toBe('windup');
    e.takeDamage({ amount: 3, dir: 1, kind: 'melee', source: p, knockback: 100 });
    expect(e.state).toBe('hurt');
    const hp0 = p.hp;
    steps(world, 40);
    expect(p.hp).toBe(hp0);
  });

  it('an elite is not interrupted while its attack is active', () => {
    const { world, p, e } = setup('ghoul', 200, 236, { elite: true });
    for (let i = 0; i < 200 && e.state !== 'active'; i++) steps(world, 1);
    expect(e.state).toBe('active');
    e.takeDamage({ amount: 3, dir: 1, kind: 'melee', source: p, knockback: 100 });
    expect(e.state).toBe('active');
  });

  it('dies with an animation, drops loot and emits enemyKilled once', () => {
    const { world, p, e } = setup('ghoul', 400, 100);
    const kills: boolean[] = [];
    world.on((ev) => ev.type === 'enemyKilled' && kills.push(ev.elite));
    (dropLoot as any).mockClear();
    e.takeDamage({ amount: 999, dir: 1, kind: 'melee', source: p });
    expect(e.dying).toBe(true);
    expect(e.dead).toBe(false);
    steps(world, 60);
    expect(e.dead).toBe(true);
    expect(kills).toEqual([false]);
    expect((dropLoot as any).mock.calls.length).toBe(1);
    const loot = (dropLoot as any).mock.calls[0][3];
    expect(loot.cells).toBeGreaterThanOrEqual(1);
    expect(loot.gold).toBeGreaterThanOrEqual(2);
  });

  it('elites drop four times the loot', () => {
    const { world, p, e } = setup('ghoul', 400, 100, { elite: true });
    (dropLoot as any).mockClear();
    e.takeDamage({ amount: 9999, dir: 1, kind: 'melee', source: p });
    steps(world, 2);
    const loot = (dropLoot as any).mock.calls[0][3];
    expect(loot.cells).toBeGreaterThanOrEqual(4);
    expect(loot.gold).toBeGreaterThanOrEqual(8);
  });
});

describe('patrol', () => {
  it('never walks off a ledge', () => {
    const map = flatMap(60, 18);
    for (let x = 20; x < 28; x++) map.set(x, 10, T.Solid); // floating island, top at y = 240
    const { world, e } = setup('ghoul', 24 * 24, 3 * 24, {}, map, 10 * 24);
    steps(world, 1500);
    expect(e.y).toBe(10 * 24);
    expect(e.x).toBeGreaterThan(20 * 24 - 4);
    expect(e.x).toBeLessThan(28 * 24 + 4);
    expect(e.state).toBe('patrol');
  });
});

describe('jailer', () => {
  it('blocks frontal hits and is hurt from behind', () => {
    const { world, p, e } = setup('jailer', 300, 100);
    const j = e as Jailer;
    j.facing = 1;
    const sfx = vi.spyOn(world.audio, 'play');
    const text = vi.spyOn(world.fx, 'text');
    const hp = j.hp;
    // attacker on the right pushes left (dir -1): the shield faces right
    const front = j.takeDamage({ amount: 12, dir: -1, kind: 'melee', source: p });
    expect(front.blocked).toBe(true);
    expect(front.applied).toBe(false);
    expect(j.hp).toBe(hp);
    expect(sfx.mock.calls.some((c) => c[0] === 'block')).toBe(true);
    expect(text.mock.calls.some((c) => c[2] === '막힘')).toBe(true);
    // from behind
    const back = j.takeDamage({ amount: 12, dir: 1, kind: 'melee', source: p });
    expect(back.applied).toBe(true);
    expect(j.hp).toBe(hp - 12);
    steps(world, 20);
    j.facing = 1;
    j.hitstun = 0;
    // unblockable (slam) and explosions go through the shield
    const slam = j.takeDamage({ amount: 10, dir: -1, kind: 'melee', unblockable: true });
    expect(slam.applied).toBe(true);
    const boom = j.takeDamage({ amount: 10, dir: -1, kind: 'explosion' });
    expect(boom.applied).toBe(true);
  });

  it('cannot block while swinging its mace', () => {
    const { world, p, e } = setup('jailer', 200, 240);
    for (let i = 0; i < 240 && e.state !== 'active'; i++) steps(world, 1);
    expect(e.state).toBe('active');
    const r = e.takeDamage({ amount: 5, dir: -1 * e.facing, kind: 'melee', source: p });
    expect(r.applied).toBe(true);
  });

  it('windup is 0.7 s', () => {
    const { world, p, e } = setup('jailer', 200, 240);
    const hp0 = p.hp;
    let w0 = -1;
    let hit = -1;
    for (let i = 0; i < 300 && hit < 0; i++) {
      steps(world, 1);
      if (w0 < 0 && e.state === 'windup') w0 = i;
      if (p.hp < hp0) hit = i;
    }
    expect(w0).toBeGreaterThan(-1);
    expect((hit - w0) / 60).toBeGreaterThanOrEqual(0.7 - 1 / 60);
  });
});

describe('archer', () => {
  it('shoots an arrow only after the 0.8 s aim, and the arrow can be reflected', () => {
    const { world, p, e } = setup('archer', 200, 400);
    let w0 = -1;
    let shot = -1;
    let arrow: Arrow | undefined;
    for (let i = 0; i < 300 && !arrow; i++) {
      steps(world, 1);
      if (w0 < 0 && e.state === 'windup') w0 = i;
      arrow = world.entities.find((x): x is Arrow => x instanceof Arrow);
      if (arrow) shot = i;
    }
    expect(arrow).toBeDefined();
    expect((shot - w0) / 60).toBeGreaterThanOrEqual(0.8 - 1 / 60);
    expect(arrow!.kind).toBe('ranged');
    expect(isReflectable(arrow)).toBe(true);
    const vx = arrow!.vx;
    arrow!.reflect(p);
    expect(arrow!.team).toBe('player');
    expect(Math.sign(arrow!.vx)).toBe(-Math.sign(vx));
    // reflected arrows hurt the archer
    const hp0 = e.hp;
    steps(world, 200);
    expect(e.hp).toBeLessThan(hp0);
  });

  it('an arrow hurts the player', () => {
    const { world, p } = setup('archer', 100, 400);
    const hp0 = p.hp;
    world.spawn(new Arrow(300, p.y - 20, 300, 0, 10, null));
    steps(world, 40);
    expect(p.hp).toBe(hp0 - 10);
  });

  it('backs away from a close player', () => {
    const { world, e } = setup('archer', 300, 260);
    steps(world, 90);
    expect(Math.abs(e.x - 260)).toBeGreaterThan(60);
    expect(e instanceof Archer).toBe(true);
  });
});

describe('bomber and bombs', () => {
  it('lobs a bomb that lands near the player after a windup', () => {
    const { world, p, e } = setup('bomber', 150, 400);
    let bomb: Bomb | undefined;
    let w0 = -1;
    let spawned = -1;
    for (let i = 0; i < 400 && !(bomb && bomb.landed); i++) {
      steps(world, 1);
      if (w0 < 0 && e.state === 'windup') w0 = i;
      if (!bomb) {
        bomb = world.entities.find((x): x is Bomb => x instanceof Bomb);
        if (bomb) spawned = i;
      }
    }
    expect(bomb).toBeDefined();
    expect((spawned - w0) / 60).toBeGreaterThanOrEqual(0.55 - 1 / 60);
    expect(bomb!.landed).toBe(true);
    expect(Math.abs(bomb!.x - p.x)).toBeLessThan(60);
  });

  it('explodes after a 0.8 s fuse with radius 44 (unblockable)', () => {
    const hurt = (dx: number): number => {
      const { world, p } = setup('ghoul', 900, 300 + dx);
      const hp0 = p.hp;
      const bomb = new Bomb(300, FLOOR, 0, 0, { damage: 14 });
      world.spawn(bomb);
      let t = 0;
      while (!bomb.dead && t < 200) {
        steps(world, 1);
        t++;
      }
      expect(t / 60).toBeGreaterThanOrEqual(0.78);
      expect(t / 60).toBeLessThan(1.0);
      return hp0 - p.hp;
    };
    expect(hurt(30)).toBe(14);
    expect(hurt(-40)).toBe(14);
    expect(hurt(60)).toBe(0);
    expect(hurt(-90)).toBe(0);
  });
});

describe('lancer', () => {
  it('charges when the player is level within 300 px: 0.7 s windup, ~330 px/s, stops at a wall, then recovers', () => {
    const map = flatMap(30, 18);
    const { world, p, e } = setup('lancer', 300, 520, {}, map);
    p.invuln = 99;
    let w0 = -1;
    let a0 = -1;
    let a1 = -1;
    let speed = 0;
    let recovered = false;
    for (let i = 0; i < 400; i++) {
      steps(world, 1);
      p.invuln = 99;
      if (w0 < 0 && e.state === 'windup') w0 = i;
      if (a0 < 0 && e.state === 'active') a0 = i;
      if (e.state === 'active') speed = Math.max(speed, Math.abs(e.vx));
      if (a0 >= 0 && a1 < 0 && e.state !== 'active') a1 = i;
      if (e.state === 'recover') recovered = true;
    }
    expect(w0).toBeGreaterThan(-1);
    expect((a0 - w0) / 60).toBeGreaterThanOrEqual(0.7 - 1 / 60);
    expect(speed).toBeGreaterThan(320);
    expect(speed).toBeLessThan(345);
    expect((a1 - a0) / 60).toBeLessThanOrEqual(1.25);
    expect(recovered).toBe(true);
  });

  it('damages the player it runs into', () => {
    const { world, p } = setup('lancer', 200, 380);
    const hp0 = p.hp;
    steps(world, 200);
    expect(p.hp).toBeLessThan(hp0);
  });

  it('does not charge at a player on another level', () => {
    const map = flatMap(60, 18);
    for (let x = 12; x < 22; x++) map.set(x, 11, T.Solid); // platform 5 tiles above the floor
    const { world, p, e } = setup('lancer', 200, 380, {}, map);
    p.y = 11 * 24;
    p.x = 17 * 24;
    let charged = false;
    for (let i = 0; i < 200; i++) {
      steps(world, 1);
      if (e.state === 'active') charged = true;
    }
    expect(charged).toBe(false);
  });
});

describe('harpy', () => {
  it('flies without gravity, then dives along a telegraphed line and recovers', () => {
    const { world, p, e } = setup('harpy', 300, 340, {}, undefined, FLOOR - 110);
    expect(e.gravityScale).toBe(0);
    const hp0 = p.hp;
    const seen = new Set<string>();
    let w0 = -1;
    let hit = -1;
    for (let i = 0; i < 600; i++) {
      steps(world, 1);
      seen.add(e.state);
      if (w0 < 0 && e.state === 'windup') w0 = i;
      if (hit < 0 && p.hp < hp0) hit = i;
      p.invuln = 0;
    }
    expect(seen.has('windup') && seen.has('active') && seen.has('recover')).toBe(true);
    expect(hit).toBeGreaterThan(w0);
    expect((hit - w0) / 60).toBeGreaterThanOrEqual(0.6 - 1 / 60);
    expect(e.y).toBeLessThan(FLOOR);
  });

  it('hovers (does not fall) while idle', () => {
    const { world, e } = setup('harpy', 300, 760, {}, undefined, FLOOR - 150);
    steps(world, 300);
    expect(Math.abs(e.y - (FLOOR - 150))).toBeLessThan(14);
  });
});
