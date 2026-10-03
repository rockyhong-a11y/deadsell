/**
 * Procedural WebAudio sound (no audio files): synthesised SFX and looping procedural music.
 * OWNER: fx/audio agent.
 *
 * Graph:  voices -> sfxBus ----\
 *         music runs -> musicBus -> compressor -> master -> limiter -> destination
 *         (each bus has its own convolution reverb send; music runs also get a feedback echo)
 *
 * Safe everywhere: without `AudioContext` (node tests, old browsers) or before `unlock()` every
 * method is a harmless no-op; `music()` and `setMuted()` requested before unlock are remembered and
 * applied on unlock. `attachContext()` lets tests render sounds offline with an OfflineAudioContext.
 */
export type Sfx =
  | 'swing' | 'swing_heavy' | 'stab' | 'hit' | 'hit_heavy' | 'crit' | 'jump' | 'double_jump' | 'land' | 'roll'
  | 'step' | 'hurt' | 'player_death' | 'enemy_death' | 'pickup_cell' | 'pickup_gold' | 'pickup_item' | 'heal'
  | 'chest' | 'door' | 'parry' | 'block' | 'bow_draw' | 'bow_shoot' | 'arrow_hit' | 'throw' | 'explosion'
  | 'freeze' | 'turret' | 'trap' | 'slam' | 'telegraph' | 'boss_roar' | 'boss_slam' | 'boss_step' | 'bell'
  | 'ui_tap' | 'ui_open' | 'ui_close' | 'scroll' | 'buy' | 'error' | 'break_wall' | 'flask_empty';

export type MusicTrack = 'title' | 'prison' | 'ramparts' | 'passage' | 'boss' | 'victory' | 'death';

export const SFX_NAMES: readonly Sfx[] = [
  'swing', 'swing_heavy', 'stab', 'hit', 'hit_heavy', 'crit', 'jump', 'double_jump', 'land', 'roll',
  'step', 'hurt', 'player_death', 'enemy_death', 'pickup_cell', 'pickup_gold', 'pickup_item', 'heal',
  'chest', 'door', 'parry', 'block', 'bow_draw', 'bow_shoot', 'arrow_hit', 'throw', 'explosion',
  'freeze', 'turret', 'trap', 'slam', 'telegraph', 'boss_roar', 'boss_slam', 'boss_step', 'bell',
  'ui_tap', 'ui_open', 'ui_close', 'scroll', 'buy', 'error', 'break_wall', 'flask_empty',
];
export const MUSIC_TRACKS: readonly MusicTrack[] = ['title', 'prison', 'ramparts', 'passage', 'boss', 'victory', 'death'];

type AC = BaseAudioContext;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = Math.random;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ======================================================================= synth primitives
interface OscP {
  f: number;
  /** glide target (exponential) */
  f1?: number;
  /** glide duration (default = d) */
  fd?: number;
  type?: OscillatorType;
  /** total duration (s) */
  d: number;
  /** peak gain */
  v: number;
  /** attack (s) */
  a?: number;
  /** sustained envelope (attack, hold, linear release `r`) instead of a percussive exponential decay */
  hold?: boolean;
  r?: number;
  /** detune in cents */
  det?: number;
  /** lowpass cutoff (and optional end cutoff) */
  lp?: number;
  lp1?: number;
  q?: number;
  /** vibrato depth (Hz) and rate (Hz) */
  vib?: number;
  vibRate?: number;
  /** reverb / echo send amounts */
  rv?: number;
  ec?: number;
}

interface NzP {
  type?: BiquadFilterType;
  f: number;
  f1?: number;
  q?: number;
  d: number;
  v: number;
  a?: number;
  hold?: boolean;
  r?: number;
  rv?: number;
  ec?: number;
}

/** [frequency ratio, amplitude, decay scale] */
type Partials = readonly (readonly [number, number, number])[];
const BELL: Partials = [[0.5, 1, 1], [1, 1, 0.9], [1.183, 0.6, 0.75], [1.506, 0.5, 0.6], [2, 0.45, 0.55], [2.514, 0.35, 0.4], [2.662, 0.3, 0.35], [3.011, 0.25, 0.3], [4.166, 0.18, 0.2]];
const CLANG: Partials = [[1, 1, 1], [2.76, 0.7, 0.6], [5.4, 0.55, 0.4], [8.93, 0.4, 0.3], [11.34, 0.25, 0.2]];
const GLASS: Partials = [[1, 1, 1], [2.01, 0.45, 0.6], [3.02, 0.25, 0.4], [5.1, 0.12, 0.25]];

const satCurves = new Map<number, Float32Array<ArrayBuffer>>();
function satCurve(drive: number): Float32Array<ArrayBuffer> {
  let c = satCurves.get(drive);
  if (!c) {
    c = new Float32Array(257);
    const norm = Math.tanh(drive);
    for (let i = 0; i < 257; i++) c[i] = Math.tanh(((i / 128) - 1) * drive) / norm;
    satCurves.set(drive, c);
  }
  return c;
}

/** Voice factory bound to a context, a shared noise buffer and optional reverb/echo inputs. */
class Synth {
  constructor(readonly c: AC, readonly noise: AudioBuffer, public rev: AudioNode | null = null, public echo: AudioNode | null = null) {}

  private env(g: AudioParam, t: number, v: number, a: number, d: number, hold?: boolean, r?: number): void {
    g.setValueAtTime(0.0001, t);
    if (hold) {
      const att = Math.min(a, d);
      g.linearRampToValueAtTime(v, t + att);
      const rel = Math.min(r ?? 0.2, Math.max(0, d - att));
      g.setValueAtTime(v, t + d - rel);
      g.linearRampToValueAtTime(0.0001, t + d);
    } else {
      g.linearRampToValueAtTime(v, t + Math.min(a, d * 0.5));
      g.exponentialRampToValueAtTime(0.0001, t + d);
    }
  }

  private sends(g: GainNode, rv?: number, ec?: number): void {
    if (rv && this.rev) {
      const w = this.c.createGain();
      w.gain.value = rv;
      g.connect(w);
      w.connect(this.rev);
    }
    if (ec && this.echo) {
      const w = this.c.createGain();
      w.gain.value = ec;
      g.connect(w);
      w.connect(this.echo);
    }
  }

  osc(dest: AudioNode, t: number, p: OscP): void {
    const c = this.c;
    const o = c.createOscillator();
    o.type = p.type ?? 'sine';
    o.frequency.setValueAtTime(p.f, t);
    if (p.f1 && p.f1 !== p.f) o.frequency.exponentialRampToValueAtTime(p.f1, t + (p.fd ?? p.d));
    if (p.det) o.detune.value = p.det;
    const g = c.createGain();
    this.env(g.gain, t, p.v, p.a ?? 0.004, p.d, p.hold, p.r);
    if (p.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(p.lp, t);
      if (p.lp1) f.frequency.exponentialRampToValueAtTime(p.lp1, t + p.d);
      f.Q.value = p.q ?? 0.7;
      o.connect(f);
      f.connect(g);
    } else o.connect(g);
    if (p.vib) {
      const l = c.createOscillator();
      const lg = c.createGain();
      l.frequency.value = p.vibRate ?? 5.5;
      lg.gain.value = p.vib;
      l.connect(lg);
      lg.connect(o.frequency);
      l.start(t);
      l.stop(t + p.d + 0.1);
    }
    g.connect(dest);
    this.sends(g, p.rv, p.ec);
    o.start(t);
    o.stop(t + p.d + 0.06);
  }

