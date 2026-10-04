import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_PAD_MAP, PAD_ACTIONS, PAD_DEADZONE, PAD_REPEAT_DELAY, GamepadManager, assignButton, mapPad, newPadState,
  padButtonName, padShortName, sanitizePadMap, stickToAxis, type PadMap, type PadSnapshot, type PadState,
} from '../src/engine/gamepad';
import { Input } from '../src/engine/input';

const snap = (pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): PadSnapshot => {
  const buttons = new Array(17).fill(false);
  for (const i of pressed) buttons[i] = true;
  return { id: 'Test Pad (STANDARD GAMEPAD)', axes, buttons };
};
const poll = (s: PadSnapshot | null, prev: PadState, map: PadMap = DEFAULT_PAD_MAP, dt = 1 / 60) => mapPad(s, map, prev, dt);

describe('stick dead-zone', () => {
  it('is zero inside the dead-zone and ramps to 1', () => {
    expect(PAD_DEADZONE).toBe(0.25);
    expect(stickToAxis(0.2, 0)).toEqual({ x: 0, y: 0 });
    expect(stickToAxis(0.24, 0.05)).toEqual({ x: 0, y: 0 });
    const small = stickToAxis(0.3, 0);
    expect(small.x).toBeGreaterThan(0);
    expect(small.x).toBeLessThan(0.1);
    expect(stickToAxis(1, 0).x).toBeCloseTo(1);
    expect(stickToAxis(-1, 0).x).toBeCloseTo(-1);
    const diag = stickToAxis(0.9, 0.9); // beyond the unit circle: clamped
    expect(Math.hypot(diag.x, diag.y)).toBeGreaterThan(0.99);
    expect(Math.abs(diag.x)).toBeLessThanOrEqual(1);
  });

  it('ignores NaN / non-finite axis values', () => {
    expect(stickToAxis(NaN, Infinity)).toEqual({ x: 0, y: 0 });
  });

  it('feeds the movement axis of the frame', () => {
    expect(poll(snap([], [0.1, 0.1]), newPadState()).frame).toMatchObject({ x: 0, y: 0 });
    expect(poll(snap([], [1, 0]), newPadState()).frame.x).toBeCloseTo(1);
    expect(poll(snap([], [-0.6, 0]), newPadState()).frame.x).toBeLessThan(-0.3);
  });
});

describe('default standard-layout mapping', () => {
  it('maps A B X Y LB RB LT RT to jump roll attack1 attack2 heal interact skill1 skill2', () => {
    const want = ['jump', 'roll', 'attack1', 'attack2', 'heal', 'interact', 'skill1', 'skill2'];
    want.forEach((btn, i) => {
      const { frame } = poll(snap([i]), newPadState());
      expect(frame.press).toEqual([btn]);
      expect(frame.release).toEqual([]);
    });
  });

  it('Back (8) = map and Start (9) = pause are menu keys', () => {
    expect(poll(snap([8]), newPadState()).frame.nav).toContain('map');
    expect(poll(snap([9]), newPadState()).frame.nav).toContain('pause');
  });

  it('A confirms and B cancels in menus', () => {
    expect(poll(snap([0]), newPadState()).frame.nav).toContain('confirm');
    expect(poll(snap([1]), newPadState()).frame.nav).toContain('cancel');
  });

  it('every action has its own default button', () => {
    expect(new Set(PAD_ACTIONS.map((a) => DEFAULT_PAD_MAP[a])).size).toBe(PAD_ACTIONS.length);
    expect(PAD_ACTIONS.map((a) => padButtonName(DEFAULT_PAD_MAP[a]))).toEqual(['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', '뒤로', '시작']);
  });
});

describe('button edges', () => {
  it('press fires once, release once; holding is silent', () => {
    let st = newPadState();
    let r = poll(snap([2]), st);
    expect(r.frame.press).toEqual(['attack1']);
    st = r.next;
    r = poll(snap([2]), st);
    expect(r.frame.press).toEqual([]);
    expect(r.frame.release).toEqual([]);
    st = r.next;
    r = poll(snap([]), st);
    expect(r.frame.release).toEqual(['attack1']);
    expect(r.frame.press).toEqual([]);
  });

  it('several buttons at once (multi-button play)', () => {
    const { frame } = poll(snap([0, 2]), newPadState());
    expect(frame.press.sort()).toEqual(['attack1', 'jump']);
    expect(frame.raw).toEqual([0, 2]);
  });

  it('a pad that disappears releases everything it held and zeroes the axis', () => {
    let st = poll(snap([0, 2], [1, 0]), newPadState()).next;
    const r = poll(null, st);
    expect(r.frame.release.sort()).toEqual(['attack1', 'jump']);
    expect(r.frame).toMatchObject({ x: 0, y: 0 });
    st = r.next;
    expect(poll(null, st).frame.release).toEqual([]);
  });

  it('works through Input (edges survive until endStep)', () => {
    const input = new Input();
    const { frame } = poll(snap([0]), newPadState());
    for (const b of frame.press) input.press(b);
    expect(input.pressed('jump')).toBe(true);
    expect(input.isDown('jump')).toBe(true);
    input.endStep(1 / 60);
    expect(input.pressed('jump')).toBe(false);
    expect(input.isDown('jump')).toBe(true);
  });
});

