import { UI_H, VIEW_H, VIEW_W_MAX, VIEW_W_MIN, WORLD_HEIGHTS } from './config';

/**
 * Graphics options (settings screen "그래픽") and the pure maths behind them.
 *
 * Layers (see Display): the world buffer is blitted to the `screen` canvas (nearest neighbour, or bilinear for
 * "부드럽게"), optionally covered by a baked overlay (CRT scanlines / LCD grid); colour filters (선명한 색감,
 * 흑백) are CSS filters on that canvas element only (works on iOS Safari, unlike ctx.filter). The UI lives on a
 * second transparent canvas above it, so text and HUD stay untouched by every filter.
 */
export const FILTER_IDS = ['sharp', 'smooth', 'crt', 'lcd', 'vivid', 'mono'] as const;
export type FilterId = (typeof FILTER_IDS)[number];
export type ResolutionId = (typeof WORLD_HEIGHTS)[number];
export type FitId = 'fill' | 'integer';
export type QualityId = 'high' | 'saver';

export interface GfxSettings {
  filter: FilterId;
  /** world buffer height in pixels */
  resolution: ResolutionId;
  fit: FitId;
  quality: QualityId;
}

export const DEFAULT_GFX: GfxSettings = { filter: 'sharp', resolution: VIEW_H as ResolutionId, fit: 'fill', quality: 'high' };

export const FILTER_LABEL: Record<FilterId, string> = {
  sharp: '선명(픽셀)', smooth: '부드럽게', crt: 'CRT', lcd: 'LCD', vivid: '선명한 색감', mono: '흑백',
};

/** CSS `filter` value applied to the world canvas element ('none' for the geometric / overlay filters). */
export function cssFilterOf(f: FilterId): string {
  switch (f) {
    case 'vivid': return 'saturate(1.45) contrast(1.12) brightness(1.02)';
    case 'mono': return 'grayscale(1) contrast(1.08)';
    default: return 'none';
  }
}

/** Bilinear upscale of the world buffer? */
export const smoothOf = (f: FilterId): boolean => f === 'smooth';

/** Overlay kind baked for a filter (null = none). */
export const overlayOf = (f: FilterId): 'crt' | 'lcd' | null => (f === 'crt' || f === 'lcd' ? f : null);

export const isFilterId = (v: unknown): v is FilterId => typeof v === 'string' && (FILTER_IDS as readonly string[]).includes(v);
export const isResolutionId = (v: unknown): v is ResolutionId => typeof v === 'number' && (WORLD_HEIGHTS as readonly number[]).includes(v);

/** Validate stored graphics settings (every field falls back to its default). */
export function sanitizeGfx(raw: Record<string, unknown> | null | undefined): GfxSettings {
  const r = raw ?? {};
  return {
    filter: isFilterId(r.filter) ? r.filter : DEFAULT_GFX.filter,
    resolution: isResolutionId(r.resolution) ? r.resolution : DEFAULT_GFX.resolution,
    fit: r.fit === 'fill' || r.fit === 'integer' ? r.fit : DEFAULT_GFX.fit,
    quality: r.quality === 'high' || r.quality === 'saver' ? r.quality : DEFAULT_GFX.quality,
  };
}

