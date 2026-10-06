import { describe, it, expect, vi } from 'vitest';
import { makeTestWorld, steps, flatMap } from './helpers';
import { Player, RUN_SPEED } from '../src/game/player/player';
import { Actor } from '../src/game/entity';
import { T, TileMap } from '../src/game/tilemap';
import { SPRINT } from '../src/game/rules';
import { ANIM_FALLBACK, AnimPlayer, SpriteSheet, resolveAnim, type AnimDef } from '../src/engine/assets';
import { fakeSheet } from './helpers';

const FLOOR = 16 * 24;

function setup(map: TileMap = flatMap(120), x = 120) {
  const t = makeTestWorld(map);
  const p = new Player(x, FLOOR);
  t.world.player = p;
  t.world.spawn(p);
  const sounds: { s: string; pitch?: number }[] = [];
  t.game.audio.play = (s: string, o?: { pitch?: number }) => { sounds.push({ s, pitch: o?.pitch }); };
  steps(t.world, 3);
  return { ...t, p, sounds };
}
type Ctx = ReturnType<typeof setup>;

const right = (t: Ctx) => t.input.setAxis('kb', 1, 0);
const left = (t: Ctx) => t.input.setAxis('kb', -1, 0);
const stop = (t: Ctx) => t.input.setAxis('kb', 0, 0);
/** the world's kill event, as the enemies emit it */
const kill = (t: Ctx) => t.world.emit({ type: 'enemyKilled', enemy: null as unknown as Actor, elite: false });
const SEC = 60;

describe('sprint: the rules table (docs/CONTENT4.md §1)', () => {
  it('has the spec numbers', () => {
    expect([SPRINT.runUp, SPRINT.mult, SPRINT.airKeep, SPRINT.streakKills, SPRINT.streakWindow, SPRINT.frenzyTime, SPRINT.endGrace]).toEqual([0.9, 1.6, true, 3, 2.5, 5, 0.12]);
    expect(RUN_SPEED * SPRINT.mult).toBe(240);
    expect([SPRINT.after.interval, SPRINT.after.count, [...SPRINT.after.alpha], SPRINT.after.color, SPRINT.after.frenzyColor]).toEqual([0.05, 4, [0.35, 0.08], '#4fe3ff', '#ff4a6a']);
  });
});

