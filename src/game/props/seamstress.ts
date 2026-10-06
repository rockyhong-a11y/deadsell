import type { Interactable } from '../world';
import { Prop, drawBubble, drawSoftGlow } from './common';

/** Selma's banter (docs/CONTENT3.md §3): said when she is spoken to. */
export const SELMA_LINES = [
  '여기 있던 팔, 종탑에서 은화 세 닢에 팔렸지.',
  '실은 붉은 걸로. 피가 덜 티 나거든.',
  '골렘? 조각만 넉넉하면 꿰매 주지.',
  '죽은 건 팔 수 있어. 산 건 아직 비싸고.',
  '내 가위는 손님을 가리지 않아.',
  '종탑의 간수가 장부를 쥐고 있어.',
  '쓸 만한 걸 맡겨 봐. 더 좋은 걸로 꿰매 줄게.',
];

/** how long she sews (s) after a craft */
const SEW_TIME = 1.2;

/**
 * Selma (셀마), the corpse seamstress of every 쉼터 (docs/CONTENT4.md §4): she crafts unique items from what the heroine keeps
 * in the stash, the banked pieces and the bell shards.
 */
export class Seamstress extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 52;
  private line = '';
  private lineT = 0;
  private lastLine = -1;
  private sewT = 0;
  private talkT = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 24;
    this.h = 60;
    this.z = 1;
    this.facing = -1;
  }

  init(): void {
    this.useSheet('seamstress', 'idle');
  }

  promptText(): string {
    // while her line is up the bubble has the stage: the prompt (drawn over the same spot) steps aside, an empty label is not drawn
    return this.lineT > 0 ? '' : '대화';
  }

  promptSub(): string | null {
    return `재봉사 셀마 · 시체 조각 ${this.world.game.save.pieces}`;
  }

  canInteract(): boolean {
    return !this.dead;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.talk();
  }

  private talk(): void {
    const w = this.world;
    let i = w.rng.int(0, SELMA_LINES.length - 1);
    if (i === this.lastLine) i = (i + 1) % SELMA_LINES.length;
    this.lastLine = i;
    this.line = SELMA_LINES[i];
    this.lineT = 3;
    this.talkT = 1.6;
    w.audio.play('ui_tap');
  }

  /** She sews (after a craft): the `sew` animation for a moment. */
  sew(): void {
    this.sewT = SEW_TIME;
  }

  update(dt: number): void {
    super.update(dt);
    if (this.playerNear(130)) this.facePlayer();
    if (this.lineT > 0) this.lineT -= dt;
    if (this.talkT > 0) this.talkT -= dt;
    if (this.sewT > 0) this.sewT -= dt;
    this.anim?.play(this.sewT > 0 ? 'sew' : this.talkT > 0 ? 'talk' : 'idle');
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, this.facing < 0);
    const flick = 0.2 + 0.06 * Math.sin(this.world.time * 3) + (this.sewT > 0 ? 0.25 : 0);
    drawSoftGlow(ctx, this.x - 10 * this.facing, this.y - 40, 28, '#ff5a6e', flick);
    if (this.lineT > 0) drawBubble(ctx, this.line, this.x, this.y - 78);
    this.world.lights.add(this.x, this.y - 40, 84, '#ff7a86', 0.65 + (this.sewT > 0 ? 0.4 : 0), 0.1);
  }
}
