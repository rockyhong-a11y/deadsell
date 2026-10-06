import { describe, it, expect, vi } from 'vitest';
import { makeTestWorld, implemented } from './helpers';
import { LevelUI } from '../src/game/ui/levelUI';
import { ALCHEMIST_PAGE, type AlchemistModal } from '../src/game/ui/modals';
import { hudLayout, MIN_TAP, itemOf } from '../src/game/ui/hud';
import { formatTime, wrap, atLeast } from '../src/game/ui/draw';
import { TapRegistry } from '../src/game/ui/taps';
import { META_UPGRADES, buyUpgrade, buyBlock, applyRunStart } from '../src/game/meta/progression';
import { defaultSave } from '../src/game/meta/save';
import { ITEMS } from '../src/game/items/items';
import { RunState } from '../src/game/run';

/** A 2D context that accepts everything (so draw code can run in node). */
function fakeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = { font: '11px x' };
  const proxy: unknown = new Proxy(target, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: [...s].length * (parseInt(String(t.font).match(/(\d+)px/)?.[1] ?? '11', 10) * 0.55) });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return proxy as CanvasRenderingContext2D;
}

const hasHangul = (s: string) => /[가-힣]/.test(s);

function setup(opts: { skills?: boolean; W?: number } = {}) {
  const { world, game, run } = makeTestWorld();
  game.display = { W: opts.W ?? 777, H: 360, scale: 1, canvas: null };
  game.taps = new TapRegistry();
  game.persist = vi.fn();
  game.playerDied = vi.fn();
  game.scene = null;
  run.cells = 100;
  if (opts.skills) run.skills = [{ id: 'fire_grenade', tier: 1, affix: null }, { id: 'turret', tier: 1, affix: null }];
  (world as any).player = {
    hp: 60, maxHp: 100, recoverable: 10, nearInteract: null, skillCooldown: [0, 5], skillCooldownMax: [10, 10],
    x: 200, y: 200, h: 40, w: 14, dying: false,
  };
  const ui = new LevelUI(game, world);
  world.ui = ui;
  const ctx = fakeCtx();
  const frame = (dt = 1 / 60) => {
    game.taps.clear();
    ui.update(dt);
    ui.draw(ctx);
  };
  const advance = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) frame(); };
  const tap = (id: string) => {
    const r = game.taps.byId(id);
    if (!r) throw new Error('no tap region ' + id + ' in ' + game.taps.regions.map((x: any) => x.id).join(','));
    r.onTap();
  };
  return { world, game, run, ui, ctx, frame, advance, tap };
}

describe('HUD layout and tap targets', () => {
  for (const W of [480, 640, 777, 800]) {
    it(`every tappable HUD element is at least ${MIN_TAP} virtual px (W=${W})`, () => {
      for (const flasks of [1, 2, 3]) {
        const L = hudLayout(W, 360, flasks);
        const targets = [L.flask, L.pause, L.minimap, ...L.skills.map((s) => s.hit)];
        for (const t of targets) {
          expect(t.w).toBeGreaterThanOrEqual(32);
          expect(t.h).toBeGreaterThanOrEqual(32);
          expect(t.x).toBeGreaterThanOrEqual(0);
          expect(t.y).toBeGreaterThanOrEqual(0);
          expect(t.x + t.w).toBeLessThanOrEqual(W);
          expect(t.y + t.h).toBeLessThanOrEqual(360);
        }
      }
    });

    it(`HUD blocks do not overlap each other (W=${W})`, () => {
      const L = hudLayout(W, 360, 3);
      const rects = { hp: L.hp, flask: L.flask, minimap: L.minimap, pause: L.pause, s0: L.skills[0].hit, s1: L.skills[1].hit, boss: L.boss };
      const names = Object.keys(rects) as (keyof typeof rects)[];
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const a = rects[names[i]], b = rects[names[j]];
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlap, `${names[i]} vs ${names[j]}`).toBe(false);
        }
      // counters stay left of the pause button
      expect(L.cells.x + 50).toBeLessThan(L.pause.x);
      expect(L.pieces.x + 60).toBeLessThan(L.pause.x);
    });
  }

  it('atLeast keeps the centre', () => {
    const r = atLeast({ x: 10, y: 10, w: 20, h: 20 }, 40, 40);
    expect(r).toEqual({ x: 0, y: 0, w: 40, h: 40 });
  });
});

