import type { AABB } from '../../engine/math';
import { clamp } from '../../engine/math';
import type { LevelUI } from './levelUI';
import type { Entity } from '../entity';
import type { Interactable } from '../world';
import type { ItemInstance } from '../items/types';
import { ITEMS, itemName, itemLines } from '../items/items';
import { COLOR_HEX } from '../combat';
import { touchView } from './touch';
import { drawVButtons, vbLayout, type VSkillView } from './vbuttons';
import { MapView } from './mapview';
import { COL, SZ, atLeast, icon, panel, pie, pulse, text, textWidth, wrap } from './draw';

/** Minimum size (virtual px) of anything tappable. */
export const MIN_TAP = 40;

export interface HudLayout {
  hp: AABB;
  /** flask tap target */
  flask: AABB;
  flaskIcon: { x: number; y: number };
  pips: { x: number; y: number };
  gold: { x: number; y: number };
  cells: { x: number; y: number };
  minimap: AABB;
  /** pause tap target (visual button is `pauseBtn`) */
  pause: AABB;
  pauseBtn: AABB;
  skills: { cx: number; cy: number; r: number; hit: AABB }[];
  weapons: AABB[];
  boss: AABB;
  /** mid-boss HP bar: top-centre between the HP bar and the pause button, smaller than the boss bar */
  mini: AABB;
  /** mid-boss name card ("중간 보스" + name), below the counters row so it never covers them */
  miniCard: AABB;
}

/** All fixed HUD geometry for a W × H virtual view (pure; used by tests to check tap target sizes). */
export function hudLayout(W: number, H: number, maxFlasks = 1): HudLayout {
  const hp = { x: 8, y: 8, w: 140, h: 15 };
  const pipsW = Math.max(1, maxFlasks) * 9;
  const flask = atLeast({ x: 2, y: 28, w: 40 + pipsW, h: 36 }, MIN_TAP, MIN_TAP);
  const gx = flask.x + flask.w + 8;
  const minimap = { x: W - 8 - 112, y: 10, w: 112, h: 64 };
  const pauseBtn = { x: minimap.x - 8 - 26, y: 10, w: 26, h: 26 };
  const sr = 17;
  const skills = [0, 1].map((i) => {
    const cx = W - 30 - (1 - i) * 46;
    const cy = H - 30;
    return { cx, cy, r: sr, hit: { x: cx - 22, y: cy - 22, w: 44, h: 44 } };
  });
  const bw = Math.min(420, W - 230);
  const mw = clamp(W - 330, 150, 250);
  return {
    hp,
    flask,
    flaskIcon: { x: 22, y: 46 },
    pips: { x: 38, y: 38 },
    gold: { x: gx, y: 46 },
    cells: { x: gx + 56, y: 46 },
    minimap,
    pause: atLeast(pauseBtn, MIN_TAP, MIN_TAP),
    pauseBtn,
    skills,
    weapons: [0, 1].map((i) => ({ x: 8 + i * 28, y: H - 32, w: 24, h: 24 })),
    boss: { x: (W - bw) / 2, y: H - 20, w: bw, h: 10 },
    mini: { x: Math.round((W - mw) / 2), y: 20, w: mw, h: 7 },
    miniCard: { x: Math.round(W / 2 - 75), y: 56, w: 150, h: 32 },
  };
}

interface Toast {
  text: string;
  t: number;
  life: number;
  color: string;
  key?: string;
}

/** The item an interactable represents, if it is an item drop (duck-typed: pickups.ts owns the class). */
export function itemOf(e: unknown): ItemInstance | null {
  const o = e as { item?: ItemInstance; inst?: ItemInstance; instance?: ItemInstance };
  const it = o?.item ?? o?.inst ?? o?.instance;
  return it && typeof it.id === 'string' && it.id in ITEMS ? it : null;
}

const BOSS_NAME = '강철 여교도관';
const BOSS_SUB = '사슬의 종탑을 지키는 간수';
const BOSS_INTRO = 3.4;
/** mid-boss name card: how long it stays up (s) */
const MINI_CARD = 2.8;
export const MINI_LABEL = '중간 보스';

