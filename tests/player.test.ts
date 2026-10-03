import { describe, it, expect } from 'vitest';
import { makeTestWorld, steps, flatMap } from './helpers';
import { Player } from '../src/game/player/player';
import { Actor, Entity } from '../src/game/entity';
import type { DamageInfo } from '../src/game/combat';
import { T, TileMap } from '../src/game/tilemap';
import type { Interactable } from '../src/game/world';
import { calcDamage } from '../src/game/player/damage';
import { Arrow } from '../src/game/player/projectiles';

class Dummy extends Actor {
  log: DamageInfo[] = [];
  constructor(x: number, y: number) {
    super(x, y);
    this.w = 16;
    this.h = 40;
    this.hp = this.maxHp = 100000;
    this.physics = false;
    this.knockbackTaken = 0;
  }
  takeDamage(info: DamageInfo) {
    if (info.kind !== 'dot') this.log.push(info);
    return super.takeDamage(info);
  }
  update(dt: number) {
    this.updateStatus(dt);
  }
  draw() {}
}

const FLOOR = 16 * 24;

function setup(map: TileMap = flatMap(), x = 120, y = FLOOR) {
  const t = makeTestWorld(map);
  const p = new Player(x, y);
  t.world.player = p;
  t.world.spawn(p);
  const sounds: string[] = [];
  t.game.audio.play = (s: string) => { sounds.push(s); };
  const events: string[] = [];
  t.world.on((e) => events.push(e.type));
  steps(t.world, 3);
  return { ...t, p, sounds, events };
}

/** run steps and return the minimum y reached (apex) */
function apexOf(world: ReturnType<typeof setup>['world'], p: Player, n: number): number {
  let top = p.y;
  for (let i = 0; i < n; i++) {
    steps(world, 1);
    top = Math.min(top, p.y);
  }
  return top;
}