describe('text helpers', () => {
  it('formatTime', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(-5)).toBe('0:00');
  });

  it('wrap breaks Korean text at any character and respects newlines', () => {
    const c = fakeCtx(); // 11px → 6.05 px per char
    const lines = wrap(c, '가나다라마바사아자차카타파하', 30, 11);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join('')).toBe('가나다라마바사아자차카타파하');
    expect(wrap(c, '가\n나', 100, 11)).toEqual(['가', '나']);
  });

  it('wrap breaks at spaces first: a Korean word that fits moves down whole', () => {
    const c = fakeCtx();
    const text = '맞은 적을 끌어온다 · 넉백이 거의 없는 적은 끌려오지 않고 기절만 한다';
    const longest = Math.max(...text.split(' ').map((w) => [...w].length)) * 6.05;
    for (let w = Math.ceil(longest); w <= 300; w += 3) {
      const lines = wrap(c, text, w, 11);
      expect(lines.join(' '), `width ${w}`).toBe(text);
      for (const l of lines) expect(l.length === 0 || l.trim() === l, `no stray spaces in "${l}"`).toBe(true);
      for (const l of lines) expect([...l].length * 6.05, `width ${w}: "${l}"`).toBeLessThanOrEqual(w + 0.01);
    }
    // a word wider than the whole line still breaks inside (Korean wraps at any character then)
    const lines = wrap(c, '가 나다라마바사아자차카타파하 거', 30, 11);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.join('').replace(/ /g, '')).toBe('가나다라마바사아자차카타파하거');
  });

  it('wrap never splits a number from its digits, decimal point, sign or unit', () => {
    const c = fakeCtx();
    // with spaces, every word fits: the lines break only at the spaces, so no number is ever cut
    const text = '정면 피해 -90% · 패링 시 기절 1.5초 · 충격파 반경 72px, 피해 30, 기절 1.5초 +15 치명타';
    for (let w = 40; w <= 320; w++) expect(wrap(c, text, w, 11).join(' '), `width ${w}`).toBe(text);
    // glued to Korean text there is no space to break at: the number still stays whole (the break moves before it)
    const bad = /[0-9]\n|[.,+\-]\n/;
    for (let w = 31; w <= 150; w++) { // (a number wider than the whole line has to break)
      const lines = wrap(c, '피해12.5초동안유지되고-90%만큼줄어든다', w, 11);
      expect(lines.join('\n'), `width ${w}`).not.toMatch(bad);
      expect(lines.join(''), `width ${w}`).toBe('피해12.5초동안유지되고-90%만큼줄어든다');
    }
    // a line of nothing but digits has to break somewhere
    expect(wrap(c, '12345678901234567890', 30, 11).length).toBeGreaterThan(1);
  });
});

describe('meta progression', () => {
  it('has Korean names, sensible costs and unlocks every locked item', () => {
    expect(META_UPGRADES.length).toBeGreaterThanOrEqual(10);
    for (const u of META_UPGRADES) {
      expect(hasHangul(u.name), u.id).toBe(true);
      expect(hasHangul(u.desc), u.id).toBe(true);
      expect(u.cost).toBeGreaterThan(0);
      expect(u.cost).toBeLessThanOrEqual(100);
    }
    const unlockable = META_UPGRADES.filter((u) => u.item).map((u) => u.item!);
    const starter = defaultSave().unlocked;
    for (const id of Object.keys(ITEMS)) if (!ITEMS[id as keyof typeof ITEMS].unique && implemented(id as keyof typeof ITEMS)) expect([...starter, ...unlockable]).toContain(id);
    const bp = META_UPGRADES.find((u) => u.id === 'unlock_spear')!;
    expect(bp.name).toContain(ITEMS.spear.name);
  });

  it('buying spends cells, applies the upgrade once and respects order', () => {
    const save = defaultSave();
    const run = new RunState(1);
    run.cells = 50;
    const f1 = META_UPGRADES.find((u) => u.id === 'flask1')!;
    const f2 = META_UPGRADES.find((u) => u.id === 'flask2')!;
    expect(buyBlock(f2, run, save)).toBe('locked');
    expect(buyUpgrade(f1, run, save)).toBe('ok');
    expect(run.cells).toBe(20);
    expect(run.cellsSpentThisRun).toBe(30);
    expect(save.upgrades.flask).toBe(1);
    expect(run.maxFlasks).toBe(2); // benefits the current run too
    expect(buyUpgrade(f1, run, save)).toBe('owned');
    expect(buyUpgrade(f2, run, save)).toBe('poor');
    expect(run.cells).toBe(20);
    const gold = META_UPGRADES.find((u) => u.id === 'gold')!;
    run.cells = 25;
    expect(buyUpgrade(gold, run, save)).toBe('ok');
    expect(run.gold).toBe(100);
    const sp = META_UPGRADES.find((u) => u.id === 'unlock_spear')!;
    run.cells = 99;
    expect(buyUpgrade(sp, run, save)).toBe('ok');
    expect(save.unlocked).toContain('spear');
    expect(buyUpgrade(sp, run, save)).toBe('owned');
  });

  it('applyRunStart uses the bought upgrades', () => {
    const save = defaultSave();
    save.upgrades = { flask: 2, gold: 1 };
    const run = new RunState(1);
    applyRunStart(run, save);
    expect(run.maxFlasks).toBe(3);
    expect(run.flasks).toBe(3);
    expect(run.gold).toBe(100);
    expect(run.weapons[0]?.id).toBe('rusty_sword');
  });
});

