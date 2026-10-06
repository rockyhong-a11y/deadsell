import { describe, it, expect, vi } from 'vitest';
import { SpriteSheet, SHEETS, type SheetManifest } from '../src/engine/assets';
import { DEFAULT_PAD_MAP, PAD_SCROLL_DELAY, mapPad, newPadState } from '../src/engine/gamepad';
import { ITEMS, AFFIX_NAMES, UNIQUE_COLOR } from '../src/game/items/items';
import { ITEM_IDS, UNIQUE_IDS } from '../src/game/items/types';
import { ALL_ENEMY_KINDS, BASE_KINDS, ENEMY_DEFS } from '../src/game/enemies/variants';
import { createEnemy } from '../src/game/enemies/factory';
import type { Enemy } from '../src/game/enemies/base';
import { MINIBOSS_IDS, MINIBOSS_SPECS, createMiniBoss } from '../src/game/miniboss';
import { MATRON, createBoss } from '../src/game/boss/matron';
import { META_UPGRADES } from '../src/game/meta/progression';
import { SCROLL_COLORS } from '../src/game/items/pickups';
import { COLOR_HEX } from '../src/game/combat';
import { CORPSE, ELITE, FOODS, GOLEM, LOOP, TIER2, golemCost } from '../src/game/rules';
import { WEAPONS } from '../src/game/player/weapons';
import { TapRegistry } from '../src/game/ui/taps';
import { implemented } from './helpers';
import { LevelUI } from '../src/game/ui/levelUI';
import { CodexModal, PauseModal } from '../src/game/ui/modals';
import {
  CODEX_TABS, ENEMY_ANIMS, BOSS_ANIMS, buildCodex, codexEntries, enemyNumbers, spawnLabel, type CodexTabId,
} from '../src/game/ui/codexData';
import { CodexScreen, codexLayout, fitScale, frameAt, previewSlots } from '../src/game/ui/codex';
import { makeTestWorld } from './helpers';

// ---------------------------------------------------------------------------
// the real sprite manifests, read from disk (the same files the game loads)

const files = import.meta.glob('../public/assets/sprites/*.json', { eager: true, import: 'default' }) as Record<string, SheetManifest>;
const manifests = new Map<string, SheetManifest>(Object.entries(files).map(([path, m]) => [path.replace(/^.*\/|\.json$/g, ''), m]));
const onDisk = (name: string): SheetManifest | null => manifests.get(name) ?? null;

/** the art of docs/CONTENT3.md §6 (corpse pieces, Selma, the golem and the new icons): required like every other sheet */
const NEW_SHEETS: Record<string, string[]> = {
  corpse: ['piece', 'piece_big'],
  seamstress: ['idle', 'talk', 'sew'],
  golem: ['idle', 'walk', 'attack', 'hurt', 'jump', 'death', 'assemble', 'pile'],
};
const NEW_ICONS = ['corpse_piece', 'golem'];
const manifest = (name: string): SheetManifest | null => onDisk(name);
const sheets = new Map<string, SpriteSheet>();
function realSheet(name: string): SpriteSheet {
  let s = sheets.get(name);
  if (!s) {
    const m = manifest(name);
    if (!m) throw new Error('no manifest for ' + name);
    s = new SpriteSheet(name, { width: 1, height: 1 } as unknown as CanvasImageSource, m);
    sheets.set(name, s);
  }
  return s;
}

const hasHangul = (s: string) => /[가-힣]/.test(s);
const byId = (tab?: CodexTabId) => new Map((tab ? codexEntries(tab) : buildCodex()).map((e) => [e.id, e]));

// ---------------------------------------------------------------------------
// a 2D context that accepts everything (draw code runs in node)

function fakeCtx(log?: string[], at?: { s: string; x: number; y: number; bold: boolean }[]): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = { font: '11px x' };
  return new Proxy(target, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: [...s].length * (parseInt(String(t.font).match(/(\d+)px/)?.[1] ?? '11', 10) * 0.9) });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'fillText' && (log || at)) return (s: string, x: number, y: number) => { log?.push(s); at?.push({ s, x, y, bold: /bold/.test(String(t.font)) }); };
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function makeGame(device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard') {
  const game: any = {
    taps: new TapRegistry(),
    audio: { play: vi.fn(), muted: false },
    input: { device },
    display: { W: 640, H: 360, scale: 1, offsetX: 0, offsetY: 0, canvas: null },
    assets: { sheet: realSheet },
  };
  return game;
}

/** a screen that has been open for a while (taps unlocked) and drawn once */
function open(W = 640, tab: CodexTabId = 'weapon', device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard', log?: string[], at?: { s: string; x: number; y: number; bold: boolean }[]) {
  const game = makeGame(device);
  const onClose = vi.fn();
  const sc = new CodexScreen(game, onClose, tab);
  const ctx = fakeCtx(log, at);
  const frame = (dt = 1 / 60) => {
    game.taps.clear();
    sc.update(dt);
    sc.draw(ctx, W, 360);
  };
  for (let i = 0; i < 15; i++) frame();
  return { game, sc, onClose, ctx, frame, W };
}

// ---------------------------------------------------------------------------