  nz(dest: AudioNode, t: number, p: NzP): void {
    const c = this.c;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = p.type ?? 'bandpass';
    f.frequency.setValueAtTime(p.f, t);
    if (p.f1 && p.f1 !== p.f) f.frequency.exponentialRampToValueAtTime(p.f1, t + p.d);
    f.Q.value = p.q ?? 0.8;
    const g = c.createGain();
    this.env(g.gain, t, p.v, p.a ?? 0.003, p.d, p.hold, p.r);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    this.sends(g, p.rv, p.ec);
    src.start(t, rnd() * 1.4);
    src.stop(t + p.d + 0.06);
  }

  /** Sum of inharmonic partials with per-partial decay (bells, chimes, metal). */
  bell(dest: AudioNode, t: number, f: number, v: number, d: number, set: Partials, rv = 0, a = 0.002): void {
    for (const [ratio, amp, dec] of set) {
      const pf = f * ratio;
      if (pf > 14000) continue;
      this.osc(dest, t, { f: pf, d: Math.max(0.05, d * dec), v: v * amp, a, rv: rv * (ratio < 3 ? 1 : 0.5) });
    }
  }

  /** Soft-clip stage for crunchy hits; returns the node voices should connect to. */
  sat(dest: AudioNode, drive: number): AudioNode {
    const w = this.c.createWaveShaper();
    w.curve = satCurve(drive);
    w.connect(dest);
    return w;
  }
}

// ======================================================================= SFX recipes
/** (synth, output, start time, pitch multiplier) -> approx duration in seconds */
type Recipe = (s: Synth, o: AudioNode, t: number, k: number) => number;

