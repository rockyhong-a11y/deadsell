/**
 * Emissive hand-off between the particle system and the lighting pass.
 *
 * Particles are drawn BEFORE the light map is multiplied over the scene, so a
 * glowing ember would be darkened like everything else. Instead, every glowing
 * particle pushes a small light into this sink while it is drawn; `Lighting.render`
 * (called right after in the same frame) adds those halos to the light map, which
 * both keeps the particle itself at full brightness and lights its surroundings.
 *
 * World coordinates. Fixed capacity, no per-frame allocation.
 */
export class GlowSink {
  readonly max: number;
  n = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly r: Float32Array;
  readonly a: Float32Array;
  readonly c: string[];

  constructor(max = 160) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.r = new Float32Array(max);
    this.a = new Float32Array(max);
    this.c = new Array<string>(max).fill('#ffffff');
  }

  push(x: number, y: number, r: number, color: string, alpha: number): boolean {
    const i = this.n;
    if (i >= this.max) return false;
    this.x[i] = x;
    this.y[i] = y;
    this.r[i] = r;
    this.a[i] = alpha;
    this.c[i] = color;
    this.n = i + 1;
    return true;
  }

  reset(): void {
    this.n = 0;
  }
}

/** Shared sink: `Particles.draw` fills it, `Lighting.render` drains it. */
export const glowSink = new GlowSink();

/**
 * Environment hand-off: `Lighting.setBiome` publishes the atmosphere key ('prison' | 'ramparts' |
 * 'tower' | 'passage' | '' for none) and `Particles.update` reads it to emit biome ambience.
 */
export const fxEnv: { ambient: string } = { ambient: '' };