describe('movement', () => {
  it('runs at 150 px/s almost instantly', () => {
    const { world, input, p } = setup();
    input.setAxis('kb', 1, 0);
    steps(world, 6);
    expect(p.vx).toBe(150);
    expect(p.state).toBe('run');
    input.setAxis('kb', 0, 0);
    steps(world, 10);
    expect(p.vx).toBe(0);
  });

  it('jumps ~80 px when jump is held, less when released early', () => {
    const a = setup();
    a.input.press('jump');
    const top = apexOf(a.world, a.p, 70);
    expect(FLOOR - top).toBeGreaterThan(74);
    expect(FLOOR - top).toBeLessThan(86);

    const b = setup();
    b.input.press('jump');
    steps(b.world, 4);
    b.input.release('jump');
    const top2 = apexOf(b.world, b.p, 70);
    expect(FLOOR - top2).toBeLessThan(55);
    expect(FLOOR - top2).toBeGreaterThan(15);
  });

  it('allows exactly one double jump', () => {
    const { world, input, p, sounds } = setup();
    const press = () => { input.press('jump'); steps(world, 1); input.release('jump'); steps(world, 8); };
    press();
    press();
    press();
    expect(sounds.filter((s) => s === 'jump').length).toBe(1);
    expect(sounds.filter((s) => s === 'double_jump').length).toBe(1);
    expect(p.onGround).toBe(false);
  });

  function ledgeMap(): TileMap {
    const m = flatMap();
    for (let x = 12; x < 59; x++) { m.set(x, 16, T.Empty); m.set(x, 17, T.Empty); }
    return m;
  }

  it('coyote time: a jump just after leaving a ledge is a normal jump and keeps the double jump', () => {
    const { world, input, p, sounds } = setup(ledgeMap(), 11 * 24 + 12);
    input.setAxis('kb', 1, 0);
    for (let i = 0; i < 80 && p.onGround; i++) steps(world, 1);
    expect(p.onGround).toBe(false);
    steps(world, 4); // 0.07 s < 0.1 s coyote
    input.press('jump');
    steps(world, 1);
    input.release('jump');
    expect(sounds.filter((s) => s === 'jump').length).toBe(1);
    steps(world, 8);
    input.press('jump');
    steps(world, 1);
    expect(sounds.filter((s) => s === 'double_jump').length).toBe(1);
  });

  it('after coyote expires the jump is the (only) double jump', () => {
    const { world, input, p, sounds } = setup(ledgeMap(), 11 * 24 + 12);
    input.setAxis('kb', 1, 0);
    for (let i = 0; i < 80 && p.onGround; i++) steps(world, 1);
    steps(world, 9); // 0.15 s
    input.press('jump');
    steps(world, 1);
    expect(sounds).toContain('double_jump');
    expect(sounds).not.toContain('jump');
  });

  it('jump buffer: pressing just before landing jumps on landing', () => {
    const { world, input, p, sounds } = setup();
    input.press('jump');
    steps(world, 1);
    input.release('jump');
    steps(world, 12);
    input.press('jump'); // double jump, uses up the air jump
    steps(world, 1);
    input.release('jump');
    let pressed = false;
    for (let i = 0; i < 120 && !(pressed && p.onGround); i++) {
      if (!pressed && p.vy > 0 && FLOOR - p.y <= p.vy * 0.07) {
        input.press('jump');
        pressed = true;
      }
      steps(world, 1);
      if (pressed) input.release('jump');
    }
    expect(pressed).toBe(true);
    steps(world, 2);
    expect(sounds.filter((s) => s === 'jump').length).toBe(2);
    expect(p.vy).toBeLessThan(0);
  });

  it('roll: i-frames, passes through enemies, ends ~96 px later', () => {
    const { world, input, p } = setup();
    const e = new Dummy(p.x + 50, FLOOR);
    world.spawn(e);
    input.press('roll');
    steps(world, 1);
    input.release('roll');
    expect(p.state).toBe('roll');
    steps(world, 6);
    const hit = p.takeDamage({ amount: 10, dir: -1, kind: 'melee' });
    expect(hit.applied).toBe(false);
    expect(p.hp).toBe(100);
    let n = 0;
    while (p.state === 'roll' && n++ < 40) steps(world, 1);
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(16);
    expect(p.x).toBeGreaterThan(e.x + 20);
    steps(world, 10);
    expect(p.takeDamage({ amount: 10, dir: -1, kind: 'melee' }).applied).toBe(true);
  });

  it('roll cancels attack recovery', () => {
    const { world, input, p } = setup();
    input.tap('attack1');
    steps(world, 14);
    expect(p.state).toBe('attack');
    input.tap('roll');
    steps(world, 1);
    expect(p.state).toBe('roll');
  });

  it('ground slam dives, damages and stuns on landing', () => {
    const { world, input, p } = setup();
    const e = new Dummy(p.x + 30, FLOOR);
    world.spawn(e);
    p.y = 250;
    steps(world, 2);
    input.tap('down');
    steps(world, 1);
    expect(p.state).toBe('slam');
    expect(p.vy).toBe(620);
    let n = 0;
    while (e.log.length === 0 && n++ < 60) steps(world, 1);
    expect(e.log.length).toBe(1);
    expect(e.status.stun).toBeGreaterThan(0.5);
    expect(e.log[0].amount).toBeGreaterThan(20);
    expect(p.state).toBe('slam_land');
  });

  it('drops through one-way platforms with down, jumps up through them', () => {
    const m = flatMap();
    for (let x = 4; x < 12; x++) m.set(x, 13, T.Platform);
    const { world, input, p } = setup(m, 7 * 24 + 12);
    input.press('jump');
    steps(world, 70);
    input.release('jump');
    steps(world, 5);
    expect(p.onPlatform).toBe(true);
    expect(p.y).toBe(13 * 24);
    input.tap('down');
    steps(world, 12);
    expect(p.y).toBeGreaterThan(13 * 24 + 20);
    steps(world, 60);
    expect(p.y).toBe(FLOOR);
  });

  it('grabs a ledge and climbs it automatically', () => {
    const m = flatMap();
    for (let x = 12; x < 16; x++) for (let y = 11; y < 16; y++) m.set(x, y, T.Solid);
    const top = 11 * 24;
    const { world, input, p } = setup(m, 12 * 24 - 8, 200);
    p.y = top + 40 - 6 + 8;
    p.vy = 50;
    input.setAxis('kb', 1, 0);
    steps(world, 2);
    expect(p.state).toBe('ledge');
    steps(world, 30);
    input.setAxis('kb', 0, 0);
    steps(world, 5);
    expect(p.y).toBe(top);
    expect(p.x).toBeGreaterThan(12 * 24);
    expect(p.onGround).toBe(true);
  });

  it('spikes hurt for 12% max HP and bounce', () => {
    const m = flatMap();
    m.set(8, 15, T.Spikes);
    const { world, p } = setup(m, 8 * 24 + 12);
    steps(world, 2);
    expect(p.hp).toBe(88);
    expect(p.vy).toBeLessThan(0);
    expect(p.state).toBe('hurt');
  });
});

