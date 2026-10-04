import type { Game, Scene } from '../game';
import type { RunState } from '../run';
import type { LoopInfo } from '../meta/body';
import { COL, SZ, pulse, text, wrap } from '../ui/draw';
import { Embers, gradientBg, statRow, vignette } from '../ui/backdrop';
import type { NavKey } from '../../engine/gamepad';

export const LOOP_EPILOGUE = [
  '마지막 한 땀이 끝나자, 백 조각이 하나의 몸으로 이어졌다.',
  '그러나 종탑의 종이 다시 울렸고, 간수의 저주가 그 몸을 도로 찢어 놓았다.',
  '신더는 눈을 떴다. 장부에는 아직 그녀의 값이 남아 있었다.',
];

const TYPE_SPEED = 28; // characters per second
const TYPE_START = 1.0;

/** the bone and thread-red of the dead seamstress's work */
const BONE = '#e8d7c3';
const RED = '#c8324a';

/** Loop clear: "온전한 몸", typewriter epilogue, the loop's stats and what comes next; tap → title. */
export class LoopClearScene implements Scene {
  private t = 0;
  private leaving = false;
  private skipped = false;
  /** a pad A / B press this step (merged with the Input presses so one press is one tap) */
  private navTap = false;
  private embers = new Embers(60, ['#e8d7c3', '#c8324a', '#ff8a9a'], 13);
  private total = LOOP_EPILOGUE.join('').length;

  /** `info` = the loop that was cleared (its number and how many runs it took) */
  constructor(private game: Game, private run: RunState, private info: LoopInfo) {}

  enter(): void {
    this.game.audio.music('victory');
    this.game.audio.play('bell');
  }

  /** characters of the epilogue revealed so far */
  private get revealed(): number {
    return this.skipped ? this.total : Math.max(0, Math.floor((this.t - TYPE_START) * TYPE_SPEED));
  }

  private tap(): void {
    if (this.leaving || this.t < 0.8) return;
    if (this.revealed < this.total) {
      this.skipped = true; // first tap finishes the text
      return;
    }
    this.leaving = true;
    this.game.audio.play('ui_tap');
    this.game.showTitle();
  }

  /** gamepad: A / B = continue (the first press finishes the epilogue) */
  nav(k: NavKey): void {
    if (k === 'confirm' || k === 'cancel') this.navTap = true;
  }

  update(dt: number): void {
    this.t += dt;
    const d = this.game.display;
    this.embers.update(dt, d.worldW, d.worldH);
    const i = this.game.input;
    if (this.navTap || i.pressed('confirm') || i.pressed('attack1') || i.pressed('jump')) this.tap();
    this.navTap = false;
  }

  render(): void {
    const g = this.game;
    const d = g.display;
    const { W, H } = d;
    const { worldW, worldH } = d;
    const t = this.t;
    const w = d.wctx;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalAlpha = 1;
    w.globalCompositeOperation = 'source-over';
    gradientBg(w, worldW, worldH, [[0, '#0b0509'], [0.5, '#2a0e16'], [0.82, '#5a1a26'], [1, '#8a3a40']]);
    // the tolling bell: a red glow on the horizon that pulses slowly
    const glow = w.createRadialGradient(worldW / 2, worldH + 20, 10, worldW / 2, worldH + 20, worldH * 0.9);
    glow.addColorStop(0, `rgba(232,160,150,${0.4 + 0.1 * Math.sin(t * 1.5)})`);
    glow.addColorStop(1, 'rgba(232,160,150,0)');
    w.fillStyle = glow;
    w.fillRect(0, 0, worldW, worldH);
    vignette(w, worldW, worldH, 0.55, '8,3,6');
    this.embers.draw(w);
    d.present();

    const c = d.ui;
    const run = this.run;
    const info = this.info;
    const cx = W / 2;
    const k = Math.min(1, t / 0.8);
    c.globalAlpha = k;
    text(c, '온전한 몸', cx, Math.round(H * 0.13 - (1 - k) * 8), { size: 40, bold: true, align: 'center', spacing: 10, color: BONE, shadow: '#2a0508' });
    c.fillStyle = 'rgba(200,50,74,0.7)';
    c.fillRect(Math.round(cx - 110 * k), Math.round(H * 0.13 + 28), Math.round(220 * k), 1);
    text(c, `${info.loop}회차 클리어`, cx, Math.round(H * 0.13 + 46), { size: SZ.m, bold: true, align: 'center', color: RED, spacing: 3 });
    c.globalAlpha = 1;

    // typewriter epilogue
    let left = this.revealed;
    const maxW = Math.min(560, W - 60);
    let y = Math.round(H * 0.34);
    for (const line of LOOP_EPILOGUE) {
      for (const part of wrap(c, line, maxW, SZ.m)) {
        const shown = part.slice(0, Math.max(0, left));
        left -= part.length;
        text(c, shown, cx, y, { size: SZ.m, align: 'center', color: '#f6e6d6' });
        y += 20;
      }
      y += 6;
    }

    // stats
    const done = this.revealed >= this.total;
    const a = Math.max(0, Math.min(1, (t - TYPE_START - this.total / TYPE_SPEED) / 0.6));
    const sa = this.skipped ? 1 : a;
    const colW = Math.min(120, (W - 40) / 3);
    const sy = Math.round(H * 0.7);
    statRow(c, [
      { label: '회차', value: String(info.loop), color: BONE },
      { label: '도전 횟수', value: String(info.runs) },
      { label: '처치한 적', value: String(run.kills) },
    ], cx, sy, colW, sa);
    c.globalAlpha = sa;
    text(c, `${g.save.loop}회차 시작 — 적이 강해집니다`, cx, sy + 52, { size: SZ.m, bold: true, align: 'center', color: COL.amber });
    c.globalAlpha = 1;
    if (t > 0.8) {
      text(c, done ? '화면을 터치하여 타이틀로' : '터치하면 건너뜁니다', cx, H - 22, { size: done ? SZ.m : SZ.s, bold: done, align: 'center', color: done ? COL.text : COL.dim, alpha: done ? 0.45 + 0.55 * pulse(t, 0.8) : 0.7 });
      g.taps.add({ id: 'title', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => this.tap() });
    }
  }
}