export interface ScreenLayout {
  /** UI virtual size: width varies with the screen aspect (480..800), height is fixed (UI_H) */
  uiW: number;
  uiH: number;
  /** world buffer size */
  worldW: number;
  worldH: number;
  /** device pixels per UI virtual pixel */
  scale: number;
  /** where the picture sits inside the canvas, device px (the rest is letterbox) */
  offsetX: number;
  offsetY: number;
  viewW: number;
  viewH: number;
  /** integer device pixels per world pixel in 'integer' fit (0 in 'fill') */
  integer: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Fit the picture into a canvas of devW × devH device pixels (pure; Display and the tests use it).
 *  - fill:    the whole screen (letterbox only when the aspect leaves the 480..800 × 360 range); the world is
 *             scaled by a non-integer factor.
 *  - integer: every world pixel is an exact k × k block of device pixels (pixel-perfect), centred with a letterbox.
 * The world buffer always has the same aspect as the UI space, so the UI keeps its size whatever the resolution.
 */
export function computeLayout(devW: number, devH: number, gfx: Pick<GfxSettings, 'resolution' | 'fit'>): ScreenLayout {
  devW = Math.max(1, devW);
  devH = Math.max(1, devH);
  const worldH = gfx.resolution;
  const ratio = worldH / UI_H;
  const wMin = Math.round(VIEW_W_MIN * ratio);
  const wMax = Math.round(VIEW_W_MAX * ratio);
  if (gfx.fit === 'integer') {
    const k = Math.floor(Math.min(devW / wMin, devH / worldH));
    if (k >= 1) {
      const worldW = clamp(Math.floor(devW / k), wMin, wMax);
      const viewW = worldW * k;
      const viewH = worldH * k;
      const scale = viewH / UI_H;
      return {
        uiW: Math.round(viewW / scale), uiH: UI_H, worldW, worldH, scale,
        offsetX: Math.floor((devW - viewW) / 2), offsetY: Math.floor((devH - viewH) / 2), viewW, viewH, integer: k,
      };
    }
  }
  const uiW = Math.round(clamp((UI_H * devW) / devH, VIEW_W_MIN, VIEW_W_MAX));
  const scale = Math.min(devW / uiW, devH / UI_H);
  const viewW = uiW * scale;
  const viewH = UI_H * scale;
  return {
    uiW, uiH: UI_H, worldW: Math.round(uiW * ratio), worldH, scale,
    offsetX: Math.round((devW - viewW) / 2), offsetY: Math.round((devH - viewH) / 2), viewW, viewH, integer: 0,
  };
}

/**
 * Device-pixel positions of `count` grid lines for a picture of `count` world pixels drawn `scale` device px each.
 * Lines are spaced at least `minGap` device px apart (skipping world pixels when the picture is tiny).
 */
export function gridLines(count: number, scale: number, minGap = 2): number[] {
  const step = Math.max(1, Math.ceil(minGap / Math.max(0.01, scale)));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(Math.round((i + 1) * scale) - 1);
  return out;
}

type Canvas2D = HTMLCanvasElement;

/**
 * Bake the overlay for 'crt' (scanlines, aperture-grille tint, vignette) or 'lcd' (pixel grid) at the size of the
 * picture (device px). Built once per size / filter and blitted every frame. Returns null without a DOM.
 */
export function buildOverlay(kind: 'crt' | 'lcd', viewW: number, viewH: number, worldW: number, worldH: number): Canvas2D | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(viewW));
  cv.height = Math.max(1, Math.round(viewH));
  const g = cv.getContext('2d');
  if (!g) return null;
  const sx = cv.width / worldW;
  const sy = cv.height / worldH;
  if (kind === 'crt') {
    // scanlines: darken the lower part of every world row
    const th = Math.max(1, Math.round(sy * 0.38));
    g.fillStyle = 'rgba(0,0,0,0.30)';
    for (const y of gridLines(worldH, sy)) g.fillRect(0, y - th + 1, cv.width, th);
    // aperture grille: faint R/G/B columns (a subtle colour fringe)
    if (sx >= 2) {
      const cols = ['rgba(255,40,40,0.045)', 'rgba(40,255,40,0.035)', 'rgba(40,80,255,0.05)'];
      for (let x = 0; x < cv.width; x++) {
        g.fillStyle = cols[x % 3];
        g.fillRect(x, 0, 1, cv.height);
      }
    }
    // vignette
    const r = Math.hypot(cv.width, cv.height) / 2;
    const gr = g.createRadialGradient(cv.width / 2, cv.height / 2, r * 0.52, cv.width / 2, cv.height / 2, r * 1.02);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.46)');
    g.fillStyle = gr;
    g.fillRect(0, 0, cv.width, cv.height);
  } else {
    const tx = Math.max(1, Math.round(sx * 0.16));
    const ty = Math.max(1, Math.round(sy * 0.16));
    g.fillStyle = 'rgba(0,0,0,0.26)';
    for (const x of gridLines(worldW, sx)) g.fillRect(x - tx + 1, 0, tx, cv.height);
    for (const y of gridLines(worldH, sy)) g.fillRect(0, y - ty + 1, cv.width, ty);
  }
  return cv;
}
