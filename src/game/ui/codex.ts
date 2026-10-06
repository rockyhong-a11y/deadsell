import type { Game } from '../game';
import type { AABB } from '../../engine/math';
import { clamp } from '../../engine/math';
import type { NavKey, ScrollKey } from '../../engine/gamepad';
import type { AnimDef, SpriteSheet } from '../../engine/assets';
import { ENEMY_DEFS } from '../enemies/variants';
import { COL, SZ, button, dim, panel, rrect, text, textWidth, wrap } from './draw';
import { CODEX_TABS, codexEntries, type CodexEntry, type CodexPreview, type CodexTabId, type PreviewProp, type PreviewStep } from './codexData';

/**
 * 도감 screen: everything in the game, nothing hidden. Tabs on top (무기 / 스킬 / 적 / 보스 / 아이템), a scrollable entry
 * list on the left, the selected entry on the right: a preview plate with its animations, then its numbers.
 * One class for the title screen (a modal over the title) and the pause menu (wrapped in `CodexModal`).
 * Touch (tap tabs / entries / the preview, drag or flick to scroll), keyboard (←→ or Q/E tabs, ↑↓ entries, Enter next
 * animation, PageUp / PageDown / Home / End or Shift+↑↓ scroll the description, Esc back) and gamepad (D-pad / stick,
 * LB / RB tabs, A next animation, right stick scrolls the description, B back).
 * The entry data comes from codexData.ts; nothing here knows a game number.
 */

export const CODEX_PAD = 12;
const TAB_Y = 8;
const TAB_H = 34;
const BODY_Y = 50;
const HINT_H = 18;
const ROW_H = 36;
const GROUP_H = 20;
const LINE_H = 14;
/** the label column of a detail page: at least this wide, wider when one of the page's (bold) labels needs it */
const LABEL_W = 44;
const LABEL_GAP = 6;
/** one `scrollUp` / `scrollDown` step (right stick, Shift+↑↓) = two text lines */
const SCROLL_STEP = LINE_H * 2;
/** taps are ignored for this long after the screen opens (the finger that opened it is still lifting) */
const LOCKOUT = 0.2;
/** a detail panel at least this wide puts the preview left of the name / description */
const WIDE_DETAIL = 440;

export interface CodexLayout {
  title: { x: number; y: number };
  tabs: AABB[];
  close: AABB;
  list: AABB;
  detail: AABB;
  /** the dark plate with the animated sprite */
  preview: AABB;
  /** wide layout only: name, tag and description right of the preview */
  head: AABB | null;
  /** the scrolling text area (narrow layout: name + description + rows; wide: rows) */
  body: AABB;
  hint: AABB;
  wide: boolean;
}

/** Pure geometry of the screen for a W × H virtual view (tests check that nothing overlaps). */
export function codexLayout(W: number, H: number): CodexLayout {
  const n = CODEX_TABS.length;
  const close = { x: W - CODEX_PAD - 56, y: TAB_Y, w: 56, h: TAB_H };
  const tx0 = 76;
  const gap = 4;
  const tw = Math.floor((close.x - 8 - tx0 - gap * (n - 1)) / n);
  const tabs = CODEX_TABS.map((_, i) => ({ x: tx0 + i * (tw + gap), y: TAB_Y, w: tw, h: TAB_H }));
  const bodyH = H - BODY_Y - HINT_H - 4;
  const lw = clamp(Math.round(W * 0.34), 168, 240);
  const list = { x: CODEX_PAD, y: BODY_Y, w: lw, h: bodyH };
  const dx = CODEX_PAD + lw + 8;
  const detail = { x: dx, y: BODY_Y, w: W - CODEX_PAD - dx, h: bodyH };
  const wide = detail.w >= WIDE_DETAIL;
  const p = 8;
  let preview: AABB;
  let head: AABB | null = null;
  let by: number;
  if (wide) {
    preview = { x: detail.x + p, y: detail.y + p, w: 208, h: 128 };
    head = { x: preview.x + preview.w + 10, y: preview.y, w: detail.w - p * 2 - preview.w - 10, h: preview.h };
    by = preview.y + preview.h + 8;
  } else {
    preview = { x: detail.x + p, y: detail.y + p, w: detail.w - p * 2, h: 92 };
    by = preview.y + preview.h + 6;
  }
  const body = { x: detail.x + p, y: by, w: detail.w - p * 2, h: detail.y + detail.h - p - by };
  return {
    title: { x: CODEX_PAD, y: TAB_Y + TAB_H / 2 },
    tabs, close, list, detail, preview, head, body, wide,
    hint: { x: CODEX_PAD, y: H - HINT_H - 2, w: W - CODEX_PAD * 2, h: HINT_H },
  };
}

const intersect = (a: AABB, b: AABB): AABB | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

// ---------------------------------------------------------------------------------------------------------------------
// sprite helpers (also used by the tests)

/** Virtual scale that draws a bw × bh sprite box inside availW × availH: whole device pixels per sprite pixel when it
 * fits at 1:1 or larger (pixel-perfect), otherwise shrunk to fit (smoothed). `dev` = device pixels per virtual pixel. */
