import type { Game } from '../game';
import type { Btn } from '../../engine/input';
import type { TapRegion } from './taps';
import { pointIn } from '../../engine/math';

/**
 * Touch / pointer controls (docs/DESIGN.md §4). OWNER: ui agent.
 *
 *  - A touch that starts inside a registered UI tap region (game.taps) belongs to the UI.
 *  - Otherwise the LEFT half is a floating joystick (appears where the thumb lands),
 *    the RIGHT half recognises gestures: tap = attack1, swipe up = jump (held while the
 *    finger stays down), swipe left/right = roll, swipe down = down (slam / drop),
 *    long press = attack2 (held until release).
 *
 * `GestureRecognizer` is pure (no DOM): feed it pointer down/move/up with timestamps
 * (seconds) and virtual coordinates; it returns the resulting actions. `attachTouch`
 * wires it to Pointer Events and applies the actions to `game.input`.
 */

export interface GestureConfig {
  /** a press released before this (s) without moving is a tap (folded up to `longPress` so no input is lost) */
  tapTime: number;
  /** max finger travel (virtual px) for a tap / long press */
  tapSlop: number;
  /** min travel (virtual px) for a swipe, measured from the swipe anchor */
  swipeDist: number;
  /** swipe distance multiplier while a long press is held (avoid accidental swipes while aiming/blocking) */
  holdSwipeMul: number;
  /** long-press threshold (s) */
  longPress: number;
  /** the jump button is held at least this long (s) after a swipe up, so a quick flick still gives a usable hop */
  minJumpHold: number;
  /** joystick radius (virtual px) */
  joyRadius: number;
  /** joystick dead-zone (virtual px) */
  joyDead: number;
  /** fraction of the radius at which the stick reaches full deflection */
  joyFull: number;
}

export const GESTURE: GestureConfig = {
  tapTime: 0.2,
  tapSlop: 10,
  swipeDist: 18,
  holdSwipeMul: 1.6,
  longPress: 0.22,
  minJumpHold: 0.1,
  joyRadius: 28,
  joyDead: 5,
  joyFull: 0.65,
};

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

export type GestureAction =
  | { t: 'press'; btn: Btn }
  | { t: 'release'; btn: Btn }
  | { t: 'tap'; btn: Btn }
  | { t: 'roll'; dir: -1 | 1 }
  | { t: 'axis'; x: number; y: number }
  | { t: 'ui'; phase: 'tap' | 'release' | 'drag'; region: TapRegion; dx?: number; dy?: number };

/** Visual state of the touch layer, drawn faintly by LevelUI. */
export interface TouchMark {
  kind: 'tap' | 'swipe' | 'hold';
  x: number;
  y: number;
  dir?: SwipeDir;
  /** recogniser time (s) the mark was created */
  t0: number;
}

export interface TouchView {
  /** floating joystick: base (ox, oy) and knob (kx, ky), virtual px; null when not touched */
  joy: { ox: number; oy: number; kx: number; ky: number; r: number } | null;
  /** fingers currently holding a long press */
  holds: { x: number; y: number; t0: number }[];
  /** short-lived feedback marks (taps, swipes) */
  marks: TouchMark[];
  /** recogniser clock (s) — age of a mark = now - t0 */
  now: number;
}

interface Finger {
  id: number;
  kind: 'joy' | 'gesture' | 'ui';
  sx: number;
  sy: number;
  st: number;
  x: number;
  y: number;
  /** max distance travelled from the start point */
  maxD: number;
  // gesture fingers
  ax: number;
  ay: number;
  lastDir: SwipeDir | null;
  lastFired: boolean;
  swiped: boolean;
  hold: boolean;
  jumpHeld: boolean;
  jumpAt: number;
  // joystick
  ox: number;
  oy: number;
  // ui
  region: TapRegion | null;
  /** ui finger has moved past the tap slop (drag regions) */
  dragging: boolean;
}

const OPPOSITE: Record<SwipeDir, SwipeDir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Classify a displacement. Up gets a wider sector (±55° from vertical) because jumping is the most common swipe. */
export function classifySwipe(dx: number, dy: number): SwipeDir {
  if (dy < 0 && -dy >= Math.abs(dx) * 0.7) return 'up';
  if (dy > 0 && dy >= Math.abs(dx)) return 'down';
  return dx < 0 ? 'left' : 'right';
}

export interface RecognizerOpts {
  /** current virtual view width (zones split at W / 2) */
  viewW: () => number;
  /** UI hit test (game.taps.hit) */
  hitTest?: (x: number, y: number) => TapRegion | null;
  config?: Partial<GestureConfig>;
}

