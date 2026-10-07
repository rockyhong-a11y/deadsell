import { Actor, type Entity } from '../entity';
import { hitArea, isBehind, type DamageInfo, type DamageResult, type HitReport } from '../combat';
import type { Interactable } from '../world';
import { GRAVITY, MAX_FALL, TILE, DEBUG } from '../../engine/config';
import { approach, clamp, lerp, overlaps, sign, type AABB } from '../../engine/math';
import type { Btn } from '../../engine/input';
import { moveBody } from '../physics';
import { T } from '../tilemap';
import { ITEMS } from '../items/items';
import type { ItemInstance } from '../items/types';
import { weaponDef, type BowWeapon, type DashSpec, type MeleeHit, type MeleeWeapon, type ShieldWeapon, type StaffWeapon, type Volley, type WandWeapon } from './weapons';
import { CHAIN_HOOK, REQUIEM, SKILLS, type SkillDef } from './skills';
import { Arrow, dragToward, explode, flameBurst, type Feel } from './projectiles';
import { Glaive, Quake, Wisp, chainLightning } from './uniques';
import { calcDamage } from './damage';
import { dropLoot } from '../items/pickups';
import { circleHitsBox, isReflectable } from '../enemies/projectiles';
import { AFFIX, CRIT_MULT, FLASK, SPRINT } from '../rules';

/**
 * The heroine (Cinder). OWNER: player agent.
 *
 * Public for the HUD: hp, maxHp, recoverable, nearInteract, skillCooldown,
 * skillCooldownMax, bowCharge (0..1), state, useFlask().
 * Public for other systems: damageInfo(), onDealt(), refreshStats().
 */
export type PlayerState =
  | 'idle' | 'run' | 'jump' | 'fall' | 'roll' | 'attack' | 'slam' | 'slam_land'
  | 'ledge' | 'hurt' | 'heal' | 'bow' | 'charge' | 'dash' | 'staff' | 'block' | 'cast' | 'dead';

type Mode = 'free' | 'roll' | 'attack' | 'slam' | 'slam_land' | 'ledge' | 'hurt' | 'heal' | 'bow' | 'charge' | 'dash' | 'staff' | 'block' | 'cast' | 'dead';

// ---- tuning (docs/DESIGN.md §5) -------------------------------------------
export const RUN_SPEED = 150;
export const JUMP_V = 466; // discrete integration at 60 Hz peaks at ~80 px
export const DOUBLE_JUMP_V = 440;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
const JUMP_CUT = 0.4;
const MIN_JUMP_TIME = 0.05;
const ROLL_DUR = 0.32;
const ROLL_SPEED = 300;
const ROLL_I0 = 0.04;
const ROLL_I1 = 0.3;
const SLAM_SPEED = 620;
const SLAM_BASE_DAMAGE = 26;
const DROP_TIME = 0.25;
const HURT_INVULN = 0.6;
const HEAL_TIME = FLASK.healTime;
const HEAL_PCT = FLASK.healPct;
const LEDGE_TIME = 0.38;
const RALLY_TIME = 3;
const RALLY_RESTORE = 0.3;
const ACTION_BUFFER = 0.15;
const SPIKE_PCT = 0.12;

interface Swing {
  slot: number;
  item: ItemInstance;
  def: MeleeWeapon;
  idx: number;
  hit: MeleeHit;
  t: number;
  dur: [number, number, number];
  fired: boolean;
  set: Set<number>;
  /** a lash that lands several times (`hit.multi`): one once-per-target set for each of them */
  sets: Set<number>[];
  /** enemies a toll ring of this swing has already hurt (장례 종) */
  tolled: Set<number>;
  /** something was hit (applied) in this swing already (쌍월 칼날 counts the swings that connect) */
  landed: boolean;
  queued: boolean;
  btn: Btn;
}

interface BowState { slot: number; item: ItemInstance; def: BowWeapon; btn: Btn; t: number; phase: 'draw' | 'shoot'; full: boolean; drawTime: number }
/** 철 도: the attack held down, charging toward `dash.charge` s */
interface ChargeState { slot: number; item: ItemInstance; def: MeleeWeapon; dash: DashSpec; btn: Btn; t: number; full: boolean }
/** 철 도: the dash (`go`: invulnerable, slashing everything on its way) and the follow-through (`end`) */
interface DashState { item: ItemInstance; dash: DashSpec; dir: 1 | -1; x0: number; t: number; phase: 'go' | 'end'; hit: Set<number> }
/** 화염 지팡이 / 폭풍 지팡이: the attack held down, `tick` s to the next flame tick / lightning */
interface StaffState { slot: number; item: ItemInstance; def: StaffWeapon | WandWeapon; btn: Btn; t: number; tick: number; n: number }
/** `rewarded`: this block's parry has paid its reward already (shockwave, heal, bell: once per block) */
interface BlockState { slot: number; item: ItemInstance; def: ShieldWeapon; btn: Btn; t: number; reflected: WeakSet<object>; rewarded: boolean }
interface CastState { slot: number; item: ItemInstance; def: SkillDef; t: number; fired: boolean }
interface LedgeState { t: number; x0: number; y0: number; x1: number; y1: number; dir: 1 | -1 }

/** how the wisps of the soul fire bow and the embers of the ember blade look */
const WISP_LOOK = { color: '#4fe3ff', core: '#e8fbff' };
const EMBER_LOOK = { color: '#ffb347', core: '#fff3a0' };

function godMode(): boolean {
  return DEBUG.god || !!(globalThis as { __ds?: { _god?: boolean } }).__ds?._god;
}

export class Player extends Actor {
  team = 'player' as const;
  /** "rally" segment of HP that can be won back by attacking */
  recoverable = 0;
  nearInteract: (Interactable & Entity) | null = null;
  skillCooldown: [number, number] = [0, 0];
  skillCooldownMax: [number, number] = [1, 1];
  /** bow draw 0..1 (HUD) */
  bowCharge = 0;
  /** combo index the NEXT swing of each weapon slot will use */
  combo: [number, number] = [0, 0];
  /** 질주: running at `RUN_SPEED x SPRINT.mult` (docs/CONTENT4.md §1) */
  sprinting = false;
  /** 광란 질주: seconds of the kill-streak frenzy left (every movement is a sprint at once) */
  frenzyT = 0;
  /** 진혼곡: seconds of the song left (kills refund the other skill's cooldown and keep the frenzy up, hits heal) */
  requiemT = 0;

