import type { Interactable } from '../world';
import type { ItemInstance } from '../items/types';
import { rollItem } from '../items/items';
import { dropLoot, spawnFood, spawnItemDrop } from '../items/pickups';
import { FOODS, LOOT } from '../rules';
import { Prop } from './common';

/** A treasure chest: gold (+ cells) always, an item or food sometimes (secret chests always roll an item). */
export class Chest extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 40;
  opened = false;
  private t = 0;
  private lootGiven = false;
  /** richer loot (secret room) */
  rich: boolean;

  constructor(x: number, y: number, rich = false) {
    super(x, y);
    this.w = 36;
    this.h = 28;
    this.rich = rich;
  }

  init(): void {
    this.useSheet('props', 'chest');
    this.anim!.speed = 0;
  }

  promptText(): string {
    return '열기';
  }

  canInteract(): boolean {
    return !this.opened && !this.dead;
  }

  interact(): void {
    if (!this.canInteract()) return;
    this.opened = true;
    this.t = 0;
    this.anim!.speed = 1;
    this.anim!.play('chest', true);
    this.world.audio.play('chest');
  }

  private giveLoot(): void {
    const w = this.world;
    const tier = w.run.tier;
    const rng = w.rng;
    const C = LOOT.chest;
    const gold = Math.round((rng.int(C.gold[0], C.gold[1]) + C.goldPerTier * (tier - 1)) * (this.rich ? C.richMult : 1));
    dropLoot(w, this.x, this.y - 18, { gold, cells: rng.int(C.cells[0], C.cells[1]) });
    const r = rng.next();
    if (this.rich || r < C.itemChance) {
      const inst: ItemInstance = rollItem(rng, tier, w.game.save.unlocked);
      spawnItemDrop(w, this.x, this.y - 22, inst);
    } else if (r < C.itemChance + C.foodChance) {
      spawnFood(w, this.x, this.y - 18, FOODS[1].healPct);
    }
    w.particles.emit('spark', this.x, this.y - 22, { count: 10 });
  }

  update(dt: number): void {
    super.update(dt);
    if (this.opened) {
      this.t += dt;
      if (!this.lootGiven && this.t >= 0.28) {
        this.lootGiven = true;
        this.giveLoot();
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, false);
    if (!this.opened) this.world.lights.add(this.x, this.y - 12, 36, '#ffd36a', 0.45, 0.1);
  }
}