export class GestureRecognizer {
  readonly cfg: GestureConfig;
  readonly view: TouchView = { joy: null, holds: [], marks: [], now: 0 };
  private fingers = new Map<number, Finger>();
  private joyId: number | null = null;
  private axisX = 0;
  private axisY = 0;
  /** jump releases waiting for minJumpHold */
  private pendingJumpRelease: number | null = null;
  private viewW: () => number;
  private hitTest: (x: number, y: number) => TapRegion | null;

  constructor(o: RecognizerOpts) {
    this.cfg = { ...GESTURE, ...o.config };
    this.viewW = o.viewW;
    this.hitTest = o.hitTest ?? (() => null);
  }

  /** number of fingers currently tracked */
  get active(): number {
    return this.fingers.size;
  }

  /** current joystick output (-1..1) */
  get axis(): { x: number; y: number } {
    return { x: this.axisX, y: this.axisY };
  }

  down(id: number, x: number, y: number, t: number): GestureAction[] {
    const out: GestureAction[] = [];
    this.view.now = t;
    if (this.fingers.has(id)) out.push(...this.cancel(id, t));
    const f: Finger = {
      id, kind: 'gesture', sx: x, sy: y, st: t, x, y, maxD: 0,
      ax: x, ay: y, lastDir: null, lastFired: false, swiped: false, hold: false, jumpHeld: false, jumpAt: 0,
      ox: x, oy: y, region: null, dragging: false,
    };
    const region = this.hitTest(x, y);
    if (region) {
      f.kind = 'ui';
      f.region = region;
      if (region.mode === 'down') out.push({ t: 'ui', phase: 'tap', region });
    } else if (x < this.viewW() / 2 && this.joyId === null) {
      f.kind = 'joy';
      this.joyId = id;
      this.view.joy = { ox: x, oy: y, kx: x, ky: y, r: this.cfg.joyRadius };
    }
    this.fingers.set(id, f);
    return out;
  }

  move(id: number, x: number, y: number, t: number): GestureAction[] {
    const f = this.fingers.get(id);
    if (!f) return [];
    this.view.now = t;
    const out: GestureAction[] = [];
    const px = f.x, py = f.y;
    f.x = x;
    f.y = y;
    f.maxD = Math.max(f.maxD, Math.hypot(x - f.sx, y - f.sy));
    if (f.kind === 'ui') {
      if (f.region?.onDrag && f.maxD >= this.cfg.tapSlop) {
        // drag starts once the finger leaves the tap slop; the first delta carries the distance travelled so far
        const first = !f.dragging;
        f.dragging = true;
        const dx = first ? x - f.sx : x - px;
        const dy = first ? y - f.sy : y - py;
        if (dx !== 0 || dy !== 0) out.push({ t: 'ui', phase: 'drag', region: f.region, dx, dy });
      }
    } else if (f.kind === 'joy') {
      this.moveJoy(f, out);
    } else {
      this.gestureMove(f, t, out);
    }
    return out;
  }

  up(id: number, x: number, y: number, t: number): GestureAction[] {
    const f = this.fingers.get(id);
    if (!f) return [];
    // the release position counts as a final move (a quick flick may only cross the threshold here)
    const out = this.move(id, x, y, t);
    this.fingers.delete(id);
    if (f.kind === 'ui') {
      const r = f.region!;
      if (r.mode === 'down') {
        if (r.onRelease) out.push({ t: 'ui', phase: 'release', region: r });
      } else if (!(r.onDrag && f.maxD >= this.cfg.tapSlop)) {
        // prefer the freshly registered region with the same id (regions are rebuilt every frame)
        const now = this.hitTest(x, y);
        if (now && now.id === r.id) out.push({ t: 'ui', phase: 'tap', region: now });
        else if (pointIn(x, y, r.rect)) out.push({ t: 'ui', phase: 'tap', region: r });
      }
    } else if (f.kind === 'joy') {
      this.endJoy(out);
    } else {
      if (f.hold) {
        out.push({ t: 'release', btn: 'attack2' });
      } else if (!f.swiped && f.maxD < this.cfg.tapSlop && t - f.st < Math.max(this.cfg.tapTime, this.cfg.longPress)) {
        out.push({ t: 'tap', btn: 'attack1' });
        this.mark('tap', x, y, t);
      }
      if (f.jumpHeld) this.releaseJump(f, t, out);
    }
    this.syncHolds();
    return out;
  }

