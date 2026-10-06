import type { AABB } from '../../engine/math';
import { clamp } from '../../engine/math';
import type { ScrollKey } from '../../engine/gamepad';
import type { LevelUI, ChoiceOption } from './levelUI';
import { META_UPGRADES, buyBlock, buyUpgrade, type MetaUpgrade } from '../meta/progression';
import { COL, SZ, button, dim, formatTime, icon, panel, pulse, text, textWidth, wrap } from './draw';
import { LEVEL_SEQUENCE } from '../run';
import { drawGestureGlyph, type Glyph } from './glyphs';
import { SettingsScreen, MODE_LABEL, drawButtonsPreview, drawPadList, type SettingsTab } from './settings';
import { CodexScreen } from './codex';
import type { CodexTabId } from './codexData';

/** `special` = X on the keyboard, Y on the pad: the second action of a screen (분해 in the stash) */
export type ModalKey = 'left' | 'right' | 'up' | 'down' | 'confirm' | 'cancel' | 'special';

/** Taps are ignored for this long after a modal opens (a finger lifting from the previous tap must not hit a card). */
const LOCKOUT = 0.2;

/** A full-screen overlay. The world is paused while any modal is open. */
export abstract class Modal {
  age = 0;
  constructor(protected ui: LevelUI) {}

  update(dt: number): void {
    this.age += dt;
  }

  /** Draw the overlay and register its tap regions (topmost last). */
  abstract draw(c: CanvasRenderingContext2D, W: number, H: number): void;

  key(_k: ModalKey): void {}

  /** back / Esc */
  cancel(): void {
    this.ui.closeTop();
  }

  /** tabbed screens: Q / E, LB / RB (dir -1 / +1) */
  tab(_dir: number): void {}

  /** screens with a long text panel: PageUp / PageDown / Home / End, Shift+arrows, the right stick */
  scroll(_k: ScrollKey): void {}

  /** does a held key (auto-repeat) keep acting? (list screens: arrows) */
  repeatKey(_code: string): boolean {
    return false;
  }

  protected get ready(): boolean {
    return this.age >= LOCKOUT;
  }

  protected get ease(): number {
    return Math.min(1, this.age / 0.14);
  }

  /** Dim the screen and swallow every touch so nothing leaks to the gameplay gestures. */
  protected backdrop(c: CanvasRenderingContext2D, W: number, H: number, alpha = 0.74, onTap?: () => void): void {
    dim(c, W, H, alpha * this.ease);
    this.ui.game.taps.add({ id: 'modal-bg', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => { if (this.ready) onTap?.(); } });
  }

  protected hit(id: string, rect: AABB, onTap: () => void, extra: { onDrag?: (dx: number, dy: number) => void } = {}): void {
    if (!this.ready) return;
    this.ui.game.taps.add({ id, rect, mode: 'up', onTap, ...extra });
  }

  protected sfx(s: 'ui_tap' | 'ui_open' | 'ui_close' | 'buy' | 'error' | 'scroll'): void {
    this.ui.game.audio.play(s);
  }
}

// ---------------------------------------------------------------------------
// Choice (scroll colours, item swap)

export class ChoiceModal extends Modal {
  sel = 0;
  private done = false;

  constructor(ui: LevelUI, readonly title: string, readonly options: ChoiceOption[], private onPick: (i: number) => void, readonly cancellable: boolean) {
    super(ui);
    const first = options.findIndex((o) => !o.disabled);
    this.sel = Math.max(0, first);
  }

