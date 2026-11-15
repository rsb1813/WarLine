// 길찾기 격자: 2m 칸, 보병용(칸마다 대표점 + 8방향 연결 비트)과 차량용(여유 2.5m) 두 겹.
// 부서진 상자(brokenLog)·무너진 건물(collapseLog)은 커서로 읽어 그 둘레만 다시 계산한다.
import type { Box, Vec3, World } from '../types';
import { boxesNear, heightAt, lineOfSight } from '../world';

export const CELL = 2;
/** 연결선 판정 여유 (몸 반지름보다 조금 작게: 몸은 벽을 따라 미끄러진다) */
const R_E = 0.25;
/** 대표점 판정 여유 */
const R_P = 0.3;
/** 차량 여유 */
const V_CLR = 2.5;
const BAND_LO = 0.5, BAND_HI = 1.7;
const MAX_STEP_ORTH = 1.3, MAX_STEP_DIAG = 1.8, V_MAX_STEP = 1.0;

const F_BLOCK = 1, F_DIRTY = 2, F_BRIDGE = 4, F_WET = 8, F_SURF = 16;
/** 상자 디딤면(바닥·다리) 끼리·땅과의 턱: 몸은 0.5m 까지만 올라선다 */
const SURF_STEP = 0.6, V_SURF_STEP = 0.7;

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DZ = [0, 1, 1, 1, 0, -1, -1, -1];
const SUB = [-0.75, -0.25, 0.25, 0.75];

export interface Nav {
  w: World; n: number;
  terr: Float32Array; base: Float32Array;
  repX: Float32Array; repZ: Float32Array;
  flags: Uint8Array; edges: Uint8Array; vblock: Uint8Array;
  cellBoxes: Map<number, number[]>;
  brokenCur: number; collapseCur: number;
  queue: number[];
  gS: Float32Array; par: Int32Array; seen: Uint32Array; closed: Uint32Array; searchId: number;
  heapN: Int32Array; heapF: Float32Array; heapCap: number;
  frameExp: number; frameBudget: number;
  boxStamp: Uint32Array; boxStampId: number;
  version: number;
}

export interface PathResult { pts: number[]; partial: boolean }

/** 디딤면: 얇고 넓은 바닥·다리 상판 (다리 난간처럼 높고 좁은 것은 장애물) */
const isSurface = (b: Box): boolean => (b.kind === 'floor' || b.kind === 'bridge') && b.max.y - b.min.y <= 1.0
  && Math.min(b.max.x - b.min.x, b.max.z - b.min.z) >= 1.2;
const blocksInf = (b: Box): boolean => b.alive && b.solid && !isSurface(b);
/** 차량이 들이받아 부수는 약한 상자 (sim-vehicles 의 isWeak 와 같은 기준) */
const weakForVeh = (b: Box): boolean => b.destructible && (b.kind === 'fence' || b.kind === 'window' || b.kind === 'tree' || b.kind === 'sandbag'
  || b.kind === 'prop' || b.kind === 'cover' || (b.kind === 'wall' && (b.mat === 'wood' || b.mat === 'glass' || b.mat === 'foliage')));
const blocksVeh = (b: Box): boolean => b.alive && b.solid && !isSurface(b) && !weakForVeh(b);

export function createNav(w: World): Nav {
  const n = Math.ceil(w.size / CELL);
  const N = n * n;
  const heapCap = 48000;
  const nav: Nav = {
    w, n,
    terr: new Float32Array(N), base: new Float32Array(N),
    repX: new Float32Array(N), repZ: new Float32Array(N),
    flags: new Uint8Array(N), edges: new Uint8Array(N), vblock: new Uint8Array(N),
    cellBoxes: new Map(),
    brokenCur: w.brokenLog.length, collapseCur: w.collapseLog.length,
    queue: [],
    gS: new Float32Array(N), par: new Int32Array(N), seen: new Uint32Array(N), closed: new Uint32Array(N), searchId: 0,
    heapN: new Int32Array(heapCap), heapF: new Float32Array(heapCap), heapCap,
    frameExp: 0, frameBudget: 9000,
    boxStamp: new Uint32Array(Math.max(16, w.boxes.length + 256)), boxStampId: 0,
    version: 0,
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = i + j * n, x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
    nav.terr[c] = heightAt(w, x, z);
    nav.base[c] = nav.terr[c];
    nav.repX[c] = x; nav.repZ[c] = z;
  }
  const T = 32;
  for (let j0 = 0; j0 < n; j0 += T) for (let i0 = 0; i0 < n; i0 += T) rebuildRegion(nav, i0, j0, Math.min(n - 1, i0 + T - 1), Math.min(n - 1, j0 + T - 1));
  return nav;
}

