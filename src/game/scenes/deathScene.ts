import type { Game, Scene } from '../game';
import type { RunState } from '../run';
import { COL, SZ, button, formatTime, icon, pulse, text } from '../ui/draw';
import { Embers, gradientBg, vignette } from '../ui/backdrop';
import type { NavKey } from '../../engine/gamepad';

/** Death screen: "사망", run stats, cells lost, tap to retry. */
export class DeathScene implements Scene {
  private t = 0;
  private leaving = false;
  private embers = new Embers(36, ['#ff5a5f', '#ff9a3c', '#7a1f3a'], 3);

  constructor(private game: Game, private run: RunState) {}

  enter(): void {
    this.game.audio.music('death');
  }

  private retry(): void {
    if (this.leaving || this.t < 0.9) return;
    this.leaving = true;
    this.game.audio.play('ui_tap');
    this.game.startRun();
  }

  private title(): void {
    if (this.leaving || this.t < 0.9) return;
    this.leaving = true;
    this.game.showTitle();
  }

  /** gamepad: A = retry, B = title */
  nav(k: NavKey): void {
    if (k === 'confirm') this.retry();
    else if (k === 'cancel') this.title();
  }

  update(dt: number): void {
    this.t += dt;
    const d = this.game.display;
    this.embers.update(dt, d.worldW, d.worldH);
    const i = this.game.input;
    if (this.t > 1 && (i.pressed('confirm') || i.pressed('attack1') || i.pressed('jump'))) this.retry();
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
    gradientBg(w, worldW, worldH, [[0, '#080308'], [0.7, '#1a060c'], [1, '#2a0a10']]);
    vignette(w, worldW, worldH, 0.75, '4,2,6');
    this.embers.draw(w);
    d.present();

    const c = d.ui;
    const run = this.run;
    const cx = W / 2;
    // title slams in
    const k = Math.min(1, t / 0.45);
    const sc = 1 + (1 - k) * 0.5;
    c.save();
    c.translate(cx, H * 0.2);
    c.scale(sc, sc);
    c.globalAlpha = k;
    text(c, '사망', 0, 0, { size: 44, bold: true, align: 'center', spacing: 14, color: COL.red, shadow: '#2a0508' });
    c.restore();
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(255,90,95,0.6)';
    c.fillRect(Math.round(cx - 90 * k), Math.round(H * 0.2 + 30), Math.round(180 * k), 1);

    // stat card, rows appear one after another
    const rows: { label: string; value: string; color?: string; cells?: boolean }[] = [
      { label: '도달한 구역', value: run.level.name },
      { label: '생존 시간', value: formatTime(run.time) },
      { label: '처치한 적', value: String(run.kills) },
      { label: '잃어버린 셀', value: String(run.cells), color: run.cells > 0 ? COL.cell : COL.dim, cells: true },
    ];
    const rw = 230;
    const ry0 = Math.round(H * 0.34);
    rows.forEach((r, i) => {
      const a = Math.max(0, Math.min(1, (t - 0.5 - i * 0.18) / 0.25));
      if (a <= 0) return;
      const y = ry0 + i * 28;
      c.globalAlpha = a;
      text(c, r.label, cx - rw / 2, y, { color: COL.dim });
      text(c, r.value, cx + rw / 2, y, { size: SZ.m, bold: true, align: 'right', color: r.color ?? COL.text });
      if (r.cells) icon(g.assets, c, 'cells', cx + rw / 2 - 22 - r.value.length * 7, y, 16);
      c.fillStyle = 'rgba(141,155,184,0.25)';
      c.fillRect(cx - rw / 2, y + 12, rw, 1);
    });
    c.globalAlpha = Math.max(0, Math.min(1, (t - 1.3) / 0.4));
    if (run.cells > 0) text(c, '※ 쓰지 않은 셀은 사라졌습니다. 통로의 연금술사에게 맡기세요.', cx, ry0 + 4 * 28 + 6, { align: 'center', color: COL.amber });
    c.globalAlpha = 1;

    if (t > 1) {
      text(c, '화면을 터치하여 다시 도전', cx, H - 52, { size: SZ.m, bold: true, align: 'center', color: COL.text, alpha: 0.45 + 0.55 * pulse(t, 0.8) });
      g.taps.add({ id: 'retry', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => this.retry() });
      const tb = { x: 12, y: H - 50, w: 84, h: 38 };
      button(c, tb, { label: '타이틀', color: COL.dim });
      g.taps.add({ id: 'to-title', rect: tb, mode: 'up', onTap: () => this.title() });
    }
  }
}