/** The always-on HUD: bars, counters, minimap, skill buttons, prompts, boss bar, toasts, touch feedback. */
export class Hud {
  readonly map: MapView;
  private toasts: Toast[] = [];
  private banner: { text: string; t: number } | null = null;
  private time = 0;
  private hurt = 0;
  private hpTrail: number;
  private hpTrailHold = 0;
  private lastHp: number;
  private popGold = 0;
  private popCells = 0;
  private lastGold: number;
  private lastCells: number;
  private ready: [number, number] = [0, 0];
  private prevCd: [number, number] = [0, 0];
  private agg = { cells: 0, gold: 0, t: 0 };
  private bossActor: unknown = null;
  private bossT = -1;
  private bossHp = 1;
  private bossTrail = 1;
  private bossFade = 1;
  private miniActor: unknown = null;
  private miniT = -1;
  private miniHp = 1;
  private miniTrail = 1;
  private miniFade = 1;

  constructor(readonly ui: LevelUI) {
    const w = ui.world;
    this.map = new MapView(w);
    this.hpTrail = this.lastHp = w.player?.hp ?? 100;
    this.lastGold = w.run.gold;
    this.lastCells = w.run.cells;
    w.on((e) => {
      if (e.type === 'playerHurt') this.hurt = 0.35;
      else if (e.type === 'pickup') {
        if (e.what === 'cells') this.agg.cells += e.amount;
        else if (e.what === 'gold') this.agg.gold += e.amount;
        else if (e.what === 'flask') this.toast('플라스크 충전', COL.green);
        else return;
        this.agg.t = 0.7;
      }
    });
  }

  showBanner(textStr: string): void {
    this.banner = { text: textStr, t: 3.2 };
  }

