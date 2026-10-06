import type { AABB } from '../../engine/math';
import type { LevelUI } from './levelUI';
import { Modal, hexA, type ModalKey } from './modals';
import { COL, SZ, button, gradeBadge, gradeBadgeW, gradeLetter, icon, panel, pieceIcon, pulse, text, textWidth, wrap } from './draw';
import { ITEMS, UNIQUE_TAG, itemColor, itemLines, itemName } from '../items/items';
import type { ItemInstance, ItemSlot } from '../items/types';
import { STASH } from '../rules';
import { depositEquipped, emptySlotFor, equipFromStash, salvageEntry, salvageValue, slotsOf, stashFull } from '../meta/stash';
import { PIECE_COLOR } from '../items/pickups';

/** edge of an item cell and the gap between cells (virtual px) */
const CELL = 40;
const GAP = 4;
/** the four equipment cells: two weapons, two skills */
const EQUIP_KIND: ItemSlot[] = ['weapon', 'weapon', 'skill', 'skill'];
const EQUIP_LABEL = ['주무기', '보조', '스킬 1', '스킬 2'];
/** seconds an armed 분해 waits for its second press */
const ARM_TIME = 3;

export interface StashLayout {
  panel: AABB;
  /** the 4 equipment cells (0, 1 = weapons, 2, 3 = skills) */
  equip: AABB[];
  /** the STASH.capacity cells of the grid, row by row */
  grid: AABB[];
  /** the item card of the selection */
  card: AABB;
  /** the main action (장착 / 맡기기) and 분해 */
  act: AABB;
  salvage: AABB;
  close: AABB;
  /** where the short result message goes */
  msg: { x: number; y: number };
  /** header baseline / the two cell-row labels */
  titleY: number;
  equipLabelY: number;
  gridLabelY: number;
}

/** The pure geometry of the stash screen for a W x H virtual view (tests check it at W = 480..800). */
export function stashLayout(W: number, H: number): StashLayout {
  const p = { x: 8, y: 6, w: W - 16, h: H - 12 };
  const x0 = p.x + 12;
  const step = CELL + GAP;
  // the two weapons, a wider gap, the two skills
  const equip = [0, 1, 2, 3].map((i) => ({ x: x0 + i * step + (i >= 2 ? 8 : 0), y: p.y + 56, w: CELL, h: CELL }));
  const gy = p.y + 118;
  const grid = Array.from({ length: STASH.capacity }, (_, i) => ({ x: x0 + (i % STASH.cols) * step, y: gy + Math.floor(i / STASH.cols) * step, w: CELL, h: CELL }));
  const gridBottom = gy + Math.ceil(STASH.capacity / STASH.cols) * step - GAP;
  const cx = x0 + STASH.cols * step - GAP + 14;
  const cw = p.x + p.w - 12 - cx;
  const card = { x: cx, y: p.y + 42, w: cw, h: gridBottom - (p.y + 42) };
  const by = p.y + p.h - 46;
  const bw = Math.floor((cw - 6) / 2);
  return {
    panel: p,
    equip,
    grid,
    card,
    act: { x: cx, y: by, w: bw, h: 38 },
    salvage: { x: cx + bw + 6, y: by, w: cw - bw - 6, h: 38 },
    close: { x: x0, y: by, w: 100, h: 38 },
    msg: { x: x0 + 110, y: by + 19 },
    titleY: p.y + 20,
    equipLabelY: p.y + 46,
    gridLabelY: p.y + 108,
  };
}

/** `1회차 x2 · 3회차`: the bell shards by the loop they were won in, cut to `maxW` px */
export function shardSummary(c: CanvasRenderingContext2D, shards: readonly number[], maxW: number): string {
  const by = new Map<number, number>();
  for (const l of shards) by.set(l, (by.get(l) ?? 0) + 1);
  const parts = [...by].sort((a, b) => a[0] - b[0]).map(([l, n]) => (n > 1 ? `${l}회차 ×${n}` : `${l}회차`));
  let out = parts.join(' · ');
  while (parts.length > 1 && textWidth(c, out, SZ.s) > maxW) {
    parts.pop();
    out = parts.join(' · ') + ' …';
  }
  return out;
}

