import { describe, it, expect } from 'vitest';
import { makeTestWorld, steps, flatMap, implemented } from './helpers';
import { Player } from '../src/game/player/player';
import { Actor, type Entity } from '../src/game/entity';
import type { DamageInfo } from '../src/game/combat';
import { T, type TileMap } from '../src/game/tilemap';
import { AFFIX, CRIT_MULT, GRADES } from '../src/game/rules';
import { ITEMS, itemLines, rollItem, signatureText } from '../src/game/items/items';
import { ITEM_IDS, UNIQUE_IDS, type ItemId, type ItemInstance } from '../src/game/items/types';
import { Rng } from '../src/engine/rng';
import { WEAPONS, type BowWeapon, type MeleeWeapon, type ShieldWeapon, type WandWeapon, type WeaponDef } from '../src/game/player/weapons';
import {
  BONE_TURRET, CHAIN_PRISON, CRIMSON_RAIN, DEATH_ORB, LAST_BELL, PLAGUE_CENSER, RAG_DOLL, REQUIEM, SKILLS, SKILL_BASE,
} from '../src/game/player/skills';
import { Arrow, Turret } from '../src/game/player/projectiles';
import { ChainPrison, DeathOrb, Glaive, LightningArcs, NeedleRain, PlagueAura, Quake, Wisp } from '../src/game/player/uniques';
import { Arrow as EnemyArrow } from '../src/game/enemies/projectiles';
import { Golem } from '../src/game/allies/golem';
import { Matron } from '../src/game/boss/matron';
import { createMiniBoss } from '../src/game/miniboss';
import { createEnemy } from '../src/game/enemies/factory';
import { buildCodex, codexEntries } from '../src/game/ui/codexData';

/**
 * The 20 unique items of grades A to SSS (docs/CONTENT4.md §5.3): their tables, then one focused test per signature. Targets are
 * stationary `Dummy` actors that log every hit they take.
 */
const FLOOR = 16 * 24;
const heroineFile = import.meta.glob('../public/assets/sprites/heroine.json', { eager: true, import: 'default' }) as Record<string, { animations: Record<string, unknown> }>;

