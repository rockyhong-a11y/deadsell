import { describe, it, expect } from 'vitest';
import { makeTestWorld, steps, flatMap, implemented } from './helpers';
import { Player } from '../src/game/player/player';
import { Actor } from '../src/game/entity';
import type { DamageInfo } from '../src/game/combat';
import { T, type TileMap } from '../src/game/tilemap';
import { defaultSave, loadSave } from '../src/game/meta/save';
import { unlockedCount } from '../src/game/meta/progression';
import { AFFIX, CRIT_MULT } from '../src/game/rules';
import { ITEMS, UNIQUE_COLOR, affixPool, itemColor, itemLines, itemName, rollItem, signatureText } from '../src/game/items/items';
import { spawnItemDrop } from '../src/game/items/pickups';
import { ITEM_IDS, STARTER_UNLOCKS, UNIQUE_IDS, type ItemId, type ItemInstance } from '../src/game/items/types';
import { Rng } from '../src/engine/rng';
import { WEAPONS, type BowWeapon, type MeleeWeapon, type ShieldWeapon, type WeaponDef } from '../src/game/player/weapons';
import { BONE_SPIKES, CHAIN_HOOK, CORPSE_BOMB, SKILLS, SKILL_BASE, SOUL_LANTERN } from '../src/game/player/skills';
import { Arrow, BoneSpikes, ChainHook, Grenade, SoulFlames } from '../src/game/player/projectiles';
import { buildCodex, codexEntries } from '../src/game/ui/codexData';

const FLOOR = 16 * 24;

/** a stationary enemy-team target; `times` = world time of every hit it took */
class Dummy extends Actor {
  log: DamageInfo[] = [];
  times: number[] = [];
  constructor(x: number, y: number, hp = 100000, kb = 1) {
    super(x, y);
    this.w = 16;
    this.h = 40;
    this.hp = this.maxHp = hp;
    this.physics = false;
    this.knockbackTaken = kb;
  }
  takeDamage(info: DamageInfo) {
    if (info.kind !== 'dot') {
      this.log.push(info);
      this.times.push(this.world.time);
    }
    return super.takeDamage(info);
  }
  update(dt: number) {
    this.updateStatus(dt);
  }
  draw() {}
}

function setup(map: TileMap = flatMap(), x = 120) {
  const t = makeTestWorld(map);
  const p = new Player(x, FLOOR);
  t.world.player = p;
  t.world.spawn(p);
  const sounds: string[] = [];
  t.game.audio.play = (s: string) => { sounds.push(s); };
  steps(t.world, 3);
  return { ...t, p, sounds };
}
type Ctx = ReturnType<typeof setup>;

const item = (id: ItemId, tier = 1): ItemInstance => ({ id, tier, affix: null });
const equip = (t: Ctx, id: ItemId, slot = 0) => {
  if (ITEMS[id].slot === 'skill') t.run.skills[slot] = item(id);
  else t.run.weapons[slot] = item(id);
};
/** one swing of weapon slot 0, then wait until the heroine is free again */
function swing(t: Ctx): void {
  t.input.tap('attack1');
  steps(t.world, 4);
  for (let i = 0; i < 60 && t.p.state === 'attack'; i++) steps(t.world, 1);
}
/** a heroine with `id` in hand and a target 30 px in front of her */
function duel(id: ItemId, targetHp = 100000) {
  const t = setup();
  equip(t, id);
  const e = new Dummy(t.p.x + 30, FLOOR, targetHp);
  t.world.spawn(e);
  steps(t.world, 1);
  return { ...t, e };
}
const dpsOf = (w: MeleeWeapon, withCrit: boolean): number => {
  let dmg = 0;
  let time = 0;
  w.hits.forEach((h, i) => {
    dmg += h.damage * (withCrit && h.crit === 'always' ? CRIT_MULT : 1);
    time += h.windup + h.active + h.recover * (i === w.hits.length - 1 ? 1 : 0.45);
  });
  return dmg / time;
};

/** a weapon table narrowed by its `kind` (throws when the id is of another kind) */
function weapon<K extends WeaponDef['kind']>(id: keyof typeof WEAPONS, kind: K): Extract<WeaponDef, { kind: K }> {
  const w = WEAPONS[id];
  if (w.kind !== kind) throw new Error(`${id} is a ${w.kind}, not a ${kind}`);
  return w as Extract<WeaponDef, { kind: K }>;
}
const melee = (id: keyof typeof WEAPONS): MeleeWeapon => weapon(id, 'melee');
const bowOf = (id: keyof typeof WEAPONS): BowWeapon => weapon(id, 'bow');
const shieldOf = (id: keyof typeof WEAPONS): ShieldWeapon => weapon(id, 'shield');

