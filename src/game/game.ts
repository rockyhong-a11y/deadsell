import { Display } from '../engine/display';
import { Input, attachKeyboard } from '../engine/input';
import { GamepadManager, padShortName, DPAD_BUTTONS, type NavKey } from '../engine/gamepad';
import { Assets } from '../engine/assets';
import { Audio } from '../engine/audio';
import { FIXED_DT, MAX_STEPS_PER_FRAME, DEBUG } from '../engine/config';
import { TapRegistry } from './ui/taps';
import { RunState, LEVEL_SEQUENCE } from './run';
import { loadSave, writeSave, type SaveData } from './meta/save';
import { attachTouch, type TouchController } from './ui/touch';
import { VButtonController, type VLayout } from './ui/vbuttons';
import { COL, SZ, panel, text, textWidth } from './ui/draw';
import { LevelScene } from './scenes/levelScene';
import { TitleScene } from './scenes/titleScene';
import { DeathScene } from './scenes/deathScene';
import { VictoryScene } from './scenes/victoryScene';
import { LoopClearScene } from './scenes/loopClearScene';
import { sewPieces, type LoopInfo } from './meta/body';
import { applyRunStart } from './meta/progression';

export interface Scene {
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  /** Gamepad menu navigation (direction edges, A = confirm, B = cancel, Start = pause, Back = map). */
  nav?(k: NavKey): void;
  /** A menu / modal is up: the pad drives it instead of gameplay (stick and buttons are not sent to Input). */
  captures?(): boolean;
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
  readonly pad = new GamepadManager();
  /** virtual buttons (control mode "buttons"): the layout is rebuilt by the HUD every frame, the controller tracks fingers */
  readonly vb: { layout: VLayout | null; ctl: VButtonController } = { layout: null, ctl: new VButtonController() };
  touch: TouchController;
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
  /** the run whose loop-clear scene has been started (it is started once) */
  private clearingRun: RunState | null = null;
  private acc = 0;
  private last = 0;
  /** measured frames per second (debug/tests) */
  fps = 60;
  /** small global toasts (gamepad connected ...), drawn over every scene */
  private toasts: { text: string; t: number; color: string }[] = [];
  private lastMode = this.save.settings.controlMode;
  private portraitPhone: MediaQueryList | null = typeof matchMedia === 'function' ? matchMedia('(orientation: portrait) and (pointer: coarse)') : null;

  constructor(canvas: HTMLCanvasElement) {
    this.display = new Display(canvas);
    attachKeyboard(this.input);
    this.touch = attachTouch(this);
    this.audio.setMuted(DEBUG.mute);
    this.pad.onConnect = (id) => {
      this.toast(`게임패드 연결됨: ${padShortName(id)}`, COL.green);
      this.input.device = 'gamepad';
    };
    this.pad.onDisconnect = (id) => this.toast(`게임패드 연결 끊김: ${padShortName(id)}`, COL.amber);
    this.settingsChanged(false);
  }

  /**
   * Apply the settings to the running game (graphics, sound, control mode) and save them. Called after every change
   * in the settings screen; also at boot (without saving).
   */
  settingsChanged(save = true): void {
    const s = this.save.settings;
    this.display.applyGfx({ filter: s.filter, resolution: s.resolution, fit: s.fit, quality: s.quality });
    this.audio.sfxVolume = s.sfx;
    this.audio.musicVolume = s.music;
    if (!DEBUG.mute) this.audio.setMuted(s.muted);
    if (s.controlMode !== this.lastMode) {
      this.lastMode = s.controlMode;
      this.touch?.cancelAll();
      this.input.reset();
    }
    if (save) this.persist();
  }

  /** A short message at the top of the screen (any scene). */
  toast(msg: string, color: string = COL.text): void {
    this.toasts.push({ text: msg, t: 2.6, color });
    if (this.toasts.length > 3) this.toasts.shift();
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
    this.vb.layout = null;
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
    this.save.loopRuns++;
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
    // the body was made whole a moment ago (Selma's slow motion): the save is already in the next loop, so this run ends
    // with the loop-clear scene, not the death screen
    if (run.clearedLoop) {
      this.loopClear(run.clearedLoop);
      return;
    }
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
    // the pieces she still carries are sewn into the body on the spot (a body made whole clears the loop)
    const sew = sewPieces(run, this.save);
    this.persist();
    this.goto(() => new VictoryScene(this, run, sew));
  }

