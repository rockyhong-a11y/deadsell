import type { Game } from '../game';
import type { World } from '../world';
import type { Actor } from '../entity';
import { FONT } from '../../engine/config';

export interface ChoiceOption {
  label: string;
  sub?: string;
  /** hex colour accent */
  color?: string;
  /** icon animation name in the `icons` sheet */
  icon?: string;
  disabled?: boolean;
}

/**
 * In-level UI: HUD, prompts, modal overlays (choices, alchemist shop, map, pause).
 * OWNER: ui agent — this stub only draws HP text. Keep the public API.
 */
export class LevelUI {
  readonly game: Game;
  readonly world: World;
  private toasts: { text: string; t: number; color: string }[] = [];
  boss: { actor: Actor; name: string } | null = null;

  constructor(game: Game, world: World) {
    this.game = game;
    this.world = world;
    world.on((e) => {
      if (e.type === 'toast') this.toast(e.text, e.color);
      if (e.type === 'bossStart') this.boss = { actor: e.boss, name: '강철 여교도관' };
    });
  }

  /** true while a modal overlay pauses the world */
  get modal(): boolean {
    return false;
  }

  onLevelStart(): void {
    this.toast(this.world.run.level.name);
  }

  toast(text: string, color = '#ffffff'): void {
    this.toasts.push({ text, t: 2.5, color });
  }

  /** Modal choice (scrolls, item swap). Calls onPick with the chosen index, or -1 if cancelled. */
  openChoice(_title: string, _options: ChoiceOption[], onPick: (i: number) => void, _cancellable = true): void {
    onPick(0);
  }

  openAlchemist(): void {}
  openMap(): void {}
  openPause(): void {}

  update(dt: number): void {
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const p = this.world.player;
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.ceil(p.hp)}/${p.maxHp}  플라스크 ${this.world.run.flasks}`, 8, 16);
    ctx.textAlign = 'center';
    this.toasts.forEach((t, i) => {
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, this.game.display.W / 2, 60 + i * 14);
    });
  }
}