export function fitScale(availW: number, availH: number, bw: number, bh: number, dev: number, cap = 8): number {
  const k = Math.min((availW * dev) / Math.max(1, bw), (availH * dev) / Math.max(1, bh));
  if (k >= 1) return Math.min(cap, Math.floor(k)) / dev;
  return Math.max(0.05, k) / dev;
}

interface Rect { x: number; y: number; w: number; h: number }
interface Box { x0: number; y0: number; x1: number; y1: number }

const boundsCache = new Map<string, Rect>();
let scratch: HTMLCanvasElement | null = null;

/** Opaque pixel bounds of one frame (frame coordinates). Falls back to the whole frame when pixels cannot be read. */
function scanFrame(sheet: SpriteSheet, anim: string, frame: number): Rect {
  const key = `${sheet.name}|${anim}|${frame}`;
  const hit = boundsCache.get(key);
  if (hit) return hit;
  let r: Rect = { x: 0, y: 0, w: sheet.frameW, h: sheet.frameH };
  if (typeof document !== 'undefined') {
    try {
      const w = sheet.frameW;
      const h = sheet.frameH;
      const def = sheet.anim(anim);
      scratch ??= document.createElement('canvas');
      if (scratch.width !== w || scratch.height !== h) {
        scratch.width = w;
        scratch.height = h;
      }
      const x = scratch.getContext('2d', { willReadFrequently: true })!;
      x.clearRect(0, 0, w, h);
      x.drawImage(sheet.img, frame * w, def.row * h, w, h, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data;
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      // big boss frames: look at every 2nd pixel (the framing does not need the last pixel of precision)
      const st = w * h > 30000 ? 2 : 1;
      for (let yy = 0; yy < h; yy += st) {
        const row = yy * w * 4;
        for (let xx = 0; xx < w; xx += st) {
          if (d[row + xx * 4 + 3] > 24) {
            if (xx < minX) minX = xx;
            if (xx > maxX) maxX = xx;
            if (yy < minY) minY = yy;
            if (yy > maxY) maxY = yy;
          }
        }
      }
      if (maxX >= 0) r = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    } catch {
      /* unreadable canvas: keep the whole frame */
    }
  }
  boundsCache.set(key, r);
  return r;
}

const animBoxCache = new Map<string, Box>();

/** Union of the opaque bounds of a few frames of an animation (first, quarter points, last), anchor-relative. */
function animBox(sheet: SpriteSheet, anim: string): Box {
  const key = `${sheet.name}|${anim}`;
  const hit = animBoxCache.get(key);
  if (hit) return hit;
  const n = sheet.anim(anim).frames;
  const picks = uniq([0, Math.floor((n - 1) * 0.25), Math.floor((n - 1) * 0.5), Math.floor((n - 1) * 0.75), n - 1]);
  let b: Box | null = null;
  for (const f of picks) {
    const r = scanFrame(sheet, anim, f);
    const nb = { x0: r.x - sheet.ax, y0: r.y - sheet.ay, x1: r.x + r.w - sheet.ax, y1: r.y + r.h - sheet.ay };
    b = b ? { x0: Math.min(b.x0, nb.x0), y0: Math.min(b.y0, nb.y0), x1: Math.max(b.x1, nb.x1), y1: Math.max(b.y1, nb.y1) } : nb;
  }
  animBoxCache.set(key, b!);
  return b!;
}

function uniq(a: number[]): number[] {
  return [...new Set(a)];
}

interface Slot {
  step: PreviewStep;
  def: AnimDef;
  start: number;
  /** seconds the animation itself runs (non-looping: stretched over this) */
  native: number;
  /** seconds the step occupies in the cycle */
  dwell: number;
}

/** Timeline of a step list on a sheet: loops show for ~1.5 s, one-shots play once and rest `hold` s. */
export function previewSlots(sheet: Pick<SpriteSheet, 'anim'>, steps: PreviewStep[]): { slots: Slot[]; total: number } {
  const slots: Slot[] = [];
  let t = 0;
  for (const step of steps) {
    const def = sheet.anim(step.anim);
    const len = def.frames / Math.max(1, def.fps);
    const native = step.dur ?? len;
    const dwell = def.loop ? (step.dur ?? Math.max(1.5, Math.ceil(1.5 / len) * len)) : native + (step.hold ?? 0.5);
    slots.push({ step, def, start: t, native, dwell });
    t += dwell;
  }
  return { slots, total: Math.max(0.1, t) };
}

function slotAt(slots: Slot[], t: number): Slot {
  for (let i = slots.length - 1; i >= 0; i--) if (t >= slots[i].start) return slots[i];
  return slots[0];
}

/** frame of a slot's animation `lt` seconds after its start */
export function frameAt(def: AnimDef, native: number, lt: number): number {
  if (def.loop) return Math.floor(Math.max(0, lt) * def.fps) % Math.max(1, def.frames);
  return Math.min(def.frames - 1, Math.floor(clamp(lt / Math.max(0.001, native), 0, 1) * def.frames));
}

// ---------------------------------------------------------------------------------------------------------------------

type ListItem = { kind: 'group'; label: string; y: number; h: number } | { kind: 'entry'; index: number; y: number; h: number };

interface TextLayout {
  descLines: string[];
  headH: number;
  /** width of the label column (the value text starts after it) */
  labelW: number;
  rows: { label: string; color?: string; lines: string[]; y: number }[];
  rowsH: number;
}

type Scroller = 'list' | 'body';

export class CodexScreen {
  /** index into CODEX_TABS */
  tabIdx: number;
  /** selected entry (index into the tab's entries) per tab */
  sel: number[] = CODEX_TABS.map(() => 0);
  private listScroll: number[] = CODEX_TABS.map(() => 0);
  private bodyScroll = 0;
  age = 0;
  /** preview clock: seconds into the current cycle of the selected entry */
  private clock = 0;
  private closed = false;
  private items: ListItem[][] = [];
  private entriesCache: CodexEntry[][] = [];
  private textCache = new Map<string, TextLayout>();
  private wheel: ((e: WheelEvent) => void) | null = null;
  // drag / flick scrolling
  private dragTarget: Scroller | null = null;
  private dragAcc = 0;
  private dragIdle = 0;
  private dragVel = 0;
  private fling: { target: Scroller; vel: number } | null = null;
  private lastLayout: CodexLayout | null = null;
  /** wall-clock ms of the last draw (a screen nobody draws any more drops its wheel listener) */
  private drawnAt = 0;
  /** the context of the last draw (text is measured with it) */
  private ctx: CanvasRenderingContext2D | null = null;
  private slotCache = new Map<string, { slots: Slot[]; total: number }>();
  private boxCache = new Map<string, Box>();

  constructor(readonly game: Game, private onClose: () => void, tab: CodexTabId = 'weapon') {
    this.tabIdx = Math.max(0, CODEX_TABS.findIndex((t) => t.id === tab));
    CODEX_TABS.forEach((t, i) => {
      this.entriesCache[i] = codexEntries(t.id);
      this.items[i] = buildItems(this.entriesCache[i]);
    });
    if (typeof window !== 'undefined') {
      this.wheel = (e) => this.onWheel(e);
      window.addEventListener('wheel', this.wheel, { passive: true });
    }
  }

  // ---- state -------------------------------------------------------------------------------------------------------

  get tab(): CodexTabId {
    return CODEX_TABS[this.tabIdx].id;
  }

  entries(): CodexEntry[] {
    return this.entriesCache[this.tabIdx];
  }

  get current(): CodexEntry {
    const e = this.entries();
    return e[clamp(this.sel[this.tabIdx], 0, e.length - 1)];
  }

  /** scroll offsets in px (list of the current tab / detail text) */
  get listOffset(): number {
    return this.listScroll[this.tabIdx];
  }

  get bodyOffset(): number {
    return this.bodyScroll;
  }

  /** how far the detail text can scroll (0 = it fits) */
  get bodyMax(): number {
    return this.maxScroll('body');
  }

  /** index of the animation step the preview is showing */
  get animIndex(): number {
    const { slots } = this.slotsOf(this.current);
    return slots.indexOf(slotAt(slots, this.clock));
  }

  private sfx(s: 'ui_tap' | 'ui_close' | 'error'): void {
    this.game.audio?.play(s);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.wheel && typeof window !== 'undefined') window.removeEventListener('wheel', this.wheel);
    this.wheel = null;
    this.sfx('ui_close');
    this.onClose();
  }

  setTab(i: number): void {
    const n = CODEX_TABS.length;
    i = ((i % n) + n) % n;
    if (i === this.tabIdx) return;
    this.tabIdx = i;
    this.resetView();
    this.ensureVisible();
    this.sfx('ui_tap');
  }

  cycleTab(dir: number): void {
    this.setTab(this.tabIdx + dir);
  }

  select(i: number): void {
    const e = this.entries();
    i = clamp(i, 0, e.length - 1);
    if (i === this.sel[this.tabIdx]) return;
    this.sel[this.tabIdx] = i;
    this.resetView();
    this.ensureVisible();
    this.sfx('ui_tap');
  }

  /** advance the preview to its next animation (tap on the plate / A / Enter) */
  nextAnim(): void {
    const { slots } = this.slotsOf(this.current);
    const i = this.animIndex;
    this.clock = slots[(i + 1) % slots.length].start + 0.001;
    this.sfx('ui_tap');
  }

  private resetView(): void {
    this.clock = 0;
    this.bodyScroll = 0;
    this.fling = null;
  }

  key(k: NavKey): void {
    if (k === 'cancel' || k === 'pause') this.close();
    else if (k === 'left' || k === 'tabL') this.cycleTab(-1);
    else if (k === 'right' || k === 'tabR') this.cycleTab(1);
    else if (k === 'up') this.select(this.sel[this.tabIdx] - 1);
    else if (k === 'down') this.select(this.sel[this.tabIdx] + 1);
    else if (k === 'confirm') this.nextAnim();
    else if (k === 'scrollUp' || k === 'scrollDown' || k === 'pageUp' || k === 'pageDown' || k === 'scrollTop' || k === 'scrollEnd') this.scrollDetail(k);
  }

  /** Keyboard / pad scrolling of the detail text (what a drag or the wheel does by touch / mouse). */
  private scrollDetail(k: ScrollKey): void {
    this.fling = null;
    const page = Math.max(LINE_H, (this.lastLayout?.body.h ?? 0) - 2 * LINE_H);
    if (k === 'scrollTop') this.bodyScroll = 0;
    else if (k === 'scrollEnd') this.bodyScroll = this.maxScroll('body');
    else this.scrollBy('body', k === 'scrollUp' ? -SCROLL_STEP : k === 'scrollDown' ? SCROLL_STEP : k === 'pageUp' ? -page : page);
  }

  // ---- scrolling ---------------------------------------------------------------------------------------------------

  private listContentH(): number {
    const it = this.items[this.tabIdx];
    const last = it[it.length - 1];
    return last ? last.y + last.h : 0;
  }

  private maxScroll(which: Scroller): number {
    const L = this.lastLayout;
    if (!L) return 0;
    if (which === 'list') return Math.max(0, this.listContentH() - L.list.h + 4);
    return Math.max(0, this.bodyContentH(L) - L.body.h);
  }

  private bodyContentH(L: CodexLayout): number {
    const c = this.ctx;
    if (!c) return 0;
    const tl = this.textLayout(c, this.current, L);
    return (L.wide ? 0 : tl.headH) + tl.rowsH;
  }

  private scrollBy(which: Scroller, dy: number): void {
    if (which === 'list') this.listScroll[this.tabIdx] = clamp(this.listScroll[this.tabIdx] + dy, 0, this.maxScroll('list'));
    else this.bodyScroll = clamp(this.bodyScroll + dy, 0, this.maxScroll('body'));
  }

  private onDrag(which: Scroller, dy: number): void {
    this.fling = null;
    this.dragTarget = which;
    this.dragAcc += dy;
    this.scrollBy(which, -dy);
  }

  private onWheel(e: WheelEvent): void {
    if (typeof performance !== 'undefined' && performance.now() - this.drawnAt > 500) {
      // the host went away without closing us
      if (this.wheel) window.removeEventListener('wheel', this.wheel);
      this.wheel = null;
      return;
    }
    const L = this.lastLayout;
    const d = this.game.display;
    if (!L || !d?.toVirtual) return;
    const p = d.toVirtual(e.clientX, e.clientY);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (p.x < L.list.x + L.list.w + 4) this.scrollBy('list', dy);
    else this.scrollBy('body', dy);
  }

  /** keep the selected row (and its group heading) inside the list */
  private ensureVisible(): void {
    const L = this.lastLayout;
    const items = this.items[this.tabIdx];
    const idx = items.findIndex((i) => i.kind === 'entry' && i.index === this.sel[this.tabIdx]);
    if (idx < 0 || !L) return;
    let top = items[idx].y;
    if (idx > 0 && items[idx - 1].kind === 'group') top = items[idx - 1].y;
    const bottom = items[idx].y + items[idx].h;
    const s = this.listScroll[this.tabIdx];
    const viewH = L.list.h - 4;
    if (top < s) this.listScroll[this.tabIdx] = top;
    else if (bottom > s + viewH) this.listScroll[this.tabIdx] = bottom - viewH;
    this.scrollBy('list', 0);
  }

  // ---- frame -------------------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.age += dt;
    const { total } = this.slotsOf(this.current);
    this.clock = (this.clock + dt) % total;
    // finger scrolling: remember the speed of the last moves, fling when the finger lifts
    if (this.dragTarget) {
      if (this.dragAcc !== 0) {
        const inst = -this.dragAcc / Math.max(dt, 1 / 120);
        this.dragVel = this.dragIdle > 0 ? inst : this.dragVel * 0.4 + inst * 0.6;
        this.dragAcc = 0;
        this.dragIdle = 0;
      } else if (++this.dragIdle >= 3) {
        if (Math.abs(this.dragVel) > 150) this.fling = { target: this.dragTarget, vel: this.dragVel };
        this.dragTarget = null;
        this.dragVel = 0;
      }
    }
    if (this.fling) {
      const f = this.fling;
      const before = f.target === 'list' ? this.listScroll[this.tabIdx] : this.bodyScroll;
      this.scrollBy(f.target, f.vel * dt);
      const after = f.target === 'list' ? this.listScroll[this.tabIdx] : this.bodyScroll;
      f.vel *= Math.exp(-dt * 3.5);
      if (Math.abs(f.vel) < 14 || after === before) this.fling = null;
    }
  }

  private slotsOf(e: CodexEntry): { slots: Slot[]; total: number } {
    let s = this.slotCache.get(e.id);
    if (!s) {
      s = previewSlots(this.sheet(e.preview.sheet), e.preview.steps);
      this.slotCache.set(e.id, s);
    }
    return s;
  }

  /** the sheet of a preview; a variant whose own sheet is missing shows its base sheet (like the game does) */
  private sheet(name: string): SpriteSheet {
    const a = this.game.assets;
    const s = a.sheet(name);
    const def = (ENEMY_DEFS as Record<string, { base: string; variant: boolean } | undefined>)[name];
    return s.placeholder && def?.variant ? a.sheet(def.base) : s;
  }

  private hit(id: string, rect: AABB, onTap: () => void, onDrag?: (dx: number, dy: number) => void): void {
    if (this.age < LOCKOUT) return;
    this.game.taps.add({ id, rect, mode: 'up', onTap, onDrag });
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    const g = this.game;
    const L = codexLayout(W, H);
    this.lastLayout = L;
    this.ctx = c;
    this.drawnAt = typeof performance !== 'undefined' ? performance.now() : 0;
    const ease = Math.min(1, this.age / 0.14);
    dim(c, W, H, 0.96 * ease);
    g.taps.add({ id: 'modal-bg', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => {} });
    c.globalAlpha = ease;
    this.scrollBy('list', 0);
    this.scrollBy('body', 0);

    // header: title, tabs, close
    text(c, '도감', L.title.x, L.title.y, { size: SZ.l, bold: true, spacing: 2 });
    CODEX_TABS.forEach((t, i) => {
      const r = L.tabs[i];
      button(c, r, { label: t.label, selected: i === this.tabIdx, color: COL.cyan });
      this.hit('codex-tab-' + t.id, { x: r.x, y: r.y - 2, w: r.w, h: r.h + 6 }, () => this.setTab(i));
    });
    button(c, L.close, { label: '닫기', color: COL.amber });
    this.hit('codex-close', { x: L.close.x, y: L.close.y - 2, w: L.close.w, h: L.close.h + 6 }, () => this.close());
    c.fillStyle = COL.line;
    c.fillRect(CODEX_PAD, BODY_Y - 4, W - CODEX_PAD * 2, 1);

    this.drawList(c, L);
    this.drawDetail(c, L);

    text(c, this.hintText(c, L), W - CODEX_PAD, L.hint.y + L.hint.h / 2, { align: 'right', color: COL.dim });
    c.globalAlpha = 1;
  }

  /** The bottom hint for the current input device; when the description overflows it also names the scroll keys
   * (the longest wording that still fits the row, the shortest one if none does). */
  private hintText(c: CanvasRenderingContext2D, L: CodexLayout): string {
    const dev = this.game.input?.device ?? 'keyboard';
    if (dev !== 'gamepad' && dev !== 'keyboard') return '목록·설명은 드래그로 스크롤 · 미리보기를 탭하면 다음 동작';
    const pad = dev === 'gamepad';
    if (this.maxScroll('body') <= 0) return pad ? 'LB/RB 탭   ↕ 선택   A 동작 전환   B 닫기' : '←→·Q/E 탭   ↑↓ 선택   Enter 동작 전환   Esc 닫기';
    const variants = pad
      ? ['LB/RB 탭   ↕ 선택   R스틱 ↕ 설명 스크롤   A 동작 전환   B 닫기', 'LB/RB 탭   ↕ 선택   R스틱 ↕ 설명   A 동작 전환   B 닫기', 'LB/RB 탭  ↕ 선택  R스틱 설명  A 동작  B 닫기', '↕ 선택  R스틱 설명  B 닫기']
      : ['←→·Q/E 탭   ↑↓ 선택   PgUp/PgDn 설명 스크롤   Enter 동작 전환   Esc 닫기', '←→·Q/E 탭   ↑↓ 선택   PgUp/PgDn 설명   Enter 동작 전환   Esc 닫기', '←→ 탭  ↑↓ 선택  PgUp/PgDn 설명  Enter 동작  Esc 닫기', '↑↓ 선택  PgUp/PgDn 설명  Esc 닫기'];
    return variants.find((v) => textWidth(c, v, SZ.s) <= L.hint.w) ?? variants[variants.length - 1];
  }

  // ---- list --------------------------------------------------------------------------------------------------------

  private drawList(c: CanvasRenderingContext2D, L: CodexLayout): void {
    const r = L.list;
    panel(c, r.x, r.y, r.w, r.h, { fill: '#080b14', alpha: 0.9, stroke: COL.line, r: 6 });
    const entries = this.entries();
    const items = this.items[this.tabIdx];
    const scroll = this.listScroll[this.tabIdx];
    const inner = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 };
    this.hit('codex-list', r, () => {}, (_dx, dy) => this.onDrag('list', dy));
    c.save();
    c.beginPath();
    c.rect(inner.x, inner.y, inner.w, inner.h);
    c.clip();
    for (const it of items) {
      const y = inner.y + it.y - scroll;
      if (y + it.h < inner.y || y > inner.y + inner.h) continue;
      if (it.kind === 'group') {
        text(c, it.label, inner.x + 8, y + it.h / 2 + 1, { size: SZ.s, bold: true, color: COL.amber });
        const lx = inner.x + 8 + Math.ceil(textWidth(c, it.label, SZ.s, true)) + 6;
        c.fillStyle = COL.line;
        c.fillRect(lx, Math.round(y + it.h / 2 + 1), inner.x + inner.w - 12 - lx, 1);
        continue;
      }
      const e = entries[it.index];
      const row = { x: inner.x + 2, y: y + 1, w: inner.w - 8, h: it.h - 2 };
      const selected = it.index === this.sel[this.tabIdx];
      panel(c, row.x, row.y, row.w, row.h, { fill: selected ? COL.panelHi : COL.panel, alpha: selected ? 0.98 : 0.55, stroke: selected ? COL.cyan : null, lineWidth: 2, r: 5 });
      this.drawThumb(c, e, row.x + 18, row.y + row.h / 2, 28);
      const tx = row.x + 36;
      const maxW = row.w - 40;
      text(c, ellipsize(c, e.name, maxW, SZ.s, true), tx, row.y + 13, { size: SZ.s, bold: true, color: e.nameColor ?? (selected ? COL.cyan : COL.text) });
      if (e.tag) text(c, ellipsize(c, e.tag, maxW, SZ.s), tx, row.y + 26, { size: SZ.s, color: COL.dim });
      const vis = intersect(row, inner);
      if (vis) this.hit('codex-entry-' + e.id, vis, () => this.select(it.index), (_dx, dy) => this.onDrag('list', dy));
    }
    c.restore();
    this.drawScrollbar(c, { x: r.x + r.w - 5, y: r.y + 4, w: 3, h: r.h - 8 }, this.listContentH(), r.h - 4, scroll);
  }

  private drawScrollbar(c: CanvasRenderingContext2D, bar: AABB, contentH: number, viewH: number, scroll: number): void {
    if (contentH <= viewH + 1) return;
    const th = Math.max(16, (bar.h * viewH) / contentH);
    const ty = bar.y + ((bar.h - th) * scroll) / Math.max(1, contentH - viewH);
    c.fillStyle = 'rgba(159,232,255,0.28)';
    c.fillRect(bar.x, ty, bar.w, th);
  }

  /** thumbnail of an entry (first frame of its icon, cropped to the opaque pixels) */
  private drawThumb(c: CanvasRenderingContext2D, e: CodexEntry, cx: number, cy: number, size: number): void {
    const sheet = this.sheet(e.icon.sheet);
    const def = sheet.anim(e.icon.anim);
    const b = scanFrame(sheet, e.icon.anim, 0);
    let s = Math.min(size / b.w, size / b.h);
    if (s >= 1) s = Math.floor(s);
    c.save();
    c.imageSmoothingEnabled = s < 1;
    c.drawImage(sheet.img, b.x, def.row * sheet.frameH + b.y, b.w, b.h, Math.round(cx - (b.w * s) / 2), Math.round(cy - (b.h * s) / 2), Math.round(b.w * s), Math.round(b.h * s));
    c.restore();
  }

  // ---- detail ------------------------------------------------------------------------------------------------------

  private textLayout(c: CanvasRenderingContext2D, e: CodexEntry, L: CodexLayout): TextLayout {
    const headW = L.wide && L.head ? L.head.w : L.body.w;
    const rowsW = L.body.w;
    const key = `${e.id}|${headW}|${rowsW}`;
    let t = this.textCache.get(key);
    if (t) return t;
    const descLines = wrap(c, e.desc, headW - 4, SZ.s);
    const headH = 22 + descLines.length * LINE_H + 6;
    const rows: TextLayout['rows'] = [];
    let y = 0;
    // a long label ('고유 효과' on the unique items' pages) must not run into its value text
    const labelW = Math.max(LABEL_W, ...e.rows.map((r) => (r.label ? Math.ceil(textWidth(c, r.label, SZ.s, true)) + LABEL_GAP : 0)));
    for (const row of e.rows) {
      const lines = wrap(c, row.text, rowsW - labelW - 10, SZ.s);
      rows.push({ label: row.label, color: row.color, lines, y });
      y += lines.length * LINE_H + 3;
    }
    // no gap after the last row: the scroll range ends exactly at its last line
    t = { descLines, headH, labelW, rows, rowsH: rows.length ? y - 3 : 0 };
    if (this.textCache.size > 80) this.textCache.clear();
    this.textCache.set(key, t);
    return t;
  }

  private drawDetail(c: CanvasRenderingContext2D, L: CodexLayout): void {
    const d = L.detail;
    panel(c, d.x, d.y, d.w, d.h, { fill: '#0b0f1b', alpha: 0.92, stroke: COL.line, r: 6 });
    const e = this.current;
    this.drawPreview(c, e, L.preview);
    this.hit('codex-preview', L.preview, () => this.nextAnim());

    const tl = this.textLayout(c, e, L);
    const drawHead = (x: number, y: number, w: number): void => {
      text(c, e.name, x, y + 9, { size: SZ.m, bold: true, color: e.nameColor ?? COL.text });
      if (e.tag) text(c, e.tag, x + w - 4, y + 9, { size: SZ.s, align: 'right', color: COL.dim });
      tl.descLines.forEach((ln, i) => text(c, ln, x, y + 28 + i * LINE_H, { size: SZ.s, color: '#c9d6ee' }));
    };
    if (L.wide && L.head) drawHead(L.head.x, L.head.y, L.head.w);

    const B = L.body;
    const scroll = this.bodyScroll;
    const headH = L.wide ? 0 : tl.headH;
    this.hit('codex-body', B, () => {}, (_dx, dy) => this.onDrag('body', dy));
    c.save();
    c.beginPath();
    c.rect(B.x, B.y, B.w, B.h);
    c.clip();
    let y0 = B.y - scroll;
    if (!L.wide) drawHead(B.x, y0, B.w - 6);
    y0 += headH;
    for (const r of tl.rows) {
      const y = y0 + r.y;
      if (y + r.lines.length * LINE_H < B.y || y > B.y + B.h) continue;
      if (r.label) text(c, r.label, B.x, y + LINE_H / 2, { size: SZ.s, bold: true, color: COL.amber });
      r.lines.forEach((ln, i) => text(c, ln, B.x + tl.labelW, y + LINE_H / 2 + i * LINE_H, { size: SZ.s, color: r.color ?? COL.text }));
    }
    c.restore();
    const contentH = headH + tl.rowsH;
    this.drawScrollbar(c, { x: B.x + B.w - 3, y: B.y, w: 3, h: B.h }, contentH, B.h, scroll);
    if (contentH > B.h + 1) {
      // text runs under an edge: fade it out there and point which way there is more
      const fade = (y: number, h: number, up: boolean): void => {
        const gr = c.createLinearGradient(0, y, 0, y + h);
        gr.addColorStop(0, up ? 'rgba(11,15,27,0.96)' : 'rgba(11,15,27,0)');
        gr.addColorStop(1, up ? 'rgba(11,15,27,0)' : 'rgba(11,15,27,0.96)');
        c.fillStyle = gr;
        c.fillRect(B.x, y, B.w, h);
      };
      if (scroll > 1) {
        fade(B.y, 12, true);
        text(c, '▲', B.x + B.w - 12, B.y + 6, { size: SZ.s, color: COL.cyan, alpha: 0.8 });
      }
      if (scroll < contentH - B.h - 1) {
        fade(B.y + B.h - 16, 16, false);
        text(c, '▼', B.x + B.w - 12, B.y + B.h - 6, { size: SZ.s, color: COL.cyan, alpha: 0.8 });
      }
    }
  }

  // ---- preview -----------------------------------------------------------------------------------------------------

  /** opaque bounds (anchor-relative sprite pixels) of everything the preview of `p` shows (cached per entry) */
  private previewBox(id: string, p: CodexPreview): Box {
    let hit = this.boxCache.get(id);
    if (!hit) {
      hit = this.computeBox(p);
      this.boxCache.set(id, hit);
    }
    return hit;
  }

  private computeBox(p: CodexPreview): Box {
    const sheet = this.sheet(p.sheet);
    let b: Box = animBox(sheet, p.steps[0].anim);
    const merge = (o: Box): void => {
      b = { x0: Math.min(b.x0, o.x0), y0: Math.min(b.y0, o.y0), x1: Math.max(b.x1, o.x1), y1: Math.max(b.y1, o.y1) };
    };
    for (const s of p.steps) merge(animBox(sheet, s.anim));
    if (p.rest) merge(animBox(sheet, p.rest));
    if (p.ground) merge({ x0: 0, y0: 0, x1: 0, y1: 0 });
    if (p.prop) {
      const ps = this.sheet(p.prop.sheet);
      const pb = animBox(ps, p.prop.steps[0].anim);
      for (const dx of [p.prop.dx, p.prop.dx + (p.prop.travel ?? 0)]) merge({ x0: dx + pb.x0, y0: p.prop.dy + pb.y0, x1: dx + pb.x1, y1: p.prop.dy + pb.y1 });
    }
    return b;
  }

  private drawPreview(c: CanvasRenderingContext2D, e: CodexEntry, plate: AABB): void {
    const p = e.preview;
    const d = this.game.display;
    const dev = d?.scale ?? 1;
    const offX = d?.offsetX ?? 0;
    const offY = d?.offsetY ?? 0;
    const sheet = this.sheet(p.sheet);
    const { slots } = this.slotsOf(e);
    const slot = slotAt(slots, this.clock);
    const lt = this.clock - slot.start;
    const idx = slots.indexOf(slot);

    // dark plate with a soft glow in the middle, so that dark sprites (ravens, shadow archers) still read
    const glow = c.createRadialGradient(plate.x + plate.w / 2, plate.y + plate.h * 0.55, 6, plate.x + plate.w / 2, plate.y + plate.h * 0.55, plate.w * 0.62);
    glow.addColorStop(0, '#1d2845');
    glow.addColorStop(1, '#070a14');
    panel(c, plate.x, plate.y, plate.w, plate.h, { fill: glow as unknown as string, stroke: COL.line, r: 6 });
    const box = this.previewBox(e.id, p);
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const availW = plate.w - 20;
    const availH = plate.h - 24;
    const s = fitScale(availW, availH, bw, bh, dev);
    const snapX = (v: number): number => (Math.round(v * dev + offX) - offX) / dev;
    const snapY = (v: number): number => (Math.round(v * dev + offY) - offY) / dev;
    const ax = snapX(plate.x + plate.w / 2 - ((box.x0 + box.x1) / 2) * s);
    const ay = snapY(plate.y + 6 + (plate.h - 24) / 2 - ((box.y0 + box.y1) / 2) * s);

    c.save();
    rrect(c, plate.x + 1, plate.y + 1, plate.w - 2, plate.h - 2, 5);
    c.clip();
    if (p.ground) {
      // floor under the feet
      const fy = Math.round(ay);
      c.fillStyle = '#0c1120';
      c.fillRect(plate.x + 1, fy, plate.w - 2, plate.y + plate.h - fy);
      c.fillStyle = '#26304d';
      c.fillRect(plate.x + 1, fy, plate.w - 2, 1);
    }
    // main sprite: a one-shot that finished rests on the `rest` animation (looping) or holds its last frame
    let anim = slot.step.anim;
    let def = slot.def;
    let frame = frameAt(def, slot.native, lt);
    if (!def.loop && lt >= slot.native && p.rest) {
      anim = p.rest;
      def = sheet.anim(anim);
      frame = frameAt(def, 1, lt - slot.native);
    }
    this.blit(c, sheet, anim, frame, ax, ay, s, dev, offX, offY);
    if (p.prop) this.drawProp(c, p.prop, ax, ay, s, dev, offX, offY, plate, p.ground ? ay : null);
    c.restore();

    // labels: animation name and position in the cycle
    const n = slots.length;
    text(c, slot.step.anim, plate.x + 8, plate.y + plate.h - 10, { size: SZ.s, color: COL.cyan });
    if (n > 1) text(c, `${idx + 1}/${n} ▶`, plate.x + plate.w - 8, plate.y + plate.h - 10, { size: SZ.s, align: 'right', color: COL.dim });
  }

  /** One frame with its anchor at (ax, ay), `s` virtual px per sprite px (whole device pixels when s*dev is whole). */
  private blit(c: CanvasRenderingContext2D, sheet: SpriteSheet, anim: string, frame: number, ax: number, ay: number, s: number, dev: number, offX: number, offY: number): void {
    const def = sheet.anim(anim);
    const f = clamp(frame, 0, def.frames - 1);
    const dx = (Math.round((ax - sheet.ax * s) * dev + offX) - offX) / dev;
    const dy = (Math.round((ay - sheet.ay * s) * dev + offY) - offY) / dev;
    c.save();
    c.imageSmoothingEnabled = s * dev < 1;
    c.drawImage(sheet.img, f * sheet.frameW, def.row * sheet.frameH, sheet.frameW, sheet.frameH, dx, dy, sheet.frameW * s, sheet.frameH * s);
    c.restore();
  }

  private drawProp(c: CanvasRenderingContext2D, prop: PreviewProp, ax: number, ay: number, s: number, dev: number, offX: number, offY: number, plate: AABB, floorY: number | null): void {
    const pt = this.clock - prop.start;
    if (pt < 0) return;
    const sheet = this.sheet(prop.sheet);
    const { slots, total } = previewSlots(sheet, prop.steps);
    const slot = slotAt(slots, Math.min(pt, total - 0.001));
    let frame: number;
    if (pt >= total) frame = slot.def.loop ? frameAt(slot.def, slot.native, pt - slot.start) : slot.def.frames - 1;
    else frame = frameAt(slot.def, slot.native, pt - slot.start);
    let ox = prop.dx;
    let oy = prop.dy;
    if (prop.motion) {
      const flight = prop.flight ?? 0.5;
      const u = clamp(pt / flight, 0, 1);
      ox += (prop.travel ?? 0) * u;
      if (prop.motion === 'lob') {
        // arcs over the target and lands on the floor
        oy += (-6 - prop.dy) * u - 44 * 4 * u * (1 - u);
      }
      if (pt > flight) {
        // landed: the burst ring of a grenade, then gone
        if (prop.blast) {
          const k = (pt - flight) / 0.35;
          if (k < 1) {
            const cx = ax + ox * s;
            const cy = ay + oy * s;
            c.save();
            if (floorY !== null) {
              c.beginPath();
              c.rect(plate.x, plate.y, plate.w, floorY - plate.y);
              c.clip();
            }
            c.globalAlpha = (1 - k) * 0.9;
            c.strokeStyle = prop.blast.color;
            c.lineWidth = 2;
            c.beginPath();
            c.arc(cx, cy, prop.blast.radius * s * (0.25 + 0.75 * (1 - Math.pow(1 - k, 3))), 0, Math.PI * 2);
            c.stroke();
            c.restore();
          }
        }
        return;
      }
    }
    this.blit(c, sheet, slot.step.anim, frame, ax + ox * s, ay + oy * s, s, dev, offX, offY);
  }
}

function buildItems(entries: CodexEntry[]): ListItem[] {
  const out: ListItem[] = [];
  let y = 2;
  let group: string | undefined;
  entries.forEach((e, index) => {
    if (e.group && e.group !== group) {
      out.push({ kind: 'group', label: e.group, y, h: GROUP_H });
      y += GROUP_H;
    }
    group = e.group;
    out.push({ kind: 'entry', index, y, h: ROW_H });
    y += ROW_H;
  });
  return out;
}

/** Shorten a string with "…" to fit maxW. */
function ellipsize(c: CanvasRenderingContext2D, s: string, maxW: number, size: number, bold = false): string {
  if (textWidth(c, s, size, bold) <= maxW) return s;
  let t = s;
  while (t.length > 1 && textWidth(c, t + '…', size, bold) > maxW) t = t.slice(0, -1);
  return t + '…';
}
