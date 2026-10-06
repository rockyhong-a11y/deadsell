import { test, expect, type Page } from '@playwright/test';
import { boot, startRun, shot, saved } from './helpers';

/**
 * The 20 unique items of grades A to SSS (docs/CONTENT4.md §5.3) in the real game (Chromium, real asset loading + real render loop, sound ON so
 * audio errors surface): the six grades are crafted one after the other through the debug hooks (stashAdd / bank / shards / craft), equipped from
 * the stash and used on three ghouls; then every new unique is held and used once with `__ds.give`, so every entity they put on the screen has been
 * drawn. Screenshots for a human to look at go to e2e/__shots__/ (`50_unique_*`, `51_unique_*`).
 */
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
test.setTimeout(240_000);

/** the stash operations of the game, imported into the page (the dev server serves the sources) */
const STASH_MODULE = '/src/game/meta/stash.ts';

const equipped = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).__ds.game.run;
    const id = (i: any) => (i ? { id: i.id as string, tier: i.tier as number } : null);
    return { weapons: r.weapons.map(id), skills: r.skills.map(id) };
  });

/** the weapons: the player states each passes through and the entities it puts on the screen (any of them) */
const WEAPONS: Record<string, { states: string[]; spawns?: string[]; sure?: boolean }> = {
  grave_bell: { states: ['attack'] },
  leech_whip: { states: ['attack'] },
  bone_rampart: { states: ['block'] },
  executioner_blade: { states: ['attack'] },
  storm_staff: { states: ['staff'], spawns: ['LightningArcs'] },
  moon_glaives: { states: ['attack'], spawns: ['Glaive'] },
  matron_flail: { states: ['attack'], spawns: ['Quake'] },
  soulfire_bow: { states: ['bow'], spawns: ['Arrow'] },
  bell_aegis: { states: ['block'] },
  selma_shears: { states: ['attack'] },
  ember_blade: { states: ['attack'], spawns: ['Wisp'], sure: true },
  ninefold_whip: { states: ['attack'] },
};
/** the skills: the entity each leaves on the screen (null: none) and whether it hurts the ghouls */
const SKILLS: Record<string, { spawns: string | null; hurts: boolean }> = {
  plague_censer: { spawns: 'PlagueAura', hurts: true },
  bone_turret: { spawns: 'Turret', hurts: true },
  death_orb: { spawns: 'DeathOrb', hurts: false },
  chain_prison: { spawns: 'ChainPrison', hurts: true },
  rag_doll: { spawns: 'Golem', hurts: true },
  crimson_rain: { spawns: 'NeedleRain', hurts: true },
  last_bell: { spawns: 'GreatBell', hurts: true },
  requiem: { spawns: null, hurts: false },
};
/** what a use leaves behind (cleared before the next item) */
const LEFTOVERS = [
  'Arrow', 'Grenade', 'Glow', 'Turret', 'Wisp', 'Glaive', 'Quake', 'LightningArcs', 'PlagueAura', 'DeathOrb', 'ChainPrison', 'NeedleRain', 'GreatBell', 'Golem',
];

/**
 * Back to `home`, clean up, equip `id` in slot 0 and put three ghouls in front of her; `window.__look()` records what happens from now on.
 * While `window.__calm` is set the ghouls are kept stunned, so a blow they land cannot cancel what she is doing (a draw, a cast, a block).
 */
