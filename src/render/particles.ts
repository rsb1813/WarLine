// 파편, 연기, 불꽃, 먼지 같은 짧은 효과
import type { Sprite, Sprites } from './sprites';

export const enum PK { Smoke, Dust, Fire, Glow, Spark, Debris, Snow, Water, Casing, Glass, Blood, Flash, Ring, Tracer, Dark }

export interface Particle {
  k: PK;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  life: number;
  max: number;
  s: number;
  grow: number;
  a: number;
  va: number;
  col: string;
  alpha: number;
}

export class Particles {
  list: Particle[] = [];
  pool: Particle[] = [];
  cap: number;
  wind = { x: 14, y: -6 };

  constructor(cap: number) { this.cap = cap; }

  add(k: PK, x: number, y: number, o: Partial<Particle> = {}): Particle | null {
    if (this.list.length >= this.cap) {
      // 꽉 차면 연기처럼 오래 가는 것부터 줄인다
      if (k === PK.Smoke || k === PK.Dust) return null;
      this.list.shift();
    }
    const p = this.pool.pop() ?? ({} as Particle);
    p.k = k; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.z = 0; p.vz = 0; p.life = 1; p.max = 1; p.s = 10; p.grow = 0;
    p.a = 0; p.va = 0; p.col = '#fff'; p.alpha = 1;
    Object.assign(p, o);
    p.max = p.life;
    this.list.push(p);
    return p;
  }

  update(dt: number) {
    let w = 0;
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { this.pool.push(p); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.s += p.grow * dt;
      p.a += p.va * dt;
      switch (p.k) {
        case PK.Smoke: case PK.Dust: case PK.Dark:
          p.vx += (this.wind.x - p.vx) * dt * 0.4; p.vy += (this.wind.y - p.vy) * dt * 0.4; break;
        case PK.Debris: case PK.Casing: case PK.Glass:
          p.z += p.vz * dt; p.vz -= 520 * dt;
          if (p.z <= 0) { p.z = 0; p.vz = -p.vz * 0.3; p.vx *= 0.5; p.vy *= 0.5; p.va *= 0.5; }
          break;
        case PK.Spark: case PK.Water: case PK.Snow: case PK.Blood:
          p.vx *= 1 - dt * 4; p.vy *= 1 - dt * 4; break;
      }
      L[w++] = p;
    }
    L.length = w;
  }

  /** 지면 높이의 효과 (연기, 먼지 제외) */
  drawLow(ctx: CanvasRenderingContext2D, sp: Sprites, x0: number, y0: number, x1: number, y1: number) {
    for (const p of this.list) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const f = p.life / p.max;
      switch (p.k) {
        case PK.Debris: case PK.Casing: case PK.Glass: {
          ctx.globalAlpha = Math.min(1, f * 3) * p.alpha;
          ctx.fillStyle = p.col;
          ctx.save(); ctx.translate(p.x, p.y - p.z); ctx.rotate(p.a);
          ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
          ctx.restore();
          break;
        }
        case PK.Blood: {
          ctx.globalAlpha = f * 0.7;
          ctx.fillStyle = '#7a1e18';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1.4 - f * 0.4), 0, 7); ctx.fill();
          break;
        }
        case PK.Water: case PK.Snow: {
          ctx.globalAlpha = f * 0.85;
          blit(ctx, p.k === PK.Water ? sp.snowPuff : sp.snowPuff, p.x, p.y, p.s);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 위로 피어오르는 효과와 빛 */
  drawHigh(ctx: CanvasRenderingContext2D, sp: Sprites, x0: number, y0: number, x1: number, y1: number) {
    for (const p of this.list) {
      if (p.x < x0 - 80 || p.x > x1 + 80 || p.y < y0 - 80 || p.y > y1 + 80) continue;
      const f = p.life / p.max;
      switch (p.k) {
        case PK.Smoke: case PK.Dust: case PK.Dark: {
          const fade = Math.min(1, (1 - f) * 6) * f;
          ctx.globalAlpha = fade * p.alpha;
          blit(ctx, p.k === PK.Smoke ? sp.smoke : p.k === PK.Dust ? sp.dust : sp.dark, p.x, p.y, p.s);
          break;
        }
        case PK.Fire: {
          ctx.globalAlpha = f * p.alpha;
          blit(ctx, sp.fire, p.x, p.y, p.s * (0.6 + f * 0.4));
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      if (p.x < x0 - 200 || p.x > x1 + 200 || p.y < y0 - 200 || p.y > y1 + 200) continue;
      const f = p.life / p.max;
      if (p.k === PK.Glow || p.k === PK.Flash) {
        ctx.globalAlpha = f * f * p.alpha;
        blit(ctx, sp.glow, p.x, p.y, p.s * (p.k === PK.Flash ? 1 : 0.7 + f * 0.3));
      } else if (p.k === PK.Spark) {
        ctx.globalAlpha = f;
        ctx.strokeStyle = p.col;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      } else if (p.k === PK.Ring) {
        ctx.globalAlpha = f * 0.8 * p.alpha;
        ctx.strokeStyle = p.col;
        ctx.lineWidth = 3 * f + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - f * 0.7), 0, 7); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, r: number) {
  ctx.drawImage(s.c, x - r, y - r, r * 2, r * 2);
}
