import { TILE } from '../../engine/config';
import { T } from '../tilemap';
import { Actor } from '../entity';
import { Prop, fillTiles } from './common';

/**
 * The portcullis of the boss arena entrance. Open at the start; closes (solid tiles) when the boss
 * fight starts, as soon as the player has stepped into the arena; opens again when the boss dies.
 * Occupies the 2 x 4 tiles whose bottom-centre is (x, y).
 */
export class BossGate extends Prop {
  closed = false;
  /** 0 = closed artwork, 1 = fully raised */
  private open = 1;
  private wantClosed = false;
  private tx0 = 0;
  private ty0 = 0;
  private off: (() => void)[] = [];

  constructor(x: number, y: number) {
    super(x, y);
    this.z = 3;
    this.w = 2 * TILE;
    this.h = 4 * TILE;
    this.alwaysActive = true;
  }

  init(): void {
    this.useSheet('props', 'boss_gate');
    this.anim!.speed = 0;
    this.tx0 = Math.round(this.x / TILE) - 1;
    this.ty0 = Math.round(this.y / TILE) - 4;
    const w = this.world;
    this.off.push(
      w.on((e) => {
        if (e.type === 'bossStart') this.wantClosed = true;
        else if (e.type === 'bossDefeated') {
          this.wantClosed = false;
          this.setClosed(false);
        }
      }),
    );
  }

  onRemove(): void {
    for (const f of this.off) f();
  }

  /** the gate's tile box in world px */
  private box() {
    return { x: this.tx0 * TILE, y: this.ty0 * TILE, w: 2 * TILE, h: 4 * TILE };
  }

  private setClosed(c: boolean): void {
    if (this.closed === c) return;
    this.closed = c;
    fillTiles(this.world, this.tx0, this.ty0, this.tx0 + 1, this.ty0 + 3, c ? T.Solid : T.Empty);
    if (c) {
      this.world.audio.play('door');
      this.world.shake(3, 0.3);
      this.world.particles.emit('debris', this.x, this.y - 40, { count: 10, w: 40 });
    }
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    if (this.wantClosed && !this.closed) {
      const p = w.player;
      const b = this.box();
      // close only once the player is inside the arena (right of the gate) and nothing stands in the way
      const clear = !!p && p.x > b.x + b.w + TILE && w.query(b, (e): e is Actor => e instanceof Actor).length === 0;
      if (clear) this.setClosed(true);
    }
    const target = this.closed ? 0 : 1;
    this.open += Math.sign(target - this.open) * Math.min(Math.abs(target - this.open), dt / 0.6);
    const a = this.anim;
    if (a) a.t = this.open * (a.def.frames - 1) / a.def.fps + 1e-6;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false);
  }
}
