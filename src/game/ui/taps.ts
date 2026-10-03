import type { AABB } from '../../engine/math';
import { pointIn } from '../../engine/math';

/**
 * Tappable UI regions in virtual coordinates, rebuilt every frame by whoever
 * draws the UI (Game.render clears it first). The touch layer asks
 * `hit()` before treating a touch as a gameplay gesture.
 *  - mode 'down': fires on touch start (HUD buttons: flask, skills)
 *  - mode 'up':   fires on release inside the region (menus, prompts)
 */
export interface TapRegion {
  id: string;
  rect: AABB;
  mode: 'down' | 'up';
  onTap: () => void;
  /** optional: called on release (for hold buttons) */
  onRelease?: () => void;
  /** optional: finger moved by (dx, dy) virtual px while pressed on this region (map panning, scrolling).
   *  A region with onDrag does not fire onTap when the finger travelled further than the tap slop. */
  onDrag?: (dx: number, dy: number) => void;
}

export class TapRegistry {
  regions: TapRegion[] = [];

  clear(): void {
    this.regions.length = 0;
  }

  add(r: TapRegion): void {
    this.regions.push(r);
  }

  /** Topmost region containing the point (last added wins). */
  hit(x: number, y: number): TapRegion | null {
    for (let i = this.regions.length - 1; i >= 0; i--) if (pointIn(x, y, this.regions[i].rect)) return this.regions[i];
    return null;
  }

  byId(id: string): TapRegion | null {
    return this.regions.find((r) => r.id === id) ?? null;
  }
}
