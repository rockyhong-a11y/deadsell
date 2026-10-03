import { TILE } from '../../engine/config';
import type { RoomInfo } from '../level/types';
import { Prop } from './common';

/** Invisible: emits {type:'roomEntered'} whenever the player's tile enters another room. */
export class RoomTracker extends Prop {
  private rooms: RoomInfo[];
  private current = -1;

  constructor(rooms: RoomInfo[]) {
    super(0, 0);
    this.rooms = rooms;
    this.alwaysActive = true;
  }

  update(dt: number): void {
    super.update(dt);
    const p = this.world.player;
    if (!p) return;
    const tx = Math.floor(p.x / TILE), ty = Math.floor((p.y - 8) / TILE);
    for (const r of this.rooms) {
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
        if (r.id !== this.current) {
          this.current = r.id;
          this.world.emit({ type: 'roomEntered', roomId: r.id });
        }
        return;
      }
    }
  }

  draw(): void {}
}