function prepareUse(page: Page, id: string, home: { x: number; y: number }) {
  return page.evaluate(([uid, hx, hy, leftovers]) => {
    const ds = (window as any).__ds;
    const w = ds.world, p = w.player;
    for (const e of w.entities) if ((leftovers as string[]).includes(e.constructor.name)) e.dead = true;
    ds.killAll();
    ds.teleport(hx, hy);
    ds.step(2);
    p.hp = p.maxHp;
    p.facing = 1;
    p.requiemT = 0;
    ds.give(uid, 0);
    ds.step(2);
    (window as any).__calm = true;
    const foes = ((window as any).__foes = [40, 70, 100].map((dx) => ds.spawn('ghoul', dx)));
    for (const e of foes) e.status.stun = 1.5;
    const seen = ((window as any).__seen = { classes: [] as string[], states: [] as string[], dolls: 0 });
    // (the last blow of the item before froze the world for a moment: a tap pressed into it would have run out of its buffer)
    for (let f = 0; f < 40 && w.hitstop > 0; f++) ds.step(1);
    ds.step(2);
    (window as any).__look = () => {
      for (const e of w.entities) {
        if (e.dead) continue;
        if (!seen.classes.includes(e.constructor.name)) seen.classes.push(e.constructor.name);
        if (e.constructor.name === 'Golem' && e.doll) seen.dolls++;
      }
      if (!seen.states.includes(p.state)) seen.states.push(p.state);
      if ((window as any).__calm) for (const e of foes) e.status.stun = Math.max(e.status.stun, 1);
    };
  }, [id, home.x, home.y, LEFTOVERS] as const);
}
/** How the three ghouls fared and what was seen; the ghouls are removed afterwards. */
const useResult = (page: Page) =>
  page.evaluate(() => {
    const ds = (window as any).__ds;
    const p = ds.world.player;
    const foes = (window as any).__foes as any[];
    const hurt = foes.filter((e) => e.dead || e.dying || e.hp < e.maxHp).length;
    for (const e of foes) e.dead = true;
    return { ...((window as any).__seen as { classes: string[]; states: string[]; dolls: number }), hurt, cooldown: p.skillCooldown[0] as number, requiem: p.requiemT as number };
  });

