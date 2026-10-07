import type { AABB } from '../../engine/math';
import type { LevelUI } from './levelUI';
import { Modal, hexA, type ModalKey } from './modals';
import { COL, SZ, button, clampLines, gradeBadge, gradeBadgeW, icon, panel, pieceIcon, text, textWidth, wrap } from './draw';
import { shardSummary } from './stashModal';
import { ITEMS, itemColor, itemName, signatureText } from '../items/items';
import { PIECE_COLOR } from '../items/pickups';
import type { ItemId } from '../items/types';
import { CRAFT, GRADE_IDS, GRADES, STASH, type Grade } from '../rules';
import { craftUnique, planCraft, uniquesOf, type CraftPlan } from '../meta/craft';

export interface CraftLayout {
  panel: AABB;
  /** the six grade tabs */
  tabs: AABB[];
  /** the recipe lines (as many rows as the longest recipe) */
  recipe: AABB[];
  /** the mini stash grid (24 cells, row by row) */
  grid: AABB[];
  /** the five uniques of the grade */
  rows: AABB[];
  /** the signature text of the selected unique (room for 3 lines) */
  detail: AABB;
  craft: AABB;
  close: AABB;
  /** the short result message between 닫기 and 조합: `y` = centre line, `w` = the free width */
  msg: { x: number; y: number; w: number };
  titleY: number;
  gridLabelY: number;
}

/** edge of a mini stash cell and the gap between them */
const MINI = 22;
const MINI_GAP = 2;

/** The pure geometry of the craft screen for a W x H virtual view (tests check it at W = 480..800). */
export function craftLayout(W: number, H: number): CraftLayout {
  const p = { x: 8, y: 6, w: W - 16, h: H - 12 };
  const x0 = p.x + 12;
  const tabs = GRADE_IDS.map((_, i) => ({ x: x0 + i * 66, y: p.y + 38, w: 62, h: 28 }));
  const bodyY = p.y + 74;
  const recipe = [0, 1, 2, 3].map((i) => ({ x: x0, y: bodyY + i * 20, w: 206, h: 18 }));
  const gridY = bodyY + 4 * 20 + 24;
  const step = MINI + MINI_GAP;
  const grid = Array.from({ length: STASH.capacity }, (_, i) => ({ x: x0 + (i % STASH.cols) * step, y: gridY + Math.floor(i / STASH.cols) * step, w: MINI, h: MINI }));
  const rx = x0 + 206 + 14;
  const rw = p.x + p.w - 12 - rx;
  // 32 px rows on a 36 px pitch: the room that is left below them holds the 3 lines the longest signature needs
  const rows = [0, 1, 2, 3, 4].map((i) => ({ x: rx, y: bodyY + i * 36, w: rw, h: 32 }));
  const by = p.y + p.h - 44;
  return {
    panel: p,
    tabs,
    recipe,
    grid,
    rows,
    detail: { x: rx, y: bodyY + 5 * 36, w: rw, h: by - 6 - (bodyY + 5 * 36) },
    craft: { x: rx, y: by, w: rw, h: 38 },
    close: { x: x0, y: by, w: 100, h: 38 },
    msg: { x: x0 + 110, y: by + 19, w: rx - 8 - (x0 + 110) },
    titleY: p.y + 20,
    gridLabelY: gridY - 10,
  };
}

/**
 * 조합 (docs/CONTENT4.md §4): Selma's craft screen. A tab per grade (C B A S SS SSS) shows its recipe with what the heroine has of each
 * line (green / red), the five uniques of the grade to pick from and `조합`; the stash entries a craft would consume are
 * highlighted in the little stash grid before it is confirmed. The crafted unique goes into the stash.
 * Touch: tap tabs, rows and buttons. Keyboard: Q / E or left / right = grade, up / down = unique, Enter = 조합, Esc. Pad: LB / RB, d-pad, A, B.
 */
export class CraftModal extends Modal {
  /** index of the grade tab */
  gi = 0;
  private sel: Record<Grade, number> = { C: 0, B: 0, A: 0, S: 0, SS: 0, SSS: 0 };
  private msg: { text: string; color: string; t: number } | null = null;

  /** `onCraft` runs after every successful craft (Selma plays her sewing animation) */
  constructor(ui: LevelUI, private onCraft: (id: ItemId) => void = () => {}) {
    super(ui);
    // open on the highest grade that can be crafted right now, else the lowest
    const best = GRADE_IDS.map((g, i) => ({ g, i })).filter(({ g }) => planCraft(g, this.save).ok).pop();
    this.gi = best?.i ?? 0;
  }

