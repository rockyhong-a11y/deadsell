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
  | 'torch' | 'deco' | 'shop' | 'fountain';

export interface Spawn {
  type: SpawnType;
  x: number;
  y: number;
  tx: number;
  ty: number;
  roomId: number;
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
}