const RECIPES: Record<Sfx, Recipe> = {
  swing: (s, o, t, k) => {
    s.nz(o, t, { type: 'bandpass', f: 600 * k, f1: 2600 * k, q: 1.3, d: 0.14, v: 0.42, a: 0.035 });
    s.nz(o, t + 0.02, { type: 'highpass', f: 2800 * k, d: 0.09, v: 0.1, a: 0.03 });
    return 0.2;
  },
  swing_heavy: (s, o, t, k) => {
    s.nz(o, t, { type: 'bandpass', f: 260 * k, f1: 1700 * k, q: 1.0, d: 0.26, v: 0.55, a: 0.09 });
    s.osc(o, t, { f: 150 * k, f1: 55 * k, d: 0.24, v: 0.28, a: 0.04 });
    s.nz(o, t + 0.06, { type: 'highpass', f: 2200 * k, d: 0.12, v: 0.1, a: 0.05 });
    return 0.3;
  },
  stab: (s, o, t, k) => {
    s.nz(o, t, { type: 'bandpass', f: 1800 * k, f1: 5200 * k, q: 1.6, d: 0.09, v: 0.4, a: 0.012 });
    s.osc(o, t, { f: 900 * k, f1: 380 * k, type: 'triangle', d: 0.07, v: 0.14 });
    return 0.12;
  },
  hit: (s, o, t, k) => {
    const w = s.sat(o, 4);
    s.nz(w, t, { type: 'lowpass', f: 4200 * k, f1: 500 * k, q: 0.7, d: 0.1, v: 0.6, a: 0.002 });
    s.osc(w, t, { f: 200 * k, f1: 70 * k, d: 0.1, v: 0.55, a: 0.002 });
    s.osc(o, t, { f: 1500 * k, f1: 300 * k, type: 'square', d: 0.025, v: 0.08 });
    s.nz(o, t + 0.01, { type: 'highpass', f: 3500, d: 0.05, v: 0.1 });
    return 0.14;
  },
  hit_heavy: (s, o, t, k) => {
    const w = s.sat(o, 5);
    s.nz(w, t, { type: 'lowpass', f: 3000 * k, f1: 300 * k, q: 0.7, d: 0.2, v: 0.65, a: 0.002 });
    s.osc(w, t, { f: 140 * k, f1: 45 * k, d: 0.22, v: 0.65, a: 0.002 });
    s.osc(w, t, { f: 95 * k, f1: 40 * k, type: 'sawtooth', d: 0.15, v: 0.18, lp: 500 });
    s.osc(o, t, { f: 1200 * k, f1: 250 * k, type: 'square', d: 0.03, v: 0.09 });
    s.nz(o, t + 0.01, { type: 'highpass', f: 3000, d: 0.08, v: 0.12 });
    return 0.26;
  },
  crit: (s, o, t, k) => {
    const w = s.sat(o, 5);
    s.nz(w, t, { type: 'lowpass', f: 3600 * k, f1: 400 * k, q: 0.7, d: 0.18, v: 0.55, a: 0.002 });
    s.osc(w, t, { f: 150 * k, f1: 50 * k, d: 0.2, v: 0.55, a: 0.002 });
    s.bell(o, t, 1250 * k, 0.16, 0.5, CLANG, 0.25);
    s.osc(o, t + 0.01, { f: 3300 * k, d: 0.25, v: 0.1, rv: 0.2 });
    s.nz(o, t, { type: 'highpass', f: 4500, d: 0.1, v: 0.18 });
    return 0.55;
  },
  jump: (s, o, t, k) => {
    s.osc(o, t, { f: 230 * k, f1: 520 * k, type: 'triangle', d: 0.13, v: 0.2, a: 0.01 });
    s.nz(o, t, { type: 'bandpass', f: 500 * k, f1: 1400 * k, q: 0.9, d: 0.1, v: 0.12, a: 0.02 });
    return 0.16;
  },
  double_jump: (s, o, t, k) => {
    s.osc(o, t, { f: 340 * k, f1: 820 * k, type: 'triangle', d: 0.14, v: 0.2, a: 0.01 });
    s.osc(o, t, { f: 680 * k, f1: 1640 * k, d: 0.1, v: 0.08 });
    s.nz(o, t, { type: 'highpass', f: 3000 * k, d: 0.1, v: 0.1, a: 0.02 });
    return 0.18;
  },
  land: (s, o, t, k) => {
    s.nz(o, t, { type: 'lowpass', f: 1100 * k, f1: 180 * k, d: 0.12, v: 0.35 });
    s.osc(o, t, { f: 95 * k, f1: 42 * k, d: 0.13, v: 0.4 });
    return 0.16;
  },
  roll: (s, o, t, k) => {
    s.nz(o, t, { type: 'bandpass', f: 500 * k, f1: 1100 * k, q: 0.9, d: 0.16, v: 0.26, a: 0.05 });
    s.nz(o, t + 0.14, { type: 'bandpass', f: 1100 * k, f1: 400 * k, q: 0.9, d: 0.16, v: 0.2, a: 0.02 });
    return 0.32;
  },
  step: (s, o, t, k) => {
    s.nz(o, t, { type: 'lowpass', f: 1300 * k, f1: 300 * k, d: 0.055, v: 0.2 });
    s.osc(o, t, { f: 130 * k, f1: 75 * k, d: 0.06, v: 0.15 });
    return 0.08;
  },
  hurt: (s, o, t, k) => {
    const w = s.sat(o, 2.5);
    s.osc(w, t, { f: 420 * k, f1: 170 * k, type: 'sawtooth', d: 0.22, v: 0.28, lp: 1500, lp1: 500 });
    s.osc(w, t, { f: 210 * k, f1: 90 * k, type: 'square', d: 0.2, v: 0.12, lp: 900 });
    s.nz(o, t, { type: 'bandpass', f: 800 * k, f1: 300 * k, d: 0.12, v: 0.28 });
    return 0.26;
  },
  player_death: (s, o, t, k) => {
    s.osc(o, t, { f: 300 * k, f1: 45 * k, type: 'sawtooth', d: 1.0, v: 0.26, lp: 1600, lp1: 150, a: 0.01 });
    s.osc(o, t, { f: 150 * k, f1: 28 * k, d: 0.9, v: 0.4 });
    s.nz(o, t, { type: 'lowpass', f: 2500, f1: 100, d: 0.9, v: 0.3 });
    s.bell(o, t + 0.1, 220 * k, 0.1, 1.6, GLASS, 0.6, 0.01);
    return 1.7;
  },
  enemy_death: (s, o, t, k) => {
    s.nz(o, t, { type: 'lowpass', f: 2600 * k, f1: 180 * k, d: 0.38, v: 0.45, a: 0.005 });
    s.osc(o, t, { f: 220 * k, f1: 50 * k, d: 0.32, v: 0.42 });
    s.osc(o, t, { f: 180 * k, f1: 60 * k, type: 'sawtooth', d: 0.25, v: 0.13, lp: 900 });
    for (let i = 0; i < 3; i++) s.osc(o, t + 0.05 + i * 0.05, { f: (1400 + i * 500 + rnd() * 200) * k, d: 0.1, v: 0.05 });
    return 0.42;
  },
  pickup_cell: (s, o, t, k) => {
    s.bell(o, t, 1318 * k, 0.2, 0.5, GLASS, 0.35);
    s.bell(o, t + 0.07, 1976 * k, 0.15, 0.45, GLASS, 0.35);
    return 0.6;
  },
  pickup_gold: (s, o, t, k) => {
    s.osc(o, t, { f: 1568 * k, type: 'square', d: 0.07, v: 0.09, lp: 4000 });
    s.osc(o, t + 0.06, { f: 2093 * k, type: 'square', d: 0.22, v: 0.1, lp: 5000 });
    s.bell(o, t + 0.06, 2093 * k, 0.05, 0.3, CLANG, 0.2);
    return 0.35;
  },
  pickup_item: (s, o, t, k) => {
    const notes = [72, 76, 79, 84];
    for (let i = 0; i < notes.length; i++) s.bell(o, t + 0.07 * i, mtof(notes[i]) * k, 0.16, 0.8, GLASS, 0.5);
    return 1.1;
  },
  heal: (s, o, t, k) => {
    s.osc(o, t, { f: 392 * k, f1: 784 * k, d: 0.45, v: 0.18, a: 0.1, hold: true, r: 0.2 });
    s.bell(o, t + 0.1, 988 * k, 0.1, 0.6, GLASS, 0.4);
    s.bell(o, t + 0.2, 1318 * k, 0.1, 0.6, GLASS, 0.4);
    return 0.85;
  },
  chest: (s, o, t, k) => {
    s.osc(o, t, { f: 90 * k, f1: 150 * k, type: 'sawtooth', d: 0.5, v: 0.2, a: 0.08, hold: true, r: 0.2, vib: 14, vibRate: 17, lp: 700, lp1: 1000, q: 5 });
    s.osc(o, t + 0.45, { f: 120 * k, f1: 55 * k, d: 0.15, v: 0.4 });
    s.nz(o, t + 0.45, { type: 'lowpass', f: 800, f1: 200, d: 0.1, v: 0.3 });
    s.bell(o, t + 0.5, 1568 * k, 0.08, 0.7, GLASS, 0.5);
    s.bell(o, t + 0.58, 2093 * k, 0.06, 0.7, GLASS, 0.5);
    return 1.3;
  },
  door: (s, o, t, k) => {
    s.osc(o, t, { f: 60 * k, f1: 110 * k, type: 'sawtooth', d: 0.7, v: 0.24, a: 0.12, hold: true, r: 0.25, vib: 9, vibRate: 11, lp: 250, lp1: 700, q: 6 });
    s.nz(o, t, { type: 'bandpass', f: 200 * k, f1: 400 * k, q: 1.5, d: 0.7, v: 0.16, a: 0.15, hold: true, r: 0.2 });
    s.osc(o, t + 0.65, { f: 80 * k, f1: 35 * k, d: 0.25, v: 0.5 });
    s.nz(o, t + 0.65, { type: 'lowpass', f: 600, f1: 100, d: 0.2, v: 0.35 });
    return 0.95;
  },
  parry: (s, o, t, k) => {
    s.bell(o, t, 1100 * k, 0.28, 0.5, CLANG, 0.3);
    s.nz(o, t, { type: 'highpass', f: 3000, d: 0.06, v: 0.32 });
    s.osc(o, t, { f: 2800 * k, d: 0.25, v: 0.09, rv: 0.2 });
    s.osc(o, t, { f: 300 * k, f1: 150 * k, d: 0.06, v: 0.3 });
    return 0.55;
  },
  block: (s, o, t, k) => {
    s.nz(o, t, { type: 'lowpass', f: 1800 * k, f1: 300 * k, d: 0.09, v: 0.45 });
    s.osc(o, t, { f: 190 * k, f1: 90 * k, d: 0.1, v: 0.5 });
    s.bell(o, t, 520 * k, 0.11, 0.15, CLANG);
    return 0.2;
  },
  bow_draw: (s, o, t, k) => {
    s.osc(o, t, { f: 120 * k, f1: 240 * k, type: 'triangle', d: 0.32, v: 0.09, a: 0.12, hold: true, r: 0.1, vib: 6, vibRate: 22 });
    s.nz(o, t, { type: 'bandpass', f: 1500 * k, f1: 2500 * k, q: 2, d: 0.3, v: 0.06, a: 0.1, hold: true, r: 0.1 });
    return 0.35;
  },
  bow_shoot: (s, o, t, k) => {
    s.osc(o, t, { f: 380 * k, f1: 160 * k, type: 'triangle', d: 0.18, v: 0.33, lp: 2200, lp1: 600 });
    s.osc(o, t, { f: 190 * k, d: 0.15, v: 0.14 });
    s.nz(o, t, { type: 'bandpass', f: 1500 * k, f1: 4000 * k, q: 1.2, d: 0.07, v: 0.2 });
    s.nz(o, t + 0.02, { type: 'highpass', f: 2500, d: 0.1, v: 0.08, a: 0.02 });
    return 0.22;
  },
  arrow_hit: (s, o, t, k) => {
    s.osc(o, t, { f: 230 * k, f1: 110 * k, d: 0.06, v: 0.4 });
    s.nz(o, t, { type: 'lowpass', f: 2500 * k, f1: 400 * k, d: 0.06, v: 0.33 });
    s.osc(o, t, { f: 700 * k, type: 'triangle', d: 0.08, v: 0.06 });
    return 0.1;
  },
  throw: (s, o, t, k) => {
    s.nz(o, t, { type: 'bandpass', f: 400 * k, f1: 1400 * k, q: 1, d: 0.17, v: 0.33, a: 0.05 });
    s.osc(o, t, { f: 250 * k, f1: 450 * k, type: 'triangle', d: 0.12, v: 0.08 });
    return 0.2;
  },
  explosion: (s, o, t, k) => {
    const w = s.sat(o, 2);
    s.nz(w, t, { type: 'lowpass', f: 3500 * k, f1: 70, q: 0.5, d: 1.0, v: 0.8, a: 0.004, rv: 0.25 });
    s.osc(w, t, { f: 100 * k, f1: 26, d: 0.85, v: 0.8 });
    s.osc(w, t, { f: 60 * k, f1: 28, type: 'sawtooth', d: 0.5, v: 0.26, lp: 200 });
    for (let i = 0; i < 5; i++) s.nz(o, t + 0.1 + i * 0.07 + rnd() * 0.03, { type: 'highpass', f: 2500, d: 0.05, v: 0.14 });
    return 1.1;
  },
  freeze: (s, o, t, k) => {
    for (let i = 0; i < 6; i++) s.osc(o, t + i * 0.03, { f: (2400 + rnd() * 1800) * k, d: 0.25, v: 0.07, rv: 0.4 });
    s.nz(o, t, { type: 'highpass', f: 6000, d: 0.25, v: 0.18, a: 0.01 });
    s.nz(o, t, { type: 'bandpass', f: 1500, f1: 6000, q: 1.2, d: 0.3, v: 0.14, a: 0.1 });
    return 0.5;
  },
  turret: (s, o, t, k) => {
    s.osc(o, t, { f: 140 * k, f1: 90 * k, type: 'square', d: 0.05, v: 0.18, lp: 1200 });
    s.nz(o, t, { type: 'bandpass', f: 2500, q: 1.5, d: 0.03, v: 0.3 });
    s.osc(o, t + 0.015, { f: 300 * k, f1: 150 * k, type: 'triangle', d: 0.09, v: 0.2 });
    return 0.12;
  },
  trap: (s, o, t, k) => {
    s.nz(o, t, { type: 'highpass', f: 2500, d: 0.04, v: 0.45 });
    s.bell(o, t, 700 * k, 0.22, 0.3, CLANG, 0.15);
    s.osc(o, t, { f: 160 * k, f1: 70 * k, d: 0.09, v: 0.4 });
    return 0.35;
  },
  slam: (s, o, t, k) => {
    const w = s.sat(o, 3);
    s.osc(w, t, { f: 110 * k, f1: 28, d: 0.35, v: 0.85 });
    s.nz(w, t, { type: 'lowpass', f: 2000 * k, f1: 120, d: 0.35, v: 0.55 });
    s.nz(o, t, { type: 'bandpass', f: 100, f1: 200, q: 1.2, d: 0.5, v: 0.35, a: 0.02 });
    for (let i = 0; i < 4; i++) s.nz(o, t + 0.08 + i * 0.05 + rnd() * 0.03, { type: 'highpass', f: 3000, d: 0.04, v: 0.09 });
    return 0.55;
  },
  telegraph: (s, o, t, k) => {
    s.osc(o, t, { f: 520 * k, f1: 780 * k, type: 'sawtooth', d: 0.09, v: 0.15, lp: 3000 });
    s.osc(o, t + 0.09, { f: 780 * k, type: 'sawtooth', d: 0.1, v: 0.13, lp: 3000 });
    s.nz(o, t, { type: 'highpass', f: 4000, d: 0.05, v: 0.07 });
    return 0.22;
  },
  boss_roar: (s, o, t, k) => {
    const w = s.sat(o, 3);
    s.osc(w, t, { f: 85 * k, f1: 55 * k, type: 'sawtooth', d: 1.3, v: 0.42, lp: 700, lp1: 250, q: 3, a: 0.12, vib: 10, vibRate: 22 });
    s.osc(w, t, { f: 128 * k, f1: 70 * k, type: 'sawtooth', d: 1.2, v: 0.22, lp: 900, lp1: 300, q: 2, a: 0.1, vib: 14, vibRate: 31 });
    s.nz(o, t, { type: 'bandpass', f: 400, f1: 900, q: 2, d: 1.2, v: 0.3, a: 0.15, rv: 0.2 });
    s.nz(o, t + 0.1, { type: 'bandpass', f: 1100, f1: 600, q: 3, d: 0.9, v: 0.12, a: 0.2 });
    s.osc(o, t, { f: 55 * k, f1: 38, d: 1.3, v: 0.45, a: 0.1 });
    return 1.5;
  },
  boss_slam: (s, o, t, k) => {
    const w = s.sat(o, 3.5);
    s.osc(w, t, { f: 95 * k, f1: 24, d: 0.5, v: 0.9 });
    s.nz(w, t, { type: 'lowpass', f: 1800, f1: 90, d: 0.5, v: 0.6 });
    s.nz(o, t, { type: 'bandpass', f: 90, f1: 180, q: 1.2, d: 0.7, v: 0.35, a: 0.02 });
    s.bell(o, t, 90 * k, 0.2, 1.0, CLANG, 0.3);
    for (let i = 0; i < 8; i++) s.nz(o, t + 0.1 + rnd() * 0.5, { type: 'bandpass', f: 4000, q: 4, d: 0.025, v: 0.09 });
    return 1.0;
  },
  boss_step: (s, o, t, k) => {
    s.osc(o, t, { f: 70 * k, f1: 30, d: 0.3, v: 0.65 });
    s.nz(o, t, { type: 'lowpass', f: 500 * k, f1: 90, d: 0.25, v: 0.45 });
    for (let i = 0; i < 3; i++) s.nz(o, t + 0.05 + i * 0.04 + rnd() * 0.02, { type: 'bandpass', f: 3500, q: 4, d: 0.02, v: 0.06 });
    return 0.35;
  },
  bell: (s, o, t, k) => {
    s.bell(o, t, 196 * k, 0.3, 3.2, BELL, 0.5, 0.003);
    s.nz(o, t, { type: 'bandpass', f: 2500, q: 1.5, d: 0.03, v: 0.14 });
    return 3.3;
  },
  ui_tap: (s, o, t, k) => {
    s.osc(o, t, { f: 1400 * k, f1: 1000 * k, d: 0.035, v: 0.17 });
    s.nz(o, t, { type: 'highpass', f: 5000, d: 0.015, v: 0.05 });
    return 0.05;
  },
  ui_open: (s, o, t, k) => {
    s.osc(o, t, { f: 420 * k, f1: 820 * k, type: 'triangle', d: 0.1, v: 0.14, a: 0.01 });
    s.nz(o, t, { type: 'bandpass', f: 1200, f1: 3000, d: 0.09, v: 0.06 });
    s.osc(o, t + 0.05, { f: 840 * k, f1: 1260 * k, d: 0.09, v: 0.08 });
    return 0.16;
  },
  ui_close: (s, o, t, k) => {
    s.osc(o, t, { f: 820 * k, f1: 420 * k, type: 'triangle', d: 0.1, v: 0.14, a: 0.01 });
    s.nz(o, t, { type: 'bandpass', f: 3000, f1: 1200, d: 0.09, v: 0.05 });
    return 0.13;
  },
  scroll: (s, o, t, k) => {
    s.nz(o, t, { type: 'bandpass', f: 3200, f1: 2000, q: 1.2, d: 0.12, v: 0.2, a: 0.02 });
    s.nz(o, t + 0.06, { type: 'bandpass', f: 2800, f1: 1800, q: 1.2, d: 0.1, v: 0.15, a: 0.02 });
    s.bell(o, t + 0.12, 1568 * k, 0.1, 0.55, GLASS, 0.4);
    s.bell(o, t + 0.2, 2093 * k, 0.08, 0.55, GLASS, 0.4);
    return 0.8;
  },
  buy: (s, o, t, k) => {
    const f = [2093, 2637, 3136];
    for (let i = 0; i < 3; i++) s.osc(o, t + i * 0.05, { f: f[i] * k, type: 'square', d: 0.06, v: 0.08, lp: 5000 });
    s.bell(o, t + 0.12, 3136 * k, 0.09, 0.35, CLANG, 0.2);
    return 0.5;
  },
  error: (s, o, t, k) => {
    s.osc(o, t, { f: 150 * k, type: 'square', d: 0.1, v: 0.12, lp: 700 });
    s.osc(o, t + 0.12, { f: 120 * k, type: 'square', d: 0.14, v: 0.12, lp: 700 });
    return 0.28;
  },
  break_wall: (s, o, t, k) => {
    const w = s.sat(o, 2);
    s.nz(w, t, { type: 'lowpass', f: 2500 * k, f1: 150, d: 0.5, v: 0.65 });
    s.osc(w, t, { f: 90 * k, f1: 38, d: 0.3, v: 0.5 });
    for (let i = 0; i < 8; i++) s.nz(o, t + 0.05 + rnd() * 0.4, { type: 'bandpass', f: 800 + rnd() * 2200, q: 1.5, d: 0.04 + rnd() * 0.04, v: 0.11 });
    return 0.6;
  },
  flask_empty: (s, o, t, k) => {
    s.bell(o, t, 2100 * k, 0.09, 0.1, CLANG);
    s.bell(o, t + 0.09, 1700 * k, 0.08, 0.1, CLANG);
    s.nz(o, t, { type: 'lowpass', f: 1000, d: 0.03, v: 0.1 });
    s.osc(o, t, { f: 220 * k, f1: 160 * k, type: 'triangle', d: 0.12, v: 0.1 });
    return 0.25;
  },
};

