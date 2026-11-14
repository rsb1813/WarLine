// 전장 그리기: 지형, 병사, 차량, 탄, 효과, 지붕, 표식
import { FLAG_R, GADGETS, VEHICLES, VWEAPONS, SEAT_WEAPON } from '../game/defs';
import { CELL, cellOf, WATER } from '../game/grid';
import type { Battle, GEvent, Soldier, Vehicle } from '../game/types';
import { Particles, PK } from './particles';
import { LOOKS, WEAPON_KIND, buildSprites, drawSprite, type Sprites, type WeaponKind } from './sprites';
import { SUN, Terrain } from './terrain';

export type Quality = 'high' | 'medium' | 'low';
export const QUALITY: Record<Quality, { q: number; parts: number; dpr: number; name: string }> = {
  high: { q: 1, parts: 1000, dpr: 2, name: '높음' },
  medium: { q: 0.75, parts: 600, dpr: 1.5, name: '보통' },
  low: { q: 0.5, parts: 300, dpr: 1, name: '낮음' },
};

const IMPACT: Record<string, [string, PK]> = {
  dirt: ['#5a4a38', PK.Dust], snow: ['#e8eef3', PK.Snow], concrete: ['#9a9ea0', PK.Dust],
  wood: ['#7a5a3c', PK.Dust], metal: ['#c9ced2', PK.Spark], water: ['#a8c8dc', PK.Water], spark: ['#ffd27a', PK.Spark],
};
const MAT_DEBRIS = ['#8a8a84', '#7a5e46', '#9da2a5', '#6f7b86', '#9a6450'];

