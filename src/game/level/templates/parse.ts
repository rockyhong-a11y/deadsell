import { CHUNK_W, CHUNK_H } from '../../../engine/config';
import { T, BG } from '../../tilemap';
import type { Marker, ParsedTemplate, Side, Site, TemplateDef } from './types';

/** Characters that are tiles (not markers). */
const TILE_CHARS: Record<string, number> = { '#': T.Solid, '=': T.Platform, '^': T.Spikes, x: T.Breakable, '.': T.Empty, ',': T.Empty };
/** Marker characters (replaced by Empty in the tile grid; collected as spawns). */
export const MARKER_CHARS = 'EFTSIMAPXBLD$HNZG';

export function isSolidChar(ch: string): boolean {
  return ch === '#' || ch === 'x';
}

/** Parse the ASCII rows of a template; collects (never throws) problems. */
export function parseTemplate(def: TemplateDef): ParsedTemplate {
  const tw = def.free ? (def.rows[0]?.length ?? 0) : def.w * CHUNK_W;
  const th = def.free ? def.rows.length : def.h * CHUNK_H;
  const problems: string[] = [];
  if (def.rows.length !== th) problems.push(`${def.id}: expected ${th} rows, got ${def.rows.length}`);
  const tiles = new Uint8Array(tw * th);
  const bg = new Uint8Array(tw * th).fill(BG.Wall);
  const markers: Marker[] = [];
  const counts: Record<string, number> = {};
  const raw: string[][] = [];
  for (let y = 0; y < th; y++) {
    const row = def.rows[y] ?? '';
    if (row.length !== tw) problems.push(`${def.id}: row ${y} has ${row.length} chars, expected ${tw}`);
    const cells: string[] = [];
    for (let x = 0; x < tw; x++) {
      const ch = row[x] ?? '#';
      cells.push(ch);
      if (ch in TILE_CHARS) {
        tiles[y * tw + x] = TILE_CHARS[ch];
      } else if (MARKER_CHARS.includes(ch)) {
        markers.push({ ch, tx: x, ty: y });
        counts[ch] = (counts[ch] ?? 0) + 1;
      } else {
        problems.push(`${def.id}: unknown char '${ch}' at ${x},${y}`);
        cells[x] = '#';
        tiles[y * tw + x] = T.Solid;
      }
    }
    raw.push(cells);
  }
  // backgrounds: ',' = sky, '.' = wall; everything else takes the nearest '.'/',' (scan outward)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const ch = raw[y][x];
      if (ch === ',') bg[y * tw + x] = BG.Sky;
      else if (ch === '.' || ch === '#') bg[y * tw + x] = BG.Wall;
      else bg[y * tw + x] = nearestBg(raw, x, y, tw, th, def.biome === 'ramparts' ? BG.Sky : BG.Wall);
    }
  }
  const sites = def.free ? [] : detectSites(tiles, tw, th, def.w, def.h, def.id, problems);
  return {
    def,
    id: def.id,
    biome: def.biome,
    w: def.w,
    h: def.h,
    tw,
    th,
    tiles,
    bg,
    markers,
    sites,
    tags: def.tags,
    weight: def.weight ?? 1,
    counts,
    problems,
  };
}

function nearestBg(raw: string[][], x: number, y: number, tw: number, th: number, dflt: number): number {
  for (let r = 1; r <= 4; r++) {
    for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, -r], [-r, r], [r, r]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
      const c = raw[ny][nx];
      if (c === ',') return BG.Sky;
      if (c === '.') return BG.Wall;
    }
  }
  return dflt;
}

const open = (tiles: Uint8Array, tw: number, x: number, y: number): boolean => {
  const t = tiles[y * tw + x];
  return t !== T.Solid && t !== T.Breakable;
};

/** Rows/cols a site occupies, as [x, y] tile coordinates. */
export function siteCells(side: Side, idx: number, tw: number, th: number): [number, number][] {
  const out: [number, number][] = [];
  if (side === 'L' || side === 'R') {
    for (let y = idx * CHUNK_H + 12; y <= idx * CHUNK_H + 15; y++) {
      if (side === 'L') out.push([0, y], [1, y]);
      else out.push([tw - 1, y], [tw - 2, y]);
    }
  } else {
    for (let x = idx * CHUNK_W + 14; x <= idx * CHUNK_W + 17; x++) {
      if (side === 'T') out.push([x, 0], [x, 1]);
      else out.push([x, th - 1], [x, th - 2]);
    }
  }
  return out;
}

function detectSites(tiles: Uint8Array, tw: number, th: number, w: number, h: number, id: string, problems: string[]): Site[] {
  const sites: Site[] = [];
  const check = (side: Side, idx: number) => {
    const cells = siteCells(side, idx, tw, th);
    // 'open' for a site means the edge-most tiles of every row/column are open
    const edge = cells.filter(([x, y]) => (side === 'L' ? x === 0 : side === 'R' ? x === tw - 1 : side === 'T' ? y === 0 : y === th - 1));
    const nOpen = edge.filter(([x, y]) => open(tiles, tw, x, y)).length;
    if (nOpen === edge.length) {
      const all = cells.every(([x, y]) => open(tiles, tw, x, y));
      if (!all) problems.push(`${id}: site ${side}${idx} open at the edge but not 2 tiles deep`);
      sites.push({ side, idx });
    } else if (nOpen > 0) problems.push(`${id}: site ${side}${idx} is partially open (${nOpen}/${edge.length})`);
  };
  for (let r = 0; r < h; r++) {
    check('L', r);
    check('R', r);
  }
  for (let c = 0; c < w; c++) {
    check('T', c);
    check('B', c);
  }
  return sites;
}

/** Horizontal mirror of a template definition (door sites map L<->R, T/B column index flips). */
export function mirrorDef(def: TemplateDef): TemplateDef {
  return { ...def, id: def.id + '~m', rows: def.rows.map((r) => [...r].reverse().join('')) };
}