type Zone = 'equip' | 'grid';

/**
 * 보관함 (docs/CONTENT4.md §2): the 4 equipped slots on top, the 24-cell stash grid below, the item card of the selection and its
 * actions: a stash item is equipped (`장착`, asking which slot when both are taken: the old one takes its place in the stash) or
 * salvaged into bank pieces (`분해`, armed by the first press); an equipped item is put away (`맡기기`).
 * Touch: tap cells and buttons. Keyboard: arrows + Enter, X = 분해, Esc. Pad: d-pad / stick, A, Y = 분해, B.
 */
export class StashModal extends Modal {
  zone: Zone = 'grid';
  i = 0;
  /** a stash index waiting for the slot it should replace (both slots of its kind are taken) */
  pending: number | null = null;
  /** the stash index whose 분해 was pressed once: pressing it again within ARM_TIME s does it */
  private armed: { index: number; t: number } | null = null;
  private msg: { text: string; color: string; t: number } | null = null;

  constructor(ui: LevelUI) {
    super(ui);
    if (this.save.stash.length === 0) this.zone = 'equip';
  }

  private get run() {
    return this.ui.world.run;
  }
  private get save() {
    return this.ui.game.save;
  }

  /** the item in equipment cell `i` */
  equipped(i: number): ItemInstance | null {
    return slotsOf(this.run, EQUIP_KIND[i])[i % 2];
  }

  /** the item under the cursor (null = an empty cell) */
  selected(): ItemInstance | null {
    return this.zone === 'equip' ? this.equipped(this.i) : this.save.stash[this.i] ?? null;
  }

  private say(textStr: string, color: string = COL.green): void {
    this.msg = { text: textStr, color, t: 2.2 };
  }

  private fail(textStr: string): void {
    this.sfx('error');
    this.say(textStr, COL.red);
  }

  private persist(): void {
    this.ui.game.persist();
  }

  // ---- actions ------------------------------------------------------------

  private select(zone: Zone, i: number): void {
    if (this.zone !== zone || this.i !== i) this.armed = null;
    this.zone = zone;
    this.i = i;
  }

  /** the main action of the selection: equip a stash item / put an equipped one away / complete a pending slot choice */
  primary(): void {
    if (this.pending !== null) {
      if (this.zone === 'equip' && EQUIP_KIND[this.i] === ITEMS[this.save.stash[this.pending].id].slot) this.chooseSlot(this.i % 2);
      return;
    }
    const inst = this.selected();
    if (!inst) {
      this.sfx('error');
      return;
    }
    if (this.zone === 'equip') {
      if (stashFull(this.save)) {
        this.fail('보관함이 가득 찼다');
        return;
      }
      depositEquipped(this.run, this.save, EQUIP_KIND[this.i], this.i % 2);
      this.persist();
      this.sfx('ui_tap');
      this.say(`${itemName(inst)} 맡김`);
      return;
    }
    const free = emptySlotFor(this.run, inst);
    if (free >= 0) {
      this.equip(this.i, free);
      return;
    }
    // both slots of its kind are taken: pick the one to replace
    this.pending = this.i;
    this.zone = 'equip';
    this.i = EQUIP_KIND.findIndex((k) => k === ITEMS[inst.id].slot);
    this.sfx('ui_tap');
  }

  private equip(stashIndex: number, slot: number): void {
    const inst = this.save.stash[stashIndex];
    if (!inst || !equipFromStash(this.run, this.save, stashIndex, slot)) return;
    this.persist();
    this.ui.game.audio.play('pickup_item');
    this.say(`${itemName(inst)} 장착`);
  }

  private chooseSlot(slot: number): void {
    const index = this.pending;
    this.pending = null;
    if (index === null) return;
    this.equip(index, slot);
    this.zone = 'grid';
    this.i = index;
  }

  /** 분해: the first press arms it, the second one (within ARM_TIME s) salvages the selected stash item into bank pieces */
  salvage(): void {
    if (this.pending !== null) return;
    const inst = this.zone === 'grid' ? this.save.stash[this.i] : undefined;
    if (!inst) {
      this.sfx('error');
      return;
    }
    if (!this.armed || this.armed.index !== this.i) {
      this.armed = { index: this.i, t: ARM_TIME };
      this.sfx('ui_tap');
      return;
    }
    this.armed = null;
    const n = salvageEntry(this.save, this.i);
    this.persist();
    this.sfx('buy');
    this.say(`${itemName(inst)} 분해 · 시체 조각 +${n}`, PIECE_COLOR);
  }