describe('codex entries cover the whole game', () => {
  const all = buildCodex();
  const ids = new Set(all.map((e) => e.id));

  it('has a page for every working weapon and skill, 30 enemies, 5 bosses and the item pages', () => {
    // (an item registered for the item expansion but not written yet has no page: docs/CONTENT4.md §5)
    expect(codexEntries('weapon')).toHaveLength(ITEM_IDS.filter((i) => ITEMS[i].slot === 'weapon' && implemented(i)).length);
    expect(codexEntries('skill')).toHaveLength(ITEM_IDS.filter((i) => ITEMS[i].slot === 'skill' && implemented(i)).length);
    expect(UNIQUE_IDS).toHaveLength(30);
    expect(codexEntries('enemy')).toHaveLength(30);
    expect(codexEntries('boss')).toHaveLength(5);
    expect(codexEntries('item').length).toBeGreaterThanOrEqual(2 + 3 + 3 + 2 + META_UPGRADES.length + Object.keys(AFFIX_NAMES).length);
    expect(ids.size).toBe(all.length); // ids are unique across tabs
  });

  it('every working ITEMS id is there (weapons / skills by slot)', () => {
    for (const id of ITEM_IDS.filter(implemented)) {
      expect(ids.has(id), id).toBe(true);
      expect(all.find((e) => e.id === id)!.tab).toBe(ITEMS[id].slot === 'weapon' ? 'weapon' : 'skill');
    }
    expect(ITEM_IDS.filter(implemented).length).toBe(codexEntries('weapon').length + codexEntries('skill').length);
  });

  it('every enemy of the variants table (30) is there, grouped by its base', () => {
    expect(ALL_ENEMY_KINDS).toHaveLength(30);
    const enemies = byId('enemy');
    for (const k of ALL_ENEMY_KINDS) {
      expect(enemies.has(k), k).toBe(true);
      expect(enemies.get(k)!.group).toBe(ENEMY_DEFS[ENEMY_DEFS[k].base].name);
    }
    expect(new Set(codexEntries('enemy').map((e) => e.group)).size).toBe(BASE_KINDS.length);
  });

  it('has the 4 mid-bosses and the Matron as the final boss', () => {
    const bosses = byId('boss');
    for (const id of MINIBOSS_IDS) {
      expect(bosses.has(id), id).toBe(true);
      expect(bosses.get(id)!.name).toBe(MINIBOSS_SPECS[id].name);
      expect(bosses.get(id)!.group).toBe('중간 보스');
    }
    expect(bosses.get('matron')!.group).toBe('최종 보스');
    expect(bosses.get('matron')!.name).toBe('강철 여교도관');
  });

  it('has every pickup kind, scroll colour, flask / fountain, alchemist upgrade and affix', () => {
    for (const id of ['cell', 'gold', 'flask', 'fountain']) expect(ids.has(id), id).toBe(true);
    for (const f of FOODS) expect(ids.has(`food_${f.id}`), f.id).toBe(true);
    for (const c of SCROLL_COLORS) expect(ids.has(`scroll_${c}`), c).toBe(true);
    for (const u of META_UPGRADES) {
      const e = all.find((x) => x.id === `meta_${u.id}`);
      expect(e, u.id).toBeTruthy();
      expect(e!.name).toBe(u.name);
      expect(e!.rows.some((r) => r.text.includes(String(u.cost))), `${u.id} shows its cost`).toBe(true);
    }
    for (const a of Object.keys(AFFIX_NAMES)) expect(ids.has(`affix_${a}`), a).toBe(true);
  });

  it('has 시체 조각 and 누더기 골렘 with their numbers taken from the tables', () => {
    const items = byId('item');
    const piece = items.get('corpse_piece')!;
    const text = piece.rows.map((r) => r.text).join(' | ');
    expect(piece.name).toBe('시체 조각');
    expect(text).toContain(`일반 적 ${CORPSE.drop.enemy} · 정예 ${CORPSE.drop.elite} · 중간 보스 ${CORPSE.drop.miniboss} · 강철 여교도관 ${CORPSE.drop.matron}`);
    expect(text).toContain('셀마');
    expect(text).toContain('맡겨');
    expect(text).toContain(`적 체력 +${Math.round(LOOP.hp * 100)}%`);
    expect(text).toContain(`정예 확률 +${Math.round(LOOP.elite * 100)}%p`);
    expect(piece.preview.sheet).toBe('corpse');
    const golem = items.get('rag_golem')!;
    const g = golem.rows.map((r) => r.text).join(' | ');
    expect(g).toContain(`시체 조각 ${golemCost(1)}개`);
    expect(g).toContain(`최대 ${golemCost(LOOP.cap)}개`);
    expect(g).toContain(`${GOLEM.hp}`);
    expect(g).toContain(`피해 ${GOLEM.damage}`);
    expect(g).toContain(`예비동작 ${GOLEM.slam.windup}초`);
    expect(g).toContain(`${GOLEM.follow.near}–${GOLEM.follow.far}px`);
    expect(golem.preview.sheet).toBe('golem');
    // 통로 is called 쉼터 everywhere the player reads it
    for (const e of all) for (const t of [e.name, e.desc, ...e.rows.map((r) => r.text)]) expect(t, e.id).not.toContain('통로');
  });

  it('every entry has a Korean name and description, rows with text, and nothing is hidden behind ???', () => {
    for (const e of all) {
      expect(e.name.length, e.id).toBeGreaterThan(0);
      expect(hasHangul(e.name), `${e.id} name`).toBe(true);
      expect(hasHangul(e.desc), `${e.id} desc`).toBe(true);
      expect(e.rows.length, `${e.id} rows`).toBeGreaterThan(0);
      for (const r of e.rows) expect(r.text.trim().length, `${e.id} row ${r.label}`).toBeGreaterThan(0);
      for (const s of [e.name, e.desc, e.tag ?? '', ...e.rows.map((r) => r.text)]) {
        expect(s, e.id).not.toMatch(/\?\?\?|undefined|NaN|\[object/);
      }
    }
  });

  it('weapon / skill names use the item colour (unique items: the bone-gold unique colour)', () => {
    for (const e of [...codexEntries('weapon'), ...codexEntries('skill')]) {
      const d = ITEMS[e.id as keyof typeof ITEMS];
      expect(e.nameColor, e.id).toBe(d.unique ? UNIQUE_COLOR : COLOR_HEX[d.color]);
    }
  });
});

describe('codex previews point at real sheets and animations (public/assets/sprites/*.json)', () => {
  const all = buildCodex();

  it('the sprite manifests of the game are all readable', () => {
    // (the stash sheet is drawn by the art lane of docs/CONTENT4.md §6: until it lands the game uses a placeholder)
    for (const name of SHEETS) if (name !== 'stash') expect(onDisk(name), name).not.toBeNull();
  });

  it('the CONTENT3 art (corpse, seamstress, golem, new icons) is there and has the animations the codex and the props use', () => {
    for (const [name, anims] of Object.entries(NEW_SHEETS)) {
      const m = onDisk(name);
      expect(m, `${name}.json`).not.toBeNull();
      for (const a of anims) expect(Object.keys(m!.animations), `${name}/${a}`).toContain(a);
    }
    const icons = onDisk('icons');
    expect(icons, 'icons.json').not.toBeNull();
    for (const n of NEW_ICONS) {
      expect(Object.keys(icons!.animations), `icons/${n}`).toContain(n);
      expect(icons!.animations[n].frames).toBeGreaterThanOrEqual(1);
    }
  });

  it('every preview, prop and thumbnail uses an existing sheet and animation', () => {
    for (const e of all) {
      const check = (sheet: string, anim: string, what: string) => {
        const m = manifest(sheet);
        expect(m, `${e.id} ${what}: sheet ${sheet}`).not.toBeNull();
        expect(Object.keys(m!.animations), `${e.id} ${what}: ${sheet}/${anim}`).toContain(anim);
      };
      expect(e.preview.steps.length, e.id).toBeGreaterThan(0);
      for (const s of e.preview.steps) check(e.preview.sheet, s.anim, 'step');
      if (e.preview.rest) check(e.preview.sheet, e.preview.rest, 'rest');
      if (e.preview.prop) {
        expect(e.preview.prop.steps.length, e.id).toBeGreaterThan(0);
        for (const s of e.preview.prop.steps) check(e.preview.prop.sheet, s.anim, 'prop');
      }
      check(e.icon.sheet, e.icon.anim, 'icon');
    }
  });

  it('weapons play the heroine attack animations in the order of their combo', () => {
    for (const e of codexEntries('weapon')) {
      expect(e.preview.sheet).toBe('heroine');
      const w = WEAPONS[e.id as keyof typeof WEAPONS];
      if (w.kind === 'melee') expect(e.preview.steps.map((s) => s.anim)).toEqual(w.hits.map((h) => h.anim));
    }
    expect(byId('weapon').get('hunter_bow')!.preview.steps.map((s) => s.anim)).toEqual(['bow_draw', 'bow_shoot']);
    expect(byId('weapon').get('old_shield')!.preview.steps.map((s) => s.anim)).toEqual(['shield_block', 'shield_parry']);
  });

  it('skills show the heroine throwing / deploying next to their projectile, turret or trap sprite', () => {
    const skills = byId('skill');
    expect(skills.get('fire_grenade')!.preview.steps[0].anim).toBe('throw');
    expect(skills.get('ice_grenade')!.preview.steps[0].anim).toBe('throw');
    expect(skills.get('turret')!.preview.steps[0].anim).toBe('deploy');
    expect(skills.get('wolf_trap')!.preview.steps[0].anim).toBe('deploy');
    expect(skills.get('corpse_bomb')!.preview.steps[0].anim).toBe('throw');
    for (const id of ['bone_spikes', 'soul_lantern']) expect(skills.get(id)!.preview.steps[0].anim, id).toBe('deploy');
    expect(skills.get('chain_hook')!.preview.steps[0].anim).toBe('throw');
    // the unique skills drawn in code (spikes, flames, the hook) have no sprite of their own: only the cast is shown
    for (const e of skills.values()) expect(e.preview.prop?.sheet, e.id).toBe(['bone_spikes', 'soul_lantern', 'chain_hook'].includes(e.id) ? undefined : 'projectiles');
  });

  it('enemies and bosses cycle through every animation of their own sheet', () => {
    for (const e of [...codexEntries('enemy'), ...codexEntries('boss')]) {
      expect(e.preview.sheet, e.id).toBe(e.id);
      const names = Object.keys(manifest(e.id)!.animations);
      expect(e.preview.steps.map((s) => s.anim).sort(), e.id).toEqual([...names].sort());
    }
    for (const b of BASE_KINDS) expect(Object.keys(manifest(b)!.animations).sort()).toEqual([...ENEMY_ANIMS[b]].sort());
    expect(Object.keys(BOSS_ANIMS)).toHaveLength(5);
  });
});

describe('codex numbers come from the game tables (no drift)', () => {
  it('enemy hp / damage equal what a real enemy of that tier / elite gets', () => {
    for (const k of ALL_ENEMY_KINDS) {
      const n = enemyNumbers(ENEMY_DEFS[k]);
      const t1 = createEnemy(k, 0, 0, { tier: 1 }) as Enemy;
      const t2 = createEnemy(k, 0, 0, { tier: 2 }) as Enemy;
      const el = createEnemy(k, 0, 0, { tier: 1, elite: true }) as Enemy;
      expect(n.hp, k).toEqual([t1.maxHp, t2.maxHp]);
      expect(n.eliteHp, k).toBe(el.maxHp);
      const hit = ENEMY_DEFS[k].hit;
      expect(n.dmg, k).toEqual([Math.max(1, Math.round(hit * t1.dmgMult)), Math.max(1, Math.round(hit * t2.dmgMult))]);
      expect(n.eliteDmg, k).toBe(Math.max(1, Math.round(hit * el.dmgMult)));
    }
  });

  it('the enemy entry shows those numbers, its biomes and an elite line', () => {
    const e = byId('enemy').get('ghoul_frenzy')!;
    const n = enemyNumbers(ENEMY_DEFS.ghoul_frenzy);
    expect(e.rows.find((r) => r.label === '체력')!.text).toContain(`${n.hp[0]}`);
    expect(e.rows.find((r) => r.label === '체력')!.text).toContain(`${n.hp[1]}`);
    expect(e.rows.find((r) => r.label === '피해')!.text).toContain(`${n.dmg[1]}`);
    expect(e.rows.find((r) => r.label === '서식')!.text).toBe('감옥 후반 · 성벽');
    expect(e.rows.find((r) => r.label === '정예')!.text).toContain(`${n.eliteHp}`);
    expect(spawnLabel(ENEMY_DEFS.ghoul_plague)).toBe('감옥');
    expect(spawnLabel(ENEMY_DEFS.lancer)).toBe('성벽');
    expect(ENEMY_DEFS.ghoul.hit).toBe(9);
    expect(TIER2.hp).toBe(1.6);
    expect(ELITE.hp).toBe(3);
  });

  it('boss hp equals the real boss (mid-bosses scale with their biome tier)', () => {
    const bosses = byId('boss');
    for (const id of MINIBOSS_IDS) {
      const tier = MINIBOSS_SPECS[id].biome === 'ramparts' ? 2 : 1;
      const hp = createMiniBoss(id, 0, 0, tier).maxHp;
      expect(bosses.get(id)!.rows.find((r) => r.label === '체력')!.text, id).toContain(String(hp));
    }
    expect(createBoss(0, 0).maxHp).toBe(MATRON.hp);
    expect(bosses.get('matron')!.rows.find((r) => r.label === '체력')!.text).toContain(String(MATRON.hp));
    // mid-boss drops: one weapon + one skill, cells and gold
    expect(bosses.get('mb_witch')!.rows.find((r) => r.label === '보상')!.text).toMatch(/무기 1.*스킬 1.*셀 10.15.*골드 60.100/);
  });

  it('weapons list every hit damage of their combo, skills their cooldown', () => {
    for (const e of codexEntries('weapon')) {
      const w = WEAPONS[e.id as keyof typeof WEAPONS];
      if (w.kind !== 'melee') continue;
      const combo = e.rows.find((r) => r.label === '콤보')!.text;
      expect(combo, e.id).toContain(`${w.hits.length}연격`);
      expect(combo, e.id).toContain(w.hits.map((h) => h.damage).join(' / '));
    }
    expect(byId('weapon').get('spear')!.rows.find((r) => r.label === '치명타')!.text).toContain('3타');
    expect(byId('weapon').get('twin_daggers')!.rows.find((r) => r.label === '치명타')!.text).toContain('등 뒤');
    expect(byId('weapon').get('blood_sword')!.rows.find((r) => r.label === '특수')!.text).toContain('출혈');
    expect(byId('weapon').get('war_hammer')!.rows.find((r) => r.label === '특수')!.text).toContain('기절');
    for (const e of codexEntries('skill')) {
      expect(e.rows.find((r) => r.label === '재사용')!.text, e.id).toBe(`${ITEMS[e.id as keyof typeof ITEMS].cooldown}초`);
    }
  });
});

describe('preview timing', () => {
  it('fitScale gives whole device pixels per sprite pixel when the sprite fits at 1:1 or larger, and shrinks otherwise', () => {
    for (const dev of [1, 1.083, 2, 2.625, 3]) {
      const s = fitScale(200, 100, 40, 50, dev);
      expect(Number.isInteger(Math.round(s * dev * 1e6) / 1e6), `dev ${dev}`).toBe(true);
      expect(40 * s).toBeLessThanOrEqual(200 + 1e-6);
      expect(50 * s).toBeLessThanOrEqual(100 + 1e-6);
      expect(s * dev).toBeGreaterThanOrEqual(1);
    }
    // too big for the plate: scaled down to fit, not clipped
    const s = fitScale(100, 60, 300, 200, 1);
    expect(s).toBeLessThan(1);
    expect(300 * s).toBeLessThanOrEqual(100 + 1e-6);
    expect(200 * s).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('a step list becomes a timeline: loops show ~1.5 s, one-shots play once and rest', () => {
    const sheet = realSheet('heroine');
    const { slots, total } = previewSlots(sheet, [{ anim: 'idle' }, { anim: 'sword_1', dur: 0.28, hold: 0.1 }]);
    expect(slots[0].start).toBe(0);
    expect(slots[0].dwell).toBeGreaterThanOrEqual(1.5);
    expect(slots[1].start).toBeCloseTo(slots[0].dwell, 6);
    expect(slots[1].dwell).toBeCloseTo(0.38, 6);
    expect(total).toBeCloseTo(slots[0].dwell + 0.38, 6);
    const def = sheet.anim('sword_1');
    expect(frameAt(def, 0.28, 0)).toBe(0);
    expect(frameAt(def, 0.28, 0.14)).toBe(Math.floor(def.frames / 2));
    expect(frameAt(def, 0.28, 5)).toBe(def.frames - 1);
    const idle = sheet.anim('idle');
    expect(frameAt(idle, 1, 10)).toBeLessThan(idle.frames);
  });
});

describe('codex layout', () => {
  const rects = (L: ReturnType<typeof codexLayout>) => ({
    title: { x: 12, y: 8, w: 56, h: 34 },
    ...Object.fromEntries(L.tabs.map((t, i) => [`tab${i}`, t])),
    close: L.close, list: L.list, detail: L.detail, hint: L.hint,
  });
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

  for (const W of [480, 560, 640, 720, 800]) {
    it(`nothing overlaps and everything is on screen (W=${W})`, () => {
      const L = codexLayout(W, 360);
      const r = rects(L);
      const names = Object.keys(r) as (keyof typeof r)[];
      for (const n of names) expect(inside(r[n], { x: 0, y: 0, w: W, h: 360 }), `${n} on screen`).toBe(true);
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) expect(overlap(r[names[i]], r[names[j]]), `${names[i]} vs ${names[j]}`).toBe(false);
      // inside the detail panel: preview, head and body are disjoint and contained
      const inner = { preview: L.preview, body: L.body, ...(L.head ? { head: L.head } : {}) } as Record<string, { x: number; y: number; w: number; h: number }>;
      const keys = Object.keys(inner);
      for (const k of keys) expect(inside(inner[k], L.detail), `${k} inside detail`).toBe(true);
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) expect(overlap(inner[keys[i]], inner[keys[j]]), `${keys[i]} vs ${keys[j]}`).toBe(false);
      // usable sizes
      expect(L.preview.w).toBeGreaterThanOrEqual(150);
      expect(L.preview.h).toBeGreaterThanOrEqual(88);
      expect(L.body.h).toBeGreaterThanOrEqual(110);
      expect(L.list.w).toBeGreaterThanOrEqual(160);
      for (const t of L.tabs) expect(t.h).toBeGreaterThanOrEqual(34);
      // the tab row never reaches the close button
      expect(L.tabs[L.tabs.length - 1].x + L.tabs[L.tabs.length - 1].w).toBeLessThan(L.close.x);
    });
  }

  it('is wide (preview beside the name) only when the detail panel has room', () => {
    expect(codexLayout(480, 360).wide).toBe(false);
    expect(codexLayout(640, 360).wide).toBe(false);
    expect(codexLayout(800, 360).wide).toBe(true);
    expect(codexLayout(800, 360).head).not.toBeNull();
    expect(codexLayout(480, 360).head).toBeNull();
  });
});

describe('CodexScreen navigation', () => {
  it('left / right and LB / RB (tabL / tabR) switch tabs and wrap around', () => {
    const { sc } = open();
    expect(sc.tab).toBe('weapon');
    sc.key('right');
    expect(sc.tab).toBe('skill');
    sc.key('tabR');
    expect(sc.tab).toBe('enemy');
    sc.key('tabL');
    sc.key('left');
    expect(sc.tab).toBe('weapon');
    sc.key('left');
    expect(sc.tab).toBe(CODEX_TABS[CODEX_TABS.length - 1].id);
    sc.key('right');
    expect(sc.tab).toBe('weapon');
  });

  it('up / down move the selection (clamped), every tab has its own, and the list follows', () => {
    const { sc, frame } = open(640, 'enemy');
    expect(sc.sel[2]).toBe(0);
    sc.key('down');
    sc.key('down');
    expect(sc.current.id).toBe(codexEntries('enemy')[2].id);
    sc.key('up');
    sc.key('up');
    sc.key('up');
    expect(sc.sel[2]).toBe(0);
    for (let i = 0; i < 40; i++) sc.key('down');
    expect(sc.sel[2]).toBe(29);
    frame();
    expect(sc.listOffset).toBeGreaterThan(0); // scrolled so that the last enemy is visible
    sc.key('right');
    expect(sc.tab).toBe('boss');
    expect(sc.sel[3]).toBe(0);
    sc.key('left');
    expect(sc.sel[2]).toBe(29); // remembered
    sc.key('up');
    frame();
    expect(sc.current.id).toBe(codexEntries('enemy')[28].id);
  });

  it('confirm (Enter / J / A) switches to the next animation of the preview, wrapping at the end', () => {
    const { sc } = open(640, 'enemy');
    const n = sc.current.preview.steps.length;
    expect(sc.animIndex).toBe(0);
    sc.key('confirm');
    expect(sc.animIndex).toBe(1);
    for (let i = 0; i < n - 1; i++) sc.key('confirm');
    expect(sc.animIndex).toBe(0);
  });

  it('the preview advances by itself, and picking another entry restarts it', () => {
    const { sc } = open(640, 'weapon');
    const steps = sc.current.preview.steps.length; // sword: 3 hits
    expect(steps).toBe(3);
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) {
      sc.update(1 / 60);
      seen.add(sc.animIndex);
    }
    expect(seen.size).toBe(3);
    for (let i = 0; i < 70; i++) sc.update(1 / 60);
    sc.key('down');
    expect(sc.animIndex).toBe(0);
  });

  it('cancel (Esc / B) and pause (Start) close it once', () => {
    const a = open();
    a.sc.key('cancel');
    a.sc.key('cancel');
    expect(a.onClose).toHaveBeenCalledTimes(1);
    const b = open();
    b.sc.key('pause');
    expect(b.onClose).toHaveBeenCalledTimes(1);
    const c = open();
    c.sc.key('map'); // ignored
    c.sc.key('confirm');
    expect(c.onClose).not.toHaveBeenCalled();
  });

  it('the gamepad maps A / B / D-pad to nav keys and LB / RB to tab switching', () => {
    const snap = (pressed: number[]) => ({ id: 'pad', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => pressed.includes(i)) });
    const nav = (b: number) => mapPad(snap([b]), DEFAULT_PAD_MAP, newPadState()).frame.nav;
    expect(nav(4)).toContain('tabL');
    expect(nav(5)).toContain('tabR');
    expect(nav(0)).toContain('confirm');
    expect(nav(1)).toContain('cancel');
    expect(nav(14)).toContain('left');
    expect(nav(15)).toContain('right');
    expect(nav(12)).toContain('up');
    expect(nav(13)).toContain('down');
    // remapping the shoulder buttons in the settings does not change the menu
    expect(mapPad(snap([5]), { ...DEFAULT_PAD_MAP, heal: 5, interact: 4 }, newPadState()).frame.nav).toContain('tabR');
  });

  it('right stick up / down makes scroll keys: one at once, then auto-repeat while held; the left stick and a pad of unknown layout do not', () => {
    const snap = (axes: number[], standard?: boolean) => ({ id: 'pad', axes, buttons: Array.from({ length: 17 }, () => false), standard });
    let r = mapPad(snap([0, 0, 0, 1]), DEFAULT_PAD_MAP, newPadState());
    expect(r.frame.nav).toEqual(['scrollDown']);
    expect(r.frame.active).toBe(true);
    let st = r.next;
    const seen: number[] = [];
    let t = 0;
    for (let i = 0; i < 90; i++) {
      r = mapPad(snap([0, 0, 0, 1]), DEFAULT_PAD_MAP, st, 1 / 60);
      st = r.next;
      t += 1 / 60;
      if (r.frame.nav.includes('scrollDown')) seen.push(t);
      expect(r.frame.nav).not.toContain('down'); // the right stick is not the D-pad
    }
    expect(seen.length).toBeGreaterThanOrEqual(10);
    expect(seen[0]).toBeGreaterThanOrEqual(PAD_SCROLL_DELAY - 0.02);
    expect(seen[1] - seen[0]).toBeLessThan(0.1);
    // letting go and pushing up: an edge again, the other way
    st = mapPad(snap([0, 0, 0, 0]), DEFAULT_PAD_MAP, st).next;
    expect(mapPad(snap([0, 0, 0, -1]), DEFAULT_PAD_MAP, st).frame.nav).toEqual(['scrollUp']);
    // dead-zone, left stick, sideways push, and a pad whose layout the browser does not know: nothing
    expect(mapPad(snap([0, 0, 0, 0.2]), DEFAULT_PAD_MAP, newPadState()).frame.nav).toEqual([]);
    expect(mapPad(snap([0, 1, 0, 0]), DEFAULT_PAD_MAP, newPadState()).frame.nav).toEqual(['down']);
    expect(mapPad(snap([0, 0, 1, 0]), DEFAULT_PAD_MAP, newPadState()).frame.nav).toEqual([]);
    expect(mapPad(snap([0, 0, 0, 1], false), DEFAULT_PAD_MAP, newPadState()).frame.nav).toEqual([]);
  });
});

