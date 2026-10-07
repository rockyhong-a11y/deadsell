import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/game/items/pickups', async (orig) => ({
  ...(await orig<typeof import('../src/game/items/pickups')>()),
  dropLoot: vi.fn(),
  spawnItemDrop: vi.fn(),
  spawnFood: vi.fn(),
}));

import { makeTestWorld, steps, flatMap } from './helpers';
import { SpriteSheet, type AnimDef } from '../src/engine/assets';
import { World } from '../src/game/world';
import { Player } from '../src/game/player/player';
import { Actor } from '../src/game/entity';
import { TILE } from '../src/engine/config';
import { dropLoot, spawnItemDrop } from '../src/game/items/pickups';
import { ITEMS, rollItem } from '../src/game/items/items';
import { Rng } from '../src/engine/rng';
import { createMiniBoss, pickMiniBoss, isMiniBoss, MINIBOSS_IDS, MINIBOSS_POOLS, MiniBoss, MB, ABBESS, ARACHNE, VALKYRIE, WITCH, type MiniBossId } from '../src/game/miniboss';
import { WebRoot, MoonShard, MoonOrb, SwordBeam } from '../src/game/miniboss/hazards';
import { generateBiome } from '../src/game/level/generator';
import { populateLevel } from '../src/game/level/build';
import { LevelUI } from '../src/game/ui/levelUI';
import { hudLayout } from '../src/game/ui/hud';
import { TapRegistry } from '../src/game/ui/taps';
import { installDebug } from '../src/game/debug';

const FLOOR = 16 * 24;
const BOSS_X = 700;

const NAMES: Record<MiniBossId, string> = {
  mb_abbess: '처형인 수녀원장',
  mb_arachne: '거미 여왕',
  mb_valkyrie: '발키리 기사단장',
  mb_witch: '달의 마녀',
};
const HP: Record<MiniBossId, number> = { mb_abbess: 650, mb_arachne: 820, mb_valkyrie: 900, mb_witch: 900 };

/** One probe per attack: where the player stands (dx in front of the boss) so that attack can reach it. */
const PROBES: Record<MiniBossId, { attack: string; dx: number; damages: boolean }[]> = {
  mb_abbess: [
    { attack: 'cleave', dx: 60, damages: true },
    { attack: 'spin', dx: 220, damages: true },
    { attack: 'summon', dx: 200, damages: false },
  ],
  mb_arachne: [
    { attack: 'bite', dx: 60, damages: true },
    { attack: 'web', dx: 320, damages: true },
    { attack: 'leap', dx: 260, damages: true },
  ],
  mb_valkyrie: [
    { attack: 'slash', dx: 60, damages: true },
    { attack: 'dive', dx: 300, damages: true },
    { attack: 'wave', dx: 300, damages: true },
  ],
  mb_witch: [
    { attack: 'orb', dx: 300, damages: true },
    { attack: 'shards', dx: 300, damages: true },
    { attack: 'blink', dx: 200, damages: false },
  ],
};

/** Like the loader's placeholder: one frame per animation, no windup / active / recover split. */
function bareSheet(name: string): SpriteSheet {
  const anims = new Proxy({} as Record<string, AnimDef>, { get: () => ({ row: 0, frames: 1, fps: 1, loop: true }), has: () => true });
  return new SpriteSheet(name, { width: 224, height: 176 } as any, { image: '', frameW: 224, frameH: 176, anchor: [112, 164], animations: anims }, true);
}

