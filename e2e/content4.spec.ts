import { test, expect, type Page } from '@playwright/test';
import { boot, tapRegion, waitScene, sceneName, entitiesOf, shot, startRun, toLevel, saved, recordText, drawn, clearText, interact } from './helpers';

/**
 * docs/CONTENT4.md in the real game (Chromium, real asset loading + real render loop, sound ON so audio errors surface): the
 * sprint (run-up, speed, animation, kill-streak frenzy), the stash (send an item from the field, open the chest, equip, put away,
 * salvage), crafting a C unique end to end (stash 3 items + bank 10 -> craft -> equip -> swing) and the victory that advances the
 * loop and keeps a bell shard. Touch input goes through real CDP touches on the registered tap regions; the debug hooks (__ds)
 * set the scene up. Screenshots for a human to look at go to e2e/__shots__/ (the stash and craft screens at 844x390 and 667x375).
 */
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
test.setTimeout(180_000);

/** the top modal of the level UI (class name), or null */
const topModal = (page: Page) => page.evaluate(() => (window as any).__ds.game.scene.ui?.top?.constructor.name ?? null) as Promise<string | null>;
const player = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__ds.player;
    return { sprinting: p.sprinting as boolean, vx: p.vx as number, frenzy: p.frenzyT as number, anim: p.anim.name as string, state: p.state as string, onGround: p.onGround as boolean, x: p.x as number };
  });
const equipped = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).__ds.game.run;
    const id = (i: any) => i?.id ?? null;
    return { weapons: r.weapons.map(id) as (string | null)[], skills: r.skills.map(id) as (string | null)[] };
  });
const stashIds = (page: Page) => page.evaluate(() => (window as any).__ds.stash().map((e: any) => e.id as string));

/** Take the same screenshot at the two phone sizes of the review (844x390, 667x375) and put the viewport back. */
async function shotBoth(page: Page, name: string) {
  await shot(page, `${name}_844x390`);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(500);
  await shot(page, `${name}_667x375`);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
}

