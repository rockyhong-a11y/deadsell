import type { Game, Scene } from '../game';
import { COL, SZ, formatTime, pulse, text } from '../ui/draw';
import { Embers, drawBiomeBg, gradientBg, vignette } from '../ui/backdrop';
import { unlockedCount } from '../meta/progression';

/** Title: animated prison backdrop, key art, logo, "touch to start" and meta stats. */
export class TitleScene implements Scene {
  private t = 0;
  private started = false;
  private embers = new Embers(70);

  constructor(private game: Game) {}

  enter(): void {
    if (this.game.save.settings.muted) this.game.audio.setMuted(true);
    this.game.audio.music('title');
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.game.audio.play('ui_tap');
    this.game.startRun();
  }

  update(dt: number): void {
    this.t += dt;
    const d = this.game.display;
    this.embers.update(dt, d.W, d.H);
    const i = this.game.input;
    if (this.t > 0.3 && (i.pressed('confirm') || i.pressed('attack1') || i.pressed('jump'))) this.start();
  }

  render(): void {
    const g = this.game;
    const d = g.display;
    const w = d.wctx;
    const { W, H } = d;
    const t = this.t;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalAlpha = 1;
    w.globalCompositeOperation = 'source-over';
    if (!drawBiomeBg(w, g.assets, 'prison', W, H, t)) {
      gradientBg(w, W, H, [[0, '#04030a'], [0.55, '#0c1224'], [1, '#1a1020']]);
      // iron bars of a cell window
      w.fillStyle = 'rgba(8,10,20,0.9)';
      for (let x = 20; x < W; x += 54) w.fillRect(x, 0, 6, H);
      w.fillStyle = 'rgba(159,232,255,0.05)';
      w.fillRect(0, H * 0.62, W, 2);
    }
    vignette(w, W, H, 0.72);
    this.embers.draw(w);
    d.present();

    const c = d.ui;
    const art = g.assets.image('ui/title.png');
    const hero = g.assets.sheet('heroine');
    const hasArt = !!art || !hero.placeholder;
    const lx = hasArt ? W * 0.34 : W / 2;
    const bob = Math.round(Math.sin(t * 1.6) * 3);
    // key art with a soft cyan glow behind it
    if (hasArt) {
      const ax = W * 0.74;
      const glow = c.createRadialGradient(ax, H * 0.55, 10, ax, H * 0.55, H * 0.6);
      glow.addColorStop(0, `rgba(159,232,255,${0.2 + 0.08 * pulse(t, 0.5)})`);
      glow.addColorStop(1, 'rgba(159,232,255,0)');
      c.fillStyle = glow;
      c.fillRect(0, 0, W, H);
      if (art) {
        const ah = H * 0.94;
        const aw = (art.width / art.height) * ah;
        c.imageSmoothingEnabled = false;
        c.drawImage(art, Math.round(ax - aw / 2), Math.round(H - ah + 6 + bob), Math.round(aw), Math.round(ah));
      } else {
        hero.draw(c, 'idle', Math.floor(t * 10), ax, H - 40 + bob, false, { scale: 3 });
      }
    }
    const fade = Math.min(1, t / 0.8);
    c.globalAlpha = fade;
    const ly = Math.round(H * 0.34 + (1 - fade) * 10);
    c.shadowColor = 'rgba(159,232,255,0.55)';
    c.shadowBlur = 14 * d.scale;
    text(c, 'DEADSELL', lx, ly, { size: 44, bold: true, align: 'center', spacing: 5, color: '#eaf8ff', shadow: '#0b1a2a' });
    c.shadowBlur = 0;
    c.shadowColor = 'transparent';
    c.fillStyle = 'rgba(159,232,255,0.55)';
    c.fillRect(Math.round(lx - 110), ly + 30, 220, 1);
    text(c, '재의 감옥에서 깨어난 죄수, 신더', lx, ly + 48, { size: SZ.m, align: 'center', color: '#b9cbe6' });
    const kb = g.input.device === 'keyboard';
    text(c, kb ? 'Enter · Space · J 또는 화면을 터치하여 시작' : '화면을 터치하여 시작', lx, Math.round(H * 0.74), {
      size: SZ.m, bold: true, align: 'center', color: COL.cyan, alpha: 0.45 + 0.55 * pulse(t, 0.8),
    });
    // meta stats
    const s = g.save;
    const unl = unlockedCount(s);
    const parts = [`도전 ${s.runs}회`, `승리 ${s.wins}회`, `최고 기록 ${s.bestTime === null ? '--:--' : formatTime(s.bestTime)}`, `처치 ${s.totalKills}`, `해금 ${unl.have}/${unl.total}`];
    text(c, parts.join('  ·  '), lx, H - 18, { align: 'center', color: COL.dim });
    c.globalAlpha = 1;
    g.taps.add({ id: 'start', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => this.start() });
  }
}