describe('LevelUI: HUD', () => {
  it('draws and registers the flask, minimap and pause taps (skills only when equipped)', () => {
    const t = setup();
    t.frame();
    const ids = t.game.taps.regions.map((r: any) => r.id);
    expect(ids).toContain('hud-flask');
    expect(ids).toContain('hud-map');
    expect(ids).toContain('hud-pause');
    expect(ids).not.toContain('hud-skill1');
    expect(ids).not.toContain('hud-skill2');
    const t2 = setup({ skills: true });
    t2.frame();
    const ids2 = t2.game.taps.regions.map((r: any) => r.id);
    expect(ids2).toContain('hud-skill1');
    expect(ids2).toContain('hud-skill2');
  });

  it('flask tap → heal, skill taps → skill1/skill2, bubble tap → interact', () => {
    const t = setup({ skills: true });
    (t.world.player as any).nearInteract = { x: 220, y: 200, h: 24, promptText: () => '열기', promptSub: () => null, canInteract: () => true, interactable: true, dead: false };
    t.frame();
    t.tap('hud-flask');
    expect(t.game.input.pressed('heal')).toBe(true);
    t.tap('hud-skill1');
    t.tap('hud-skill2');
    expect(t.game.input.pressed('skill1')).toBe(true);
    expect(t.game.input.pressed('skill2')).toBe(true);
    t.tap('hud-interact');
    expect(t.game.input.pressed('interact')).toBe(true);
  });

  it('minimap tap opens the full map (modal) and a tap closes it', () => {
    const t = setup();
    t.frame();
    expect(t.ui.modal).toBe(false);
    t.tap('hud-map');
    expect(t.ui.modal).toBe(true);
    t.advance(0.3);
    expect(t.game.taps.byId('map-view')).not.toBeNull();
    t.tap('map-view');
    expect(t.ui.modal).toBe(false);
  });

  it('pause button opens the pause menu; resume closes it', () => {
    const t = setup();
    t.frame();
    t.tap('hud-pause');
    expect(t.ui.modal).toBe(true);
    t.advance(0.3);
    t.tap('pause0');
    expect(t.ui.modal).toBe(false);
  });

  it('modal blocks HUD taps (no tap region leaks to the HUD)', () => {
    const t = setup({ skills: true });
    t.ui.openPause();
    t.advance(0.3);
    const ids = t.game.taps.regions.map((r: any) => r.id);
    expect(ids).not.toContain('hud-flask');
    expect(ids).not.toContain('hud-skill1');
    expect(ids[0]).toBe('modal-bg');
  });

  it('boss start shows the intro then the bar; item drops are recognised', () => {
    const t = setup();
    const boss = { hp: 500, maxHp: 1000, dead: false } as any;
    t.world.emit({ type: 'bossStart', boss });
    expect(t.ui.boss?.name).toBe('강철 여교도관');
    t.advance(4);
    expect(itemOf({ item: { id: 'spear', tier: 1, affix: null } })?.id).toBe('spear');
    expect(itemOf({ item: { id: 'nope' } })).toBeNull();
    expect(itemOf(null)).toBeNull();
  });

  it('toasts from events, aggregated pickups', () => {
    const t = setup();
    t.world.emit({ type: 'toast', text: '안녕', color: '#fff' });
    t.world.emit({ type: 'pickup', what: 'cells', amount: 2 });
    t.world.emit({ type: 'pickup', what: 'cells', amount: 3 });
    t.advance(1);
    expect((t.ui.hud as any).toasts.map((x: any) => x.text)).toEqual(['안녕', '+5 셀']);
  });
});

