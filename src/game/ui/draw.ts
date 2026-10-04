import { FONT } from '../../engine/config';
import type { Assets } from '../../engine/assets';
import type { AABB } from '../../engine/math';

/**
 * Small canvas helpers shared by the HUD, overlays and scenes. All coordinates are
 * virtual pixels (the UI transform is applied by Display.beginUI).
 * Galmuri11 is a pixel-style face: it is crispest at 11 px and its multiples, so the
 * size scale below sticks to those (plus 13 for the few places that need to stand out).
 */
export const SZ = { s: 11, m: 13, l: 22, xl: 33 } as const;

export const COL = {
  ink: '#07060b',
  panel: '#121624',
  panelHi: '#1c2338',
  line: '#3b4a6b',
  text: '#eef6ff',
  dim: '#8d9bb8',
  cyan: '#9fe8ff',
  gold: '#ffd23f',
  cell: '#4fd8ff',
  /** 시체 조각 (corpse pieces) */
  bone: '#e8d7c3',
  red: '#ff5a5f',
  green: '#7bd96a',
  amber: '#ffb347',
} as const;

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  bold?: boolean;
  /** shadow colour (1 px, down-right); null = none. Default dark ink. */
  shadow?: string | null;
  baseline?: CanvasTextBaseline;
  alpha?: number;
  /** extra pixels between letters (logo) */
  spacing?: number;
}

export function setFont(c: CanvasRenderingContext2D, size: number, bold = false): void {
  c.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
}

/** Draw text with a 1 px drop shadow. (x, y) is the baseline-middle anchor by default. */
export function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}): void {
  const size = o.size ?? SZ.s;
  setFont(c, size, o.bold);
  c.textAlign = o.align ?? 'left';
  c.textBaseline = o.baseline ?? 'middle';
  const prevAlpha = c.globalAlpha;
  if (o.alpha !== undefined) c.globalAlpha = prevAlpha * o.alpha;
  const draw = (dx: number, dy: number, color: string) => {
    c.fillStyle = color;
    if (o.spacing) spaced(c, s, x + dx, y + dy, o.spacing, o.align ?? 'left');
    else c.fillText(s, x + dx, y + dy);
  };
  const shadow = o.shadow === undefined ? COL.ink : o.shadow;
  if (shadow) draw(1, 1, shadow);
  draw(0, 0, o.color ?? COL.text);
  c.globalAlpha = prevAlpha;
}

function spaced(c: CanvasRenderingContext2D, s: string, x: number, y: number, sp: number, align: CanvasTextAlign): void {
  const chars = [...s];
  const widths = chars.map((ch) => c.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = c.textAlign;
  c.textAlign = 'left';
  chars.forEach((ch, i) => {
    c.fillText(ch, cx, y);
    cx += widths[i] + sp;
  });
  c.textAlign = prev;
}

export function textWidth(c: CanvasRenderingContext2D, s: string, size: number = SZ.s, bold = false): number {
  setFont(c, size, bold);
  return c.measureText(s).width;
}

/** Greedy line wrap (Korean wraps at any character, Latin at spaces when possible). */
export function wrap(c: CanvasRenderingContext2D, s: string, maxW: number, size: number = SZ.s, bold = false): string[] {
  setFont(c, size, bold);
  const lines: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const ch of [...para]) {
      const test = line + ch;
      if (line && c.measureText(test).width > maxW) {
        // prefer breaking at the last space if there is one
        const sp = line.lastIndexOf(' ');
        if (ch !== ' ' && sp > 0 && /[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]/.test(line[line.length - 1])) {
          lines.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          lines.push(line);
          line = ch === ' ' ? '' : ch;
        }
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** Rounded-rect path (does not fill). */
export function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 4): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.arcTo(x + w, y, x + w, y + rr, rr);
  c.lineTo(x + w, y + h - rr);
  c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  c.lineTo(x + rr, y + h);
  c.arcTo(x, y + h, x, y + h - rr, rr);
  c.lineTo(x, y + rr);
  c.arcTo(x, y, x + rr, y, rr);
  c.closePath();
}

export interface PanelOpts {
  fill?: string;
  /** null = no outline */
  stroke?: string | null;
  alpha?: number;
  r?: number;
  lineWidth?: number;
}

export function panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: PanelOpts = {}): void {
  const prev = c.globalAlpha;
  c.globalAlpha = prev * (o.alpha ?? 1);
  rrect(c, x, y, w, h, o.r ?? 5);
  c.fillStyle = o.fill ?? COL.panel;
  c.fill();
  if (o.stroke !== null) {
    c.lineWidth = o.lineWidth ?? 1;
    c.strokeStyle = o.stroke ?? COL.line;
    c.stroke();
  }
  c.globalAlpha = prev;
}

export interface ButtonOpts {
  label: string;
  color?: string;
  selected?: boolean;
  disabled?: boolean;
  size?: number;
  sub?: string;
}

