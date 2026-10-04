import type { Btn } from './input';

/**
 * Gamepad support (Gamepad API, "standard" layout / Xbox naming).
 *
 * `mapPad` is pure: a pad snapshot + the button map + the previous state -> gameplay edges, the movement axis and
 * UI navigation keys. `GamepadManager` is the thin DOM part (navigator.getGamepads, connect / disconnect).
 * Game.step feeds the result into Input (gameplay) and the current scene (menus).
 *
 * Default map: A=점프, B=구르기, X=공격, Y=보조 무기, LB=회복, RB=상호작용, LT=스킬 1, RT=스킬 2,
 * Back=지도, Start=일시정지; left stick / D-pad = 이동, stick or D-pad down = 아래(내려찍기 / 발판 내려가기).
 * Menus always use the physical buttons: A (0) = 확인, B (1) = 뒤로, stick / D-pad = 이동.
 */
export type PadAction = 'jump' | 'roll' | 'attack1' | 'attack2' | 'heal' | 'interact' | 'skill1' | 'skill2' | 'map' | 'pause';

export const PAD_ACTIONS: readonly PadAction[] = ['jump', 'roll', 'attack1', 'attack2', 'heal', 'interact', 'skill1', 'skill2', 'map', 'pause'];

export type PadMap = Record<PadAction, number>;

export const DEFAULT_PAD_MAP: Readonly<PadMap> = {
  jump: 0, roll: 1, attack1: 2, attack2: 3, heal: 4, interact: 5, skill1: 6, skill2: 7, map: 8, pause: 9,
};

export const PAD_ACTION_LABEL: Record<PadAction, string> = {
  jump: '점프', roll: '구르기', attack1: '공격', attack2: '보조 무기', heal: '회복',
  interact: '상호작용', skill1: '스킬 1', skill2: '스킬 2', map: '지도', pause: '일시정지',
};

export const PAD_DEADZONE = 0.25;
/** a direction counts as "pushed" for menu navigation / the 'down' action beyond this deflection */
export const PAD_NAV_THRESHOLD = 0.5;
export const PAD_REPEAT_DELAY = 0.4;
export const PAD_REPEAT_RATE = 0.13;
/** physical buttons of the standard layout that are always the D-pad (never remappable) */
export const DPAD_BUTTONS = { up: 12, down: 13, left: 14, right: 15 } as const;
const MAX_BUTTON = 31;

/** Menu / UI navigation keys (ModalKey + the two global menu buttons). */
export type NavKey = 'left' | 'right' | 'up' | 'down' | 'confirm' | 'cancel' | 'pause' | 'map';

const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', '뒤로', '시작', 'L3', 'R3', '↑', '↓', '←', '→', '홈'];

/** Human name of a physical button (standard layout names, else "버튼 N"). */
export function padButtonName(index: number): string {
  return BUTTON_NAMES[index] ?? `버튼 ${index}`;
}

export interface PadSnapshot {
  id: string;
  axes: ArrayLike<number>;
  /** pressed flags, indexed like Gamepad.buttons */
  buttons: ArrayLike<boolean>;
}

export interface PadState {
  held: boolean[];
  /** the 'down' action (stick / D-pad down) is held */
  down: boolean;
  dirs: { left: boolean; right: boolean; up: boolean; down: boolean };
  repeat: { dir: 'left' | 'right' | 'up' | 'down' | null; t: number; next: number };
}

export const newPadState = (): PadState => ({
  held: [],
  down: false,
  dirs: { left: false, right: false, up: false, down: false },
  repeat: { dir: null, t: 0, next: PAD_REPEAT_DELAY },
});

