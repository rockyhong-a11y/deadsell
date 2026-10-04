import { TILE } from '../engine/config';
import type { Game } from './game';
import type { LevelScene } from './scenes/levelScene';
import { LEVEL_SEQUENCE } from './run';
import type { ItemId } from './items/types';
import { Actor } from './entity';
import { createEnemy } from './enemies/factory';
import { ENEMY_DEFS, type EnemyKind } from './enemies/variants';
import { isMiniBoss } from './miniboss';

/**
 * Debug / test hooks exposed as `window.__ds` (used by e2e tests and manual QA).
 */
export function installDebug(game: Game): void {
  const level = () => (game.scene && 'world' in game.scene ? (game.scene as LevelScene) : null);
  const api = {
    game,
    get world() { return level()?.world ?? null; },
    get player() { return level()?.world.player ?? null; },
    /** run N fixed steps synchronously */
    step(n = 1) { for (let i = 0; i < n; i++) game.step(1 / 60); },
    start(seed = 1) { game.startRun(seed); },
    gotoLevel(kindOrBiome: string) {
      if (!game.run) game.startRun(1);
      const i = LEVEL_SEQUENCE.findIndex((l) => l.kind === kindOrBiome || l.biome === kindOrBiome);
      if (i >= 0 && game.run) { game.run.levelIndex = i - 1; game.nextLevel(); }
    },
    /**
     * Teleport the player into the mid-boss room, to the doorway farthest from the boss, so walking in wakes it.
     * Biome levels with a mid-boss only (prison / ramparts); anywhere else this loads the prison level (async,
     * call again after a few steps) and returns null. Returns the mid-boss entity (or null).
     */
    gotoMiniboss() {
      const w = level()?.world;
      const mb = w?.level.spawns.find((s) => s.type === 'miniboss');
      if (!w || !mb) { api.gotoLevel('prison'); return null; }
      const room = w.level.rooms[mb.roomId];
      const left = mb.x - room.x * TILE > (room.w * TILE) / 2 ? room.x + 6 : room.x + room.w - 6;
      const p = w.player;
      p.x = left * TILE + TILE / 2; p.y = mb.y; p.vx = p.vy = 0;
      w.camera.snap(p.x, p.y - 20);
      return w.entities.find((e) => isMiniBoss(e)) ?? null;
    },
    god(on = true) { (api as any)._god = on; const p = level()?.world.player; if (p) { p.hp = p.maxHp; } },
    teleport(x: number, y: number) { const p = level()?.world.player; if (p) { p.x = x; p.y = y; p.vx = p.vy = 0; } },
    killAll() {
      const w = level()?.world; if (!w) return 0;
      let n = 0;
      for (const e of w.entities) if (e instanceof Actor && e.team === 'enemy' && e.targetable) { e.takeDamage({ amount: 99999, dir: 0, kind: 'melee' }); n++; }
      return n;
    },
    /** Spawn any enemy / variant id (e.g. 'ghoul_plague', 'lancer_dragoon') `dx` px in front of the player. Returns the enemy (null if unknown). */
    spawn(kind: string, dx = 80) {
      const w = level()?.world;
      const def = ENEMY_DEFS[kind as EnemyKind];
      if (!w || !def) return null;
      const p = w.player;
      const e = createEnemy(def.id, p.x + dx, def.flyer ? p.y - 70 : p.y, { tier: game.run?.tier ?? 1, elite: false });
      w.spawn(e);
      return e;
    },
    give(id: ItemId, slot = 0) {
      const run = game.run; if (!run) return;
      const inst = { id, tier: run.tier, affix: null };
      if (['fire_grenade', 'ice_grenade', 'turret', 'wolf_trap'].includes(id)) run.skills[slot] = inst; else run.weapons[slot] = inst;
    },
    info() {
      const w = level()?.world;
      return w ? { level: game.run?.level, entities: w.entities.length, player: { x: w.player.x, y: w.player.y, hp: w.player.hp }, map: { w: w.map.w, h: w.map.h } } : { scene: game.scene?.constructor.name };
    },
  };
  (window as any).__ds = api;
  // god mode: keep topping up HP every frame
  const origStep = game.step.bind(game);
  game.step = (dt: number) => { origStep(dt); if ((api as any)._god) { const p = level()?.world.player; if (p && !p.dying) p.hp = p.maxHp; } };
}
