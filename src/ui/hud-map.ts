// 지도 그림: 세계를 한 번 그려 두고(지형 음영·지면 종류·물·도로·건물·나무), 미니맵·큰 지도·배치 지도가 함께 쓴다.
import type { Box, Game, SpawnOption, VehicleType, World } from '../types';
import { groundTypeAt, heightAt } from '../world';
import { flagLetter, ownerColor, palette } from './hud-util';

export interface MapImage { canvas: HTMLCanvasElement; base: HTMLCanvasElement; n: number; size: number; collapseSeen: number }
const cache = new WeakMap<World, MapImage>();

/** 0 눈, 1 툰드라, 2 흙, 3 아스팔트, 4 콘크리트, 5 자갈 — 어두운 작전 지도 색 */
const GROUND: [number, number, number][] = [
  [116, 126, 136], [76, 88, 70], [88, 77, 64], [50, 54, 59], [92, 96, 102], [101, 96, 86],
];
const BLD_COLOR: Record<string, string> = {
  house: '#9aa3ab', apartment: '#aab2b9', warehouse: '#8c949c', office: '#b1b8bf', shed: '#868d94', tower: '#bdc3c9',
};

export function mapImage(w: World): MapImage {
  let m = cache.get(w);
  if (!m) {
    const n = Math.max(512, Math.min(1024, Math.round(w.size * 1.5)));
    const base = buildBase(w, n);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    m = { canvas, base, n, size: w.size, collapseSeen: -1 };
    cache.set(w, m);
  }
  if (m.collapseSeen !== w.collapseLog.length) { compose(w, m); m.collapseSeen = w.collapseLog.length; }
  return m;
}