  /** Finger lost (pointercancel, focus lost): release what it held, never fire a tap. */
  cancel(id: number, t: number): GestureAction[] {
    const f = this.fingers.get(id);
    if (!f) return [];
    this.fingers.delete(id);
    const out: GestureAction[] = [];
    if (f.kind === 'joy') this.endJoy(out);
    else if (f.kind === 'gesture') {
      if (f.hold) out.push({ t: 'release', btn: 'attack2' });
      if (f.jumpHeld) out.push({ t: 'release', btn: 'jump' });
    } else if (f.region?.mode === 'down' && f.region.onRelease) out.push({ t: 'ui', phase: 'release', region: f.region });
    this.syncHolds();
    void t;
    return out;
  }

  cancelAll(t: number): GestureAction[] {
    const out: GestureAction[] = [];
    for (const id of [...this.fingers.keys()]) out.push(...this.cancel(id, t));
    if (this.pendingJumpRelease !== null) {
      this.pendingJumpRelease = null;
      out.push({ t: 'release', btn: 'jump' });
    }
    return out;
  }

  /** Time-based recognition (long press, delayed jump release). Call every frame. */
  update(t: number): GestureAction[] {
    this.view.now = t;
    const out: GestureAction[] = [];
    for (const f of this.fingers.values()) if (f.kind === 'gesture') this.checkHold(f, t, out);
    if (this.pendingJumpRelease !== null && t >= this.pendingJumpRelease) {
      this.pendingJumpRelease = null;
      if (![...this.fingers.values()].some((f) => f.jumpHeld)) out.push({ t: 'release', btn: 'jump' });
    }
    if (this.view.marks.length) this.view.marks = this.view.marks.filter((m) => t - m.t0 < 0.4);
    return out;
  }

  // -------------------------------------------------------------------------

