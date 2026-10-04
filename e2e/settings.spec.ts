import { test, expect, type Page } from '@playwright/test';
import { boot, tapRegion, regionCentre, waitScene, sceneName, SAVE_KEY, type Ctx } from './helpers';

/**
 * Settings system, driven like a player: real touch (CDP) on the settings screen and on the virtual buttons, a mocked
 * navigator.getGamepads for the pad, every graphics filter / resolution / fit applied while a level is running.
 * Screenshots (844x390, deviceScaleFactor 1) go to e2e-shots/ (git-ignored): LOOK at them.
 */
test.use({ deviceScaleFactor: 1 });

const SHOTS = 'e2e-shots/';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}settings_${name}.png` });

const state = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__ds.game;
    return { ...g.save.settings, gamepadMap: { ...g.save.settings.gamepadMap } } as Record<string, any>;
  });
const stored = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').settings as Record<string, any>, SAVE_KEY);
const player = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__ds.player;
    return p ? { x: p.x as number, y: p.y as number, vy: p.vy as number, onGround: p.onGround as boolean } : null;
  });
const isDown = (page: Page, btn: string) => page.evaluate((b) => (window as any).__ds.game.input.isDown(b) as boolean, btn);

async function startRun(page: Page) {
  await page.evaluate(() => (window as any).__ds.start(1));
  await waitScene(page, 'LevelScene');
  await page.waitForFunction(() => !!(window as any).__ds.player && (window as any).__ds.game.taps.byId('hud-pause'), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/** Open pause -> 설정 of a running level by touch. */
async function openSettingsInGame(c: Ctx) {
  await tapRegion(c, 'hud-pause');
  await tapRegion(c, 'pause3');
  await c.page.waitForFunction(() => (window as any).__ds.game.taps.byId('set-close'));
}

async function closeSettingsInGame(c: Ctx) {
  await tapRegion(c, 'set-close');
  await tapRegion(c, 'pause0'); // resume
  await c.page.waitForFunction(() => !(window as any).__ds.game.scene.ui.modal);
}

/** CSS-pixel centre of a virtual button of the current layout. */
async function vbCentre(page: Page, id: string) {
  const p = await page.evaluate((bid) => {
    const g = (window as any).__ds.game;
    const b = g.vb.layout?.buttons.find((x: any) => x.id === bid);
    if (!b) return null;
    const d = g.display;
    const box = d.canvas.getBoundingClientRect();
    const dpr = d.canvas.width / box.width;
    return { x: box.left + (b.cx * d.scale + d.offsetX) / dpr, y: box.top + (b.cy * d.scale + d.offsetY) / dpr };
  }, id);
  expect(p, `virtual button ${id} is on screen`).not.toBeNull();
  return p!;
}

// ---- mocked gamepad -------------------------------------------------------------------------------

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
const padSet = (page: Page, o: { buttons?: number[]; axes?: [number, number]; present?: boolean }) =>
  page.evaluate((s) => {
    const p = (window as any).__pad;
    if (s.present !== undefined) p.present = s.present;
    if (s.buttons) p.pad.buttons.forEach((b: any, i: number) => { b.pressed = s.buttons!.includes(i); b.value = b.pressed ? 1 : 0; });
    if (s.axes) { p.pad.axes[0] = s.axes[0]; p.pad.axes[1] = s.axes[1]; }
  }, o);
/** a press that the 60 fps loop is sure to see */
async function padTap(page: Page, btn: number, holdMs = 140) {
  await padSet(page, { buttons: [btn] });
  await page.waitForTimeout(holdMs);
  await padSet(page, { buttons: [] });
  await page.waitForTimeout(90);
}

test.describe('settings', () => {
  test('opens from the title by touch; mode, graphics and sound tabs apply and persist', async ({ page }) => {
    const c = await boot(page);
    expect(await sceneName(page)).toBe('TitleScene');
    // the old save has none of the new fields: defaults
    expect(await state(page)).toMatchObject({ controlMode: 'gesture', filter: 'sharp', resolution: 360, fit: 'fill', quality: 'high' });
    await page.waitForTimeout(600);
    // tap target of the title button is large enough
    const rect = await page.evaluate(() => (window as any).__ds.game.taps.byId('settings').rect as { w: number; h: number });
    expect(rect.w).toBeGreaterThanOrEqual(36);
    expect(rect.h).toBeGreaterThanOrEqual(36);
    await tapRegion(c, 'settings');
    await page.waitForFunction(() => !!(window as any).__ds.game.scene.settings);
    expect(await sceneName(page)).toBe('TitleScene'); // tapping it did not start the run
    await shot(page, 'title_control');

    await tapRegion(c, 'set-mode-1');
    expect((await state(page)).controlMode).toBe('buttons');
    expect((await stored(page)).controlMode).toBe('buttons'); // persisted at once
    await tapRegion(c, 'set-size-2');
    await tapRegion(c, 'set-opacity-0');
    expect(await state(page)).toMatchObject({ btnSize: 'large', btnOpacity: 0.35 });
    await shot(page, 'title_buttons');

    await tapRegion(c, 'set-tab-graphics');
    await tapRegion(c, 'set-filter-2');
    await tapRegion(c, 'set-res-2');
    await tapRegion(c, 'set-fit-1');
    await tapRegion(c, 'set-quality-1');
    expect(await state(page)).toMatchObject({ filter: 'crt', resolution: 432, fit: 'integer', quality: 'saver' });
    expect(await stored(page)).toMatchObject({ filter: 'crt', resolution: 432, fit: 'integer', quality: 'saver' });
    await shot(page, 'title_graphics');

    await tapRegion(c, 'set-tab-sound');
    await tapRegion(c, 'set-muted-1');
    expect((await state(page)).muted).toBe(true);
    await tapRegion(c, 'set-muted-0');
    await tapRegion(c, 'set-sfx-2');
    expect((await state(page)).sfx).toBeCloseTo(0.5);

    await tapRegion(c, 'set-close');
    await page.waitForFunction(() => !(window as any).__ds.game.scene.settings);
    // settings survive a reload
    await page.reload();
    await page.waitForFunction(() => (window as any).__ds?.game?.scene?.constructor?.name === 'TitleScene', null, { timeout: 30_000 });
    expect(await state(page)).toMatchObject({ controlMode: 'buttons', btnSize: 'large', filter: 'crt', resolution: 432, fit: 'integer', quality: 'saver' });
    expect(await page.evaluate(() => (window as any).__ds.game.display.gfx)).toMatchObject({ filter: 'crt', resolution: 432 });
    expect(c.errors).toEqual([]);
  });

  test('가상 버튼: real touch on the d-pad moves, the jump button jumps, multi-touch works', async ({ page }) => {
    const c = await boot(page);
    await page.waitForTimeout(600);
    await tapRegion(c, 'settings');
    await tapRegion(c, 'set-mode-1');
    await tapRegion(c, 'set-close');
    await page.waitForFunction(() => !(window as any).__ds.game.scene.settings);
    await startRun(page);
    await page.waitForFunction(() => !!(window as any).__ds.game.vb.layout);
    await shot(page, 'vbuttons_game');

    // the gesture layer is off: a tap on empty right-half screen does nothing, the buttons exist
    const ids = await page.evaluate(() => (window as any).__ds.game.vb.layout.buttons.map((b: any) => b.id as string));
    expect(ids).toEqual(expect.arrayContaining(['left', 'right', 'down', 'attack', 'jump', 'roll', 'sub']));

    const right = await vbCentre(page, 'right');
    const left = await vbCentre(page, 'left');
    const jump = await vbCentre(page, 'jump');
    const attack = await vbCentre(page, 'attack');

    // → moves the player right
    const x0 = (await player(page))!.x;
    await c.fingers.down(1, right.x, right.y);
    await page.waitForTimeout(500);
    expect((await player(page))!.x).toBeGreaterThan(x0 + 25);
    // slide to ←: reverses without lifting the finger
    const x1 = (await player(page))!.x;
    await c.fingers.move(1, (right.x + left.x) / 2, left.y);
    await c.fingers.move(1, left.x, left.y);
    await page.waitForTimeout(500);
    expect((await player(page))!.x).toBeLessThan(x1 - 10);
    await c.fingers.upAll();
    await page.waitForTimeout(250);
    const xs = (await player(page))!.x;
    await page.waitForTimeout(250);
    expect(Math.abs((await player(page))!.x - xs)).toBeLessThan(2); // stopped when the finger lifted

    // jump button
    expect((await player(page))!.onGround).toBe(true);
    const y0 = (await player(page))!.y;
    await c.fingers.down(1, jump.x, jump.y);
    await page.waitForTimeout(220);
    expect(await isDown(page, 'jump')).toBe(true);
    const p = (await player(page))!;
    expect(p.onGround).toBe(false);
    expect(p.y).toBeLessThan(y0 - 8);
    await c.fingers.upAll();
    await page.waitForFunction(() => (window as any).__ds.player.onGround, null, { timeout: 5000 });
    expect(await isDown(page, 'jump')).toBe(false);

    // multi-touch: hold → + jump + attack at once
    await c.fingers.down(1, right.x, right.y);
    await c.fingers.down(2, jump.x, jump.y);
    await c.fingers.down(3, attack.x, attack.y);
    await page.waitForTimeout(160);
    expect(await page.evaluate(() => { const i = (window as any).__ds.game.input; return [i.moveX, i.isDown('jump'), i.isDown('attack1')]; })).toEqual([1, true, true]);
    await shot(page, 'vbuttons_multitouch');
    await c.fingers.upAll(); // Chromium releases every touch point on touchEnd
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => { const i = (window as any).__ds.game.input; return [i.moveX, i.isDown('jump'), i.isDown('attack1')]; })).toEqual([0, false, false]);

    // the HUD flask still works in this mode (UI taps win over gameplay)
    expect(await regionCentre(page, 'hud-flask')).not.toBeNull();
    // a modal hides the buttons and lets go of them
    await tapRegion(c, 'hud-pause');
    await page.waitForFunction(() => !(window as any).__ds.game.vb.layout);
    await tapRegion(c, 'pause0');
    await page.waitForFunction(() => !!(window as any).__ds.game.vb.layout);
    expect(c.errors).toEqual([]);
  });

  test('게임패드 (mocked): connect toast, stick moves, A jumps, remap, menus by pad', async ({ page }) => {
    await mockPad(page);
    const c = await boot(page);
    await page.waitForTimeout(600);

    // connect -> toast + status
    await padSet(page, { present: true });
    await page.waitForFunction(() => (window as any).__ds.game.pad.connected);
    const toast = await page.evaluate(() => (window as any).__ds.game.toasts.map((t: any) => t.text as string));
    expect(toast.join('|')).toContain('게임패드 연결됨: Mock Xbox Controller');
    expect(await page.evaluate(() => (window as any).__ds.game.input.device)).toBe('gamepad'); // hints follow the pad
    await page.waitForTimeout(300);
    await shot(page, 'pad_toast');

    // title menu by pad: d-pad right selects 설정, A opens it
    await padTap(page, 15);
    await padTap(page, 0);
    await page.waitForFunction(() => !!(window as any).__ds.game.scene.settings);
    expect(await sceneName(page)).toBe('TitleScene');
    expect(await page.evaluate(() => (window as any).__ds.game.input.device)).toBe('gamepad');
    // mode row is focused: right, right -> 게임패드
    await padTap(page, 15);
    await padTap(page, 15);
    expect((await state(page)).controlMode).toBe('gamepad');
    await page.waitForTimeout(300);
    await shot(page, 'pad_settings');

    // remap by touch: 공격 -> A (swaps with 점프, which gets X)
    await tapRegion(c, 'set-pad-attack1');
    await page.waitForFunction(() => (window as any).__ds.game.scene.settings.listen === 'attack1');
    await padTap(page, 13); // D-pad is refused
    expect((await state(page)).gamepadMap.attack1).toBe(2);
    await padTap(page, 0);
    await page.waitForFunction(() => (window as any).__ds.game.save.settings.gamepadMap.attack1 === 0);
    const map = (await state(page)).gamepadMap;
    expect(map).toMatchObject({ attack1: 0, jump: 2, roll: 1 });
    expect((await stored(page)).gamepadMap).toMatchObject({ attack1: 0, jump: 2 });
    await page.waitForTimeout(300);
    await shot(page, 'pad_remapped');
    // B closes the settings
    await padTap(page, 1);
    await page.waitForFunction(() => !(window as any).__ds.game.scene.settings);

    // start the run with the pad (A is 공격 now; it also confirms)
    await padTap(page, 0);
    await waitScene(page, 'LevelScene');
    await page.waitForFunction(() => !!(window as any).__ds.player && (window as any).__ds.game.fade < 0.1, null, { timeout: 15_000 });
    await page.waitForTimeout(600);
    // no touch controls in this mode
    expect(await page.evaluate(() => (window as any).__ds.game.vb.layout)).toBeNull();

    // left stick moves
    const x0 = (await player(page))!.x;
    await padSet(page, { axes: [1, 0] });
    await page.waitForTimeout(500);
    expect((await player(page))!.x).toBeGreaterThan(x0 + 25);
    await padSet(page, { axes: [0.15, 0] }); // inside the dead-zone: stops
    await page.waitForTimeout(250);
    const xs = (await player(page))!.x;
    await page.waitForTimeout(250);
    expect(Math.abs((await player(page))!.x - xs)).toBeLessThan(2);
    await padSet(page, { axes: [0, 0] });

    // remapped: A = 공격, X = 점프
    await padSet(page, { buttons: [0] });
    await page.waitForTimeout(100);
    expect(await isDown(page, 'attack1')).toBe(true);
    expect(await isDown(page, 'jump')).toBe(false);
    await padSet(page, { buttons: [] });
    await page.waitForTimeout(500);
    const y0 = (await player(page))!.y;
    await padSet(page, { buttons: [2] });
    await page.waitForTimeout(220);
    expect(await isDown(page, 'jump')).toBe(true);
    expect((await player(page))!.onGround).toBe(false);
    expect((await player(page))!.y).toBeLessThan(y0 - 8);
    await padSet(page, { buttons: [] });
    await page.waitForFunction(() => (window as any).__ds.player.onGround, null, { timeout: 5000 });

    // Start = pause; d-pad moves the selection, A confirms, B goes back
    await padTap(page, 9);
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.modal);
    // while paused the stick must not move the (frozen) player and gameplay buttons do not leak
    const frozen = (await player(page))!.x;
    await padSet(page, { axes: [1, 0] });
    await page.waitForTimeout(250);
    await padSet(page, { axes: [0, 0] });
    expect((await player(page))!.x).toBe(frozen);
    // the stick also moved the menu selection (right = next); walk it to 설정 (4th button) with the d-pad
    for (let i = 0; i < 6 && (await page.evaluate(() => (window as any).__ds.game.scene.ui.top.sel)) !== 3; i++) await padTap(page, 13);
    expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.top.sel)).toBe(3);
    await padTap(page, 0);
    await page.waitForFunction(() => !!(window as any).__ds.game.taps.byId('set-close'));
    await padTap(page, 15); // 조작 방식: 게임패드 -> (clamped)
    await padTap(page, 1); // B: back to the pause menu
    await page.waitForFunction(() => !(window as any).__ds.game.taps.byId('set-close'));
    expect(await page.evaluate(() => (window as any).__ds.game.scene.ui.modal)).toBe(true);
    await padTap(page, 1); // B closes the pause menu
    await page.waitForFunction(() => !(window as any).__ds.game.scene.ui.modal);
    // Start / Back also open pause / map
    await padTap(page, 8);
    await page.waitForFunction(() => (window as any).__ds.game.scene.ui.top?.constructor?.name === 'MapModal');
    await padTap(page, 8);
    await page.waitForFunction(() => !(window as any).__ds.game.scene.ui.modal);

    // unplugging releases everything
    await padSet(page, { buttons: [0], axes: [1, 0] });
    await page.waitForTimeout(150);
    await padSet(page, { present: false });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => { const i = (window as any).__ds.game.input; return [i.moveX, i.isDown('attack1')]; })).toEqual([0, false]);
    expect(await page.evaluate(() => (window as any).__ds.game.pad.connected)).toBe(false);
    expect(c.errors).toEqual([]);
  });

  test('게임패드: death and victory screens are navigable (A = continue, B = title)', async ({ page }) => {
    await mockPad(page);
    const c = await boot(page);
    await padSet(page, { present: true });
    await page.waitForFunction(() => (window as any).__ds.game.pad.connected);
    await startRun(page);
    // death: B goes to the title, A retries
    await page.evaluate(() => (window as any).__ds.game.playerDied());
    await waitScene(page, 'DeathScene');
    await page.waitForTimeout(1300); // the screen ignores input for its first second
    await padTap(page, 1);
    await waitScene(page, 'TitleScene');
    await page.waitForTimeout(600);
    await padTap(page, 0); // A starts a run from the title
    await waitScene(page, 'LevelScene');
    await page.evaluate(() => (window as any).__ds.game.playerDied());
    await waitScene(page, 'DeathScene');
    await page.waitForTimeout(1300);
    await padTap(page, 0);
    await waitScene(page, 'LevelScene'); // retry
    // victory: the first A finishes the epilogue, the next one returns to the title
    await page.evaluate(() => (window as any).__ds.game.victory());
    await waitScene(page, 'VictoryScene');
    await page.waitForTimeout(1200);
    await padTap(page, 0);
    await page.waitForTimeout(300);
    expect(await sceneName(page)).toBe('VictoryScene');
    await padTap(page, 0);
    await waitScene(page, 'TitleScene');
    expect(c.errors).toEqual([]);
  });

  test('graphics: every filter and resolution applies live, the world still renders', async ({ page }) => {
    const c = await boot(page);
    await startRun(page);
    const scaleOf = () => page.evaluate(() => (window as any).__ds.game.display.scale as number);
    const flask0 = await page.evaluate(() => (window as any).__ds.game.taps.byId('hud-flask').rect);
    const scale0 = await scaleOf();
    await openSettingsInGame(c);
    await tapRegion(c, 'set-tab-graphics');

    /** the screen layer must show a real picture: many distinct colours inside the picture area */
    const rendered = () =>
      page.evaluate(() => {
        const d = (window as any).__ds.game.display;
        const v = d.layout;
        // copy to a CPU canvas first (reading the visible canvas back repeatedly makes Chromium warn)
        const t = document.createElement('canvas');
        t.width = Math.round(v.viewW);
        t.height = Math.round(v.viewH);
        const x = t.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(d.screen, v.offsetX, v.offsetY, t.width, t.height, 0, 0, t.width, t.height);
        const img = x.getImageData(0, 0, t.width, t.height);
        const seen = new Set<number>();
        for (let i = 0; i < img.data.length; i += 4 * 37) seen.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
        return seen.size;
      });

    const filters = ['sharp', 'smooth', 'crt', 'lcd', 'vivid', 'mono'];
    for (let i = 0; i < filters.length; i++) {
      await tapRegion(c, `set-filter-${i}`);
      await page.waitForTimeout(250);
      const info = await page.evaluate(() => {
        const d = (window as any).__ds.game.display;
        return { filter: d.gfx.filter as string, css: d.screen.style.filter as string, smooth: d.sctx.imageSmoothingEnabled as boolean, rendering: d.screen.style.imageRendering as string };
      });
      expect(info.filter).toBe(filters[i]);
      expect(info.css !== '').toBe(filters[i] === 'vivid' || filters[i] === 'mono');
      expect(info.rendering).toBe(filters[i] === 'smooth' ? 'auto' : 'pixelated');
      expect(await rendered(), `filter ${filters[i]} renders a picture`).toBeGreaterThan(12);
      expect(c.errors).toEqual([]);
    }
    // CRT / LCD: look at them (settings screen open, then the plain game)
    await tapRegion(c, 'set-filter-3');
    await page.waitForTimeout(300);
    await shot(page, 'lcd_menu');
    await tapRegion(c, 'set-filter-2');
    await page.waitForTimeout(300);
    await shot(page, 'crt_menu');
    await closeSettingsInGame(c);
    await page.waitForTimeout(400);
    await shot(page, 'crt_game');
    await openSettingsInGame(c);
    await tapRegion(c, 'set-tab-graphics');

    // resolutions
    for (const [i, h] of [[0, 288], [1, 360], [2, 432]] as const) {
      await tapRegion(c, `set-res-${i}`);
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => {
        const d = (window as any).__ds.game.display;
        const w = (window as any).__ds.world;
        return { worldH: d.worldH as number, worldW: d.worldW as number, canvasH: d.worldCanvas.height as number, canvasW: d.worldCanvas.width as number, uiH: d.H as number, uiW: d.W as number, cam: [w.camera.w, w.camera.h] };
      });
      expect(info.worldH).toBe(h);
      expect(info.canvasH).toBe(h);
      expect(info.canvasW).toBe(info.worldW);
      expect(info.worldW / info.worldH).toBeCloseTo(info.uiW / info.uiH, 1);
      expect(info.uiH).toBe(360);
      expect(await scaleOf()).toBeCloseTo(scale0, 5); // UI keeps the same on-screen size
      expect(await rendered(), `${h}p renders a picture`).toBeGreaterThan(12);
      expect(c.errors).toEqual([]);
    }
    await tapRegion(c, 'set-res-2'); // 432
    await closeSettingsInGame(c);
    // the camera follows the new buffer and the HUD did not move
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => { const w = (window as any).__ds.world; return [w.camera.w, w.camera.h]; })).toEqual(
      await page.evaluate(() => { const d = (window as any).__ds.game.display; return [d.worldW, d.worldH]; }),
    );
    expect(await page.evaluate(() => (window as any).__ds.game.taps.byId('hud-flask').rect)).toEqual(flask0);
    await shot(page, 'crt_432p_game');
    // 432p with the plain pixel filter
    await openSettingsInGame(c);
    await tapRegion(c, 'set-tab-graphics');
    await tapRegion(c, 'set-filter-0');
    await closeSettingsInGame(c);
    await page.waitForTimeout(400);
    await shot(page, '432p_game');

    // integer scaling: pixel-perfect, letterboxed
    await openSettingsInGame(c);
    await tapRegion(c, 'set-tab-graphics');
    await tapRegion(c, 'set-fit-1');
    await tapRegion(c, 'set-filter-0');
    await tapRegion(c, 'set-res-1');
    await page.waitForTimeout(300);
    const L = await page.evaluate(() => {
      const d = (window as any).__ds.game.display;
      const t = document.createElement('canvas');
      t.width = t.height = 4;
      const x = t.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(d.screen, 0, 0, 4, 4, 0, 0, 4, 4);
      const px = x.getImageData(2, 2, 1, 1).data;
      return { ...d.layout, canvas: [d.canvas.width, d.canvas.height], corner: [px[0], px[1], px[2]] };
    });
    expect(L.integer).toBeGreaterThanOrEqual(1);
    expect(L.viewW).toBe(L.worldW * L.integer);
    expect(L.viewH).toBe(L.worldH * L.integer);
    expect(L.offsetX > 0 || L.offsetY > 0).toBe(true); // bars
    expect(L.offsetX).toBe(Math.floor((L.canvas[0] - L.viewW) / 2));
    expect(L.corner).toEqual([0, 0, 0]);
    expect(await rendered()).toBeGreaterThan(12);
    await shot(page, 'integer_fit');
    // back to fill: no bars
    await tapRegion(c, 'set-fit-0');
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => (window as any).__ds.game.display.layout.integer)).toBe(0);
    // battery saver: DPR 1 canvas
    await tapRegion(c, 'set-quality-1');
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => { const d = (window as any).__ds.game.display; return d.canvas.width <= Math.round(d.canvas.clientWidth) + 1; })).toBe(true);
    await closeSettingsInGame(c);
    expect(c.errors).toEqual([]);
  });

  test('gestures still work (default mode) and 터치 제스처 hides the virtual buttons', async ({ page }) => {
    const c = await boot(page);
    await startRun(page);
    expect(await page.evaluate(() => (window as any).__ds.game.vb.layout)).toBeNull();
    const x0 = (await player(page))!.x;
    // floating stick on the left half
    await c.fingers.down(1, 200, 250);
    await c.fingers.move(1, 230, 250);
    await c.fingers.move(1, 270, 250);
    await page.waitForTimeout(400);
    expect((await player(page))!.x).toBeGreaterThan(x0 + 20);
    await c.fingers.upAll();
    expect(c.errors).toEqual([]);
  });
});
