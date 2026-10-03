import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/game/items/pickups', async (orig) => ({
  ...(await orig<typeof import('../src/game/items/pickups')>()),
  dropLoot: vi.fn(),
  spawnItemDrop: vi.fn(),
  spawnFood: vi.fn(),
}));

import { makeTestWorld, steps, flatMap } from './helpers';
import { Player } from '../src/game/player/player';
import { createBoss, Matron, MATRON, type AttackName } from '../src/game/boss/matron';
import { Shockwave, Debris } from '../src/game/boss/hazards';
import { dropLoot } from '../src/game/items/pickups';

const FLOOR = 16 * 24;

function setup(bossX = 600, playerX = 400, map = flatMap(60, 18)) {
  const { world } = makeTestWorld(map);
  const p = new Player(playerX, FLOOR);
  world.player = p;
  world.spawn(p);
  const boss = createBoss(bossX, FLOOR) as Matron;
  world.spawn(boss);
  const events: string[] = [];
  world.on((e) => {
    if (e.type === 'bossStart' || e.type === 'bossDefeated') events.push(e.type);
  });
  steps(world, 2);
  /** damage the player took: frame index (steps run so far) and amount */
  const log: { frame: number; amount: number }[] = [];
  let frame = 0;
  /** step with the player kept alive, logging every point of damage */
  const run = (n: number, each?: (i: number) => void) => {
    for (let i = 0; i < n; i++) {
      p.hp = p.maxHp;
      each?.(i);
      steps(world, 1);
      frame++;
      if (p.hp < p.maxHp) log.push({ frame, amount: p.maxHp - p.hp });
    }
  };
  const total = () => log.reduce((a, l) => a + l.amount, 0);
  return { world, p, boss, events, run, log, total, now: () => frame };
}

/** Wake her (a hit does that), run through the intro and keep her from starting attacks on her own. */
function skipIntro(t: ReturnType<typeof setup>) {
  if (t.boss.state === 'dormant') t.boss.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: t.p });
  for (let i = 0; i < 400 && t.boss.state !== 'idle'; i++) t.run(1);
  expect(t.boss.state).toBe('idle');
  hold(t.boss);
}

/** Postpone her next self-chosen attack. */
function hold(boss: Matron) {
  (boss as any).gapT = 999;
}

describe('Iron Matron: activation and intro', () => {
  it('stays dormant until the player is within ~300 px, then emits bossStart exactly once', () => {
    const t = setup(1100, 100);
    t.run(120);
    expect(t.boss.state).toBe('dormant');
    expect(t.events).toEqual([]);
    t.p.x = 900;
    t.run(60);
    expect(t.boss.state).toBe('intro');
    t.run(900);
    expect(t.events.filter((e) => e === 'bossStart')).toHaveLength(1);
    expect(t.world.camera.override).toBeNull();
  });

  it('pans the camera to her, roars (sfx + shake) and cannot be hurt during the intro', () => {
    const t = setup(600, 400);
    const sfx = vi.spyOn(t.world.audio, 'play');
    const shake = vi.spyOn(t.world, 'shake');
    t.run(20);
    expect(t.world.camera.override).not.toBeNull();
    const hp = t.boss.hp;
    const r = t.boss.takeDamage({ amount: 100, dir: 1, kind: 'melee', source: t.p });
    expect(r.applied).toBe(false);
    expect(t.boss.hp).toBe(hp);
    t.run(80);
    expect(sfx.mock.calls.some((c) => c[0] === 'boss_roar')).toBe(true);
    expect(shake).toHaveBeenCalled();
    skipIntro(t);
    expect(t.boss.takeDamage({ amount: 100, dir: 1, kind: 'melee', source: t.p }).applied).toBe(true);
    expect(t.boss.hp).toBe(hp - 100);
  });

  it('has 2200 hp, is immovable and a hit before activation wakes her', () => {
    const t = setup(1100, 100);
    expect(t.boss.maxHp).toBe(2200);
    expect(t.boss.knockbackTaken).toBe(0);
    t.boss.takeDamage({ amount: 10, dir: 1, kind: 'ranged', source: t.p });
    expect(t.boss.state).toBe('intro');
    expect(t.boss.hp).toBe(2200);
  });
});