function setup(id: MiniBossId, bossX = BOSS_X, playerX = 100, tier = 1, bare = false) {
  const { world, run, game } = makeTestWorld(flatMap(60, 18));
  if (bare) game.assets.sheet = (n: string) => bareSheet(n);
  const p = new Player(playerX, FLOOR);
  world.player = p;
  world.spawn(p);
  const boss = createMiniBoss(id, bossX, FLOOR, tier);
  world.spawn(boss);
  const events: { type: string; name?: string }[] = [];
  world.on((e) => {
    if (e.type === 'minibossStart') events.push({ type: e.type, name: e.name });
    else if (e.type === 'minibossDefeated') events.push({ type: e.type });
  });
  steps(world, 2);
  /** damage the player took: frame index (steps run so far) and amount */
  const log: { frame: number; amount: number }[] = [];
  let frame = 0;
  /** step with the player kept alive, logging every point of damage */
  const runFor = (n: number, each?: (i: number) => void) => {
    for (let i = 0; i < n; i++) {
      p.hp = p.maxHp;
      each?.(i);
      steps(world, 1);
      frame++;
      if (p.hp < p.maxHp) log.push({ frame, amount: p.maxHp - p.hp });
    }
  };
  const count = (type: string) => events.filter((e) => e.type === type).length;
  return { world, run, p, boss, events, log, runFor, count, now: () => frame };
}
type T = ReturnType<typeof setup>;

/** Postpone the boss's next self-chosen attack. */
const hold = (boss: MiniBoss) => {
  (boss as any).gapT = 999;
};

/** Wake it (a hit does that), run through the intro, and keep it from attacking on its own. */
function skipIntro(t: T) {
  if (t.boss.state === 'dormant') t.boss.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: t.p });
  for (let i = 0; i < 400 && t.boss.state !== 'idle'; i++) t.runFor(1);
  expect(t.boss.state).toBe('idle');
  hold(t.boss);
}

/** Stand the player `dx` in front of the boss (the side it faces) and pin him there. */
function place(t: T, dx: number): (i: number) => void {
  const x = t.boss.x + dx;
  t.p.x = x;
  t.p.y = FLOOR;
  t.p.vx = t.p.vy = 0;
  return () => {
    t.p.invuln = 0;
    // damage over time (bleed from the bite) is not what these tests look at
    t.p.status.bleed = 0;
    t.p.status.burn = 0;
    if (t.p.state !== 'hurt') t.p.x = x;
  };
}

beforeEach(() => {
  vi.mocked(dropLoot).mockClear();
  vi.mocked(spawnItemDrop).mockClear();
});

describe('mid-boss factory', () => {
  it('creates all four bosses with the contract ids, Korean names, hp and no knockback', () => {
    expect(MINIBOSS_IDS).toEqual(['mb_abbess', 'mb_arachne', 'mb_valkyrie', 'mb_witch']);
    for (const id of MINIBOSS_IDS) {
      const b = createMiniBoss(id, 400, FLOOR);
      expect(b).toBeInstanceOf(MiniBoss);
      expect(isMiniBoss(b)).toBe(true);
      expect(b.bossId).toBe(id);
      expect(b.spec.name).toBe(NAMES[id]);
      expect(b.maxHp).toBe(HP[id]);
      expect(b.knockbackTaken).toBe(0);
      expect(b.state).toBe('dormant');
      // tier 2 (ramparts) scales like every other enemy: hp x1.6, damage x1.4
      const b2 = createMiniBoss(id, 400, FLOOR, 2);
      expect(b2.maxHp).toBe(Math.round(HP[id] * 1.6));
      expect(b2.dmgMult).toBeCloseTo(1.4);
      expect(b.attackNames.length).toBeGreaterThanOrEqual(3);
    }
    expect(isMiniBoss(new Player(0, 0))).toBe(false);
    expect(isMiniBoss(null)).toBe(false);
  });

  it('prison bosses 650 / 820 hp (abbess / spider queen), ramparts bosses ~900 hp before tier scaling', () => {
    expect(HP.mb_abbess).toBe(650);
    expect(HP.mb_arachne).toBe(820);
    expect(HP.mb_valkyrie).toBe(900);
    expect(HP.mb_witch).toBe(900);
  });

  it('pickMiniBoss: a pure function of (biome, seed) choosing within the biome pair, both of them appear', () => {
    for (const biome of ['prison', 'ramparts'] as const) {
      const pool = MINIBOSS_POOLS[biome]!;
      expect(pool).toHaveLength(2);
      const seen = new Set<string>();
      for (let s = 1; s <= 60; s++) {
        const a = pickMiniBoss(biome, s * 977);
        expect(a).toBe(pickMiniBoss(biome, s * 977));
        expect(pool).toContain(a);
        seen.add(a!);
      }
      expect(seen.size, biome).toBe(2);
    }
    expect(pickMiniBoss('tower', 5)).toBeNull();
  });
});

