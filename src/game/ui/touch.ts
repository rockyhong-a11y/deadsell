import type { Game } from '../game';

/**
 * Touch / pointer controls (docs/DESIGN.md §4). OWNER: ui agent.
 * Minimal stub: UI taps only, no gameplay gestures yet.
 */
export function attachTouch(game: Game): void {
  const canvas = game.display.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    game.audio.unlock();
    const p = game.display.toVirtual(e.clientX, e.clientY);
    const r = game.taps.hit(p.x, p.y);
    if (r) r.onTap();
  });
}
