import type { TileMap } from '../tilemap';
import type { BiomeId } from '../run';

/** Everything the generator produces for one playable level. */
export interface LevelData {
  kind: 'biome' | 'passage' | 'boss';
  biome: BiomeId;
  seed: number;
  map: TileMap;
  /** entity spawn points, world pixels, (x, y) = bottom-centre of the tile the marker was in */
  spawns: Spawn[];
  /** rooms for the minimap / room-entered events (tile rect) */
  rooms: RoomInfo[];
  playerStart: { x: number; y: number };
}

export type SpawnType =
  | 'enemy' | 'flyer' | 'chest' | 'altar' | 'pedestal' | 'merchant' | 'alchemist' | 'exit' | 'boss'
  | 'torch' | 'deco' | 'shop' | 'fountain' | 'gate';

export interface Spawn {
  type: SpawnType;
  x: number;
  y: number;
  tx: number;
  ty: number;
  roomId: number;
  /** optional style hint (deco: 'barrel' | 'crates' | 'bones' | 'banner' | 'chains' | 'cage' | 'bell') */
  variant?: string;
}

export interface RoomInfo {
  id: number;
  templateId: string;
  /** tile rect */
  x: number;
  y: number;
  w: number;
  h: number;
  tags: string[];
  /** 0..1 position along the main path (branches inherit their root's value); drives elites */
  progress?: number;
}
