import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/game/items/pickups', async (orig) => ({
  ...(await orig<typeof import('../src/game/items/pickups')>()),
  dropLoot: vi.fn(),
  spawnItemDrop: vi.fn(),
  spawnFood: vi.fn(),
}));

import { makeTestWorld, steps, flatMap } from './helpers';
import { Player } from '../src/game/player/player';
import { createMiniBoss, ARACHNE, ARACHNE_SPEC, MB, MINIBOSS_SPECS, type Arachne } from '../src/game/miniboss';
import { WebBlob } from '../src/game/miniboss/hazards';
import { codexEntries } from '../src/game/ui/codexData';

const FLOOR = 16 * 24;
const BOSS_X = 700;
/** rage windups / recoveries are x0.85 */
const RAGE = 0.85;

function setup(playerDx = 320, rage = false) {
  const { world } = makeTestWorld(flatMap(60, 18));
  const p = new Player(BOSS_X + playerDx, FLOOR);
  world.player = p;
  world.spawn(p);
  const boss = createMiniBoss('mb_arachne', BOSS_X, FLOOR) as Arachne;
  world.spawn(boss);
  steps(world, 2);
  boss.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: p });
  for (let i = 0; i < 400 && boss.state !== 'idle'; i++) steps(world, 1);
  expect(boss.state).toBe('idle');
  (boss as any).gapT = 999;
  if (rage) boss.hp = Math.floor(boss.maxHp * MB.rageAt) - 1;
  expect(boss.rage).toBe(rage);
  boss.facing = 1;
  /** one frame; the player is pinned at `px` (default: where he stands now) and cannot be hurt unless `hurt` */
  const frame = (px = p.x, hurt = false) => {
    p.x = px;
    p.y = FLOOR;
    p.vx = p.vy = 0;
    p.hp = p.maxHp;
    p.invuln = hurt ? 0 : 99;
    p.status.bleed = 0;
    steps(world, 1);
  };
  /** sound effects played so far (name + the boss's vx at that moment) */
  const sfx: { name: string; vx: number }[] = [];
  const play = world.audio.play.bind(world.audio);
  vi.spyOn(world.audio, 'play').mockImplementation((name, o) => {
    sfx.push({ name, vx: boss.vx });
    play(name, o);
  });
  const count = (name: string) => sfx.filter((s) => s.name === name).length;
  return { world, p, boss, frame, sfx, count };
}
type T = ReturnType<typeof setup>;

