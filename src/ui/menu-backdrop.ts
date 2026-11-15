// 첫 화면 배경: 캔버스로 그린 눈 덮인 능선, 날리는 눈, 먼 탐조등과 조명탄, 지평선 섬광.
// 가볍게: 능선은 크기가 바뀔 때만 미리 그려 두고, 화면이 숨으면 멈춘다.
import { fbm, rng } from '../math';
import type { Quality } from '../types';
import { reducedMotion } from './menu-util';

interface Flake { x: number; y: number; z: number; ph: number }
interface Flare { x: number; y: number; vx: number; t: number; life: number; trail: { x: number; y: number }[]; hue: number }
interface Flash { x: number; t: number; life: number; r: number }
interface Ridge { img: HTMLCanvasElement; depth: number; y0: number }

export class Backdrop {
  private ctx: CanvasRenderingContext2D;
  private w = 1; private h = 1; private dpr = 1;
  private raf = 0; private last = 0; private time = 0;
  private running = false; private dead = false;
  private ridges: Ridge[] = [];
  private flakes: Flake[] = [];
  private flares: Flare[] = [];
  private flashes: Flash[] = [];
  private stars: { x: number; y: number; a: number; ph: number }[] = [];
  private grain: CanvasPattern | null = null;
  private nextFlare = 1.5; private nextFlash = 3;
  private px = 0; private py = 0; private tx = 0; private ty = 0;
  private r = rng(2147);
  private still = reducedMotion();
  private ro: ResizeObserver;
  private beamOrigins: { x: number; y: number; base: number; amp: number; sp: number; ph: number }[] = [];