  private get save() {
    return this.ui.game.save;
  }

  get grade(): Grade {
    return GRADE_IDS[this.gi];
  }

  /** the five uniques of the open grade */
  get uniques(): ItemId[] {
    return uniquesOf(this.grade);
  }

  get selected(): ItemId {
    return this.uniques[this.sel[this.grade]];
  }

  get plan(): CraftPlan {
    return planCraft(this.grade, this.save);
  }

  private say(textStr: string, color: string): void {
    this.msg = { text: textStr, color, t: 2.4 };
  }

  // ---- actions ------------------------------------------------------------

  setGrade(i: number): void {
    this.gi = (i + GRADE_IDS.length) % GRADE_IDS.length;
  }

  craft(): void {
    const id = this.selected;
    const res = craftUnique(this.save, this.grade, id);
    if (!res.ok) {
      this.sfx('error');
      this.say(res.reason === 'materials' ? '재료가 부족합니다' : '보관함이 가득 찼다', COL.red);
      return;
    }
    const name = itemName(res.item);
    this.ui.game.persist();
    this.sfx('buy');
    this.ui.game.audio.play('pickup_item');
    this.say(`${name} 조합 완료`, itemColor(id));
    this.ui.world.emit({ type: 'toast', text: `${name} 조합 완료`, color: itemColor(id) });
    this.onCraft(id);
  }

  // ---- input --------------------------------------------------------------

  key(k: ModalKey): void {
    if (k === 'cancel') this.ui.closeTop(this);
    else if (k === 'confirm') this.craft();
    else if (k === 'left') this.setGrade(this.gi - 1);
    else if (k === 'right') this.setGrade(this.gi + 1);
    else if (k === 'up' || k === 'down') {
      const n = this.uniques.length;
      this.sel[this.grade] = (this.sel[this.grade] + (k === 'up' ? n - 1 : 1)) % n;
    }
  }

  tab(dir: number): void {
    this.setGrade(this.gi + dir);
  }

  update(dt: number): void {
    super.update(dt);
    if (this.msg && (this.msg.t -= dt) <= 0) this.msg = null;
  }

  // ---- drawing ------------------------------------------------------------

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.backdrop(c, W, H, 0.82);
    const L = craftLayout(W, H);
    const save = this.save;
    const plan = this.plan;
    const assets = this.ui.game.assets;
    c.globalAlpha = this.ease;
    panel(c, L.panel.x, L.panel.y, L.panel.w, L.panel.h, { fill: '#0d111e', alpha: 0.97, stroke: '#4a5d8a', lineWidth: 2, r: 8 });

    // header: title, bank and shards
    text(c, '조합', L.panel.x + 14, L.titleY, { size: SZ.l, bold: true });
    text(c, '재봉사 셀마', L.panel.x + 14 + 56, L.titleY + 2, { color: COL.dim });
    const right = L.panel.x + L.panel.w - 14;
    const bank = String(save.pieces);
    text(c, bank, right, L.titleY - 6, { size: SZ.m, bold: true, align: 'right', color: PIECE_COLOR });
    pieceIcon(assets, c, right - textWidth(c, bank, SZ.m, true) - 12, L.titleY - 6, 18);
    text(c, '시체 조각', right - textWidth(c, bank, SZ.m, true) - 26, L.titleY - 6, { align: 'right', color: COL.dim });
    const shardHead = `종탑의 파편 ${save.shards.length}`;
    const loops = save.shards.length ? ` (${shardSummary(c, save.shards, 150)})` : '';
    text(c, shardHead + loops, right, L.titleY + 9, { align: 'right', color: save.shards.length ? '#ffd9a0' : COL.dim });
    c.fillStyle = 'rgba(141,155,184,0.25)';
    c.fillRect(L.panel.x + 10, L.panel.y + 34, L.panel.w - 20, 1);