describe('CodexScreen detail scrolling with keys and the pad (a page that does not fit)', () => {
  const DOWN = ['scrollDown', 'pageDown'] as const;

  it('the final boss page at the narrow width overflows and every key reaches both ends of it', () => {
    const { sc, frame } = open(480, 'boss');
    sc.select(4); // Matron: the longest page
    frame();
    const max = sc.bodyMax;
    expect(max).toBeGreaterThan(0);
    expect(sc.bodyOffset).toBe(0);
    sc.key('scrollDown');
    expect(sc.bodyOffset).toBe(Math.min(max, 28)); // two lines
    sc.key('scrollUp');
    expect(sc.bodyOffset).toBe(0);
    sc.key('scrollUp'); // clamped at the top
    expect(sc.bodyOffset).toBe(0);
    sc.key('pageDown');
    expect(sc.bodyOffset).toBeGreaterThan(28);
    sc.key('scrollEnd');
    expect(sc.bodyOffset).toBe(max);
    sc.key('scrollDown'); // clamped at the end
    sc.key('pageDown');
    expect(sc.bodyOffset).toBe(max);
    sc.key('pageUp');
    expect(sc.bodyOffset).toBeLessThan(max);
    sc.key('scrollTop');
    expect(sc.bodyOffset).toBe(0);
    // the list and the selection are not touched by it
    expect(sc.current.id).toBe(codexEntries('boss')[4].id);
    expect(sc.listOffset).toBe(0);
  });

  for (const W of [480, 560, 640, 740, 800]) {
    it(`every page of every tab can be read to its last line with PageDown / Shift+arrows (W=${W})`, () => {
      const { sc, frame } = open(W);
      let overflowing = 0;
      for (let ti = 0; ti < CODEX_TABS.length; ti++) {
        sc.setTab(ti);
        for (let i = 0; i < sc.entries().length; i++) {
          sc.select(i);
          frame();
          const max = sc.bodyMax;
          expect(sc.bodyOffset).toBe(0); // a new page starts at the top
          if (max > 0) overflowing++;
          for (const k of DOWN) {
            sc.key('scrollTop');
            let guard = 0;
            let last = -1;
            while (sc.bodyOffset !== last && guard++ < 60) {
              last = sc.bodyOffset;
              sc.key(k);
              frame();
            }
            expect(sc.bodyOffset, `${W} ${sc.current.id} ${k}`).toBe(max);
          }
          sc.key('scrollEnd');
          expect(sc.bodyOffset).toBe(max);
        }
      }
      if (W <= 640) expect(overflowing).toBeGreaterThan(0); // the narrow layouts do have pages that do not fit
    });
  }

  it('a page that fits does not scroll and shows no scroll key in the hint', () => {
    const log: string[] = [];
    const { sc, frame } = open(800, 'item', 'keyboard', log);
    frame();
    expect(sc.bodyMax).toBe(0);
    sc.key('pageDown');
    sc.key('scrollEnd');
    expect(sc.bodyOffset).toBe(0);
    expect(log.some((t) => t.includes('PgUp/PgDn'))).toBe(false);
  });

  it('the hint names the scroll keys of the device only while the page overflows', () => {
    for (const [device, word] of [['keyboard', 'PgUp/PgDn'], ['gamepad', 'R스틱']] as const) {
      const log: string[] = [];
      const { sc, frame } = open(480, 'boss', device, log);
      sc.select(4);
      log.length = 0;
      frame();
      expect(sc.bodyMax).toBeGreaterThan(0);
      const hint = log.find((t) => t.includes('선택'));
      expect(hint, device).toBeDefined();
      expect(hint!.includes(word), `${device}: ${hint}`).toBe(true);
    }
    // touch users already read "드래그로 스크롤"
    const log: string[] = [];
    const { frame } = open(480, 'boss', 'touch', log);
    log.length = 0;
    frame();
    expect(log.some((t) => t.includes('드래그로 스크롤'))).toBe(true);
  });

  it('the scroll keys are ignored for the list and before anything was drawn', () => {
    const game = makeGame();
    const sc = new CodexScreen(game, vi.fn(), 'boss');
    sc.key('pageDown'); // never drawn: nothing to measure, nothing breaks
    sc.key('scrollEnd');
    expect(sc.bodyOffset).toBe(0);
  });
});

