import type { AABB } from '../../engine/math';
import { pointIn } from '../../engine/math';
import type { Btn } from '../../engine/input';
import type { ButtonSize } from '../meta/save';
import type { GestureAction } from './touch';
import { COL, SZ, gradeLetter, icon, pie, rrect, text } from './draw';
import type { Grade } from '../rules';
import type { Assets } from '../../engine/assets';

/**
 * Virtual buttons ("가상 버튼" control mode). Pure layout + hit test + pointer controller (no DOM), plus the draw code.
 *
 *   left:  ← → on one row, ↓ below the gap between them (a finger can slide between them)
 *   right: [보조][점프]
 *          [구르기][공격]   and the equipped skills to the left of that block
 *
 * Every pointer tracks the button it pressed (true multi-touch: hold → + jump + attack at once). Action buttons stay
 * pressed until their finger lifts; a finger that started on the d-pad follows the direction under it.
 */
export type VId = 'left' | 'right' | 'down' | 'attack' | 'jump' | 'roll' | 'sub' | 'skill1' | 'skill2';

export interface VButton {
  id: VId;
  kind: 'dpad' | 'action';
  cx: number;
  cy: number;
  /** visual radius of a round button / half-size of a d-pad key */
  r: number;
  /** touch target (always >= 40 virtual px) */
  hit: AABB;
  label: string;
}

export interface VLayout {
  W: number;
  H: number;
  size: ButtonSize;
  buttons: VButton[];
  /** d-pad bounding box, grown by a few px (a finger sliding along it stays in) */
  dpad: AABB;
}

export const VSIZE: Record<ButtonSize, number> = { small: 0.85, medium: 1, large: 1.2 };
export const VSIZE_LABEL: Record<ButtonSize, string> = { small: '작게', medium: '보통', large: '크게' };
/** lowest y (bottom edge) any button may reach: keeps clear of the weapon icons and the boss bar */
export const VB_BOTTOM_MARGIN = 36;
const GAP = 4;
const SIDE = 10;
const MIN_HIT_HALF = 22;

/** All button geometry for a W × H virtual view (pure). `skills` = which skill slots hold a skill. */
export function vbLayout(W: number, H: number, size: ButtonSize, skills: readonly [boolean, boolean] = [false, false]): VLayout {
  const u = VSIZE[size];
  const B = H - VB_BOTTOM_MARGIN;
  const buttons: VButton[] = [];
  const rect = (cx: number, cy: number, hs: number): AABB => ({ x: cx - hs, y: cy - hs, w: hs * 2, h: hs * 2 });
  const round = (id: VId, label: string, cx: number, cy: number, r: number) =>
    buttons.push({ id, kind: 'action', cx, cy, r, hit: rect(cx, cy, Math.max(r, MIN_HIT_HALF)), label });

  // d-pad
  const dw = Math.round(50 * u);
  const hs = dw / 2;
  const dcx = SIDE + dw + GAP / 2; // x of the gap between ← and →
  const rowY = B - dw * 2 - GAP; // top of the ← → row
  const key = (id: VId, label: string, x: number, y: number) =>
    buttons.push({ id, kind: 'dpad', cx: x + hs, cy: y + hs, r: hs, hit: { x, y, w: dw, h: dw }, label });
  key('left', '←', SIDE, rowY);
  key('right', '→', SIDE + dw + GAP, rowY);
  key('down', '↓', dcx - hs, B - dw);
  const dpad = { x: SIDE - 8, y: rowY - 8, w: dw * 2 + GAP + 16, h: dw * 2 + GAP + 8 };

  // action block (bottom-right)
  const hsA = 36 * u;
  const hsJ = 30 * u;
  const hsR = 28 * u;
  const ax = W - SIDE - hsA;
  const ay = B - hsA;
  round('attack', '공격', ax, ay, hsA);
  round('jump', '점프', ax, ay - hsA - GAP - hsJ, hsJ);
  const rx = ax - hsA - GAP - hsR;
  round('roll', '구르기', rx, B - hsR, hsR);
  round('sub', '보조', ax - hsJ - GAP - hsR, ay - hsA - GAP - hsR, hsR);
  // skills: one column further left
  const sr = Math.max(20, 20 * u);
  const sh = Math.max(sr, MIN_HIT_HALF);
  const sx = rx - hsR - GAP - sh;
  if (skills[0]) round('skill1', '스킬1', sx, B - sh, sr);
  if (skills[1]) round('skill2', '스킬2', sx, B - sh * 2 - GAP - sh, sr);
  return { W, H, size, buttons, dpad };
}

