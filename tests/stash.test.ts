import { describe, it, expect, vi } from 'vitest';
import { makeTestWorld, steps, flatMap } from './helpers';
import { Player } from '../src/game/player/player';
import { LevelUI } from '../src/game/ui/levelUI';
import { StashModal, stashLayout, shardSummary } from '../src/game/ui/stashModal';
import { TapRegistry } from '../src/game/ui/taps';
import { RunState, LEVEL_SEQUENCE } from '../src/game/run';
import { defaultSave, loadSave, sanitizeStash, writeSave, MAX_LOOP } from '../src/game/meta/save';
import { addToStash, depositEquipped, emptySlotFor, equipFromStash, salvageEntry, salvageValue, stashFull } from '../src/game/meta/stash';
import { spawnItemDrop } from '../src/game/items/pickups';
import { ITEMS, rollItem } from '../src/game/items/items';
import { ITEM_IDS, type ItemId, type ItemInstance } from '../src/game/items/types';
import { GRADES, STASH } from '../src/game/rules';
import { createMiniBoss, MINIBOSS_IDS, MINIBOSS_SPECS, type MiniBoss } from '../src/game/miniboss';
import { Rng } from '../src/engine/rng';
import { StashChest, Seamstress } from '../src/game/props';
import { buildLevel, populateLevel } from '../src/game/level/build';
import { TILE } from '../src/engine/config';

const FLOOR = 16 * 24;
const it_ = (id: ItemId, tier = 1, affix: ItemInstance['affix'] = null, mb = false): ItemInstance => ({ id, tier, affix, ...(mb ? { mb: true as const } : {}) });

/** A 2D context that accepts everything (so draw code can run in node). */
function fakeCtx(): CanvasRenderingContext2D {
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

/** a world with the real LevelUI (as in ui.test.ts): `open()` opens the stash screen and returns it */
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
  const ctx = fakeCtx();
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
  const open = () => {
    ui.openStash();
    advance(0.3);
    return ui.top as StashModal;
  };
  return { world, game, run, ui, ctx, frame, advance, tap, open, sounds, save: game.save as ReturnType<typeof defaultSave> };
}