describe('CodexScreen: row labels', () => {
  // the label column grows with the widest (bold) label of the page; the fake measure is 0.9 em per glyph like the real font
  for (const W of [480, 640, 800]) {
    it(`a unique item's long label ("고유 효과") never runs into its value text (W=${W})`, () => {
      const at: { s: string; x: number; y: number; bold: boolean }[] = [];
      const { sc, frame } = open(W, 'weapon', 'keyboard', undefined, at);
      const i = sc.entries().findIndex((e) => e.id === 'bone_cleaver');
      expect(i).toBeGreaterThanOrEqual(0);
      sc.select(i);
      for (let k = 0; k < 4; k++) frame(0.7);
      at.length = 0;
      frame();
      const row = sc.current.rows[0];
      expect(row.label).toBe('고유 효과');
      const label = at.find((t) => t.s === row.label);
      expect(label, 'the label is drawn').toBeTruthy();
      // its value starts on the same row (same baseline), to the right of it
      const value = at.find((t) => t !== label && t.y === label!.y && t.x > label!.x);
      expect(value, 'the value is drawn').toBeTruthy();
      const labelW = [...row.label].length * 11 * 0.9;
      expect(value!.x - label!.x, `label ${labelW}px wide`).toBeGreaterThanOrEqual(labelW + 4);
    });
  }

  it('pages with short labels keep the narrow label column (nothing else grows)', () => {
    const at: { s: string; x: number; y: number; bold: boolean }[] = [];
    const { sc, frame } = open(640, 'weapon', 'keyboard', undefined, at);
    const i = sc.entries().findIndex((e) => e.id === 'rusty_sword');
    sc.select(i);
    for (let k = 0; k < 4; k++) frame(0.7);
    at.length = 0;
    frame();
    const label = at.find((t) => t.s === '콤보')!;
    const value = at.find((t) => t !== label && t.y === label.y && t.x > label.x)!;
    expect(value.x - label.x).toBe(44);
  });
});