/** the 12 weapons and 8 skills: id, grade (the spec lists five of each grade: A three weapons and two skills ...) */
const WEAPON_IDS = [
  'grave_bell', 'leech_whip', 'bone_rampart', 'executioner_blade', 'storm_staff', 'moon_glaives',
  'matron_flail', 'soulfire_bow', 'bell_aegis', 'selma_shears', 'ember_blade', 'ninefold_whip',
] as const;
const SKILL_IDS = ['plague_censer', 'bone_turret', 'death_orb', 'chain_prison', 'rag_doll', 'crimson_rain', 'last_bell', 'requiem'] as const;
const GRADE_OF: Record<string, 'A' | 'S' | 'SS' | 'SSS'> = {
  grave_bell: 'A', leech_whip: 'A', bone_rampart: 'A', plague_censer: 'A', bone_turret: 'A',
  executioner_blade: 'S', storm_staff: 'S', moon_glaives: 'S', death_orb: 'S', chain_prison: 'S',
  matron_flail: 'SS', soulfire_bow: 'SS', bell_aegis: 'SS', rag_doll: 'SS', crimson_rain: 'SS',
  selma_shears: 'SSS', ember_blade: 'SSS', ninefold_whip: 'SSS', last_bell: 'SSS', requiem: 'SSS',
};

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
  /** a real enemy tells the world it died (kill streaks, the death orb and the requiem listen) */
  die(info: DamageInfo) {
    super.die(info);
    this.world.emit({ type: 'enemyKilled', enemy: this, elite: false });
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
const equip = (t: Ctx, id: ItemId, slot = 0, tier = 1) => {
  if (ITEMS[id].slot === 'skill') t.run.skills[slot] = item(id, tier);
  else t.run.weapons[slot] = item(id, tier);
};
/** one swing of weapon slot 0, then wait until the heroine is free again */
function swing(t: Ctx): void {
  t.input.tap('attack1');
  steps(t.world, 4);
  for (let i = 0; i < 90 && t.p.state === 'attack'; i++) steps(t.world, 1);
}
/** a heroine with `id` in hand and enemies at the given distances in front of her */
function duel(id: ItemId, dxs: number[] = [30], hp = 100000, kb = 1) {
  const t = setup();
  equip(t, id);
  const es = dxs.map((dx) => new Dummy(t.p.x + dx, FLOOR, hp, kb));
  for (const e of es) t.world.spawn(e);
  steps(t.world, 1);
  return { ...t, es, e: es[0] };
}
/** a heroine with the skill in slot 0 and enemies at the given distances in front of her; the cast has run when this returns */
function cast(id: ItemId, dxs: number[], after = 30, hp = 100000) {
  const t = duel(id, dxs, hp);
  t.input.tap('skill1');
  steps(t.world, after);
  return t;
}

function weapon<K extends WeaponDef['kind']>(id: keyof typeof WEAPONS, kind: K): Extract<WeaponDef, { kind: K }> {
  const w = WEAPONS[id];
  if (w.kind !== kind) throw new Error(`${id} is a ${w.kind}, not a ${kind}`);
  return w as Extract<WeaponDef, { kind: K }>;
}
const melee = (id: keyof typeof WEAPONS): MeleeWeapon => weapon(id, 'melee');
const bowOf = (id: keyof typeof WEAPONS): BowWeapon => weapon(id, 'bow');
const shieldOf = (id: keyof typeof WEAPONS): ShieldWeapon => weapon(id, 'shield');
const wandOf = (id: keyof typeof WEAPONS): WandWeapon => weapon(id, 'wand');
/** damage per second of a combo: a lash that lands several times counts every landing; `crit` counts the hits that always crit */
const dpsOf = (w: MeleeWeapon, crit: boolean): number => {
  let dmg = 0;
  let time = 0;
  w.hits.forEach((h, i) => {
    dmg += h.damage * (h.multi?.n ?? 1) * (crit && h.crit === 'always' ? CRIT_MULT : 1);
    time += h.windup + h.active + h.recover * (i === w.hits.length - 1 ? 1 : 0.45);
  });
  return dmg / time;
};
const of = <T extends Entity>(t: Ctx, cls: abstract new (...a: never[]) => T): T[] => t.world.entities.filter((e): e is T => e instanceof cls && !e.dead);

// ---------------------------------------------------------------------------------------------------------------------
describe('the 20 unique items of grades A to SSS (docs/CONTENT4.md §5.3): the catalogue', () => {
  it('all of them work now: a weapon / skill table each, the spec grade, slot and colour, a Korean name, no affix, never rolled', () => {
    expect(WEAPON_IDS).toHaveLength(12);
    expect(SKILL_IDS).toHaveLength(8);
    for (const id of [...WEAPON_IDS, ...SKILL_IDS]) {
      const d = ITEMS[id];
      expect([d.unique, d.grade], id).toEqual([true, GRADE_OF[id]]);
      expect(d.slot, id).toBe(WEAPON_IDS.includes(id as never) ? 'weapon' : 'skill');
      expect(d.name, id).toMatch(/[가-힣]/);
      expect(d.icon).toBe(id);
      expect([...d.desc].length, `${id} desc`).toBeLessThanOrEqual(16);
      expect(implemented(id), id).toBe(true);
      expect(UNIQUE_IDS).toContain(id);
    }
    // every id of the game has a behaviour now (the expansion is complete)
    expect(ITEM_IDS.filter((i) => !implemented(i))).toEqual([]);
    const rng = new Rng(7);
    for (let i = 0; i < 300; i++) expect(UNIQUE_IDS).not.toContain(rollItem(rng, 1 + (i % 3), ITEM_IDS, i % 2 ? 'skill' : 'weapon').id);
  });

  it('colours and families of the spec table', () => {
    const colour: Record<string, string> = {
      grave_bell: 'survival', leech_whip: 'brutality', bone_rampart: 'survival', plague_censer: 'survival', bone_turret: 'tactics',
      executioner_blade: 'brutality', storm_staff: 'tactics', moon_glaives: 'tactics', death_orb: 'brutality', chain_prison: 'survival',
      matron_flail: 'brutality', soulfire_bow: 'tactics', bell_aegis: 'survival', rag_doll: 'survival', crimson_rain: 'brutality',
      selma_shears: 'brutality', ember_blade: 'tactics', ninefold_whip: 'tactics', last_bell: 'survival', requiem: 'brutality',
    };
    for (const [id, c] of Object.entries(colour)) expect(ITEMS[id as ItemId].color, id).toBe(c);
    const anims = (id: keyof typeof WEAPONS) => melee(id).hits.map((h) => h.anim);
    expect(anims('grave_bell')).toEqual(['hammer_1', 'hammer_2']);
    expect(anims('matron_flail')).toEqual(['hammer_1', 'hammer_2']);
    expect(anims('leech_whip')).toEqual(['whip_1', 'whip_2']);
    expect(anims('ninefold_whip')).toEqual(['whip_1', 'whip_2']);
    expect(anims('executioner_blade')).toEqual(['heavy_1', 'heavy_2', 'heavy_3']);
    expect(anims('selma_shears')).toEqual(['heavy_1', 'heavy_2', 'heavy_3']);
    expect(anims('moon_glaives')).toEqual(['dagger_1', 'dagger_2', 'dagger_3', 'dagger_4']);
    expect(anims('ember_blade')).toEqual(['sword_1', 'sword_2', 'sword_3']);
    expect(WEAPONS.storm_staff.kind).toBe('wand');
    expect(WEAPONS.soulfire_bow.kind).toBe('bow');
    expect([WEAPONS.bone_rampart.kind, WEAPONS.bell_aegis.kind]).toEqual(['shield', 'shield']);
    // the animation rows they use are in the real heroine manifest
    const rows = Object.keys(Object.values(heroineFile)[0].animations);
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      if (w.kind === 'melee') for (const h of w.hits) expect(rows, `${id} ${h.anim}`).toContain(h.anim);
    }
    expect(rows).toEqual(expect.arrayContaining(['whip_1', 'whip_2', 'heavy_1', 'heavy_2', 'heavy_3', 'cast', 'sprint']));
  });

  it('skills carry cooldowns, the last bell the 40 s of the spec; every number the cards show is a table number', () => {
    const cd: Record<string, number> = { plague_censer: 18, bone_turret: 16, death_orb: 20, chain_prison: 18, rag_doll: 22, crimson_rain: 16, last_bell: 40, requiem: 30 };
    for (const [id, c] of Object.entries(cd)) {
      expect(ITEMS[id as ItemId].cooldown, id).toBe(c);
      expect(SKILLS[id as ItemId], id).toBeTruthy();
    }
    expect(SKILL_BASE).toMatchObject({ plague_censer: 4, bone_turret: 14, death_orb: 20, chain_prison: 20, crimson_rain: 5, last_bell: 120 });
    expect(PLAGUE_CENSER).toMatchObject({ life: 6, radius: 72 });
    expect(SKILL_BASE.plague_censer / PLAGUE_CENSER.interval, 'poison per second').toBe(8);
    expect(BONE_TURRET).toMatchObject({ life: 10, pierce: true });
    expect(DEATH_ORB).toMatchObject({ life: 8, reach: 90, burst: { radius: 48, base: 20 }, heal: 0.02 });
    expect(CHAIN_PRISON).toMatchObject({ radius: 120, root: 2.5 });
    expect(CRIMSON_RAIN).toMatchObject({ life: 2, reach: 160 });
    expect(LAST_BELL).toMatchObject({ boss: 40, stun: 2 });
    expect(REQUIEM).toMatchObject({ life: 6, refund: 0.3, heal: 0.01 });
    expect(RAG_DOLL).toMatchObject({ scale: 0.5, life: 10 });
  });

  it('balance: the weapon tables sit near the power target of their grade over the DPS of the ordinary weapon of their family (signature on top)', () => {
    // (those whose signature multiplies damage - selma's crit on bleeding, the ember blade's full-HP bonus - sit a little below)
    const pairs: [keyof typeof WEAPONS, keyof typeof WEAPONS, number][] = [
      ['grave_bell', 'war_hammer', GRADES.A.power], ['leech_whip', 'leather_whip', GRADES.A.power],
      ['executioner_blade', 'broadsword', GRADES.S.power], ['moon_glaives', 'twin_daggers', GRADES.S.power],
      ['matron_flail', 'war_hammer', GRADES.SS.power],
      ['selma_shears', 'broadsword', GRADES.SSS.power - 0.2], ['ember_blade', 'rusty_sword', GRADES.SSS.power - 0.2], ['ninefold_whip', 'leather_whip', GRADES.SSS.power - 0.1],
    ];
    for (const [u, base, power] of pairs) {
      const r = dpsOf(melee(u), false) / dpsOf(melee(base), true);
      expect(r, `${u} / ${base}`).toBeGreaterThan(1 + power - 0.1);
      expect(r, `${u} / ${base}`).toBeLessThan(1 + power + 0.1);
    }
    // bows count a second of full draws with the follow-through; the staff its first bolt every interval
    const bow = (id: 'hunter_bow' | 'soulfire_bow') => bowOf(id).damage / (bowOf(id).drawTime + 0.2);
    expect(bow('soulfire_bow') / bow('hunter_bow')).toBeGreaterThan(1 + GRADES.SS.power - 0.1);
    expect(bow('soulfire_bow') / bow('hunter_bow')).toBeLessThan(1 + GRADES.SS.power + 0.1);
    const f = (WEAPONS.fire_staff as { flame: { damage: number; interval: number } }).flame;
    const b = wandOf('storm_staff').bolt;
    expect(b.damage / b.interval / (f.damage / f.interval)).toBeGreaterThan(1 + GRADES.S.power - 0.1);
    expect(b.damage / b.interval / (f.damage / f.interval)).toBeLessThan(1 + GRADES.S.power + 0.1);
    // the grades order the power of the weapons of one family: war hammer < 장례 종 < 여교도관의 종철퇴
    expect(dpsOf(melee('grave_bell'), false)).toBeGreaterThan(dpsOf(melee('reaper_scythe'), false));
    expect(dpsOf(melee('matron_flail'), false)).toBeGreaterThan(dpsOf(melee('grave_bell'), false));
  });

  it('the item cards and the codex carry the signature of each (from the tables, no undefined / NaN)', () => {
    for (const id of [...WEAPON_IDS, ...SKILL_IDS]) {
      const lines = itemLines(item(id, 2));
      expect(lines[0]).toBe(ITEMS[id].desc);
      expect(lines.at(-1), id).toBe(signatureText(id, (b) => Math.round(b * 1.25)));
      expect(signatureText(id).length, id).toBeGreaterThan(12);
      expect(lines.join('|'), id).not.toMatch(/undefined|NaN/);
    }
    expect(signatureText('grave_bell')).toContain(`${melee('grave_bell').toll!.radius}px`);
    expect(signatureText('leech_whip')).toContain('5%');
    expect(signatureText('executioner_blade')).toContain('25%');
    expect(signatureText('storm_staff')).toContain('5명');
    expect(signatureText('last_bell')).toContain(String(SKILL_BASE.last_bell));
    // the codex: every one of them has a page in its grade group with a signature row and the recipe
    const all = buildCodex();
    for (const id of [...WEAPON_IDS, ...SKILL_IDS]) {
      const e = all.find((x) => x.id === id)!;
      expect(e, id).toBeTruthy();
      expect([e.tab, e.group, e.grade], id).toEqual([ITEMS[id].slot === 'weapon' ? 'weapon' : 'skill', `유니크 ${GRADE_OF[id]}`, GRADE_OF[id]]);
      expect(e.rows[0], id).toMatchObject({ label: '고유 효과', text: signatureText(id) });
      expect(e.rows.at(-1)!.label, id).toBe('조합');
      expect(e.rows.map((r) => r.text).join('|'), id).not.toMatch(/undefined|NaN|\?\?\?/);
    }
    expect(codexEntries('weapon')).toHaveLength(39);
    expect(codexEntries('skill')).toHaveLength(24);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('장례 종 (A): every hit tolls - a ring of 64 px, 12 damage, stun 0.6 s around the target', () => {
  it('the target and the enemies within 64 px of it are hurt for 12 and stunned 0.6 s, once each per swing; far ones are not', () => {
    const t = duel('grave_bell', [30, 45, 130]);
    const [a, b, far] = t.es;
    swing(t);
    for (const e of [a, b]) {
      const amounts = e.log.map((i) => i.amount).sort((m, n) => m - n);
      expect(amounts, 'the hammer once and the toll once').toEqual([melee('grave_bell').toll!.damage, melee('grave_bell').hits[0].damage]);
      const toll = e.log.find((i) => i.amount === 12)!;
      expect([toll.kind, toll.unblockable, toll.stun]).toEqual(['explosion', true, 0.6]);
      expect(e.status.stun, 'stunned').toBeGreaterThan(0.1);
    }
    expect(far.log, 'past the ring').toHaveLength(0);
  });

  it('a swing that hits nothing tolls nothing; the next swing tolls again', () => {
    const t = duel('grave_bell', [200]);
    swing(t);
    expect(t.e.log).toHaveLength(0);
    t.e.x = t.p.x + 30;
    steps(t.world, 30);
    swing(t);
    expect(t.e.log.filter((i) => i.amount === 12).length).toBeGreaterThanOrEqual(1);
    expect(t.sounds).toContain('bell');
  });
});

describe('거머리 채찍 (A): heals 5 % of the damage dealt; tip hits pull the target 30 px toward her', () => {
  it('a hit heals 5 % of what it dealt (13 -> 0.65 HP), and a body hit does not pull', () => {
    const t = duel('leech_whip', [40]);
    t.p.hp = 50;
    const x0 = t.e.x;
    swing(t);
    const dealt = t.e.log[0].amount;
    expect(dealt).toBe(13);
    expect(t.p.hp).toBeCloseTo(50 + 13 * 0.05, 5);
    expect(t.e.x, 'not in the tip: not pulled').toBe(x0);
  });

  it('a tip hit crits, heals 5 % of the crit and pulls the target 30 px toward her; a heavy enemy stays where it is', () => {
    const t = duel('leech_whip', [100]);
    t.p.hp = 50;
    const x0 = t.e.x;
    swing(t);
    const hit = t.e.log[0];
    expect([hit.amount, hit.crit]).toEqual([13 * CRIT_MULT, true]);
    expect(t.p.hp).toBeCloseTo(50 + 26 * 0.05, 5);
    expect(x0 - t.e.x, 'pulled toward her').toBeCloseTo(30, 5);
    const heavy = duel('leech_whip', [100], 100000, 0.1);
    const hx = heavy.e.x;
    swing(heavy);
    expect(heavy.e.log.length).toBeGreaterThan(0);
    expect(heavy.e.x).toBe(hx);
    expect(melee('leech_whip')).toMatchObject({ leech: 0.05, tipPull: 30 });
  });
});

describe('뼈 성벽 (A): 100 % block for the first 0.5 s of a block; a parry heals 10 % max HP', () => {
  function guard() {
    const t = setup();
    equip(t, 'bone_rampart', 1);
    const near = new Dummy(t.p.x + 30, FLOOR);
    near.facing = -1;
    t.world.spawn(near);
    steps(t.world, 1);
    t.input.press('attack2');
    return { ...t, near };
  }

  it('the first 0.5 s of the block stop every blow (no damage, no stagger); after it the shield blocks 80 %', () => {
    const t = guard();
    steps(t.world, 20); // 0.33 s: past the parry window, inside the wall
    const r = t.p.takeDamage({ amount: 40, dir: -1, kind: 'melee', source: t.near });
    expect([r.blocked, r.applied, r.amount]).toEqual([true, false, 0]);
    expect(t.p.hp).toBe(100);
    expect(t.p.state, 'no stagger').toBe('block');
    steps(t.world, 20); // 0.67 s
    const late = t.p.takeDamage({ amount: 40, dir: -1, kind: 'melee', source: t.near });
    expect([late.blocked, late.amount]).toEqual([true, 8]);
    expect(t.p.hp).toBe(92);
    expect(shieldOf('bone_rampart')).toMatchObject({ reduction: 0.8, fullBlock: 0.5, parryHeal: 0.1 });
  });

  it('a parry heals 10 % of max HP, once per block, and still stuns the attacker', () => {
    const t = guard();
    t.p.hp = 50;
    steps(t.world, 3);
    const r = t.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: t.near });
    expect(r.parried).toBe(true);
    expect(t.p.hp).toBe(60);
    expect(t.near.status.stun).toBeGreaterThan(1.3);
    t.p.invuln = 0;
    t.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: t.near });
    expect(t.p.hp, 'a second parry of the same block heals nothing more').toBe(60);
  });
});

