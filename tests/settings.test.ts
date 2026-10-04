import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defaultSave, loadSave, writeSave, BUTTON_OPACITY_STEPS } from '../src/game/meta/save';
import { DEFAULT_PAD_MAP, PAD_ACTIONS } from '../src/engine/gamepad';
import { DEFAULT_GFX, FILTER_IDS, computeLayout, gridLines, cssFilterOf, smoothOf, overlayOf, sanitizeGfx } from '../src/engine/filters';
import { SettingsScreen } from '../src/game/ui/settings';
import { TapRegistry } from '../src/game/ui/taps';
import { UI_H, WORLD_HEIGHTS } from '../src/engine/config';
import { makeTestWorld } from './helpers';
import { LevelUI } from '../src/game/ui/levelUI';
import { SettingsModal, PauseModal, MapModal, ChoiceModal } from '../src/game/ui/modals';

// ---------------------------------------------------------------------------
// localStorage stand-in (node environment)

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
});
const KEY = 'deadsell.save.v1';
const put = (o: unknown) => store.set(KEY, JSON.stringify(o));

describe('settings persistence', () => {
  it('a fresh save has the documented defaults', () => {
    const s = defaultSave().settings;
    expect(s.controlMode).toBe('gesture');
    expect(s.btnSize).toBe('medium');
    expect(BUTTON_OPACITY_STEPS).toContain(s.btnOpacity);
    expect(s.gamepadMap).toEqual(DEFAULT_PAD_MAP);
    expect(s).toMatchObject({ filter: 'sharp', resolution: 360, fit: 'fill', quality: 'high' });
    expect(s).toMatchObject({ sfx: 0.8, music: 0.5, hints: true, muted: false });
  });

  it('an old save without any of the new fields loads with defaults (and keeps the old ones)', () => {
    put({ version: 1, runs: 7, wins: 2, settings: { sfx: 0.3, music: 0.1, hints: false, muted: true } });
    const d = loadSave();
    expect(d.runs).toBe(7);
    expect(d.wins).toBe(2);
    expect(d.settings).toMatchObject({ sfx: 0.3, music: 0.1, hints: false, muted: true });
    expect(d.settings).toMatchObject({ controlMode: 'gesture', btnSize: 'medium', filter: 'sharp', resolution: 360, fit: 'fill', quality: 'high' });
    expect(d.settings.gamepadMap).toEqual(DEFAULT_PAD_MAP);
  });

  it('a save with no settings object at all still loads', () => {
    put({ version: 1, runs: 3 });
    expect(loadSave().settings).toEqual(defaultSave().settings);
  });

  it('valid new values round-trip through write / load', () => {
    const s = defaultSave();
    Object.assign(s.settings, { controlMode: 'buttons', btnSize: 'large', btnOpacity: 0.85, filter: 'crt', resolution: 432, fit: 'integer', quality: 'saver' });
    s.settings.gamepadMap = { ...DEFAULT_PAD_MAP, jump: 2, attack1: 0 };
    writeSave(s);
    const back = loadSave().settings;
    expect(back).toMatchObject({ controlMode: 'buttons', btnSize: 'large', btnOpacity: 0.85, filter: 'crt', resolution: 432, fit: 'integer', quality: 'saver' });
    expect(back.gamepadMap.jump).toBe(2);
    expect(back.gamepadMap.attack1).toBe(0);
  });

  it('invalid values are rejected (safe defaults)', () => {
    put({
      version: 1,
      settings: {
        controlMode: 'telepathy', btnSize: 'huge', btnOpacity: 'see-through', filter: 'neon', resolution: 500, fit: 'stretch', quality: 3,
        gamepadMap: { jump: 'A', roll: -1, attack1: 3.5, attack2: 999, heal: null },
      },
    });
    const s = loadSave().settings;
    expect(s).toMatchObject({ controlMode: 'gesture', btnSize: 'medium', filter: 'sharp', resolution: 360, fit: 'fill', quality: 'high' });
    expect(s.btnOpacity).toBe(defaultSave().settings.btnOpacity);
    expect(s.gamepadMap).toEqual(DEFAULT_PAD_MAP);
  });

  it('opacity is clamped, a map with duplicate buttons is repaired', () => {
    put({ version: 1, settings: { btnOpacity: 7, gamepadMap: { jump: 4, heal: 4, roll: 4 } } });
    let s = loadSave().settings;
    expect(s.btnOpacity).toBe(1);
    expect(new Set(PAD_ACTIONS.map((a) => s.gamepadMap[a])).size).toBe(PAD_ACTIONS.length);
    put({ version: 1, settings: { btnOpacity: -3 } });
    s = loadSave().settings;
    expect(s.btnOpacity).toBe(0.2);
  });

  it('corrupted JSON / wrong types fall back to a fresh save', () => {
    store.set(KEY, '{nope');
    expect(loadSave().settings.controlMode).toBe('gesture');
    put([1, 2, 3]);
    expect(loadSave().settings).toEqual(defaultSave().settings);
    put({ version: 1, settings: 'x' });
    expect(loadSave().settings).toEqual(defaultSave().settings);
  });

  it('sanitizeGfx handles null / junk', () => {
    expect(sanitizeGfx(null)).toEqual(DEFAULT_GFX);
    expect(sanitizeGfx({ filter: 'lcd', resolution: 288 })).toMatchObject({ filter: 'lcd', resolution: 288, fit: 'fill' });
  });
});

