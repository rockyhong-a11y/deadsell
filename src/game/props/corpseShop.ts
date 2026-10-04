import type { Interactable } from '../world';
import type { Rng } from '../../engine/rng';
import { UNIQUE_IDS, type ItemId, type ItemInstance } from '../items/types';
import { itemColor, itemLines, itemName, uniquePrice } from '../items/items';
import { PIECE_COLOR, spawnItemDrop } from '../items/pickups';
import { AnimPlayer } from '../../engine/assets';
import { Prop, drawSoftGlow, drawWorldText } from './common';
import { drawItemIcon } from './pedestal';

/** `count` distinct unique items for the 시체 상점, drawn with the level rng (fewer if there are not that many). */
export function corpseShopStock(rng: Rng, count: number, ids: readonly ItemId[] = UNIQUE_IDS): ItemId[] {
  return rng.shuffle([...ids]).slice(0, count);
}

/**
 * One pedestal of Selma's 시체 상점: a unique item for corpse pieces (not gold). An empty pedestal (no stock, or already
 * bought) says "품절".
 */
export class CorpseShopItem extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 38;
  item: ItemInstance | null;
  price: number;
  sold = false;
  private t = 0;

  constructor(x: number, y: number, item: ItemInstance | null, loop = 1) {
    super(x, y);
    this.item = item;
    this.price = item ? uniquePrice(item.id, loop) : 0;
    this.sold = !item;
    this.w = 30;
    this.h = 24;
  }

  init(): void {
    this.anim = new AnimPlayer(this.world.assets.sheet('props'));
    this.anim.play('pedestal');
  }

  promptText(): string {
    return this.item ? `구매 · ${itemName(this.item)}` : '품절';
  }

  promptSub(): string | null {
    return this.item ? `${this.price}조각 · ${itemLines(this.item)[0] ?? ''}` : null;
  }

  canInteract(): boolean {
    return !this.sold && !this.dead;
  }

  get affordable(): boolean {
    return this.world.run.pieces >= this.price;
  }

  interact(): void {
    if (!this.canInteract() || !this.item) return;
    const w = this.world;
    if (!this.affordable) {
      w.audio.play('error');
      w.emit({ type: 'toast', text: '시체 조각이 부족하다', color: '#ff7a7a' });
      return;
    }
    w.run.pieces -= this.price;
    this.sold = true;
    w.audio.play('buy');
    w.particles.emit('magic', this.x, this.y - 34, { count: 10, color: PIECE_COLOR });
    w.emit({ type: 'toast', text: `${itemName(this.item)} 구매`, color: PIECE_COLOR });
    spawnItemDrop(w, this.x, this.y - 40, this.item);
  }

  update(dt: number): void {
    super.update(dt);
    this.t += dt;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false, { scale: 0.8 });
    drawSoftGlow(ctx, this.x, this.y - 8, 20, PIECE_COLOR, 0.28);
    if (this.sold || !this.item) {
      drawWorldText(ctx, '품절', this.x, this.y - 30, '#8d8d98', 11);
      return;
    }
    const col = itemColor(this.item.id);
    const bob = Math.sin(this.t * 2.4 + this.x) * 2;
    drawSoftGlow(ctx, this.x, this.y - 36 + bob, 18, col, 0.5);
    drawItemIcon(this.world, ctx, this.item, this.x, this.y - 36 + bob, 1.2);
    drawWorldText(ctx, `${this.price}조각`, this.x, this.y - 54, this.affordable ? PIECE_COLOR : '#ff7a7a', 11);
    this.world.lights.add(this.x, this.y - 34, 46, col, 0.5, 0.1);
  }
}