describe('Iron Matron: attacks', () => {
  it('never repeats the same attack three times in a row and uses several attacks', () => {
    const t = setup(700, 450);
    const seq: string[] = [];
    const orig = t.boss.startAttack.bind(t.boss);
    t.boss.startAttack = (a: AttackName, p?: Player) => {
      seq.push(a);
      orig(a, p);
    };
    t.run(60 * 70);
    expect(seq.length).toBeGreaterThan(8);
    for (let i = 2; i < seq.length; i++) expect(!(seq[i] === seq[i - 1] && seq[i] === seq[i - 2])).toBe(true);
    expect(new Set(seq).size).toBeGreaterThanOrEqual(3);
  });

  it('slam: windup ≥ 0.9 s before any damage, then an AoE and floor shockwaves both ways', () => {
    const t = setup(700, 780);
    skipIntro(t);
    t.boss.facing = 1;
    const f0 = t.now();
    t.boss.startAttack('slam', t.p);
    let maxWaves = 0;
    for (let i = 0; i < 200; i++) {
      t.run(1);
      maxWaves = Math.max(maxWaves, t.world.entities.filter((e) => e instanceof Shockwave).length);
    }
    expect(t.log.length).toBeGreaterThan(0);
    expect((t.log[0].frame - f0) / 60).toBeGreaterThanOrEqual(MATRON.slam.w - 2 / 60);
    expect(t.log[0].amount).toBeGreaterThanOrEqual(MATRON.slam.dmg);
    expect(maxWaves).toBe(2);
  });

  it('shockwaves hurt a player on the floor but pass under a jumping one', () => {
    const run = (airborne: boolean): number => {
      const t = setup(300, 40);
      skipIntro(t);
      t.boss.facing = 1;
      t.p.x = 700;
      t.p.invuln = 0;
      t.boss.startAttack('slam', t.p);
      t.boss.facing = 1;
      t.run(60 * 3, () => {
        if (airborne) {
          t.p.y = FLOOR - 70;
          t.p.vy = 0;
        }
      });
      return t.total();
    };
    expect(run(false)).toBeGreaterThanOrEqual(MATRON.wave.dmg);
    expect(run(true)).toBe(0);
  });

  it('sweep has ~120 px reach and a 0.7 s windup', () => {
    const t = setup(700, 780);
    skipIntro(t);
    const f0 = t.now();
    t.boss.startAttack('sweep', t.p);
    t.run(120);
    expect(t.log.length).toBeGreaterThan(0);
    expect((t.log[0].frame - f0) / 60).toBeGreaterThanOrEqual(MATRON.sweep.w - 2 / 60);
    // far outside the reach: no damage
    const t2 = setup(700, 900);
    skipIntro(t2);
    t2.p.x = 700 + 190;
    t2.boss.startAttack('sweep', t2.p);
    t2.run(120);
    expect(t2.total()).toBe(0);
  });

  it('charge: windup 0.8 s, runs into the wall and is stunned for 2 s (vulnerable)', () => {
    const t = setup(400, 200);
    skipIntro(t);
    t.p.x = 200;
    t.boss.startAttack('charge', t.p);
    expect(t.boss.facing).toBe(-1);
    let active = -1;
    let crashed = -1;
    for (let i = 0; i < 400 && crashed < 0; i++) {
      t.run(1, () => {
        t.p.invuln = 99;
        t.p.x = 200;
      });
      if (active < 0 && t.boss.sub === 1) active = i;
      if (t.boss.sub === 3) crashed = i;
    }
    expect(active / 60).toBeGreaterThanOrEqual(MATRON.charge.w - 2 / 60);
    expect(crashed).toBeGreaterThan(active);
    expect(t.boss.x).toBeLessThan(24 + 28 + 4);
    // stunned: stays down ~2 s then recovers
    t.run(60);
    expect(t.boss.sub).toBe(3);
    const hp = t.boss.hp;
    expect(t.boss.takeDamage({ amount: 50, dir: 1, kind: 'melee', source: t.p }).applied).toBe(true);
    expect(t.boss.hp).toBe(hp - 50);
    t.run(80);
    expect(t.boss.state).toBe('idle');
  });

  it('charge hurts a player standing in the path', () => {
    const t = setup(600, 300);
    skipIntro(t);
    t.p.x = 300;
    t.boss.startAttack('charge', t.p);
    t.run(200, () => {
      t.p.x = 300;
    });
    expect(t.total()).toBeGreaterThanOrEqual(MATRON.charge.dmg);
  });

  it('leap: rises, hangs above the player with a landing marker, then lands with an AoE', () => {
    const t = setup(700, 500);
    skipIntro(t);
    t.p.x = 500;
    t.boss.startAttack('leap', t.p);
    const subs = new Set<number>();
    let minY = FLOOR;
    for (let i = 0; i < 400 && !(t.boss.state === 'idle'); i++) {
      t.run(1);
      subs.add(t.boss.sub);
      minY = Math.min(minY, t.boss.y);
    }
    const dmg = t.total();
    expect([...subs].sort()).toEqual([0, 1, 2, 3]);
    expect(minY).toBeLessThan(FLOOR - 150);
    expect(Math.abs(t.boss.x - 500)).toBeLessThan(70);
    expect(t.boss.y).toBe(FLOOR);
    expect(dmg).toBe(MATRON.leap.dmg);
  });

  it('keeps hits in the 18–30 range', () => {
    expect(MATRON.slam.dmg).toBeLessThanOrEqual(30);
    expect(MATRON.wave.dmg).toBeGreaterThanOrEqual(18);
    expect(MATRON.leap.dmg).toBeLessThanOrEqual(30);
    expect(MATRON.charge.dmg).toBeLessThanOrEqual(30);
    expect(MATRON.sweep.dmg).toBeGreaterThanOrEqual(18);
  });
});

