import type { Game, Scene } from '../game';
import { COL, SZ, book, button, formatTime, gear, panel, pulse, text } from '../ui/draw';
import { SettingsScreen } from '../ui/settings';
import { CodexScreen } from '../ui/codex';
import type { NavKey } from '../../engine/gamepad';
import { Embers, drawBiomeBg, gradientBg, vignette } from '../ui/backdrop';
import { unlockedCount } from '../meta/progression';

const NAV_KEYS: Record<string, 'left' | 'right' | 'up' | 'down' | 'confirm'> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  Enter: 'confirm', KeyJ: 'confirm', Space: 'confirm', NumpadEnter: 'confirm',
};

/** Title: animated prison backdrop, key art, logo, "touch to start" and meta stats. */
export class TitleScene implements Scene {
  private t = 0;
  private started = false;
  private embers = new Embers(70);
  /** 0 = start, 1 = 설정, 2 = 도감 (keyboard / gamepad selection; right / down go start -> 설정 -> 도감, left / up the other way) */
  private sel = 0;
  private settings: SettingsScreen | null = null;
  private codex: CodexScreen | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private game: Game) {}

  enter(): void {
    if (this.game.save.settings.muted) this.game.audio.setMuted(true);
    this.game.audio.music('title');
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.settings?.close();
    this.codex?.close();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.game.audio.play('ui_tap');
    this.game.startRun();
  }

  openSettings(): void {
    if (this.settings || this.started) return;
    this.game.audio.play('ui_open');
    this.settings = new SettingsScreen(this.game, () => {
      this.settings = null;
      this.sel = 0; // back on "start"
      this.game.input.reset();
    });
  }

  /** 도감: every weapon, skill, enemy, boss and item (a modal over the title) */
  openCodex(): void {
    if (this.codex || this.settings || this.started) return;
    this.game.audio.play('ui_open');
    this.codex = new CodexScreen(this.game, () => {
      this.codex = null;
      this.sel = 0; // back on "start"
      this.game.input.reset();
    });
  }

  /** move the keyboard / pad selection (a cycle of the three buttons; `right` from start still lands on 설정 as before) */
  private moveSel(dir: 1 | -1): void {
    this.sel = (this.sel + dir + 3) % 3;
  }

  /** start, open the codex or open the settings, whichever is selected */
  private activate(): void {
    if (this.settings || this.codex || this.t < 0.3) return;
    if (this.sel === 1) this.openSettings();
    else if (this.sel === 2) this.openCodex();
    else this.start();
  }

  /** gamepad menu keys */
  nav(k: NavKey): void {
    if (this.codex) {
      if (k === 'map') return;
      this.codex.key(k);
      return;
    }
    if (this.settings) {
      if (k === 'map') return;
      this.settings.key(k);
      return;
    }
    if (k === 'confirm') this.activate();
    else if (k === 'pause') this.openSettings();
    else if (k === 'left' || k === 'up') this.moveSel(-1);
    else if (k === 'right' || k === 'down') this.moveSel(1);
  }

  /** the settings screen or the codex is up: the pad drives it */
  captures(): boolean {
    return !!this.settings || !!this.codex;
  }

  private onKey(e: KeyboardEvent): void {
    const c = e.code;
    // held arrows keep scrolling the codex list
    const repeatOk = !!this.codex && (c === 'ArrowUp' || c === 'ArrowDown' || c === 'KeyW' || c === 'KeyS');
    if ((e.repeat && !repeatOk) || e.ctrlKey || e.altKey || e.metaKey || this.started) return;
    if (this.codex) {
      const k = NAV_KEYS[c];
      if (c === 'Escape') this.codex.key('cancel');
      else if (c === 'KeyQ') this.codex.key('tabL');
      else if (c === 'KeyE') this.codex.key('tabR');
      else if (k) this.codex.key(k);
      return;
    }
    if (this.settings) {
      const k = NAV_KEYS[c];
      if (c === 'Escape') this.settings.key('cancel');
      else if (k) this.settings.key(k);
      return;
    }
    if (c === 'Escape') this.openSettings();
    else if (c === 'ArrowLeft' || c === 'ArrowUp' || c === 'KeyA' || c === 'KeyW') this.moveSel(-1);
    else if (c === 'ArrowRight' || c === 'ArrowDown' || c === 'KeyD' || c === 'KeyS') this.moveSel(1);
  }

  update(dt: number): void {
    this.t += dt;
    const d = this.game.display;
    this.embers.update(dt, d.worldW, d.worldH);
    if (this.codex) {
      this.codex.update(dt);
      return;
    }
    if (this.settings) {
      this.settings.update(dt);
      return;
    }
    const i = this.game.input;
    if (this.t > 0.3 && (i.pressed('confirm') || i.pressed('attack1') || i.pressed('jump'))) this.activate();
  }

  render(): void {
    const g = this.game;
    const d = g.display;
    const w = d.wctx;
    const { W, H } = d;
    const { worldW, worldH } = d;
    const t = this.t;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalAlpha = 1;
    w.globalCompositeOperation = 'source-over';
    if (!drawBiomeBg(w, g.assets, 'prison', worldW, worldH, t)) {
      gradientBg(w, worldW, worldH, [[0, '#04030a'], [0.55, '#0c1224'], [1, '#1a1020']]);
      // iron bars of a cell window
      w.fillStyle = 'rgba(8,10,20,0.9)';
      for (let x = 20; x < worldW; x += 54) w.fillRect(x, 0, 6, worldH);
      w.fillStyle = 'rgba(159,232,255,0.05)';
      w.fillRect(0, worldH * 0.62, worldW, 2);
    }
    vignette(w, worldW, worldH, 0.72);
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
    const padMode = g.save.settings.controlMode === 'gamepad';
    // 게임패드 mode hides the touch hint; otherwise the hint follows the last device used
    const dev = padMode && g.input.device === 'touch' ? 'gamepad' : g.input.device;
    const promptY = Math.round(H * 0.74);
    const promptW = dev === 'keyboard' ? 330 : dev === 'gamepad' ? (padMode ? 250 : 270) : 190;
    const promptText = dev === 'keyboard'
      ? 'Enter · Space · J 또는 화면을 터치하여 시작'
      : dev === 'gamepad'
        ? (padMode ? (g.pad.connected ? 'A 버튼을 눌러 시작' : '게임패드를 연결하고 A 버튼을 누르세요') : 'A 버튼 또는 화면을 터치하여 시작')
        : '화면을 터치하여 시작';
    const onStart = this.sel === 0 || dev === 'touch';
    panel(c, Math.round(lx - promptW / 2), promptY - 15, promptW, 30, { fill: '#05080f', alpha: 0.62, stroke: onStart && dev !== 'touch' ? COL.cyan : null, r: 15 });
    text(c, promptText, lx, promptY, {
      size: SZ.m, bold: true, align: 'center', color: COL.cyan, alpha: 0.45 + 0.55 * pulse(t, 0.8),
    });
    // meta stats
    const s = g.save;
    const unl = unlockedCount(s);
    const parts = [`도전 ${s.runs}회`, `승리 ${s.wins}회`, `최고 기록 ${s.bestTime === null ? '--:--' : formatTime(s.bestTime)}`, `처치 ${s.totalKills}`, `해금 ${unl.have}/${unl.total}`];
    text(c, parts.join('  ·  '), lx, H - 18, { align: 'center', color: COL.dim });
    c.globalAlpha = 1;
    g.taps.add({ id: 'start', rect: { x: 0, y: 0, w: W, h: H }, mode: 'up', onTap: () => this.start() });
    // 설정 button (top right, 40 px tall touch target); added after 'start' so it wins the hit test
    const sb = { x: W - 14 - 96, y: 12, w: 96, h: 40 };
    button(c, sb, { label: '', selected: this.sel === 1 && dev !== 'touch', color: COL.amber });
    gear(c, sb.x + 22, sb.y + sb.h / 2, 8, this.sel === 1 && dev !== 'touch' ? COL.amber : COL.text);
    text(c, '설정', sb.x + 38, sb.y + sb.h / 2, { bold: true, size: SZ.m });
    g.taps.add({ id: 'settings', rect: sb, mode: 'up', onTap: () => this.openSettings() });
    // 도감 button, left of 설정 (same size and style)
    const cb = { x: sb.x - 8 - sb.w, y: sb.y, w: sb.w, h: sb.h };
    const onCodex = this.sel === 2 && dev !== 'touch';
    button(c, cb, { label: '', selected: onCodex, color: COL.amber });
    book(c, cb.x + 22, cb.y + cb.h / 2, 9, onCodex ? COL.amber : COL.text);
    text(c, '도감', cb.x + 38, cb.y + cb.h / 2, { bold: true, size: SZ.m });
    g.taps.add({ id: 'codex', rect: cb, mode: 'up', onTap: () => this.openCodex() });
    this.settings?.draw(c, W, H);
    this.codex?.draw(c, W, H);
  }
}