describe('LevelUI: choice', () => {
  const options = [
    { label: '잔혹', sub: '붉은 두루마리', color: '#e2483d', icon: 'scroll' },
    { label: '전술', color: '#a65be8' },
    { label: '생존', color: '#5ec24a', disabled: true },
  ];

  it('opens as a modal and picks by tap (cards ignore taps during the lockout)', () => {
    const t = setup();
    const pick = vi.fn();
    t.ui.openChoice('두루마리', options, pick, true);
    expect(t.ui.modal).toBe(true);
    t.frame();
    expect(t.game.taps.byId('choice0')).toBeNull(); // lockout
    t.advance(0.3);
    t.tap('choice1');
    expect(pick).toHaveBeenCalledWith(1);
    expect(t.ui.modal).toBe(false);
  });

  it('disabled options cannot be picked; background cancels only when cancellable', () => {
    const t = setup();
    const pick = vi.fn();
    t.ui.openChoice('두루마리', options, pick, false);
    t.advance(0.3);
    t.tap('choice2');
    expect(pick).not.toHaveBeenCalled();
    t.tap('modal-bg');
    expect(pick).not.toHaveBeenCalled();
    t.ui.key('cancel');
    expect(t.ui.modal).toBe(true);
    t.ui.key('confirm');
    expect(pick).toHaveBeenCalledWith(0);

    const u = setup();
    const pick2 = vi.fn();
    u.ui.openChoice('교체', options, pick2, true);
    u.advance(0.3);
    u.tap('modal-bg');
    expect(pick2).toHaveBeenCalledWith(-1);
    expect(u.ui.modal).toBe(false);
  });

  it('keyboard selection: arrows move, Enter picks, Esc cancels', () => {
    const t = setup();
    const pick = vi.fn();
    t.ui.openChoice('두루마리', options, pick, true);
    t.ui.key('right');
    t.ui.key('confirm');
    expect(pick).toHaveBeenCalledWith(1);
    const u = setup();
    const pick2 = vi.fn();
    u.ui.openChoice('두루마리', options, pick2, true);
    u.ui.key('cancel');
    expect(pick2).toHaveBeenCalledWith(-1);
  });

  it('every card is a big touch target', () => {
    const t = setup({ W: 480 });
    t.ui.openChoice('두루마리', options, () => {}, true);
    t.advance(0.3);
    for (let i = 0; i < 3; i++) {
      const r = t.game.taps.byId('choice' + i)!.rect;
      expect(r.w).toBeGreaterThanOrEqual(90);
      expect(r.h).toBeGreaterThanOrEqual(120);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(480);
    }
  });
});