export const cellOf = (nav: Nav, x: number, z: number): number => {
  const n = nav.n;
  let i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  if (i < 0) i = 0; else if (i >= n) i = n - 1;
  if (j < 0) j = 0; else if (j >= n) j = n - 1;
  return i + j * n;
};
export const cellX = (nav: Nav, c: number): number => nav.repX[c];
export const cellZ = (nav: Nav, c: number): number => nav.repZ[c];
export const isOpen = (nav: Nav, c: number, veh: boolean): boolean => veh ? nav.vblock[c] === 0 : (nav.flags[c] & F_BLOCK) === 0 && nav.edges[c] !== 0;
export const isDirty = (nav: Nav, c: number): boolean => (nav.flags[c] & F_DIRTY) !== 0;
export const baseAt = (nav: Nav, x: number, z: number): number => nav.base[cellOf(nav, x, z)];

/** 매 프레임 처음에: 탐색 예산을 되돌리고, 부서진 상자를 반영한다 */
export function navFrame(nav: Nav): void {
  nav.frameExp = 0;
  const w = nav.w;
  while (nav.brokenCur < w.brokenLog.length) {
    const b = w.boxes[w.brokenLog[nav.brokenCur++]];
    if (b) queueRect(nav, b.min.x, b.min.z, b.max.x, b.max.z, 3.5);
  }
  while (nav.collapseCur < w.collapseLog.length) {
    const bd = w.buildings[w.collapseLog[nav.collapseCur++]];
    if (!bd) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const id of bd.boxes) {
      const b = w.boxes[id];
      if (!b) continue;
      if (b.min.x < x0) x0 = b.min.x; if (b.min.z < z0) z0 = b.min.z;
      if (b.max.x > x1) x1 = b.max.x; if (b.max.z > z1) z1 = b.max.z;
    }
    if (x0 === Infinity) { x0 = bd.x - bd.w; z0 = bd.z - bd.d; x1 = bd.x + bd.w; z1 = bd.z + bd.d; }
    queueRect(nav, x0, z0, x1, z1, 4);
  }
  // 한 프레임에 한 구역 (겹치는 구역은 합쳐서)
  if (nav.queue.length >= 4) {
    const q = nav.queue;
    let i0 = q[0], j0 = q[1], i1 = q[2], j1 = q[3];
    const rest: number[] = [];
    for (let k = 4; k < q.length; k += 4) {
      const a0 = q[k], b0 = q[k + 1], a1 = q[k + 2], b1 = q[k + 3];
      const ov = a0 <= i1 + 1 && a1 >= i0 - 1 && b0 <= j1 + 1 && b1 >= j0 - 1;
      const ni0 = Math.min(i0, a0), nj0 = Math.min(j0, b0), ni1 = Math.max(i1, a1), nj1 = Math.max(j1, b1);
      if (ov && (ni1 - ni0) * (nj1 - nj0) <= 1600) { i0 = ni0; j0 = nj0; i1 = ni1; j1 = nj1; }
      else rest.push(a0, b0, a1, b1);
    }
    nav.queue = rest;
    rebuildRegion(nav, i0, j0, i1, j1);
    nav.version++;
  }
}

function queueRect(nav: Nav, x0: number, z0: number, x1: number, z1: number, pad: number): void {
  const n = nav.n;
  const i0 = Math.max(0, Math.floor((x0 - pad) / CELL)), j0 = Math.max(0, Math.floor((z0 - pad) / CELL));
  const i1 = Math.min(n - 1, Math.floor((x1 + pad) / CELL)), j1 = Math.min(n - 1, Math.floor((z1 + pad) / CELL));
  if (i1 < i0 || j1 < j0) return;
  const q = nav.queue;
  for (let k = 0; k < q.length; k += 4) {
    if (q[k] <= i0 && q[k + 1] <= j0 && q[k + 2] >= i1 && q[k + 3] >= j1) return; // 이미 덮임
  }
  q.push(i0, j0, i1, j1);
}

