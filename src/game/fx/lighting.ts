import type { Camera } from '../../engine/camera';

/**
 * Immediate-mode 2D lighting: everything that glows calls `add()` every frame;
 * `render()` darkens the scene with the biome's ambient colour and punches
 * coloured light into it. OWNER: fx agent — keep the API stable.
 */
export interface Light { x: number; y: number; r: number; color: string; intensity: number; flicker?: number; }

export class Lighting {
  /** colour multiplied over the scene where there is no light; null = lighting off */
  ambient: string | null = null;
  private lights: Light[] = [];

  /** Pick ambient darkness for a biome/level kind. */
  setBiome(_biome: string, _kind: 'biome' | 'passage' | 'boss'): void {}

  add(x: number, y: number, r: number, color: string, intensity = 1, flicker = 0): void {
    this.lights.push({ x, y, r, color, intensity, flicker });
  }

  render(_ctx: CanvasRenderingContext2D, _cam: Camera, _w: number, _h: number, _time: number): void {
    this.lights.length = 0;
  }
}
