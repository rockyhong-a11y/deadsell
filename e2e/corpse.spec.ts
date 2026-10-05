import { test, expect, type Page } from '@playwright/test';
import { SAVE_KEY, boot, waitScene, sceneName, entitiesOf, teleportNear } from './helpers';

/**
 * docs/CONTENT3.md in the real game (Chromium, real asset loading + real render loop, sound ON so audio errors surface):
 * kills drop corpse pieces that fly to the heroine and show in the HUD; Selma sews them into the body in the 쉼터; the 시체 상점
 * sells with pieces; the golem pile builds a golem that follows into the next level; a body made whole clears the loop
 * (loop-clear scene -> title shows the next 회차); dying loses carried pieces. The debug hooks (__ds) set the scene up.
 * Screenshots for a human to look at go to e2e/__shots__/.
 */
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
test.setTimeout(180_000);

/** the ten unique items of docs/CONTENT3.md §5 (the 시체 상점 sells only these) */
const UNIQUES = ['bone_cleaver', 'reaper_scythe', 'stitch_needle', 'widow_fangs', 'coffin_lid', 'marrow_bow', 'corpse_bomb', 'bone_spikes', 'soul_lantern', 'chain_hook'];

/** the unique skills (the others are weapons) */
const ITEM_SLOT_SKILL = ['corpse_bomb', 'bone_spikes', 'soul_lantern', 'chain_hook'];