describe('melee combos', () => {
  const hitAll = (world: ReturnType<typeof setup>['world'], input: ReturnType<typeof setup>['input'], e: Dummy, count: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      const before = e.log.length;
      input.tap('attack1');
      for (let i = 0; i < 45 && e.log.length === before; i++) steps(world, 1);
      if (e.log.length > before) out.push(e.log[e.log.length - 1].amount);
    }
    return out;
  };

  it('advances 14 / 14 / 22 and wraps', () => {
    const { world, input, p } = setup();
    const e = new Dummy(p.x + 30, FLOOR);
    world.spawn(e);
    const dmg = hitAll(world, input, e, 4);
    expect(dmg).toEqual([14, 14, 22, 14]);
    expect(e.log[0].dir).toBe(1);
    expect(e.log[0].source).toBe(p);
  });

  it('resets the combo after the recover + 0.3 s', () => {
    const { world, input, run, p } = setup();
    run.weapons[0] = { id: 'blood_sword', tier: 1, affix: null };
    const e = new Dummy(p.x + 30, FLOOR);
    world.spawn(e);
    expect(hitAll(world, input, e, 1)).toEqual([18]);
    steps(world, 70);
    expect(hitAll(world, input, e, 1)).toEqual([18]);
    expect(hitAll(world, input, e, 1)).toEqual([28]);
    expect(e.log[0].bleed).toBeGreaterThan(0);
  });

  it('one hit per swing even though the box stays active for several frames', () => {
    const { world, input, p } = setup();
    const e = new Dummy(p.x + 30, FLOOR);
    world.spawn(e);
    input.tap('attack1');
    steps(world, 30);
    expect(e.log.length).toBe(1);
    expect(p.state).not.toBe('attack');
  });

  it('hit-stop and rally on hit', () => {
    const { world, input, p } = setup();
    const e = new Dummy(p.x + 30, FLOOR);
    world.spawn(e);
    p.takeDamage({ amount: 30, dir: -1, kind: 'melee' });
    expect(p.hp).toBe(70);
    expect(p.recoverable).toBeCloseTo(30, 1);
    steps(world, 40);
    const rec = p.recoverable;
    input.tap('attack1');
    for (let i = 0; i < 30 && e.log.length === 0; i++) steps(world, 1);
    expect(world.hitstop).toBeGreaterThan(0);
    expect(p.hp).toBeCloseTo(70 + 0.3 * 14, 1);
    expect(p.recoverable).toBeLessThan(rec);
    steps(world, 400);
    expect(p.recoverable).toBe(0);
  });

  it('twin daggers crit from behind, spear 3rd thrust crits', () => {
    const a = setup();
    a.run.weapons[0] = { id: 'twin_daggers', tier: 1, affix: null };
    const front = new Dummy(a.p.x + 24, FLOOR);
    front.facing = -1; // faces the player
    a.world.spawn(front);
    expect(hitAll(a.world, a.input, front, 1)).toEqual([7]);
    expect(front.log[0].crit).toBeFalsy();
    const back = new Dummy(a.p.x - 24, FLOOR);
    back.facing = -1; // looks away from the player (to the left)
    a.world.spawn(back);
    a.p.facing = -1;
    steps(a.world, 30);
    const before = back.log.length;
    a.input.setAxis('kb', -1, 0);
    a.input.tap('attack1');
    for (let i = 0; i < 30 && back.log.length === before; i++) steps(a.world, 1);
    expect(back.log[back.log.length - 1].crit).toBe(true);
    expect(back.log[back.log.length - 1].amount).toBe(14);

    const b = setup();
    b.run.weapons[0] = { id: 'spear', tier: 1, affix: null };
    const e = new Dummy(b.p.x + 50, FLOOR);
    b.world.spawn(e);
    const dmg = hitAll(b.world, b.input, e, 3);
    expect(dmg).toEqual([13, 13, 30]);
    expect(e.log[2].crit).toBe(true);
  });

  it('air attacks work and do not lunge', () => {
    const { world, input, p } = setup();
    const e = new Dummy(p.x + 30, 330);
    world.spawn(e);
    p.y = 345;
    steps(world, 1);
    const x0 = p.x;
    input.tap('attack1');
    steps(world, 8);
    expect(e.log.length).toBe(1);
    expect(Math.abs(p.x - x0)).toBeLessThan(1);
  });
});

