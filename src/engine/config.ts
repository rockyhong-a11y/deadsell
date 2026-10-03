/** Global constants. World units are pixels, y points down. */
export const TILE = 24;
export const VIEW_H = 360;
export const VIEW_W_MIN = 480;
export const VIEW_W_MAX = 800;
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
