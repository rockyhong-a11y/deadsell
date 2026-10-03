import type { Interactable } from '../world';
import type { ItemInstance } from '../items/types';
import { ITEMS, itemLines, itemName } from '../items/items';
import { spawnItemDrop } from '../items/pickups';
import { COLOR_HEX } from '../combat';
import { AnimPlayer } from '../../engine/assets';
import { Prop, drawSoftGlow } from './common';

/** Draws an item icon (icons sheet) centred at (x, y). */
export function drawItemIcon(world: Prop['world'], ctx: CanvasRenderingContext2D, inst: ItemInstance, x: number, y: number, scale = 1): void {
  const sheet = world.assets.sheet('icons');
  const anim = sheet.has(ITEMS[inst.id].icon) ? ITEMS[inst.id].icon : 'rusty_sword';
  sheet.draw(ctx, anim, 0, x, y, false, { scale });
}

/** Free item on a pedestal: take it (it drops into reach and is picked up like any floor item). */
export class Pedestal extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 44;
  item: ItemInstance;
  taken = false;
  private t = 0;

  constructor(x: number, y: number, item: ItemInstance) {
    super(x, y);
    this.item = item;
    this.w = 40;
    this.h = 24;
  }

  init(): void {
    this.anim = new AnimPlayer(this.world.assets.sheet('props'));
    this.anim.play('pedestal');
  }

  promptText(): string {
    return `가져가기 · ${itemName(this.item)}`;
  }

  promptSub(): string | null {
    return itemLines(this.item)[0] ?? null;
  }

  canInteract(): boolean {
    return !this.taken && !this.dead;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.taken = true;
    const w = this.world;
    w.audio.play('pickup_item');
    w.particles.emit('magic', this.x, this.y - 32, { count: 10, color: COLOR_HEX[ITEMS[this.item.id].color] });
    spawnItemDrop(w, this.x, this.y - 40, this.item);
  }

  update(dt: number): void {
    super.update(dt);
    this.t += dt;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false);
    if (this.taken) return;
    const col = COLOR_HEX[ITEMS[this.item.id].color];
    const bob = Math.sin(this.t * 2.6) * 2.5;
    drawSoftGlow(ctx, this.x, this.y - 40 + bob, 24, col, 0.6);
    drawItemIcon(this.world, ctx, this.item, this.x, this.y - 40 + bob, 1.4);
    this.world.lights.add(this.x, this.y - 36, 70, col, 0.8, 0.1);
  }
}
