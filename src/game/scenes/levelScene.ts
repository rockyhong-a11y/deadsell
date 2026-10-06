import type { Game, Scene } from '../game';
import type { RunState } from '../run';
import { World } from '../world';
import { buildLevel, populateLevel } from '../level/build';
import { LevelRenderer } from '../level/render';
import { Player } from '../player/player';
import { spawnRunGolem } from '../allies/golem';
import { collectAllPieces, collectCoinsInRange, homeAllPieces } from '../items/pickups';
import { LevelUI } from '../ui/levelUI';
import { DEBUG } from '../../engine/config';
import type { Actor } from '../entity';
import type { NavKey } from '../../engine/gamepad';

/** Plays one level of the run (biome, passage or boss arena). */
export class LevelScene implements Scene {
  readonly game: Game;
  readonly run: RunState;
  readonly world: World;
  readonly renderer: LevelRenderer;
  readonly ui: LevelUI;
  private endTimer = -1;
  private endAction: (() => void) | null = null;
  /** the exit was taken: the level is fading out, loot that still drops is collected on the spot */
  private leaving = false;

  constructor(game: Game, run: RunState) {
    this.game = game;
    this.run = run;
    const spec = run.level;
    const level = buildLevel(spec, (run.seed + run.levelIndex * 7919) >>> 0, game.save);
    this.world = new World(game, run, level);
    const w = this.world;
    const p = new Player(level.playerStart.x, level.playerStart.y);
    w.player = p;
    w.spawn(p);
    // the rag golem follows her through the levels of the run (healed in every 쉼터)
    spawnRunGolem(w, p, spec.kind);
    populateLevel(w, level);
    w.camera.snap(p.x, p.y - 20);
    this.renderer = new LevelRenderer(w);
    this.ui = new LevelUI(game, w);
    w.ui = this.ui;
    w.lights.setBiome(spec.biome, spec.kind);
    w.on((e) => {
      if (e.type === 'playerDied') this.endAfter(1.6, () => game.playerDied());
      else if (e.type === 'levelExit') {
        this.endAfter(0, () => {
          this.leaving = true;
          // loot that dropped moments before the exit (it only starts homing after a short delay) is not left behind
          collectCoinsInRange(w);
          game.nextLevel();
        });
      } else if (e.type === 'bossDefeated') {
        w.timeScale = 0.3;
        // her pieces fly to the heroine from anywhere on the map; whatever is still on the floor when the victory is
        // called (slow motion slows them) is credited first, so a far-away killing blow never loses pieces
        homeAllPieces(w);
        this.endAfter(3.2, () => {
          collectAllPieces(w);
          game.victory();
        });
      } else if (e.type === 'enemyKilled') run.kills++;
    });
  }

  enter(): void {
    const spec = this.run.level;
    this.game.audio.music(spec.kind === 'boss' ? 'boss' : spec.kind === 'passage' ? 'passage' : spec.biome === 'prison' ? 'prison' : 'ramparts');
    this.ui.onLevelStart();
  }

  /** Release the global listeners of the in-level UI (a touch-only player never sends the key press that disposes it lazily). */
  exit(): void {
    this.ui.dispose();
  }

  /** Gamepad menu keys (the pause / map buttons also arrive here). */
  nav(k: NavKey): void {
    this.ui.nav(k);
  }

  /** a modal is open: the pad drives the menu, not the (paused) world */
  captures(): boolean {
    return this.ui.modal;
  }

  private endAfter(secs: number, fn: () => void): void {
    if (this.endAction) return;
    this.endAction = fn;
    this.endTimer = secs;
  }

  update(dt: number): void {
    if (this.endAction) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        const fn = this.endAction;
        this.endTimer = Infinity;
        fn();
      }
    }
    this.ui.update(dt);
    if (this.ui.modal) return;
    this.run.time += dt;
    this.world.update(dt);
    if (this.leaving) collectCoinsInRange(this.world);
  }

  render(): void {
    const d = this.game.display;
    const ctx = d.wctx;
    const w = this.world;
    const cam = w.camera;
    // the world buffer size is a graphics setting (288 / 360 / 432 tall); the UI keeps its own fixed 360-tall space
    cam.w = d.worldW;
    cam.h = d.worldH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.renderer.drawBack(ctx, cam);
    ctx.save();
    ctx.translate(-cam.viewX, -cam.viewY);
    this.renderer.drawTiles(ctx, cam);
    const vx0 = cam.x - 160, vx1 = cam.x + cam.w + 160, vy0 = cam.y - 160, vy1 = cam.y + cam.h + 200;
    const list = w.entities.filter((e) => !e.dead && e.x > vx0 && e.x < vx1 && e.y > vy0 && e.y < vy1).sort((a, b) => a.z - b.z);
    for (const e of list) e.draw(ctx);
    w.particles.draw(ctx);
    this.renderer.drawFront(ctx, cam);
    if (DEBUG.hitboxes) drawHitboxes(ctx, w.actors);
    ctx.restore();
    w.lights.render(ctx, cam, d.worldW, d.worldH, w.time);
    ctx.save();
    ctx.translate(-cam.viewX, -cam.viewY);
    w.fx.draw(ctx);
    ctx.restore();
    w.fx.drawScreen(ctx, d.worldW, d.worldH);
    d.present();
    this.ui.draw(d.ui);
  }
}

function drawHitboxes(ctx: CanvasRenderingContext2D, actors: Actor[]): void {
  ctx.lineWidth = 1;
  for (const a of actors) {
    const b = a.hurtbox();
    ctx.strokeStyle = a.team === 'player' ? '#3f3' : '#f33';
    ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, b.w, b.h);
  }
}