function gatherBoxes(nav: Nav, i0: number, j0: number, i1: number, j1: number, pad: number): Box[] {
  const w = nav.w;
  if (nav.boxStamp.length < w.boxes.length) nav.boxStamp = new Uint32Array(w.boxes.length + 512);
  const id = ++nav.boxStampId;
  if (id >= 0xfffffff0) { nav.boxStamp.fill(0); nav.boxStampId = 1; }
  const stamp = nav.boxStamp, sid = nav.boxStampId;
  const x0 = i0 * CELL - pad, z0 = j0 * CELL - pad, x1 = (i1 + 1) * CELL + pad, z1 = (j1 + 1) * CELL + pad;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.hypot(x1 - x0, z1 - z0) / 2;
  const out: Box[] = [];
  boxesNear(w, cx, cz, r, (b: Box) => {
    if (!b || !b.alive || !b.solid) return;
    if (b.id < stamp.length) { if (stamp[b.id] === sid) return; stamp[b.id] = sid; }
    if (b.max.x < x0 || b.min.x > x1 || b.max.z < z0 || b.min.z > z1) return;
    out.push(b);
  });
  return out;
}

function rebuildRegion(nav: Nav, i0: number, j0: number, i1: number, j1: number): void {
  const n = nav.n, w = nav.w;
  const boxes = gatherBoxes(nav, i0, j0, i1, j1, V_CLR + 1);
  const { base, terr, flags, repX, repZ, vblock } = nav;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = i + j * n;
    base[c] = terr[c]; flags[c] = 0; vblock[c] = 0;
    repX[c] = (i + 0.5) * CELL; repZ[c] = (j + 0.5) * CELL;
    nav.cellBoxes.delete(c);
  }
  // 1) 디딤면: 1층 바닥, 다리
  for (const b of boxes) {
    if (!isSurface(b)) continue;
    const a0 = Math.max(i0, Math.ceil(b.min.x / CELL - 0.5)), a1 = Math.min(i1, Math.floor(b.max.x / CELL - 0.5));
    const c0 = Math.max(j0, Math.ceil(b.min.z / CELL - 0.5)), c1 = Math.min(j1, Math.floor(b.max.z / CELL - 0.5));
    for (let j = c0; j <= c1; j++) for (let i = a0; i <= a1; i++) {
      const c = i + j * n, top = b.max.y, h = terr[c];
      if (b.kind === 'bridge') {
        if (top <= h + 14 && top >= h - 0.5 && (!(flags[c] & F_BRIDGE) || top > base[c])) { base[c] = top; flags[c] |= F_BRIDGE | F_SURF; }
      } else if (top <= h + 2.0 && top >= h - 0.6 && !(flags[c] & F_BRIDGE)) {
        if (top > base[c] || base[c] === h) { base[c] = Math.max(top, h); flags[c] |= F_SURF; }
      }
    }
  }
  // 2) 물
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = i + j * n;
    // sim-vehicles 는 다리 위에서도 지형 기준 물 깊이로 차량을 막는다: 그대로 따른다
    if (w.water - terr[c] > 1.0) vblock[c] = 1;
    if (flags[c] & F_BRIDGE) continue;
    const depth = w.water - base[c];
    if (depth > 1.0) flags[c] |= F_BLOCK;
    if (depth > 0.15) flags[c] |= F_WET;
    if (depth > 0.8) vblock[c] = 1;
  }
  // 3) 막는 상자: 보병 칸 목록, 차량 여유
  for (const b of boxes) {
    if (blocksInf(b)) {
      const ex0 = b.min.x - R_P, ex1 = b.max.x + R_P, ez0 = b.min.z - R_P, ez1 = b.max.z + R_P;
      const a0 = Math.max(i0, Math.floor(ex0 / CELL)), a1 = Math.min(i1, Math.floor(ex1 / CELL));
      const c0 = Math.max(j0, Math.floor(ez0 / CELL)), c1 = Math.min(j1, Math.floor(ez1 / CELL));
      for (let j = c0; j <= c1; j++) for (let i = a0; i <= a1; i++) {
        const c = i + j * n, bs = base[c];
        if (b.max.y <= bs + BAND_LO || b.min.y >= bs + BAND_HI) continue;
        let l = nav.cellBoxes.get(c);
        if (!l) { l = []; nav.cellBoxes.set(c, l); }
        l.push(b.id);
        flags[c] |= F_DIRTY;
      }
    }
    if (blocksVeh(b)) {
      const ex0 = b.min.x - V_CLR, ex1 = b.max.x + V_CLR, ez0 = b.min.z - V_CLR, ez1 = b.max.z + V_CLR;
      const a0 = Math.max(i0, Math.ceil(ex0 / CELL - 0.5)), a1 = Math.min(i1, Math.floor(ex1 / CELL - 0.5));
      const c0 = Math.max(j0, Math.ceil(ez0 / CELL - 0.5)), c1 = Math.min(j1, Math.floor(ez1 / CELL - 0.5));
      for (let j = c0; j <= c1; j++) for (let i = a0; i <= a1; i++) {
        const c = i + j * n, bs = base[c];
        if (b.max.y <= bs + 0.85 || b.min.y >= bs + 3.2) continue; // 낮은 턱은 넘어간다
        vblock[c] = 1;
      }
    }
  }
  // 4) 차량 경사 (가장자리 칸은 지도 밖으로 못 나감)
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = i + j * n;
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) { vblock[c] = 1; continue; }
    if (vblock[c]) continue;
    if (!stepOK(nav, c, c + 1, false, true) || !stepOK(nav, c, c - 1, false, true) || !stepOK(nav, c, c + n, false, true) || !stepOK(nav, c, c - n, false, true)) vblock[c] = 1;
  }
  // 5) 대표점 1차: 가운데가 비면 가운데, 아니면 비어 있는 첫 표본
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = i + j * n;
    if (!(flags[c] & F_DIRTY) || (flags[c] & F_BLOCK)) continue;
    const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
    if (pointFree(nav, c, cx, cz)) continue;
    let found = false;
    for (let a = 0; a < 4 && !found; a++) for (let bb = 0; bb < 4 && !found; bb++) {
      const px = cx + SUB[a], pz = cz + SUB[bb];
      if (pointFree(nav, c, px, pz)) { repX[c] = px; repZ[c] = pz; found = true; }
    }
    if (!found) flags[c] |= F_BLOCK;
  }
  // 6) 대표점 2차: 이웃과 가장 많이 이어지는 점 (문틈을 찾는다)
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = i + j * n;
    if (!(flags[c] & F_DIRTY) || (flags[c] & F_BLOCK)) continue;
    const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
    let bestS = -1, bx = repX[c], bz = repZ[c];
    for (let k = -1; k < 16; k++) {
      const px = k < 0 ? cx : cx + SUB[k & 3], pz = k < 0 ? cz : cz + SUB[k >> 2];
      if (!pointFree(nav, c, px, pz)) continue;
      let s = 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DZ[d];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nc = ni + nj * n;
        if (flags[nc] & F_BLOCK) continue;
        if (!stepOK(nav, c, nc, (d & 1) === 1, false)) continue;
        if (segClear(nav, c, nc, px, pz, repX[nc], repZ[nc])) s += 1;
      }
      s -= Math.hypot(px - cx, pz - cz) * 0.05;
      if (k < 0) s += 0.3;
      if (s > bestS) { bestS = s; bx = px; bz = pz; }
    }
    repX[c] = bx; repZ[c] = bz;
  }
  // 7) 연결 비트: 구역과 한 칸 둘레
  const e0 = Math.max(0, i0 - 1), e1 = Math.min(n - 1, i1 + 1), f0 = Math.max(0, j0 - 1), f1 = Math.min(n - 1, j1 + 1);
  for (let j = f0; j <= f1; j++) for (let i = e0; i <= e1; i++) computeEdges(nav, i, j);
}