  private mode: Mode = 'free';
  private coyote = 0;
  private airJumps = 1;
  private jumpAge = 0;
  private jumpCut = false;
  private landT = 0;
  private djT = 0;
  private dropT = 0;
  private ledgeCd = 0;
  /** seconds since the last roll ended / since the last hit taken (unique weapons: crit windows); huge = never */
  private sinceRoll = Infinity;
  private sinceHurt = Infinity;
  /** the first-hit crit after this roll was used up (레이피어) */
  private rollCritSpent = false;
  /** seconds her next weapon hit stays a crit (위상 전이) */
  private nextCritT = 0;
  /** the skill slot the song was sung from (the other one gets the refunds) and seconds until the next hit may heal */
  private requiemSlot = -1;
  private requiemHealT = 0;
  /** 쌍월 칼날: swings that connected with each weapon slot since its last glaive */
  private glaiveN: [number, number] = [0, 0];
  private rollT = 0;
  private rollDir: 1 | -1 = 1;
  private rollCd = 0;
  private hurtT = 0;
  private healT = 0;
  private healTotal = 0;
  private healGiven = 0;
  private slamT = 0;
  private parryAnimT = 0;
  private stepT = 0;
  private dustT = 0;
  private comboTimer: [number, number] = [0, 0];
  private recoverPeak = 0;
  private lastRunHp = -1;
  private seenW: (ItemInstance | null)[] = [null, null];
  private seenS: (ItemInstance | null)[] = [null, null];
  private diedEmitted = false;
  private atk: Swing | null = null;
  private bow: BowState | null = null;
  private blk: BlockState | null = null;
  private chg: ChargeState | null = null;
  private dashS: DashState | null = null;
  private stf: StaffState | null = null;
  private cast: CastState | null = null;
  private ledge: LedgeState | null = null;
  // ---- sprint
  /** seconds a direction has been held on the ground without a break (the run-up), and which direction */
  private runT = 0;
  private runDir = 0;
  /** seconds without a direction (the end grace) */
  private idleT = 0;
  /** kills in a row (each within `SPRINT.streakWindow` s of the one before) and the world time of the last one */
  private streak = 0;
  private lastKillT = -Infinity;
  /** the stored frames drawn behind a sprinting heroine (newest first) and the time until the next one is stored */
  private afterImgs: { anim: string; frame: number; x: number; y: number; flip: boolean }[] = [];
  private afterT = 0;
  private footFrame = -1;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 14;
    this.h = 40;
    this.z = 20;
    this.alwaysActive = true;
    this.bloodColor = '#c8324a';
  }

  // ---------------------------------------------------------------- public
  /** What the HUD / tests see: locomotion while free, else the action in progress. */
  get state(): PlayerState {
    if (this.mode !== 'free') return this.mode;
    if (!this.onGround) return this.vy < 0 ? 'jump' : 'fall';
    return Math.abs(this.vx) > 12 ? 'run' : 'idle';
  }

  /** Index of the swing in progress, or -1. */
  get swingIndex(): number {
    return this.atk ? this.atk.idx : -1;
  }

  /** Is the heroine in a state where her i-frames (roll window) protect her? */
  get rollInvulnerable(): boolean {
    return this.mode === 'roll' && this.rollT >= ROLL_I0 && this.rollT <= ROLL_I1;
  }

  /** Re-read max HP / HP from the run (after a scroll or an Alchemist upgrade). */
  refreshStats(): void {
    const run = this.world.run;
    this.maxHp = run.maxHp;
    this.hp = clamp(run.hp, 0, this.maxHp);
    this.lastRunHp = run.hp;
  }

  /** External changes (scrolls, fountain, alchemist) flow in through RunState. */
  private pullRun(): void {
    const run = this.world.run;
    if (this.maxHp !== run.maxHp) this.maxHp = run.maxHp;
    if (run.hp !== this.lastRunHp) this.hp = clamp(run.hp, 0, this.maxHp);
  }

  private pushRun(): void {
    this.world.run.hp = this.hp;
    this.lastRunHp = this.hp;
  }

  takeDamage(info: DamageInfo): DamageResult {
    this.pullRun();
    const r = super.takeDamage(info);
    this.pushRun();
    return r;
  }

  heal(n: number): void {
    this.pullRun();
    super.heal(n);
    this.pushRun();
  }

  /** Drink a flask (HUD button / 'heal'). Returns true if the drink started. */
  useFlask(): boolean {
    const run = this.world.run;
    if (this.mode === 'dead' || this.mode === 'heal' || this.mode === 'roll' || this.mode === 'slam' || this.mode === 'ledge' || this.mode === 'hurt') return false;
    if (run.flasks <= 0 || this.hp >= this.maxHp) {
      this.world.audio.play('flask_empty');
      return false;
    }
    run.flasks--;
    this.cancelActions();
    this.mode = 'heal';
    this.healT = 0;
    this.healGiven = 0;
    this.healTotal = Math.round(this.maxHp * HEAL_PCT);
    this.anim?.playFor('heal', HEAL_TIME);
    this.world.audio.play('heal');
    return true;
  }

  /** 위상 전이: her next weapon hit within `secs` s is a crit. */
  armCrit(secs: number): void {
    this.nextCritT = Math.max(this.nextCritT, secs);
  }

  /** Build a DamageInfo for one of the heroine's items (base x colour x tier x affix). */
  damageInfo(item: ItemInstance, base: number, extra: Partial<DamageInfo> = {}): DamageInfo {
    const info: DamageInfo = {
      amount: calcDamage(this.world.run, item, base),
      dir: this.facing,
      kind: 'melee',
      source: this,
      color: ITEMS[item.id].color,
    };
    if (item.affix === 'burn') { info.burn = AFFIX.burnSecs; info.burnDps = AFFIX.burnDps; }
    else if (item.affix === 'bleed') info.bleed = AFFIX.bleedSecs;
    for (const k of Object.keys(extra) as (keyof DamageInfo)[]) {
      if (extra[k] !== undefined) (info as unknown as Record<string, unknown>)[k] = extra[k];
    }
    return info;
  }

  /** Feedback + rally + on-kill affixes for a hit the heroine (or her turret) landed. */
  onDealt(r: HitReport, item: ItemInstance | null, info: DamageInfo, feel: Feel): void {
    const res = r.result;
    if (!res.applied) return;
    const w = this.world;
    this.rally(res.amount);
    const crit = !!info.crit;
    w.addHitstop(feel.hitstop + (crit ? 0.03 : 0));
    w.shake(feel.shake + (crit ? 1 : 0), 0.12);
    w.audio.play(crit ? 'crit' : feel.sfx ?? 'hit', feel.vol !== undefined ? { vol: feel.vol } : undefined);
    const wd = item ? weaponDef(item.id) : null;
    const melee = wd?.kind === 'melee' ? wd : null;
    if (melee?.leech && !this.dying) this.heal(res.amount * melee.leech); // (거머리 채찍: a share of the damage comes back)
    // 진혼곡: every hit heals a little (not more often than `healCd`, so a flame that ticks ten times a second does not heal ten times)
    if (this.requiemT > 0 && this.requiemHealT <= 0 && !this.dying) {
      this.requiemHealT = REQUIEM.healCd;
      this.heal(this.maxHp * REQUIEM.heal);
    }
    if (res.killed && !this.dying) {
      const pct = (item?.affix === 'heal_on_kill' ? AFFIX.healPct : 0) + (melee?.healOnKill ?? 0);
      if (pct > 0) {
        this.heal(Math.max(1, Math.round(this.maxHp * pct)));
        w.particles.emit('heal', this.x, this.y - 24, { count: 6 });
      }
      if (melee?.killPieces) dropLoot(w, r.target.x, r.target.y, { pieces: melee.killPieces }); // (셀마의 대가위)
    }
  }

  // ---------------------------------------------------------------- lifecycle
  init(): void {
    this.setSheet(this.world.assets.sheet('heroine'));
    const run = this.world.run;
    this.maxHp = run.maxHp;
    this.hp = Math.min(run.hp, this.maxHp);
    this.lastRunHp = run.hp;
    this.anim!.play('idle');
    // kills in quick succession start the frenzy
    this.world.on((e) => {
      if (e.type === 'enemyKilled') this.onKillStreak();
    });
  }

  update(dt: number): void {
    const w = this.world;
    this.pullRun();
    this.updateStatus(dt);
    this.tickTimers(dt);
    this.gravityScale = 1;
    if (this.anim) this.anim.speed = 1;
    const wasGround = this.onGround;
    const preVy = this.vy;

    if (this.mode === 'dead') {
      this.vx = approach(this.vx, 0, 600 * dt);
    } else {
      this.watchEquipment();
      if (this.onGround) {
        this.coyote = COYOTE;
        this.airJumps = 1;
      } else this.coyote -= dt;
      this.hazards();
      this.nearInteract = w.nearestInteractable(this.x, this.y - 20);
      if (!this.tryRoll()) this.tickMode(dt);
    }
    // any attack, skill, roll, slam, ledge grab or hit (and death) ends the sprint and restarts the run-up
    if (this.mode !== 'free') this.breakSprint();
    this.tickSprintFx(dt);

    this.physics = this.mode !== 'ledge';
    super.update(dt);
    if (!wasGround && this.onGround && this.mode !== 'dead') this.onLanded(Math.max(preVy, this.vy));

    this.nearInteract = this.mode === 'dead' ? null : w.nearestInteractable(this.x, this.y - 20);
    this.pushRun();
  }

  stepPhysics(dt: number): void {
    const maxFall = this.mode === 'slam' ? SLAM_SPEED : MAX_FALL;
    this.vy = Math.min(maxFall, this.vy + GRAVITY * this.gravityScale * dt);
    moveBody(this, this.world.map, dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const blink = this.invuln > 0 && this.mode !== 'roll' && this.mode !== 'dead' && Math.floor(this.world.time * 20) % 2 === 0;
    this.drawSprintBehind(ctx);
    this.drawSprite(ctx, { alpha: blink ? 0.5 : 1 });
    if (this.mode !== 'dead') {
      this.world.lights.add(this.x, this.y - 24, 70, '#9fe8ff', 0.3);
      if (this.frenzyT > 0) this.world.lights.add(this.x, this.y - 24, 96, SPRINT.after.frenzyColor, 0.55);
      if (this.nextCritT > 0) this.world.lights.add(this.x, this.y - 24, 60, '#c690ff', 0.5);
      if (this.requiemT > 0) this.world.lights.add(this.x, this.y - 24, 84, '#ff4a58', 0.5 + 0.2 * Math.sin(this.world.time * 8));
      if (this.stf) this.world.lights.add(this.x + this.facing * 36, this.y - 30, 80, '#ff8a3c', 0.6);
    }
  }

  /**
   * What a sprint draws behind the heroine (docs/CONTENT4.md §1): the stored frames as tinted after-images (cyan, red in the frenzy;
   * the newest is the most visible), a few short speed lines against the direction of travel and, in the frenzy, an ember glow.
   */
  private drawSprintBehind(ctx: CanvasRenderingContext2D): void {
    const sheet = this.anim?.sheet;
    if (!sheet || this.mode === 'dead') return;
    const A = SPRINT.after;
    const frenzy = this.frenzyT > 0;
    if (frenzy) {
      const gx = Math.round(this.x), gy = Math.round(this.y - 22);
      const g = ctx.createRadialGradient(gx, gy, 2, gx, gy, 36);
      g.addColorStop(0, 'rgba(255,74,106,0.5)');
      g.addColorStop(1, 'rgba(255,74,106,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(gx - 36, gy - 36, 72, 72);
      ctx.restore();
    }
    const tint = frenzy ? A.frenzyColor : A.color;
    for (let i = this.afterImgs.length - 1; i >= 0; i--) {
      const im = this.afterImgs[i];
      const k = A.count > 1 ? i / (A.count - 1) : 0;
      sheet.draw(ctx, im.anim, im.frame, im.x, im.y, im.flip, { tint, alpha: A.alpha[0] + (A.alpha[1] - A.alpha[0]) * k });
    }
    if (!this.sprinting) return;
    // speed lines: short, horizontal, trailing off behind her
    const t = this.world.time;
    const dir = this.facing;
    ctx.save();
    ctx.fillStyle = frenzy ? '#ffc0c8' : '#d8f6ff';
    for (let k = 0; k < 4; k++) {
      const phase = (t * 6 + k * 0.37) % 1;
      const len = 10 + ((k * 7) % 12);
      const lx = this.x - dir * (12 + phase * 26);
      ctx.globalAlpha = (1 - phase) * 0.5;
      ctx.fillRect(Math.round(dir > 0 ? lx - len : lx), Math.round(this.y - 8 - k * 9 - ((k * 5) % 4)), len, 1);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- timers
  private tickTimers(dt: number): void {
    this.rollCd -= dt;
    this.ledgeCd -= dt;
    this.sinceRoll += dt;
    this.sinceHurt += dt;
    if (this.nextCritT > 0) this.nextCritT -= dt;
    this.requiemHealT -= dt;
    if (this.requiemT > 0) {
      this.requiemT = Math.max(0, this.requiemT - dt);
      if (Math.random() < dt * 9) this.world.particles.emit('magic', this.x, this.y - 28, { count: 1, color: '#ffd0d8', w: 36, h: 44 });
    }
    this.landT -= dt;
    this.djT -= dt;
    this.parryAnimT -= dt;
    if (this.dropT > 0) {
      this.dropT -= dt;
      if (this.dropT <= 0) this.dropThrough = false;
    }
    for (let i = 0; i < 2; i++) {
      if (this.skillCooldown[i] > 0) this.skillCooldown[i] = Math.max(0, this.skillCooldown[i] - dt);
      if (this.mode !== 'attack' && this.comboTimer[i] > 0) {
        this.comboTimer[i] -= dt;
        if (this.comboTimer[i] <= 0) this.combo[i] = 0;
      }
    }
    if (this.recoverable > 0) {
      this.recoverable -= (this.recoverPeak / RALLY_TIME) * dt;
      if (this.recoverable < 0.01) this.recoverable = 0;
      this.recoverable = Math.min(this.recoverable, this.maxHp - this.hp);
    }
  }

  private watchEquipment(): void {
    const run = this.world.run;
    for (let i = 0; i < 2; i++) {
      if (run.weapons[i] !== this.seenW[i]) {
        this.seenW[i] = run.weapons[i];
        this.combo[i] = 0;
        this.comboTimer[i] = 0;
        this.glaiveN[i] = 0;
        const cur = this.atk?.slot === i || this.bow?.slot === i || this.blk?.slot === i || this.chg?.slot === i || this.stf?.slot === i;
        if (cur) this.cancelActions();
      }
      if (run.skills[i] !== this.seenS[i]) {
        this.seenS[i] = run.skills[i];
        this.skillCooldown[i] = 0;
      }
      const s = run.skills[i];
      this.skillCooldownMax[i] = s ? ITEMS[s.id].cooldown ?? 1 : 1;
    }
  }

  // ---------------------------------------------------------------- mode dispatch
  private tickMode(dt: number): void {
    switch (this.mode) {
      case 'free': this.tickFree(dt); break;
      case 'roll': this.tickRoll(dt); break;
      case 'attack': this.tickAttack(dt); break;
      case 'slam': this.tickSlam(dt); break;
      case 'slam_land': this.tickSlamLand(dt); break;
      case 'ledge': this.tickLedge(dt); break;
      case 'hurt': this.tickHurt(dt); break;
      case 'heal': this.tickHeal(dt); break;
      case 'bow': this.tickBow(dt); break;
      case 'charge': this.tickCharge(dt); break;
      case 'dash': this.tickDash(dt); break;
      case 'staff': this.tickStaff(dt); break;
      case 'block': this.tickBlock(dt); break;
      case 'cast': this.tickCast(dt); break;
      default: break;
    }
  }

  private get locked(): boolean {
    return this.status.freeze > 0 || this.status.stun > 0;
  }

  private moveDir(): number {
    const mx = this.world.input.moveX;
    return mx > 0.25 ? 1 : mx < -0.25 ? -1 : 0;
  }

  /** Horizontal control: near-instant run acceleration; `scale` slows (draw, block, heal...). */
  private steer(dt: number, scale: number, canTurn = true): number {
    const mx = this.locked ? 0 : this.moveDir();
    const target = mx * RUN_SPEED * scale;
    const acc = this.onGround ? (mx ? 1900 : 2800) : mx ? 1500 : 500;
    this.vx = approach(this.vx, target, acc * dt);
    if (mx && canTurn) this.facing = mx > 0 ? 1 : -1;
    return mx;
  }

  // ---------------------------------------------------------------- free (run / jump / fall)
  private tickFree(dt: number): void {
    const w = this.world;
    const inp = w.input;
    if (this.locked) {
      this.breakSprint();
      this.steer(dt, 0);
      this.anim?.play(this.onGround ? 'idle' : 'fall');
      return;
    }
    if (inp.pressedWithin('interact', ACTION_BUFFER)) {
      const n = this.nearInteract;
      if (n && n.canInteract()) {
        inp.consume('interact');
        n.interact();
      }
    }
    if (inp.pressedWithin('heal', ACTION_BUFFER)) {
      inp.consume('heal');
      if (this.useFlask()) return;
    }
    if (this.trySkill()) return;
    if (this.tryDrop()) return;
    if (this.trySlam()) return;
    this.tryJump();
    if (this.tryLedge()) return;
    if (this.tryWeapons()) return;
    const mx = this.moveDir();
    const mult = this.sprintStep(dt, mx);
    // jumping out of a sprint keeps the horizontal speed until landing (or turning), even with the direction released
    if (!(!this.onGround && this.sprinting && SPRINT.airKeep && mx === 0)) this.steer(dt, mult);
    this.variableJump(dt);
    this.locomotion(dt, mx);
  }

  private locomotion(dt: number, mx: number): void {
    const a = this.anim!;
    const w = this.world;
    if (this.landT > 0 && this.onGround) a.play('land');
    else if (!this.onGround) a.play(this.djT > 0 ? 'double_jump' : this.vy < 0 ? 'jump' : 'fall');
    else if (mx && Math.abs(this.vx) > 20) {
      const sprint = this.sprinting;
      a.play(sprint ? 'sprint' : 'run');
      a.speed = sprint ? clamp(Math.abs(this.vx) / (RUN_SPEED * SPRINT.mult), 0.6, 1.2) : clamp(Math.abs(this.vx) / RUN_SPEED, 0.6, 1.3);
      this.stepT += dt;
      this.dustT += dt;
      if (this.stepT >= (sprint ? 0.16 : 0.26)) {
        this.stepT = 0;
        w.audio.play('step', { vol: 0.35, pitch: (sprint ? 1.1 : 0.95) + Math.random() * 0.1 });
      }
      if (sprint) {
        // a dust puff at every footfall frame of the stride
        const f = a.frame;
        if (f !== this.footFrame && (SPRINT.footFrames as readonly number[]).includes(f)) {
          w.particles.emit('dust', this.x - this.facing * 4, this.y - 1, { dir: -this.facing, count: 3 });
        }
        this.footFrame = f;
      } else if (this.dustT >= 0.16) {
        this.dustT = 0;
        w.particles.emit('dust', this.x - this.facing * 4, this.y - 1, { dir: -this.facing, count: 1 });
      }
    } else {
      a.play('idle');
      this.stepT = 0.18;
    }
  }

  private tryJump(): boolean {
    const inp = this.world.input;
    if (!inp.pressedWithin('jump', JUMP_BUFFER)) return false;
    if (this.onGround || this.coyote > 0) {
      inp.consume('jump');
      this.vy = -JUMP_V;
      this.coyote = 0;
      this.onGround = false;
      this.jumpAge = 0;
      this.jumpCut = true;
      this.world.particles.emit('jump', this.x, this.y, { count: 5 });
      this.world.audio.play('jump');
      return true;
    }
    if (this.airJumps > 0) {
      inp.consume('jump');
      this.airJumps--;
      this.vy = -DOUBLE_JUMP_V;
      this.jumpAge = 0;
      this.jumpCut = true;
      this.djT = 0.3;
      this.world.particles.emit('jump', this.x, this.y - 4, { count: 6, power: 1.2 });
      this.world.audio.play('double_jump');
      return true;
    }
    return false;
  }

  /** Releasing jump while rising shortens the jump (vy x 0.4). */
  private variableJump(dt: number): void {
    if (!this.jumpCut) return;
    if (this.vy >= 0) {
      this.jumpCut = false;
      return;
    }
    this.jumpAge += dt;
    if (!this.world.input.isDown('jump') && this.jumpAge >= MIN_JUMP_TIME) {
      this.vy *= JUMP_CUT;
      this.jumpCut = false;
    }
  }

  private tryDrop(): boolean {
    if (!this.onPlatform) return false;
    const inp = this.world.input;
    const byDown = inp.pressedWithin('down', JUMP_BUFFER);
    const byJump = inp.moveY > 0.5 && inp.pressedWithin('jump', JUMP_BUFFER);
    if (!byDown && !byJump) return false;
    inp.consume('down');
    inp.consume('jump');
    this.dropThrough = true;
    this.dropT = DROP_TIME;
    this.onGround = false;
    this.onPlatform = false;
    this.coyote = 0;
    this.y += 1;
    this.vy = Math.max(this.vy, 80);
    this.world.particles.emit('dust', this.x, this.y, { count: 2 });
    return true;
  }

  // ---------------------------------------------------------------- sprint (docs/CONTENT4.md §1)
  /**
   * Run-up and end conditions for this step; returns the speed multiplier of the horizontal control. The run-up counts the seconds a
   * direction is held on the ground: stopping (past the end grace), turning or a wall in front restarts it, and `SPRINT.runUp`
   * seconds start the sprint. In the frenzy every movement is a sprint at once.
   */
  private sprintStep(dt: number, mx: number): number {
    const airKept = !this.onGround && this.sprinting && SPRINT.airKeep;
    if (mx === 0) {
      // (released in the air: the sprint carries on until landing)
      if (!airKept && (this.idleT += dt) > SPRINT.endGrace) this.breakSprint();
    } else {
      this.idleT = 0;
      if ((this.runDir !== 0 && mx !== this.runDir) || this.hitWallX === mx) this.breakSprint();
      this.runDir = mx;
      if (this.onGround && this.hitWallX !== mx) this.runT += dt;
    }
    // (a wall in front ends it even in the frenzy: the frenzy itself stays, the sprint comes back the moment she turns away)
    this.sprinting = this.runDir !== 0 && (mx === 0 || this.hitWallX !== mx) && (this.frenzyT > 0 || this.runT >= SPRINT.runUp);
    return this.sprinting ? SPRINT.mult : 1;
  }

  /** The sprint ends and the run-up starts over. */
  private breakSprint(): void {
    this.sprinting = false;
    this.runT = 0;
    this.runDir = 0;
    this.idleT = 0;
  }

  /** A kill: `SPRINT.streakKills` of them, each within `SPRINT.streakWindow` s of the last, start the frenzy; every further kill refreshes it. */
  private onKillStreak(): void {
    const w = this.world;
    if (this.requiemT > 0 && !this.dying) this.requiemKill();
    this.streak = w.time - this.lastKillT <= SPRINT.streakWindow ? this.streak + 1 : 1;
    this.lastKillT = w.time;
    // (once it runs, every kill refreshes it, however long since the last one)
    if ((this.frenzyT > 0 || this.streak >= SPRINT.streakKills) && !this.dying) this.startFrenzy();
  }

  /** 광란 질주: every movement is a sprint for `SPRINT.frenzyTime` s (a running one makes it full again). Also the debug hook. */
  startFrenzy(): void {
    const fresh = this.frenzyT <= 0;
    this.frenzyT = SPRINT.frenzyTime;
    if (!fresh) return;
    const w = this.world;
    w.fx.text(this.x, this.y - this.h - 14, '광란 질주!', SPRINT.after.frenzyColor);
    w.shake(1, 0.15);
    w.audio.play('crit', { pitch: 1.3 });
  }

  /** 진혼곡: she sings for `REQUIEM.life` s; `item` is the skill she sang it from (its slot is the one that gets no refunds). */
  startRequiem(item: ItemInstance): void {
    const w = this.world;
    this.requiemT = REQUIEM.life;
    this.requiemSlot = w.run.skills.indexOf(item);
    w.fx.text(this.x, this.y - this.h - 14, '진혼곡', '#ff4a58');
    w.fx.ring(this.x, this.y - 22, { radius: 52, color: '#ff4a58', life: 0.5 });
    w.particles.emit('magic', this.x, this.y - 24, { count: 12, color: '#ffd0d8', w: 30, h: 40 });
    w.audio.play('bell', { vol: 0.7, pitch: 1.4 });
  }

  /** A kill during the song: the other skill gets `REQUIEM.refund` of its cooldown back and the frenzy sprint starts (or is topped up). */
  private requiemKill(): void {
    const other = this.requiemSlot === 0 ? 1 : this.requiemSlot === 1 ? 0 : null;
    if (other !== null && this.skillCooldown[other] > 0) {
      this.skillCooldown[other] = Math.max(0, this.skillCooldown[other] - this.skillCooldownMax[other] * REQUIEM.refund);
      this.world.fx.ring(this.x, this.y - 22, { radius: 30, color: '#ffd0d8', life: 0.25 });
    }
    this.startFrenzy();
  }

  /** The frenzy timer and the after-image buffer (every `SPRINT.after.interval` s while sprinting; the buffer drains when it ends). */
  private tickSprintFx(dt: number): void {
    if (this.frenzyT > 0 && (this.frenzyT -= dt) <= 0) {
      // the frenzy ran out: a sprint it carried falls back to a normal run and the run-up starts over
      this.frenzyT = 0;
      this.runT = 0;
    }
    if (this.frenzyT > 0 && this.mode !== 'dead' && Math.random() < dt * 12) this.world.particles.emit('embers', this.x, this.y - 20, { count: 1, w: 14, h: 36 });
    const A = SPRINT.after;
    this.afterT += dt;
    if (this.afterT < A.interval) return;
    this.afterT -= A.interval;
    if ((this.sprinting || this.mode === 'dash') && this.anim) {
      this.afterImgs.unshift({ anim: this.anim.name, frame: this.anim.frame, x: this.x, y: this.y, flip: this.facing < 0 });
      if (this.afterImgs.length > A.count) this.afterImgs.length = A.count;
    } else if (this.afterImgs.length) this.afterImgs.pop();
  }

  // ---------------------------------------------------------------- roll
  private canRollFrom(): boolean {
    switch (this.mode) {
      case 'free': case 'attack': case 'bow': case 'charge': case 'staff': case 'block': case 'slam_land': return true;
      case 'dash': return this.dashS?.phase === 'end';
      case 'hurt': return this.hurtT < 0.14;
      case 'cast': return !!this.cast?.fired;
      default: return false;
    }
  }

  private tryRoll(): boolean {
    const inp = this.world.input;
    if (!inp.pressedWithin('roll', ACTION_BUFFER)) return false;
    if (!this.canRollFrom() || this.rollCd > 0 || this.locked) return false;
    if (!this.onGround && this.coyote <= 0) return false; // buffered: rolls on landing
    const dir = (inp.rollDir || this.moveDir() || this.facing) > 0 ? 1 : -1;
    inp.consume('roll');
    inp.rollDir = 0;
    this.cancelActions();
    this.mode = 'roll';
    this.rollT = 0;
    this.rollDir = dir;
    this.facing = dir;
    this.vx = dir * ROLL_SPEED;
    this.dustT = 0;
    this.anim?.playFor('roll', ROLL_DUR);
    this.world.particles.emit('roll', this.x, this.y, { dir: -dir, count: 6 });
    this.world.audio.play('roll');
    return true;
  }

  private tickRoll(dt: number): void {
    this.rollT += dt;
    this.vx = this.rollDir * ROLL_SPEED;
    this.facing = this.rollDir;
    this.dustT += dt;
    if (this.onGround && this.dustT >= 0.07) {
      this.dustT = 0;
      this.world.particles.emit('dust', this.x - this.rollDir * 6, this.y - 1, { dir: -this.rollDir, count: 1 });
    }
    if (this.rollT >= ROLL_DUR) {
      this.mode = 'free';
      this.rollCd = 0.1;
      this.sinceRoll = 0;
      this.rollCritSpent = false;
      const mx = this.moveDir();
      this.vx = mx ? mx * RUN_SPEED : this.rollDir * RUN_SPEED * 0.4;
    }
  }

  // ---------------------------------------------------------------- slam
  private trySlam(): boolean {
    if (this.onGround) return false;
    const inp = this.world.input;
    if (!inp.pressedWithin('down', JUMP_BUFFER)) return false;
    inp.consume('down');
    this.cancelActions();
    this.mode = 'slam';
    this.vx = 0;
    this.vy = SLAM_SPEED;
    this.jumpCut = false;
    this.anim?.play('slam_dive');
    this.world.audio.play('swing_heavy', { vol: 0.5, pitch: 0.8 });
    return true;
  }

  private tickSlam(dt: number): void {
    this.vy = SLAM_SPEED;
    this.vx = approach(this.vx, 0, 3000 * dt);
    this.anim?.play('slam_dive');
    if (Math.random() < dt * 40) this.world.particles.emit('dust', this.x, this.y - 20, { count: 1, vy: -60 });
  }

  private slamImpact(): void {
    const w = this.world;
    const run = w.run;
    const item = run.weapons[0] ?? { id: 'rusty_sword' as const, tier: run.tier, affix: null };
    const infos = new Map<Actor, DamageInfo>();
    const box = { x: this.x - 56, y: this.y - 34, w: 112, h: 36 };
    const reports = hitArea(w, box, 'player', (t) => {
      const info = this.damageInfo(item, SLAM_BASE_DAMAGE, { dir: sign(t.x - this.x) || this.facing, knockback: 200, knockup: 180, stun: 1.2, kind: 'melee', unblockable: true });
      infos.set(t, info);
      return info;
    });
    for (const r of reports) this.onDealt(r, item, infos.get(r.target)!, { hitstop: 0.08, shake: 3, sfx: 'hit_heavy' });
    w.particles.emit('slam', this.x, this.y, { count: 14 });
    w.fx.ring(this.x, this.y - 4, { radius: 56, color: '#ffe9a8', life: 0.3 });
    w.shake(6, 0.28);
    w.addHitstop(reports.length ? 0.08 : 0.04);
    w.audio.play('slam');
    this.mode = 'slam_land';
    this.slamT = 0;
    this.vx = 0;
    this.anim?.playFor('slam_land', 0.3);
  }

  private tickSlamLand(dt: number): void {
    this.slamT += dt;
    this.steer(dt, 0, false);
    if (this.slamT >= 0.14) {
      // buffered actions break the landing recovery early
      const inp = this.world.input;
      if (inp.pressedWithin('jump', JUMP_BUFFER) || inp.isDown('attack1') || inp.pressedWithin('attack1', ACTION_BUFFER) || inp.pressedWithin('attack2', ACTION_BUFFER) || inp.pressedWithin('skill1', ACTION_BUFFER) || inp.pressedWithin('skill2', ACTION_BUFFER)) {
        this.mode = 'free';
        this.tickFree(dt);
        return;
      }
    }
    if (this.slamT >= 0.3) this.mode = 'free';
  }

  private onLanded(vy: number): void {
    const w = this.world;
    this.jumpCut = false;
    if (this.mode === 'slam') {
      this.slamImpact();
      return;
    }
    if (vy > 200) {
      w.particles.emit('land', this.x, this.y, { count: Math.min(8, 3 + Math.floor(vy / 150)) });
      w.audio.play('land', { vol: clamp(vy / 540, 0.3, 0.9) });
    }
    if (vy > 330 && this.mode === 'free') this.landT = 0.1;
  }

  // ---------------------------------------------------------------- ledge
  private tryLedge(): boolean {
    if (this.onGround || this.ledgeCd > 0 || this.vy < -120 || this.dropT > 0) return false;
    const dir = this.moveDir();
    if (!dir) return false;
    const map = this.world.map;
    const wtx = Math.floor((this.x + dir * (this.w / 2 + 2)) / TILE);
    const hands = this.y - this.h + 6;
    const hy = Math.floor(hands / TILE);
    if (!map.isSolid(wtx, hy) || map.isSolid(wtx, hy - 1) || map.isSolid(wtx, hy - 2)) return false;
    const top = hy * TILE;
    if (hands - top > 18) return false;
    const edge = dir > 0 ? wtx * TILE : (wtx + 1) * TILE;
    this.ledge = { t: 0, x0: edge - dir * (this.w / 2), y0: top + 2 + this.h, x1: edge + dir * (this.w / 2 + 2), y1: top, dir: dir as 1 | -1 };
    this.mode = 'ledge';
    this.x = this.ledge.x0;
    this.y = this.ledge.y0;
    this.vx = this.vy = 0;
    this.facing = dir as 1 | -1;
    this.airJumps = 1;
    this.jumpCut = false;
    this.anim?.playFor('ledge_climb', LEDGE_TIME);
    this.world.audio.play('land', { vol: 0.3 });
    this.world.particles.emit('dust', this.x + dir * 6, this.y - this.h, { count: 3 });
    return true;
  }

  private tickLedge(dt: number): void {
    const l = this.ledge!;
    l.t += dt;
    const p = clamp(l.t / LEDGE_TIME, 0, 1);
    const up = 1 - Math.pow(1 - clamp(p / 0.65, 0, 1), 2);
    const side = clamp((p - 0.5) / 0.5, 0, 1);
    this.x = lerp(l.x0, l.x1, side);
    this.y = lerp(l.y0, l.y1, up);
    this.vx = this.vy = 0;
    if (p >= 1) {
      this.mode = 'free';
      this.ledge = null;
      this.ledgeCd = 0.25;
      this.vy = 0;
    }
  }

  // ---------------------------------------------------------------- hazards
  private hazards(): void {
    if (this.invuln > 0 || this.dying) return;
    const feet = { x: this.x - this.w / 2 + 2, y: this.y - 6, w: this.w - 4, h: 6 };
    if (!this.world.map.boxHas(feet, T.Spikes)) return;
    this.takeDamage({
      amount: Math.max(1, Math.round(this.maxHp * SPIKE_PCT)),
      dir: -this.facing,
      kind: 'hazard',
      unblockable: true,
      knockup: 340,
      knockback: 110,
      hitstun: 0.2,
    });
  }

  // ---------------------------------------------------------------- melee
  private tryWeapons(): boolean {
    const inp = this.world.input;
    const run = this.world.run;
    for (let slot = 0; slot < 2; slot++) {
      const btn: Btn = slot === 0 ? 'attack1' : 'attack2';
      const item = run.weapons[slot];
      if (!item) continue;
      if (!(inp.pressedWithin(btn, ACTION_BUFFER) || inp.isDown(btn))) continue;
      const def = weaponDef(item.id);
      if (!def) continue;
      inp.consume(btn);
      const mx = this.moveDir();
      if (mx) this.facing = mx > 0 ? 1 : -1;
      if (def.kind === 'melee' && def.dash) this.startCharge(slot, item, def, btn);
      else if (def.kind === 'melee') this.startSwing(slot, item, def, this.combo[slot] % def.hits.length, btn);
      else if (def.kind === 'bow') this.startBow(slot, item, def, btn);
      else if (def.kind === 'staff' || def.kind === 'wand') this.startStaff(slot, item, def, btn);
      else this.startBlock(slot, item, def, btn);
      return true;
    }
    return false;
  }

  private startSwing(slot: number, item: ItemInstance, def: MeleeWeapon, idx: number, btn: Btn): void {
    const hit = def.hits[idx];
    const k = item.affix === 'speed' ? AFFIX.speedMul : 1;
    this.mode = 'attack';
    this.combo[slot] = idx;
    this.atk = {
      slot, item, def, idx, hit, t: 0, dur: [hit.windup * k, hit.active * k, hit.recover * k], fired: false, set: new Set(),
      sets: hit.multi ? Array.from({ length: hit.multi.n }, () => new Set<number>()) : [], tolled: new Set(), landed: false, queued: false, btn,
    };
    this.anim?.playPhased(hit.anim, ...this.atk.dur);
    this.jumpCut = false;
  }

  private tickAttack(dt: number): void {
    const a = this.atk!;
    const inp = this.world.input;
    const w = this.world;
    a.t += dt;
    const [W, A, R] = a.dur;
    const act = a.t < W + A;
    if (this.onGround) {
      if (act && !this.targetInReach(a.hit)) this.vx = this.facing * a.hit.lunge;
      else if (act) this.vx = approach(this.vx, 0, 2600 * dt);
      else this.steer(dt, 0.3, false);
    } else {
      this.steer(dt, 0.7, false);
      this.gravityScale = 0.55;
    }
    if (a.t >= W && !a.fired) {
      a.fired = true;
      const h = a.hit;
      w.audio.play(h.swing);
      if (h.shoot) this.throwVolley(a, h.shoot);
      else w.fx.slash(this.x + this.facing * 4, this.y - 24, { dir: this.facing, radius: h.slash.radius, from: h.slash.from, to: h.slash.to, color: h.slash.color, width: h.slash.width, life: h.slash.life });
      if (a.def.quake && this.onGround) this.releaseQuake(a);
    }
    if (a.fired && act && !a.hit.shoot) this.swingHit(a);
    // (a charging weapon is not chained by holding the button: holding charges it)
    if (inp.pressedWithin(a.btn, ACTION_BUFFER) || (!a.def.dash && inp.isDown(a.btn) && a.t >= W + A)) {
      a.queued = true;
      inp.consume(a.btn);
    }
    const recovering = a.t >= W + A;
    if (recovering && inp.pressedWithin('down', JUMP_BUFFER) && !this.onGround) {
      this.endAttack(a);
      this.trySlam();
      return;
    }
    if (recovering && this.tryJump()) {
      this.endAttack(a);
      return;
    }
    const last = a.idx === a.def.hits.length - 1;
    if (a.queued && a.t >= W + A + R * (last ? 1 : 0.45)) {
      const mx = this.moveDir();
      if (mx) this.facing = mx > 0 ? 1 : -1;
      this.startSwing(a.slot, a.item, a.def, (a.idx + 1) % a.def.hits.length, a.btn);
      return;
    }
    if (a.t >= W + A + R) this.endAttack(a);
  }

  private endAttack(a: Swing): void {
    this.combo[a.slot] = (a.idx + 1) % a.def.hits.length;
    this.comboTimer[a.slot] = a.def.resetDelay;
    this.atk = null;
    this.mode = 'free';
    this.gravityScale = 1;
  }

  /** the box of a hit in front of her; `dy` moves it up (negative) or down */
  private hitBox(h: MeleeHit, dy = 0): AABB {
    const b = h.box;
    return { x: this.facing > 0 ? this.x + b.x : this.x - b.x - b.w, y: this.y + b.y + dy, w: b.w, h: b.h };
  }

  /** Lunge magnetism: stop sliding once an enemy is already inside the swing (no overshooting through targets). */
  private targetInReach(h: MeleeHit): boolean {
    const box = this.hitBox(h);
    for (const t of this.world.actors) if (t.team === 'enemy' && t.targetable && overlaps(box, t.hurtbox())) return true;
    return false;
  }

  /** Weapons with a crit condition: against a bleeding / burning / frozen / stunned target, for a while after a roll or a hit taken, below some HP. */
  private signatureCrit(def: MeleeWeapon, target: Actor): boolean {
    if (def.critBleeding && target.status.bleed > 0) return true;
    if (def.critAfterRoll !== undefined && this.sinceRoll <= def.critAfterRoll) return true;
    if (def.critAfterHurt !== undefined && this.sinceHurt <= def.critAfterHurt) return true;
    if (def.critBelowHp !== undefined && this.hp < this.maxHp * def.critBelowHp) return true;
    return !!def.critVs?.some((k) => target.status[k] > 0);
  }

  private swingHit(a: Swing): void {
    const m = a.hit.multi;
    if (!m) {
      this.strike(a, this.hitBox(a.hit), a.set);
      return;
    }
    // a lash that lands `n` times: the box of lash i opens `gap` s after the one before (fanned `spread` px up and down) and hurts each enemy once
    const upto = Math.min(m.n - 1, Math.floor((a.t - a.dur[0]) / m.gap));
    for (let i = 0; i <= upto; i++) this.strike(a, this.hitBox(a.hit, (i - (m.n - 1) / 2) * m.spread), a.sets[i]);
  }

  /** One test of a swing's box (the single one, or one lash of several): whom it hits, how hard, and what the weapon's signature adds to each hit. */
  private strike(a: Swing, box: AABB, set: Set<number>): void {
    const h = a.hit;
    const def = a.def;
    // the whip's tip: the outer `tip` px of the box
    const tip = h.tip ? { x: this.facing > 0 ? box.x + box.w - h.tip : box.x, y: box.y, w: h.tip, h: box.h } : null;
    const first = def.critFirstAfterRoll !== undefined && !this.rollCritSpent && this.sinceRoll <= def.critFirstAfterRoll;
    const marked = this.nextCritT > 0;
    const infos = new Map<Actor, DamageInfo>();
    const executed = new Set<Actor>();
    const reports = hitArea(this.world, box, 'player', (t) => {
      const crit = h.crit === 'always' || (h.crit === 'behind' && isBehind(this, t)) || this.signatureCrit(def, t) || first || marked || (!!tip && overlaps(tip, t.hurtbox()));
      const info = this.damageInfo(a.item, h.damage, { dir: this.facing, knockback: h.knockback, knockup: h.knockup, stun: h.stun, crit, kind: 'melee' });
      if (crit) info.amount *= CRIT_MULT;
      if (def.fullHpMul && this.hp >= this.maxHp - 0.01) info.amount *= def.fullHpMul;
      if (h.execute) {
        // 집행자의 대검: a boss takes a multiple; anything else below the line is finished off
        if (t.isBoss) info.amount *= h.execute.boss;
        else if (t.hp < t.maxHp * h.execute.below) {
          info.amount = Math.max(info.amount, t.hp);
          info.crit = true;
          executed.add(t);
        }
      }
      if (def.bleed) info.bleed = Math.max(info.bleed ?? 0, def.bleed);
      if (def.burn) {
        info.burn = Math.max(info.burn ?? 0, def.burn);
        info.burnDps = Math.max(info.burnDps ?? 0, AFFIX.burnDps);
      }
      infos.set(t, info);
      return info;
    }, set);
    const applied = reports.filter((r) => r.result.applied);
    if (applied.length) {
      if (first) this.rollCritSpent = true;
      if (marked) this.nextCritT = 0;
    }
    for (const r of reports) {
      this.onDealt(r, a.item, infos.get(r.target)!, { hitstop: h.hitstop, shake: h.shake, sfx: h.hit });
      if (r.result.applied) this.world.particles.emit('spark', r.target.x, r.target.cy, { dir: this.facing, count: 3, color: h.slash.color });
    }
    for (const r of applied) this.signatureHit(a, r, !!tip && overlaps(tip, r.target.hurtbox()), executed.has(r.target));
    if (applied.length && !a.landed) {
      a.landed = true;
      if (def.glaive && ++this.glaiveN[a.slot] >= def.glaive.every) {
        this.glaiveN[a.slot] = 0;
        this.throwGlaive(a, def.glaive);
      }
    }
  }

  /**
   * What a hit that landed adds for the unique weapons of docs/CONTENT4.md §5.3: the executioner's mark, further bleed stacks (셀마의 대가위), the
   * toll ring (장례 종), the seeking ember (신더의 불씨검) and the pull of a whip's tip (거머리 채찍, 아홉 꼬리 채찍; heavy enemies stay where they are).
   */
  private signatureHit(a: Swing, r: HitReport, tipHit: boolean, executed: boolean): void {
    const def = a.def;
    const t = r.target;
    const w = this.world;
    if (executed && r.result.killed) w.fx.text(t.x, t.y - t.h - 8, '처형!', '#ff4a58');
    // (the hit itself added one stack)
    if (def.bleedStacks && !r.result.killed) t.status.bleedStacks = Math.min(AFFIX.bleedStacks, t.status.bleedStacks + def.bleedStacks - 1);
    if (def.toll) explode(this, a.item, t.cx, t.cy, { radius: def.toll.radius, base: def.toll.damage, kind: 'toll', extra: { stun: def.toll.stun }, already: a.tolled });
    if (def.ember && w.rng.chance(def.ember.chance)) {
      const e = def.ember;
      w.spawn(new Wisp(t.cx, t.cy - 4, -Math.PI / 2 + w.rng.range(-0.6, 0.6), this, a.item, e.damage, e, EMBER_LOOK, { hitstop: 0.02, shake: 0.5, sfx: 'hit' }, t));
    }
    if (tipHit && def.tipPull && !r.result.killed && t.knockbackTaken >= CHAIN_HOOK.pullMinKnockback) {
      dragToward(t, this.x + this.facing * (this.w / 2 + t.w / 2 + 4), null, def.tipPull);
    }
  }

  /** 쌍월 칼날: the glaive leaves her hand, flying the way she faces. */
  private throwGlaive(a: Swing, g: NonNullable<MeleeWeapon['glaive']>): void {
    const w = this.world;
    w.spawn(new Glaive(this.x + this.facing * 14, this.y - 26, this, a.item, g.damage, this.facing, g));
    w.audio.play('swing', { pitch: 1.5 });
  }

  /** 여교도관의 종철퇴: a slam on the ground sends a shockwave along the floor both ways (one set: an enemy is hurt by the pair of them once). */
  private releaseQuake(a: Swing): void {
    const w = this.world;
    const x = this.x + this.facing * 40;
    const seen = new Set<number>();
    for (const dir of [1, -1] as const) w.spawn(new Quake(x, this.y, dir, this, a.item, a.def.quake!, seen));
    w.shake(4, 0.2);
    w.particles.emit('slam', x, this.y, { count: 10 });
    w.audio.play('slam', { vol: 0.8 });
  }

  /** 투척 단검: the volley leaves her hand when the windup ends, the knives one above the other, each bleeding its target. */
  private throwVolley(a: Swing, v: Volley): void {
    const w = this.world;
    const marked = this.nextCritT > 0;
    for (let i = 0; i < v.count; i++) {
      const dy = (i - (v.count - 1) / 2) * v.gap;
      const info = this.damageInfo(a.item, a.hit.damage, { kind: 'ranged', dir: this.facing, knockback: a.hit.knockback });
      info.bleed = Math.max(info.bleed ?? 0, v.bleed); // (a bleed affix can make it longer, never shorter)
      if (marked) {
        info.crit = true;
        info.amount *= CRIT_MULT;
      }
      w.spawn(new Arrow(this.x + this.facing * 14, this.y - 28 + dy, this.facing * v.speed, 0, this, a.item, info, { hitstop: a.hit.hitstop, shake: a.hit.shake, sfx: a.hit.hit }, { range: v.range, knife: true }));
    }
    if (marked) this.nextCritT = 0;
    w.particles.emit('spark', this.x + this.facing * 16, this.y - 28, { dir: this.facing, count: 2 });
  }

  // ---------------------------------------------------------------- bow
  private startBow(slot: number, item: ItemInstance, def: BowWeapon, btn: Btn): void {
    const drawTime = def.drawTime * (item.affix === 'speed' ? AFFIX.speedMul : 1);
    this.mode = 'bow';
    this.bow = { slot, item, def, btn, t: 0, phase: 'draw', full: false, drawTime };
    this.bowCharge = 0;
    this.anim?.playFor('bow_draw', drawTime);
    this.world.audio.play('bow_draw');
  }

  private tickBow(dt: number): void {
    const b = this.bow!;
    const inp = this.world.input;
    b.t += dt;
    if (b.phase === 'shoot') {
      this.steer(dt, 0.7, false);
      this.tryJump();
      this.variableJump(dt);
      if (b.t >= 0.2) this.endBow();
      return;
    }
    this.bowCharge = clamp(b.t / b.drawTime, 0, 1);
    if (this.bowCharge >= 1 && !b.full) {
      b.full = true;
      this.world.particles.emit('spark', this.x + this.facing * 10, this.y - 26, { count: 4, color: '#ffe9a8' });
    }
    this.steer(dt, b.def.moveScale, false);
    this.tryJump();
    this.variableJump(dt);
    if (inp.pressedWithin('down', JUMP_BUFFER) && !this.onGround && this.trySlam()) return;
    if (!inp.isDown(b.btn) && b.t >= 0.04) this.fireArrow(b);
  }

  private fireArrow(b: BowState): void {
    const w = this.world;
    const c = this.bowCharge;
    const d = b.def;
    const sf = d.soulfire;
    if (sf && c < 1) this.fireWisps(b, sf);
    else {
      const frac = d.minFrac + (1 - d.minFrac) * c;
      const speed = lerp(d.minSpeed, d.maxSpeed, c);
      // a fully drawn volley bow fans out several arrows, each a share of the damage; every other shot is one arrow
      const fan = d.volley && c >= 1 ? d.volley : null;
      const n = fan ? fan.n : 1;
      const marked = this.nextCritT > 0;
      for (let i = 0; i < n; i++) {
        const ang = fan && n > 1 ? ((i / (n - 1)) * 2 - 1) * fan.spread * (Math.PI / 180) : 0;
        const info = this.damageInfo(b.item, d.damage * (fan ? fan.frac : frac), { kind: 'ranged', dir: this.facing, knockback: 50 + 150 * c, knockup: c >= 1 ? 60 : undefined, freeze: d.freeze });
        if (marked) {
          info.crit = true;
          info.amount *= CRIT_MULT;
        }
        const arrow = new Arrow(
          this.x + this.facing * 14, this.y - 26, this.facing * Math.cos(ang) * speed, Math.sin(ang) * speed, this, b.item, info,
          { hitstop: 0.04 + 0.04 * c, shake: 1 + c, sfx: 'arrow_hit' },
          { pierce: !!d.pierce && c >= 1, range: d.range, ...d.look, burst: sf ? { radius: sf.radius, base: sf.damage, burn: sf.burn } : undefined },
        );
        w.spawn(arrow);
      }
      if (marked) this.nextCritT = 0;
    }
    w.audio.play('bow_shoot', { pitch: 0.9 + 0.2 * c });
    w.particles.emit('spark', this.x + this.facing * 16, this.y - 26, { dir: this.facing, count: 2 });
    this.vx -= this.facing * 40 * c;
    this.bowCharge = 0;
    b.phase = 'shoot';
    b.t = 0;
    this.anim?.playFor('bow_shoot', 0.2);
  }

  /** 혼불 활: a shot let go before the draw is full sends `wisps` homing wisps, fanned a little apart, instead of an arrow. */
  private fireWisps(b: BowState, sf: NonNullable<BowWeapon['soulfire']>): void {
    const base = this.facing > 0 ? 0 : Math.PI;
    for (let i = 0; i < sf.wisps; i++) {
      const spread = sf.wisps > 1 ? ((i / (sf.wisps - 1)) * 2 - 1) * 0.35 : 0;
      this.world.spawn(new Wisp(this.x + this.facing * 14, this.y - 26, base + spread, this, b.item, sf.wisp.damage, sf.wisp, WISP_LOOK, { hitstop: 0.03, shake: 0.5, sfx: 'hit' }));
    }
  }

  private endBow(): void {
    this.bow = null;
    this.bowCharge = 0;
    this.mode = 'free';
  }

  // ---------------------------------------------------------------- katana (hold to charge, let go to dash)
  private startCharge(slot: number, item: ItemInstance, def: MeleeWeapon, btn: Btn): void {
    // (the speed affix shortens the charge like it shortens a swing)
    const dash = { ...def.dash!, charge: def.dash!.charge * (item.affix === 'speed' ? AFFIX.speedMul : 1) };
    this.mode = 'charge';
    this.chg = { slot, item, def, dash, btn, t: 0, full: false };
    this.bowCharge = 0;
    this.jumpCut = false;
    // the coiled pose of the swing's windup, stretched over the charge and held there
    this.anim?.playPhased(def.hits[0].anim, dash.charge * 1.5, 1, 1);
    this.world.audio.play('bow_draw', { pitch: 0.7 });
  }

  private tickCharge(dt: number): void {
    const c = this.chg!;
    const inp = this.world.input;
    c.t += dt;
    this.bowCharge = clamp(c.t / c.dash.charge, 0, 1);
    if (this.anim) this.anim.t = Math.min(this.anim.t, c.dash.charge * 1.4);
    if (this.bowCharge >= 1 && !c.full) {
      c.full = true;
      this.world.particles.emit('spark', this.x + this.facing * 10, this.y - 26, { count: 6, color: '#ffe9a8' });
      this.world.fx.ring(this.x, this.y - 24, { radius: 26, color: '#ffe9a8', life: 0.25 });
      this.world.audio.play('parry', { vol: 0.35, pitch: 1.4 });
    }
    this.steer(dt, 0.4, false);
    this.tryJump();
    this.variableJump(dt);
    if (inp.pressedWithin('down', JUMP_BUFFER) && !this.onGround && this.trySlam()) return;
    if (inp.isDown(c.btn) || c.t < 0.04) return;
    // let go: a full charge dashes, anything less is the tap slash
    this.chg = null;
    this.bowCharge = 0;
    if (c.full) this.startDash(c);
    else this.startSwing(c.slot, c.item, c.def, 0, c.btn);
  }

  private startDash(c: ChargeState): void {
    const w = this.world;
    this.mode = 'dash';
    this.dashS = { item: c.item, dash: c.dash, dir: this.facing, x0: this.x, t: 0, phase: 'go', hit: new Set() };
    this.jumpCut = false;
    this.anim?.play('sprint', true);
    w.audio.play('swing_heavy', { pitch: 1.3 });
    w.particles.emit('dust', this.x, this.y - 1, { dir: -this.facing, count: 5 });
    w.shake(2, 0.12);
  }

  private tickDash(dt: number): void {
    const d = this.dashS!;
    const w = this.world;
    d.t += dt;
    if (d.phase === 'end') {
      this.vx = approach(this.vx, 0, 2600 * dt);
      if (d.t >= d.dash.recover) {
        this.dashS = null;
        this.mode = 'free';
      }
      return;
    }
    // the dash: horizontal, exactly `distance` px unless a wall is in the way; it slashes everything it passes (each once)
    const left = d.dash.distance - Math.abs(this.x - d.x0);
    this.facing = d.dir;
    this.vx = d.dir * Math.min(d.dash.speed, Math.max(0, left) / dt);
    this.vy = 0;
    this.gravityScale = 0;
    const box = { x: this.x + d.dir * 12 - 20, y: this.y - 50, w: 40, h: 52 };
    const infos = new Map<Actor, DamageInfo>();
    const reports = hitArea(w, box, 'player', (t) => {
      const info = this.damageInfo(d.item, d.dash.damage, { dir: d.dir, knockback: d.dash.knockback, kind: 'melee' });
      infos.set(t, info);
      return info;
    }, d.hit);
    for (const r of reports) {
      this.onDealt(r, d.item, infos.get(r.target)!, { hitstop: 0.06, shake: 2.5, sfx: 'hit_heavy' });
      if (r.result.applied) w.particles.emit('spark', r.target.x, r.target.cy, { dir: d.dir, count: 5, color: '#e8f4ff' });
    }
    if (left <= 0.5 || this.hitWallX === d.dir || d.t > 0.6) {
      // the finishing slash and the follow-through
      d.phase = 'end';
      d.t = 0;
      this.gravityScale = 1;
      w.fx.slash(this.x, this.y - 24, { dir: d.dir, radius: 64, from: -0.6, to: 0.6, color: '#e8f4ff', width: 11, life: 0.2 });
      w.audio.play('swing_heavy');
      w.shake(3, 0.15);
      this.anim?.playPhased('heavy_3', 0.02, 0.06, Math.max(0.05, d.dash.recover - 0.08));
    }
  }

  // ---------------------------------------------------------------- staff (hold to breathe a flame cone)
  private startStaff(slot: number, item: ItemInstance, def: StaffWeapon | WandWeapon, btn: Btn): void {
    this.mode = 'staff';
    this.stf = { slot, item, def, btn, t: 0, tick: 0.1, n: 0 };
    this.jumpCut = false;
    this.anim?.playFor('cast', 0.3);
    this.world.audio.play('throw');
  }

  private tickStaff(dt: number): void {
    const s = this.stf!;
    const inp = this.world.input;
    s.t += dt;
    this.steer(dt, s.def.moveScale, false);
    this.tryJump();
    this.variableJump(dt);
    if (inp.pressedWithin('down', JUMP_BUFFER) && !this.onGround && this.trySlam()) return;
    const speed = s.item.affix === 'speed' ? AFFIX.speedMul : 1;
    s.tick -= dt;
    while (s.tick <= 0) {
      const tipX = this.x + this.facing * 16;
      const tipY = this.y - 30;
      if (s.def.kind === 'staff') {
        const f = s.def.flame;
        s.tick += f.interval * speed;
        flameBurst(this, s.item, tipX, tipY, this.facing, { range: f.range, spread: f.spread, base: f.damage, burn: f.burn, interval: f.interval * speed });
        if (s.n++ % 2 === 0) this.world.audio.play('swing', { vol: 0.15, pitch: 0.6 });
      } else {
        // 폭풍 지팡이: a chain lightning at the nearest enemy ahead (nothing in reach: only a crackle at the tip)
        const f = s.def.bolt;
        s.tick += f.interval * speed;
        if (!chainLightning(this, s.item, tipX, tipY, this.facing, f).length) this.world.particles.emit('spark', tipX, tipY, { count: 1, color: '#9fe8ff' });
      }
    }
    if (!inp.isDown(s.btn) && s.t >= 0.12) {
      this.stf = null;
      this.mode = 'free';
    }
  }

  // ---------------------------------------------------------------- shield
  private startBlock(slot: number, item: ItemInstance, def: ShieldWeapon, btn: Btn): void {
    this.mode = 'block';
    this.blk = { slot, item, def, btn, t: 0, reflected: new WeakSet(), rewarded: false };
    this.parryAnimT = 0;
    this.anim?.play('shield_block', true);
  }

  private tickBlock(dt: number): void {
    const b = this.blk!;
    const inp = this.world.input;
    b.t += dt;
    if (this.parryAnimT <= 0) this.anim?.play('shield_block');
    if (b.t < b.def.parryWindow) this.reflectProjectiles(b);
    this.steer(dt, b.def.moveScale, false);
    this.tryJump();
    this.variableJump(dt);
    if (inp.pressedWithin('down', JUMP_BUFFER) && !this.onGround && this.trySlam()) return;
    if (!inp.isDown(b.btn) && b.t >= 0.25) {
      this.blk = null;
      this.mode = 'free';
    }
  }

  /** Parry window: enemy projectiles that expose reflect() are sent back. */
  private reflectProjectiles(b: BlockState): void {
    for (const e of this.world.entities) {
      const fn = (e as unknown as { reflect?: (by: Actor) => void }).reflect;
      if (typeof fn !== 'function' || e.dead || b.reflected.has(e)) continue;
      const dx = (e.x - this.x) * this.facing;
      if (dx < -6 || dx > 48 || Math.abs(e.y - (this.y - 22)) > 34) continue;
      this.reflectShot(e, b);
      this.parryFeedback(null);
    }
  }

  /** Send a shot back (once per block); a shield with a `bell` hits harder with it: `reflectMul` times the damage it had. */
  private reflectShot(e: Entity, b: BlockState): void {
    b.reflected.add(e);
    const shot = e as unknown as { damage?: number; reflect: (by: Actor) => void };
    const dmg = shot.damage;
    shot.reflect(this);
    if (b.def.bell && typeof dmg === 'number') shot.damage = Math.round(dmg * b.def.bell.reflectMul);
  }

  private parryFeedback(attacker: Actor | null): void {
    const w = this.world;
    const b = this.blk;
    if (attacker) attacker.status.stun = Math.max(attacker.status.stun, b?.def.parryStun ?? 1.5);
    this.invuln = Math.max(this.invuln, 0.25);
    this.parryAnimT = 0.25;
    this.anim?.playFor('shield_parry', 0.25);
    const fx = this.x + this.facing * 16;
    w.audio.play('parry');
    w.particles.emit('parry', fx, this.y - 24, { dir: this.facing, count: 10 });
    w.fx.text(this.x, this.y - this.h - 14, '패링!', '#ffd23f');
    w.fx.ring(fx, this.y - 24, { radius: 30, color: '#ffffff', life: 0.25 });
    w.fx.screenFlash('#ffffff', 0.12, 0.3);
    w.addHitstop(0.12);
    w.shake(3, 0.15);
    if (b && !b.rewarded) {
      // what a parry pays, once per block: the shockwave, the healing, the bell
      b.rewarded = true;
      if (b.def.shockwave) this.parryShockwave(b.item, b.def.shockwave);
      if (b.def.parryHeal) {
        this.heal(Math.max(1, Math.round(this.maxHp * b.def.parryHeal)));
        w.particles.emit('heal', this.x, this.y - 24, { count: 8 });
      }
      if (b.def.bell) this.parryBell(b, b.def.bell);
    }
    if (attacker && b?.def.counter) this.parryCounter(attacker, b.item, b.def.counter);
  }

  /** 종의 방패: a parry tolls: every enemy within `radius` px is stunned and every enemy shot in reach is sent back at `reflectMul` times the damage. */
  private parryBell(b: BlockState, bell: { radius: number; stun: number }): void {
    const w = this.world;
    const cx = this.x;
    const cy = this.y - 20;
    for (const a of w.actors) {
      if (a.team !== 'enemy' || !a.targetable || !circleHitsBox(cx, cy, bell.radius, a.hurtbox())) continue;
      a.status.stun = Math.max(a.status.stun, bell.stun);
      w.particles.emit('spark', a.cx, a.cy, { count: 4, color: '#ffd9a0' });
    }
    for (const e of w.entities) {
      if (e.dead || !isReflectable(e) || e.team !== 'enemy' || b.reflected.has(e) || Math.hypot(e.x - cx, e.y - cy) > bell.radius) continue;
      this.reflectShot(e, b);
    }
    w.fx.ring(cx, this.y - 4, { radius: bell.radius, color: '#ffd9a0', life: 0.45, flat: 0.5 });
    w.audio.play('bell', { vol: 0.9 });
  }

  /** 가시 방패: a parry strikes the attacker back (unblockable) and makes it bleed. */
  private parryCounter(target: Actor, item: ItemInstance, c: { damage: number; bleed: number }): void {
    const info = this.damageInfo(item, c.damage, { kind: 'melee', unblockable: true, dir: sign(target.x - this.x) || this.facing, knockback: 120, bleed: c.bleed });
    this.onDealt({ target, result: target.takeDamage(info) }, item, info, { hitstop: 0.06, shake: 2, sfx: 'hit_heavy' });
  }

  /** 관 뚜껑: a parry sends out a shockwave around the heroine (unblockable, stuns). */
  private parryShockwave(item: ItemInstance, sw: { radius: number; damage: number; stun: number }): void {
    const w = this.world;
    const cx = this.x;
    const cy = this.y - 20;
    const infos = new Map<Actor, DamageInfo>();
    const reports = hitArea(w, { x: cx - sw.radius, y: cy - sw.radius, w: sw.radius * 2, h: sw.radius * 2 }, 'player', (t) => {
      const b = t.hurtbox();
      const nx = clamp(cx, b.x, b.x + b.w);
      const ny = clamp(cy, b.y, b.y + b.h);
      if (Math.hypot(nx - cx, ny - cy) > sw.radius) return null;
      const info = this.damageInfo(item, sw.damage, { kind: 'explosion', unblockable: true, dir: sign(t.x - this.x) || this.facing, knockback: 160, stun: sw.stun });
      infos.set(t, info);
      return info;
    });
    for (const r of reports) this.onDealt(r, item, infos.get(r.target)!, { hitstop: 0.06, shake: 2, sfx: 'hit_heavy' });
    w.fx.ring(cx, this.y - 4, { radius: sw.radius, color: '#f0e6d2', life: 0.35, flat: 0.45 });
    w.particles.emit('slam', this.x, this.y, { count: 12, color: '#f0e6d2' });
    w.audio.play('slam', { vol: 0.8, pitch: 1.2 });
  }

  private isFrontal(info: DamageInfo): boolean {
    if (info.source) return (info.source.x - this.x) * this.facing >= 0;
    if (info.dir) return info.dir * this.facing < 0;
    return true;
  }

  // ---------------------------------------------------------------- damage intake
  protected intercept(info: DamageInfo): DamageResult | null {
    if (info.kind === 'dot') return null;
    if (this.rollInvulnerable || (this.mode === 'dash' && this.dashS?.phase === 'go')) return { applied: false, amount: 0, killed: false };
    const b = this.blk;
    if (this.mode === 'block' && b && !info.unblockable && this.isFrontal(info)) {
      if (b.t < b.def.parryWindow) {
        this.parryFeedback(info.source ?? null);
        return { applied: false, amount: 0, killed: false, blocked: true, parried: true };
      }
      return this.blockHit(info, b);
    }
    return null;
  }

  /** Shield block: -80 % damage, sparks, no stagger. In the first `fullBlock` s of a block (뼈 성벽) nothing gets through at all. */
  private blockHit(info: DamageInfo, b: BlockState): DamageResult {
    const w = this.world;
    const wall = b.def.fullBlock !== undefined && b.t < b.def.fullBlock;
    const amount = wall ? 0 : Math.max(1, Math.round(info.amount * (1 - b.def.reduction)));
    this.hp -= amount;
    this.invuln = Math.max(this.invuln, 0.1);
    this.vx = (info.dir || -this.facing) * 90;
    if (wall) w.fx.text(this.x, this.y - this.h - 14, '완전 방어', '#f0e6d2');
    else w.fx.damageNumber(this.x, this.y - this.h - 4, amount, info);
    w.particles.emit('spark', this.x + this.facing * 14, this.y - 24, { dir: this.facing, count: 6, color: '#ffe9a8' });
    w.audio.play('block');
    w.shake(1.5, 0.12);
    w.addHitstop(0.04);
    this.flash = 0.06;
    if (wall) return { applied: false, amount: 0, killed: false, blocked: true };
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(info);
      return { applied: true, amount, killed: true, blocked: true };
    }
    this.sinceHurt = 0;
    this.addRecoverable(amount);
    w.emit({ type: 'playerHurt', amount });
    return { applied: true, amount, killed: false, blocked: true };
  }

  protected onHurt(info: DamageInfo, amount: number): void {
    const w = this.world;
    this.addRecoverable(amount);
    w.emit({ type: 'playerHurt', amount });
    if (info.kind === 'dot') return;
    this.sinceHurt = 0;
    this.cancelActions();
    this.mode = 'hurt';
    this.hurtT = 0.28;
    this.invuln = HURT_INVULN;
    if (!info.knockback && info.dir) this.vx = info.dir * 110;
    if (info.knockup === undefined && this.onGround) this.vy = -120;
    this.jumpCut = false;
    this.anim?.playFor('hurt', 0.3);
    w.audio.play('hurt');
    w.shake(3, 0.2);
    w.fx.screenFlash('#d01838', 0.14, 0.35);
    w.addHitstop(0.05);
  }

  private tickHurt(dt: number): void {
    this.hurtT -= dt;
    this.vx = approach(this.vx, 0, 700 * dt);
    if (this.hurtT <= 0) this.mode = 'free';
  }

  die(info: DamageInfo): void {
    if (godMode()) {
      this.hp = this.maxHp;
      this.onHurt({ ...info, kind: info.kind === 'dot' ? 'dot' : 'hazard' }, 0);
      return;
    }
    if (this.mode === 'dead') return;
    super.die(info);
    this.cancelActions();
    this.mode = 'dead';
    this.dropThrough = false;
    this.vx = info.dir ? info.dir * 120 : 0;
    this.vy = -180;
    this.recoverable = 0;
    this.anim?.play('death', true);
    const w = this.world;
    w.audio.play('player_death');
    w.shake(5, 0.3);
    w.fx.screenFlash('#d01838', 0.25, 0.45);
    w.addHitstop(0.12);
    if (!this.diedEmitted) {
      this.diedEmitted = true;
      w.emit({ type: 'playerDied' });
    }
  }

  // ---------------------------------------------------------------- rally
  private addRecoverable(amount: number): void {
    this.recoverable = Math.min(this.recoverable + amount, this.maxHp - this.hp);
    this.recoverPeak = this.recoverable;
  }

  /** Damage dealt wins back 30 % of itself from the recoverable segment. */
  private rally(dealt: number): void {
    if (this.recoverable <= 0 || this.dying) return;
    const r = Math.min(this.recoverable, dealt * RALLY_RESTORE);
    this.recoverable -= r;
    this.hp = Math.min(this.maxHp, this.hp + r);
  }

  // ---------------------------------------------------------------- heal flask
  private tickHeal(dt: number): void {
    this.healT += dt;
    this.steer(dt, 0.3, false);
    this.tryJump();
    this.variableJump(dt);
    const p = clamp(this.healT / HEAL_TIME, 0, 1);
    const give = Math.round(this.healTotal * p) - this.healGiven;
    if (give > 0) {
      this.healGiven += give;
      this.heal(give);
      this.world.particles.emit('heal', this.x, this.y - 20, { count: 1 });
    }
    if (this.healT >= HEAL_TIME) this.mode = 'free';
  }

  // ---------------------------------------------------------------- skills
  private trySkill(): boolean {
    const inp = this.world.input;
    const run = this.world.run;
    for (let i = 0; i < 2; i++) {
      const btn: Btn = i === 0 ? 'skill1' : 'skill2';
      if (!inp.pressedWithin(btn, ACTION_BUFFER)) continue;
      inp.consume(btn);
      const item = run.skills[i];
      const def = item ? SKILLS[item.id] : undefined;
      if (!item || !def) continue;
      if (this.skillCooldown[i] > 0) {
        this.world.audio.play('error', { vol: 0.3 });
        continue;
      }
      this.skillCooldownMax[i] = ITEMS[item.id].cooldown ?? 1;
      this.skillCooldown[i] = this.skillCooldownMax[i];
      const mx = this.moveDir();
      if (mx) this.facing = mx > 0 ? 1 : -1;
      this.cancelActions();
      this.mode = 'cast';
      this.cast = { slot: i, item, def, t: 0, fired: false };
      this.anim?.playFor(def.anim, def.castTime);
      this.world.audio.play(def.sfx);
      return true;
    }
    return false;
  }

  private tickCast(dt: number): void {
    const c = this.cast!;
    c.t += dt;
    this.steer(dt, c.def.moveScale, false);
    if (!c.fired && c.t >= c.def.fireAt) {
      c.fired = true;
      if (c.def.use(this, c.item) === false) {
        // nothing to use it on: no cooldown
        this.skillCooldown[c.slot] = 0;
        this.world.audio.play('error', { vol: 0.3 });
      }
    }
    if (c.t >= c.def.castTime) {
      this.cast = null;
      this.mode = 'free';
    }
  }

  // ---------------------------------------------------------------- misc
  /** Abort whatever ability is running (hurt, roll, new action). */
  private cancelActions(): void {
    if (this.mode === 'heal' && !this.dying) {
      const rest = this.healTotal - this.healGiven;
      if (rest > 0) this.heal(rest);
    }
    this.atk = null;
    this.bow = null;
    this.blk = null;
    this.chg = null;
    this.dashS = null;
    this.stf = null;
    this.cast = null;
    this.ledge = null;
    this.bowCharge = 0;
    this.gravityScale = 1;
    if (this.mode !== 'dead') this.mode = 'free';
  }
}