// ---------------------------------------------------------------------------
// graphics maths

describe('screen layout', () => {
  const screens: [number, number][] = [[1688, 780], [844, 390], [2340, 1080], [1280, 720], [800, 600], [640, 480], [1000, 1000]];

  it('UI space is always 360 tall; width 480..800; the world has the same aspect', () => {
    for (const [w, h] of screens) {
      for (const res of WORLD_HEIGHTS) {
        for (const fit of ['fill', 'integer'] as const) {
          const L = computeLayout(w, h, { resolution: res, fit });
          expect(L.uiH).toBe(UI_H);
          expect(L.uiW).toBeGreaterThanOrEqual(480);
          expect(L.uiW).toBeLessThanOrEqual(800);
          expect(L.worldH).toBe(res);
          expect(L.worldW / L.worldH).toBeCloseTo(L.uiW / L.uiH, 1);
          // inside the canvas
          expect(L.offsetX).toBeGreaterThanOrEqual(0);
          expect(L.offsetY).toBeGreaterThanOrEqual(0);
          expect(L.offsetX + L.viewW).toBeLessThanOrEqual(w + 1);
          expect(L.offsetY + L.viewH).toBeLessThanOrEqual(h + 1);
        }
      }
    }
  });

  it('the world width limits scale with the resolution (480..800 at 360)', () => {
    const wide = computeLayout(4000, 1000, { resolution: 360, fit: 'fill' });
    expect(wide.worldW).toBe(800);
    expect(computeLayout(4000, 1000, { resolution: 288, fit: 'fill' }).worldW).toBe(640);
    expect(computeLayout(4000, 1000, { resolution: 432, fit: 'fill' }).worldW).toBe(960);
    expect(computeLayout(500, 1000, { resolution: 288, fit: 'fill' }).worldW).toBe(384);
    expect(computeLayout(500, 1000, { resolution: 432, fit: 'fill' }).worldW).toBe(576);
  });

  it('fill uses (nearly) the whole screen, UI scale is uniform', () => {
    const L = computeLayout(1688, 780, { resolution: 360, fit: 'fill' });
    expect(L.integer).toBe(0);
    expect(L.viewH).toBeCloseTo(780);
    expect(L.scale).toBeCloseTo(780 / 360);
    expect(L.uiW).toBe(779);
  });

  it('the UI keeps the same on-screen size for every world resolution', () => {
    const a = computeLayout(1688, 780, { resolution: 288, fit: 'fill' });
    const b = computeLayout(1688, 780, { resolution: 432, fit: 'fill' });
    expect(a.scale).toBeCloseTo(b.scale, 5);
    expect(a.uiW).toBe(b.uiW);
    // ... but a different amount of world is visible
    expect(a.worldH).toBeLessThan(b.worldH);
  });

  it('integer fit: every world pixel is a whole k x k block, centred with a letterbox', () => {
    const L = computeLayout(1688, 780, { resolution: 360, fit: 'integer' });
    expect(L.integer).toBe(2);
    expect(L.viewW).toBe(L.worldW * 2);
    expect(L.viewH).toBe(L.worldH * 2);
    expect(L.viewH).toBe(720);
    expect(L.offsetY).toBe(30); // 780 - 720 = 60 px of bars
    expect(L.offsetX).toBe(Math.floor((1688 - L.viewW) / 2));
    const small = computeLayout(844, 390, { resolution: 360, fit: 'integer' });
    expect(small.integer).toBe(1);
    expect(small.viewH).toBe(360);
    expect(small.offsetY).toBe(15);
    expect(small.offsetX).toBeGreaterThan(0); // 800 wide in 844: side bars too
    // 288 fits twice into 780 (2 x 288 = 576), 432 only once
    expect(computeLayout(1688, 780, { resolution: 288, fit: 'integer' }).integer).toBe(2);
    expect(computeLayout(1688, 780, { resolution: 432, fit: 'integer' }).integer).toBe(1);
  });

  it('integer fit falls back to fill when even 1x does not fit', () => {
    const L = computeLayout(300, 200, { resolution: 360, fit: 'integer' });
    expect(L.integer).toBe(0);
  });
});