function stepOK(nav: Nav, a: number, b: number, diag: boolean, veh: boolean): boolean {
  const d = Math.abs(nav.base[a] - nav.base[b]);
  if ((nav.flags[a] | nav.flags[b]) & F_SURF) return d <= (veh ? V_SURF_STEP : SURF_STEP);
  return d <= (veh ? (diag ? V_MAX_STEP * 1.4 : V_MAX_STEP) : diag ? MAX_STEP_DIAG : MAX_STEP_ORTH);
}

function computeEdges(nav: Nav, i: number, j: number): void {
  const n = nav.n, c = i + j * n, { flags, repX, repZ } = nav;
  let m = 0;
  if (!(flags[c] & F_BLOCK)) {
    for (let d = 0; d < 8; d++) {
      const ni = i + DX[d], nj = j + DZ[d];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nc = ni + nj * n;
      if (flags[nc] & F_BLOCK) continue;
      if (!stepOK(nav, c, nc, (d & 1) === 1, false)) continue;
      if (((flags[c] | flags[nc]) & F_DIRTY) && !segClear(nav, c, nc, repX[c], repZ[c], repX[nc], repZ[nc])) continue;
      if (d & 1) {
        // 대각선: 양옆 칸이 둘 다 막혔으면(지형·물) 건너지 않음
        const a = (i + DX[d]) + j * n, b = i + (j + DZ[d]) * n;
        if ((flags[a] & F_BLOCK) && (flags[b] & F_BLOCK) && !((flags[a] | flags[b]) & F_DIRTY)) continue;
      }
      m |= 1 << d;
    }
  }
  nav.edges[c] = m;
}