/** The button under a point: exact touch targets first, then (inside the d-pad box) the nearest d-pad key. */
export function hitTestV(L: VLayout, x: number, y: number): VButton | null {
  for (const b of L.buttons) if (pointIn(x, y, b.hit)) return b;
  if (pointIn(x, y, L.dpad)) {
    let best: VButton | null = null;
    let bd = Infinity;
    for (const b of L.buttons) {
      if (b.kind !== 'dpad') continue;
      const d = Math.hypot(x - b.cx, y - b.cy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  return null;
}

const BTN_OF: Partial<Record<VId, Btn>> = { attack: 'attack1', jump: 'jump', sub: 'attack2', skill1: 'skill1', skill2: 'skill2', down: 'down' };

interface Ptr {
  /** button currently held by this pointer (d-pad pointers may slide off: null) */
  id: VId | null;
  dpad: boolean;
}

/**
 * Pointer -> button state machine. Feed it pointer down / move / up with virtual coordinates and the current
 * layout; it returns the actions to apply to Input (applyGestureActions).
 */
export class VButtonController {
  private ptrs = new Map<number, Ptr>();
  private count = new Map<VId, number>();
  private axisX = 0;
  private axisY = 0;

  /** a pointer is being tracked */
  get active(): boolean {
    return this.ptrs.size > 0;
  }

  get axis(): { x: number; y: number } {
    return { x: this.axisX, y: this.axisY };
  }

  owns(pid: number): boolean {
    return this.ptrs.has(pid);
  }

  isDown(id: VId): boolean {
    return (this.count.get(id) ?? 0) > 0;
  }

  /** Start tracking if the point hits a button; returns [] (and `owns` stays false) otherwise. */
  down(pid: number, x: number, y: number, L: VLayout): GestureAction[] {
    const out: GestureAction[] = [];
    if (this.ptrs.has(pid)) out.push(...this.cancel(pid));
    const b = hitTestV(L, x, y);
    if (!b) return out;
    this.ptrs.set(pid, { id: b.id, dpad: b.kind === 'dpad' });
    this.hold(b.id, out);
    return out;
  }

  move(pid: number, x: number, y: number, L: VLayout): GestureAction[] {
    const p = this.ptrs.get(pid);
    if (!p || !p.dpad) return [];
    const b = hitTestV(L, x, y);
    const next = b && b.kind === 'dpad' ? b.id : null;
    if (next === p.id) return [];
    const out: GestureAction[] = [];
    if (p.id) this.drop(p.id, out, false);
    p.id = next;
    if (next) this.hold(next, out, false);
    this.syncAxis(out); // one axis update for the whole slide
    return out;
  }

  up(pid: number): GestureAction[] {
    return this.cancel(pid);
  }

  cancel(pid: number): GestureAction[] {
    const p = this.ptrs.get(pid);
    if (!p) return [];
    this.ptrs.delete(pid);
    const out: GestureAction[] = [];
    if (p.id) this.drop(p.id, out);
    return out;
  }

  cancelAll(): GestureAction[] {
    const out: GestureAction[] = [];
    for (const pid of [...this.ptrs.keys()]) out.push(...this.cancel(pid));
    return out;
  }

  private hold(id: VId, out: GestureAction[], sync = true): void {
    const n = (this.count.get(id) ?? 0) + 1;
    this.count.set(id, n);
    if (n !== 1) return;
    if (id === 'roll') {
      out.push({ t: 'roll', dir: 0 }); // held ← / → decides the direction, else the facing
      return;
    }
    const b = BTN_OF[id];
    if (b) out.push({ t: 'press', btn: b });
    if (sync) this.syncAxis(out);
  }

  private drop(id: VId, out: GestureAction[], sync = true): void {
    const n = (this.count.get(id) ?? 0) - 1;
    if (n > 0) {
      this.count.set(id, n);
      return;
    }
    this.count.delete(id);
    const b = BTN_OF[id];
    if (b) out.push({ t: 'release', btn: b });
    if (sync) this.syncAxis(out);
  }

  private syncAxis(out: GestureAction[]): void {
    const x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const y = this.isDown('down') ? 1 : 0;
    if (x !== this.axisX || y !== this.axisY) {
      this.axisX = x;
      this.axisY = y;
      out.push({ t: 'axis', x, y, src: 'vbtn' });
    }
  }
}

// ---------------------------------------------------------------------------
// drawing

export interface VSkillView {
  icon: string;
  color: string;
  cd: number;
  cdMax: number;
  /** 0..1 flash after the cooldown ends */
  flash: number;
  /** the grade letter in the corner (unique items) */
  grade?: Grade;
}

export interface VDrawOpts {
  /** 0.2..1 */
  opacity: number;
  isDown: (id: VId) => boolean;
  skills?: [VSkillView | null, VSkillView | null];
  assets?: Pick<Assets, 'sheet'>;
}

const ACCENT: Partial<Record<VId, string>> = { attack: COL.amber, jump: COL.cyan, roll: '#e8f0ff', sub: '#d3a8ff' };

/** Draw the buttons in the current (UI virtual) transform. */
export function drawVButtons(c: CanvasRenderingContext2D, L: VLayout, o: VDrawOpts): void {
  const op = Math.max(0.2, Math.min(1, o.opacity));
  c.save();
  for (const b of L.buttons) {
    const down = o.isDown(b.id);
    const skillIdx = b.id === 'skill1' ? 0 : b.id === 'skill2' ? 1 : -1;
    const sv = skillIdx >= 0 ? o.skills?.[skillIdx as 0 | 1] ?? null : null;
    const accent = b.kind === 'dpad' ? COL.cyan : sv ? sv.color : ACCENT[b.id] ?? COL.cyan;
    c.globalAlpha = op;
    if (b.kind === 'dpad') {
      const hw = b.hit.w / 2 - 1;
      rrect(c, b.cx - hw, b.cy - hw, hw * 2, hw * 2, 9);
      c.fillStyle = down ? 'rgba(159,232,255,0.55)' : 'rgba(10,14,28,0.62)';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = down ? '#ffffff' : 'rgba(159,232,255,0.75)';
      c.stroke();
      c.globalAlpha = Math.min(1, op + 0.35);
      arrow(c, b.id, b.cx, b.cy, hw * 0.42, down ? '#07060b' : '#eaf8ff');
      continue;
    }
    c.beginPath();
    c.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
    c.fillStyle = down ? hexA(accent, 0.55) : 'rgba(10,14,28,0.62)';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = down ? '#ffffff' : accent;
    c.stroke();
    c.globalAlpha = Math.min(1, op + 0.35);
    if (sv && o.assets) {
      icon(o.assets, c, sv.icon, b.cx, b.cy, 24, sv.cd > 0 ? 0.5 : 1);
      if (sv.grade) gradeLetter(c, sv.grade, b.cx + b.r - 2, b.cy + b.r - 6);
      if (sv.cd > 0) {
        pie(c, b.cx, b.cy, b.r - 1, sv.cd / Math.max(0.001, sv.cdMax), 'rgba(7,6,11,0.72)');
        text(c, String(Math.ceil(sv.cd)), b.cx, b.cy + 1, { align: 'center', bold: true });
      } else if (sv.flash > 0) {
        c.globalAlpha = sv.flash;
        c.strokeStyle = '#ffffff';
        c.beginPath();
        c.arc(b.cx, b.cy, b.r + 3 + (1 - sv.flash) * 8, 0, Math.PI * 2);
        c.stroke();
      }
    } else if (skillIdx >= 0) {
      text(c, `S${skillIdx + 1}`, b.cx, b.cy, { align: 'center', bold: true, color: accent });
    } else {
      text(c, b.label, b.cx, b.cy + 0.5, { align: 'center', bold: true, size: b.r >= 30 ? SZ.m : SZ.s, color: down ? '#ffffff' : COL.text });
    }
  }
  c.restore();
}

function arrow(c: CanvasRenderingContext2D, id: VId, cx: number, cy: number, s: number, color: string): void {
  const dx = id === 'left' ? -1 : id === 'right' ? 1 : 0;
  const dy = id === 'down' ? 1 : 0;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(cx + dx * s, cy + dy * s);
  c.lineTo(cx - dx * s * 0.6 - dy * s, cy - dy * s * 0.6 + dx * s);
  c.lineTo(cx - dx * s * 0.6 + dy * s, cy - dy * s * 0.6 - dx * s);
  c.closePath();
  c.fill();
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