describe('d-pad and the down action', () => {
  it('d-pad left / right set the axis (and win over the stick)', () => {
    expect(poll(snap([15]), newPadState()).frame).toMatchObject({ x: 1, y: 0 });
    expect(poll(snap([14], [0.9, 0]), newPadState()).frame.x).toBe(-1);
  });

  it('d-pad down = axis y 1 + a down press; releasing releases it', () => {
    let r = poll(snap([13]), newPadState());
    expect(r.frame.y).toBe(1);
    expect(r.frame.press).toEqual(['down']);
    expect(r.frame.nav).toContain('down');
    r = poll(snap([13]), r.next);
    expect(r.frame.press).toEqual([]);
    r = poll(snap([]), r.next);
    expect(r.frame.release).toEqual(['down']);
  });

  it('stick pushed down past the threshold = down edge', () => {
    let r = poll(snap([], [0, 0.4]), newPadState());
    expect(r.frame.press).toEqual([]); // inside the dead-zone ramp: y = 0.2
    r = poll(snap([], [0, 0.95]), r.next);
    expect(r.frame.press).toEqual(['down']);
    r = poll(snap([], [0, 0]), r.next);
    expect(r.frame.release).toEqual(['down']);
  });

  it('d-pad buttons are never gameplay actions', () => {
    for (const b of [12, 13, 14, 15]) {
      expect(PAD_ACTIONS.some((a) => DEFAULT_PAD_MAP[a] === b)).toBe(false);
    }
    // up is a menu direction only
    const r = poll(snap([12]), newPadState());
    expect(r.frame.nav).toContain('up');
    expect(r.frame.press).toEqual([]);
  });
});

describe('menu navigation', () => {
  it('direction edges, then auto-repeat while held', () => {
    let st = newPadState();
    let r = poll(snap([], [1, 0]), st);
    expect(r.frame.nav).toEqual(['right']);
    st = r.next;
    const navs: number[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      r = poll(snap([], [1, 0]), st, DEFAULT_PAD_MAP, 1 / 60);
      st = r.next;
      t += 1 / 60;
      if (r.frame.nav.includes('right')) navs.push(t);
    }
    expect(navs.length).toBeGreaterThanOrEqual(3);
    expect(navs[0]).toBeGreaterThanOrEqual(PAD_REPEAT_DELAY - 0.02);
    expect(navs[1] - navs[0]).toBeLessThan(0.2);
  });

  it('a tapped direction fires exactly once', () => {
    let st = newPadState();
    let count = 0;
    for (const down of [true, true, false, false]) {
      const r = poll(snap(down ? [14] : []), st);
      st = r.next;
      count += r.frame.nav.filter((k) => k === 'left').length;
    }
    expect(count).toBe(1);
  });
});

describe('remapping', () => {
  it('assigning a free button just moves the action', () => {
    const m = assignButton(DEFAULT_PAD_MAP, 'jump', 10);
    expect(m.jump).toBe(10);
    expect(new Set(PAD_ACTIONS.map((a) => m[a])).size).toBe(PAD_ACTIONS.length);
  });

  it('assigning a used button swaps the two actions', () => {
    const m = assignButton(DEFAULT_PAD_MAP, 'jump', 2); // 2 = attack1's button
    expect(m.jump).toBe(2);
    expect(m.attack1).toBe(0);
    expect(new Set(PAD_ACTIONS.map((a) => m[a])).size).toBe(PAD_ACTIONS.length);
    // the input map is not modified
    expect(DEFAULT_PAD_MAP.jump).toBe(0);
  });

  it('a remapped action follows its new button', () => {
    const m = assignButton(DEFAULT_PAD_MAP, 'jump', 2);
    expect(poll(snap([2]), newPadState(), m).frame.press).toEqual(['jump']);
    expect(poll(snap([0]), newPadState(), m).frame.press).toEqual(['attack1']);
  });

  it('invalid buttons leave the map unchanged', () => {
    expect(assignButton(DEFAULT_PAD_MAP, 'jump', -1)).toEqual(DEFAULT_PAD_MAP);
    expect(assignButton(DEFAULT_PAD_MAP, 'jump', 1.5)).toEqual(DEFAULT_PAD_MAP);
    expect(assignButton(DEFAULT_PAD_MAP, 'jump', 99)).toEqual(DEFAULT_PAD_MAP);
  });

  it('assigning the current button is a no-op', () => {
    expect(assignButton(DEFAULT_PAD_MAP, 'roll', 1)).toEqual(DEFAULT_PAD_MAP);
  });

  it('menus keep using the physical A / B even when jump moved away', () => {
    const m = assignButton(DEFAULT_PAD_MAP, 'jump', 10);
    expect(poll(snap([0]), newPadState(), m).frame.nav).toContain('confirm');
  });
});