function pointFree(nav: Nav, c: number, x: number, z: number): boolean {
  const l = nav.cellBoxes.get(c);
  if (!l) return true;
  const bx = nav.w.boxes;
  for (let k = 0; k < l.length; k++) {
    const b = bx[l[k]];
    if (!b || !b.alive) continue;
    if (x > b.min.x - R_P && x < b.max.x + R_P && z > b.min.z - R_P && z < b.max.z + R_P) return false;
  }
  return true;
}

function segHitsRect(ax: number, az: number, bx: number, bz: number, x0: number, z0: number, x1: number, z1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax <= x0 || ax >= x1) return false; }
  else {
    let ta = (x0 - ax) / dx, tb = (x1 - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 >= t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az <= z0 || az >= z1) return false; }
  else {
    let ta = (z0 - az) / dz, tb = (z1 - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 >= t1) return false;
  }
  return true;
}

function segVsList(nav: Nav, l: number[] | undefined, ax: number, az: number, bx: number, bz: number): boolean {
  if (!l) return true;
  const boxes = nav.w.boxes;
  for (let k = 0; k < l.length; k++) {
    const b = boxes[l[k]];
    if (!b || !b.alive) continue;
    if (segHitsRect(ax, az, bx, bz, b.min.x - R_E, b.min.z - R_E, b.max.x + R_E, b.max.z + R_E)) return false;
  }
  return true;
}

function segClear(nav: Nav, c: number, nc: number, ax: number, az: number, bx: number, bz: number): boolean {
  return segVsList(nav, nav.cellBoxes.get(c), ax, az, bx, bz) && segVsList(nav, nav.cellBoxes.get(nc), ax, az, bx, bz);
}

/** 거친 "곧장 걸어갈 수 있나" 판정: 지나는 칸을 차례로 보고, 벽 가까운 칸은 상자와 직접 비교 */
export function lineWalkable(nav: Nav, ax: number, az: number, bx: number, bz: number, veh = false): boolean {
  const n = nav.n;
  let i = Math.floor(ax / CELL), j = Math.floor(az / CELL);
  const ti = Math.floor(bx / CELL), tj = Math.floor(bz / CELL);
  if (i < 0 || j < 0 || i >= n || j >= n || ti < 0 || tj < 0 || ti >= n || tj >= n) return false;
  const dx = bx - ax, dz = bz - az;
  const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tdx = adx > 1e-9 ? CELL / adx : Infinity, tdz = adz > 1e-9 ? CELL / adz : Infinity;
  let tmx = adx > 1e-9 ? (si > 0 ? (i + 1) * CELL - ax : ax - i * CELL) / adx : Infinity;
  let tmz = adz > 1e-9 ? (sj > 0 ? (j + 1) * CELL - az : az - j * CELL) / adz : Infinity;
  const { flags, vblock } = nav;
  let prev = i + j * n;
  for (let steps = 0; steps < 600; steps++) {
    const c = i + j * n;
    if (steps > 0) {
      if (veh) { if (vblock[c]) return false; }
      else if (flags[c] & F_BLOCK) return false;
      if (!stepOK(nav, prev, c, false, veh)) return false;
    }
    prev = c;
    if (!veh && (flags[c] & F_DIRTY) && !segVsList(nav, nav.cellBoxes.get(c), ax, az, bx, bz)) return false;
    if (i === ti && j === tj) return true;
    if (tmx < tmz) { tmx += tdx; i += si; } else { tmz += tdz; j += sj; }
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
  }
  return false;
}

