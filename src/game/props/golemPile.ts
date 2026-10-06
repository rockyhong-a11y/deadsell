import type { Interactable } from '../world';
import { golemCost } from '../rules';
import { Golem, newGolemState } from '../allies/golem';
import { Prop, drawSoftGlow } from './common';

/** seconds the heap of rags takes to rise into the golem */
const ASSEMBLE = 0.9;

/**
 * The rag pile of a 쉼터 where Selma stitches the golem (docs/CONTENT3.md §3): pay banked pieces, the pile rises into a
 * 누더기 골렘 that fights beside the heroine for the rest of the run. One golem at a time: while it lives (or when one
 * already follows her into the level) the pile is gone and there is nothing to buy.
 */
export class GolemPile extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 50;
  private t = 0;
  /** 'pile' = for sale, 'rising' = assembling, 'gone' = the golem stands (or follows her) */
  private state: 'pile' | 'rising' | 'gone' = 'pile';
  private riseT = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 40;
    this.h = 24;
  }

  init(): void {
    this.useSheet('golem', 'pile');
    this.facing = 1;
    if (this.world.run.golem) this.state = 'gone';
  }

  private get cost(): number {
    return golemCost(this.world.run.loop);
  }

  /** the banked pieces pay for it (docs/CONTENT4.md §3) */
  private get bank(): number {
    return this.world.game.save.pieces;
  }

  promptText(): string {
    return this.world.run.golem ? '골렘 수선' : '누더기 골렘 제작';
  }

  promptSub(): string | null {
    const g = this.world.run.golem;
    return g ? `체력 ${Math.ceil(g.hp)}/${g.maxHp}` : `${this.cost}조각 (맡긴 ${this.bank}) · 조력자 (이번 런 동안 함께 싸움)`;
  }

  canInteract(): boolean {
    return !this.dead && this.state === 'pile' && !this.world.run.golem;
  }

  interact(): void {
    if (!this.canInteract()) return;
    const w = this.world;
    if (this.bank < this.cost) {
      w.audio.play('error');
      w.emit({ type: 'toast', text: '시체 조각이 부족하다', color: '#ff7a7a' });
      return;
    }
    w.game.save.pieces -= this.cost;
    w.game.persist();
    newGolemState(w.run);
    this.state = 'rising';
    this.riseT = 0;
    this.anim?.playFor('assemble', ASSEMBLE);
    w.audio.play('buy');
    w.particles.emit('debris', this.x, this.y - 10, { count: 12, color: '#b89a72' });
    w.emit({ type: 'toast', text: '누더기 골렘이 일어섰다', color: '#e8d7c3' });
  }

  update(dt: number): void {
    super.update(dt);
    this.t += dt;
    if (this.state !== 'rising') return;
    this.riseT += dt;
    if (this.riseT < ASSEMBLE) return;
    // the golem stands up where the pile was, facing the heroine
    const w = this.world;
    const g = new Golem(this.x, this.y, w.run.golem!);
    g.facing = w.player.x >= this.x ? 1 : -1;
    w.spawn(g);
    w.particles.emit('dust', this.x, this.y, { count: 10, w: 40 });
    this.state = 'gone';
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'gone') return;
    this.anim?.draw(ctx, this.x, this.y, false);
    if (this.state === 'pile') {
      drawSoftGlow(ctx, this.x, this.y - 14, 26, '#4fe3ff', 0.16 + 0.05 * Math.sin(this.t * 3));
      this.world.lights.add(this.x, this.y - 14, 56, '#8fe3ff', 0.4, 0.1);
    }
  }
}
