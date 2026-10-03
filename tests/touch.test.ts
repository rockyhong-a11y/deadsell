import { describe, it, expect } from 'vitest';
import { GestureRecognizer, GESTURE, classifySwipe, applyGestureActions, type GestureAction } from '../src/game/ui/touch';
import { Input } from '../src/engine/input';
import type { TapRegion } from '../src/game/ui/taps';

const W = 800;
const H = 360;
const LEFT = { x: 200, y: 220 };
const RIGHT = { x: 600, y: 220 };

function make(hit?: (x: number, y: number) => TapRegion | null) {
  return new GestureRecognizer({ viewW: () => W, hitTest: hit });
}
const kinds = (a: GestureAction[]) => a.map((x) => (x.t === 'press' || x.t === 'release' || x.t === 'tap' ? `${x.t}:${x.btn}` : x.t === 'roll' ? `roll:${x.dir}` : x.t));

describe('swipe classification', () => {
  it('maps displacements to directions (up has a wider sector)', () => {
    expect(classifySwipe(0, -20)).toBe('up');
    expect(classifySwipe(10, -20)).toBe('up');
    expect(classifySwipe(20, -10)).toBe('right');
    expect(classifySwipe(-20, -10)).toBe('left');
    expect(classifySwipe(0, 20)).toBe('down');
    expect(classifySwipe(20, 5)).toBe('right');
    expect(classifySwipe(-20, 5)).toBe('left');
  });
});

