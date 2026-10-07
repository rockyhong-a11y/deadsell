import { test, expect, type Page } from '@playwright/test';
import { boot, waitScene, sceneName, entitiesOf, teleportNear, shot, startRun, toLevel, saved, hudPieces, recordText, drawn, clearText, interact } from './helpers';

/**
 * docs/CONTENT3.md (as changed by docs/CONTENT4.md §0 / §3) in the real game (Chromium, real asset loading + real render loop,
 * sound ON so audio errors surface): kills drop corpse pieces that fly to the heroine and show in the HUD; entering a 쉼터 banks
 * them (Selma crafts, the stash chest stands there); the golem pile is paid from the bank and builds a golem that follows into the
 * next level; dying loses carried pieces; the Matron's pieces are banked on victory. The debug hooks (__ds) set the scene up.
 * Screenshots for a human to look at go to e2e/__shots__/.
 */
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
test.setTimeout(180_000);

/** the ten unique items of docs/CONTENT3.md §5 (the first two grades, C and B) */
const UNIQUES = ['bone_cleaver', 'reaper_scythe', 'stitch_needle', 'widow_fangs', 'coffin_lid', 'marrow_bow', 'corpse_bomb', 'bone_spikes', 'soul_lantern', 'chain_hook'];

/** the unique skills (the others are weapons) */
const ITEM_SLOT_SKILL = ['corpse_bomb', 'bone_spikes', 'soul_lantern', 'chain_hook'];

const run = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).__ds.game.run;
    return { pieces: r.pieces as number, golem: r.golem as { hp: number; maxHp: number } | null, kind: r.level.kind as string, loop: r.loop as number };
  });

test('kills drop pieces, the 쉼터 banks them (Selma, the stash chest, the golem pile), the golem follows into the next level', async ({ page }) => {
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

  await test.step('entering the 쉼터 banks the carried pieces; Selma, the golem pile and the stash chest stand there, no corpse shop', async () => {
    await clearText(page);
    await toLevel(page, 'passage');
    expect((await run(page)).kind).toBe('passage');
    expect((await run(page)).pieces, 'nothing is carried any more').toBe(0);
    expect((await saved(page)).pieces, 'the 4 carried pieces are in the bank').toBe(4);
    await page.waitForTimeout(500);
    expect(await drawn(page), 'the toast').toEqual(expect.arrayContaining(['시체 조각 4개를 셀마에게 맡겼다']));
    const names = await page.evaluate(() => (window as any).__ds.world.entities.map((e: any) => e.constructor.name));
    for (const n of ['Seamstress', 'GolemPile', 'Alchemist', 'Fountain', 'ExitDoor', 'StashChest']) expect(names, n).toContain(n);
    expect(names).not.toContain('CorpseShopItem');
    await page.waitForTimeout(1200);
    await shot(page, '02_rest_stop');
    for (const [cls, name] of [['Seamstress', '03_selma'], ['StashChest', '04_stash_chest'], ['GolemPile', '05_golem_pile']] as const) {
      const e = (await entitiesOf(page, cls))[0];
      await teleportNear(page, e.x - 40, e.y - 2, 25);
      await page.waitForTimeout(700);
      await shot(page, name);
    }
  });

  await test.step('Selma: her prompt is 조합 with the bank; talking to her opens the craft screen', async () => {
    await clearText(page);
    await interact(page, 'Seamstress');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top?.constructor.name)).toBe('CraftModal');
    const texts = await drawn(page);
    expect(texts, 'the craft screen').toEqual(expect.arrayContaining(['조합', '재봉사 셀마', '조합']));
    expect(texts.some((t) => t === '재봉사 셀마 · 시체 조각 4'), 'the prompt of Selma before the screen opened').toBe(true);
    await shot(page, '06_craft_open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top)).toBeNull();
  });

  await test.step('the golem pile is paid from the bank and builds a golem that follows into the next level', async () => {
    await page.evaluate(() => { const ds = (window as any).__ds; ds.bank(29); ds.step(5); });
    await interact(page, 'GolemPile');
    await page.waitForTimeout(300);
    expect((await run(page)).golem, 'too few banked pieces: no golem').toBeNull();
    expect((await saved(page)).pieces).toBe(29);
    await page.evaluate(() => { const ds = (window as any).__ds; ds.bank(31); ds.pieces(500); ds.step(5); });
    await interact(page, 'GolemPile');
    await page.waitForTimeout(300);
    let r = await run(page);
    expect(r.pieces, 'the carried pieces were not spent').toBe(500);
    expect((await saved(page)).pieces, 'the bank paid 30').toBe(1);
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

test('dying loses the carried pieces (the banked ones stay), the death screen says so', async ({ page }) => {
  const c = await boot(page, { query: '?seed=9' });
  await recordText(page);
  await page.evaluate(() => { (window as any).__ds.bank(20); });
  await startRun(page, 9);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.pieces(12); ds.game.run.cells = 5; ds.step(5); });
  expect((await run(page)).pieces).toBe(12);
  await clearText(page);
  await page.evaluate(() => { const p = (window as any).__ds.player; p.takeDamage({ amount: 99999, dir: 1, kind: 'hazard' }); });
  await waitScene(page, 'DeathScene', 15_000);
  await page.waitForTimeout(3500);
  const texts = await drawn(page);
  expect(texts, 'death rows').toEqual(expect.arrayContaining(['잃어버린 시체 조각', '12', '※ 쉼터에 맡기지 못한 시체 조각은 사라졌습니다.', '※ 쓰지 않은 셀은 사라졌습니다. 쉼터의 연금술사에게 맡기세요.']));
  await shot(page, '13_death');
  expect((await saved(page)).pieces).toBe(20);
  // retry: a fresh run with nothing carried, the bank is still there
  await page.evaluate(() => (window as any).__ds.game.taps.byId('retry')?.onTap());
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene?.constructor?.name === 'LevelScene' && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
  expect((await run(page)).pieces).toBe(0);
  expect((await saved(page)).pieces).toBe(20);
  expect(c.errors).toEqual([]);
});

test('the Matron killed from far away still hands over her 12 pieces: the victory banks them all', async ({ page }) => {
  const c = await boot(page, { query: '?seed=3&god=1' });
  // (the last blow of a bow / grenade / turret lands far from her pile; the pieces only home within 260 px otherwise)
  for (const dist of [60, 450, 700]) {
    await startRun(page, 3);
    await page.evaluate(() => { const ds = (window as any).__ds; ds.bank(10); ds.shards(); ds.game.save.loop = 1; ds.pieces(7); });
    await toLevel(page, 'boss');
    const before = await page.evaluate((d) => {
      const ds = (window as any).__ds, w = ds.world;
      const m = w.entities.find((e: any) => e.constructor.name === 'Matron');
      m.takeDamage({ amount: 1, dir: 1, kind: 'melee' }); // wake her
      ds.step(300);
      ds.teleport(m.x - d, m.y);
      ds.step(30);
      m.takeDamage({ amount: 999999, dir: 1, kind: 'melee' });
      return { gap: Math.round(m.x - w.player.x), dying: m.dying };
    }, dist);
    expect(before.dying, 'the Matron is dying').toBe(true);
    expect(before.gap, `the heroine stands ${dist} px from her`).toBeGreaterThanOrEqual(dist - 30);
    // her pieces fly to the heroine from anywhere while the slow motion runs (it starts with bossDefeated, MATRON.deathAt
    // after the blow plus any hit-stop, so wait for it rather than for a fixed number of steps)
    await page.evaluate(() => {
      const ds = (window as any).__ds;
      for (let i = 0; i < 60 && ds.world.timeScale >= 1; i++) ds.step(10);
      ds.step(10);
    });
    if (dist > 260) {
      const flying = await page.evaluate(() => (window as any).__ds.world.entities.some((e: any) => e.constructor.name === 'Coin' && e.kind === 'piece' && e.homing && !e.dead));
      expect(flying, 'a far piece is already homing').toBe(true);
    }
    for (let i = 0; i < 60 && (await sceneName(page)) !== 'VictoryScene'; i++) await page.evaluate(() => (window as any).__ds.step(20));
    expect(await sceneName(page)).toBe('VictoryScene');
    const r = await run(page);
    expect(r.pieces).toBe(0);
    expect((await saved(page)).pieces, `${dist} px: 10 banked + 7 carried + the Matron's 12`).toBe(10 + 7 + 12);
  }
  expect(c.errors).toEqual([]);
});

test('loot that dropped just before the exit is not lost to the fade', async ({ page }) => {
  const c = await boot(page, { query: '?seed=3&god=1' });
  await startRun(page, 3);
  await page.evaluate(() => {
    const ds = (window as any).__ds;
    const es = [ds.spawn('ghoul', 50), ds.spawn('ghoul', -50), ds.spawn('ghoul', 80)];
    ds.step(2);
    for (const e of es) e.takeDamage({ amount: 99999, dir: 1, kind: 'melee' }); // 3 pieces, brand new
    ds.world.emit({ type: 'levelExit' }); // ... in the very same step the exit door fires
    (window as any).__prev = ds.game.scene;
  });
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene !== (window as any).__prev && d.game.scene?.constructor?.name === 'LevelScene' && d.game.fade < 0.3; }, null, { timeout: 30_000 });
  const r = await run(page);
  expect(r.kind).toBe('passage');
  expect((await saved(page)).pieces, '3 ordinary kills = 3 pieces, banked on entering the 쉼터').toBe(3);
  expect(r.pieces).toBe(0);
  expect(c.errors).toEqual([]);
});

