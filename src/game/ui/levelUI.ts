import type { Game } from '../game';
import type { World } from '../world';
import type { Actor } from '../entity';
import { Hud } from './hud';
import { Modal, ChoiceModal, AlchemistModal, CodexModal, MapModal, PauseModal, SettingsModal, TutorialModal, type ModalKey } from './modals';
import type { NavKey } from '../../engine/gamepad';

export interface ChoiceOption {
  label: string;
  sub?: string;
  /** hex colour accent */
  color?: string;
  /** icon animation name in the `icons` sheet */
  icon?: string;
  disabled?: boolean;
}

const KEYS: Record<string, ModalKey> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  Enter: 'confirm', KeyJ: 'confirm', Space: 'confirm', NumpadEnter: 'confirm',
};

/**
 * In-level UI: HUD (hud.ts), prompts, modal overlays (choices, alchemist shop, map, pause,
 * tutorial: modals.ts). While a modal is open `modal` is true and LevelScene pauses the world.
 * Everything is tappable through game.taps (see touch.ts); keyboard works too.
 */
export class LevelUI {
  readonly game: Game;
  readonly world: World;
  readonly hud: Hud;
  boss: { actor: Actor; name: string } | null = null;
  /** the mid-boss whose name card / HP bar is up (set on minibossStart, cleared by the HUD after its death fade) */
  miniboss: { actor: Actor; name: string } | null = null;
  private stack: Modal[] = [];
  private started = false;
  private gaveUp = false;
  private bannerPending = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private visHandler: (() => void) | null = null;

  constructor(game: Game, world: World) {
    this.game = game;
    this.world = world;
    this.hud = new Hud(this);
    world.on((e) => {
      if (e.type === 'toast') this.toast(e.text, e.color);
      if (e.type === 'bossStart') this.boss = { actor: e.boss, name: '강철 여교도관' };
      else if (e.type === 'minibossStart') this.miniboss = { actor: e.boss, name: e.name };
    });
    if (game.save.settings.muted) game.audio.setMuted(true);
    if (typeof window !== 'undefined') {
      this.keyHandler = (e) => this.onKeyDown(e);
      this.visHandler = () => {
        if (document.hidden && this.isActive() && !this.modal && !this.world.player.dying) this.openPause();
      };
      window.addEventListener('keydown', this.keyHandler);
      document.addEventListener('visibilitychange', this.visHandler);
    }
  }

  /** true while a modal overlay pauses the world */
  get modal(): boolean {
    return this.stack.length > 0;
  }

  get top(): Modal | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Is this the UI of the scene currently on screen? (stale instances ignore the keyboard) */
  private isActive(): boolean {
    const s = this.game.scene as { ui?: unknown } | null;
    return !!s && s.ui === this;
  }

  /** Remove the global listeners (called automatically once another scene takes over). */
  dispose(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.visHandler) document.removeEventListener('visibilitychange', this.visHandler);
    this.keyHandler = this.visHandler = null;
  }

  onLevelStart(): void {
    this.started = true;
    if (this.game.save.settings.hints && this.world.run.levelIndex === 0) {
      this.bannerPending = true; // shown once the tutorial is dismissed
      this.openTutorial(true);
    } else this.hud.showBanner(this.world.run.level.name);
  }

  toast(text: string, color = '#ffffff'): void {
    this.hud.toast(text, color);
  }

  // ---- modals -------------------------------------------------------------

  private push(m: Modal): void {
    this.game.input.reset();
    this.stack.push(m);
  }

  closeTop(m?: Modal): void {
    if (m) this.stack = this.stack.filter((x) => x !== m);
    else this.stack.pop();
    this.game.input.reset();
    if (this.bannerPending && !this.stack.length) {
      this.bannerPending = false;
      this.hud.showBanner(this.world.run.level.name);
    }
  }

  /** Modal choice (scrolls, item swap). Calls onPick with the chosen index, or -1 if cancelled. */
  openChoice(title: string, options: ChoiceOption[], onPick: (i: number) => void, cancellable = true): void {
    this.game.audio.play('ui_open');
    this.push(new ChoiceModal(this, title, options, onPick, cancellable));
  }

  openAlchemist(): void {
    this.game.audio.play('ui_open');
    this.push(new AlchemistModal(this));
  }

  openMap(): void {
    if (this.top instanceof MapModal) return;
    this.game.audio.play('ui_open');
    this.push(new MapModal(this));
  }

  openPause(): void {
    if (this.top instanceof PauseModal) return;
    this.game.audio.play('ui_open');
    this.push(new PauseModal(this));
  }

  openTutorial(firstRun: boolean): void {
    this.push(new TutorialModal(this, firstRun));
  }

  openSettings(): void {
    if (this.top instanceof SettingsModal) return;
    this.game.audio.play('ui_open');
    this.push(new SettingsModal(this));
  }

  openCodex(): void {
    if (this.top instanceof CodexModal) return;
    this.game.audio.play('ui_open');
    this.push(new CodexModal(this));
  }

  /** Pause menu "give up": end the run now (death screen). The pause card stays up while the screen fades. */
  giveUp(): void {
    if (this.gaveUp) return;
    this.gaveUp = true;
    this.game.playerDied();
  }

  /** Feed a navigation key to the top modal (keyboard; also used by tests). */
  key(k: ModalKey): void {
    this.top?.key(k);
  }

  /** Gamepad navigation (Game.step): menu keys go to the top modal; Start = Esc, Back = M like the keyboard. */
  nav(k: NavKey): void {
    if (!this.isActive()) return;
    if (k === 'pause') {
      if (this.top) this.top.key('cancel');
      else if (!this.world.player.dying) this.openPause();
    } else if (k === 'map') {
      if (this.top instanceof MapModal) this.top.key('cancel');
      else if (!this.top && !this.world.player.dying) this.openMap();
    } else if (k === 'tabL' || k === 'tabR') this.top?.tab(k === 'tabL' ? -1 : 1);
    else if (this.top) this.top.key(k);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.isActive()) {
      if (this.started) this.dispose();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.repeat && !this.top?.repeatKey(e.code)) return;
    if (e.code === 'Escape') {
      if (this.top) this.top.key('cancel');
      else if (!this.world.player.dying) this.openPause();
    } else if (e.code === 'KeyM') {
      if (this.top instanceof MapModal) this.top.key('cancel');
      else if (!this.top && !this.world.player.dying) this.openMap();
    } else if (this.top) {
      const k = KEYS[e.code];
      if (k) this.top.key(k);
      else if (e.code === 'KeyQ') this.top.tab(-1);
      else if (e.code === 'KeyE') this.top.tab(1);
    }
  }

  // ---- frame --------------------------------------------------------------

  update(dt: number): void {
    this.hud.update(dt);
    this.top?.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const d = this.game.display;
    this.hud.draw(ctx, d.W, d.H, !this.modal);
    this.top?.draw(ctx, d.W, d.H);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}
