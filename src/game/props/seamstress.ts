import type { Interactable } from '../world';
import { Prop, drawBubble, drawSoftGlow } from './common';

/** Selma's banter (docs/CONTENT3.md §3): she says one after every craft. */
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
 * How far above her feet the banter bubble's tail ends (world px): clear of the interact prompt, whose top edge is 100 to 122
 * px above them at the three world resolutions (HUD `drawPrompt`: the anchor 60 px up, 12 px gap, the 38 px bubble, scaled by
 * UI px per world px = 1.25 / 1 / 0.83).
 */
const BUBBLE_Y = -122;

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
    // always there, also while her line is up (the bubble sits above it): the prompt is the tap target of the craft screen
    return '조합';
  }

  promptSub(): string | null {
    return `재봉사 셀마 · 시체 조각 ${this.world.game.save.pieces}`;
  }

  canInteract(): boolean {
    return !this.dead;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.world.ui.openCraft(() => this.sew());
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

  /** After a craft: the `sew` animation for a moment and one of her lines (it stays up once the craft screen is closed). */
  sew(): void {
    this.sewT = SEW_TIME;
    this.anim?.play('sew'); // (the world is paused while the craft screen is up)
    this.talk();
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
    if (this.lineT > 0) drawBubble(ctx, this.line, this.x, this.y + BUBBLE_Y);
    this.world.lights.add(this.x, this.y - 40, 84, '#ff7a86', 0.65 + (this.sewT > 0 ? 0.4 : 0), 0.1);
  }
}
