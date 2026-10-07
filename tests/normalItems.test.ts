import { describe, it, expect } from 'vitest';
import { makeTestWorld, steps, flatMap } from './helpers';
import { Player } from '../src/game/player/player';
import { Actor } from '../src/game/entity';
import type { DamageInfo } from '../src/game/combat';
import { T, type TileMap } from '../src/game/tilemap';
import { defaultSave, loadSave } from '../src/game/meta/save';
import { META_UPGRADES, buyUpgrade, unlockedCount } from '../src/game/meta/progression';
import { CRIT_MULT, AFFIX } from '../src/game/rules';
import { HOLD_HINT, ITEMS, holdHint, itemLines, rollItem } from '../src/game/items/items';
import { spawnItemDrop } from '../src/game/items/pickups';
import { ITEM_IDS, STARTER_UNLOCKS, UNIQUE_IDS, type ItemId, type ItemInstance } from '../src/game/items/types';
import { Rng } from '../src/engine/rng';
import { WEAPONS, type BowWeapon, type MeleeWeapon, type ShieldWeapon, type StaffWeapon, type WeaponDef } from '../src/game/player/weapons';
import {
  CLUSTER_GRENADE, FLAME_TURRET, MAGNET_GRENADE, PHASER, SKILLS, SKILL_BASE, STUN_GRENADE, TESLA_COIL, TORNADO, WAVE_OF_DENIAL,
} from '../src/game/player/skills';
import { Arrow, FlameTurret, Grenade, MagnetWell, TeslaCoil, Tornado, BOMBLET_FUSE } from '../src/game/player/projectiles';
import { Arrow as EnemyArrow, Bolt, Bomb, ChainHook as EnemyChainHook } from '../src/game/enemies/projectiles';
import { MoonShard, SwordBeam, WebBlob } from '../src/game/miniboss/hazards';
import { buildCodex, codexEntries } from '../src/game/ui/codexData';

/**
 * The ordinary weapons and skills of docs/CONTENT4.md §5.1 / §5.2: the table of each, then one focused test per mechanic. Targets are
 * stationary `Dummy` actors that log every hit they take.
 */
const FLOOR = 16 * 24;
// the real heroine manifest (the new whip / heavy / cast rows must be in it)
const heroineFile = import.meta.glob('../public/assets/sprites/heroine.json', { eager: true, import: 'default' }) as Record<string, { animations: Record<string, unknown> }>;

const NEW_WEAPONS = [
  'broadsword', 'frantic_sword', 'rapier', 'sadist_stiletto', 'grave_shovel', 'torch', 'leather_whip', 'iron_katana',
  'multi_bow', 'ice_bow', 'heavy_crossbow', 'throwing_knives', 'fire_staff', 'spiked_shield',
] as const;
const NEW_SKILLS = ['stun_grenade', 'magnet_grenade', 'cluster_grenade', 'tesla_coil', 'flame_turret', 'phaser', 'wave_of_denial', 'tornado'] as const;
const STARRED: ItemId[] = ['grave_shovel', 'leather_whip', 'throwing_knives', 'stun_grenade'];

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
  for (let i = 0; i < 90 && t.p.state === 'attack'; i++) steps(t.world, 1);
}
/** a heroine with `id` in hand and a target 30 px in front of her */
function duel(id: ItemId, dx = 30) {
  const t = setup();
  equip(t, id);
  const e = new Dummy(t.p.x + dx, FLOOR);
  t.world.spawn(e);
  steps(t.world, 1);
  return { ...t, e };
}
/** hold attack 1 for `n` steps, then let go */
function hold(t: Ctx, n: number): void {
  t.input.press('attack1');
  steps(t.world, n);
  t.input.release('attack1');
}

function weapon<K extends WeaponDef['kind']>(id: keyof typeof WEAPONS, kind: K): Extract<WeaponDef, { kind: K }> {
  const w = WEAPONS[id];
  if (w.kind !== kind) throw new Error(`${id} is a ${w.kind}, not a ${kind}`);
  return w as Extract<WeaponDef, { kind: K }>;
}
const melee = (id: keyof typeof WEAPONS): MeleeWeapon => weapon(id, 'melee');
const bowOf = (id: keyof typeof WEAPONS): BowWeapon => weapon(id, 'bow');
const shieldOf = (id: keyof typeof WEAPONS): ShieldWeapon => weapon(id, 'shield');
const staffOf = (id: keyof typeof WEAPONS): StaffWeapon => weapon(id, 'staff');
const dpsOf = (w: MeleeWeapon): number => {
  let dmg = 0;
  let time = 0;
  w.hits.forEach((h, i) => {
    dmg += h.damage * (h.shoot?.count ?? 1); // a thrown volley hurts once per knife
    time += h.windup + h.active + h.recover * (i === w.hits.length - 1 ? 1 : 0.45);
  });
  return dmg / time;
};
const arrows = (t: Ctx) => t.world.entities.filter((e): e is Arrow => e instanceof Arrow && !e.dead);

