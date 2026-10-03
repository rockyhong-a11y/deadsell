/**
 * Action-based input. Sources (keyboard here, touch gestures in touch.ts) write
 * into one Input; gameplay only reads actions.
 *
 * Edges (`pressed`/`released`) survive until the next `endStep()`, which the
 * game loop calls after every fixed update, so a tap that starts and ends
 * between two updates is still seen exactly once.
 */
export type Btn =
  | 'jump' | 'attack1' | 'attack2' | 'roll' | 'skill1' | 'skill2'
  | 'interact' | 'heal' | 'down' | 'map' | 'pause' | 'confirm';

export class Input {
  /** analog movement, -1..1 (keyboard gives -1/0/1) */
  moveX = 0;
  moveY = 0;
  /** direction requested by the last roll gesture (-1/1), 0 = use facing */
  rollDir = 0;
  /** last input device used, so UI can show the right hints */
  device: 'touch' | 'keyboard' = 'keyboard';

  private held = new Set<Btn>();
  private pressedSet = new Set<Btn>();
  private releasedSet = new Set<Btn>();
  private pressTime = new Map<Btn, number>();
  private now = 0;

  // per-source analog values, combined in `moveX/moveY`
  private axes = new Map<string, { x: number; y: number }>();

  press(b: Btn): void {
    if (!this.held.has(b)) {
      this.held.add(b);
      this.pressedSet.add(b);
      this.pressTime.set(b, this.now);
    }
  }

  release(b: Btn): void {
    if (this.held.has(b)) {
      this.held.delete(b);
      this.releasedSet.add(b);
    }
  }

  /** press + release within one step (taps, swipes) */
  tap(b: Btn): void {
    this.pressedSet.add(b);
    this.releasedSet.add(b);
    this.pressTime.set(b, this.now);
  }

  isDown(b: Btn): boolean {
    return this.held.has(b);
  }

  pressed(b: Btn): boolean {
    return this.pressedSet.has(b);
  }

  released(b: Btn): boolean {
    return this.releasedSet.has(b);
  }

  /** Was `b` pressed within the last `secs` seconds (input buffering)? Consumes nothing. */
  pressedWithin(b: Btn, secs: number): boolean {
    const t = this.pressTime.get(b);
    return t !== undefined && this.now - t <= secs;
  }

  /** Forget a buffered press so it does not trigger twice. */
  consume(b: Btn): void {
    this.pressTime.delete(b);
    this.pressedSet.delete(b);
  }

  setAxis(source: string, x: number, y: number): void {
    this.axes.set(source, { x, y });
    let ax = 0;
    let ay = 0;
    for (const v of this.axes.values()) {
      ax += v.x;
      ay += v.y;
    }
    this.moveX = Math.max(-1, Math.min(1, ax));
    this.moveY = Math.max(-1, Math.min(1, ay));
  }

  /** Called by the loop after each fixed step. */
  endStep(dt: number): void {
    this.now += dt;
    this.pressedSet.clear();
    this.releasedSet.clear();
  }

  /** Release everything (focus lost, scene change). */
  reset(): void {
    for (const b of [...this.held]) this.release(b);
    this.axes.clear();
    this.moveX = this.moveY = 0;
    this.pressTime.clear();
  }

  get time(): number {
    return this.now;
  }
}

const KEYMAP: Record<string, Btn> = {
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
  KeyJ: 'attack1', KeyK: 'attack2',
  KeyL: 'roll', ShiftLeft: 'roll', ShiftRight: 'roll',
  KeyQ: 'skill1', KeyE: 'skill2', KeyF: 'interact', KeyR: 'heal',
  KeyS: 'down', ArrowDown: 'down',
  KeyM: 'map', Escape: 'pause', Enter: 'confirm',
};

export function attachKeyboard(input: Input): void {
  const dirs = { left: false, right: false, up: false, down: false };
  const update = () => input.setAxis('kb', (dirs.right ? 1 : 0) - (dirs.left ? 1 : 0), (dirs.down ? 1 : 0) - (dirs.up ? 1 : 0));
  const onKey = (e: KeyboardEvent, down: boolean) => {
    const c = e.code;
    if (c === 'KeyA' || c === 'ArrowLeft') dirs.left = down;
    else if (c === 'KeyD' || c === 'ArrowRight') dirs.right = down;
    else if (c === 'KeyW' || c === 'ArrowUp') dirs.up = down;
    else if (c === 'KeyS' || c === 'ArrowDown') dirs.down = down;
    update();
    const b = KEYMAP[c];
    if (b) {
      if (down) {
        if (!e.repeat) input.press(b);
      } else input.release(b);
      e.preventDefault();
    } else if (c.startsWith('Arrow') || c === 'KeyA' || c === 'KeyD') e.preventDefault();
    input.device = 'keyboard';
    if (down && b === 'roll') input.rollDir = 0;
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => {
    dirs.left = dirs.right = dirs.up = dirs.down = false;
    input.reset();
  });
}
