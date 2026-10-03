import type { Game, Scene } from '../game';
import type { RunState } from '../run';
import { COL, SZ, formatTime, pulse, text, wrap } from '../ui/draw';
import { Embers, gradientBg, statRow, vignette } from '../ui/backdrop';

export const EPILOGUE = [
  '종탑의 마지막 종이 울리고, 사슬이 재처럼 부서져 내렸다.',
  '신더는 무너지는 감옥을 뒤로한 채, 새벽의 문을 밀어 열었다.',
  '처음 맞는 바람은 차가웠고, 자유의 냄새가 났다.',
];

const TYPE_SPEED = 28; // characters per second
const TYPE_START = 1.0;

/** Victory: "자유", typewriter epilogue, run stats and best time; tap → title. */
export class VictoryScene implements Scene {
  private t = 0;
  private leaving = false;
  private skipped = false;
  private embers = new Embers(60, ['#ffd27a', '#ffb347', '#fff2c8'], 11);
  private total = EPILOGUE.join('').length;

  constructor(private game: Game, private run: RunState) {}

  enter(): void {
    this.game.audio.music('victory');
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

  update(dt: number): void {
    this.t += dt;
    const d = this.game.display;
    this.embers.update(dt, d.W, d.H);
    const i = this.game.input;
    if (i.pressed('confirm') || i.pressed('attack1') || i.pressed('jump')) this.tap();
  }

  render(): void {
    const g = this.game;
    const d = g.display;
    const { W, H } = d;
    const t = this.t;
    const w = d.wctx;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalAlpha = 1;
    w.globalCompositeOperation = 'source-over';
    gradientBg(w, W, H, [[0, '#0a0c24'], [0.5, '#2a1a3c'], [0.82, '#8a4a3a'], [1, '#e0a050']]);
    // dawn glow on the horizon
    const glow = w.createRadialGradient(W / 2, H + 20, 10, W / 2, H + 20, H * 0.9);
    glow.addColorStop(0, `rgba(255,214,140,${0.55 + 0.1 * Math.sin(t)})`);
    glow.addColorStop(1, 'rgba(255,214,140,0)');
    w.fillStyle = glow;
    w.fillRect(0, 0, W, H);
    vignette(w, W, H, 0.5, '6,4,14');
    this.embers.draw(w);
    d.present();

    const c = d.ui;
    const run = this.run;
    const cx = W / 2;
    const k = Math.min(1, t / 0.8);
    c.globalAlpha = k;
    text(c, '자유', cx, Math.round(H * 0.15 - (1 - k) * 8), { size: 44, bold: true, align: 'center', spacing: 18, color: COL.gold, shadow: '#3a1a08' });
    c.fillStyle = 'rgba(255,210,63,0.6)';
    c.fillRect(Math.round(cx - 110 * k), Math.round(H * 0.15 + 30), Math.round(220 * k), 1);
    c.globalAlpha = 1;

    // typewriter epilogue
    let left = this.revealed;
    const maxW = Math.min(560, W - 60);
    let y = Math.round(H * 0.33);
    for (const line of EPILOGUE) {
      const wrapped = wrap(c, line, maxW, SZ.m);
      // wrap on the full line so the layout does not jump while typing
      for (const part of wrapped) {
        const shown = part.slice(0, Math.max(0, left));
        left -= part.length;
        text(c, shown, cx, y, { size: SZ.m, align: 'center', color: '#fff0d8' });
        y += 20;
      }
      y += 6;
    }

    // stats
    const done = this.revealed >= this.total;
    const a = Math.max(0, Math.min(1, (t - TYPE_START - this.total / TYPE_SPEED) / 0.6));
    const sa = this.skipped ? 1 : a;
    const save = g.save;
    const record = save.bestTime !== null && Math.abs(save.bestTime - run.time) < 1e-6;
    statRow(c, [
      { label: '클리어 시간', value: formatTime(run.time), color: record ? COL.gold : COL.text },
      { label: '처치한 적', value: String(run.kills) },
      { label: '최고 기록', value: save.bestTime === null ? '--:--' : formatTime(save.bestTime), color: COL.cyan },
      { label: '승리 횟수', value: String(save.wins) },
    ], cx, Math.round(H * 0.72), Math.min(120, (W - 40) / 4), sa);
    if (record && sa > 0.5) text(c, '신기록!', cx - Math.min(120, (W - 40) / 4) * 1.5, Math.round(H * 0.72) - 16, { color: COL.gold, bold: true, align: 'center', alpha: 0.5 + 0.5 * pulse(t, 1.5) });
    if (t > 0.8) {
      text(c, done ? '화면을 터치하여 타이틀로' : '터치하면 건너뜁니다', cx, H - 22, { size: done ? SZ.m : SZ.s, bold: done, align: 'center', color: done ? COL.text : COL.dim, alpha: done ? 0.45 + 0.55 * pulse(t, 0.8) : 0.7 });
      g.taps.add({ id: 'title', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => this.tap() });
    }
  }
}