describe('sanitizePadMap (saved maps)', () => {
  it('undefined / garbage -> defaults', () => {
    expect(sanitizePadMap(undefined)).toEqual(DEFAULT_PAD_MAP);
    expect(sanitizePadMap('x')).toEqual(DEFAULT_PAD_MAP);
    expect(sanitizePadMap({ jump: 'a', roll: -3, attack1: 1.2, heal: 500 })).toEqual(DEFAULT_PAD_MAP);
  });

  it('keeps valid entries', () => {
    const m = sanitizePadMap({ jump: 3, attack2: 0 });
    expect(m.jump).toBe(3);
    expect(m.attack2).toBe(0);
  });

  it('duplicates are resolved so every action keeps its own button', () => {
    const m = sanitizePadMap({ jump: 5, roll: 5, attack1: 5 });
    expect(new Set(PAD_ACTIONS.map((a) => m[a])).size).toBe(PAD_ACTIONS.length);
    expect(m.jump).toBe(5);
    for (const a of PAD_ACTIONS) expect([12, 13, 14, 15]).not.toContain(m[a]);
  });
});

describe('names', () => {
  it('shortens a Gamepad.id for toasts', () => {
    expect(padShortName('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('Xbox 360 Controller');
    expect(padShortName('x'.repeat(60), 10)).toHaveLength(10);
    expect(padButtonName(30)).toBe('버튼 30');
  });
});

describe('GamepadManager (mocked navigator.getGamepads)', () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  afterEach(() => {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  function mockPads(list: () => unknown[]) {
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => list() }, configurable: true });
  }
  const pad = (pressed: number[], axes = [0, 0, 0, 0]) => ({
    id: 'Mock Pad', connected: true, mapping: 'standard', axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
  });

  it('reports connect / disconnect and produces frames', () => {
    let pads: unknown[] = [null, null, null, null];
    mockPads(() => pads);
    const m = new GamepadManager();
    const log: string[] = [];
    m.onConnect = (id) => log.push('on ' + id);
    m.onDisconnect = (id) => log.push('off ' + id);
    expect(m.update(DEFAULT_PAD_MAP, 1 / 60)).toBeNull();
    expect(m.connected).toBe(false);
    pads = [pad([])];
    expect(m.update(DEFAULT_PAD_MAP, 1 / 60)).not.toBeNull();
    expect(m.connected).toBe(true);
    expect(m.id).toBe('Mock Pad');
    pads = [pad([0], [1, 0])];
    const f = m.update(DEFAULT_PAD_MAP, 1 / 60)!;
    expect(f.press).toEqual(['jump']);
    expect(f.x).toBeCloseTo(1);
    pads = [null];
    const gone = m.update(DEFAULT_PAD_MAP, 1 / 60)!;
    expect(gone.release).toEqual(['jump']);
    expect(m.connected).toBe(false);
    expect(log).toEqual(['on Mock Pad', 'off Mock Pad']);
    expect(m.update(DEFAULT_PAD_MAP, 1 / 60)).toBeNull();
  });

  it('uses the analog value of triggers (> 0.5) as pressed', () => {
    const p = pad([]);
    (p.buttons[7] as { pressed: boolean; value: number }) = { pressed: false, value: 0.8 };
    mockPads(() => [p]);
    const m = new GamepadManager();
    const f = m.update(DEFAULT_PAD_MAP, 1 / 60)!;
    expect(f.press).toEqual(['skill2']);
  });

  it('survives getGamepads throwing / missing', () => {
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => { throw new Error('nope'); } }, configurable: true });
    const m = new GamepadManager();
    expect(m.update(DEFAULT_PAD_MAP, 1 / 60)).toBeNull();
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    expect(new GamepadManager().update(DEFAULT_PAD_MAP, 1 / 60)).toBeNull();
  });
});