  layout(W: number, H: number): AABB[] {
    const n = Math.max(1, this.options.length);
    const gap = 10;
    const cw = clamp(Math.floor((W - 40 - (n - 1) * gap) / n), 96, 172);
    const ch = 178;
    const total = n * cw + (n - 1) * gap;
    const x0 = Math.round((W - total) / 2);
    const y = Math.round(H / 2 - ch / 2 + 12);
    return this.options.map((_, i) => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch }));
  }

  pick(i: number): void {
    if (this.done) return;
    if (i >= 0 && this.options[i]?.disabled) {
      this.sfx('error');
      return;
    }
    this.done = true;
    this.sfx(i < 0 ? 'ui_close' : 'ui_tap');
    this.ui.closeTop(this);
    this.onPick(i);
  }

  key(k: ModalKey): void {
    const n = this.options.length;
    if (k === 'left' || k === 'up') this.sel = (this.sel + n - 1) % n;
    else if (k === 'right' || k === 'down') this.sel = (this.sel + 1) % n;
    else if (k === 'confirm') this.pick(this.sel);
    else if (k === 'cancel' && this.cancellable) this.pick(-1);
  }

  cancel(): void {
    if (this.cancellable) this.pick(-1);
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.backdrop(c, W, H, 0.78, () => { if (this.cancellable) this.pick(-1); });
    const rects = this.layout(W, H);
    c.globalAlpha = this.ease;
    const top = rects[0]?.y ?? H / 2;
    text(c, this.title, W / 2, top - 28, { size: SZ.l, bold: true, align: 'center', spacing: 2 });
    this.options.forEach((o, i) => {
      const r = rects[i];
      const accent = o.color ?? COL.cyan;
      const sel = i === this.sel;
      c.globalAlpha = this.ease * (o.disabled ? 0.5 : 1);
      panel(c, r.x, r.y, r.w, r.h, { fill: sel ? COL.panelHi : COL.panel, stroke: sel ? accent : COL.line, lineWidth: sel ? 2 : 1, r: 7 });
      c.fillStyle = accent;
      c.fillRect(r.x + 8, r.y + 1, r.w - 16, 3);
      // glow disc behind the icon
      const cx = r.x + r.w / 2;
      const g = c.createRadialGradient(cx, r.y + 52, 4, cx, r.y + 52, 38);
      g.addColorStop(0, hexA(accent, sel ? 0.45 : 0.28));
      g.addColorStop(1, hexA(accent, 0));
      c.fillStyle = g;
      c.fillRect(r.x, r.y + 8, r.w, 90);
      if (o.icon) icon(this.ui.game.assets, c, o.icon, cx, r.y + 52, 56);
      text(c, o.label, cx, r.y + 100, { size: SZ.m, bold: true, align: 'center', color: accent });
      if (o.sub) wrap(c, o.sub, r.w - 16, SZ.s).slice(0, 4).forEach((l, li) => text(c, l, cx, r.y + 120 + li * 14, { align: 'center', color: COL.dim }));
      if (sel && this.ui.game.input.device !== 'touch') text(c, this.ui.game.input.device === 'gamepad' ? 'A' : 'Enter', cx, r.y + r.h - 10, { align: 'center', color: accent, alpha: 0.5 + 0.5 * pulse(this.age, 1.2) });
      c.globalAlpha = this.ease;
      this.hit('choice' + i, r, () => this.pick(i));
    });
    const hintY = (rects[0]?.y ?? 0) + (rects[0]?.h ?? 0) + 22;
    text(c, this.cancellable ? '카드를 터치해 선택 · 빈 곳을 터치하면 취소' : '카드를 터치해 선택', W / 2, hintY, { align: 'center', color: COL.dim });
    c.globalAlpha = 1;
  }
}

export function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------------------
// Alchemist (meta shop)

export interface AlchemistLayout {
  panel: AABB;
  /** one rect per upgrade: where it sits on ITS page (only the rows of the current page are drawn) */
  rows: AABB[];
  close: AABB;
  buy: AABB;
  prev: AABB;
  next: AABB;
}

/** upgrades on one page of the Alchemist screen: two columns of five rows (the blueprints of the item expansion made the list longer than the screen) */
export const ALCHEMIST_PAGE = 10;

export class AlchemistModal extends Modal {
  sel: number;
  /** the page shown; it follows the selection */
  page: number;
  private msg: { text: string; color: string; t: number } | null = null;
  private shake = 0;

  constructor(ui: LevelUI) {
    super(ui);
    const run = ui.world.run;
    const save = ui.game.save;
    const buyable = META_UPGRADES.findIndex((u) => buyBlock(u, run, save) === null);
    const avail = META_UPGRADES.findIndex((u) => u.available(save));
    this.sel = buyable >= 0 ? buyable : Math.max(0, avail);
    this.page = Math.floor(this.sel / ALCHEMIST_PAGE);
  }

  private get pages(): number {
    return Math.max(1, Math.ceil(META_UPGRADES.length / ALCHEMIST_PAGE));
  }