// ---------------------------------------------------------------------------------------------------------------------
describe('the catalogue of unique items (docs/CONTENT3.md §5)', () => {
  const spec: [ItemId, string, string, string, string][] = [
    ['bone_cleaver', '뼈 도살검', 'brutality', 'weapon', 'melee'],
    ['reaper_scythe', '사신의 낫', 'brutality', 'weapon', 'melee'],
    ['stitch_needle', '재봉 바늘', 'tactics', 'weapon', 'melee'],
    ['widow_fangs', '과부의 송곳니', 'tactics', 'weapon', 'melee'],
    ['coffin_lid', '관 뚜껑', 'survival', 'weapon', 'shield'],
    ['marrow_bow', '골수 활', 'tactics', 'weapon', 'bow'],
    ['corpse_bomb', '시체 폭탄', 'brutality', 'skill', 'skill'],
    ['bone_spikes', '뼈 가시', 'tactics', 'skill', 'skill'],
    ['soul_lantern', '영혼 등불', 'survival', 'skill', 'skill'],
    ['chain_hook', '사슬 갈고리', 'tactics', 'skill', 'skill'],
  ];

  it('the ten uniques of CONTENT3 are in UNIQUE_IDS (grade C and B), flagged `unique`, with the spec name / colour / slot', () => {
    expect(UNIQUE_IDS).toHaveLength(30);
    expect(UNIQUE_IDS.slice(0, 10).map((id) => ITEMS[id].grade)).toEqual(['C', 'C', 'C', 'C', 'C', 'B', 'B', 'B', 'B', 'B']);
    expect([...UNIQUE_IDS.slice(0, 10)].sort()).toEqual(spec.map((s) => s[0]).sort());
    for (const [id, name, color, slot, kind] of spec) {
      const d = ITEMS[id];
      expect([d.name, d.color, d.slot, d.kind, d.unique, d.icon]).toEqual([name, color, slot, kind, true, id]);
      expect(ITEM_IDS).toContain(id);
      expect([...d.desc].length, `${id} desc`).toBeLessThanOrEqual(16);
    }
    for (const id of ITEM_IDS) if (!UNIQUE_IDS.includes(id)) expect(ITEMS[id].unique, id).toBeFalsy();
  });

  it('skills carry the cooldowns of the spec; weapons and skills have their tables', () => {
    const cd: Partial<Record<ItemId, number>> = { corpse_bomb: 12, bone_spikes: 9, soul_lantern: 16, chain_hook: 7 };
    for (const [id, c] of Object.entries(cd)) {
      expect(ITEMS[id as ItemId].cooldown).toBe(c);
      expect(SKILLS[id as ItemId], id).toBeTruthy();
      expect(SKILL_BASE[id as keyof typeof SKILL_BASE], id).toBeGreaterThan(0);
    }
    for (const [id] of spec) if (ITEMS[id].slot === 'weapon') expect((WEAPONS as Record<string, unknown>)[id], id).toBeTruthy();
    expect(SKILL_BASE).toMatchObject({ corpse_bomb: 40, bone_spikes: 18, soul_lantern: 10, chain_hook: 12 });
  });

  it('weapon families: sword 3 hits, hammer 2 sweeps (faster), spear 3 thrusts, daggers 4 hits (anims of the family)', () => {
    const anims = (id: keyof typeof WEAPONS) => melee(id).hits.map((h) => h.anim);
    expect(anims('bone_cleaver')).toEqual(['sword_1', 'sword_2', 'sword_3']);
    expect(anims('reaper_scythe')).toEqual(['hammer_1', 'hammer_2']);
    expect(anims('stitch_needle')).toEqual(['spear_1', 'spear_2', 'spear_3']);
    expect(anims('widow_fangs')).toEqual(['dagger_1', 'dagger_2', 'dagger_3', 'dagger_4']);
    const dur = (id: keyof typeof WEAPONS) => melee(id).hits.reduce((n, h) => n + h.windup + h.active + h.recover, 0);
    expect(dur('reaper_scythe')).toBeLessThan(dur('war_hammer'));
    const hammerReach = Math.max(...melee('war_hammer').hits.map((h) => h.box.w));
    expect(Math.max(...melee('reaper_scythe').hits.map((h) => h.box.w))).toBeGreaterThanOrEqual(hammerReach);
    expect(shieldOf('coffin_lid')).toMatchObject({ kind: 'shield', reduction: 0.9, shockwave: { radius: 72, damage: 30, stun: 1.5 } });
    expect(bowOf('marrow_bow')).toMatchObject({ kind: 'bow', pierce: true });
  });

  it('balance: the base tables sit roughly 15 % above the DPS of their family (the signature comes on top)', () => {
    const pairs: [keyof typeof WEAPONS, keyof typeof WEAPONS][] = [
      ['bone_cleaver', 'rusty_sword'], ['reaper_scythe', 'war_hammer'], ['stitch_needle', 'spear'], ['widow_fangs', 'twin_daggers'],
    ];
    for (const [u, base] of pairs) {
      const r = dpsOf(melee(u), false) / dpsOf(melee(base), true);
      expect(r, `${u} / ${base}`).toBeGreaterThan(1.05);
      expect(r, `${u} / ${base}`).toBeLessThan(1.25);
    }
    const bow = (id: 'hunter_bow' | 'marrow_bow') => bowOf(id).damage / bowOf(id).drawTime;
    expect(bow('marrow_bow') / bow('hunter_bow')).toBeGreaterThan(1.05);
    expect(bow('marrow_bow') / bow('hunter_bow')).toBeLessThan(1.25);
  });

  it('item colour: bone-gold for uniques, the stat colour for the rest; names and cards come from the tables', () => {
    expect(UNIQUE_COLOR).toBe('#f0d9a0');
    for (const id of ITEM_IDS) expect(itemColor(id) === UNIQUE_COLOR, id).toBe(!!ITEMS[id].unique);
    expect(itemName(item('bone_cleaver', 2))).toBe('뼈 도살검 +1');
    for (const id of UNIQUE_IDS.filter(implemented)) {
      const lines = itemLines(item(id));
      expect(lines[0]).toBe(ITEMS[id].desc);
      expect(lines.at(-1), id).toBe(signatureText(id));
      expect(signatureText(id).length, id).toBeGreaterThan(8);
      expect(signatureText(id), id).not.toMatch(/undefined|NaN/);
    }
    // an entry whose behaviour is not written yet has no signature line (and no empty line on its card)
    for (const id of UNIQUE_IDS.filter((i) => !implemented(i))) {
      const lines = itemLines(item(id));
      expect(lines[0], id).toBe(ITEMS[id].desc);
      expect(lines.every((l) => l.length > 0), id).toBe(true);
    }
    // numbers of the cards are the table numbers
    expect(signatureText('reaper_scythe')).toContain(`${Math.round(melee('reaper_scythe').healOnKill! * 100)}%`);
    expect(signatureText('stitch_needle')).toContain(`${melee('stitch_needle').critAfterRoll}초`);
    expect(signatureText('widow_fangs')).toContain(`${melee('widow_fangs').critAfterHurt}초`);
    expect(signatureText('coffin_lid')).toContain(`${shieldOf('coffin_lid').shockwave!.radius}px`);
    expect(signatureText('corpse_bomb')).toContain(`${CORPSE_BOMB.chain.radius}px`);
    expect(signatureText('bone_spikes')).toContain(`${BONE_SPIKES.count}개`);
    expect(signatureText('soul_lantern')).toContain(`${SOUL_LANTERN.flames}개`);
    expect(signatureText('chain_hook')).toContain(`${CHAIN_HOOK.range}px`);
    // the shield line reads its own table (coffin lid 90 %, old shield 80 %)
    expect(itemLines(item('coffin_lid'))[1]).toContain('-90%');
    expect(itemLines(item('old_shield'))[1]).toContain('-80%');
    // the card scales the damage figures of a signature with the tier
    expect(signatureText('coffin_lid', (b) => b * 2)).toContain(`피해 ${shieldOf('coffin_lid').shockwave!.damage * 2}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('unique items stay out of every random pool', () => {
  it('rollItem never returns a unique (any slot, any tier, even when the unlocked list names them), and never an affix on one', () => {
    const rng = new Rng(21);
    for (let i = 0; i < 600; i++) {
      for (const slot of [undefined, 'weapon', 'skill'] as const) {
        const r = rollItem(rng, 1 + (i % 3), ITEM_IDS, slot, { guaranteeAffix: i % 2 === 0 });
        expect(UNIQUE_IDS.includes(r.id), r.id).toBe(false);
      }
    }
    // only uniques unlocked -> the slot fallback, not a unique
    expect(UNIQUE_IDS.includes(rollItem(new Rng(1), 1, [...UNIQUE_IDS]).id)).toBe(false);
    expect(rollItem(new Rng(1), 1, [...UNIQUE_IDS], 'skill').id).toBe('fire_grenade');
    expect(rollItem(new Rng(1), 1, [...UNIQUE_IDS], 'weapon').id).toBe('rusty_sword');
  });

  it('a unique rolls no affix (empty pool); the other items keep theirs', () => {
    for (const id of UNIQUE_IDS) expect(affixPool(id), id).toEqual([]);
    expect(affixPool('spear').length).toBeGreaterThan(0);
  });

  it('the title unlock count ignores uniques (x / y over the 33 ordinary items)', () => {
    const c = unlockedCount(defaultSave());
    expect(c.total).toBe(ITEM_IDS.length - UNIQUE_IDS.length);
    expect(c.total).toBe(33);
    expect(c.have).toBe(STARTER_UNLOCKS.length);
    const s = defaultSave();
    s.unlocked.push('bone_cleaver'); // a hand-edited save
    expect(unlockedCount(s)).toEqual(c);
  });

  it('loadSave drops unique ids from the unlock list and keeps working', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    try {
      store.set('deadsell.save.v1', JSON.stringify({ unlocked: ['spear', 'bone_cleaver', 'chain_hook', 'nope'], loop: 3 }));
      const s = loadSave();
      expect(s.unlocked).toContain('spear');
      for (const id of UNIQUE_IDS) expect(s.unlocked).not.toContain(id);
      expect(s.loop).toBe(3);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('a unique item on the floor is a usable item', () => {
  /** an item drop with `inst` in front of the heroine */
  function dropFor(inst: ItemInstance) {
    const t = setup();
    spawnItemDrop(t.world, t.p.x + 10, FLOOR, inst);
    steps(t.world, 40);
    return { ...t, drop: dropsOf(t)[0] };
  }
  type Drop = { inst: ItemInstance; x: number; canInteract(): boolean; interact(): void };
  const dropsOf = (t: Ctx): Drop[] => t.world.entities.filter((e): e is typeof e & Drop => !e.dead && (e as unknown as Drop).inst !== undefined);

  it('it is picked up into the matching slot with its tier and no affix', () => {
    const t = dropFor({ id: 'chain_hook', tier: 1, affix: null });
    expect(t.drop.canInteract()).toBe(true);
    expect(t.world.nearestInteractable(t.p.x, t.p.y - 16)).toBe(t.drop);
    t.drop.interact();
    expect(t.run.skills).toEqual([{ id: 'chain_hook', tier: 1, affix: null }, null]);
    expect(dropsOf(t)).toHaveLength(0);
  });

  it('a full slot asks which to replace and drops the old item', () => {
    const t = setup();
    t.run.weapons = [item('rusty_sword'), item('spear')];
    spawnItemDrop(t.world, t.p.x + 10, FLOOR, item('marrow_bow'));
    steps(t.world, 40);
    dropsOf(t)[0].interact(); // the test UI picks the first option: the main hand
    expect(t.run.weapons.map((w) => w?.id)).toEqual(['marrow_bow', 'spear']);
    steps(t.world, 5);
    expect(dropsOf(t).map((d) => d.inst.id)).toEqual(['rusty_sword']);
  });

  it('every working unique: pick up, use once (a weapon swings / draws / blocks, a skill starts its cooldown)', () => {
    for (const id of UNIQUE_IDS.filter(implemented)) {
      const t = dropFor({ id, tier: 1, affix: null });
      const e = new Dummy(t.p.x + 40, FLOOR);
      t.world.spawn(e);
      expect(t.drop.inst.id, id).toBe(id);
      t.drop.interact();
      const slot = ITEMS[id].slot === 'skill' ? t.run.skills : t.run.weapons;
      expect(slot.map((s) => s?.id), id).toContain(id);
      const states = new Set<string>();
      if (ITEMS[id].slot === 'skill') t.input.tap(slot[0]?.id === id ? 'skill1' : 'skill2');
      else t.input.press(slot[0]?.id === id ? 'attack1' : 'attack2');
      for (let i = 0; i < 60; i++) {
        steps(t.world, 1);
        states.add(t.p.state);
      }
      if (ITEMS[id].slot === 'skill') expect(Math.max(...t.p.skillCooldown), id).toBeGreaterThan(0);
      else expect([...states].some((st) => st !== 'free'), `${id} states ${[...states]}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('뼈 도살검: every hit bleeds, crit against bleeding targets', () => {
  it('the first hit bleeds (3 s) without crit; the next hit on the bleeding target crits for x2', () => {
    const t = duel('bone_cleaver');
    swing(t);
    swing(t);
    const [a, b] = t.e.log;
    expect(a.crit).toBeFalsy();
    expect(a.bleed).toBe(3);
    expect(a.amount).toBe(17);
    expect(b.crit).toBe(true);
    expect(b.bleed).toBe(3);
    expect(b.amount).toBe(17 * CRIT_MULT);
    expect(t.e.status.bleed).toBeGreaterThan(0);
  });

  it('a target that already bleeds (from anything) is crit on the very first hit; a clean target is not', () => {
    const t = duel('bone_cleaver');
    t.e.status.bleed = 2;
    swing(t);
    expect(t.e.log[0].crit).toBe(true);
    const clean = duel('bone_cleaver');
    swing(clean);
    expect(clean.e.log[0].crit).toBeFalsy();
    // other swords do not do it
    const sword = duel('rusty_sword');
    sword.e.status.bleed = 2;
    swing(sword);
    expect(sword.e.log[0].crit).toBeFalsy();
  });
});

describe('사신의 낫: each kill heals 8 % of max HP', () => {
  it('a kill with the scythe heals 8 % of max HP; hits that do not kill, and kills with another weapon, heal nothing', () => {
    const t = duel('reaper_scythe', 10);
    t.run.hp = 50;
    steps(t.world, 1);
    expect(t.p.hp).toBe(50);
    swing(t);
    expect(t.e.dying).toBe(true);
    expect(t.p.hp).toBe(50 + Math.round(t.p.maxHp * melee('reaper_scythe').healOnKill!));
    expect(t.p.hp).toBe(58);

    const hurt = duel('reaper_scythe'); // a target that survives
    hurt.run.hp = 50;
    steps(hurt.world, 1);
    swing(hurt);
    expect(hurt.p.hp).toBe(50);

    const other = duel('rusty_sword', 10);
    other.run.hp = 50;
    steps(other.world, 1);
    swing(other);
    expect(other.e.dying).toBe(true);
    expect(other.p.hp).toBe(50);
  });
});

describe('재봉 바늘: all hits crit for 2 s after a roll', () => {
  function roll(t: Ctx) {
    t.input.press('roll');
    steps(t.world, 1);
    t.input.release('roll');
    for (let i = 0; i < 60 && t.p.state === 'roll'; i++) steps(t.world, 1);
    expect(t.p.state).not.toBe('roll');
  }
  const place = (t: ReturnType<typeof duel>) => { t.e.x = t.p.x + 30; };

  it('no crit before any roll; crit right after one; none once 2 s have passed', () => {
    const t = duel('stitch_needle');
    swing(t);
    expect(t.e.log[0].crit).toBeFalsy();
    expect(t.e.log[0].amount).toBe(18);
    steps(t.world, 30);
    roll(t);
    place(t);
    swing(t);
    expect(t.e.log[1].crit).toBe(true);
    expect(t.e.log[1].amount).toBe(18 * CRIT_MULT);
    // the window is `critAfterRoll` seconds long, and every hit of the combo inside it crits
    steps(t.world, 20);
    place(t);
    swing(t);
    expect(t.e.log[2].crit).toBe(true);
    steps(t.world, Math.ceil(melee('stitch_needle').critAfterRoll! * 60) + 10);
    place(t);
    swing(t);
    expect(t.e.log[3].crit).toBeFalsy();
  });

  it('other spears do not get the window (and the spear keeps its 3rd-thrust crit)', () => {
    const t = duel('spear');
    roll(t);
    place(t);
    swing(t);
    expect(t.e.log[0].crit).toBeFalsy();
  });
});

describe('과부의 송곳니: all hits crit for 3 s after taking damage (spite)', () => {
  it('crit while the spite window is open, plain before it and after it', () => {
    const t = duel('widow_fangs');
    swing(t);
    expect(t.e.log[0].crit).toBeFalsy();
    expect(t.e.log[0].amount).toBe(8);
    steps(t.world, 20);
    t.p.takeDamage({ amount: 5, dir: -1, kind: 'melee' });
    steps(t.world, 30); // hurt + i-frames are over soon enough to swing
    t.e.x = t.p.x + 30;
    swing(t);
    const hit = t.e.log.at(-1)!;
    expect(hit.crit).toBe(true);
    expect(hit.amount).toBe(8 * CRIT_MULT);
    // all four hits of the combo crit inside the window
    for (let i = 0; i < 3; i++) swing(t);
    expect(t.e.log.slice(-3).every((l) => l.crit)).toBe(true);
    steps(t.world, Math.ceil(melee('widow_fangs').critAfterHurt! * 60) + 10);
    t.e.x = t.p.x + 30;
    swing(t);
    expect(t.e.log.at(-1)!.crit).toBeFalsy();
  });

  it('a blocked hit that costs HP opens the window too; damage over time does not', () => {
    const t = duel('widow_fangs');
    t.p.takeDamage({ amount: 3, dir: 0, kind: 'dot', dotType: 'burn' });
    steps(t.world, 2);
    swing(t);
    expect(t.e.log[0].crit).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('관 뚜껑: blocks 90 %, a parry releases a shockwave', () => {
  const lid = (id: ItemId = 'coffin_lid') => {
    const t = setup();
    equip(t, id, 1);
    const near = new Dummy(t.p.x + 30, FLOOR);
    near.facing = -1;
    const behind = new Dummy(t.p.x - 50, FLOOR);
    const mid = new Dummy(t.p.x + 60, FLOOR);
    const far = new Dummy(t.p.x + 140, FLOOR);
    for (const e of [near, behind, mid, far]) t.world.spawn(e);
    steps(t.world, 1);
    return { ...t, near, behind, mid, far };
  };

  it('a parry in the first 0.2 s: shockwave r 72 (damage 30, stun 1.5, unblockable) around her; farther enemies are not touched', () => {
    const t = lid();
    t.input.press('attack2');
    steps(t.world, 3);
    expect(t.p.state).toBe('block');
    const r = t.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: t.near });
    expect(r.parried).toBe(true);
    expect(t.p.hp).toBe(100);
    for (const e of [t.near, t.behind, t.mid]) {
      const hit = e.log.find((i) => i.kind === 'explosion');
      expect(hit, 'enemy inside the radius').toBeTruthy();
      expect([hit!.amount, hit!.stun, hit!.unblockable]).toEqual([30, 1.5, true]);
      expect(e.status.stun).toBeGreaterThan(1.3);
      expect(e.log.filter((i) => i.kind === 'explosion')).toHaveLength(1);
    }
    expect(t.far.log).toHaveLength(0);
    expect(t.sounds).toContain('parry');
    // once per block: a second parry-time projectile / hit inside the same window adds nothing
    t.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: t.near });
    expect(t.near.log.filter((i) => i.kind === 'explosion')).toHaveLength(1);
  });

  it('the shockwave reaches exactly the radius of its table', () => {
    const t = setup();
    equip(t, 'coffin_lid', 1);
    const r = shieldOf('coffin_lid').shockwave!.radius;
    const inside = new Dummy(t.p.x + r - 8 - 2, FLOOR); // hurtbox edge 2 px inside the circle (at chest height)
    const outside = new Dummy(t.p.x + r + 8 + 6, FLOOR);
    t.world.spawn(inside);
    t.world.spawn(outside);
    steps(t.world, 1);
    t.input.press('attack2');
    steps(t.world, 3);
    t.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: inside });
    expect(inside.log.some((i) => i.kind === 'explosion')).toBe(true);
    expect(outside.log).toHaveLength(0);
  });

  it('blocking after the parry window takes 10 % (90 % blocked); the old shield takes 20 % and has no shockwave', () => {
    const t = lid();
    t.input.press('attack2');
    steps(t.world, 20);
    const r = t.p.takeDamage({ amount: 40, dir: -1, kind: 'melee', source: t.near });
    expect([r.blocked, r.amount]).toEqual([true, 4]);
    expect(t.p.hp).toBe(96);
    expect(t.near.log.some((i) => i.kind === 'explosion')).toBe(false); // a plain block releases nothing

    const old = lid('old_shield');
    old.input.press('attack2');
    steps(old.world, 3);
    expect(old.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: old.near }).parried).toBe(true);
    expect(old.near.log.some((i) => i.kind === 'explosion')).toBe(false);
    const later = lid('old_shield');
    later.input.press('attack2');
    steps(later.world, 20);
    expect(later.p.takeDamage({ amount: 40, dir: -1, kind: 'melee', source: later.near }).amount).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('골수 활: a fully drawn arrow pierces every enemy in its path', () => {
  function shoot(id: ItemId, drawSteps: number) {
    const t = setup();
    equip(t, id);
    const es = [100, 160, 220].map((dx) => new Dummy(t.p.x + dx, FLOOR));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    t.input.press('attack1');
    steps(t.world, drawSteps);
    t.input.release('attack1');
    steps(t.world, 130); // the arrow flies on past all three until its 1.6 s life is over
    return { ...t, es };
  }

  it('full draw: every enemy on the line is hit, each exactly once, for the full damage', () => {
    const t = shoot('marrow_bow', 40);
    for (const e of t.es) {
      expect(e.log, 'each enemy is hit once').toHaveLength(1);
      expect(e.log[0].amount).toBe(bowOf('marrow_bow').damage);
      expect(e.log[0].kind).toBe('ranged');
    }
    expect(t.world.entities.some((x) => x instanceof Arrow && !x.dead)).toBe(false);
  });

  it('a half-drawn arrow, and the ordinary bow at full draw, stop at the first enemy', () => {
    const half = shoot('marrow_bow', 12);
    expect(half.es.map((e) => e.log.length)).toEqual([1, 0, 0]);
    const hunter = shoot('hunter_bow', 40);
    expect(hunter.es.map((e) => e.log.length)).toEqual([1, 0, 0]);
  });

  it('a piercing arrow still stops in a wall', () => {
    const m = flatMap();
    for (let y = 10; y < 16; y++) m.set(Math.floor(310 / 24), y, T.Solid);
    const t = setup(m);
    equip(t, 'marrow_bow');
    const past = new Dummy(t.p.x + 260, FLOOR);
    const before = new Dummy(t.p.x + 100, FLOOR);
    t.world.spawn(before);
    t.world.spawn(past);
    steps(t.world, 1);
    t.input.press('attack1');
    steps(t.world, 40);
    t.input.release('attack1');
    steps(t.world, 70);
    expect([before.log.length, past.log.length]).toEqual([1, 0]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('시체 폭탄: a big blast, and what it kills bursts once more', () => {
  const FX = 500;
  /** grenade at the left edge of A (a wide target), D beyond the blast but inside A's chain radius, E inside D's chain radius only */
  function bomb(opts: { aHp: number; dHp: number }) {
    const t = setup();
    const a = new Dummy(FX, FLOOR, opts.aHp);
    a.w = 60;
    const d = new Dummy(FX + 40, FLOOR, opts.dHp);
    const e = new Dummy(FX + 70, FLOOR);
    const far = new Dummy(FX + 400, FLOOR);
    for (const x of [a, d, e, far]) t.world.spawn(x);
    steps(t.world, 1);
    t.world.spawn(new Grenade(FX - 32, FLOOR - 20, 0, 0, t.p, item('corpse_bomb'), 'corpse', SKILL_BASE.corpse_bomb, CORPSE_BOMB));
    steps(t.world, 3);
    return { ...t, a, d, e, far };
  }

  it('the blast hurts for the table damage (no burn, no freeze); the thrown bomb arcs like a grenade and bursts on the first enemy', () => {
    const t = setup();
    equip(t, 'corpse_bomb');
    const e = new Dummy(t.p.x + 100, FLOOR);
    t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 100);
    const boom = e.log.find((i) => i.kind === 'explosion')!;
    expect(boom.amount).toBe(SKILL_BASE.corpse_bomb);
    expect(boom.burn).toBeUndefined();
    expect(boom.freeze).toBeUndefined();
    expect(t.p.skillCooldownMax[0]).toBe(12);
  });

  it('an enemy the blast kills bursts again (r 44, 20 damage) and hurts what is next to it; those outside the burst are untouched', () => {
    const t = bomb({ aHp: 30, dHp: 100000 });
    expect(t.a.log.map((i) => i.amount)).toEqual([SKILL_BASE.corpse_bomb]);
    expect(t.a.dying).toBe(true);
    // D stands beyond the 56 px blast but inside the 44 px burst of A: only the burst reached it
    expect(t.d.log.map((i) => i.amount)).toEqual([CORPSE_BOMB.chain.base]);
    expect(t.far.log).toHaveLength(0);
  });

  it('no kill, no burst', () => {
    const t = bomb({ aHp: 100000, dHp: 100000 });
    expect(t.a.log.map((i) => i.amount)).toEqual([SKILL_BASE.corpse_bomb]);
    expect(t.d.log).toHaveLength(0);
  });

  it('one chain level only: an enemy killed BY a burst does not burst', () => {
    const t = bomb({ aHp: 30, dHp: 10 });
    expect(t.d.dying).toBe(true);
    expect(t.d.log.map((i) => i.amount)).toEqual([CORPSE_BOMB.chain.base]);
    expect(t.e.log, 'E is inside D\'s burst radius but D\'s death chains no further').toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('뼈 가시: five spikes along the floor, 28 px apart, one every 0.08 s', () => {
  function cast(map: TileMap = flatMap()) {
    const t = setup(map);
    equip(t, 'bone_spikes');
    const slots = [1, 2, 3, 4, 5, 6].map((k) => new Dummy(t.p.x + BONE_SPIKES.spacing * k, FLOOR));
    const behind = new Dummy(t.p.x - BONE_SPIKES.spacing, FLOOR);
    for (const e of [...slots, behind]) t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    let line: BoneSpikes | undefined;
    for (let i = 0; i < 60; i++) {
      steps(t.world, 1);
      line ??= t.world.entities.find((e): e is BoneSpikes => e instanceof BoneSpikes);
    }
    return { ...t, slots, behind, line: line! };
  }

  it('erupts 5 spikes in front, 28 px apart; each hurts the enemy over it once (18 damage, knock-up 220); the sixth slot and behind are safe', () => {
    const t = cast();
    const line = t.line;
    expect(line.spikes).toHaveLength(BONE_SPIKES.count);
    expect(line.spikes.map((s) => s.x)).toEqual([1, 2, 3, 4, 5].map((k) => t.p.x + BONE_SPIKES.spacing * k));
    expect(new Set(line.spikes.map((s) => s.y))).toEqual(new Set([FLOOR]));
    for (const e of t.slots.slice(0, 5)) {
      expect(e.log, 'one spike per enemy').toHaveLength(1);
      expect([e.log[0].amount, e.log[0].knockup]).toEqual([SKILL_BASE.bone_spikes, BONE_SPIKES.knockup]);
      expect(e.vy).toBe(-BONE_SPIKES.knockup);
    }
    expect(t.slots[5].log).toHaveLength(0);
    expect(t.behind.log).toHaveLength(0);
    // eruption times: one after the other, `interval` apart (to the frame)
    const gaps = line.spikes.slice(1).map((s, i) => s.t0 - line.spikes[i].t0);
    for (const g of gaps) expect(Math.abs(g - BONE_SPIKES.interval)).toBeLessThan(1 / 60 + 1e-9);
    // the line is gone afterwards
    steps(t.world, 60);
    expect(t.world.entities.some((e) => e instanceof BoneSpikes)).toBe(false);
  });

  it('they come one after the other: the first enemy is hit before the last', () => {
    const t = setup();
    equip(t, 'bone_spikes');
    const first = new Dummy(t.p.x + 28, FLOOR);
    const last = new Dummy(t.p.x + 140, FLOOR);
    t.world.spawn(first);
    t.world.spawn(last);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 60);
    expect(last.times[0] - first.times[0]).toBeGreaterThan(0.25);
    expect(last.times[0] - first.times[0]).toBeLessThan(0.4);
  });

  it('a wall in front ends the line early; a pit does too', () => {
    const wall = flatMap();
    wall.set(Math.floor((120 + 28 * 3) / 24), 15, T.Solid);
    const a = cast(wall);
    const n = a.line.spikes.length;
    expect(n).toBeLessThan(BONE_SPIKES.count);
    expect(n).toBeGreaterThanOrEqual(2);
    const pit = flatMap();
    for (let x = 8; x < 12; x++) { pit.set(x, 16, T.Empty); pit.set(x, 17, T.Empty); }
    const b = cast(pit);
    expect(b.line.spikes.length).toBeLessThan(BONE_SPIKES.count);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('영혼 등불: three soul flames orbit her for 8 s', () => {
  function lantern(targetW = 16) {
    const t = setup();
    equip(t, 'soul_lantern');
    const hit = new Dummy(t.p.x + SOUL_LANTERN.radius, FLOOR);
    hit.w = targetW;
    const out = new Dummy(t.p.x + SOUL_LANTERN.radius + 60, FLOOR);
    t.world.spawn(hit);
    t.world.spawn(out);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 40);
    const flames = t.world.entities.find((e): e is SoulFlames => e instanceof SoulFlames)!;
    return { ...t, hit, out, flames };
  }

  it('3 flames on a circle of r 34 around her; a touch hurts (10) and burns (2 s); an enemy outside the orbit is never touched', () => {
    const t = lantern();
    expect(t.flames).toBeTruthy();
    for (let i = 0; i < SOUL_LANTERN.flames; i++) {
      const f = t.flames.flame(i);
      expect(Math.hypot(f.x - t.p.x, f.y - (t.p.y - 26))).toBeCloseTo(SOUL_LANTERN.radius, 5);
    }
    const a0 = t.flames.flame(0);
    const a1 = t.flames.flame(1);
    expect(Math.hypot(a0.x - a1.x, a0.y - a1.y)).toBeCloseTo(SOUL_LANTERN.radius * Math.sqrt(3), 5); // evenly spread
    steps(t.world, 150);
    expect(t.hit.log.length).toBeGreaterThanOrEqual(3);
    const first = t.hit.log[0];
    expect([first.amount, first.burn, first.burnDps]).toEqual([SKILL_BASE.soul_lantern, SOUL_LANTERN.burn, SOUL_LANTERN.burnDps]);
    expect(t.hit.status.burn).toBeGreaterThan(0);
    expect(t.out.log).toHaveLength(0);
    expect(t.flames.owner).toBe(t.p);
  });

  it('the same enemy is hit at most once per 0.4 s, whichever flame touches it', () => {
    const t = lantern(90);
    steps(t.world, 240);
    expect(t.hit.times.length).toBeGreaterThan(4);
    for (let i = 1; i < t.hit.times.length; i++) expect(t.hit.times[i] - t.hit.times[i - 1]).toBeGreaterThanOrEqual(SOUL_LANTERN.hitCd - 1 / 60 - 1e-9);
  });

  it('the flames follow her and vanish after 8 s', () => {
    const t = lantern();
    t.p.x += 200;
    steps(t.world, 1);
    const f = t.flames.flame(0);
    expect(Math.abs(f.x - t.p.x)).toBeLessThanOrEqual(SOUL_LANTERN.radius + 1e-6);
    // a second cast, counted from the step the flames come out to the step they are gone
    const u = setup();
    equip(u, 'soul_lantern');
    u.input.tap('skill1');
    let flames: SoulFlames | undefined;
    for (let i = 0; i < 60 && !flames; i++) {
      steps(u.world, 1);
      flames = u.world.entities.find((e): e is SoulFlames => e instanceof SoulFlames);
    }
    expect(flames).toBeTruthy();
    let n = 0;
    while (!flames!.dead && n < 1000) {
      steps(u.world, 1);
      n++;
    }
    expect(Math.abs(n / 60 - SOUL_LANTERN.life)).toBeLessThan(0.1);
    steps(u.world, 2);
    expect(u.world.entities.some((e) => e instanceof SoulFlames)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('사슬 갈고리: the first enemy hit is pulled to her', () => {
  /**
   * Cast the hook at enemies `dx` px in front of her and follow the first one frame by frame: its stun right after the
   * hit (`stunAtHit`) and how long it stays stunned counted from the step the hook is gone (`stunAfter`, seconds).
   */
  function hook(opts: { dx?: number[]; kb?: number; map?: TileMap } = {}) {
    const t = setup(opts.map);
    equip(t, 'chain_hook');
    const es = (opts.dx ?? [150]).map((dx) => new Dummy(t.p.x + dx, FLOOR, 100000, opts.kb ?? 1));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    let line: ChainHook | undefined;
    let stunAtHit = 0;
    let gone = -1;
    let stunOver = -1;
    for (let i = 0; i < 200; i++) {
      steps(t.world, 1);
      line ??= t.world.entities.find((e): e is ChainHook => e instanceof ChainHook);
      if (!stunAtHit && es[0].log.length) stunAtHit = es[0].status.stun;
      if (gone < 0 && line?.dead) gone = i;
      if (gone >= 0 && stunOver < 0 && es[0].status.stun <= 0) stunOver = i;
    }
    return { ...t, es, stunAtHit, stunAfter: stunOver < 0 ? Infinity : (stunOver - gone) / 60 };
  }

  it('hurts (12), stuns (1 s) and drags the enemy to just in front of her', () => {
    const t = hook();
    const [e] = t.es;
    expect([e.log[0].amount, e.log[0].stun]).toEqual([SKILL_BASE.chain_hook, CHAIN_HOOK.stun]);
    expect(e.x).toBeLessThan(t.p.x + 30);
    expect(e.x).toBeGreaterThan(t.p.x + 8);
    expect(t.world.entities.some((x) => x instanceof ChainHook)).toBe(false);
    expect(t.p.skillCooldownMax[0]).toBe(7);
  });

  it('the stun starts when the pull ends: she is left with the enemy stunned for the full 1.0 s', () => {
    const t = hook();
    expect(t.stunAtHit).toBeGreaterThan(CHAIN_HOOK.stun - 0.05);
    expect(t.stunAfter).toBeGreaterThan(CHAIN_HOOK.stun - 0.05);
    expect(t.stunAfter).toBeLessThan(CHAIN_HOOK.stun + 0.05);
  });

  it('only the first enemy on the line is caught', () => {
    const t = hook({ dx: [100, 170] });
    expect(t.es[0].log).toHaveLength(1);
    expect(t.es[1].log).toHaveLength(0);
    expect(t.es[1].x).toBe(t.p.x + 170);
    expect(t.es[0].x).toBeLessThan(t.p.x + 30);
  });

  it('heavy enemies (knockbackTaken < 0.3) are stunned and hurt but not pulled', () => {
    const t = hook({ kb: 0.2 });
    const [e] = t.es;
    expect(e.x).toBe(t.p.x + 150);
    expect([e.log[0].amount, e.log[0].stun]).toEqual([SKILL_BASE.chain_hook, CHAIN_HOOK.stun]);
    expect(t.stunAtHit).toBeGreaterThan(CHAIN_HOOK.stun - 0.05);
    // exactly at the limit is pulled
    expect(hook({ kb: CHAIN_HOOK.pullMinKnockback }).es[0].x).toBeLessThan(120 + 30);
  });

  it('reach: a target past 220 px is not caught; a wall stops the hook', () => {
    const far = hook({ dx: [CHAIN_HOOK.range + 40] });
    expect(far.es[0].log).toHaveLength(0);
    expect(far.es[0].x).toBe(far.p.x + CHAIN_HOOK.range + 40);
    const near = hook({ dx: [CHAIN_HOOK.range - 20] });
    expect(near.es[0].log).toHaveLength(1);
    const m = flatMap();
    m.set(Math.floor((120 + 60) / 24), 14, T.Solid);
    const walled = hook({ map: m });
    expect(walled.es[0].log).toHaveLength(0);
    expect(walled.es[0].x).toBe(walled.p.x + 150);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the codex pages of the unique items', () => {
  const weapons = new Map(codexEntries('weapon').map((e) => [e.id, e]));
  const skills = new Map(codexEntries('skill').map((e) => [e.id, e]));
  const uniques = [...UNIQUE_IDS].filter(implemented).map((id) => (weapons.get(id) ?? skills.get(id))!);

  it('every unique is in the weapon / skill tab with the 유니크 tag, the bone-gold name and a signature row', () => {
    expect(uniques.every(Boolean)).toBe(true);
    for (const e of uniques) {
      expect(e.tag, e.id).toMatch(/^유니크/);
      expect(e.nameColor, e.id).toBe(UNIQUE_COLOR);
      expect(e.group, e.id).toBe('유니크');
      expect(e.rows[0], e.id).toMatchObject({ label: '고유 효과', text: signatureText(e.id as ItemId) });
      expect(e.rows.find((r) => r.label === '접사')!.text, e.id).toContain('붙지 않음');
      expect(e.icon, e.id).toEqual({ sheet: 'icons', anim: e.id });
    }
    // the ordinary items are untouched
    for (const id of ['rusty_sword', 'old_shield', 'fire_grenade']) expect(weapons.get(id)?.tag ?? skills.get(id)?.tag, id).not.toMatch(/유니크/);
  });

  it('the previews reuse the heroine animations of their family', () => {
    const anim = (id: string) => (weapons.get(id) ?? skills.get(id))!.preview.steps.map((s) => s.anim);
    expect(anim('bone_cleaver')).toEqual(['sword_1', 'sword_2', 'sword_3']);
    expect(anim('reaper_scythe')).toEqual(['hammer_1', 'hammer_2']);
    expect(anim('stitch_needle')).toEqual(['spear_1', 'spear_2', 'spear_3']);
    expect(anim('widow_fangs')).toEqual(['dagger_1', 'dagger_2', 'dagger_3', 'dagger_4']);
    expect(anim('coffin_lid')).toEqual(['shield_block', 'shield_parry']);
    expect(anim('marrow_bow')).toEqual(['bow_draw', 'bow_shoot']);
    expect(anim('corpse_bomb')).toEqual(['throw']);
    expect(anim('bone_spikes')).toEqual(['deploy']);
    expect(anim('soul_lantern')).toEqual(['deploy']);
    expect(anim('chain_hook')).toEqual(['throw']);
    for (const e of uniques) expect(e.preview.sheet, e.id).toBe('heroine');
  });

  it('their numbers are the table numbers', () => {
    const text = (id: string) => (weapons.get(id) ?? skills.get(id))!.rows.map((r) => r.text).join('\n');
    expect(text('bone_cleaver')).toContain(`출혈 ${melee('bone_cleaver').bleed}초`);
    expect(text('reaper_scythe')).toContain(`${Math.round(melee('reaper_scythe').healOnKill! * 100)}%`);
    expect(text('stitch_needle')).toContain(`${melee('stitch_needle').critAfterRoll}초`);
    expect(text('widow_fangs')).toContain(`${melee('widow_fangs').critAfterHurt}초`);
    expect(text('coffin_lid')).toContain(`${Math.round(shieldOf('coffin_lid').reduction * 100)}%`);
    expect(text('coffin_lid')).toContain(`반경 ${shieldOf('coffin_lid').shockwave!.radius}px`);
    expect(text('marrow_bow')).toContain(`${bowOf('marrow_bow').damage}`);
    expect(text('corpse_bomb')).toContain(`반경 ${CORPSE_BOMB.radius}px`);
    expect(text('corpse_bomb')).toContain(`반경 ${CORPSE_BOMB.chain.radius}px`);
    expect(text('bone_spikes')).toContain(`${BONE_SPIKES.spacing}px`);
    expect(text('bone_spikes')).toContain(`띄우기 ${BONE_SPIKES.knockup}`);
    expect(text('soul_lantern')).toContain(`반경 ${SOUL_LANTERN.radius}px`);
    expect(text('chain_hook')).toContain(`${CHAIN_HOOK.range}px`);
    for (const id of ['corpse_bomb', 'bone_spikes', 'soul_lantern', 'chain_hook'] as const) expect(text(id)).toContain(String(SKILL_BASE[id]));
  });

  it('the codex still lists every item once and the affix pages name no unique', () => {
    const all = buildCodex();
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of all.filter((x) => x.id.startsWith('affix_'))) for (const id of UNIQUE_IDS) expect(e.rows[0].text, e.id).not.toContain(ITEMS[id].name);
    expect(AFFIX.healPct).toBeGreaterThan(0);
  });
});
