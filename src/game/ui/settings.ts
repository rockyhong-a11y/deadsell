import type { Game } from '../game';
import type { AABB } from '../../engine/math';
import { FILTER_IDS, FILTER_LABEL } from '../../engine/filters';
import { WORLD_HEIGHTS } from '../../engine/config';
import {
  DPAD_BUTTONS, PAD_ACTIONS, PAD_ACTION_LABEL, assignButton, isDefaultMap, padButtonName, DEFAULT_PAD_MAP, padEnvironment,
  type NavKey, type PadAction,
} from '../../engine/gamepad';
import {
  BUTTON_OPACITY_STEPS, BUTTON_SIZES, CONTROL_MODES, type ControlMode, type Settings,
} from '../meta/save';
import { VSIZE_LABEL, drawVButtons, vbLayout } from './vbuttons';
import { COL, SZ, button, dim, panel, pulse, text, textWidth, wrap } from './draw';
import { GESTURE_CARDS, drawGestureGlyph } from './glyphs';

/**
 * 설정 screen: tabs 조작 / 그래픽 / 사운드. One class for the title screen and the in-level pause menu (the pause
 * menu wraps it in a Modal). Touch (tap options), keyboard and gamepad (up/down = row, left/right = change value,
 * A/Enter = confirm / cycle, B/Esc = back). Every change is applied and saved at once (Game.settingsChanged).
 */
export type SettingsTab = 'control' | 'graphics' | 'sound';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'control', label: '조작' },
  { id: 'graphics', label: '그래픽' },
  { id: 'sound', label: '사운드' },
];

export const MODE_LABEL: Record<ControlMode, string> = { gesture: '터치 제스처', buttons: '가상 버튼', gamepad: '게임패드' };
const OPACITY_LABEL = ['연하게', '보통', '진하게'];
const FILTER_HELP: Record<(typeof FILTER_IDS)[number], string> = {
  sharp: '픽셀이 또렷한 기본 화면입니다.',
  smooth: '화면을 부드럽게 늘려 픽셀 경계를 흐리게 합니다.',
  crt: '주사선·잔광·가장자리 어둠을 더한 옛날 브라운관 느낌입니다.',
  lcd: '픽셀 사이에 가는 격자를 넣어 휴대용 게임기 화면처럼 보입니다.',
  vivid: '채도와 대비를 높여 색을 또렷하게 합니다.',
  mono: '화면을 흑백으로 바꿉니다.',
};
const RES_LABEL = ['288 · 가까이', '360 · 기본', '432 · 넓게'];
const SOUND_STEPS = ['0%', '25%', '50%', '75%', '100%'];

type Row =
  | { kind: 'choice'; id: string; label: string; options: string[]; get: () => number; set: (i: number) => void; cols?: number }
  | { kind: 'pad'; action: PadAction }
  | { kind: 'action'; id: string; label: string; act: () => void };

interface Box {
  row: number;
  box: AABB;
  /** choice rows: one rect per option */
  opts: AABB[];
  labelW: number;
}

const PADX = 16;
const OPT_H = 34;
const GAP = 4;
/** taps are ignored for this long after the screen opens (the finger that opened it is still lifting) */
const LOCKOUT = 0.2;

function nearest(steps: readonly number[], v: number): number {
  let bi = 0;
  steps.forEach((s, i) => { if (Math.abs(s - v) < Math.abs(steps[bi] - v)) bi = i; });
  return bi;
}

export class SettingsScreen {
  tab: SettingsTab;
  /** focused row of the current tab (-1 = the tab bar) */
  focus = 0;
  age = 0;
  /** pad action waiting for a button press (remap) */
  listen: PadAction | null = null;
  private listenT = 0;
  private closed = false;

  constructor(readonly game: Game, private onClose: () => void, tab: SettingsTab = 'control') {
    this.tab = tab;
  }

  get settings(): Settings {
    return this.game.save.settings;
  }

  private change(): void {
    this.game.settingsChanged();
  }

  // ---- rows --------------------------------------------------------------

