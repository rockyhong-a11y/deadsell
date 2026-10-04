import { Entity } from '../entity';
import type { World, Interactable } from '../world';
import type { ChoiceOption } from '../ui/levelUI';
import type { ItemColor } from '../combat';
import { COLOR_HEX } from '../combat';
import { GRAVITY, MAX_FALL } from '../../engine/config';
import { approach, overlaps } from '../../engine/math';
import { moveBody } from '../physics';
import type { ItemInstance } from './types';
import { ITEMS, COLOR_NAMES, itemLines, itemName, AFFIX_NAMES } from './items';
import { CORPSE, FOODS, SCROLL } from '../rules';

/**
 * Pickups: cells, gold, corpse pieces, food, scrolls, dropped items. OWNER: player agent.
 * Loot bursts out with physics, homes in on the player, and is collected on touch.
 */

const HOME_DELAY = 0.4;
const HOME_RANGE = 260;

/** Gravity + bounce + friction body shared by every drop. */
abstract class Drop extends Entity {
  z = 5;
  protected bounce = 0.42;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 8;
    this.h = 8;
  }

  stepPhysics(dt: number): void {
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
    const pvx = this.vx;
    const pvy = this.vy;
    moveBody(this, this.world.map, dt);
    if (this.onGround) {
      if (pvy > 110) {
        this.vy = -pvy * this.bounce;
        this.onGround = false;
      }
      this.vx = approach(this.vx, 0, 520 * dt);
    }
    if (this.hitWallX) this.vx = -pvx * 0.4;
  }

  protected touchingPlayer(grow = 4): boolean {
    const p = this.world.player;
    if (!p || p.dying || p.dead) return false;
    const b = p.bounds;
    return overlaps(this.bounds, { x: b.x - grow, y: b.y - grow, w: b.w + grow * 2, h: b.h + grow * 2 });
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(color, a));
  g.addColorStop(1, hexA(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// ---------------------------------------------------------------------------
const chains = new WeakMap<World, { t: number; n: number }>();

/** Rising pitch while a handful of coins / cells is vacuumed up. */
function collectPitch(world: World): number {
  const c = chains.get(world) ?? { t: -9, n: 0 };
  c.n = world.time - c.t < 0.25 ? Math.min(c.n + 1, 10) : 0;
  c.t = world.time;
  chains.set(world, c);
  return 1 + c.n * 0.04;
}

type CoinKind = 'cell' | 'gold' | 'piece';

/** the bone colour of corpse pieces (HUD counter, glow, particles) */
export const PIECE_COLOR = '#e8d7c3';

class Coin extends Drop {
  private age = 0;
  private homing = false;
  private speed = 120;

  constructor(x: number, y: number, readonly kind: CoinKind, readonly value: number) {
    super(x, y);
  }

  init(): void {
    const piece = this.kind === 'piece';
    // 시체 조각 live on the `corpse` sheet; a drop worth CORPSE.big or more is drawn bigger
    this.setSheet(this.world.assets.sheet(piece ? 'corpse' : 'pickups'));
    this.anim!.play(piece ? (this.value >= CORPSE.big ? 'piece_big' : 'piece') : this.kind === 'cell' ? 'cell' : 'gold_coin');
    this.anim!.t = Math.random();
  }

  update(dt: number): void {
    this.age += dt;
    const w = this.world;
    const p = w.player;
    const alive = !!p && !p.dying && !p.dead;
    if (alive && !this.homing && this.age >= HOME_DELAY && Math.hypot(p.x - this.x, p.y - 14 - this.y) < HOME_RANGE) this.homing = true;
    if (this.homing && alive) {
      this.physics = false;
      this.speed = Math.min(560, this.speed + 1100 * dt);
      const dx = p.x - this.x;
      const dy = p.y - 14 - (this.y - 4);
      const d = Math.hypot(dx, dy) || 1;
      this.x += (dx / d) * Math.min(d, this.speed * dt);
      this.y += (dy / d) * Math.min(d, this.speed * dt);
      this.anim?.update(dt);
    } else super.update(dt);
    if (alive && this.age > 0.15 && this.touchingPlayer(6)) this.collect();
  }

  private collect(): void {
    const w = this.world;
    const run = w.run;
    const pitch = collectPitch(w);
    if (this.kind === 'cell') {
      run.cells += this.value;
      w.audio.play('pickup_cell', { pitch, vol: 0.6 });
      w.particles.emit('cell', this.x, this.y - 6, { count: 3 });
    } else if (this.kind === 'piece') {
      run.pieces += this.value;
      w.audio.play('pickup_cell', { pitch: pitch * 0.7, vol: 0.6 });
      w.particles.emit('cell', this.x, this.y - 6, { count: 3, color: PIECE_COLOR });
    } else {
      run.gold += this.value;
      w.audio.play('pickup_gold', { pitch, vol: 0.6 });
      w.particles.emit('gold', this.x, this.y - 6, { count: 3 });
    }
    w.emit({ type: 'pickup', what: this.kind === 'cell' ? 'cells' : this.kind === 'piece' ? 'pieces' : 'gold', amount: this.value });
    this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y + 2, false);
    const light = this.kind === 'cell' ? { r: 26, c: '#4fd8ff', a: 0.6 } : this.kind === 'piece' ? { r: 22, c: PIECE_COLOR, a: 0.45 } : { r: 20, c: '#ffd23f', a: 0.4 };
    this.world.lights.add(this.x, this.y - 6, light.r, light.c, light.a);
  }
}

function split(total: number, maxN: number, perCoin: number): number[] {
  total = Math.floor(total);
  if (total <= 0) return [];
  const n = Math.max(1, Math.min(maxN, Math.ceil(total / perCoin)));
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Scatter cells, gold and corpse pieces from a defeated enemy / opened chest. */
export function dropLoot(world: World, x: number, y: number, loot: { cells?: number; gold?: number; pieces?: number }): void {
  const burst = (kind: CoinKind, value: number) => {
    const c = new Coin(x + world.rng.range(-6, 6), y - 12, kind, value);
    c.vx = world.rng.range(-110, 110);
    c.vy = -world.rng.range(170, 320);
    world.spawn(c);
  };
  for (const v of split(loot.cells ?? 0, 12, 1)) burst('cell', v);
  for (const v of split(loot.gold ?? 0, 8, 5)) burst('gold', v);
  for (const v of split(loot.pieces ?? 0, 6, CORPSE.big)) burst('piece', v);
}

// ---------------------------------------------------------------------------
class Food extends Drop {
  private t = 0;
  private sprite: string;

  constructor(x: number, y: number, readonly healPct: number, sprite: string) {
    super(x, y);
    this.sprite = sprite;
    this.w = 12;
    this.h = 10;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('pickups'));
    this.anim!.play(this.sprite);
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    const p = this.world.player;
    if (this.t > 0.3 && p && !p.dying && p.hp < p.maxHp && this.touchingPlayer(4)) {
      const before = p.hp;
      p.heal(Math.max(1, Math.round(p.maxHp * this.healPct)));
      const w = this.world;
      w.audio.play('heal');
      w.particles.emit('heal', p.x, p.y - 20, { count: 6 });
      w.emit({ type: 'pickup', what: 'food', amount: Math.round(p.hp - before) });
      this.dead = true;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const bob = this.onGround ? Math.sin(this.t * 3) * 1.5 : 0;
    drawGlow(ctx, this.x, this.y - 8, 14, '#9bff7a', 0.28);
    this.anim?.draw(ctx, this.x, this.y + 2 + bob, false);
  }
}

/** Drop a food pickup (heals). */
export function spawnFood(world: World, x: number, y: number, healPct: number = FOODS[1].healPct): void {
  // the closest of the three foods (apple / bread / meat) by heal share
  const sprite = (healPct <= (FOODS[0].healPct + FOODS[1].healPct) / 2 ? FOODS[0] : healPct <= (FOODS[1].healPct + FOODS[2].healPct) / 2 ? FOODS[1] : FOODS[2]).sprite;
  const f = new Food(x, y - 10, healPct, sprite);
  f.vx = world.rng.range(-60, 60);
  f.vy = -200;
  world.spawn(f);
}

// ---------------------------------------------------------------------------
/** A weapon / skill lying on the floor: interact to equip or swap. */
class ItemDrop extends Drop implements Interactable {
  readonly interactable = true as const;
  interactRange = 46;
  private t = 0;
  private busy = false;
  private sparkT = 0;

  constructor(x: number, y: number, readonly inst: ItemInstance, delay = 0) {
    super(x, y);
    this.w = 14;
    this.h = 14;
    this.t = -delay;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('icons'));
    this.anim!.play(ITEMS[this.inst.id].icon);
  }

  promptText(): string {
    return `줍기 · ${itemName(this.inst)}`;
  }

  promptSub(): string | null {
    const lines = itemLines(this.inst);
    return this.inst.affix ? `${lines[0]} · ${AFFIX_NAMES[this.inst.affix]}` : lines[0];
  }

  canInteract(): boolean {
    return !this.dead && !this.busy && this.t > 0.35;
  }

  interact(): void {
    if (!this.canInteract()) return;
    const w = this.world;
    const run = w.run;
    const def = ITEMS[this.inst.id];
    const slots = def.slot === 'weapon' ? run.weapons : run.skills;
    const empty = slots.findIndex((s) => s === null);
    if (empty >= 0) {
      slots[empty] = this.inst;
      this.finish(null);
      return;
    }
    const names = def.slot === 'weapon' ? ['주무기', '보조 무기'] : ['스킬 1', '스킬 2'];
    const options: ChoiceOption[] = slots.map((cur, i) => ({
      label: `${names[i]} · ${itemName(cur!)}`,
      sub: `${itemName(this.inst)}(으)로 교체`,
      color: COLOR_HEX[ITEMS[cur!.id].color],
      icon: ITEMS[cur!.id].icon,
    }));
    this.busy = true;
    w.ui.openChoice(`${itemName(this.inst)} · 교체할 칸을 선택`, options, (i) => {
      this.busy = false;
      if (this.dead || i < 0 || i >= slots.length) return;
      const old = slots[i];
      slots[i] = this.inst;
      this.finish(old);
    }, true);
  }

  private finish(replaced: ItemInstance | null): void {
    const w = this.world;
    this.dead = true;
    const col = COLOR_HEX[ITEMS[this.inst.id].color];
    w.audio.play('pickup_item');
    w.particles.emit('magic', this.x, this.y - 10, { count: 10, color: col });
    w.emit({ type: 'pickup', what: 'item', amount: 1 });
    w.emit({ type: 'toast', text: `${itemName(this.inst)} 획득`, color: col });
    if (replaced) {
      const p = w.player;
      const d = new ItemDrop(p.x, p.y - 24, replaced, 0.5);
      d.vy = -240;
      d.vx = -p.facing * 50;
      w.spawn(d);
    }
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
    if (this.inst.affix || this.inst.tier > 1) {
      this.sparkT -= dt;
      if (this.sparkT <= 0 && this.world.player) {
        this.sparkT = 0.5;
        this.world.particles.emit('magic', this.x, this.y - 16, { count: 1, color: COLOR_HEX[ITEMS[this.inst.id].color] });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const col = COLOR_HEX[ITEMS[this.inst.id].color];
    const bob = Math.sin(this.t * 3) * 2.5;
    const pulse = 0.5 + 0.2 * Math.sin(this.t * 4);
    drawGlow(ctx, this.x, this.y - 14 + bob, 26, col, pulse);
    this.anim?.draw(ctx, this.x, this.y - 14 + bob + 1, false);
    this.world.lights.add(this.x, this.y - 14, 48, col, 0.8, 0.1);
  }
}

/** Drop an item on the floor (interactable: pick up / swap). */
export function spawnItemDrop(world: World, x: number, y: number, inst: ItemInstance): void {
  const d = new ItemDrop(x, y, inst);
  d.vy = -170;
  world.spawn(d);
}

// ---------------------------------------------------------------------------
export const SCROLL_COLORS: ItemColor[] = ['brutality', 'tactics', 'survival'];
export const SCROLL_SPRITE: Record<ItemColor, string> = { brutality: 'scroll_red', tactics: 'scroll_purple', survival: 'scroll_green' };

/** A scroll of power: interact to choose Brutality / Tactics / Survival. */
class Scroll extends Drop implements Interactable {
  readonly interactable = true as const;
  interactRange = 46;
  private t = 0;
  private busy = false;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 14;
    this.h = 14;
  }

  init(): void {
    this.setSheet(this.world.assets.sheet('pickups'));
  }

  promptText(): string {
    return '읽기 · 힘의 두루마리';
  }

  promptSub(): string | null {
    return '능력치를 하나 올린다';
  }

  canInteract(): boolean {
    return !this.dead && !this.busy && this.t > 0.3;
  }

  interact(): void {
    if (!this.canInteract()) return;
    const w = this.world;
    const run = w.run;
    const options: ChoiceOption[] = SCROLL_COLORS.map((c) => ({
      label: COLOR_NAMES[c],
      sub: `Lv ${run.stats[c]} → ${run.stats[c] + 1} · ${COLOR_NAMES[c]} 장비 피해 +${Math.round(SCROLL.dmgPerLevel * 100)}% · 최대 체력 +${Math.round(SCROLL.hpPerLevel[c] * 100)}%`,
      color: COLOR_HEX[c],
      icon: 'scroll',
    }));
    this.busy = true;
    w.ui.openChoice('힘의 두루마리', options, (i) => {
      this.busy = false;
      if (this.dead || i < 0 || i >= SCROLL_COLORS.length) return;
      const c = SCROLL_COLORS[i];
      run.addStat(c);
      w.player.refreshStats();
      this.dead = true;
      w.audio.play('scroll');
      w.particles.emit('magic', w.player.x, w.player.y - 24, { count: 14, color: COLOR_HEX[c] });
      w.fx.text(w.player.x, w.player.y - w.player.h - 12, `${COLOR_NAMES[c]} +1`, COLOR_HEX[c]);
      w.emit({ type: 'pickup', what: 'scroll', amount: 1 });
      w.emit({ type: 'toast', text: `${COLOR_NAMES[c]} 상승`, color: COLOR_HEX[c] });
    }, true);
  }

  update(dt: number): void {
    this.t += dt;
    super.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const c = SCROLL_COLORS[Math.floor(this.t / 0.9) % 3];
    const bob = Math.sin(this.t * 3) * 2.5;
    drawGlow(ctx, this.x, this.y - 12 + bob, 28, COLOR_HEX[c], 0.55);
    this.anim?.play(SCROLL_SPRITE[c]);
    this.anim?.draw(ctx, this.x, this.y + 2 + bob, false);
    this.world.lights.add(this.x, this.y - 12, 50, COLOR_HEX[c], 0.8, 0.1);
  }
}

/** Drop a scroll of power (on pickup the player chooses a stat). */
export function spawnScroll(world: World, x: number, y: number): void {
  const s = new Scroll(x, y);
  s.vy = -170;
  world.spawn(s);
}