  private select(i: number): void {
    this.sel = i;
    this.page = Math.floor(i / ALCHEMIST_PAGE);
  }

  /** the pager buttons / LB RB: the first upgrade of the next (or previous) page, wrapping round */
  private turn(dir: number): void {
    const to = (this.page + dir + this.pages) % this.pages;
    this.select(to * ALCHEMIST_PAGE);
    this.sfx('ui_tap');
  }

  tab(dir: number): void {
    if (this.pages > 1) this.turn(dir);
  }

  layout(W: number, H: number): AlchemistLayout {
    const p = { x: 12, y: 6, w: W - 24, h: H - 12 };
    const cols = 2;
    const gap = 8;
    const rw = Math.floor((p.w - 24 - gap) / cols);
    const rh = 40;
    const rg = 5;
    const y0 = p.y + 66;
    const rows = META_UPGRADES.map((_, i) => {
      const k = i % ALCHEMIST_PAGE;
      return { x: p.x + 12 + (k % cols) * (rw + gap), y: y0 + Math.floor(k / cols) * (rh + rg), w: rw, h: rh };
    });
    const by = p.y + p.h - 46;
    const close = { x: p.x + 12, y: by, w: 104, h: 38 };
    const buy = { x: p.x + p.w - 12 - 168, y: by, w: 168, h: 38 };
    // the pager sits between them: < 1/3 >
    const mid = Math.round((close.x + close.w + buy.x) / 2);
    return { panel: p, rows, close, buy, prev: { x: mid - 56, y: by, w: 36, h: 38 }, next: { x: mid + 20, y: by, w: 36, h: 38 } };
  }

  private buySelected(): void {
    const u = META_UPGRADES[this.sel];
    if (!u) return;
    const ui = this.ui;
    const res = buyUpgrade(u, ui.world.run, ui.game.save);
    if (res === 'ok') {
      ui.game.persist();
      this.sfx('buy');
      this.msg = { text: `${u.name} 구매 완료`, color: COL.green, t: 2.2 };
      // move to the next thing worth buying
      const next = META_UPGRADES.findIndex((x) => x.available(ui.game.save));
      if (next >= 0 && META_UPGRADES[this.sel].owned(ui.game.save)) this.select(next);
    } else {
      this.sfx('error');
      this.shake = 0.3;
      this.msg = {
        text: res === 'poor' ? '셀이 부족합니다' : res === 'owned' ? '이미 구매했습니다' : '먼저 이전 단계를 구매하세요',
        color: COL.red,
        t: 2.2,
      };
    }
  }

  key(k: ModalKey): void {
    const n = META_UPGRADES.length;
    if (k === 'up') this.select((this.sel + n - 2) % n);
    else if (k === 'down') this.select((this.sel + 2) % n);
    else if (k === 'left') this.select((this.sel + n - 1) % n);
    else if (k === 'right') this.select((this.sel + 1) % n);
    else if (k === 'confirm') this.buySelected();
    else if (k === 'cancel') this.cancel();
  }