  rows(): Row[] {
    const s = this.settings;
    const g = this.game;
    const choice = (id: string, label: string, options: string[], get: () => number, set: (i: number) => void, cols?: number): Row => ({ kind: 'choice', id, label, options, get, set, cols });
    if (this.tab === 'control') {
      const rows: Row[] = [
        choice('mode', '조작 방식', CONTROL_MODES.map((m) => MODE_LABEL[m]), () => CONTROL_MODES.indexOf(s.controlMode), (i) => { s.controlMode = CONTROL_MODES[i]; this.change(); }),
      ];
      if (s.controlMode === 'buttons') {
        rows.push(
          choice('size', '버튼 크기', BUTTON_SIZES.map((b) => VSIZE_LABEL[b]), () => BUTTON_SIZES.indexOf(s.btnSize), (i) => { s.btnSize = BUTTON_SIZES[i]; this.change(); }),
          choice('opacity', '투명도', OPACITY_LABEL, () => nearest(BUTTON_OPACITY_STEPS, s.btnOpacity), (i) => { s.btnOpacity = BUTTON_OPACITY_STEPS[i]; this.change(); }),
        );
      }
      if (s.controlMode === 'gamepad') {
        for (const a of PAD_ACTIONS) rows.push({ kind: 'pad', action: a });
        rows.push({ kind: 'action', id: 'reset-pad', label: '기본값 복원', act: () => { this.stopListen(); s.gamepadMap = { ...DEFAULT_PAD_MAP }; this.change(); } });
      } else {
        rows.push(choice('hints', '조작 도움말', ['켜짐', '꺼짐'], () => (s.hints ? 0 : 1), (i) => { s.hints = i === 0; this.change(); }));
      }
      return rows;
    }
    if (this.tab === 'graphics') {
      return [
        choice('filter', '필터', FILTER_IDS.map((f) => FILTER_LABEL[f]), () => FILTER_IDS.indexOf(s.filter), (i) => { s.filter = FILTER_IDS[i]; this.change(); }, 3),
        choice('res', '해상도', RES_LABEL, () => WORLD_HEIGHTS.indexOf(s.resolution), (i) => { s.resolution = WORLD_HEIGHTS[i]; this.change(); }),
        choice('fit', '화면 맞춤', ['화면 채우기', '정수 배율'], () => (s.fit === 'fill' ? 0 : 1), (i) => { s.fit = i === 0 ? 'fill' : 'integer'; this.change(); }),
        choice('quality', '화질', ['고화질', '절전'], () => (s.quality === 'high' ? 0 : 1), (i) => { s.quality = i === 0 ? 'high' : 'saver'; this.change(); }),
      ];
    }
    return [
      choice('muted', '소리', ['켜짐', '꺼짐'], () => (g.audio.muted ? 1 : 0), (i) => { s.muted = i === 1; this.change(); }),
      choice('sfx', '효과음', SOUND_STEPS, () => Math.round(s.sfx * 4), (i) => { s.sfx = i / 4; this.change(); }),
      choice('music', '음악', SOUND_STEPS, () => Math.round(s.music * 4), (i) => { s.music = i / 4; this.change(); }),
    ];
  }

  // ---- layout ------------------------------------------------------------

  private choiceBox(i: number, row: Extract<Row, { kind: 'choice' }>, x: number, y: number, w: number, labelW = 78): Box {
    const cols = row.cols ?? row.options.length;
    const nrows = Math.ceil(row.options.length / cols);
    const ax = x + labelW;
    const aw = w - labelW;
    const cw = (aw - (cols - 1) * GAP) / cols;
    const opts = row.options.map((_, k) => ({
      x: ax + (k % cols) * (cw + GAP), y: y + Math.floor(k / cols) * (OPT_H + GAP), w: cw, h: OPT_H,
    }));
    return { row: i, box: { x, y, w, h: nrows * OPT_H + (nrows - 1) * GAP }, opts, labelW };
  }

