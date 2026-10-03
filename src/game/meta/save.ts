import { STARTER_UNLOCKS, type ItemId } from '../items/types';

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
  settings: { sfx: number; music: number; hints: boolean; muted: boolean };
}

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
    settings: { sfx: 0.8, music: 0.5, hints: true, muted: false },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    const base = defaultSave();
    return { ...base, ...d, upgrades: { ...base.upgrades, ...d.upgrades }, settings: { ...base.settings, ...d.settings } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode): progress is kept for this session only */
  }
}