  update(dt: number): void {
    super.update(dt);
    if (this.msg && (this.msg.t -= dt) <= 0) this.msg = null;
    if (this.shake > 0) this.shake -= dt;
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.backdrop(c, W, H, 0.82);
    const L = this.layout(W, H);
    const run = this.ui.world.run;
    const save = this.ui.game.save;
    const assets = this.ui.game.assets;
    c.globalAlpha = this.ease;
    panel(c, L.panel.x, L.panel.y, L.panel.w, L.panel.h, { fill: '#0d111e', alpha: 0.97, stroke: '#4a5d8a', lineWidth: 2, r: 8 });
    // header
    const npc = assets.sheet('alchemist');
    let hx = L.panel.x + 14;
    if (!npc.placeholder) {
      npc.draw(c, 'idle', Math.floor(this.age * 8), L.panel.x + 40, L.panel.y + 62, false, { scale: 0.5 });
      hx += 56;
    }
    text(c, '연금술사 모르웬', hx, L.panel.y + 20, { size: SZ.l, bold: true });
    // (the line under the name also carries the result of the last purchase)
    if (this.msg) text(c, this.msg.text, hx, L.panel.y + 40, { bold: true, color: this.msg.color, alpha: Math.min(1, this.msg.t * 2) });
    else text(c, '셀을 바치면 영구적인 힘을 얻을 수 있어요.', hx, L.panel.y + 40, { color: COL.dim });
    text(c, '※ 쓰지 않은 셀은 사망하면 모두 사라집니다.', hx, L.panel.y + 54, { color: COL.amber });
    const cellsX = L.panel.x + L.panel.w - 14;
    text(c, String(run.cells), cellsX, L.panel.y + 22, { size: SZ.l, bold: true, align: 'right', color: COL.cell });
    icon(assets, c, 'cells', cellsX - textWidth(c, String(run.cells), SZ.l, true) - 14, L.panel.y + 22, 22);
    text(c, '보유 셀', cellsX, L.panel.y + 42, { align: 'right', color: COL.dim });
    // rows
    const first = this.page * ALCHEMIST_PAGE;
    const shown = META_UPGRADES.slice(first, first + ALCHEMIST_PAGE);
    shown.forEach((u, k) => this.drawRow(c, u, L.rows[first + k], first + k === this.sel, run.cells, save));
    shown.forEach((_, k) => this.hit('alch' + (first + k), L.rows[first + k], () => { this.select(first + k); this.sfx('ui_tap'); }));
    // footer
    const u = META_UPGRADES[this.sel];
    const block = u ? buyBlock(u, run, save) : 'owned';
    button(c, L.close, { label: '닫기', color: COL.dim });
    this.hit('alch-close', L.close, () => this.ui.closeTop(this));
    const bx = L.buy.x + (this.shake > 0 ? Math.round(Math.sin(this.age * 60) * 3) : 0);
    button(c, { ...L.buy, x: bx }, {
      label: block === 'owned' ? '구매 완료' : block === 'locked' ? '잠김' : '구매',
      sub: u && !block ? `${u.cost} 셀` : u && block === 'poor' ? `${u.cost} 셀 필요` : undefined,
      color: COL.cell,
      selected: !block,
      disabled: !!block,
    });
    this.hit('alch-buy', L.buy, () => this.buySelected());
    if (this.pages > 1) {
      button(c, L.prev, { label: '<' });
      button(c, L.next, { label: '>' });
      text(c, `${this.page + 1}/${this.pages}`, (L.prev.x + L.prev.w + L.next.x) / 2, L.prev.y + L.prev.h / 2, { align: 'center', bold: true });
      this.hit('alch-prev', L.prev, () => this.turn(-1));
      this.hit('alch-next', L.next, () => this.turn(1));
    }
    c.globalAlpha = 1;
  }

  private drawRow(c: CanvasRenderingContext2D, u: MetaUpgrade, r: AABB, sel: boolean, cells: number, save: Parameters<MetaUpgrade['owned']>[0]): void {
    const owned = u.owned(save);
    const locked = !owned && !u.available(save);
    const afford = cells >= u.cost;
    const a = this.ease * (owned || locked ? 0.55 : 1);
    c.globalAlpha = a;
    panel(c, r.x, r.y, r.w, r.h, { fill: sel ? COL.panelHi : COL.panel, stroke: sel ? COL.cyan : COL.line, lineWidth: sel ? 2 : 1, r: 5 });
    icon(this.ui.game.assets, c, u.icon, r.x + 22, r.y + r.h / 2, 28);
    text(c, u.name, r.x + 44, r.y + 14, { bold: true });
    text(c, u.desc, r.x + 44, r.y + 29, { color: COL.dim });
    if (owned) text(c, '보유', r.x + r.w - 10, r.y + r.h / 2, { align: 'right', bold: true, color: COL.green });
    else {
      const costStr = String(u.cost);
      text(c, costStr, r.x + r.w - 10, r.y + r.h / 2, { align: 'right', bold: true, color: afford && !locked ? COL.cell : COL.red });
      icon(this.ui.game.assets, c, 'cells', r.x + r.w - 10 - textWidth(c, costStr, SZ.s, true) - 10, r.y + r.h / 2, 16);
    }
    c.globalAlpha = this.ease;
  }
}

// ---------------------------------------------------------------------------
// Full map

export class MapModal extends Modal {
  private panX = 0;
  private panY = 0;

  constructor(ui: LevelUI) {
    super(ui);
    ui.hud.map.refresh();
  }