describe('CodexScreen drawing and touch', () => {
  for (const W of [480, 640, 800]) {
    it(`draws every tab and entry without errors and registers sensible tap regions (W=${W})`, () => {
      const { game, sc, frame } = open(W);
      for (const t of CODEX_TABS) {
        sc.setTab(CODEX_TABS.findIndex((x) => x.id === t.id));
        const n = sc.entries().length;
        for (let i = 0; i < n; i++) {
          sc.select(i);
          for (let k = 0; k < 4; k++) frame(0.7);
          const ids = game.taps.regions.map((r: { id: string }) => r.id);
          expect(ids).toContain('codex-close');
          expect(ids).toContain('codex-preview');
          expect(ids).toContain('codex-body');
          expect(ids).toContain('codex-entry-' + sc.entries()[i].id); // the selected row is always on screen
          expect(game.taps.byId('codex-entry-' + sc.entries()[i].id).rect.h).toBeGreaterThanOrEqual(30); // and a comfortable target
          for (const c of CODEX_TABS) expect(ids).toContain('codex-tab-' + c.id);
        }
        for (const r of game.taps.regions) {
          if (r.id === 'modal-bg') continue;
          expect(r.rect.x, r.id).toBeGreaterThanOrEqual(0);
          expect(r.rect.y, r.id).toBeGreaterThanOrEqual(0);
          expect(r.rect.x + r.rect.w, r.id).toBeLessThanOrEqual(W + 0.001);
          expect(r.rect.y + r.rect.h, r.id).toBeLessThanOrEqual(360.001);
          if (r.id.startsWith('codex-tab-') || r.id === 'codex-close') expect(r.rect.h, r.id).toBeGreaterThanOrEqual(36);
        }
      }
    });
  }

  it('taps are ignored while the finger that opened it is still lifting', () => {
    const game = makeGame();
    const sc = new CodexScreen(game, vi.fn());
    const ctx = fakeCtx();
    sc.update(0.05);
    game.taps.clear();
    sc.draw(ctx, 640, 360);
    expect(game.taps.byId('codex-close')).toBeNull();
    expect(game.taps.byId('modal-bg')).not.toBeNull(); // but the screen still swallows the touch
    sc.update(0.3);
    game.taps.clear();
    sc.draw(ctx, 640, 360);
    expect(game.taps.byId('codex-close')).not.toBeNull();
  });

  it('tapping tabs, entries and the preview works; the close button closes', () => {
    const { game, sc, frame, onClose } = open(640);
    game.taps.byId('codex-tab-enemy').onTap();
    expect(sc.tab).toBe('enemy');
    frame();
    const target = codexEntries('enemy')[3];
    game.taps.byId('codex-entry-' + target.id).onTap();
    expect(sc.current.id).toBe(target.id);
    frame();
    game.taps.byId('codex-preview').onTap();
    expect(sc.animIndex).toBe(1);
    game.taps.byId('codex-close').onTap();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dragging the list scrolls it, a flick keeps it going and then stops', () => {
    const { game, sc, frame } = open(640, 'enemy');
    expect(sc.listOffset).toBe(0);
    const drag = game.taps.byId('codex-list').onDrag;
    drag(0, -30);
    expect(sc.listOffset).toBe(30);
    drag(0, 500); // past the top: clamped
    expect(sc.listOffset).toBe(0);
    drag(0, -1e5); // and past the end
    const max = sc.listOffset;
    expect(max).toBeGreaterThan(300);
    drag(0, 1e5);
    expect(sc.listOffset).toBe(0);
    // a quick series of moves, then the finger lifts: the list coasts on
    for (let i = 0; i < 5; i++) {
      game.taps.clear();
      drag(0, -14);
      frame();
    }
    const at = sc.listOffset;
    expect(at).toBeGreaterThan(40);
    for (let i = 0; i < 6; i++) frame(); // finger idle -> fling starts
    const coasted = sc.listOffset;
    expect(coasted).toBeGreaterThan(at);
    for (let i = 0; i < 240; i++) frame();
    const rest = sc.listOffset;
    for (let i = 0; i < 30; i++) frame();
    expect(sc.listOffset).toBe(rest); // came to rest
    expect(rest).toBeLessThanOrEqual(max); // never beyond the content
  });

  it('long detail text scrolls by dragging (bosses at the narrow width)', () => {
    const { game, sc, frame } = open(480, 'boss');
    sc.select(4); // Matron: the longest page
    for (let i = 0; i < 3; i++) frame();
    expect(sc.bodyOffset).toBe(0);
    game.taps.byId('codex-body').onDrag(0, -40);
    expect(sc.bodyOffset).toBeGreaterThan(0);
    game.taps.byId('codex-body').onDrag(0, 400);
    expect(sc.bodyOffset).toBe(0);
    sc.select(3); // a new entry starts at the top again
    expect(sc.bodyOffset).toBe(0);
  });
});

