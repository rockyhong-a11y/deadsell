import { describe, it, expect } from 'vitest';
import { vbLayout, hitTestV, VButtonController, VB_BOTTOM_MARGIN, VSIZE, type VLayout, type VId } from '../src/game/ui/vbuttons';
import { applyGestureActions, type GestureAction } from '../src/game/ui/touch';
import { hudLayout } from '../src/game/ui/hud';
import { Input } from '../src/engine/input';
import { BUTTON_SIZES } from '../src/game/meta/save';
import type { AABB } from '../src/engine/math';

const H = 360;
const WIDTHS = [480, 520, 568, 640, 667, 700, 740, 777, 800];

const overlap = (a: AABB, b: AABB) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const centre = (L: VLayout, id: VId) => {
  const b = L.buttons.find((x) => x.id === id)!;
  return { x: b.cx, y: b.cy };
};

describe('virtual button layout', () => {
  for (const size of BUTTON_SIZES) {
    for (const W of WIDTHS) {
      it(`fits the view, has >= 40 px targets and no overlaps (W=${W}, ${size})`, () => {
        const L = vbLayout(W, H, size, [true, true]);
        expect(L.buttons.map((b) => b.id).sort()).toEqual(['attack', 'down', 'jump', 'left', 'right', 'roll', 'skill1', 'skill2', 'sub']);
        for (const b of L.buttons) {
          expect(b.hit.w, b.id).toBeGreaterThanOrEqual(40);
          expect(b.hit.h, b.id).toBeGreaterThanOrEqual(40);
          expect(b.hit.x, b.id).toBeGreaterThanOrEqual(0);
          expect(b.hit.y, b.id).toBeGreaterThanOrEqual(0);
          expect(b.hit.x + b.hit.w, b.id).toBeLessThanOrEqual(W);
          expect(b.hit.y + b.hit.h, b.id).toBeLessThanOrEqual(H - VB_BOTTOM_MARGIN);
          // the drawn circle / key is inside its touch target
          expect(b.r, b.id).toBeLessThanOrEqual(b.hit.w / 2 + 0.001);
        }
        // touch targets never overlap each other
        for (let i = 0; i < L.buttons.length; i++) {
          for (let j = i + 1; j < L.buttons.length; j++) {
            expect(overlap(L.buttons[i].hit, L.buttons[j].hit), `${L.buttons[i].id} x ${L.buttons[j].id}`).toBe(false);
          }
        }
      });

      it(`stays clear of the HUD (W=${W}, ${size})`, () => {
        const L = vbLayout(W, H, size, [true, true]);
        const hud = hudLayout(W, H, 3);
        const blocks: Record<string, AABB> = {
          hp: hud.hp,
          flask: hud.flask,
          counters: { x: hud.gold.x - 4, y: hud.gold.y - 12, w: 120, h: 24 },
          minimap: hud.minimap,
          pause: hud.pause,
          weapons: { x: hud.weapons[0].x, y: hud.weapons[0].y, w: hud.weapons[1].x + hud.weapons[1].w - hud.weapons[0].x, h: hud.weapons[0].h },
          // boss bar with its name label above it
          boss: { x: hud.boss.x, y: hud.boss.y - 14, w: hud.boss.w, h: hud.boss.h + 14 },
        };
        for (const b of L.buttons) {
          for (const [name, r] of Object.entries(blocks)) expect(overlap(b.hit, r), `${b.id} x HUD ${name}`).toBe(false);
        }
        // the d-pad catch area (slide margin) stays clear as well
        for (const [name, r] of Object.entries(blocks)) expect(overlap(L.dpad, r), `dpad area x HUD ${name}`).toBe(false);
      });
    }
  }

  it('skill buttons exist only for equipped skills', () => {
    const ids = (s: [boolean, boolean]) => vbLayout(640, H, 'medium', s).buttons.map((b) => b.id).filter((i) => i.startsWith('skill'));
    expect(ids([false, false])).toEqual([]);
    expect(ids([true, false])).toEqual(['skill1']);
    expect(ids([false, true])).toEqual(['skill2']);
    expect(ids([true, true])).toEqual(['skill1', 'skill2']);
  });

  it('bigger size = bigger buttons', () => {
    const area = (s: 'small' | 'medium' | 'large') => vbLayout(640, H, s).buttons.find((b) => b.id === 'attack')!.hit.w;
    expect(area('small')).toBeLessThan(area('medium'));
    expect(area('medium')).toBeLessThan(area('large'));
    expect(VSIZE.small).toBeLessThan(VSIZE.large);
  });
});