  private cancelPending(): boolean {
    if (this.pending === null) return false;
    this.zone = 'grid';
    this.i = this.pending;
    this.pending = null;
    this.sfx('ui_close');
    return true;
  }

  // ---- input --------------------------------------------------------------

  key(k: ModalKey): void {
    if (k === 'cancel') {
      if (!this.cancelPending()) this.ui.closeTop(this);
      return;
    }
    if (k === 'confirm') this.primary();
    else if (k === 'special') this.salvage();
    else this.move(k);
  }

  private move(k: 'left' | 'right' | 'up' | 'down'): void {
    const cols = STASH.cols;
    if (this.pending !== null) {
      // only the equipment cells of the pending item's kind can be chosen: left / right step between them
      const kind = ITEMS[this.save.stash[this.pending].id].slot;
      const cells = EQUIP_KIND.map((e, j) => (e === kind ? j : -1)).filter((j) => j >= 0);
      if (k === 'left') this.i = [...cells].reverse().find((j) => j < this.i) ?? this.i;
      else if (k === 'right') this.i = cells.find((j) => j > this.i) ?? this.i;
      return;
    }
    if (this.zone === 'equip') {
      if (k === 'left') this.select('equip', Math.max(0, this.i - 1));
      else if (k === 'right') this.select('equip', Math.min(EQUIP_KIND.length - 1, this.i + 1));
      else if (k === 'down') this.select('grid', this.i);
    } else if (k === 'left') this.select('grid', this.i % cols > 0 ? this.i - 1 : this.i);
    else if (k === 'right') this.select('grid', this.i % cols < cols - 1 ? this.i + 1 : this.i);
    else if (k === 'down') this.select('grid', this.i + cols < STASH.capacity ? this.i + cols : this.i);
    else if (this.i >= cols) this.select('grid', this.i - cols);
    else this.select('equip', Math.min(EQUIP_KIND.length - 1, this.i));
  }

  update(dt: number): void {
    super.update(dt);
    if (this.msg && (this.msg.t -= dt) <= 0) this.msg = null;
    if (this.armed && (this.armed.t -= dt) <= 0) this.armed = null;
  }

  // ---- drawing ------------------------------------------------------------

