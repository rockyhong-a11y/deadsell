import type { BiomeId } from '../run';
import type { Rng } from '../../engine/rng';
import { Prop, ceilingAbove } from './common';

export type DecoKind = 'barrel' | 'crates' | 'bones' | 'banner' | 'chains' | 'cage' | 'bell';

/** [kind, weight] per biome. */
const DECO_WEIGHTS: Record<BiomeId, [DecoKind, number][]> = {
  prison: [['barrel', 3], ['crates', 3], ['bones', 3], ['cage', 1.2], ['chains', 2]],
  ramparts: [['banner', 3], ['barrel', 2], ['crates', 2], ['bones', 1], ['chains', 1]],
  tower: [['chains', 2], ['bones', 1], ['barrel', 1]],
};

export function pickDeco(rng: Rng, biome: BiomeId): DecoKind {
  return rng.weighted(DECO_WEIGHTS[biome], (d) => d[1])[0];
}

/** pixel height of the artwork, for hanging decor */
const HANG_HEIGHT: Partial<Record<DecoKind, number>> = { chains: 70, banner: 80, cage: 72, bell: 93 };

/** Decoration: standing props sit on the floor, hanging ones attach to the ceiling above. */
export class Deco extends Prop {
  readonly kind: DecoKind;

  constructor(x: number, y: number, kind: DecoKind, flip = false) {
    super(x, y);
    this.kind = kind;
    this.facing = flip ? -1 : 1;
    this.z = -1;
    this.w = 24;
    this.h = 24;
  }

  /** low alcoves cannot hold a hanging prop: it would reach into the floor, so a standing one takes its place */
  private static readonly STANDING: Partial<Record<DecoKind, DecoKind>> = { chains: 'bones', banner: 'barrel', cage: 'crates' };

  init(): void {
    let sheetKind: DecoKind = this.kind;
    const hang = HANG_HEIGHT[this.kind];
    if (hang && this.kind !== 'bell') {
      const c = ceilingAbove(this.world, this.x, this.y - 8);
      if (c !== null) {
        if (c + hang <= this.y + 2) this.y = c + hang;
        else sheetKind = Deco.STANDING[this.kind] ?? this.kind;
      }
    }
    this.useSheet('props', sheetKind);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, this.facing < 0);
  }
}
