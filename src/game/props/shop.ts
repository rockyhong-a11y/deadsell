import type { Interactable } from '../world';
import type { ItemInstance } from '../items/types';
import { ITEMS, itemLines, itemName, itemPrice } from '../items/items';
import { spawnItemDrop } from '../items/pickups';
import { COLOR_HEX } from '../combat';
import { AnimPlayer } from '../../engine/assets';
import { Prop, drawBubble, drawSoftGlow, drawWorldText } from './common';
import { drawItemIcon } from './pedestal';

/** An item for sale on a small pedestal in front of the merchant. */
export class ShopItem extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 38;
  item: ItemInstance;
  price: number;
  sold = false;
  private t = 0;

  constructor(x: number, y: number, item: ItemInstance, price?: number) {
    super(x, y);
    this.item = item;
    this.price = price ?? itemPrice(item);
    this.w = 30;
    this.h = 24;
  }

  init(): void {
    this.anim = new AnimPlayer(this.world.assets.sheet('props'));
    this.anim.play('pedestal');
  }

  promptText(): string {
    return `구매 · ${itemName(this.item)}`;
  }

  promptSub(): string | null {
    return `${this.price} 골드 · ${itemLines(this.item)[0] ?? ''}`;
  }

  canInteract(): boolean {
    return !this.sold && !this.dead;
  }

  get affordable(): boolean {
    return this.world.run.gold >= this.price;
  }

  interact(): void {
    if (!this.canInteract()) return;
    const w = this.world;
    if (!this.affordable) {
      w.audio.play('error');
      w.emit({ type: 'toast', text: '골드가 부족하다', color: '#ff7a7a' });
      return;
    }
    w.run.gold -= this.price;
    this.sold = true;
    w.audio.play('buy');
    w.particles.emit('gold', this.x, this.y - 34, { count: 8 });
    w.emit({ type: 'toast', text: `${itemName(this.item)} 구매`, color: '#ffd36a' });
    spawnItemDrop(w, this.x, this.y - 40, this.item);
  }

  update(dt: number): void {
    super.update(dt);
    this.t += dt;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false, { scale: 0.8 });
    if (this.sold) return;
    const col = COLOR_HEX[ITEMS[this.item.id].color];
    const bob = Math.sin(this.t * 2.4 + this.x) * 2;
    drawSoftGlow(ctx, this.x, this.y - 36 + bob, 18, col, 0.5);
    drawItemIcon(this.world, ctx, this.item, this.x, this.y - 36 + bob, 1.2);
    drawWorldText(ctx, String(this.price), this.x, this.y - 54, this.affordable ? '#ffd36a' : '#ff7a7a', 11);
    this.world.lights.add(this.x, this.y - 34, 46, col, 0.5, 0.1);
  }
}

const MERCHANT_LINES = [
  '어서 와요! 좋은 물건만 있어요.',
  '골드가 있다면 뭐든 팔죠.',
  '죽으면 다 잃어요. 쓸 수 있을 때 쓰세요!',
  '저 칼 좋아 보이죠? 그렇죠?',
  '깎아 달라고요? 후후, 농담도!',
  '목숨값보다는 싸답니다.',
];

/** Pell, the merchant (and her stall). Talk for a line of banter. */
export class Merchant extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 48;
  private line = '';
  private lineT = 0;
  private talkT = 0;
  private lastLine = -1;
  private t = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 24;
    this.h = 52;
    this.z = 1;
    this.facing = -1;
  }

  init(): void {
    this.useSheet('merchant', 'idle');
  }

  promptText(): string {
    return '대화';
  }

  promptSub(): string | null {
    return '상인 펠';
  }

  canInteract(): boolean {
    return !this.dead;
  }

  interact(): void {
    const w = this.world;
    let i = w.rng.int(0, MERCHANT_LINES.length - 1);
    if (i === this.lastLine) i = (i + 1) % MERCHANT_LINES.length;
    this.lastLine = i;
    this.line = MERCHANT_LINES[i];
    this.lineT = 2.8;
    this.talkT = 1.4;
    w.audio.play('ui_tap');
  }

  update(dt: number): void {
    super.update(dt);
    this.t += dt;
    if (this.playerNear(110)) this.facePlayer();
    if (this.lineT > 0) this.lineT -= dt;
    if (this.talkT > 0) this.talkT -= dt;
    this.anim?.play(this.talkT > 0 ? 'talk' : 'idle');
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const stall = this.world.assets.sheet('props');
    stall.draw(ctx, 'shop_stall', 0, this.x + 26, this.y, false);
    this.anim?.draw(ctx, this.x, this.y, this.facing < 0);
    if (this.lineT > 0) drawBubble(ctx, this.line, this.x, this.y - 66);
    this.world.lights.add(this.x + 8, this.y - 34, 90, '#ffcf80', 0.8, 0.06);
  }
}
