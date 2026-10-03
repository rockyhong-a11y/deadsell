import { Rng } from '../../engine/rng';
import { CHUNK_W, CHUNK_H, TILE } from '../../engine/config';
import { TileMap, T, BG } from '../tilemap';
import type { BiomeId } from '../run';
import { templatePool, siteKey, oppositeSide, type ParsedTemplate, type Site } from './templates';
import { siteCells } from './templates/parse';
import type { LevelData, RoomInfo, Spawn, SpawnType } from './types';

/**
 * Procedural level generator: a macro grid of 32 x 18 chunks filled with hand-made templates.
 *  1. a main path start -> exit of 9..12 chunks (randomised DFS with backtracking, always through
 *     door sites the templates really offer),
 *  2. side branches (shop, secret, altars, pedestals, chest room) hung on free door sites,
 *  3. a few loops (adjacent rooms whose facing door sites are both open get connected),
 *  4. every door site that is not connected is sealed with solid tiles.
 * All templates keep every one of their door sites mutually reachable (tests/level.test.ts), so a
 * level assembled this way is traversable by construction; `verifyLayout` re-checks the graph.
 */

/** failure reasons of rejected attempts (for tuning / tests) */
export const genDiagnostics: Record<string, number> = {};
const fail = (why: string): null => {
  genDiagnostics[why] = (genDiagnostics[why] ?? 0) + 1;
  return null;
};

export const GRID_W = 8;
export const GRID_H = 4;

type Role = 'shop' | 'secret' | 'altar' | 'pedestal' | 'treasure';
const ROLE_TAGS: Role[] = ['shop', 'secret', 'altar', 'pedestal', 'treasure'];

export interface Placement {
  idx: number;
  tpl: ParsedTemplate;
  /** top-left chunk cell */
  gx: number;
  gy: number;
  branch: boolean;
  /** branch depth (0 = main path) */
  depth: number;
  conn: Map<string, { to: Placement; toKey: string }>;
  progress: number;
  /** order along the main path (main only) */
  order: number;
}

export interface GenStats {
  attempts: number;
  mainChunks: number;
  branches: number;
  loops: number;
  relaxed: boolean;
}

interface Pools {
  starts: ParsedTemplate[];
  exits: ParsedTemplate[];
  connectors: ParsedTemplate[];
  roles: Record<Role, ParsedTemplate[]>;
}

const poolCache = new Map<string, Pools>();

function pools(biome: BiomeId): Pools {
  let p = poolCache.get(biome);
  if (p) return p;
  const all = templatePool(biome);
  const hasTag = (t: ParsedTemplate, tag: string) => (t.tags as string[]).includes(tag);
  const special = ['start', 'exit', 'deadend', 'passage', 'boss', ...ROLE_TAGS];
  p = {
    starts: all.filter((t) => hasTag(t, 'start')),
    exits: all.filter((t) => hasTag(t, 'exit')),
    connectors: all.filter((t) => t.sites.length >= 2 && !special.some((s) => hasTag(t, s))),
    roles: {
      shop: all.filter((t) => hasTag(t, 'shop')),
      secret: all.filter((t) => hasTag(t, 'secret')),
      altar: all.filter((t) => hasTag(t, 'altar')),
      pedestal: all.filter((t) => hasTag(t, 'pedestal')),
      treasure: all.filter((t) => hasTag(t, 'treasure')),
    },
  };
  poolCache.set(biome, p);
  return p;
}

const baseId = (t: ParsedTemplate) => t.id.replace('~m', '');

class Layout {
  occ: (Placement | null)[] = new Array(GRID_W * GRID_H).fill(null);
  placements: Placement[] = [];

  at(gx: number, gy: number): Placement | null {
    if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return null;
    return this.occ[gy * GRID_W + gx];
  }
  free(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < GRID_W && gy < GRID_H && !this.occ[gy * GRID_W + gx];
  }
  fits(tpl: ParsedTemplate, gx: number, gy: number): boolean {
    for (let y = 0; y < tpl.h; y++) for (let x = 0; x < tpl.w; x++) if (!this.free(gx + x, gy + y)) return false;
    return true;
  }
  add(tpl: ParsedTemplate, gx: number, gy: number, branch: boolean, depth: number): Placement {
    const p: Placement = { idx: this.placements.length, tpl, gx, gy, branch, depth, conn: new Map(), progress: 0, order: -1 };
    this.placements.push(p);
    for (let y = 0; y < tpl.h; y++) for (let x = 0; x < tpl.w; x++) this.occ[(gy + y) * GRID_W + gx + x] = p;
    return p;
  }
  removeLast(p: Placement): void {
    for (let y = 0; y < p.tpl.h; y++) for (let x = 0; x < p.tpl.w; x++) this.occ[(p.gy + y) * GRID_W + p.gx + x] = null;
    this.placements.pop();
    for (const c of p.conn.values()) c.to.conn.delete(c.toKey);
  }
}

