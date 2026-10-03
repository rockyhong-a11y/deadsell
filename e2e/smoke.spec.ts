import { test, expect, type Page, type CDPSession } from '@playwright/test';

/**
 * Mobile-landscape smoke test with REAL touch input: events go through the browser's
 * input pipeline (CDP Input.dispatchTouchEvent → Pointer Events → touch.ts), not through
 * game internals. `window.__ds` (debug hooks) is only used to read state.
 */

const SAVE_KEY = 'deadsell.save.v1';

/** Multi-finger helper on top of CDP touch events. */
class Fingers {
  private pts = new Map<number, { x: number; y: number }>();
  constructor(private cdp: CDPSession) {}

  private points() {
    return [...this.pts].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 6, radiusY: 6, force: 1 }));
  }
  async down(id: number, x: number, y: number) {
    this.pts.set(id, { x, y });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.points() });
  }
  async move(id: number, x: number, y: number) {
    this.pts.set(id, { x, y });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() });
  }
  /** Chromium releases every active touch point on touchEnd. */
  async upAll() {
    this.pts.clear();
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async tap(x: number, y: number, holdMs = 40) {
    await this.down(9, x, y);
    await new Promise((r) => setTimeout(r, holdMs));
    await this.upAll();
  }
  /** Drag in small steps (like a real thumb) */
  async drag(id: number, from: [number, number], to: [number, number], steps = 5, stepMs = 12) {
    for (let i = 1; i <= steps; i++) {
      await this.move(id, from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }
}

interface Ctx {
  page: Page;
  fingers: Fingers;
  errors: string[];
}

async function boot(page: Page, opts: { hints: boolean } = { hints: false }): Promise<Ctx> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // optional art (title.png, bg/*, ...) may be missing: the game has placeholders for it (DESIGN §8.4)
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
  });
  await page.addInitScript(([key, hints]) => {
    try {
      localStorage.setItem(key as string, JSON.stringify({ version: 1, settings: { sfx: 0.8, music: 0.5, hints, muted: false } }));
    } catch { /* ignore */ }
  }, [SAVE_KEY, opts.hints] as const);
  await page.goto('/?seed=1&mute=1&god=1');
  await page.waitForFunction(() => (window as any).__ds?.game?.scene?.constructor?.name === 'TitleScene', null, { timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);
  return { page, fingers: new Fingers(cdp), errors };
}

const sceneName = (page: Page) => page.evaluate(() => (window as any).__ds.game.scene?.constructor?.name as string);
const playerState = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__ds.player;
    return p ? { x: p.x as number, y: p.y as number, vy: p.vy as number, onGround: p.onGround as boolean } : null;
  });

async function startRunByTouch(c: Ctx) {
  await c.page.waitForTimeout(1200); // title fade-in (taps are accepted immediately, this just lets the fade finish)
  await c.fingers.tap(420, 200);
  await c.page.waitForFunction(() => (window as any).__ds.game.scene?.constructor?.name === 'LevelScene', null, { timeout: 15_000 });
  await c.page.waitForFunction(() => (window as any).__ds.player?.onGround === true, null, { timeout: 15_000 });
  await c.page.evaluate(() => {
    const i = (window as any).__ds.game.input;
    (window as any).__log = [];
    for (const m of ['tap', 'press', 'release'] as const) {
      const orig = i[m].bind(i);
      i[m] = (b: string) => {
        // a roll gesture sets rollDir right before tapping 'roll': record it with the event
        (window as any).__log.push(b === 'roll' ? `${m}:${b}:${i.rollDir}` : `${m}:${b}`);
        orig(b);
      };
    }
  });
}

const log = (page: Page) => page.evaluate(() => [...(window as any).__log] as string[]);
const clearLog = (page: Page) => page.evaluate(() => { (window as any).__log.length = 0; });

/** CSS-pixel centre of a registered tap region (so the test taps where the HUD really is). */
async function regionCentre(page: Page, id: string) {
  return page.evaluate((rid) => {
    const g = (window as any).__ds.game;
    const r = g.taps.byId(rid)?.rect;
    if (!r) return null;
    const d = g.display;
    const box = d.canvas.getBoundingClientRect();
    const dpr = d.canvas.width / box.width;
    return { x: box.left + ((r.x + r.w / 2) * d.scale + d.offsetX) / dpr, y: box.top + ((r.y + r.h / 2) * d.scale + d.offsetY) / dpr };
  }, id);
}