describe('filters', () => {
  it('has the six documented filters; colour ones use CSS filters, others none', () => {
    expect([...FILTER_IDS]).toEqual(['sharp', 'smooth', 'crt', 'lcd', 'vivid', 'mono']);
    expect(cssFilterOf('sharp')).toBe('none');
    expect(cssFilterOf('crt')).toBe('none');
    expect(cssFilterOf('mono')).toContain('grayscale');
    expect(cssFilterOf('vivid')).toContain('saturate');
    expect(smoothOf('smooth')).toBe(true);
    expect(smoothOf('sharp')).toBe(false);
    expect(overlayOf('crt')).toBe('crt');
    expect(overlayOf('lcd')).toBe('lcd');
    expect(overlayOf('vivid')).toBeNull();
  });

  it('grid lines are spaced by the pixel scale (and thinned when tiny)', () => {
    expect(gridLines(4, 3)).toEqual([2, 5, 8, 11]);
    const thin = gridLines(10, 1);
    expect(thin.length).toBe(5);
    expect(gridLines(3, 2.5).every((v, i, a) => i === 0 || v > a[i - 1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the settings screen (keyboard / pad navigation, applied at once)

function fakeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = { font: '11px x' };
  return new Proxy(target, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: [...s].length * 6 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

function makeGame() {
  const save = defaultSave();
  const changed = vi.fn();
  const game: any = {
    save,
    taps: new TapRegistry(),
    audio: { muted: false, play: vi.fn() },
    input: { device: 'keyboard' },
    pad: { capture: null, connected: false, id: '', mapping: '' },
    settingsChanged: () => { changed(); game.audio.muted = save.settings.muted; },
  };
  return { game, changed, save };
}

describe('SettingsScreen', () => {
  it('left / right change the selected value and apply it immediately', () => {
    const { game, changed, save } = makeGame();
    const sc = new SettingsScreen(game, vi.fn());
    sc.key('right'); // row 0 = 조작 방식: 터치 제스처 -> 가상 버튼
    expect(save.settings.controlMode).toBe('buttons');
    expect(changed).toHaveBeenCalledTimes(1);
    sc.key('right');
    expect(save.settings.controlMode).toBe('gamepad');
    sc.key('right'); // clamps at the last option
    expect(save.settings.controlMode).toBe('gamepad');
    sc.key('left');
    expect(save.settings.controlMode).toBe('buttons');
  });

  it('buttons mode adds size and opacity rows', () => {
    const { game, save } = makeGame();
    save.settings.controlMode = 'buttons';
    const sc = new SettingsScreen(game, vi.fn());
    const labels = sc.rows().map((r) => ('label' in r ? r.label : r.kind));
    expect(labels).toContain('버튼 크기');
    expect(labels).toContain('투명도');
    sc.key('down');
    sc.key('right');
    expect(save.settings.btnSize).toBe('large');
    sc.key('down');
    sc.key('left');
    expect(save.settings.btnOpacity).toBeLessThan(0.6);
  });

  it('up from the first row reaches the tab bar; left / right switch tabs; graphics options work', () => {
    const { game, save } = makeGame();
    const sc = new SettingsScreen(game, vi.fn());
    sc.key('up');
    expect(sc.focus).toBe(-1);
    sc.key('right');
    expect(sc.tab).toBe('graphics');
    sc.key('down');
    expect(sc.focus).toBe(0);
    sc.key('confirm'); // cycles the filter forward
    expect(save.settings.filter).toBe('smooth');
    sc.key('right');
    expect(save.settings.filter).toBe('crt');
    sc.key('down'); // 해상도
    sc.key('right');
    expect(save.settings.resolution).toBe(432);
    sc.key('down'); // 화면 맞춤
    sc.key('right');
    expect(save.settings.fit).toBe('integer');
    sc.key('down'); // 화질
    sc.key('right');
    expect(save.settings.quality).toBe('saver');
    sc.key('up');
    sc.key('up');
    sc.key('up');
    sc.key('up');
    sc.key('left'); // tab bar: graphics -> control
    expect(sc.tab).toBe('control');
  });

  it('sound tab: mute toggle and volume steps', () => {
    const { game, save } = makeGame();
    const sc = new SettingsScreen(game, vi.fn(), 'sound');
    sc.key('right'); // 켜짐 -> 꺼짐
    expect(save.settings.muted).toBe(true);
    sc.key('down');
    sc.key('left'); // 80% -> 50%? steps of 25%: 0.8 rounds to 100% index 3 -> 2
    expect(save.settings.sfx).toBeCloseTo(0.5);
    sc.key('down');
    sc.key('right');
    expect(save.settings.music).toBeCloseTo(0.75);
  });

  it('cancel / pause close it once', () => {
    const { game } = makeGame();
    const onClose = vi.fn();
    const sc = new SettingsScreen(game, onClose);
    sc.key('cancel');
    sc.key('cancel');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('remap: select an action, press a pad button; the other action swaps; D-pad is refused', () => {
    const { game, save } = makeGame();
    save.settings.controlMode = 'gamepad';
    const sc = new SettingsScreen(game, vi.fn());
    // rows: 0 mode, 1.. = jump, roll, attack1 ...
    sc.key('down'); // jump
    sc.key('confirm');
    expect(sc.listen).toBe('jump');
    expect(typeof game.pad.capture).toBe('function');
    // other keys do nothing while waiting
    sc.key('down');
    expect(sc.listen).toBe('jump');
    game.pad.capture(2); // X: attack1's button
    expect(save.settings.gamepadMap.jump).toBe(2);
    expect(save.settings.gamepadMap.attack1).toBe(0);
    expect(sc.listen).toBeNull();
    // D-pad buttons cannot be assigned
    sc.key('confirm');
    game.pad.capture(13);
    expect(save.settings.gamepadMap.jump).toBe(2);
    // Esc while listening only stops listening
    sc.key('confirm');
    expect(sc.listen).toBe('jump');
    const onClose = vi.fn();
    (sc as any).onClose = onClose;
    sc.key('cancel');
    expect(sc.listen).toBeNull();
    expect(game.pad.capture).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('기본값 복원 restores the default map', () => {
    const { game, save } = makeGame();
    save.settings.controlMode = 'gamepad';
    save.settings.gamepadMap = { ...DEFAULT_PAD_MAP, jump: 5, interact: 0 };
    const sc = new SettingsScreen(game, vi.fn());
    const rows = sc.rows();
    sc.focus = rows.length - 1;
    sc.key('confirm');
    expect(save.settings.gamepadMap).toEqual(DEFAULT_PAD_MAP);
  });

  it('draws every tab / mode and registers tap regions (options >= 40 px high, tabs, close)', () => {
    const { game, save } = makeGame();
    const ctx = fakeCtx();
    for (const mode of ['gesture', 'buttons', 'gamepad'] as const) {
      for (const tab of ['control', 'graphics', 'sound'] as const) {
        for (const W of [480, 640, 800]) {
          save.settings.controlMode = mode;
          const sc = new SettingsScreen(game, vi.fn(), tab);
          sc.update(0.5);
          game.taps.clear();
          sc.draw(ctx, W, 360);
          const ids = game.taps.regions.map((r: { id: string }) => r.id);
          expect(ids).toContain('set-close');
          expect(ids).toContain('set-tab-graphics');
          for (const r of game.taps.regions) {
            if (r.id === 'modal-bg') continue;
            expect(r.rect.h, `${r.id} (${mode}/${tab}/${W})`).toBeGreaterThanOrEqual(28);
            expect(r.rect.x).toBeGreaterThanOrEqual(0);
            expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(W);
            expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(360);
          }
          // the geometry fits above the footer
          const L = sc.layout(W, 360);
          for (const b of L.boxes) {
            if (b.box === L.reset) continue;
            expect(b.box.y + b.box.h, `${mode}/${tab}/${W}`).toBeLessThanOrEqual(L.footer.y);
          }
        }
      }
    }
  });

  it('tapping an option applies it (after the open lock-out)', () => {
    const { game, save } = makeGame();
    const sc = new SettingsScreen(game, vi.fn(), 'graphics');
    const ctx = fakeCtx();
    sc.update(0.05);
    game.taps.clear();
    sc.draw(ctx, 640, 360);
    expect(game.taps.byId('set-filter-2')).toBeNull(); // locked out: a finger still lifting must not hit it
    sc.update(0.3);
    game.taps.clear();
    sc.draw(ctx, 640, 360);
    game.taps.byId('set-filter-2').onTap();
    expect(save.settings.filter).toBe('crt');
    game.taps.byId('set-res-0').onTap();
    expect(save.settings.resolution).toBe(288);
    game.taps.byId('set-fit-1').onTap();
    expect(save.settings.fit).toBe('integer');
    game.taps.byId('set-quality-1').onTap();
    expect(save.settings.quality).toBe('saver');
  });
});

// ---------------------------------------------------------------------------
// gamepad navigation of the in-level menus (LevelUI.nav = the keyboard paths)


function levelUI() {
  const { world, game } = makeTestWorld();
  game.display = { W: 640, H: 360, scale: 1, canvas: null };
  game.taps = new TapRegistry();
  game.persist = vi.fn();
  game.playerDied = vi.fn();
  game.settingsChanged = vi.fn();
  game.pad = { capture: null, connected: false, id: '', mapping: '' };
  (world as any).player = { hp: 60, maxHp: 100, recoverable: 0, nearInteract: null, skillCooldown: [0, 0], skillCooldownMax: [1, 1], x: 200, y: 200, h: 40, w: 14, dying: false };
  const ui = new LevelUI(game, world);
  world.ui = ui;
  game.scene = { ui };
  return { ui, game, world };
}

describe('LevelUI.nav (gamepad)', () => {
  it('Start opens / closes pause, d-pad + A reach 설정, B goes back', () => {
    const { ui } = levelUI();
    expect(ui.modal).toBe(false);
    ui.nav('pause');
    expect(ui.top).toBeInstanceOf(PauseModal);
    ui.nav('down');
    ui.nav('down');
    ui.nav('down'); // 계속하기 -> 소리 -> 조작 도움말 -> 설정
    ui.nav('confirm');
    expect(ui.top).toBeInstanceOf(SettingsModal);
    ui.nav('right'); // the settings screen is driven too
    ui.nav('cancel');
    expect(ui.top).toBeInstanceOf(PauseModal);
    ui.nav('pause'); // Start closes the pause menu
    expect(ui.modal).toBe(false);
  });

  it('Back opens / closes the map; stale UIs ignore the pad', () => {
    const { ui, game } = levelUI();
    ui.nav('map');
    expect(ui.top).toBeInstanceOf(MapModal);
    ui.nav('map');
    expect(ui.modal).toBe(false);
    game.scene = { ui: {} };
    ui.nav('pause');
    expect(ui.modal).toBe(false);
  });

  it('choice modals: direction + A picks, B cancels', () => {
    const { ui } = levelUI();
    const picked: number[] = [];
    ui.openChoice('테스트', [{ label: 'a' }, { label: 'b' }, { label: 'c' }], (i) => picked.push(i), true);
    expect(ui.top).toBeInstanceOf(ChoiceModal);
    ui.nav('right');
    ui.nav('confirm');
    expect(picked).toEqual([1]);
    expect(ui.modal).toBe(false);
    ui.openChoice('테스트', [{ label: 'a' }, { label: 'b' }], (i) => picked.push(i), true);
    ui.nav('cancel');
    expect(picked).toEqual([1, -1]);
  });

  it('gameplay is not driven by menu keys when no modal is open', () => {
    const { ui } = levelUI();
    for (const k of ['up', 'down', 'left', 'right', 'confirm', 'cancel'] as const) ui.nav(k);
    expect(ui.modal).toBe(false);
  });
});