export interface PadFrame {
  /** movement axis, dead-zoned (-1..1); the D-pad overrides the stick per axis */
  x: number;
  y: number;
  /** gameplay button edges this frame (includes 'down' from the stick / D-pad) */
  press: Btn[];
  release: Btn[];
  /** menu keys this frame: direction edges (+ auto-repeat), A=confirm, B=cancel, mapped pause / map buttons */
  nav: NavKey[];
  /** physical buttons that went down this frame (remap capture) */
  raw: number[];
  /** any input at all this frame (device hint switching) */
  active: boolean;
}

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Radial dead-zone with rescaling: 0 inside, then ramps smoothly to 1 at full deflection. */
export function stickToAxis(ax: number, ay: number, dead = PAD_DEADZONE): { x: number; y: number } {
  ax = finite(ax);
  ay = finite(ay);
  const m = Math.hypot(ax, ay);
  if (m < dead) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return { x: Math.max(-1, Math.min(1, ax * k)), y: Math.max(-1, Math.min(1, ay * k)) };
}

const BTN_OF: Partial<Record<PadAction, Btn>> = {
  jump: 'jump', roll: 'roll', attack1: 'attack1', attack2: 'attack2', heal: 'heal', interact: 'interact', skill1: 'skill1', skill2: 'skill2',
};

const DIRS = ['left', 'right', 'up', 'down'] as const;

/** One poll of a pad (or `null` = none connected: everything that was held is released). */
export function mapPad(snap: PadSnapshot | null, map: PadMap, prev: PadState, dt = 1 / 60): { frame: PadFrame; next: PadState } {
  const n = Math.max(prev.held.length, snap ? snap.buttons.length : 0, MAX_BUTTON + 1);
  const held: boolean[] = [];
  for (let i = 0; i < n; i++) held.push(!!snap && !!snap.buttons[i]);
  const was = (i: number) => !!prev.held[i];

  const raw: number[] = [];
  for (let i = 0; i < n; i++) if (held[i] && !was(i)) raw.push(i);

  const press: Btn[] = [];
  const release: Btn[] = [];
  const nav: NavKey[] = [];
  for (const a of PAD_ACTIONS) {
    const i = map[a];
    if (held[i] === was(i)) continue;
    const b = BTN_OF[a];
    if (b) (held[i] ? press : release).push(b);
    else if (held[i]) nav.push(a === 'map' ? 'map' : 'pause');
  }

  // movement: stick with dead-zone, D-pad wins per axis
  let { x, y } = snap ? stickToAxis(finite(snap.axes[0]), finite(snap.axes[1])) : { x: 0, y: 0 };
  const dx = (held[DPAD_BUTTONS.right] ? 1 : 0) - (held[DPAD_BUTTONS.left] ? 1 : 0);
  const dy = (held[DPAD_BUTTONS.down] ? 1 : 0) - (held[DPAD_BUTTONS.up] ? 1 : 0);
  if (dx !== 0) x = dx;
  if (dy !== 0) y = dy;

  const down = y > PAD_NAV_THRESHOLD;
  if (down && !prev.down) press.push('down');
  else if (!down && prev.down) release.push('down');

  // menu navigation: direction edges with auto-repeat, A / B
  const dirs = { left: x < -PAD_NAV_THRESHOLD, right: x > PAD_NAV_THRESHOLD, up: y < -PAD_NAV_THRESHOLD, down };
  const rep = { ...prev.repeat };
  for (const d of DIRS) {
    if (dirs[d] && !prev.dirs[d]) {
      nav.push(d);
      rep.dir = d;
      rep.t = 0;
      rep.next = PAD_REPEAT_DELAY;
    }
  }
  if (rep.dir && !dirs[rep.dir]) rep.dir = null;
  else if (rep.dir && prev.dirs[rep.dir]) {
    rep.t += dt;
    while (rep.t >= rep.next) {
      nav.push(rep.dir);
      rep.next += PAD_REPEAT_RATE;
    }
  }
  if (raw.includes(0)) nav.push('confirm');
  if (raw.includes(1)) nav.push('cancel');

  return {
    frame: { x, y, press, release, nav, raw, active: raw.length > 0 || x !== 0 || y !== 0 },
    next: { held, down, dirs, repeat: rep },
  };
}

const validButton = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_BUTTON;

/**
 * Give `action` the physical `button`. A button belongs to one action: if another action already uses it, the two
 * swap. Returns a new map (the input is untouched); an invalid button leaves the map unchanged.
 */
