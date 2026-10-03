import { describe, it, expect } from 'vitest';
import { makeTestWorld, steps } from './helpers';
import { Player } from '../src/game/player/player';
import { Rng } from '../src/engine/rng';
import { ITEMS, rollItem, itemName, itemLines, itemPrice, AFFIX_NAMES } from '../src/game/items/items';
import { ITEM_IDS, STARTER_UNLOCKS, type ItemInstance } from '../src/game/items/types';
import { dropLoot, spawnFood, spawnItemDrop, spawnScroll } from '../src/game/items/pickups';

const FLOOR = 16 * 24;

function setup() {
  const t = makeTestWorld();
  const p = new Player(120, FLOOR);
  t.world.player = p;
  t.world.spawn(p);
  const events: { type: string; [k: string]: unknown }[] = [];
  t.world.on((e) => events.push(e as never));
  steps(t.world, 3);
  return { ...t, p, events };
}

const drops = (world: ReturnType<typeof setup>['world']) =>
  world.entities.filter((e) => (e as unknown as { inst?: ItemInstance }).inst && !e.dead) as unknown as { inst: ItemInstance }[];

describe('catalogue', () => {
  it('has every item id with a name, colour and slot', () => {
    for (const id of ITEM_IDS) {
      const d = ITEMS[id];
      expect(d.id).toBe(id);
      expect(d.name.length).toBeGreaterThan(0);
      expect(['brutality', 'tactics', 'survival']).toContain(d.color);
      if (d.slot === 'skill') expect(d.cooldown).toBeGreaterThan(0);
      expect(itemLines({ id, tier: 1, affix: null }).length).toBeGreaterThan(0);
    }
  });

  it('rollItem respects the unlocked pool and slot, and is deterministic', () => {
    const pool = STARTER_UNLOCKS;
    for (let i = 0; i < 50; i++) {
      const r = rollItem(new Rng(i), 1, pool);
      expect(pool).toContain(r.id);
      const w = rollItem(new Rng(i), 2, pool, 'weapon');
      expect(ITEMS[w.id].slot).toBe('weapon');
      const s = rollItem(new Rng(i), 2, pool, 'skill');
      expect(ITEMS[s.id].slot).toBe('skill');
      expect(s.tier).toBe(2);
    }
    expect(rollItem(new Rng(7), 1, pool)).toEqual(rollItem(new Rng(7), 1, pool));
    expect(rollItem(new Rng(3), 1, [], 'skill').id).toBe('fire_grenade');
    const affixes = new Set<string | null>();
    for (let i = 0; i < 200; i++) affixes.add(rollItem(new Rng(i), 2, [...ITEM_IDS], 'weapon').affix);
    expect(affixes.size).toBeGreaterThan(3);
    // shields only roll sensible affixes
    for (let i = 0; i < 100; i++) {
      const a = rollItem(new Rng(i), 3, ['old_shield']).affix;
      expect(a === null || a === 'heal_on_kill').toBe(true);
    }
  });

  it('Korean names, lines and prices scale with tier and affix', () => {
    const base: ItemInstance = { id: 'spear', tier: 1, affix: null };
    expect(itemName(base)).toBe('창');
    expect(itemName({ ...base, tier: 3 })).toBe('창 +2');
    expect(itemLines({ ...base, affix: 'burn' })).toContain(AFFIX_NAMES.burn);
    expect(itemLines(base).some((l) => l.startsWith('피해'))).toBe(true);
    expect(itemPrice({ ...base, tier: 2, affix: 'dmg' })).toBeGreaterThan(itemPrice(base));
    expect(itemPrice({ id: 'turret', tier: 1, affix: null })).toBeGreaterThan(0);
  });
});