describe('plague_censer 역병 향로 (A): 6 s poison aura r 72 around her, 8 dps', () => {
  it('everyone within 72 px takes 4 every 0.5 s (8 a second), unblockable and without stagger; farther ones nothing; it follows her and ends after 6 s', () => {
    const t = cast('plague_censer', [50, 100], 20);
    const [near, far] = t.es;
    const aura = of(t, PlagueAura)[0];
    expect(aura).toBeTruthy();
    steps(t.world, 90);
    expect(near.log.length, 'about 2 ticks a second').toBeGreaterThanOrEqual(3);
    for (const i of near.log) expect([i.amount, i.kind, i.unblockable, i.hitstun, i.knockback]).toEqual([4, 'explosion', true, 0, 0]);
    for (let i = 1; i < near.times.length; i++) expect(near.times[i] - near.times[i - 1]).toBeCloseTo(PLAGUE_CENSER.interval, 1);
    expect(far.log, 'out of the 72 px').toHaveLength(0);
    // she walks: the cloud goes along and now reaches the second one
    t.p.x += 50;
    steps(t.world, 40);
    expect(far.log.length).toBeGreaterThan(0);
    for (let i = 0; i < 400 && !aura.dead; i++) steps(t.world, 1);
    expect(aura.dead).toBe(true);
    expect(t.world.time).toBeLessThan(PLAGUE_CENSER.life + 1.5);
  });
});

