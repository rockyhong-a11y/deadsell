import { CHUNK_W, CHUNK_H } from '../../engine/config';
import { T } from '../tilemap';
import type { ParsedTemplate, Side } from './templates/types';
import { siteKey } from './templates/types';

/**
 * Movement graph on the tile grid, conservative with respect to the player's abilities
 * (run 150 px/s, single jump apex 80 px = 3 tiles, gravity 1300, one-way platforms passable from
 * below, drop-through on platforms, no double jump / ledge grab). Used by the template tests and
 * by the level tests to prove that every room and every level is traversable.
 *
 * Nodes are "standing cells": (x, y) is the cell the feet are in; the cell below is solid or a
 * one-way platform. Edges: walking to a neighbouring standing cell, and sampled ballistic arcs
 * (jump with several apex heights, horizontal cut-offs, walking off a ledge, dropping through a
 * platform) that end on the first floor they meet.
 */
export const TS = 24;
const BW = 16; // hull used for planning (a little larger than the real 14 x 40)
const BH = 44;
const DT = 0.025;
const SPEED = 150;
const GRAV = 1300;
const MAXFALL = 540;
const RUN = 21; // px to walk off a ledge before gravity takes over
const EPS = 0.001;
const NSAMPLES = 110;

export interface NavGrid {
  w: number;
  h: number;
  tiles: Uint8Array;
  /** treat breakable walls as open (secret rooms) */
  openBreakables?: boolean;
}

/** Per-cell classes: 0 free, 1 solid, 2 one-way platform, 3 spikes (cached per grid). */
interface NavCtx {
  w: number;
  h: number;
  cls: Uint8Array;
}

const ctxCache = new WeakMap<NavGrid, { ctx: NavCtx; open: boolean | undefined; len: number }>();

function getCtx(g: NavGrid): NavCtx {
  const hit = ctxCache.get(g);
  if (hit && hit.open === g.openBreakables && hit.len === g.tiles.length) return hit.ctx;
  const cls = new Uint8Array(g.w * g.h);
  for (let i = 0; i < cls.length; i++) {
    const t = g.tiles[i];
    cls[i] = t === T.Solid ? 1 : t === T.Breakable ? (g.openBreakables ? 0 : 1) : t === T.Platform ? 2 : t === T.Spikes ? 3 : 0;
  }
  const ctx = { w: g.w, h: g.h, cls };
  ctxCache.set(g, { ctx, open: g.openBreakables, len: g.tiles.length });
  return ctx;
}

const clsAt = (c: NavCtx, x: number, y: number): number => (x < 0 || y < 0 || x >= c.w || y >= c.h ? 1 : c.cls[y * c.w + x]);

/** 0 = free, 1 = blocked by a solid tile, 2 = overlaps spikes. Box: centre x, feet y (px). */
function boxState(c: NavCtx, cx: number, fy: number): number {
  const x0 = Math.floor((cx - BW / 2 + EPS) / TS), x1 = Math.floor((cx + BW / 2 - EPS) / TS);
  const y0 = Math.floor((fy - BH + EPS) / TS), y1 = Math.floor((fy - EPS) / TS);
  let r = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const t = clsAt(c, x, y);
      if (t === 1) return 1;
      if (t === 3 && fy > (y + 1) * TS - 10 && fy - BH < (y + 1) * TS) r = 2;
    }
  return r;
}

/** 1 = solid floor, 2 = one-way platform, 0 = nothing to stand on */
const supportKind = (c: NavCtx, x: number, y: number): number => {
  const t = clsAt(c, x, y);
  return t === 1 ? 1 : t === 2 ? 2 : 0;
};

function standableC(c: NavCtx, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
  if (!supportKind(c, x, y + 1)) return false;
  return boxState(c, x * TS + TS / 2, (y + 1) * TS) === 0;
}

/** Is (x, y) a cell the player can stand in? */
export function standable(g: NavGrid, x: number, y: number): boolean {
  return standableC(getCtx(g), x, y);
}

interface Arc {
  kind: 'jump' | 'fall' | 'drop';
  /** horizontal distance (px) the player keeps pressing the direction for */
  cut: number;
  /** takeoff speed (px/s, jumps only) */
  vy0: number;
  /** vertical offsets by vertical step (px, positive = down) */
  oy: Float32Array;
}