  /** Geometry of the current tab for a W × H view (also exposes the preview / status panels). */
  layout(W: number, H: number): { boxes: Box[]; preview: AABB | null; status: AABB | null; footer: AABB; reset: AABB | null; body: AABB } {
    const rows = this.rows();
    const boxes: Box[] = [];
    let y = 58;
    let preview: AABB | null = null;
    let status: AABB | null = null;
    let reset: AABB | null = null;
    const fw = W - PADX * 2;
    const footer = { x: Math.round(W / 2 - 70), y: H - 46, w: 140, h: 36 };
    if (this.tab === 'control') {
      const mode = this.settings.controlMode;
      boxes.push(this.choiceBox(0, rows[0] as Extract<Row, { kind: 'choice' }>, PADX, y, fw));
      y += 40;
      if (mode === 'buttons') {
        const pw = Math.min(260, Math.floor(fw * 0.45));
        const lw = fw - pw - 10;
        preview = { x: W - PADX - pw, y, w: pw, h: Math.round((pw * 9) / 16) };
        for (let i = 1; i < rows.length; i++) {
          boxes.push(this.choiceBox(i, rows[i] as Extract<Row, { kind: 'choice' }>, PADX, y, lw, 84));
          y += OPT_H + 6;
        }
      } else if (mode === 'gamepad') {
        status = { x: PADX, y, w: fw, h: 40 };
        y += 46;
        const colW = (fw - 8) / 2;
        const n = PAD_ACTIONS.length;
        for (let i = 0; i < n; i++) {
          const col = i < n / 2 ? 0 : 1;
          const r = i % (n / 2);
          boxes.push({ row: 1 + i, box: { x: PADX + col * (colW + 8), y: y + r * 30, w: colW, h: 28 }, opts: [], labelW: 0 });
        }
        reset = { x: PADX, y: footer.y, w: 130, h: 36 };
        boxes.push({ row: rows.length - 1, box: reset, opts: [], labelW: 0 });
      } else {
        boxes.push(this.choiceBox(1, rows[1] as Extract<Row, { kind: 'choice' }>, PADX, y, fw));
      }
    } else {
      rows.forEach((r, i) => {
        const b = this.choiceBox(i, r as Extract<Row, { kind: 'choice' }>, PADX, y, fw);
        boxes.push(b);
        y += b.box.h + 6;
      });
    }
    return { boxes, preview, status, footer, reset, body: { x: PADX, y: 58, w: fw, h: H - 58 - 54 } };
  }

  // ---- input -------------------------------------------------------------

  private sfx(s: 'ui_tap' | 'ui_close' | 'error'): void {
    this.game.audio.play(s);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopListen();
    this.sfx('ui_close');
    this.onClose();
  }

  private stopListen(): void {
    this.listen = null;
    if (this.game.pad.capture) this.game.pad.capture = null;
  }

  private startListen(a: PadAction): void {
    this.listen = a;
    this.listenT = 0;
    this.game.pad.capture = (b) => this.assign(a, b);
  }

  private assign(a: PadAction, button: number): void {
    this.listen = null;
    if (button >= DPAD_BUTTONS.up && button <= DPAD_BUTTONS.right) {
      this.sfx('error');
      return;
    }
    this.settings.gamepadMap = assignButton(this.settings.gamepadMap, a, button);
    this.sfx('ui_tap');
    this.change();
  }

  setTab(t: SettingsTab): void {
    if (t === this.tab) return;
    this.stopListen();
    this.tab = t;
    this.focus = Math.min(this.focus, 0);
    this.sfx('ui_tap');
  }

  /** Apply `delta` (-1 / +1, or 0 = cycle forward) to a choice row. */
  private bump(row: Extract<Row, { kind: 'choice' }>, delta: number, wrap: boolean): void {
    const n = row.options.length;
    const cur = row.get();
    let next = cur + (delta || 1);
    next = wrap ? (next + n) % n : Math.max(0, Math.min(n - 1, next));
    if (next !== cur) {
      row.set(next);
      this.sfx('ui_tap');
    }
  }

