import { expect, type Page, type CDPSession } from '@playwright/test';

export const SAVE_KEY = 'deadsell.save.v1';

/** Multi-finger helper on top of CDP touch events (real browser input pipeline). */
export class Fingers {
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
  async upAll() {
    this.pts.clear();
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async tap(x: number, y: number, holdMs = 40) {
    await this.down(9, x, y);
    await new Promise((r) => setTimeout(r, holdMs));
    await this.upAll();
  }
  /** Drag one finger in small steps (like a real thumb); the finger stays down, call upAll() to lift it. */
  async drag(id: number, from: [number, number], to: [number, number], steps = 5, stepMs = 12) {
    for (let i = 1; i <= steps; i++) {
      await this.move(id, from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }
}

export interface Ctx {
  page: Page;
  fingers: Fingers;
  errors: string[];
}

export interface BootOpts {
  /** query string, default "?seed=1&god=1" (sound stays ON so audio errors surface) */
  query?: string;
  hints?: boolean;
}

/** Open the game with a pre-seeded save and collect every console / page error. */
export async function boot(page: Page, opts: BootOpts = {}): Promise<Ctx> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // optional art (title.png, bg/*, ...) may be missing: the game has placeholders for it (DESIGN §8.4)
    if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) errors.push(`console.${m.type()}: ${m.text()}`);
  });
  await page.addInitScript(([key, hints]) => {
    try {
      // a fresh save every test (the init script re-runs on reload, so only seed when empty)
      if (!localStorage.getItem(key as string)) localStorage.setItem(key as string, JSON.stringify({ version: 1, settings: { sfx: 0.8, music: 0.5, hints, muted: false } }));
    } catch { /* ignore */ }
  }, [SAVE_KEY, opts.hints ?? false] as const);
  await page.goto('/' + (opts.query ?? '?seed=1&god=1'));
  await page.waitForFunction(() => (window as any).__ds?.game?.scene?.constructor?.name === 'TitleScene', null, { timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);
  return { page, fingers: new Fingers(cdp), errors };
}

export const sceneName = (page: Page) => page.evaluate(() => (window as any).__ds.game.scene?.constructor?.name as string);

export async function waitScene(page: Page, name: string, timeout = 20_000) {
  await page.waitForFunction((n) => {
    const g = (window as any).__ds.game;
    return g.scene?.constructor?.name === n && g.fade < 0.25;
  }, name, { timeout });
}

/** CSS-pixel centre of a registered tap region (so the test taps where the UI really is). */
export async function regionCentre(page: Page, id: string) {
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

/** Tap a registered UI region with a real touch. */
export async function tapRegion(c: Ctx, id: string) {
  await expect.poll(() => regionCentre(c.page, id), { timeout: 8_000, message: `tap region "${id}" is registered` }).not.toBeNull();
  const p = (await regionCentre(c.page, id))!;
  await c.fingers.tap(p.x, p.y);
}

/** Record every world event of the current level into window.__ev (call after each level change). */
export async function watchEvents(page: Page) {
  await page.evaluate(() => {
    const w = (window as any).__ds.world;
    const ev: { type: string; [k: string]: unknown }[] = ((window as any).__ev = []);
    w.on((e: any) => ev.push({ type: e.type, what: e.what, text: e.text, amount: e.amount }));
  });
}
export const events = (page: Page, type: string) =>
  page.evaluate((t) => ((window as any).__ev as { type: string }[]).filter((e) => e.type === t).length, type);

/** Entities of a class (constructor name) in the current world, as plain data. */
export const entitiesOf = (page: Page, cls: string): Promise<{ x: number; y: number; hp?: number }[]> =>
  page.evaluate((c) => {
    const w = (window as any).__ds.world;
    return w.entities
      .filter((e: any) => e.constructor.name === c && !e.dead)
      .map((e: any) => ({ x: e.x as number, y: e.y as number, hp: e.hp as number | undefined }));
  }, cls);

/** Teleport the player next to a point (nearest spot with real floor under it) and let physics settle. */
export async function teleportNear(page: Page, x: number, y: number, settleSteps = 20) {
  await page.evaluate(([px, py, n]) => {
    const ds = (window as any).__ds;
    const map = ds.world.map;
    let tx = px;
    for (const off of [0, 12, -12, 24, -24, 36, -36, 48, -48, 72, -72]) {
      const f = map.floorBelow(px + off, py - 6, 30);
      if (f !== null && Math.abs(f - py) <= 8 && !map.solidAt(px + off, py - 20)) { tx = px + off; break; }
    }
    ds.teleport(tx, py);
    ds.step(n);
  }, [x, y, settleSteps]);
}

/** Hold a key for ms of real time. */
export async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

// ---- shared by the content specs (corpse, content4) ----
export const SHOTS = 'e2e/__shots__/';
export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}.png` });

export async function startRun(page: Page, seed: number) {
  // wait for the NEW scene (the old one may still be up while the fade runs)
  await page.evaluate((s) => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.start(s); }, seed);
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene !== (window as any).__prev && d.game.scene?.constructor?.name === 'LevelScene' && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
}
export async function toLevel(page: Page, name: string) {
  await page.evaluate((n) => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.gotoLevel(n); }, name);
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene !== (window as any).__prev && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
}

export const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
export const hudPieces = (page: Page) => page.evaluate(() => (window as any).__ds.game.scene.ui.hud.lastPieces as number);

/** Record every string the game draws with fillText, so tests can read the canvas UI. */
export async function recordText(page: Page) {
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
export const drawn = (page: Page) => page.evaluate(() => [...((window as any).__texts as string[])]);
export const clearText = (page: Page) => page.evaluate(() => { ((window as any).__texts as string[]).length = 0; });

/** Stand next to an entity of a class, wait for its prompt, press the interact key. */
export async function interact(page: Page, cls: string, pick = 0) {
  const e = (await entitiesOf(page, cls))[pick];
  expect(e, `a ${cls} exists`).toBeTruthy();
  await teleportNear(page, e.x - 8, e.y - 2, 25);
  await expect.poll(() => page.evaluate(() => (window as any).__ds.player.nearInteract?.constructor.name ?? null), { timeout: 5_000, message: `prompt for ${cls}` }).toBe(cls);
  // two real frames, so the prompt has been on the screen (and in the recorded text) before the key is pressed
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.keyboard.press('KeyF');
}