describe('sprint: the run-up', () => {
  it('holding a direction on the ground for 0.9 s starts the sprint: 240 px/s, the sprint animation', () => {
    const t = setup();
    right(t);
    steps(t.world, 40);
    expect([t.p.sprinting, t.p.vx]).toEqual([false, 150]);
    expect(t.p.anim!.name).toBe('run');
    steps(t.world, 15); // 55 steps = 0.92 s
    expect(t.p.sprinting).toBe(true);
    steps(t.world, 8);
    expect(t.p.vx).toBe(240);
    expect(t.p.anim!.name).toBe('sprint');
    expect(t.p.state).toBe('run');
  });

  it('works to the left too, and the speed is x1.6 of the run speed', () => {
    const t = setup(flatMap(120), 900);
    left(t);
    steps(t.world, SEC + 10);
    expect([t.p.sprinting, t.p.vx, t.p.facing]).toEqual([true, -240, -1]);
  });

  it('stopping, a pause longer than the end grace, or turning restarts the run-up', () => {
    const t = setup();
    right(t);
    steps(t.world, SEC);
    expect(t.p.sprinting).toBe(true);
    stop(t);
    steps(t.world, 10); // 0.17 s > 0.12 s
    expect(t.p.sprinting).toBe(false);
    right(t);
    steps(t.world, 40);
    expect(t.p.sprinting).toBe(false); // the run-up starts over
    steps(t.world, 20);
    expect(t.p.sprinting).toBe(true);
    // turning
    left(t);
    steps(t.world, 2);
    expect(t.p.sprinting).toBe(false);
    steps(t.world, 40);
    expect(t.p.sprinting).toBe(false);
    steps(t.world, 20);
    expect([t.p.sprinting, t.p.vx]).toEqual([true, -240]);
  });

  it('a release shorter than the end grace (touch jitter) does not end it', () => {
    const t = setup();
    right(t);
    steps(t.world, SEC);
    expect(t.p.sprinting).toBe(true);
    stop(t);
    steps(t.world, 4); // 0.067 s
    right(t);
    steps(t.world, 3);
    expect(t.p.sprinting).toBe(true);
    expect(t.p.vx).toBeGreaterThan(100); // (she lost some speed, not the sprint)
    // ... and the run-up was not reset by it
    stop(t);
    steps(t.world, 5);
    right(t);
    steps(t.world, 1);
    expect(t.p.sprinting).toBe(true);
  });

  it('a wall in front ends it; pushing on keeps the run-up at zero', () => {
    const m = flatMap(120);
    for (let y = 1; y < 16; y++) m.set(10, y, T.Solid);
    const t = setup(m, 1200);
    left(t);
    steps(t.world, SEC + 10);
    expect(t.p.sprinting).toBe(true);
    steps(t.world, 300);
    expect(t.p.x).toBeLessThan(10 * 24 + 40);
    expect(t.p.sprinting).toBe(false);
    steps(t.world, 90);
    expect(t.p.sprinting).toBe(false); // still pushing against the wall: the run-up does not count
    right(t);
    steps(t.world, 40);
    expect(t.p.sprinting).toBe(false);
    steps(t.world, 20);
    expect(t.p.sprinting).toBe(true);
  });

  it('an attack, a skill, a roll, a slam, a flask and a hit each end it and restart the run-up', () => {
    const cases: [string, (t: Ctx) => void][] = [
      ['attack', (t) => t.input.tap('attack1')],
      ['skill', (t) => { t.run.skills = [{ id: 'fire_grenade', tier: 1, affix: null }, null]; t.input.tap('skill1'); }],
      ['roll', (t) => t.input.tap('roll')],
      ['flask', (t) => { t.run.hp = 10; t.p.hp = 10; t.input.tap('heal'); }],
      ['hit', (t) => { t.p.takeDamage({ amount: 5, dir: -1, kind: 'melee' }); }],
    ];
    for (const [name, act] of cases) {
      const t = setup();
      t.run.flasks = 1;
      right(t);
      steps(t.world, SEC + 5);
      expect(t.p.sprinting, name).toBe(true);
      act(t);
      steps(t.world, 12); // (past the hit-stop)
      expect(t.p.sprinting, name).toBe(false);
      // back to free movement: the run-up begins anew
      for (let i = 0; i < 120 && t.p.state !== 'run'; i++) steps(t.world, 1);
      steps(t.world, 10);
      expect(t.p.sprinting, `${name} (restarted)`).toBe(false);
    }
    const s = setup();
    right(s);
    steps(s.world, SEC + 5);
    s.p.y -= 60;
    s.p.vy = 0;
    steps(s.world, 3);
    s.input.tap('down'); // a ground slam in the air
    steps(s.world, 2);
    expect(s.p.sprinting).toBe(false);
    expect(s.p.state).toBe('slam');
  });

  it('a ledge grab ends it', () => {
    const m = flatMap(120);
    for (let x = 60; x < 64; x++) for (let y = 11; y < 16; y++) m.set(x, y, T.Solid);
    const top = 11 * 24;
    const t = setup(m, 120);
    right(t);
    steps(t.world, SEC + 5);
    expect(t.p.sprinting).toBe(true);
    // she is up against the block's face at hand height (as in the ledge test of player.test.ts)
    t.p.x = 60 * 24 - 8;
    t.p.y = top + 40 - 6 + 8;
    t.p.vy = 50;
    t.p.onGround = false;
    steps(t.world, 2);
    expect(t.p.state).toBe('ledge');
    expect(t.p.sprinting).toBe(false);
  });
});