describe('LevelUI: alchemist', () => {
  it('buys the selected upgrade with carried cells and persists', () => {
    const t = setup();
    t.ui.openAlchemist();
    t.advance(0.3);
    t.ui.key('confirm'); // first affordable = flask1 (30)
    expect(t.run.cells).toBe(70);
    expect(t.game.save.upgrades.flask).toBe(1);
    expect(t.game.persist).toHaveBeenCalled();
    expect(t.ui.modal).toBe(true); // stays open for more purchases
  });

  it('refuses when cells are missing', () => {
    const t = setup();
    t.run.cells = 5;
    t.ui.openAlchemist();
    t.advance(0.3);
    t.ui.key('confirm');
    expect(t.run.cells).toBe(5);
    expect(t.game.save.upgrades.flask).toBe(0);
    expect(t.game.persist).not.toHaveBeenCalled();
  });

  it('rows are tappable (ten to a page), buy and close buttons exist, rows fit in the view', () => {
    const t = setup({ W: 480 });
    t.ui.openAlchemist();
    t.advance(0.3);
    for (let i = 0; i < ALCHEMIST_PAGE; i++) {
      const r = t.game.taps.byId('alch' + i)!.rect;
      expect(r.h).toBeGreaterThanOrEqual(32);
      expect(r.x + r.w).toBeLessThanOrEqual(480);
      expect(r.y + r.h).toBeLessThanOrEqual(360 - 50);
    }
    expect(t.game.taps.byId('alch' + ALCHEMIST_PAGE), 'the next page is not on screen').toBeNull();
    t.tap('alch3'); // the blood sword blueprint
    t.tap('alch-buy');
    expect(t.game.save.unlocked).toContain('blood_sword');
    expect(t.run.cells).toBe(80);
    t.tap('alch-close');
    expect(t.ui.modal).toBe(false);
  });

  it('the blueprints of the item expansion are paged: < > turn the pages, every upgrade is on exactly one page and fits', () => {
    const t = setup({ W: 480 });
    t.ui.openAlchemist();
    t.advance(0.3);
    const pages = Math.ceil(META_UPGRADES.length / ALCHEMIST_PAGE);
    expect(pages).toBe(3);
    const seen = new Set<number>();
    for (let p = 0; p < pages; p++) {
      const ids = t.game.taps.regions.map((r: { id: string }) => r.id).filter((id: string) => /^alch\d+$/.test(id)).map((id: string) => Number(id.slice(4)));
      expect(ids.length, `page ${p + 1}`).toBe(Math.min(ALCHEMIST_PAGE, META_UPGRADES.length - p * ALCHEMIST_PAGE));
      for (const i of ids) {
        expect(Math.floor(i / ALCHEMIST_PAGE)).toBe(p);
        const r = t.game.taps.byId('alch' + i)!.rect;
        expect(r.y + r.h).toBeLessThanOrEqual(360 - 50);
        seen.add(i);
      }
      // the pager buttons are there, below the rows and clear of the close / buy buttons
      const prev = t.game.taps.byId('alch-prev')!.rect;
      const next = t.game.taps.byId('alch-next')!.rect;
      const close = t.game.taps.byId('alch-close')!.rect;
      const buy = t.game.taps.byId('alch-buy')!.rect;
      expect(prev.x).toBeGreaterThanOrEqual(close.x + close.w);
      expect(next.x + next.w).toBeLessThanOrEqual(buy.x);
      expect(prev.h).toBeGreaterThanOrEqual(32);
      t.tap('alch-next');
      t.advance(0.05);
    }
    expect(seen.size).toBe(META_UPGRADES.length);
    // after the last page it wraps to the first; < goes back
    expect(t.game.taps.byId('alch0')).toBeTruthy();
    t.tap('alch-prev');
    t.advance(0.05);
    expect(t.game.taps.byId('alch' + (META_UPGRADES.length - 1))).toBeTruthy();
    // a row of a later page buys its blueprint
    t.run.cells = 100;
    t.tap('alch' + (META_UPGRADES.length - 1));
    t.tap('alch-buy');
    expect(t.game.save.unlocked).toContain(META_UPGRADES[META_UPGRADES.length - 1].item);
  });

  it('keys move through all the upgrades and the page follows the selection; LB / RB turn the pages', () => {
    const t = setup({ W: 480 });
    t.ui.openAlchemist();
    t.advance(0.3);
    const modal = t.ui.top as AlchemistModal;
    for (let i = 0; i < 6; i++) t.ui.key('down'); // two rows per key: 12 upgrades further
    expect([modal.sel, modal.page]).toEqual([12 + 0, 1]);
    t.ui.key('up');
    t.ui.key('up');
    t.ui.key('up');
    t.ui.key('up');
    t.ui.key('up');
    t.ui.key('up');
    expect([modal.sel, modal.page]).toEqual([0, 0]);
    modal.tab(1);
    expect([modal.sel, modal.page]).toEqual([ALCHEMIST_PAGE, 1]);
    modal.tab(-1);
    modal.tab(-1);
    expect(modal.page).toBe(Math.ceil(META_UPGRADES.length / ALCHEMIST_PAGE) - 1);
  });
});

describe('LevelUI: pause + tutorial', () => {
  it('toggles settings and gives up only after confirmation', () => {
    const t = setup();
    t.ui.openPause();
    t.advance(0.3);
    const before = t.game.save.settings.hints;
    t.tap('pause2');
    expect(t.game.save.settings.hints).toBe(!before);
    t.advance(0.05);
    t.tap('pause5'); // 포기하기 (after 설정 = pause3 and 도감 = pause4): the first press asks for confirmation
    expect(t.game.playerDied).not.toHaveBeenCalled();
    t.advance(0.05);
    t.tap('pause5');
    expect(t.game.playerDied).toHaveBeenCalledTimes(1);
  });

  it('first run shows the gesture tutorial; dismissing turns hints off', () => {
    const t = setup();
    t.game.save.settings.hints = true;
    t.run.levelIndex = 0;
    t.ui.onLevelStart();
    expect(t.ui.modal).toBe(true);
    t.advance(0.3);
    t.tap('tutorial-ok');
    expect(t.ui.modal).toBe(false);
    expect(t.game.save.settings.hints).toBe(false);
    // not shown again
    t.ui.onLevelStart();
    expect(t.ui.modal).toBe(false);
  });

  it('no tutorial when hints are off or past level 1', () => {
    const a = setup();
    a.game.save.settings.hints = false;
    a.ui.onLevelStart();
    expect(a.ui.modal).toBe(false);
    const b = setup();
    b.game.save.settings.hints = true;
    b.run.levelIndex = 2;
    b.ui.onLevelStart();
    expect(b.ui.modal).toBe(false);
  });
});