test('sprint: 0.9 s of running starts it (sprint animation, 240 px/s), stopping ends it, a jump keeps the speed', async ({ page }) => {
  const c = await boot(page, { query: '?seed=3&god=1' });
  await startRun(page, 3);
  await toLevel(page, 'passage'); // a long flat floor
  await page.evaluate(() => { const ds = (window as any).__ds; ds.teleport(150, ds.player.y); ds.step(20); });
  const hasSprintRow = await page.evaluate(() => (window as any).__ds.player.anim.sheet.has('sprint'));
  const want = hasSprintRow ? 'sprint' : 'run';

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(450);
  let p = await player(page);
  expect([p.sprinting, p.vx, p.anim], 'still running').toEqual([false, 150, 'run']);
  await expect.poll(async () => (await player(page)).sprinting, { timeout: 4_000, message: 'the sprint starts after the run-up' }).toBe(true);
  await page.waitForTimeout(150);
  p = await player(page);
  expect([p.vx, p.anim], 'sprinting').toEqual([240, want]);
  await shot(page, '20_sprint');
  // the distance covered really is x1.6: sample the position over half a second of real time
  const x0 = (await player(page)).x;
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForTimeout(500);
  const x1 = (await player(page)).x;
  const t1 = await page.evaluate(() => performance.now());
  const speed = ((x1 - x0) / (t1 - t0)) * 1000;
  expect(speed, `measured ${Math.round(speed)} px/s`).toBeGreaterThan(200);
  expect(speed).toBeLessThan(250);

  // a jump out of the sprint keeps the horizontal speed while the direction is let go, until she lands
  await page.keyboard.down('Space');
  await page.waitForTimeout(100);
  await page.keyboard.up('KeyD');
  expect((await player(page)).onGround).toBe(false);
  await page.waitForTimeout(100);
  p = await player(page);
  expect([p.onGround, p.vx], 'airborne at sprint speed').toEqual([false, 240]);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await player(page)).onGround, { timeout: 5_000 }).toBe(true);
  await expect.poll(async () => (await player(page)).sprinting, { timeout: 3_000, message: 'stopping ends it' }).toBe(false);
  expect((await player(page)).vx).toBe(0);
  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('sprint: three kills within 2.5 s start the 광란 질주 - every movement is a sprint at once; it runs out after 5 s', async ({ page }) => {
  const c = await boot(page, { query: '?seed=3&god=1' });
  await recordText(page);
  await startRun(page, 3);
  await toLevel(page, 'passage');
  await page.evaluate(() => { const ds = (window as any).__ds; ds.teleport(150, ds.player.y); ds.step(20); });
  expect((await player(page)).frenzy).toBe(0);
  // two kills: nothing yet
  await page.evaluate(() => {
    const ds = (window as any).__ds;
    for (const dx of [60, 90]) { const e = ds.spawn('ghoul', dx); ds.step(2); e.takeDamage({ amount: 99999, dir: 1, kind: 'melee' }); }
    ds.step(5);
  });
  expect((await player(page)).frenzy).toBe(0);
  await clearText(page);
  await page.evaluate(() => {
    const ds = (window as any).__ds;
    const e = ds.spawn('ghoul', 120);
    ds.step(2);
    e.takeDamage({ amount: 99999, dir: 1, kind: 'melee' });
    ds.step(3);
  });
  expect((await player(page)).frenzy, 'the third kill starts the frenzy').toBeGreaterThan(4.5);
  await page.waitForTimeout(300);
  expect(await drawn(page), 'the pop text').toEqual(expect.arrayContaining(['광란 질주!']));
  // no run-up: the first moments of movement are already a sprint
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(250);
  const p = await player(page);
  expect([p.sprinting, p.vx]).toEqual([true, 240]);
  await page.waitForTimeout(150);
  await shot(page, '21_frenzy');
  await page.keyboard.up('KeyD');
  // let it run out (step the world: 5 s of simulation), then running is a plain run again
  await page.evaluate(() => { const ds = (window as any).__ds; ds.step(360); });
  expect((await player(page)).frenzy).toBe(0);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(300);
  expect(await player(page), 'back to a normal run').toMatchObject({ sprinting: false, vx: 150 });
  await page.keyboard.up('KeyD');
  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('stash: send an item from the field, open the chest, equip (with a slot choice), put away and salvage; it survives a reload', async ({ page }) => {
  const c = await boot(page, { query: '?seed=1&god=1' });
  await recordText(page);
  await startRun(page, 1);
  await page.evaluate(() => {
    const ds = (window as any).__ds;
    ds.give('rusty_sword', 0);
    ds.give('spear', 1);
    ds.stashAdd('war_hammer', 1);
    ds.stashAdd('turret', 2, 'dmg');
    ds.step(5);
  });
  expect(await stashIds(page)).toEqual(['war_hammer', 'turret']);

  await test.step('picking an item up with both weapon slots full offers 보관함으로 보내기', async () => {
    await page.evaluate(() => { const ds = (window as any).__ds; ds.drop('hunter_bow', 2, 'burn', true); });
    await page.waitForTimeout(700);
    await interact(page, 'ItemDrop');
    await page.waitForTimeout(500);
    expect(await topModal(page)).toBe('ChoiceModal');
    const labels = await page.evaluate(() => (window as any).__ds.game.scene.ui.top.options.map((o: any) => o.label as string));
    expect(labels).toHaveLength(3);
    expect(labels[2]).toBe('보관함으로 보내기 · 2/24');
    await shot(page, '22_field_choice');
    await tapRegion(c, 'choice2');
    await page.waitForTimeout(400);
    expect(await topModal(page)).toBeNull();
    expect(await stashIds(page)).toEqual(['war_hammer', 'turret', 'hunter_bow']);
    const bow = await page.evaluate(() => (window as any).__ds.stash()[2]);
    expect(bow).toEqual({ id: 'hunter_bow', tier: 2, affix: 'burn', mb: true });
    expect((await equipped(page)).weapons, 'both slots untouched').toEqual(['rusty_sword', 'spear']);
    expect((await saved(page)).stash).toHaveLength(3);
    expect(await page.evaluate(() => (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'ItemDrop' && !e.dead).length)).toBe(0);
  });

  await test.step('the chest next to the start: the stash screen', async () => {
    const chests = await entitiesOf(page, 'StashChest');
    expect(chests, 'a stash chest in the prison start room').toHaveLength(1);
    await interact(page, 'StashChest');
    await page.waitForTimeout(600);
    expect(await topModal(page)).toBe('StashModal');
    const texts = await drawn(page);
    expect(texts).toEqual(expect.arrayContaining(['보관함', '장착 중', '보관함  3/24', '장착', '분해', '닫기']));
    await shotBoth(page, '23_stash');
  });

  await test.step('장착 with both slots taken asks which to replace; the old item takes its place in the stash', async () => {
    await tapRegion(c, 'stash-cell2'); // hunter_bow
    await tapRegion(c, 'stash-act');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top.pending)).toBe(2);
    await shot(page, '24_stash_pending');
    await tapRegion(c, 'stash-equip1'); // replaces the spear
    await page.waitForTimeout(300);
    expect((await equipped(page)).weapons).toEqual(['rusty_sword', 'hunter_bow']);
    expect(await stashIds(page)).toEqual(['war_hammer', 'turret', 'spear']);
    expect((await saved(page)).stash.map((e: any) => e.id)).toEqual(['war_hammer', 'turret', 'spear']);
    // the mid-boss flag travelled with it
    expect(await page.evaluate(() => (window as any).__ds.game.run.weapons[1].mb)).toBe(true);
  });

  await test.step('맡기기 puts an equipped item away (an empty primary is fine); 분해 needs a second tap and gives bank pieces', async () => {
    await tapRegion(c, 'stash-equip0');
    await tapRegion(c, 'stash-act');
    await page.waitForTimeout(300);
    expect((await equipped(page)).weapons).toEqual([null, 'hunter_bow']);
    expect(await stashIds(page)).toEqual(['war_hammer', 'turret', 'spear', 'rusty_sword']);
    // salvage the tier-2 turret with a damage affix: 1 + 1 + 1 = 3 pieces
    await tapRegion(c, 'stash-cell1');
    await tapRegion(c, 'stash-salvage');
    await page.waitForTimeout(250);
    expect(await stashIds(page), 'armed, not done').toHaveLength(4);
    expect(await drawn(page)).toEqual(expect.arrayContaining(['정말?']));
    await tapRegion(c, 'stash-salvage');
    await page.waitForTimeout(300);
    expect(await stashIds(page)).toEqual(['war_hammer', 'spear', 'rusty_sword']);
    expect((await saved(page)).pieces).toBe(3);
    await shot(page, '25_stash_after');
    await tapRegion(c, 'stash-close');
    await page.waitForTimeout(300);
    expect(await topModal(page)).toBeNull();
  });

  await test.step('the stash is permanent: it is still there after a reload, and in the next run', async () => {
    await page.reload();
    await page.waitForFunction(() => (window as any).__ds?.game?.scene?.constructor?.name === 'TitleScene', null, { timeout: 30_000 });
    expect(await stashIds(page)).toEqual(['war_hammer', 'spear', 'rusty_sword']);
    expect(await page.evaluate(() => (window as any).__ds.game.save.pieces)).toBe(3);
    await startRun(page, 2);
    expect(await stashIds(page)).toEqual(['war_hammer', 'spear', 'rusty_sword']);
    expect((await entitiesOf(page, 'StashChest')).length).toBe(1);
  });
  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('stash: with the keyboard (arrows, Enter, X, Esc)', async ({ page }) => {
  const c = await boot(page, { query: '?seed=1&god=1' });
  await startRun(page, 1);
  await page.evaluate(() => {
    const ds = (window as any).__ds;
    ds.stashAdd('war_hammer', 1);
    ds.stashAdd('fire_grenade', 1, 'dmg');
    ds.step(5);
  });
  await interact(page, 'StashChest');
  await page.waitForTimeout(500);
  expect(await topModal(page)).toBe('StashModal');
  await page.keyboard.press('Enter'); // the war hammer goes into the free secondary slot
  await page.waitForTimeout(200);
  expect((await equipped(page)).weapons).toEqual(['rusty_sword', 'war_hammer']);
  await page.keyboard.press('Enter'); // the grenade into the free skill slot
  await page.waitForTimeout(200);
  expect((await equipped(page)).skills).toEqual(['fire_grenade', null]);
  expect(await stashIds(page)).toEqual([]);
  await page.keyboard.press('ArrowUp'); // off the grid onto the equipment row
  await page.keyboard.press('Enter'); // the primary weapon is put away
  await page.waitForTimeout(200);
  expect((await equipped(page)).weapons).toEqual([null, 'war_hammer']);
  expect(await stashIds(page)).toEqual(['rusty_sword']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('KeyX');
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(200);
  expect(await stashIds(page)).toEqual([]);
  expect((await saved(page)).pieces).toBe(1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await topModal(page)).toBeNull();
  expect(c.errors).toEqual([]);
});

test('crafting: a C unique end to end - 3 stash items + 10 banked pieces -> craft -> equip -> swing', async ({ page }) => {
  const c = await boot(page, { query: '?seed=3&god=1' });
  await recordText(page);
  await startRun(page, 3);
  await page.evaluate(() => {
    const ds = (window as any).__ds;
    ds.stashAdd('spear', 1);
    ds.stashAdd('war_hammer', 1);
    ds.stashAdd('turret', 1);
    ds.stashAdd('hunter_bow', 3, 'dmg'); // the dearest: it stays
    ds.bank(14);
  });
  await toLevel(page, 'passage');
  await page.waitForTimeout(500);

  await test.step('Selma\'s craft screen shows the recipe, the entries it will use, and the unique to make', async () => {
    await clearText(page);
    await interact(page, 'Seamstress');
    await page.waitForTimeout(600);
    expect(await topModal(page)).toBe('CraftModal');
    const m = await page.evaluate(() => { const t = (window as any).__ds.game.scene.ui.top; return { grade: t.grade as string, picks: t.plan.picks as number[], ok: t.plan.ok as boolean, selected: t.selected as string }; });
    expect(m).toEqual({ grade: 'C', picks: [0, 1, 2], ok: true, selected: 'bone_cleaver' });
    const texts = await drawn(page);
    expect(texts).toEqual(expect.arrayContaining(['아이템 (유니크 제외)', '4/3', '시체 조각', '14/10', '뼈 도살검', '쓰이는 칸']));
    await shotBoth(page, '26_craft');
  });

  await test.step('조합 (a real tap): the materials are gone, the unique is in the stash, Selma sews', async () => {
    await clearText(page);
    await tapRegion(c, 'craft-do');
    await page.waitForTimeout(600);
    expect(await stashIds(page)).toEqual(['hunter_bow', 'bone_cleaver']);
    expect(await page.evaluate(() => (window as any).__ds.stash()[1])).toEqual({ id: 'bone_cleaver', tier: 1, affix: null });
    const s = await saved(page);
    expect([s.pieces, s.stash.map((e: any) => e.id)]).toEqual([4, ['hunter_bow', 'bone_cleaver']]);
    expect(await drawn(page)).toEqual(expect.arrayContaining(['뼈 도살검 조합 완료']));
    expect(await page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'Seamstress').anim.name)).toBe('sew');
    // not enough left for another one
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top.plan.ok)).toBe(false);
    await shot(page, '27_crafted');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await topModal(page)).toBeNull();
  });

  await test.step('the stash chest of the 쉼터: equip it (the grade letter shows in the HUD) and swing it at a ghoul', async () => {
    await interact(page, 'StashChest');
    await page.waitForTimeout(500);
    expect(await topModal(page)).toBe('StashModal');
    await tapRegion(c, 'stash-cell1'); // the bone cleaver
    await tapRegion(c, 'stash-act');
    await page.waitForTimeout(300);
    expect(await topModal(page)).toBe('StashModal');
    // the secondary slot was free: the cleaver took it without asking
    expect((await equipped(page)).weapons).toEqual(['rusty_sword', 'bone_cleaver']);
    await shot(page, '28_stash_equipped');
    await clearText(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    expect(await drawn(page), 'the grade letter C on the weapon slot of the HUD').toContain('C');
    const hit = await page.evaluate(() => {
      const ds = (window as any).__ds, w = ds.world, inp = w.input;
      const e = ds.spawn('ghoul', 36);
      ds.step(2);
      const states = new Set<string>();
      inp.press('attack2'); // the secondary weapon
      for (let f = 0; f < 50; f++) { ds.step(1); states.add(w.player.state); }
      inp.release('attack2');
      return { attacked: states.has('attack'), hp: e.hp as number, maxHp: e.maxHp as number, bleed: e.status.bleed as number, dead: e.dead || e.dying };
    });
    expect(hit.attacked, 'the heroine swung').toBe(true);
    expect(hit.dead || hit.hp < hit.maxHp, 'the cleaver hurt the ghoul').toBe(true);
    expect(hit.dead || hit.bleed > 0, 'and it bleeds (the signature of the 뼈 도살검)').toBe(true);
  });
  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('victory: the carried pieces are banked, the loop goes up, a bell shard of the won loop is kept; the title shows the loop', async ({ page }) => {
  const c = await boot(page, { query: '?seed=4&god=1' });
  await recordText(page);
  await startRun(page, 4);
  await page.evaluate(() => { const ds = (window as any).__ds; ds.bank(5); ds.pieces(7); });
  await toLevel(page, 'boss');
  // only a 쉼터 or the victory banks the carried pieces: the bank still holds the 5
  expect((await saved(page))?.pieces ?? 0).toBe(5);
  await clearText(page);
  await page.evaluate(() => { (window as any).__ds.game.victory(); });
  await waitScene(page, 'VictoryScene', 20_000);
  await page.waitForTimeout(9000);
  const texts = await drawn(page);
  expect(texts.some((t) => t.startsWith('맡긴 시체 조각 +7') && t.includes('종탑의 파편 +1 (1회차)')), 'the banked row').toBe(true);
  expect(texts, 'the next loop').toEqual(expect.arrayContaining(['다음 회차: 2']));
  await shot(page, '29_victory');
  const s = await saved(page);
  expect([s.loop, s.shards, s.pieces, s.wins]).toEqual([2, [1], 12, 1]);
  await page.evaluate(() => (window as any).__ds.game.taps.byId('title')?.onTap());
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as any).__ds.game.taps.byId('title')?.onTap());
  await waitScene(page, 'TitleScene');
  await clearText(page);
  await page.waitForTimeout(1500);
  const t2 = await drawn(page);
  expect(t2, 'the title shows the loop').toEqual(expect.arrayContaining(['2회차']));
  expect(t2.some((t) => t === '그들은 죽은 자를 팔았다.'), 'the new tagline').toBe(true);
  expect(t2.some((t) => /몸 \d+\/100/.test(t)), 'no body meter any more').toBe(false);
  await shot(page, '30_title_loop2');
  // the next run is a loop-2 run: stronger enemies; winning it keeps a shard of loop 2
  await startRun(page, 6);
  expect(await page.evaluate(() => (window as any).__ds.game.run.loop)).toBe(2);
  const hp = await page.evaluate(() => { const ds = (window as any).__ds; const e = ds.spawn('ghoul', 200); ds.step(2); return [e.maxHp, e.spec.hp]; });
  expect(hp[0]).toBe(Math.round(hp[1] * 1.3));
  await toLevel(page, 'boss');
  await page.evaluate(() => { (window as any).__ds.game.victory(); });
  await waitScene(page, 'VictoryScene', 20_000);
  expect(await sceneName(page)).toBe('VictoryScene');
  const s2 = await saved(page);
  expect([s2.loop, s2.shards]).toEqual([3, [1, 2]]);
  expect(c.errors, 'no console / page errors').toEqual([]);
});

test('the grade table: the badges of all six grades on the craft tabs and the stash cells (screenshot)', async ({ page }) => {
  const c = await boot(page, { query: '?seed=1&god=1' });
  await startRun(page, 1);
  await toLevel(page, 'passage');
  await page.evaluate(() => {
    const ds = (window as any).__ds;
    for (const id of ['bone_cleaver', 'reaper_scythe', 'grave_bell', 'executioner_blade', 'matron_flail', 'selma_shears']) ds.stashAdd(id, 2);
    ds.bank(300);
    ds.shards(1, 2, 3, 3, 3);
  });
  await interact(page, 'StashChest');
  await page.waitForTimeout(600);
  await shot(page, '31_stash_grades');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await interact(page, 'Seamstress');
  await page.waitForTimeout(600);
  // it opens on the highest grade that can be crafted now (SSS: an SS and an S unique, three shards of loop 3+, 120 pieces)
  expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top.grade)).toBe('SSS');
  await shot(page, '32_craft_sss');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top.grade)).toBe('SS');
  await shot(page, '33_craft_ss');
  expect(c.errors, 'no console / page errors').toEqual([]);
});