  key(k: NavKey): void {
    if (this.listen) {
      if (k === 'cancel' || k === 'pause') {
        this.stopListen();
        this.sfx('ui_close');
      }
      return;
    }
    const rows = this.rows();
    const ti = TABS.findIndex((t) => t.id === this.tab);
    if (k === 'cancel' || k === 'pause') {
      this.close();
      return;
    }
    if (k === 'up') {
      this.focus = Math.max(-1, this.focus - 1);
      return;
    }
    if (k === 'down') {
      this.focus = Math.min(rows.length - 1, this.focus + 1);
      return;
    }
    if (this.focus < 0) {
      if (k === 'left' || k === 'right') this.setTab(TABS[(ti + (k === 'right' ? 1 : TABS.length - 1)) % TABS.length].id);
      else if (k === 'confirm') this.focus = 0;
      return;
    }
    const row = rows[Math.min(this.focus, rows.length - 1)];
    if (row.kind === 'choice') {
      if (k === 'left') this.bump(row, -1, false);
      else if (k === 'right') this.bump(row, 1, false);
      else if (k === 'confirm') this.bump(row, 0, true);
    } else if (row.kind === 'pad') {
      const n = PAD_ACTIONS.length;
      const idx = PAD_ACTIONS.indexOf(row.action);
      if (k === 'confirm') this.startListen(row.action);
      else if (k === 'right' && idx < n / 2) this.focus = Math.min(rows.length - 1, this.focus + n / 2);
      else if (k === 'left' && idx >= n / 2) this.focus = Math.max(0, this.focus - n / 2);
    } else if (k === 'confirm') {
      row.act();
      this.sfx('ui_tap');
    }
  }

  update(dt: number): void {
    this.age += dt;
    if (this.listen) {
      this.listenT += dt;
      if (this.listenT > 10) this.stopListen();
    }
  }

  // ---- drawing -----------------------------------------------------------

  private hit(id: string, rect: AABB, fn: () => void): void {
    if (this.age < LOCKOUT) return;
    this.game.taps.add({ id, rect, mode: 'up', onTap: fn });
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    const g = this.game;
    const s = this.settings;
    const ease = Math.min(1, this.age / 0.14);
    dim(c, W, H, (this.tab === 'graphics' ? 0.55 : 0.9) * ease);
    g.taps.add({ id: 'modal-bg', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => {} });
    c.globalAlpha = ease;

    // header: title + tabs
    text(c, '설정', PADX, 27, { size: SZ.l, bold: true, spacing: 2 });
    const tx0 = 84;
    const tw = (W - PADX - tx0 - (TABS.length - 1) * 6) / TABS.length;
    TABS.forEach((t, i) => {
      const r = { x: tx0 + i * (tw + 6), y: 10, w: tw, h: 34 };
      const sel = t.id === this.tab;
      const focused = sel && this.focus < 0;
      button(c, r, { label: t.label, selected: sel, color: focused ? COL.amber : COL.cyan });
      if (focused) {
        c.strokeStyle = COL.amber;
        c.lineWidth = 2;
        c.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      }
      this.hit('set-tab-' + t.id, { x: r.x, y: 6, w: r.w, h: 42 }, () => { this.setTab(t.id); this.focus = 0; });
    });
    c.fillStyle = COL.line;
    c.fillRect(PADX, 50, W - PADX * 2, 1);

    const L = this.layout(W, H);
    const rows = this.rows();
    for (const b of L.boxes) {
      const row = rows[b.row];
      if (!row) continue;
      const focused = this.focus === b.row;
      if (row.kind === 'choice') this.drawChoice(c, row, b, focused);
      else if (row.kind === 'pad') this.drawPadRow(c, row.action, b.box, focused);
      else {
        button(c, b.box, { label: row.label, selected: focused, color: COL.amber, size: SZ.m });
        this.hit('set-' + row.id, b.box, () => { this.focus = b.row; row.act(); this.sfx('ui_tap'); });
      }
    }

    if (this.tab === 'control') {
      const mode = s.controlMode;
      if (mode === 'gesture') this.drawGestureCards(c, W, 58 + 40 + OPT_H + 12, H - 54);
      else if (mode === 'buttons' && L.preview) {
        const r = L.preview;
        drawButtonsPreview(c, s, r);
        text(c, '왼쪽 방향키 · 오른쪽 행동 버튼', r.x + r.w / 2, r.y + r.h + 14, { align: 'center', color: COL.dim });
        text(c, '스킬은 장착 시 · 멀티터치 가능', r.x + r.w / 2, r.y + r.h + 29, { align: 'center', color: COL.dim });
      }
      else if (mode === 'gamepad' && L.status) this.drawPadStatus(c, L.status);
    } else if (this.tab === 'graphics') {
      const y = L.boxes[L.boxes.length - 1].box.y + OPT_H + 6;
      panel(c, PADX - 6, y, W - PADX * 2 + 12, 52, { fill: '#05080f', alpha: 0.8, stroke: null, r: 6 });
      const help = wrap(c, `${FILTER_LABEL[s.filter]}: ${FILTER_HELP[s.filter]}`, W - PADX * 2, SZ.s);
      help.slice(0, 2).forEach((l, i) => text(c, l, PADX, y + 12 + i * 14, { color: COL.text }));
      text(c, '해상도 낮을수록 확대 · 정수 배율은 검은 여백이 생깁니다 · 바로 적용·저장', PADX, y + 12 + Math.min(2, help.length) * 14, { color: COL.dim });
    } else {
      const y = L.boxes[L.boxes.length - 1].box.y + OPT_H + 14;
      text(c, '소리는 이 화면에서도, 일시정지 메뉴에서도 켜고 끌 수 있습니다.', PADX, y, { color: COL.dim });
    }

    // footer
    button(c, L.footer, { label: '닫기', color: COL.cyan, selected: false });
    this.hit('set-close', { x: L.footer.x, y: L.footer.y - 2, w: L.footer.w, h: 40 }, () => this.close());
    const dev = g.input.device;
    const hint = dev === 'gamepad' ? '↕ 이동   ↔ 값 변경   A 선택   B 닫기' : dev === 'keyboard' ? '↑↓ 이동   ←→ 값 변경   Enter 선택   Esc 닫기' : '';
    if (hint) text(c, hint, W - PADX, H - 14, { align: 'right', color: COL.dim });
    c.globalAlpha = 1;
  }