describe('damage scaling', () => {
  it('base x colour mult x tier x affix', () => {
    const { world, run, p } = setup();
    run.stats.brutality = 2;
    const item = { id: 'rusty_sword' as const, tier: 2, affix: 'dmg' as const };
    expect(calcDamage(run, item, 14)).toBeCloseTo(14 * 1.3 * 1.25 * 1.2, 5);
    run.weapons[0] = item;
    steps(world, 2);
    const info = p.damageInfo(item, 14);
    expect(info.amount).toBeCloseTo(27.3, 1);
    expect(info.color).toBe('brutality');
    // tactics item ignores brutality stat
    expect(calcDamage(run, { id: 'twin_daggers', tier: 1, affix: null }, 10)).toBe(10);
    run.stats.tactics = 1;
    expect(calcDamage(run, { id: 'twin_daggers', tier: 1, affix: null }, 10)).toBeCloseTo(11.5, 5);
  });

  it('affixes: burn / bleed on hit, heal on kill', () => {
    const { world, input, run, p } = setup();
    run.weapons[0] = { id: 'rusty_sword', tier: 1, affix: 'burn' };
    const e = new Dummy(p.x + 30, FLOOR);
    world.spawn(e);
    input.tap('attack1');
    for (let i = 0; i < 30 && e.log.length === 0; i++) steps(world, 1);
    expect(e.log[0].burn).toBeGreaterThan(0);
    expect(e.status.burn).toBeGreaterThan(0);

    const info = p.damageInfo({ id: 'rusty_sword', tier: 1, affix: 'bleed' }, 10);
    expect(info.bleed).toBeGreaterThan(0);

    run.weapons[0] = { id: 'rusty_sword', tier: 1, affix: 'heal_on_kill' };
    steps(world, 2);
    p.hp = 50;
    steps(world, 1);
    p.onDealt({ target: e, result: { applied: true, amount: 5, killed: true } }, run.weapons[0], info, { hitstop: 0, shake: 0 });
    expect(p.hp).toBe(55);
  });

  it('speed affix shortens swing phases', () => {
    const a = setup();
    a.input.tap('attack1');
    let na = 0;
    steps(a.world, 1);
    while (a.p.state === 'attack' && na++ < 60) steps(a.world, 1);
    const b = setup();
    b.run.weapons[0] = { id: 'rusty_sword', tier: 1, affix: 'speed' };
    b.input.tap('attack1');
    let nb = 0;
    steps(b.world, 1);
    while (b.p.state === 'attack' && nb++ < 60) steps(b.world, 1);
    expect(nb).toBeLessThan(na);
  });
});

describe('bow', () => {
  it('draws for 0.45 s, shoots a damage-scaled arrow; a tap is weak', () => {
    const a = setup();
    const e = new Dummy(a.p.x + 160, FLOOR);
    a.world.spawn(e);
    a.run.weapons[0] = { id: 'hunter_bow', tier: 1, affix: null };
    a.input.press('attack1');
    steps(a.world, 12);
    expect(a.p.state).toBe('bow');
    expect(a.p.bowCharge).toBeGreaterThan(0.3);
    expect(a.p.bowCharge).toBeLessThan(0.6);
    steps(a.world, 20);
    expect(a.p.bowCharge).toBe(1);
    a.input.release('attack1');
    steps(a.world, 2);
    expect(a.world.entities.some((x) => x instanceof Arrow)).toBe(true);
    steps(a.world, 40);
    expect(e.log.length).toBe(1);
    expect(e.log[0].amount).toBe(30);
    expect(e.log[0].kind).toBe('ranged');

    const b = setup();
    const e2 = new Dummy(b.p.x + 160, FLOOR);
    b.world.spawn(e2);
    b.run.weapons[0] = { id: 'hunter_bow', tier: 1, affix: null };
    b.input.tap('attack1');
    steps(b.world, 50);
    expect(e2.log.length).toBe(1);
    expect(e2.log[0].amount).toBeLessThan(15);
    expect(e2.log[0].amount).toBeGreaterThan(8);
  });

  it('arrows stop on walls', () => {
    const { world, input, run, p } = setup();
    run.weapons[0] = { id: 'hunter_bow', tier: 1, affix: null };
    p.x = 40;
    input.setAxis('kb', 0, 0);
    p.facing = -1;
    input.press('attack1');
    steps(world, 30);
    input.release('attack1');
    steps(world, 40);
    expect(world.entities.some((x) => x instanceof Arrow && !x.dead)).toBe(false);
  });
});

