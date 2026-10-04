import { COL, panel } from './draw';

export type Glyph = 'drag' | 'tap' | 'up' | 'side' | 'down' | 'hold';

/** The six touch gestures (tutorial and the settings screen share these mini animations). */
export const GESTURE_CARDS: { glyph: Glyph; title: string; short: string }[] = [
  { glyph: 'drag', title: '이동', short: '왼쪽을 누른 채 드래그' },
  { glyph: 'tap', title: '공격', short: '오른쪽을 톡 탭' },
  { glyph: 'up', title: '점프', short: '위로 쓸기 (공중에서 한 번 더)' },
  { glyph: 'side', title: '구르기', short: '좌우로 쓸기' },
  { glyph: 'down', title: '내려찍기', short: '아래로 쓸기' },
  { glyph: 'hold', title: '보조 무기', short: '길게 누르기' },
];

/** Animated mini screen: left half blue (stick), right half orange (gestures), finger dot showing the motion. `age` = seconds. */
export function drawGestureGlyph(c: CanvasRenderingContext2D, g: Glyph, cx: number, cy: number, age: number): void {
  const w = 86;
  const h = 48;
  const x = cx - w / 2;
  const y = cy - h / 2;
  panel(c, x, y, w, h, { fill: '#0a0d18', stroke: COL.line, r: 5 });
  c.fillStyle = 'rgba(79,216,255,0.10)';
  c.fillRect(x + 1, y + 1, w / 2 - 1, h - 2);
  c.fillStyle = 'rgba(255,179,71,0.10)';
  c.fillRect(x + w / 2, y + 1, w / 2 - 1, h - 2);
  c.fillStyle = COL.line;
  c.fillRect(Math.round(x + w / 2), y + 3, 1, h - 6);
  const t = (age * 0.8) % 1;
  const e = t < 0.7 ? t / 0.7 : 1;
  const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  const lx = x + w * 0.25;
  const rx = x + w * 0.75;
  const my = y + h / 2;
  let fx = rx, fy = my, ring = 0;
  let dirx = 0, diry = 0;
  switch (g) {
    case 'drag': fx = lx - 12 + 24 * Math.abs(Math.sin(age * 2.2)); fy = my; ring = 12; break;
    case 'tap': fx = rx; fy = my; ring = 4 + 8 * e; break;
    case 'up': fx = rx; fy = my + 14 - 28 * e; diry = -1; break;
    case 'side': fx = rx - 14 + 28 * e; fy = my; dirx = 1; break;
    case 'down': fx = rx; fy = my - 14 + 28 * e; diry = 1; break;
    case 'hold': fx = rx; fy = my; ring = 3 + 11 * Math.min(1, (age % 1.4) / 1.1); break;
  }
  c.save();
  c.globalAlpha *= fade;
  if (g === 'drag') {
    c.strokeStyle = 'rgba(159,232,255,0.5)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(lx, my, ring, 0, Math.PI * 2);
    c.stroke();
  } else if (ring) {
    c.strokeStyle = g === 'hold' ? 'rgba(255,179,71,0.8)' : 'rgba(255,255,255,0.6)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(fx, fy, ring, 0, Math.PI * 2);
    c.stroke();
  }
  if (dirx || diry) {
    c.strokeStyle = 'rgba(255,255,255,0.4)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(rx - dirx * 14, my - diry * 14);
    c.lineTo(rx + dirx * 14, my + diry * 14);
    c.stroke();
  }
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(fx, fy, 4.5, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