describe('sprint: jumping out of a sprint keeps the speed (airKeep)', () => {
  it('the horizontal speed stays 240 in the air even when the direction is let go, until she lands', () => {
    const t = setup();
    right(t);
    steps(t.world, SEC + 5);
    t.input.press('jump'); // held: a full jump
    steps(t.world, 3);
    expect(t.p.onGround).toBe(false);
    stop(t);
    let air = 0;
    for (let i = 0; i < 20; i++) {
      steps(t.world, 1);
      if (!t.p.onGround) air++;
      expect(t.p.vx, `air step ${i}`).toBe(240);
    }
    expect(air).toBe(20);
    expect(t.p.sprinting).toBe(true);
    // landing without a direction: she stops (the sprint is over after the end grace)
    for (let i = 0; i < 80 && !t.p.onGround; i++) steps(t.world, 1);
    steps(t.world, 20);
    expect([t.p.sprinting, t.p.vx]).toEqual([false, 0]);
  });

  it('with the direction held she lands still sprinting; turning in the air ends the sprint and slows her', () => {
    const a = setup();
    right(a);
    steps(a.world, SEC + 5);
    a.input.press('jump');
    steps(a.world, 3);
    a.input.release('jump');
    for (let i = 0; i < 80 && !a.p.onGround; i++) steps(a.world, 1);
    steps(a.world, 4);
    expect(a.p.sprinting).toBe(true);
    const b = setup();
    right(b);
    steps(b.world, SEC + 5);
    b.input.press('jump');
    steps(b.world, 4);
    left(b);
    steps(b.world, 2);
    expect(b.p.sprinting).toBe(false);
    steps(b.world, 20);
    expect(b.p.vx).toBeLessThan(0);
    expect(Math.abs(b.p.vx)).toBeLessThanOrEqual(RUN_SPEED);
  });

  it('a jump out of an ordinary run does not get faster', () => {
    const t = setup();
    right(t);
    steps(t.world, 20);
    t.input.tap('jump');
    steps(t.world, 10);
    expect(t.p.vx).toBe(150);
  });
});

describe('sprint: the kill-streak frenzy (광란 질주)', () => {
  it('3 kills, each within 2.5 s of the one before, start it: 5 s, a pop text, a shake, the crit sound at pitch 1.3', () => {
    const t = setup();
    const texts: string[] = [];
    t.world.fx.text = ((_x: number, _y: number, s: string) => { texts.push(s); }) as never;
    const shake = vi.spyOn(t.world, 'shake');
    kill(t);
    steps(t.world, 60);
    kill(t);
    expect(t.p.frenzyT).toBe(0);
    steps(t.world, 100);
    kill(t); // 1.67 s after the second
    expect(t.p.frenzyT).toBe(SPRINT.frenzyTime);
    expect(texts).toEqual(['광란 질주!']);
    expect(shake).toHaveBeenCalledWith(1, expect.anything());
    expect(t.sounds.filter((s) => s.s === 'crit' && s.pitch === 1.3)).toHaveLength(1);
  });

  it('kills too far apart do not count; a gap longer than 2.5 s starts the count over', () => {
    const t = setup();
    kill(t);
    steps(t.world, 60 * 3);
    kill(t);
    steps(t.world, 60 * 3);
    kill(t);
    expect(t.p.frenzyT).toBe(0);
    kill(t);
    kill(t);
    expect(t.p.frenzyT).toBe(SPRINT.frenzyTime); // three in a row now
  });

  it('every further kill makes it full again; it runs out 5 s after the last one', () => {
    const t = setup();
    const texts: string[] = [];
    t.world.fx.text = ((_x: number, _y: number, s: string) => { texts.push(s); }) as never;
    kill(t); kill(t); kill(t);
    steps(t.world, 60 * 3);
    expect(t.p.frenzyT).toBeCloseTo(2, 1);
    kill(t); // 3 s after the last one: more than the streak window, but it runs, so it is refreshed
    expect(t.p.frenzyT).toBe(SPRINT.frenzyTime);
    expect(texts).toHaveLength(1); // the pop is for the start only
    steps(t.world, 60 * 4);
    expect(t.p.frenzyT).toBeGreaterThan(0);
    steps(t.world, 70);
    expect(t.p.frenzyT).toBe(0);
  });

  it('during the frenzy every movement is a sprint at once (no run-up); in the air too', () => {
    const t = setup();
    kill(t); kill(t); kill(t);
    right(t);
    steps(t.world, 12);
    expect([t.p.sprinting, t.p.vx]).toEqual([true, 240]);
    expect(t.p.anim!.name).toBe('sprint');
    // standing still ends it (past the end grace) but the next step is a sprint again
    stop(t);
    steps(t.world, 12);
    expect([t.p.sprinting, t.p.vx]).toEqual([false, 0]);
    left(t);
    steps(t.world, 12);
    expect([t.p.sprinting, t.p.vx]).toEqual([true, -240]);
    t.input.tap('jump');
    steps(t.world, 5);
    expect(t.p.onGround).toBe(false);
    expect(t.p.vx).toBe(-240);
  });

  it('an attack ends the sprint but not the frenzy: moving again is a sprint at once', () => {
    const t = setup();
    kill(t); kill(t); kill(t);
    right(t);
    steps(t.world, 12);
    t.input.tap('attack1');
    steps(t.world, 2);
    expect(t.p.sprinting).toBe(false);
    expect(t.p.frenzyT).toBeGreaterThan(4);
    for (let i = 0; i < 100 && t.p.state === 'attack'; i++) steps(t.world, 1);
    steps(t.world, 8);
    expect(t.p.sprinting).toBe(true);
  });

  it('when the frenzy runs out a sprint it carried falls back to a normal run and the run-up starts over', () => {
    const t = setup(flatMap(200), 120);
    kill(t); kill(t); kill(t);
    right(t);
    steps(t.world, 60 * 5 - 20);
    expect(t.p.sprinting).toBe(true);
    steps(t.world, 40);
    expect(t.p.frenzyT).toBe(0);
    expect([t.p.sprinting, t.p.vx]).toEqual([false, 150]);
    steps(t.world, 20); // 0.67 s after it ran out
    expect(t.p.sprinting).toBe(false);
    steps(t.world, 15); // the run-up of 0.9 s is over
    expect(t.p.sprinting).toBe(true);
  });

  it('a death ends the sprint and no kill starts a frenzy afterwards', () => {
    const t = setup();
    right(t);
    steps(t.world, SEC + 5);
    t.p.takeDamage({ amount: 99999, dir: 1, kind: 'melee', unblockable: true });
    steps(t.world, 20);
    expect(t.p.sprinting).toBe(false);
    kill(t); kill(t); kill(t);
    expect(t.p.frenzyT).toBe(0);
  });

  it('startFrenzy() (the debug hook) starts it like three kills do', () => {
    const t = setup();
    t.p.startFrenzy();
    expect(t.p.frenzyT).toBe(SPRINT.frenzyTime);
  });
});

