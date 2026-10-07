import { test, expect, type Page } from '@playwright/test';
import { botWalk, type BotResult } from './bot';
import {
  SAVE_KEY, boot, sceneName, waitScene, tapRegion, watchEvents, events, entitiesOf, teleportNear, hold, type Ctx,
} from './helpers';

/**
 * Full-run integration test (DEADSELL): Title -> Prison -> Passage -> Ramparts -> Passage -> Boss -> Victory -> Title,
 * plus death -> retry. Real input where practical (keyboard, CDP touch taps on the real UI regions, the nav-graph
 * bot of bot.ts driving the real player through the real input layer + physics); debug hooks (__ds) only for
 * teleports, state setup (gold/cells) and reading state. Sound is ON (no mute flag) so audio errors surface.
 * Screenshots (for humans) go to e2e-shots/.
 */
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });

const SHOTS = 'e2e-shots/';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}.png` });

const player = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__ds.player;
    return { x: p.x as number, y: p.y as number, vy: p.vy as number, onGround: p.onGround as boolean, hp: p.hp as number, maxHp: p.maxHp as number, state: p.state as string, facing: p.facing as number };
  });
const run = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).__ds.game.run;
    return {
      levelIndex: r.levelIndex as number, kind: r.level.kind as string, biome: r.level.biome as string, gold: r.gold as number, cells: r.cells as number,
      flasks: r.flasks as number, maxFlasks: r.maxFlasks as number, kills: r.kills as number, weapons: r.weapons.map((w: any) => w?.id ?? null) as (string | null)[],
      scrolls: r.scrolls as number, maxHp: r.maxHp as number,
    };
  });
const modalOpen = (page: Page) => page.evaluate(() => !!(window as any).__ds.game.scene.ui?.modal);
const savedGame = (page: Page, key = SAVE_KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

/** Entities that overlap solid terrain (spawned in walls) or float far above any floor (non-flyers). */
async function misplacedEntities(page: Page) {
  return page.evaluate(() => {
    const w = (window as any).__ds.world;
    const bad: string[] = [];
    const FLY = new Set(['Harpy', 'Torch', 'Deco']);
    for (const e of w.entities) {
      if (e.dead || e.constructor.name === 'Player' || e.constructor.name === 'RoomTracker' || e.constructor.name === 'BossGate') continue;
      const tx = Math.floor(e.x / 24), ty = Math.floor((e.y - 2) / 24);
      if (w.map.isSolid(tx, ty)) bad.push(`${e.constructor.name}@${tx},${ty} inside a solid tile`);
      if (!FLY.has(e.constructor.name)) {
        const below = w.map.floorBelow ? w.map.floorBelow(e.x, e.y - 4, 200) : e.y;
        if (below === null || below === undefined || below - e.y > 30) bad.push(`${e.constructor.name}@${tx},${ty} floats (floor ${below} vs y ${Math.round(e.y)})`);
      }
    }
    return bad;
  });
}

/** Walk the real player to the thing it must interact with, then press the interact key. */
async function walkTo(page: Page, target: { x: number; y: number }, reach = 28, maxSteps = 60 * 240): Promise<BotResult> {
  return page.evaluate(botWalk, { target, reach, maxSteps });
}

/** Stand at an entity, wait for its prompt, interact through the keyboard. */
async function interactKey(page: Page, cls: string, pick = 0) {
  const list = await entitiesOf(page, cls);
  const e = list[pick];
  expect(e, `a ${cls} exists`).toBeTruthy();
  await teleportNear(page, e.x - 12, e.y - 2, 25);
  await expect.poll(() => page.evaluate(() => (window as any).__ds.player.nearInteract?.constructor.name ?? null), { timeout: 5_000, message: `prompt for ${cls}` }).not.toBeNull();
  await page.keyboard.press('KeyF');
}

test.describe('full run', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  test('title -> prison -> passage -> ramparts -> passage -> boss -> victory -> title', async ({ page }) => {
    const c: Ctx = await boot(page, { query: '?seed=7&god=1' });

    // ------------------------------------------------------------------ title -> run (real touch)
    await shot(page, '00_title');
    await page.waitForTimeout(1200);
    await c.fingers.tap(420, 200);
    await waitScene(page, 'LevelScene');
    await page.waitForFunction(() => (window as any).__ds.player?.onGround === true, null, { timeout: 15_000 });
    await watchEvents(page);

    // ------------------------------------------------------------------ biome 1: Sunken Prison
    await test.step('prison: generated level renders with tile art + parallax, enemies and props are placed', async () => {
      const r = await run(page);
      expect(r).toMatchObject({ levelIndex: 0, kind: 'biome', biome: 'prison' });
      const info = await page.evaluate(() => {
        const s = (window as any).__ds.game.scene;
        const w = s.world;
        const kinds: Record<string, number> = {};
        for (const e of w.entities) kinds[e.constructor.name] = (kinds[e.constructor.name] ?? 0) + 1;
        return { tileArt: s.renderer.tileArt as boolean, layers: s.renderer.parallaxLayers as number, kinds, w: w.map.w as number, h: w.map.h as number };
      });
      expect(info.tileArt, 'tile atlas (not flat-colour placeholder) in use').toBe(true);
      expect(info.layers, 'parallax layers loaded').toBeGreaterThanOrEqual(2);
      expect(info.w * info.h).toBeGreaterThan(5000);
      const enemyKinds = ['Ghoul', 'Jailer', 'Archer', 'Bomber', 'Harpy', 'Lancer'].filter((k) => (info.kinds[k] ?? 0) > 0);
      expect(enemyKinds.length, `enemy variety ${JSON.stringify(info.kinds)}`).toBeGreaterThanOrEqual(3);
      for (const k of ['ExitDoor', 'Chest', 'Altar', 'Pedestal', 'ShopItem', 'Merchant']) expect(info.kinds[k] ?? 0, k).toBeGreaterThan(0);
      expect(await misplacedEntities(page)).toEqual([]);
      // start position is on the floor, not in a wall
      const p = await player(page);
      expect(p.onGround).toBe(true);
      await page.waitForTimeout(1500);
      await shot(page, '01_prison_start');
    });

    await test.step('prison: real keyboard movement (run, jump, roll)', async () => {
      const a = await player(page);
      await hold(page, 'KeyD', 700);
      const b = await player(page);
      expect(b.x - a.x, 'D runs right').toBeGreaterThan(50);
      await page.keyboard.press('Space');
      await page.waitForTimeout(120);
      const j = await player(page);
      expect(j.onGround || j.vy < 0, 'Space jumps').toBe(true);
      expect(j.onGround).toBe(false);
      await page.waitForTimeout(900);
      const sampler = page.evaluate(() => new Promise<string[]>((res) => {
        const seen = new Set<string>();
        const t0 = performance.now();
        const tick = () => {
          seen.add((window as any).__ds.player.state);
          if (performance.now() - t0 > 700) res([...seen]);
          else requestAnimationFrame(tick);
        };
        tick();
      }));
      await page.keyboard.down('KeyD');
      await page.keyboard.press('KeyL');
      await page.keyboard.up('KeyD');
      expect(await sampler, 'L rolls').toContain('roll');
      await page.waitForTimeout(300);
    });

    await test.step('prison: combat - attack a ghoul with real keys, it dies and drops loot', async () => {
      const ghouls = await entitiesOf(page, 'Ghoul');
      expect(ghouls.length).toBeGreaterThan(0);
      const g0 = ghouls[0];
      await teleportNear(page, g0.x - 70, g0.y - 2, 30);
      const before = await run(page);
      const hpBefore = await player(page);
      let killed = 0;
      for (let i = 0; i < 80 && !killed; i++) {
        const gs = await entitiesOf(page, 'Ghoul');
        const p = await player(page);
        const near = gs.filter((g) => Math.abs(g.x - p.x) < 400 && Math.abs(g.y - p.y) < 40).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
        if (near) {
          const dx = near.x - p.x;
          const key = dx > 0 ? 'KeyD' : 'KeyA';
          if (Math.abs(dx) > 34) await hold(page, key, 110);
          else {
            // turn to face it with a tiny step, then swing
            await hold(page, key, 20);
            await page.keyboard.press('KeyJ');
            await page.waitForTimeout(260);
          }
        } else await page.waitForTimeout(120);
        killed = await events(page, 'enemyKilled');
      }
      expect(killed, 'enemyKilled event fired').toBeGreaterThan(0);
      expect((await run(page)).kills).toBeGreaterThan(before.kills);
      await shot(page, '02_prison_combat');
      // cells / gold drop and are vacuumed up by the player
      await expect.poll(async () => { const r = await run(page); return r.cells + r.gold; }, { timeout: 6_000 }).toBeGreaterThan(before.cells + before.gold);
      expect((await player(page)).hp).toBeGreaterThan(0);
      expect(hpBefore.hp).toBeGreaterThan(0);
    });

    await test.step('prison: chest through the HUD interact prompt (real touch tap) drops loot', async () => {
      const g0 = await run(page);
      const chest = (await entitiesOf(page, 'Chest'))[0];
      await teleportNear(page, chest.x - 14, chest.y - 2, 25);
      await expect.poll(() => page.evaluate(() => (window as any).__ds.player.nearInteract?.constructor.name), { timeout: 5_000 }).toBe('Chest');
      await shot(page, '03_prompt');
      await tapRegion(c, 'hud-interact');
      await expect.poll(() => page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'Chest')?.opened), { timeout: 5_000 }).toBe(true);
      await expect.poll(async () => { const r = await run(page); return r.gold; }, { timeout: 8_000, message: 'chest gold collected' }).toBeGreaterThan(g0.gold);
      // an item the chest may have dropped: pick it up (swap modal -> first option)
      await page.waitForTimeout(600);
      const drops = await entitiesOf(page, 'ItemDrop');
      if (drops.length) {
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(300);
        if (await modalOpen(page)) await page.keyboard.press('Enter');
      }
    });

    await test.step('prison: altar -> scroll of power -> choice modal (real touch) raises a stat', async () => {
      const before = await run(page);
      await interactKey(page, 'Altar');
      await expect.poll(() => entitiesOf(page, 'Scroll').then((l) => l.length), { timeout: 4_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(900);
      const sc = (await entitiesOf(page, 'Scroll'))[0];
      await teleportNear(page, sc.x - 6, sc.y - 2, 10);
      await expect.poll(() => page.evaluate(() => (window as any).__ds.player.nearInteract?.constructor.name), { timeout: 5_000 }).toBe('Scroll');
      await page.keyboard.press('KeyF');
      await expect.poll(() => modalOpen(page), { timeout: 4_000 }).toBe(true);
      await page.waitForTimeout(500);
      await shot(page, '04_scroll_choice');
      await tapRegion(c, 'choice2'); // survival
      await expect.poll(() => modalOpen(page), { timeout: 4_000 }).toBe(false);
      const after = await run(page);
      expect(after.scrolls).toBe(before.scrolls + 1);
      expect(after.maxHp).toBeGreaterThan(before.maxHp);
    });

    await test.step('prison: pedestal item + shop purchase', async () => {
      // the pedestal's own drop = the item drop that appears after interacting (loot from the chest / enemies may lie around)
      const dropCount = () => page.evaluate(() => (window as any).__ds.world.entities.filter((e: any) => e.constructor.name === 'ItemDrop' && !e.dead).length as number);
      const known = await page.evaluate(() => { const w = (window as any).__ds.world; (window as any).__known = w.entities.filter((e: any) => e.constructor.name === 'ItemDrop'); return (window as any).__known.length as number; });
      await interactKey(page, 'Pedestal');
      await expect.poll(dropCount, { timeout: 4_000 }).toBeGreaterThan(await page.evaluate(() => (window as any).__known.filter((e: any) => !e.dead).length as number));
      await page.waitForTimeout(700);
      const d = await page.evaluate(() => {
        const w = (window as any).__ds.world;
        const e = w.entities.find((o: any) => o.constructor.name === 'ItemDrop' && !o.dead && !(window as any).__known.includes(o));
        (window as any).__ped = e ?? null;
        return e ? { x: e.x as number, y: e.y as number, id: e.inst.id as string } : null;
      });
      expect(d, `the pedestal produced a new item drop (${known} drops were already there)`).not.toBeNull();
      // walk onto it and press interact until THAT drop is gone. It has a short pickup delay, and a full loadout opens the swap
      // modal (Enter = first slot; picking an identical item leaves the loadout unchanged, so the loadout is no signal).
      let taken = false;
      for (let i = 0; i < 8 && !taken; i++) {
        await teleportNear(page, d!.x - 6, d!.y - 2, 10);
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(300);
        if (await modalOpen(page)) await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        taken = await page.evaluate(() => !!(window as any).__ped?.dead);
      }
      expect(taken, `pedestal item ${d!.id} was taken`).toBe(true);

      // shop: needs gold
      await page.evaluate(() => { (window as any).__ds.game.run.gold = 900; });
      const shops = await entitiesOf(page, 'ShopItem');
      expect(shops.length).toBe(3);
      const goldBefore = (await run(page)).gold;
      await interactKey(page, 'ShopItem', 0);
      await page.waitForTimeout(400);
      expect((await run(page)).gold, 'gold was spent').toBeLessThan(goldBefore);
      await expect.poll(() => entitiesOf(page, 'ItemDrop').then((l) => l.length), { timeout: 4_000 }).toBeGreaterThan(0);
      await page.keyboard.press('KeyF'); // maybe too early for the drop (it has a pickup delay)
      await page.waitForTimeout(700);
      await page.keyboard.press('KeyF');
      await page.waitForTimeout(300);
      if (await modalOpen(page)) await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    });

    await test.step('prison: walk to the exit door with the nav bot, open it -> passage', async () => {
      await page.evaluate(() => (window as any).__ds.killAll());
      const ex = (await entitiesOf(page, 'ExitDoor'))[0];
      const res = await walkTo(page, ex);
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
      await shot(page, '05_prison_exit');
      await expect.poll(() => page.evaluate(() => (window as any).__ds.player.nearInteract?.constructor.name), { timeout: 5_000 }).toBe('ExitDoor');
      await page.keyboard.press('KeyF');
      await expect.poll(() => events(page, 'levelExit'), { timeout: 5_000 }).toBe(1);
      await waitScene(page, 'LevelScene');
      await expect.poll(async () => (await run(page)).kind).toBe('passage');
      await watchEvents(page);
    });

    // ------------------------------------------------------------------ passage 1: Alchemist + fountain
    await test.step('passage: alchemist, fountain, buying with cells, saving', async () => {
      await page.waitForTimeout(2200);
      await shot(page, '06_passage');
      expect(await entitiesOf(page, 'Alchemist')).toHaveLength(1);
      expect(await entitiesOf(page, 'Fountain')).toHaveLength(1);
      expect(await entitiesOf(page, 'Jailer')).toHaveLength(0);
      expect(await misplacedEntities(page)).toEqual([]);
      expect((await page.evaluate(() => (window as any).__ds.game.scene.renderer.tileArt))).toBe(true);

      // fountain refills flask charges
      await page.evaluate(() => { (window as any).__ds.game.run.flasks = 0; });
      await interactKey(page, 'Fountain');
      await expect.poll(async () => (await run(page)).flasks, { timeout: 4_000 }).toBe((await run(page)).maxFlasks);

      // alchemist: not enough cells -> error, then enough -> buy
      await page.evaluate(() => { (window as any).__ds.game.run.cells = 10; });
      await interactKey(page, 'Alchemist');
      await expect.poll(() => modalOpen(page), { timeout: 4_000 }).toBe(true);
      await page.waitForTimeout(600);
      await tapRegion(c, 'alch-buy');
      await page.waitForTimeout(200);
      expect((await run(page)).cells, 'too poor: nothing spent').toBe(10);
      await page.evaluate(() => { (window as any).__ds.game.run.cells = 100; });
      await shot(page, '07_alchemist');
      await tapRegion(c, 'alch-buy');
      await expect.poll(async () => (await run(page)).cells, { timeout: 4_000 }).toBe(70); // flask +1 costs 30
      const save = await savedGame(page);
      expect(save.upgrades.flask, 'purchase persisted to localStorage').toBe(1);
      expect((await run(page)).maxFlasks).toBe(2);
      await tapRegion(c, 'alch-close');
      await expect.poll(() => modalOpen(page), { timeout: 4_000 }).toBe(false);
    });

    await test.step('passage: exit -> ramparts', async () => {
      const ex = (await entitiesOf(page, 'ExitDoor'))[0];
      const res = await walkTo(page, ex);
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
      await page.keyboard.press('KeyF');
      await waitScene(page, 'LevelScene');
      await expect.poll(async () => (await run(page)).biome).toBe('ramparts');
      await watchEvents(page);
    });

    // ------------------------------------------------------------------ biome 2: Moonlit Ramparts
    await test.step('ramparts: its own tileset + parallax, enemies, placement, exit', async () => {
      await page.waitForTimeout(2200);
      await shot(page, '08_ramparts');
      const r = await run(page);
      expect(r).toMatchObject({ levelIndex: 2, kind: 'biome', biome: 'ramparts' });
      const info = await page.evaluate(() => {
        const s = (window as any).__ds.game.scene;
        const a = (window as any).__ds.game.assets;
        const kinds: Record<string, number> = {};
        for (const e of s.world.entities) kinds[e.constructor.name] = (kinds[e.constructor.name] ?? 0) + 1;
        return { tileArt: s.renderer.tileArt as boolean, layers: s.renderer.parallaxLayers as number, kinds, atlas: !!a.image('tiles/ramparts.png') };
      });
      expect(info.tileArt).toBe(true);
      expect(info.atlas).toBe(true);
      expect(info.layers).toBeGreaterThanOrEqual(2);
      expect(info.kinds['Lancer'] ?? 0, 'ramparts roster includes lancers').toBeGreaterThan(0);
      expect(await misplacedEntities(page)).toEqual([]);
      // an item roll at tier 2 / quick interaction sanity: chest opens
      const home = await player(page);
      await interactKey(page, 'Chest');
      await expect.poll(() => page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'Chest')?.opened), { timeout: 5_000 }).toBe(true);
      await teleportNear(page, home.x, home.y, 20); // the chest may sit in a secret room (breakable wall): come back out
      await page.evaluate(() => (window as any).__ds.killAll());
      const ex = (await entitiesOf(page, 'ExitDoor'))[0];
      const res = await walkTo(page, ex);
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
      await page.keyboard.press('KeyF');
      await waitScene(page, 'LevelScene');
      await expect.poll(async () => (await run(page)).kind).toBe('passage');
      await watchEvents(page);
    });

    await test.step('passage 2 (ramparts) -> boss arena', async () => {
      await page.waitForTimeout(1500);
      expect((await run(page)).biome).toBe('ramparts');
      expect(await entitiesOf(page, 'Alchemist')).toHaveLength(1);
      await shot(page, '09_passage2');
      const ex = (await entitiesOf(page, 'ExitDoor'))[0];
      const res = await walkTo(page, ex);
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
      await page.keyboard.press('KeyF');
      await waitScene(page, 'LevelScene');
      await expect.poll(async () => (await run(page)).kind).toBe('boss');
      await watchEvents(page);
    });

    // ------------------------------------------------------------------ boss: The Iron Matron
    await test.step('boss: arena renders, intro triggers (bossStart, title card, boss bar, gate closes)', async () => {
      await page.waitForTimeout(1800);
      await shot(page, '10_boss_arena');
      expect(await page.evaluate(() => (window as any).__ds.game.scene.renderer.tileArt)).toBe(true);
      expect(await entitiesOf(page, 'Matron')).toHaveLength(1);
      expect(await entitiesOf(page, 'BossGate')).toHaveLength(1);
      expect(await misplacedEntities(page)).toEqual([]);
      expect(await events(page, 'bossStart')).toBe(0);
      // walk through the gate into the arena with the real bot, towards the matron
      const m = (await entitiesOf(page, 'Matron'))[0];
      const gate = (await entitiesOf(page, 'BossGate'))[0];
      const res = await walkTo(page, { x: gate.x + 150, y: m.y }, 20);
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
      // keep walking right (real keys) until she wakes up
      for (let i = 0; i < 120 && !(await events(page, 'bossStart')) && !(await page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'Matron')?.state !== 'dormant')); i++) await hold(page, 'KeyD', 150);
      await expect.poll(() => page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'Matron')?.state), { timeout: 8_000 }).not.toBe('dormant');
      await expect.poll(() => events(page, 'bossStart'), { timeout: 10_000, message: 'bossStart event' }).toBe(1);
      await page.waitForTimeout(500);
      const ui = await page.evaluate(() => { const u = (window as any).__ds.game.scene.ui; return { boss: !!u.boss, card: !!u.hud.bossIntroActive }; });
      expect(ui.boss).toBe(true);
      expect(ui.card, 'boss title card visible').toBe(true);
      await shot(page, '11_boss_titlecard');
      await expect.poll(() => page.evaluate(() => (window as any).__ds.game.scene.ui.hud.bossIntroActive), { timeout: 10_000 }).toBe(false);
      await page.waitForTimeout(700);
      await shot(page, '12_boss_fight_start');
      expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.hud.bossFade), 'boss bar shown').toBeGreaterThan(0.5);
      await expect.poll(() => page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'BossGate')?.closed), { timeout: 8_000, message: 'arena gate closed' }).toBe(true);
    });

    await test.step('boss: fight with real attacks, then kill -> bossDefeated -> victory', async () => {
      // soften her to ~40% so the fight is short, then keep hitting for real (dodging is not needed in god mode)
      await page.evaluate(() => { const b = (window as any).__ds.world.entities.find((e: any) => e.constructor.name === 'Matron'); b.hp = Math.round(b.maxHp * 0.4); });
      const hpStart = (await entitiesOf(page, 'Matron'))[0].hp!;
      let shotFight = false;
      for (let i = 0; i < 160; i++) {
        const [m] = await entitiesOf(page, 'Matron');
        if (!m) break;
        if (await events(page, 'bossDefeated')) break;
        const p = await player(page);
        const dx = m.x - p.x;
        if (Math.abs(dx) > 60) {
          if (Math.abs(dx) > 400) await teleportNear(page, m.x - 70, m.y - 2, 10);
          else await hold(page, dx > 0 ? 'KeyD' : 'KeyA', 160);
        } else {
          await hold(page, dx > 0 ? 'KeyD' : 'KeyA', 20);
          await page.keyboard.press('KeyJ');
          await page.waitForTimeout(230);
        }
        if (!shotFight && i === 30) { shotFight = true; await shot(page, '13_boss_fight'); }
      }
      const [mAfter] = await entitiesOf(page, 'Matron');
      const dealt = !mAfter || (mAfter.hp ?? 0) < hpStart;
      expect(dealt, 'real attacks damaged the matron').toBe(true);
      if (!(await events(page, 'bossDefeated'))) {
        // last resort so the rest of the flow still gets verified: finish her off
        await page.evaluate(() => (window as any).__ds.killAll());
        test.info().annotations.push({ type: 'note', description: 'boss finished with killAll (real attacks did not finish her in time)' });
      }
      await expect.poll(() => events(page, 'bossDefeated'), { timeout: 20_000 }).toBeGreaterThan(0);
      await shot(page, '14_boss_defeated');
      await waitScene(page, 'VictoryScene', 30_000);
      await page.waitForTimeout(2500);
      await shot(page, '15_victory');
      const s = await savedGame(page);
      expect(s.wins).toBe(1);
      expect(typeof s.bestTime).toBe('number');
      expect(s.totalKills).toBeGreaterThan(0);
      // the first tap may only complete the typewriter epilogue; the next one leaves
      for (let i = 0; i < 2 && (await sceneName(page)) === 'VictoryScene'; i++) {
        await c.fingers.tap(420, 200);
        await page.waitForTimeout(1000);
      }
      await waitScene(page, 'TitleScene');
      await page.waitForTimeout(1200);
      await shot(page, '16_title_after_win');
    });

    expect(c.errors, 'no console / page errors during the whole run').toEqual([]);
  });

  test('death -> death scene -> retry starts a fresh run', async ({ page }) => {
    const c = await boot(page, { query: '?seed=3' }); // no god mode
    await page.waitForTimeout(1200);
    await c.fingers.tap(420, 200);
    await waitScene(page, 'LevelScene');
    await page.waitForFunction(() => (window as any).__ds.player?.onGround === true);
    await watchEvents(page);
    await page.evaluate(() => { (window as any).__ds.game.run.cells = 55; (window as any).__ds.game.run.gold = 40; });
    await page.evaluate(() => (window as any).__ds.player.takeDamage({ amount: 99999, dir: 1, kind: 'melee' }));
    await expect.poll(() => events(page, 'playerDied'), { timeout: 5_000 }).toBe(1);
    await waitScene(page, 'DeathScene', 10_000);
    await page.waitForTimeout(1500);
    await shot(page, '17_death');
    await c.fingers.tap(420, 150);
    await waitScene(page, 'LevelScene');
    await page.waitForFunction(() => (window as any).__ds.player?.onGround === true);
    const r = await run(page);
    expect(r).toMatchObject({ levelIndex: 0, cells: 0, gold: 0, kills: 0 });
    const p = await player(page);
    expect(p.hp).toBe(p.maxHp);
    expect((await savedGame(page)).runs).toBe(2);
    expect(c.errors).toEqual([]);
  });

  test('HUD: flask heals, map opens, pause freezes the world, sound setting persists, give up -> death scene', async ({ page }) => {
    const c = await boot(page, { query: '?seed=9' }); // no god mode: hp can be lowered
    await page.waitForTimeout(1200);
    await c.fingers.tap(420, 200);
    await waitScene(page, 'LevelScene');
    await page.waitForFunction(() => (window as any).__ds.player?.onGround === true);
    await page.waitForTimeout(3600); // level banner
    // flask: heals and consumes a charge
    await page.evaluate(() => { const p = (window as any).__ds.player; p.hp = 40; });
    const f0 = (await run(page)).flasks;
    await tapRegion(c, 'hud-flask');
    await expect.poll(async () => (await player(page)).hp, { timeout: 5_000 }).toBeGreaterThan(40);
    expect((await run(page)).flasks).toBe(f0 - 1);
    // map
    await tapRegion(c, 'hud-map');
    await expect.poll(() => modalOpen(page), { timeout: 3_000 }).toBe(true);
    await page.waitForTimeout(500);
    await shot(page, '18_map');
    await c.fingers.tap(420, 200); // tap closes
    await expect.poll(() => modalOpen(page), { timeout: 3_000 }).toBe(false);
    // pause: the world is frozen while the card is open
    await tapRegion(c, 'hud-pause');
    await expect.poll(() => modalOpen(page), { timeout: 3_000 }).toBe(true);
    await page.waitForTimeout(500);
    const t0 = await page.evaluate(() => (window as any).__ds.world.time);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => (window as any).__ds.world.time)).toBe(t0);
    await shot(page, '19_pause');
    await tapRegion(c, 'pause1'); // sound toggle
    await expect.poll(async () => (await savedGame(page)).settings.muted, { timeout: 3_000 }).toBe(true);
    await tapRegion(c, 'pause1');
    await expect.poll(async () => (await savedGame(page)).settings.muted, { timeout: 3_000 }).toBe(false);
    await tapRegion(c, 'pause0'); // resume
    await expect.poll(() => modalOpen(page), { timeout: 3_000 }).toBe(false);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__ds.world.time)).toBeGreaterThan(t0);
    // give up (two taps)
    await tapRegion(c, 'hud-pause');
    await expect.poll(() => modalOpen(page), { timeout: 3_000 }).toBe(true);
    await page.waitForTimeout(500);
    await tapRegion(c, 'pause5'); // 포기하기 (after 설정 and 도감)
    await page.waitForTimeout(300);
    await tapRegion(c, 'pause5');
    await waitScene(page, 'DeathScene', 10_000);
    expect(c.errors).toEqual([]);
  });

  test('traversal: the nav bot reaches the exit door with the real player on 8 seeds per biome', async ({ page }) => {
    test.setTimeout(180_000);
    const c = await boot(page, { query: '?seed=1&god=1&mute=1' });
    const failures: string[] = [];
    for (const biome of ['prison', 'ramparts'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        await page.evaluate(([s]) => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.start(s); }, [seed * 13 + 1]);
        await page.waitForFunction(() => { const g = (window as any).__ds.game; return g.scene !== (window as any).__prev && g.scene?.constructor?.name === 'LevelScene' && g.fade < 0.3; }, null, { timeout: 15_000 });
        if (biome === 'ramparts') {
          await page.evaluate(() => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.gotoLevel('ramparts'); });
          await page.waitForFunction(() => { const g = (window as any).__ds.game; return g.scene !== (window as any).__prev && g.scene?.constructor?.name === 'LevelScene' && g.fade < 0.3; }, null, { timeout: 15_000 });
        }
        expect(await misplacedEntities(page), `${biome} #${seed}`).toEqual([]);
        await page.evaluate(() => (window as any).__ds.killAll());
        const ex = (await entitiesOf(page, 'ExitDoor'))[0];
        const res = await walkTo(page, ex, 30, 60 * 600);
        if (!res.ok) failures.push(`${biome} seed ${seed * 13 + 1}: ${JSON.stringify(res)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(c.errors).toEqual([]);
  });

  test('every weapon and skill fights without errors (all enemy kinds of the ramparts)', async ({ page }) => {
    const c = await boot(page, { query: '?seed=4&god=1&mute=1' });
    await page.evaluate(() => (window as any).__ds.start(4));
    await waitScene(page, 'LevelScene');
    await page.evaluate(() => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.gotoLevel('ramparts'); });
    await page.waitForFunction(() => { const g = (window as any).__ds.game; return g.scene !== (window as any).__prev && g.fade < 0.3; });
    const WEAPONS = ['rusty_sword', 'blood_sword', 'spear', 'twin_daggers', 'war_hammer', 'hunter_bow', 'old_shield'];
    const SKILLS = ['fire_grenade', 'ice_grenade', 'turret', 'wolf_trap'];
    const res = await page.evaluate(({ WEAPONS, SKILLS }) => {
      const ds = (window as any).__ds;
      const out: { weapon: string; dealt: number }[] = [];
      WEAPONS.forEach((wid, k) => {
        ds.give(wid, 0); ds.give(WEAPONS[(k + 3) % WEAPONS.length], 1); ds.give(SKILLS[k % 4], 0); ds.give(SKILLS[(k + 1) % 4], 1);
        const w = ds.world, p = w.player, inp = w.input;
        // real enemies only: arrows / bolts / orbs on the enemy team have no hp (a lingering arrow made the sum NaN)
        const en = w.entities.filter((e: any) => e.team === 'enemy' && !e.dead && typeof e.hp === 'number' && e.targetable);
        // a reachable ground target, picked deterministically (not by an index into the live enemy list, which could be a harpy):
        // the nearest non-flyer on her floor (else the nearest non-flyer anywhere), ties by id
        const walker = (e: any) => e.gravityScale !== 0 && !e.dying;
        const dist = (e: any) => Math.hypot(e.x - p.x, e.y - p.y);
        const onFloor = en.filter((e: any) => walker(e) && Math.abs(e.y - p.y) < 60);
        const pool = onFloor.length ? onFloor : en.filter(walker);
        const tgt = pool.sort((a: any, b: any) => dist(a) - dist(b) || a.id - b.id)[0];
        ds.teleport(tgt.x - 60, tgt.y - 2); ds.step(15);
        const hp0 = en.reduce((a: number, e: any) => a + e.hp, 0);
        for (let f = 0; f < 600; f++) {
          const near = w.entities.filter((e: any) => e.team === 'enemy' && !e.dead && !e.dying && e.gravityScale !== 0 && Math.abs(e.y - p.y) < 60 && Math.abs(e.x - p.x) < 300).sort((a: any, b: any) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
          inp.setAxis('sweep', near && Math.abs(near.x - p.x) > 45 ? Math.sign(near.x - p.x) : 0, 0);
          if (f % 14 === 0) inp.tap('attack1');
          if (f % 140 === 70) inp.press('attack2');
          if (f % 140 === 110) inp.release('attack2');
          if (f % 160 === 40) inp.tap('skill1');
          if (f % 160 === 100) inp.tap('skill2');
          if (f % 150 === 20) inp.tap('roll');
          if (f % 180 === 0) inp.tap('jump');
          ds.step(1);
        }
        inp.setAxis('sweep', 0, 0);
        inp.release('attack2');
        ds.step(30);
        out.push({ weapon: wid, dealt: hp0 - w.entities.filter((e: any) => e.team === 'enemy' && !e.dead && typeof e.hp === 'number').reduce((a: number, e: any) => a + e.hp, 0) });
      });
      return out;
    }, { WEAPONS, SKILLS });
    // the shield alone may not deal damage (skills / secondary weapon did the work); everything else must hurt something
    for (const r of res) if (r.weapon !== 'old_shield') expect(r.dealt, `${r.weapon} deals damage`).toBeGreaterThan(0);
    expect(c.errors).toEqual([]);
  });

  for (const [name, garbage] of [
    ['wrong-shaped fields', '{"version":1,"unlocked":"x","upgrades":null,"settings":{"sfx":"loud","hints":5},"runs":"many","bestTime":"fast","totalKills":-4}'],
    ['not JSON at all', '{not json'],
  ] as const) {
    test(`a corrupted save (${name}) does not break the game`, async ({ page }) => {
      await page.addInitScript(([key, raw]) => { try { localStorage.setItem(key as string, raw as string); } catch { /* ignore */ } }, [SAVE_KEY, garbage] as const);
      const c = await boot(page, { query: '?seed=2&god=1' });
      await page.waitForTimeout(1200);
      await c.fingers.tap(420, 200);
      await waitScene(page, 'LevelScene');
      await page.waitForTimeout(1500);
      const ok = await page.evaluate(() => { const sv = (window as any).__ds.game.save; return Array.isArray(sv.unlocked) && sv.unlocked.includes('rusty_sword') && typeof sv.runs === 'number' && sv.totalKills >= 0; });
      expect(ok).toBe(true);
      await page.evaluate(() => (window as any).__ds.gotoLevel('passage'));
      await page.waitForTimeout(1200);
      await waitScene(page, 'LevelScene');
      expect((await run(page)).kind).toBe('passage');
      expect(c.errors).toEqual([]);
    });
  }

  test('deep link to the boss arena works (level=boss) and no input is needed to see the intro', async ({ page }) => {
    const c = await boot(page, { query: '?seed=5&god=1&level=boss' });
    await page.waitForTimeout(1200);
    await c.fingers.tap(420, 200);
    await waitScene(page, 'LevelScene');
    await expect.poll(async () => (await run(page)).kind).toBe('boss');
    expect(await sceneName(page)).toBe('LevelScene');
    expect(c.errors).toEqual([]);
  });

  test('performance: a busy room holds ~60 fps', async ({ page }) => {
    const c = await boot(page, { query: '?seed=11&god=1' });
    await page.waitForTimeout(1200);
    await c.fingers.tap(420, 200);
    await waitScene(page, 'LevelScene');
    await page.waitForFunction(() => (window as any).__ds.player?.onGround === true);
    // find the spot with the most enemies within one screen
    const spot = await page.evaluate(() => {
      const w = (window as any).__ds.world;
      const en = w.entities.filter((e: any) => e.team === 'enemy' && !e.dead);
      let best = { n: 0, x: 0, y: 0 };
      for (const e of en) {
        const n = en.filter((o: any) => Math.abs(o.x - e.x) < 380 && Math.abs(o.y - e.y) < 180).length;
        if (n > best.n) best = { n, x: e.x, y: e.y };
      }
      return best;
    });
    await teleportNear(page, spot.x, spot.y - 2, 5);
    await page.waitForTimeout(500);
    // fight a bit so particles / damage numbers are in play
    for (let i = 0; i < 12; i++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
    await page.waitForTimeout(2500);
    const fps = await page.evaluate(() => (window as any).__game.fps as number);
    test.info().annotations.push({ type: 'fps', description: `${fps.toFixed(1)} fps with ${spot.n} enemies near` });
    expect(fps).toBeGreaterThan(45);
    expect(c.errors).toEqual([]);
  });
});
