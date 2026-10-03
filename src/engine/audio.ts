/**
 * Procedural WebAudio sound (no audio files). OWNER: fx/audio agent —
 * replace this silent stub, keep the API stable.
 */
export type Sfx =
  | 'swing' | 'swing_heavy' | 'stab' | 'hit' | 'hit_heavy' | 'crit' | 'jump' | 'double_jump' | 'land' | 'roll'
  | 'step' | 'hurt' | 'player_death' | 'enemy_death' | 'pickup_cell' | 'pickup_gold' | 'pickup_item' | 'heal'
  | 'chest' | 'door' | 'parry' | 'block' | 'bow_draw' | 'bow_shoot' | 'arrow_hit' | 'throw' | 'explosion'
  | 'freeze' | 'turret' | 'trap' | 'slam' | 'telegraph' | 'boss_roar' | 'boss_slam' | 'boss_step' | 'bell'
  | 'ui_tap' | 'ui_open' | 'ui_close' | 'scroll' | 'buy' | 'error' | 'break_wall' | 'flask_empty';

export type MusicTrack = 'title' | 'prison' | 'ramparts' | 'passage' | 'boss' | 'victory' | 'death';

export class Audio {
  muted = false;
  sfxVolume = 0.8;
  musicVolume = 0.5;
  /** Must be called from a user gesture (first tap) to start the AudioContext. */
  unlock(): void {}
  play(_s: Sfx, _o: { vol?: number; pitch?: number } = {}): void {}
  music(_t: MusicTrack | null): void {}
  setMuted(m: boolean): void {
    this.muted = m;
  }
}
