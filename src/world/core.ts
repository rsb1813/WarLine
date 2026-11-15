// 세계 모듈 내부 공용: 상자 만들기, 공간 색인(균일 격자).
import type { Box, BoxKind, Mat, World } from '../types';

/** 공간 색인 칸 크기 (m) */
export const CELL = 8;
/** 몸이 그냥 올라서는 턱 높이 */
export const STEP = 0.5;

/**
 * world.index 의 실제 모양. 상자 id 를 격자 칸마다 담는다.
 * bb: 상자별 [minX, minY, minZ, maxX, maxY, maxZ] (빠른 판정용 사본, 상자는 움직이지 않는다)
 * top: 칸 안 상자 윗면의 최대값 (보수적, 줄지 않음) — 광선이 그 위로 지나가면 칸을 건너뛴다
 * tmax: 칸 안 지형 최대 높이 — 광선이 그 위면 지형 검사 생략
 */
export interface WIndex {
  cs: number; n: number;
  cells: number[][];
  top: Float32Array;
  tmax: Float32Array;
  bb: Float64Array;
  stamp: Uint32Array;
  q: number;
}

export const MAT_HP: Record<Mat, number> = {
  wood: 180, brick: 380, concrete: 600, metal: 450, glass: 10, rock: 5000, sand: 250, foliage: 60,
};
const KIND_DES: Record<BoxKind, boolean> = {
  wall: true, window: true, floor: false, roof: false, stair: false, prop: true, rock: false,
  sandbag: true, container: true, tree: true, fence: true, rubble: false, cover: true, bridge: false,
};
/** 부서지지 않는 상자의 hp 표시값 */
export const HARD_HP = 10000;

export interface BoxOpt { hp?: number; destructible?: boolean; solid?: boolean; opaque?: boolean }

/** 상자 하나를 w.boxes 끝에 추가 (id = 배열 순번). 색인에는 넣지 않는다 */
export function mkBox(
  w: World, kind: BoxKind, mat: Mat,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  color: number, building = -1, o?: BoxOpt,
): number {
  const id = w.boxes.length;
  const des = o && o.destructible !== undefined ? o.destructible : KIND_DES[kind];
  const hp = des ? (o && o.hp !== undefined ? o.hp : MAT_HP[mat]) : HARD_HP;
  const b: Box = {
    id, kind, mat,
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
    hp, maxHp: hp, destructible: des, alive: true, building, color,
    solid: o && o.solid !== undefined ? o.solid : true,
    opaque: o && o.opaque !== undefined ? o.opaque : !(kind === 'window' || kind === 'fence'),
  };
  w.boxes.push(b);
  return id;
}

export function getIndex(w: World): WIndex { return w.index as WIndex; }

function ensureCap(ix: WIndex, count: number): void {
  if (ix.stamp.length >= count) return;
  const cap = Math.max(count + 64, Math.ceil(ix.stamp.length * 1.5));
  const bb = new Float64Array(cap * 6); bb.set(ix.bb); ix.bb = bb;
  const st = new Uint32Array(cap); st.set(ix.stamp); ix.stamp = st;
}

/** 중복 검사용 도장 번호 (질의마다 새로) */
export function nextStamp(ix: WIndex): number {
  ix.q = (ix.q + 1) >>> 0;
  if (ix.q === 0 || ix.q > 0xfffffff0) { ix.stamp.fill(0); ix.q = 1; }
  return ix.q;
}

function cellRange(ix: WIndex, b: Box): [number, number, number, number] {
  const cs = ix.cs, n = ix.n;
  const c = (v: number): number => { const k = Math.floor(v / cs); return k < 0 ? 0 : k >= n ? n - 1 : k; };
  return [c(b.min.x), c(b.min.z), c(b.max.x), c(b.max.z)];
}

export function indexBox(ix: WIndex, b: Box): void {
  ensureCap(ix, b.id + 1);
  const p = b.id * 6, bb = ix.bb;
  bb[p] = b.min.x; bb[p + 1] = b.min.y; bb[p + 2] = b.min.z;
  bb[p + 3] = b.max.x; bb[p + 4] = b.max.y; bb[p + 5] = b.max.z;
  const [i0, j0, i1, j1] = cellRange(ix, b);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * ix.n + i;
      ix.cells[c].push(b.id);
      if (b.max.y > ix.top[c]) ix.top[c] = b.max.y;
    }
  }
}

export function unindexBox(ix: WIndex, b: Box): void {
  const [i0, j0, i1, j1] = cellRange(ix, b);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const a = ix.cells[j * ix.n + i];
      const k = a.indexOf(b.id);
      if (k >= 0) { a[k] = a[a.length - 1]; a.pop(); }
    }
  }
}

/** 생성 끝에 한 번: 격자 만들고 살아 있는 상자 전부 넣기 */
export function buildIndex(w: World): WIndex {
  const cs = CELL, n = Math.max(1, Math.ceil(w.size / cs));
  const cells: number[][] = new Array(n * n);
  for (let i = 0; i < n * n; i++) cells[i] = [];
  const cap = Math.max(1024, Math.ceil(w.boxes.length * 1.25) + 256);
  const ix: WIndex = {
    cs, n, cells,
    top: new Float32Array(n * n).fill(-1e9),
    tmax: new Float32Array(n * n),
    bb: new Float64Array(cap * 6),
    stamp: new Uint32Array(cap),
    q: 0,
  };
  // 칸별 지형 최대 높이 (칸에 걸치는 높이장 꼭짓점 전부)
  const hn = w.hfN, hc = w.hfCell, H = w.heights, s = hn + 1;
  for (let cj = 0; cj < n; cj++) {
    const vj0 = Math.max(0, Math.floor((cj * cs) / hc)), vj1 = Math.min(hn, Math.ceil(((cj + 1) * cs) / hc));
    for (let ci = 0; ci < n; ci++) {
      const vi0 = Math.max(0, Math.floor((ci * cs) / hc)), vi1 = Math.min(hn, Math.ceil(((ci + 1) * cs) / hc));
      let m = -1e9;
      for (let j = vj0; j <= vj1; j++) for (let i = vi0; i <= vi1; i++) { const h = H[j * s + i]; if (h > m) m = h; }
      ix.tmax[cj * n + ci] = m + 0.02;
    }
  }
  w.index = ix;
  for (const b of w.boxes) if (b.alive) indexBox(ix, b);
  return ix;
}

/** 0xRRGGBB 밝기 배율 */
export function shade(c: number, k: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return (r << 16) | (g << 8) | b;
}
/** 두 색 섞기 */
export function mixColor(a: number, b: number, t: number): number {
  const m = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