/** max simultaneous voices of one effect */
const POLY: Partial<Record<Sfx, number>> = {
  step: 2, swing: 3, swing_heavy: 2, stab: 3, hit: 4, hit_heavy: 3, crit: 2, explosion: 3, boss_roar: 1, boss_slam: 2,
  boss_step: 2, bell: 3, pickup_cell: 6, pickup_gold: 6, slam: 2, telegraph: 3, ui_tap: 3, land: 2, hurt: 2,
  player_death: 1, enemy_death: 4, break_wall: 2, door: 2, chest: 2, freeze: 2,
};
const POLY_DEFAULT = 4;
const GLOBAL_POLY = 30;
/** random pitch variation (fraction) per effect; default 0.03 */
const VARY: Partial<Record<Sfx, number>> = {
  hit: 0.1, hit_heavy: 0.08, step: 0.15, boss_step: 0.06, swing: 0.08, swing_heavy: 0.06, stab: 0.06, land: 0.08,
  enemy_death: 0.1, hurt: 0.05, arrow_hit: 0.08, ui_tap: 0, ui_open: 0, ui_close: 0, error: 0, pickup_cell: 0,
  pickup_gold: 0, pickup_item: 0, scroll: 0, buy: 0, bell: 0, telegraph: 0,
};
/** minimum gap between two plays of the same effect (s) */
const MIN_GAP: Partial<Record<Sfx, number>> = { step: 0.07, hit: 0.03, hit_heavy: 0.04, swing: 0.04, pickup_cell: 0.025, pickup_gold: 0.025, ui_tap: 0.04, arrow_hit: 0.03 };