describe.each(MINIBOSS_IDS)('%s: activation', (id) => {
  it('stays dormant while the player is far, then engages and emits minibossStart exactly once', () => {
    const t = setup(id, 1000, 100);
    const x0 = t.boss.x;
    t.runFor(120);
    expect(t.boss.state).toBe('dormant');
    expect(t.count('minibossStart')).toBe(0);
    expect(t.boss.x).toBeCloseTo(x0, 3);
    // walk into range
    t.p.x = t.boss.x - (t.boss.spec.activateRange - 40);
    t.runFor(5);
    expect(t.boss.state).toBe('intro');
    t.runFor(600);
    expect(t.count('minibossStart')).toBe(1);
    expect(t.events.find((e) => e.type === 'minibossStart')!.name).toBe(NAMES[id]);
    expect(t.boss.state).not.toBe('dormant');
    expect(t.count('minibossDefeated')).toBe(0);
  });

  it('a hit wakes it (without hurting it); it cannot be hurt during the intro, then it can', () => {
    const t = setup(id, 1000, 100);
    expect(t.boss.takeDamage({ amount: 40, dir: 1, kind: 'ranged', source: t.p }).applied).toBe(false);
    expect(t.boss.state).toBe('intro');
    expect(t.boss.hp).toBe(t.boss.maxHp);
    expect(t.count('minibossStart')).toBe(1);
    expect(t.boss.takeDamage({ amount: 40, dir: 1, kind: 'melee', source: t.p }).applied).toBe(false);
    skipIntro(t);
    const hp = t.boss.hp;
    expect(t.boss.takeDamage({ amount: 40, dir: 1, kind: 'melee', source: t.p }).applied).toBe(true);
    expect(t.boss.hp).toBe(hp - 40);
    expect(t.count('minibossStart')).toBe(1);
  });

  it('has no knockback and no hit-stun', () => {
    const t = setup(id, 1000, 700);
    skipIntro(t);
    const vx = t.boss.vx;
    t.boss.takeDamage({ amount: 5, dir: 1, kind: 'melee', knockback: 600, knockup: 400, hitstun: 1, source: t.p });
    expect(t.boss.vx).toBe(vx);
    expect(t.boss.vy).toBe(0);
    t.runFor(2);
    expect(t.boss.hitstun).toBe(0);
    expect(t.boss.state).toBe('idle');
  });
});

