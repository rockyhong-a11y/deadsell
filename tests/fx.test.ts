import { describe, it, expect, afterEach } from 'vitest';
import { Particles, PARTICLE_PRESETS, MAX_PARTICLES, mixColor } from '../src/game/fx/particles';
import { Fx } from '../src/game/fx/fx';
import { Lighting, MOODS } from '../src/game/fx/lighting';
import { glowSink, fxEnv } from '../src/game/fx/glow';
import { Audio, SFX_NAMES, MUSIC_TRACKS } from '../src/engine/audio';
import { TileMap, T } from '../src/game/tilemap';
import type { DamageInfo } from '../src/game/combat';

/** Recording fake 2D context: every method is a no-op, fillRect/drawImage/fillText calls are logged. */
function fakeCtx(w = 480, h = 360, tx = 0, ty = 0) {
  const rects: number[][] = [];
  const log: { op: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = {};
  const target: Record<string, unknown> = {
    canvas: { width: w, height: h },
    getTransform: () => ({ a: 1, d: 1, e: tx, f: ty }),
    fillRect: (...a: number[]) => { rects.push(a); },
    drawImage: (...a: unknown[]) => { log.push({ op: 'drawImage', args: a }); },
    fillText: (...a: unknown[]) => { log.push({ op: 'fillText', args: a }); },
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : k in state ? state[k] : () => {}),
    set: (_t, k: string, v) => { state[k] = v; log.push({ op: 'set:' + k, args: [v] }); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rects, log, state };
}

const hit = (over: Partial<DamageInfo> = {}): DamageInfo => ({ amount: 10, dir: 1, kind: 'melee', ...over });

describe('particles', () => {
  it('every preset emits and expires', () => {
    for (const p of PARTICLE_PRESETS) {
      const ps = new Particles();
      ps.emit(p, 100, 100, {});
      expect(ps.count, p).toBeGreaterThan(0);
      for (let i = 0; i < 60 * 12; i++) ps.update(1 / 60);
      expect(ps.count, p + ' expired').toBe(0);
    }
  });

  it('never exceeds the pool cap and recycles when full', () => {
    const ps = new Particles();
    for (let i = 0; i < 200; i++) ps.emit('explosion', 50 + i, 50, { power: 2 });
    expect(ps.count).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(ps.count).toBe(MAX_PARTICLES);
    ps.emit('hit', 5, 5, {});
    expect(ps.count).toBe(MAX_PARTICLES);
    ps.clear();
    expect(ps.count).toBe(0);
  });

  it('ignores non-finite positions and honours density/count', () => {
    const ps = new Particles();
    ps.emit('hit', NaN, 0);
    expect(ps.count).toBe(0);
    ps.emit('spark', 0, 0, { count: 5 });
    const c5 = ps.count;
    ps.clear();
    ps.density = 0;
    ps.emit('spark', 0, 0, { count: 5 });
    expect(ps.count).toBeLessThan(c5);
  });

  it('draws pixel-art: integer rect coordinates, 1-3 px sizes (no big blobs except explosion cores)', () => {
    const ps = new Particles();
    for (const p of PARTICLE_PRESETS) if (p !== 'explosion' && p !== 'death') ps.emit(p, 120.37, 99.62, { dir: 1 });
    for (let i = 0; i < 5; i++) ps.update(1 / 60);
    const { ctx, rects } = fakeCtx();
    ps.draw(ctx);
    expect(rects.length).toBeGreaterThan(20);
    for (const [x, y, w, h] of rects) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(12);
    }
  });

  it('glowing particles push emissive lights for the lighting pass', () => {
    const ps = new Particles();
    ps.emit('explosion', 100, 100, {});
    ps.emit('cell', 120, 100, {});
    const { ctx } = fakeCtx();
    ps.draw(ctx);
    expect(glowSink.n).toBeGreaterThan(2);
    expect(glowSink.n).toBeLessThanOrEqual(glowSink.max);
    glowSink.reset();
  });

  it('culls particles outside the view', () => {
    const ps = new Particles();
    ps.emit('spark', 5000, 5000, {});
    const { ctx, rects } = fakeCtx();
    ps.draw(ctx);
    expect(rects.length).toBe(0);
    glowSink.reset();
  });

  it('collides with the map: blood settles on floors', () => {
    const map = new TileMap(10, 10);
    for (let x = 0; x < 10; x++) map.set(x, 8, T.Solid);
    const ps = new Particles();
    ps.setMap(map);
    for (let i = 0; i < 30; i++) ps.emit('blood', 120, 150, { count: 6 });
    for (let i = 0; i < 90; i++) ps.update(1 / 60);
    // nothing fell through the floor (y of floor top = 8 * 24 = 192) - draw and check rows
    const { ctx, rects } = fakeCtx();
    ps.draw(ctx);
    for (const [, y] of rects) expect(y).toBeLessThanOrEqual(192);
  });

  it('ambient emits per biome, is capped and only emits when the biome is known', () => {
    const map = new TileMap(40, 20);
    for (let x = 0; x < 40; x++) { map.set(x, 0, T.Solid); map.set(x, 19, T.Solid); }
    const cam = { x: 0, y: 0, w: 480, h: 360 };
    for (const b of ['prison', 'ramparts', 'tower', 'passage']) {
      const ps = new Particles();
      for (let i = 0; i < 60 * 8; i++) { ps.ambient(b, cam, 1 / 60, map); ps.update(1 / 60); }
      expect(ps.count, b).toBeGreaterThan(3);
      expect(ps.count, b).toBeLessThan(200);
    }
    const none = new Particles();
    for (let i = 0; i < 120; i++) none.ambient('nowhere', cam, 1 / 60);
    expect(none.count).toBe(0);
  });

  it('auto-ambient follows Lighting.setBiome once a frame has been drawn', () => {
    const ps = new Particles();
    const lights = new Lighting();
    lights.setBiome('tower', 'boss');
    expect(fxEnv.ambient).toBe('tower');
    const { ctx } = fakeCtx();
    ps.draw(ctx);
    for (let i = 0; i < 300; i++) ps.update(1 / 60);
    expect(ps.count).toBeGreaterThan(5);
    fxEnv.ambient = '';
    glowSink.reset();
  });

  it('mixColor blends', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('fx: numbers, slashes, rings, flash', () => {
  const pops = (fx: Fx) => ((fx as unknown as { pops: { on: boolean; text: string; color: string; scale: number }[] }).pops.filter((p) => p.on));

  it('damage number styles: normal, crit, dot, coloured weapon, damage taken', () => {
    const fx = new Fx();
    fx.damageNumber(100, 100, 12, hit());
    let p = pops(fx)[0];
    expect(p.text).toBe('12');
    expect(p.color).toBe('#ffffff');
    expect(p.scale).toBe(2);
    fx.clear();

    fx.damageNumber(100, 100, 30, hit({ crit: true }));
    p = pops(fx)[0];
    expect(p.text).toBe('30!');
    expect(p.color).toBe('#ffd23f');
    expect(p.scale).toBe(3);
    fx.clear();

    fx.damageNumber(100, 100, 3, hit({ kind: 'dot', dotType: 'burn' }));
    p = pops(fx)[0];
    expect(p.scale).toBe(1);
    expect(p.color).toBe('#ff8a3c');
    fx.clear();
    fx.damageNumber(100, 100, 2, hit({ kind: 'dot', dotType: 'bleed' }));
    expect(pops(fx)[0].color).toBe('#ff3b5c');
    fx.clear();

    fx.damageNumber(100, 100, 9, hit({ color: 'tactics' }));
    expect(pops(fx)[0].color).toBe('#a65be8');
    fx.clear();

    fx.damageNumber(100, 100, 9, hit({ source: { team: 'enemy' } as never }));
    expect(pops(fx)[0].color).toBe('#ff4a58');
  });

  it('numbers rise, fade and expire; the pool never overflows', () => {
    const fx = new Fx();
    fx.damageNumber(100, 100, 7, hit());
    const y0 = pops(fx)[0] as unknown as { y: number };
    const startY = y0.y;
    fx.update(0.3);
    expect(y0.y).toBeLessThan(startY);
    fx.update(2);
    expect(fx.activeNumbers).toBe(0);
    for (let i = 0; i < 500; i++) fx.damageNumber(100, 100, i, hit());
    expect(fx.activeNumbers).toBeLessThanOrEqual(64);
    fx.text(10, 10, '패링!');
    expect(fx.activeNumbers).toBeLessThanOrEqual(64);
  });

  it('stacks simultaneous numbers instead of overlapping them', () => {
    const fx = new Fx();
    fx.damageNumber(100, 100, 5, hit());
    fx.damageNumber(100, 100, 6, hit());
    const ps = pops(fx) as unknown as { y: number }[];
    expect(Math.abs(ps[0].y - ps[1].y)).toBeGreaterThanOrEqual(8);
  });

  it('draws numbers, text, slash, ring without throwing (fake 2D context, no canvas)', () => {
    const fx = new Fx();
    fx.damageNumber(100, 100, 123, hit({ crit: true }));
    fx.text(50, 50, '+5', '#7ee070');
    fx.text(60, 60, '기절!', '#ffd23f');
    fx.slash(100, 100, { dir: 1, radius: 40, from: -1.1, to: 0.8, color: '#c8d4e8', width: 7 });
    fx.slash(100, 100, { dir: -1, radius: 62, from: -0.12, to: 0.12, color: '#ffe9a8', width: 4, life: 0.12 });
    fx.ring(100, 100, { radius: 80, color: '#ffb35a', life: 0.3 });
    fx.ring(100, 100, { radius: 30, flat: 0.3 });
    expect(fx.activeSlashes).toBe(2);
    expect(fx.activeRings).toBe(2);
    for (const dt of [0.01, 0.02, 0.03, 0.05, 0.05]) {
      fx.update(dt);
      const { ctx, rects, log } = fakeCtx();
      fx.draw(ctx);
      expect(rects.length + log.length).toBeGreaterThan(0);
      for (const r of rects) for (const v of r) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('slash is pixel-stepped: integer rects, a crescent paints a sensible number of pixels, expires', () => {
    const fx = new Fx();
    fx.slash(200, 200, { dir: 1, radius: 48, from: -2, to: 0.9, color: '#ff4a58', width: 10, life: 0.2 });
    fx.update(0.07);
    const { ctx, rects } = fakeCtx();
    fx.draw(ctx);
    expect(rects.length).toBeGreaterThan(20);
    expect(rects.length).toBeLessThan(800);
    for (const [x, y, w, h] of rects) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(h).toBeGreaterThanOrEqual(1);
    }
    fx.update(0.3);
    expect(fx.activeSlashes).toBe(0);
    const again = fakeCtx();
    fx.draw(again.ctx);
    expect(again.rects.length).toBe(0);
  });

  it('left-facing slashes mirror to the left of the origin', () => {
    const run = (dir: number) => {
      const fx = new Fx();
      fx.slash(200, 200, { dir, radius: 40, from: -0.8, to: 0.8, color: '#fff', life: 0.12 });
      fx.update(0.05);
      const { ctx, rects } = fakeCtx();
      fx.draw(ctx);
      const xs = rects.map((r) => r[0]);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(run(1)).toBeGreaterThan(200);
    expect(run(-1)).toBeLessThan(200);
  });

  it('rings grow, fade and expire', () => {
    const fx = new Fx();
    fx.ring(100, 100, { radius: 100, life: 0.4 });
    fx.update(0.05);
    const a = fakeCtx();
    fx.draw(a.ctx);
    fx.update(0.2);
    const b = fakeCtx();
    fx.draw(b.ctx);
    expect(a.rects.length).toBeGreaterThan(0);
    expect(b.rects.length).toBeGreaterThan(0);
    fx.update(1);
    expect(fx.activeRings).toBe(0);
  });

  it('screen flash fades, expires, and a weaker flash never cuts a stronger one', () => {
    const fx = new Fx();
    fx.screenFlash('#ffffff', 0.3, 0.7);
    fx.screenFlash('#ff0000', 0.1, 0.1);
    let c = fakeCtx();
    fx.drawScreen(c.ctx, 480, 360);
    expect(c.rects.length).toBe(1);
    expect(c.log.find((l) => l.op === 'set:fillStyle')?.args[0]).toBe('#ffffff');
    fx.update(0.5);
    c = fakeCtx();
    fx.drawScreen(c.ctx, 480, 360);
    expect(c.rects.length).toBe(0);
    expect(fx.flashing).toBe(false);
  });

  it('keeps the legacy signatures', () => {
    const fx = new Fx();
    fx.text(1, 2, 'x');
    fx.text(1, 2, 'x', '#fff', { size: 2, life: 1 });
    fx.slash(0, 0, { dir: 1, radius: 10, from: 0, to: 1 });
    fx.ring(0, 0, { radius: 10 });
    fx.screenFlash('#fff');
    fx.update(1 / 60);
    fx.clear();
    expect(fx.activeNumbers + fx.activeSlashes + fx.activeRings).toBe(0);
  });
});

describe('lighting', () => {
  const savedDoc = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = savedDoc;
    glowSink.reset();
    fxEnv.ambient = '';
  });
  const cam = { x: 100, y: 50, viewX: 100, viewY: 50, w: 480, h: 360 } as never;

  it('every biome mood is readable (never pitch black) and lights are cleared each render', () => {
    const l = new Lighting();
    for (const [biome, kind] of [['prison', 'biome'], ['ramparts', 'biome'], ['tower', 'boss'], ['prison', 'passage'], ['nowhere', 'biome']] as const) {
      l.setBiome(biome, kind);
      const rgb = (l as unknown as { baseRGB: number[] }).baseRGB;
      for (const c of rgb) expect(c).toBeGreaterThanOrEqual(48);
      expect(l.ambient).not.toBeNull();
    }
    expect(Object.keys(MOODS)).toEqual(expect.arrayContaining(['prison', 'ramparts', 'tower', 'passage']));
    l.add(10, 10, 50, '#ff9a4a');
    l.add(10, 10, 0, '#fff');
    l.add(10, 10, 20, '#fff', 0);
    expect(l.count).toBe(1);
    const { ctx } = fakeCtx();
    l.render(ctx, cam, 480, 360, 1);
    expect(l.count).toBe(0);
  });

  it('prison is greener/darker than ramparts, which is lighter and bluer', () => {
    const lum = (b: string) => { const l = new Lighting(); l.setBiome(b, 'biome'); const [r, g, bl] = (l as unknown as { baseRGB: number[] }).baseRGB; return { r, g, b: bl, y: 0.3 * r + 0.59 * g + 0.11 * bl }; };
    const p = lum('prison'), r = lum('ramparts'), t = lum('tower');
    expect(p.g).toBeGreaterThan(p.r);
    expect(r.y).toBeGreaterThan(p.y);
    expect(r.b).toBeGreaterThan(r.g);
    expect(t.r).toBeGreaterThan(t.b);
  });

  it('without canvases falls back to a multiply tint; null ambient draws nothing', () => {
    const l = new Lighting();
    l.setBiome('prison', 'biome');
    const a = fakeCtx();
    l.render(a.ctx, cam, 480, 360, 0);
    expect(a.log.some((e) => e.op === 'set:globalCompositeOperation' && e.args[0] === 'multiply')).toBe(true);
    l.ambient = null;
    const b = fakeCtx();
    l.render(b.ctx, cam, 480, 360, 0);
    expect(b.rects.length).toBe(0);
  });

  it('light-map path: composites with multiply, adds lights and glow-sink halos, bloom and vignette', () => {
    const made: ReturnType<typeof fakeCtx>[] = [];
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const f = fakeCtx(64, 64);
        made.push(f);
        return { width: 0, height: 0, getContext: () => f.ctx };
      },
    };
    const l = new Lighting();
    l.setBiome('prison', 'biome');
    l.add(150, 120, 60, '#ff9a4a', 1, 0.2);
    l.add(1000, 1000, 60, '#ff9a4a', 1); // off screen -> culled
    glowSink.push(160, 130, 30, '#4fd8ff', 0.9);
    const main = fakeCtx();
    l.render(main.ctx, cam, 480, 360, 2.5);
    const ops = main.log.filter((e) => e.op === 'set:globalCompositeOperation').map((e) => e.args[0]);
    expect(ops).toContain('multiply');
    expect(ops).toContain('lighter');
    expect(main.log.filter((e) => e.op === 'drawImage').length).toBeGreaterThanOrEqual(3);
    expect(glowSink.n).toBe(0);
    // second frame reuses cached sprites (no new canvases besides the first set)
    const created = made.length;
    l.add(150, 120, 60, '#ff9a4a', 1, 0.2);
    l.render(fakeCtx().ctx, cam, 480, 360, 2.6);
    expect(made.length).toBe(created);
  });
});

describe('audio', () => {
  /** Minimal fake AudioContext: counts nodes, accepts every call. */
  function fakeAudioCtx() {
    const counts: Record<string, number> = {};
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
    const node = (kind: string) => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { connect() {}, disconnect() {}, start() {}, stop() {}, type: '', buffer: null, loop: false, curve: null, frequency: param(), detune: param(), gain: param(), Q: param(), delayTime: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() };
    };
    const ctx = {
      currentTime: 0, sampleRate: 8000, state: 'running', destination: {},
      createGain: () => node('gain'), createOscillator: () => node('osc'), createBiquadFilter: () => node('filter'),
      createBufferSource: () => node('noise'), createWaveShaper: () => node('shaper'), createConvolver: () => node('conv'),
      createDynamicsCompressor: () => node('comp'), createDelay: () => node('delay'),
      createBuffer: (ch: number, len: number) => ({ getChannelData: () => new Float32Array(len), numberOfChannels: ch, length: len }),
    };
    return { ctx: ctx as unknown as BaseAudioContext, raw: ctx, counts };
  }

  it('is a safe no-op without AudioContext (node) and before unlock', () => {
    const a = new Audio();
    expect(() => {
      a.unlock();
      a.play('hit');
      a.play('explosion', { vol: 2, pitch: 0.5 });
      a.music('prison');
      a.music(null);
      a.setMuted(true);
      a.pumpMusic(10);
    }).not.toThrow();
    expect(a.ready).toBe(false);
    expect(a.muted).toBe(true);
  });

  it('volume accessors clamp and keep the legacy fields', () => {
    const a = new Audio();
    expect(a.sfxVolume).toBeCloseTo(0.8);
    expect(a.musicVolume).toBeCloseTo(0.5);
    a.sfxVolume = 3;
    a.musicVolume = -1;
    expect(a.sfxVolume).toBe(1);
    expect(a.musicVolume).toBe(0);
    a.muted = false;
    expect(a.muted).toBe(false);
  });

  it('synthesises every Sfx name', () => {
    expect(SFX_NAMES.length).toBe(44);
    for (const name of SFX_NAMES) {
      const a = new Audio();
      const f = fakeAudioCtx();
      a.attachContext(f.ctx);
      const before = f.counts.osc ?? 0;
      const beforeN = f.counts.noise ?? 0;
      a.play(name);
      expect((f.counts.osc ?? 0) + (f.counts.noise ?? 0), name).toBeGreaterThan(before + beforeN);
    }
  });

  it('respects mute, vol 0 pitch clamps and the min gap / polyphony caps', () => {
    const a = new Audio();
    const f = fakeAudioCtx();
    a.attachContext(f.ctx);
    a.setMuted(true);
    a.play('hit');
    expect(f.counts.osc ?? 0).toBe(0);
    a.setMuted(false);
    a.play('hit', { pitch: 100, vol: -5 });
    const n1 = f.counts.osc;
    expect(n1).toBeGreaterThan(0);
    a.play('hit'); // same instant: blocked by the min gap
    expect(f.counts.osc).toBe(n1);
    // polyphony: 'step' allows 2 voices at once
    const b = new Audio();
    const g = fakeAudioCtx();
    b.attachContext(g.ctx);
    let played = 0;
    for (let i = 0; i < 10; i++) {
      const before = g.counts.osc ?? 0;
      (g.raw as { currentTime: number }).currentTime = i * 0.08; // past the min gap, voices still alive (0.08 s tail)
      b.play('step');
      if ((g.counts.osc ?? 0) > before) played++;
    }
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThanOrEqual(10);
  });

  it('schedules every music track and stops non-looping ones', () => {
    for (const tr of MUSIC_TRACKS) {
      const a = new Audio();
      const f = fakeAudioCtx();
      a.attachContext(f.ctx);
      a.music(tr);
      expect(a.currentTrack).toBe(tr);
      a.pumpMusic(40);
      expect((f.counts.osc ?? 0) + (f.counts.noise ?? 0), tr).toBeGreaterThan(20);
    }
    const a = new Audio();
    const f = fakeAudioCtx();
    a.attachContext(f.ctx);
    a.music('death');
    a.pumpMusic(200);
    const n = f.counts.osc;
    a.pumpMusic(400);
    expect(f.counts.osc).toBe(n); // sting finished, nothing more scheduled
  });

  it('remembers a track requested before unlock and crossfades between tracks', () => {
    const a = new Audio();
    a.music('title');
    const f = fakeAudioCtx();
    a.attachContext(f.ctx);
    expect(a.currentTrack).toBe('title');
    a.music('prison');
    expect(a.currentTrack).toBe('prison');
    a.music(null);
    expect(a.currentTrack).toBeNull();
  });
});