function makeOy(vy0: number): Float32Array {
  const oy = new Float32Array(NSAMPLES);
  let y = 0, vy = -vy0;
  for (let i = 0; i < NSAMPLES; i++) {
    vy = Math.min(MAXFALL, vy + GRAV * DT);
    y += vy * DT;
    oy[i] = y;
  }
  return oy;
}

const FALL_OY = makeOy(0);
const ARCS: Arc[] = [];
for (const v of [456, 380, 290]) {
  const oy = makeOy(v);
  ARCS.push({ kind: 'jump', cut: 0, oy, vy0: v });
  for (const c of [24, 48, 72, 96, 120, 1e9]) ARCS.push({ kind: 'jump', cut: c, oy, vy0: v });
}
for (const c of [24, 36, 48, 72, 96, 1e9]) ARCS.push({ kind: 'fall', cut: c, oy: FALL_OY, vy0: 0 });
for (const c of [0, 24, 48, 72, 1e9]) ARCS.push({ kind: 'drop', cut: c, oy: FALL_OY, vy0: 0 });

/**
 * Run an arc from a standing cell. `dir` = +1/-1. The player holds the direction until `cut` px
 * were covered (walls stop it, like in the real physics) while the vertical motion follows the
 * jump / fall profile. Returns the landing node index or -1.
 */
function runArc(g: NavCtx, arc: Arc, dir: number, sx: number, sy: number): number {
  let px = sx, py = sy, moved = 0, vi = 0;
  const dropRow = arc.kind === 'drop' ? Math.round(sy / TS) : -1; // platform row we stand on
  const step = SPEED * DT;
  for (let i = 0; i < NSAMPLES; i++) {
    if (moved < arc.cut) {
      const mv = Math.min(step, arc.cut - moved);
      const nx = px + dir * mv;
      const st = boxState(g, nx, py);
      if (st === 2) return -1;
      if (st === 0) {
        px = nx;
        moved += mv;
      }
    }
    if (arc.kind === 'fall' && moved < RUN) continue; // still walking off the ledge
    const ny = sy + arc.oy[vi++];
    if (ny === py) continue;
    if (ny > py) {
      const r1 = Math.floor((ny - EPS) / TS);
      const cl = Math.floor((px - BW / 2 + EPS) / TS), cr = Math.floor((px + BW / 2 - EPS) / TS);
      const cc = Math.floor(px / TS);
      for (let ry = Math.max(0, Math.floor(py / TS)); ry <= r1; ry++) {
        const top = ry * TS;
        if (py > top + EPS) continue;
        const ok = (cx: number): boolean => {
          const sk = supportKind(g, cx, ry);
          return sk === 1 || (sk === 2 && !(dropRow >= 0 && ry <= dropRow));
        };
        let col = -1;
        if (ok(cc)) col = cc;
        else if (ok(cl)) col = cl;
        else if (ok(cr)) col = cr;
        if (col < 0) continue;
        if (!standableC(g, col, ry - 1)) return -1;
        return (ry - 1) * g.w + col;
      }
      if (boxState(g, px, ny) !== 0) return -1;
    } else if (boxState(g, px, ny) !== 0) return -1;
    py = ny;
  }
  return -1;
}

export interface ReachResult {
  visited: Uint8Array;
  /** forward edges as flat [from, to] pairs, when requested */
  edges?: number[];
}