// ======================================================================= music
interface MusicCtx {
  s: Synth;
  d: AudioNode;
  /** audio time of this 16th step */
  t: number;
  /** global 16th-step counter */
  n: number;
  /** bar index (wrapped to the track's loop length) and 16th within the bar */
  bar: number;
  st: number;
  /** step / bar duration (s) */
  sd: number;
  bd: number;
}

interface Track {
  bpm: number;
  bars: number;
  loop: boolean;
  /** relative loudness */
  level: number;
  /** crossfade-in seconds */
  fade: number;
  /** echo delay in steps (0 = none) */
  echo: number;
  step(m: MusicCtx): void;
}

function pad(m: MusicCtx, notes: number[], dur: number, v: number, lp: number, type: OscillatorType = 'sawtooth', att = 1.2, rv = 0.4): void {
  for (const n of notes) {
    const f = mtof(n);
    m.s.osc(m.d, m.t, { f, type, d: dur, v, a: att, hold: true, r: 1.4, det: -6, lp, q: 0.6, rv });
    m.s.osc(m.d, m.t, { f, type, d: dur, v, a: att, hold: true, r: 1.4, det: 6, lp, q: 0.6 });
  }
}

function pluck(m: MusicCtx, midi: number, off: number, v: number, d = 1.0, lp = 2400, type: OscillatorType = 'triangle', rv = 0.5, ec = 0.5): void {
  m.s.osc(m.d, m.t + off * m.sd, { f: mtof(midi), type, d, v, a: 0.004, lp, lp1: Math.max(300, lp * 0.3), q: 0.8, rv, ec });
}

function kick(m: MusicCtx, off: number, v: number, f0 = 150, f1 = 45): void {
  const t = m.t + off * m.sd;
  m.s.osc(m.d, t, { f: f0, f1, d: 0.22, v, a: 0.002 });
  m.s.osc(m.d, t, { f: 1800, f1: 200, type: 'square', d: 0.012, v: v * 0.12 });
}

function snare(m: MusicCtx, off: number, v: number): void {
  const t = m.t + off * m.sd;
  m.s.nz(m.d, t, { type: 'bandpass', f: 1900, q: 0.7, d: 0.14, v, a: 0.002, rv: 0.12 });
  m.s.osc(m.d, t, { f: 190, f1: 130, type: 'triangle', d: 0.1, v: v * 0.6 });
}

function hat(m: MusicCtx, off: number, v: number, d = 0.03): void {
  m.s.nz(m.d, m.t + off * m.sd, { type: 'highpass', f: 7500, d, v, a: 0.001 });
}