export function assignButton(map: PadMap, action: PadAction, button: number): PadMap {
  const out = { ...map };
  if (!validButton(button) || !(action in out)) return out;
  const old = out[action];
  for (const a of PAD_ACTIONS) if (a !== action && out[a] === button) out[a] = old;
  out[action] = button;
  return out;
}

/** Validate a stored map: wrong types / out-of-range / duplicate buttons fall back so that every action has its own button. */
export function sanitizePadMap(raw: unknown): PadMap {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PAD_MAP } as PadMap;
  const used = new Set<number>();
  const free = (): number => {
    for (let i = 0; i <= MAX_BUTTON; i++) if (!used.has(i) && (i < DPAD_BUTTONS.up || i > DPAD_BUTTONS.right)) return i;
    return 0;
  };
  for (const a of PAD_ACTIONS) {
    let v = validButton(r[a]) ? (r[a] as number) : DEFAULT_PAD_MAP[a];
    if (used.has(v)) v = !used.has(DEFAULT_PAD_MAP[a]) ? DEFAULT_PAD_MAP[a] : free();
    out[a] = v;
    used.add(v);
  }
  return out;
}

export const isDefaultMap = (m: PadMap): boolean => PAD_ACTIONS.every((a) => m[a] === DEFAULT_PAD_MAP[a]);

/** Shorten a Gamepad.id for toasts: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e ...)" -> "Xbox 360 Controller". */
export function padShortName(id: string, max = 28): string {
  const base = id.replace(/\s*\(.*$/, '').trim() || id;
  return base.length > max ? base.slice(0, max - 1) + '…' : base;
}

function snapshotOf(gp: Gamepad): PadSnapshot {
  const buttons: boolean[] = [];
  for (let i = 0; i < gp.buttons.length; i++) {
    const b = gp.buttons[i];
    buttons.push(!!b && (b.pressed || b.value > 0.5));
  }
  return { id: gp.id, axes: gp.axes, buttons };
}

/** Polls navigator.getGamepads and tracks connection. All state lives in `state` (see mapPad). */
export class GamepadManager {
  /** connected pad's `id` ('' = none) */
  id = '';
  /** Gamepad.mapping of the connected pad ('standard' or '') */
  mapping = '';
  state: PadState = newPadState();
  /** the remap UI sets this to receive the next physical button press (everything else is suppressed meanwhile) */
  capture: ((button: number) => void) | null = null;
  onConnect: ((id: string) => void) | null = null;
  onDisconnect: ((id: string) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', () => this.sync());
      window.addEventListener('gamepaddisconnected', () => this.sync());
    }
  }

  get connected(): boolean {
    return this.id !== '';
  }

  private find(): Gamepad | null {
    let list: ArrayLike<Gamepad | null> = [];
    try {
      list = (typeof navigator !== 'undefined' && navigator.getGamepads?.()) || [];
    } catch {
      return null;
    }
    let first: Gamepad | null = null;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || !g.connected) continue;
      if (g.id === this.id) return g; // keep the pad we already use
      if (!first || (g.mapping === 'standard' && first.mapping !== 'standard')) first = g;
    }
    return first;
  }

  /** Re-read the connection (also called by the connect / disconnect events). Returns the live snapshot. */
  sync(): PadSnapshot | null {
    const gp = this.find();
    if (gp && gp.id !== this.id) {
      this.id = gp.id;
      this.mapping = gp.mapping;
      this.onConnect?.(gp.id);
    } else if (!gp && this.id) {
      const old = this.id;
      this.id = '';
      this.mapping = '';
      this.onDisconnect?.(old);
    }
    return gp ? snapshotOf(gp) : null;
  }

  /** Poll once. `null` when nothing is connected and nothing is left to release. */
  update(map: PadMap, dt: number): PadFrame | null {
    const snap = this.sync();
    if (!snap && this.state.held.length === 0 && !this.state.down) return null;
    const { frame, next } = mapPad(snap, map, this.state, dt);
    this.state = snap ? next : newPadState();
    return frame;
  }
}