describe.each(MINIBOSS_IDS)('%s: attacks are telegraphed', (id) => {
  for (const probe of PROBES[id]) {
    it(`${probe.attack}: wind-up pose before anything happens${probe.damages ? ', damage only after it' : ''}`, () => {
      const t = setup(id, BOSS_X, BOSS_X + probe.dx);
      skipIntro(t);
      const pin = place(t, probe.dx);
      t.boss.facing = 1;
      const w = t.boss.windupOf(probe.attack);
      // the quickest warning of any mid-boss attack is the spider queen's bite (0.42 s)
      expect(w).toBeGreaterThanOrEqual(0.4);
      const f0 = t.now();
      const bx0 = t.boss.x;
      const ghouls = () => t.world.entities.filter((e) => (e as any).kind === 'ghoul').length;
      t.boss.startAttack(probe.attack, t.p);
      expect(t.boss.state).toBe('windup');
      expect(t.boss.telegraphing).toBe(true);
      const windFrames = Math.round(w * 60) - 2;
      // during the whole windup: telegraphing, no damage, no effect
      for (let i = 0; i < windFrames; i++) {
        t.runFor(1, pin);
        expect(t.boss.state, `frame ${i}`).toBe('windup');
        expect(t.boss.telegraphing).toBe(true);
        expect(ghouls(), `frame ${i}`).toBe(0);
        if (probe.attack === 'blink') expect(Math.abs(t.boss.x - bx0)).toBeLessThan(12);
      }
      expect(t.log).toHaveLength(0);
      // let it play out (damaging attacks: up to 7 s; the others: until the boss is idle again)
      if (probe.damages) {
        t.runFor(60 * 7, pin);
        expect(t.log.length, 'it deals damage').toBeGreaterThan(0);
        expect((t.log[0].frame - f0) / 60).toBeGreaterThanOrEqual(w - 2 / 60);
      } else {
        for (let i = 0; i < 60 * 5 && t.boss.attack; i++) t.runFor(1, pin);
        expect(t.boss.attack).toBeNull();
        // the bell itself does not hurt (the ghouls it rings up do, later)
        if (probe.attack !== 'summon') expect(t.log).toHaveLength(0);
      }
      if (probe.attack === 'summon') expect(ghouls()).toBe(ABBESS.summon.count);
      if (probe.attack === 'blink') expect(Math.abs(t.boss.x - bx0)).toBeGreaterThan(WITCH.blink.minMove - 1);
      expect(t.boss.state).not.toBe('dormant');
    });
  }

  it('a parry / stun cancels the attack in progress (nothing hurts afterwards) and it recovers', () => {
    const probe = PROBES[id][0];
    const t = setup(id, BOSS_X, BOSS_X + probe.dx);
    skipIntro(t);
    const pin = place(t, probe.dx);
    t.boss.facing = 1;
    t.boss.startAttack(probe.attack, t.p);
    t.runFor(10, pin);
    t.boss.takeDamage({ amount: 1, dir: 1, kind: 'melee', stun: 1, source: t.p });
    t.runFor(2, pin);
    expect(t.boss.state).toBe('stunned');
    expect(t.boss.attack).toBeNull();
    for (let i = 0; i < 60 * 3 && t.boss.state === 'stunned'; i++) t.runFor(1, pin);
    expect(t.log).toHaveLength(0);
    expect(t.boss.state).toBe('idle');
  });
});

