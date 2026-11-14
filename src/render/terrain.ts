// 지형 굽기: 전장을 512 단위 조각으로 나눠 미리 그려 두고, 부서지거나 자국이 생기면 다시 그린다
import {
  BRIDGE, CELL, CONTAINER, DOOR, FENCE, FLOOR, GROUND, M_BRICK, M_CONCRETE, M_METAL, M_WOOD, ROAD, ROCK, RUBBLE, SANDBAG, STUMP,
  TREE, WALL, WATER, WINDOW, WRECK, type Building, type World,
} from '../game/grid';
import { canvas } from './sprites';

export const CHUNK = 512;
const CC = CHUNK / CELL;
export const SUN = { x: 9, y: 12 };

export interface Decal { k: 'crater' | 'scorch' | 'track' | 'stain'; x: number; y: number; a: number; s: number }

const GND: [number, number, number][] = [
  [92, 106, 72], [222, 230, 237], [106, 104, 64], [124, 129, 132], [116, 114, 104], [84, 74, 59],
];
const WALL_COL: Record<number, [string, string, string]> = {
  [M_WOOD]: ['#6e5642', '#856a52', '#4a3a2c'],
  [M_CONCRETE]: ['#8d9295', '#a4a9ac', '#62676a'],
  [M_METAL]: ['#6c7884', '#84909b', '#4b545c'],
  [M_BRICK]: ['#8b5d4b', '#a06f5b', '#5f3e33'],
  0: ['#7a7a76', '#8c8c88', '#555551'],
};
const FLOOR_COL: Record<number, string> = { [M_WOOD]: '#7b6750', [M_CONCRETE]: '#7d8184', [M_METAL]: '#6d7275', [M_BRICK]: '#86705f', 0: '#777' };
export const CONTAINER_COL = ['#8f3d30', '#2f6189', '#3f7041', '#b27b2f', '#6f7175', '#7b416c'];