function buildBase(w: World, n: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(n, n);
  const d = img.data;
  const mpp = w.size / n;
  const H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = (j + 0.5) * mpp;
    for (let i = 0; i < n; i++) H[j * n + i] = heightAt(w, (i + 0.5) * mpp, z);
  }
  // 북서쪽 위에서 오는 빛
  const ll = Math.hypot(0.55, 1, 0.55), lx = -0.55 / ll, ly = 1 / ll, lz = -0.55 / ll;
  const water = w.water;
  let seed = 1234567;
  for (let j = 0; j < n; j++) {
    const z = (j + 0.5) * mpp;
    const ju = j > 0 ? j - 1 : j, jd = j < n - 1 ? j + 1 : j;
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const h = H[k];
      const il = i > 0 ? i - 1 : i, ir = i < n - 1 ? i + 1 : i;
      const hl = H[j * n + il], hr = H[j * n + ir], hu = H[ju * n + i], hd = H[jd * n + i];
      const gx = (hr - hl) / (2 * mpp), gz = (hd - hu) / (2 * mpp);
      const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      const dl = (-gx * lx + ly - gz * lz) * inv;
      let shade = 1 + (dl - ly) * 1.7;
      shade = shade < 0.5 ? 0.5 : shade > 1.4 ? 1.4 : shade;
      // 등고선 5m, 25m 마다 진하게
      const c0 = Math.floor(h / 5);
      if (Math.floor(hl / 5) !== c0 || Math.floor(hu / 5) !== c0) shade *= c0 % 5 === 0 ? 0.8 : 0.9;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = ((seed >> 16) & 15) - 7.5;
      let r: number, g: number, b: number;
      if (h < water) {
        const dep = Math.min(1, (water - h) / 6);
        r = 34 - dep * 18; g = 70 - dep * 34; b = 94 - dep * 38;
        if (water - h < 0.35) { r += 22; g += 26; b += 26; }
        r += noise * 0.3; g += noise * 0.3; b += noise * 0.3;
      } else {
        const gt = groundTypeAt(w, (i + 0.5) * mpp, z);
        const col = GROUND[gt] ?? GROUND[1];
        r = col[0] * shade + noise; g = col[1] * shade + noise; b = col[2] * shade + noise;
      }
      const o = k * 4;
      d[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function boxGetter(w: World): (id: number) => Box | undefined {
  let map: Map<number, Box> | null = null;
  return (id: number) => {
    const b = w.boxes[id];
    if (b && b.id === id) return b;
    if (!map) { map = new Map(); for (const x of w.boxes) map.set(x.id, x); }
    return map.get(id);
  };
}

function compose(w: World, m: MapImage): void {
  const ctx = m.canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(m.base, 0, 0);
  const k = m.n / w.size;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const lw = 1 / k;
  // 100m 격자
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let x = 100; x < w.size; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, w.size); ctx.moveTo(0, x); ctx.lineTo(w.size, x); }
  ctx.stroke();
  // 도로
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of [0, 1, 2]) {
    for (const r of w.roads) {
      if (r.pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(r.pts[0][0], r.pts[0][1]);
      for (let i = 1; i < r.pts.length; i++) ctx.lineTo(r.pts[i][0], r.pts[i][1]);
      if (pass === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = r.w + 1.8; ctx.setLineDash([]); }
      else if (pass === 1) { ctx.strokeStyle = '#686d72'; ctx.lineWidth = r.w; ctx.setLineDash([]); }
      else { if (r.w < 6) continue; ctx.strokeStyle = 'rgba(230,226,210,0.22)'; ctx.lineWidth = 0.35; ctx.setLineDash([3, 4]); }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  // 나무
  const getBox = boxGetter(w);
  const treeCol: Record<string, string> = { pine: 'rgba(22,38,27,0.9)', birch: 'rgba(50,64,44,0.85)', dead: 'rgba(70,60,50,0.7)' };
  for (const kind of ['pine', 'birch', 'dead']) {
    ctx.fillStyle = treeCol[kind];
    ctx.beginPath();
    for (const t of w.trees) {
      if (t.kind !== kind) continue;
      if (t.box >= 0) { const b = getBox(t.box); if (b && !b.alive) continue; }
      const r = Math.max(0.9, Math.min(3.2, t.r * 0.9));
      ctx.moveTo(t.x + r, t.z);
      ctx.arc(t.x, t.z, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // 건물 밖 상자 (바위, 컨테이너, 모래주머니, 울타리, 다리, 잔해)
  for (const b of w.boxes) {
    if (!b.alive || b.building >= 0 || b.kind === 'tree') continue;
    let col = '';
    switch (b.kind) {
      case 'rock': col = '#6c6f71'; break;
      case 'container': col = '#7c868f'; break;
      case 'sandbag': col = '#8b7f60'; break;
      case 'fence': col = 'rgba(200,205,210,0.35)'; break;
      case 'bridge': col = '#7f8489'; break;
      case 'rubble': col = '#5a554e'; break;
      case 'cover': case 'prop': col = '#767c83'; break;
      default: col = '#8a9198';
    }
    const wdt = b.max.x - b.min.x, dpt = b.max.z - b.min.z;
    if (b.kind !== 'fence' && b.kind !== 'bridge') { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(b.min.x + 0.6, b.min.z + 0.6, wdt, dpt); }
    ctx.fillStyle = col;
    ctx.fillRect(b.min.x, b.min.z, Math.max(wdt, 0.4), Math.max(dpt, 0.4));
  }
  // 건물: 상자들의 바깥 사각형
  for (const bd of w.buildings) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const id of bd.boxes) {
      const b = getBox(id);
      if (!b || b.kind === 'rubble') continue;
      if (b.min.x < x0) x0 = b.min.x; if (b.min.z < z0) z0 = b.min.z;
      if (b.max.x > x1) x1 = b.max.x; if (b.max.z > z1) z1 = b.max.z;
    }
    if (!isFinite(x0)) { x0 = bd.x - bd.w / 2; x1 = bd.x + bd.w / 2; z0 = bd.z - bd.d / 2; z1 = bd.z + bd.d / 2; }
    const bw = x1 - x0, bh = z1 - z0;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(x0 + 1.4, z0 + 1.4, bw, bh);
    if (bd.collapsed) {
      ctx.fillStyle = '#4f4a44';
      ctx.fillRect(x0, z0, bw, bh);
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, z0, bw, bh); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let s = -bh; s < bw; s += 2.2) { ctx.moveTo(x0 + s, z0); ctx.lineTo(x0 + s + bh, z1); }
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = BLD_COLOR[bd.style] ?? '#a0a8b0';
      ctx.fillRect(x0, z0, bw, bh);
      ctx.strokeStyle = 'rgba(10,14,18,0.75)'; ctx.lineWidth = 0.55;
      ctx.strokeRect(x0, z0, bw, bh);
      // 지붕 마루 또는 층 표시
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 0.4;
      ctx.beginPath();
      if (bd.style === 'house' || bd.style === 'shed') {
        if (bw > bh) { ctx.moveTo(x0 + 0.8, z0 + bh / 2); ctx.lineTo(x1 - 0.8, z0 + bh / 2); }
        else { ctx.moveTo(x0 + bw / 2, z0 + 0.8); ctx.lineTo(x0 + bw / 2, z1 - 0.8); }
      } else {
        ctx.rect(x0 + 1, z0 + 1, Math.max(0, bw - 2), Math.max(0, bh - 2));
      }
      ctx.stroke();
    }
  }
  // 지도 테두리
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = lw * 2;
  ctx.strokeRect(0, 0, w.size, w.size);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ───────────────────────── 기호 ─────────────────────────

/** 병사 점: ang = 화면 기준 위쪽 0, 시계 방향 + */
export function glyphSoldier(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, color: string, r: number, arrow: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  if (arrow) {
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.9);
    ctx.lineTo(r * 0.95, -r * 0.3);
    ctx.arc(0, 0, r, -0.3, Math.PI + 0.3);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
  ctx.restore();
}

/** 쓰러진 병사: 십자 */
export function glyphDown(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,12,16,0.85)'; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = color; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0);
  ctx.lineWidth = 1.6; ctx.stroke();
  ctx.restore();
}

export function glyphVehicle(ctx: CanvasRenderingContext2D, type: VehicleType, x: number, y: number, hull: number, tur: number, color: string, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.fillStyle = color;
  if (type === 'heli') {
    ctx.rotate(hull);
    ctx.beginPath(); ctx.ellipse(0, -s * 0.1, s * 0.42, s * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, s * 0.4); ctx.lineTo(0, s * 1.3);
    ctx.lineWidth = Math.max(1.5, s * 0.18); ctx.strokeStyle = color; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = color; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(-s * 1.2, -s * 1.1); ctx.lineTo(s * 1.2, s * 0.9); ctx.moveTo(s * 1.2, -s * 1.1); ctx.lineTo(-s * 1.2, s * 0.9); ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    const hw = type === 'mbt' ? 0.62 : type === 'ifv' ? 0.56 : 0.46;
    const hl = type === 'mbt' ? 0.95 : type === 'ifv' ? 0.85 : 0.72;
    ctx.save();
    ctx.rotate(hull);
    ctx.beginPath();
    ctx.rect(-hw * s, -hl * s, hw * 2 * s, hl * 2 * s);
    ctx.fill(); ctx.stroke();
    if (type === 'ltv') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-hw * s * 0.7, -hl * s * 0.55, hw * 1.4 * s, hl * 0.5 * s);
    }
    ctx.restore();
    if (type !== 'ltv') {
      ctx.rotate(tur);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.arc(0, 0, s * (type === 'mbt' ? 0.42 : 0.32), 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * (type === 'mbt' ? 1.6 : 1.2));
      ctx.lineWidth = Math.max(1.4, s * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
    }
  }
  ctx.restore();
}