describe('attack details', () => {
  it('abbess: cleave is a 0.85 s chop; the spin dash and the bell are separate attacks', () => {
    expect(ABBESS.cleave.w).toBeGreaterThanOrEqual(0.8);
    const t = setup('mb_abbess', BOSS_X, BOSS_X + 60);
    expect(t.boss.attackNames).toEqual(['cleave', 'spin', 'summon']);
  });

  it('arachne: the web blob roots the player for 1.2 s', () => {
    const t = setup('mb_arachne', BOSS_X, BOSS_X + 320);
    skipIntro(t);
    const pin = place(t, 320);
    t.boss.facing = 1;
    t.boss.startAttack('web', t.p);
    let rooted = false;
    t.runFor(60 * 3, (i) => {
      pin(i);
      if (t.world.entities.some((e) => e instanceof WebRoot && !e.dead)) rooted = true;
    });
    expect(rooted).toBe(true);
    expect(ARACHNE.web.root).toBeCloseTo(1.2);
  });

  it('valkyrie: slash is a 2-hit combo (second swing after its own wind-up)', () => {
    const t = setup('mb_valkyrie', BOSS_X, BOSS_X + 60);
    skipIntro(t);
    const pin = place(t, 60);
    t.boss.facing = 1;
    const f0 = t.now();
    t.boss.startAttack('slash', t.p);
    t.runFor(60 * 3, pin);
    expect(t.log.length).toBeGreaterThanOrEqual(2);
    const first = (t.log[0].frame - f0) / 60;
    const second = (t.log[1].frame - f0) / 60;
    expect(first).toBeGreaterThanOrEqual(VALKYRIE.slash.w1 - 2 / 60);
    expect(second - first).toBeGreaterThanOrEqual(VALKYRIE.slash.w2 - 3 / 60);
  });

  it('valkyrie: the sword beam travels along the floor and can be jumped', () => {
    const run = (airborne: boolean): number => {
      const t = setup('mb_valkyrie', BOSS_X, BOSS_X + 300);
      skipIntro(t);
      const pin = place(t, 300);
      t.boss.facing = 1;
      t.boss.startAttack('wave', t.p);
      let beam = 0;
      t.runFor(60 * 4, (i) => {
        pin(i);
        if (airborne) {
          t.p.y = FLOOR - 90;
          t.p.vy = 0;
        }
        beam = Math.max(beam, t.world.entities.filter((e) => e instanceof SwordBeam).length);
      });
      expect(beam).toBe(1);
      return t.log.reduce((a, l) => a + l.amount, 0);
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
  });

  it('witch: orb launches 3 homing orbs; shards fall at marked spots, the first on the player', () => {
    const t = setup('mb_witch', BOSS_X, BOSS_X + 300);
    skipIntro(t);
    const pin = place(t, 300);
    t.boss.facing = 1;
    t.boss.startAttack('orb', t.p);
    let orbs = 0;
    t.runFor(60 * 2, (i) => {
      pin(i);
      orbs = Math.max(orbs, t.world.entities.filter((e) => e instanceof MoonOrb).length);
    });
    expect(orbs).toBe(WITCH.orb.count);
    const t2 = setup('mb_witch', BOSS_X, BOSS_X + 300);
    skipIntro(t2);
    const pin2 = place(t2, 300);
    t2.boss.facing = 1;
    t2.boss.startAttack('shards', t2.p);
    t2.runFor(2, pin2);
    const shards = t2.world.entities.filter((e): e is MoonShard => e instanceof MoonShard);
    expect(shards.length).toBeGreaterThanOrEqual(WITCH.shards.count);
    expect(shards.some((s) => Math.abs(s.x - t2.p.x) < 4)).toBe(true);
  });
});

describe.each(MINIBOSS_IDS)('%s: AI loop', (id) => {
  it('never repeats the same attack three times in a row and uses at least two different ones', () => {
    const t = setup(id, BOSS_X, BOSS_X - 220);
    t.boss.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: t.p });
    const seq: string[] = [];
    const orig = t.boss.startAttack.bind(t.boss);
    t.boss.startAttack = (a: string, p?: Player) => {
      seq.push(a);
      orig(a, p);
    };
    t.runFor(60 * 70, () => {
      t.p.invuln = 99;
    });
    expect(seq.length).toBeGreaterThan(6);
    for (let i = 2; i < seq.length; i++) expect(!(seq[i] === seq[i - 1] && seq[i] === seq[i - 2])).toBe(true);
    expect(new Set(seq).size).toBeGreaterThanOrEqual(2);
    for (const a of seq) expect(t.boss.attackNames).toContain(a);
  });
});

describe.each(MINIBOSS_IDS)('%s: placeholder sheet', (id) => {
  it('does not depend on frame counts: a one-frame sheet without phases fights and dies the same way', () => {
    const t = setup(id, BOSS_X, BOSS_X - 220, 1, true);
    t.boss.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: t.p });
    const seq: string[] = [];
    const orig = t.boss.startAttack.bind(t.boss);
    t.boss.startAttack = (a: string, p?: Player) => {
      seq.push(a);
      orig(a, p);
    };
    t.runFor(60 * 40, () => {
      t.p.invuln = 99;
    });
    expect(new Set(seq).size).toBeGreaterThanOrEqual(2);
    t.boss.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: t.p });
    t.runFor(60 * 3);
    expect(t.boss.dead).toBe(true);
    expect(t.count('minibossDefeated')).toBe(1);
  });
});