describe('shield', () => {
  const shieldSetup = () => {
    const s = setup();
    s.run.weapons[1] = { id: 'old_shield', tier: 1, affix: null };
    const e = new Dummy(s.p.x + 30, FLOOR);
    e.facing = -1;
    s.world.spawn(e);
    return { ...s, e };
  };

  it('parry in the first 0.2 s: negates, stuns the attacker 1.5 s, flashes text', () => {
    const { world, input, p, e, sounds } = shieldSetup();
    input.press('attack2');
    steps(world, 3);
    expect(p.state).toBe('block');
    const r = p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: e });
    expect(r.parried).toBe(true);
    expect(r.applied).toBe(false);
    expect(p.hp).toBe(100);
    expect(e.status.stun).toBeGreaterThanOrEqual(1.5);
    expect(sounds).toContain('parry');
    expect(world.hitstop).toBeGreaterThanOrEqual(0.1);
  });

  it('later block: -80 % frontal damage, back hits are full', () => {
    const { world, input, p, e, sounds } = shieldSetup();
    input.press('attack2');
    steps(world, 20);
    const r = p.takeDamage({ amount: 20, dir: -1, kind: 'melee', source: e });
    expect(r.blocked).toBe(true);
    expect(r.amount).toBe(4);
    expect(p.hp).toBe(96);
    expect(p.state).toBe('block');
    expect(sounds).toContain('block');
    steps(world, 10);
    const behind = new Dummy(p.x - 40, FLOOR);
    world.spawn(behind);
    p.takeDamage({ amount: 20, dir: 1, kind: 'melee', source: behind });
    expect(p.hp).toBe(76);
    expect(p.state).toBe('hurt');
  });

  it('parry reflects projectiles that expose reflect()', () => {
    const { world, input, p } = shieldSetup();
    let reflected = 0;
    class Bolt extends Entity {
      reflect() { reflected++; }
      update() {}
      draw() {}
    }
    const b = new Bolt(p.x + 20, p.y - 22);
    world.spawn(b);
    input.press('attack2');
    steps(world, 4);
    expect(reflected).toBe(1);
  });
});

describe('health', () => {
  it('flask heals 60 % of max HP over ~0.7 s, then runs out', () => {
    const { world, input, run, p, sounds } = setup();
    run.hp = 40;
    steps(world, 1);
    expect(p.hp).toBe(40);
    input.tap('heal');
    steps(world, 2);
    expect(p.state).toBe('heal');
    steps(world, 20);
    expect(p.hp).toBeGreaterThan(40);
    expect(p.hp).toBeLessThan(100);
    steps(world, 30);
    expect(p.hp).toBe(100);
    expect(run.flasks).toBe(0);
    expect(run.hp).toBe(100);
    p.hp = 50;
    steps(world, 1);
    input.tap('heal');
    steps(world, 3);
    expect(p.hp).toBe(50);
    expect(sounds).toContain('flask_empty');
  });

  it('flask refuses at full HP', () => {
    const { world, input, run, sounds } = setup();
    input.tap('heal');
    steps(world, 3);
    expect(run.flasks).toBe(1);
    expect(sounds).toContain('flask_empty');
  });

  it('hurt: i-frames 0.6 s, knockback, event, shake', () => {
    const { world, p, events } = setup();
    const r = p.takeDamage({ amount: 10, dir: 1, kind: 'melee', knockback: 150 });
    expect(r.applied).toBe(true);
    expect(p.vx).toBe(150);
    expect(p.state).toBe('hurt');
    expect(p.takeDamage({ amount: 10, dir: 1, kind: 'melee' }).applied).toBe(false);
    expect(events).toContain('playerHurt');
    steps(world, 25);
    expect(p.takeDamage({ amount: 10, dir: 1, kind: 'melee' }).applied).toBe(false);
    steps(world, 20);
    expect(p.takeDamage({ amount: 10, dir: 1, kind: 'melee' }).applied).toBe(true);
  });

  it('death emits playerDied exactly once', () => {
    const { world, p, events } = setup();
    p.takeDamage({ amount: 1000, dir: 1, kind: 'melee' });
    steps(world, 5);
    expect(p.state).toBe('dead');
    expect(p.hp).toBe(0);
    p.takeDamage({ amount: 1000, dir: 1, kind: 'melee' });
    steps(world, 30);
    expect(events.filter((e) => e === 'playerDied').length).toBe(1);
    expect(world.run.hp).toBe(0);
  });

  it('syncs HP / max HP with the run state', () => {
    const { world, run, p } = setup();
    run.addStat('survival');
    steps(world, 2);
    expect(p.maxHp).toBe(120);
    expect(p.hp).toBe(120);
    p.takeDamage({ amount: 30, dir: 1, kind: 'melee' });
    steps(world, 1);
    expect(run.hp).toBe(90);
    run.hp = 120; // e.g. a fountain
    steps(world, 8);
    expect(p.hp).toBe(120);
  });
});