// ---------------------------------------------------------------------------------------------------------------------
describe('stash: the pure operations (docs/CONTENT4.md §2, §3)', () => {
  it('holds STASH.capacity (24) items and refuses more', () => {
    expect(STASH.capacity).toBe(24);
    const save = defaultSave();
    for (let i = 0; i < STASH.capacity; i++) expect(addToStash(save, it_('spear')), `item ${i}`).toBe(true);
    expect(stashFull(save)).toBe(true);
    expect(addToStash(save, it_('spear'))).toBe(false);
    expect(save.stash).toHaveLength(24);
  });

  it('equipping into an empty slot frees the stash cell (the entries behind it move up)', () => {
    const save = defaultSave();
    save.stash = [it_('spear'), it_('war_hammer'), it_('hunter_bow')];
    const run = new RunState(1);
    run.weapons = [it_('rusty_sword'), null];
    expect(emptySlotFor(run, save.stash[1])).toBe(1);
    expect(equipFromStash(run, save, 1, 1)).toBe(true);
    expect(run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'war_hammer']);
    expect(save.stash.map((s) => s.id)).toEqual(['spear', 'hunter_bow']);
  });

  it('equipping over a full slot puts the old item into the stash in the entry\'s place', () => {
    const save = defaultSave();
    save.stash = [it_('spear'), it_('war_hammer', 2, 'burn', true)];
    const run = new RunState(1);
    run.weapons = [it_('rusty_sword', 1, 'bleed'), it_('old_shield')];
    expect(emptySlotFor(run, save.stash[0])).toBe(-1);
    equipFromStash(run, save, 1, 0);
    expect(run.weapons[0]).toEqual({ id: 'war_hammer', tier: 2, affix: 'burn', mb: true });
    expect(save.stash.map((s) => s.id)).toEqual(['spear', 'rusty_sword']);
    expect(save.stash[1]).toEqual({ id: 'rusty_sword', tier: 1, affix: 'bleed' });
  });

  it('skills go to the skill slots, weapons to the weapon slots; bad indices do nothing', () => {
    const save = defaultSave();
    save.stash = [it_('turret'), it_('spear')];
    const run = new RunState(1);
    run.weapons = [it_('rusty_sword'), null];
    expect(equipFromStash(run, save, 0, 0)).toBe(true);
    expect(run.skills[0]?.id).toBe('turret');
    expect(run.weapons[0]?.id).toBe('rusty_sword');
    expect(equipFromStash(run, save, 5, 0)).toBe(false);
    expect(equipFromStash(run, save, 0, 2)).toBe(false);
    expect(equipFromStash(run, save, -1, 0)).toBe(false);
    expect(save.stash.map((s) => s.id)).toEqual(['spear']);
  });

  it('depositing empties the slot (an empty primary weapon is allowed); a full stash or an empty slot refuses', () => {
    const save = defaultSave();
    const run = new RunState(1);
    run.weapons = [it_('rusty_sword'), it_('spear', 2, null, true)];
    expect(depositEquipped(run, save, 'weapon', 0)).toBe(true);
    expect(run.weapons).toEqual([null, it_('spear', 2, null, true)]);
    expect(save.stash).toEqual([it_('rusty_sword')]);
    expect(depositEquipped(run, save, 'weapon', 0)).toBe(false); // empty
    expect(depositEquipped(run, save, 'skill', 1)).toBe(false);
    save.stash = Array.from({ length: STASH.capacity }, () => it_('spear'));
    expect(depositEquipped(run, save, 'weapon', 1)).toBe(false);
    expect(run.weapons[1]?.id).toBe('spear');
  });

  it('the mid-boss flag survives equipping, depositing and equipping again', () => {
    const save = defaultSave();
    const run = new RunState(1);
    run.weapons = [it_('war_hammer', 3, 'dmg', true), null];
    depositEquipped(run, save, 'weapon', 0);
    expect(save.stash[0].mb).toBe(true);
    equipFromStash(run, save, 0, 1);
    expect(run.weapons[1]).toEqual({ id: 'war_hammer', tier: 3, affix: 'dmg', mb: true });
  });

  it('salvage: a normal item gives 1 + (tier - 1) + (affix ? 1 : 0) pieces, a unique the salvage value of its grade', () => {
    expect(salvageValue(it_('spear', 1))).toBe(1);
    expect(salvageValue(it_('spear', 1, 'burn'))).toBe(2);
    expect(salvageValue(it_('spear', 2))).toBe(2);
    expect(salvageValue(it_('spear', 3, 'dmg'))).toBe(4);
    expect(salvageValue(it_('hunter_bow', 2, 'speed', true))).toBe(3);
    expect(salvageValue(it_('fire_grenade', 5, 'dmg'))).toBe(6);
    expect(GRADES.C.salvage).toBe(5);
    // a unique of every grade: the grade's value, whatever its tier
    for (const id of ITEM_IDS) {
      const d = ITEMS[id];
      if (d.unique) expect(salvageValue(it_(id, 3)), id).toBe(GRADES[d.grade!].salvage);
    }
    const save = defaultSave();
    save.pieces = 7;
    save.stash = [it_('spear', 2, 'burn'), it_('bone_cleaver')];
    expect(salvageEntry(save, 1)).toBe(5);
    expect(save.pieces).toBe(12);
    expect(salvageEntry(save, 0)).toBe(3);
    expect(save.pieces).toBe(15);
    expect(save.stash).toEqual([]);
    expect(salvageEntry(save, 0)).toBe(-1);
    expect(save.pieces).toBe(15);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('save: the stash persists and is sanitised on load', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  const load = (d: unknown) => {
    store.set('deadsell.save.v1', JSON.stringify(d));
    return loadSave();
  };

  it('survives a write / load round trip (with the pieces, shards and the mid-boss flag)', () => {
    const s = defaultSave();
    s.stash = [it_('spear', 2, 'burn'), it_('war_hammer', 3, null, true), it_('bone_cleaver')];
    s.pieces = 33;
    s.shards = [1, 2];
    writeSave(s);
    const back = loadSave();
    expect(back.stash).toEqual(s.stash);
    expect(back.stash[1].mb).toBe(true);
    expect([back.pieces, back.shards]).toEqual([33, [1, 2]]);
    store.clear();
  });

  it('old saves have an empty stash', () => {
    expect(load({ version: 1, runs: 3 }).stash).toEqual([]);
    store.clear();
    expect(loadSave().stash).toEqual([]);
  });

  it('unknown ids and junk entries are dropped', () => {
    const s = load({ stash: [{ id: 'spear', tier: 1, affix: null }, { id: 'nope', tier: 1, affix: null }, null, 7, 'spear', { tier: 2 }, [], { id: 'war_hammer', tier: 2, affix: null }] });
    expect(s.stash.map((e) => e.id)).toEqual(['spear', 'war_hammer']);
    expect(load({ stash: 'full' }).stash).toEqual([]);
    expect(load({ stash: { id: 'spear' } }).stash).toEqual([]);
    store.clear();
  });

  it('the tier is an integer 1..5', () => {
    const tiers = sanitizeStash([0, -3, 1.9, 5, 6, 99, '3', null, NaN].map((tier) => ({ id: 'spear', tier, affix: null }))).map((e) => e.tier);
    expect(tiers).toEqual([1, 1, 1, 5, 5, 5, 1, 1, 1]);
  });

  it('an affix stays only when the item can roll it; uniques never carry one; the flag is `true` or nothing', () => {
    const [a, b, c, d, e, f] = sanitizeStash([
      { id: 'spear', tier: 1, affix: 'burn' },
      { id: 'spear', tier: 1, affix: 'nonsense' },
      { id: 'old_shield', tier: 1, affix: 'burn' }, // a shield can only heal on kill
      { id: 'old_shield', tier: 1, affix: 'heal_on_kill', mb: true },
      { id: 'bone_cleaver', tier: 1, affix: 'dmg', mb: 'yes' },
      { id: 'fire_grenade', tier: 2, affix: 'speed' }, // skills have no swing speed
    ]);
    expect([a.affix, b.affix, c.affix, d.affix, e.affix, f.affix]).toEqual(['burn', null, null, 'heal_on_kill', null, null]);
    expect([a.mb, d.mb, e.mb]).toEqual([undefined, true, undefined]);
    expect('mb' in a).toBe(false);
  });

  it('at most STASH.capacity entries are kept', () => {
    const many = Array.from({ length: 60 }, () => ({ id: 'spear', tier: 1, affix: null }));
    expect(sanitizeStash(many)).toHaveLength(STASH.capacity);
    expect(load({ stash: many }).stash).toHaveLength(24);
    store.clear();
  });

  it('every item id of the game is a valid stash entry', () => {
    const all = sanitizeStash(ITEM_IDS.slice(0, 24).map((id) => ({ id, tier: 1, affix: null })));
    expect(all.map((e) => e.id)).toEqual(ITEM_IDS.slice(0, 24));
    expect(MAX_LOOP).toBe(99);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('mid-boss drops carry the `mb` flag (docs/CONTENT4.md §2)', () => {
  const FLOORY = 16 * 24;
  type Drop = { inst: ItemInstance };
  const dropsOf = (world: ReturnType<typeof makeTestWorld>['world']) => world.entities.filter((e) => e.constructor.name === 'ItemDrop') as unknown as Drop[];

  it('both items of every mid-boss are flagged; ordinary rolls, chests and the Matron never are', () => {
    for (const id of MINIBOSS_IDS) {
      const t = makeTestWorld(flatMap(60, 18));
      const p = new Player(300, FLOORY);
      t.world.player = p;
      t.world.spawn(p);
      steps(t.world, 3);
      const boss = createMiniBoss(id, 700, FLOORY, MINIBOSS_SPECS[id].biome === 'ramparts' ? 2 : 1) as MiniBoss;
      t.world.spawn(boss);
      steps(t.world, 2);
      boss.takeDamage({ amount: 1, dir: 1, kind: 'ranged', source: p });
      for (let i = 0; i < 400 && boss.state !== 'idle'; i++) steps(t.world, 1);
      (boss as unknown as { gapT: number }).gapT = 999;
      boss.takeDamage({ amount: boss.hp + 999, dir: 1, kind: 'melee', source: p });
      steps(t.world, 1);
      const drops = dropsOf(t.world);
      expect(drops.map((d) => ITEMS[d.inst.id].slot).sort(), id).toEqual(['skill', 'weapon']);
      for (const d of drops) expect([d.inst.mb, d.inst.affix !== null], id).toEqual([true, true]);
    }
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) expect(rollItem(rng, 2, ITEM_IDS, undefined, { guaranteeAffix: true }).mb).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('picking up with both slots full: the third choice sends the item to the stash', () => {
  /** a world whose choice modal records what it was offered and answers with `pick` */
  function field(pick: number, stashN = 0) {
    const t = makeTestWorld(flatMap());
    const p = new Player(120, FLOOR);
    t.world.player = p;
    t.world.spawn(p);
    const asked: { title: string; options: { label: string; sub?: string; disabled?: boolean }[] }[] = [];
    (t.world as any).ui.openChoice = (title: string, options: any[], cb: (i: number) => void) => { asked.push({ title, options }); cb(pick); };
    const toasts: string[] = [];
    t.world.on((e) => { if (e.type === 'toast') toasts.push(e.text); });
    const persisted: number[] = [];
    t.game.persist = () => { persisted.push(t.game.save.stash.length); };
    t.game.save.stash = Array.from({ length: stashN }, () => it_('spear'));
    t.run.weapons = [it_('rusty_sword'), it_('old_shield')];
    steps(t.world, 3);
    const inst = it_('war_hammer', 2, 'burn', true);
    spawnItemDrop(t.world, p.x + 10, FLOOR, inst);
    steps(t.world, 40);
    const drop = t.world.entities.find((e) => e.constructor.name === 'ItemDrop') as unknown as { inst: ItemInstance; dead: boolean; interact(): void; canInteract(): boolean };
    return { ...t, p, asked, toasts, persisted, inst, drop };
  }

  it('offers the two slots and `보관함으로 보내기 · n/24` (enabled while there is room)', () => {
    const t = field(0, 5);
    t.drop.interact();
    expect(t.asked).toHaveLength(1);
    const o = t.asked[0].options;
    expect(o).toHaveLength(3);
    expect(o[0].label).toContain('주무기');
    expect(o[1].label).toContain('보조 무기');
    expect(o[2].label).toBe('보관함으로 보내기 · 5/24');
    expect(o[2].disabled).toBeFalsy();
  });

  it('picking it stores the very instance (tier, affix, mid-boss flag), saves, toasts, and leaves both slots alone', () => {
    const t = field(2, 5);
    t.drop.interact();
    expect(t.game.save.stash).toHaveLength(6);
    expect(t.game.save.stash[5]).toBe(t.inst);
    expect(t.game.save.stash[5]).toEqual({ id: 'war_hammer', tier: 2, affix: 'burn', mb: true });
    expect(t.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'old_shield']);
    expect(t.persisted).toEqual([6]);
    expect(t.toasts).toEqual(['전쟁 망치 +1 보관함에 보관']);
    expect(t.drop.dead).toBe(true);
    steps(t.world, 5);
    expect(t.world.entities.some((e) => e.constructor.name === 'ItemDrop')).toBe(false); // nothing dropped back
  });

  it('a full stash disables the option (`보관함이 가득 찼다`); choosing it anyway changes nothing', () => {
    const t = field(2, STASH.capacity);
    t.drop.interact();
    const last = t.asked[0].options[2];
    expect([last.label, last.sub, last.disabled]).toEqual(['보관함으로 보내기 · 24/24', '보관함이 가득 찼다', true]);
    expect(t.game.save.stash).toHaveLength(STASH.capacity);
    expect(t.drop.dead).toBe(false);
    expect(t.persisted).toEqual([]);
    expect(t.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'old_shield']);
  });

  it('the slot choices still work (and an empty slot is filled without asking)', () => {
    const t = field(1, 3);
    t.drop.interact();
    expect(t.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'war_hammer']);
    expect(t.game.save.stash).toHaveLength(3);
    const u = makeTestWorld(flatMap());
    const p = new Player(120, FLOOR);
    u.world.player = p;
    u.world.spawn(p);
    let asked = 0;
    (u.world as any).ui.openChoice = () => { asked++; };
    u.run.weapons = [it_('rusty_sword'), null];
    steps(u.world, 3);
    spawnItemDrop(u.world, p.x + 10, FLOOR, it_('spear'));
    steps(u.world, 40);
    (u.world.entities.find((e) => e.constructor.name === 'ItemDrop') as unknown as { interact(): void }).interact();
    expect(asked).toBe(0);
    expect(u.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'spear']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the 보관함 chest', () => {
  it('the prison start room has one next to the player start; every 쉼터 has one', () => {
    for (const seed of [1, 7, 13, 99]) {
      const lvl = buildLevel(LEVEL_SEQUENCE[0], seed);
      const chests = lvl.spawns.filter((s) => s.type === 'stash');
      expect(chests, `prison ${seed}`).toHaveLength(1);
      expect(Math.abs(chests[0].x - lvl.playerStart.x), `prison ${seed}`).toBeLessThanOrEqual(6 * TILE);
      expect(Math.abs(chests[0].y - lvl.playerStart.y), `prison ${seed}`).toBeLessThan(TILE);
      expect(lvl.rooms[chests[0].roomId].tags).toContain('start');
    }
    for (const spec of LEVEL_SEQUENCE.filter((l) => l.kind === 'passage')) {
      const lvl = buildLevel(spec, 7);
      const chests = lvl.spawns.filter((s) => s.type === 'stash');
      expect(chests).toHaveLength(1);
      expect(Math.abs(chests[0].x - lvl.playerStart.x)).toBeLessThanOrEqual(6 * TILE);
    }
    // the other biome levels do not get one
    expect(buildLevel(LEVEL_SEQUENCE[2], 5).spawns.some((s) => s.type === 'stash')).toBe(false);
    expect(buildLevel(LEVEL_SEQUENCE[4], 5).spawns.some((s) => s.type === 'stash')).toBe(false);
  });

  it('populateLevel spawns it; its prompt is `보관함` with the count; interacting opens the stash screen', () => {
    const t = makeTestWorld(flatMap());
    t.world.entities.length = 0;
    const p = new Player(120, FLOOR);
    t.world.player = p;
    t.world.spawn(p);
    populateLevel(t.world, buildLevel(LEVEL_SEQUENCE[1], 7));
    steps(t.world, 1);
    const chest = t.world.entities.find((e) => e instanceof StashChest) as StashChest;
    expect(chest).toBeTruthy();
    expect(t.world.entities.some((e) => e instanceof Seamstress)).toBe(true);
    t.game.save.stash = [it_('spear'), it_('war_hammer')];
    expect([chest.promptText(), chest.promptSub(), chest.canInteract()]).toEqual(['보관함', '2/24', true]);
    const open = vi.fn();
    (t.world as any).ui.openStash = open;
    chest.interact();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('StashModal: keyboard / pad, touch, drawing', () => {
  it('starts on the first stash cell (or the equipment row when the stash is empty); arrows move between the grid and the equipment', () => {
    const a = uiSetup();
    a.save.stash = [it_('spear')];
    const m = a.open();
    expect([m.zone, m.i]).toEqual(['grid', 0]);
    a.ui.key('right');
    a.ui.key('right');
    a.ui.key('down');
    expect([m.zone, m.i]).toEqual(['grid', 8]);
    a.ui.key('left');
    a.ui.key('up');
    expect([m.zone, m.i]).toEqual(['grid', 1]);
    a.ui.key('up'); // off the top row: the equipment cell above
    expect([m.zone, m.i]).toEqual(['equip', 1]);
    a.ui.key('right');
    a.ui.key('right');
    a.ui.key('right');
    expect([m.zone, m.i]).toEqual(['equip', 3]);
    a.ui.key('down');
    expect([m.zone, m.i]).toEqual(['grid', 3]);
    for (let i = 0; i < 8; i++) a.ui.key('down');
    expect(m.i).toBe(21); // the last row
    for (let i = 0; i < 8; i++) a.ui.key('right');
    expect(m.i).toBe(23); // does not wrap into the next row
    const b = uiSetup();
    expect(b.open().zone).toBe('equip');
  });

  it('Enter on a stash item equips it into the free slot of its kind (saved, the cell is freed)', () => {
    const a = uiSetup();
    a.run.weapons = [it_('rusty_sword'), null];
    a.save.stash = [it_('spear'), it_('turret')];
    const m = a.open();
    a.ui.key('confirm');
    expect(a.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'spear']);
    expect(a.save.stash.map((s) => s.id)).toEqual(['turret']);
    expect(a.game.persist).toHaveBeenCalled();
    expect(a.sounds).toContain('pickup_item');
    expect(m.selected()?.id).toBe('turret'); // the cursor stays on the cell, the next entry moved up
    a.ui.key('confirm');
    expect(a.run.skills[0]?.id).toBe('turret');
    expect(a.save.stash).toEqual([]);
  });

  it('with both slots taken, Enter asks which one to replace: left / right pick, Enter swaps (the old item takes the entry\'s place), Esc cancels', () => {
    const a = uiSetup();
    a.run.weapons = [it_('rusty_sword'), it_('old_shield')];
    a.save.stash = [it_('hunter_bow', 2, 'speed', true)];
    const m = a.open();
    a.ui.key('confirm');
    expect(m.pending).toBe(0);
    expect([m.zone, m.i]).toEqual(['equip', 0]);
    a.ui.key('right');
    expect(m.i).toBe(1);
    a.ui.key('right'); // skills are not valid targets for a weapon
    expect(m.i).toBe(1);
    a.ui.key('left');
    expect(m.i).toBe(0);
    a.ui.key('cancel');
    expect([m.pending, m.zone, m.i]).toEqual([null, 'grid', 0]);
    expect(a.ui.top).toBe(m); // cancelling the choice did not close the screen
    expect(a.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'old_shield']);
    a.ui.key('confirm');
    a.ui.key('right');
    a.ui.key('confirm');
    expect(a.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'hunter_bow']);
    expect(a.run.weapons[1]).toEqual({ id: 'hunter_bow', tier: 2, affix: 'speed', mb: true });
    expect(a.save.stash).toEqual([it_('old_shield')]);
    expect(m.pending).toBeNull();
    expect([m.zone, m.i]).toEqual(['grid', 0]);
  });

  it('Enter on an equipped item puts it away (an empty primary is fine); a full stash says so and keeps it', () => {
    const a = uiSetup();
    a.run.weapons = [it_('rusty_sword'), it_('old_shield')];
    const m = a.open();
    expect(m.zone).toBe('equip');
    a.ui.key('confirm');
    expect(a.run.weapons).toEqual([null, it_('old_shield')]);
    expect(a.save.stash).toEqual([it_('rusty_sword')]);
    a.ui.key('confirm'); // nothing in the cell any more
    expect(a.sounds).toContain('error');
    a.ui.key('right');
    a.save.stash = Array.from({ length: STASH.capacity }, () => it_('spear'));
    a.ui.key('confirm');
    expect(a.run.weapons[1]?.id).toBe('old_shield');
    expect(a.save.stash).toHaveLength(STASH.capacity);
  });

  it('분해 (X / Y) is armed by the first press and done by the second; moving away or waiting disarms it', () => {
    const a = uiSetup();
    a.save.pieces = 4;
    a.save.stash = [it_('spear', 2, 'burn'), it_('war_hammer'), it_('bone_cleaver')];
    const m = a.open();
    a.ui.key('special');
    expect(a.save.stash).toHaveLength(3);
    expect(a.save.pieces).toBe(4);
    a.ui.key('right'); // another cell: disarmed
    a.ui.key('left');
    a.ui.key('special');
    expect(a.save.stash).toHaveLength(3);
    a.advance(3.2); // the 3 seconds ran out
    a.ui.key('special');
    expect(a.save.stash).toHaveLength(3);
    a.ui.key('special'); // second press: salvaged (tier 2 + affix = 3 pieces)
    expect(a.save.stash.map((s) => s.id)).toEqual(['war_hammer', 'bone_cleaver']);
    expect(a.save.pieces).toBe(7);
    expect(a.game.persist).toHaveBeenCalled();
    a.ui.key('right');
    a.ui.key('special');
    a.ui.key('special'); // the unique: grade C = 5
    expect(a.save.pieces).toBe(12);
    expect(a.save.stash.map((s) => s.id)).toEqual(['war_hammer']);
    // an equipped item cannot be salvaged from the equipment row
    a.run.weapons = [it_('rusty_sword'), null];
    m.zone = 'equip';
    m.i = 0;
    a.ui.key('special');
    a.ui.key('special');
    expect(a.run.weapons[0]?.id).toBe('rusty_sword');
    expect(a.save.pieces).toBe(12);
  });

  it('Esc closes the screen; the pad Y is `special`', () => {
    const a = uiSetup();
    const m = a.open();
    expect(a.ui.top).toBe(m);
    a.ui.nav('special');
    a.ui.key('cancel');
    expect(a.ui.top).toBeNull();
  });

  it('touch: cells select, 장착 / 분해 / 맡기기 / 닫기 are tap regions; the first tap on 분해 arms it', () => {
    const a = uiSetup();
    a.run.weapons = [it_('rusty_sword'), null];
    a.save.stash = [it_('spear'), it_('war_hammer'), it_('hunter_bow')];
    a.open();
    a.frame();
    for (const id of ['stash-equip0', 'stash-equip3', 'stash-cell0', 'stash-cell23', 'stash-act', 'stash-salvage', 'stash-close']) expect(a.game.taps.byId(id), id).toBeTruthy();
    a.tap('stash-cell1');
    a.frame();
    a.tap('stash-salvage');
    a.frame();
    expect(a.save.stash).toHaveLength(3);
    a.tap('stash-salvage');
    expect(a.save.stash.map((s) => s.id)).toEqual(['spear', 'hunter_bow']);
    a.frame();
    a.tap('stash-cell1');
    a.frame();
    a.tap('stash-act');
    expect(a.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'hunter_bow']);
    a.frame();
    a.tap('stash-equip1');
    a.frame();
    a.tap('stash-act'); // 맡기기
    expect(a.run.weapons[1]).toBeNull();
    expect(a.save.stash.map((s) => s.id)).toEqual(['spear', 'hunter_bow']);
    a.frame();
    a.tap('stash-close');
    expect(a.ui.top).toBeNull();
  });

  it('touch: with both slots taken, tapping the glowing cell completes the swap; tapping elsewhere cancels', () => {
    const a = uiSetup();
    a.run.weapons = [it_('rusty_sword'), it_('old_shield')];
    a.save.stash = [it_('spear'), it_('war_hammer')];
    const m = a.open();
    a.frame();
    a.tap('stash-cell1');
    a.frame();
    a.tap('stash-act');
    expect(m.pending).toBe(1);
    a.frame();
    a.tap('stash-equip2'); // a skill cell: not a valid target
    expect(m.pending).toBeNull();
    expect(a.run.weapons.map((w) => w?.id)).toEqual(['rusty_sword', 'old_shield']);
    a.frame();
    a.tap('stash-cell1');
    a.frame();
    a.tap('stash-act');
    a.frame();
    a.tap('stash-equip0');
    expect(a.run.weapons.map((w) => w?.id)).toEqual(['war_hammer', 'old_shield']);
    expect(a.save.stash.map((s) => s.id)).toEqual(['spear', 'rusty_sword']);
  });

  it('taps are ignored for the first 0.2 s (a finger lifting from the chest prompt must not hit a cell)', () => {
    const a = uiSetup();
    a.ui.openStash();
    a.frame(1 / 60);
    expect(a.game.taps.byId('stash-cell0')).toBeFalsy();
    a.advance(0.3);
    expect(a.game.taps.byId('stash-cell0')).toBeTruthy();
  });

  it('draws at every width without throwing, with every kind of cell (equipped, affix, tier, mid-boss, unique, empty)', () => {
    for (const W of [480, 640, 777, 800]) {
      const a = uiSetup(W);
      a.run.weapons = [it_('rusty_sword', 2, 'burn'), it_('old_shield')];
      a.run.skills = [it_('fire_grenade'), null];
      a.save.stash = [it_('bone_cleaver'), it_('war_hammer', 3, 'dmg', true), it_('chain_hook'), it_('spear', 5)];
      a.save.shards = [1, 1, 2, 3, 3, 3];
      a.save.pieces = 123;
      const m = a.open();
      a.advance(0.5);
      for (let i = 0; i < 4; i++) {
        a.ui.key('right');
        a.advance(0.1);
      }
      m.pending = null;
      a.ui.key('up');
      a.advance(0.1);
      a.save.stash = Array.from({ length: STASH.capacity }, (_, i) => it_(ITEM_IDS[i % 11]));
      a.advance(0.2);
    }
  });

  it('the layout fits every width: cells, card and buttons inside the panel, nothing overlapping, tap targets at least 38 px', () => {
    for (const W of [480, 560, 640, 700, 777, 800]) {
      const L = stashLayout(W, 360);
      const inside = (r: { x: number; y: number; w: number; h: number }, name: string) => {
        expect(r.x, `${name}@${W}`).toBeGreaterThanOrEqual(L.panel.x);
        expect(r.y, `${name}@${W}`).toBeGreaterThanOrEqual(L.panel.y);
        expect(r.x + r.w, `${name}@${W}`).toBeLessThanOrEqual(L.panel.x + L.panel.w);
        expect(r.y + r.h, `${name}@${W}`).toBeLessThanOrEqual(L.panel.y + L.panel.h);
      };
      const all = [...L.equip.map((r, i) => ({ r, n: 'equip' + i })), ...L.grid.map((r, i) => ({ r, n: 'cell' + i })), { r: L.card, n: 'card' }, { r: L.act, n: 'act' }, { r: L.salvage, n: 'salvage' }, { r: L.close, n: 'close' }];
      for (const { r, n } of all) inside(r, n);
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i].r, b = all[j].r;
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, `${all[i].n} vs ${all[j].n} @${W}`).toBe(false);
      }
      for (const r of [...L.equip, ...L.grid, L.act, L.salvage, L.close]) expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(38);
      expect(L.card.w).toBeGreaterThanOrEqual(160);
      expect(L.grid).toHaveLength(24);
    }
  });

  it('the bell shards are summarised by loop, cut to the room there is', () => {
    const c = fakeCtx();
    expect(shardSummary(c, [], 300)).toBe('');
    expect(shardSummary(c, [2, 1, 1, 3, 3, 3], 400)).toBe('1회차 ×2 · 2회차 · 3회차 ×3');
    const cut = shardSummary(c, Array.from({ length: 40 }, (_, i) => i + 1), 90);
    expect(cut.endsWith(' …')).toBe(true);
    expect(cut.startsWith('1회차')).toBe(true);
  });
});