describe('hit testing', () => {
  const L = vbLayout(640, H, 'medium', [true, true]);

  it('the centre of every button hits that button', () => {
    for (const b of L.buttons) expect(hitTestV(L, b.cx, b.cy)?.id).toBe(b.id);
  });

  it('empty screen does not hit', () => {
    expect(hitTestV(L, 320, 150)).toBeNull();
    expect(hitTestV(L, 5, 5)).toBeNull();
  });

  it('the gap between ← and → still resolves to a d-pad key', () => {
    const l = centre(L, 'left');
    const r = centre(L, 'right');
    const hit = hitTestV(L, (l.x + r.x) / 2, l.y);
    expect(hit?.kind).toBe('dpad');
  });
});

describe('multi-touch controller', () => {
  const L = vbLayout(640, H, 'medium', [true, true]);
  const kinds = (a: GestureAction[]) => a.map((x) => (x.t === 'axis' ? `axis:${x.x},${x.y}` : x.t === 'roll' ? `roll:${x.dir}` : `${x.t}:${(x as { btn: string }).btn}`));

  it('a finger on → moves right and releases on lift', () => {
    const c = new VButtonController();
    const p = centre(L, 'right');
    expect(kinds(c.down(1, p.x, p.y, L))).toEqual(['axis:1,0']);
    expect(c.axis).toEqual({ x: 1, y: 0 });
    expect(c.owns(1)).toBe(true);
    expect(kinds(c.up(1))).toEqual(['axis:0,0']);
    expect(c.axis).toEqual({ x: 0, y: 0 });
    expect(c.owns(1)).toBe(false);
  });

  it('hold → + jump + attack at the same time, each pointer releases only its own button', () => {
    const c = new VButtonController();
    const input = new Input();
    const go = (acts: GestureAction[]) => applyGestureActions({ input }, acts);
    const right = centre(L, 'right');
    const jump = centre(L, 'jump');
    const attack = centre(L, 'attack');
    go(c.down(1, right.x, right.y, L));
    go(c.down(2, jump.x, jump.y, L));
    go(c.down(3, attack.x, attack.y, L));
    expect(input.moveX).toBe(1);
    expect(input.isDown('jump')).toBe(true);
    expect(input.isDown('attack1')).toBe(true);
    // jump held = variable height: releasing the jump finger releases jump only
    go(c.up(2));
    expect(input.isDown('jump')).toBe(false);
    expect(input.isDown('attack1')).toBe(true);
    expect(input.moveX).toBe(1);
    go(c.up(3));
    expect(input.isDown('attack1')).toBe(false);
    expect(input.moveX).toBe(1);
    go(c.up(1));
    expect(input.moveX).toBe(0);
    expect(c.active).toBe(false);
  });

  it('a quick tap between two fixed steps is still seen once (press + release edges)', () => {
    const c = new VButtonController();
    const input = new Input();
    const a = centre(L, 'attack');
    applyGestureActions({ input }, c.down(7, a.x, a.y, L));
    applyGestureActions({ input }, c.up(7));
    expect(input.pressed('attack1')).toBe(true);
    expect(input.released('attack1')).toBe(true);
    expect(input.isDown('attack1')).toBe(false);
    expect(input.pressedWithin('attack1', 0.1)).toBe(true);
  });

  it('sliding between ← and → switches direction without lifting', () => {
    const c = new VButtonController();
    const l = centre(L, 'left');
    const r = centre(L, 'right');
    expect(kinds(c.down(1, l.x, l.y, L))).toEqual(['axis:-1,0']);
    expect(kinds(c.move(1, r.x, r.y, L))).toEqual(['axis:1,0']);
    expect(kinds(c.move(1, r.x + 1, r.y, L))).toEqual([]);
    // off the d-pad: stops; back on: moves again
    expect(kinds(c.move(1, 320, 100, L))).toEqual(['axis:0,0']);
    expect(kinds(c.move(1, l.x, l.y, L))).toEqual(['axis:-1,0']);
    expect(kinds(c.up(1))).toEqual(['axis:0,0']);
  });

  it('↓ presses the down action and sets axis y; sliding ← -> ↓ keeps one pointer', () => {
    const c = new VButtonController();
    const l = centre(L, 'left');
    const d = centre(L, 'down');
    c.down(1, l.x, l.y, L);
    const acts = kinds(c.move(1, d.x, d.y, L));
    expect(acts).toContain('press:down');
    expect(acts).toContain('axis:0,1');
    expect(kinds(c.up(1))).toEqual(['release:down', 'axis:0,0']);
  });

  it('two fingers on ← and ↓ together (diagonal)', () => {
    const c = new VButtonController();
    const l = centre(L, 'left');
    const d = centre(L, 'down');
    c.down(1, l.x, l.y, L);
    c.down(2, d.x, d.y, L);
    expect(c.axis).toEqual({ x: -1, y: 1 });
    c.up(2);
    expect(c.axis).toEqual({ x: -1, y: 0 });
  });

  it('an action button keeps its finger even when it drifts off (no sliding)', () => {
    const c = new VButtonController();
    const a = centre(L, 'attack');
    const j = centre(L, 'jump');
    c.down(1, a.x, a.y, L);
    expect(c.move(1, j.x, j.y, L)).toEqual([]);
    expect(c.isDown('attack')).toBe(true);
    expect(c.isDown('jump')).toBe(false);
    expect(kinds(c.up(1))).toEqual(['release:attack1']);
  });

  it('roll is a tap that uses the held direction / facing (dir 0)', () => {
    const c = new VButtonController();
    const r = centre(L, 'roll');
    expect(c.down(1, r.x, r.y, L)).toEqual([{ t: 'roll', dir: 0 }]);
    expect(c.up(1)).toEqual([]);
    const input = new Input();
    input.rollDir = 1;
    applyGestureActions({ input }, [{ t: 'roll', dir: 0 }]);
    expect(input.rollDir).toBe(0);
    expect(input.pressed('roll')).toBe(true);
  });

  it('skills and the secondary weapon map to their actions', () => {
    const c = new VButtonController();
    const want: [VId, string][] = [['sub', 'attack2'], ['skill1', 'skill1'], ['skill2', 'skill2'], ['jump', 'jump']];
    for (const [id, btn] of want) {
      const p = centre(L, id);
      expect(kinds(c.down(10, p.x, p.y, L))).toEqual([`press:${btn}`]);
      expect(kinds(c.up(10))).toEqual([`release:${btn}`]);
    }
  });

  it('pointercancel / cancelAll release everything', () => {
    const c = new VButtonController();
    const input = new Input();
    for (const [pid, id] of [[1, 'right'], [2, 'attack'], [3, 'jump']] as [number, VId][]) {
      const p = centre(L, id);
      applyGestureActions({ input }, c.down(pid, p.x, p.y, L));
    }
    applyGestureActions({ input }, c.cancel(2));
    expect(input.isDown('attack1')).toBe(false);
    applyGestureActions({ input }, c.cancelAll());
    expect(input.isDown('jump')).toBe(false);
    expect(input.moveX).toBe(0);
    expect(c.active).toBe(false);
    expect(c.cancel(99)).toEqual([]);
  });

  it('two fingers on the same button release it only when both are up', () => {
    const c = new VButtonController();
    const a = centre(L, 'attack');
    expect(kinds(c.down(1, a.x, a.y, L))).toEqual(['press:attack1']);
    expect(kinds(c.down(2, a.x, a.y, L))).toEqual([]);
    expect(kinds(c.up(1))).toEqual([]);
    expect(c.isDown('attack')).toBe(true);
    expect(kinds(c.up(2))).toEqual(['release:attack1']);
  });

  it('a touch that misses every button is not owned (it goes to the gesture layer / UI)', () => {
    const c = new VButtonController();
    expect(c.down(1, 320, 100, L)).toEqual([]);
    expect(c.owns(1)).toBe(false);
  });

  it('uses its own axis source so the gesture stick and the keyboard are unaffected', () => {
    const input = new Input();
    input.setAxis('kb', 1, 0);
    applyGestureActions({ input }, [{ t: 'axis', x: -1, y: 0, src: 'vbtn' }]);
    expect(input.moveX).toBe(0); // 1 + -1 (summed per source, clamped)
    applyGestureActions({ input }, [{ t: 'axis', x: 0, y: 0, src: 'vbtn' }]);
    expect(input.moveX).toBe(1);
  });
});