  draw(c: CanvasRenderingContext2D, W: number, H: number): void {
    this.backdrop(c, W, H, 0.82);
    const L = stashLayout(W, H);
    const save = this.save;
    const assets = this.ui.game.assets;
    c.globalAlpha = this.ease;
    panel(c, L.panel.x, L.panel.y, L.panel.w, L.panel.h, { fill: '#0d111e', alpha: 0.97, stroke: '#4a5d8a', lineWidth: 2, r: 8 });

    // header: title, the banked pieces and the bell shards
    text(c, '보관함', L.panel.x + 14, L.titleY, { size: SZ.l, bold: true });
    const right = L.panel.x + L.panel.w - 14;
    const bank = String(save.pieces);
    text(c, bank, right, L.titleY - 6, { size: SZ.m, bold: true, align: 'right', color: PIECE_COLOR });
    pieceIcon(assets, c, right - textWidth(c, bank, SZ.m, true) - 12, L.titleY - 6, 18);
    text(c, '시체 조각', right - textWidth(c, bank, SZ.m, true) - 26, L.titleY - 6, { align: 'right', color: COL.dim });
    const shardHead = `종탑의 파편 ${save.shards.length}`;
    const roomLeft = right - (L.panel.x + 14 + 70);
    const loops = save.shards.length ? ` (${shardSummary(c, save.shards, Math.max(40, roomLeft - textWidth(c, shardHead, SZ.s) - 14))})` : '';
    text(c, shardHead + loops, right, L.titleY + 9, { align: 'right', color: save.shards.length ? '#ffd9a0' : COL.dim });
    c.fillStyle = 'rgba(141,155,184,0.25)';
    c.fillRect(L.panel.x + 10, L.panel.y + 34, L.panel.w - 20, 1);

    // equipment row
    text(c, this.pending !== null ? '어느 칸과 바꿀까요?' : '장착 중', L.equip[0].x, L.equipLabelY, { color: this.pending !== null ? COL.amber : COL.dim, bold: this.pending !== null });
    const target = this.pending !== null ? ITEMS[save.stash[this.pending]?.id]?.slot : null;
    L.equip.forEach((r, i) => {
      const glow = target !== null && EQUIP_KIND[i] === target;
      this.drawCell(c, r, this.equipped(i), this.zone === 'equip' && this.i === i, EQUIP_LABEL[i], glow);
      this.hit('stash-equip' + i, r, () => this.tapCell('equip', i));
    });
    // stash grid
    text(c, `보관함  ${save.stash.length}/${STASH.capacity}`, L.grid[0].x, L.gridLabelY, { color: stashFull(save) ? COL.amber : COL.dim });
    L.grid.forEach((r, i) => {
      this.drawCell(c, r, save.stash[i] ?? null, this.zone === 'grid' && this.i === i, null, false, this.armed?.index === i);
      this.hit('stash-cell' + i, r, () => this.tapCell('grid', i));
    });

    // the card of the selection
    this.drawCard(c, L.card, this.selected());

    // buttons
    const inst = this.selected();
    const equipZone = this.zone === 'equip';
    if (this.pending !== null) {
      button(c, L.act, { label: '취소', color: COL.dim });
      this.hit('stash-act', L.act, () => { this.cancelPending(); });
    } else {
      const full = stashFull(save);
      const noAct = !inst || (equipZone && full);
      button(c, L.act, {
        label: equipZone ? '맡기기' : '장착', sub: equipZone && inst && full ? '가득 참' : undefined, color: COL.cyan, selected: !noAct, disabled: noAct,
      });
      this.hit('stash-act', L.act, () => this.primary());
      const canSalvage = !equipZone && !!inst;
      const armed = this.armed?.index === this.i && canSalvage;
      button(c, L.salvage, {
        label: armed ? '정말?' : '분해', sub: canSalvage ? `시체 조각 +${salvageValue(inst!)}` : undefined, color: armed ? COL.red : PIECE_COLOR, selected: armed, disabled: !canSalvage,
      });
      this.hit('stash-salvage', L.salvage, () => this.salvage());
    }
    button(c, L.close, { label: '닫기', color: COL.dim });
    this.hit('stash-close', L.close, () => this.ui.closeTop(this));
    if (this.msg) text(c, this.msg.text, L.msg.x, L.msg.y, { bold: true, color: this.msg.color, alpha: Math.min(1, this.msg.t * 2) });
    c.globalAlpha = 1;
  }

  private tapCell(zone: Zone, i: number): void {
    if (this.pending !== null) {
      // the pending choice: a valid equipment cell completes it, anything else cancels it
      if (zone === 'equip' && EQUIP_KIND[i] === ITEMS[this.save.stash[this.pending].id].slot) {
        this.chooseSlot(i % 2);
        return;
      }
      this.pending = null;
    }
    this.sfx('ui_tap');
    this.select(zone, i);
  }

