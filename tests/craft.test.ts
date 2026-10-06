import { describe, it, expect, vi } from 'vitest';
import { makeTestWorld, steps, flatMap } from './helpers';
import { Player } from '../src/game/player/player';
import { LevelUI } from '../src/game/ui/levelUI';
import { CraftModal, craftLayout } from '../src/game/ui/craftModal';
import { TapRegistry } from '../src/game/ui/taps';
import { defaultSave } from '../src/game/meta/save';
import { CRAFT, CRAFT_MIN_TIER, GRADES, GRADE_IDS, STASH, type Grade } from '../src/game/rules';
import { ITEMS, itemLines } from '../src/game/items/items';
import { ITEM_IDS, UNIQUE_IDS, type ItemId, type ItemInstance } from '../src/game/items/types';
import { craftUnique, materialLabel, planCraft, qualifies, recipeText, shardLabel, uniquesOf } from '../src/game/meta/craft';
import { Seamstress } from '../src/game/props';
import { buildCodex, codexEntries } from '../src/game/ui/codexData';
import { Hud } from '../src/game/ui/hud';

const FLOOR = 16 * 24;
const mk = (id: ItemId, tier = 1, affix: ItemInstance['affix'] = null, mb = false): ItemInstance => ({ id, tier, affix, ...(mb ? { mb: true as const } : {}) });
/** a save with `stash` and (by default) everything else the recipe could ask for */
const saveWith = (stash: ItemInstance[], extra: { pieces?: number; shards?: number[] } = {}) => {
  const s = defaultSave();
  s.stash = stash;
  s.pieces = extra.pieces ?? 500;
  s.shards = extra.shards ?? [1, 2, 3, 4];
  return s;
};

// ---------------------------------------------------------------------------------------------------------------------
describe('the tables of docs/CONTENT4.md §4 (rules.ts)', () => {
  it('six grades C B A S SS SSS with the badge colours, salvage values and power targets of the spec', () => {
    expect([...GRADE_IDS]).toEqual(['C', 'B', 'A', 'S', 'SS', 'SSS']);
    expect(GRADE_IDS.map((g) => GRADES[g].color)).toEqual(['#9aa4b2', '#5ec24a', '#4f9dff', '#b05be8', '#ff9a3d', '#ff4a58']);
    expect(GRADE_IDS.map((g) => GRADES[g].salvage)).toEqual([5, 10, 20, 35, 55, 80]);
    expect(GRADE_IDS.map((g) => GRADES[g].power)).toEqual([0.15, 0.2, 0.3, 0.45, 0.6, 0.8]);
    expect(GRADES.SSS.outline).toBe('#ffd23f');
    for (const g of GRADE_IDS.slice(0, 5)) expect(GRADES[g].outline).toBeUndefined();
  });

  it('the recipes: stash items, special lines, bank pieces and the tier of the unique', () => {
    expect(CRAFT_MIN_TIER).toBe(2);
    expect(CRAFT.C).toEqual({ items: [{ n: 3, what: 'any' }], shards: null, pieces: 10, tier: 1 });
    expect(CRAFT.B).toEqual({ items: [{ n: 3, what: 'affix' }], shards: null, pieces: 20, tier: 2 });
    expect(CRAFT.A).toEqual({ items: [{ n: 2, what: 'tier' }, { n: 1, what: 'mb' }], shards: null, pieces: 35, tier: 2 });
    expect(CRAFT.S).toEqual({ items: [{ n: 1, what: 'unique', grade: 'A' }, { n: 2, what: 'mb' }], shards: { n: 1, minLoop: 1 }, pieces: 50, tier: 3 });
    expect(CRAFT.SS).toEqual({ items: [{ n: 1, what: 'unique', grade: 'S' }, { n: 1, what: 'unique', grade: 'A' }], shards: { n: 2, minLoop: 2 }, pieces: 80, tier: 3 });
    expect(CRAFT.SSS).toEqual({ items: [{ n: 1, what: 'unique', grade: 'SS' }, { n: 1, what: 'unique', grade: 'S' }], shards: { n: 3, minLoop: 3 }, pieces: 120, tier: 4 });
  });
});