/** A canvas stand-in that records the strokes / ellipses the markers draw. */
function recorder() {
  const lines: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const ellipses: { x: number; y: number; rx: number; ry: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  let cur = { x: 0, y: 0 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, k: string) {
      if (k === 'moveTo') return (x: number, y: number) => (cur = { x, y });
      if (k === 'lineTo') return (x: number, y: number) => lines.push({ x0: cur.x, y0: cur.y, x1: x, y1: y });
      if (k === 'ellipse') return (x: number, y: number, rx: number, ry: number) => ellipses.push({ x, y, rx, ry });
      if (k === 'strokeRect') return (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, lines, ellipses, rects };
}

/** Run until `pred`, at most `max` frames. */
function until(t: T, pred: () => boolean, max = 600, px?: () => number): number {
  let n = 0;
  while (!pred() && n < max) {
    t.frame(px?.());
    n++;
  }
  expect(pred(), 'the condition came true').toBe(true);
  return n;
}

const blobs = (t: T) => t.world.entities.filter((e): e is WebBlob => e instanceof WebBlob && !e.dead);
const angleOf = (b: WebBlob) => Math.atan2(b.vy, b.vx);

/** Start a web and run to the first frame in which blobs exist (the boss's windup warning is drawn on the way). */
function fireWeb(t: T): { shots: WebBlob[]; lines: { x0: number; y0: number; x1: number; y1: number }[] } {
  t.boss.startAttack('web', t.p);
  const rec = recorder();
  until(t, () => {
    if (t.boss.state === 'windup') (t.boss as any).drawMarkers(rec.ctx, 0.5);
    return blobs(t).length > 0;
  });
  return { shots: blobs(t), lines: rec.lines };
}

describe('arachne: numbers', () => {
  it('820 hp (650 before), still a prison mid-boss with no knockback', () => {
    expect(ARACHNE_SPEC.hp).toBe(820);
    expect(MINIBOSS_SPECS.mb_arachne.hp).toBe(820);
    const b = createMiniBoss('mb_arachne', 0, 0);
    expect(b.maxHp).toBe(820);
    expect(b.knockbackTaken).toBe(0);
    expect(createMiniBoss('mb_arachne', 0, 0, 2).maxHp).toBe(Math.round(820 * 1.6));
  });

  it('web blob speed 360, leap radius 76 / damage 24, bite windup 0.42', () => {
    expect(ARACHNE.web.speed).toBe(360);
    expect(ARACHNE.leap.radius).toBe(76);
    expect(ARACHNE.leap.dmg).toBe(24);
    expect(ARACHNE.bite.w).toBe(0.42);
    const t = setup();
    expect(t.boss.windupOf('bite', t.p)).toBeCloseTo(0.42);
  });

  it('the codex lists the new fan, the bigger leap, the double bite from the tables', () => {
    const e = codexEntries('boss').find((x) => x.id === 'mb_arachne')!;
    const rows = e.rows.filter((r) => r.label === '공격' || r.label === '').map((r) => r.text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(`${ARACHNE.web.shots}발`);
    expect(rows[0]).toContain(`격분 시 ${ARACHNE.web.rageShots}발`);
    expect(rows[0]).toContain(`피해 ${ARACHNE.web.dmg}`);
    expect(rows[1]).toContain(`반경 ${ARACHNE.leap.radius}px 피해 ${ARACHNE.leap.dmg}`);
    expect(rows[1]).toContain('격분 시');
    expect(rows[2]).toContain(`피해 ${ARACHNE.bite.dmg}`);
    expect(rows[2]).toContain('격분 시 2연속');
    expect(e.rows.find((r) => r.label === '체력')!.text).toContain('820');
  });
});

describe('arachne: web', () => {
  it('always a fan of 3 blobs (+-0.22 rad) at speed 360, even before she is enraged', () => {
    const t = setup();
    const { shots } = fireWeb(t);
    expect(shots).toHaveLength(ARACHNE.web.shots);
    expect(ARACHNE.web.shots).toBe(3);
    for (const b of shots) expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(360, 3);
    const a = shots.map(angleOf).sort((x, y) => x - y);
    expect(a[1] - a[0]).toBeCloseTo(0.22, 4);
    expect(a[2] - a[1]).toBeCloseTo(0.22, 4);
  });

  it('enraged: 5 blobs (+-0.22 and +-0.44 rad around the aim line)', () => {
    const t = setup(320, true);
    const { shots } = fireWeb(t);
    expect(shots).toHaveLength(ARACHNE.web.rageShots);
    expect(ARACHNE.web.rageShots).toBe(5);
    for (const b of shots) expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(360, 3);
    const a = shots.map(angleOf).sort((x, y) => x - y);
    for (let i = 1; i < 5; i++) expect(a[i] - a[i - 1]).toBeCloseTo(0.22, 4);
    // symmetric around the middle blob
    expect(a[2] - a[0]).toBeCloseTo(0.44, 4);
    expect(a[4] - a[2]).toBeCloseTo(0.44, 4);
  });

  for (const rage of [false, true]) {
    it(`the warning lines are the shots (${rage ? 'enraged' : 'calm'}): same count, same angles`, () => {
      const t = setup(320, rage);
      const { shots, lines } = fireWeb(t);
      // the warning is drawn with the same fan the shots leave in (every frame of the windup: use the last set of lines)
      const per = shots.length;
      expect(lines.length % per).toBe(0);
      const last = lines.slice(-per);
      const warn = last.map((l) => Math.atan2(l.y1 - l.y0, l.x1 - l.x0)).sort((x, y) => x - y);
      const real = shots.map(angleOf).sort((x, y) => x - y);
      expect(warn).toHaveLength(real.length);
      for (let i = 0; i < real.length; i++) expect(warn[i]).toBeCloseTo(real[i], 2);
    });
  }

  it('a blob still roots the player', () => {
    const t = setup();
    t.boss.startAttack('web', t.p);
    let rooted = false;
    for (let i = 0; i < 60 * 3 && !rooted; i++) {
      t.frame(t.p.x, true);
      rooted = t.world.entities.some((e) => e.constructor.name === 'WebRoot' && !e.dead);
    }
    expect(rooted).toBe(true);
  });
});

describe('arachne: leap', () => {
  /** Run a calm leap from windup to the landing frame; returns the landing x. */
  it('radius 76: hits inside, misses outside, for 24', () => {
    const run = (off: number): number => {
      const t = setup(260);
      const px = t.p.x;
      t.boss.startAttack('leap', t.p);
      until(t, () => t.boss.state === 'active', 200, () => px);
      const tx = (t.boss as any).leapTx as number;
      expect(tx).toBeCloseTo(px, 3);
      // the target is locked now: step to the landing and look at what the shock does to a player `off` px from the centre
      const hp0 = t.p.maxHp;
      let taken = 0;
      for (let i = 0; i < 80 && t.boss.state === 'active'; i++) {
        t.p.x = tx + off;
        t.p.y = FLOOR;
        t.p.vx = t.p.vy = 0;
        t.p.invuln = 0;
        t.p.hp = hp0;
        steps(t.world, 1);
        taken = Math.max(taken, hp0 - t.p.hp);
      }
      return taken;
    };
    expect(run(ARACHNE.leap.radius - 14)).toBe(ARACHNE.leap.dmg);
    expect(run(0)).toBe(ARACHNE.leap.dmg);
    expect(run(ARACHNE.leap.radius + 24)).toBe(0);
  });

  it('the warning circle is as big as the shock (radius 76), at the locked target', () => {
    const t = setup(260);
    t.boss.startAttack('leap', t.p);
    until(t, () => t.boss.state === 'active', 200);
    const rec = recorder();
    // draw the marker as in the windup (the attack and the target are still set)
    (t.boss as any).drawMarkers(rec.ctx, 0.9);
    const tx = (t.boss as any).leapTx as number;
    expect(rec.ellipses.some((e) => e.rx === ARACHNE.leap.radius && Math.abs(e.x - Math.round(tx)) < 1)).toBe(true);
  });

  it('calm: one leap, no chain, then she recovers', () => {
    const t = setup(260);
    t.boss.startAttack('leap', t.p);
    until(t, () => t.boss.attack === null, 60 * 6);
    expect(t.count('boss_slam')).toBe(1);
    expect(t.boss.swing).toBe(0);
  });

  it('enraged: a second leap right after the landing, aimed at where the player stood as she landed', () => {
    const t = setup(260, true);
    const A = t.p.x;
    const B = A - 150;
    t.boss.startAttack('leap', t.p);
    // the player stays at A until she lands (swing becomes 1 on the landing frame), then runs to B
    let landed = 0;
    /** how long the second windup ran (the hit-stop of the landing does not count) */
    let windupT = 0;
    let secondWindupAt = -1;
    for (let i = 0; i < 60 * 6 && t.boss.attack !== null; i++) {
      t.frame(t.boss.swing === 0 ? A : B);
      if (t.boss.swing === 1) {
        if (secondWindupAt < 0) {
          secondWindupAt = i;
          // right after the first landing: not a recovery, the next windup
          expect(t.boss.state).toBe('windup');
          expect(t.count('boss_slam')).toBe(1);
          expect(t.boss.x).toBeCloseTo((t.boss as any).leapTx, 3);
        }
        if (t.boss.state === 'windup') windupT = Math.max(windupT, t.boss.stateT);
        landed = t.count('boss_slam');
      }
    }
    expect(secondWindupAt).toBeGreaterThan(0);
    expect(t.boss.attack).toBeNull();
    // two landings in all, the second on the spot where the player was when the first one landed (not where he ran to)
    expect(landed).toBe(2);
    expect(t.boss.x).toBeCloseTo(A, 0);
    expect(Math.abs(t.boss.x - B)).toBeGreaterThan(100);
    // the second windup is a readable warning of its own: ARACHNE.leap.w2 (x0.85 enraged), and the air time is the same
    expect(windupT).toBeLessThan(ARACHNE.leap.w2 * RAGE);
    expect(windupT).toBeGreaterThan(ARACHNE.leap.w2 * RAGE - 2 / 60);
    expect(windupT).toBeGreaterThanOrEqual(0.35);
  });

  it('the second warning circle stays on its spot (it does not follow the player any more)', () => {
    const t = setup(260, true);
    const A = t.p.x;
    t.boss.startAttack('leap', t.p);
    until(t, () => t.boss.swing === 1, 60 * 4, () => A);
    const tx = (t.boss as any).leapTx as number;
    expect(tx).toBeCloseTo(A, 3);
    const rec = recorder();
    // the player runs away during the second windup: the marker stays
    for (let i = 0; i < 8; i++) t.frame(A - 20 * (i + 1));
    expect(t.boss.state).toBe('windup');
    expect((t.boss as any).leapTx).toBeCloseTo(tx, 3);
    (t.boss as any).drawMarkers(rec.ctx, 0.5);
    expect(rec.ellipses.some((e) => e.rx === ARACHNE.leap.radius && Math.abs(e.x - Math.round(tx)) < 1)).toBe(true);
  });

  it('a parry during the second windup ends the chain: no second landing', () => {
    const t = setup(260, true);
    const A = t.p.x;
    t.boss.startAttack('leap', t.p);
    until(t, () => t.boss.swing === 1, 60 * 4, () => A);
    t.boss.takeDamage({ amount: 1, dir: 1, kind: 'melee', stun: 1, source: t.p });
    for (let i = 0; i < 20; i++) t.frame(A);
    expect(t.boss.state).toBe('stunned');
    expect(t.boss.attack).toBeNull();
    expect(t.count('boss_slam')).toBe(1);
    // she comes down and nothing hurts afterwards
    for (let i = 0; i < 60 * 3 && t.boss.state === 'stunned'; i++) t.frame(A);
    expect(t.boss.state).toBe('idle');
    expect(t.boss.physics).toBe(true);
    expect(t.boss.y).toBeCloseTo(FLOOR, 0);
  });
});

describe('arachne: bite', () => {
  /** Run one bite from the start until she is done; the player stands in reach and can be hurt. */
  const bite = (rage: boolean) => {
    const t = setup(60, rage);
    const hurt: number[] = [];
    const take = vi.spyOn(t.p, 'takeDamage');
    t.boss.startAttack('bite', t.p);
    let n = 0;
    for (let i = 0; i < 60 * 4 && t.boss.attack !== null; i++) {
      // he stays 60 px in front of her (the lunge carries her forward)
      t.frame(t.boss.x + 60, true);
      n++;
      const calls = take.mock.calls.filter((c) => c[0].amount === ARACHNE.bite.dmg).length;
      while (hurt.length < calls) hurt.push(n);
    }
    return { t, hurt, frames: n };
  };

  it('calm: one bite after a 0.42 s warning', () => {
    const { t, hurt } = bite(false);
    expect(hurt).toHaveLength(1);
    expect(t.count('swing_heavy')).toBe(1);
    expect(t.boss.swing).toBe(0);
    expect(hurt[0] / 60).toBeGreaterThanOrEqual(ARACHNE.bite.w - 2 / 60);
    expect(hurt[0] / 60).toBeLessThan(ARACHNE.bite.w + 0.1);
  });

  it('enraged: a double bite, the second one with a warning of its own and the same lunge', () => {
    const { t, hurt } = bite(true);
    expect(hurt).toHaveLength(2);
    expect(t.count('swing_heavy')).toBe(2);
    expect(t.boss.swing).toBe(1);
    // first bite after the (shortened) windup, the second one a windup + active phase later
    expect(hurt[0] / 60).toBeGreaterThanOrEqual(ARACHNE.bite.w * RAGE - 2 / 60);
    const gap = (hurt[1] - hurt[0]) / 60;
    expect(gap).toBeGreaterThanOrEqual(ARACHNE.bite.a + ARACHNE.bite.w2 * RAGE - 3 / 60);
    expect(gap).toBeLessThan(ARACHNE.bite.a + ARACHNE.bite.w2 * RAGE + 0.15);
    // both lunges are the same one
    const lunges = t.sfx.filter((s) => s.name === 'swing_heavy').map((s) => s.vx);
    expect(lunges).toEqual([ARACHNE.bite.lunge, ARACHNE.bite.lunge]);
    // never a hit before its own windup (no bite without a warning)
    expect(gap * 60).toBeGreaterThan(ARACHNE.bite.a * 60 + 15);
  });

  it('enraged: the second bite turns to the player and shows its marker in front of her', () => {
    const t = setup(60, true);
    t.boss.startAttack('bite', t.p);
    const start = t.p.x;
    // first bite: the player stands in front; as soon as she is in the first active phase he rolls behind her
    until(t, () => t.boss.state === 'active', 120, () => start);
    expect(t.boss.facing).toBe(1);
    const behind = t.boss.x - 60;
    until(t, () => t.boss.swing === 1, 120, () => behind);
    expect(t.boss.state).toBe('windup');
    expect(t.boss.facing).toBe(-1);
    const rec = recorder();
    (t.boss as any).drawMarkers(rec.ctx, 0.5);
    expect(rec.rects).toHaveLength(1);
    const r = rec.rects[0];
    expect(r.x + r.w / 2).toBeLessThan(t.boss.x);
  });

  it('a parry during the double bite stops it (the second bite never comes)', () => {
    const t = setup(60, true);
    const px = t.p.x;
    t.boss.startAttack('bite', t.p);
    until(t, () => t.boss.swing === 1, 120, () => px);
    t.boss.takeDamage({ amount: 1, dir: 1, kind: 'melee', stun: 1, source: t.p });
    for (let i = 0; i < 90; i++) t.frame(px);
    expect(t.count('swing_heavy')).toBe(1);
    expect(t.boss.attack).toBeNull();
  });
});