test.describe('mobile landscape, real touch', () => {
  test('boots without errors; the title tap starts a run', async ({ page }) => {
    const c = await boot(page);
    expect(await sceneName(page)).toBe('TitleScene');
    const vp = page.viewportSize()!;
    expect(vp.width).toBe(844);
    expect(vp.height).toBe(390);
    await startRunByTouch(c);
    expect(await sceneName(page)).toBe('LevelScene');
    expect(await page.evaluate(() => (window as any).__ds.game.input.device)).toBe('touch');
    await page.waitForTimeout(500);
    expect(c.errors).toEqual([]);
  });

  test('left-half drag moves the player (floating joystick)', async ({ page }) => {
    const c = await boot(page);
    await startRunByTouch(c);
    const before = (await playerState(page))!;
    await c.fingers.down(1, 120, 300);
    await c.fingers.drag(1, [120, 300], [180, 300]);
    await page.waitForTimeout(500);
    const during = (await playerState(page))!;
    expect(during.x).toBeGreaterThan(before.x + 25);
    // stick is visible while touched and released on lift
    expect(await page.evaluate(() => (window as any).__ds.game.input.moveX)).toBeGreaterThan(0.5);
    await c.fingers.upAll();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__ds.game.input.moveX)).toBe(0);
    // and the other way
    await c.fingers.down(1, 300, 300);
    await c.fingers.drag(1, [300, 300], [240, 300]);
    await page.waitForTimeout(400);
    const left = (await playerState(page))!;
    expect(left.x).toBeLessThan(during.x - 15);
    await c.fingers.upAll();
    expect(c.errors).toEqual([]);
  });

  test('right-half gestures: tap attacks, swipe up jumps, swipe sideways rolls, long press = secondary', async ({ page }) => {
    const c = await boot(page);
    await startRunByTouch(c);

    // tap → attack1
    await clearLog(page);
    await c.fingers.tap(640, 250, 50);
    await page.waitForTimeout(150);
    expect(await log(page)).toContain('tap:attack1');

    // swipe up → jump, the player leaves the ground
    await page.waitForFunction(() => (window as any).__ds.player.onGround === true);
    const y0 = (await playerState(page))!.y;
    await clearLog(page);
    await c.fingers.down(2, 640, 300);
    await c.fingers.drag(2, [640, 300], [640, 245], 4, 10);
    await expect.poll(async () => (await playerState(page))!.y, { timeout: 2000 }).toBeLessThan(y0 - 15);
    await c.fingers.upAll();
    const l = await log(page);
    expect(l).toContain('press:jump');
    expect(l).toContain('release:jump');
    await page.waitForFunction(() => (window as any).__ds.player.onGround === true, null, { timeout: 5000 });

    // swipe right / left → roll
    await clearLog(page);
    await c.fingers.down(3, 600, 300);
    await c.fingers.drag(3, [600, 300], [670, 300], 4, 10);
    await c.fingers.upAll();
    await page.waitForTimeout(100);
    expect(await log(page)).toContain('tap:roll:1');
    await page.waitForTimeout(500);
    await clearLog(page);
    await c.fingers.down(3, 670, 300);
    await c.fingers.drag(3, [670, 300], [600, 300], 4, 10);
    await c.fingers.upAll();
    await page.waitForTimeout(100);
    expect(await log(page)).toContain('tap:roll:-1');

    // swipe down → down
    await clearLog(page);
    await c.fingers.down(4, 640, 250);
    await c.fingers.drag(4, [640, 250], [640, 310], 4, 10);
    await c.fingers.upAll();
    await page.waitForTimeout(100);
    expect(await log(page)).toContain('tap:down');

    // long press → attack2 held until release
    await clearLog(page);
    await c.fingers.down(5, 640, 250);
    await page.waitForTimeout(450);
    expect(await log(page)).toContain('press:attack2');
    expect(await page.evaluate(() => (window as any).__ds.game.input.isDown('attack2'))).toBe(true);
    await c.fingers.upAll();
    await page.waitForTimeout(100);
    expect(await log(page)).toContain('release:attack2');
    expect(await page.evaluate(() => (window as any).__ds.game.input.isDown('attack2'))).toBe(false);
    expect(c.errors).toEqual([]);
  });

  test('two fingers: move with the left thumb while holding the secondary weapon with the right', async ({ page }) => {
    const c = await boot(page);
    await startRunByTouch(c);
    const x0 = (await playerState(page))!.x;
    await clearLog(page);
    await c.fingers.down(1, 120, 300);
    await c.fingers.down(2, 660, 260);
    await c.fingers.drag(1, [120, 300], [175, 300], 4, 12);
    await page.waitForTimeout(500);
    expect((await playerState(page))!.x).toBeGreaterThan(x0 + 20);
    expect(await log(page)).toContain('press:attack2');
    await c.fingers.upAll();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ down: (window as any).__ds.game.input.isDown('attack2'), mx: (window as any).__ds.game.input.moveX }))).toEqual({ down: false, mx: 0 });
  });

  test('HUD taps win over gestures: flask heals, minimap opens the map, tap closes it', async ({ page }) => {
    const c = await boot(page);
    await startRunByTouch(c);
    await page.waitForTimeout(300);
    await clearLog(page);
    const flask = (await regionCentre(page, 'hud-flask'))!;
    expect(flask).not.toBeNull();
    await c.fingers.tap(flask.x, flask.y);
    await page.waitForTimeout(100);
    const l = await log(page);
    expect(l).toContain('tap:heal');
    expect(l).not.toContain('tap:attack1');

    const mini = (await regionCentre(page, 'hud-map'))!;
    await c.fingers.tap(mini.x, mini.y);
    await expect.poll(() => page.evaluate(() => (window as any).__ds.game.scene.ui.modal)).toBe(true);
    // the world is paused while the map is open
    const x = (await playerState(page))!.x;
    await page.waitForTimeout(400);
    await c.fingers.tap(300, 200);
    await expect.poll(() => page.evaluate(() => (window as any).__ds.game.scene.ui.modal)).toBe(false);
    expect((await playerState(page))!.x).toBeCloseTo(x, 0);

    // pause button + Escape
    await page.waitForFunction(() => !!(window as any).__ds.game.taps.byId('hud-pause'));
    const pause = (await regionCentre(page, 'hud-pause'))!;
    await c.fingers.tap(pause.x, pause.y);
    await expect.poll(() => page.evaluate(() => (window as any).__ds.game.scene.ui.modal)).toBe(true);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as any).__ds.game.scene.ui.modal)).toBe(false);
    expect(c.errors).toEqual([]);
  });

  test('first run shows the gesture tutorial; it can be dismissed by touch', async ({ page }) => {
    const c = await boot(page, { hints: true });
    await c.page.waitForTimeout(1200);
    await c.fingers.tap(420, 200);
    await c.page.waitForFunction(() => (window as any).__ds.game.scene?.constructor?.name === 'LevelScene', null, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__ds.game.scene.ui.modal), { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(500);
    const ok = (await regionCentre(page, 'tutorial-ok'))!;
    await c.fingers.tap(ok.x, ok.y);
    await expect.poll(() => page.evaluate(() => (window as any).__ds.game.scene.ui.modal)).toBe(false);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).settings.hints, SAVE_KEY)).toBe(false);
    expect(c.errors).toEqual([]);
  });

  test('death screen: tap to retry', async ({ page }) => {
    const c = await boot(page);
    await startRunByTouch(c);
    await page.evaluate(() => (window as any).__ds.game.playerDied());
    await page.waitForFunction(() => (window as any).__ds.game.scene?.constructor?.name === 'DeathScene', null, { timeout: 10_000 });
    await page.waitForTimeout(1400);
    await c.fingers.tap(420, 150);
    await page.waitForFunction(() => (window as any).__ds.game.scene?.constructor?.name === 'LevelScene', null, { timeout: 10_000 });
    expect(c.errors).toEqual([]);
  });
});