const hyp2 = Math.hypot;

/** 위치 (x, z) 에서 곧장 걸어 닿는 칸: 벽이 가르는 칸이면 이웃 중 실제로 닿는 것 */
export function anchorCell(nav: Nav, x: number, z: number, veh: boolean, r: number): number {
  const c0 = cellOf(nav, x, z);
  if (veh) return nearestOpen(nav, c0, r, true);
  if (isOpen(nav, c0, false) && (!(nav.flags[c0] & F_DIRTY) || lineWalkable(nav, x, z, nav.repX[c0], nav.repZ[c0]))) return c0;
  const n = nav.n, ci = c0 % n, cj = (c0 / n) | 0;
  let best = -1, bd = Infinity;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const i = ci + di, j = cj + dj;
    if ((di === 0 && dj === 0) || i < 0 || j < 0 || i >= n || j >= n) continue;
    const c = i + j * n;
    if (!isOpen(nav, c, false)) continue;
    const d = (nav.repX[c] - x) ** 2 + (nav.repZ[c] - z) ** 2;
    if (d >= bd) continue;
    if (!lineWalkable(nav, x, z, nav.repX[c], nav.repZ[c])) continue;
    bd = d; best = c;
  }
  return best >= 0 ? best : nearestOpen(nav, c0, r, false);
}

