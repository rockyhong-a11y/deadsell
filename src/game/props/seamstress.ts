import type { Interactable } from '../world';
import { Prop, drawBubble, drawSoftGlow } from './common';
import { PIECE_COLOR } from '../items/pickups';
import { bodyNeed, sewPieces, sewPlan } from '../meta/body';
import { CORPSE } from '../rules';

/** Selma's banter while the heroine carries nothing (docs/CONTENT3.md §3). */
export const SELMA_LINES = [
  '여기 있던 팔, 종탑에서 은화 세 닢에 팔렸지.',
  '실은 붉은 걸로. 피가 덜 티 나거든.',
  '골렘? 조각만 넉넉하면 꿰매 주지.',
  '죽은 건 팔 수 있어. 산 건 아직 비싸고.',
  '내 가위는 손님을 가리지 않아.',
  '종탑의 간수가 장부를 쥐고 있어.',
  '네 몸은 한 땀씩 되돌아오는 중이야.',
];

/** how long she sews (s) and how long the slow-motion lasts when the body is completed (real seconds) */
const SEW_TIME = 1.2;
const CLEAR_TIME = 0.6;

/**
 * Selma (셀마), the corpse seamstress of every 쉼터: sews the carried pieces into Cinder's body (permanent), or just talks.
 * Completing the body (100/100) ends the run with the loop-clear scene.
 */
export class Seamstress extends Prop implements Interactable {
  readonly interactable = true as const;
  interactRange = 52;
  private line = '';
  private lineT = 0;
  private lastLine = -1;
  private sewT = 0;
  private talkT = 0;
  /** > 0 while the body-completing slow motion runs (real seconds left) */
  private clearT = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.w = 24;
    this.h = 60;
    this.z = 1;
    this.facing = -1;
  }

  init(): void {
    this.useSheet('seamstress', 'idle');
  }

  private get plan() {
    return sewPlan(this.world.run.pieces, this.world.game.save.body);
  }

  promptText(): string {
    const w = this.world;
    if (w.run.pieces <= 0) return '대화';
    const plan = this.plan;
    return plan.completes ? `몸 완성하기 · ${bodyNeed(w.game.save.body)}조각` : `몸 꿰매기 · ${w.run.pieces}조각`;
  }

  promptSub(): string | null {
    const w = this.world;
    const save = w.game.save;
    const plan = this.plan;
    if (w.run.pieces > 0 && plan.completes) return `${save.loop}회차 클리어!` + (plan.surplus > 0 ? ` · 남는 ${plan.surplus}조각은 사라짐` : '');
    return `재봉사 셀마 · 몸 ${save.body}/${CORPSE.body}`;
  }

  canInteract(): boolean {
    return !this.dead && this.clearT <= 0;
  }

  interact(): void {
    if (!this.canInteract()) return;
    const w = this.world;
    if (w.run.pieces <= 0) {
      this.talk();
      return;
    }
    const { plan, cleared } = sewPieces(w.run, w.game.save);
    w.game.persist();
    this.sewT = SEW_TIME;
    const p = w.player;
    w.audio.play('heal');
    w.particles.emit('magic', p.x, p.y - 24, { count: 18, color: '#c8324a' });
    w.particles.emit('magic', p.x, p.y - 24, { count: 8, color: PIECE_COLOR });
    const body = cleared ? CORPSE.body : w.game.save.body;
    w.emit({ type: 'toast', text: `시체 조각 ${plan.n}개를 꿰맸다 · 몸 ${body}/${CORPSE.body}`, color: PIECE_COLOR });
    if (cleared) {
      // the bell tolls: a flash and slow motion, then the loop-clear scene
      w.fx.screenFlash(PIECE_COLOR, 0.5, 0.6);
      w.timeScale = 0.3;
      this.clearT = CLEAR_TIME;
      this.onCleared = () => w.game.loopClear(cleared);
    }
  }

  /** runs once the slow motion is over (set when the body is completed) */
  private onCleared: (() => void) | null = null;

  private talk(): void {
    const w = this.world;
    let i = w.rng.int(0, SELMA_LINES.length - 1);
    if (i === this.lastLine) i = (i + 1) % SELMA_LINES.length;
    this.lastLine = i;
    this.line = SELMA_LINES[i];
    this.lineT = 3;
    this.talkT = 1.6;
    w.audio.play('ui_tap');
  }

  update(dt: number): void {
    super.update(dt);
    if (this.playerNear(130)) this.facePlayer();
    if (this.lineT > 0) this.lineT -= dt;
    if (this.talkT > 0) this.talkT -= dt;
    if (this.sewT > 0) this.sewT -= dt;
    if (this.clearT > 0) {
      // `dt` is slowed by the world's time scale: count real seconds
      this.clearT -= dt / Math.max(0.05, this.world.timeScale);
      if (this.clearT <= 0) {
        this.clearT = 0;
        this.onCleared?.();
        this.onCleared = null;
      }
    }
    this.anim?.play(this.sewT > 0 ? 'sew' : this.talkT > 0 ? 'talk' : 'idle');
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.anim?.draw(ctx, this.x, this.y, this.facing < 0);
    const flick = 0.2 + 0.06 * Math.sin(this.world.time * 3) + (this.sewT > 0 ? 0.25 : 0);
    drawSoftGlow(ctx, this.x - 10 * this.facing, this.y - 40, 28, '#ff5a6e', flick);
    if (this.lineT > 0) drawBubble(ctx, this.line, this.x, this.y - 78);
    this.world.lights.add(this.x, this.y - 40, 84, '#ff7a86', 0.65 + (this.sewT > 0 ? 0.4 : 0), 0.1);
  }
}