export function glyphFlag(ctx: CanvasRenderingContext2D, x: number, y: number, letter: string, owner: number, prog: number, s: number, pulse: number): void {
  const col = ownerColor(owner);
  ctx.save();
  ctx.translate(x, y);
  if (pulse > 0) {
    ctx.beginPath();
    const pr = s * (1.25 + pulse * 0.6);
    ctx.moveTo(0, -pr); ctx.lineTo(pr, 0); ctx.lineTo(0, pr); ctx.lineTo(-pr, 0); ctx.closePath();
    ctx.globalAlpha = 0.6 * (1 - pulse);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath();
  ctx.fillStyle = 'rgba(8,12,16,0.88)';
  ctx.fill();
  // 점령 진행: 아래에서 위로 차오름
  const p = Math.abs(prog);
  if (p > 0.01) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = ownerColor(prog > 0 ? 0 : 1);
    ctx.globalAlpha = 0.38;
    ctx.fillRect(-s, s - 2 * s * p, 2 * s, 2 * s * p);
    ctx.restore();
  }
  ctx.lineWidth = Math.max(1.2, s * 0.14);
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.font = `700 ${Math.round(s * 1.05)}px 'Saira Condensed', 'IBM Plex Sans KR', sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 0, s * 0.06);
  ctx.restore();
}

function playerArrow(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, s: number): void {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.15); ctx.lineTo(s * 0.8, s * 0.85); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.8, s * 0.85); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke();
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number, weight = 600): void {
  ctx.font = `${weight} ${size}px 'IBM Plex Sans KR', system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

/** 거점 진행이 바뀌고 있나 (미니맵 깜빡임용) — Hud 가 매 프레임 채운다 */
export const flagActivity: number[] = [];

// ───────────────────────── 미니맵 ─────────────────────────

export class MiniMap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private cssSize = 160;
  private dpr = 1;
  private acc = 1;
  private lastB = 0; private lastX = 0; private lastZ = 0;
  private ro: ResizeObserver | null = null;
  private pt = [0, 0];
  /** 가운데에서 가장자리까지 m */
  range = 110;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mm-canvas';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((ents) => { for (const e of ents) { const w = e.contentRect.width; if (w > 0) { this.cssSize = w; this.acc = 1; } } });
      this.ro.observe(this.canvas);
    }
  }

  dispose(): void { this.ro?.disconnect(); this.canvas.remove(); }

  update(g: Game, bearing: number, hfovHalf: number, dt: number, time: number): void {
    this.acc += dt;
    const p = g.soldiers[g.player];
    const turned = Math.abs(bearing - this.lastB) > 0.035 || Math.hypot(p.pos.x - this.lastX, p.pos.z - this.lastZ) > 1.5;
    if (this.acc < 0.1 && !(turned && this.acc >= 1 / 30)) return;
    this.acc = 0;
    this.lastB = bearing; this.lastX = p.pos.x; this.lastZ = p.pos.z;
    this.draw(g, bearing, hfovHalf, time);
  }

  private draw(g: Game, b: number, hfovHalf: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = this.cssSize;
    const W = Math.max(1, Math.round(S * dpr));
    if (this.canvas.width !== W || this.dpr !== dpr) { this.canvas.width = W; this.canvas.height = W; this.dpr = dpr; }
    const pal = palette();
    const w = g.world;
    const mi = mapImage(w);
    const p = g.soldiers[g.player];
    const veh = p.vehicle >= 0 ? g.vehicles[p.vehicle] : null;
    const px = veh ? veh.pos.x : p.pos.x, pz = veh ? veh.pos.z : p.pos.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, S, S);
    const cx = S / 2, cy = S * 0.56;
    const zoom = (S / 2) / this.range;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-b);
    ctx.scale(zoom, zoom);
    ctx.translate(-px, -pz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mi.canvas, 0, 0, w.size, w.size);
    // 본부
    for (let t = 0; t < 2; t++) {
      const hq = w.hq[t];
      ctx.beginPath(); ctx.arc(hq.x, hq.z, 14, 0, Math.PI * 2);
      ctx.fillStyle = t === 0 ? 'rgba(79,182,255,0.12)' : 'rgba(255,74,61,0.12)'; ctx.fill();
      ctx.lineWidth = 1 / zoom; ctx.strokeStyle = t === 0 ? pal.friend : pal.enemy; ctx.stroke();
    }
    // 거점 범위
    for (const f of g.flags) {
      ctx.beginPath(); ctx.arc(f.pos.x, f.pos.z, f.r, 0, Math.PI * 2);
      ctx.fillStyle = f.owner === 0 ? 'rgba(79,182,255,0.10)' : f.owner === 1 ? 'rgba(255,74,61,0.10)' : 'rgba(232,227,212,0.07)';
      ctx.fill();
      ctx.lineWidth = 1 / zoom; ctx.strokeStyle = ownerColor(f.owner); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // 연막
    ctx.fillStyle = 'rgba(200,205,210,0.18)';
    for (const sm of g.smokes) { ctx.beginPath(); ctx.arc(sm.pos.x, sm.pos.z, sm.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    const cb = Math.cos(b), sb = Math.sin(b);
    const pt = this.pt;
    const toS = (x: number, z: number): number[] => {
      const dx = x - px, dz = z - pz;
      pt[0] = cx + zoom * (dx * cb + dz * sb);
      pt[1] = cy + zoom * (-dx * sb + dz * cb);
      return pt;
    };
    const inside = (x: number, y: number, m: number): boolean => x > -m && y > -m && x < S + m && y < S + m;

    // 시야 부채꼴
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.55);
    grad.addColorStop(0, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, S * 0.55, -Math.PI / 2 - hfovHalf, -Math.PI / 2 + hfovHalf);
    ctx.closePath(); ctx.fill();

    // 차량
    for (const v of g.vehicles) {
      if (!v.alive || v === veh) continue;
      const friendly = v.team === p.team;
      if (!friendly && v.spotT <= 0) continue;
      const s = toS(v.pos.x, v.pos.z);
      if (!inside(s[0], s[1], 10)) continue;
      const hull = -v.yaw - b;
      glyphVehicle(ctx, v.type, s[0], s[1], hull, hull - v.tYaw, friendly ? pal.friend : pal.enemy, v.type === 'heli' ? 5 : 5.5);
    }
    // 병사
    for (const s of g.soldiers) {
      if (s.id === g.player || s.state === 'dead' || s.vehicle >= 0) continue;
      const friendly = s.team === p.team;
      if (!friendly && s.spotT <= 0) continue;
      const q = toS(s.pos.x, s.pos.z);
      if (!inside(q[0], q[1], 6)) continue;
      const sq = friendly && s.squad === p.squad;
      const col = !friendly ? pal.enemy : sq ? pal.squad : pal.friend;
      if (s.state === 'down') { if (friendly) glyphDown(ctx, q[0], q[1], col, 4); continue; }
      glyphSoldier(ctx, q[0], q[1], -s.yaw - b, col, sq ? 3.4 : 2.8, friendly);
    }
    // 거점 (화면 밖이면 가장자리에)
    for (let i = 0; i < g.flags.length; i++) {
      const f = g.flags[i];
      const q = toS(f.pos.x, f.pos.z);
      let x = q[0], y = q[1];
      const m = 10;
      let edge = false;
      if (x < m || y < m || x > S - m || y > S - m) {
        const dx = x - cx, dy = y - cy;
        const tx = dx > 0 ? (S - m - cx) / dx : dx < 0 ? (m - cx) / dx : Infinity;
        const ty = dy > 0 ? (S - m - cy) / dy : dy < 0 ? (m - cy) / dy : Infinity;
        const t = Math.min(tx, ty);
        x = cx + dx * t; y = cy + dy * t; edge = true;
      }
      const act = flagActivity[i] ?? 0;
      const pulse = act > 0 ? (time * 1.6) % 1 : 0;
      ctx.globalAlpha = edge ? 0.75 : 1;
      glyphFlag(ctx, x, y, flagLetter(g, i), f.owner, f.prog, edge ? 6 : 7.5, pulse);
      ctx.globalAlpha = 1;
    }
    // 나
    playerArrow(ctx, cx, cy, veh ? (-veh.yaw - b) : 0, 6);
    // 북쪽 표시
    {
      const dx = -sb, dy = -cb;
      const m = 9;
      const tx = dx > 0 ? (S - m - cx) / dx : dx < 0 ? (m - cx) / dx : Infinity;
      const ty = dy > 0 ? (S - m - cy) / dy : dy < 0 ? (m - cy) / dy : Infinity;
      const t = Math.min(tx, ty);
      const nx = cx + dx * t, ny = cy + dy * t;
      ctx.beginPath(); ctx.arc(nx, ny, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6,9,12,0.9)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,181,46,0.8)'; ctx.stroke();
      ctx.fillStyle = pal.accent;
      ctx.font = `700 9px 'IBM Plex Sans KR', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('북', nx, ny + 0.5);
    }
    // 축척
    ctx.fillStyle = 'rgba(238,242,245,0.6)';
    ctx.font = `600 9px 'Saira Condensed', sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.round(this.range * 2)}M`, S - 5, S - 4);
  }
}

// ───────────────────────── 전체 지도 (큰 지도·배치 화면) ─────────────────────────

export interface TacOpts {
  names: boolean;
  showPlayer: boolean;
  time: number;
  options?: SpawnOption[];
  selected?: number;
  hover?: number;
}

/** 북쪽 위 전체 지도. (x0, y0) 에서 한 변 S px */
export function drawTactical(ctx: CanvasRenderingContext2D, g: Game, x0: number, y0: number, S: number, o: TacOpts): void {
  const pal = palette();
  const w = g.world;
  const mi = mapImage(w);
  const k = S / w.size;
  const p = g.soldiers[g.player];
  const X = (x: number): number => x0 + x * k;
  const Y = (z: number): number => y0 + z * k;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mi.canvas, x0, y0, S, S);
  // 격자 좌표
  ctx.fillStyle = 'rgba(238,242,245,0.35)';
  ctx.font = `600 10px 'Saira Condensed', sans-serif`;
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  for (let i = 0, x = 0; x < w.size - 20; x += 100, i++) ctx.fillText(String.fromCharCode(65 + i), X(x) + 3, y0 + 3);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (let i = 1, z = 100; z < w.size - 20; z += 100, i++) ctx.fillText(String(i + 1), x0 + 3, Y(z) + 3);
  // 본부
  for (let t = 0; t < 2; t++) {
    const hq = w.hq[t];
    const col = t === 0 ? pal.friend : pal.enemy;
    ctx.beginPath(); ctx.arc(X(hq.x), Y(hq.z), Math.max(10, 16 * k), 0, Math.PI * 2);
    ctx.fillStyle = t === 0 ? 'rgba(79,182,255,0.15)' : 'rgba(255,74,61,0.15)'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, t === 0 ? '아군 본부' : '적 본부', X(hq.x), Y(hq.z) + Math.max(10, 16 * k) + 3, col, 11);
  }
  // 거점 범위
  for (const f of g.flags) {
    ctx.beginPath(); ctx.arc(X(f.pos.x), Y(f.pos.z), Math.max(6, f.r * k), 0, Math.PI * 2);
    ctx.fillStyle = f.owner === 0 ? 'rgba(79,182,255,0.14)' : f.owner === 1 ? 'rgba(255,74,61,0.14)' : 'rgba(232,227,212,0.08)';
    ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = ownerColor(f.owner); ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(200,205,210,0.2)';
  for (const sm of g.smokes) { ctx.beginPath(); ctx.arc(X(sm.pos.x), Y(sm.pos.z), sm.r * k, 0, Math.PI * 2); ctx.fill(); }
  // 차량
  const vs = Math.max(4.5, Math.min(8, 3 * k * 2));
  for (const v of g.vehicles) {
    if (!v.alive) continue;
    const friendly = v.team === p.team;
    if (!friendly && v.spotT <= 0) continue;
    glyphVehicle(ctx, v.type, X(v.pos.x), Y(v.pos.z), -v.yaw, -v.yaw - v.tYaw, friendly ? pal.friend : pal.enemy, vs);
  }
  // 병사
  const deployed = !g.playerNeedsDeploy && p.state !== 'dead';
  for (const s of g.soldiers) {
    if (s.state === 'dead' || s.vehicle >= 0) continue;
    if (s.id === g.player && deployed && o.showPlayer) continue;
    if (s.id === g.player && !deployed) continue;
    const friendly = s.team === p.team;
    if (!friendly && s.spotT <= 0) continue;
    const sq = friendly && s.squad === p.squad;
    const col = !friendly ? pal.enemy : sq ? pal.squad : pal.friend;
    if (s.state === 'down') { if (friendly) glyphDown(ctx, X(s.pos.x), Y(s.pos.z), col, 4.5); continue; }
    glyphSoldier(ctx, X(s.pos.x), Y(s.pos.z), -s.yaw, col, sq ? 3.6 : 2.8, friendly);
    if (sq && o.names) label(ctx, s.name, X(s.pos.x), Y(s.pos.z) + 6, pal.squad, 10, 500);
  }
  // 거점
  const fs = Math.max(9, Math.min(15, S / 48));
  for (let i = 0; i < g.flags.length; i++) {
    const f = g.flags[i];
    const act = flagActivity[i] ?? 0;
    glyphFlag(ctx, X(f.pos.x), Y(f.pos.z), flagLetter(g, i), f.owner, f.prog, fs, act > 0 ? (o.time * 1.4) % 1 : 0);
    if (o.names) label(ctx, f.name, X(f.pos.x), Y(f.pos.z) + fs + 4, ownerColor(f.owner), 11);
  }
  // 출현 지점
  if (o.options) {
    for (let i = 0; i < o.options.length; i++) {
      const op = o.options[i];
      const sx = X(op.pos.x), sy = Y(op.pos.z);
      const sel = i === o.selected, hov = i === o.hover;
      drawSpawnMark(ctx, op, sx, sy, sel, hov, o.time, fs);
    }
  }
  // 나
  if (deployed && o.showPlayer) {
    const veh = p.vehicle >= 0 ? g.vehicles[p.vehicle] : null;
    const pp = veh ? veh.pos : p.pos;
    const yaw = veh ? veh.yaw : p.yaw;
    const pr = 9 + 4 * ((o.time * 1.2) % 1);
    ctx.beginPath(); ctx.arc(X(pp.x), Y(pp.z), pr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${(0.6 * (1 - ((o.time * 1.2) % 1))).toFixed(2)})`; ctx.lineWidth = 1.2; ctx.stroke();
    playerArrow(ctx, X(pp.x), Y(pp.z), -yaw, 7);
  }
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, S - 1, S - 1);
}

