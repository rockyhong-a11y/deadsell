import { TILE } from '../engine/config';
import { Camera } from '../engine/camera';
import { Rng } from '../engine/rng';
import type { AABB } from '../engine/math';
import { overlaps } from '../engine/math';
import type { Game } from './game';
import type { RunState } from './run';
import type { LevelData } from './level/types';
import type { TileMap } from './tilemap';
import { T } from './tilemap';
import { Entity, Actor } from './entity';
import { Particles } from './fx/particles';
import { Fx } from './fx/fx';
import { Lighting } from './fx/lighting';
import type { Player } from './player/player';
import type { LevelUI } from './ui/levelUI';

/** Game events other systems can listen to (HUD, audio, stats, scene flow). */
export type GameEvent =
  | { type: 'enemyKilled'; enemy: Actor; elite: boolean }
  | { type: 'playerHurt'; amount: number }
  | { type: 'playerDied' }
  | { type: 'bossStart'; boss: Actor }
  | { type: 'bossDefeated'; boss: Actor }
  | { type: 'levelExit' }
  | { type: 'pickup'; what: 'cells' | 'gold' | 'item' | 'food' | 'scroll' | 'flask'; amount: number }
  | { type: 'roomEntered'; roomId: number }
  | { type: 'tileBroken'; tx: number; ty: number }
  | { type: 'toast'; text: string; color?: string };

/** Something the player can interact with (chests, doors, items, NPCs...). */
export interface Interactable {
  readonly interactable: true;
  x: number;
  y: number;
  /** max distance (px) from the player's centre; default 40 */
  interactRange?: number;
  /** text in the prompt bubble, e.g. "열기", "줍기 · 녹슨 검" */
  promptText(): string;
  /** optional second line (price, stats) */
  promptSub?(): string | null;
  canInteract(): boolean;
  interact(): void;
}

export function isInteractable(e: unknown): e is Interactable & Entity {
  return !!e && (e as Interactable).interactable === true;
}

/** A level in play: tilemap + entities + effects. Owned by LevelScene. */
export class World {
  readonly game: Game;
  readonly run: RunState;
  readonly level: LevelData;
  readonly map: TileMap;
  readonly camera: Camera;
  readonly particles = new Particles();
  readonly fx = new Fx();
  readonly lights = new Lighting();
  readonly rng: Rng;
  entities: Entity[] = [];
  /** subset of entities that are Actors (rebuilt every step) */
  actors: Actor[] = [];
  /** set by LevelScene; the Player entity */
  player!: Player;
  /** set by LevelScene; in-level UI (choices, shop, toasts) */
  ui!: LevelUI;
  time = 0;
  hitstop = 0;
  /** slow-motion factor (boss kill) */
  timeScale = 1;
  private pending: Entity[] = [];
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor(game: Game, run: RunState, level: LevelData) {
    this.game = game;
    this.run = run;
    this.level = level;
    this.map = level.map;
    this.rng = new Rng(level.seed ^ 0x51ed);
    this.camera = new Camera(game.display.W, game.display.H);
    this.camera.setBounds(this.map.pxW, this.map.pxH);
  }

  get assets() {
    return this.game.assets;
  }
  get audio() {
    return this.game.audio;
  }
  get input() {
    return this.game.input;
  }

  spawn<E extends Entity>(e: E): E {
    e.world = this;
    this.pending.push(e);
    return e;
  }

  private flushPending(): void {
    if (!this.pending.length) return;
    const add = this.pending;
    this.pending = [];
    for (const e of add) {
      this.entities.push(e);
      e.init();
    }
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(e: GameEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  /** Freeze the action briefly for impact (seconds; keeps the max). */
  addHitstop(secs: number): void {
    this.hitstop = Math.max(this.hitstop, secs);
  }

  shake(mag: number, dur = 0.2): void {
    this.camera.shake(mag, dur);
  }

  update(dt: number): void {
    this.flushPending();
    this.fx.update(dt);
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.camera.follow(this.player.x, this.player.y, this.player.facing, this.player.vy, 0);
      return;
    }
    dt *= this.timeScale;
    this.time += dt;
    this.actors = this.entities.filter((e): e is Actor => e instanceof Actor);
    const cam = this.camera;
    const margin = 260;
    for (const e of this.entities) {
      if (e.dead) continue;
      if (!e.alwaysActive && (e.x < cam.x - margin || e.x > cam.x + cam.w + margin || e.y < cam.y - margin || e.y > cam.y + cam.h + margin * 1.5)) continue;
      e.update(dt);
    }
    this.flushPending();
    if (this.entities.some((e) => e.dead)) {
      for (const e of this.entities) if (e.dead) e.onRemove();
      this.entities = this.entities.filter((e) => !e.dead);
    }
    this.particles.update(dt);
    const p = this.player;
    if (p) {
      cam.follow(p.x, p.y - 20, p.facing, p.vy, dt);
      this.map.reveal(p.x, p.y - 24, 12);
    }
  }

  /** Entities overlapping a box (optionally filtered). */
  query<E extends Entity = Entity>(box: AABB, filter?: (e: Entity) => e is E): E[] {
    const out: E[] = [];
    for (const e of this.entities) {
      if (e.dead) continue;
      if (filter && !filter(e)) continue;
      if (overlaps(box, e.bounds)) out.push(e as E);
    }
    return out;
  }

  /** Nearest interactable within its range of the point (player centre). */
  nearestInteractable(px: number, py: number): (Interactable & Entity) | null {
    let best: (Interactable & Entity) | null = null;
    let bd = Infinity;
    for (const e of this.entities) {
      if (e.dead || !isInteractable(e) || !e.canInteract()) continue;
      const d = Math.hypot(e.x - px, (e.y - 16) - py);
      if (d <= (e.interactRange ?? 40) && d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Break breakable tiles overlapping the box (and their connected group). */
  breakTilesIn(box: AABB): void {
    const x0 = Math.floor(box.x / TILE);
    const x1 = Math.floor((box.x + box.w - 0.001) / TILE);
    const y0 = Math.floor(box.y / TILE);
    const y1 = Math.floor((box.y + box.h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) if (this.map.get(tx, ty) === T.Breakable) this.breakGroup(tx, ty);
  }

  private breakGroup(sx: number, sy: number): void {
    const stack = [[sx, sy]];
    let n = 0;
    while (stack.length && n < 64) {
      const [x, y] = stack.pop()!;
      if (this.map.get(x, y) !== T.Breakable) continue;
      this.map.set(x, y, T.Empty);
      n++;
      this.particles.emit('debris', x * TILE + TILE / 2, y * TILE + TILE / 2, { count: 6 });
      this.emit({ type: 'tileBroken', tx: x, ty: y });
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    if (n) {
      this.shake(4, 0.25);
      this.audio.play('break_wall');
    }
  }
}