/** All standing nodes reachable from `starts`. */
export function reach(grid: NavGrid, starts: number[], recordEdges = false, stopAt = -1): ReachResult {
  const g = getCtx(grid);
  const visited = new Uint8Array(g.w * g.h);
  const queue: number[] = [];
  const edges: number[] | undefined = recordEdges ? [] : undefined;
  for (const s of starts) {
    if (!visited[s]) {
      visited[s] = 1;
      queue.push(s);
    }
  }
  const push = (from: number, to: number) => {
    if (edges) edges.push(from, to);
    if (!visited[to]) {
      visited[to] = 1;
      queue.push(to);
    }
  };
  for (let qi = 0; qi < queue.length; qi++) {
    if (stopAt >= 0 && visited[stopAt]) break;
    const n = queue[qi];
    const x = n % g.w, y = (n - x) / g.w;
    const sx = x * TS + TS / 2, sy = (y + 1) * TS;
    const onPlat = supportKind(g, x, y + 1) === 2;
    const wl = standableC(g, x - 1, y), wr = standableC(g, x + 1, y);
    if (wl) push(n, n - 1);
    if (wr) push(n, n + 1);
    for (let ai = 0; ai < ARCS.length; ai++) {
      const arc = ARCS[ai];
      if (arc.kind === 'drop' && !onPlat) continue;
      for (let di = arc.cut === 0 ? 1 : 0; di < 2; di++) {
        const d = di === 0 ? -1 : 1;
        if (arc.kind === 'fall' && (d < 0 ? wl : wr)) continue; // walking covers it
        const to = runArc(g, arc, d, sx, sy);
        if (to >= 0 && to !== n) push(n, to);
      }
    }
  }
  return { visited, edges };
}

// ---------------------------------------------------------------------------
// Template analysis (door sites are probed with mock neighbours)
// ---------------------------------------------------------------------------

/** One-way platform stack every template with a top door must be able to climb (rows, [x0, x1] in chunk cols). */
export const STANDARD_STACK: [number, number, number][] = [
  [13, 8, 15], [10, 13, 20], [7, 8, 15], [4, 13, 20], [2, 12, 17], [0, 14, 16],
];

export interface TemplateAnalysis {
  problems: string[];
  /** which site keys can reach which (forward) */
  connected: Record<string, Record<string, boolean>>;
  nodeCount: number;
}

const MX = 20;
const MY = 20;

/** Build the template grid with mock neighbours attached to every open site. */
function extendTemplate(t: ParsedTemplate, openBreakables: boolean): { g: NavGrid; siteNodes: Record<string, number>; ox: number; oy: number } {
  const w = t.tw + MX * 2, h = t.th + MY * 2;
  const tiles = new Uint8Array(w * h).fill(T.Solid);
  for (let y = 0; y < t.th; y++) for (let x = 0; x < t.tw; x++) tiles[(y + MY) * w + x + MX] = t.tiles[y * t.tw + x];
  const carve = (x0: number, y0: number, x1: number, y1: number, v: number = T.Empty) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * w + x] = v;
  };
  const siteNodes: Record<string, number> = {};
  for (const s of t.sites) {
    const k = siteKey(s);
    if (s.side === 'L') {
      const r = MY + s.idx * CHUNK_H;
      carve(0, r + 1, MX - 3, r + 15);
      carve(MX - 2, r + 12, MX - 1, r + 15);
      siteNodes[k] = (r + 15) * w + 4;
    } else if (s.side === 'R') {
      const r = MY + s.idx * CHUNK_H;
      carve(MX + t.tw + 2, r + 1, w - 1, r + 15);
      carve(MX + t.tw, r + 12, MX + t.tw + 1, r + 15);
      siteNodes[k] = (r + 15) * w + (w - 5);
    } else if (s.side === 'T') {
      const c = MX + s.idx * CHUNK_W;
      carve(c + 2, MY - 17, c + 29, MY - 3);
      carve(c + 14, MY - 2, c + 17, MY - 1);
      siteNodes[k] = (MY - 3) * w + c + 6;
    } else {
      const c = MX + s.idx * CHUNK_W;
      const top = MY + t.th;
      carve(c + 2, top + 1, c + 29, top + 15);
      carve(c + 14, top, c + 17, top + 1);
      for (const [row, x0, x1] of STANDARD_STACK) carve(c + x0, top + row, c + x1, top + row, T.Platform);
      siteNodes[k] = (top + 15) * w + c + 6;
    }
  }
  return { g: { w, h, tiles, openBreakables }, siteNodes, ox: MX, oy: MY };
}

/**
 * Check a parsed template: door geometry, internal connectivity between all door sites (both
 * directions), no traps (every reachable cell can get back to a door site), and that every
 * interactable marker sits on reachable standing ground.
 */