test('쉼터 details: Selma\'s banter bubble (after a craft) sits above her prompt (which stays, with its tap region), the golem\'s hp bar sits above its head', async ({ page }) => {
  const c = await boot(page, { query: '?seed=5&god=1' });
  await recordText(page);
  await startRun(page, 5);
  await toLevel(page, 'passage');
  await page.evaluate(() => { const ds = (window as any).__ds; ds.step(5); });
  const e = (await entitiesOf(page, 'Seamstress'))[0];
  await teleportNear(page, e.x - 8, e.y - 2, 25);
  await page.evaluate(() => (window as any).__ds.world.entities.find((x: any) => x.constructor.name === 'Seamstress').sew()); // after a craft she sews and says a line
  await clearText(page);
  await page.waitForTimeout(400);
  const texts = await drawn(page);
  expect(texts.some((t) => /[가-힣]/.test(t) && t.length > 8 && !t.startsWith('재봉사')), 'her line is drawn').toBe(true);
  expect(texts, 'the prompt stays while she talks (it is the touch target)').toContain('조합');
  expect(await page.evaluate(() => !!(window as any).__ds.game.taps.byId('hud-interact')), 'its tap region too').toBe(true);
  await shot(page, '16_selma_banter');
  // and after the line is gone
  await page.waitForTimeout(3300);
  await clearText(page);
  await page.waitForTimeout(300);
  expect(await drawn(page)).toContain('조합');
  // the golem's hp bar
  await page.evaluate(() => { const ds = (window as any).__ds; const g = ds.golem(); ds.step(30); g.takeDamage({ amount: 90, dir: 1, kind: 'melee' }); ds.step(3); });
  await page.waitForTimeout(300);
  await shot(page, '17_golem_hpbar');
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