test('craft one unique of each grade (C B A S SS SSS) with the debug hooks, equip it from the stash and use it: no console errors', async ({ page }) => {
  const c = await boot(page, { query: '?seed=6&god=1' });
  await startRun(page, 6);
  const home = await page.evaluate(() => { const p = (window as any).__ds.player; return { x: p.x as number, y: p.y as number }; });

  type Add = [id: string, tier?: number, affix?: string | null, mb?: boolean];
  /** the materials of a recipe, the shards and the bank pieces, then the craft */
  const craft = async (grade: string, id: string, items: Add[], bank: number, shards: number[]) => {
    const r = await page.evaluate(([g, uid, adds, pieces, loops]) => {
      const ds = (window as any).__ds;
      for (const a of adds as any[]) if (!ds.stashAdd(a[0], a[1] ?? 1, a[2] ?? null, a[3] ?? false)) return { ok: false, reason: 'stash full' };
      ds.bank(pieces);
      ds.shards(...(loops as number[]));
      return ds.craft(g, uid);
    }, [grade, id, items, bank, shards] as const);
    expect(r, `${grade}: ${id} is crafted`).toMatchObject({ ok: true });
    return r as { ok: true; item: { id: string; tier: number; affix: null } };
  };
  /** equip the crafted unique from the stash (the real stash operation) into slot 0 and use it for a moment on three ghouls */
  const equipAndUse = async (id: string, tier: number) => {
    const idx = await page.evaluate(async ([uid, mod]) => {
      const ds = (window as any).__ds;
      const { equipFromStash } = await import(/* @vite-ignore */ mod);
      const i = ds.game.save.stash.findIndex((e: any) => e.id === uid);
      return i >= 0 && equipFromStash(ds.game.run, ds.game.save, i, 0) ? i : -1;
    }, [id, STASH_MODULE]);
    expect(idx, `${id} is in the stash and goes into slot 0`).toBeGreaterThanOrEqual(0);
    const slot = (await equipped(page));
    const kind = (await page.evaluate((uid) => (window as any).__ds.game.run.skills[0]?.id === uid, id)) ? 'skills' : 'weapons';
    expect(slot[kind as 'skills' | 'weapons'][0], `${id} equipped with the crafted tier`).toEqual({ id, tier });
    await page.evaluate(([hx, hy]) => {
      const ds = (window as any).__ds;
      ds.killAll();
      ds.teleport(hx, hy);
      ds.step(2);
      const p = ds.player;
      p.hp = p.maxHp;
      p.facing = 1;
      (window as any).__foes = [40, 70, 100].map((dx) => ds.spawn('ghoul', dx));
      for (const e of (window as any).__foes) e.status.stun = 1.5;
      ds.step(2);
    }, [home.x, home.y]);
    if (kind === 'skills') await page.evaluate(() => { const ds = (window as any).__ds; ds.world.input.tap('skill1'); ds.step(40); });
    else await page.evaluate(() => { const ds = (window as any).__ds; ds.world.input.press('attack1'); ds.step(50); ds.world.input.release('attack1'); ds.step(30); });
    await page.waitForTimeout(100);
    // then it is put away again (the real operation): the stash keeps it as a material for the next recipe
    return page.evaluate(async ([k, mod]) => {
      const ds = (window as any).__ds;
      const foes = (window as any).__foes as any[];
      const hurt = foes.filter((e) => e.dead || e.dying || e.hp < e.maxHp).length;
      const out = { hurt, cooldown: ds.player.skillCooldown[0] as number, state: ds.player.state as string };
      const { depositEquipped } = await import(/* @vite-ignore */ mod);
      depositEquipped(ds.game.run, ds.game.save, k === 'skills' ? 'skill' : 'weapon', 0);
      ds.game.persist();
      return { ...out, away: ds.game.run[k === 'skills' ? 'skills' : 'weapons'][0] === null };
    }, [kind, STASH_MODULE]);
  };
  const stashIds = () => page.evaluate(() => (window as any).__ds.stash().map((e: any) => e.id as string));

  // C: any 3 items + 10 pieces -> tier 1
  let r = await craft('C', 'bone_cleaver', [['rusty_sword'], ['spear'], ['war_hammer']], 10, []);
  expect(r.item.tier).toBe(1);
  expect((await equipAndUse('bone_cleaver', 1)).hurt, 'the cleaver hurts').toBeGreaterThan(0);

  // B: 3 items with an affix + 20 -> tier 2
  r = await craft('B', 'reaper_scythe', [['rusty_sword', 1, 'burn'], ['spear', 1, 'bleed'], ['twin_daggers', 1, 'dmg']], 20, []);
  expect(r.item.tier).toBe(2);
  expect((await equipAndUse('reaper_scythe', 2)).hurt).toBeGreaterThan(0);

  // A: 2 items of tier >= 2 + 1 mid-boss item + 35 -> tier 2 (three of them: one is used up by the S, one by the SS, one by the second S)
  const A = (id: string) => craft('A', id, [['spear', 2], ['war_hammer', 2], ['rusty_sword', 1, null, true]], 35, []);
  r = await A('grave_bell');
  expect(r.item.tier).toBe(2);
  let use = await equipAndUse('grave_bell', 2);
  expect(use.hurt, '장례 종 hurts').toBeGreaterThan(0);
  await A('plague_censer');
  use = await equipAndUse('plague_censer', 2);
  expect(use.cooldown, '역병 향로 started its cooldown').toBeGreaterThan(0);
  await A('bone_turret');

  const aUniques = async () => (await stashIds()).filter((id: string) => ['grave_bell', 'plague_censer', 'bone_turret'].includes(id));
  expect(await aUniques(), 'the three A uniques are in the stash').toHaveLength(3);

  // S: one A unique + 2 mid-boss items + 1 bell shard (any loop) + 50 -> tier 3
  const S = (id: string) => craft('S', id, [['spear', 1, null, true], ['war_hammer', 1, null, true]], 50, [1]);
  r = await S('executioner_blade');
  expect(r.item.tier).toBe(3);
  expect(await aUniques(), 'one of the three A uniques was used up').toHaveLength(2);
  use = await equipAndUse('executioner_blade', 3);
  expect(use.hurt, '집행자의 대검 hurts').toBeGreaterThan(0);
  await S('chain_prison');

  // SS: one S unique + one A unique + 2 shards of loop >= 2 + 80 -> tier 3
  r = await craft('SS', 'matron_flail', [], 80, [2, 2]);
  expect(r.item.tier).toBe(3);
  use = await equipAndUse('matron_flail', 3);
  expect(use.hurt, '여교도관의 종철퇴 hurts').toBeGreaterThan(0);

  // SSS: one SS unique + one S unique + 3 shards of loop >= 3 + 120 -> tier 4
  r = await craft('SSS', 'selma_shears', [], 120, [3, 3, 3]);
  expect(r.item.tier).toBe(4);
  use = await equipAndUse('selma_shears', 4);
  expect(use.hurt, '셀마의 대가위 hurts').toBeGreaterThan(0);
  expect(use.away, 'and was put back into the stash').toBe(true);
  await shot(page, '50_unique_crafted_selma_shears');

  // what is left in the stash and the bank is what the recipes did not take; the save has it all
  const s = await saved(page);
  expect(s.stash.every((e: any) => typeof e.id === 'string' && e.tier >= 1)).toBe(true);
  expect(s.stash.find((e: any) => e.id === 'selma_shears'), 'the SSS unique is in the saved stash with its tier').toMatchObject({ id: 'selma_shears', tier: 4, affix: null });
  expect(s.shards, 'every shard of the last recipe was used').toEqual([]);
  expect(await page.evaluate(() => (window as any).__ds.craft('SSS', 'selma_shears').reason), 'a recipe without its materials is refused').toBe('materials');
  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('every unique of grades A to SSS can be equipped (__ds.give) and used once in the real game: its entities draw, no console errors', async ({ page }) => {
  const c = await boot(page, { query: '?seed=4&god=1' });
  await startRun(page, 4);
  const home = await page.evaluate(() => { const p = (window as any).__ds.player; return { x: p.x as number, y: p.y as number }; });

  for (const [id, want] of Object.entries(WEAPONS)) {
    await prepareUse(page, id, home);
    // (the ember is a 30 % chance of a hit: this once every hit rolls it, so the test does not depend on luck)
    if (want.sure) await page.evaluate(() => { const r = (window as any).__ds.world.rng; (window as any).__chance = r.chance; r.chance = () => true; });
    // hold the attack for a second and a half (chains the combo, draws the bow, blocks, calls lightning) with real frames in between
    await page.evaluate(() => {
      const ds = (window as any).__ds;
      ds.world.input.press('attack1');
      for (let f = 0; f < 70; f++) { ds.step(1); (window as any).__look(); }
    });
    await page.waitForTimeout(80);
    await shot(page, `50_unique_${id}`);
    await page.evaluate(() => {
      const ds = (window as any).__ds;
      ds.world.input.release('attack1');
      for (let f = 0; f < 45; f++) { ds.step(1); (window as any).__look(); }
    });
    // (the bow: a quick tap too, for the wisps)
    if (id === 'soulfire_bow') {
      await page.evaluate(() => {
        const ds = (window as any).__ds;
        ds.world.input.tap('attack1');
        for (let f = 0; f < 6; f++) { ds.step(1); (window as any).__look(); }
      });
      await page.waitForTimeout(60);
      await shot(page, '50_unique_soulfire_bow_wisps');
      await page.evaluate(() => { const ds = (window as any).__ds; for (let f = 0; f < 60; f++) { ds.step(1); (window as any).__look(); } });
    }
    await page.waitForTimeout(60);
    if (want.sure) await page.evaluate(() => { (window as any).__ds.world.rng.chance = (window as any).__chance; });
    const r = await useResult(page);
    expect((await equipped(page)).weapons[0]?.id, `${id} is in the first weapon slot`).toBe(id);
    for (const st of want.states) expect(r.states, `${id} passes through the ${st} state (saw ${r.states})`).toContain(st);
    if (want.spawns) for (const cls of want.spawns) expect(r.classes, `${id} puts a ${cls} on the screen (saw ${r.classes})`).toContain(cls);
    // (the shields only answer a blow; every other weapon reaches the ghouls in front of her)
    if (!['bone_rampart', 'bell_aegis'].includes(id)) expect(r.hurt, `${id} hurt a ghoul`).toBeGreaterThan(0);
  }

  for (const [id, want] of Object.entries(SKILLS)) {
    await prepareUse(page, id, home);
    await page.evaluate((key) => {
      const ds = (window as any).__ds;
      ds.world.input.tap('skill1');
      // until the thing it leaves on the screen exists, then a few frames more
      for (let f = 0; f < 120; f++) {
        ds.step(1);
        (window as any).__look();
        if (key ? ((window as any).__seen.classes as string[]).includes(key) : f >= 30) break;
      }
      for (let f = 0; f < 10; f++) { ds.step(1); (window as any).__look(); }
      (window as any).__calm = false; // now they may fight back
    }, want.spawns);
    await page.waitForTimeout(100); // real frames draw the effect
    await shot(page, `51_unique_${id}`);
    await page.evaluate(() => {
      const ds = (window as any).__ds;
      for (let f = 0; f < 200; f++) { ds.step(1); (window as any).__look(); }
    });
    const r = await useResult(page);
    expect((await equipped(page)).skills[0]?.id, `${id} is in the first skill slot`).toBe(id);
    if (want.spawns) expect(r.classes, `${id} puts a ${want.spawns} on the screen (cooldown ${r.cooldown})`).toContain(want.spawns);
    expect(r.cooldown, `${id} started its cooldown`).toBeGreaterThan(0);
    if (want.hurts) expect(r.hurt, `${id} hurt a ghoul`).toBeGreaterThan(0);
    if (id === 'rag_doll') expect(r.dolls, 'the doll stood on the screen').toBeGreaterThan(0);
  }
  expect(c.errors, 'no console / page errors').toEqual([]);
});