/** A labelled button panel. Returns nothing; register the tap region yourself. */
export function button(c: CanvasRenderingContext2D, r: AABB, o: ButtonOpts): void {
  const accent = o.color ?? COL.cyan;
  panel(c, r.x, r.y, r.w, r.h, {
    fill: o.selected ? COL.panelHi : COL.panel,
    stroke: o.selected ? accent : COL.line,
    lineWidth: o.selected ? 2 : 1,
    alpha: o.disabled ? 0.55 : 0.96,
  });
  const cy = r.y + r.h / 2;
  text(c, o.label, r.x + r.w / 2, o.sub ? cy - 6 : cy, { align: 'center', bold: true, size: o.size ?? SZ.m, color: o.disabled ? COL.dim : COL.text });
  if (o.sub) text(c, o.sub, r.x + r.w / 2, cy + 8, { align: 'center', color: COL.dim });
}

/** Expand a rect so that it is at least minW × minH, keeping the centre. */
export function atLeast(r: AABB, minW: number, minH: number): AABB {
  const w = Math.max(r.w, minW);
  const h = Math.max(r.h, minH);
  return { x: r.x - (w - r.w) / 2, y: r.y - (h - r.h) / 2, w, h };
}

/** Draw an icon from the `icons` sheet centred at (cx, cy), `size` virtual px square. */
export function icon(assets: Pick<Assets, 'sheet'>, c: CanvasRenderingContext2D, name: string, cx: number, cy: number, size = 24, alpha = 1): void {
  const sheet = assets.sheet('icons');
  const s = size / sheet.frameW;
  c.save();
  c.imageSmoothingEnabled = s < 1;
  sheet.draw(c, name, 0, cx + (sheet.ax - sheet.frameW / 2) * s, cy + (sheet.ay - sheet.frameH / 2) * s, false, { scale: s, alpha });
  c.restore();
}

/**
 * The 시체 조각 icon centred at (cx, cy): `corpse_piece` of the `icons` sheet once the art has it, until then a small
 * stitched lump drawn with paths (the sheet would show an unrelated icon for an unknown name).
 */
export function pieceIcon(assets: Pick<Assets, 'sheet'>, c: CanvasRenderingContext2D, cx: number, cy: number, size = 18, alpha = 1): void {
  if (assets.sheet('icons').has('corpse_piece')) {
    icon(assets, c, 'corpse_piece', cx, cy, size, alpha);
    return;
  }
  const r = size / 2;
  c.save();
  c.globalAlpha *= alpha;
  c.fillStyle = COL.bone;
  c.strokeStyle = '#7a1f2a';
  c.lineWidth = 1.5;
  c.beginPath();
  c.ellipse(cx, cy + 1, r * 0.85, r * 0.62, -0.35, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.strokeStyle = '#c8324a';
  c.lineWidth = 1.2;
  c.beginPath();
  for (const k of [-0.45, 0, 0.45]) {
    const x = cx + r * k;
    c.moveTo(x - 1.6, cy - 2.2);
    c.lineTo(x + 1.6, cy + 3);
    c.moveTo(x + 1.6, cy - 2.2);
    c.lineTo(x - 1.6, cy + 3);
  }
  c.stroke();
  c.restore();
}

/** m:ss (or h:mm:ss) */
export function formatTime(secs: number): string {
  const t = Math.max(0, Math.floor(secs));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const pulse = (t: number, speed = 2): number => 0.5 + 0.5 * Math.sin(t * speed * Math.PI * 2);

/** Radial pie (clockwise from the top) covering `frac` (0..1) of a circle. */
export function pie(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, frac: number, color: string): void {
  if (frac <= 0) return;
  c.beginPath();
  c.moveTo(cx, cy);
  c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
  c.closePath();
  c.fillStyle = color;
  c.fill();
}

/** Dim the whole view. */
export function dim(c: CanvasRenderingContext2D, W: number, H: number, alpha: number, color = '#05040a'): void {
  const prev = c.globalAlpha;
  c.globalAlpha = prev * alpha;
  c.fillStyle = color;
  c.fillRect(-10, -10, W + 20, H + 20);
  c.globalAlpha = prev;
}

/** A small open-book (도감) icon drawn with paths, so it never depends on a font glyph. `r` = half the width. */
export function book(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string = COL.text): void {
  const h = r * 0.82;
  c.save();
  c.fillStyle = color;
  for (const s of [-1, 1]) {
    // one page: a quad that lifts toward the outer edge, with a 2 px gutter at the spine
    c.beginPath();
    c.moveTo(cx + s * 1.2, cy - h * 0.7);
    c.lineTo(cx + s * r, cy - h);
    c.lineTo(cx + s * r, cy + h * 0.55);
    c.lineTo(cx + s * 1.2, cy + h);
    c.closePath();
    c.fill();
  }
  // text lines on the pages (dark ticks)
  c.fillStyle = 'rgba(7,6,11,0.6)';
  for (const s of [-1, 1]) for (const k of [-0.3, 0.15]) c.fillRect(s > 0 ? cx + 4 : cx - r + 2, cy + h * k, r - 6, 1.5);
  c.restore();
}

/** A small gear (설정) icon drawn with paths, so it never depends on a font glyph. */
export function gear(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string = COL.text): void {
  const teeth = 8;
  c.save();
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.72;
    const a0 = a - Math.PI / (teeth * 4);
    const a1 = a + Math.PI / (teeth * 4);
    c.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
    c.lineTo(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr);
  }
  c.closePath();
  c.moveTo(cx + r * 0.32, cy);
  c.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
  c.fill('evenodd');
  c.restore();
}