  key(k: ModalKey): void {
    const step = 4;
    if (k === 'left') this.panX -= step;
    else if (k === 'right') this.panX += step;
    else if (k === 'up') this.panY -= step;
    else if (k === 'down') this.panY += step;
    else if (k === 'confirm' || k === 'cancel') this.ui.closeTop(this);
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    const map = this.ui.hud.map;
    const world = this.ui.world;
    this.backdrop(c, W, H, 0.94);
    c.globalAlpha = this.ease;
    const view = { x: 12, y: 34, w: W - 24, h: H - 34 - 34 };
    const scale = map.fullScale(view.w, view.h);
    const size = map.fullSize(scale);
    // pan limits (in tiles) so the map never leaves the view
    const maxPanX = Math.max(0, (size.w - view.w) / 2 / scale);
    const maxPanY = Math.max(0, (size.h - view.h) / 2 / scale);
    this.panX = clamp(this.panX, -maxPanX, maxPanX);
    this.panY = clamp(this.panY, -maxPanY, maxPanY);
    text(c, `지도 · ${world.run.level.name}`, W / 2, 16, { size: SZ.m, bold: true, align: 'center' });
    panel(c, view.x, view.y, view.w, view.h, { fill: '#07060b', alpha: 0.6, stroke: COL.line, r: 4 });
    map.drawFull(c, view, scale, this.panX, this.panY, this.age);
    map.drawLegend(c, 16, H - 17);
    text(c, maxPanX || maxPanY ? '드래그해서 이동 · 탭하면 닫기' : '탭하면 닫기', W - 14, H - 17, { align: 'right', color: COL.dim });
    c.globalAlpha = 1;
    // full-screen region on top of the blocker: drag pans, tap closes
    this.hit('map-view', { x: 0, y: 0, w: W, h: H }, () => this.ui.closeTop(this), {
      onDrag: (dx, dy) => {
        this.panX -= dx / scale;
        this.panY -= dy / scale;
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Pause

export class PauseModal extends Modal {
  private sel = 0;
  private confirmGiveUp = 0;
  private buttons: { label: string; sub?: string; color?: string; act: () => void }[] = [];

  constructor(ui: LevelUI) {
    super(ui);
    this.rebuild();
  }

  private rebuild(): void {
    const ui = this.ui;
    const game = ui.game;
    const s = game.save.settings;
    this.buttons = [
      { label: '계속하기', color: COL.cyan, act: () => ui.closeTop(this) },
      {
        label: `소리  ${game.audio.muted ? '꺼짐' : '켜짐'}`,
        act: () => {
          game.audio.setMuted(!game.audio.muted);
          s.muted = game.audio.muted;
          game.persist();
          this.rebuild();
        },
      },
      {
        label: `조작 도움말  ${s.hints ? '켜짐' : '꺼짐'}`,
        sub: s.hints ? '다음 판 시작 때 조작법을 보여줍니다' : undefined,
        act: () => {
          s.hints = !s.hints;
          game.persist();
          this.rebuild();
        },
      },
      { label: '설정', sub: '조작 · 그래픽 · 사운드', act: () => ui.openSettings() },
      { label: '도감', sub: '무기 · 스킬 · 적 · 보스 · 아이템', act: () => ui.openCodex() },
      {
        label: this.confirmGiveUp > 0 ? '정말 포기할까요? 한 번 더 터치' : '포기하기',
        color: COL.red,
        act: () => {
          if (this.confirmGiveUp > 0) ui.giveUp();
          else {
            this.confirmGiveUp = 3;
            this.rebuild();
          }
        },
      },
    ];
  }

  update(dt: number): void {
    super.update(dt);
    if (this.confirmGiveUp > 0 && (this.confirmGiveUp -= dt) <= 0) {
      this.confirmGiveUp = 0;
      this.rebuild();
    }
  }

  key(k: ModalKey): void {
    const n = this.buttons.length;
    if (k === 'up' || k === 'left') this.sel = (this.sel + n - 1) % n;
    else if (k === 'down' || k === 'right') this.sel = (this.sel + 1) % n;
    else if (k === 'confirm') this.buttons[this.sel].act();
    else if (k === 'cancel') this.ui.closeTop(this);
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.backdrop(c, W, H, 0.8, () => this.ui.closeTop(this));
    const bw = 250;
    const bh = 36;
    const gap = 6;
    const ph = 62 + this.buttons.length * (bh + gap) + 12;
    const px = Math.round((W - bw - 32) / 2);
    const py = Math.round((H - ph) / 2);
    c.globalAlpha = this.ease;
    panel(c, px, py, bw + 32, ph, { fill: '#0d111e', alpha: 0.97, stroke: '#4a5d8a', lineWidth: 2, r: 8 });
    text(c, '일시정지', W / 2, py + 22, { size: SZ.l, bold: true, align: 'center' });
    const run = this.ui.world.run;
    const idx = Math.min(run.levelIndex, LEVEL_SEQUENCE.length - 1);
    text(c, `${run.level.name} (${idx + 1}/${LEVEL_SEQUENCE.length}) · ${formatTime(run.time)}`, W / 2, py + 44, { align: 'center', color: COL.dim });
    this.buttons.forEach((b, i) => {
      const r = { x: px + 16, y: py + 62 + i * (bh + gap), w: bw, h: bh };
      button(c, r, { label: b.label, sub: b.sub, color: b.color, selected: i === this.sel });
      this.hit('pause' + i, r, () => { this.sel = i; this.sfx('ui_tap'); b.act(); });
    });
    c.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Gesture tutorial

const TUTORIAL: { glyph: Glyph; title: string; how: string }[] = [
  { glyph: 'drag', title: '이동', how: '왼쪽을 누른 채\n드래그' },
  { glyph: 'tap', title: '공격', how: '오른쪽을 톡 탭' },
  { glyph: 'up', title: '점프', how: '오른쪽에서 위로 쓸기\n(공중에서 한 번 더)' },
  { glyph: 'side', title: '구르기', how: '오른쪽에서\n좌우로 쓸기' },
  { glyph: 'down', title: '내려찍기', how: '오른쪽에서\n아래로 쓸기' },
  { glyph: 'hold', title: '보조 무기', how: '오른쪽을\n길게 누르기' },
];

export class TutorialModal extends Modal {
  /** first-run tutorial (dismissing it turns the hints setting off) vs. opened from the pause menu */
  constructor(ui: LevelUI, private firstRun: boolean) {
    super(ui);
  }

  private dismiss(): void {
    if (this.firstRun) {
      this.ui.game.save.settings.hints = false;
      this.ui.game.persist();
    }
    this.ui.closeTop(this);
  }

  key(k: ModalKey): void {
    if (k === 'confirm' || k === 'cancel') this.dismiss();
  }

  cancel(): void {
    this.dismiss();
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.backdrop(c, W, H, 0.86, () => this.dismiss());
    c.globalAlpha = this.ease;
    const mode = this.ui.game.save.settings.controlMode;
    if (mode !== 'gesture') {
      this.drawOtherMode(c, W, H, mode);
      c.globalAlpha = 1;
      return;
    }
    const cols = W >= 740 ? 6 : 3;
    const rows = Math.ceil(TUTORIAL.length / cols);
    const cw = Math.min(150, Math.floor((W - 32) / cols));
    const ch = 120;
    const x0 = Math.round((W - cols * cw) / 2);
    const total = 30 + rows * ch + 18 + 44;
    const y0 = Math.round((H - total) / 2);
    text(c, '조작 방법', W / 2, y0 + 12, { size: SZ.l, bold: true, align: 'center', spacing: 3 });
    TUTORIAL.forEach((t, i) => {
      const cx = x0 + (i % cols) * cw + cw / 2;
      const cy = y0 + 30 + Math.floor(i / cols) * ch;
      drawGestureGlyph(c, t.glyph, cx, cy + 28, this.age);
      text(c, t.title, cx, cy + 62, { bold: true, align: 'center', size: SZ.m, color: COL.cyan });
      wrap(c, t.how, cw - 8, SZ.s).forEach((l, li) => text(c, l, cx, cy + 79 + li * 13, { align: 'center', color: COL.dim }));
    });
    const ky = y0 + 30 + rows * ch + 4;
    text(c, '플라스크·스킬·상호작용 말풍선·미니맵은 화면의 아이콘을 터치', W / 2, ky, { align: 'center', color: COL.text });
    const btn = { x: Math.round(W / 2 - 80), y: ky + 14, w: 160, h: 36 };
    button(c, btn, { label: '시작하기', color: COL.cyan, selected: true });
    this.hit('tutorial-any', { x: 0, y: 0, w: W, h: H }, () => this.dismiss());
    this.hit('tutorial-ok', btn, () => this.dismiss());
    c.globalAlpha = 1;
  }

  /** 가상 버튼 / 게임패드: the same "how to play" card, showing the layout or the pad mapping instead of gestures. */
  private drawOtherMode(c: CanvasRenderingContext2D, W: number, H: number, mode: 'buttons' | 'gamepad'): void {
    const game = this.ui.game;
    const s = game.save.settings;
    text(c, '조작 방법', W / 2, 34, { size: SZ.l, bold: true, align: 'center', spacing: 3 });
    text(c, MODE_LABEL[mode], W / 2, 56, { align: 'center', color: COL.cyan, bold: true });
    if (mode === 'buttons') {
      const pw = Math.min(300, W - 48);
      const r = { x: Math.round((W - pw) / 2), y: 72, w: pw, h: Math.round((pw * 9) / 16) };
      drawButtonsPreview(c, s, r);
      text(c, '왼쪽 방향키로 이동, 오른쪽 버튼으로 공격·점프·구르기·보조 무기·스킬', W / 2, r.y + r.h + 36, { align: 'center', color: COL.text });
      text(c, '플라스크·말풍선·미니맵은 화면의 아이콘을 터치', W / 2, r.y + r.h + 52, { align: 'center', color: COL.dim });
    } else {
      const pad = game.pad;
      const lw = Math.min(460, W - 32);
      const r = { x: Math.round((W - lw) / 2), y: 72, w: lw, h: 5 * 30 };
      drawPadList(c, s, r);
      text(c, pad.connected ? `연결됨: ${pad.id}` : '게임패드를 연결하고 아무 버튼이나 누르세요', W / 2, r.y + r.h + 10, { align: 'center', color: pad.connected ? COL.green : COL.amber });
      text(c, '이동: 왼쪽 스틱 / 십자키   메뉴: A 확인 · B 뒤로', W / 2, r.y + r.h + 28, { align: 'center', color: COL.dim });
    }
    const btn = { x: Math.round(W / 2 - 80), y: H - 56, w: 160, h: 36 };
    button(c, btn, { label: '시작하기', color: COL.cyan, selected: true });
    this.hit('tutorial-any', { x: 0, y: 0, w: W, h: H }, () => this.dismiss());
    this.hit('tutorial-ok', btn, () => this.dismiss());
  }
}

// ---------------------------------------------------------------------------
// Settings (wraps SettingsScreen, which the title screen also uses)

export class SettingsModal extends Modal {
  readonly screen: SettingsScreen;

  constructor(ui: LevelUI, tab: SettingsTab = 'control') {
    super(ui);
    this.screen = new SettingsScreen(ui.game, () => ui.closeTop(this), tab);
  }

  update(dt: number): void {
    super.update(dt);
    this.screen.update(dt);
  }

  key(k: ModalKey): void {
    this.screen.key(k);
  }

  cancel(): void {
    this.screen.key('cancel');
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.screen.draw(c, W, H);
  }
}

// ---------------------------------------------------------------------------
// Codex (도감): wraps CodexScreen, which the title screen also uses. The run stays paused underneath.

export class CodexModal extends Modal {
  readonly screen: CodexScreen;

  constructor(ui: LevelUI, tab: CodexTabId = 'weapon') {
    super(ui);
    this.screen = new CodexScreen(ui.game, () => ui.closeTop(this), tab);
  }

  update(dt: number): void {
    super.update(dt);
    this.screen.update(dt);
  }

  key(k: ModalKey): void {
    this.screen.key(k);
  }

  tab(dir: number): void {
    this.screen.cycleTab(dir);
  }

  scroll(k: ScrollKey): void {
    this.screen.key(k);
  }

  repeatKey(code: string): boolean {
    return code === 'ArrowUp' || code === 'ArrowDown' || code === 'KeyW' || code === 'KeyS' || code === 'PageUp' || code === 'PageDown';
  }

  cancel(): void {
    this.screen.key('cancel');
  }

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.screen.draw(c, W, H);
  }
}