const TRACKS: Record<MusicTrack, Track> = {
  // ---------------------------------------------------------- title: haunting arpeggio + pad (D minor)
  title: {
    bpm: 66, bars: 8, loop: true, level: 1, fade: 1.5, echo: 3,
    step(m) {
      const CH = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
      const ROOT = [38, 34, 31, 33];
      const ci = Math.floor(m.bar / 2) % 4;
      const ch = CH[ci];
      if (m.st === 0 && m.bar % 2 === 0) {
        pad(m, ch, m.bd * 2 + 1.4, 0.02, 700);
        m.s.osc(m.d, m.t, { f: mtof(ROOT[ci]), d: m.bd * 2 + 1.2, v: 0.09, a: 1.0, hold: true, r: 1.2 });
      }
      const ext = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[2] + 12];
      const ARP = [0, 1, 2, 4, 2, 1, -1, 2, 3, 2, 1, -1, 0, 1, 2, 5];
      if (m.st % 2 === 0) {
        const p = ARP[(m.bar % 2) * 8 + m.st / 2];
        if (p >= 0) pluck(m, ext[p] + 12, 0, m.st === 0 ? 0.075 : 0.055, 1.5, 2600);
      }
      if (m.st === 8 && m.bar % 2 === 1 && rnd() < 0.55) m.s.osc(m.d, m.t, { f: mtof(ch[2] + 36), d: 3, v: 0.03, a: 0.01, rv: 0.9, ec: 0.4 });
    },
  },
  // ---------------------------------------------------------- prison: dark drone, sparse plucks, soft percussion (E phrygian)
  prison: {
    bpm: 72, bars: 8, loop: true, level: 1, fade: 1.6, echo: 3,
    step(m) {
      if (m.st === 0 && m.bar % 2 === 0) {
        pad(m, [28, 35, 40], m.bd * 2 + 1.6, 0.045, 230, 'sawtooth', 1.6, 0.3);
        if (m.bar % 4 === 2) m.s.osc(m.d, m.t, { f: mtof(41), d: m.bd * 2, v: 0.03, a: 1.4, hold: true, r: 1.0, rv: 0.6 });
      }
      const SC = [52, 53, 55, 57, 59, 60, 62, 64];
      if (m.st % 2 === 0 && rnd() < (m.st === 0 ? 0.35 : 0.14)) {
        const i = Math.min(SC.length - 1, Math.floor(rnd() * rnd() * SC.length * 1.4));
        pluck(m, SC[i], 0, 0.085, 1.3, 1900);
      }
      if (m.st === 0) kick(m, 0, 0.24, 95, 40);
      if (m.st === 10 && m.bar % 2 === 1) kick(m, 0, 0.16, 90, 40);
      if (m.st === 4 || m.st === 12) m.s.nz(m.d, m.t, { type: 'highpass', f: 6000, d: 0.03, v: 0.04 });
      if (rnd() < 0.05) for (let i = 0; i < 3; i++) m.s.nz(m.d, m.t + i * 0.035, { type: 'bandpass', f: 3500, q: 4, d: 0.015, v: 0.03, rv: 0.3 });
      if (rnd() < 0.025) m.s.osc(m.d, m.t, { f: 1500 + rnd() * 400, f1: 2100, d: 0.07, v: 0.04, rv: 0.8 });
    },
  },
  // ---------------------------------------------------------- ramparts: windy pad + melody (D minor)
  ramparts: {
    bpm: 96, bars: 8, loop: true, level: 1, fade: 1.5, echo: 3,
    step(m) {
      const CH = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]];
      const ROOT = [38, 34, 41, 36];
      const MEL: number[][][] = [
        [[0, 74, 6], [6, 72, 2], [8, 69, 8]],
        [[0, 70, 4], [4, 72, 4], [8, 74, 8]],
        [[0, 77, 6], [6, 76, 2], [8, 72, 8]],
        [[0, 72, 4], [4, 67, 4], [8, 64, 4], [12, 67, 4]],
        [[0, 69, 4], [4, 74, 4], [8, 77, 8]],
        [[0, 77, 6], [6, 74, 2], [8, 70, 8]],
        [[0, 72, 4], [4, 76, 4], [8, 77, 4], [12, 81, 4]],
        [[0, 79, 8], [8, 76, 4], [12, 72, 4]],
      ];
      const ci = m.bar % 4;
      if (m.st === 0) {
        pad(m, CH[ci], m.bd + 1.2, 0.022, 1000, 'sawtooth', 0.5);
        m.s.osc(m.d, m.t, { f: mtof(ROOT[ci]), d: m.bd, v: 0.1, a: 0.02, rv: 0.2 });
      }
      if (m.st === 8) m.s.osc(m.d, m.t, { f: mtof(ROOT[ci]), d: m.bd * 0.5, v: 0.07, a: 0.02 });
      if (m.st === 0 && m.bar % 2 === 0) m.s.nz(m.d, m.t, { type: 'bandpass', f: 350 + rnd() * 200, f1: 800 + rnd() * 500, q: 0.8, d: m.bd * 2 + 1, v: 0.1, a: 1.5, hold: true, r: 1.2, rv: 0.4 });
      for (const [off, note, len] of MEL[m.bar]) {
        if (off === m.st) {
          const d = len * m.sd * 1.1;
          m.s.osc(m.d, m.t, { f: mtof(note), type: 'triangle', d, v: 0.085, a: 0.015, hold: true, r: Math.min(0.3, d * 0.5), vib: 3, vibRate: 5.2, rv: 0.5, ec: 0.45 });
          m.s.osc(m.d, m.t, { f: mtof(note) * 2, d, v: 0.018, a: 0.02, hold: true, r: 0.1 });
        }
      }
      if (m.st % 2 === 0) hat(m, 0, m.st % 4 === 0 ? 0.03 : 0.018, 0.05);
      if (m.st === 0 && m.bar % 2 === 0) kick(m, 0, 0.16, 100, 45);
      if (m.st === 8 && m.bar % 2 === 1) kick(m, 0, 0.1, 100, 45);
    },
  },
  // ---------------------------------------------------------- passage: calm, warm (C lydian)
  passage: {
    bpm: 64, bars: 8, loop: true, level: 1, fade: 1.4, echo: 3,
    step(m) {
      const CH = [[48, 52, 55, 59], [53, 57, 60, 64], [45, 48, 52, 55], [43, 47, 50, 52]];
      const ci = Math.floor(m.bar / 2) % 4;
      const ch = CH[ci];
      if (m.st === 0 && m.bar % 2 === 0) {
        pad(m, ch, m.bd * 2 + 1.4, 0.02, 1400, 'triangle', 1.2, 0.5);
        m.s.osc(m.d, m.t, { f: mtof(ch[0] - 12), d: m.bd * 2 + 1.2, v: 0.08, a: 1.2, hold: true, r: 1.2 });
      }
      if (m.st % 4 === 0 && rnd() < 0.62) {
        const n = ch[Math.floor(rnd() * ch.length)] + 24;
        pluck(m, n, 0, 0.06, 1.8, 3000, 'sine', 0.7, 0.45);
      }
      if (rnd() < 0.14) m.s.nz(m.d, m.t, { type: 'highpass', f: 4500, d: 0.012, v: 0.03 });
    },
  },
  // ---------------------------------------------------------- boss: driving percussion + bass ostinato (E phrygian)
  boss: {
    bpm: 144, bars: 8, loop: true, level: 1, fade: 0.4, echo: 3,
    step(m) {
      const hi = m.bar >= 4;
      if (m.st % 4 === 0) kick(m, 0, 0.5);
      if ((m.st === 6 || m.st === 14) && (m.bar % 2 === 1 || hi)) kick(m, 0, 0.33);
      if (m.st === 4 || m.st === 12) snare(m, 0, 0.26);
      hat(m, 0, m.st % 4 === 2 ? 0.09 : hi ? 0.045 : m.st % 2 === 0 ? 0.04 : 0, 0.03);
      if (m.bar % 4 === 3 && m.st >= 12) {
        // tom fill
        m.s.osc(m.d, m.t, { f: 150 - (m.st - 12) * 16, f1: 70, d: 0.14, v: 0.32 });
      }
      const A = [40, 40, 52, 40, 40, 43, 40, 41];
      const B = [40, 40, 52, 40, 43, 40, 46, 45];
      if (m.st % 2 === 0) {
        const seq = hi ? B : A;
        const note = seq[m.st / 2];
        m.s.osc(m.d, m.t, { f: mtof(note), type: 'sawtooth', d: m.sd * 1.8, v: 0.17, a: 0.004, lp: 520, lp1: 220, q: 2 });
        m.s.osc(m.d, m.t, { f: mtof(note - 12), d: m.sd * 1.8, v: 0.18, a: 0.004 });
      }
      if (m.bar % 4 === 0 && m.st === 0) {
        pad(m, [52, 53, 59], m.bd * 4 + 1.5, 0.028, 800, 'sawtooth', 1.0, 0.5);
        m.s.bell(m.d, m.t, mtof(40), 0.1, 3.5, BELL, 0.5);
      }
      if ((m.bar % 4 === 0 || m.bar % 4 === 2) && (m.st === 0 || m.st === 6)) {
        for (const n of [52, 55, 59]) m.s.osc(m.d, m.t, { f: mtof(n), type: 'sawtooth', d: 0.28, v: 0.04, a: 0.01, lp: 1500, lp1: 300, det: m.st === 6 ? 8 : -8 });
      }
    },
  },
  // ---------------------------------------------------------- victory: major resolve (C major)
  victory: {
    bpm: 96, bars: 8, loop: true, level: 1, fade: 0.3, echo: 3,
    step(m) {
      const CH = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50], [41, 45, 48], [48, 52, 55]];
      const ch = CH[m.bar];
      if (m.st === 0) {
        pad(m, ch, m.bd + 1.0, 0.025, 1800, 'triangle', 0.3, 0.5);
        pad(m, [ch[0] + 12, ch[1] + 12], m.bd + 1.0, 0.012, 2500, 'sawtooth', 0.3, 0.3);
        m.s.osc(m.d, m.t, { f: mtof(ch[0] - 12), d: m.bd, v: 0.1, a: 0.02 });
      }
      if (m.st % 2 === 0) {
        const i = m.st / 2;
        const up = m.bar < 4 || m.bar === 6;
        const seq = up ? [0, 1, 2, 3, 2, 3, 4, 5] : [4, 3, 2, 1, 2, 1, 0, 1];
        const ext = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24, ch[1] + 24, ch[2] + 24];
        const last = m.bar === 7;
        if (!last || m.st === 0) m.s.bell(m.d, m.t, mtof(ext[seq[i]] + (last ? 12 : 0)), last ? 0.14 : 0.1, last ? 3 : 0.8, GLASS, 0.5);
      }
      if (m.st === 0 || m.st === 8) kick(m, 0, 0.18, 110, 50);
      if (m.st === 4 || m.st === 12) hat(m, 0, 0.03, 0.04);
    },
  },
  // ---------------------------------------------------------- death: descending sting then fading drone (A minor)
  death: {
    bpm: 56, bars: 6, loop: false, level: 1, fade: 0.25, echo: 3,
    step(m) {
      const CH = [[45, 48, 52], [41, 45, 48], [38, 41, 45], [40, 44, 47], [40, 44, 47], [40, 44, 47]];
      const ch = CH[m.bar];
      if (m.n === 0) {
        m.s.osc(m.d, m.t, { f: 85, f1: 30, d: 1.2, v: 0.5, a: 0.003 });
        m.s.nz(m.d, m.t, { type: 'lowpass', f: 2000, f1: 100, d: 0.9, v: 0.3 });
      }
      if (m.st === 0) {
        if (m.bar < 4) pad(m, ch, m.bd + 1.5, 0.03, 700, 'sawtooth', 0.6, 0.6);
        else if (m.bar === 4) pad(m, ch, m.bd * 2 + 1, 0.02, 500, 'sawtooth', 0.8, 0.7);
        m.s.osc(m.d, m.t, { f: mtof(ch[0] - 12), d: m.bd + 1, v: 0.1, a: 0.1, hold: true, r: 1.0 });
      }
      const MELO = [69, 67, 65, 64];
      if (m.st === 0 && m.bar < 4) pluck(m, MELO[m.bar], 0, 0.1, 3.0, 2500, 'triangle', 0.8, 0.5);
      if (m.st === 8 && m.bar < 4) pluck(m, MELO[m.bar] - 12, 0, 0.05, 2.0, 1500, 'sine', 0.6, 0.3);
    },
  },
};

