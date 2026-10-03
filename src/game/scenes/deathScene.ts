import type { Game, Scene } from '../game';
import type { RunState } from '../run';
import { FONT } from '../../engine/config';

/** Death screen with run stats. OWNER: ui agent (stub). */
export class DeathScene implements Scene {
  private t = 0;
  constructor(private game: Game, private run: RunState) {}

  enter(): void {
    this.game.audio.music('death');
  }

  update(dt: number): void {
    this.t += dt;
    const i = this.game.input;
    if (this.t > 1 && (i.pressed('confirm') || i.pressed('attack1') || i.pressed('jump'))) this.game.startRun();
  }

  render(): void {
    const d = this.game.display;
    d.wctx.fillStyle = '#100608';
    d.wctx.fillRect(0, 0, d.W, d.H);
    d.present();
    const c = d.ui;
    c.textAlign = 'center';
    c.fillStyle = '#ff5a5f';
    c.font = `bold 24px ${FONT}`;
    c.fillText('사망', d.W / 2, d.H / 2 - 20);
    c.fillStyle = '#ddd';
    c.font = `11px ${FONT}`;
    c.fillText(`처치 ${this.run.kills} · 잃은 셀 ${this.run.cells}`, d.W / 2, d.H / 2 + 10);
    if (this.t > 1) this.game.taps.add({ id: 'retry', rect: { x: 0, y: 0, w: d.W, h: d.H }, mode: 'up', onTap: () => this.game.startRun() });
  }
}