describe('right half: tap / swipe / long press', () => {
  it('quick tap = attack1', () => {
    const r = make();
    expect(r.down(1, RIGHT.x, RIGHT.y, 0)).toEqual([]);
    expect(kinds(r.up(1, RIGHT.x, RIGHT.y, 0.1))).toEqual(['tap:attack1']);
  });

  it('a tap may wobble by less than the slop', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    r.move(1, RIGHT.x + 6, RIGHT.y - 5, 0.05);
    expect(kinds(r.up(1, RIGHT.x + 6, RIGHT.y - 5, 0.1))).toEqual(['tap:attack1']);
  });

  it('moving past the slop without reaching swipe distance is neither tap nor swipe', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    expect(r.move(1, RIGHT.x + GESTURE.tapSlop + 2, RIGHT.y, 0.05)).toEqual([]);
    expect(r.up(1, RIGHT.x + GESTURE.tapSlop + 2, RIGHT.y, 0.1)).toEqual([]);
  });

  it('swipe up is recognised DURING the move, not on release', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    expect(r.move(1, RIGHT.x, RIGHT.y - 10, 0.02)).toEqual([]);
    expect(kinds(r.move(1, RIGHT.x, RIGHT.y - GESTURE.swipeDist, 0.04))).toEqual(['press:jump']);
    // still held: finger stays down, jump stays pressed
    expect(r.update(0.3)).toEqual([]);
    // lifting releases the jump (variable height)
    expect(kinds(r.up(1, RIGHT.x, RIGHT.y - GESTURE.swipeDist, 0.4))).toEqual(['release:jump']);
  });

  it('swipe threshold is 18 px', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    expect(r.move(1, RIGHT.x, RIGHT.y - 17, 0.03)).toEqual([]);
    expect(kinds(r.move(1, RIGHT.x, RIGHT.y - 18, 0.04))).toEqual(['press:jump']);
  });

  it('a quick flick still holds jump for minJumpHold', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    r.move(1, RIGHT.x, RIGHT.y - 25, 0.02);
    expect(r.up(1, RIGHT.x, RIGHT.y - 25, 0.04)).toEqual([]); // too early to release
    expect(r.update(0.05)).toEqual([]);
    expect(kinds(r.update(0.02 + GESTURE.minJumpHold + 0.001))).toEqual(['release:jump']);
  });

  it('swipe left / right = roll in that direction', () => {
    const a = make();
    a.down(1, RIGHT.x, RIGHT.y, 0);
    expect(kinds(a.move(1, RIGHT.x - 20, RIGHT.y, 0.05))).toEqual(['roll:-1']);
    const b = make();
    b.down(1, RIGHT.x, RIGHT.y, 0);
    expect(kinds(b.move(1, RIGHT.x + 20, RIGHT.y + 3, 0.05))).toEqual(['roll:1']);
    // no tap on release after a swipe
    expect(b.up(1, RIGHT.x + 20, RIGHT.y + 3, 0.1)).toEqual([]);
  });

  it('swipe down = down', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    expect(kinds(r.move(1, RIGHT.x + 2, RIGHT.y + 22, 0.05))).toEqual(['tap:down']);
  });

  it('a long stroke keeps rolling only once; a second stroke rolls again', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    expect(kinds(r.move(1, RIGHT.x + 20, RIGHT.y, 0.05))).toEqual(['roll:1']);
    expect(r.move(1, RIGHT.x + 45, RIGHT.y, 0.08)).toEqual([]); // same stroke
    // reverse stroke is the return of the thumb: ignored
    expect(r.move(1, RIGHT.x + 20, RIGHT.y, 0.12)).toEqual([]);
  });

  it('long press (>= 0.22 s, still) = attack2 held until release, no tap', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    expect(r.update(GESTURE.longPress - 0.01)).toEqual([]);
    expect(kinds(r.update(GESTURE.longPress))).toEqual(['press:attack2']);
    expect(r.view.holds.length).toBe(1);
    expect(kinds(r.up(1, RIGHT.x, RIGHT.y, 0.6))).toEqual(['release:attack2']);
    expect(r.view.holds.length).toBe(0);
  });

  it('moving beyond the slop before the threshold cancels the long press', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    r.move(1, RIGHT.x + 12, RIGHT.y, 0.1);
    expect(r.update(0.3)).toEqual([]);
  });

  it('a bow/shield hold is not broken by small drift but a clear swipe ends it', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    r.update(0.25);
    // held: swipes need 1.6x the distance
    expect(r.move(1, RIGHT.x + 22, RIGHT.y, 0.3)).toEqual([]);
    const out = kinds(r.move(1, RIGHT.x + 40, RIGHT.y, 0.35));
    expect(out).toContain('release:attack2');
    expect(out).toContain('roll:1');
  });

  it('pointercancel releases holds and never fires a tap', () => {
    const r = make();
    r.down(1, RIGHT.x, RIGHT.y, 0);
    r.update(0.3);
    expect(kinds(r.cancel(1, 0.4))).toEqual(['release:attack2']);
    const j = make();
    j.down(2, RIGHT.x, RIGHT.y, 0);
    j.move(2, RIGHT.x, RIGHT.y - 20, 0.03);
    expect(kinds(j.cancel(2, 0.05))).toEqual(['release:jump']);
    const t = make();
    t.down(3, RIGHT.x, RIGHT.y, 0);
    expect(t.cancel(3, 0.05)).toEqual([]);
    expect(t.active).toBe(0);
  });
});

