/**
 * Particle system (world space). OWNER: fx agent — replace this minimal
 * implementation, keep the public API (emit/update/draw/clear) stable.
 */
export type ParticlePreset =
  | 'hit' | 'blood' | 'spark' | 'dust' | 'land' | 'jump' | 'roll' | 'cell' | 'gold' | 'fire' | 'ice'
  | 'smoke' | 'explosion' | 'embers' | 'heal' | 'debris' | 'death' | 'parry' | 'magic' | 'slam' | 'drip';

export interface EmitOpts {
  /** -1/1 main direction (hits spray away from the attacker) */
  dir?: number;
  color?: string;
  count?: number;
  /** scales the preset's speed/size */
  power?: number;
}

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number; }

export class Particles {
  private ps: P[] = [];

  emit(preset: ParticlePreset, x: number, y: number, o: EmitOpts = {}): void {
    const n = o.count ?? (preset === 'hit' ? 8 : preset === 'explosion' ? 24 : 5);
    const color = o.color ?? (preset === 'cell' ? '#4fd8ff' : preset === 'fire' ? '#ff9a3c' : preset === 'ice' ? '#bdf3ff' : '#e8e0d0');
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 120 * (o.power ?? 1);
      this.ps.push({ x, y, vx: Math.cos(a) * s + (o.dir ?? 0) * 80, vy: Math.sin(a) * s - 40, life: 0.4, max: 0.4, color, size: 2, g: 400 });
    }
  }

  update(dt: number): void {
    for (const p of this.ps) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.ps = this.ps.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.ps) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.ps = [];
  }
}