  private drawChoice(c: CanvasRenderingContext2D, row: Extract<Row, { kind: 'choice' }>, b: Box, focused: boolean): void {
    const cur = row.get();
    const mid = b.box.y + OPT_H / 2;
    if (focused) {
      c.fillStyle = COL.amber;
      c.fillRect(b.box.x - 8, b.box.y, 3, b.box.h);
    }
    text(c, row.label, b.box.x, mid, { bold: true, size: SZ.m, color: focused ? COL.amber : COL.text });
    row.options.forEach((label, k) => {
      const r = b.opts[k];
      button(c, r, { label, selected: k === cur, color: focused ? COL.amber : COL.cyan, size: label.length > 7 ? SZ.s : SZ.m });
      this.hit(`set-${row.id}-${k}`, r, () => {
        this.focus = b.row;
        if (k !== row.get()) {
          row.set(k);
          this.sfx('ui_tap');
        }
      });
    });
  }

  private drawPadRow(c: CanvasRenderingContext2D, a: PadAction, r: AABB, focused: boolean): void {
    const map = this.settings.gamepadMap;
    const listening = this.listen === a;
    panel(c, r.x, r.y, r.w, r.h, { fill: focused ? COL.panelHi : COL.panel, stroke: listening ? COL.amber : focused ? COL.cyan : COL.line, lineWidth: focused || listening ? 2 : 1, alpha: 0.95, r: 5 });
    text(c, PAD_ACTION_LABEL[a], r.x + 10, r.y + r.h / 2, { bold: true, size: SZ.m, color: focused ? COL.cyan : COL.text });
    if (listening) text(c, '버튼을 누르세요…', r.x + r.w - 10, r.y + r.h / 2, { align: 'right', bold: true, color: COL.amber, alpha: 0.5 + 0.5 * pulse(this.age, 1.4) });
    else {
      const used = map[a] !== DEFAULT_PAD_MAP[a];
      text(c, padButtonName(map[a]), r.x + r.w - 10, r.y + r.h / 2, { align: 'right', bold: true, size: SZ.m, color: used ? COL.amber : COL.cyan });
    }
    this.hit('set-pad-' + a, r, () => {
      this.focus = 1 + PAD_ACTIONS.indexOf(a);
      if (listening) this.stopListen();
      else this.startListen(a);
    });
  }