  private moveJoy(f: Finger, out: GestureAction[]): void {
    const R = this.cfg.joyRadius;
    let dx = f.x - f.ox;
    let dy = f.y - f.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // the base follows the thumb so reversing direction is immediate
      f.ox = f.x - (dx / d) * R;
      f.oy = f.y - (dy / d) * R;
      dx = f.x - f.ox;
      dy = f.y - f.oy;
    }
    const full = R * this.cfg.joyFull;
    const dead = this.cfg.joyDead;
    const axis = (v: number) => {
      const a = Math.abs(v);
      if (a <= dead) return 0;
      return Math.sign(v) * Math.min(1, (a - dead) / Math.max(1, full - dead));
    };
    const ax = round3(axis(dx));
    const ay = round3(axis(dy));
    this.view.joy = { ox: f.ox, oy: f.oy, kx: f.ox + dx, ky: f.oy + dy, r: R };
    if (ax !== this.axisX || ay !== this.axisY) {
      this.axisX = ax;
      this.axisY = ay;
      out.push({ t: 'axis', x: ax, y: ay });
    }
  }

  private endJoy(out: GestureAction[]): void {
    this.joyId = null;
    this.view.joy = null;
    this.axisX = this.axisY = 0;
    out.push({ t: 'axis', x: 0, y: 0 });
  }

  private gestureMove(f: Finger, t: number, out: GestureAction[]): void {
    this.checkHold(f, t, out);
    const need = this.cfg.swipeDist * (f.hold ? this.cfg.holdSwipeMul : 1);
    const dx = f.x - f.ax;
    const dy = f.y - f.ay;
    if (dx * dx + dy * dy < need * need) return;
    const dir = classifySwipe(dx, dy);
    f.ax = f.x;
    f.ay = f.y;
    if (dir === f.lastDir) return; // the same stroke keeps going
    if (f.lastFired && f.lastDir && dir === OPPOSITE[f.lastDir]) {
      // return stroke after a swipe (e.g. thumb coming back down after a jump): no action,
      // but it ends the jump hold so a following swipe up is a fresh (double) jump.
      f.lastDir = dir;
      f.lastFired = false;
      if (f.jumpHeld) this.releaseJump(f, t, out);
      return;
    }
    f.lastDir = dir;
    f.lastFired = true;
    f.swiped = true;
    if (f.hold) {
      f.hold = false;
      out.push({ t: 'release', btn: 'attack2' });
    }
    if (dir !== 'up' && f.jumpHeld) this.releaseJump(f, t, out);
    this.mark('swipe', f.x, f.y, t, dir);
    if (dir === 'up') {
      if (this.pendingJumpRelease !== null) {
        this.pendingJumpRelease = null;
        out.push({ t: 'release', btn: 'jump' });
      }
      out.push({ t: 'press', btn: 'jump' });
      f.jumpHeld = true;
      f.jumpAt = t;
    } else if (dir === 'down') {
      out.push({ t: 'tap', btn: 'down' });
    } else {
      out.push({ t: 'roll', dir: dir === 'left' ? -1 : 1 });
    }
  }

  private checkHold(f: Finger, t: number, out: GestureAction[]): void {
    if (f.hold || f.swiped || f.maxD >= this.cfg.tapSlop) return;
    if (t - f.st >= this.cfg.longPress) {
      f.hold = true;
      out.push({ t: 'press', btn: 'attack2' });
      this.syncHolds();
    }
  }

  private releaseJump(f: Finger, t: number, out: GestureAction[]): void {
    f.jumpHeld = false;
    if (t - f.jumpAt >= this.cfg.minJumpHold) out.push({ t: 'release', btn: 'jump' });
    else this.pendingJumpRelease = f.jumpAt + this.cfg.minJumpHold;
  }

  private syncHolds(): void {
    this.view.holds = [...this.fingers.values()].filter((f) => f.hold).map((f) => ({ x: f.x, y: f.y, t0: f.st }));
  }

  private mark(kind: TouchMark['kind'], x: number, y: number, t: number, dir?: SwipeDir): void {
    this.view.marks.push({ kind, x, y, dir, t0: t });
    if (this.view.marks.length > 8) this.view.marks.shift();
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Apply recogniser output to the game. */
export function applyGestureActions(game: Pick<Game, 'input'>, acts: GestureAction[]): void {
  const input = game.input;
  for (const a of acts) {
    switch (a.t) {
      case 'press': input.press(a.btn); break;
      case 'release': input.release(a.btn); break;
      case 'tap': input.tap(a.btn); break;
      case 'roll':
        input.rollDir = a.dir;
        input.tap('roll');
        break;
      case 'axis': input.setAxis('touch', a.x, a.y); break;
      case 'ui':
        if (a.phase === 'tap') a.region.onTap();
        else if (a.phase === 'release') a.region.onRelease?.();
        else a.region.onDrag?.(a.dx ?? 0, a.dy ?? 0);
        break;
    }
  }
}

/** The live touch view (joystick / feedback), read by LevelUI. Empty until attachTouch runs. */
export let touchView: TouchView = { joy: null, holds: [], marks: [], now: 0 };

const nowSecs = () => performance.now() / 1000;

/** Wire Pointer Events (touch, pen and mouse) on the game canvas to the recogniser. */
export function attachTouch(game: Game): void {
  const canvas = game.display.canvas;
  // phones/tablets: show touch hints from the first frame (keyboard presses switch it back)
  if (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) game.input.device = 'touch';
  const rec = new GestureRecognizer({
    viewW: () => game.display.W,
    hitTest: (x, y) => game.taps.hit(x, y),
  });
  touchView = rec.view;
  const apply = (acts: GestureAction[]) => {
    if (acts.length) applyGestureActions(game, acts);
  };
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    game.audio.unlock();
    if (e.pointerType !== 'mouse') game.input.device = 'touch';
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may not be capturable */
    }
    const p = game.display.toVirtual(e.clientX, e.clientY);
    apply(rec.down(e.pointerId, p.x, p.y, nowSecs()));
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    const p = game.display.toVirtual(e.clientX, e.clientY);
    apply(rec.move(e.pointerId, p.x, p.y, nowSecs()));
  });

  const end = (e: PointerEvent) => {
    const p = game.display.toVirtual(e.clientX, e.clientY);
    apply(rec.up(e.pointerId, p.x, p.y, nowSecs()));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', (e) => apply(rec.cancel(e.pointerId, nowSecs())));
  canvas.addEventListener('lostpointercapture', (e) => apply(rec.cancel(e.pointerId, nowSecs())));

  // no browser gestures: scrolling, pinch zoom, double-tap zoom, long-press menus, selection
  const stop = (e: Event) => e.preventDefault();
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(ev, stop, { passive: false });
  canvas.addEventListener('contextmenu', stop);
  canvas.addEventListener('dblclick', stop);
  document.addEventListener('gesturestart', stop as EventListener, { passive: false } as AddEventListenerOptions);
  document.addEventListener('touchmove', (e) => { if ((e as TouchEvent).touches.length > 1) e.preventDefault(); }, { passive: false });

  const dropAll = () => apply(rec.cancelAll(nowSecs()));
  window.addEventListener('blur', dropAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) dropAll(); });

  // first key press also unlocks WebAudio (desktop / tests)
  window.addEventListener('keydown', () => game.audio.unlock(), { once: true });

  const tick = () => {
    apply(rec.update(nowSecs()));
    // scene changes reset game.input (axes included): keep the stick alive while the thumb is down
    if (rec.view.joy) game.input.setAxis('touch', rec.axis.x, rec.axis.y);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
