import { ITEM_IDS, STARTER_UNLOCKS, type ItemId } from '../items/types';
import { DEFAULT_GFX, sanitizeGfx, type GfxSettings } from '../../engine/filters';
import { DEFAULT_PAD_MAP, sanitizePadMap, type PadMap } from '../../engine/gamepad';
import { CORPSE } from '../rules';

/** 터치 제스처 / 가상 버튼 / 게임패드 (the keyboard always works in every mode) */
export type ControlMode = 'gesture' | 'buttons' | 'gamepad';
export const CONTROL_MODES: readonly ControlMode[] = ['gesture', 'buttons', 'gamepad'];
export type ButtonSize = 'small' | 'medium' | 'large';
export const BUTTON_SIZES: readonly ButtonSize[] = ['small', 'medium', 'large'];
/** the three opacity steps offered for the virtual buttons (stored as a number, any 0.2..1 value is accepted) */
export const BUTTON_OPACITY_STEPS = [0.35, 0.6, 0.85] as const;

export interface Settings extends GfxSettings {
  sfx: number;
  music: number;
  hints: boolean;
  muted: boolean;
  controlMode: ControlMode;
  /** virtual button size */
  btnSize: ButtonSize;
  /** virtual button opacity, 0.2..1 */
  btnOpacity: number;
  /** physical gamepad button index per action */
  gamepadMap: PadMap;
}

/** Meta progression persisted across runs (localStorage). */
export interface SaveData {
  version: 1;
  unlocked: ItemId[];
  /** permanent upgrades bought from the Alchemist */
  upgrades: { flask: number; gold: number };
  runs: number;
  wins: number;
  bestTime: number | null;
  totalKills: number;
  /** 회차: the current loop, starts at 1 (docs/CONTENT3.md §1) */
  loop: number;
  /** pieces sewn into Cinder's body in the current loop, 0..99 (100 completes the loop and resets to 0) */
  body: number;
  /** runs started in the current loop (reset when the loop is cleared) */
  loopRuns: number;
  settings: Settings;
}

/** the highest loop number a save keeps */
export const MAX_LOOP = 99;

const KEY = 'deadsell.save.v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    unlocked: [...STARTER_UNLOCKS],
    upgrades: { flask: 0, gold: 0 },
    runs: 0,
    wins: 0,
    bestTime: null,
    totalKills: 0,
    loop: 1,
    body: 0,
    loopRuns: 0,
    settings: {
      sfx: 0.8, music: 0.5, hints: true, muted: false,
      controlMode: 'gesture', btnSize: 'medium', btnOpacity: 0.6, gamepadMap: { ...DEFAULT_PAD_MAP },
      ...DEFAULT_GFX,
    },
  };
}

const num = (v: unknown, fallback: number, min = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback);

/** Merge stored data over the defaults, dropping anything with the wrong shape (old / hand-edited / corrupted saves). */
export function loadSave(): SaveData {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return base;
    const known = new Set<string>(ITEM_IDS);
    const unlocked = Array.isArray(d.unlocked) ? (d.unlocked as unknown[]).filter((id): id is ItemId => typeof id === 'string' && known.has(id)) : [];
    const up = d.upgrades && typeof d.upgrades === 'object' ? d.upgrades : {};
    const st = d.settings && typeof d.settings === 'object' ? d.settings : {};
    return {
      version: 1,
      unlocked: [...new Set<ItemId>([...STARTER_UNLOCKS, ...unlocked])],
      upgrades: { flask: Math.min(2, Math.floor(num(up.flask, 0))), gold: Math.min(1, Math.floor(num(up.gold, 0))) },
      runs: Math.floor(num(d.runs, 0)),
      wins: Math.floor(num(d.wins, 0)),
      bestTime: typeof d.bestTime === 'number' && Number.isFinite(d.bestTime) && d.bestTime > 0 ? d.bestTime : null,
      totalKills: Math.floor(num(d.totalKills, 0)),
      loop: Math.min(MAX_LOOP, Math.floor(num(d.loop, 1, 1))),
      body: Math.min(CORPSE.body - 1, Math.floor(num(d.body, 0))),
      loopRuns: Math.floor(num(d.loopRuns, 0)),
      settings: {
        sfx: Math.min(1, num(st.sfx, base.settings.sfx)),
        music: Math.min(1, num(st.music, base.settings.music)),
        hints: typeof st.hints === 'boolean' ? st.hints : base.settings.hints,
        muted: typeof st.muted === 'boolean' ? st.muted : base.settings.muted,
        controlMode: (CONTROL_MODES as readonly unknown[]).includes(st.controlMode) ? st.controlMode : base.settings.controlMode,
        btnSize: (BUTTON_SIZES as readonly unknown[]).includes(st.btnSize) ? st.btnSize : base.settings.btnSize,
        btnOpacity: typeof st.btnOpacity === 'number' && Number.isFinite(st.btnOpacity) ? Math.min(1, Math.max(0.2, st.btnOpacity)) : base.settings.btnOpacity,
        gamepadMap: sanitizePadMap(st.gamepadMap),
        ...sanitizeGfx(st),
      },
    };
  } catch {
    return base;
  }
}

export function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode): progress is kept for this session only */
  }
}