export function analyzeTemplate(t: ParsedTemplate): TemplateAnalysis {
  const problems: string[] = [...t.problems];
  const id = t.id;
  // door geometry
  const solid = (x: number, y: number) => t.tiles[y * t.tw + x] === T.Solid || t.tiles[y * t.tw + x] === T.Breakable;
  const clear = (x: number, y: number) => {
    const v = t.tiles[y * t.tw + x];
    return v === T.Empty || v === T.Platform;
  };
  for (const s of t.sites) {
    const k = siteKey(s);
    if (s.side === 'L' || s.side === 'R') {
      const y16 = s.idx * CHUNK_H + 16;
      const xs = s.side === 'L' ? [0, 1, 2, 3] : [t.tw - 1, t.tw - 2, t.tw - 3, t.tw - 4];
      for (const x of xs) {
        if (!solid(x, y16)) problems.push(`${id}: site ${k} floor (row 16) not solid at x=${x}`);
        for (const y of [y16 - 1, y16 - 2]) if (!clear(x, y)) problems.push(`${id}: site ${k} landing zone blocked at ${x},${y}`);
      }
    } else {
      const base = s.idx * CHUNK_W;
      if (s.side === 'B') {
        for (let x = base + 11; x <= base + 20; x++) {
          for (const y of [t.th - 3, t.th - 4, t.th - 5, t.th - 6])
            if (!clear(x, y)) problems.push(`${id}: site ${k} landing zone blocked at ${x},${y}`);
        }
      }
    }
  }
  const connected: Record<string, Record<string, boolean>> = {};
  let nodeCount = 0;
  const modes = t.tiles.includes(T.Breakable) ? [false, true] : [false];
  for (const openB of modes) {
    const { g, siteNodes, ox, oy } = extendTemplate(t, openB);
    const keys = Object.keys(siteNodes);
    for (const k of keys) {
      const n = siteNodes[k];
      if (!standable(g, n % g.w, Math.floor(n / g.w))) problems.push(`${id}: mock node for site ${k} not standable (internal error)`);
    }
    const startNodes = [...keys.map((k) => siteNodes[k])];
    for (const m of t.markers) {
      if (m.ch === 'P') startNodes.push((m.ty + oy) * g.w + m.tx + ox);
    }
    // reachability from every site
    const fwd: Record<string, Uint8Array> = {};
    const allEdges: number[] = [];
    for (const k of keys) {
      const r = reach(g, [siteNodes[k]], true);
      fwd[k] = r.visited;
      for (const e of r.edges!) allEdges.push(e);
    }
    if (!openB) {
      for (const a of keys) {
        connected[a] = {};
        for (const b of keys) {
          const ok = !!fwd[a][siteNodes[b]];
          connected[a][b] = ok;
          if (!ok) problems.push(`${id}: no route from site ${a} to site ${b}`);
        }
      }
    }
    // union of reachable nodes (from any site / start marker)
    const union = new Uint8Array(g.w * g.h);
    for (const k of keys) for (let i = 0; i < union.length; i++) if (fwd[k][i]) union[i] = 1;
    for (const sn of startNodes) {
      if (!union[sn]) {
        const r = reach(g, [sn], true);
        for (let i = 0; i < union.length; i++) if (r.visited[i]) union[i] = 1;
        for (const e of r.edges!) allEdges.push(e);
      }
    }
    // inside-template reachable cells
    const inside = (n: number) => {
      const x = n % g.w, y = (n - x) / g.w;
      return x >= ox && x < ox + t.tw && y >= oy && y < oy + t.th;
    };
    // reverse reachability to the site nodes (no traps)
    if (keys.length) {
      const rev = new Map<number, number[]>();
      for (let i = 0; i < allEdges.length; i += 2) {
        const arr = rev.get(allEdges[i + 1]);
        if (arr) arr.push(allEdges[i]);
        else rev.set(allEdges[i + 1], [allEdges[i]]);
      }
      const back = new Uint8Array(g.w * g.h);
      const q: number[] = [];
      for (const k of keys) {
        back[siteNodes[k]] = 1;
        q.push(siteNodes[k]);
      }
      for (let qi = 0; qi < q.length; qi++) for (const p of rev.get(q[qi]) ?? []) if (!back[p]) { back[p] = 1; q.push(p); }
      let traps = 0, firstTrap = -1;
      for (let n = 0; n < union.length; n++) {
        if (union[n] && inside(n) && !back[n]) {
          traps++;
          if (firstTrap < 0) firstTrap = n;
        }
        if (union[n] && inside(n)) nodeCount++;
      }
      if (traps) {
        const x = (firstTrap % g.w) - ox, y = Math.floor(firstTrap / g.w) - oy;
        problems.push(`${id}: ${traps} trap cells${openB ? ' (secrets open)' : ''}, e.g. at ${x},${y}`);
      }
    }
    // markers on reachable ground
    const needGround = 'TISMAXP$HB';
    for (const m of t.markers) {
      if (!needGround.includes(m.ch)) continue;
      const n = (m.ty + oy) * g.w + m.tx + ox;
      const hidden = !openB;
      if (!standable(g, m.tx + ox, m.ty + oy)) {
        problems.push(`${id}: marker ${m.ch} at ${m.tx},${m.ty} is not on standable ground`);
        continue;
      }
      if (!union[n] && !(hidden && t.def.tags.includes('secret'))) problems.push(`${id}: marker ${m.ch} at ${m.tx},${m.ty} unreachable${openB ? ' (secrets open)' : ''}`);
    }
    for (const m of t.markers) {
      if (m.ch !== 'E') continue;
      if (!standable(g, m.tx + ox, m.ty + oy)) problems.push(`${id}: enemy marker at ${m.tx},${m.ty} has no floor`);
    }
  }
  // doors of one side must lead somewhere: at least one site unless it is a special room
  if (t.sites.length === 0 && !t.tags.includes('passage') && !t.tags.includes('boss')) problems.push(`${id}: no door sites`);
  return { problems, connected, nodeCount };
}