function hash(i: number): number {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

interface Chunk { c: HTMLCanvasElement; dirty: boolean; used: number }

export class Terrain {
  w: World;
  q: number;
  chunks = new Map<number, Chunk>();
  decals = new Map<number, Decal[]>();
  roofs = new Map<number, HTMLCanvasElement>();
  low: HTMLCanvasElement;
  grain: CanvasPattern | null = null;
  ncx: number;
  ncy: number;
  frame = 0;
  snowy: boolean;

  constructor(w: World, q: number) {
    this.w = w;
    this.q = q;
    this.ncx = Math.ceil(w.w / CHUNK);
    this.ncy = Math.ceil(w.h / CHUNK);
    this.snowy = w.theme !== 'industrial';
    this.low = this.buildLow();
    const g = canvas(128, 128);
    const gx = g.getContext('2d')!;
    const img = gx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = 110 + Math.floor(hash(i + 99) * 145);
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    gx.putImageData(img, 0, 0);
    this.grain = gx.createPattern(g, 'repeat');
  }

  /** 칸 하나를 한 픽셀로 그린 전장 전체 (부드럽게 늘여 바탕으로 쓴다) */
  buildLow(): HTMLCanvasElement {
    const { cw, ch } = this.w;
    const c = canvas(cw, ch);
    const g = c.getContext('2d')!;
    const img = g.createImageData(cw, ch);
    for (let i = 0; i < cw * ch; i++) {
      const [r, gg, bb] = this.baseColor(i);
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = bb; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  baseColor(i: number): [number, number, number] {
    const w = this.w;
    const t = w.t[i];
    if (t === WATER || (t === BRIDGE && !this.landNear(i))) {
      const shore = this.landNear(i) ? 1 : 0;
      return shore ? [52, 88, 108] : [30, 58, 80];
    }
    let c = GND[w.gnd[i]];
    if (w.theme === 'snow' && w.gnd[i] === 0) c = [122, 135, 108];
    const v = 0.95 + hash(i) * 0.1;
    return [c[0] * v, c[1] * v, c[2] * v].map((x) => Math.max(0, Math.min(255, x))) as [number, number, number];
  }

  landNear(i: number): boolean {
    const w = this.w;
    const x = i % w.cw, y = (i - x) / w.cw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.cw || ny >= w.ch) continue;
      const t = w.t[ny * w.cw + nx];
      if (t !== WATER && t !== BRIDGE) return true;
    }
    return false;
  }

  /** 바뀐 칸이 속한 조각을 다시 그리게 한다 */
  touch(cells: number[]) {
    const w = this.w;
    const seen = new Set<number>();
    for (const i of cells) {
      const x = i % w.cw, y = (i - x) / w.cw;
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const kx = Math.floor((x + dx) / CC), ky = Math.floor((y + dy) / CC);
        if (kx < 0 || ky < 0 || kx >= this.ncx || ky >= this.ncy) continue;
        seen.add(ky * this.ncx + kx);
      }
      const t = w.t[i];
      const col = this.lowColor(i, t);
      const lg = this.low.getContext('2d')!;
      lg.fillStyle = col;
      lg.fillRect(x, y, 1, 1);
    }
    for (const k of seen) { const ch = this.chunks.get(k); if (ch) ch.dirty = true; }
  }

  private lowColor(i: number, _t: number): string {
    const [r, g, b] = this.baseColor(i);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  addDecal(d: Decal) {
    const kx = Math.floor(d.x / CHUNK), ky = Math.floor(d.y / CHUNK);
    if (kx < 0 || ky < 0 || kx >= this.ncx || ky >= this.ncy) return;
    const k = ky * this.ncx + kx;
    let list = this.decals.get(k);
    if (!list) { list = []; this.decals.set(k, list); }
    // 같은 자리에 자국이 겹겹이 쌓여 새까맣게 되지 않도록
    if (d.k === 'scorch' || d.k === 'crater') {
      let near = 0;
      for (const o of list) if (o.k === d.k && Math.abs(o.x - d.x) < d.s * 0.7 && Math.abs(o.y - d.y) < d.s * 0.7) near++;
      if (near >= 2) return;
    }
    list.push(d);
    if (list.length > 220) list.splice(0, list.length - 220);
    // 이미 그려 둔 조각에는 바로 덧그린다 (가장자리에 걸치면 이웃 조각도)
    const r = d.s + 8;
    for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = kx + ox, ny = ky + oy;
      if (nx < 0 || ny < 0 || nx >= this.ncx || ny >= this.ncy) continue;
      if (ox || oy) {
        const x0 = nx * CHUNK, y0 = ny * CHUNK;
        if (d.x + r < x0 || d.x - r > x0 + CHUNK || d.y + r < y0 || d.y - r > y0 + CHUNK) continue;
      }
      const ch = this.chunks.get(ny * this.ncx + nx);
      if (!ch || ch.dirty) continue;
      const g = ch.c.getContext('2d')!;
      g.setTransform(this.q, 0, 0, this.q, -nx * CHUNK * this.q, -ny * CHUNK * this.q);
      this.drawDecal(g, d);
    }
  }

  drawDecal(g: CanvasRenderingContext2D, d: Decal) {
    const snow = this.snowy;
    if (d.k === 'track') {
      g.save(); g.translate(d.x, d.y); g.rotate(d.a);
      g.fillStyle = snow ? 'rgba(70,70,64,0.22)' : 'rgba(30,26,20,0.22)';
      const half = d.s;
      const tw = d.s > 10 ? 5 : 3;
      g.fillRect(-8, -half - tw / 2, 16, tw);
      g.fillRect(-8, half - tw / 2, 16, tw);
      g.restore();
    } else if (d.k === 'crater') {
      const gr = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.s);
      gr.addColorStop(0, 'rgba(34,28,22,0.7)');
      gr.addColorStop(0.55, 'rgba(52,42,34,0.45)');
      gr.addColorStop(0.8, 'rgba(70,58,44,0.25)');
      gr.addColorStop(1, 'rgba(70,58,44,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(d.x, d.y, d.s, 0, 7); g.fill();
      g.fillStyle = 'rgba(60,50,40,0.4)';
      for (let k = 0; k < 7; k++) {
        const a = d.a + k * 0.9, r = d.s * (0.8 + hash(k + d.x) * 0.5);
        g.beginPath(); g.arc(d.x + Math.cos(a) * r, d.y + Math.sin(a) * r, 1.5 + hash(k * 3 + d.y) * 2.5, 0, 7); g.fill();
      }
    } else if (d.k === 'scorch') {
      const gr = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.s);
      gr.addColorStop(0, 'rgba(20,18,16,0.42)');
      gr.addColorStop(0.7, 'rgba(24,22,20,0.16)');
      gr.addColorStop(1, 'rgba(20,18,16,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(d.x, d.y, d.s, 0, 7); g.fill();
    } else {
      g.fillStyle = 'rgba(40,36,30,0.35)';
      g.beginPath(); g.ellipse(d.x, d.y, d.s, d.s * 0.6, d.a, 0, 7); g.fill();
    }
  }

  /** 조각 하나를 굽는다 */
  bake(kx: number, ky: number, into?: HTMLCanvasElement): HTMLCanvasElement {
    const w = this.w;
    const q = this.q;
    const c = into ?? canvas(CHUNK * q, CHUNK * q);
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(q, 0, 0, q, -kx * CHUNK * q, -ky * CHUNK * q);
    const x0 = kx * CHUNK, y0 = ky * CHUNK;
    const cx0 = Math.max(0, kx * CC - 2), cy0 = Math.max(0, ky * CC - 2);
    const cx1 = Math.min(w.cw - 1, (kx + 1) * CC + 2), cy1 = Math.min(w.ch - 1, (ky + 1) * CC + 2);
    // 1. 부드러운 바탕
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.low, kx * CC - 1, ky * CC - 1, CC + 2, CC + 2, x0 - CELL + CELL / 2, y0 - CELL + CELL / 2, (CC + 2) * CELL, (CC + 2) * CELL);
    // 2. 결
    if (this.grain) {
      g.save();
      g.globalAlpha = 0.11;
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = this.grain;
      g.fillRect(x0, y0, CHUNK, CHUNK);
      g.restore();
    }
    // 3. 칸 위의 잔무늬 (풀, 눈, 밭고랑, 물결)
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const i = y * w.cw + x;
      const t = w.t[i];
      const px = x * CELL, py = y * CELL;
      const h = hash(i);
      if (t === WATER) {
        g.strokeStyle = 'rgba(160,200,225,0.12)';
        g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(px + h * 18, py + 10 + h * 10); g.quadraticCurveTo(px + 16, py + 6 + h * 8, px + 28, py + 12 + h * 10); g.stroke();
        if (this.snowy && h > 0.86 && !this.landNear(i)) {
          g.fillStyle = 'rgba(215,230,238,0.85)';
          g.beginPath();
          for (let k = 0; k < 6; k++) { const a = k * 1.05 + h * 3, r = 8 + hash(i + k) * 9; g.lineTo(px + 16 + Math.cos(a) * r, py + 16 + Math.sin(a) * r); }
          g.closePath(); g.fill();
        }
        continue;
      }
      const gd = w.gnd[i];
      if (t === GROUND || t === STUMP) {
        if (gd === 0) {
          g.strokeStyle = h > 0.5 ? 'rgba(135,140,80,0.35)' : 'rgba(55,70,45,0.35)';
          g.lineWidth = 1;
          for (let k = 0; k < 3; k++) {
            const tx = px + hash(i * 3 + k) * 30, ty = py + hash(i * 5 + k) * 30;
            g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + 2, ty - 4); g.moveTo(tx + 2, ty); g.lineTo(tx + 4, ty - 3); g.stroke();
          }
        } else if (gd === 1) {
          if (h > 0.7) { g.fillStyle = 'rgba(180,195,210,0.35)'; g.beginPath(); g.ellipse(px + 16, py + 16, 12, 4, h * 3, 0, 7); g.fill(); }
        } else if (gd === 2) {
          g.strokeStyle = 'rgba(70,64,40,0.4)'; g.lineWidth = 2;
          for (let k = 4; k < CELL; k += 8) { g.beginPath(); g.moveTo(px, py + k); g.lineTo(px + CELL, py + k); g.stroke(); }
        } else if (gd === 4 || gd === 5) {
          g.fillStyle = gd === 4 ? 'rgba(150,146,134,0.5)' : 'rgba(60,52,40,0.4)';
          for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(px + hash(i + k * 7) * 32, py + hash(i + k * 11) * 32, 1 + hash(i + k) * 1.5, 0, 7); g.fill(); }
        } else if (gd === 3) {
          // 콘크리트는 가장자리가 번지지 않게 칸마다 또렷하게 깐다
          g.fillStyle = this.lowColor(i, t);
          g.fillRect(px, py, CELL, CELL);
          g.strokeStyle = 'rgba(80,84,86,0.35)'; g.lineWidth = 1;
          g.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
        }
      }
    }
    // 4. 길: 경로를 따라 부드러운 선으로
    this.drawRoads(g, x0, y0);
    // 5. 건물 바닥과 그림자
    const blds = new Set<number>();
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { const bi = w.bld[y * w.cw + x]; if (bi >= 0) blds.add(bi); }
    for (const bi of blds) {
      const b = w.buildings[bi];
      if (!b.collapsed) {
        g.fillStyle = 'rgba(14,22,30,0.32)';
        g.fillRect(b.x * CELL + SUN.x * 1.6, b.y * CELL + SUN.y * 1.6, b.w * CELL, b.h * CELL);
      }
      g.fillStyle = FLOOR_COL[b.mat] ?? '#777';
      g.fillRect(b.x * CELL, b.y * CELL, b.w * CELL, b.h * CELL);
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1;
      if (b.mat === M_WOOD) for (let yy = b.y * CELL + 6; yy < (b.y + b.h) * CELL; yy += 7) { g.beginPath(); g.moveTo(b.x * CELL, yy); g.lineTo((b.x + b.w) * CELL, yy); g.stroke(); }
      else for (let xx = b.x * CELL; xx < (b.x + b.w) * CELL; xx += 16) for (let yy = b.y * CELL; yy < (b.y + b.h) * CELL; yy += 16) g.strokeRect(xx, yy, 16, 16);
    }
    // 6. 자국
    for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
      const list = this.decals.get((ky + oy) * this.ncx + (kx + ox));
      if (list && kx + ox >= 0 && kx + ox < this.ncx && ky + oy >= 0 && ky + oy < this.ncy) for (const d of list) this.drawDecal(g, d);
    }
    // 7. 장애물의 그림자
    g.fillStyle = 'rgba(14,22,30,0.3)';
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const i = y * w.cw + x;
      const t = w.t[i];
      const px = x * CELL, py = y * CELL;
      if (t === CONTAINER || t === ROCK) g.fillRect(px + SUN.x, py + SUN.y, CELL, CELL);
      else if (t === TREE) { g.beginPath(); g.ellipse(px + 16 + SUN.x * 2.2, py + 16 + SUN.y * 2.2, 26, 22, 0, 0, 7); g.fill(); }
      else if (t === SANDBAG || t === WRECK || t === FENCE) g.fillRect(px + 3, py + 4, CELL, CELL * (t === FENCE ? 0.2 : 1));
      else if ((t === WALL || t === WINDOW) && w.bld[i] >= 0 && w.buildings[w.bld[i]].collapsed) g.fillRect(px + 4, py + 5, CELL, CELL);
    }
    // 8. 칸 위의 물체
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const i = y * w.cw + x;
      const t = w.t[i];
      if (t === GROUND || t === ROAD || t === FLOOR || t === WATER) continue;
      this.drawCell(g, i, x, y, t);
    }
    // 9. 장식
    for (const d of w.decor) {
      if (d.x < x0 - 200 || d.x > x0 + CHUNK + 200 || d.y < y0 - 200 || d.y > y0 + CHUNK + 200) continue;
      this.drawDecor(g, d);
    }
    return c;
  }

  private smooth(pts: number[]): number[] {
    if (pts.length <= 4) return pts;
    // 계단 모양 경로를 이동 평균으로 펴고 점을 솎는다
    const n = pts.length / 2;
    const out: number[] = [];
    for (let i = 0; i < n; i += 2) {
      let sx = 0, sy = 0, c = 0;
      for (let k = -3; k <= 3; k++) { const j = Math.max(0, Math.min(n - 1, i + k)); sx += pts[j * 2]; sy += pts[j * 2 + 1]; c++; }
      out.push(i === 0 ? pts[0] : sx / c, i === 0 ? pts[1] : sy / c);
    }
    out.push(pts[pts.length - 2], pts[pts.length - 1]);
    return out;
  }

  private roadCache: { pts: number[]; w: number; street: boolean; x0: number; y0: number; x1: number; y1: number }[] | null = null;

  drawRoads(g: CanvasRenderingContext2D, x0: number, y0: number) {
    if (!this.roadCache) {
      this.roadCache = this.w.roads.map((r) => {
        const pts = r.street ? r.pts : this.smooth(r.pts);
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (let i = 0; i < pts.length; i += 2) { a = Math.min(a, pts[i]); c = Math.max(c, pts[i]); b = Math.min(b, pts[i + 1]); d = Math.max(d, pts[i + 1]); }
        return { pts, w: r.w, street: r.street, x0: a, y0: b, x1: c, y1: d };
      });
    }
    const snow = this.w.theme === 'snow';
    const pad = 80;
    const list = this.roadCache.filter((r) => r.x1 > x0 - pad && r.x0 < x0 + CHUNK + pad && r.y1 > y0 - pad && r.y0 < y0 + CHUNK + pad);
    const plazas = this.w.plazas.filter((p) => p.x + p.r > x0 - pad && p.x - p.r < x0 + CHUNK + pad && p.y + p.r > y0 - pad && p.y - p.r < y0 + CHUNK + pad);
    const path = (r: { pts: number[] }) => {
      g.beginPath();
      const p = r.pts;
      g.moveTo(p[0], p[1]);
      if (p.length <= 4) { g.lineTo(p[2], p[3]); return; }
      for (let i = 2; i < p.length - 2; i += 2) g.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
      g.lineTo(p[p.length - 2], p[p.length - 1]);
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    const layers: [string, number][] = snow
      ? [['rgba(120,128,134,0.25)', 1.5], ['#c6ccd1', 1.0]]
      : [['rgba(120,116,104,0.55)', 1.45], ['#585e63', 1.0]];
    for (const [col, k] of layers) {
      g.strokeStyle = col; g.fillStyle = col;
      for (const r of list) { g.lineWidth = r.w * CELL * k; path(r); g.stroke(); }
      for (const p of plazas) { g.beginPath(); g.arc(p.x, p.y, p.r * (k > 1 ? 1.12 : 1), 0, 7); g.fill(); }
    }
    // 바퀴 자국과 차선
    g.setLineDash(snow ? [] : [18, 22]);
    for (const r of list) {
      if (snow) {
        g.strokeStyle = 'rgba(140,150,158,0.5)'; g.lineWidth = 4;
        for (const off of [-0.22, 0.22]) {
          g.save(); g.translate(off * r.w * CELL * 0.6, off * r.w * CELL * 0.6); path(r); g.stroke(); g.restore();
        }
      } else if (!r.street) {
        g.strokeStyle = 'rgba(225,215,170,0.35)'; g.lineWidth = 2; path(r); g.stroke();
      }
    }
    g.setLineDash([]);
    if (!snow) {
      g.strokeStyle = 'rgba(30,32,34,0.18)'; g.lineWidth = 7;
      for (const r of list) { g.save(); g.translate(5, 0); path(r); g.stroke(); g.restore(); }
    }
  }

  private sameWall(i: number, b: number) {
    const t = this.w.t[i];
    return (t === WALL || t === WINDOW || t === DOOR) && this.w.bld[i] === b;
  }

  drawCell(g: CanvasRenderingContext2D, i: number, x: number, y: number, t: number) {
    const w = this.w;
    const px = x * CELL, py = y * CELL;
    const h = hash(i);
    const nb = (dx: number, dy: number) => {
      const nx = x + dx, ny = y + dy;
      return nx < 0 || ny < 0 || nx >= w.cw || ny >= w.ch ? -1 : ny * w.cw + nx;
    };
    switch (t) {
      case WALL: case WINDOW: {
        const [base, top, edge] = WALL_COL[w.mat[i]] ?? WALL_COL[0];
        g.fillStyle = base;
        g.fillRect(px, py, CELL, CELL);
        g.fillStyle = top;
        g.fillRect(px + 4, py + 4, CELL - 8, CELL - 8);
        g.strokeStyle = edge; g.lineWidth = 2;
        const b = w.bld[i];
        g.beginPath();
        if (!this.sameWall(nb(0, -1), b)) { g.moveTo(px, py + 1); g.lineTo(px + CELL, py + 1); }
        if (!this.sameWall(nb(0, 1), b)) { g.moveTo(px, py + CELL - 1); g.lineTo(px + CELL, py + CELL - 1); }
        if (!this.sameWall(nb(-1, 0), b)) { g.moveTo(px + 1, py); g.lineTo(px + 1, py + CELL); }
        if (!this.sameWall(nb(1, 0), b)) { g.moveTo(px + CELL - 1, py); g.lineTo(px + CELL - 1, py + CELL); }
        g.stroke();
        if (w.mat[i] === M_BRICK) { g.strokeStyle = 'rgba(40,20,15,0.25)'; g.lineWidth = 1; for (let k = 8; k < CELL; k += 8) { g.beginPath(); g.moveTo(px, py + k); g.lineTo(px + CELL, py + k); g.stroke(); } }
        if (t === WINDOW) {
          const horiz = this.sameWall(nb(-1, 0), b) || this.sameWall(nb(1, 0), b);
          const broken = (w.vis[i] & 1) === 1;
          g.fillStyle = broken ? '#1d2328' : 'rgba(150,205,235,0.9)';
          if (horiz) g.fillRect(px + 3, py + 12, CELL - 6, 8); else g.fillRect(px + 12, py + 3, 8, CELL - 6);
          if (!broken) { g.fillStyle = 'rgba(255,255,255,0.6)'; if (horiz) g.fillRect(px + 6, py + 13, 6, 2); else g.fillRect(px + 13, py + 6, 2, 6); }
          else { g.fillStyle = 'rgba(170,215,240,0.7)'; for (let k = 0; k < 3; k++) g.fillRect(px + 6 + hash(i + k) * 20, py + 6 + hash(i * 2 + k) * 20, 2, 2); }
        }
        break;
      }
      case DOOR: {
        const b = w.bld[i];
        const horiz = this.sameWall(nb(-1, 0), b) || this.sameWall(nb(1, 0), b);
        g.fillStyle = FLOOR_COL[w.mat[i]] ?? '#777';
        g.fillRect(px, py, CELL, CELL);
        g.fillStyle = '#4b3a2c';
        g.save(); g.translate(px + (horiz ? 3 : 16), py + (horiz ? 16 : 3)); g.rotate(horiz ? -0.9 : 0.9);
        g.fillRect(0, -2, horiz ? 22 : 2, horiz ? 4 : 22);
        g.restore();
        break;
      }
      case RUBBLE: {
        const m = w.mat[i];
        const [base, top, edge] = WALL_COL[m] ?? WALL_COL[0];
        g.fillStyle = 'rgba(58,54,50,0.35)';
        g.beginPath(); g.ellipse(px + 16, py + 16, 17, 15, h * 3, 0, 7); g.fill();
        g.globalAlpha = 0.85;
        for (let k = 0; k < 9; k++) {
          g.fillStyle = k % 3 === 0 ? top : k % 3 === 1 ? base : edge;
          const cx = px + 3 + hash(i * 7 + k) * 26, cy = py + 3 + hash(i * 13 + k) * 26, r = 1.5 + hash(i + k * 5) * 3.2;
          g.beginPath();
          for (let s2 = 0; s2 < 4; s2++) { const a = s2 * 1.57 + k; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8); }
          g.closePath(); g.fill();
        }
        g.globalAlpha = 1;
        if (m === M_WOOD && h > 0.4) { g.strokeStyle = '#4e3b2b'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(px + 4, py + 6 + h * 20); g.lineTo(px + 28, py + 26 - h * 18); g.stroke(); }
        break;
      }
      case SANDBAG: {
        if (w.vis[i] === 1) {
          g.fillStyle = '#c4a24e'; g.beginPath(); g.arc(px + 16, py + 16, 11, 0, 7); g.fill();
          g.strokeStyle = 'rgba(110,80,30,0.6)'; g.lineWidth = 1.2; g.beginPath(); g.arc(px + 16, py + 16, 7, 0, 7); g.stroke(); g.beginPath(); g.arc(px + 16, py + 16, 11, 0, 7); g.stroke();
          break;
        }
        for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
          g.fillStyle = (r + k) % 2 ? '#a99a6c' : '#9b8c60';
          g.beginPath(); g.roundRect(px + 1 + k * 10 + (r ? 5 : 0) - (r && k === 2 ? 5 : 0), py + 4 + r * 12, 11, 11, 4); g.fill();
          g.strokeStyle = 'rgba(60,50,30,0.5)'; g.lineWidth = 1; g.stroke();
        }
        break;
      }
      case FENCE: {
        g.strokeStyle = '#5b5a52'; g.lineWidth = 1.4;
        g.beginPath();
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const n = nb(dx, dy);
          if (n >= 0 && w.t[n] === FENCE) { g.moveTo(px + 16, py + 16); g.lineTo(px + 16 + dx * 16, py + 16 + dy * 16); }
        }
        g.stroke();
        g.fillStyle = '#4a3c2e'; g.fillRect(px + 14, py + 14, 4, 4);
        break;
      }
      case WRECK: {
        const v = w.vis[i];
        const horiz = (v & 1) === 1;
        const col = ['#4d4a46', '#5a3f35', '#3f4b52', '#58533c'][(v >> 1) & 3];
        g.fillStyle = col;
        g.beginPath(); g.roundRect(px + 3, py + 4, CELL - 6, CELL - 8, 4); g.fill();
        g.fillStyle = 'rgba(20,18,16,0.6)'; g.beginPath(); g.roundRect(px + 9, py + 9, CELL - 18, CELL - 18, 3); g.fill();
        g.fillStyle = 'rgba(120,70,40,0.5)'; g.beginPath(); g.arc(px + 8 + h * 16, py + 10 + h * 10, 4, 0, 7); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(px + 3, py + 4, CELL - 6, CELL - 8);
        void horiz;
        break;
      }
      case CONTAINER: {
        if (w.vis[i] === 255) { g.fillStyle = '#5d6670'; g.fillRect(px, py, CELL, CELL); break; }
        const kind = w.vis[i] & 15, horiz = (w.vis[i] & 16) === 16;
        const col = CONTAINER_COL[kind % CONTAINER_COL.length];
        g.fillStyle = col;
        g.fillRect(px, py, CELL, CELL);
        g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.5;
        g.beginPath();
        for (let k = 3; k < CELL; k += 5) { if (horiz) { g.moveTo(px + k, py + 1); g.lineTo(px + k, py + CELL - 1); } else { g.moveTo(px + 1, py + k); g.lineTo(px + CELL - 1, py + k); } }
        g.stroke();
        g.strokeStyle = 'rgba(15,15,15,0.7)'; g.lineWidth = 2;
        g.beginPath();
        const same = (n: number) => n >= 0 && w.t[n] === CONTAINER && (w.vis[n] & 31) === (w.vis[i] & 31);
        if (!same(nb(0, -1))) { g.moveTo(px, py + 1); g.lineTo(px + CELL, py + 1); }
        if (!same(nb(0, 1))) { g.moveTo(px, py + CELL - 1); g.lineTo(px + CELL, py + CELL - 1); }
        if (!same(nb(-1, 0))) { g.moveTo(px + 1, py); g.lineTo(px + 1, py + CELL); }
        if (!same(nb(1, 0))) { g.moveTo(px + CELL - 1, py); g.lineTo(px + CELL - 1, py + CELL); }
        g.stroke();
        break;
      }
      case ROCK: {
        g.fillStyle = '#6b7279';
        g.beginPath();
        for (let k = 0; k < 7; k++) { const a = k * 0.9 + h * 2, r = 13 + hash(i + k) * 6; g.lineTo(px + 16 + Math.cos(a) * r, py + 16 + Math.sin(a) * r); }
        g.closePath(); g.fill();
        g.fillStyle = '#858d94';
        g.beginPath(); g.ellipse(px + 13, py + 12, 8, 6, h, 0, 7); g.fill();
        if (this.snowy) { g.fillStyle = 'rgba(235,242,248,0.7)'; g.beginPath(); g.ellipse(px + 12, py + 11, 5, 3.5, h, 0, 7); g.fill(); }
        break;
      }
      case TREE: {
        g.fillStyle = '#3b2e24'; g.beginPath(); g.arc(px + 16, py + 16, 6, 0, 7); g.fill();
        break;
      }
      case STUMP: {
        g.fillStyle = '#5a4634'; g.beginPath(); g.arc(px + 16, py + 16, 5.5, 0, 7); g.fill();
        g.fillStyle = '#9c7f5c'; g.beginPath(); g.arc(px + 16, py + 16, 3.5, 0, 7); g.fill();
        g.save(); g.translate(px + 16, py + 16); g.rotate(h * Math.PI * 2);
        g.fillStyle = '#4c3b2c'; g.fillRect(6, -3.5, 40, 7);
        g.fillStyle = h > 0.5 ? '#2a4a3c' : '#5e6d34'; g.globalAlpha = 0.85;
        g.beginPath(); g.ellipse(40, 0, 16, 11, 0, 0, 7); g.fill();
        g.restore();
        break;
      }
      case BRIDGE: {
        const pier = w.vis[i] === 1;
        g.fillStyle = pier ? '#6f5a44' : '#6b6f73';
        g.fillRect(px, py, CELL, CELL);
        g.strokeStyle = pier ? 'rgba(40,30,20,0.5)' : 'rgba(40,44,48,0.4)';
        g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < CELL; k += pier ? 6 : 16) { g.moveTo(px + k, py); g.lineTo(px + k, py + CELL); }
        g.stroke();
        g.strokeStyle = '#3a3d40'; g.lineWidth = 3;
        g.beginPath();
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const n = nb(dx, dy);
          if (n >= 0 && w.t[n] === WATER) {
            if (dy) { g.moveTo(px, py + (dy < 0 ? 1.5 : CELL - 1.5)); g.lineTo(px + CELL, py + (dy < 0 ? 1.5 : CELL - 1.5)); }
            else { g.moveTo(px + (dx < 0 ? 1.5 : CELL - 1.5), py); g.lineTo(px + (dx < 0 ? 1.5 : CELL - 1.5), py + CELL); }
          }
        }
        g.stroke();
        break;
      }
    }
  }

  drawDecor(g: CanvasRenderingContext2D, d: World['decor'][number]) {
    g.save();
    g.translate(d.x, d.y);
    g.rotate(d.a);
    switch (d.k) {
      case 'tent': {
        g.fillStyle = 'rgba(14,22,30,0.3)'; g.fillRect(-20 + 6, -16 + 8, 44, 34);
        g.fillStyle = d.c === 'a' ? '#5d6b52' : '#6b6450';
        g.fillRect(-22, -16, 44, 32);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(-22, -16, 44, 16);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5; g.strokeRect(-22, -16, 44, 32);
        g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.stroke();
        break;
      }
      case 'silo': {
        g.fillStyle = 'rgba(14,22,30,0.3)'; g.beginPath(); g.arc(SUN.x * 2, SUN.y * 2, d.s, 0, 7); g.fill();
        const gr = g.createRadialGradient(-d.s * 0.3, -d.s * 0.3, 2, 0, 0, d.s);
        gr.addColorStop(0, '#c9ced2'); gr.addColorStop(1, '#79828a');
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, d.s, 0, 7); g.fill();
        g.strokeStyle = 'rgba(40,46,52,0.6)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, d.s * 0.55, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, d.s, 0, 7); g.stroke();
        break;
      }
      case 'crane': {
        g.fillStyle = 'rgba(14,22,30,0.25)'; g.fillRect(SUN.x * 3, -6 + SUN.y * 3, 160, 12);
        g.fillStyle = '#d4a43a'; g.fillRect(-20, -20, 40, 40);
        g.strokeStyle = '#b8872a'; g.lineWidth = 3; g.strokeRect(-20, -20, 40, 40);
        g.fillStyle = '#e0b14a'; g.fillRect(0, -6, 160, 12);
        g.strokeStyle = 'rgba(60,45,20,0.6)'; g.lineWidth = 1.2;
        for (let x = 8; x < 160; x += 12) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x + 6, 6); g.stroke(); }
        break;
      }
      case 'boat': {
        g.fillStyle = 'rgba(10,20,30,0.3)'; g.beginPath(); g.ellipse(6, 8, 58, 18, 0, 0, 7); g.fill();
        g.fillStyle = '#7d2f2a'; g.beginPath(); g.moveTo(-56, -14); g.lineTo(40, -14); g.lineTo(60, 0); g.lineTo(40, 14); g.lineTo(-56, 14); g.closePath(); g.fill();
        g.fillStyle = '#d9d3c4'; g.fillRect(-30, -9, 34, 18);
        g.fillStyle = '#3b4a56'; g.fillRect(-26, -6, 10, 12);
        break;
      }
      case 'pipe': {
        g.fillStyle = 'rgba(14,22,30,0.25)'; g.fillRect(SUN.x, SUN.y - 7, d.s, 14);
        g.fillStyle = '#8b939a'; g.fillRect(0, -7, d.s, 14);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, -6, d.s, 4);
        for (let x = 0; x < d.s; x += 48) { g.fillStyle = '#5d656c'; g.fillRect(x, -9, 5, 18); }
        break;
      }
      case 'lamp': {
        g.fillStyle = '#2d3135'; g.beginPath(); g.arc(0, 0, 3, 0, 7); g.fill();
        break;
      }
      case 'hqflag': {
        g.fillStyle = 'rgba(14,22,30,0.3)'; g.beginPath(); g.arc(4, 5, 7, 0, 7); g.fill();
        g.fillStyle = '#3b4046'; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
        g.strokeStyle = d.c === '0' ? '#4aa8ff' : '#ff5d4a'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 60, 0, 7); g.stroke();
        break;
      }
      case 'antenna': case 'dome': break;
    }
    g.restore();
  }

  /** 지붕 그림 */
  roof(b: Building): HTMLCanvasElement {
    let c = this.roofs.get(b.id);
    if (c && !b.dirty) return c;
    const q = this.q;
    const W = b.w * CELL, H = b.h * CELL;
    if (!c) c = canvas(W * q, H * q);
    b.dirty = false;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    if (b.collapsed) { this.roofs.set(b.id, c); return c; }
    g.setTransform(q, 0, 0, q, 0, 0);
    const col = b.roofColor;
    const shade = (hex: string, f: number) => {
      const n = parseInt(hex.slice(1), 16);
      const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
      return `rgb(${cl(n >> 16)},${cl((n >> 8) & 255)},${cl(n & 255)})`;
    };
    if (b.roof === 'gable') {
      const along = W >= H;
      g.fillStyle = shade(col, 1.12);
      g.fillRect(0, 0, W, H);
      g.fillStyle = shade(col, 0.78);
      if (along) g.fillRect(0, H / 2, W, H / 2); else g.fillRect(W / 2, 0, W / 2, H);
      g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1;
      g.beginPath();
      if (along) for (let y = 5; y < H; y += 6) { g.moveTo(0, y); g.lineTo(W, y); }
      else for (let x = 5; x < W; x += 6) { g.moveTo(x, 0); g.lineTo(x, H); }
      g.stroke();
      g.strokeStyle = shade(col, 0.55); g.lineWidth = 3;
      g.beginPath(); if (along) { g.moveTo(2, H / 2); g.lineTo(W - 2, H / 2); } else { g.moveTo(W / 2, 2); g.lineTo(W / 2, H - 2); } g.stroke();
      g.fillStyle = '#5a4b42'; g.fillRect(along ? W * 0.72 : W * 0.25, along ? H * 0.2 : H * 0.7, 8, 8);
    } else if (b.roof === 'metal') {
      g.fillStyle = col; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 2;
      g.beginPath(); for (let x = 3; x < W; x += 7) { g.moveTo(x, 0); g.lineTo(x, H); } g.stroke();
      g.fillStyle = 'rgba(170,215,240,0.45)';
      for (let x = W * 0.2; x < W - 20; x += W * 0.3) g.fillRect(x, H * 0.25, 18, H * 0.5);
    } else {
      g.fillStyle = col; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let k = 0; k < Math.max(1, (b.w * b.h) / 25); k++) g.fillRect(8 + hash(b.id * 7 + k) * (W - 30), 8 + hash(b.id * 11 + k) * (H - 30), 14, 12);
      if (b.roof === 'dome') {
        const r = Math.min(W, H) * 0.42;
        const gr = g.createRadialGradient(W / 2 - r * 0.35, H / 2 - r * 0.35, 4, W / 2, H / 2, r);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#a9b2ba');
        g.fillStyle = 'rgba(14,22,30,0.25)'; g.beginPath(); g.arc(W / 2 + 6, H / 2 + 8, r, 0, 7); g.fill();
        g.fillStyle = gr; g.beginPath(); g.arc(W / 2, H / 2, r, 0, 7); g.fill();
        g.strokeStyle = 'rgba(80,90,100,0.35)'; g.lineWidth = 1;
        for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(W / 2, H / 2, (r * k) / 4, 0, 7); g.stroke(); }
      }
    }
    if (this.snowy) {
      g.fillStyle = 'rgba(236,242,247,0.22)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(240,245,249,0.35)';
      for (let k = 0; k < (b.w * b.h) / 4; k++) { g.beginPath(); g.ellipse(hash(b.id * 31 + k) * W, hash(b.id * 17 + k) * H, 3 + hash(k + b.id) * 5, 2 + hash(k * 3 + b.id) * 3, 0, 0, 7); g.fill(); }
    }
    g.strokeStyle = 'rgba(10,12,14,0.6)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
    // 구멍
    const w = this.w;
    g.globalCompositeOperation = 'destination-out';
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (w.roof[y * w.cw + x]) continue;
      const px = (x - b.x) * CELL, py = (y - b.y) * CELL;
      g.beginPath();
      for (let k = 0; k < 8; k++) { const a = k * 0.785, r = 20 + hash(x * 31 + y * 7 + k) * 8; g.lineTo(px + 16 + Math.cos(a) * r, py + 16 + Math.sin(a) * r); }
      g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    this.roofs.set(b.id, c);
    return c;
  }

  /** 보이는 조각을 그린다. 한 프레임에 굽는 조각 수를 제한한다 */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, budget: number) {
    this.frame++;
    const kx0 = Math.max(0, Math.floor(x0 / CHUNK)), kx1 = Math.min(this.ncx - 1, Math.floor(x1 / CHUNK));
    const ky0 = Math.max(0, Math.floor(y0 / CHUNK)), ky1 = Math.min(this.ncy - 1, Math.floor(y1 / CHUNK));
    let baked = 0;
    for (let ky = ky0; ky <= ky1; ky++) for (let kx = kx0; kx <= kx1; kx++) {
      const k = ky * this.ncx + kx;
      let ch = this.chunks.get(k);
      if ((!ch || ch.dirty) && baked < budget) {
        const c = this.bake(kx, ky, ch?.c);
        if (!ch) { ch = { c, dirty: false, used: this.frame }; this.chunks.set(k, ch); }
        ch.dirty = false;
        baked++;
      }
      if (ch) {
        ch.used = this.frame;
        ctx.drawImage(ch.c, kx * CHUNK, ky * CHUNK, CHUNK, CHUNK);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.low, kx * CC, ky * CC, CC, CC, kx * CHUNK, ky * CHUNK, CHUNK, CHUNK);
      }
    }
    // 오래 안 쓴 조각은 버린다
    if (this.chunks.size > 56) {
      const list = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [k] of list.slice(0, this.chunks.size - 48)) this.chunks.delete(k);
    }
  }
}