interface MusicRun {
  name: MusicTrack;
  track: Track;
  /** fade bus (everything of this run goes through it) */
  bus: GainNode;
  synth: Synth;
  /** echo nodes (disposed with the run) */
  nodes: AudioNode[];
  /** audio time of the next 16th to schedule, and its global index */
  t: number;
  n: number;
  stepDur: number;
  stopped: boolean;
  done: boolean;
}

// ======================================================================= Audio
export class Audio {
  muted = false;
  private _sfx = 0.8;
  private _music = 0.5;

  private ctx: AC | null = null;
  private offline = false;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxSynth: Synth | null = null;
  private noise: AudioBuffer | null = null;
  private musicConv: ConvolverNode | null = null;
  private run: MusicRun | null = null;
  private wanted: MusicTrack | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private voices = new Map<Sfx, number[]>();
  private lastPlay = new Map<Sfx, number>();
  private all: number[] = [];
  private hooked = false;

  get sfxVolume(): number {
    return this._sfx;
  }
  set sfxVolume(v: number) {
    this._sfx = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    this.applyVolumes();
  }
  get musicVolume(): number {
    return this._music;
  }
  set musicVolume(v: number) {
    this._music = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    this.applyVolumes();
  }

  /** true once an AudioContext exists */
  get ready(): boolean {
    return this.ctx !== null;
  }
  /** name of the track currently scheduled (null = silence / not started) */
  get currentTrack(): MusicTrack | null {
    return this.run && !this.run.stopped ? this.run.name : null;
  }

