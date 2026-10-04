import { test, expect, type Page } from '@playwright/test';
import { boot, tapRegion, regionCentre, waitScene, sceneName } from './helpers';

/**
 * 도감 (codex), driven like a player: real touch (CDP) on the title screen and in the pause menu, the keyboard, and a
 * mocked navigator.getGamepads. Screenshots (844x390, deviceScaleFactor 1, one per tab) go to e2e-shots/ (git-ignored):
 * LOOK at them.
 */
test.use({ deviceScaleFactor: 1 });

const TABS = ['weapon', 'skill', 'enemy', 'boss', 'item'] as const;
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e-shots/codex_${name}.png` });

const codex = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__ds.game;
    const c = g.scene.codex ?? g.scene.ui?.top?.screen;
    return c
      ? { tab: c.tab as string, sel: c.sel[c.tabIdx] as number, id: c.current.id as string, anim: c.animIndex as number, list: c.listOffset as number, body: c.bodyOffset as number, max: c.bodyMax as number, n: c.entries().length as number }
      : null;
  });
const entryIds = (page: Page) =>
  page.evaluate(() => ((window as any).__ds.game.taps.regions as { id: string }[]).map((r) => r.id).filter((id) => id.startsWith('codex-entry-')));

async function startRun(page: Page) {
  await page.evaluate(() => (window as any).__ds.start(1));
  await waitScene(page, 'LevelScene');
  await page.waitForFunction(() => !!(window as any).__ds.player && (window as any).__ds.game.taps.byId('hud-pause'), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/** mocked gamepad (standard layout) */
async function mockPad(page: Page) {
  await page.addInitScript(() => {
    const pad = {
      id: 'Mock Xbox Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as any).__pad = { pad, present: false };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => ((window as any).__pad.present ? [pad, null, null, null] : [null, null, null, null]),
    });
  });
}
const padSet = (page: Page, o: { buttons?: number[]; present?: boolean; axes?: number[] }) =>
  page.evaluate((s) => {
    const p = (window as any).__pad;
    if (s.present !== undefined) p.present = s.present;
    if (s.axes) s.axes.forEach((v, i) => { p.pad.axes[i] = v; });
    if (s.buttons) p.pad.buttons.forEach((b: any, i: number) => { b.pressed = s.buttons!.includes(i); b.value = b.pressed ? 1 : 0; });
  }, o);
async function padTap(page: Page, btn: number, holdMs = 140) {
  await padSet(page, { buttons: [btn] });
  await page.waitForTimeout(holdMs);
  await padSet(page, { buttons: [] });
  await page.waitForTimeout(90);
}

test.describe('codex (도감)', () => {
  test('title: the 도감 button opens it by touch; every tab, entries, preview taps, list drag, close', async ({ page }) => {
    const c = await boot(page);
    await page.waitForTimeout(600);
    // the button: >= 36 px target, same size as 설정, sitting left of it
    const rects = await page.evaluate(() => {
      const t = (window as any).__ds.game.taps;
      return { codex: t.byId('codex').rect as { x: number; y: number; w: number; h: number }, settings: t.byId('settings').rect as { x: number; y: number; w: number; h: number } };
    });
    expect(rects.codex.w).toBeGreaterThanOrEqual(36);
    expect(rects.codex.h).toBeGreaterThanOrEqual(36);
    expect(rects.codex.w).toBe(rects.settings.w);
    expect(rects.codex.h).toBe(rects.settings.h);
    expect(rects.codex.x + rects.codex.w).toBeLessThanOrEqual(rects.settings.x);
    await shot(page, 'title');

    await tapRegion(c, 'codex');
    await page.waitForFunction(() => !!(window as any).__ds.game.scene.codex);
    expect(await sceneName(page)).toBe('TitleScene'); // tapping it did not start the run
    await page.waitForTimeout(400);
    expect((await codex(page))!.tab).toBe('weapon');

    for (const tab of TABS) {
      await tapRegion(c, `codex-tab-${tab}`);
      await expect.poll(async () => (await codex(page))!.tab).toBe(tab);
      await page.waitForTimeout(450);
      const ids = await entryIds(page);
      expect(ids.length, `${tab}: entries on screen`).toBeGreaterThanOrEqual(3);
      // select a few entries by touch (the 2nd, the 3rd, then back to the 1st)
      for (const k of [1, 2, 0]) {
        await tapRegion(c, ids[k]);
        await expect.poll(async () => `codex-entry-${(await codex(page))!.id}`).toBe(ids[k]);
      }
      // tap the preview: the next animation
      const before = (await codex(page))!.anim;
      await tapRegion(c, 'codex-preview');
      const steps = await page.evaluate(() => (window as any).__ds.game.scene.codex.current.preview.steps.length as number);
      if (steps > 1) await expect.poll(async () => (await codex(page))!.anim).toBe((before + 1) % steps);
      await page.waitForTimeout(600);
      await shot(page, tab);
    }

    // the enemy list is long: a drag scrolls it, a quick flick keeps going
    await tapRegion(c, 'codex-tab-enemy');
    await page.waitForTimeout(300);
    const list = (await regionCentre(c.page, 'codex-list'))!;
    expect((await codex(page))!.list).toBe(0);
    await c.fingers.down(1, list.x, list.y + 120);
    await c.fingers.drag(1, [list.x, list.y + 120], [list.x, list.y - 60], 5, 12);
    await c.fingers.upAll();
    const dragged = (await codex(page))!.list;
    expect(dragged).toBeGreaterThan(40);
    await page.waitForTimeout(700);
    expect((await codex(page))!.list).toBeGreaterThanOrEqual(dragged); // never snaps back
    await shot(page, 'enemy_scrolled');
    expect(await sceneName(page)).toBe('TitleScene');

    // 닫기 returns to the title (and a tap on the title still starts the run afterwards)
    await tapRegion(c, 'codex-close');
    await page.waitForFunction(() => !(window as any).__ds.game.scene.codex);
    expect(await sceneName(page)).toBe('TitleScene');
    expect(c.errors).toEqual([]);
  });

  test('title: every entry of every tab can be visited with the keyboard (←→ Q/E tabs, ↑↓ entries, Enter, Esc)', async ({ page }) => {
    const c = await boot(page);
    await page.waitForTimeout(700);
    await page.keyboard.press('ArrowLeft'); // start -> 도감 (the button left of 설정)
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!(window as any).__ds.game.scene.codex);
    await page.waitForTimeout(300);
    expect((await codex(page))!.tab).toBe('weapon');
    await page.keyboard.press('ArrowRight');
    expect((await codex(page))!.tab).toBe('skill');
    await page.keyboard.press('KeyE');
    expect((await codex(page))!.tab).toBe('enemy');
    await page.keyboard.press('KeyQ');
    await page.keyboard.press('ArrowLeft');
    expect((await codex(page))!.tab).toBe('weapon');
    await page.keyboard.press('ArrowLeft'); // wraps to the last tab
    expect((await codex(page))!.tab).toBe('item');
    await page.keyboard.press('ArrowRight');

    // walk every entry of every tab with ↑↓: the selection moves one at a time and each page draws
    for (const tab of TABS) {
      await page.evaluate((t) => { const s = (window as any).__ds.game.scene.codex; s.setTab(['weapon', 'skill', 'enemy', 'boss', 'item'].indexOf(t)); s.select(0); }, tab);
      const n = (await codex(page))!.n;
      for (let i = 1; i < n; i++) {
        await page.keyboard.press('ArrowDown');
        expect((await codex(page))!.sel, `${tab} ${i}`).toBe(i);
      }
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
    }

    // a held arrow key repeats (long lists)
    await page.evaluate(() => { const s = (window as any).__ds.game.scene.codex; s.setTab(2); s.select(0); });
    for (let i = 0; i < 6; i++) await page.keyboard.down('ArrowDown');
    await page.keyboard.up('ArrowDown');
    expect((await codex(page))!.sel).toBe(6);

    // Enter = next animation
    await page.keyboard.press('Enter');
    expect((await codex(page))!.anim).toBe(1);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__ds.game.scene.codex);
    expect(await sceneName(page)).toBe('TitleScene');
    expect(c.errors).toEqual([]);
  });

  test('title: the gamepad drives it (D-pad, LB / RB tabs, A next animation, B back)', async ({ page }) => {
    await mockPad(page);
    const c = await boot(page);
    await page.waitForTimeout(700);
    await padSet(page, { present: true });
    await page.waitForTimeout(150);
    await padTap(page, 14); // left: start -> 도감
    await padTap(page, 0); // A
    await page.waitForFunction(() => !!(window as any).__ds.game.scene.codex);
    expect(await sceneName(page)).toBe('TitleScene');
    await page.waitForTimeout(300);
    expect((await codex(page))!.tab).toBe('weapon');
    await padTap(page, 5); // RB
    await padTap(page, 5);
    expect((await codex(page))!.tab).toBe('enemy');
    await padTap(page, 4); // LB
    expect((await codex(page))!.tab).toBe('skill');
    await padTap(page, 15); // d-pad right = next tab, too
    expect((await codex(page))!.tab).toBe('enemy');
    await padTap(page, 13); // down
    await padTap(page, 13);
    expect((await codex(page))!.sel).toBe(2);
    await padTap(page, 12); // up
    expect((await codex(page))!.sel).toBe(1);
    await padTap(page, 0); // A: next animation
    expect((await codex(page))!.anim).toBe(1);
    // the pad does not leak into the title (A would otherwise start the run)
    expect(await sceneName(page)).toBe('TitleScene');
    await padTap(page, 1); // B
    await page.waitForFunction(() => !(window as any).__ds.game.scene.codex);
    expect(await sceneName(page)).toBe('TitleScene');
    expect(c.errors).toEqual([]);
  });

  test('pause menu: 도감 opens over the paused run, every tab works, the run stays paused until resumed', async ({ page }) => {
    const c = await boot(page);
    await startRun(page);
    await tapRegion(c, 'hud-pause');
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.modal);
    await page.waitForTimeout(400);
    await shot(page, 'pause_menu');
    const t0 = await page.evaluate(() => (window as any).__ds.world.time as number);
    await tapRegion(c, 'pause4'); // 도감 (설정 is pause3)
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.top?.constructor?.name === 'CodexModal');
    await page.waitForTimeout(400);
    expect((await codex(page))!.tab).toBe('weapon');
    for (const tab of TABS) {
      await tapRegion(c, `codex-tab-${tab}`);
      await expect.poll(async () => (await codex(page))!.tab).toBe(tab);
      await page.waitForTimeout(250);
      const ids = await entryIds(page);
      await tapRegion(c, ids[1]);
      await tapRegion(c, 'codex-preview');
      if (tab === 'boss') await shot(page, 'pause_boss');
    }
    // Q / E and the pad shoulder buttons switch tabs here as well
    await page.keyboard.press('KeyQ');
    expect((await codex(page))!.tab).toBe('boss');
    await page.keyboard.press('KeyE');
    expect((await codex(page))!.tab).toBe('item');
    await page.keyboard.press('ArrowDown'); // the item tab had its 2nd entry selected above
    expect((await codex(page))!.sel).toBe(2);
    // the world did not move while the codex was open
    expect(await page.evaluate(() => (window as any).__ds.world.time as number)).toBe(t0);
    // Esc goes back to the pause menu (not into the game), the close button too
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.top?.constructor?.name === 'PauseModal');
    await page.waitForTimeout(300);
    await tapRegion(c, 'pause4');
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.top?.constructor?.name === 'CodexModal');
    await page.waitForTimeout(300);
    await tapRegion(c, 'codex-close');
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.top?.constructor?.name === 'PauseModal');
    expect(await page.evaluate(() => (window as any).__ds.world.time as number)).toBe(t0);
    // resume: the run goes on
    await tapRegion(c, 'pause0');
    await page.waitForFunction(() => !(window as any).__ds.game.scene.ui.modal);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__ds.world.time as number)).toBeGreaterThan(t0);
    expect(await sceneName(page)).toBe('LevelScene');
    expect(c.errors).toEqual([]);
  });

  test('a page taller than its panel scrolls with the keyboard and the right stick (final boss at 667x375 = 640x360)', async ({ page }) => {
    await mockPad(page);
    await page.setViewportSize({ width: 667, height: 375 });
    const c = await boot(page);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => (window as any).__ds.game.display.H as number)).toBe(360);
    await page.keyboard.press('ArrowLeft'); // start -> 도감
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!(window as any).__ds.game.scene.codex);
    await page.waitForTimeout(300);
    await page.evaluate(() => { const s = (window as any).__ds.game.scene.codex; s.setTab(3); s.select(4); }); // 강철 여교도관
    await page.waitForTimeout(400);
    const start = (await codex(page))!;
    expect(start.id).toBe('matron');
    expect(start.body).toBe(0);
    expect(start.max, 'the page does not fit, so it must be scrollable').toBeGreaterThan(20);
    await shot(page, 'boss_matron_top');

    // the keyboard (these did nothing before): PageDown, End, Home, Shift+arrows; Space is still "next animation"
    await page.keyboard.press('PageDown');
    expect((await codex(page))!.body).toBeGreaterThan(0);
    await page.keyboard.press('End');
    expect((await codex(page))!.body).toBe(start.max);
    await page.waitForTimeout(150);
    await shot(page, 'boss_matron_end'); // the last row (보상) is fully visible
    await page.keyboard.press('PageUp');
    expect((await codex(page))!.body).toBeLessThan(start.max);
    await page.keyboard.press('Home');
    expect((await codex(page))!.body).toBe(0);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    const two = await codex(page);
    expect(two!.body).toBe(Math.min(start.max, 56));
    expect(two!.sel, 'Shift+arrows scroll the text, they do not pick another entry').toBe(4);
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowUp');
    expect((await codex(page))!.body).toBe(0);
    await page.keyboard.press('Space');
    expect((await codex(page))!.anim).toBe(1);
    expect((await codex(page))!.body).toBe(0);
    await page.keyboard.press('ArrowUp'); // a plain arrow still picks the previous entry (and starts it at the top)
    expect((await codex(page))!.sel).toBe(3);
    await page.keyboard.press('ArrowDown');
    expect((await codex(page))!.sel).toBe(4);

    // the right stick: held down it scrolls to the end, held up it comes back; it never leaks into the title
    await padSet(page, { present: true });
    await page.waitForTimeout(150);
    await padSet(page, { axes: [0, 0, 0, 1] });
    await expect.poll(async () => (await codex(page))!.body, { timeout: 4000 }).toBe(start.max);
    await padSet(page, { axes: [0, 0, 0, 0] });
    await padSet(page, { axes: [0, 0, 0, -1] });
    await expect.poll(async () => (await codex(page))!.body, { timeout: 4000 }).toBe(0);
    await padSet(page, { axes: [0, 0, 0, 0] });
    await page.waitForTimeout(150);
    expect((await codex(page))!.sel).toBe(4);
    expect(await sceneName(page)).toBe('TitleScene');

    // touch still works: a drag scrolls the same offset
    const body = (await regionCentre(c.page, 'codex-body'))!;
    await c.fingers.down(1, body.x, body.y + 40);
    await c.fingers.drag(1, [body.x, body.y + 40], [body.x, body.y - 10], 5, 12);
    await c.fingers.upAll();
    await page.waitForTimeout(700);
    expect((await codex(page))!.body).toBeGreaterThan(0);
    expect((await codex(page))!.body).toBeLessThanOrEqual(start.max);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__ds.game.scene.codex);
    expect(c.errors).toEqual([]);
  });

  test('pause menu: PageDown and the right stick scroll the detail of the open codex', async ({ page }) => {
    await mockPad(page);
    await page.setViewportSize({ width: 667, height: 375 });
    const c = await boot(page);
    await startRun(page);
    await tapRegion(c, 'hud-pause');
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.modal);
    await page.waitForTimeout(400);
    await tapRegion(c, 'pause4');
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.top?.constructor?.name === 'CodexModal');
    await page.waitForTimeout(400);
    await page.evaluate(() => { const s = (window as any).__ds.game.scene.ui.top.screen; s.setTab(3); s.select(4); });
    await page.waitForTimeout(300);
    const start = (await codex(page))!;
    expect(start.max).toBeGreaterThan(20);
    await page.keyboard.press('PageDown');
    expect((await codex(page))!.body).toBeGreaterThan(0);
    await page.keyboard.press('End');
    expect((await codex(page))!.body).toBe(start.max);
    await page.keyboard.press('Home');
    expect((await codex(page))!.body).toBe(0);
    await padSet(page, { present: true });
    await page.waitForTimeout(150);
    await padSet(page, { axes: [0, 0, 0, 1] });
    await expect.poll(async () => (await codex(page))!.body, { timeout: 4000 }).toBe(start.max);
    await padSet(page, { axes: [0, 0, 0, 0] });
    await shot(page, 'pause_boss_end');
    expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top?.constructor?.name)).toBe('CodexModal');
    expect(c.errors).toEqual([]);
  });
});