describe('left half: floating joystick', () => {
  it('appears at the touch point and is analog with a dead-zone', () => {
    const r = make();
    r.down(1, LEFT.x, LEFT.y, 0);
    expect(r.view.joy).toMatchObject({ ox: LEFT.x, oy: LEFT.y, r: GESTURE.joyRadius });
    expect(r.move(1, LEFT.x + GESTURE.joyDead - 1, LEFT.y, 0.02)).toEqual([]);
    const half = r.move(1, LEFT.x + 11, LEFT.y, 0.03).find((a) => a.t === 'axis') as { x: number; y: number };
    expect(half.x).toBeGreaterThan(0.2);
    expect(half.x).toBeLessThan(0.9);
    const full = r.move(1, LEFT.x + 24, LEFT.y, 0.04).find((a) => a.t === 'axis') as { x: number; y: number };
    expect(full.x).toBe(1);
    expect(r.axis.x).toBe(1);
  });

  it('does not emit gameplay taps and resets on release', () => {
    const r = make();
    r.down(1, LEFT.x, LEFT.y, 0);
    r.move(1, LEFT.x - 20, LEFT.y, 0.03);
    expect(r.axis.x).toBe(-1);
    const out = r.up(1, LEFT.x - 20, LEFT.y, 0.05);
    expect(out).toEqual([{ t: 'axis', x: 0, y: 0 }]);
    expect(r.view.joy).toBeNull();
    // a quick tap on the left half is just a (zero) stick, no attack
    const q = make();
    q.down(1, LEFT.x, LEFT.y, 0);
    expect(kinds(q.up(1, LEFT.x, LEFT.y, 0.08))).toEqual(['axis']);
  });

  it('the stick base follows the thumb past the radius (instant reversal)', () => {
    const r = make();
    r.down(1, LEFT.x, LEFT.y, 0);
    r.move(1, LEFT.x + 60, LEFT.y, 0.05);
    expect(r.view.joy!.ox).toBeCloseTo(LEFT.x + 60 - GESTURE.joyRadius, 5);
    const back = r.move(1, LEFT.x + 60 - 20, LEFT.y, 0.08).find((a) => a.t === 'axis') as { x: number };
    expect(back.x).toBeLessThan(1);
  });

  it('pointercancel on the stick zeroes the axis', () => {
    const r = make();
    r.down(1, LEFT.x, LEFT.y, 0);
    r.move(1, LEFT.x + 20, LEFT.y, 0.03);
    expect(r.cancel(1, 0.05)).toEqual([{ t: 'axis', x: 0, y: 0 }]);
  });

  it('zones split at half of the view width', () => {
    const r = make();
    r.down(1, W / 2 - 1, 100, 0);
    expect(r.view.joy).not.toBeNull();
    const s = make();
    s.down(1, W / 2, 100, 0);
    expect(s.view.joy).toBeNull();
  });
});

describe('multi-touch', () => {
  it('stick and attack work at the same time', () => {
    const r = make();
    const input = new Input();
    const game = { input };
    applyGestureActions(game, r.down(1, LEFT.x, LEFT.y, 0));
    applyGestureActions(game, r.move(1, LEFT.x + 22, LEFT.y, 0.02));
    expect(input.moveX).toBe(1);
    applyGestureActions(game, r.down(2, RIGHT.x, RIGHT.y, 0.1));
    applyGestureActions(game, r.up(2, RIGHT.x, RIGHT.y, 0.16));
    expect(input.pressed('attack1')).toBe(true);
    expect(input.moveX).toBe(1); // stick unaffected
    // jump while still moving
    applyGestureActions(game, r.down(3, RIGHT.x, RIGHT.y, 0.3));
    applyGestureActions(game, r.move(3, RIGHT.x, RIGHT.y - 22, 0.33));
    expect(input.isDown('jump')).toBe(true);
    expect(input.moveX).toBe(1);
    applyGestureActions(game, r.up(3, RIGHT.x, RIGHT.y - 22, 0.6));
    expect(input.isDown('jump')).toBe(false);
    applyGestureActions(game, r.up(1, LEFT.x + 22, LEFT.y, 0.7));
    expect(input.moveX).toBe(0);
  });

  it('a second finger on the left half is a gesture finger, not a second stick', () => {
    const r = make();
    r.down(1, LEFT.x, LEFT.y, 0);
    r.down(2, LEFT.x + 40, LEFT.y, 0.01);
    expect(r.view.joy!.ox).toBe(LEFT.x);
    expect(kinds(r.up(2, LEFT.x + 40, LEFT.y, 0.05))).toEqual(['tap:attack1']);
  });

  it('long press and stick together', () => {
    const r = make();
    r.down(1, LEFT.x, LEFT.y, 0);
    r.down(2, RIGHT.x, RIGHT.y, 0.01);
    expect(kinds(r.update(0.3))).toEqual(['press:attack2']);
    r.move(1, LEFT.x - 20, LEFT.y, 0.35);
    expect(r.axis.x).toBe(-1);
    expect(r.view.holds.length).toBe(1);
  });
});