    // grade tabs (a green dot: that grade can be crafted right now)
    GRADE_IDS.forEach((g, i) => {
      const r = L.tabs[i];
      const on = i === this.gi;
      const color = GRADES[g].outline ?? GRADES[g].color;
      panel(c, r.x, r.y, r.w, r.h, { fill: on ? COL.panelHi : COL.panel, stroke: on ? color : COL.line, lineWidth: on ? 2 : 1, r: 5 });
      gradeBadge(c, g, r.x + r.w / 2, r.y + r.h / 2);
      if (planCraft(g, save).ok) {
        c.fillStyle = COL.green;
        c.beginPath();
        c.arc(r.x + r.w - 7, r.y + 7, 3, 0, Math.PI * 2);
        c.fill();
      }
      this.hit('craft-tab' + i, r, () => { this.sfx('ui_tap'); this.setGrade(i); });
    });

    // recipe lines, then the little stash grid with the entries a craft would consume
    plan.lines.forEach((l, i) => {
      const r = L.recipe[i];
      const col = l.ok ? COL.green : COL.red;
      text(c, l.label, r.x, r.y + r.h / 2, { color: l.ok ? COL.text : COL.dim });
      text(c, `${l.have}/${l.need}`, r.x + r.w, r.y + r.h / 2, { align: 'right', bold: true, color: col });
    });
    text(c, '쓰이는 칸', L.grid[0].x, L.gridLabelY, { color: COL.dim });
    const picks = new Set(plan.picks);
    L.grid.forEach((r, i) => {
      const inst = save.stash[i];
      const use = picks.has(i);
      panel(c, r.x, r.y, r.w, r.h, { fill: use ? '#3a2a10' : COL.panel, stroke: use ? COL.gold : inst ? hexA(itemColor(inst.id), 0.6) : COL.line, lineWidth: use ? 2 : 1, r: 3 });
      if (!inst) return;
      icon(assets, c, ITEMS[inst.id].icon, r.x + r.w / 2, r.y + r.h / 2, 18, use ? 1 : 0.8);
      // the grade of a unique as a coloured strip along the bottom (the letters do not fit the little cell)
      const g = ITEMS[inst.id].grade;
      if (g) {
        c.fillStyle = GRADES[g].color;
        c.fillRect(r.x + 3, r.y + r.h - 4, r.w - 6, 2);
      }
    });

    // the five uniques of the grade
    this.uniques.forEach((id, i) => {
      const r = L.rows[i];
      const def = ITEMS[id];
      const on = i === this.sel[this.grade];
      panel(c, r.x, r.y, r.w, r.h, { fill: on ? COL.panelHi : COL.panel, stroke: on ? itemColor(id) : COL.line, lineWidth: on ? 2 : 1, r: 5 });
      icon(assets, c, def.icon, r.x + 20, r.y + r.h / 2, 28);
      text(c, def.name, r.x + 40, r.y + 10, { bold: true, color: itemColor(id) });
      gradeBadge(c, def.grade ?? this.grade, r.x + r.w - 6 - gradeBadgeW(c, def.grade ?? this.grade) / 2, r.y + 10);
      text(c, def.desc, r.x + 40, r.y + 23, { color: COL.dim });
      this.hit('craft-row' + i, r, () => { this.sfx('ui_tap'); this.sel[this.grade] = i; });
    });
    // the signature of the selected unique and what the craft makes
    const sel = this.selected;
    const sig = signatureText(sel) || ITEMS[sel].desc;
    wrap(c, `${sig} · 티어 ${CRAFT[this.grade].tier}`, L.detail.w - 4, SZ.s).slice(0, Math.max(1, Math.floor(L.detail.h / 13))).forEach((l, n) => text(c, l, L.detail.x + 2, L.detail.y + 8 + n * 13, { color: COL.amber }));

    const ok = plan.ok;
    button(c, L.craft, { label: '조합', sub: ok ? undefined : '재료 부족', color: GRADES[this.grade].outline ?? GRADES[this.grade].color, selected: ok, disabled: !ok });
    this.hit('craft-do', L.craft, () => this.craft());
    button(c, L.close, { label: '닫기', color: COL.dim });
    this.hit('craft-close', L.close, () => this.ui.closeTop(this));
    if (this.msg) {
      // at most two lines in the room between the two buttons (never over their borders)
      const lines = clampLines(c, this.msg.text, L.msg.w, 2, SZ.s, true);
      lines.forEach((l, n) => text(c, l, L.msg.x, L.msg.y + (n - (lines.length - 1) / 2) * 13, { bold: true, color: this.msg!.color, alpha: Math.min(1, this.msg!.t * 2) }));
    }
    c.globalAlpha = 1;
  }
}