  /**
   * The body is whole: the run ends with the loop-clear scene (the next loop has already begun in the save, see
   * `completeLoop`). Selma calls it after she sewed the last piece; the victory scene hands over to it after a won run.
   */
  loopClear(info: LoopInfo): void {
    const run = this.run!;
    if (this.clearingRun === run) return; // already on its way (the pause menu's give-up during the slow motion)
    this.clearingRun = run;
    // a won run was counted by victory() already
    if (!run.bossDefeated) this.save.totalKills += run.kills;
    this.persist();
    this.goto(() => new LoopClearScene(this, run, info));
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
    // phone held upright: the "rotate your device" overlay (index.html) covers the canvas, so freeze the game
    if (this.portraitPhone?.matches) {
      this.acc = 0;
      this.input.reset();
      return;
    }
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
    }
    // also when the screen is already black (a goto right after a scene swap): never leave a scene pending
    if (this.fade >= 1 && this.pendingScene) {
      const make = this.pendingScene;
      this.pendingScene = null;
      this.swapScene(make());
    }
    this.stepPad(dt);
    this.scene?.update(dt);
    this.input.endStep(dt);
    for (const t of this.toasts) t.t -= dt;
    if (this.toasts.length && this.toasts[0].t <= 0) this.toasts = this.toasts.filter((t) => t.t > 0);
  }

  /** Poll the gamepad (whatever the control mode) and feed Input (gameplay) and the scene (menus). */
  private stepPad(dt: number): void {
    const frame = this.pad.update(this.save.settings.gamepadMap, dt);
    if (!frame) return;
    if (frame.active) this.input.device = 'gamepad';
    if (this.pad.capture) {
      // remap screen waiting for a button: the press goes there and nowhere else
      for (const b of frame.raw) {
        if (b >= DPAD_BUTTONS.up && b <= DPAD_BUTTONS.right) continue;
        const cb = this.pad.capture;
        this.pad.capture = null;
        cb?.(b);
        break;
      }
      this.input.setAxis('pad', 0, 0);
      for (const b of frame.release) this.input.release(b);
      return;
    }
    if (this.scene?.captures?.()) {
      // a menu is up: never leak the stick / buttons into the (paused) world; still let go of what was held
      this.input.setAxis('pad', 0, 0);
      for (const b of frame.release) this.input.release(b);
    } else {
      for (const b of frame.release) this.input.release(b);
      for (const b of frame.press) this.input.press(b);
      this.input.setAxis('pad', frame.x, frame.y);
    }
    for (const k of frame.nav) this.scene?.nav?.(k);
  }

  render(): void {
    this.taps.clear();
    this.vb.layout = null;
    this.scene?.render();
    this.drawToasts();
    if (this.fade > 0) {
      const c = this.display.ui;
      c.globalAlpha = this.fade;
      c.fillStyle = '#07060b';
      c.fillRect(-10, -10, this.display.W + 20, this.display.H + 20);
      c.globalAlpha = 1;
    }
  }

  private drawToasts(): void {
    if (!this.toasts.length) return;
    const c = this.display.ui;
    let y = 96;
    for (const t of this.toasts) {
      const a = Math.max(0, Math.min(1, t.t / 0.4));
      const w = textWidth(c, t.text, SZ.s, true) + 24;
      c.globalAlpha = a;
      panel(c, Math.round(this.display.W / 2 - w / 2), y - 12, w, 24, { fill: '#07060b', alpha: 0.82, stroke: t.color, r: 12 });
      text(c, t.text, this.display.W / 2, y + 0.5, { align: 'center', bold: true, color: t.color });
      c.globalAlpha = 1;
      y += 30;
    }
  }
}