describe('sprint: the motion', () => {
  it('stores a frame every 0.05 s while sprinting and keeps the last 4; they drain when the sprint ends', () => {
    const t = setup();
    right(t);
    steps(t.world, SEC + 6);
    const imgs = () => (t.p as unknown as { afterImgs: { x: number }[] }).afterImgs;
    steps(t.world, 5);
    expect(imgs().length).toBeGreaterThan(0);
    steps(t.world, 30);
    expect(imgs()).toHaveLength(4);
    // newest first: further along the way
    expect(imgs()[0].x).toBeGreaterThan(imgs()[3].x);
    expect(imgs()[0].x - imgs()[1].x).toBeCloseTo(240 * SPRINT.after.interval, 0);
    stop(t);
    steps(t.world, 30);
    expect(imgs()).toHaveLength(0);
  });

  it('draws them behind her, tinted cyan (red in the frenzy), alpha 0.35 for the newest to 0.08 for the oldest', () => {
    const t = setup();
    right(t);
    steps(t.world, SEC + 40);
    const sheet = t.p.anim!.sheet;
    const draw = vi.spyOn(sheet, 'draw').mockImplementation(() => {});
    const ctx = fakeCtx();
    t.p.draw(ctx);
    const calls = draw.mock.calls.map((c) => c[6] as { tint?: string; alpha?: number } | undefined);
    const tinted = calls.filter((o) => o?.tint);
    expect(tinted).toHaveLength(4);
    expect(tinted.every((o) => o!.tint === '#4fe3ff')).toBe(true);
    // oldest first: the alpha rises towards the newest
    expect(tinted.map((o) => Math.round(o!.alpha! * 100) / 100)).toEqual([0.08, 0.17, 0.26, 0.35]);
    expect(calls[calls.length - 1]?.tint).toBeUndefined(); // the heroine herself is drawn last
    kill(t); kill(t); kill(t);
    steps(t.world, 40);
    draw.mockClear();
    t.p.draw(ctx);
    expect(draw.mock.calls.map((c) => (c[6] as { tint?: string } | undefined)?.tint).filter(Boolean).every((c) => c === '#ff4a6a')).toBe(true);
    // not sprinting: nothing is drawn behind her
    stop(t);
    steps(t.world, 60);
    draw.mockClear();
    t.p.draw(ctx);
    expect(draw.mock.calls.filter((c) => (c[6] as { tint?: string } | undefined)?.tint)).toHaveLength(0);
  });

  it('a dust puff at the footfall frames of the sprint stride, bigger than the run\'s', () => {
    const t = setup();
    const puffs: number[] = [];
    const orig = t.world.particles.emit.bind(t.world.particles);
    t.world.particles.emit = ((preset: string, x: number, y: number, o?: { count?: number }) => {
      if (preset === 'dust') puffs.push(o?.count ?? 0);
      return orig(preset as never, x, y, o as never);
    }) as never;
    right(t);
    steps(t.world, 40);
    expect(Math.max(...puffs)).toBe(1); // running: single puffs
    puffs.length = 0;
    steps(t.world, SEC);
    expect(puffs.filter((c) => c === 3).length).toBeGreaterThan(0);
  });

  it('the speed lines and the glow are drawn only while sprinting', () => {
    const t = setup();
    vi.spyOn(t.p.anim!.sheet, 'draw').mockImplementation(() => {});
    const ctx = fakeCtx();
    const rects = (ctx as unknown as { fillRect: { mock: { calls: number[][] } } }).fillRect;
    t.p.draw(ctx);
    expect(rects.mock.calls).toHaveLength(0);
    right(t);
    steps(t.world, SEC + 5);
    t.p.draw(ctx);
    expect(rects.mock.calls.filter((c) => c[3] === 1).length).toBe(4); // four 1 px tall lines
  });
});

