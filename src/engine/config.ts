/** Global constants. World units are pixels, y points down. */
export const TILE = 24;
/** Fixed height of the UI's virtual space (HUD, menus, text). The UI keeps this size whatever the world resolution is. */
export const UI_H = 360;
/** Default world buffer height (also the reference the width limits below are given for). Options: see WORLD_HEIGHTS. */
export const VIEW_H = 360;
export const VIEW_W_MIN = 480;
export const VIEW_W_MAX = 800;
/** Selectable world buffer heights: fewer pixels = more zoomed in, more = a wider view of the level. */
export const WORLD_HEIGHTS = [288, 360, 432] as const;
export const FIXED_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 4;

export const GRAVITY = 1300;
export const MAX_FALL = 540;

/** Level macro-grid chunk size in tiles (see docs/DESIGN.md §6). */
export const CHUNK_W = 32;
export const CHUNK_H = 18;

export const FONT = "'Galmuri11', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Noto Sans CJK KR', sans-serif";

/** Debug flags, toggled from the URL: ?debug=1&seed=123&god=1&level=boss */
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const DEBUG = {
  on: params.has('debug'),
  hitboxes: params.get('debug') === '2',
  god: params.has('god'),
  seed: params.has('seed') ? Number(params.get('seed')) : null,
  /** Jump straight to a level: prison | ramparts | passage | boss */
  level: params.get('level'),
  mute: params.has('mute'),
};