// ---------------------------------------------------------------------------------------------------------------------
describe('the catalogue of the ordinary items (docs/CONTENT4.md §5.1 / §5.2)', () => {
  it('every one of the 14 weapons and 8 skills has its table, a Korean name and an icon, and is not unique', () => {
    expect(NEW_WEAPONS).toHaveLength(14);
    expect(NEW_SKILLS).toHaveLength(8);
    for (const id of NEW_WEAPONS) {
      expect((WEAPONS as Record<string, unknown>)[id], id).toBeTruthy();
      expect(ITEMS[id].slot, id).toBe('weapon');
    }
    for (const id of NEW_SKILLS) {
      expect(SKILLS[id], id).toBeTruthy();
      expect(ITEMS[id].slot, id).toBe('skill');
    }
    for (const id of [...NEW_WEAPONS, ...NEW_SKILLS]) {
      expect(ITEMS[id].unique, id).toBeFalsy();
      expect(ITEMS[id].name, id).toMatch(/[가-힣]/);
      expect(ITEMS[id].icon).toBe(id);
      expect(itemLines({ id, tier: 1, affix: null }).join('|'), id).not.toMatch(/undefined|NaN/);
    }
    // the cooldowns of the spec
    const cd = { stun_grenade: 12, magnet_grenade: 13, cluster_grenade: 14, tesla_coil: 16, flame_turret: 15, phaser: 10, wave_of_denial: 11, tornado: 15 };
    for (const [id, c] of Object.entries(cd)) expect(ITEMS[id as ItemId].cooldown, id).toBe(c);
    // the skills of the spec use the throw / deploy casts it names
    for (const id of ['stun_grenade', 'magnet_grenade', 'cluster_grenade', 'phaser', 'tornado'] as const) expect(SKILLS[id]!.anim, id).toBe('throw');
    for (const id of ['tesla_coil', 'flame_turret', 'wave_of_denial'] as const) expect(SKILLS[id]!.anim, id).toBe('deploy');
  });

  it('weapons use the animation family of the spec (whip / heavy / cast rows of the heroine sheet included)', () => {
    const anims = (id: keyof typeof WEAPONS) => melee(id).hits.map((h) => h.anim);
    expect(anims('broadsword')).toEqual(['heavy_1', 'heavy_2', 'heavy_3']);
    expect(anims('frantic_sword')).toEqual(['sword_1', 'sword_2', 'sword_3']);
    expect(anims('rapier')).toEqual(['spear_1', 'spear_2', 'spear_3']);
    expect(anims('sadist_stiletto')).toEqual(['dagger_1', 'dagger_2', 'dagger_3', 'dagger_4']);
    expect(anims('grave_shovel')).toEqual(['heavy_1', 'heavy_2']);
    expect(anims('torch')).toEqual(['sword_1', 'sword_2']);
    expect(anims('leather_whip')).toEqual(['whip_1', 'whip_2']);
    expect(anims('iron_katana')).toEqual(['heavy_3']);
    expect(anims('throwing_knives')).toEqual(['throw']);
    const heroine = Object.values(heroineFile)[0];
    for (const a of ['whip_1', 'whip_2', 'heavy_1', 'heavy_2', 'heavy_3', 'cast', 'sprint']) expect(heroine.animations, a).toHaveProperty(a);
  });

  it('balance: the melee tables sit near the DPS of the item of their family (no crit counted)', () => {
    const pairs: [keyof typeof WEAPONS, keyof typeof WEAPONS][] = [
      ['frantic_sword', 'rusty_sword'], ['torch', 'rusty_sword'], ['broadsword', 'war_hammer'], ['grave_shovel', 'war_hammer'],
      ['rapier', 'spear'], ['sadist_stiletto', 'twin_daggers'], ['leather_whip', 'spear'], ['throwing_knives', 'twin_daggers'],
    ];
    for (const [id, base] of pairs) {
      const r = dpsOf(melee(id)) / dpsOf(melee(base));
      expect(r, `${id} / ${base}`).toBeGreaterThan(0.55);
      expect(r, `${id} / ${base}`).toBeLessThan(1.25);
    }
    // bows: damage of a full draw (every arrow of a volley counted) over the draw plus the shot's recovery
    const bowDps = (id: keyof typeof WEAPONS): number => {
      const b = bowOf(id);
      return (b.damage * (b.volley ? b.volley.n * b.volley.frac : 1)) / (b.drawTime + 0.2);
    };
    for (const id of ['multi_bow', 'ice_bow', 'heavy_crossbow'] as const) {
      const r = bowDps(id) / bowDps('hunter_bow');
      expect(r, `${id} / hunter_bow`).toBeGreaterThan(0.55);
      expect(r, `${id} / hunter_bow`).toBeLessThan(1.4); // (the crossbow: every bolt hit at point blank)
    }
    // the volley bows and crossbow draw as long as the hunter bow or longer; the ice bow does 70 % damage
    expect(bowOf('ice_bow').damage / bowOf('hunter_bow').damage).toBeCloseTo(0.7, 5);
    expect(bowOf('multi_bow').drawTime).toBeGreaterThanOrEqual(bowOf('hunter_bow').drawTime);
    expect(bowOf('heavy_crossbow').drawTime).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('blueprints and the starting pool', () => {
  it('the four ★ items start unlocked; every other ordinary item is an Alchemist blueprint of 20-40 cells', () => {
    expect([...STARTER_UNLOCKS].sort()).toEqual([...STARRED, 'rusty_sword', 'hunter_bow', 'old_shield', 'fire_grenade'].sort());
    const ordinary = ITEM_IDS.filter((id) => !UNIQUE_IDS.includes(id));
    const blueprint = new Map(META_UPGRADES.filter((u) => u.item).map((u) => [u.item!, u]));
    for (const id of ordinary) {
      if (STARTER_UNLOCKS.includes(id)) expect(blueprint.has(id), `${id} (starter)`).toBe(false);
      else {
        const u = blueprint.get(id);
        expect(u, `${id} has a blueprint`).toBeTruthy();
        expect(u!.cost, id).toBeGreaterThanOrEqual(20);
        expect(u!.cost, id).toBeLessThanOrEqual(40);
        expect(u!.id).toBe('unlock_' + id);
      }
    }
    for (const id of NEW_WEAPONS) expect(blueprint.has(id), id).toBe(!STARRED.includes(id));
    for (const id of NEW_SKILLS) expect(blueprint.has(id), id).toBe(!STARRED.includes(id));
    expect(blueprint.size).toBe(25);
    // weapons first, then skills (the Alchemist pages read that way)
    const order = META_UPGRADES.filter((u) => u.item).map((u) => ITEMS[u.item!].slot);
    expect(order.indexOf('skill')).toBe(order.lastIndexOf('weapon') + 1);
  });

  it('buying a blueprint puts the item into the drop pool; before that rollItem never returns it', () => {
    const save = defaultSave();
    const pool = (s = save) => new Set(Array.from({ length: 400 }, (_, i) => rollItem(new Rng(i), 1, s.unlocked).id));
    for (const id of NEW_WEAPONS) expect(pool().has(id), id).toBe(STARRED.includes(id));
    for (const id of NEW_SKILLS) expect(pool().has(id), id).toBe(STARRED.includes(id));
    const run = makeTestWorld().run;
    for (const u of META_UPGRADES.filter((x) => x.item)) {
      run.cells = 100;
      expect(buyUpgrade(u, run, save), u.id).toBe('ok');
      expect(save.unlocked).toContain(u.item);
      expect(run.cells).toBe(100 - u.cost);
    }
    const p = pool();
    for (const id of [...NEW_WEAPONS, ...NEW_SKILLS]) expect(p.has(id), id).toBe(true);
    expect(unlockedCount(save)).toEqual({ have: 33, total: 33 });
  });

  it('an old save (written before the expansion) loads with the ★ items added, and keeps what it had unlocked', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    try {
      store.set('deadsell.save.v1', JSON.stringify({ version: 1, unlocked: ['rusty_sword', 'hunter_bow', 'old_shield', 'fire_grenade', 'spear', 'turret'], upgrades: { flask: 1, gold: 0 }, runs: 4 }));
      const s = loadSave();
      for (const id of [...STARRED, 'spear', 'turret', 'rusty_sword']) expect(s.unlocked, id).toContain(id);
      expect(s.unlocked).not.toContain('broadsword');
      expect(s.upgrades.flask).toBe(1);
      expect(s.runs).toBe(4);
      // a save that already names new items keeps them; a unique id in the list is dropped
      store.set('deadsell.save.v1', JSON.stringify({ unlocked: ['broadsword', 'tornado', 'bone_cleaver', 'nope'] }));
      const t = loadSave();
      expect(t.unlocked).toEqual(expect.arrayContaining(['broadsword', 'tornado', ...STARRED]));
      expect(t.unlocked).not.toContain('bone_cleaver');
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('대검: slow, very wide 3-hit; the 3rd hit crits', () => {
  it('26 / 28 / 22 x2: only the 3rd hit crits, and the 3rd reaches behind her too', () => {
    const t = duel('broadsword');
    const behind = new Dummy(t.p.x - 50, FLOOR);
    t.world.spawn(behind);
    steps(t.world, 1);
    swing(t);
    swing(t);
    expect(t.e.log.map((i) => [i.amount, !!i.crit])).toEqual([[26, false], [28, false]]);
    expect(behind.log, 'hits 1 and 2 reach 24 px / 40 px behind her, not 50').toHaveLength(0);
    swing(t);
    expect(t.e.log[2].amount).toBe(22 * CRIT_MULT);
    expect(t.e.log[2].crit).toBe(true);
    expect(behind.log, 'the full spin sweeps behind her').toHaveLength(1);
    // wider and slower than the sword
    expect(Math.max(...melee('broadsword').hits.map((h) => h.box.w))).toBeGreaterThan(Math.max(...melee('rusty_sword').hits.map((h) => h.box.w)) * 2);
    const dur = (id: keyof typeof WEAPONS) => melee(id).hits.reduce((n, h) => n + h.windup + h.active + h.recover, 0);
    expect(dur('broadsword')).toBeGreaterThan(dur('rusty_sword') * 1.5);
  });
});

describe('광란의 검: crits while HP is below 50 %', () => {
  it('no crit at full or half HP, crit below half; the combo numbers are the table', () => {
    const t = duel('frantic_sword');
    swing(t);
    expect([t.e.log[0].amount, !!t.e.log[0].crit]).toEqual([13, false]);
    t.run.hp = 50; // exactly half is not "below"
    steps(t.world, 2);
    t.e.x = t.p.x + 30;
    swing(t);
    expect(t.e.log[1].crit).toBeFalsy();
    t.run.hp = 49;
    steps(t.world, 2);
    t.e.x = t.p.x + 30;
    swing(t);
    expect([t.e.log[2].crit, t.e.log[2].amount]).toEqual([true, 20 * CRIT_MULT]); // the 3rd hit of the combo, doubled
    // other swords do not
    const sword = duel('rusty_sword');
    sword.run.hp = 10;
    steps(sword.world, 2);
    swing(sword);
    expect(sword.e.log[0].crit).toBeFalsy();
  });
});

describe('레이피어: the first hit within 1.5 s after a roll crits', () => {
  function roll(t: Ctx) {
    t.input.press('roll');
    steps(t.world, 1);
    t.input.release('roll');
    for (let i = 0; i < 60 && t.p.state === 'roll'; i++) steps(t.world, 1);
    expect(t.p.state).not.toBe('roll');
  }
  it('only the first hit after a roll crits (not the second of the combo), none without a roll, none after 1.5 s', () => {
    const t = duel('rapier');
    swing(t);
    expect(t.e.log[0].crit).toBeFalsy();
    steps(t.world, 30);
    roll(t);
    t.e.x = t.p.x + 30;
    swing(t);
    swing(t);
    expect([t.e.log[1].crit, t.e.log[1].amount]).toEqual([true, 9 * CRIT_MULT]);
    expect(t.e.log[2].crit, 'the second hit inside the window does not').toBeFalsy();
    // a new roll arms it again; waiting out the window disarms it
    roll(t);
    steps(t.world, Math.ceil(melee('rapier').critFirstAfterRoll! * 60) + 10);
    t.e.x = t.p.x + 30;
    swing(t);
    expect(t.e.log.at(-1)!.crit).toBeFalsy();
    roll(t);
    t.e.x = t.p.x + 30;
    swing(t);
    expect(t.e.log.at(-1)!.crit).toBe(true);
  });

  it('a roll that is followed by a swing that hits nothing keeps the crit for the next one', () => {
    const t = duel('rapier', 200);
    roll(t);
    swing(t); // whiffs: the target is 200 px away
    expect(t.e.log).toHaveLength(0);
    t.e.x = t.p.x + 30;
    swing(t);
    expect(t.e.log[0].crit).toBe(true);
  });
});

describe('가학의 단검: crits against burning, frozen or stunned targets', () => {
  it('crit on each of the three states, plain on a clean target and on a bleeding one', () => {
    for (const [state, secs] of [['burn', 2], ['freeze', 1], ['stun', 1]] as const) {
      const t = duel('sadist_stiletto');
      t.e.status[state] = secs;
      swing(t);
      expect(t.e.log[0].crit, state).toBe(true);
      expect(t.e.log[0].amount, state).toBe(6 * CRIT_MULT);
    }
    const clean = duel('sadist_stiletto');
    swing(clean);
    expect(clean.e.log[0].crit).toBeFalsy();
    const bleeding = duel('sadist_stiletto');
    bleeding.e.status.bleed = 2;
    swing(bleeding);
    expect(bleeding.e.log[0].crit).toBeFalsy();
    // the status lapses: no crit
    const t = duel('sadist_stiletto');
    t.e.status.stun = 0.1;
    steps(t.world, 12);
    swing(t);
    expect(t.e.log[0].crit).toBeFalsy();
  });
});

describe('무덤 삽 ★: heavy, stuns 0.8 s; crit against stunned', () => {
  it('hit 1 stuns 0.8 s and does not crit; hit 2 lands inside the stun and crits', () => {
    const t = duel('grave_shovel');
    swing(t);
    const [a] = t.e.log;
    expect([a.amount, a.stun, !!a.crit]).toEqual([22, 0.8, false]);
    expect(t.e.status.stun).toBeGreaterThan(0.2);
    swing(t);
    const b = t.e.log[1];
    expect([b.amount, !!b.crit]).toEqual([24 * CRIT_MULT, true]);
  });

  it('a target whose stun ran out is not crit; any other stunned target is', () => {
    const t = duel('grave_shovel');
    t.e.status.stun = 2;
    swing(t);
    expect(t.e.log[0].crit).toBe(true);
    const u = duel('grave_shovel');
    swing(u);
    steps(u.world, 90); // 1.5 s: the stun is over, the combo restarts
    u.e.x = u.p.x + 30;
    swing(u);
    expect(u.e.log[1].crit).toBeFalsy();
  });
});

describe('횃불: every hit ignites (burn 3 s)', () => {
  it('both hits set the target on fire for 3 s at the burn rate of the game; the burn ticks', () => {
    const t = duel('torch');
    swing(t);
    swing(t);
    for (const i of t.e.log) expect([i.burn, i.burnDps]).toEqual([3, AFFIX.burnDps]);
    expect(t.e.log.map((i) => i.amount)).toEqual([12, 14]);
    expect(t.e.status.burn).toBeGreaterThan(2);
    const hp = t.e.hp;
    steps(t.world, 40);
    expect(t.e.hp, 'burning hurts').toBeLessThan(hp);
    // other swords ignite nothing
    const s = duel('rusty_sword');
    swing(s);
    expect(s.e.log[0].burn).toBeUndefined();
  });
});

describe('가죽 채찍 ★: reach 104 px, hits in the outer 24 px crit', () => {
  it('a target in the tip crits, one close to her does not, one past 104 px is not hit', () => {
    const w = melee('leather_whip');
    expect(w.hits.map((h) => h.box.x + h.box.w)).toEqual([104, 104]);
    expect(w.hits.map((h) => h.tip)).toEqual([24, 24]);
    const near = duel('leather_whip', 50);
    swing(near);
    expect([near.e.log[0].amount, !!near.e.log[0].crit]).toEqual([10, false]);
    const tip = duel('leather_whip', 95);
    swing(tip);
    expect([tip.e.log[0].amount, !!tip.e.log[0].crit]).toEqual([10 * CRIT_MULT, true]);
    const far = duel('leather_whip', 150);
    swing(far);
    expect(far.e.log).toHaveLength(0);
    // faces left too (the tip box is mirrored)
    const left = setup(flatMap(), 300);
    equip(left, 'leather_whip');
    left.p.facing = -1;
    const e = new Dummy(left.p.x - 95, FLOOR);
    left.world.spawn(e);
    steps(left.world, 1);
    left.input.moveX = 0;
    left.input.setAxis('t', -1, 0);
    swing(left);
    left.input.setAxis('t', 0, 0);
    expect(e.log[0]?.crit).toBe(true);
  });
});

describe('철 도: hold the attack 0.6 s, let go to dash 120 px through enemies, invulnerable on the way', () => {
  const D = melee('iron_katana').dash!;
  function charged(extra: number[] = []) {
    const t = setup();
    equip(t, 'iron_katana');
    const es = [50, 100, ...extra].map((dx) => new Dummy(t.p.x + dx, FLOOR));
    const behind = new Dummy(t.p.x - 40, FLOOR);
    for (const e of [...es, behind]) t.world.spawn(e);
    steps(t.world, 1);
    return { ...t, es, behind };
  }

  it('after a full charge the release dashes exactly 120 px and slashes every enemy on the line once for 46', () => {
    const t = charged([170]);
    const x0 = t.p.x;
    t.input.press('attack1');
    steps(t.world, Math.ceil(D.charge * 60) + 2);
    expect(t.p.state).toBe('charge');
    expect(t.p.bowCharge).toBe(1);
    t.input.release('attack1');
    steps(t.world, 1);
    expect(t.p.state).toBe('dash');
    let sawInvulnerable = false;
    for (let i = 0; i < 40 && t.p.state === 'dash'; i++) {
      const dashing = t.p.x - x0 < D.distance - 1;
      if (dashing) {
        const r = t.p.takeDamage({ amount: 30, dir: 1, kind: 'melee', source: t.es[0] });
        if (!r.applied) sawInvulnerable = true;
      }
      steps(t.world, 1);
    }
    expect(sawInvulnerable, 'no damage while dashing').toBe(true);
    expect(t.p.hp).toBe(100);
    expect(t.p.x - x0).toBeCloseTo(D.distance, 0);
    for (const e of t.es.slice(0, 2)) {
      expect(e.log, 'each enemy on the path once').toHaveLength(1);
      expect([e.log[0].amount, e.log[0].knockback]).toEqual([D.damage, D.knockback]);
    }
    expect(t.es[2].log, 'the one 170 px away is past the dash').toHaveLength(0);
    expect(t.behind.log).toHaveLength(0);
    // the follow-through ends and she is free (and vulnerable) again
    steps(t.world, Math.ceil(D.recover * 60) + 10);
    expect(t.p.state).not.toBe('dash');
    expect(t.p.takeDamage({ amount: 5, dir: 1, kind: 'melee', source: t.es[0] }).applied).toBe(true);
  });

  it('letting go before the charge is full is the quick slash (17), not a dash', () => {
    const t = charged();
    const x0 = t.p.x;
    hold(t, 15);
    steps(t.world, 2);
    expect(t.p.state).toBe('attack');
    for (let i = 0; i < 60 && t.p.state === 'attack'; i++) steps(t.world, 1);
    expect(t.p.x - x0, 'no dash').toBeLessThan(40);
    expect(t.es[0].log.map((i) => i.amount)).toEqual([17]);
    expect(t.es[1].log).toHaveLength(0);
  });

  it('holding after the slash charges again instead of chaining slashes; a wall stops the dash', () => {
    const t = setup(); // a wall 70 px ahead
    t.world.map.set(Math.floor((t.p.x + 70) / 24), 15, T.Solid);
    t.world.map.set(Math.floor((t.p.x + 70) / 24), 14, T.Solid);
    equip(t, 'iron_katana');
    const x0 = t.p.x;
    hold(t, 45);
    for (let i = 0; i < 60 && (t.p.state === 'charge' || t.p.state === 'dash'); i++) steps(t.world, 1);
    expect(t.p.x - x0).toBeGreaterThan(30);
    expect(t.p.x - x0).toBeLessThan(75);
    // the held button: tap slash, then still down -> a new charge, not a second slash
    const u = setup();
    equip(u, 'iron_katana');
    u.input.press('attack1');
    steps(u.world, 5);
    expect(u.p.state).toBe('charge');
    const states = new Set<string>();
    for (let i = 0; i < 10; i++) {
      steps(u.world, 1);
      states.add(u.p.state);
    }
    expect(states.has('attack')).toBe(false);
  });
});

describe('연발 활: a full draw fires 3 arrows (±8°), each 45 % damage', () => {
  function shoot(id: ItemId, drawSteps: number) {
    const t = setup();
    equip(t, id);
    const es = [60, 120].map((dx) => new Dummy(t.p.x + dx, FLOOR));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    t.input.press('attack1');
    steps(t.world, drawSteps);
    t.input.release('attack1');
    steps(t.world, 1);
    return { ...t, es };
  }

  it('full draw: three arrows at -8 / 0 / +8 degrees, each 0.45 x 28; a tap fires one', () => {
    const t = shoot('multi_bow', 40);
    const a = arrows(t);
    expect(a).toHaveLength(3);
    const angles = a.map((x) => Math.round((Math.atan2(x.vy, Math.abs(x.vx)) * 180) / Math.PI)).sort((m, n) => m - n);
    expect(angles).toEqual([-8, 0, 8]);
    for (const x of a) expect(x.info.amount).toBeCloseTo(28 * 0.45, 5);
    steps(t.world, 40);
    expect(t.es[0].log.length, 'the centre arrow and the near ones hit the first target').toBeGreaterThanOrEqual(1);
    const tap = shoot('multi_bow', 5);
    expect(arrows(tap)).toHaveLength(1);
    // (a short draw: between the minimum share and the full damage of ONE arrow, not a volley share)
    expect(arrows(tap)[0].info.amount).toBeGreaterThan(28 * bowOf('multi_bow').minFrac - 0.01);
    expect(arrows(tap)[0].info.amount).toBeLessThan(28);
  });

  it('the plain bow still fires one arrow at full draw', () => {
    expect(arrows(shoot('hunter_bow', 40))).toHaveLength(1);
  });
});

describe('서리 활: arrows freeze 1.2 s, 70 % damage', () => {
  it('a hit freezes the target for 1.2 s (even a tap shot) and does 70 % of the hunter bow', () => {
    const t = setup();
    equip(t, 'ice_bow');
    const e = new Dummy(t.p.x + 100, FLOOR);
    t.world.spawn(e);
    steps(t.world, 1);
    hold(t, 40);
    steps(t.world, 60);
    expect(e.log).toHaveLength(1);
    expect([e.log[0].freeze, e.log[0].amount]).toEqual([1.2, 21]);
    expect(e.status.freeze).toBeGreaterThan(0.2);
    expect(e.status.freeze).toBeLessThanOrEqual(1.2);
    // a tap shot freezes too
    const u = setup();
    equip(u, 'ice_bow');
    const f = new Dummy(u.p.x + 100, FLOOR);
    u.world.spawn(f);
    steps(u.world, 1);
    hold(u, 4);
    steps(u.world, 60);
    expect(f.log[0].freeze).toBe(1.2);
    // the hunter bow freezes nothing
    const h = setup();
    equip(h, 'hunter_bow');
    const g = new Dummy(h.p.x + 100, FLOOR);
    h.world.spawn(g);
    steps(h.world, 1);
    hold(h, 40);
    steps(h.world, 60);
    expect(g.log[0].freeze).toBeUndefined();
    expect(g.log[0].amount).toBe(30);
  });
});

describe('중석궁: 5 bolts in a ±14° spread, range 160 px, slow draw (0.7 s)', () => {
  it('a full draw takes 0.7 s and fires 5 bolts across -14..+14 degrees, 40 % damage each; a bolt does not reach past 160 px', () => {
    const t = setup();
    equip(t, 'heavy_crossbow');
    const near = new Dummy(t.p.x + 90, FLOOR);
    const far = new Dummy(t.p.x + 230, FLOOR);
    t.world.spawn(near);
    t.world.spawn(far);
    steps(t.world, 1);
    t.input.press('attack1');
    steps(t.world, 30);
    expect(t.p.bowCharge, 'still drawing at 0.5 s').toBeLessThan(1);
    steps(t.world, 16);
    expect(t.p.bowCharge).toBe(1);
    t.input.release('attack1');
    steps(t.world, 1);
    const bolts = arrows(t);
    expect(bolts).toHaveLength(5);
    const deg = bolts.map((b) => Math.round((Math.atan2(b.vy, Math.abs(b.vx)) * 180) / Math.PI)).sort((a, b) => a - b);
    expect(deg).toEqual([-14, -7, 0, 7, 14]);
    for (const b of bolts) expect(b.info.amount).toBeCloseTo(bowOf('heavy_crossbow').damage * 0.4, 5);
    steps(t.world, 60);
    expect(near.log.length, 'at 90 px the middle bolts hit').toBeGreaterThanOrEqual(2);
    expect(far.log, 'past the range').toHaveLength(0);
    expect(arrows(t)).toHaveLength(0);
  });

  it('a bolt flies 160 px (from the muzzle): a target at 150 is hit, one at 200 is not', () => {
    for (const [dx, hit] of [[150, true], [200, false]] as const) {
      const t = setup();
      equip(t, 'heavy_crossbow');
      const e = new Dummy(t.p.x + dx, FLOOR);
      t.world.spawn(e);
      steps(t.world, 1);
      hold(t, 46);
      steps(t.world, 40);
      expect(e.log.length > 0, `${dx} px`).toBe(hit);
    }
  });
});

describe('투척 단검 ★: a quick 2-knife volley, bleed 2 s', () => {
  it('one tap throws two knives side by side; each hits for 5 and bleeds the target for 2 s', () => {
    const t = duel('throwing_knives', 120);
    t.input.tap('attack1');
    steps(t.world, 6);
    expect(arrows(t)).toHaveLength(2);
    expect(new Set(arrows(t).map((k) => Math.round(k.y))).size, 'one above the other').toBe(2);
    expect(arrows(t).every((k) => k.opts.knife)).toBe(true);
    steps(t.world, 40);
    expect(t.e.log).toHaveLength(2);
    for (const i of t.e.log) expect([i.amount, i.bleed, i.kind]).toEqual([5, 2, 'ranged']);
    expect(t.e.status.bleed).toBeGreaterThan(0);
    expect(t.e.status.bleedStacks).toBe(2);
  });

  it('holding the attack keeps throwing volleys; the knives vanish after their range', () => {
    const t = duel('throwing_knives', 500);
    t.input.press('attack1');
    steps(t.world, 70);
    t.input.release('attack1');
    steps(t.world, 5);
    const thrown = t.world.entities.filter((e) => e instanceof Arrow).length + 0;
    expect(thrown).toBeGreaterThanOrEqual(2);
    steps(t.world, 60);
    expect(arrows(t)).toHaveLength(0); // 240 px at 520 px/s is gone in half a second
    expect(t.e.log, 'out of range').toHaveLength(0);
    expect(melee('throwing_knives').hits[0].shoot).toMatchObject({ count: 2, bleed: 2 });
  });
});

describe('화염 지팡이: hold for a flame cone (64 px), 9 dmg / 0.15 s + burn, moveScale 0.3', () => {
  function flame() {
    const t = setup();
    equip(t, 'fire_staff');
    const front = new Dummy(t.p.x + 40, FLOOR);
    const edge = new Dummy(t.p.x + 66, FLOOR); // its near edge is inside the 64 px range
    const out = new Dummy(t.p.x + 100, FLOOR);
    const behind = new Dummy(t.p.x - 40, FLOOR);
    for (const e of [front, edge, out, behind]) t.world.spawn(e);
    steps(t.world, 1);
    return { ...t, front, edge, out, behind };
  }

  it('while held it ticks every 0.15 s on every enemy inside the cone, burning them; outside it and behind her nothing', () => {
    const t = flame();
    t.input.press('attack1');
    steps(t.world, 60);
    expect(t.p.state).toBe('staff');
    t.input.release('attack1');
    const n = t.front.log.length;
    expect(n, 'about 6-7 ticks in a second').toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(8);
    for (const i of t.front.log) expect([i.amount, i.burn, i.burnDps, i.kind, i.hitstun]).toEqual([9, 2, AFFIX.burnDps, 'explosion', 0]);
    expect(t.front.status.burn).toBeGreaterThan(0);
    expect(t.edge.log.length).toBe(n);
    expect(t.out.log).toHaveLength(0);
    expect(t.behind.log).toHaveLength(0);
    for (let i = 1; i < t.front.times.length; i++) expect(t.front.times[i] - t.front.times[i - 1]).toBeCloseTo(0.15, 1);
    // letting go stops the flame
    steps(t.world, 30);
    expect(t.p.state).not.toBe('staff');
    const after = t.front.log.length;
    steps(t.world, 30);
    expect(t.front.log.length).toBe(after);
  });

  it('the cone fans out: a target above the line is hit only farther away; a target below the floor line too', () => {
    const t = setup();
    equip(t, 'fire_staff');
    const high = new Dummy(t.p.x + 20, FLOOR - 50);
    const high2 = new Dummy(t.p.x + 60, FLOOR - 50);
    t.world.spawn(high);
    t.world.spawn(high2);
    steps(t.world, 1);
    hold(t, 30);
    expect(high.log, 'too narrow near the nozzle').toHaveLength(0);
    expect(high2.log.length).toBeGreaterThan(0);
  });

  it('she moves at 30 % speed while breathing fire, and the flame does not stagger enemies', () => {
    const t = flame();
    t.input.setAxis('t', 1, 0);
    t.input.press('attack1');
    steps(t.world, 30);
    t.input.setAxis('t', 0, 0);
    t.input.release('attack1');
    expect(t.p.vx).toBeLessThanOrEqual(150 * 0.3 + 1);
    expect(t.front.hitstun).toBe(0);
    expect(staffOf('fire_staff').moveScale).toBe(0.3);
  });
});

describe('the flame is drawn: a cone as long as the reach plus a spray of flames (화염 지팡이, 화염 포탑)', () => {
  /** the farthest x a flame jet paints, over all its layers (a recording 2D context) */
  function reach(jet: { draw(c: CanvasRenderingContext2D): void }, dir: 1 | -1): { far: number; paths: number } {
    let far = -Infinity;
    let paths = 0;
    const grad = { addColorStop() {} };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(tg, k: string) {
        if (k === 'createLinearGradient') return () => grad;
        if (k === 'moveTo') return () => { paths++; };
        if (k === 'lineTo') return (x: number) => { far = Math.max(far, x * dir); };
        return k in tg ? tg[k] : () => {};
      },
      set(tg, k: string, v) { tg[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    jet.draw(ctx);
    return { far, paths };
  }
  const jets = (t: Ctx) => t.world.entities.filter((e) => e.constructor.name === 'FlameJet');
  /** the oldest jet that has grown to its full length (it takes 0.04 s) */
  const grown = (t: Ctx) => {
    for (let i = 0; i < 30; i++) {
      const j = jets(t).find((e) => (e as any).t >= 0.05);
      if (j) return j;
      steps(t.world, 1);
    }
    throw new Error('no grown flame jet');
  };

  it('the staff: every 0.15 s tick adds a drawn cone reaching her 64 px (from the staff tip) and at least 8 flame particles', () => {
    const t = setup();
    equip(t, 'fire_staff');
    expect(jets(t)).toHaveLength(0);
    t.input.press('attack1');
    steps(t.world, 14);
    const before = t.world.particles.count;
    expect(jets(t).length, 'a flame jet is up while she breathes').toBeGreaterThanOrEqual(1);
    steps(t.world, 12); // (at least one more tick)
    expect(t.world.particles.count, 'a spray of flames, not three dots').toBeGreaterThanOrEqual(before + 8);
    const jet = grown(t);
    const tipX = t.p.x + t.p.facing * 16;
    const r = reach(jet as any, 1);
    expect(r.paths, 'three layers').toBe(3);
    expect(r.far, 'the cone reaches the 64 px of the hit area').toBeGreaterThanOrEqual(tipX + 64 * 0.95);
    expect(r.far, '... and not farther').toBeLessThanOrEqual(tipX + 64 + 0.5);
    t.input.release('attack1');
    steps(t.world, 40);
    expect(jets(t), 'it dies out soon after she lets go').toHaveLength(0);
  });

  it('the turret: its cone is 70 px long, drawn facing the way it faces (left too), and it dies out with the turret', () => {
    const t = setup(flatMap(), 400);
    for (const face of [1, -1] as const) {
      const f = new FlameTurret(400, FLOOR, t.p, item('flame_turret'), SKILL_BASE.flame_turret, face, FLAME_TURRET);
      t.world.spawn(f);
      steps(t.world, 30);
      const jet = grown(t);
      const r = reach(jet as any, face);
      const m = f.muzzle;
      expect(r.far * 1, `facing ${face}`).toBeGreaterThanOrEqual(m.x * face + FLAME_TURRET.range * 0.95);
      expect(r.far).toBeLessThanOrEqual(m.x * face + FLAME_TURRET.range + 0.5);
      f.dead = true;
    }
    steps(t.world, 40);
    expect(jets(t)).toHaveLength(0);
  });
});

describe('hold weapons say where they work best while the controls are gestures (qa#2, spec#4)', () => {
  it('holdHint: the 철 도 charge, both staffs and every bow, in gesture mode only; no other weapon, no skill', () => {
    const hold = new Set<string>();
    for (const id of ITEM_IDS) {
      const h = holdHint(id, 'gesture');
      const w = (WEAPONS as Record<string, WeaponDef>)[id];
      const wants = !!w && (w.kind === 'bow' || w.kind === 'staff' || w.kind === 'wand' || (w.kind === 'melee' && !!w.dash));
      expect(h, id).toBe(wants ? HOLD_HINT : null);
      if (h) hold.add(id);
      for (const mode of ['buttons', 'gamepad', 'keyboard']) expect(holdHint(id, mode), `${id} in ${mode}`).toBeNull();
    }
    expect(HOLD_HINT).toBe('길게 눌러 쓰는 무기: 보조 칸에서 최대 효과');
    for (const id of ['iron_katana', 'fire_staff', 'hunter_bow', 'multi_bow', 'ice_bow', 'heavy_crossbow', 'storm_staff', 'soulfire_bow'] as const) expect(hold.has(id), id).toBe(true);
    for (const id of ['rusty_sword', 'broadsword', 'old_shield', 'turret'] as const) expect(hold.has(id), id).toBe(false);
  });

  it('the pickup choice (both slots taken) carries the line for a hold weapon in gesture mode, not in virtual-button mode or for a sword', () => {
    for (const [id, mode, want] of [['iron_katana', 'gesture', true], ['fire_staff', 'gesture', true], ['hunter_bow', 'gesture', true], ['iron_katana', 'buttons', false], ['broadsword', 'gesture', false]] as const) {
      const t = setup();
      t.game.save.settings.controlMode = mode;
      t.run.weapons = [item('rusty_sword'), item('old_shield')];
      let note: string | undefined | null = null;
      (t.world as any).ui.openChoice = (_t: string, _o: unknown, pick: (i: number) => void, _c?: boolean, n?: string) => { note = n; pick(-1); };
      spawnItemDrop(t.world, t.p.x + 8, FLOOR, item(id));
      steps(t.world, 40);
      t.input.tap('interact');
      steps(t.world, 3);
      expect(note, `${id} in ${mode}`).toBe(want ? HOLD_HINT : undefined);
    }
  });
});

describe('가시 방패: parry deals 40 + bleed; block 75 %', () => {
  const guard = (id: ItemId = 'spiked_shield') => {
    const t = setup();
    equip(t, id, 1);
    const near = new Dummy(t.p.x + 30, FLOOR);
    near.facing = -1;
    t.world.spawn(near);
    steps(t.world, 1);
    return { ...t, near };
  };

  it('a parry strikes the attacker back for 40 and bleeds it 3 s (unblockable), still stunning it; a plain shield does not', () => {
    const t = guard();
    t.input.press('attack2');
    steps(t.world, 3);
    expect(t.p.state).toBe('block');
    const r = t.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: t.near });
    expect(r.parried).toBe(true);
    const hit = t.near.log.find((i) => i.kind === 'melee')!;
    expect([hit.amount, hit.bleed, hit.unblockable]).toEqual([40, 3, true]);
    expect(t.near.status.stun).toBeGreaterThan(1.3);
    expect(t.near.status.bleed).toBeGreaterThan(2);
    const plain = guard('old_shield');
    plain.input.press('attack2');
    steps(plain.world, 3);
    plain.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: plain.near });
    expect(plain.near.log).toHaveLength(0);
  });

  it('blocking after the parry window takes 25 % (75 % blocked) and strikes nothing back', () => {
    const t = guard();
    t.input.press('attack2');
    steps(t.world, 20);
    const r = t.p.takeDamage({ amount: 40, dir: -1, kind: 'melee', source: t.near });
    expect([r.blocked, r.amount]).toEqual([true, 10]);
    expect(t.near.log).toHaveLength(0);
    expect(shieldOf('spiked_shield')).toMatchObject({ reduction: 0.75, counter: { damage: 40, bleed: 3 } });
  });

  it('reflecting an arrow in the parry window (no attacker) strikes nobody and does not throw', () => {
    const t = guard();
    t.near.x = t.p.x + 300; // (the reflected arrow must not reach it)
    t.input.press('attack2');
    steps(t.world, 2);
    const arrow = new EnemyArrow(t.p.x + 20, t.p.y - 22, -200, 0, 5, null);
    t.world.spawn(arrow);
    steps(t.world, 3);
    expect(arrow.reflected).toBe(true);
    expect(t.near.log).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('affixes on the new weapons: none of them is a dead roll', () => {
  const withAffix = (t: Ctx, id: ItemId, affix: NonNullable<ItemInstance['affix']>) => { t.run.weapons[0] = { id, tier: 1, affix }; };

  it('speed: 철 도 charges 15 % faster, 화염 지팡이 ticks 15 % faster', () => {
    const chargeSteps = (affix: ItemInstance['affix']) => {
      const t = setup();
      t.run.weapons[0] = { id: 'iron_katana', tier: 1, affix };
      t.input.press('attack1');
      let n = 0;
      while (t.p.bowCharge < 1 && n < 90) { steps(t.world, 1); n++; }
      return n;
    };
    expect(chargeSteps(null)).toBeGreaterThanOrEqual(Math.floor(melee('iron_katana').dash!.charge * 60));
    expect(chargeSteps('speed')).toBeLessThan(chargeSteps(null) * 0.9);
    const ticks = (affix: ItemInstance['affix']) => {
      const t = setup();
      t.run.weapons[0] = { id: 'fire_staff', tier: 1, affix };
      const e = new Dummy(t.p.x + 40, FLOOR);
      t.world.spawn(e);
      steps(t.world, 1);
      hold(t, 60);
      return e.log.length;
    };
    expect(ticks('speed')).toBeGreaterThan(ticks(null));
  });

  it('burn lengthens the 화염 지팡이 fire to 3 s; bleed makes the 투척 단검 bleed 3 s instead of 2 and 화염 지팡이 bleed too', () => {
    const t = setup();
    withAffix(t, 'fire_staff', 'burn');
    const e = new Dummy(t.p.x + 40, FLOOR);
    t.world.spawn(e);
    steps(t.world, 1);
    hold(t, 20);
    expect(e.log.every((i) => i.burn === AFFIX.burnSecs)).toBe(true);
    expect(AFFIX.burnSecs).toBeGreaterThan(staffOf('fire_staff').flame.burn);

    const u = setup();
    withAffix(u, 'throwing_knives', 'bleed');
    const f = new Dummy(u.p.x + 120, FLOOR);
    u.world.spawn(f);
    steps(u.world, 1);
    u.input.tap('attack1');
    steps(u.world, 50);
    expect(f.log.map((i) => i.bleed)).toEqual([AFFIX.bleedSecs, AFFIX.bleedSecs]);
    expect(AFFIX.bleedSecs).toBeGreaterThan(melee('throwing_knives').hits[0].shoot!.bleed);

    const v = setup();
    withAffix(v, 'fire_staff', 'bleed');
    const g = new Dummy(v.p.x + 40, FLOOR);
    v.world.spawn(g);
    steps(v.world, 1);
    hold(v, 20);
    expect(g.log.length).toBeGreaterThan(0);
    expect(g.log.every((i) => i.bleed === AFFIX.bleedSecs)).toBe(true);
  });
});

describe('섬광탄 ★: stun 2 s in r 64, 6 dmg', () => {
  it('thrown with the skill: the blast stuns everything within 64 px for 2 s and hurts 6; farther enemies are not touched', () => {
    const t = setup();
    equip(t, 'stun_grenade');
    const a = new Dummy(t.p.x + 100, FLOOR);
    const b = new Dummy(t.p.x + 150, FLOOR); // 50 px from a: inside r 64
    const far = new Dummy(t.p.x + 260, FLOOR);
    for (const e of [a, b, far]) t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 120);
    for (const e of [a, b]) {
      const hit = e.log.find((i) => i.kind === 'explosion')!;
      expect(hit, 'in the blast').toBeTruthy();
      expect([hit.amount, hit.stun, hit.unblockable]).toEqual([SKILL_BASE.stun_grenade, STUN_GRENADE.stun, true]);
    }
    expect(a.status.stun).toBeGreaterThan(0.5);
    expect(far.log).toHaveLength(0);
    expect(t.p.skillCooldownMax[0]).toBe(12);
  });

  it('the blast radius is the table radius', () => {
    const t = setup();
    const inside = new Dummy(500 + STUN_GRENADE.radius + 8 - 2, FLOOR);
    const outside = new Dummy(500 + STUN_GRENADE.radius + 8 + 6, FLOOR);
    t.world.spawn(inside);
    t.world.spawn(outside);
    steps(t.world, 1);
    t.world.spawn(new Grenade(500, FLOOR - 20, 0, 0, t.p, item('stun_grenade'), 'stun', SKILL_BASE.stun_grenade, STUN_GRENADE));
    steps(t.world, 60);
    expect(inside.log.some((i) => i.stun)).toBe(true);
    expect(outside.log).toHaveLength(0);
  });
});

describe('자석 수류탄: pulls enemies in r 96 to the centre for 0.6 s, then 24 dmg', () => {
  const CX = 500;
  function well() {
    const t = setup();
    const left = new Dummy(CX - 80, FLOOR);
    const right = new Dummy(CX + 85, FLOOR);
    const heavy = new Dummy(CX + 60, FLOOR, 100000, 0.1);
    const out = new Dummy(CX + 200, FLOOR);
    for (const e of [left, right, heavy, out]) t.world.spawn(e);
    steps(t.world, 1);
    t.world.spawn(new MagnetWell(t.p, item('magnet_grenade'), CX, FLOOR - 4, SKILL_BASE.magnet_grenade, MAGNET_GRENADE));
    return { ...t, left, right, heavy, out };
  }

  it('the enemies in reach are dragged to the centre (stunned meanwhile), then the burst hurts them for 24', () => {
    const t = well();
    steps(t.world, 20);
    expect(t.left.x, 'on the way').toBeGreaterThan(CX - 80 + 20);
    expect(t.left.log, 'no damage while pulling').toHaveLength(0);
    expect(t.left.status.stun).toBeGreaterThan(0);
    steps(t.world, Math.ceil(MAGNET_GRENADE.pull * 60) - 20 + 3);
    for (const e of [t.left, t.right]) {
      expect(Math.abs(e.x - CX), 'gathered').toBeLessThan(6);
      expect(e.log).toHaveLength(1);
      expect([e.log[0].amount, e.log[0].kind]).toEqual([SKILL_BASE.magnet_grenade, 'explosion']);
    }
    expect(t.out.x).toBe(CX + 200);
    expect(t.out.log).toHaveLength(0);
    expect(t.world.entities.some((e) => e instanceof MagnetWell && !e.dead)).toBe(false);
  });

  it('a heavy enemy (knockbackTaken < 0.3) is not pulled but is caught by the burst if it stands close enough', () => {
    const t = well();
    steps(t.world, 50);
    expect(t.heavy.x).toBe(CX + 60);
    expect(t.heavy.log, 'r 40 burst: 60 px away is outside').toHaveLength(0);
    const u = well();
    u.heavy.x = CX + 20;
    steps(u.world, 50);
    expect(u.heavy.x).toBe(CX + 20);
    expect(u.heavy.log).toHaveLength(1);
  });

  it('thrown with the skill it lands, becomes a well and ends in the burst', () => {
    const t = setup();
    equip(t, 'magnet_grenade');
    const e = new Dummy(t.p.x + 130, FLOOR);
    t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 200);
    expect(e.log.length).toBeGreaterThanOrEqual(1);
    expect(e.log.at(-1)!.amount).toBe(SKILL_BASE.magnet_grenade);
    expect(t.p.skillCooldownMax[0]).toBe(13);
  });
});

describe('집속 수류탄: blast 18 + splits into 4 bomblets (12 each)', () => {
  it('the blast hurts for 18, four bomblets fly out and burst after their fuse (never on contact) for 12 each', () => {
    const t = setup();
    const centre = new Dummy(500, FLOOR);
    t.world.spawn(centre);
    // the bomblets land 40-90 px to each side: a row of targets collects what each one does
    const row = [-120, -70, -30, 30, 70, 120].map((dx) => new Dummy(500 + dx, FLOOR));
    for (const e of row) t.world.spawn(e);
    steps(t.world, 1);
    t.world.spawn(new Grenade(500, FLOOR - 20, 0, 0, t.p, item('cluster_grenade'), 'cluster', SKILL_BASE.cluster_grenade, CLUSTER_GRENADE));
    const t0 = t.world.time;
    steps(t.world, 2);
    expect(centre.log.map((i) => i.amount)).toEqual([SKILL_BASE.cluster_grenade]);
    const bomblets = t.world.entities.filter((e): e is Grenade => e instanceof Grenade && e.type === 'bomblet' && !e.dead);
    expect(bomblets).toHaveLength(CLUSTER_GRENADE.bomblets);
    expect(new Set(bomblets.map((b) => Math.sign(b.vx) * Math.round(Math.abs(b.vx)))).size, 'a fan, not a pile').toBe(4);
    steps(t.world, Math.ceil(BOMBLET_FUSE * 60) + 30);
    expect(t.world.entities.some((e) => e instanceof Grenade && !e.dead)).toBe(false);
    // what is in the main blast (r 44) takes 18 at once; whatever else is hit is a bomblet (12), after the fuse, never on contact
    const hits = [centre, ...row].flatMap((e) => e.log.map((i, k) => ({ amount: i.amount, at: e.times[k] - t0 })));
    const bombletHits = hits.filter((h) => h.amount === CLUSTER_GRENADE.bomblet.base);
    expect(hits.every((h) => h.amount === CLUSTER_GRENADE.bomblet.base || h.amount === SKILL_BASE.cluster_grenade)).toBe(true);
    expect(bombletHits.length, 'the bomblets burst somewhere along the row').toBeGreaterThanOrEqual(2);
    for (const h of hits) {
      if (h.amount === SKILL_BASE.cluster_grenade) expect(h.at).toBeLessThan(0.1);
      else expect(h.at).toBeGreaterThanOrEqual(BOMBLET_FUSE - 0.05);
    }
  });

  it('thrown with the skill: one blast on the target, then bomblets', () => {
    const t = setup();
    equip(t, 'cluster_grenade');
    const e = new Dummy(t.p.x + 110, FLOOR);
    t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 40);
    expect(e.log[0].amount).toBe(SKILL_BASE.cluster_grenade);
    expect(t.p.skillCooldownMax[0]).toBe(14);
    steps(t.world, 80);
    expect(e.log.slice(1).every((i) => i.amount === CLUSTER_GRENADE.bomblet.base)).toBe(true);
  });
});

describe('테슬라 코일: 8 s, zaps the nearest enemy in 140 px every 0.5 s (6 dmg, chains to 1 more)', () => {
  function coil(dxs: number[]) {
    const t = setup();
    const es = dxs.map((dx) => new Dummy(300 + dx, FLOOR));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    const c = new TeslaCoil(300, FLOOR, t.p, item('tesla_coil'), SKILL_BASE.tesla_coil, TESLA_COIL);
    t.world.spawn(c);
    return { ...t, es, c };
  }

  it('each zap hits the nearest enemy for 6 and chains to one more within 80 px of it; the third and the far one are spared', () => {
    const t = coil([60, 120, 190, 400]);
    steps(t.world, 30); // 0.5 s: the first zap (at 0.4 s)
    const [a, b, c3, far] = t.es;
    expect(a.log.map((i) => i.amount)).toEqual([SKILL_BASE.tesla_coil]);
    expect(b.log.map((i) => i.amount), 'the chain').toEqual([SKILL_BASE.tesla_coil]);
    expect(c3.log, 'a zap chains to ONE more').toHaveLength(0);
    expect(far.log).toHaveLength(0);
    steps(t.world, 100);
    expect(a.log.length, 'every 0.5 s').toBeGreaterThanOrEqual(3);
    for (let i = 1; i < a.times.length; i++) expect(a.times[i] - a.times[i - 1]).toBeCloseTo(TESLA_COIL.interval, 1);
  });

  it('only enemies inside 140 px of the coil are zapped (and not through walls); with none around it just waits', () => {
    const t = coil([180]);
    steps(t.world, 60);
    expect(t.es[0].log).toHaveLength(0);
    t.es[0].x = 300 + 130;
    steps(t.world, 40);
    expect(t.es[0].log.length).toBeGreaterThan(0);
    const m = flatMap();
    for (let y = 8; y < 16; y++) m.set(Math.floor(340 / 24), y, T.Solid);
    const w = setup(m);
    const e = new Dummy(380, FLOOR);
    w.world.spawn(e);
    steps(w.world, 1);
    w.world.spawn(new TeslaCoil(300, FLOOR, w.p, item('tesla_coil'), 6, TESLA_COIL));
    steps(w.world, 90);
    expect(e.log, 'a wall in between').toHaveLength(0);
  });

  it('it stands for 8 s and then goes; thrown with the skill it is placed in front of her', () => {
    const t = coil([]);
    const t0 = t.world.time;
    for (let i = 0; i < 900 && !t.c.dead; i++) steps(t.world, 1);
    expect(t.c.dead).toBe(true);
    expect(t.world.time - t0).toBeGreaterThanOrEqual(TESLA_COIL.life - 0.05);
    expect(t.world.time - t0).toBeLessThan(TESLA_COIL.life + 0.1);
    const u = setup();
    equip(u, 'tesla_coil');
    u.input.tap('skill1');
    steps(u.world, 40);
    const placed = u.world.entities.find((e): e is TeslaCoil => e instanceof TeslaCoil)!;
    expect(placed.x).toBeCloseTo(u.p.x + 18, 0);
    expect(u.p.skillCooldownMax[0]).toBe(16);
  });
});

describe('화염 포탑: 6 s, a fire cone 70 px in front, 4 dmg / 0.2 s + burn', () => {
  it('it breathes fire in the direction she faced: front enemies take 4 every 0.2 s and burn; behind and past 70 px nothing; gone after 6 s', () => {
    const t = setup();
    const front = new Dummy(300 + 13 + 40, FLOOR);
    const out = new Dummy(300 + 13 + 110, FLOOR);
    const behind = new Dummy(300 - 40, FLOOR);
    for (const e of [front, out, behind]) t.world.spawn(e);
    steps(t.world, 1);
    const f = new FlameTurret(300, FLOOR, t.p, item('flame_turret'), SKILL_BASE.flame_turret, 1, FLAME_TURRET);
    t.world.spawn(f);
    steps(t.world, 66);
    expect(front.log.length, '5 ticks a second').toBeGreaterThanOrEqual(4);
    expect(front.log.length).toBeLessThanOrEqual(6);
    for (const i of front.log) expect([i.amount, i.burn, i.unblockable]).toEqual([SKILL_BASE.flame_turret, FLAME_TURRET.burn, true]);
    expect(front.status.burn).toBeGreaterThan(0);
    for (let i = 1; i < front.times.length; i++) expect(front.times[i] - front.times[i - 1]).toBeCloseTo(FLAME_TURRET.interval, 1);
    expect(out.log).toHaveLength(0);
    expect(behind.log).toHaveLength(0);
    steps(t.world, Math.ceil(FLAME_TURRET.life * 60));
    expect(f.dead).toBe(true);
  });

  it('thrown with the skill facing left it burns what is on her left', () => {
    const t = setup(flatMap(), 400);
    equip(t, 'flame_turret');
    t.p.facing = -1;
    const e = new Dummy(400 - 18 - 13 - 40, FLOOR);
    t.world.spawn(e);
    steps(t.world, 1);
    t.input.setAxis('t', -1, 0);
    t.input.tap('skill1');
    steps(t.world, 5);
    t.input.setAxis('t', 0, 0);
    steps(t.world, 60);
    expect(e.log.length).toBeGreaterThan(0);
    expect(t.p.skillCooldownMax[0]).toBe(15);
  });
});

describe('위상 전이: teleport behind the nearest enemy within 160 px, stun it 1 s; your next hit within 2 s crits', () => {
  function phase(dx = 100, extra: Dummy[] = []) {
    const t = setup();
    equip(t, 'phaser');
    equip(t, 'rusty_sword'); // (weapon slot 0 is already the sword)
    const e = new Dummy(t.p.x + dx, FLOOR);
    e.facing = -1; // looking at her
    t.world.spawn(e);
    for (const x of extra) t.world.spawn(x);
    steps(t.world, 1);
    return { ...t, e };
  }

  it('she appears at its back (its far side), turned toward it; it is stunned for 1 s; the cooldown is spent', () => {
    const t = phase(100);
    const x0 = t.p.x;
    t.input.tap('skill1');
    steps(t.world, 25);
    expect(t.p.x).toBeGreaterThan(x0 + 100);
    expect(t.p.x - t.e.x).toBeGreaterThan(0);
    expect(t.p.x - t.e.x).toBeLessThan(30);
    expect(t.p.facing).toBe(-1);
    expect(t.e.status.stun).toBeGreaterThan(PHASER.stun - 0.5);
    expect(t.p.skillCooldown[0]).toBeGreaterThan(5);
    expect(t.p.skillCooldownMax[0]).toBe(10);
  });

  it('picks the nearest enemy, not the first or the farthest', () => {
    const near = new Dummy(120 + 60, FLOOR);
    near.facing = -1;
    const t = phase(140, [near]);
    t.input.tap('skill1');
    steps(t.world, 25);
    expect(Math.abs(t.p.x - near.x)).toBeLessThan(30);
    expect(t.e.status.stun).toBe(0);
    expect(near.status.stun).toBeGreaterThan(0.4);
  });

  it('her next weapon hit crits (once), only inside the 2 s window', () => {
    const t = phase(100);
    t.input.tap('skill1');
    steps(t.world, 25);
    swing(t);
    expect([t.e.log[0].crit, t.e.log[0].amount]).toEqual([true, 14 * CRIT_MULT]);
    swing(t);
    expect(t.e.log[1].crit, 'only the next hit').toBeFalsy();
    // a second phase, then wait out the window
    const u = phase(100);
    u.input.tap('skill1');
    steps(u.world, 25);
    steps(u.world, Math.ceil(PHASER.critWindow * 60) + 5);
    swing(u);
    expect(u.e.log[0].crit).toBeFalsy();
  });

  it('an arrow after the phase is a crit too', () => {
    const t = phase(100);
    equip(t, 'hunter_bow');
    t.input.tap('skill1');
    steps(t.world, 25);
    t.input.press('attack1');
    steps(t.world, 30);
    t.input.release('attack1');
    steps(t.world, 1);
    expect(arrows(t)[0]?.info.crit).toBe(true);
  });

  it('with nobody within 160 px (or none at all) nothing happens and the cooldown is not spent', () => {
    const t = phase(200);
    const x0 = t.p.x;
    t.input.tap('skill1');
    steps(t.world, 30);
    expect(t.p.x).toBe(x0);
    expect(t.p.skillCooldown[0]).toBe(0);
    const u = setup();
    equip(u, 'phaser');
    u.input.tap('skill1');
    steps(u.world, 30);
    expect(u.p.skillCooldown[0]).toBe(0);
  });

  it('with a wall behind the enemy she appears on its other side', () => {
    const m = flatMap();
    for (let y = 8; y < 16; y++) m.set(Math.floor(230 / 24), y, T.Solid);
    const t = setup(m);
    equip(t, 'phaser');
    const e = new Dummy(210, FLOOR);
    e.facing = -1;
    t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 25);
    expect(t.p.x).toBeLessThan(e.x);
    expect(t.p.skillCooldown[0]).toBeGreaterThan(5);
  });
});

describe('거부의 파동: pushes every enemy in r 110 away (knockback 420), 12 dmg, destroys enemy projectiles in range', () => {
  function wave() {
    const t = setup(flatMap(), 300);
    equip(t, 'wave_of_denial');
    const right = new Dummy(300 + 60, FLOOR);
    const left = new Dummy(300 - 90, FLOOR);
    const out = new Dummy(300 + 200, FLOOR);
    for (const e of [right, left, out]) t.world.spawn(e);
    const arrowIn = new EnemyArrow(300 + 80, FLOOR - 24, -100, 0, 8, null);
    const boltIn = new Bolt(300 - 70, FLOOR - 24, 100, 0, 8, null);
    const arrowOut = new EnemyArrow(300 + 180, FLOOR - 24, -100, 0, 8, null);
    // (flies over the heads of the dummies: it must not hit one of them before the wave goes off)
    const mine = new EnemyArrow(300 + 50, FLOOR - 70, 100, 0, 8, null);
    for (const e of [arrowIn, boltIn, arrowOut, mine]) t.world.spawn(e);
    steps(t.world, 1);
    mine.reflect('player'); // sent back by a parry: hers now
    return { ...t, right, left, out, arrowIn, boltIn, arrowOut, mine };
  }

  it('hurts for 12 and throws every enemy inside 110 px away with 420 px/s; the far one is untouched', () => {
    const t = wave();
    t.input.tap('skill1');
    steps(t.world, 20);
    expect(t.right.log.map((i) => [i.amount, i.knockback, i.kind])).toEqual([[SKILL_BASE.wave_of_denial, WAVE_OF_DENIAL.knockback, 'explosion']]);
    expect(t.left.log).toHaveLength(1);
    expect(t.right.vx, 'away from her (right)').toBeGreaterThan(0);
    expect(t.left.vx, 'away from her (left)').toBeLessThan(0);
    expect(Math.abs(t.right.vx)).toBeLessThanOrEqual(WAVE_OF_DENIAL.knockback);
    expect(t.out.log).toHaveLength(0);
    expect(t.p.skillCooldownMax[0]).toBe(11);
  });

  it('wipes the enemy arrows and bolts inside the radius; those outside, and the ones she reflected, fly on', () => {
    const t = wave();
    t.input.tap('skill1');
    steps(t.world, 20);
    expect(t.arrowIn.dead).toBe(true);
    expect(t.boltIn.dead).toBe(true);
    expect(t.arrowOut.dead).toBe(false);
    expect(t.mine.dead).toBe(false);
  });
});

describe('거부의 파동 wipes every enemy projectile class in range, not only arrows (spec#2)', () => {
  it('the sword beam, the chain hook, the moon shard (by its landing spot) and the bomb / web blob go; the ones outside the radius, and the jailer itself, stay', () => {
    const t = setup(flatMap(), 300);
    equip(t, 'wave_of_denial');
    const jailer = new Dummy(300 + 90, FLOOR);
    t.world.spawn(jailer);
    // (all of them fly away from her, so none can hurt her before the wave goes off)
    const beamIn = new SwordBeam(300 + 70, FLOOR - 24, 1, 20, 10, null, 300);
    const beamOut = new SwordBeam(300 + 240, FLOOR - 24, 1, 20, 10, null, 300);
    const hookIn = new EnemyChainHook(300 + 60, FLOOR - 24, 1, 0, jailer, { range: 180, speed: 20, damage: 5, pull: 1 });
    const hookOut = new EnemyChainHook(300 + 230, FLOOR - 24, 1, 0, jailer, { range: 180, speed: 20, damage: 5, pull: 1 });
    // a shard that still hangs high above her (its marker is on the floor beside her): wiped; one marked far away: not
    const shardIn = new MoonShard(300 - 40, FLOOR, FLOOR - 400, 5, 10, null);
    const shardOut = new MoonShard(300 + 300, FLOOR, FLOOR - 400, 5, 10, null);
    const bombIn = new Bomb(300 - 60, FLOOR - 60, 0, 0, { damage: 10, fuse: 30 });
    const blobIn = new WebBlob(300 + 50, FLOOR - 70, 1, 0, 10, 1, null);
    const all = [beamIn, beamOut, hookIn, hookOut, shardIn, shardOut, bombIn, blobIn];
    for (const e of all) t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 20);
    expect([beamIn.dead, hookIn.dead, shardIn.dead, bombIn.dead, blobIn.dead], 'inside the radius').toEqual([true, true, true, true, true]);
    expect([beamOut.dead, hookOut.dead, shardOut.dead], 'outside the radius').toEqual([false, false, false]);
    expect(jailer.dead).toBe(false);
  });
});

describe('회오리: a vortex travels 200 px forward over 2 s, drags enemies along, 3 dmg / 0.2 s', () => {
  function twister(dxs: number[], kb = 1) {
    const t = setup();
    equip(t, 'tornado');
    const es = dxs.map((dx) => new Dummy(t.p.x + dx, FLOOR, 100000, kb));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    let tw: Tornado | undefined;
    for (let i = 0; i < 30 && !tw; i++) {
      steps(t.world, 1);
      tw = t.world.entities.find((e): e is Tornado => e instanceof Tornado);
    }
    return { ...t, es, tw: tw! };
  }

  it('it rolls 200 px in 2 s along the floor and is gone; the enemy inside is carried along with it and takes 3 every 0.2 s', () => {
    const t = twister([34]);
    const x0 = t.tw.x;
    const e = t.es[0];
    steps(t.world, Math.ceil(TORNADO.life * 60) - 3);
    expect(t.tw.x - x0).toBeGreaterThan(TORNADO.distance - 12);
    expect(t.tw.x - x0).toBeLessThanOrEqual(TORNADO.distance + 1);
    expect(e.x - 34 - t.p.x, 'dragged along').toBeGreaterThan(150);
    expect(Math.abs(e.x - t.tw.x)).toBeLessThan(TORNADO.radius);
    expect(e.log.length).toBeGreaterThanOrEqual(8);
    expect(e.log.length).toBeLessThanOrEqual(11);
    for (const i of e.log) expect([i.amount, i.kind, i.hitstun]).toEqual([SKILL_BASE.tornado, 'explosion', 0]);
    for (let i = 1; i < e.times.length; i++) expect(e.times[i] - e.times[i - 1]).toBeCloseTo(TORNADO.interval, 1);
    expect(e.status.stun, 'held while inside').toBeGreaterThan(0);
    steps(t.world, 10);
    expect(t.world.entities.some((x) => x instanceof Tornado)).toBe(false);
    expect(t.p.skillCooldownMax[0]).toBe(15);
  });

  it('heavy enemies (knockbackTaken < 0.3) are hurt but stay where they are; enemies outside the funnel are untouched', () => {
    const t = twister([34, 110], 1);
    const heavy = twister([34], 0.1);
    steps(heavy.world, 60);
    expect(heavy.es[0].x).toBe(heavy.p.x + 34);
    expect(heavy.es[0].log.length).toBeGreaterThan(0);
    steps(t.world, 4);
    expect(t.es[1].log, 'not in the funnel yet').toHaveLength(0);
  });

  it('a wall ends it', () => {
    const m = flatMap();
    for (let y = 10; y < 16; y++) m.set(Math.floor(220 / 24), y, T.Solid);
    const t = setup(m);
    equip(t, 'tornado');
    t.input.tap('skill1');
    steps(t.world, 90);
    expect(t.world.entities.some((x) => x instanceof Tornado)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('every new item can be picked up, held and used once', () => {
  it('a weapon swings / draws / blocks / breathes, a skill starts its cooldown (or, for the phaser, waits for a target); nothing throws', () => {
    for (const id of [...NEW_WEAPONS, ...NEW_SKILLS]) {
      const t = setup();
      equip(t, id);
      const e = new Dummy(t.p.x + 50, FLOOR);
      e.facing = -1;
      t.world.spawn(e);
      const slot = ITEMS[id].slot === 'skill' ? 'skill1' : 'attack1';
      t.input.press(slot);
      const states = new Set<string>();
      for (let i = 0; i < 60; i++) {
        steps(t.world, 1);
        states.add(t.p.state);
        if (i === 10) t.input.release(slot);
      }
      if (ITEMS[id].slot === 'skill') expect(Math.max(...t.p.skillCooldown), id).toBeGreaterThan(0);
      else expect([...states].some((st) => st !== 'idle' && st !== 'run'), `${id} states ${[...states]}`).toBe(true);
      expect(t.p.hp, id).toBe(100);
    }
  });

  it('they work from the second slot too and with a tier and an affix', () => {
    for (const id of NEW_WEAPONS) {
      const t = setup();
      t.run.weapons = [null, { id, tier: 3, affix: ITEMS[id].kind === 'shield' ? 'heal_on_kill' : 'dmg' }];
      const e = new Dummy(t.p.x + 40, FLOOR);
      t.world.spawn(e);
      t.input.press('attack2');
      steps(t.world, 40);
      t.input.release('attack2');
      steps(t.world, 40);
      expect(t.p.state, id).not.toBe('dead');
    }
  });
});

describe('the codex pages of the ordinary items', () => {
  const weapons = new Map(codexEntries('weapon').map((e) => [e.id, e]));
  const skills = new Map(codexEntries('skill').map((e) => [e.id, e]));
  const row = (id: string, label: string) => (weapons.get(id) ?? skills.get(id))!.rows.find((r) => r.label === label)!.text;
  const text = (id: string) => (weapons.get(id) ?? skills.get(id))!.rows.map((r) => r.text).join('\n');

  it('every one of the 22 has a page in the 일반 group, with its blueprint cost or 기본 as the 해금 row', () => {
    for (const id of [...NEW_WEAPONS, ...NEW_SKILLS]) {
      const e = weapons.get(id) ?? skills.get(id);
      expect(e, id).toBeTruthy();
      expect(e!.group, id).toBe('일반');
      expect(e!.tab).toBe(ITEMS[id].slot === 'weapon' ? 'weapon' : 'skill');
      const unlock = row(id, '해금');
      if (STARRED.includes(id)) expect(unlock, id).toBe('기본');
      else expect(unlock, id).toBe(`연금술사 ${META_UPGRADES.find((u) => u.item === id)!.cost}셀`);
      expect(e!.rows.find((r) => r.label === '접사'), id).toBeTruthy();
      expect(text(id), id).not.toMatch(/undefined|NaN|\[object/);
    }
    expect(new Set(buildCodex().map((e) => e.id)).size).toBe(buildCodex().length);
  });

  it('the numbers on the pages are the numbers of the tables', () => {
    const k = melee('iron_katana').dash!;
    expect(row('iron_katana', '특수')).toContain(`${k.distance}px`);
    expect(row('iron_katana', '특수')).toContain(`${k.damage}`);
    expect(row('broadsword', '치명타')).toContain('3타');
    expect(row('frantic_sword', '치명타')).toContain('50%');
    expect(row('rapier', '치명타')).toContain('1.5초');
    expect(row('sadist_stiletto', '치명타')).toMatch(/불타는.*얼어붙은.*기절한/);
    expect(row('grave_shovel', '특수')).toContain('기절 0.8초');
    expect(row('grave_shovel', '치명타')).toContain('기절한');
    expect(row('torch', '특수')).toContain('3초 화상');
    expect(row('leather_whip', '사거리')).toContain('104px');
    expect(row('leather_whip', '치명타')).toContain('24px');
    expect(row('multi_bow', '피해')).toContain(`3발 × ${Math.round(28 * 0.45)}`);
    expect(row('ice_bow', '특수')).toContain('1.2초 빙결');
    expect(row('heavy_crossbow', '특수')).toContain('160px');
    expect(row('heavy_crossbow', '피해')).toContain(`5발 × ${Math.round(bowOf('heavy_crossbow').damage * 0.4)}`);
    expect(row('throwing_knives', '특수')).toContain('출혈 2초');
    expect(row('fire_staff', '피해')).toContain('9 / 0.15초');
    expect(row('fire_staff', '사거리')).toContain('64px');
    expect(row('spiked_shield', '특수')).toContain('피해 40');
    expect(row('spiked_shield', '막기')).toContain('-75%');
    expect(row('stun_grenade', '효과')).toContain('2초 기절');
    expect(row('magnet_grenade', '효과')).toContain('반경 96px');
    expect(row('cluster_grenade', '피해')).toContain(`${CLUSTER_GRENADE.bomblets}개 × ${CLUSTER_GRENADE.bomblet.base}`);
    expect(row('tesla_coil', '효과')).toContain(`반경 ${TESLA_COIL.range}px`);
    expect(row('flame_turret', '효과')).toContain(`${FLAME_TURRET.range}px`);
    expect(row('phaser', '효과')).toContain(`반경 ${PHASER.range}px`);
    expect(row('wave_of_denial', '효과')).toContain(`넉백 ${WAVE_OF_DENIAL.knockback}`);
    expect(row('tornado', '효과')).toContain(`${TORNADO.distance}px`);
    for (const id of NEW_SKILLS) expect(row(id, '재사용'), id).toBe(`${ITEMS[id].cooldown}초`);
    for (const id of NEW_SKILLS.filter((i) => i !== 'phaser')) expect(text(id), id).toContain(String(SKILL_BASE[id as keyof typeof SKILL_BASE]));
  });

  it('the previews use the new heroine animations of the spec', () => {
    const anims = (id: string) => (weapons.get(id) ?? skills.get(id))!.preview.steps.map((s) => s.anim);
    expect(anims('broadsword')).toEqual(['heavy_1', 'heavy_2', 'heavy_3']);
    expect(anims('leather_whip')).toEqual(['whip_1', 'whip_2']);
    expect(anims('grave_shovel')).toEqual(['heavy_1', 'heavy_2']);
    expect(anims('fire_staff')).toEqual(['cast']);
    expect(anims('multi_bow')).toEqual(['bow_draw', 'bow_shoot']);
    expect(anims('spiked_shield')).toEqual(['shield_block', 'shield_parry']);
    expect(weapons.get('fire_staff')!.tag).toMatch(/지팡이/);
    expect(weapons.get('throwing_knives')!.tag).toMatch(/투척/);
  });
});