export class Renderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, z: 1 };
  cw = 1;
  ch = 1;
  dpr = 1;
  shake = 0;
  flash = 0;
  sp: Sprites;
  terrain: Terrain;
  parts: Particles;
  quality: Quality;
  colors = ['#4aa8ff', '#ff5d4a'];
  private ro: ResizeObserver;
  private clouds: { x: number; y: number; r: number }[] = [];
  private flakes: { x: number; y: number; z: number }[] = [];
  private emitT = 0;
  private time = 0;
  hideRoof = -1;
  /** 이 플레이어 시점으로 그린다 (null이면 모두 보인다) */
  viewer: Soldier | null = null;

  constructor(public canvas: HTMLCanvasElement, public b: Battle, quality: Quality) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.quality = quality;
    const snowy = b.world.theme !== 'industrial';
    this.sp = buildSprites(snowy);
    this.terrain = new Terrain(b.world, QUALITY[quality].q);
    this.parts = new Particles(QUALITY[quality].parts);
    for (let k = 0; k < 7; k++) this.clouds.push({ x: Math.random() * b.world.w, y: Math.random() * b.world.h, r: 400 + Math.random() * 500 });
    if (snowy) for (let k = 0; k < 140; k++) this.flakes.push({ x: Math.random(), y: Math.random(), z: 0.4 + Math.random() * 0.8 });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  destroy() { this.ro.disconnect(); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(QUALITY[this.quality].dpr, window.devicePixelRatio || 1);
    this.cw = Math.max(1, r.width);
    this.ch = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cw * this.dpr);
    this.canvas.height = Math.round(this.ch * this.dpr);
  }

  /** 기본 배율: 긴 변에 약 1100 단위, 짧은 변에 적어도 640 단위가 보인다 */
  baseZoom() { return Math.min(Math.max(this.cw, this.ch) / 960, Math.min(this.cw, this.ch) / 600); }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.cw / 2) / this.cam.z + this.cam.x, (sy - this.ch / 2) / this.cam.z + this.cam.y];
  }
  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.z + this.cw / 2, (y - this.cam.y) * this.cam.z + this.ch / 2];
  }

  // ───────── 사건을 효과로 ─────────

  handle(e: GEvent) {
    const P = this.parts;
    const R = Math.random;
    switch (e.k) {
      case 'shot': {
        if (!e.supp) P.add(PK.Flash, e.x, e.y, { life: 0.06, s: 14 + e.heavy * 10, alpha: 0.9 });
        if (e.heavy >= 3) {
          P.add(PK.Flash, e.x, e.y, { life: 0.12, s: 70, alpha: 1 });
          for (let k = 0; k < 6; k++) P.add(PK.Dust, e.x + (R() - 0.5) * 30, e.y + (R() - 0.5) * 30, { life: 1.6, s: 18, grow: 26, vx: Math.cos(e.a) * 60 + (R() - 0.5) * 60, vy: Math.sin(e.a) * 60 + (R() - 0.5) * 60, alpha: 0.6 });
          P.add(PK.Ring, e.x, e.y, { life: 0.3, s: 60, col: 'rgba(255,240,200,0.8)' });
        } else if (e.heavy >= 2) {
          for (let k = 0; k < 3; k++) P.add(PK.Smoke, e.x, e.y, { life: 1.2, s: 10, grow: 18, vx: (R() - 0.5) * 40, vy: (R() - 0.5) * 40, alpha: 0.5 });
        }
        break;
      }
      case 'casing':
        P.add(PK.Casing, e.x, e.y, { life: 1.6, s: 2.2, col: '#c8a24a', vx: Math.cos(e.a) * (60 + R() * 40), vy: Math.sin(e.a) * (60 + R() * 40), vz: 90, z: 8, va: 20 });
        break;
      case 'impact': {
        const [col, kind] = IMPACT[e.m] ?? IMPACT.dirt;
        if (kind === PK.Spark) for (let k = 0; k < 4; k++) P.add(PK.Spark, e.x, e.y, { life: 0.18 + R() * 0.15, col: '#ffe1a0', vx: Math.cos(e.a + Math.PI + (R() - 0.5) * 2) * 300, vy: Math.sin(e.a + Math.PI + (R() - 0.5) * 2) * 300 });
        else if (kind === PK.Water) P.add(PK.Water, e.x, e.y, { life: 0.5, s: 7, grow: 14 });
        else if (kind === PK.Snow) P.add(PK.Snow, e.x, e.y, { life: 0.5, s: 6, grow: 16 });
        else P.add(PK.Dust, e.x, e.y, { life: 0.6, s: 5, grow: 18, alpha: 0.7 });
        if (e.m === 'concrete' || e.m === 'wood') for (let k = 0; k < 2; k++) P.add(PK.Debris, e.x, e.y, { life: 1.2, s: 2.5, col, vx: Math.cos(e.a + Math.PI + (R() - 0.5) * 2) * 90, vy: Math.sin(e.a + Math.PI + (R() - 0.5) * 2) * 90, vz: 70 + R() * 60, va: 10 });
        break;
      }
      case 'blood':
        P.add(PK.Blood, e.x + Math.cos(e.a) * 6, e.y + Math.sin(e.a) * 6, { life: 0.4, s: 3.5, vx: Math.cos(e.a) * 40, vy: Math.sin(e.a) * 40 });
        break;
      case 'boom': {
        const big = e.big;
        const n = big ? 8 : 4;
        P.add(PK.Flash, e.x, e.y, { life: big ? 0.25 : 0.16, s: e.r * 1.8, alpha: 1 });
        P.add(PK.Ring, e.x, e.y, { life: 0.35, s: e.r * 1.4, col: 'rgba(255,245,220,0.9)' });
        for (let k = 0; k < n; k++) P.add(PK.Fire, e.x + (R() - 0.5) * e.r * 0.6, e.y + (R() - 0.5) * e.r * 0.6, { life: 0.35 + R() * 0.35, s: e.r * (0.35 + R() * 0.3), grow: 30, alpha: 0.95 });
        for (let k = 0; k < (big ? 5 : 3); k++) P.add(PK.Smoke, e.x + (R() - 0.5) * e.r * 0.6, e.y + (R() - 0.5) * e.r * 0.6, { life: 2 + R() * 2, s: e.r * 0.3, grow: e.r * 0.12, vx: (R() - 0.5) * 40, vy: (R() - 0.5) * 40, alpha: 0.45 });
        for (let k = 0; k < n * 2; k++) { const a = R() * 7, sp = 120 + R() * 220; P.add(PK.Debris, e.x, e.y, { life: 1.5 + R(), s: 2 + R() * 3, col: '#3b3229', vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 120 + R() * 160, va: 12 }); }
        for (let k = 0; k < n; k++) { const a = R() * 7; P.add(PK.Spark, e.x, e.y, { life: 0.3 + R() * 0.3, col: '#ffcf7a', vx: Math.cos(a) * 420, vy: Math.sin(a) * 420 }); }
        const ci = cellOf(this.b.world, e.x, e.y);
        if (ci >= 0 && this.b.world.t[ci] !== WATER) {
          this.terrain.addDecal({ k: 'crater', x: e.x, y: e.y, a: R() * 7, s: Math.min(70, e.r * 0.45) });
          this.terrain.addDecal({ k: 'scorch', x: e.x, y: e.y, a: 0, s: e.r * 0.85 });
        } else if (ci >= 0) for (let k = 0; k < 5; k++) P.add(PK.Water, e.x + (R() - 0.5) * 40, e.y + (R() - 0.5) * 40, { life: 0.9, s: 12, grow: 30 });
        this.bump(e.x, e.y, big ? 1 : 0.55);
        break;
      }
      case 'break': {
        const col = MAT_DEBRIS[e.m] ?? '#888';
        for (let k = 0; k < 9; k++) { const a = R() * 7, sp = 60 + R() * 140; P.add(PK.Debris, e.x, e.y, { life: 2 + R() * 1.5, s: 3 + R() * 4, col, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 100 + R() * 140, va: 8 }); }
        for (let k = 0; k < 3; k++) P.add(PK.Dust, e.x + (R() - 0.5) * 20, e.y + (R() - 0.5) * 20, { life: 2.5, s: 18, grow: 26, alpha: 0.8 });
        break;
      }
      case 'collapse': {
        const bl = this.b.world.buildings[e.b];
        for (let k = 0; k < 18; k++) P.add(PK.Dust, (bl.x + R() * bl.w) * CELL, (bl.y + R() * bl.h) * CELL, { life: 4 + R() * 3, s: 40, grow: 30, alpha: 0.9 });
        for (let k = 0; k < 24; k++) { const a = R() * 7; P.add(PK.Debris, (bl.x + R() * bl.w) * CELL, (bl.y + R() * bl.h) * CELL, { life: 2.5, s: 3 + R() * 5, col: MAT_DEBRIS[bl.mat], vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, vz: 160, va: 6 }); }
        this.terrain.roofs.delete(e.b);
        this.bump((bl.x + bl.w / 2) * CELL, (bl.y + bl.h / 2) * CELL, 1.4);
        break;
      }
      case 'tree':
        for (let k = 0; k < 6; k++) P.add(PK.Debris, e.x + (R() - 0.5) * 30, e.y + (R() - 0.5) * 30, { life: 2, s: 3, col: '#2d5040', vx: (R() - 0.5) * 80, vy: (R() - 0.5) * 80, vz: 60, va: 5 });
        P.add(PK.Snow, e.x, e.y, { life: 1, s: 18, grow: 30 });
        break;
      case 'crush':
        for (let k = 0; k < 4; k++) P.add(PK.Debris, e.x, e.y, { life: 1.2, s: 3, col: '#7a6a4e', vx: (R() - 0.5) * 120, vy: (R() - 0.5) * 120, vz: 60, va: 8 });
        P.add(PK.Dust, e.x, e.y, { life: 1.5, s: 16, grow: 20, alpha: 0.6 });
        break;
      case 'glass':
        for (let k = 0; k < 5; k++) P.add(PK.Glass, e.x, e.y, { life: 1.2, s: 2, col: 'rgba(190,225,245,0.9)', vx: (R() - 0.5) * 120, vy: (R() - 0.5) * 120, vz: 50, va: 12 });
        break;
      case 'vdead':
        for (let k = 0; k < 10; k++) P.add(PK.Fire, e.x + (R() - 0.5) * 40, e.y + (R() - 0.5) * 40, { life: 0.6 + R() * 0.6, s: 40 + R() * 30, grow: 40 });
        for (let k = 0; k < 6; k++) P.add(PK.Dark, e.x + (R() - 0.5) * 50, e.y + (R() - 0.5) * 50, { life: 3 + R() * 2, s: 22, grow: 10, alpha: 0.55 });
        break;
      case 'smoke':
        for (let k = 0; k < 18; k++) { const a = R() * 7, d = R() * e.r * 0.75; P.add(PK.Smoke, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, { life: 13 + R() * 3, s: e.r * 0.32, grow: e.r * 0.04, vx: Math.cos(a) * 12, vy: Math.sin(a) * 12, alpha: 1.5 }); }
        break;
      case 'flare':
        for (let k = 0; k < 8; k++) { const a = R() * 7; P.add(PK.Glow, e.x, e.y, { life: 1.5, s: 18, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, alpha: 1 }); }
        break;
      case 'heal':
        P.add(PK.Ring, e.x, e.y, { life: 0.6, s: 40, col: 'rgba(120,255,170,0.9)' });
        break;
      case 'track':
        this.terrain.addDecal({ k: 'track', x: e.x, y: e.y, a: e.a, s: e.w === 2 ? 17 : e.w === 1 ? 14 : 9 });
        break;
    }
  }

  private bump(x: number, y: number, k: number) {
    const d = Math.hypot(x - this.cam.x, y - this.cam.y);
    if (d < 900) {
      this.shake = Math.max(this.shake, (k * 16 * (1 - d / 900)));
      if (d < 500) this.flash = Math.max(this.flash, 0.12 * k * (1 - d / 500));
    }
  }

  /** 매 프레임: 차량의 연기와 불, 날씨 */
  private ambient(dt: number) {
    this.emitT -= dt;
    if (this.emitT > 0) return;
    this.emitT = 0.08;
    const P = this.parts;
    const R = Math.random;
    for (const v of this.b.vehicles) {
      const d = VEHICLES[v.type];
      if (v.alive) {
        if (v.hp < v.maxHp * 0.55 && R() < 0.4) P.add(PK.Dark, v.x + (R() - 0.5) * 10, v.y + (R() - 0.5) * 10, { life: 1.8, s: 7, grow: 9, alpha: 0.45 });
        if (v.hp < v.maxHp * 0.22) P.add(PK.Fire, v.x + (R() - 0.5) * 16, v.y + (R() - 0.5) * 16, { life: 0.4, s: 16, grow: 10 });
        if (!d.air && Math.abs(v.spd) > 30 && R() < 0.5) {
          const bx = v.x - Math.cos(v.ang) * d.r, by = v.y - Math.sin(v.ang) * d.r;
          P.add(this.terrain.snowy ? PK.Snow : PK.Dust, bx, by, { life: 0.8, s: 8, grow: 22, alpha: 0.5 });
        }
        if (d.air && v.seats[0] >= 0 && R() < 0.4) P.add(this.terrain.snowy ? PK.Snow : PK.Dust, v.x + 40 + (R() - 0.5) * 120, v.y + 55 + (R() - 0.5) * 120, { life: 0.7, s: 10, grow: 26, alpha: 0.35 });
      } else if (v.respawnT > d.respawn - 20 && R() < 0.25) {
        P.add(PK.Dark, v.x + (R() - 0.5) * 20, v.y + (R() - 0.5) * 20, { life: 2.5, s: 10, grow: 10, alpha: 0.4 });
        if (v.respawnT > d.respawn - 10) P.add(PK.Fire, v.x + (R() - 0.5) * 20, v.y + (R() - 0.5) * 20, { life: 0.5, s: 18, grow: 12 });
      }
    }
    for (const p of this.b.proj) {
      if (p.kind === 'rocket' || p.kind === 'missile' || p.kind === 'hrocket') P.add(PK.Smoke, p.x, p.y, { life: 1.2, s: 5, grow: 12, alpha: 0.6 });
    }
  }

  // ───────── 그리기 ─────────

  draw(dt: number) {
    this.time += dt;
    const { ctx, b } = this;
    const w = b.world;
    this.parts.update(dt);
    this.ambient(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1218';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = this.cam.z * this.dpr;
    const sh = this.shake > 0.3 ? this.shake : 0;
    const ox = this.canvas.width / 2 - this.cam.x * z + (Math.random() - 0.5) * sh * this.dpr;
    const oy = this.canvas.height / 2 - this.cam.y * z + (Math.random() - 0.5) * sh * this.dpr;
    this.shake *= Math.pow(0.02, dt);
    ctx.setTransform(z, 0, 0, z, ox, oy);
    const vx0 = this.cam.x - this.cw / 2 / this.cam.z - 60, vx1 = this.cam.x + this.cw / 2 / this.cam.z + 60;
    const vy0 = this.cam.y - this.ch / 2 / this.cam.z - 60, vy1 = this.cam.y + this.ch / 2 / this.cam.z + 60;
    const inView = (x: number, y: number, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
    // 1. 지형
    if (w.changed.length) { this.terrain.touch(w.changed); w.changed.length = 0; }
    ctx.imageSmoothingEnabled = true;
    this.terrain.draw(ctx, vx0, vy0, vx1, vy1, this.time < 1 ? 40 : 2);
    // 2. 거점 영역
    for (const f of b.flags) {
      if (!inView(f.x, f.y, FLAG_R)) continue;
      const col = f.owner >= 0 ? this.colors[f.owner] : '#e8d9a8';
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(f.x, f.y, FLAG_R, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -this.time * 10;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // 3. 땅 위의 물건과 쓰러진 병사
    for (const it of b.items) {
      if (!inView(it.x, it.y) || it.kind === 'drone') continue;
      if (it.team !== 0 && (it.kind === 'mine' || it.kind === 'claymore') && Math.hypot(it.x - this.cam.x, it.y - this.cam.y) > 180) continue;
      this.drawItem(it);
    }
    for (const s of b.soldiers) {
      if (s.state === 0 || !inView(s.x, s.y)) continue;
      if (s.state === 2 && s.deadT > 22) continue;
      if (s.team !== 0 && !s.seen && s.state === 1) continue;
      const alpha = s.state === 2 ? Math.max(0, 1 - s.deadT / 22) * 0.8 : 1;
      ctx.fillStyle = 'rgba(14,22,30,0.25)';
      ctx.beginPath(); ctx.ellipse(s.x + 2, s.y + 3, 13, 8, s.ang, 0, 7); ctx.fill();
      drawSprite(ctx, this.sp.lying[s.team], s.x, s.y, s.ang, alpha);
      if (s.state === 1 && s.team === 0) {
        const pulse = 0.6 + 0.4 * Math.sin(this.time * 6);
        ctx.strokeStyle = `rgba(120,255,170,${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 16, -Math.PI / 2, -Math.PI / 2 + (s.downT / 12) * Math.PI * 2); ctx.stroke();
        if (s.revive > 0) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, 20, -Math.PI / 2, -Math.PI / 2 + s.revive * Math.PI * 2); ctx.stroke(); }
      }
    }
    // 4. 낮은 효과
    this.parts.drawLow(ctx, this.sp, vx0, vy0, vx1, vy1);
    // 5. 지상 차량과 잔해
    for (const v of b.vehicles) {
      if (VEHICLES[v.type].air || !inView(v.x, v.y, 80)) continue;
      if (!v.alive) { if (v.respawnT > VEHICLES[v.type].respawn - 30) drawSprite(ctx, this.sp.veh[`${v.team}${v.type}`].wreck, v.x, v.y, v.ang); continue; }
      if (v.team !== 0 && !v.seen) continue;
      this.drawGround(v);
    }
    // 6. 병사
    for (const s of b.soldiers) {
      if (s.state !== 0 || s.veh >= 0 || !inView(s.x, s.y)) continue;
      if (s.team !== 0 && !s.seen) continue;
      this.drawSoldier(s);
    }
    // 7. 탄과 수류탄
    this.drawProjectiles(vx0, vy0, vx1, vy1);
    for (const g of b.thrown) {
      if (!inView(g.x, g.y)) continue;
      const f = Math.min(1, g.t / g.flight);
      const hgt = Math.sin(f * Math.PI) * 30;
      ctx.fillStyle = 'rgba(14,22,30,0.35)';
      ctx.beginPath(); ctx.arc(g.x + 2, g.y + 3, 3.5, 0, 7); ctx.fill();
      ctx.fillStyle = g.kind === 'frag' ? '#3a4231' : '#8a9096';
      ctx.beginPath(); ctx.arc(g.x, g.y - hgt, 4 + hgt * 0.06, 0, 7); ctx.fill();
      if (g.kind === 'frag' && g.team !== 0 && f >= 1) {
        ctx.strokeStyle = `rgba(255,80,60,${0.5 + 0.5 * Math.sin(this.time * 18)})`;
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, 105, 0, 7); ctx.stroke();
      }
    }
    // 8. 나무 위, 지붕
    this.drawCanopies(vx0, vy0, vx1, vy1);
    this.drawRoofs(vx0, vy0, vx1, vy1);
    // 9. 거점 깃발
    for (const f of b.flags) if (inView(f.x, f.y, 100)) this.drawFlag(f);
    // 10. 높은 효과와 헬기
    this.parts.drawHigh(ctx, this.sp, vx0, vy0, vx1, vy1);
    for (const v of b.vehicles) {
      if (!VEHICLES[v.type].air || !inView(v.x, v.y, 140)) continue;
      if (!v.alive) { if (v.respawnT > VEHICLES[v.type].respawn - 30) drawSprite(ctx, this.sp.veh[`${v.team}heli`].wreck, v.x, v.y, v.ang); continue; }
      if (v.team !== 0 && !v.seen) continue;
      this.drawHeli(v);
    }
    for (const it of b.items) if (it.kind === 'drone' && inView(it.x, it.y)) this.drawDrone(it.x, it.y, it.ang, it.team);
    // 11. 구름 그림자
    for (const c of this.clouds) {
      c.x += 9 * dt; c.y -= 4 * dt;
      if (c.x - c.r > w.w) c.x = -c.r;
      if (c.y + c.r < 0) c.y = w.h + c.r;
      if (!inView(c.x, c.y, c.r)) continue;
      ctx.globalAlpha = 0.1;
      ctx.drawImage(this.sp.dark.c, c.x - c.r, c.y - c.r * 0.7, c.r * 2, c.r * 1.4);
    }
    ctx.globalAlpha = 1;
    // 12. 표식
    this.drawMarkers(inView);
    // 화면 공간: 눈, 섬광
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.flakes.length) {
      ctx.fillStyle = 'rgba(245,249,252,0.75)';
      for (const f of this.flakes) {
        f.x += (0.012 + f.z * 0.01) * dt; f.y += (0.03 + f.z * 0.03) * dt;
        if (f.y > 1) { f.y = 0; f.x = Math.random(); }
        if (f.x > 1) f.x = 0;
        const px = ((f.x - this.cam.x * 0.00006 * f.z) % 1 + 1) % 1 * this.cw, py = ((f.y - this.cam.y * 0.00006 * f.z) % 1 + 1) % 1 * this.ch;
        ctx.globalAlpha = 0.3 + f.z * 0.4;
        ctx.beginPath(); ctx.arc(px, py, f.z * 1.6, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0.005) {
      ctx.fillStyle = `rgba(255,236,200,${this.flash})`;
      ctx.fillRect(0, 0, this.cw, this.ch);
      this.flash *= Math.pow(0.0005, dt);
    }
  }

  private drawItem(it: Battle['items'][number]) {
    const ctx = this.ctx;
    const col = this.colors[it.team];
    ctx.save();
    ctx.translate(it.x, it.y);
    switch (it.kind) {
      case 'medbag': case 'ammobox': {
        ctx.fillStyle = 'rgba(14,22,30,0.3)'; ctx.fillRect(-6, -4, 15, 11);
        ctx.fillStyle = it.kind === 'medbag' ? '#e4e6e1' : '#56603f';
        ctx.fillRect(-8, -6, 15, 11);
        ctx.fillStyle = it.kind === 'medbag' ? '#d23a32' : '#d8c27a';
        if (it.kind === 'medbag') { ctx.fillRect(-2, -4, 3, 7); ctx.fillRect(-5, -1, 9, 3); } else ctx.fillRect(-6, -3, 11, 2);
        ctx.strokeStyle = it.kind === 'medbag' ? 'rgba(120,255,170,0.5)' : 'rgba(255,220,120,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 16 + 6 * Math.sin(this.time * 3), 0, 7); ctx.stroke();
        break;
      }
      case 'mine': ctx.fillStyle = '#3d4434'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill(); break;
      case 'claymore': ctx.rotate(it.ang); ctx.fillStyle = '#4c5640'; ctx.fillRect(-3, -7, 5, 14); if (it.team === 0) { ctx.fillStyle = 'rgba(120,200,255,0.1)'; ctx.beginPath(); ctx.moveTo(2, 0); ctx.arc(2, 0, 70, -0.8, 0.8); ctx.fill(); } break;
      case 'beacon': ctx.fillStyle = '#2f3438'; ctx.fillRect(-4, -4, 8, 8); ctx.fillStyle = Math.sin(this.time * 8) > 0 ? col : '#555'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill(); break;
      case 'sensor': ctx.fillStyle = '#2f3438'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill(); ctx.strokeStyle = `rgba(255,230,120,${0.3 + 0.3 * Math.sin(this.time * 4)})`; ctx.beginPath(); ctx.arc(0, 0, 290, 0, 7); ctx.stroke(); break;
    }
    ctx.restore();
  }

  private drawDrone(x: number, y: number, a: number, team: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(14,22,30,0.3)'; ctx.beginPath(); ctx.arc(x + 18, y + 24, 7, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.strokeStyle = '#2a2f33'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke();
    ctx.fillStyle = this.colors[team]; ctx.fillRect(-3, -3, 6, 6);
    ctx.fillStyle = 'rgba(40,44,48,0.35)';
    for (const [dx, dy] of [[-7, -7], [7, 7], [7, -7], [-7, 7]]) { ctx.beginPath(); ctx.arc(dx, dy, 4.5, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  private weaponKind(s: Soldier): WeaponKind {
    if (s.held === 1 || s.held === 2) {
      const id = s.held === 1 ? s.kit.ga : s.kit.gb;
      if (id === 'rpg') return 'rpg';
      if (id === 'aa') return 'aa';
      if (id === 'repair') return 'torch';
      if (GADGETS[id].use === 'aimed') return 'ugl';
    }
    return WEAPON_KIND[s.ws.kind] ?? 'ar';
  }

  private drawSoldier(s: Soldier) {
    const ctx = this.ctx;
    const b = this.b;
    const me = s === b.player;
    const squad = s.team === 0 && s.squad === b.player.squad && !me;
    // 그림자와 진영 고리
    ctx.fillStyle = 'rgba(14,22,30,0.3)';
    ctx.beginPath(); ctx.ellipse(s.x + 2.5, s.y + 3.5, 10, 8, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = me ? 'rgba(255,255,255,0.9)' : squad ? 'rgba(120,255,170,0.85)' : s.team === 0 ? 'rgba(74,168,255,0.55)' : 'rgba(255,93,74,0.75)';
    ctx.lineWidth = me ? 2 : 1.6;
    ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, 7); ctx.stroke();
    if (s.protect > 0 && Math.sin(this.time * 24) > 0) ctx.globalAlpha = 0.55;
    // 다리
    const moving = Math.hypot(s.vx, s.vy) > 15;
    if (moving) {
      const ph = Math.sin(s.walk * 3.2);
      const la = s.legAng;
      ctx.fillStyle = '#26282a';
      for (const side of [-1, 1]) {
        const off = ph * side * 5;
        const px = s.x + Math.cos(la) * off + Math.cos(la + Math.PI / 2) * side * 3.5;
        const py = s.y + Math.sin(la) * off + Math.sin(la + Math.PI / 2) * side * 3.5;
        ctx.beginPath(); ctx.ellipse(px, py, 3.4, 2.2, la, 0, 7); ctx.fill();
      }
    }
    // 무기, 몸
    const wk = this.weaponKind(s);
    const recoil = b.time - s.lastShotT < 0.06 ? -1.5 : 0;
    const sc = s.crouch ? 0.9 : 1;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.ang);
    ctx.scale(sc, sc);
    const ws = this.sp.weapons[wk];
    ctx.drawImage(ws.c, -ws.cx + 3 + recoil, -ws.cy - 0.6, ws.w, ws.h);
    const bs = this.sp.body[`${s.team}${s.cls}`];
    ctx.drawImage(bs.c, -bs.cx, -bs.cy, bs.w, bs.h);
    ctx.restore();
    ctx.globalAlpha = 1;
    // 총구 섬광
    if (b.time - s.lastShotT < 0.05 && !s.ws.supp && s.held === 0) {
      const mx = s.x + Math.cos(s.ang) * (ws.w - ws.cx + 3), my = s.y + Math.sin(s.ang) * (ws.w - ws.cx + 3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,220,140,0.9)';
      ctx.save(); ctx.translate(mx, my); ctx.rotate(s.ang);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, -3); ctx.lineTo(14, 0); ctx.lineTo(9, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
    // 저격 조준경 반짝임
    if (s.team !== 0 && s.ads && s.ws.scope && Math.sin(this.time * 5 + s.id) > 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.sp.glow.c, s.x + Math.cos(s.ang) * 10 - 10, s.y + Math.sin(s.ang) * 10 - 10, 20, 20);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawGround(v: Vehicle) {
    const ctx = this.ctx;
    const d = VEHICLES[v.type];
    const vs = this.sp.veh[`${v.team}${v.type}`];
    const mine = v.seats.includes(this.b.player.id);
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.fillStyle = 'rgba(14,22,30,0.32)';
    ctx.save(); ctx.translate(SUN.x * 0.7, SUN.y * 0.7); ctx.rotate(v.ang);
    ctx.beginPath(); ctx.roundRect(-d.r * 1.15, -d.r * 0.8, d.r * 2.3, d.r * 1.6, 6); ctx.fill();
    ctx.restore();
    ctx.rotate(v.ang);
    if (vs.tracks) { const tr = vs.tracks[Math.floor(Math.abs(v.track + v.x * 0.05 + v.y * 0.05) / 3) % 4]; ctx.drawImage(tr.c, -tr.cx, -tr.cy, tr.w, tr.h); }
    ctx.drawImage(vs.hull.c, -vs.hull.cx, -vs.hull.cy, vs.hull.w, vs.hull.h);
    if (mine) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.strokeRect(-d.r * 1.15, -d.r * 0.82, d.r * 2.3, d.r * 1.64); }
    ctx.restore();
    if (vs.turret) {
      const W = VWEAPONS[SEAT_WEAPON[v.type][0]!];
      const since = 60 / W.rpm - v.fireT[0];
      const rc = since < 0.15 && v.reloadT[0] <= 0 ? -5 * (1 - since / 0.15) : v.mag[0] < W.mag && v.reloadT[0] > W.reload - 0.15 ? -5 : 0;
      ctx.save(); ctx.translate(v.x - Math.cos(v.ang) * (v.type === 'tank' ? 4 : 2), v.y - Math.sin(v.ang) * (v.type === 'tank' ? 4 : 2)); ctx.rotate(v.tang);
      ctx.fillStyle = 'rgba(14,22,30,0.25)'; ctx.fillRect(4, 3, 30, 6);
      ctx.drawImage(vs.barrel!.c, -vs.barrel!.cx + 6 + rc, -vs.barrel!.cy, vs.barrel!.w, vs.barrel!.h);
      ctx.drawImage(vs.turret.c, -vs.turret.cx, -vs.turret.cy, vs.turret.w, vs.turret.h);
      if (v.type === 'tank' && vs.gun2) { ctx.rotate(v.tang2 - v.tang); ctx.drawImage(vs.gun2.c, -vs.gun2.cx - 2, -vs.gun2.cy + 0, vs.gun2.w, vs.gun2.h); }
      ctx.restore();
    } else if (vs.gun2) {
      ctx.save(); ctx.translate(v.x - Math.cos(v.ang) * 6, v.y - Math.sin(v.ang) * 6); ctx.rotate(v.tang2);
      ctx.drawImage(vs.gun2.c, -vs.gun2.cx, -vs.gun2.cy, vs.gun2.w, vs.gun2.h);
      ctx.restore();
    }
    if (v.team !== 0 || !mine) this.hpBar(v.x, v.y - d.r - 14, v.hp / v.maxHp, this.colors[v.team], 40);
  }

  private drawHeli(v: Vehicle) {
    const ctx = this.ctx;
    const vs = this.sp.veh[`${v.team}heli`];
    const alt = 1;
    ctx.globalAlpha = 0.3;
    ctx.save(); ctx.translate(v.x + 42 * alt, v.y + 56 * alt); ctx.rotate(v.ang); ctx.scale(0.9, 0.9);
    ctx.filter = 'none';
    ctx.drawImage(vs.hull.c, -vs.hull.cx, -vs.hull.cy, vs.hull.w, vs.hull.h);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.ang); ctx.scale(1.08, 1.08);
    ctx.drawImage(vs.hull.c, -vs.hull.cx, -vs.hull.cy, vs.hull.w, vs.hull.h);
    if (vs.gun2) { ctx.save(); ctx.translate(20, 0); ctx.rotate(v.tang2 - v.ang); ctx.drawImage(vs.gun2.c, -vs.gun2.cx, -vs.gun2.cy, vs.gun2.w, vs.gun2.h); ctx.restore(); }
    ctx.rotate(v.rotor);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(vs.rotor!.c, -vs.rotor!.cx, -vs.rotor!.cy, vs.rotor!.w, vs.rotor!.h);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (!v.seats.includes(this.b.player.id)) this.hpBar(v.x, v.y - 48, v.hp / v.maxHp, this.colors[v.team], 44);
  }

  private hpBar(x: number, y: number, f: number, col: string, wdt: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - wdt / 2, y, wdt, 4);
    ctx.fillStyle = f > 0.5 ? col : f > 0.25 ? '#f5b74e' : '#ff6b5e';
    ctx.fillRect(x - wdt / 2, y, wdt * Math.max(0, f), 4);
  }

  private drawProjectiles(x0: number, y0: number, x1: number, y1: number) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.b.proj) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const ux = p.vx / sp, uy = p.vy / sp;
      if (p.kind === 'bullet' || p.kind === 'hmg' || p.kind === 'cannon') {
        const len = p.kind === 'bullet' ? 26 : 34;
        const col = p.team === 0 ? '255,236,170' : '255,190,140';
        ctx.strokeStyle = `rgba(${col},0.25)`;
        ctx.lineWidth = p.kind === 'bullet' ? 4 : 6;
        ctx.beginPath(); ctx.moveTo(p.x - ux * len, p.y - uy * len); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.strokeStyle = `rgba(${col},0.95)`;
        ctx.lineWidth = p.kind === 'bullet' ? 1.4 : 2.4;
        ctx.beginPath(); ctx.moveTo(p.x - ux * len * 0.7, p.y - uy * len * 0.7); ctx.lineTo(p.x, p.y); ctx.stroke();
      } else if (p.kind === 'shell') {
        ctx.strokeStyle = 'rgba(255,240,200,0.9)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x - ux * 50, p.y - uy * 50); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.drawImage(this.sp.glow.c, p.x - 14, p.y - 14, 28, 28);
      } else if (p.kind === 'smokegl' || p.kind === 'gl') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#3a3f33'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
      } else {
        ctx.drawImage(this.sp.glow.c, p.x - ux * 10 - 12, p.y - uy * 10 - 12, 24, 24);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = p.kind === 'missile' ? '#e8eaec' : '#5b6150'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x - ux * 10, p.y - uy * 10); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawCanopies(x0: number, y0: number, x1: number, y1: number) {
    const ctx = this.ctx;
    const w = this.b.world;
    const p = this.b.player;
    const px = p.x, py = p.y;
    const cx0 = Math.max(0, Math.floor(x0 / CELL) - 1), cx1 = Math.min(w.cw - 1, Math.floor(x1 / CELL) + 1);
    const cy0 = Math.max(0, Math.floor(y0 / CELL) - 1), cy1 = Math.min(w.ch - 1, Math.floor(y1 / CELL) + 1);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const i = y * w.cw + x;
      if (w.t[i] !== 5) continue;
      const h = w.vis[i];
      const tx = (x + 0.5) * CELL, ty = (y + 0.5) * CELL;
      const d2 = (tx - px) ** 2 + (ty - py) ** 2;
      const sprite = h % 5 === 0 ? this.sp.birches[h % 3] : this.sp.pines[h % 4];
      const sway = Math.sin(this.time * 0.8 + i) * 0.04;
      ctx.globalAlpha = p.state === 0 && d2 < 70 * 70 ? 0.35 : 0.95;
      const s = 0.85 + (h % 7) * 0.05;
      drawSprite(ctx, sprite, tx, ty, (h / 255) * 6 + sway, 1, s);
    }
    ctx.globalAlpha = 1;
  }

  private drawRoofs(x0: number, y0: number, x1: number, y1: number) {
    const ctx = this.ctx;
    const w = this.b.world;
    const p = this.b.player;
    const ci = p.state !== 2 ? cellOf(w, p.x, p.y) : -1;
    const inside = ci >= 0 && p.veh < 0 ? w.bld[ci] : -1;
    for (const bl of w.buildings) {
      const bx = bl.x * CELL, by = bl.y * CELL, bw = bl.w * CELL, bh = bl.h * CELL;
      if (bx > x1 || by > y1 || bx + bw < x0 || by + bh < y0 || bl.collapsed) continue;
      const c = this.terrain.roof(bl);
      ctx.globalAlpha = bl.id === inside ? 0.12 : 1;
      ctx.drawImage(c, bx - 2, by - 3, bw, bh);
    }
    ctx.globalAlpha = 1;
    // 안테나
    for (const d of w.decor) {
      if (d.k !== 'antenna' || d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) continue;
      ctx.strokeStyle = 'rgba(14,22,30,0.3)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + SUN.x * 6, d.y + SUN.y * 6); ctx.stroke();
      ctx.fillStyle = '#5c646b'; ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, 7); ctx.fill();
      ctx.strokeStyle = '#9aa3aa'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(d.x - 12, d.y); ctx.lineTo(d.x + 12, d.y); ctx.moveTo(d.x, d.y - 12); ctx.lineTo(d.x, d.y + 12); ctx.stroke();
      ctx.fillStyle = Math.sin(this.time * 3) > 0 ? '#ff4a3a' : '#552222'; ctx.beginPath(); ctx.arc(d.x, d.y, 2.5, 0, 7); ctx.fill();
    }
  }

  private drawFlag(f: Battle['flags'][number]) {
    const ctx = this.ctx;
    const col = f.owner >= 0 ? this.colors[f.owner] : '#d9d2bd';
    ctx.strokeStyle = 'rgba(14,22,30,0.3)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + SUN.x * 4, f.y + SUN.y * 4); ctx.stroke();
    ctx.fillStyle = '#c9ced2'; ctx.beginPath(); ctx.arc(f.x, f.y, 4, 0, 7); ctx.fill();
    // 깃발 천
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    for (let k = 0; k <= 8; k++) { const t = k / 8; ctx.lineTo(f.x + t * 34, f.y - 2 + Math.sin(this.time * 5 - t * 4) * 3 * t); }
    for (let k = 8; k >= 0; k--) { const t = k / 8; ctx.lineTo(f.x + t * 34, f.y + 16 + Math.sin(this.time * 5 - t * 4) * 3 * t); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    // 진행 고리와 글자
    ctx.fillStyle = 'rgba(8,13,18,0.85)';
    ctx.beginPath(); ctx.arc(f.x, f.y - 34, 15, 0, 7); ctx.fill();
    if (f.prog !== 0) {
      ctx.strokeStyle = this.colors[f.prog < 0 ? 0 : 1]; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(f.x, f.y - 34, 15, -Math.PI / 2, -Math.PI / 2 + Math.abs(f.prog) * Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.font = '800 18px "Saira Condensed", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(f.tag, f.x, f.y - 33);
  }

  private drawMarkers(inView: (x: number, y: number, m?: number) => boolean) {
    const ctx = this.ctx;
    const b = this.b;
    const pl = b.player;
    const w = b.world;
    const s1 = 1 / Math.max(0.6, this.cam.z);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const s of b.soldiers) {
      if (s.state === 2 || s === pl) continue;
      const v = s.veh >= 0 ? b.vehicles[s.veh] : null;
      const x = v ? v.x : s.x, y = v ? v.y : s.y;
      if (!inView(x, y, 40)) continue;
      if (s.team === 0 && s.squad === pl.squad) {
        if (v && s.seat !== 0) continue;
        // 분대원: 초록 표식과 이름
        ctx.fillStyle = s.state === 1 ? '#7dffb0' : '#7dffb0';
        ctx.beginPath(); ctx.moveTo(x, y - 18 * s1 - 4); ctx.lineTo(x - 5 * s1, y - 27 * s1 - 4); ctx.lineTo(x + 5 * s1, y - 27 * s1 - 4); ctx.closePath(); ctx.fill();
        ctx.font = `600 ${11 * s1}px "IBM Plex Sans KR", sans-serif`;
        ctx.fillStyle = 'rgba(8,13,18,0.75)';
        const tw = ctx.measureText(s.name).width;
        ctx.fillRect(x - tw / 2 - 3, y - 41 * s1 - 4, tw + 6, 13 * s1);
        ctx.fillStyle = '#c8ffd9';
        ctx.fillText(s.name, x, y - 29 * s1 - 4);
        if (s.state === 1) { ctx.fillStyle = '#ffffff'; ctx.font = `800 ${16 * s1}px sans-serif`; ctx.fillText('+', x, y - 10); }
      } else if (s.team === 1 && s.state === 0 && s.spotT > 0 && (!s.seen || Math.hypot(x - pl.x, y - pl.y) > 320 || w.roof[cellOf(w, x, y)])) {
        // 표시된 적: 지붕 위로도 보이는 빨간 마름모
        const k = 4.5 * s1;
        ctx.fillStyle = 'rgba(255,93,74,0.9)';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - 18 * s1 - k * 2); ctx.lineTo(x + k, y - 18 * s1 - k); ctx.lineTo(x, y - 18 * s1); ctx.lineTo(x - k, y - 18 * s1 - k); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    for (const v of b.vehicles) {
      if (!v.alive || v.team === 0 || !inView(v.x, v.y, 60)) continue;
      if (v.mapT <= 0) continue;
      const k = 8 * s1, y = v.y - VEHICLES[v.type].r - 20;
      ctx.fillStyle = '#ff5d4a';
      ctx.beginPath(); ctx.moveTo(v.x, y - k * 2); ctx.lineTo(v.x + k, y - k); ctx.lineTo(v.x, y); ctx.lineTo(v.x - k, y - k); ctx.closePath(); ctx.fill();
    }
    // 대공 미사일 조준
    if (pl.state === 0 && pl.held === 1 && pl.kit.ga === 'aa' && pl.lockId >= 0) {
      const v = b.vehicles[pl.lockId];
      const f = Math.min(1, pl.lockT);
      ctx.strokeStyle = f >= 1 ? '#ff4a3a' : '#ffd27a';
      ctx.lineWidth = 2.5;
      const r = 50 - 16 * f;
      ctx.strokeRect(v.x - r, v.y - r, r * 2, r * 2);
      if (f >= 1) { ctx.font = '700 14px "IBM Plex Sans KR"'; ctx.fillStyle = '#ff4a3a'; ctx.fillText('잠김', v.x, v.y - r - 4); }
    }
    // 아군이 놓은 의무 가방과 탄약 상자 아이콘은 drawItem에서
    void LOOKS;
  }
}
