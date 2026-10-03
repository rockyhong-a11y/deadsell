/**
 * In-page navigation bot for e2e tests. `botWalk` is serialised by Playwright and runs INSIDE the
 * page: it plans a route with the level generator's own movement graph (src/game/level/nav.ts,
 * loaded through the Vite dev server) and drives the REAL player through the real input layer
 * (Input.setAxis / press / release) and the real physics, stepping the game synchronously with
 * `__ds.step`. Because it is serialised, it must be self-contained (no outer references).
 */
export interface BotOpts {
  /** world px (feet) of the thing to walk to */
  target: { x: number; y: number };
  /** stop once the player's centre is this close (px, horizontally) and on the same floor band */
  reach: number;
  /** hard cap of fixed steps */
  maxSteps: number;
}

export interface BotResult {
  ok: boolean;
  reason: string;
  steps: number;
  replans: number;
  edges: number;
  pos: { x: number; y: number };
}

export async function botWalk(opts: BotOpts): Promise<BotResult> {
  const ds = (window as any).__ds;
  const world = ds.world;
  const P = world.player;
  const map = world.map;
  const input = world.input;
  const TS = 24;
  // keep a real dynamic import() (a bundler/transpiler must not rewrite it)
  const nav = await (new Function('u', 'return import(u)') as (u: string) => Promise<any>)('/src/game/level/nav.ts');
  const grid = { w: map.w, h: map.h, tiles: map.tiles };
  const W = map.w;
  let steps = 0, replans = 0, execEdges = 0;

  const step = (n = 1) => {
    ds.step(n);
    steps += n;
  };
  const nodeOf = () => Math.floor((P.y - 1) / TS) * W + Math.floor(P.x / TS);
  const tcy = Math.floor((opts.target.y - 1) / TS);
  const isGoal = (n: number) => {
    const x = n % W, y = (n - x) / W;
    return Math.abs(x * TS + TS / 2 - opts.target.x) <= opts.reach && Math.abs(y - tcy) <= 1;
  };
  const result = (ok: boolean, reason: string): BotResult => {
    input.setAxis('bot', 0, 0);
    input.release('jump');
    return { ok, reason, steps, replans, edges: execEdges, pos: { x: Math.round(P.x), y: Math.round(P.y) } };
  };

  // ---- planning (A* on the nav graph) ------------------------------------------------------
  interface Edge { from: number; to: number; kind: string; release: number; cut: number; dir: number }
  const cost = (e: Edge) => (e.kind === 'walk' ? 0.17 : e.kind === 'jump' ? 0.9 : e.kind === 'drop' ? 0.6 : 0.5);
  const plan = (start: number): Edge[] | null => {
    const g = new Map<number, number>();
    const prev = new Map<number, Edge>();
    const open: [number, number][] = [];
    const h = (n: number) => Math.abs((n % W) * TS + TS / 2 - opts.target.x) / 150;
    g.set(start, 0);
    open.push([h(start), start]);
    const closed = new Set<number>();
    let guard = 0;
    while (open.length && guard++ < 60000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, n] = open.splice(bi, 1)[0];
      if (closed.has(n)) continue;
      closed.add(n);
      if (isGoal(n)) {
        const path: Edge[] = [];
        let c = n;
        while (c !== start) {
          const e = prev.get(c)!;
          path.push(e);
          c = e.from;
        }
        return path.reverse();
      }
      for (const e of nav.edgesFrom(grid, n) as Edge[]) {
        const ng = g.get(n)! + cost(e);
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          prev.set(e.to, e);
          open.push([ng + h(e.to), e.to]);
        }
      }
    }
    return null;
  };

  // ---- execution -------------------------------------------------------------------------------
  const settle = (maxN = 90) => {
    // brake and wait for the feet to be on the ground and at rest
    input.setAxis('bot', 0, 0);
    input.release('jump');
    for (let i = 0; i < maxN; i++) {
      if (P.onGround && Math.abs(P.vx) < 4 && P.mode === 'free') break;
      step();
    }
  };
  const alignTo = (cx: number) => {
    for (let i = 0; i < 260; i++) {
      const dx = cx - P.x;
      if (Math.abs(dx) <= 1.6 && Math.abs(P.vx) < 6) break;
      if (Math.abs(dx) > 14) {
        input.setAxis('bot', Math.sign(dx), 0);
        step();
      } else {
        // single-step nudges keep the speed low
        input.setAxis('bot', Math.abs(P.vx) < 6 && Math.abs(dx) > 1.6 ? Math.sign(dx) : 0, 0);
        step();
        input.setAxis('bot', 0, 0);
        step();
      }
    }
    input.setAxis('bot', 0, 0);
  };

  const execEdge = (e: Edge): void => {
    execEdges++;
    alignTo((e.from % W) * TS + TS / 2);
    const x0 = P.x;
    let left = false;
    if (e.kind === 'jump') input.press('jump');
    else if (e.kind === 'drop') {
      input.press('down');
      input.release('down');
    }
    let t = 0;
    for (let i = 0; i < 150; i++) {
      const travelled = Math.abs(P.x - x0);
      input.setAxis('bot', travelled < e.cut ? e.dir : 0, 0);
      if (e.kind === 'jump' && t >= e.release) input.release('jump');
      step();
      t += 1 / 60;
      if (!P.onGround) left = true;
      if (left && P.onGround) break;
      if (P.mode === 'ledge') {
        // ledge grab (the real player can do more than the model): let the climb finish
        for (let k = 0; k < 60 && P.mode !== 'free'; k++) step();
        break;
      }
    }
    settle();
  };
  const execWalk = (toX: number, dir: number): void => {
    for (let i = 0; i < 400; i++) {
      if ((toX - P.x) * dir <= 2) break;
      input.setAxis('bot', dir, 0);
      step();
    }
    settle();
  };

  // ---- main loop -------------------------------------------------------------------------------
  settle();
  let path = plan(nodeOf());
  replans++;
  if (!path) return result(false, 'no path from ' + nodeOf());
  let idx = 0;
  let fails = 0;
  while (steps < opts.maxSteps) {
    if (isGoal(nodeOf()) && P.onGround) return result(true, 'arrived');
    if (!path || idx >= path.length) {
      path = plan(nodeOf());
      replans++;
      idx = 0;
      if (!path) return result(false, 'replan failed at ' + nodeOf());
      if (!path.length) return result(true, 'arrived');
    }
    const e = path[idx];
    let expectTo = e.to;
    if (e.kind === 'walk') {
      // collapse a run of same-direction walk edges
      let j = idx;
      while (j + 1 < path.length && path[j + 1].kind === 'walk' && path[j + 1].dir === e.dir) j++;
      expectTo = path[j].to;
      execWalk((expectTo % W) * TS + TS / 2, e.dir);
      idx = j + 1;
    } else {
      execEdge(e);
      idx++;
    }
    const now = nodeOf();
    if (now !== expectTo) {
      // the actual node may lie further along the path; otherwise replan
      const k = path.findIndex((pe, i) => i >= idx - 1 && pe.to === now);
      if (k >= 0) idx = k + 1;
      else {
        fails++;
        if (fails > 60) return result(false, 'too many deviations, at ' + now);
        path = null;
      }
    }
    if (P.dying || P.dead) return result(false, 'player died');
  }
  return result(false, 'step budget exhausted');
}
