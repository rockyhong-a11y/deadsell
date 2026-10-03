import { describe, it, expect } from 'vitest';
import { makeTestWorld, steps } from './helpers';
import { Player } from '../src/game/player/player';
import { createEnemy } from '../src/game/enemies/factory';
import { hitArea } from '../src/game/combat';

describe('World + combat core', () => {
  it('spawns a player that lands on the floor', () => {
    const { world } = makeTestWorld();
    const p = new Player(120, 100);
    world.player = p;
    world.spawn(p);
    steps(world, 90);
    expect(p.onGround).toBe(true);
    expect(p.y).toBe(16 * 24);
  });

  it('hitArea damages opposing actors once per hit set', () => {
    const { world } = makeTestWorld();
    const p = new Player(120, 16 * 24);
    world.player = p;
    world.spawn(p);
    const e = createEnemy('ghoul', 160, 16 * 24, { tier: 1, elite: false });
    world.spawn(e);
    steps(world, 2);
    const before = e.hp;
    const set = new Set<number>();
    hitArea(world, { x: 140, y: 16 * 24 - 40, w: 40, h: 40 }, 'player', { amount: 10, dir: 1, kind: 'melee' }, set);
    hitArea(world, { x: 140, y: 16 * 24 - 40, w: 40, h: 40 }, 'player', { amount: 10, dir: 1, kind: 'melee' }, set);
    expect(e.hp).toBe(before - 10);
    // own team is never hit
    const php = p.hp;
    hitArea(world, p.bounds, 'player', { amount: 10, dir: 1, kind: 'melee' });
    expect(p.hp).toBe(php);
  });
});