function drawSpawnMark(ctx: CanvasRenderingContext2D, op: SpawnOption, x: number, y: number, sel: boolean, hov: boolean, time: number, fs: number): void {
  const pal = palette();
  const col = !op.ok ? 'rgba(150,160,170,0.55)' : op.kind === 'squad' || op.kind === 'beacon' ? pal.squad : pal.friend;
  ctx.save();
  ctx.translate(x, y);
  const r = op.kind === 'flag' ? fs + 6 : 11;
  if (sel) {
    const t = (time * 1.3) % 1;
    ctx.beginPath(); ctx.arc(0, 0, r + 4 + t * 8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,181,46,${(0.8 * (1 - t)).toFixed(2)})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 2.2; ctx.stroke();
  } else if (hov) {
    ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (op.kind === 'flag') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
  } else {
    ctx.beginPath();
    if (op.kind === 'hq') ctx.rect(-9, -9, 18, 18);
    else if (op.kind === 'beacon') { ctx.moveTo(0, -11); ctx.lineTo(10, 8); ctx.lineTo(-10, 8); ctx.closePath(); }
    else if (op.kind === 'vehicle') { ctx.rect(-11, -8, 22, 16); }
    else ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,16,0.92)'; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = `700 10px 'IBM Plex Sans KR', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyph = op.kind === 'hq' ? '본' : op.kind === 'beacon' ? '비' : op.kind === 'vehicle' ? '차' : '';
    if (glyph) ctx.fillText(glyph, 0, op.kind === 'beacon' ? 2 : 0.5);
    else {
      ctx.beginPath(); ctx.moveTo(-4.5, -1.5); ctx.lineTo(0, 3); ctx.lineTo(4.5, -1.5);
      ctx.lineWidth = 2; ctx.stroke();
    }
  }
  ctx.restore();
}
