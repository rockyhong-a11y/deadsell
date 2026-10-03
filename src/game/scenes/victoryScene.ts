import type { Game, Scene } from '../game';
import type { RunState } from '../run';
import { FONT } from '../../engine/config';

/** Victory screen. OWNER: ui agent (stub). */
export class VictoryScene implements Scene {
  private t = 0;
  constructor(private game: Game, private run: RunState) {}

  enter(): void {
    this.game.audio.music('victory');
  }

  update(dt: number): void {
    this.t += dt;
  }

  render(): void {
    const d = this.game.display;
    d.wctx.fillStyle = '#0b0a14';
    d.wctx.fillRect(0, 0, d.W, d.H);
    d.present();
    const c = d.ui;
    c.textAlign = 'center';
    c.fillStyle = '#ffd23f';
    c.font = `bold 24px ${FONT}`;
    c.fillText('승리', d.W / 2, d.H / 2 - 20);
    c.fillStyle = '#ddd';
    c.font = `11px ${FONT}`;
    c.fillText(`시간 ${Math.floor(this.run.time)}초 · 처치 ${this.run.kills}`, d.W / 2, d.H / 2 + 10);
    if (this.t > 1.5) this.game.taps.add({ id: 'title', rect: { x: 0, y: 0, w: d.W, h: d.H }, mode: 'up', onTap: () => this.game.showTitle() });
  }
}
