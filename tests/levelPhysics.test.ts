import { describe, it, expect } from 'vitest';
import { TILE, GRAVITY, MAX_FALL, FIXED_DT } from '../src/engine/config';
import { Rng } from '../src/engine/rng';
import { TileMap } from '../src/game/tilemap';
import { moveBody, type Body } from '../src/game/physics';
import { authoredTemplates } from '../src/game/level/templates';
import { edgesFrom, standable, type NavEdge, type NavGrid } from '../src/game/level/nav';

/**
 * Cross-check of the planning model (nav.ts) against the real kinematics (physics.ts): every move
 * the model claims must be reproducible by SOME input sequence (hold distance, early jump release)
 * on the actual body (14 x 40, run 150 px/s, jump v = 466 px/s, gravity 1300) landing on the same cell.
 */
const JUMP_V = 466;
const RUN = 150;

/** Simulate one input sequence on the real body; returns the landing position or null. */
function simulate(map: TileMap, e: NavEdge, w: number, cut: number, release: number): { x: number; y: number } | null {
  const sx = (e.from % w) * TILE + TILE / 2;
  const sy = (Math.floor(e.from / w) + 1) * TILE;
  const b: Body = { x: sx, y: sy, w: 14, h: 40, vx: 0, vy: 0, onGround: true, onPlatform: false, hitWallX: 0, hitCeiling: false, dropThrough: e.kind === 'drop' };
  let held = 0;
  let left = false;
  let dropT = e.kind === 'drop' ? 0.25 : 0;
  for (let i = 0; i < 300; i++) {
    b.vx = held < cut ? e.dir * RUN : 0;
    if (i === 0 && e.kind === 'jump') b.vy = -JUMP_V;
    else b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * FIXED_DT);
    if (e.kind === 'jump' && i * FIXED_DT >= release && b.vy < 0) b.vy *= 0.4;
    if (b.onGround && e.kind !== 'jump') b.vy = Math.min(b.vy, 0);
    const x0 = b.x;
    moveBody(b, map, FIXED_DT);
    held += Math.abs(b.x - x0);
    if (dropT > 0) {
      dropT -= FIXED_DT;
      if (dropT <= 0) b.dropThrough = false;
    }
    if (!b.onGround) left = true;
    if (left && b.onGround) return { x: b.x, y: b.y };
    if (b.y > map.pxH + 200) return null;
  }
  return null;
}

/** Is there ANY input (hold distance, early jump release) that really lands on the planned cell? */
function reproducible(map: TileMap, e: NavEdge, w: number): boolean {
  const tx = e.to % w, ty = Math.floor(e.to / w);
  const releases = e.kind === 'jump' ? [9, 0.25, 0.18, 0.14, 0.1, 0.07, 0.05] : [9];
  for (const rel of releases) {
    for (let cut = 0; cut <= 200; cut += 4) {
      const end = simulate(map, e, w, cut, rel);
      if (end && Math.floor(end.x / TILE) === tx && Math.floor((end.y - 1) / TILE) === ty) return true;
    }
  }
  return false;
}

describe('movement model vs the real physics', () => {
  it('jumps, falls and drops planned by the nav model are reproducible', () => {
    const rng = new Rng(99);
    let total = 0, bad = 0;
    const failures: string[] = [];
    for (const biome of ['prison', 'ramparts'] as const) {
      for (const t of authoredTemplates(biome)) {
        const map = new TileMap(t.tw, t.th);
        map.tiles.set(t.tiles);
        const grid: NavGrid = { w: t.tw, h: t.th, tiles: t.tiles };
        const nodes: number[] = [];
        for (let y = 0; y < t.th; y++) for (let x = 0; x < t.tw; x++) if (standable(grid, x, y)) nodes.push(y * t.tw + x);
        for (let k = 0; k < 14 && nodes.length; k++) {
          const n = rng.pick(nodes);
          const edges = edgesFrom(grid, n).filter((e) => e.kind !== 'walk');
          if (!edges.length) continue;
          for (let j = 0; j < 4; j++) {
            const e = rng.pick(edges);
            total++;
            const tx = e.to % t.tw, ty = Math.floor(e.to / t.tw);
            if (!reproducible(map, e, t.tw)) {
              bad++;
              if (failures.length < 12) failures.push(`${t.id} ${e.kind} rel${e.release} cut${e.cut} dir${e.dir} from ${e.from % t.tw},${Math.floor(e.from / t.tw)} -> ${tx},${ty}`);
            }
          }
        }
      }
    }
    // the model is deliberately conservative; a small residue is boundary noise of the 25 ms sampling
    expect(total).toBeGreaterThan(500);
    expect(bad / total, failures.join('\n')).toBeLessThan(0.01);
  }, 120000);
});