describe('the catalogue: 63 kinds, 30 uniques in six grades', () => {
  const spec: Record<Grade, ItemId[]> = {
    C: ['bone_cleaver', 'stitch_needle', 'coffin_lid', 'bone_spikes', 'chain_hook'],
    B: ['reaper_scythe', 'widow_fangs', 'marrow_bow', 'corpse_bomb', 'soul_lantern'],
    A: ['grave_bell', 'leech_whip', 'bone_rampart', 'plague_censer', 'bone_turret'],
    S: ['executioner_blade', 'storm_staff', 'moon_glaives', 'death_orb', 'chain_prison'],
    SS: ['matron_flail', 'soulfire_bow', 'bell_aegis', 'rag_doll', 'crimson_rain'],
    SSS: ['selma_shears', 'ember_blade', 'ninefold_whip', 'last_bell', 'requiem'],
  };

  it('ITEM_IDS has all 63 ids once: 21 weapons + 12 skills ordinary, 18 weapons + 12 skills unique', () => {
    expect(ITEM_IDS).toHaveLength(63);
    expect(new Set(ITEM_IDS).size).toBe(63);
    expect(Object.keys(ITEMS).sort()).toEqual([...ITEM_IDS].sort());
    const kinds = (unique: boolean, slot: string) => ITEM_IDS.filter((i) => !!ITEMS[i].unique === unique && ITEMS[i].slot === slot).length;
    expect([kinds(false, 'weapon'), kinds(false, 'skill'), kinds(true, 'weapon'), kinds(true, 'skill')]).toEqual([21, 12, 18, 12]);
  });

  it('every grade has its five uniques (3 weapons + 2 skills), graded in ITEMS, in UNIQUE_IDS order', () => {
    expect(UNIQUE_IDS).toHaveLength(30);
    for (const g of GRADE_IDS) {
      expect(uniquesOf(g), g).toEqual(spec[g]);
      expect(spec[g].filter((i) => ITEMS[i].slot === 'weapon'), g).toHaveLength(3);
      for (const id of spec[g]) expect([ITEMS[id].unique, ITEMS[id].grade, ITEMS[id].icon], id).toEqual([true, g, id]);
    }
    expect([...UNIQUE_IDS]).toEqual(GRADE_IDS.flatMap((g) => spec[g]));
    for (const id of ITEM_IDS) if (!UNIQUE_IDS.includes(id)) expect(ITEMS[id].grade, id).toBeUndefined();
  });

  it('every entry has a Korean name and short description (16 characters at most), an icon named like its id, and the spec colour / slot', () => {
    const colors: Partial<Record<ItemId, string>> = {
      broadsword: 'brutality', frantic_sword: 'brutality', rapier: 'tactics', sadist_stiletto: 'tactics', grave_shovel: 'survival', torch: 'brutality',
      leather_whip: 'tactics', iron_katana: 'brutality', multi_bow: 'tactics', ice_bow: 'tactics', heavy_crossbow: 'brutality', throwing_knives: 'tactics',
      fire_staff: 'brutality', spiked_shield: 'brutality', stun_grenade: 'tactics', magnet_grenade: 'tactics', cluster_grenade: 'brutality',
      tesla_coil: 'tactics', flame_turret: 'brutality', phaser: 'tactics', wave_of_denial: 'survival', tornado: 'survival',
      grave_bell: 'survival', leech_whip: 'brutality', bone_rampart: 'survival', plague_censer: 'survival', bone_turret: 'tactics',
      executioner_blade: 'brutality', storm_staff: 'tactics', moon_glaives: 'tactics', death_orb: 'brutality', chain_prison: 'survival',
      matron_flail: 'brutality', soulfire_bow: 'tactics', bell_aegis: 'survival', rag_doll: 'survival', crimson_rain: 'brutality',
      selma_shears: 'brutality', ember_blade: 'tactics', ninefold_whip: 'tactics', last_bell: 'survival', requiem: 'brutality',
    };
    expect(Object.keys(colors)).toHaveLength(42);
    for (const id of ITEM_IDS) {
      const d = ITEMS[id];
      expect(/[가-힣]/.test(d.name), `${id} name`).toBe(true);
      expect([...d.desc].length, `${id} desc`).toBeLessThanOrEqual(16);
      expect(d.desc.length, `${id} desc`).toBeGreaterThan(0);
      expect(d.icon, id).toBe(id);
      if (colors[id]) expect(d.color, id).toBe(colors[id]);
      if (d.slot === 'skill') expect(d.cooldown, id).toBeGreaterThan(0);
    }
    // the cooldowns the spec names
    const cd: Partial<Record<ItemId, number>> = { stun_grenade: 12, magnet_grenade: 13, cluster_grenade: 14, tesla_coil: 16, flame_turret: 15, phaser: 10, wave_of_denial: 11, tornado: 15, last_bell: 40 };
    for (const [id, c] of Object.entries(cd)) expect(ITEMS[id as ItemId].cooldown, id).toBe(c);
    expect(ITEMS.broadsword.name).toBe('대검');
    expect(ITEMS.selma_shears.name).toBe('셀마의 대가위');
    expect(ITEMS.ninefold_whip.name).toBe('아홉 꼬리 채찍');
  });

  it('of the new items only the four ★ ordinary ones are in the starting pool (the other ordinary ones are Alchemist blueprints), the uniques never are', () => {
    const save = defaultSave();
    const star: ItemId[] = ['grave_shovel', 'leather_whip', 'throwing_knives', 'stun_grenade'];
    for (const id of ITEM_IDS.slice(21)) expect(save.unlocked.includes(id), id).toBe(star.includes(id));
  });

  it('an item whose behaviour is not written yet is harmless to hold, show and use', () => {
    const t = makeTestWorld(flatMap());
    const p = new Player(120, FLOOR);
    t.world.player = p;
    t.world.spawn(p);
    t.run.weapons = [mk('grave_bell'), mk('broadsword')];
    t.run.skills = [mk('last_bell'), mk('tornado')];
    steps(t.world, 3);
    for (const b of ['attack1', 'attack2', 'skill1', 'skill2'] as const) {
      t.input.tap(b);
      steps(t.world, 10);
    }
    expect(p.state).not.toBe('dead');
    for (const id of ITEM_IDS) expect(itemLines(mk(id)).length, id).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('planCraft: have / need per line and the automatic selection', () => {
  it('C: any 3 non-unique items + 10 pieces', () => {
    const s = saveWith([mk('spear'), mk('turret')], { pieces: 9 });
    const p = planCraft('C', s);
    expect(p.lines.map((l) => [l.label, l.have, l.need, l.ok])).toEqual([
      ['아이템 (유니크 제외)', 2, 3, false],
      ['시체 조각', 9, 10, false],
    ]);
    expect(p.ok).toBe(false);
    s.stash.push(mk('war_hammer'));
    s.pieces = 10;
    expect(planCraft('C', s).ok).toBe(true);
    // uniques are not materials
    const u = saveWith([mk('spear'), mk('turret'), mk('bone_cleaver')]);
    expect(planCraft('C', u).lines[0]).toMatchObject({ have: 2, need: 3, ok: false });
  });

  it('picks the cheapest first: lowest tier, then no affix, then not mid-boss, then the oldest', () => {
    const stash = [
      mk('spear', 3), // 0
      mk('war_hammer', 1, 'burn'), // 1
      mk('hunter_bow', 1, null, true), // 2
      mk('twin_daggers', 1), // 3  (cheapest of the tier-1 plain ones, the oldest)
      mk('old_shield', 2), // 4
      mk('fire_grenade', 1), // 5
      mk('turret', 1), // 6
    ];
    const p = planCraft('C', saveWith(stash));
    expect(p.picks.sort((a, b) => a - b)).toEqual([3, 5, 6]);
    // without those: the tier-1 mid-boss item is cheaper than the affixed one? no - affix is checked first
    const q = planCraft('C', saveWith(stash.filter((_, i) => ![3, 5, 6].includes(i))));
    expect(q.picks.map((i) => stash.filter((_, k) => ![3, 5, 6].includes(k))[i].id).sort()).toEqual(['hunter_bow', 'old_shield', 'war_hammer']);
  });

  it('B: three items with an affix, the cheapest ones', () => {
    const stash = [mk('spear', 1, 'burn'), mk('war_hammer'), mk('hunter_bow', 3, 'dmg'), mk('twin_daggers', 2, 'bleed'), mk('turret', 1, 'dmg'), mk('bone_cleaver')];
    const p = planCraft('B', saveWith(stash));
    expect(p.lines[0]).toMatchObject({ label: '접사가 붙은 아이템', have: 4, need: 3, ok: true });
    expect(p.picks.sort((a, b) => a - b)).toEqual([0, 3, 4]);
    expect(planCraft('B', saveWith(stash.slice(0, 2))).lines[0]).toMatchObject({ have: 1, ok: false });
  });

  it('A: 2 items of tier 2+ and 1 mid-boss item, three different entries', () => {
    // a mid-boss item is also tier 2+: it must not be counted twice
    const only = saveWith([mk('spear', 2), mk('war_hammer', 2, null, true)]);
    const a = planCraft('A', only);
    expect(a.lines.map((l) => [l.label, l.have, l.need, l.ok])).toEqual([
      ['티어 2 이상 아이템', 1, 2, false],
      ['중간 보스 아이템', 1, 1, true],
      ['시체 조각', 500, 35, true],
    ]);
    expect(a.ok).toBe(false);
    const ok = saveWith([mk('spear', 2), mk('hunter_bow', 3), mk('war_hammer', 2, null, true), mk('turret', 1)]);
    const p = planCraft('A', ok);
    expect(p.ok).toBe(true);
    expect(p.picks.sort((x, y) => x - y)).toEqual([0, 1, 2]);
    expect(new Set(p.picks).size).toBe(3);
    // the cheaper of two mid-boss items is spent; the other counts as a tier 2+ item
    const two = saveWith([mk('war_hammer', 3, null, true), mk('spear', 2, null, true), mk('hunter_bow', 2)]);
    const q = planCraft('A', two);
    expect(q.ok).toBe(true);
    expect(q.picks).toHaveLength(3);
  });

  it('S: 1 A unique + 2 mid-boss items + 1 bell shard (the lowest one) + 50 pieces', () => {
    const stash = [mk('grave_bell', 2), mk('spear', 2, null, true), mk('hunter_bow', 3, 'dmg', true), mk('turret', 2, null, true), mk('bone_cleaver')];
    const p = planCraft('S', saveWith(stash, { shards: [3, 1, 2] }));
    expect(p.lines.map((l) => [l.label, l.have, l.need, l.ok])).toEqual([
      ['A급 유니크', 1, 1, true],
      ['중간 보스 아이템', 3, 2, true],
      ['종탑의 파편', 3, 1, true],
      ['시체 조각', 500, 50, true],
    ]);
    expect(p.picks.sort((a, b) => a - b)).toEqual([0, 1, 3]); // the A unique and the two cheapest mid-boss items
    expect(p.shardPicks).toEqual([1]); // the shard of loop 1
    expect(planCraft('S', saveWith(stash, { shards: [] })).ok).toBe(false);
    expect(planCraft('S', saveWith(stash.slice(1))).lines[0]).toMatchObject({ have: 0, ok: false });
    expect(planCraft('S', saveWith([mk('bone_cleaver'), ...stash.slice(1)])).lines[0]).toMatchObject({ have: 0, ok: false }); // a C unique is no A unique
  });

  it('SS: an S and an A unique + 2 bell shards of loop 2 or later; SSS: SS + S + 3 shards of loop 3 or later', () => {
    const ss = saveWith([mk('executioner_blade', 3), mk('grave_bell', 2), mk('leech_whip', 2)], { shards: [1, 2, 5, 2] });
    const p = planCraft('SS', ss);
    expect(p.lines[2]).toMatchObject({ label: '종탑의 파편 (2회차 이상)', have: 3, need: 2, ok: true });
    expect(p.shardPicks.map((i) => ss.shards[i]).sort()).toEqual([2, 2]);
    expect(p.picks.sort((a, b) => a - b)).toEqual([0, 1]);
    expect(planCraft('SS', saveWith(ss.stash, { shards: [1, 1, 1, 2] })).lines[2]).toMatchObject({ have: 1, ok: false });
    const sss = saveWith([mk('matron_flail', 3), mk('executioner_blade', 3), mk('storm_staff', 3)], { shards: [2, 3, 3, 4, 1] });
    const q = planCraft('SSS', sss);
    expect(q.lines[2]).toMatchObject({ label: '종탑의 파편 (3회차 이상)', have: 3, need: 3, ok: true });
    expect(q.ok).toBe(true);
    expect(q.picks.sort((a, b) => a - b)).toEqual([0, 1]);
    expect(q.shardPicks.map((i) => sss.shards[i]).sort()).toEqual([3, 3, 4]);
    expect(planCraft('SSS', saveWith(sss.stash, { shards: [3, 3, 2, 2] })).ok).toBe(false);
    expect(planCraft('SSS', saveWith(sss.stash, { pieces: 119 })).ok).toBe(false);
  });

  it('labels come from the table; the recipe line of a grade reads from CRAFT', () => {
    expect(materialLabel({ n: 1, what: 'tier' })).toBe(`티어 ${CRAFT_MIN_TIER} 이상 아이템`);
    expect(shardLabel(1)).toBe('종탑의 파편');
    expect(recipeText('C')).toBe('아이템 (유니크 제외) 3개 + 시체 조각 10 → 티어 1');
    expect(recipeText('S')).toBe('A급 유니크 1개 + 중간 보스 아이템 2개 + 종탑의 파편 1개 + 시체 조각 50 → 티어 3');
    expect(recipeText('SSS')).toContain('종탑의 파편 (3회차 이상) 3개');
    expect(qualifies(mk('spear', 2), { n: 1, what: 'tier' })).toBe(true);
    expect(qualifies(mk('spear', 1), { n: 1, what: 'tier' })).toBe(false);
    expect(qualifies(mk('bone_cleaver', 4), { n: 1, what: 'tier' })).toBe(false);
    expect(qualifies(mk('bone_cleaver'), { n: 1, what: 'unique', grade: 'C' })).toBe(true);
    expect(qualifies(mk('bone_cleaver'), { n: 1, what: 'unique', grade: 'B' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('craftUnique', () => {
  it('C: consumes 3 items and 10 pieces, the unique (tier 1, no affix) enters the stash; any number of times', () => {
    const s = saveWith([mk('spear'), mk('war_hammer'), mk('turret'), mk('hunter_bow', 2)], { pieces: 25 });
    const r = craftUnique(s, 'C', 'bone_cleaver');
    expect(r).toEqual({ ok: true, item: { id: 'bone_cleaver', tier: 1, affix: null } });
    expect(s.pieces).toBe(15);
    expect(s.stash.map((i) => i.id)).toEqual(['hunter_bow', 'bone_cleaver']);
    // not enough items left: nothing changes
    expect(craftUnique(s, 'C', 'bone_cleaver')).toEqual({ ok: false, reason: 'materials' });
    expect(s.pieces).toBe(15);
    expect(s.stash).toHaveLength(2);
    // the same unique again from fresh materials
    s.stash.push(mk('spear'), mk('spear'));
    expect(craftUnique(s, 'C', 'bone_cleaver').ok).toBe(true);
    expect(s.stash.filter((i) => i.id === 'bone_cleaver')).toHaveLength(2);
    expect(s.pieces).toBe(5);
  });

  it('the crafted tier is fixed by the grade: C 1, B 2, A 2, S 3, SS 3, SSS 4; never an affix', () => {
    const rich = () => saveWith([
      mk('spear', 2, 'burn', true), mk('war_hammer', 2, 'burn', true), mk('hunter_bow', 2, 'burn', true), mk('twin_daggers', 2, 'burn', true),
      mk('grave_bell', 2), mk('executioner_blade', 3), mk('matron_flail', 3), mk('leech_whip', 2), mk('storm_staff', 3),
    ], { pieces: 999, shards: [3, 3, 3, 3, 3] });
    const tiers: Record<Grade, number> = { C: 1, B: 2, A: 2, S: 3, SS: 3, SSS: 4 };
    for (const g of GRADE_IDS) {
      const s = rich();
      for (const id of uniquesOf(g)) {
        const t = rich();
        const r = craftUnique(t, g, id);
        expect(r.ok, `${g} ${id}`).toBe(true);
        if (r.ok) expect(r.item, `${g} ${id}`).toEqual({ id, tier: tiers[g], affix: null });
      }
      expect(CRAFT[g].tier).toBe(tiers[g]);
      void s;
    }
  });

  it('consumes exactly what was planned: the shards (lowest first) and the mid-boss item, and takes the pieces', () => {
    const s = saveWith([mk('grave_bell', 2), mk('spear', 2, null, true), mk('turret', 3, null, true), mk('hunter_bow', 2, null, true), mk('old_shield')], { pieces: 70, shards: [2, 1, 3] });
    const before = planCraft('S', s);
    const r = craftUnique(s, 'S', 'death_orb');
    expect(r.ok).toBe(true);
    expect(s.pieces).toBe(20);
    expect(s.shards).toEqual([2, 3]); // the loop 1 shard went
    const gone = before.picks.map((i) => ['grave_bell', 'spear', 'turret', 'hunter_bow', 'old_shield'][i]).sort();
    expect(gone).toEqual(['grave_bell', 'hunter_bow', 'spear']);
    expect(s.stash.map((i) => i.id)).toEqual(['turret', 'old_shield', 'death_orb']);
  });

  it('refuses a unique of another grade, an ordinary item and an unknown id, without touching the save', () => {
    const s = saveWith([mk('spear'), mk('war_hammer'), mk('turret')]);
    const snap = JSON.stringify(s);
    expect(craftUnique(s, 'C', 'reaper_scythe')).toEqual({ ok: false, reason: 'unknown' }); // a B unique
    expect(craftUnique(s, 'C', 'spear')).toEqual({ ok: false, reason: 'unknown' });
    expect(craftUnique(s, 'C', 'nope' as ItemId)).toEqual({ ok: false, reason: 'unknown' });
    expect(craftUnique(s, 'Z' as Grade, 'bone_cleaver')).toEqual({ ok: false, reason: 'unknown' });
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('a full stash still has room: every recipe consumes at least two entries', () => {
    for (const g of GRADE_IDS) expect(CRAFT[g].items.reduce((n, m) => n + m.n, 0), g).toBeGreaterThanOrEqual(2);
    const s = saveWith(Array.from({ length: STASH.capacity }, () => mk('spear', 1)));
    expect(craftUnique(s, 'C', 'bone_cleaver').ok).toBe(true);
    expect(s.stash).toHaveLength(STASH.capacity - 3 + 1);
  });

  it('the grades follow the loops: SS and SSS need shards of loop 2 / 3 or later (a run through the whole chain)', () => {
    const s = saveWith([mk('spear', 2, null, true), mk('war_hammer', 2, null, true), mk('hunter_bow', 2, null, true), mk('turret', 2, null, true), mk('old_shield', 2, null, true), mk('twin_daggers', 2, null, true), mk('blood_sword', 2, null, true)], { pieces: 999, shards: [1] });
    // A needs two tier 2+ items and a mid-boss one: three entries each time
    expect(craftUnique(s, 'A', 'grave_bell').ok).toBe(true);
    expect(craftUnique(s, 'A', 'leech_whip').ok).toBe(true);
    // S: an A unique, two mid-boss items and a shard of any loop
    expect(craftUnique(s, 'S', 'storm_staff').ok).toBe(false); // only one mid-boss item left
    s.stash.push(mk('spear', 2, null, true), mk('spear', 2, null, true));
    expect(craftUnique(s, 'S', 'storm_staff').ok).toBe(true);
    expect(s.shards).toEqual([]);
    // SS: an S and an A unique and two shards of loop 2 or later: a loop-1 shard does not count
    s.shards = [1, 1];
    expect(planCraft('SS', s).ok).toBe(false);
    s.shards = [2, 2];
    expect(craftUnique(s, 'SS', 'matron_flail').ok).toBe(true);
    expect(s.shards).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
function ctxFake(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = { font: '11px x' };
  return new Proxy(target, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: [...s].length * (parseInt(String(t.font).match(/(\d+)px/)?.[1] ?? '11', 10) * 0.55) });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function uiSetup(W = 777) {
  const { world, game, run } = makeTestWorld();
  game.display = { W, H: 360, scale: 1, canvas: null };
  game.taps = new TapRegistry();
  game.persist = vi.fn();
  game.scene = null;
  const sounds: string[] = [];
  game.audio.play = (s: string) => { sounds.push(s); };
  (world as any).player = { hp: 60, maxHp: 100, recoverable: 0, nearInteract: null, skillCooldown: [0, 0], skillCooldownMax: [1, 1], x: 200, y: 200, h: 40, w: 14, dying: false };
  const ui = new LevelUI(game, world);
  world.ui = ui;
  const ctx = ctxFake();
  const frame = (dt = 1 / 60) => {
    game.taps.clear();
    ui.update(dt);
    ui.draw(ctx);
  };
  const advance = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) frame(); };
  const tap = (id: string) => {
    const r = game.taps.byId(id);
    if (!r) throw new Error('no tap region ' + id);
    r.onTap();
  };
  const toasts: string[] = [];
  world.on((e) => { if (e.type === 'toast') toasts.push(e.text); });
  const open = (onCraft?: (id: ItemId) => void) => {
    ui.openCraft(onCraft);
    advance(0.3);
    return ui.top as CraftModal;
  };
  return { world, game, run, ui, ctx, frame, advance, tap, open, sounds, toasts, save: game.save as ReturnType<typeof defaultSave> };
}

describe('CraftModal', () => {
  it('opens on the highest grade that can be crafted (else C); tabs by Q / E / left / right wrap around', () => {
    const a = uiSetup();
    expect(a.open().grade).toBe('C');
    const b = uiSetup();
    b.save.pieces = 100;
    b.save.stash = [mk('spear'), mk('war_hammer'), mk('turret')];
    expect(b.open().grade).toBe('C');
    const c = uiSetup();
    c.save.pieces = 100;
    c.save.stash = [mk('spear', 1, 'burn'), mk('war_hammer', 1, 'burn'), mk('turret', 1, 'dmg')];
    const m = c.open();
    expect(m.grade).toBe('B'); // B is the highest craftable
    c.ui.key('right');
    expect(m.grade).toBe('A');
    m.tab(1);
    expect(m.grade).toBe('S');
    for (let i = 0; i < 3; i++) m.tab(1);
    expect(m.grade).toBe('C'); // S -> SS -> SSS -> C
    m.tab(-1);
    expect(m.grade).toBe('SSS');
    c.ui.key('left');
    expect(m.grade).toBe('SS');
  });

  it('up / down pick the unique (each grade remembers its own), Enter crafts it: materials gone, the unique in the stash, saved, toast, Selma callback', () => {
    const a = uiSetup();
    a.save.pieces = 14;
    a.save.stash = [mk('spear'), mk('war_hammer'), mk('turret'), mk('hunter_bow')];
    const made: ItemId[] = [];
    const m = a.open((id) => made.push(id));
    expect(m.grade).toBe('C');
    expect(m.selected).toBe('bone_cleaver');
    a.ui.key('down');
    a.ui.key('down');
    expect(m.selected).toBe('coffin_lid');
    a.ui.key('up');
    a.ui.key('up');
    a.ui.key('up');
    expect(m.selected).toBe('chain_hook'); // wraps
    a.ui.key('confirm');
    expect(a.save.stash.map((i) => i.id)).toEqual(['hunter_bow', 'chain_hook']);
    expect(a.save.pieces).toBe(4);
    expect(a.game.persist).toHaveBeenCalled();
    expect(a.toasts).toEqual(['사슬 갈고리 조합 완료']);
    expect(made).toEqual(['chain_hook']);
    expect(a.sounds).toContain('buy');
    // not enough materials now: an error, nothing changes
    a.ui.key('confirm');
    expect(a.sounds).toContain('error');
    expect(a.save.stash).toHaveLength(2);
    expect(made).toHaveLength(1);
    m.tab(1);
    expect(m.selected).toBe('reaper_scythe'); // the B tab starts on its first unique
    m.tab(-1);
    expect(m.selected).toBe('chain_hook');
  });

  it('touch: tabs, rows and 조합 / 닫기 are tap regions; the plan lists the entries that will be consumed', () => {
    const a = uiSetup();
    a.save.pieces = 40;
    a.save.stash = [mk('spear', 1, 'burn'), mk('war_hammer', 1, 'burn'), mk('turret', 1, 'burn'), mk('hunter_bow', 1, 'burn')];
    a.open();
    a.frame();
    for (const id of ['craft-tab0', 'craft-tab5', 'craft-row0', 'craft-row4', 'craft-do', 'craft-close']) expect(a.game.taps.byId(id), id).toBeTruthy();
    a.tap('craft-tab1');
    a.frame();
    const m = a.ui.top as CraftModal;
    expect(m.grade).toBe('B');
    expect(m.plan.picks).toEqual([0, 1, 2]);
    a.tap('craft-row3');
    expect(m.selected).toBe('corpse_bomb');
    a.frame();
    a.tap('craft-do');
    expect(a.save.stash.map((i) => i.id)).toEqual(['hunter_bow', 'corpse_bomb']);
    expect(a.save.stash[1]).toEqual({ id: 'corpse_bomb', tier: 2, affix: null });
    expect(a.save.pieces).toBe(20);
    a.frame();
    a.tap('craft-close');
    expect(a.ui.top).toBeNull();
  });

  it('draws every tab at every width without throwing (all recipe lines, shards, a full stash)', () => {
    for (const W of [480, 640, 777, 800]) {
      const a = uiSetup(W);
      a.save.pieces = 321;
      a.save.shards = [1, 2, 2, 3, 3, 3];
      a.save.stash = Array.from({ length: STASH.capacity }, (_, i) => mk(ITEM_IDS[i % 33], 1 + (i % 3), i % 2 ? 'dmg' : null, i % 5 === 0));
      a.save.stash[3] = mk('grave_bell', 2);
      const m = a.open();
      for (let i = 0; i < 7; i++) {
        a.advance(0.1);
        m.tab(1);
      }
      a.ui.key('confirm');
      a.advance(0.2);
    }
  });

  it('the layout fits every width: tabs, recipe rows, mini grid, the five rows and the buttons inside the panel, nothing overlapping', () => {
    for (const W of [480, 560, 640, 700, 777, 800]) {
      const L = craftLayout(W, 360);
      const all = [
        ...L.tabs.map((r, i) => ({ r, n: 'tab' + i })), ...L.recipe.map((r, i) => ({ r, n: 'recipe' + i })), ...L.grid.map((r, i) => ({ r, n: 'cell' + i })),
        ...L.rows.map((r, i) => ({ r, n: 'row' + i })), { r: L.detail, n: 'detail' }, { r: L.craft, n: 'craft' }, { r: L.close, n: 'close' },
      ];
      for (const { r, n } of all) {
        expect(r.x, `${n}@${W}`).toBeGreaterThanOrEqual(L.panel.x);
        expect(r.y, `${n}@${W}`).toBeGreaterThanOrEqual(L.panel.y);
        expect(r.x + r.w, `${n}@${W}`).toBeLessThanOrEqual(L.panel.x + L.panel.w);
        expect(r.y + r.h, `${n}@${W}`).toBeLessThanOrEqual(L.panel.y + L.panel.h);
      }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i].r, b = all[j].r;
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, `${all[i].n} vs ${all[j].n} @${W}`).toBe(false);
      }
      for (const r of [...L.tabs, ...L.rows, L.craft, L.close]) expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(28);
      expect(L.craft.h).toBeGreaterThanOrEqual(38);
      expect(L.rows).toHaveLength(5);
      expect(L.recipe.length).toBeGreaterThanOrEqual(4); // the longest recipe has 4 lines
      expect(Math.max(...GRADE_IDS.map((g) => planCraft(g, defaultSave()).lines.length))).toBe(4);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Selma opens the craft screen', () => {
  it('her prompt is `조합` with the banked pieces; interacting opens the craft screen, and a craft makes her sew', () => {
    const t = makeTestWorld(flatMap());
    t.game.save.pieces = 37;
    const selma = new Seamstress(300, FLOOR);
    t.world.spawn(selma);
    steps(t.world, 2);
    expect([selma.promptText(), selma.promptSub(), selma.canInteract()]).toEqual(['조합', '재봉사 셀마 · 시체 조각 37', true]);
    let cb: ((id: ItemId) => void) | undefined;
    (t.world as any).ui.openCraft = (fn: (id: ItemId) => void) => { cb = fn; };
    selma.interact();
    expect(cb).toBeTypeOf('function');
    expect(selma.promptText()).toBe('조합'); // she says nothing before the craft
    cb!('bone_cleaver');
    expect(selma.promptText()).toBe(''); // her line is up
    steps(t.world, 2);
    expect(selma.anim?.name).toBe('sew');
    steps(t.world, 100);
    expect(selma.anim?.name).not.toBe('sew');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('grade badges and the codex', () => {
  it('weapon and skill pages: ordinary items under 일반, uniques grade by grade with the recipe from CRAFT', () => {
    const entries = [...codexEntries('weapon'), ...codexEntries('skill')];
    for (const e of entries) {
      const d = ITEMS[e.id as ItemId];
      if (!d.unique) {
        expect(e.group, e.id).toBe('일반');
        expect(e.grade, e.id).toBeUndefined();
        continue;
      }
      expect(e.group, e.id).toBe(`유니크 ${d.grade}`);
      expect(e.grade, e.id).toBe(d.grade);
      expect(e.rows.at(-1), e.id).toMatchObject({ label: '조합', text: `셀마의 조합 · ${recipeText(d.grade!)}` });
    }
    // the ordinary items come first, then C, B ...
    const order = (tab: 'weapon' | 'skill') => codexEntries(tab).map((e) => e.group);
    for (const tab of ['weapon', 'skill'] as const) {
      const groups = order(tab).filter((g, i, a) => a.indexOf(g) === i);
      expect(groups[0]).toBe('일반');
      expect(groups.slice(1)).toEqual(GRADE_IDS.map((g) => `유니크 ${g}`));
    }
  });

  it('ordinary items say where they come from: 기본 (starting pool) or the Alchemist blueprint with its cost', () => {
    const row = (id: string) => buildCodex().find((e) => e.id === id)!.rows.find((r) => r.label === '해금');
    expect(row('rusty_sword')).toMatchObject({ text: '기본' });
    expect(row('spear')?.text).toMatch(/^연금술사 \d+셀$/);
    expect(row('bone_cleaver')).toBeUndefined();
  });

  it('the item tab has 종탑의 파편, 보관함 and 조합 (recipe table) and no word of the body or the 시체 상점', () => {
    const items = new Map(codexEntries('item').map((e) => [e.id, e]));
    const shard = items.get('bell_shard')!;
    const sText = shard.rows.map((r) => r.text).join(' | ');
    expect(shard.name).toBe('종탑의 파편');
    expect(sText).toContain(`S급 유니크: ${CRAFT.S.shards!.n}개`);
    expect(sText).toContain(`SS급 유니크: ${CRAFT.SS.shards!.n}개 (${CRAFT.SS.shards!.minLoop}회차 이상`);
    expect(sText).toContain(`SSS급 유니크: ${CRAFT.SSS.shards!.n}개 (${CRAFT.SSS.shards!.minLoop}회차 이상`);
    const stash = items.get('stash')!;
    expect(stash.rows.map((r) => r.text).join(' | ')).toContain(`${STASH.capacity}칸`);
    expect(stash.rows.map((r) => r.text).join(' | ')).toContain(`${GRADES.C.salvage}–${GRADES.SSS.salvage}`);
    const craft = items.get('crafting')!;
    for (const g of GRADE_IDS) expect(craft.rows.find((r) => r.label === g), g).toMatchObject({ text: recipeText(g), color: GRADES[g].color });
    const piece = items.get('corpse_piece')!.rows.map((r) => r.text).join(' | ');
    expect(piece).toContain('맡겨');
    expect(piece).toContain(`${CRAFT.C.pieces}–${CRAFT.SSS.pieces}조각`);
    for (const e of buildCodex()) for (const t of [e.name, e.desc, ...e.rows.map((r) => r.text)]) {
      expect(t, e.id).not.toMatch(/몸 꿰|시체 상점|몸이 \d|온전한 몸/);
    }
  });

  it('the item card draws a grade pill for a unique and the HUD slots a corner letter (no throw, every grade)', () => {
    const t = makeTestWorld(flatMap());
    (t.world as any).player = { hp: 60, maxHp: 100, recoverable: 0, nearInteract: null, skillCooldown: [0, 3], skillCooldownMax: [10, 10], x: 200, y: 200, h: 40, w: 14, dying: false };
    t.game.display = { W: 640, H: 360, scale: 1, canvas: null };
    t.game.taps = new TapRegistry();
    t.game.scene = null;
    const ui = new LevelUI(t.game, t.world);
    t.world.ui = ui;
    const ctx = ctxFake();
    for (const g of GRADE_IDS) {
      const weapon = uniquesOf(g).find((i) => ITEMS[i].slot === 'weapon')!;
      const skill = uniquesOf(g).find((i) => ITEMS[i].slot === 'skill')!;
      t.run.weapons = [mk(weapon, 2), mk('rusty_sword')];
      t.run.skills = [mk(skill, 2), null];
      (t.world.player as any).nearInteract = { x: 210, y: 200, h: 14, dead: false, inst: mk(weapon, 2), promptText: () => '줍기', promptSub: () => null, interact() {}, canInteract: () => true };
      t.game.taps.clear();
      ui.update(1 / 60);
      ui.hud.draw(ctx, 640, 360, true);
    }
    expect(ui.hud).toBeInstanceOf(Hud);
  });
});
