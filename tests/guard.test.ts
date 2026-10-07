import { describe, it, expect, vi } from 'vitest';

import { makeTestWorld, steps } from './helpers';
import { Player } from '../src/game/player/player';
import { createEnemy } from '../src/game/enemies/factory';
import type { Enemy } from '../src/game/enemies/base';
import { BASE_STATS, ENEMY_DEFS, type EnemyKind } from '../src/game/enemies/variants';
import { GUARD } from '../src/game/rules';
import { FIXED_DT } from '../src/engine/config';
import { codexEntries } from '../src/game/ui/codexData';

const FLOOR = 16 * 24;
const SEC = Math.round(1 / FIXED_DT);

function setup(kind: EnemyKind, ex: number, px: number, opts: { tier?: number; elite?: boolean } = {}) {
  const { world } = makeTestWorld();
  const p = new Player(px, FLOOR);
  world.player = p;
  world.spawn(p);
  p.invuln = 99;
  const e = createEnemy(kind, ex, FLOOR, { tier: opts.tier ?? 1, elite: opts.elite ?? false }) as Enemy;
  world.spawn(e);
  steps(world, 2);
  return { world, p, e };
}

/** a plain frontal hit from the player's side (the shield faces right) */
function hit(e: Enemy, p: Player) {
  e.facing = 1;
  return e.takeDamage({ amount: 12, dir: -1, kind: 'melee', source: p });
}

/** a jailer 240 px from the player that stays where it is (so the player is never in its reach) */
function standoff(opts: { elite?: boolean } = {}) {
  const t = setup('jailer', 400, 160, opts);
  const hold = (): void => {
    t.e.x = 400;
  };
  return { ...t, wait: (secs: number) => steps(t.world, Math.round(secs * SEC), hold) };
}

describe('가드 브레이크', () => {
  it('the numbers: 3 blocks, each within 2.0 s of the one before, stagger 1.2 s', () => {
    expect(GUARD).toEqual({ hits: 3, window: 2, stagger: 1.2 });
  });

  it.each([false, true])('the third block within the window breaks the shield: text, sound, stagger, then hits land (elite %s)', (elite) => {
    const { world, p, e } = standoff({ elite });
    const sfx = vi.spyOn(world.audio, 'play');
    const text = vi.spyOn(world.fx, 'text');
    const hp = e.hp;
    for (let i = 0; i < GUARD.hits - 1; i++) {
      expect(hit(e, p).blocked).toBe(true);
      steps(world, 6);
    }
    expect(e.status.stun).toBeLessThanOrEqual(0);
    expect(e.shieldUp).toBe(true);
    expect(text.mock.calls.some((c) => c[2] === '가드 브레이크!')).toBe(false);
    expect(sfx.mock.calls.some((c) => c[0] === 'parry')).toBe(false);

    const last = hit(e, p);
    expect(last.blocked).toBe(true);
    expect(last.applied).toBe(false);
    expect(e.hp).toBe(hp);
    expect(text.mock.calls.some((c) => c[2] === '가드 브레이크!')).toBe(true);
    expect(sfx.mock.calls.some((c) => c[0] === 'parry')).toBe(true);
    expect(e.status.stun).toBeCloseTo(GUARD.stagger, 5);
    expect(e.shieldUp).toBe(false);
    steps(world, 1);
    expect(e.state).toBe('hurt');

    // staggered: the shield is down, hits land normally
    const after = hit(e, p);
    expect(after.applied).toBe(true);
    expect(after.blocked).toBeUndefined();
    expect(e.hp).toBe(hp - 12);
  });

  it('the stagger lasts 1.2 s, then the shield is back and the block count starts over', () => {
    const { world, p, e } = standoff();
    for (let i = 0; i < GUARD.hits; i++) hit(e, p);
    expect(e.status.stun).toBeGreaterThan(0);
    steps(world, Math.round(GUARD.stagger * SEC) - 6);
    expect(e.incapacitated).toBe(true);
    expect(e.shieldUp).toBe(false);
    steps(world, 12);
    expect(e.incapacitated).toBe(false);
    expect(e.shieldUp).toBe(true);
    // the count restarted: two blocks do not break it again, the third does
    for (let i = 0; i < GUARD.hits - 1; i++) {
      expect(hit(e, p).blocked).toBe(true);
      expect(e.status.stun).toBeLessThanOrEqual(0);
    }
    expect(hit(e, p).blocked).toBe(true);
    expect(e.status.stun).toBeGreaterThan(0);
  });

  it('blocks spaced just inside the window add up, blocks spaced just outside it do not', () => {
    // 3 blocks, 1.8 s apart: 3.6 s from the first to the last, yet each one is within 2.0 s of the one before
    const near = standoff();
    for (let i = 0; i < GUARD.hits; i++) {
      expect(near.e.status.stun).toBeLessThanOrEqual(0);
      expect(hit(near.e, near.p).blocked).toBe(true);
      if (i < GUARD.hits - 1) near.wait(GUARD.window - 0.2);
    }
    expect(near.e.hp).toBe(near.e.maxHp);
    expect(near.e.status.stun).toBeGreaterThan(0);

    const far = standoff();
    for (let i = 0; i < GUARD.hits + 2; i++) {
      expect(hit(far.e, far.p).blocked).toBe(true);
      far.wait(GUARD.window + 0.1);
    }
    expect(far.e.status.stun).toBeLessThanOrEqual(0);
    expect(far.e.hp).toBe(far.e.maxHp);
  });

  it('the paladin shield breaks the same way', () => {
    const { p, e } = setup('lancer_paladin', 400, 160);
    for (let i = 0; i < GUARD.hits - 1; i++) {
      expect(hit(e, p).blocked).toBe(true);
      expect(e.status.stun).toBeLessThanOrEqual(0);
    }
    expect(hit(e, p).blocked).toBe(true);
    expect(e.status.stun).toBeCloseTo(GUARD.stagger, 5);
    expect(e.shieldUp).toBe(false);
    expect(hit(e, p).applied).toBe(true);
  });

  it('the duelist parry never breaks, however many hits it deflects', () => {
    const { world, p, e } = setup('lancer_duelist', 400, 160);
    const text = vi.spyOn(world.fx, 'text');
    for (let i = 0; i < GUARD.hits + 3; i++) {
      (e as unknown as { parryReady: boolean }).parryReady = true;
      expect(hit(e, p).blocked).toBe(true);
      expect(e.status.stun).toBeLessThanOrEqual(0);
    }
    expect(text.mock.calls.some((c) => c[2] === '쳐냄')).toBe(true);
    expect(text.mock.calls.some((c) => c[2] === '가드 브레이크!')).toBe(false);
  });

  it('the chain jailer has no shield: nothing to block, nothing to break', () => {
    const { p, e } = setup('jailer_chain', 400, 160);
    const hp = e.hp;
    for (let i = 0; i < GUARD.hits; i++) {
      e.hitstun = 0;
      expect(hit(e, p).applied).toBe(true);
    }
    expect(e.hp).toBe(hp - 12 * GUARD.hits);
    expect(e.status.stun).toBeLessThanOrEqual(0);
  });
});