  private drawPadStatus(c: CanvasRenderingContext2D, r: AABB): void {
    const pad = this.game.pad;
    panel(c, r.x, r.y, r.w, r.h, { fill: '#0a0d18', stroke: pad.connected ? COL.green : COL.line, alpha: 0.95, r: 6 });
    const maxW = r.w - 24;
    let id = pad.connected ? pad.id : '없음';
    while (id.length > 4 && textWidth(c, `게임패드: ${id}`, SZ.s) > maxW) id = id.slice(0, -2) + '…';
    text(c, `게임패드: ${id}`, r.x + 12, r.y + 13, { color: COL.text });
    if (pad.connected) {
      text(c, `연결됨${pad.mapping === 'standard' ? '' : '  ·  표준 배치가 아니므로 버튼을 직접 지정하세요'}`, r.x + 12, r.y + 29, { color: COL.green, bold: true });
    } else {
      const env = padEnvironment();
      const msg = env === 'unsupported' ? '이 브라우저는 게임패드를 지원하지 않습니다'
        : env === 'blocked' ? '이 화면(임베드)은 게임패드가 차단됨 · 게임 링크를 브라우저에서 직접 여세요'
        : '게임패드를 연결하고 아무 버튼이나 누르세요';
      text(c, msg, r.x + 12, r.y + 29, { color: env === 'ok' ? COL.amber : COL.red, bold: true, alpha: env === 'ok' ? 0.6 + 0.4 * pulse(this.age, 0.8) : 1 });
    }
    if (!isDefaultMap(this.settings.gamepadMap)) text(c, '사용자 지정', r.x + r.w - 12, r.y + 13, { align: 'right', color: COL.amber });
  }

  private drawGestureCards(c: CanvasRenderingContext2D, W: number, y0: number, y1: number): void {
    const cols = 3;
    const cw = Math.min(150, Math.floor((W - PADX * 2) / cols));
    const x0 = Math.round((W - cols * cw) / 2);
    const rh = Math.min(84, Math.floor((y1 - y0) / 2));
    GESTURE_CARDS.forEach((t, i) => {
      const cx = x0 + (i % cols) * cw + cw / 2;
      const top = y0 + Math.floor(i / cols) * rh;
      drawGestureGlyph(c, t.glyph, cx, top + 27, this.age + i * 0.3);
      text(c, t.title, cx, top + 57, { bold: true, size: SZ.m, align: 'center', color: COL.cyan });
      text(c, t.short, cx, top + 71, { align: 'center', color: COL.dim });
    });
  }
}

/** Mini screen showing the virtual buttons with the current size / opacity (settings + tutorial). */
export function drawButtonsPreview(c: CanvasRenderingContext2D, s: Settings, r: AABB): void {
  const VW = 640;
  const VH = 360;
  const k = r.w / VW;
  c.save();
  panel(c, r.x, r.y, r.w, r.h, { fill: '#05080f', stroke: COL.line, alpha: 0.96, r: 6 });
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.clip();
  c.translate(r.x, r.y);
  c.scale(k, k);
  // the HUD corners the buttons keep clear of
  c.fillStyle = '#7a2434';
  c.fillRect(8, 8, 140, 15);
  c.strokeStyle = COL.line;
  c.lineWidth = 3;
  c.strokeRect(VW - 120, 10, 112, 64);
  drawVButtons(c, vbLayout(VW, VH, s.btnSize, [true, true]), { opacity: s.btnOpacity, isDown: () => false });
  c.restore();
}

/** The action -> button table in two columns of five (tutorial; the settings screen has its own interactive rows). */
export function drawPadList(c: CanvasRenderingContext2D, s: Settings, r: AABB): void {
  const colW = (r.w - 8) / 2;
  const half = PAD_ACTIONS.length / 2;
  PAD_ACTIONS.forEach((a, i) => {
    const box = { x: r.x + (i < half ? 0 : colW + 8), y: r.y + (i % half) * 30, w: colW, h: 28 };
    panel(c, box.x, box.y, box.w, box.h, { fill: COL.panel, stroke: COL.line, alpha: 0.95, r: 5 });
    text(c, PAD_ACTION_LABEL[a], box.x + 10, box.y + box.h / 2, { bold: true, size: SZ.m });
    text(c, padButtonName(s.gamepadMap[a]), box.x + box.w - 10, box.y + box.h / 2, { align: 'right', bold: true, size: SZ.m, color: COL.cyan });
  });
}