describe('pickups', () => {
  it('dropLoot: cells and gold burst out, home in and are collected', () => {
    const { world, run, events } = setup();
    dropLoot(world, 260, FLOOR, { cells: 3, gold: 22 });
    steps(world, 2);
    expect(world.entities.length).toBeGreaterThan(5);
    steps(world, 200);
    expect(run.cells).toBe(3);
    expect(run.gold).toBe(22);
    const picks = events.filter((e) => e.type === 'pickup');
    expect(picks.some((e) => e.what === 'cells')).toBe(true);
    expect(picks.some((e) => e.what === 'gold')).toBe(true);
    expect(picks.reduce((n, e) => n + (e.what === 'gold' ? (e.amount as number) : 0), 0)).toBe(22);
    expect(world.entities.filter((e) => e.z === 5).length).toBe(0);
  });

  it('loot does not home before ~0.4 s and falls with physics', () => {
    const { world, run } = setup();
    dropLoot(world, 200, FLOOR, { cells: 1 });
    steps(world, 12);
    expect(run.cells).toBe(0);
  });

  it('item drop: equips into an empty slot', () => {
    const { world, input, run, p, events } = setup();
    const spear: ItemInstance = { id: 'spear', tier: 1, affix: null };
    spawnItemDrop(world, p.x + 8, FLOOR, spear);
    steps(world, 40);
    expect(p.nearInteract).not.toBeNull();
    expect(p.nearInteract!.promptText()).toContain('창');
    input.tap('interact');
    steps(world, 3);
    expect(run.weapons[1]).toBe(spear);
    expect(run.weapons[0]!.id).toBe('rusty_sword');
    expect(drops(world).length).toBe(0);
    expect(events.some((e) => e.type === 'pickup' && e.what === 'item')).toBe(true);
  });

  it('item drop: swaps with a chosen slot and drops the replaced item', () => {
    const { world, input, run, p } = setup();
    run.weapons[1] = { id: 'old_shield', tier: 1, affix: null };
    const hammer: ItemInstance = { id: 'war_hammer', tier: 2, affix: 'dmg' };
    let asked: string[] = [];
    (world as any).ui.openChoice = (_t: string, opts: { label: string }[], pick: (i: number) => void) => {
      asked = opts.map((o) => o.label);
      pick(1); // replace the secondary slot
    };
    spawnItemDrop(world, p.x + 8, FLOOR, hammer);
    steps(world, 40);
    input.tap('interact');
    steps(world, 3);
    expect(asked.length).toBe(2);
    expect(run.weapons[1]).toBe(hammer);
    expect(run.weapons[0]!.id).toBe('rusty_sword');
    const left = drops(world);
    expect(left.length).toBe(1);
    expect(left[0].inst.id).toBe('old_shield');
    // cancelling keeps everything as it was
    (world as any).ui.openChoice = (_t: string, _o: unknown, pick: (i: number) => void) => pick(-1);
    steps(world, 40);
    input.tap('interact');
    steps(world, 3);
    expect(run.weapons[1]).toBe(hammer);
    expect(drops(world).length).toBe(1);
  });

  it('skill drops use the skill slots; the player picks up the new skill', () => {
    const { world, input, run, p } = setup();
    spawnItemDrop(world, p.x + 8, FLOOR, { id: 'ice_grenade', tier: 1, affix: null });
    steps(world, 40);
    input.tap('interact');
    steps(world, 3);
    expect(run.skills[0]!.id).toBe('ice_grenade');
    steps(world, 3);
    expect(p.skillCooldownMax[0]).toBe(12);
  });

  it('food heals only when HP is not full', () => {
    const { world, run, p } = setup();
    spawnFood(world, p.x + 4, FLOOR, 0.35);
    steps(world, 60);
    expect(world.entities.some((e) => e.constructor.name === 'Food')).toBe(true); // full HP: stays
    run.hp = 50;
    const food = world.entities.find((e) => e.constructor.name === 'Food')!;
    p.x = food.x;
    steps(world, 20);
    expect(p.hp).toBe(85);
    expect(world.entities.some((e) => e.constructor.name === 'Food')).toBe(false);
  });

  it('scroll: choose a colour, run stats and player HP update', () => {
    const { world, input, run, p, events } = setup();
    let title = '';
    (world as any).ui.openChoice = (t: string, opts: unknown[], pick: (i: number) => void) => {
      title = t;
      expect(opts.length).toBe(3);
      pick(2);
    };
    spawnScroll(world, p.x + 8, FLOOR);
    steps(world, 40);
    expect(p.nearInteract).not.toBeNull();
    input.tap('interact');
    steps(world, 3);
    expect(title.length).toBeGreaterThan(0);
    expect(run.stats.survival).toBe(1);
    expect(run.maxHp).toBe(120);
    expect(p.maxHp).toBe(120);
    expect(p.hp).toBe(120);
    expect(events.some((e) => e.type === 'pickup' && e.what === 'scroll')).toBe(true);
    expect(world.entities.some((e) => e.constructor.name === 'Scroll')).toBe(false);
  });
});