/** The chunk cell just outside a placement's site. */
function targetCell(p: Placement, s: Site): [number, number] {
  switch (s.side) {
    case 'L': return [p.gx - 1, p.gy + s.idx];
    case 'R': return [p.gx + p.tpl.w, p.gy + s.idx];
    case 'T': return [p.gx + s.idx, p.gy - 1];
    default: return [p.gx + s.idx, p.gy + p.tpl.h];
  }
}

/** Origin (top-left chunk) of `tpl` so that its site `s` sits in `cell`. */
function originFor(tpl: ParsedTemplate, s: Site, cell: [number, number]): [number, number] {
  switch (s.side) {
    case 'L': return [cell[0], cell[1] - s.idx];
    case 'R': return [cell[0] - (tpl.w - 1), cell[1] - s.idx];
    case 'T': return [cell[0] - s.idx, cell[1]];
    default: return [cell[0] - s.idx, cell[1] - (tpl.h - 1)];
  }
}

function connect(a: Placement, ka: string, b: Placement, kb: string): void {
  a.conn.set(ka, { to: b, toKey: kb });
  b.conn.set(kb, { to: a, toKey: ka });
}

interface Ctx {
  rng: Rng;
  L: Layout;
  P: Pools;
  usage: Map<string, number>;
  budget: number;
}