describe.each(MINIBOSS_IDS)('%s: death', (id) => {
  const tier = 1;
  const check = (t: T) => {
    expect(t.count('minibossDefeated')).toBe(1);
    expect(t.boss.dead).toBe(true);
    // exactly one weapon and one skill, tier + 1, guaranteed affix
    const items = vi.mocked(spawnItemDrop).mock.calls.map((c) => c[3]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => ITEMS[i.id].slot).sort()).toEqual(['skill', 'weapon']);
    for (const i of items) {
      expect(i.tier).toBe(tier + 1);
      expect(i.affix).not.toBeNull();
    }
    // cells 10-15, gold 60-100
    // (minions that die with the boss drop their own small loot: look for the boss's)
    const big = vi.mocked(dropLoot).mock.calls.map((c) => c[3] as { cells: number; gold: number }).filter((l) => (l.gold ?? 0) >= 60);
    expect(big).toHaveLength(1);
    const loot = big[0];
    expect(loot.cells).toBeGreaterThanOrEqual(10);
    expect(loot.cells).toBeLessThanOrEqual(15);
    expect(loot.gold).toBeGreaterThanOrEqual(60);
    expect(loot.gold).toBeLessThanOrEqual(100);
  };

  it('emits minibossDefeated once and spawns exactly one weapon drop and one skill drop (+ cells, gold)', () => {
    const t = setup(id, BOSS_X, BOSS_X - 300, tier);
    skipIntro(t);
    const hp = t.boss.hp;
    const r = t.boss.takeDamage({ amount: hp + 500, dir: 1, kind: 'melee', source: t.p });
    expect(r.killed).toBe(true);
    expect(t.boss.state).toBe('dying');
    // more hits while it dies do nothing (no second death)
    for (let i = 0; i < 5; i++) expect(t.boss.takeDamage({ amount: 999, dir: 1, kind: 'melee', source: t.p }).applied).toBe(false);
    t.runFor(60 * 4);
    expect(t.boss.dead).toBe(true);
    check(t);
    expect(t.count('minibossStart')).toBe(1);
  });

  for (const probe of PROBES[id]) {
    it(`killed in the middle of ${probe.attack}: still exactly one defeat event and two drops, nothing hurts afterwards`, () => {
      const t = setup(id, BOSS_X, BOSS_X + probe.dx, tier);
      skipIntro(t);
      const pin = place(t, probe.dx);
      t.boss.facing = 1;
      t.boss.startAttack(probe.attack, t.p);
      t.runFor(Math.round(t.boss.windupOf(probe.attack) * 60) + 6, pin);
      t.boss.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: t.p });
      const died = t.now();
      t.runFor(60 * 4, pin);
      check(t);
      expect(t.log.filter((l) => l.frame > died + 2)).toHaveLength(0);
      // everything it conjured is gone
      expect(t.world.entities.filter((e) => e instanceof MoonOrb || e instanceof MoonShard || e instanceof SwordBeam).length).toBe(0);
    });
  }

  it('dying takes ~1.9 s with the defeat burst at the end of the death animation', () => {
    const t = setup(id, BOSS_X, BOSS_X - 300, tier);
    skipIntro(t);
    t.boss.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: t.p });
    t.runFor(Math.round((MB.deathAt - 0.2) * 60));
    expect(t.count('minibossDefeated')).toBe(0);
    t.runFor(60);
    expect(t.count('minibossDefeated')).toBe(1);
  });
});

describe('abbess minions', () => {
  it('the ghouls she rings up die with her', () => {
    const t = setup('mb_abbess', BOSS_X, BOSS_X + 200);
    skipIntro(t);
    const pin = place(t, 200);
    t.boss.facing = 1;
    t.boss.startAttack('summon', t.p);
    t.runFor(Math.round((ABBESS.summon.w + ABBESS.summon.a) * 60) + 10, pin);
    const ghouls = t.world.entities.filter((e) => (e as any).kind === 'ghoul') as Actor[];
    expect(ghouls).toHaveLength(2);
    t.boss.takeDamage({ amount: 99999, dir: 1, kind: 'melee', source: t.p });
    t.runFor(90, pin);
    for (const g of ghouls) expect(g.dead || g.dying || g.hp <= 0).toBe(true);
  });
});