  private drawCell(c: CanvasRenderingContext2D, r: AABB, inst: ItemInstance | null, sel: boolean, label: string | null, glow: boolean, armed = false): void {
    const accent = inst ? itemColor(inst.id) : COL.line;
    panel(c, r.x, r.y, r.w, r.h, {
      fill: sel ? COL.panelHi : COL.panel, stroke: sel ? COL.cyan : inst ? hexA(accent, 0.7) : COL.line, lineWidth: sel ? 2 : 1, r: 4,
    });
    if (glow) {
      c.globalAlpha = this.ease * (0.5 + 0.5 * pulse(this.age, 1.6));
      panel(c, r.x - 2, r.y - 2, r.w + 4, r.h + 4, { fill: 'rgba(0,0,0,0)', stroke: COL.amber, lineWidth: 2, r: 5 });
      c.globalAlpha = this.ease;
    }
    if (!inst) {
      if (label) text(c, label, r.x + r.w / 2, r.y + r.h / 2, { align: 'center', color: COL.dim, alpha: 0.7 });
      return;
    }
    const def = ITEMS[inst.id];
    icon(this.ui.game.assets, c, def.icon, r.x + r.w / 2, r.y + r.h / 2, 30);
    if (inst.tier > 1) text(c, `+${inst.tier - 1}`, r.x + 3, r.y + 8, { color: COL.gold, bold: true });
    if (inst.affix) {
      c.fillStyle = COL.amber;
      c.fillRect(r.x + r.w - 7, r.y + 4, 4, 4);
    }
    if (inst.mb) {
      c.fillStyle = '#ff8a5c';
      c.beginPath();
      c.moveTo(r.x + 5, r.y + r.h - 12);
      c.lineTo(r.x + 10, r.y + r.h - 7);
      c.lineTo(r.x + 5, r.y + r.h - 2);
      c.lineTo(r.x, r.y + r.h - 7);
      c.closePath();
      c.fill();
    }
    if (def.grade) gradeLetter(c, def.grade, r.x + r.w - 2, r.y + r.h - 8);
    if (armed) {
      c.fillStyle = 'rgba(255,90,95,0.3)';
      c.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  private drawCard(c: CanvasRenderingContext2D, r: AABB, inst: ItemInstance | null): void {
    panel(c, r.x, r.y, r.w, r.h, { fill: '#0b0e1a', alpha: 0.92, stroke: inst ? itemColor(inst.id) : COL.line, lineWidth: 1.5, r: 6 });
    if (this.pending !== null) {
      const it = this.save.stash[this.pending];
      wrap(c, `${itemName(it)}을(를) 어느 칸에 장착할까요? 위의 빛나는 칸을 선택하세요. 그 칸의 장비는 보관함으로 돌아옵니다.`, r.w - 20, SZ.s).forEach((l, n) => text(c, l, r.x + 10, r.y + 16 + n * 14, { color: COL.amber }));
      return;
    }
    if (!inst) {
      const hint = this.zone === 'equip' ? '빈 칸 · 보관함에서 장비를 골라 장착하세요' : '빈 칸';
      wrap(c, hint, r.w - 20, SZ.s).forEach((l, n) => text(c, l, r.x + 10, r.y + 16 + n * 14, { color: COL.dim }));
      return;
    }
    const def = ITEMS[inst.id];
    const accent = itemColor(inst.id);
    icon(this.ui.game.assets, c, def.icon, r.x + 28, r.y + 30, 40);
    const name = itemName(inst);
    const nx = r.x + 54;
    text(c, name, nx, r.y + 15, { bold: true, color: accent });
    // the grade pill sits right of the name when it fits, else it starts the second line
    let x2 = nx;
    if (def.grade) {
      const bw = gradeBadgeW(c, def.grade);
      const tx = nx + textWidth(c, name, SZ.s, true) + 6;
      if (tx + bw <= r.x + r.w - 6) gradeBadge(c, def.grade, tx + bw / 2, r.y + 15);
      else {
        gradeBadge(c, def.grade, nx + bw / 2, r.y + 31);
        x2 = nx + bw + 6;
      }
    }
    const kind = def.slot === 'weapon' ? '무기' : '스킬';
    text(c, `${def.unique ? `${UNIQUE_TAG} ` : ''}${kind} · 티어 ${inst.tier}`, x2, r.y + 31, { color: COL.dim });
    const textW = r.w - 20;
    const lines = itemLines(inst);
    const sig = def.unique ? lines.length - 1 : -1;
    const wrapped = lines.flatMap((l, i) => wrap(c, l, textW, SZ.s).map((s) => ({ s, color: i === 0 ? COL.text : i === sig ? accent : COL.amber })));
    if (inst.mb) wrapped.push({ s: '중간 보스 아이템', color: '#ff8a5c' });
    const y0 = r.y + 62;
    const maxLines = Math.max(1, Math.floor((r.y + r.h - 8 - y0) / 13));
    wrapped.slice(0, maxLines).forEach((l, n) => text(c, l.s, r.x + 10, y0 + n * 13, { color: l.color }));
  }
}