  toast(s: string, color: string = COL.text, key?: string): void {
    if (key) {
      const ex = this.toasts.find((t) => t.key === key);
      if (ex) {
        ex.text = s;
        ex.t = ex.life;
        return;
      }
    }
    this.toasts.push({ text: s, t: 2.4, life: 2.4, color, key });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  get bossIntroActive(): boolean {
    return this.bossT >= 0 && this.bossT < BOSS_INTRO;
  }

  /** The compact "중간 보스" name card is on screen. */
  get miniCardActive(): boolean {
    return !!this.ui.miniboss && this.miniT >= 0 && this.miniT < MINI_CARD;
  }

  /** The mid-boss HP bar is on screen (hidden once the boss is dead and the bar has faded out). */
  get miniBarVisible(): boolean {
    return !!this.ui.miniboss && this.miniFade > 0.01;
  }

  update(dt: number): void {
    this.time += dt;
    const w = this.ui.world;
    const p = w.player;
    const run = w.run;
    this.map.update(dt);
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
    if (this.hurt > 0) this.hurt -= dt;
    // aggregated pickup toasts ("+3 셀")
    if (this.agg.t > 0 && (this.agg.t -= dt) <= 0) {
      if (this.agg.cells) this.toast(`+${this.agg.cells} 셀`, COL.cell, 'cells');
      if (this.agg.gold) this.toast(`+${this.agg.gold} 골드`, COL.gold, 'gold');
      this.agg.cells = this.agg.gold = 0;
    }
    if (run.gold !== this.lastGold) { this.popGold = 0.3; this.lastGold = run.gold; }
    if (run.cells !== this.lastCells) { this.popCells = 0.3; this.lastCells = run.cells; }
    this.popGold = Math.max(0, this.popGold - dt);
    this.popCells = Math.max(0, this.popCells - dt);
    if (p) {
      if (p.hp < this.lastHp - 0.01) this.hpTrailHold = 0.5;
      this.lastHp = p.hp;
      if (this.hpTrailHold > 0) this.hpTrailHold -= dt;
      else this.hpTrail = Math.max(p.hp, this.hpTrail - p.maxHp * 0.5 * dt);
      if (p.hp > this.hpTrail) this.hpTrail = p.hp;
      for (let i = 0; i < 2; i++) {
        const cd = p.skillCooldown?.[i] ?? 0;
        if (this.prevCd[i] > 0 && cd <= 0) this.ready[i] = 0.5;
        this.prevCd[i] = cd;
        this.ready[i] = Math.max(0, this.ready[i] - dt);
      }
    }
    // boss
    const b = this.ui.boss;
    if (b && b.actor !== this.bossActor) {
      this.bossActor = b.actor;
      this.bossT = 0;
      this.bossHp = this.bossTrail = 1;
      this.bossFade = 1;
    }
    if (b) {
      if (this.bossT >= 0) this.bossT += dt;
      const f = clamp(b.actor.hp / Math.max(1, b.actor.maxHp), 0, 1);
      this.bossHp = f;
      this.bossTrail = f > this.bossTrail ? f : Math.max(f, this.bossTrail - 0.25 * dt);
      if (b.actor.dead || b.actor.hp <= 0) this.bossFade = Math.max(0, this.bossFade - dt * 0.8);
    }
    // mid-boss
    const m = this.ui.miniboss;
    if (m && m.actor !== this.miniActor) {
      this.miniActor = m.actor;
      this.miniT = 0;
      this.miniHp = this.miniTrail = 1;
      this.miniFade = 1;
    }
    if (m) {
      this.miniT += dt;
      const f = clamp(m.actor.hp / Math.max(1, m.actor.maxHp), 0, 1);
      this.miniHp = f;
      this.miniTrail = f > this.miniTrail ? f : Math.max(f, this.miniTrail - 0.25 * dt);
      if (m.actor.dead || m.actor.hp <= 0) {
        this.miniFade = Math.max(0, this.miniFade - dt * 0.9);
        if (this.miniFade <= 0) {
          this.ui.miniboss = null;
          this.miniActor = null;
          this.miniT = -1;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------

  draw(c: CanvasRenderingContext2D, W: number, H: number, interactive: boolean): void {
    const ui = this.ui;
    const w = ui.world;
    const p = w.player;
    if (!p) return;
    const L = hudLayout(W, H, w.run.maxFlasks);
    this.drawVignette(c, W, H, p.hp / Math.max(1, p.maxHp));
    this.drawTouch(c);
    this.drawBowCharge(c, W);
    this.drawHp(c, L);
    this.drawFlaskAndCounters(c, L, interactive);
    this.drawMinimapAndPause(c, L, interactive);
    this.drawWeapons(c, L);
    this.drawSkills(c, L, interactive);
    this.drawVButtons(c, W, H, interactive);
    if (interactive && !p.dying) this.drawPrompt(c, W, H);
    this.drawBoss(c, L, W, H);
    this.drawMiniBoss(c, L);
    this.drawToasts(c, W, H);
  }

  private drawVignette(c: CanvasRenderingContext2D, W: number, H: number, frac: number): void {
    const low = frac < 0.3 ? (0.3 - frac) / 0.3 : 0;
    const a = Math.max(low * (0.28 + 0.16 * pulse(this.time, 0.9)), this.hurt > 0 ? this.hurt * 0.9 : 0);
    if (a <= 0.01) return;
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.52);
    g.addColorStop(0, 'rgba(160,10,30,0)');
    g.addColorStop(1, `rgba(160,10,30,${Math.min(0.8, a)})`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  /** Faint feedback for the touch layer: floating stick, tap ripples, swipe chevrons, hold ring. */
  private drawTouch(c: CanvasRenderingContext2D): void {
    const v = touchView;
    if (v.joy) {
      const j = v.joy;
      c.save();
      c.globalAlpha = 0.07;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(j.ox, j.oy, j.r, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.28;
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
      c.stroke();
      c.globalAlpha = 0.34;
      c.fillStyle = '#d8f6ff';
      c.beginPath();
      c.arc(j.kx, j.ky, 9, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    for (const h of v.holds) {
      c.save();
      c.globalAlpha = 0.25 + 0.15 * pulse(this.time, 3);
      c.strokeStyle = '#ffb347';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(h.x, h.y, 16 + 2 * pulse(this.time, 3), 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    for (const m of v.marks) {
      const k = (v.now - m.t0) / 0.4;
      if (k < 0 || k >= 1) continue;
      c.save();
      c.globalAlpha = 0.4 * (1 - k);
      c.strokeStyle = '#ffffff';
      c.fillStyle = '#ffffff';
      c.lineWidth = 2;
      if (m.kind === 'tap') {
        c.beginPath();
        c.arc(m.x, m.y, 5 + 14 * k, 0, Math.PI * 2);
        c.stroke();
      } else if (m.dir) {
        const dx = m.dir === 'left' ? -1 : m.dir === 'right' ? 1 : 0;
        const dy = m.dir === 'up' ? -1 : m.dir === 'down' ? 1 : 0;
        const x = m.x + dx * 10 * k;
        const y = m.y + dy * 10 * k;
        c.beginPath();
        c.moveTo(x - dx * 8 + dy * 8, y - dy * 8 + dx * 8);
        c.lineTo(x + dx * 4, y + dy * 4);
        c.lineTo(x - dx * 8 - dy * 8, y - dy * 8 - dx * 8);
        c.stroke();
      }
      c.restore();
    }
  }

  /** UI virtual px per world px (the world buffer height is a graphics setting; the UI space is always 360 tall). */
  private uiPerWorld(): number {
    const d = this.ui.game.display;
    return d?.worldH ? d.H / d.worldH : 1;
  }

  private drawBowCharge(c: CanvasRenderingContext2D, W: number): void {
    const p = this.ui.world.player as unknown as { bowCharge?: number; x: number; y: number; h: number };
    const q = clamp(p.bowCharge ?? 0, 0, 1);
    if (q <= 0.02) return;
    const cam = this.ui.world.camera;
    const k = this.uiPerWorld();
    const x = Math.round((p.x - cam.viewX) * k);
    const y = Math.round((p.y - p.h - cam.viewY) * k - 10);
    if (x < -20 || x > W + 20) return;
    c.fillStyle = '#07060b';
    c.fillRect(x - 15, y - 1, 30, 5);
    c.fillStyle = q >= 1 ? '#ffe28a' : '#a65be8';
    c.fillRect(x - 14, y, Math.round(28 * q), 3);
  }

  private drawHp(c: CanvasRenderingContext2D, L: HudLayout): void {
    const world = this.ui.world;
    const p = world.player;
    // before the first world update the Player has not initialised from the run yet (stub defaults)
    const fresh = world.time <= 0;
    const hpNow = fresh ? world.run.hp : p.hp;
    const maxNow = fresh ? world.run.maxHp : p.maxHp;
    const max = Math.max(1, maxNow);
    const { x, y, w, h } = L.hp;
    const shake = this.hurt > 0 ? Math.round(Math.sin(this.time * 80) * 1.5) : 0;
    const ox = x + shake;
    c.fillStyle = '#07060b';
    c.fillRect(ox - 2, y - 2, w + 4, h + 4);
    c.fillStyle = '#2a1424';
    c.fillRect(ox, y, w, h);
    const hpW = Math.round(w * clamp(hpNow / max, 0, 1));
    const trailW = Math.round(w * clamp(this.hpTrail / max, 0, 1));
    if (trailW > hpW) {
      c.fillStyle = '#f3e7d3';
      c.fillRect(ox + hpW, y, trailW - hpW, h);
    }
    // rally: the part of the lost HP that can be won back by attacking
    const rally = Math.max(0, Math.min(p.recoverable ?? 0, maxNow - hpNow));
    const rallyW = Math.round(w * clamp(rally / max, 0, 1));
    if (rallyW > 0) {
      c.fillStyle = '#ff9fb0';
      c.fillRect(ox + hpW, y, rallyW, h);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(ox + hpW, y, rallyW, 3);
    }
    if (hpW > 0) {
      c.fillStyle = '#d42f48';
      c.fillRect(ox, y, hpW, h);
      c.fillStyle = '#ff6d82';
      c.fillRect(ox, y, hpW, 3);
      c.fillStyle = '#8f1f35';
      c.fillRect(ox, y + h - 3, hpW, 3);
    }
    if (this.hurt > 0.1) {
      c.fillStyle = `rgba(255,255,255,${Math.min(0.7, (this.hurt - 0.1) * 3)})`;
      c.fillRect(ox, y, w, h);
    }
    text(c, `${Math.ceil(hpNow)}/${maxNow}`, ox + w / 2, y + h / 2 + 0.5, { align: 'center', bold: true, size: SZ.s });
  }

  private drawFlaskAndCounters(c: CanvasRenderingContext2D, L: HudLayout, interactive: boolean): void {
    const w = this.ui.world;
    const run = w.run;
    const game = this.ui.game;
    const empty = run.flasks <= 0;
    icon(game.assets, c, 'flask', L.flaskIcon.x, L.flaskIcon.y, 26, empty ? 0.4 : 1);
    for (let i = 0; i < run.maxFlasks; i++) {
      const px = L.pips.x + i * 9;
      c.fillStyle = '#07060b';
      c.fillRect(px - 1, L.pips.y - 1, 8, 18);
      c.fillStyle = i < run.flasks ? '#5ee8c0' : '#2a3347';
      c.fillRect(px, L.pips.y, 6, 16);
      if (i < run.flasks) {
        c.fillStyle = 'rgba(255,255,255,0.45)';
        c.fillRect(px + 1, L.pips.y + 1, 2, 14);
      }
    }
    const pop = (t: number) => 1 + t * 1.2;
    const drawCounter = (name: string, value: number, pos: { x: number; y: number }, color: string, popT: number) => {
      icon(game.assets, c, name, pos.x + 8, pos.y, 18);
      c.save();
      c.translate(pos.x + 22, pos.y);
      c.scale(pop(popT), pop(popT));
      text(c, String(value), 0, 0, { bold: true, color });
      c.restore();
    };
    drawCounter('gold', run.gold, L.gold, COL.gold, this.popGold);
    drawCounter('cells', run.cells, L.cells, COL.cell, this.popCells);
    if (interactive) {
      game.taps.add({ id: 'hud-flask', rect: L.flask, mode: 'down', onTap: () => game.input.tap('heal') });
    }
  }

  private drawMinimapAndPause(c: CanvasRenderingContext2D, L: HudLayout, interactive: boolean): void {
    const game = this.ui.game;
    this.map.drawMini(c, L.minimap, this.time);
    const b = L.pauseBtn;
    panel(c, b.x, b.y, b.w, b.h, { fill: '#07060b', alpha: 0.55, stroke: COL.line, r: 4 });
    c.fillStyle = '#d8e4ff';
    c.globalAlpha = 0.85;
    c.fillRect(b.x + 8, b.y + 7, 3, 12);
    c.fillRect(b.x + 15, b.y + 7, 3, 12);
    c.globalAlpha = 1;
    if (interactive) {
      game.taps.add({ id: 'hud-map', rect: atLeast(L.minimap, MIN_TAP, MIN_TAP), mode: 'up', onTap: () => this.ui.openMap() });
      game.taps.add({ id: 'hud-pause', rect: L.pause, mode: 'up', onTap: () => this.ui.openPause() });
    }
  }

  private drawWeapons(c: CanvasRenderingContext2D, L: HudLayout): void {
    const run = this.ui.world.run;
    const game = this.ui.game;
    run.weapons.forEach((wp, i) => {
      if (!wp) return;
      const r = L.weapons[i];
      const def = ITEMS[wp.id];
      panel(c, r.x, r.y, r.w, r.h, { fill: '#07060b', alpha: i === 0 ? 0.55 : 0.4, stroke: COLOR_HEX[def.color], r: 4 });
      icon(game.assets, c, def.icon, r.x + r.w / 2, r.y + r.h / 2, 20, i === 0 ? 0.95 : 0.7);
    });
  }

  private drawSkills(c: CanvasRenderingContext2D, L: HudLayout, interactive: boolean): void {
    const p = this.ui.world.player;
    const run = this.ui.world.run;
    const game = this.ui.game;
    if (game.save.settings.controlMode === 'buttons') return; // the virtual buttons draw (and tap) the skills
    run.skills.forEach((sk, i) => {
      if (!sk) return;
      const s = L.skills[i];
      const def = ITEMS[sk.id];
      const cd = p.skillCooldown?.[i] ?? 0;
      const cdMax = Math.max(0.001, p.skillCooldownMax?.[i] ?? 1);
      const onCd = cd > 0;
      c.fillStyle = '#07060b';
      c.globalAlpha = 0.7;
      c.beginPath();
      c.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      icon(game.assets, c, def.icon, s.cx, s.cy, 24, onCd ? 0.5 : 1);
      if (onCd) {
        pie(c, s.cx, s.cy, s.r - 1, cd / cdMax, 'rgba(7,6,11,0.72)');
        text(c, String(Math.ceil(cd)), s.cx, s.cy + 1, { align: 'center', bold: true });
      }
      c.lineWidth = 2;
      c.strokeStyle = onCd ? COL.line : COLOR_HEX[def.color];
      c.beginPath();
      c.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
      c.stroke();
      if (this.ready[i] > 0) {
        const k = 1 - this.ready[i] / 0.5;
        c.globalAlpha = 1 - k;
        c.strokeStyle = '#ffffff';
        c.beginPath();
        c.arc(s.cx, s.cy, s.r + 2 + k * 8, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
      if (interactive) game.taps.add({ id: 'hud-skill' + (i + 1), rect: s.hit, mode: 'down', onTap: () => game.input.tap(i === 0 ? 'skill1' : 'skill2') });
    });
  }

  /** "가상 버튼" mode: d-pad + action buttons. Publishes the layout for the touch layer (null while a modal is open). */
  private drawVButtons(c: CanvasRenderingContext2D, W: number, H: number, interactive: boolean): void {
    const game = this.ui.game;
    const s = game.save.settings;
    if (s.controlMode !== 'buttons' || !game.vb || !interactive) return;
    const world = this.ui.world;
    const p = world.player;
    const skills = world.run.skills;
    const L = vbLayout(W, H, s.btnSize, [!!skills[0], !!skills[1]]);
    game.vb.layout = L;
    const view = (i: number): VSkillView | null => {
      const sk = skills[i];
      if (!sk) return null;
      const def = ITEMS[sk.id];
      return { icon: def.icon, color: COLOR_HEX[def.color], cd: p.skillCooldown?.[i] ?? 0, cdMax: Math.max(0.001, p.skillCooldownMax?.[i] ?? 1), flash: this.ready[i] / 0.5 };
    };
    drawVButtons(c, L, { opacity: s.btnOpacity, isDown: (id) => game.vb.ctl.isDown(id), skills: [view(0), view(1)], assets: game.assets });
  }

  /** Bubble above the nearest interactable (+ item card for item drops). */
  private drawPrompt(c: CanvasRenderingContext2D, W: number, H: number): void {
    const world = this.ui.world;
    const game = this.ui.game;
    const e = world.player.nearInteract as (Interactable & Entity) | null;
    if (!e || e.dead) return;
    const cam = world.camera;
    const label = e.promptText();
    if (!label) return;
    const sub = e.promptSub?.() ?? null;
    const bob = Math.round(Math.sin(this.time * 4) * 1.5);
    const bw = Math.max(72, textWidth(c, label, SZ.s, true) + 28, sub ? textWidth(c, sub, SZ.s) + 24 : 0);
    const bh = sub ? 38 : 26;
    const k = this.uiPerWorld();
    const sx = (e.x - cam.viewX) * k;
    const anchorY = (e.y - Math.max(e.h, 28) - cam.viewY) * k - 12 + bob;
    const bx = clamp(Math.round(sx - bw / 2), 4, W - 4 - bw);
    const by = clamp(Math.round(anchorY - bh), 82, H - 60);
    const rect = { x: bx, y: by, w: bw, h: bh };
    // card first (behind the bubble)
    const item = itemOf(e);
    if (item) this.drawItemCard(c, W, rect);
    panel(c, rect.x, rect.y, rect.w, rect.h, { fill: '#0b0e1a', alpha: 0.92, stroke: COL.cyan, lineWidth: 1.5, r: 6 });
    // tail
    c.fillStyle = '#0b0e1a';
    c.beginPath();
    const tx = clamp(Math.round(sx), rect.x + 10, rect.x + rect.w - 10);
    c.moveTo(tx - 5, rect.y + rect.h - 0.5);
    c.lineTo(tx + 5, rect.y + rect.h - 0.5);
    c.lineTo(tx, rect.y + rect.h + 5);
    c.closePath();
    c.fill();
    text(c, label, rect.x + rect.w / 2, rect.y + (sub ? 13 : rect.h / 2 + 0.5), { align: 'center', bold: true, color: COL.cyan });
    if (sub) text(c, sub, rect.x + rect.w / 2, rect.y + 28, { align: 'center', color: COL.gold });
    game.taps.add({ id: 'hud-interact', rect: atLeast(rect, 56, 40), mode: 'up', onTap: () => game.input.tap('interact') });
  }

  private drawItemCard(c: CanvasRenderingContext2D, W: number, bubble: AABB): void {
    const e = this.ui.world.player.nearInteract;
    const item = itemOf(e);
    if (!item) return;
    const def = ITEMS[item.id];
    const w = 204;
    const textW = w - 60;
    const lines = itemLines(item).flatMap((l, i) => wrap(c, l, textW, SZ.s).map((s) => ({ s, color: i === 0 ? COL.text : COL.amber })));
    const h = Math.max(46, 24 + lines.length * 13 + 8);
    const x = clamp(Math.round(bubble.x + bubble.w / 2 - w / 2), 4, W - 4 - w);
    const y = Math.max(4, bubble.y - h - 8);
    const accent = COLOR_HEX[def.color];
    panel(c, x, y, w, h, { fill: '#0b0e1a', alpha: 0.94, stroke: accent, lineWidth: 1.5, r: 6 });
    icon(this.ui.game.assets, c, def.icon, x + 28, y + h / 2, 36);
    text(c, itemName(item), x + 52, y + 12, { bold: true, color: accent });
    lines.forEach((l, i) => text(c, l.s, x + 52, y + 27 + i * 13, { color: l.color }));
  }

  private drawBoss(c: CanvasRenderingContext2D, L: HudLayout, W: number, H: number): void {
    const b = this.ui.boss;
    if (!b) return;
    const name = b.name || BOSS_NAME;
    if (this.bossIntroActive) {
      const t = this.bossT;
      const a = Math.min(1, t / 0.5) * Math.min(1, (BOSS_INTRO - t) / 0.6);
      const bar = Math.round(H * 0.15 * Math.min(1, t / 0.4) * Math.min(1, (BOSS_INTRO - t) / 0.4 + 0.0001));
      c.fillStyle = '#05040a';
      c.fillRect(0, 0, W, bar);
      c.fillRect(0, H - bar, W, bar);
      c.globalAlpha = a * 0.55;
      c.fillStyle = '#12040a';
      c.fillRect(0, bar, W, H - bar * 2);
      c.globalAlpha = a;
      const portrait = this.ui.game.assets.image('ui/boss_portrait.png');
      let tx = W / 2;
      if (portrait) {
        const ph = H * 0.62;
        const pw = (portrait.width / portrait.height) * ph;
        const slide = (1 - Math.min(1, t / 0.8)) * 30;
        c.drawImage(portrait, W / 2 - 40 - pw - slide, H / 2 - ph / 2 + 4, pw, ph);
        tx = W / 2 + 70;
      }
      text(c, name, tx, H / 2 - 12, { size: SZ.l, bold: true, align: 'center', color: '#ffd9c8', spacing: 3 });
      const lw = Math.min(1, t / 1.0) * 150;
      c.fillStyle = '#d42f48';
      c.fillRect(Math.round(tx - lw / 2), H / 2 + 6, Math.round(lw), 2);
      text(c, BOSS_SUB, tx, H / 2 + 22, { align: 'center', color: COL.dim });
      c.globalAlpha = 1;
      return;
    }
    if (this.bossFade <= 0.01) return;
    c.globalAlpha = this.bossFade * Math.min(1, (this.bossT - BOSS_INTRO) / 0.4 + 0.0001);
    const r = L.boss;
    text(c, name, r.x + r.w / 2, r.y - 8, { align: 'center', bold: true, color: '#ffd9c8' });
    c.fillStyle = '#07060b';
    c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    c.fillStyle = '#2a1424';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#f3e7d3';
    c.fillRect(r.x, r.y, Math.round(r.w * this.bossTrail), r.h);
    c.fillStyle = '#c42a42';
    c.fillRect(r.x, r.y, Math.round(r.w * this.bossHp), r.h);
    c.fillStyle = '#ff7388';
    c.fillRect(r.x, r.y, Math.round(r.w * this.bossHp), 3);
    c.globalAlpha = 1;
  }

  /** Mid-boss: compact name card ("중간 보스" + name) for the first seconds, then a slim HP bar at the top centre. */
  private drawMiniBoss(c: CanvasRenderingContext2D, L: HudLayout): void {
    const m = this.ui.miniboss;
    if (!m || this.miniFade <= 0.01 || this.bossIntroActive) return;
    const r = L.mini;
    const fade = this.miniFade * clamp(this.miniT / 0.3, 0, 1);
    c.globalAlpha = fade;
    text(c, m.name, r.x + r.w / 2, r.y - 8, { align: 'center', bold: true, color: '#ffe3c2' });
    c.fillStyle = '#07060b';
    c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    c.fillStyle = '#2a1424';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#f3e7d3';
    c.fillRect(r.x, r.y, Math.round(r.w * this.miniTrail), r.h);
    c.fillStyle = '#d6762a';
    c.fillRect(r.x, r.y, Math.round(r.w * this.miniHp), r.h);
    c.fillStyle = '#ffb06a';
    c.fillRect(r.x, r.y, Math.round(r.w * this.miniHp), 2);
    if (this.miniCardActive) {
      const t = this.miniT;
      const a = Math.min(1, t / 0.25) * Math.min(1, (MINI_CARD - t) / 0.5);
      const k = L.miniCard;
      c.globalAlpha = a * this.miniFade;
      panel(c, k.x, k.y, k.w, k.h, { fill: '#0b0a12', alpha: 0.82, stroke: '#d6762a', r: 5 });
      text(c, MINI_LABEL, k.x + k.w / 2, k.y + 9, { align: 'center', color: '#ff8a5c', spacing: 2 });
      text(c, m.name, k.x + k.w / 2, k.y + 22, { size: SZ.m, bold: true, align: 'center', color: '#ffe3c2' });
    }
    c.globalAlpha = 1;
  }

  private drawToasts(c: CanvasRenderingContext2D, W: number, H: number): void {
    if (this.banner) {
      const t = this.banner.t;
      const a = Math.min(1, (3.2 - t) / 0.5) * Math.min(1, t / 0.7);
      c.globalAlpha = a;
      const y = Math.round(H * 0.27);
      text(c, this.banner.text, W / 2, y, { size: SZ.l, bold: true, align: 'center', spacing: 4, color: '#eaf6ff' });
      c.fillStyle = 'rgba(159,232,255,0.7)';
      const lw = Math.round(Math.min(1, (3.2 - t) / 0.6) * 120);
      c.fillRect(Math.round(W / 2 - lw / 2), y + 17, lw, 1);
      c.globalAlpha = 1;
    }
    let y = 46 + (this.miniCardActive ? 50 : 0);
    for (const t of this.toasts) {
      const a = clamp(t.t / 0.4, 0, 1) * clamp((t.life - t.t) / 0.15, 0, 1);
      const rise = (1 - clamp(t.t / 0.4, 0, 1)) * -6;
      c.globalAlpha = a;
      const w = textWidth(c, t.text, SZ.s, true) + 22;
      const cx = W / 2 - 20;
      panel(c, Math.round(cx - w / 2), Math.round(y - 11 + rise), w, 22, { fill: '#07060b', alpha: 0.7, stroke: null, r: 11 });
      text(c, t.text, cx, y + rise + 0.5, { align: 'center', bold: true, color: t.color });
      c.globalAlpha = 1;
      y += 26;
    }
  }
}
