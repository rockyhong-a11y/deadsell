import type { Game, Scene } from '../game';
import { FONT } from '../../engine/config';

/** Title screen. OWNER: ui agent (stub). */
export class TitleScene implements Scene {
  constructor(private game: Game) {}

  enter(): void {
    this.game.audio.music('title');
  }

  update(_dt: number): void {
    const i = this.game.input;
    if (i.pressed('confirm') || i.pressed('attack1') || i.pressed('jump')) this.game.startRun();
  }

  render(): void {
    const d = this.game.display;
    d.wctx.fillStyle = '#07060b';
    d.wctx.fillRect(0, 0, d.W, d.H);
    d.present();
    const c = d.ui;
    c.textAlign = 'center';
    c.fillStyle = '#e8f6ff';
    c.font = `bold 32px ${FONT}`;
    c.fillText('DEADSELL', d.W / 2, d.H / 2 - 20);
    c.font = `11px ${FONT}`;
    c.fillText('화면을 터치하여 시작', d.W / 2, d.H / 2 + 30);
    this.game.taps.add({ id: 'start', rect: { x: 0, y: 0, w: d.W, h: d.H }, mode: 'up', onTap: () => this.game.startRun() });
  }
}
