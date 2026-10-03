import { ITEM_IDS, STARTER_UNLOCKS, type ItemId } from '../items/types';

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
      settings: {
        sfx: Math.min(1, num(st.sfx, base.settings.sfx)),
        music: Math.min(1, num(st.music, base.settings.music)),
        hints: typeof st.hints === 'boolean' ? st.hints : base.settings.hints,
        muted: typeof st.muted === 'boolean' ? st.muted : base.settings.muted,
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