/** 가장 가까운 열린 칸 (r 칸 안), 없으면 -1 */
export function nearestOpen(nav: Nav, c: number, r: number, veh: boolean): number {
  if (isOpen(nav, c, veh)) return c;
  const n = nav.n, ci = c % n, cj = (c / n) | 0;
  for (let rr = 1; rr <= r; rr++) {
    let best = -1, bd = Infinity;
    for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
      if (Math.abs(di) !== rr && Math.abs(dj) !== rr) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = i + j * n;
      if (!isOpen(nav, k, veh)) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = k; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function heapPush(nav: Nav, size: number, node: number, f: number): number {
  const hn = nav.heapN, hf = nav.heapF;
  let k = size;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (hf[p] <= f) break;
    hn[k] = hn[p]; hf[k] = hf[p]; k = p;
  }
  hn[k] = node; hf[k] = f;
  return size + 1;
}
function heapPop(nav: Nav, size: number): number {
  const hn = nav.heapN, hf = nav.heapF;
  const last = size - 1;
  const ln = hn[last], lf = hf[last];
  let k = 0;
  for (;;) {
    let ch = 2 * k + 1;
    if (ch >= last) break;
    if (ch + 1 < last && hf[ch + 1] < hf[ch]) ch++;
    if (hf[ch] >= lf) break;
    hn[k] = hn[ch]; hf[k] = hf[ch]; k = ch;
  }
  hn[k] = ln; hf[k] = lf;
  return last;
}

/**
 * A* (8방향, 옥타일 휴리스틱, 이진 힙). 결과는 [x0,z0,x1,z1,...] 경유점(출발점 제외), 매끈하게 당긴 것.
 * 목표까지 못 가면 가장 가까이 간 칸까지(partial). 이번 프레임 예산이 다 떨어졌으면 null (나중에 다시).
 */
export function findPath(nav: Nav, sx: number, sz: number, tx: number, tz: number, veh: boolean, maxExp = 4000): PathResult | null {
  const n = nav.n;
  const s = anchorCell(nav, sx, sz, veh, 4);
  const t = anchorCell(nav, tx, tz, veh, 8);
  if (s < 0 || t < 0) return { pts: [tx, tz], partial: true };
  const ptX = (c: number): number => veh ? (c % n + 0.5) * CELL : nav.repX[c];
  const ptZ = (c: number): number => veh ? (((c / n) | 0) + 0.5) * CELL : nav.repZ[c];
  const goalExact = hyp2(tx - ptX(t), tz - ptZ(t)) < 3 && (veh || lineWalkable(nav, ptX(t), ptZ(t), tx, tz, false));
  const gx = goalExact ? tx : ptX(t), gz = goalExact ? tz : ptZ(t);
  if (s === t) return { pts: [gx, gz], partial: !goalExact };
  const dd = Math.hypot(gx - sx, gz - sz);
  if (dd < 90 && lineWalkable(nav, sx, sz, gx, gz, veh)) return { pts: [gx, gz], partial: !goalExact };
  if (nav.frameExp >= nav.frameBudget) return null;

  let sid = ++nav.searchId;
  if (sid >= 0xfffffff0) { nav.seen.fill(0); nav.closed.fill(0); nav.searchId = sid = 1; }
  const { gS, par, seen, closed, edges, flags, vblock } = nav;
  const ti = t % n, tj = (t / n) | 0;
  const H = (c: number): number => {
    const di = Math.abs(c % n - ti), dj = Math.abs(((c / n) | 0) - tj);
    return (di > dj ? di + 0.4142 * dj : dj + 0.4142 * di) * CELL * 1.2;
  };
  seen[s] = sid; gS[s] = 0; par[s] = -1;
  let size = heapPush(nav, 0, s, H(s));
  let best = s, bestH = H(s), exp = 0, found = false;
  const cap = nav.heapCap - 9;
  while (size > 0 && exp < maxExp) {
    const c = nav.heapN[0];
    size = heapPop(nav, size);
    if (closed[c] === sid) continue;
    closed[c] = sid;
    exp++;
    if (c === t) { found = true; break; }
    const h = H(c);
    if (h < bestH) { bestH = h; best = c; }
    const ci = c % n, cj = (c / n) | 0, gc = gS[c];
    for (let d = 0; d < 8; d++) {
      let nc: number;
      if (veh) {
        const ni = ci + DX[d], nj = cj + DZ[d];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        nc = ni + nj * n;
        if (vblock[nc]) continue;
        if (d & 1) { if (vblock[ni + cj * n] || vblock[ci + nj * n]) continue; }
        if (!stepOK(nav, c, nc, (d & 1) === 1, true)) continue;
      } else {
        if (!(edges[c] & (1 << d))) continue;
        nc = ci + DX[d] + (cj + DZ[d]) * n;
      }
      if (closed[nc] === sid) continue;
      let cost = (d & 1) ? 2.8284 : 2;
      const fl = flags[nc];
      if (!veh && (fl & F_DIRTY)) cost += 0.5;
      if (fl & F_WET) cost += 2;
      const ng = gc + cost;
      if (seen[nc] === sid && gS[nc] <= ng) continue;
      seen[nc] = sid; gS[nc] = ng; par[nc] = c;
      if (size < cap) size = heapPush(nav, size, nc, ng + H(nc));
    }
  }
  nav.frameExp += exp;
  const end = found ? t : best;
  const cells: number[] = [];
  for (let c = end, guard = 0; c >= 0 && guard < 20000; c = par[c], guard++) { cells.push(c); if (c === s) break; }
  cells.reverse();
  // 원래 점들 (출발점 + 칸 대표점 + 목표점)
  const raw: number[] = [sx, sz];
  for (let k = 0; k < cells.length; k++) raw.push(ptX(cells[k]), ptZ(cells[k]));
  if (found && goalExact) { raw.push(tx, tz); }
  return { pts: pull(nav, raw, veh), partial: !(found && goalExact) };
}

/** 줄 당기기: 곧장 갈 수 있는 가장 먼 점으로 건너뛴다 (출발점은 빼고 돌려준다) */
function pull(nav: Nav, raw: number[], veh: boolean): number[] {
  const m = raw.length >> 1;
  const out: number[] = [];
  let i = 0;
  while (i < m - 1) {
    let j = i + 1;
    const ax = raw[i * 2], az = raw[i * 2 + 1];
    // 몇 칸씩 건너뛰며 시험하고, 실패하면 한 칸씩
    while (j + 1 < m) {
      const k = Math.min(m - 1, j + 4);
      const bx = raw[k * 2], bz = raw[k * 2 + 1];
      if (Math.hypot(bx - ax, bz - az) < 60 && lineWalkable(nav, ax, az, bx, bz, veh)) { j = k; continue; }
      const bx1 = raw[(j + 1) * 2], bz1 = raw[(j + 1) * 2 + 1];
      if (Math.hypot(bx1 - ax, bz1 - az) < 60 && lineWalkable(nav, ax, az, bx1, bz1, veh)) { j++; continue; }
      break;
    }
    out.push(raw[j * 2], raw[j * 2 + 1]);
    i = j;
  }
  return out;
}

/** 거점 안 엄폐 자리: 벽 가까운 열린 칸 (건물 안 1층 포함), 모자라면 아무 열린 칸 */
export function coverSpots(nav: Nav, x: number, z: number, r: number, max: number, rnd: () => number): number[] {
  const n = nav.n;
  const i0 = Math.max(0, Math.floor((x - r) / CELL)), i1 = Math.min(n - 1, Math.floor((x + r) / CELL));
  const j0 = Math.max(0, Math.floor((z - r) / CELL)), j1 = Math.min(n - 1, Math.floor((z + r) / CELL));
  const good: number[] = [], open: number[] = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = i + j * n;
    const px = nav.repX[c], pz = nav.repZ[c];
    if ((px - x) ** 2 + (pz - z) ** 2 > r * r) continue;
    if (!isOpen(nav, c, false)) continue;
    let bits = 0; for (let e = nav.edges[c]; e; e &= e - 1) bits++;
    if (bits < 2) continue;
    if (nav.flags[c] & F_DIRTY) good.push(c); else open.push(c);
  }
  const pick = (arr: number[], k: number, out: number[]): void => {
    for (let a = arr.length - 1; a > 0; a--) { const b = Math.floor(rnd() * (a + 1)); const t = arr[a]; arr[a] = arr[b]; arr[b] = t; }
    for (let a = 0; a < arr.length && out.length < k * 2; a++) out.push(nav.repX[arr[a]], nav.repZ[arr[a]]);
  };
  const out: number[] = [];
  pick(good, max, out);
  if (out.length < 8) pick(open, Math.min(max, (out.length >> 1) + 6), out);
  return out;
}