describe('도감 in the pause menu', () => {
  function pauseUI() {
    const { world, game } = makeTestWorld();
    game.display = { W: 640, H: 360, scale: 1, offsetX: 0, offsetY: 0, canvas: null };
    game.taps = new TapRegistry();
    game.assets = { sheet: realSheet, image: () => undefined, json: new Map() };
    game.persist = vi.fn();
    game.playerDied = vi.fn();
    (world as any).player = { hp: 60, maxHp: 100, recoverable: 10, nearInteract: null, skillCooldown: [0, 0], skillCooldownMax: [10, 10], x: 200, y: 200, h: 40, w: 14, dying: false };
    const ui = new LevelUI(game, world);
    world.ui = ui;
    game.scene = { ui };
    const ctx = fakeCtx();
    const frame = (dt = 1 / 60) => { game.taps.clear(); ui.update(dt); ui.draw(ctx); };
    return { ui, game, frame, world };
  }

  it('the pause menu has a 도감 button that opens the codex over the paused run, Esc goes back to the pause menu', () => {
    const { ui, game, frame } = pauseUI();
    ui.openPause();
    frame();
    expect(ui.top).toBeInstanceOf(PauseModal);
    for (let i = 0; i < 20; i++) frame();
    game.taps.byId('pause4').onTap(); // 설정 is pause3, 도감 pause4
    expect(ui.top).toBeInstanceOf(CodexModal);
    expect(ui.modal).toBe(true); // the world stays paused
    for (let i = 0; i < 20; i++) frame();
    const codex = (ui.top as CodexModal).screen;
    ui.key('right');
    expect(codex.tab).toBe('skill');
    ui.nav('tabR'); // LB / RB
    expect(codex.tab).toBe('enemy');
    ui.nav('tabL');
    ui.nav('down');
    expect(codex.sel[1]).toBe(1);
    ui.key('cancel');
    expect(ui.top).toBeInstanceOf(PauseModal);
    // the give-up button moved to the end and still needs two taps
    frame();
    expect(game.taps.byId('pause5')).not.toBeNull();
    expect(game.playerDied).not.toHaveBeenCalled();
  });

  it('in the pause menu PageUp / PageDown / Home / End, Shift+arrows and the right stick scroll the detail text', () => {
    const { ui, game, frame } = pauseUI();
    game.display.W = 480;
    ui.openPause();
    for (let i = 0; i < 20; i++) frame();
    game.taps.byId('pause4').onTap();
    for (let i = 0; i < 20; i++) frame();
    const codex = (ui.top as CodexModal).screen;
    codex.setTab(3);
    codex.select(4);
    frame();
    const max = codex.bodyMax;
    expect(max).toBeGreaterThan(0);
    const key = (code: string, shift = false) => (ui as any).onKeyDown({ code, shiftKey: shift, repeat: false, ctrlKey: false, altKey: false, metaKey: false });
    key('PageDown');
    expect(codex.bodyOffset).toBeGreaterThan(0);
    key('End');
    expect(codex.bodyOffset).toBe(max);
    key('PageUp');
    expect(codex.bodyOffset).toBeLessThan(max);
    key('Home');
    expect(codex.bodyOffset).toBe(0);
    key('ArrowDown', true); // Shift+down = two lines, the selection stays
    expect(codex.bodyOffset).toBe(Math.min(max, 28));
    expect(codex.current.id).toBe(codexEntries('boss')[4].id);
    key('ArrowUp', true);
    expect(codex.bodyOffset).toBe(0);
    key('ArrowUp'); // plain arrows still pick the entry
    expect(codex.current.id).toBe(codexEntries('boss')[3].id);
    codex.select(4);
    ui.nav('scrollDown'); // right stick
    expect(codex.bodyOffset).toBeGreaterThan(0);
    ui.nav('scrollUp');
    expect(codex.bodyOffset).toBe(0);
    ui.nav('pageDown');
    ui.nav('scrollEnd');
    expect(codex.bodyOffset).toBe(max);
    expect(ui.top).toBeInstanceOf(CodexModal); // none of them closes or changes anything else
  });

  it('Shift + arrows still move the selection in the other menus', () => {
    const { ui, game, frame } = pauseUI();
    ui.openPause();
    for (let i = 0; i < 20; i++) frame();
    const top = ui.top as any;
    const before = top.sel ?? top.focus;
    (ui as any).onKeyDown({ code: 'ArrowDown', shiftKey: true, repeat: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(game.taps.byId('pause4')).not.toBeNull();
    expect(ui.top).toBeInstanceOf(PauseModal);
    expect(top.sel ?? top.focus).not.toBe(before);
  });

  it('the close button and the Start button close the codex but not the pause menu', () => {
    const { ui, game, frame } = pauseUI();
    ui.openPause();
    for (let i = 0; i < 20; i++) frame();
    game.taps.byId('pause4').onTap();
    for (let i = 0; i < 20; i++) frame();
    game.taps.byId('codex-close').onTap();
    expect(ui.top).toBeInstanceOf(PauseModal);
    for (let i = 0; i < 20; i++) frame();
    game.taps.byId('pause4').onTap();
    for (let i = 0; i < 20; i++) frame();
    ui.nav('pause'); // Start = back, like Esc
    expect(ui.top).toBeInstanceOf(PauseModal);
    ui.nav('pause'); // and Start again closes the pause menu: the run goes on
    expect(ui.modal).toBe(false);
  });
});