  constructor(private canvas: HTMLCanvasElement, private quality: Quality) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    this.resize();
  }

  private onVis = () => { if (document.hidden) this.stop(); else this.start(); };
  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    this.tx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    this.ty = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
  };

  start(): void {
    if (this.dead || this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    if (this.still) { this.draw(0); this.running = false; return; }
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.raf); }

  dispose(): void {
    this.stop();
    this.dead = true;
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('pointermove', this.onMove);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    const dpr = this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.75 : 1.35);
    if (w === this.w && h === this.h && dpr === this.dpr && this.ridges.length) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.build();
    if (!this.running || this.still) this.draw(0);
  }

  /** 능선, 별, 눈송이를 크기에 맞춰 새로 만든다 */
  private build(): void {
    const { w, h, dpr } = this;
    const r = rng(904);
    const pad = 90;
    const portrait = h > w * 1.1;
    const horizon = h * (portrait ? 0.56 : 0.6);
    const layers = [
      { y: horizon - h * 0.05, amp: h * 0.13, freq: 2.2, col: [30, 40, 53], snow: 0.16, seed: 11, trees: 0 },
      { y: horizon + h * 0.06, amp: h * 0.15, freq: 3.1, col: [19, 26, 35], snow: 0.2, seed: 23, trees: 0 },
      { y: horizon + h * 0.17, amp: h * 0.13, freq: 3.8, col: [12, 16, 22], snow: 0.18, seed: 37, trees: 0.35 },
      { y: horizon + h * 0.3, amp: h * 0.12, freq: 2.6, col: [6, 8, 11], snow: 0.12, seed: 51, trees: 1 },
    ];
    this.ridges = layers.map((L, i) => {
      const cw = w + pad * 2;
      const c = document.createElement('canvas');
      c.width = Math.round(cw * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.scale(dpr, dpr);
      const n = fbm(L.seed, 5);
      const ys: number[] = [];
      const step = 4;
      for (let x = 0; x <= cw + step; x += step) {
        const u = x / cw;
        let v = n(u * L.freq, i * 3.7);
        v = Math.pow(v, 1.6) * 1.9;
        const crag = Math.abs(n(u * L.freq * 4.3, 9 + i) - 0.5) * 0.35;
        ys.push(L.y - (v + crag) * L.amp);
      }
      // 몸통
      const body = g.createLinearGradient(0, L.y - L.amp * 1.4, 0, h);
      const [cr, cg, cb] = L.col;
      body.addColorStop(0, `rgb(${cr + 6},${cg + 8},${cb + 12})`);
      body.addColorStop(1, `rgb(${Math.max(0, cr - 6)},${Math.max(0, cg - 6)},${Math.max(0, cb - 6)})`);
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(0, h);
      ys.forEach((y, k) => g.lineTo(k * step, y));
      g.lineTo(cw, h);
      g.closePath();
      g.fill();
      // 눈 덮인 마루: 경사가 빛 쪽(왼쪽)을 보면 밝게
      g.save();
      g.clip();
      for (let k = 1; k < ys.length; k++) {
        const slope = ys[k] - ys[k - 1];
        const lit = slope > 0 ? 0.55 + Math.min(0.45, slope * 0.12) : 0.25;
        const depth = 10 + n(k * 0.07, 40 + i) * 34;
        const grd = g.createLinearGradient(0, ys[k], 0, ys[k] + depth);
        grd.addColorStop(0, `rgba(214,226,238,${(L.snow * lit * 1.6).toFixed(3)})`);
        grd.addColorStop(1, 'rgba(214,226,238,0)');
        g.fillStyle = grd;
        g.fillRect((k - 1) * step, ys[k] - 1, step + 0.6, depth + 2);
      }
      // 아래로 내려가는 안개
      const fog = g.createLinearGradient(0, L.y - L.amp * 0.3, 0, L.y + h * 0.12);
      fog.addColorStop(0, 'rgba(120,140,160,0)');
      fog.addColorStop(1, `rgba(90,108,128,${0.07 + i * 0.015})`);
      g.fillStyle = fog;
      g.fillRect(0, L.y - L.amp, cw, h);
      g.restore();
      // 침엽수 실루엣
      if (L.trees > 0) {
        g.fillStyle = `rgb(${Math.max(0, cr - 4)},${Math.max(0, cg - 3)},${Math.max(0, cb - 2)})`;
        const count = Math.round((cw / 9) * L.trees);
        for (let t = 0; t < count; t++) {
          const x = r() * cw;
          const k = Math.min(ys.length - 1, Math.max(0, Math.round(x / step)));
          if (n(x / cw * 6, 77 + i) < 0.48) continue;
          const th = (i === 3 ? 18 : 9) + r() * (i === 3 ? 26 : 12);
          const tw = th * 0.32;
          const by = ys[k] + 3;
          g.beginPath();
          for (let lv = 0; lv < 3; lv++) {
            const yy = by - th * (lv * 0.3);
            const ww = tw * (1 - lv * 0.28);
            g.moveTo(x - ww, yy);
            g.lineTo(x, yy - th * 0.45);
            g.lineTo(x + ww, yy);
          }
          g.fill();
          g.fillRect(x - 0.8, by - 2, 1.6, 5);
        }
      }
      // 맨 앞 능선: 무전 안테나
      if (i === 3) {
        const mx = cw * 0.78;
        const k = Math.round(mx / step);
        const top = ys[k] - h * 0.16;
        g.strokeStyle = 'rgb(6,8,11)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(mx, ys[k] + 4); g.lineTo(mx, top);
        g.moveTo(mx - 14, ys[k] + 4); g.lineTo(mx, top + 20); g.lineTo(mx + 14, ys[k] + 4);
        for (let q = 1; q < 6; q++) { const yy = top + (ys[k] - top) * (q / 6); const ww = 2 + q * 2.2; g.moveTo(mx - ww, yy); g.lineTo(mx + ww, yy); }
        g.stroke();
        this.mast = { x: mx, y: top };
      }
      return { img: c, depth: 0.25 + i * 0.25, y0: L.y };
    });
    // 탐조등 받침 (가운데 능선 뒤)
    const b1 = layers[1].y + h * 0.02;
    this.beamOrigins = [
      { x: w * 0.18, y: b1, base: -0.35, amp: 0.38, sp: 0.21, ph: 0 },
      { x: w * 0.55, y: b1 + 10, base: 0.12, amp: 0.45, sp: 0.15, ph: 2.1 },
      { x: w * 0.86, y: b1 - 4, base: 0.42, amp: 0.3, sp: 0.26, ph: 4.2 },
    ];
    // 별
    this.stars = [];
    const sc = Math.round((w * h) / 9000);
    for (let k = 0; k < sc; k++) this.stars.push({ x: r() * w, y: r() * horizon * 0.75, a: 0.15 + r() * 0.45, ph: r() * 7 });
    // 눈
    const fc = Math.round(Math.min(this.quality === 'low' ? 110 : 240, Math.max(70, (w * h) / 7000)));
    if (this.flakes.length !== fc) {
      this.flakes = [];
      for (let k = 0; k < fc; k++) this.flakes.push({ x: r() * w, y: r() * h, z: 0.15 + r() * 0.85, ph: r() * 7 });
    }
    // 필름 낟알
    const gc = document.createElement('canvas');
    gc.width = gc.height = 96;
    const gg = gc.getContext('2d') as CanvasRenderingContext2D;
    const id = gg.createImageData(96, 96);
    for (let k = 0; k < id.data.length; k += 4) {
      const v = Math.floor(r() * 255);
      id.data[k] = id.data[k + 1] = id.data[k + 2] = v;
      id.data[k + 3] = 255;
    }
    gg.putImageData(id, 0, 0);
    this.grain = this.ctx.createPattern(gc, 'repeat');
  }

  private mast = { x: 0, y: 0 };

  private draw(dt: number): void {
    const { ctx, w, h, dpr } = this;
    this.time += dt;
    const t = this.time;
    this.px += (this.tx - this.px) * Math.min(1, dt * 1.8);
    this.py += (this.ty - this.py) * Math.min(1, dt * 1.8);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 하늘
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#04060a');
    sky.addColorStop(0.42, '#0b111a');
    sky.addColorStop(0.62, '#1a2431');
    sky.addColorStop(1, '#0a0e14');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // 지평선 너머 불빛 (멀리 타는 마을)
    const glowX = w * (0.68 + Math.sin(t * 0.05) * 0.01);
    const glowY = this.ridges.length ? this.ridges[0].y0 : h * 0.55;
    const pulse = 0.75 + Math.sin(t * 0.7) * 0.08 + Math.sin(t * 2.3) * 0.04;
    const hg = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, w * 0.42);
    hg.addColorStop(0, `rgba(255,150,60,${(0.2 * pulse).toFixed(3)})`);
    hg.addColorStop(0.35, `rgba(200,90,40,${(0.08 * pulse).toFixed(3)})`);
    hg.addColorStop(1, 'rgba(120,60,30,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);

    // 별
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * (0.7 + Math.sin(t * 1.3 + s.ph) * 0.3);
      ctx.fillStyle = '#cfe0ff';
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    ctx.globalAlpha = 1;

    // 지평선 섬광 (먼 포격)
    this.nextFlash -= dt;
    if (this.nextFlash <= 0 && !this.still) {
      this.flashes.push({ x: w * (0.1 + this.r() * 0.8), t: 0, life: 0.35 + this.r() * 0.5, r: 60 + this.r() * 120 });
      this.nextFlash = 2.5 + this.r() * 6;
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      f.t += dt;
      const k = Math.max(0, 1 - f.t / f.life);
      const fr = ctx.createRadialGradient(f.x, glowY + 6, 0, f.x, glowY + 6, f.r * (1 + f.t));
      fr.addColorStop(0, `rgba(255,200,140,${(0.5 * k * k).toFixed(3)})`);
      fr.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = fr;
      ctx.fillRect(f.x - f.r * 3, glowY - f.r * 3, f.r * 6, f.r * 6);
    }
    this.flashes = this.flashes.filter((f) => f.t < f.life);
    ctx.globalCompositeOperation = 'source-over';

    // 먼 능선
    this.drawRidge(0);

    // 탐조등
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.beamOrigins) {
      const ang = b.base + Math.sin(t * b.sp + b.ph) * b.amp;
      const L = h * 1.1;
      const spread = 0.05;
      const ex = b.x + Math.sin(ang) * L, ey = b.y - Math.cos(ang) * L;
      const lx = b.x + Math.sin(ang - spread) * L, ly = b.y - Math.cos(ang - spread) * L;
      const rx = b.x + Math.sin(ang + spread) * L, ry = b.y - Math.cos(ang + spread) * L;
      const bg = ctx.createLinearGradient(b.x, b.y, ex, ey);
      bg.addColorStop(0, 'rgba(190,215,255,0.16)');
      bg.addColorStop(0.5, 'rgba(170,200,255,0.05)');
      bg.addColorStop(1, 'rgba(160,190,255,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(lx, ly);
      ctx.lineTo(rx, ry);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 조명탄
    this.nextFlare -= dt;
    if (this.nextFlare <= 0 && !this.still) {
      this.flares.push({ x: w * (0.15 + this.r() * 0.7), y: h * (0.08 + this.r() * 0.18), vx: (this.r() - 0.5) * 8, t: 0, life: 7 + this.r() * 4, trail: [], hue: this.r() < 0.25 ? 1 : 0 });
      this.nextFlare = 4 + this.r() * 6;
    }
    for (const f of this.flares) {
      f.t += dt;
      f.x += (f.vx + Math.sin(f.t * 0.9) * 4) * dt;
      f.y += (9 + f.t * 0.6) * dt;
      if (f.trail.length === 0 || Math.hypot(f.trail[f.trail.length - 1].x - f.x, f.trail[f.trail.length - 1].y - f.y) > 4) {
        f.trail.push({ x: f.x, y: f.y - 3 });
        if (f.trail.length > 40) f.trail.shift();
      }
      const k = Math.min(1, f.t / 0.4) * Math.max(0, 1 - Math.max(0, f.t - f.life + 2) / 2);
      // 연기 꼬리
      ctx.strokeStyle = `rgba(150,160,170,${(0.12 * k).toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      f.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const flick = 0.85 + Math.sin(t * 31 + f.x) * 0.1 + Math.sin(t * 17) * 0.05;
      const col = f.hue ? '255,90,70' : '255,190,110';
      const big = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 150);
      big.addColorStop(0, `rgba(${col},${(0.22 * k * flick).toFixed(3)})`);
      big.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = big;
      ctx.fillRect(f.x - 150, f.y - 150, 300, 300);
      ctx.fillStyle = `rgba(255,240,215,${(0.95 * k).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    this.flares = this.flares.filter((f) => f.t < f.life && f.y < h);

    // 가운데·앞 능선
    this.drawRidge(1);
    this.drawRidge(2);
    this.drawRidge(3);

    // 안테나 불빛
    if (this.ridges.length === 4) {
      const off = this.ridgeOffset(3);
      const on = Math.sin(t * 2.6) > 0.55;
      if (on) {
        ctx.globalCompositeOperation = 'lighter';
        const mx = this.mast.x + off.x, my = this.mast.y + off.y;
        const rg = ctx.createRadialGradient(mx, my, 0, mx, my, 14);
        rg.addColorStop(0, 'rgba(255,60,50,0.85)');
        rg.addColorStop(1, 'rgba(255,60,50,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(mx - 14, my - 14, 28, 28);
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // 눈
    const wind = -18 - Math.sin(t * 0.13) * 14;
    ctx.fillStyle = '#e6eef6';
    for (const f of this.flakes) {
      f.y += (14 + 46 * f.z) * dt;
      f.x += (wind * f.z + Math.sin(t * 0.8 + f.ph) * 7 * f.z) * dt;
      if (f.y > h + 4) { f.y = -4; f.x = this.r() * w; }
      if (f.x < -6) f.x = w + 6; else if (f.x > w + 6) f.x = -6;
      const sz = 0.5 + f.z * f.z * 2.4;
      ctx.globalAlpha = 0.18 + f.z * 0.55;
      const x = f.x + this.px * f.z * 14, y = f.y + this.py * f.z * 6;
      if (sz < 1.3) ctx.fillRect(x, y, sz, sz);
      else { ctx.beginPath(); ctx.arc(x, y, sz * 0.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    // 낟알
    if (this.grain && this.quality !== 'low') {
      ctx.globalAlpha = 0.035;
      ctx.globalCompositeOperation = 'overlay';
      const ox = Math.floor(this.r() * 96), oy = Math.floor(this.r() * 96);
      ctx.translate(-ox, -oy);
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, 0, w + 96, h + 96);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private ridgeOffset(i: number): { x: number; y: number } {
    const R = this.ridges[i];
    if (!R) return { x: 0, y: 0 };
    const drift = Math.sin(this.time * 0.025 + i) * 22 * R.depth;
    return { x: -90 + drift - this.px * 26 * R.depth, y: -this.py * 8 * R.depth };
  }

  private drawRidge(i: number): void {
    const R = this.ridges[i];
    if (!R) return;
    const o = this.ridgeOffset(i);
    this.ctx.drawImage(R.img, o.x, o.y, R.img.width / this.dpr, R.img.height / this.dpr);
  }
}