/** 위협 지점(threat, 눈 높이)에서 안 보이는 가까운 열린 칸. 광선은 최대 maxRays 번 */
export function findCover(nav: Nav, from: Vec3, threat: Vec3, maxR: number, maxRays: number): { x: number; z: number } | null {
  const n = nav.n;
  const ci = Math.floor(from.x / CELL), cj = Math.floor(from.z / CELL);
  const R = Math.ceil(maxR / CELL);
  const cand: number[] = [];
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const c = i + j * n;
    if (!(nav.flags[c] & F_DIRTY) || !isOpen(nav, c, false)) continue;
    const d2 = di * di + dj * dj;
    if (d2 > R * R) continue;
    cand.push(d2 * 262144 + c);
  }
  cand.sort((a, b) => a - b);
  let rays = 0;
  const p = { x: 0, y: 0, z: 0 };
  for (let k = 0; k < cand.length && rays < maxRays; k++) {
    const c = cand[k] % 262144;
    const px = nav.repX[c], pz = nav.repZ[c];
    // 위협 쪽으로 걸어 들어가는 자리는 빼기
    if ((px - threat.x) ** 2 + (pz - threat.z) ** 2 < (from.x - threat.x) ** 2 + (from.z - threat.z) ** 2 - 4) continue;
    p.x = px; p.y = nav.base[c] + 1.05; p.z = pz;
    rays++;
    if (!lineOfSight(nav.w, threat, p)) return { x: px, z: pz };
  }
  return null;
}