describe('rollItem guaranteeAffix', () => {
  it('always rolls an affix for weapons and skills; normal rolls keep their rng sequence', () => {
    const unlocked = Object.keys(ITEMS) as (keyof typeof ITEMS)[];
    for (let s = 1; s <= 80; s++) {
      for (const slot of ['weapon', 'skill'] as const) {
        const it = rollItem(new Rng(s), 2, unlocked, slot, { guaranteeAffix: true });
        expect(ITEMS[it.id].slot).toBe(slot);
        expect(it.affix).not.toBeNull();
      }
      const a = rollItem(new Rng(s), 2, unlocked, 'weapon');
      const b = rollItem(new Rng(s), 2, unlocked, 'weapon', {});
      expect(a).toEqual(b);
    }
  });
});

describe('level: the biome mid-boss spawns from the N marker', () => {
  for (const biome of ['prison', 'ramparts'] as const) {
    it(`${biome}: exactly one mid-boss per level, chosen by the level seed from the biome pair, standing in the mid-boss room`, () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) {
        const { world, run } = makeTestWorld(undefined, seed);
        const lvl = generateBiome(biome, seed * 31).level;
        (world as any).level = lvl;
        (world as any).map = lvl.map;
        run.levelIndex = biome === 'ramparts' ? 2 : 0;
        const pl = new Player(lvl.playerStart.x, lvl.playerStart.y);
        world.player = pl;
        world.spawn(pl);
        populateLevel(world, lvl);
        steps(world, 2);
        const bosses = world.entities.filter((e) => isMiniBoss(e)) as MiniBoss[];
        expect(bosses, `seed ${seed}`).toHaveLength(1);
        const b = bosses[0];
        expect(b.bossId).toBe(pickMiniBoss(biome, lvl.seed));
        expect(MINIBOSS_POOLS[biome]).toContain(b.bossId);
        expect(b.spec.biome).toBe(biome);
        expect(b.tier).toBe(biome === 'ramparts' ? 2 : 1);
        expect(b.state).toBe('dormant');
        const room = lvl.rooms.find((r) => r.tags.includes('miniboss'))!;
        expect(b.x).toBeGreaterThan(room.x * TILE);
        expect(b.x).toBeLessThan((room.x + room.w) * TILE);
        seen.add(b.bossId);
        // the arena is the room minus its doorways
        expect(b.arena.l).toBe((room.x + 4) * TILE);
        expect(b.arena.r).toBe((room.x + room.w - 4) * TILE);
      }
      expect(seen.size, biome).toBe(2);
    });
  }
});

describe('debug.gotoMiniboss', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('teleports the player to the far doorway of the mid-boss room and returns the boss', () => {
    const { world, run } = makeTestWorld(undefined, 4);
    const lvl = generateBiome('prison', 4).level;
    (world as any).level = lvl;
    (world as any).map = lvl.map;
    const pl = new Player(lvl.playerStart.x, lvl.playerStart.y);
    world.player = pl;
    world.spawn(pl);
    populateLevel(world, lvl);
    steps(world, 2);
    (globalThis as any).window = {};
    const game: any = { scene: { world }, step() {}, run };
    installDebug(game);
    const boss = (globalThis as any).window.__ds.gotoMiniboss() as MiniBoss;
    expect(boss).toBeInstanceOf(MiniBoss);
    const room = lvl.rooms.find((r) => r.tags.includes('miniboss'))!;
    expect(pl.x).toBeGreaterThan(room.x * TILE);
    expect(pl.x).toBeLessThan((room.x + room.w) * TILE);
    expect(Math.abs(pl.x - boss.x)).toBeGreaterThan(boss.spec.activateRange + 100);
    // walking toward it wakes it up
    pl.x = boss.x - boss.spec.activateRange + 20;
    steps(world, 5);
    expect(boss.state).toBe('intro');
  });
});

// ---------------------------------------------------------------------------------------- UI

function fakeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = { font: '11px x' };
  return new Proxy(target, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: [...s].length * (parseInt(String(t.font).match(/(\d+)px/)?.[1] ?? '11', 10) * 0.55) });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function uiSetup(W = 640) {
  const { world, game } = makeTestWorld();
  game.display = { W, H: 360, scale: 1, canvas: null };
  game.taps = new TapRegistry();
  game.persist = vi.fn();
  game.scene = null;
  (world as any).player = {
    hp: 100, maxHp: 100, recoverable: 0, nearInteract: null, skillCooldown: [0, 0], skillCooldownMax: [10, 10],
    x: 200, y: 200, h: 40, w: 14, dying: false,
  };
  const ui = new LevelUI(game, world);
  world.ui = ui;
  const ctx = fakeCtx();
  const advance = (secs: number) => {
    for (let i = 0; i < Math.ceil(secs * 60); i++) {
      game.taps.clear();
      ui.update(1 / 60);
      ui.draw(ctx);
    }
  };
  return { world: world as World, ui, advance };
}

describe('mid-boss HUD', () => {
  it('minibossStart shows a compact name card, then a slim HP bar; both disappear after the boss dies', () => {
    const { world, ui, advance } = uiSetup();
    expect(ui.miniboss).toBeNull();
    const boss = { hp: 650, maxHp: 650, dead: false } as unknown as Actor;
    world.emit({ type: 'minibossStart', boss, name: '처형인 수녀원장' });
    expect(ui.miniboss?.name).toBe('처형인 수녀원장');
    expect(ui.boss).toBeNull();
    advance(0.5);
    expect(ui.hud.miniCardActive).toBe(true);
    expect(ui.hud.miniBarVisible).toBe(true);
    advance(3);
    expect(ui.hud.miniCardActive).toBe(false);
    expect(ui.hud.miniBarVisible).toBe(true);
    boss.hp = 300;
    advance(0.2);
    expect(ui.hud.miniBarVisible).toBe(true);
    boss.hp = 0;
    (boss as any).dead = true;
    world.emit({ type: 'minibossDefeated', boss });
    advance(2.5);
    expect(ui.hud.miniBarVisible).toBe(false);
    expect(ui.miniboss).toBeNull();
    advance(0.5);
  });

  it('a second mid-boss (next level) gets a fresh card', () => {
    const { world, ui, advance } = uiSetup();
    const a = { hp: 0, maxHp: 650, dead: true } as unknown as Actor;
    world.emit({ type: 'minibossStart', boss: a, name: 'A' });
    advance(2);
    const b = { hp: 900, maxHp: 900, dead: false } as unknown as Actor;
    world.emit({ type: 'minibossStart', boss: b, name: 'B' });
    advance(0.3);
    expect(ui.miniboss?.actor).toBe(b);
    expect(ui.hud.miniCardActive).toBe(true);
    expect(ui.hud.miniBarVisible).toBe(true);
  });

  for (const W of [480, 640, 777, 800]) {
    it(`mid-boss bar sits top-centre, narrower than the boss bar, clear of HP bar / pause / minimap (W=${W})`, () => {
      const L = hudLayout(W, 360, 3);
      const m = L.mini;
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.w).toBeLessThanOrEqual(W);
      expect(m.y).toBeLessThan(40);
      expect(Math.abs(m.x + m.w / 2 - W / 2)).toBeLessThanOrEqual(1);
      expect(m.w).toBeLessThan(L.boss.w);
      expect(m.h).toBeLessThan(L.boss.h);
      for (const o of [L.hp, L.pause, L.minimap, L.flask]) {
        const overlap = m.x < o.x + o.w && m.x + m.w > o.x && m.y - 14 < o.y + o.h && m.y + m.h > o.y;
        expect(overlap).toBe(false);
      }
      // the name card hangs below the counters row and covers none of the HUD blocks
      const k = L.miniCard;
      expect(k.y).toBeGreaterThanOrEqual(L.cells.y + 10);
      expect(Math.abs(k.x + k.w / 2 - W / 2)).toBeLessThanOrEqual(1);
      expect(k.w).toBeLessThan(L.boss.w);
      for (const o of [L.hp, L.pause, L.minimap, L.flask, ...L.skills.map((s) => s.hit), ...L.weapons]) {
        const overlap = k.x < o.x + o.w && k.x + k.w > o.x && k.y < o.y + o.h && k.y + k.h > o.y;
        expect(overlap).toBe(false);
      }
    });
  }
});
