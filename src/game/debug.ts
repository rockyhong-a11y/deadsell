import type { Game } from './game';
import type { LevelScene } from './scenes/levelScene';
import { LEVEL_SEQUENCE } from './run';
import type { ItemId } from './items/types';
import { Actor } from './entity';

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
    god(on = true) { (api as any)._god = on; const p = level()?.world.player; if (p) { p.hp = p.maxHp; } },
    teleport(x: number, y: number) { const p = level()?.world.player; if (p) { p.x = x; p.y = y; p.vx = p.vy = 0; } },
    killAll() {
      const w = level()?.world; if (!w) return 0;
      let n = 0;
      for (const e of w.entities) if (e instanceof Actor && e.team === 'enemy' && e.targetable) { e.takeDamage({ amount: 99999, dir: 0, kind: 'melee' }); n++; }
      return n;
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