  /** Must be called from a user gesture (first tap) to start the AudioContext. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const g = globalThis as unknown as { AudioContext?: new (o?: object) => AudioContext; webkitAudioContext?: new (o?: object) => AudioContext };
      const AC = g.AudioContext ?? g.webkitAudioContext;
      if (!AC) return;
      try {
        this.build(new AC({ latencyHint: 'interactive' }));
      } catch {
        this.ctx = null;
        return;
      }
      this.hookVisibility();
    }
    const c = this.ctx as AudioContext | null;
    if (c && c.state === 'suspended' && typeof c.resume === 'function') c.resume().catch(() => {});
    if (this.wanted && !this.run) this.switchTo(this.wanted);
  }

  /**
   * Use an existing context instead of creating one (tests render with an OfflineAudioContext).
   * With `offline` the voices are scheduled relative to time 0 and the music scheduler is not timer-driven:
   * call `pumpMusic(untilSeconds)` and then `ctx.startRendering()`.
   */
  attachContext(ctx: BaseAudioContext, offline = true): void {
    this.offline = offline;
    this.build(ctx);
    if (this.wanted && !this.run) this.switchTo(this.wanted);
  }

  /** Schedule music steps up to the given audio time (offline rendering / manual drive). */
  pumpMusic(until: number): void {
    this.pump(until);
  }

  play(sfx: Sfx, o: { vol?: number; pitch?: number } = {}): void {
    const c = this.ctx;
    if (!c || !this.sfxSynth || !this.sfxBus || this.muted) return;
    if (!this.offline && c.state !== 'running') return;
    const rec = RECIPES[sfx];
    if (!rec) return;
    const now = c.currentTime;
    const last = this.lastPlay.get(sfx);
    if (last !== undefined && now - last < (MIN_GAP[sfx] ?? 0.012) && now >= last) return;
    // polyphony: drop finished voices, then enforce per-sfx and global caps
    let list = this.voices.get(sfx);
    if (!list) this.voices.set(sfx, (list = []));
    pruneEnded(list, now);
    pruneEnded(this.all, now);
    if (list.length >= (POLY[sfx] ?? POLY_DEFAULT) || this.all.length >= GLOBAL_POLY) return;
    this.lastPlay.set(sfx, now);
    const vary = VARY[sfx] ?? 0.03;
    const pitch = clamp(o.pitch ?? 1, 0.25, 4) * (1 + (rnd() * 2 - 1) * vary);
    const out = c.createGain();
    out.gain.value = clamp(o.vol ?? 1, 0, 2);
    out.connect(this.sfxBus);
    const t = now + 0.004;
    const dur = rec(this.sfxSynth, out, t, pitch);
    const end = t + dur;
    list.push(end);
    this.all.push(end);
  }

  /** Start (or crossfade to) a looping procedural track; null fades out. */
  music(track: MusicTrack | null): void {
    this.wanted = track;
    if (!this.ctx) return;
    if (track === this.currentTrack && this.run && !this.run.done) return;
    if (track === null && !this.run) return;
    this.switchTo(track);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  // ------------------------------------------------------------ internals
  private applyVolumes(): void {
    const c = this.ctx;
    if (!c || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = c.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this._sfx * 0.9, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this._music * 0.6, t, 0.05);
  }

  private hookVisibility(): void {
    if (this.hooked || typeof document === 'undefined') return;
    this.hooked = true;
    document.addEventListener('visibilitychange', () => {
      const c = this.ctx as AudioContext | null;
      if (!c || this.offline) return;
      if (document.hidden) c.suspend?.().catch(() => {});
      else c.resume?.().catch(() => {});
    });
  }

  private build(c: AC): void {
    this.ctx = c;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    limiter.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(limiter);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this._sfx * 0.9;
    this.sfxBus.connect(comp);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this._music * 0.6;
    this.musicBus.connect(comp);

    // shared white-noise buffer
    const sr = c.sampleRate;
    const nb = c.createBuffer(1, Math.floor(sr * 2), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
    this.noise = nb;

    // reverbs (generated impulse responses)
    const sfxConv = c.createConvolver();
    sfxConv.buffer = makeIR(c, 1.1, 2.6);
    sfxConv.connect(this.sfxBus);
    const musConv = c.createConvolver();
    musConv.buffer = makeIR(c, 1.8, 2.2);
    musConv.connect(this.musicBus);
    this.musicConv = musConv;
    this.sfxSynth = new Synth(c, nb, sfxConv);
    this.applyVolumes();
  }

  private switchTo(track: MusicTrack | null): void {
    const c = this.ctx;
    if (!c || !this.musicBus || !this.noise || !this.musicConv) return;
    const now = c.currentTime;
    const def = track ? TRACKS[track] : null;
    const old = this.run;
    if (old && !old.stopped) {
      const out = def ? Math.max(0.3, def.fade) : 1.2;
      old.stopped = true;
      const g = old.bus.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + out);
      if (!this.offline) setTimeout(() => disposeRun(old), (out + 3) * 1000);
    }
    this.run = null;
    if (!track || !def) return;
    const bus = c.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(def.level, now + def.fade);
    bus.connect(this.musicBus);
    const sd = 60 / def.bpm / 4;
    const nodes: AudioNode[] = [bus];
    let echoIn: AudioNode | null = null;
    if (def.echo > 0) {
      const dl = c.createDelay(2);
      dl.delayTime.value = sd * def.echo;
      const fb = c.createGain();
      fb.gain.value = 0.36;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      dl.connect(lp);
      lp.connect(fb);
      fb.connect(dl);
      lp.connect(bus);
      echoIn = dl;
      nodes.push(dl, fb, lp);
    }
    const synth = new Synth(c, this.noise, this.musicConv, echoIn);
    this.run = { name: track, track: def, bus, synth, nodes, t: now + 0.08, n: 0, stepDur: sd, stopped: false, done: false };
    if (!this.offline && this.timer === null && typeof setInterval !== 'undefined') this.timer = setInterval(() => this.pump(), 40);
  }

  /** Lookahead scheduler: schedule every 16th step that starts before `until`. */
  private pump(until?: number): void {
    const c = this.ctx;
    const r = this.run;
    if (!c || !r || r.stopped || r.done) return;
    const now = c.currentTime;
    const horizon = until ?? now + 0.35;
    if (until === undefined && r.t < now - 0.05) r.t = now + 0.03; // resync after a stall / suspend
    const tr = r.track;
    let guard = 0;
    while (r.t < horizon && guard++ < 200) {
      const barIdx = Math.floor(r.n / 16);
      if (!tr.loop && barIdx >= tr.bars) {
        r.done = true;
        break;
      }
      if (!this.muted) {
        const bar = tr.loop ? barIdx % tr.bars : barIdx;
        tr.step({ s: r.synth, d: r.bus, t: r.t, n: r.n, bar, st: r.n % 16, sd: r.stepDur, bd: r.stepDur * 16 });
      }
      r.n++;
      r.t += r.stepDur;
    }
  }
}

function pruneEnded(list: number[], now: number): void {
  let j = 0;
  for (let i = 0; i < list.length; i++) if (list[i] > now) list[j++] = list[i];
  list.length = j;
}

function disposeRun(r: MusicRun): void {
  for (const n of r.nodes) {
    try {
      n.disconnect();
    } catch {
      /* already gone */
    }
  }
}

/** Generated stereo impulse response: decaying, lowpassed noise. */
function makeIR(c: AC, seconds: number, decay: number): AudioBuffer {
  const sr = c.sampleRate;
  const len = Math.floor(sr * seconds);
  const b = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const x = rnd() * 2 - 1;
      y += (x - y) * 0.38;
      d[i] = y * Math.pow(1 - i / len, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
  }
  return b;
}
