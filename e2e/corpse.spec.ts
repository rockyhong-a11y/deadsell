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

  await test.step('시체 상점: a pedestal sells its item for carried pieces', async () => {
    const injected = await page.evaluate(() => {
      const w = (window as any).__ds.world;
      const peds = w.entities.filter((e: any) => e.constructor.name === 'CorpseShopItem');
      const stocked = peds.filter((p: any) => p.item).length;
      // no unique items in the game yet: put a catalogue item on the first pedestal so the purchase path runs in the real game
      if (!stocked) { peds[0].item = { id: 'war_hammer', tier: w.run.tier, affix: null }; peds[0].price = 25; peds[0].sold = false; }
      return !stocked;
    });
    if (injected) test.info().annotations.push({ type: 'note', description: 'no unique items in the shop stock yet: a stand-in item was placed on the first pedestal' });
    const price = await page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'CorpseShopItem' && e.item).price as number);
    // too poor: error toast, nothing happens
    await page.evaluate(() => { const ds = (window as any).__ds; ds.pieces(1); ds.step(5); });
    const ped = (await page.evaluate(() => { const e = (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'CorpseShopItem').findIndex((p: any) => p.item); return e; })) as number;
    await clearText(page);
    await interact(page, 'CorpseShopItem', ped);
    await page.waitForTimeout(300);
    expect((await drawn(page)).some((t) => t === '시체 조각이 부족하다')).toBe(true);
    expect((await run(page)).pieces).toBe(1);
    // rich: pays, the item drops at the pedestal
    await page.evaluate((n) => { const ds = (window as any).__ds; ds.pieces(n + 7); ds.step(5); }, price);
    await interact(page, 'CorpseShopItem', ped);
    await page.waitForTimeout(300);
    expect((await run(page)).pieces).toBe(7);
    expect(await page.evaluate(() => (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'ItemDrop' && !e.dead).length)).toBe(1);
    await page.waitForTimeout(500);
    await shot(page, '07_bought');
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
