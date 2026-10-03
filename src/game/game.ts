import { Display } from '../engine/display';
import { Input, attachKeyboard } from '../engine/input';
import { Assets } from '../engine/assets';
import { Audio } from '../engine/audio';
import { FIXED_DT, MAX_STEPS_PER_FRAME, DEBUG } from '../engine/config';
import { TapRegistry } from './ui/taps';
import { RunState, LEVEL_SEQUENCE } from './run';
import { loadSave, writeSave, type SaveData } from './meta/save';
import { attachTouch } from './ui/touch';
import { LevelScene } from './scenes/levelScene';
import { TitleScene } from './scenes/titleScene';
import { DeathScene } from './scenes/deathScene';
import { VictoryScene } from './scenes/victoryScene';
import { applyRunStart } from './meta/progression';

export interface Scene {
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  /** draw the world buffer (game.display.wctx), call display.present(), then draw UI on display.ui */
  render(): void;
}

/** Top-level owner: devices, assets, save data, the current run and scene. */
export class Game {
  readonly display: Display;
  readonly input = new Input();
  readonly assets = new Assets();
  readonly audio = new Audio();
  readonly taps = new TapRegistry();
  save: SaveData = loadSave();
  run: RunState | null = null;
  scene: Scene | null = null;
  /** seconds since boot (real time) */
  time = 0;
  /** screen fade: 1 = black */
  fade = 1;
  private fadeTarget = 0;
  private fadeSpeed = 3;
  private pendingScene: (() => Scene) | null = null;
  private acc = 0;
  private last = 0;
  /** measured frames per second (debug/tests) */
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.display = new Display(canvas);
    attachKeyboard(this.input);
    attachTouch(this);
    this.audio.setMuted(DEBUG.mute);
  }

  persist(): void {
    writeSave(this.save);
  }

  /** Change scene with a fade through black. */
  goto(make: () => Scene, fast = false): void {
    this.pendingScene = make;
    this.fadeTarget = 1;
    this.fadeSpeed = fast ? 6 : 3;
  }

  private swapScene(next: Scene): void {
    this.scene?.exit?.();
    this.input.reset();
    this.scene = next;
    next.enter?.();
    this.fadeTarget = 0;
  }

  showTitle(): void {
    this.goto(() => new TitleScene(this));
  }

  startRun(seed?: number): void {
    const s = seed ?? DEBUG.seed ?? ((Math.random() * 2 ** 32) >>> 0);
    const run = new RunState(s);
    applyRunStart(run, this.save);
    this.save.runs++;
    this.persist();
    this.run = run;
    if (DEBUG.level) {
      const idx = LEVEL_SEQUENCE.findIndex((l) => l.biome === DEBUG.level || l.kind === DEBUG.level);
      if (idx >= 0) run.levelIndex = idx;
    }
    this.goto(() => new LevelScene(this, run));
  }

  /** Called by LevelScene when the player leaves through the exit. */
  nextLevel(): void {
    const run = this.run!;
    run.levelIndex++;
    if (run.levelIndex >= LEVEL_SEQUENCE.length) {
      this.victory();
      return;
    }
    this.goto(() => new LevelScene(this, run));
  }

  playerDied(): void {
    const run = this.run!;
    this.save.totalKills += run.kills;
    this.persist();
    this.goto(() => new DeathScene(this, run));
  }

  victory(): void {
    const run = this.run!;
    run.bossDefeated = true;
    this.save.wins++;
    this.save.totalKills += run.kills;
    if (this.save.bestTime === null || run.time < this.save.bestTime) this.save.bestTime = run.time;
    this.persist();
    this.goto(() => new VictoryScene(this, run));
  }

  start(): void {
    this.swapScene(new TitleScene(this));
    this.last = performance.now();
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      this.frame(now);
    };
    requestAnimationFrame(frame);
  }

  private frame(now: number): void {
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (elapsed > 0) this.fps += (1 / elapsed - this.fps) * 0.05;
    this.display.resize();
    this.acc += elapsed;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.step(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    this.render();
  }

  /** One fixed simulation step (also used by automated tests). */
  step(dt: number): void {
    this.time += dt;
    if (this.fade !== this.fadeTarget) {
      this.fade = this.fadeTarget > this.fade ? Math.min(1, this.fade + dt * this.fadeSpeed) : Math.max(0, this.fade - dt * this.fadeSpeed);
      if (this.fade >= 1 && this.pendingScene) {
        const make = this.pendingScene;
        this.pendingScene = null;
        this.swapScene(make());
      }
    }
    this.scene?.update(dt);
    this.input.endStep(dt);
  }

  render(): void {
    this.taps.clear();
    this.scene?.render();
    if (this.fade > 0) {
      const c = this.display.ui;
      c.globalAlpha = this.fade;
      c.fillStyle = '#07060b';
      c.fillRect(-10, -10, this.display.W + 20, this.display.H + 20);
      c.globalAlpha = 1;
    }
  }
}