describe('shield jailers: more openings', () => {
  it('hp: base 90 -> 65, the variants keep their multipliers', () => {
    expect(BASE_STATS.jailer.hp).toBe(65);
    const hp = (k: EnemyKind, o: { tier?: number; elite?: boolean } = {}): number => setup(k, 400, 160, o).e.maxHp;
    expect(hp('jailer')).toBe(65);
    expect(hp('jailer_warden')).toBe(91); // x 1.4
    expect(hp('jailer_torch')).toBe(59); // x 0.9
    expect(hp('jailer_spear')).toBe(62); // x 0.95
    expect(hp('jailer_chain')).toBe(62); // x 0.95
    expect(hp('jailer', { tier: 2 })).toBe(104);
    expect(hp('jailer', { elite: true })).toBe(195);
    expect(ENEMY_DEFS.jailer_warden.hp).toBe(1.4);
  });

  /** seconds from the start of the swing's recovery to its end (the player stands in reach and cannot be hurt) */
  function recoverSecs(kind: EnemyKind, px: number): number {
    const { world, e } = setup(kind, 200, px);
    let from = -1;
    for (let i = 0; i < 400; i++) {
      steps(world, 1);
      if (from < 0 && e.state === 'recover') {
        from = i;
        // the shield is already down: a frontal hit lands
        expect(e.shieldUp).toBe(false);
      }
      if (from >= 0 && e.state !== 'recover') return (i - from) / SEC;
    }
    throw new Error('no recovery seen');
  }

  it.each(['jailer', 'jailer_warden', 'jailer_torch'] as const)('%s: recovers for 1.0 s after the mace swing (was 0.7)', (kind) => {
    expect(Math.abs(recoverSecs(kind, 240) - 1.0)).toBeLessThan(0.04);
  });

  it('jailer_spear: recovers for 0.9 s after the thrust (was 0.6)', () => {
    expect(Math.abs(recoverSecs('jailer_spear', 270) - 0.9)).toBeLessThan(0.04);
  });

  it('a frontal hit during the recovery lands (the shield is down)', () => {
    const { world, p, e } = setup('jailer', 200, 240);
    for (let i = 0; i < 400 && e.state !== 'recover'; i++) steps(world, 1);
    expect(e.state).toBe('recover');
    const hp = e.hp;
    expect(e.takeDamage({ amount: 7, dir: -e.facing, kind: 'melee', source: p }).applied).toBe(true);
    expect(e.hp).toBe(hp - 7);
  });

  /** seconds the jailer needs to face a player who just moved behind it */
  function turnSecs(elite: boolean): number {
    const { world, p, e } = setup('jailer', 400, 300, { elite });
    for (let i = 0; i < 120 && e.state !== 'chase'; i++) steps(world, 1);
    expect(e.state).toBe('chase');
    expect(e.facing).toBe(-1);
    for (let i = 1; i <= 200; i++) {
      p.x = e.x + 200; // behind it, out of reach
      steps(world, 1);
      if (e.facing === 1) return i / SEC;
    }
    throw new Error('never turned');
  }

  it('turns round in 0.9 s (was 0.6), an elite in 0.6 s (was 0.4)', () => {
    expect(Math.abs(turnSecs(false) - 0.9)).toBeLessThan(0.04);
    expect(Math.abs(turnSecs(true) - 0.6)).toBeLessThan(0.04);
  });

  it('the codex tells about the guard break from the table numbers, and shows the new hp', () => {
    const jailer = codexEntries('enemy').find((x) => x.id === 'jailer')!;
    expect(jailer.desc).toContain(`${GUARD.window}초 안에 ${GUARD.hits}번`);
    expect(jailer.desc).toContain(`${GUARD.stagger}초 기절`);
    expect(jailer.rows.find((r) => r.label === '체력')!.text).toBe('1티어 65 · 2티어 104');
    expect(codexEntries('enemy').find((x) => x.id === 'lancer_paladin')!.desc).toContain(`${GUARD.hits}번`);
  });
});
