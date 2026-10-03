/**
 * Shared telegraph drawing helpers (red warning markers). All coordinates are world pixels;
 * `p` is progress 0..1 through the windup (markers get brighter / fill up as the hit approaches).
 */
export const WARN = '#ff3b30';
export const WARN_BRIGHT = '#ff8a5c';

const pulse = (t: number, hz: number) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * hz);

/** Translucent red box that fills up over time (hit area preview). */
export function warnRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: number, t: number, color = WARN): void {
  ctx.save();
  ctx.globalAlpha = 0.1 + 0.28 * p;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.globalAlpha = 0.45 + 0.45 * pulse(t, 6 + 6 * p);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  // inner fill that grows toward the hit moment
  ctx.globalAlpha = 0.35;
  ctx.fillRect(Math.round(x), Math.round(y + h * (1 - p)), Math.round(w), Math.round(h * p));
  ctx.restore();
}

/** Flat red ellipse on the floor (ground warning circle). `r` = gameplay radius. */
export function warnCircle(ctx: CanvasRenderingContext2D, x: number, groundY: number, r: number, p: number, t: number, color = WARN): void {
  const ry = Math.max(3, r * 0.3);
  ctx.save();
  ctx.globalAlpha = 0.14 + 0.22 * p;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(groundY) - 1, r, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // growing inner disc = time until it goes off
  ctx.globalAlpha = 0.4 + 0.2 * p;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(groundY) - 1, Math.max(1, r * p), Math.max(1, ry * p), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.55 + 0.45 * pulse(t, 5 + 8 * p);
  ctx.strokeStyle = WARN_BRIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(groundY) - 1, r, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Thin aim / path line. */
export function warnLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, alpha: number, width = 1, color = WARN, dash = 0): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash([dash, dash]);
  ctx.beginPath();
  ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
  ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.stroke();
  ctx.restore();
}

/** Glowing strip along the floor with chevrons pointing in `dir` (charge path). */
export function warnPath(ctx: CanvasRenderingContext2D, x0: number, x1: number, groundY: number, dir: number, p: number, t: number, thick = 6): void {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  if (b - a < 4) return;
  ctx.save();
  ctx.globalAlpha = 0.16 + 0.26 * p;
  ctx.fillStyle = WARN;
  ctx.fillRect(Math.round(a), Math.round(groundY) - thick, Math.round(b - a), thick);
  ctx.globalAlpha = 0.55 + 0.4 * pulse(t, 6 + 6 * p);
  ctx.fillRect(Math.round(a), Math.round(groundY) - thick - 1, Math.round(b - a), 1);
  ctx.strokeStyle = WARN_BRIGHT;
  ctx.lineWidth = 1;
  const off = (t * 90) % 24;
  for (let i = 0; i < Math.ceil((b - a) / 24) + 1; i++) {
    const cx = dir > 0 ? a + ((i * 24 + off) % (b - a + 24)) : b - ((i * 24 + off) % (b - a + 24));
    if (cx < a || cx > b) continue;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx - dir * 4) + 0.5, Math.round(groundY - thick));
    ctx.lineTo(Math.round(cx) + 0.5, Math.round(groundY - thick / 2));
    ctx.lineTo(Math.round(cx - dir * 4) + 0.5, Math.round(groundY));
    ctx.stroke();
  }
  ctx.restore();
}

/** Small exclamation marker drawn by code (in addition to the fx '!' text). */
export function warnBang(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const s = 1 + 0.15 * Math.sin(t * 30);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(s, s);
  ctx.fillStyle = '#120a1a';
  ctx.fillRect(-3, -11, 6, 12);
  ctx.fillRect(-3, 3, 6, 5);
  ctx.fillStyle = WARN;
  ctx.fillRect(-2, -10, 4, 9);
  ctx.fillRect(-2, 4, 4, 3);
  ctx.restore();
}