describe('bone_turret 뼈 포탑 (A): 10 s turret firing piercing bone shards (14 dmg)', () => {
  it('it stands 10 s, shoots a piercing shard for 14 that hits every enemy on its line; a plain turret shard stops at the first', () => {
    const t = setup();
    equip(t, 'bone_turret');
    t.input.tap('skill1');
    steps(t.world, 25);
    const turret = of(t, Turret)[0];
    expect(turret).toBeTruthy();
    expect(turret.spec).toMatchObject({ pierce: true, life: 10, interval: 0.9 });
    const [e1, e2] = [turret.x + 60, turret.x + 100].map((x) => new Dummy(x, FLOOR));
    t.world.spawn(e1);
    t.world.spawn(e2);
    steps(t.world, 70);
    expect(e1.log.length, 'the shard hits the first').toBeGreaterThan(0);
    expect(e2.log.length, 'and pierces on to the second').toBeGreaterThan(0);
    for (const i of [...e1.log, ...e2.log]) expect([i.amount, i.kind]).toEqual([14, 'ranged']);
    // the same shard from the crossbow turret stops at the first enemy
    const plain = setup();
    const pt = new Turret(plain.p.x + 30, FLOOR, plain.p, item('turret'), 14, 1);
    plain.world.spawn(pt);
    const [p1, p2] = [pt.x + 60, pt.x + 100].map((x) => new Dummy(x, FLOOR));
    plain.world.spawn(p1);
    plain.world.spawn(p2);
    steps(plain.world, 70);
    expect(p1.log.length).toBeGreaterThan(0);
    expect(p2.log, 'a plain bolt is spent on the first').toHaveLength(0);
  });

  it('it is gone after 10 s', () => {
    const t = setup();
    const turret = new Turret(200, FLOOR, t.p, item('bone_turret'), 14, 1, BONE_TURRET);
    t.world.spawn(turret);
    steps(t.world, 590);
    expect(turret.dead).toBe(false);
    steps(t.world, 20);
    expect(turret.dead).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('집행자의 대검 (S): the 3rd hit executes non-boss enemies below 25 % HP (bosses / mid-bosses take x3 instead)', () => {
  function chop(hp: number, boss = false) {
    const t = duel('executioner_blade', [30], 1000);
    t.e.hp = hp;
    t.e.isBoss = boss;
    return t;
  }
  const threeSwings = (t: Ctx) => { swing(t); swing(t); swing(t); };

  it('below 25 %: hits 1 and 2 hurt normally (42, 46), the 3rd takes everything that is left', () => {
    const t = chop(240);
    swing(t);
    swing(t);
    expect(t.e.log.map((i) => i.amount)).toEqual([42, 46]);
    expect(t.e.hp).toBe(240 - 42 - 46);
    expect(t.e.dying).toBe(false);
    swing(t);
    expect(t.e.log[2].amount, 'at least what was left').toBeGreaterThanOrEqual(240 - 42 - 46);
    expect(t.e.dying || t.e.hp <= 0, 'executed').toBe(true);
  });

  it('at or above 25 % the 3rd hit is an ordinary 54; a boss takes x3 whatever it has left', () => {
    const t = chop(1000);
    threeSwings(t);
    expect(t.e.log.map((i) => i.amount)).toEqual([42, 46, 54]);
    expect(t.e.dying).toBe(false);
    const boss = chop(900, true);
    threeSwings(boss);
    expect(boss.e.log.map((i) => i.amount)).toEqual([42, 46, 54 * 3]);
    expect(boss.e.hp, 'a boss below 25 % is not executed').toBeGreaterThan(0);
    const low = chop(200, true);
    threeSwings(low);
    expect(low.e.log[2].amount).toBe(54 * 3);
  });
});

describe('폭풍 지팡이 (S): chain lightning - up to 5 targets, -15 % per bounce, 22 base', () => {
  function storm(dxs: number[], hold = 12) {
    const t = setup();
    equip(t, 'storm_staff');
    const es = dxs.map((dx) => new Dummy(t.p.x + dx, FLOOR));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    t.input.press('attack1');
    steps(t.world, hold);
    return { ...t, es };
  }

  it('the bolt strikes the nearest enemy ahead for 22, jumps on to four more (each 15 % weaker than the one before); the sixth is spared', () => {
    const t = storm([40, 80, 120, 160, 200, 240]);
    expect(t.p.state).toBe('staff');
    const first = t.es.map((e) => e.log[0]);
    for (let i = 0; i < 5; i++) {
      expect(t.es[i].log.length, `target ${i + 1} is hit once by the first bolt`).toBe(1);
      expect(first[i].amount).toBeCloseTo(22 * Math.pow(0.85, i), 5);
      expect([first[i].kind, first[i].unblockable]).toEqual(['explosion', true]);
    }
    expect(t.es[5].log, 'a bolt reaches five targets at most').toHaveLength(0);
    expect(of(t, LightningArcs).length).toBeGreaterThan(0);
    expect(wandOf('storm_staff').bolt).toMatchObject({ damage: 22, chain: 4, falloff: 0.15 });
  });

  it('it needs a target ahead in sight: nothing behind her, past 150 px or behind a wall is struck; it keeps bolting every 0.25 s while held', () => {
    const t = storm([-40, 200], 30);
    expect(t.es.every((e) => e.log.length === 0)).toBe(true);
    const m = flatMap();
    for (let y = 8; y < 16; y++) m.set(Math.floor(160 / 24), y, T.Solid);
    const w = setup(m);
    equip(w, 'storm_staff');
    const e = new Dummy(w.p.x + 80, FLOOR);
    w.world.spawn(e);
    w.input.press('attack1');
    steps(w.world, 30);
    expect(e.log, 'a wall in between').toHaveLength(0);
    const hold = storm([60], 60);
    expect(hold.es[0].log.length, 'a bolt every 0.25 s').toBeGreaterThanOrEqual(3);
    expect(hold.es[0].log.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < hold.es[0].times.length; i++) expect(hold.es[0].times[i] - hold.es[0].times[i - 1]).toBeCloseTo(0.25, 1);
  });
});

describe('쌍월 칼날 (S): every 4th hit throws a returning glaive (boomerang, 18 dmg both ways)', () => {
  it('the swings 1-3 throw nothing, the 4th that connects throws one; it hurts an enemy on its way out and again on its way back, for 18', () => {
    const t = duel('moon_glaives', [30]);
    const far = new Dummy(t.p.x + 110, FLOOR);
    t.world.spawn(far);
    for (let i = 0; i < 3; i++) {
      swing(t);
      expect(of(t, Glaive), `after swing ${i + 1}`).toHaveLength(0);
    }
    swing(t);
    const glaive = of(t, Glaive)[0];
    expect(glaive, 'the 4th hit').toBeTruthy();
    expect(melee('moon_glaives').glaive).toMatchObject({ every: 4, damage: 18 });
    for (let i = 0; i < 200 && !glaive.dead; i++) steps(t.world, 1);
    expect(glaive.dead, 'it came back to her hand').toBe(true);
    const passes = far.log.filter((i) => i.amount === 18 && i.kind === 'ranged');
    expect(passes, 'once out, once back').toHaveLength(2);
    expect(passes[1].dir, 'the way back pushes the other way').toBe(-passes[0].dir);
    expect(far.times[far.times.length - 1] - far.times[0]).toBeGreaterThan(0.25);
  });

  it('the count starts again after a glaive (the 8th hit throws the next); a swing that hits nothing is not counted', () => {
    const t = duel('moon_glaives', [30]);
    for (let i = 0; i < 4; i++) swing(t);
    for (let i = 0; i < 200; i++) steps(t.world, 1);
    expect(of(t, Glaive)).toHaveLength(0);
    for (let i = 0; i < 3; i++) swing(t);
    expect(of(t, Glaive), '3 more hits: none yet').toHaveLength(0);
    t.e.x = t.p.x + 300;
    steps(t.world, 30);
    swing(t); // nothing in reach
    t.e.x = t.p.x + 30;
    steps(t.world, 30);
    swing(t);
    expect(of(t, Glaive), 'the 4th hit since the last glaive').toHaveLength(1);
  });
});

describe('death_orb 죽음의 구슬 (S): 8 s orb ahead of her; enemies killed within 90 px burst (20 dmg r 48) and heal her 2 %', () => {
  function orb() {
    const t = setup(flatMap(), 300);
    equip(t, 'death_orb');
    t.input.tap('skill1');
    steps(t.world, 25);
    const o = of(t, DeathOrb)[0];
    return { ...t, o };
  }

  it('the orb floats 56 px ahead of her; an enemy that dies within 90 px of it bursts: its neighbours within 48 px take 20, and she heals 2 % of max HP', () => {
    const t = orb();
    expect(t.o).toBeTruthy();
    expect(t.o.x - t.p.x).toBeCloseTo(DEATH_ORB.ahead, 0);
    const dying = new Dummy(t.o.x + 20, FLOOR, 5);
    const neighbour = new Dummy(t.o.x + 20 + 30, FLOOR);
    const outside = new Dummy(t.o.x + 20 + 90, FLOOR); // outside the burst radius
    for (const e of [dying, neighbour, outside]) t.world.spawn(e);
    steps(t.world, 1);
    t.p.hp = 50;
    dying.takeDamage({ amount: 99, dir: 1, kind: 'melee', source: t.p });
    expect(neighbour.log.map((i) => [i.amount, i.kind])).toEqual([[20, 'explosion']]);
    expect(outside.log).toHaveLength(0);
    expect(t.p.hp).toBeCloseTo(52, 5);
  });

  it('a death farther than 90 px from the orb, or after the orb has gone (8 s), does nothing; a burst that kills bursts again', () => {
    const t = orb();
    const far = new Dummy(t.o.x + 140, FLOOR, 5);
    const bystander = new Dummy(t.o.x + 140 + 30, FLOOR);
    t.world.spawn(far);
    t.world.spawn(bystander);
    steps(t.world, 1);
    far.takeDamage({ amount: 99, dir: 1, kind: 'melee', source: t.p });
    expect(bystander.log, 'too far from the orb').toHaveLength(0);
    // chain: the second enemy dies in the first one's burst, and is itself within the orb's 90 px
    const a = new Dummy(t.o.x + 10, FLOOR, 5);
    const b = new Dummy(t.o.x + 40, FLOOR, 15);
    const c = new Dummy(t.o.x + 70, FLOOR);
    for (const e of [a, b, c]) t.world.spawn(e);
    steps(t.world, 1);
    a.takeDamage({ amount: 99, dir: 1, kind: 'melee', source: t.p });
    expect(b.dying, 'killed by the burst of a').toBe(true);
    expect(c.log.map((i) => i.amount), 'a reached only b (60 px from c); the burst of b reached c').toEqual([20]);
    for (let i = 0; i < 520 && !t.o.dead; i++) steps(t.world, 1);
    expect(t.o.dead).toBe(true);
    const late = new Dummy(t.p.x + 60, FLOOR, 5);
    const near = new Dummy(t.p.x + 80, FLOOR);
    t.world.spawn(late);
    t.world.spawn(near);
    steps(t.world, 2);
    late.takeDamage({ amount: 99, dir: 1, kind: 'melee', source: t.p });
    expect(near.log).toHaveLength(0);
  });
});

describe('chain_prison 사슬 감옥 (S): chains root every enemy in r 120 for 2.5 s (no actions), 20 dmg', () => {
  it('everything within 120 px takes 20, is stunned 2.5 s and held on the spot for that long; farther enemies are free', () => {
    const t = cast('chain_prison', [60, 110, 200], 30);
    const [a, b, far] = t.es;
    const prison = of(t, ChainPrison)[0];
    expect(prison).toBeTruthy();
    for (const e of [a, b]) {
      expect(e.log.map((i) => [i.amount, i.kind, i.unblockable])).toEqual([[20, 'trap', true]]);
      expect(e.status.stun, 'stunned').toBeGreaterThan(1.5);
    }
    expect(far.log).toHaveLength(0);
    // held: a push does not move them while the chains hold
    const x0 = a.x;
    a.vx = 300;
    steps(t.world, 20);
    expect(a.x).toBe(x0);
    steps(t.world, 120);
    expect(prison.dead, 'the chains are gone after 2.5 s').toBe(true);
    a.vx = 300;
    a.physics = true;
    steps(t.world, 5);
    expect(a.status.stun, 'the stun ran out with the chains').toBeLessThanOrEqual(0.2);
  });

  it('a heavy enemy (a boss, knockbackTaken < 0.3) is hurt and stunned but not held; a kill leaves no chains', () => {
    const t = duel('chain_prison', [60, 90]);
    const [heavy, light] = t.es;
    heavy.knockbackTaken = 0;
    heavy.isBoss = true;
    light.hp = light.maxHp = 10;
    t.input.tap('skill1');
    steps(t.world, 30);
    const prison = of(t, ChainPrison)[0];
    expect(heavy.log).toHaveLength(1);
    expect(light.dying, 'the 20 killed it').toBe(true);
    expect(prison.captives.map((c) => [c.a === heavy, c.held])).toEqual([[true, false]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('여교도관의 종철퇴 (SS): slams send a floor shockwave both ways (30 dmg, jumpable), heavy knockback', () => {
  function slam(dxs: number[], map: TileMap = flatMap()) {
    const t = setup(map, 300);
    equip(t, 'matron_flail');
    const es = dxs.map((dx) => new Dummy(t.p.x + dx, FLOOR));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    return { ...t, es };
  }

  it('a slam sends two waves, one each way, along the floor: every enemy on the floor within reach is hit once for 30 with knockback 300, the one that jumped is not', () => {
    const t = slam([-150, 120, 190, 300]);
    const [left, right, edge, past] = t.es;
    const air = new Dummy(t.p.x + 100, FLOOR - 70);
    t.world.spawn(air);
    swing(t);
    steps(t.world, 80);
    for (const e of [left, right, edge]) {
      const waves = e.log.filter((i) => i.kind === 'trap');
      expect(waves.map((i) => [i.amount, i.knockback, i.unblockable]), `wave on ${e.x - t.p.x}`).toEqual([[30, 300, true]]);
    }
    expect(left.log.find((i) => i.kind === 'trap')!.dir, 'thrown to the left').toBe(-1);
    expect(right.log.find((i) => i.kind === 'trap')!.dir).toBe(1);
    expect(past.log.filter((i) => i.kind === 'trap'), 'past 200 px').toHaveLength(0);
    expect(air.log.filter((i) => i.kind === 'trap'), 'the wave runs under it').toHaveLength(0);
    expect(melee('matron_flail').quake).toMatchObject({ damage: 30, knockback: 300 });
    expect(of(t, Quake)).toHaveLength(0);
  });

  it('the hammer itself has heavy knockback; a wall or a pit stops the wave; a slam in mid-air sends none', () => {
    expect(Math.min(...melee('matron_flail').hits.map((h) => h.knockback))).toBeGreaterThan(Math.max(...melee('war_hammer').hits.map((h) => h.knockback)));
    const m = flatMap();
    for (let y = 8; y < 16; y++) m.set(Math.floor(430 / 24), y, T.Solid);
    const t = slam([100, 190], m);
    swing(t);
    steps(t.world, 80);
    expect(t.es[0].log.some((i) => i.kind === 'trap'), 'in front of the wall').toBe(true);
    expect(t.es[1].log.some((i) => i.kind === 'trap'), 'behind the wall').toBe(false);
    const pit = flatMap();
    for (let x = 17; x < 22; x++) for (const y of [16, 17]) pit.set(x, y, T.Empty);
    const u = slam([60, 190], pit);
    swing(u);
    steps(u.world, 80);
    expect(u.es[0].log.some((i) => i.kind === 'trap'), 'the near side of the pit').toBe(true);
    expect(u.es[1].log.some((i) => i.kind === 'trap'), 'the wave dies at the edge of the pit').toBe(false);
    // a slam in the air (she is still falling when the hammer comes down) sends none
    const air = slam([100]);
    air.p.y -= 220;
    air.p.onGround = false;
    air.input.tap('attack1');
    steps(air.world, 14);
    expect(air.p.onGround, 'still in the air at the moment of the slam').toBe(false);
    expect(of(air, Quake)).toHaveLength(0);
    expect(air.world.entities.some((e) => e instanceof Quake)).toBe(false);
  });
});

describe('혼불 활 (SS): full-draw arrows explode in soul fire (r 48, burn); tap shots fire 2 homing wisps', () => {
  function bow(drawSteps: number, dxs: number[], dy = 0) {
    const t = setup();
    equip(t, 'soulfire_bow');
    const es = dxs.map((dx) => new Dummy(t.p.x + dx, FLOOR + dy));
    for (const e of es) t.world.spawn(e);
    steps(t.world, 1);
    t.input.press('attack1');
    steps(t.world, drawSteps);
    t.input.release('attack1');
    steps(t.world, 1);
    return { ...t, es };
  }

  it('a full draw hits the first enemy for 48 and bursts there: enemies within 48 px take 18 and burn 3 s, farther ones nothing', () => {
    const t = bow(40, [80, 110, 200]);
    steps(t.world, 40);
    const [first, next, far] = t.es;
    expect(first.log.map((i) => i.amount).sort((a, b) => a - b)).toEqual([18, 48]);
    expect(next.log.map((i) => [i.amount, i.burn, i.kind])).toEqual([[18, 3, 'explosion']]);
    expect(next.status.burn).toBeGreaterThan(0);
    expect(far.log).toHaveLength(0);
    expect(bowOf('soulfire_bow').soulfire).toMatchObject({ radius: 48, damage: 18, burn: 3, wisps: 2 });
  });

  it('an arrow that sticks in a wall bursts too', () => {
    const m = flatMap();
    for (let y = 8; y < 16; y++) m.set(Math.floor(220 / 24), y, T.Solid);
    const t = setup(m);
    equip(t, 'soulfire_bow');
    const near = new Dummy(220 - 12 - 20, FLOOR);
    t.world.spawn(near);
    steps(t.world, 1);
    t.input.press('attack1');
    steps(t.world, 40);
    t.input.release('attack1');
    steps(t.world, 60);
    expect(near.log.map((i) => i.amount), 'the arrow flies over his head? no: it hits him first').toContain(48);
    expect(near.log.length).toBeGreaterThanOrEqual(1);
  });

  it('a tap fires 2 homing wisps instead of an arrow: they bend toward an enemy off the line and hurt it for 7 each', () => {
    const t = bow(4, [110], -45);
    expect(of(t, Arrow)).toHaveLength(0);
    const wisps = of(t, Wisp);
    expect(wisps).toHaveLength(2);
    steps(t.world, 80);
    expect(t.es[0].log.map((i) => [i.amount, i.kind])).toEqual([[7, 'ranged'], [7, 'ranged']]);
    // a wisp with nothing to chase flies straight and ends after its life
    const lone = bow(4, []);
    expect(of(lone, Wisp)).toHaveLength(2);
    steps(lone.world, 130);
    expect(of(lone, Wisp)).toHaveLength(0);
  });
});

describe('종의 방패 (SS): parry stuns every enemy within 160 px 2 s and reflects projectiles at x2 damage', () => {
  function bell() {
    const t = setup(flatMap(), 300);
    equip(t, 'bell_aegis', 1);
    const attacker = new Dummy(t.p.x + 30, FLOOR);
    attacker.facing = -1;
    const near = new Dummy(t.p.x - 120, FLOOR);
    const far = new Dummy(t.p.x + 220, FLOOR);
    for (const e of [attacker, near, far]) t.world.spawn(e);
    steps(t.world, 1);
    t.input.press('attack2');
    steps(t.world, 3);
    return { ...t, attacker, near, far };
  }

  it('a parry stuns the attacker and every enemy within 160 px (also behind her) for 2 s; the one past 160 px is free', () => {
    const t = bell();
    const r = t.p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: t.attacker });
    expect(r.parried).toBe(true);
    expect(t.attacker.status.stun).toBeGreaterThan(1.9);
    expect(t.near.status.stun).toBeGreaterThan(1.9);
    expect(t.far.status.stun).toBe(0);
    expect(shieldOf('bell_aegis')).toMatchObject({ bell: { radius: 160, stun: 2, reflectMul: 2 }, parryStun: 2 });
  });

  it('enemy arrows within 160 px are sent back with exactly twice their damage (the plain parry window reflect included); those farther fly on', () => {
    const t = bell();
    const ahead = new EnemyArrow(t.p.x + 20, t.p.y - 22, -200, 0, 10, null);
    const behind = new EnemyArrow(t.p.x - 100, t.p.y - 22, 200, 0, 6, null);
    const far = new EnemyArrow(t.p.x + 200, t.p.y - 70, -100, 0, 8, null);
    for (const e of [ahead, behind, far]) t.world.spawn(e);
    steps(t.world, 3);
    expect([ahead.reflected, ahead.damage], 'ahead of her').toEqual([true, 20]);
    expect([behind.reflected, behind.damage], 'behind her, 100 px away').toEqual([true, 12]);
    expect([far.reflected, far.damage]).toEqual([false, 8]);
    expect(ahead.team).toBe('player');
  });
});

describe('rag_doll 누더기 인형 (SS): a small rag doll (half-size golem sprite) for 10 s that slams nearby enemies', () => {
  it('a Golem at half scale appears next to her, slams the enemy in reach for 40 (stun, knockback) and does not touch the run\'s golem', () => {
    const t = setup();
    equip(t, 'rag_doll');
    const slot = (t.run.golem = { hp: 300, maxHp: 300 });
    const e = new Dummy(t.p.x + 70, FLOOR);
    t.world.spawn(e);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 30);
    const doll = of(t, Golem).find((g) => g.doll)!;
    expect(doll, 'the doll stands').toBeTruthy();
    expect([doll.scale, doll.w, doll.h]).toEqual([0.5, 15, 32]);
    steps(t.world, 90);
    expect(e.log.length, 'it slammed the enemy').toBeGreaterThan(0);
    const hit = e.log[0];
    expect([hit.amount, hit.kind, hit.stun]).toEqual([SKILL_BASE.rag_doll, 'melee', 0.6]);
    expect(t.run.golem, 'the run\'s golem is untouched').toBe(slot);
    expect(slot.hp).toBe(300);
  });

  it('it falls apart after 10 s, a second cast replaces it, and its death says nothing and clears nothing', () => {
    const t = setup();
    equip(t, 'rag_doll');
    t.run.golem = { hp: 300, maxHp: 300 };
    const toasts: string[] = [];
    t.world.on((ev) => { if (ev.type === 'toast') toasts.push(ev.text); });
    t.input.tap('skill1');
    steps(t.world, 30);
    const first = of(t, Golem).find((g) => g.doll)!;
    steps(t.world, 540); // 9.25 s after it appeared (it was cast 0.25 s into the animation)
    expect(first.dead, 'still standing a moment before its 10 s').toBe(false);
    steps(t.world, 60);
    expect(first.dead, 'gone after its life').toBe(true);
    // a new one replaces the one that stands
    t.p.skillCooldown[0] = 0;
    t.input.tap('skill1');
    steps(t.world, 30);
    const second = of(t, Golem).filter((g) => g.doll);
    expect(second).toHaveLength(1);
    t.p.skillCooldown[0] = 0;
    t.input.tap('skill1');
    steps(t.world, 30);
    expect(of(t, Golem).filter((g) => g.doll), 'still one').toHaveLength(1);
    expect(second[0].dead, 'the old one was replaced').toBe(true);
    // an enemy kills the doll: no golem toast, run.golem stays
    const doll = of(t, Golem).find((g) => g.doll)!;
    doll.takeDamage({ amount: 9999, dir: 1, kind: 'melee' });
    steps(t.world, 90);
    expect(toasts).not.toContain('골렘이 쓰러졌다');
    expect(t.run.golem).not.toBeNull();
  });
});

describe('crimson_rain 핏빛 비 (SS): 2 s rain of blood needles over 160 px ahead, 5 dmg / hit, bleed', () => {
  it('every enemy under the rain takes 5 every 0.1 s for 2 s and bleeds; behind her and past 160 px nothing', () => {
    const t = cast('crimson_rain', [60, 150, 230, -60], 20);
    const [a, b, far, behind] = t.es;
    expect(of(t, NeedleRain)).toHaveLength(1);
    steps(t.world, 140);
    for (const e of [a, b]) {
      expect(e.log.length, 'about 20 volleys').toBeGreaterThanOrEqual(17);
      expect(e.log.length).toBeLessThanOrEqual(21);
      for (const i of e.log) expect([i.amount, i.bleed, i.kind, i.unblockable]).toEqual([5, 2, 'trap', true]);
      expect(e.status.bleedStacks, 'stacks up').toBe(AFFIX.bleedStacks);
    }
    expect(far.log).toHaveLength(0);
    expect(behind.log).toHaveLength(0);
    expect(of(t, NeedleRain), 'it ends after 2 s').toHaveLength(0);
    expect(a.times[a.times.length - 1] - a.times[0]).toBeGreaterThan(1.7);
    expect(a.times[a.times.length - 1] - a.times[0]).toBeLessThan(2.1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('셀마의 대가위 (SSS): every hit bleeds x2 stacks; crit vs bleeding; kills drop +1 corpse piece', () => {
  it('the first hit leaves 2 bleed stacks (and no crit), the next hit on the bleeding target crits', () => {
    const t = duel('selma_shears', [30]);
    swing(t);
    expect(t.e.log[0].crit).toBeFalsy();
    expect([t.e.log[0].bleed, t.e.status.bleedStacks]).toEqual([4, 2]);
    swing(t);
    expect(t.e.log[1].crit).toBe(true);
    expect(t.e.log[1].amount).toBe(48 * CRIT_MULT);
    expect(t.e.status.bleedStacks, '2 per hit, at most 5').toBeGreaterThanOrEqual(4);
    swing(t);
    expect(t.e.status.bleedStacks).toBe(AFFIX.bleedStacks);
    expect(melee('selma_shears')).toMatchObject({ bleedStacks: 2, critBleeding: true, killPieces: 1 });
  });

  it('a kill with the shears drops one more piece than another weapon would; a kill with the rusty sword drops none (a bare dummy)', () => {
    const piecesAfter = (id: ItemId): number => {
      const t = duel(id, [30], 10);
      swing(t);
      steps(t.world, 5);
      return t.world.entities.filter((e) => e.constructor.name === 'Coin' && (e as unknown as { kind: string }).kind === 'piece').reduce((n, e) => n + (e as unknown as { value: number }).value, 0);
    };
    expect(piecesAfter('rusty_sword')).toBe(0);
    expect(piecesAfter('selma_shears')).toBe(1);
  });
});

describe('신더의 불씨검 (SSS): x1.5 damage at full HP; 30 % of hits release a seeking ember (15 dmg)', () => {
  it('at full HP the first hit does x1.5 (22 -> 33); one HP short of full it is plain', () => {
    const t = duel('ember_blade', [30]);
    swing(t);
    expect(t.e.log[0].amount).toBeCloseTo(22 * 1.5, 5);
    const u = duel('ember_blade', [30]);
    u.p.hp = 99;
    swing(u);
    expect(u.e.log[0].amount).toBe(22);
    expect(melee('ember_blade')).toMatchObject({ fullHpMul: 1.5, ember: { chance: 0.3, damage: 15 } });
  });

  it('a hit that rolls the 30 % releases an ember that seeks ANOTHER enemy and hurts it for 15; a hit that does not roll releases none', () => {
    const t = duel('ember_blade', [30, 250]);
    const [near, far] = t.es;
    t.world.rng.chance = () => false;
    swing(t);
    expect(of(t, Wisp)).toHaveLength(0);
    t.world.rng.chance = () => true;
    t.p.hp = 99;
    steps(t.world, 30);
    swing(t);
    expect(of(t, Wisp), 'one ember per hit that rolled').toHaveLength(1);
    steps(t.world, 150);
    expect(far.log.map((i) => [i.amount, i.kind]), 'it flew to the far one, not back into the near one').toEqual([[15, 'ranged']]);
    expect(near.log.filter((i) => i.amount === 15)).toHaveLength(0);
  });

  it('the chance is the table chance (a roll over many hits lands near 30 %)', () => {
    const t = duel('ember_blade', [30]);
    let rolled = 0;
    const real = t.world.rng.chance.bind(t.world.rng);
    t.world.rng.chance = (p: number) => { const r = real(p); if (r) rolled++; expect(p).toBe(0.3); return r; };
    for (let i = 0; i < 18; i++) swing(t);
    expect(rolled).toBeGreaterThan(0);
    expect(rolled).toBeLessThan(14);
  });
});

describe('아홉 꼬리 채찍 (SSS): each lash hits 3 times in a cone (each hit once per lash), tip crits, pulls', () => {
  it('a target in reach is hit three times by one lash (7 each), and the lash does not hit it a fourth time; the second lash again 3 x 8', () => {
    const t = duel('ninefold_whip', [40]);
    swing(t);
    expect(t.e.log.map((i) => i.amount), 'three landings').toEqual([7, 7, 7]);
    expect(t.e.log.every((i) => !i.crit), 'close to her: no tip').toBe(true);
    swing(t);
    expect(t.e.log.map((i) => i.amount)).toEqual([7, 7, 7, 8, 8, 8]);
    expect(melee('ninefold_whip').hits.map((h) => h.multi)).toEqual([{ n: 3, gap: 0.04, spread: 14 }, { n: 3, gap: 0.04, spread: 14 }]);
  });

  it('a target in the tip takes crits (each landing) and is pulled 30 px toward her; a lash past its reach hits nothing', () => {
    const t = duel('ninefold_whip', [105]);
    const x0 = t.e.x;
    swing(t);
    expect(t.e.log.length).toBeGreaterThanOrEqual(1);
    expect(t.e.log[0]).toMatchObject({ amount: 14, crit: true });
    expect(x0 - t.e.x, 'pulled (once per tip landing, 30 px each, it stays out of her body)').toBeGreaterThanOrEqual(30);
    const far = duel('ninefold_whip', [140]);
    swing(far);
    expect(far.e.log).toHaveLength(0);
  });

  it('the three boxes fan out: an enemy high above the line is reached by only some of the landings', () => {
    const t = duel('ninefold_whip', [60]);
    t.e.y = FLOOR - 40; // feet 40 px up: only the upper box reaches his body
    swing(t);
    const n = t.e.log.length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(3);
  });
});

describe('last_bell 마지막 종 (SSS): every enemy on screen takes 120 dmg + stun 2 s (bosses / mid-bosses: 40 dmg, no stun); cd 40', () => {
  it('everyone in the view is hit for 120 and stunned 2 s; a boss takes 40 and no stun; an enemy off the screen is untouched', () => {
    const t = duel('last_bell', [60, 300, 400]);
    const [a, b, boss] = t.es;
    boss.isBoss = true;
    const off = new Dummy(900, FLOOR); // the camera of the test world shows x 0..640
    t.world.spawn(off);
    t.input.tap('skill1');
    steps(t.world, 45);
    for (const e of [a, b]) {
      expect([e.log[0].amount, e.log[0].stun, e.log[0].kind]).toEqual([120, 2, 'explosion']);
      expect(e.status.stun).toBeGreaterThan(1.5);
    }
    expect(boss.log.map((i) => [i.amount, i.stun])).toEqual([[40, undefined]]);
    expect(boss.status.stun).toBe(0);
    expect(off.log).toHaveLength(0);
    expect(t.p.skillCooldownMax[0]).toBe(40);
    expect(t.sounds).toContain('bell');
  });

  it('it kills what 120 kills, and the real bosses are marked: the Matron, the mid-bosses (and no common enemy)', () => {
    const t = duel('last_bell', [60]);
    t.e.hp = 100;
    t.input.tap('skill1');
    steps(t.world, 40);
    expect(t.e.dying || t.e.hp <= 0).toBe(true);
    expect(new Matron(0, 0).isBoss).toBe(true);
    expect(createMiniBoss('mb_abbess', 0, 0).isBoss).toBe(true);
    expect(createEnemy('ghoul', 0, 0, { tier: 1 }).isBoss).toBe(false);
  });
});

describe('requiem 진혼곡 (SSS): 6 s, each kill refunds 30 % of the other skill\'s cooldown and starts the frenzy sprint; hits heal 1 %', () => {
  function song() {
    const t = setup();
    equip(t, 'requiem', 0);
    equip(t, 'last_bell', 1);
    const weak = new Dummy(t.p.x + 30, FLOOR, 3);
    const tank = new Dummy(t.p.x + 30, FLOOR);
    t.world.spawn(tank);
    t.world.spawn(weak);
    steps(t.world, 1);
    t.input.tap('skill1');
    steps(t.world, 30);
    return { ...t, weak, tank };
  }

  it('a kill during the song gives back 30 % of the other skill\'s cooldown (12 of 40 s) and starts the frenzy; hits heal 1 % of max HP', () => {
    const t = song();
    expect(t.p.requiemT).toBeGreaterThan(5);
    t.p.skillCooldown[1] = 40;
    t.p.skillCooldownMax[1] = 40;
    t.p.hp = 50;
    expect(t.p.frenzyT).toBe(0);
    swing(t);
    expect(t.weak.dying, 'the sword killed it').toBe(true);
    expect(t.p.skillCooldown[1], '40 - 30 % of 40 (a few frames of the swing have run since)').toBeLessThanOrEqual(28);
    expect(t.p.skillCooldown[1]).toBeGreaterThan(27);
    expect(t.p.frenzyT, 'the frenzy sprint').toBeGreaterThan(0);
    expect(t.p.hp, 'a hit heals 1 % of 100').toBeGreaterThan(50.9);
    // (the requiem slot itself is not refunded)
    expect(t.p.skillCooldown[0]).toBeGreaterThan(20);
  });

  it('kills before the song or after its 6 s refund nothing and heal nothing', () => {
    const before = duel('rusty_sword', [30], 3);
    before.run.skills = [item('requiem'), item('last_bell')];
    steps(before.world, 3);
    before.p.skillCooldown[1] = 40;
    swing(before);
    expect(before.p.skillCooldown[1]).toBeGreaterThan(39);
    expect(before.p.frenzyT).toBe(0);
    const t = song();
    steps(t.world, 6 * 60);
    expect(t.p.requiemT).toBe(0);
    t.p.skillCooldown[1] = 40;
    t.p.hp = 50;
    swing(t);
    expect(t.p.skillCooldown[1]).toBeGreaterThan(39);
    expect(t.p.hp).toBe(50);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('every unique of A to SSS can be picked up, held and used once', () => {
  it('a weapon swings / draws / blocks / casts, a skill starts its cooldown; nothing throws, in either slot, with a tier', () => {
    for (const id of [...WEAPON_IDS, ...SKILL_IDS]) {
      const t = setup();
      equip(t, id, ITEMS[id].slot === 'skill' ? 1 : 0, 3);
      const e = new Dummy(t.p.x + 50, FLOOR);
      e.facing = -1;
      t.world.spawn(e);
      const key = ITEMS[id].slot === 'skill' ? 'skill2' : 'attack1';
      t.input.press(key);
      const states = new Set<string>();
      for (let i = 0; i < 90; i++) {
        steps(t.world, 1);
        states.add(t.p.state);
        if (i === 12) t.input.release(key);
      }
      if (ITEMS[id].slot === 'skill') expect(t.p.skillCooldown[1], id).toBeGreaterThan(0);
      else expect([...states].some((st) => st !== 'idle' && st !== 'run'), `${id} states ${[...states]}`).toBe(true);
      expect(t.p.hp, id).toBe(100);
    }
  });
});