describe('UI taps have priority over gestures', () => {
  const flask: TapRegion = { id: 'flask', rect: { x: 560, y: 200, w: 60, h: 60 }, mode: 'down', onTap: () => {} };
  const bubble: TapRegion = { id: 'bubble', rect: { x: 100, y: 100, w: 60, h: 40 }, mode: 'up', onTap: () => {} };
  const hit = (x: number, y: number) => [flask, bubble].find((r) => x >= r.rect.x && x < r.rect.x + r.rect.w && y >= r.rect.y && y < r.rect.y + r.rect.h) ?? null;

  it("'down' regions fire on press and produce no gesture", () => {
    const r = make(hit);
    const down = r.down(1, 580, 220, 0);
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ t: 'ui', phase: 'tap' });
    // dragging/lifting this finger never becomes attack/jump/roll
    expect(r.move(1, 580, 150, 0.05)).toEqual([]);
    expect(r.up(1, 580, 150, 0.1)).toEqual([]);
  });

  it("'up' regions fire on release inside, even in the joystick half, and never start a stick", () => {
    const r = make(hit);
    expect(r.down(1, 120, 120, 0)).toEqual([]);
    expect(r.view.joy).toBeNull();
    const out = r.up(1, 125, 122, 0.1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ t: 'ui', phase: 'tap', region: { id: 'bubble' } });
  });

  it("'up' regions do not fire when the finger is released outside", () => {
    const r = make(hit);
    r.down(1, 120, 120, 0);
    expect(r.up(1, 300, 300, 0.1)).toEqual([]);
  });

  it('a region with onDrag reports drags and only taps when the finger did not travel', () => {
    const drags: number[] = [];
    const map: TapRegion = { id: 'map', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => {}, onDrag: (dx) => drags.push(dx) };
    const r = make(() => map);
    r.down(1, 300, 200, 0);
    expect(r.move(1, 304, 200, 0.03)).toEqual([]); // inside the tap slop
    const mv = r.move(1, 330, 200, 0.05);
    expect(mv[0]).toMatchObject({ t: 'ui', phase: 'drag', dx: 30 }); // first delta = distance since the press
    expect(r.move(1, 335, 200, 0.06)[0]).toMatchObject({ phase: 'drag', dx: 5 });
    expect(r.up(1, 335, 200, 0.1)).toEqual([]);
    r.down(2, 300, 200, 1);
    expect(r.up(2, 302, 201, 1.05)).toHaveLength(1);
  });

  it('actions are applied to the region callbacks', () => {
    let taps = 0;
    const reg: TapRegion = { id: 'x', rect: { x: 0, y: 0, w: 100, h: 100 }, mode: 'down', onTap: () => taps++ };
    const r = make(() => reg);
    applyGestureActions({ input: new Input() }, r.down(1, 10, 10, 0));
    expect(taps).toBe(1);
  });
});

describe('applyGestureActions', () => {
  it('maps recogniser output onto Input', () => {
    const input = new Input();
    const game = { input };
    applyGestureActions(game, [{ t: 'roll', dir: -1 }]);
    expect(input.rollDir).toBe(-1);
    expect(input.pressed('roll')).toBe(true);
    applyGestureActions(game, [{ t: 'axis', x: 0.5, y: 0 }]);
    expect(input.moveX).toBe(0.5);
    applyGestureActions(game, [{ t: 'press', btn: 'attack2' }]);
    expect(input.isDown('attack2')).toBe(true);
    applyGestureActions(game, [{ t: 'release', btn: 'attack2' }]);
    expect(input.isDown('attack2')).toBe(false);
    applyGestureActions(game, [{ t: 'tap', btn: 'down' }]);
    expect(input.pressed('down')).toBe(true);
  });
});