describe('animation fallbacks (docs/CONTENT4.md §5)', () => {
  const sheetWith = (names: string[]): SpriteSheet => {
    const anims: Record<string, AnimDef> = {};
    names.forEach((n, i) => { anims[n] = { row: i, frames: 4, fps: 10, loop: true }; });
    return new SpriteSheet('t', { width: 1, height: 1 } as unknown as CanvasImageSource, { image: '', frameW: 8, frameH: 8, anchor: [4, 8], animations: anims });
  };

  it('the table: whip -> spear, heavy -> hammer / sword_3, cast -> throw, sprint -> run', () => {
    expect(ANIM_FALLBACK).toEqual({
      whip_1: ['spear_1'], whip_2: ['spear_2'], heavy_1: ['hammer_1'], heavy_2: ['hammer_2'], heavy_3: ['sword_3'], cast: ['throw'], sprint: ['run'],
    });
  });

  it('a missing animation plays its fallback; one the sheet has plays as itself; one with no fallback is left alone', () => {
    const old = sheetWith(['idle', 'run', 'spear_1', 'spear_2', 'hammer_1', 'hammer_2', 'sword_3', 'throw']);
    for (const [name, to] of [['sprint', 'run'], ['whip_1', 'spear_1'], ['whip_2', 'spear_2'], ['heavy_1', 'hammer_1'], ['heavy_2', 'hammer_2'], ['heavy_3', 'sword_3'], ['cast', 'throw']]) {
      expect(old.resolve(name), name).toBe(to);
      expect(resolveAnim(old, name), name).toBe(to);
      const a = new AnimPlayer(old);
      a.play(name);
      expect(a.name, `play ${name}`).toBe(to);
      a.playFor(name, 0.5);
      expect(a.name, `playFor ${name}`).toBe(to);
      a.playPhased(name, 0.1, 0.1, 0.1);
      expect(a.name, `playPhased ${name}`).toBe(to);
    }
    const art = sheetWith(['idle', 'run', 'sprint', 'whip_1', 'heavy_3', 'spear_1', 'sword_3']);
    expect(art.resolve('sprint')).toBe('sprint');
    expect(art.resolve('whip_1')).toBe('whip_1');
    expect(art.resolve('heavy_3')).toBe('heavy_3');
    expect(art.resolve('whip_2')).toBe('whip_2'); // no fallback exists (spear_2 is missing): unchanged
    expect(art.resolve('idle')).toBe('idle');
    expect(art.resolve('nope')).toBe('nope');
    // a placeholder sheet (it has every name) never maps
    expect(fakeSheet().resolve('sprint')).toBe('sprint');
  });

  it('the heroine plays the run animation when the sheet has no sprint row yet', () => {
    const t = setup();
    const sheet = sheetWith(['idle', 'run', 'jump', 'fall']);
    t.p.anim = new AnimPlayer(sheet);
    right(t);
    steps(t.world, SEC + 10);
    expect(t.p.sprinting).toBe(true);
    expect(t.p.anim.name).toBe('run');
  });
});

function fakeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {};
  const fns = new Map<string, unknown>();
  return new Proxy(target, {
    get(tg, k: string) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k in tg) return tg[k];
      if (!fns.has(k)) fns.set(k, vi.fn());
      return fns.get(k);
    },
    set(tg, k: string, v) {
      tg[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