export function sideOf(k: string): Side {
  return k[0] as Side;
}

/** Debug helper: ASCII picture of the cells reachable from a site ('*') on the template. */
export function dumpReach(t: ParsedTemplate, fromKey: string, openBreakables = false): string {
  const { g, siteNodes, ox, oy } = extendTemplate(t, openBreakables);
  const r = reach(g, [siteNodes[fromKey]]);
  const lines: string[] = [];
  const glyph = [' ', '#', '=', '^', 'x'];
  for (let y = 0; y < g.h; y++) {
    let row = '';
    for (let x = 0; x < g.w; x++) {
      const tt = g.tiles[y * g.w + x];
      row += r.visited[y * g.w + x] ? '*' : tt === 0 ? (x >= ox && x < ox + t.tw && y >= oy && y < oy + t.th ? '.' : ' ') : glyph[tt];
    }
    lines.push(String(y - oy).padStart(3) + ' ' + row);
  }
  return lines.join('\n');
}


/** One planned move (used to cross-check the model against the real physics in tests). */
export interface NavEdge {
  from: number;
  to: number;
  kind: 'walk' | 'jump' | 'fall' | 'drop';
  /** takeoff speed for jumps (px/s), 0 otherwise */
  vy0: number;
  /** px of horizontal travel the player holds the direction for */
  cut: number;
  dir: number;
}

/** Every move the model allows from one standing node. */
export function edgesFrom(grid: NavGrid, node: number): NavEdge[] {
  const g = getCtx(grid);
  const x = node % g.w, y = (node - x) / g.w;
  const sx = x * TS + TS / 2, sy = (y + 1) * TS;
  const out: NavEdge[] = [];
  const onPlat = supportKind(g, x, y + 1) === 2;
  for (const d of [-1, 1]) if (standableC(g, x + d, y)) out.push({ from: node, to: node + d, kind: 'walk', vy0: 0, cut: TS, dir: d });
  for (const arc of ARCS) {
    if (arc.kind === 'drop' && !onPlat) continue;
    for (const d of arc.cut === 0 ? [1] : [-1, 1]) {
      if (arc.kind === 'fall' && standableC(g, x + d, y)) continue;
      const to = runArc(g, arc, d, sx, sy);
      if (to >= 0 && to !== node) out.push({ from: node, to, kind: arc.kind, vy0: arc.vy0, cut: arc.cut, dir: d });
    }
  }
  return out;
}