describe('Iron Matron: phase 2 and death', () => {
  it('enters phase 2 at 50 % hp: roars invulnerable, windups ×0.8, debris falls', () => {
    const t = setup(700, 400);
    skipIntro(t);
    // phase 1 slam windup
    const measure = (): number => {
      hold(t.boss);
      t.boss.startAttack('slam', t.p);
      let n = 0;
      while (t.boss.sub === 0 && n < 200) {
        t.run(1);
        n++;
      }
      return n;
    };
    const w1 = measure();
    while (t.boss.state !== 'idle') t.run(1);
    hold(t.boss);
    expect(t.boss.phase).toBe(1);
    t.boss.takeDamage({ amount: 1099, dir: 1, kind: 'melee', source: t.p });
    expect(t.boss.phase).toBe(1);
    t.boss.takeDamage({ amount: 1, dir: 1, kind: 'melee', source: t.p });
    t.run(2);
    expect(t.boss.phase).toBe(2);
    expect(t.boss.state).toBe('roar');
    const hp = t.boss.hp;
    expect(t.boss.takeDamage({ amount: 100, dir: 1, kind: 'melee', source: t.p }).applied).toBe(false);
    expect(t.boss.hp).toBe(hp);
    t.run(30);
    expect(t.world.entities.some((e) => e instanceof Debris)).toBe(true);
    t.run(200);
    expect(t.boss.state).not.toBe('roar');
    // wait for whatever she does next to end, then measure again
    hold(t.boss);
    for (let i = 0; i < 900 && t.boss.state !== 'idle'; i++) t.run(1);
    expect(t.boss.state).toBe('idle');
    const w2 = measure();
    expect(w2 / w1).toBeLessThan(0.9);
    expect(w2 / w1).toBeGreaterThan(0.7);
    // she can be hurt again
    for (let i = 0; i < 900 && t.boss.state === 'roar'; i++) t.run(1);
    expect(t.boss.takeDamage({ amount: 10, dir: 1, kind: 'melee', source: t.p }).applied).toBe(true);
  });

  it('debris falls at its marked spot and hurts there', () => {
    const t = setup(900, 300);
    skipIntro(t);
    const d = new Debris(300, FLOOR, 60, 0.3, MATRON.debris.dmg, t.boss);
    t.world.spawn(d);
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++) {
      t.run(1, () => {
        t.p.x = 300;
      });
      landed = d.dead;
    }
    expect(landed).toBe(true);
    expect(t.total()).toBeGreaterThanOrEqual(MATRON.debris.dmg);
  });

  it('dies: emits bossDefeated exactly once, drops lots of loot, then disappears', () => {
    const t = setup(700, 400);
    skipIntro(t);
    (dropLoot as any).mockClear();
    t.boss.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: t.p });
    expect(t.boss.dying).toBe(true);
    expect(t.events.filter((e) => e === 'bossDefeated')).toHaveLength(0);
    t.run(60 * 4);
    expect(t.events.filter((e) => e === 'bossDefeated')).toHaveLength(1);
    expect(t.boss.dead).toBe(true);
    t.run(120);
    expect(t.events.filter((e) => e === 'bossDefeated')).toHaveLength(1);
    expect(t.events.filter((e) => e === 'bossStart')).toHaveLength(1);
    const loot = (dropLoot as any).mock.calls[0][3];
    expect(loot.cells).toBeGreaterThanOrEqual(20);
    expect(loot.gold).toBeGreaterThanOrEqual(80);
  });

  it('can be killed from phase 1 directly, and a boss created from the factory is a Matron', () => {
    const t = setup(700, 400);
    expect(t.boss instanceof Matron).toBe(true);
    skipIntro(t);
    t.boss.takeDamage({ amount: 2200, dir: 1, kind: 'melee', source: t.p });
    t.run(60 * 4);
    expect(t.events.filter((e) => e === 'bossDefeated')).toHaveLength(1);
  });
});