describe('interaction & skills', () => {
  it('interact triggers the nearest interactable', () => {
    const { world, input, p } = setup();
    let n = 0;
    class Thing extends Entity implements Interactable {
      readonly interactable = true as const;
      physics = false;
      promptText() { return 'x'; }
      canInteract() { return true; }
      interact() { n++; }
      draw() {}
    }
    world.spawn(new Thing(p.x + 10, FLOOR));
    steps(world, 2);
    expect(p.nearInteract).not.toBeNull();
    input.tap('interact');
    steps(world, 2);
    expect(n).toBe(1);
  });

  it('fire grenade: cooldown, explosion, burn', () => {
    const { world, input, run, p } = setup();
    run.skills[0] = { id: 'fire_grenade', tier: 1, affix: null };
    const e = new Dummy(p.x + 100, FLOOR);
    world.spawn(e);
    steps(world, 1);
    expect(p.skillCooldownMax[0]).toBe(10);
    input.tap('skill1');
    steps(world, 2);
    expect(p.state).toBe('cast');
    expect(p.skillCooldown[0]).toBeGreaterThan(9.5);
    steps(world, 100);
    const boom = e.log.find((i) => i.kind === 'explosion');
    expect(boom).toBeTruthy();
    expect(boom!.amount).toBe(30);
    expect(e.status.burn).toBeGreaterThan(2);
    // still cooling down: second press does nothing
    input.tap('skill1');
    steps(world, 5);
    expect(p.state).not.toBe('cast');
  });

  it('ice grenade freezes everything in radius 60', () => {
    const { world, input, run, p } = setup();
    run.skills[1] = { id: 'ice_grenade', tier: 1, affix: null };
    const a = new Dummy(p.x + 100, FLOOR);
    const b = new Dummy(p.x + 150, FLOOR);
    const far = new Dummy(p.x + 400, FLOOR);
    world.spawn(a);
    world.spawn(b);
    world.spawn(far);
    steps(world, 1);
    input.tap('skill2');
    steps(world, 100);
    expect(a.status.freeze).toBeGreaterThan(1.5);
    expect(far.log.length).toBe(0);
  });

  it('turret shoots the nearest enemy within 220 px for 10 s', () => {
    const { world, input, run, p } = setup();
    run.skills[0] = { id: 'turret', tier: 1, affix: null };
    const e = new Dummy(p.x + 140, FLOOR);
    world.spawn(e);
    steps(world, 1);
    input.tap('skill1');
    steps(world, 150);
    const shots = e.log.filter((i) => i.kind === 'ranged').length;
    expect(shots).toBeGreaterThanOrEqual(2);
    steps(world, 600);
    expect(world.entities.some((x) => x.constructor.name === 'Turret')).toBe(false);
  });

  it('wolf trap roots the first enemy for 3 s and hurts for 20', () => {
    const { world, input, run, p } = setup();
    run.skills[0] = { id: 'wolf_trap', tier: 1, affix: null };
    const e = new Dummy(p.x + 20, FLOOR);
    world.spawn(e);
    steps(world, 1);
    input.tap('skill1');
    steps(world, 60);
    expect(e.log.length).toBe(1);
    expect(e.log[0].kind).toBe('trap');
    expect(e.log[0].amount).toBe(20);
    expect(e.status.stun).toBeGreaterThan(2);
  });
});
