import { describe, it, expect } from 'vitest';
import { TileMap, T } from '../src/game/tilemap';
import { moveBody, type Body } from '../src/game/physics';
import { TILE, GRAVITY, MAX_FALL } from '../src/engine/config';

function body(x: number, y: number): Body {
  return { x, y, w: 14, h: 40, vx: 0, vy: 0, onGround: false, onPlatform: false, hitWallX: 0, hitCeiling: false, dropThrough: false };
}
function floorMap(): TileMap {
  const m = new TileMap(20, 10);
  for (let x = 0; x < 20; x++) m.set(x, 9, T.Solid);
  return m;
}
function sim(b: Body, m: TileMap, steps: number) {
  for (let i = 0; i < steps; i++) {
    b.vy = Math.min(MAX_FALL, b.vy + GRAVITY / 60);
    moveBody(b, m, 1 / 60);
  }
}

describe('moveBody', () => {
  it('lands on solid floor and reports onGround', () => {
    const m = floorMap();
    const b = body(100, 50);
    sim(b, m, 120);
    expect(b.onGround).toBe(true);
    expect(b.y).toBe(9 * TILE);
  });

  it('stays grounded while standing still', () => {
    const m = floorMap();
    const b = body(100, 9 * TILE);
    for (let i = 0; i < 10; i++) { sim(b, m, 1); expect(b.onGround).toBe(true); }
    expect(b.y).toBe(9 * TILE);
  });

  it('is blocked by walls', () => {
    const m = floorMap();
    for (let y = 0; y < 9; y++) m.set(10, y, T.Solid);
    const b = body(100, 9 * TILE);
    b.vx = 300;
    for (let i = 0; i < 120; i++) { b.vx = 300; sim(b, m, 1); }
    expect(b.x + b.w / 2).toBeLessThanOrEqual(10 * TILE);
    expect(b.hitWallX).toBe(1);
  });

  it('one-way platforms: land from above, pass from below, drop through', () => {
    const m = floorMap();
    for (let x = 0; x < 20; x++) m.set(x, 5, T.Platform);
    const above = body(100, 2 * TILE);
    sim(above, m, 60);
    expect(above.y).toBe(5 * TILE);
    expect(above.onPlatform).toBe(true);
    above.dropThrough = true;
    sim(above, m, 60);
    expect(above.y).toBe(9 * TILE);
    const below = body(100, 9 * TILE);
    below.vy = -600;
    for (let i = 0; i < 10; i++) moveBody(below, m, 1 / 60);
    expect(below.y).toBeLessThan(5 * TILE + 1);
  });

  it('does not tunnel through a 1-tile floor at max fall speed', () => {
    const m = new TileMap(10, 40);
    for (let x = 0; x < 10; x++) m.set(x, 30, T.Solid);
    const b = body(100, 0 + 40);
    sim(b, m, 300);
    expect(b.y).toBe(30 * TILE);
  });
});
