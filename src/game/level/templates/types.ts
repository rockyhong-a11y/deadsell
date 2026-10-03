import type { BiomeId } from '../../run';

/**
 * Room template format (docs/DESIGN.md §6).
 * A template is `w` x `h` chunks of 32 x 18 tiles; `rows` has h*18 strings of w*32 characters.
 */
export type TemplateTag =
  | 'start' | 'exit'
  | 'combat' | 'corridor' | 'shaft' | 'hall' | 'hub' | 'loop' | 'trap'
  | 'treasure' | 'pedestal' | 'altar' | 'shop' | 'secret'
  | 'deadend' | 'passage' | 'boss';

export interface TemplateDef {
  id: string;
  biome: BiomeId;
  /** size in chunks */
  w: number;
  h: number;
  tags: TemplateTag[];
  /** selection weight for the generator (default 1) */
  weight?: number;
  /** free-size template (passage, boss arena): size comes from `rows`, no door sites */
  free?: boolean;
  rows: string[];
}

export type Side = 'L' | 'R' | 'T' | 'B';

/**
 * A door site: `idx` is the chunk row for L/R sites and the chunk column for T/B sites,
 * relative to the template's top-left chunk.
 */
export interface Site {
  side: Side;
  idx: number;
}

export const siteKey = (s: Site): string => s.side + s.idx;
export const oppositeSide = (s: Side): Side => (s === 'L' ? 'R' : s === 'R' ? 'L' : s === 'T' ? 'B' : 'T');

export interface Marker {
  ch: string;
  tx: number;
  ty: number;
}

export interface ParsedTemplate {
  def: TemplateDef;
  id: string;
  biome: BiomeId;
  /** size in chunks */
  w: number;
  h: number;
  /** size in tiles */
  tw: number;
  th: number;
  /** tile ids (markers are Empty) */
  tiles: Uint8Array;
  /** BG ids per cell */
  bg: Uint8Array;
  markers: Marker[];
  /** open door sites (as authored) */
  sites: Site[];
  tags: TemplateTag[];
  weight: number;
  /** count of every marker character */
  counts: Record<string, number>;
  /** problems found while parsing (size mismatch, unknown chars, malformed doors) */
  problems: string[];
}
