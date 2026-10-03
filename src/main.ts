import { Game } from './game/game';
import { installDebug } from './game/debug';
import { DEBUG } from './engine/config';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
// Exposed for debugging and automated tests (e2e/).
(window as any).__game = game;
installDebug(game);
if (DEBUG.god) (window as any).__ds.god(true);

function drawLoading(p: number): void {
  const d = game.display;
  const c = d.ui;
  d.beginUI();
  c.fillStyle = '#07060b';
  c.fillRect(0, 0, d.W, d.H);
  c.fillStyle = '#26303f';
  c.fillRect(d.W / 2 - 80, d.H / 2, 160, 4);
  c.fillStyle = '#9fe8ff';
  c.fillRect(d.W / 2 - 80, d.H / 2, Math.round(160 * p), 4);
}

drawLoading(0);
game.assets.loadAll(drawLoading).then(() => game.start());