const SHOTS = 'e2e/__shots__/';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}.png` });

async function startRun(page: Page, seed: number) {
  // wait for the NEW scene (the old one may still be up while the fade runs)
  await page.evaluate((s) => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.start(s); }, seed);
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene !== (window as any).__prev && d.game.scene?.constructor?.name === 'LevelScene' && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
}
async function toLevel(page: Page, name: string) {
  await page.evaluate((n) => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.gotoLevel(n); }, name);
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene !== (window as any).__prev && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
}

const run = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).__ds.game.run;
    return { pieces: r.pieces as number, sewn: r.piecesSewn as number, golem: r.golem as { hp: number; maxHp: number } | null, kind: r.level.kind as string, loop: r.loop as number };
  });
const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
const hudPieces = (page: Page) => page.evaluate(() => (window as any).__ds.game.scene.ui.hud.lastPieces as number);

/** Record every string the game draws with fillText, so tests can read the canvas UI. */
async function recordText(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__texts) return;
    w.__texts = [] as string[];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s: string, ...a: any[]) {
      w.__texts.push(String(s));
      return (orig as any).call(this, s, ...a);
    };
  });
}
/** the strings drawn since the last `clearText` */
const drawn = (page: Page) => page.evaluate(() => [...((window as any).__texts as string[])]);
const clearText = (page: Page) => page.evaluate(() => { ((window as any).__texts as string[]).length = 0; });

/** Stand next to an entity of a class, wait for its prompt, press the interact key. */
async function interact(page: Page, cls: string, pick = 0) {
  const e = (await entitiesOf(page, cls))[pick];
  expect(e, `a ${cls} exists`).toBeTruthy();
  await teleportNear(page, e.x - 8, e.y - 2, 25);
  await expect.poll(() => page.evaluate(() => (window as any).__ds.player.nearInteract?.constructor.name ?? null), { timeout: 5_000, message: `prompt for ${cls}` }).toBe(cls);
  await page.keyboard.press('KeyF');
}

test('kills drop pieces, Selma sews them, the shop sells, the golem follows into the next level', async ({ page }) => {
  const c = await boot(page, { query: '?seed=3&god=1' });
  await recordText(page);
  await startRun(page, 3);

  await test.step('kills drop pieces that fly to the heroine and the HUD counter rises', async () => {
    expect((await run(page)).pieces).toBe(0);
    // three ordinary enemies, killed on the spot: 1 piece each
    await page.evaluate(() => {
      const ds = (window as any).__ds;
      const es = [ds.spawn('ghoul', 50), ds.spawn('archer', -50), ds.spawn('bomber', 80)];
      ds.step(2);
      for (const e of es) e.takeDamage({ amount: 99999, dir: 1, kind: 'melee' });
      ds.step(150);
    });
    expect((await run(page)).pieces).toBe(3);
    expect(await hudPieces(page)).toBe(3);
    // a real kill with real attacks: a ghoul right in front of her
    const before = (await run(page)).pieces;
    const dead = await page.evaluate(() => {
      const ds = (window as any).__ds, w = ds.world, inp = w.input;
      const e = ds.spawn('ghoul', 34);
      ds.step(2);
      for (let f = 0; f < 400 && !e.dead && !e.dying; f++) { if (f % 14 === 0) inp.tap('attack1'); ds.step(1); }
      ds.step(150);
      return e.dead || e.dying;
    });
    expect(dead, 'the ghoul died to real attacks').toBe(true);
    expect((await run(page)).pieces).toBe(before + 1);
    await page.waitForTimeout(400);
    await shot(page, '01_hud_pieces');
    // the aggregated toast
    const texts = await drawn(page);
    expect(texts.some((t) => /^\+\d+ 조각$/.test(t)), '+N 조각 toast').toBe(true);
  });

  await test.step('the 쉼터: Selma, three pedestals, the golem pile', async () => {
    await toLevel(page, 'passage');
    expect((await run(page)).kind).toBe('passage');
    expect((await run(page)).pieces).toBe(4); // carried through the level change
    const names = await page.evaluate(() => (window as any).__ds.world.entities.map((e: any) => e.constructor.name));
    for (const n of ['Seamstress', 'GolemPile', 'Alchemist', 'Fountain', 'ExitDoor']) expect(names, n).toContain(n);
    expect(names.filter((n: string) => n === 'CorpseShopItem')).toHaveLength(3);
    await page.waitForTimeout(1200);
    await shot(page, '02_rest_stop');
    for (const [cls, name] of [['Seamstress', '03_selma'], ['CorpseShopItem', '04_corpse_shop'], ['GolemPile', '05_golem_pile']] as const) {
      const e = (await entitiesOf(page, cls))[cls === 'CorpseShopItem' ? 1 : 0];
      await teleportNear(page, e.x - 40, e.y - 2, 25);
      await page.waitForTimeout(700);
      await shot(page, name);
    }
  });

  await test.step('Selma: nothing carried she talks; carrying pieces she sews them into the body (saved at once)', async () => {
    await page.evaluate(() => (window as any).__ds.pieces(0));
    await clearText(page);
    await interact(page, 'Seamstress');
    await page.waitForTimeout(300);
    expect(await drawn(page)).toEqual(expect.arrayContaining(['대화']));
    expect((await saved(page)).body).toBe(0);

    await page.evaluate(() => { const ds = (window as any).__ds; ds.pieces(37); ds.step(20); });
    await clearText(page);
    await interact(page, 'Seamstress');
    await page.waitForTimeout(400);
    const texts = await drawn(page);
    expect(texts.some((t) => t === '몸 꿰매기 · 37조각'), 'the prompt before sewing').toBe(true);
    expect(texts.some((t) => t === '시체 조각 37개를 꿰맸다 · 몸 37/100'), 'the toast').toBe(true);
    const r = await run(page);
    expect(r.pieces).toBe(0);
    expect(r.sewn).toBe(37);
    expect((await saved(page)).body).toBe(37);
    await shot(page, '06_sewn');
  });

  await test.step('시체 상점: three distinct uniques; one is bought with pieces, picked up, equipped and used once', async () => {
    const stock: { id?: string; price: number; sold: boolean; affix: string | null }[] = await page.evaluate(() =>
      (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'CorpseShopItem').map((p: any) => ({ id: p.item?.id as string | undefined, price: p.price as number, sold: p.sold as boolean, affix: p.item?.affix ?? null })));
    expect(stock, 'three pedestals').toHaveLength(3);
    for (const s of stock) {
      expect(UNIQUES, 'a unique item on every pedestal (no 품절)').toContain(s.id);
      expect([s.sold, s.affix]).toEqual([false, null]);
      expect(s.price).toBeGreaterThan(0);
    }
    expect(new Set(stock.map((s) => s.id)).size, 'distinct').toBe(3);
    const ped = 1;
    const { id, price } = stock[ped] as { id: string; price: number };
    // too poor: error toast, nothing happens
    await page.evaluate(() => { const ds = (window as any).__ds; ds.pieces(1); ds.step(5); });
    await clearText(page);
    await interact(page, 'CorpseShopItem', ped);
    await page.waitForTimeout(300);
    const texts = await drawn(page);
    expect(texts.some((t) => t === '시체 조각이 부족하다')).toBe(true);
    expect(texts.some((t) => t.startsWith('구매 · ')), 'the prompt names the item').toBe(true);
    expect(texts.some((t) => t === '유니크'), 'the item card carries the 유니크 tag').toBe(true);
    expect((await run(page)).pieces).toBe(1);
    await shot(page, '07a_unique_card');
    // rich: pays, the item drops at the pedestal, the pedestal is spent
    await page.evaluate((n) => { const ds = (window as any).__ds; ds.pieces(n + 7); ds.step(5); }, price);
    await interact(page, 'CorpseShopItem', ped);
    await page.waitForTimeout(300);
    expect((await run(page)).pieces).toBe(7);
    expect(await page.evaluate(() => (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'ItemDrop' && !e.dead).length)).toBe(1);
    expect(await page.evaluate((k) => (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'CorpseShopItem')[k].sold, ped)).toBe(true);
    await page.waitForTimeout(500);
    await shot(page, '07_bought');
    // pick the item up: it goes into its slot as the shop sold it (tier of the run, no affix)
    await clearText(page);
    await interact(page, 'ItemDrop');
    await page.waitForTimeout(300);
    const held = await page.evaluate((want) => {
      const r = (window as any).__ds.game.run;
      const all = [...r.weapons.map((w: any, slot: number) => ({ w, slot, kind: 'weapon' })), ...r.skills.map((w: any, slot: number) => ({ w, slot, kind: 'skill' }))];
      const f = all.find((x) => x.w?.id === want);
      return f ? { slot: f.slot as number, kind: f.kind as string, affix: f.w.affix, tier: f.w.tier as number, run: r.tier as number } : null;
    }, id);
    expect(held, `${id} is equipped`).not.toBeNull();
    expect([held!.affix, held!.tier]).toEqual([null, held!.run]);
    expect(await page.evaluate(() => (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'ItemDrop' && !e.dead).length)).toBe(0);
    // use it once with the real input: a weapon swings / draws / blocks, a skill starts its cooldown
    const used = await page.evaluate(([kind, slot]) => {
      const ds = (window as any).__ds, w = ds.world, inp = w.input, p = w.player;
      const e = ds.spawn('ghoul', 40);
      ds.step(2);
      const seen = new Set<string>();
      if (kind === 'skill') {
        inp.tap(slot === 0 ? 'skill1' : 'skill2');
        for (let f = 0; f < 60; f++) { ds.step(1); seen.add(p.state); }
        return { moved: p.skillCooldown[slot as number] > 0, seen: [...seen] };
      }
      const a = slot === 0 ? 'attack1' : 'attack2';
      inp.press(a);
      for (let f = 0; f < 40; f++) { ds.step(1); seen.add(p.state); }
      inp.release(a);
      for (let f = 0; f < 30; f++) { ds.step(1); seen.add(p.state); }
      e.dead = true;
      return { moved: [...seen].some((st) => st !== 'free'), seen: [...seen] };
    }, [held!.kind, held!.slot] as const);
    expect(used.moved, `${id} used once (states ${used.seen})`).toBe(true);
    await page.waitForTimeout(300);
    await shot(page, '07b_unique_used');
  });

  await test.step('the golem pile builds a golem that follows into the next level', async () => {
    await page.evaluate(() => { const ds = (window as any).__ds; ds.pieces(31); ds.step(5); });
    await interact(page, 'GolemPile');
    await page.waitForTimeout(300);
    let r = await run(page);
    expect(r.pieces).toBe(1);
    expect(r.golem).toEqual({ hp: 300, maxHp: 300 });
    await expect.poll(() => entitiesOf(page, 'Golem'), { timeout: 8_000, message: 'the golem stands up' }).toHaveLength(1);
    await page.waitForTimeout(1200);
    await shot(page, '08_golem_built');
    // hurt it, then walk on: the next level has it next to the heroine with the same hp
    await page.evaluate(() => { const g = (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'Golem'); g.takeDamage({ amount: 80, dir: 1, kind: 'melee' }); (window as any).__ds.step(2); });
    await toLevel(page, 'ramparts');
    await expect.poll(() => entitiesOf(page, 'Golem'), { timeout: 5_000 }).toHaveLength(1);
    const g = (await entitiesOf(page, 'Golem'))[0];
    expect(g.hp).toBe(220);
    const p = await page.evaluate(() => (window as any).__ds.player.x as number);
    expect(Math.abs(g.x - p)).toBeLessThan(120);
    // it fights: an enemy next to it takes damage
    const hurt = await page.evaluate(() => {
      const ds = (window as any).__ds, w = ds.world;
      for (const e of w.entities) if (e.team === 'enemy' && e.targetable) e.dead = true;
      ds.step(2);
      const e = ds.spawn('ghoul', 90);
      e.takeDamage({ amount: 1, dir: 1, kind: 'ranged' }); // wake it
      ds.step(300);
      return { hp: e.hp, maxHp: e.maxHp, dead: e.dead || e.dying };
    });
    expect(hurt.dead || hurt.hp < hurt.maxHp, 'the golem slammed it (or it fell)').toBe(true);
    await shot(page, '09_golem_follows');
    r = await run(page);
    expect(r.golem).not.toBeNull();
  });

  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('every unique item can be equipped and used in the real game (its entities draw, no console errors)', async ({ page }) => {
  const c = await boot(page, { query: '?seed=4&god=1' });
  await startRun(page, 4);
  const home = await page.evaluate(() => { const p = (window as any).__ds.player; return { x: p.x as number, y: p.y as number }; });
  // the entity each signature spawns (none for the shield: it only reacts to a parry) and how many steps after the cast the effect is on screen
  const spawns: Record<string, [string | null, number]> = {
    bone_cleaver: [null, 0], reaper_scythe: [null, 0], stitch_needle: [null, 0], widow_fangs: [null, 0], coffin_lid: [null, 0],
    marrow_bow: ['Arrow', 0], corpse_bomb: ['Grenade', 26], bone_spikes: ['BoneSpikes', 26], soul_lantern: ['SoulFlames', 40], chain_hook: ['ChainHook', 22],
  };
  for (const id of UNIQUES) {
    const skill = ITEM_SLOT_SKILL.includes(id);
    // phase 1: back to the start, equip, put three ghouls in front of her, use it; stop while the effect is still on the screen
    await page.evaluate(([uid, sk, frames, hx, hy]) => {
      const ds = (window as any).__ds;
      const w = ds.world, inp = w.input, p = w.player;
      for (const e of w.entities) if (e.constructor.name === 'SoulFlames') e.dead = true;
      ds.killAll();
      ds.teleport(hx, hy);
      ds.step(2);
      p.hp = p.maxHp;
      p.facing = 1;
      ds.give(uid, 0);
      ds.step(2);
      (window as any).__foes = [40, 70, 100].map((dx) => ds.spawn('ghoul', dx));
      (window as any).__seen = { classes: [] as string[], states: [] as string[] };
      ds.step(2);
      const look = () => {
        const s = (window as any).__seen;
        for (const e of w.entities) if (!e.dead && !s.classes.includes(e.constructor.name)) s.classes.push(e.constructor.name);
        if (!s.states.includes(p.state)) s.states.push(p.state);
      };
      if (sk) {
        inp.tap('skill1');
        for (let f = 0; f < frames; f++) { ds.step(1); look(); }
      } else {
        inp.press('attack1');
        for (let f = 0; f < 40; f++) { ds.step(1); look(); }
        inp.release('attack1');
        for (let f = 0; f < 40; f++) { ds.step(1); look(); }
      }
    }, [id, skill, spawns[id][1], home.x, home.y] as const);
    await page.waitForTimeout(60); // a couple of really rendered frames
    if (skill) await shot(page, `16_unique_${id}`);
    // phase 2: let it run out, read what happened
    const r = await page.evaluate((sk) => {
      const ds = (window as any).__ds;
      const p = ds.world.player;
      const seen = (window as any).__seen as { classes: string[]; states: string[] };
      if (sk) for (let f = 0; f < 90; f++) { ds.step(1); for (const e of ds.world.entities) if (!e.dead && !seen.classes.includes(e.constructor.name)) seen.classes.push(e.constructor.name); }
      const foes = (window as any).__foes as any[];
      const hurt = foes.filter((e) => e.dead || e.dying || e.hp < e.maxHp).length;
      for (const e of foes) e.dead = true;
      return { ...seen, cooldown: p.skillCooldown[0] as number, hurt };
    }, skill);
    const want = spawns[id][0];
    if (want) expect(r.classes, `${id} spawns ${want}`).toContain(want);
    if (skill) expect(r.cooldown, `${id} started its cooldown`).toBeGreaterThan(0);
    else expect(r.states.some((st) => st !== 'free'), `${id} swung / drew / blocked (states ${r.states})`).toBe(true);
    // the signature really reaches the ghouls in front of her (the shield only answers a parry)
    if (id !== 'coffin_lid') expect(r.hurt, `${id} hurt an enemy`).toBeGreaterThan(0);
  }
  expect(c.errors).toEqual([]);
});

test('the body made whole clears the loop: loop-clear scene, then the title shows the next 회차', async ({ page }) => {
  const c = await boot(page, { query: '?seed=5&god=1' });
  await recordText(page);
  await startRun(page, 5);
  await toLevel(page, 'passage');
  expect((await saved(page))?.loop ?? 1).toBe(1);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.body(99); ds.pieces(41); ds.step(5); });
  await clearText(page);
  await interact(page, 'Seamstress');
  await page.waitForTimeout(200);
  const texts = await drawn(page);
  expect(texts.some((t) => t === '몸 완성하기 · 1조각'), 'the completing prompt').toBe(true);
  expect(texts.some((t) => t === '1회차 클리어! · 남는 40조각은 사라짐'), 'the surplus warning').toBe(true);
  // the save already moved on
  const s = await saved(page);
  expect([s.loop, s.body, s.loopRuns]).toEqual([2, 0, 0]);
  await waitScene(page, 'LoopClearScene', 20_000);
  await clearText(page);
  await page.waitForTimeout(9000); // the typewriter epilogue + stats
  await shot(page, '10_loop_clear');
  const t1 = await drawn(page);
  // (the big headings are drawn letter by letter, so look at the joined text)
  const joined = t1.join('');
  for (const want of ['온전한 몸', '1회차 클리어', '도전 횟수', '처치한 적', '2회차 시작 — 적이 강해집니다']) expect(joined, want).toContain(want);
  // tap to leave (the first tap may only finish the typewriter)
  for (let i = 0; i < 2 && (await sceneName(page)) === 'LoopClearScene'; i++) {
    await page.evaluate(() => (window as any).__ds.game.taps.byId('title')?.onTap());
    await page.waitForTimeout(900);
  }
  await waitScene(page, 'TitleScene');
  await page.waitForTimeout(1200);
  const t2 = await drawn(page);
  expect(t2.some((t) => t === '2회차 · 몸 0/100'), 'the title shows the next loop').toBe(true);
  expect(t2.some((t) => t === '그들은 나를 백 조각으로 나눠 팔았다.'), 'the tagline').toBe(true);
  await shot(page, '11_title_loop2');
  // the next run is a loop-2 run: stronger enemies, a pricier golem
  await startRun(page, 6);
  const r = await run(page);
  expect(r.loop).toBe(2);
  expect((await saved(page)).loopRuns).toBe(1);
  const hp = await page.evaluate(() => { const ds = (window as any).__ds; const e = ds.spawn('ghoul', 200); ds.step(2); return [e.maxHp, e.spec.hp]; });
  expect(hp[0]).toBe(Math.round(hp[1] * 1.3));
  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('a loop-2 body: 99 sewn in the title save, the meter and "몸 n/100"', async ({ page }) => {
  const c = await boot(page, { query: '?seed=5&god=1' });
  await recordText(page);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.loop(3); ds.body(63); });
  await page.reload();
  await page.waitForFunction(() => (window as any).__ds?.game?.scene?.constructor?.name === 'TitleScene', null, { timeout: 30_000 });
  await recordText(page);
  await page.waitForTimeout(1500);
  expect(await drawn(page)).toEqual(expect.arrayContaining(['3회차 · 몸 63/100']));
  await shot(page, '12_title_body63');
  expect(c.errors).toEqual([]);
});

test('dying loses the carried pieces (the sewn ones stay), the death screen says so', async ({ page }) => {
  const c = await boot(page, { query: '?seed=9' });
  await recordText(page);
  await page.evaluate(() => { (window as any).__ds.body(20); });
  await startRun(page, 9);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.pieces(12); ds.game.run.cells = 5; ds.step(5); });
  expect((await run(page)).pieces).toBe(12);
  await clearText(page);
  await page.evaluate(() => { const p = (window as any).__ds.player; p.takeDamage({ amount: 99999, dir: 1, kind: 'hazard' }); });
  await waitScene(page, 'DeathScene', 15_000);
  await page.waitForTimeout(3500);
  const texts = await drawn(page);
  expect(texts, 'death rows').toEqual(expect.arrayContaining(['잃어버린 시체 조각', '12', '※ 꿰매지 않은 시체 조각은 사라졌습니다. 쉼터의 재봉사 셀마에게 맡기세요.', '※ 쓰지 않은 셀은 사라졌습니다. 쉼터의 연금술사에게 맡기세요.']));
  await shot(page, '13_death');
  expect((await saved(page)).body).toBe(20);
  // retry: a fresh run with nothing carried
  await page.evaluate(() => (window as any).__ds.game.taps.byId('retry')?.onTap());
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene?.constructor?.name === 'LevelScene' && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
  expect((await run(page)).pieces).toBe(0);
  expect((await saved(page)).body).toBe(20);
  expect(c.errors).toEqual([]);
});

test('a won run sews the carried pieces on the spot (victory rows); a body made whole hands over to the loop-clear scene', async ({ page }) => {
  const c = await boot(page, { query: '?seed=4&god=1' });
  await recordText(page);
  await startRun(page, 4);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.body(10); ds.pieces(25); });
  await toLevel(page, 'boss');
  await clearText(page);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.game.victory(); });
  await waitScene(page, 'VictoryScene', 20_000);
  await page.waitForTimeout(9000);
  const texts = await drawn(page);
  expect(texts.some((t) => t.startsWith('꿰맨 시체 조각 +25') && t.endsWith('몸 35/100')), 'victory row').toBe(true);
  await shot(page, '14_victory');
  expect((await saved(page)).body).toBe(35);
  // a second win with the body nearly done: the loop clears
  await startRun(page, 4);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.body(95); ds.pieces(30); });
  await toLevel(page, 'boss');
  await page.evaluate(() => { (window as any).__ds.game.victory(); });
  await waitScene(page, 'VictoryScene', 20_000);
  await page.waitForTimeout(9000);
  expect((await saved(page)).loop).toBe(2);
  for (let i = 0; i < 2 && (await sceneName(page)) === 'VictoryScene'; i++) {
    await page.evaluate(() => (window as any).__ds.game.taps.byId('title')?.onTap());
    await page.waitForTimeout(1000);
  }
  await waitScene(page, 'LoopClearScene', 20_000);
  expect(c.errors).toEqual([]);
});

test('the HUD counters fit every control mode at 480 and 800 UI widths', async ({ page }) => {
  const c = await boot(page, { query: '?seed=2&god=1' });
  await recordText(page);
  await startRun(page, 2);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.pieces(188); ds.game.run.gold = 1250; ds.game.run.cells = 321; ds.give('fire_grenade', 0); ds.give('turret', 1); ds.step(3); });
  for (const [vw, vh, tag] of [[640, 480, 'w480'], [1100, 360, 'w800']] as const) {
    await page.setViewportSize({ width: vw, height: vh });
    for (const mode of ['gesture', 'buttons', 'gamepad']) {
      await page.evaluate((m) => { const g = (window as any).__ds.game; g.save.settings.controlMode = m; g.settingsChanged(false); (window as any).__ds.step(2); }, mode);
      // a burst of pickups for the toast
      await page.evaluate(() => { const ds = (window as any).__ds; for (let i = 0; i < 3; i++) ds.world.emit({ type: 'pickup', what: 'pieces', amount: 2 }); ds.world.emit({ type: 'pickup', what: 'cells', amount: 3 }); ds.step(60); });
      await page.waitForTimeout(500);
      await shot(page, `15_hud_${tag}_${mode}`);
    }
  }
  expect(c.errors).toEqual([]);
});