/** Weighted random order (Efraimidis-Spirakis). */
function orderBy<T>(rng: Rng, items: T[], w: (t: T) => number): T[] {
  return items
    .map((it) => ({ it, k: -Math.log(Math.max(1e-9, rng.next())) / Math.max(1e-6, w(it)) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it);
}

const SIDE_PREF: Record<string, number> = { R: 3, L: 0.4, T: 1.5, B: 1.5 };

interface Cand {
  tpl: ParsedTemplate;
  site: Site;
  gx: number;
  gy: number;
}

function candidates(ctx: Ctx, from: Placement, s: Site, pool: ParsedTemplate[]): Cand[] {
  const cell = targetCell(from, s);
  if (!ctx.L.free(cell[0], cell[1])) return [];
  const need = oppositeSide(s.side);
  const out: Cand[] = [];
  for (const tpl of pool) {
    for (const site of tpl.sites) {
      if (site.side !== need) continue;
      const [gx, gy] = originFor(tpl, site, cell);
      if (ctx.L.fits(tpl, gx, gy)) out.push({ tpl, site, gx, gy });
    }
  }
  return out;
}

/** hubs (3+ doors) are preferred on the main path: they carry the side branches */
const tplWeight = (ctx: Ctx, t: ParsedTemplate) => (t.weight * (1 + 0.9 * Math.max(0, t.sites.length - 2))) / (1 + 1.3 * (ctx.usage.get(baseId(t)) ?? 0));

function growMain(ctx: Ctx, cur: Placement, inKey: string | null, chunks: number, depth: number): boolean {
  if (ctx.budget-- <= 0) return false;
  const { rng, L, P } = ctx;
  const outs = cur.tpl.sites.filter((s) => siteKey(s) !== inKey && !cur.conn.has(siteKey(s)) && (() => { const c = targetCell(cur, s); return L.free(c[0], c[1]); })());
  const ordered = orderBy(rng, outs, (s) => SIDE_PREF[s.side]);
  for (const s of ordered) {
    // try the exit
    if (chunks >= 8) {
      for (const c of orderBy(rng, candidates(ctx, cur, s, P.exits), (c) => c.tpl.weight)) {
        const total = chunks + c.tpl.w * c.tpl.h;
        if (total < 9 || total > 12) continue;
        const p = L.add(c.tpl, c.gx, c.gy, false, 0);
        connect(cur, siteKey(s), p, siteKey(c.site));
        return true;
      }
    }
    if (chunks >= 11) continue;
    const cs = candidates(ctx, cur, s, P.connectors).filter((c) => chunks + c.tpl.w * c.tpl.h <= 11);
    // limit branching: only a handful of tries per site
    const tries = orderBy(rng, cs, (c) => tplWeight(ctx, c.tpl)).slice(0, 5);
    for (const c of tries) {
      const p = L.add(c.tpl, c.gx, c.gy, false, 0);
      connect(cur, siteKey(s), p, siteKey(c.site));
      const key = baseId(c.tpl);
      ctx.usage.set(key, (ctx.usage.get(key) ?? 0) + 1);
      if (growMain(ctx, p, siteKey(c.site), chunks + c.tpl.w * c.tpl.h, depth + 1)) return true;
      ctx.usage.set(key, (ctx.usage.get(key) ?? 1) - 1);
      L.removeLast(p);
      cur.conn.delete(siteKey(s));
    }
  }
  return false;
}

function freeSites(L: Layout, p: Placement): Site[] {
  return p.tpl.sites.filter((s) => {
    if (p.conn.has(siteKey(s))) return false;
    const c = targetCell(p, s);
    return L.free(c[0], c[1]);
  });
}

interface Plan {
  roles: Role[];
  branchRoots: number;
}

function planRoles(rng: Rng): Plan {
  const roles: Role[] = ['shop', 'secret', 'altar', 'altar', 'pedestal'];
  if (rng.chance(0.35)) roles.push('altar');
  if (rng.chance(0.4)) roles.push('pedestal');
  if (rng.chance(0.6)) roles.push('treasure');
  return { roles: rng.shuffle(roles), branchRoots: rng.int(3, 4) };
}

/** Try to build one complete layout; null when the random choices dead-end. */
function tryLayout(rng: Rng, biome: BiomeId): { L: Layout; stats: Omit<GenStats, 'attempts' | 'relaxed'> } | null {
  const P = pools(biome);
  const L = new Layout();
  const ctx: Ctx = { rng, L, P, usage: new Map(), budget: 3000 };
  // --- start
  const st = rng.pick(P.starts);
  const sg = [rng.int(0, 1), rng.int(0, GRID_H - st.h)] as const;
  if (!L.fits(st, sg[0], sg[1])) return fail('start');
  const start = L.add(st, sg[0], sg[1], false, 0);
  if (!growMain(ctx, start, null, st.w * st.h, 0)) return fail('main');

  // main path order + progress
  const main: Placement[] = [];
  {
    let cur: Placement | null = start;
    let inKey: string | null = null;
    const seen = new Set<number>();
    while (cur && !seen.has(cur.idx)) {
      seen.add(cur.idx);
      main.push(cur);
      let next: Placement | null = null;
      let nk: string | null = null;
      for (const [k, c] of cur.conn) {
        if (k === inKey || seen.has(c.to.idx)) continue;
        next = c.to;
        nk = c.toKey;
      }
      cur = next;
      inKey = nk;
    }
  }
  main.forEach((p, i) => {
    p.order = i;
    p.progress = main.length > 1 ? i / (main.length - 1) : 0;
  });
  const mainChunks = main.reduce((n, p) => n + p.tpl.w * p.tpl.h, 0);

  // --- branches
  const plan = planRoles(rng);
  let roots = 0;
  const mandatory = new Set<Role>(['shop', 'secret', 'altar', 'pedestal']);
  const placedRoles: Role[] = [];
  for (const role of plan.roles) {
    const pool = P.roles[role];
    // all candidate (placement, site, template) combos
    const combos: { from: Placement; s: Site; c: Cand; w: number }[] = [];
    for (const from of L.placements) {
      if (from.tpl.tags.includes('start') && from.depth === 0 && role !== 'treasure') {
        /* allowed, but branches off the start room are unusual: low weight below */
      }
      if (from.depth >= 2) continue;
      const isMain = !from.branch;
      const wBase = isMain ? (roots < plan.branchRoots ? 1 : 0.15) : roots < plan.branchRoots ? 0.15 : 1.2;
      for (const s of freeSites(L, from)) {
        for (const c of candidates(ctx, from, s, pool)) {
          let w = wBase * c.tpl.weight / (1 + (ctx.usage.get(baseId(c.tpl)) ?? 0));
          if (from.tpl.tags.includes('start') || from.tpl.tags.includes('exit')) w *= 0.3;
          combos.push({ from, s, c, w });
        }
      }
    }
    if (!combos.length) {
      if (role === 'shop' || role === 'secret') return fail('role:' + role);
      if (mandatory.has(role) && !placedRoles.includes(role)) return fail('role:' + role);
      continue;
    }
    const pick = orderBy(rng, combos, (x) => x.w)[0];
    const p = L.add(pick.c.tpl, pick.c.gx, pick.c.gy, true, pick.from.depth + (pick.from.branch ? 1 : 1));
    p.progress = pick.from.progress;
    connect(pick.from, siteKey(pick.s), p, siteKey(pick.c.site));
    if (!pick.from.branch) roots++;
    ctx.usage.set(baseId(pick.c.tpl), (ctx.usage.get(baseId(pick.c.tpl)) ?? 0) + 1);
    placedRoles.push(role);
  }
  // mandatory counts (altars >= 2, pedestal >= 1 are planned; make sure they were all placed)
  const need = (r: Role) => plan.roles.filter((x) => x === r).length;
  for (const r of ['altar', 'pedestal'] as Role[]) {
    const have = placedRoles.filter((x) => x === r).length;
    if (have < Math.min(need(r), r === 'altar' ? 2 : 1)) return fail('count:' + r);
  }

  // --- loops: connect adjacent connector rooms whose facing sites are both open
  let loops = 0;
  const loopCandidates: [Placement, Site, Placement, Site][] = [];
  for (const a of L.placements) {
    if (!isLoopable(a)) continue;
    for (const s of a.tpl.sites) {
      if (a.conn.has(siteKey(s))) continue;
      const c = targetCell(a, s);
      const b = L.at(c[0], c[1]);
      if (!b || b === a || !isLoopable(b)) continue;
      const need = oppositeSide(s.side);
      // matching site of b at the same boundary
      const bs = b.tpl.sites.find((x) => {
        if (x.side !== need || b.conn.has(siteKey(x))) return false;
        const bc = targetCell(b, x);
        return a.gx <= bc[0] && bc[0] < a.gx + a.tpl.w && a.gy <= bc[1] && bc[1] < a.gy + a.tpl.h && L.at(bc[0], bc[1]) === a && siteKey(s) === siteKeyAt(a, bc, s.side);
      });
      if (bs) loopCandidates.push([a, s, b, bs]);
    }
  }
  for (const [a, s, b, bs] of rng.shuffle(loopCandidates)) {
    if (loops >= 2) break;
    if (a.conn.has(siteKey(s)) || b.conn.has(siteKey(bs))) continue;
    if (rng.chance(0.7)) {
      connect(a, siteKey(s), b, siteKey(bs));
      loops++;
    }
  }
  return { L, stats: { mainChunks, branches: roots, loops } };
}

const isLoopable = (p: Placement) => !p.tpl.tags.some((t) => ['start', 'exit', 'shop', 'secret', 'altar', 'pedestal', 'treasure'].includes(t)) || false;

/** key of a's site on `side` that borders the chunk cell `bc` (b's neighbouring cell inside a). */
function siteKeyAt(a: Placement, bc: [number, number], side: string): string {
  if (side === 'L' || side === 'R') return side + (bc[1] - a.gy);
  return side + (bc[0] - a.gx);
}

/** Graph check: start -> exit reachable and every placement connected. */
export function verifyLayout(L: Layout): boolean {
  const start = L.placements.find((p) => p.tpl.tags.includes('start'));
  const exit = L.placements.find((p) => p.tpl.tags.includes('exit'));
  if (!start || !exit) return false;
  const seen = new Set<number>([start.idx]);
  const q = [start];
  for (let i = 0; i < q.length; i++) for (const c of q[i].conn.values()) if (!seen.has(c.to.idx)) { seen.add(c.to.idx); q.push(c.to); }
  return seen.has(exit.idx) && seen.size === L.placements.length;
}

export const MARKER_SPAWN: Record<string, SpawnType> = {
  E: 'enemy', F: 'flyer', T: 'chest', S: 'altar', I: 'pedestal', M: 'merchant', A: 'alchemist', X: 'exit', B: 'boss',
  L: 'torch', D: 'deco', $: 'shop', H: 'fountain',
};

/** Assemble the tile map + spawn list of a layout. */
function assemble(L: Layout, biome: BiomeId, seed: number, rng: Rng): LevelData {
  let minX = 99, minY = 99, maxX = -1, maxY = -1;
  for (const p of L.placements) {
    minX = Math.min(minX, p.gx);
    minY = Math.min(minY, p.gy);
    maxX = Math.max(maxX, p.gx + p.tpl.w - 1);
    maxY = Math.max(maxY, p.gy + p.tpl.h - 1);
  }
  const W = (maxX - minX + 1) * CHUNK_W, H = (maxY - minY + 1) * CHUNK_H;
  const map = new TileMap(W, H);
  map.tiles.fill(T.Solid);
  map.bg.fill(BG.Wall);
  const spawns: Spawn[] = [];
  const rooms: RoomInfo[] = [];
  let playerStart = { x: 0, y: 0 };
  for (const p of L.placements) {
    const ox = (p.gx - minX) * CHUNK_W, oy = (p.gy - minY) * CHUNK_H;
    const t = p.tpl;
    for (let y = 0; y < t.th; y++) {
      for (let x = 0; x < t.tw; x++) {
        map.tiles[(oy + y) * W + ox + x] = t.tiles[y * t.tw + x];
        map.bg[(oy + y) * W + ox + x] = t.bg[y * t.tw + x];
      }
    }
    // seal the sites that are not connected
    for (const s of t.sites) {
      if (p.conn.has(siteKey(s))) continue;
      for (const [x, y] of siteCells(s.side, s.idx, t.tw, t.th)) map.tiles[(oy + y) * W + ox + x] = T.Solid;
    }
    const tags: string[] = [...t.tags, p.branch ? 'branch' : 'main'];
    rooms.push({ id: p.idx, templateId: t.id, x: ox, y: oy, w: t.tw, h: t.th, tags, progress: p.progress });
    const isStart = t.tags.includes('start');
    for (const m of t.markers) {
      const tx = ox + m.tx, ty = oy + m.ty;
      const wx = tx * TILE + TILE / 2, wy = (ty + 1) * TILE;
      if (m.ch === 'P') {
        playerStart = { x: wx, y: wy };
        continue;
      }
      const type = MARKER_SPAWN[m.ch];
      if (!type) continue;
      // thin out ordinary monsters a little so the same template does not always play identically
      if ((type === 'enemy' && !rng.chance(0.88)) || (type === 'flyer' && !rng.chance(0.8))) continue;
      if ((type === 'enemy' || type === 'flyer') && isStart) continue;
      spawns.push({ type, x: wx, y: wy, tx, ty, roomId: p.idx });
    }
  }
  return { kind: 'biome', biome, seed, map, spawns, rooms, playerStart };
}

export interface Generated {
  level: LevelData;
  layout: Layout;
  stats: GenStats;
}

/** Generate a biome level; deterministic for (biome, seed). */
export function generateBiome(biome: BiomeId, seed: number): Generated {
  const base = new Rng((seed ^ (biome === 'prison' ? 0x1badf00d : 0x0badcafe)) >>> 0);
  let best: { L: Layout; stats: Omit<GenStats, 'attempts' | 'relaxed'> } | null = null;
  for (let attempt = 1; attempt <= 400; attempt++) {
    const r = base.fork(attempt);
    const res = tryLayout(r, biome);
    if (res && verifyLayout(res.L)) {
      best = res;
      return { level: assemble(res.L, biome, seed, base.fork(9000 + attempt)), layout: res.L, stats: { ...res.stats, attempts: attempt, relaxed: false } };
    }
  }
  // Fallback (should never happen): a straight chain start -> connectors -> exit, no side rooms.
  best = fallbackLayout(base, biome);
  return { level: assemble(best.L, biome, seed, base.fork(7)), layout: best.L, stats: { ...best.stats, attempts: 401, relaxed: true } };
}

function fallbackLayout(rng: Rng, biome: BiomeId): { L: Layout; stats: Omit<GenStats, 'attempts' | 'relaxed'> } {
  const P = pools(biome);
  const flat = P.connectors.filter((t) => t.h === 1 && t.sites.some((s) => s.side === 'L') && t.sites.some((s) => s.side === 'R'));
  const starts = P.starts.filter((t) => t.h === 1 && t.sites.some((s) => s.side === 'R'));
  const exits = P.exits.filter((t) => t.h === 1 && t.sites.some((s) => s.side === 'L'));
  const L = new Layout();
  let x = 0;
  const chain: ParsedTemplate[] = [starts[0]];
  while (chain.reduce((n, t) => n + t.w, 0) < 8) chain.push(rng.pick(flat));
  chain.push(exits[0]);
  let prev: Placement | null = null;
  for (const t of chain) {
    const p = L.add(t, x, 0, false, 0);
    x += t.w;
    if (prev) connect(prev, 'R0', p, 'L0');
    prev = p;
  }
  L.placements.forEach((p, i) => { p.order = i; p.progress = i / (L.placements.length - 1); });
  return { L, stats: { mainChunks: x, branches: 0, loops: 0 } };
}
