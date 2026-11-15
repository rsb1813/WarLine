// 건물 상자 만들기: 층마다 벽 판(벽·창·문), 칸막이, 계단(디딤 상자), 계단 구멍 난 바닥판, 평지붕과 난간.
import type { BoxKind, Building, Mat, World } from '../types';
import { BoxOpt, mkBox, shade } from './core';

export type Style = Building['style'];
export type Variant = '' | 'church' | 'barn' | 'radar' | 'bell' | 'school' | 'hq';

export interface BPlan {
  style: Style; variant: Variant;
  /** 바닥 사각형 (축 정렬) */
  x0: number; z0: number; x1: number; z1: number;
  floors: number; floorH: number;
  mat: Mat; color: number; roofColor: number; trim: number;
  /** 1층 문을 낼 벽: 0 북(-z) 1 남(+z) 2 서(-x) 3 동(+x) */
  doors: number[];
  /** 지붕으로 올라가는 계단 */
  roofStair: boolean;
  /** 1층 바닥 윗면, 기초 아랫면 (지형 평탄화 뒤 채움) */
  by: number; baseY: number;
}

const ST = 0.25;      // 바닥판 두께
const TREAD = 0.3;    // 계단 디딤 깊이
const SW = 1.2;       // 계단 폭
export const WALL_T: Record<Mat, number> = { wood: 0.2, brick: 0.3, concrete: 0.3, metal: 0.15, glass: 0.1, rock: 0.4, sand: 0.5, foliage: 0.2 };
const GLASS_COL = 0x8ea6b4;
const RAIL_COL = 0x45484b;
const RAIL: BoxOpt = { opaque: false };

export const stairRun = (floorH: number): number => Math.max(1, Math.round(floorH / 0.3)) * TREAD;
/** 층 사이 계단을 넣을 수 있는 최소 깊이 (z) */
export const minStairDepth = (floorH: number, mat: Mat): number => 2 * WALL_T[mat] + 2.2 + stairRun(floorH);

interface Win { p: number; w: number; pitch: number; h0: number; h1: number }
const WIN: Record<string, Win> = {
  house: { p: 0.55, w: 1.2, pitch: 2.6, h0: 0.9, h1: 2.2 },
  apartment: { p: 0.72, w: 1.4, pitch: 2.8, h0: 0.9, h1: 2.2 },
  office: { p: 0.78, w: 1.8, pitch: 2.8, h0: 0.9, h1: 2.3 },
  school: { p: 0.85, w: 1.8, pitch: 2.6, h0: 0.9, h1: 2.3 },
  hq: { p: 0.6, w: 1.6, pitch: 2.8, h0: 0.9, h1: 2.3 },
  shed: { p: 0.3, w: 0.8, pitch: 2.4, h0: 1.0, h1: 1.9 },
  warehouse: { p: 0.55, w: 2.4, pitch: 3.6, h0: 4.3, h1: 5.5 },
  barn: { p: 0.3, w: 1.0, pitch: 3.4, h0: 3.3, h1: 4.4 },
  church: { p: 0.85, w: 1.2, pitch: 3.0, h0: 1.4, h1: 4.2 },
  tower: { p: 0, w: 1, pitch: 3, h0: 1, h1: 2 },
};

type Add = (kind: BoxKind, mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, o?: BoxOpt) => void;
interface Op { a: number; b: number; door: boolean; h0: number; h1: number }

export function buildBuilding(w: World, p: BPlan, r: () => number): Building {
  const id = w.buildings.length;
  const B: Building = {
    id, x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, w: p.x1 - p.x0, d: p.z1 - p.z0, y: p.by,
    floors: p.floors, floorH: p.floorH, boxes: [], wallCount: 0, wallsAlive: 0, collapsed: false,
    style: p.style, color: p.color, roofColor: p.roofColor,
  };
  w.buildings.push(B);
  const add: Add = (kind, mat, x0, y0, z0, x1, y1, z1, color, o) => {
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01 || z1 - z0 < 0.01) return;
    const bid = mkBox(w, kind, mat, x0, y0, z0, x1, y1, z1, color, id, o);
    B.boxes.push(bid);
    if ((kind === 'wall' || kind === 'window') && w.boxes[bid].destructible) B.wallCount++;
  };
  if (p.style === 'tower') buildTower(p, add, r); else buildHouse(p, add, r);
  B.wallsAlive = B.wallCount;
  return B;
}

/** 구멍 하나 뚫린 판 (구멍 없으면 통짜) */
function slab(add: Add, kind: BoxKind, m: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hole: number[] | null, col: number): void {
  if (!hole) { add(kind, m, x0, y0, z0, x1, y1, z1, col); return; }
  const [hx0, hz0, hx1, hz1] = hole;
  add(kind, m, x0, y0, z0, x1, y1, hz0, col);
  add(kind, m, x0, y0, hz1, x1, y1, z1, col);
  add(kind, m, x0, y0, hz0, hx0, y1, hz1, col);
  add(kind, m, hx1, y0, hz0, x1, y1, hz1, col);
}

/** 계단 구멍 둘레 난간: 방 쪽 긴 변과 낮은 끝 (높은 끝은 드나드는 곳) */
function holeRail(add: Add, st: number[], y: number, kind: BoxKind, west: boolean): void {
  if (west) add(kind, 'metal', st[2], y, st[1], st[2] + 0.06, y + 1.0, st[3], RAIL_COL, RAIL);
  else add(kind, 'metal', st[0] - 0.06, y, st[1], st[0], y + 1.0, st[3], RAIL_COL, RAIL);
  add(kind, 'metal', st[0], y, st[1] - 0.06, st[2], y + 1.0, st[1], RAIL_COL, RAIL);
}

/** +z 로 올라가는 계단 (디딤마다 바닥부터 쌓은 상자) */
function stairsZ(add: Add, m: Mat, x0: number, x1: number, zStart: number, y0: number, height: number, dir: 1 | -1, col: number): void {
  const n = Math.max(1, Math.round(height / 0.3)), rise = height / n;
  for (let i = 0; i < n; i++) {
    const za = dir > 0 ? zStart + i * TREAD : zStart - (i + 1) * TREAD;
    add('stair', m, x0, y0, za, x1, y0 + (i + 1) * rise, za + TREAD, shade(col, i % 2 ? 0.96 : 1.02));
  }
}

function buildHouse(p: BPlan, add: Add, r: () => number): void {
  const { x0, z0, x1, z1, by, baseY, floors, floorH, mat } = p;
  const t = WALL_T[mat];
  const wh = p.style === 'warehouse';
  const church = p.variant === 'church';
  const fMat: Mat = mat === 'wood' ? 'wood' : 'concrete';
  const fCol = fMat === 'wood' ? 0x6b5640 : 0x7a7873;
  const sCol = fMat === 'wood' ? 0x6e5a44 : 0x85827b;
  const inner = mat === 'wood' ? 0xb3a58c : mat === 'metal' ? 0x7e8487 : 0xaea594;
  const Wd = x1 - x0, D = z1 - z0;
  const run = stairRun(floorH);
  const canStair = !wh && !church && D >= minStairDepth(floorH, mat) - 0.01 && Wd >= 2 * SW + 2 * t + 1.2;
  const stairAt = (L: number): number[] | null => {
    if (!canStair || !(L < floors - 1 || p.roofStair)) return null;
    const sz0 = z0 + t + 1.0;
    return L % 2 === 0 ? [x0 + t, sz0, x0 + t + SW, sz0 + run] : [x1 - t - SW, sz0, x1 - t, sz0 + run];
  };
  const wn = WIN[p.variant && WIN[p.variant] ? p.variant : p.style] || WIN.house;
  const clearH = floorH - ST;
  const winH1 = Math.min(wn.h1, clearH - 0.3), winH0 = Math.min(wn.h0, winH1 - 0.6);
  const doorH = church ? Math.min(3.0, clearH - 0.4) : Math.min(2.25, clearH - 0.3);
  const doorW = church ? 1.8 : 1.2;

  // 창고 중이층(메자닌): 큰 문 반대쪽 끝, 서쪽 벽을 따라 계단
  let mz: { z0: number; z1: number; north: boolean; sz0: number; sz1: number } | null = null;
  const hm = 3.3, mrun = stairRun(hm);
  if (wh && Wd >= 16 && D >= 14) {
    const north = !p.doors.includes(0);
    if (north) mz = { z0: z0 + t, z1: z0 + t + 5, north, sz0: z0 + t + 5, sz1: z0 + t + 5 + mrun };
    else mz = { z0: z1 - t - 5, z1: z1 - t, north, sz0: z1 - t - 5 - mrun, sz1: z1 - t - 5 };
  }

  // 문 자리 (벽 좌표, 벽 시작점 기준 중심). 계단 쪽 서벽은 피한다
  const sideLen = (s: number): number => (s < 2 ? Wd : D - 2 * t);
  const noDoor = (s: number): number[] | null => {
    if (s !== 2) return null;
    const st = stairAt(0);
    if (st) return [st[1] - (z0 + t) - 0.6, st[3] - (z0 + t) + 0.6];
    if (mz) return [mz.sz0 - (z0 + t) - 0.6, mz.sz1 - (z0 + t) + 0.6];
    return null;
  };
  const doorCenter = (s: number, dw: number): number => {
    const len = sideLen(s), clr = (s < 2 ? t : 0) + 0.25;
    let c = len / 2;
    const nd = noDoor(s);
    if (nd && c + dw / 2 > nd[0] && c - dw / 2 < nd[1]) {
      if (nd[1] + dw <= len - clr) c = nd[1] + dw / 2;
      else if (nd[0] - dw >= clr) c = nd[0] - dw / 2;
      else return -1;
    }
    if (c - dw / 2 < clr || c + dw / 2 > len - clr) return -1;
    return c;
  };
  const bigW = (s: number): number => Math.min(4.6, sideLen(s) - 2);
  const doorSpec = new Map<number, { c: number; w: number; h: number }>();
  for (const s of p.doors) {
    const big = (wh || p.variant === 'barn') && s < 2;
    const dw = big ? bigW(s) : doorW;
    const c = doorCenter(s, dw);
    if (c > 0) doorSpec.set(s, { c, w: dw, h: big ? Math.min(4.8, clearH - 1.0) : doorH });
  }
  if (doorSpec.size === 0) {
    // 문이 하나도 안 나면 남쪽 또는 북쪽 가운데에 억지로
    for (const s of [1, 0]) { const c = doorCenter(s, doorW); if (c > 0) { doorSpec.set(s, { c, w: doorW, h: doorH }); break; } }
  }

  const ops = (s: number, L: number): Op[] => {
    const len = sideLen(s), clr = (s < 2 ? t : 0) + 0.25;
    const out: Op[] = [];
    const ds = L === 0 ? doorSpec.get(s) : undefined;
    if (ds) out.push({ a: ds.c - ds.w / 2, b: ds.c + ds.w / 2, door: true, h0: 0, h1: ds.h });
    if (wn.p > 0) {
      const n = Math.max(1, Math.round(len / wn.pitch)), pw = len / n;
      const isHi = wh || p.variant === 'barn';
      for (let k = 0; k < n; k++) {
        const c = (k + 0.5) * pw, ww = Math.min(wn.w, pw - (isHi ? 1.0 : 0.8));
        if (ww < 0.6) continue;
        const a = c - ww / 2, b = c + ww / 2;
        if (a < clr || b > len - clr) continue;
        if (ds && b + 0.4 > ds.a && a - 0.4 < ds.b) continue;
        if (r() > wn.p) continue;
        out.push({ a, b, door: false, h0: isHi ? Math.min(wn.h0, clearH - 2.0) : winH0, h1: isHi ? Math.min(wn.h1, clearH - 0.5) : winH1 });
      }
    }
    out.sort((u, v) => u.a - v.a);
    return out;
  };

  /** 벽 한 줄. axis 'x' = x 방향으로 뻗는 벽(북·남), 'z' = z 방향(서·동) */
  const wallLine = (axis: 'x' | 'z', f0: number, f1: number, a0: number, len: number, yBot: number, yL: number, yTop: number, list: Op[], m: Mat, col: number, trim: number): void => {
    const piece = (a: number, b: number, ya: number, yb: number, kind: BoxKind, pm: Mat, c: number, glass: boolean): void => {
      let g0 = f0, g1 = f1;
      if (glass) { const mid = (f0 + f1) / 2; g0 = mid - 0.03; g1 = mid + 0.03; }
      if (axis === 'x') add(kind, pm, a0 + a, ya, g0, a0 + b, yb, g1, c);
      else add(kind, pm, g0, ya, a0 + a, g1, yb, a0 + b, c);
    };
    const solid = (a: number, b: number): void => {
      const l = b - a;
      if (l < 0.05) return;
      const n = Math.max(1, Math.ceil(l / 2.8 - 0.05));
      for (let i = 0; i < n; i++) piece(a + (l * i) / n, a + (l * (i + 1)) / n, yBot, yTop, 'wall', m, shade(col, 0.95 + r() * 0.09), false);
    };
    let cur = 0;
    for (const o of list) {
      solid(cur, o.a);
      if (o.door) piece(o.a, o.b, yL + o.h1, yTop, 'wall', m, trim, false);
      else {
        piece(o.a, o.b, yBot, yL + o.h0, 'wall', m, trim, false);
        piece(o.a, o.b, yL + o.h0, yL + o.h1, 'window', 'glass', GLASS_COL, true);
        piece(o.a, o.b, yL + o.h1, yTop, 'wall', m, trim, false);
      }
      cur = o.b;
    }
    solid(cur, len);
  };

  // 칸막이 위치 (x)
  const partX: number[] = [];
  if (!wh && !church && p.style !== 'shed') {
    if (p.style === 'apartment') { partX.push(x0 + Wd / 3, x0 + (2 * Wd) / 3); }
    else if (Wd >= (p.style === 'house' ? 9.5 : 12)) partX.push(x0 + Wd / 2);
  }
  const trimC = p.trim;

  add('floor', fMat, x0, baseY, z0, x1, by, z1, fCol);
  for (let L = 0; L < floors; L++) {
    const yL = by + L * floorH, yTop = yL + clearH, yBot = L === 0 ? baseY : yL;
    const st = stairAt(L);
    wallLine('x', z0, z0 + t, x0, Wd, yBot, yL, yTop, ops(0, L), mat, p.color, trimC);
    wallLine('x', z1 - t, z1, x0, Wd, yBot, yL, yTop, ops(1, L), mat, p.color, trimC);
    wallLine('z', x0, x0 + t, z0 + t, D - 2 * t, yBot, yL, yTop, ops(2, L), mat, p.color, trimC);
    wallLine('z', x1 - t, x1, z0 + t, D - 2 * t, yBot, yL, yTop, ops(3, L), mat, p.color, trimC);
    for (const xp of partX) {
      const len = D - 2 * t;
      const dc = len / 2;
      wallLine('z', xp - 0.075, xp + 0.075, z0 + t, len, yL, yL, yTop, [{ a: dc - 0.55, b: dc + 0.55, door: true, h0: 0, h1: doorH }], mat === 'metal' ? 'concrete' : mat, inner, inner);
    }
    if (st) stairsZ(add, fMat, st[0], st[2], st[1], yL, floorH, 1, sCol);
    const roofL = L === floors - 1;
    const yS = yL + floorH;
    slab(add, roofL ? 'roof' : 'floor', roofL && wh ? 'metal' : fMat, x0, yS - ST, z0, x1, yS, z1, st, roofL ? p.roofColor : fCol);
    if (st) holeRail(add, st, yS, roofL ? 'roof' : 'floor', L % 2 === 0);
  }

  // 지붕 둘레 낮은 난간 (창고·헛간·창고형 제외)
  const yR = by + floors * floorH;
  if (!wh && p.style !== 'shed') {
    const ph = p.style === 'house' ? 0.55 : 0.85;
    const pc = shade(p.color, 0.9);
    add('roof', mat, x0, yR, z0, x1, yR + ph, z0 + t, pc);
    add('roof', mat, x0, yR, z1 - t, x1, yR + ph, z1, pc);
    add('roof', mat, x0, yR, z0 + t, x0 + t, yR + ph, z1 - t, pc);
    add('roof', mat, x1 - t, yR, z0 + t, x1, yR + ph, z1 - t, pc);
  }
  if (p.style === 'house') add('roof', 'brick', x1 - t - 1.3, yR, z1 - t - 0.75, x1 - t - 0.7, yR + 1.4, z1 - t - 0.15, 0x6a4a3a);
  if (p.style === 'apartment' || p.style === 'office') {
    // 옥상 기계실 상자 (엄폐물 겸)
    const cx = x0 + Wd * 0.55, cz = z1 - t - 2.4;
    add('roof', 'metal', cx, yR, cz, cx + 2.2, yR + 1.3, cz + 1.6, 0x6d7174);
  }
  if (mz) {
    add('floor', 'concrete', x0 + t, by + hm - ST, mz.z0, x1 - t, by + hm, mz.z1, fCol);
    if (mz.north) {
      stairsZ(add, 'metal', x0 + t, x0 + t + SW, mz.sz1, by, hm, -1, 0x5c6063);
      add('floor', 'metal', x0 + t + SW, by + hm, mz.z1 - 0.06, x1 - t, by + hm + 1.0, mz.z1, RAIL_COL, RAIL);
    } else {
      stairsZ(add, 'metal', x0 + t, x0 + t + SW, mz.sz0, by, hm, 1, 0x5c6063);
      add('floor', 'metal', x0 + t + SW, by + hm, mz.z0, x1 - t, by + hm + 1.0, mz.z0 + 0.06, RAIL_COL, RAIL);
    }
  }
}

function buildTower(p: BPlan, add: Add, r: () => number): void {
  const { x0, z0, x1, z1, by, baseY, floors, floorH, mat } = p;
  const cw = 0.45, tw = 1.1;
  const run = stairRun(floorH);
  const sCol = 0x55585b, fCol = mat === 'brick' ? 0x6e6a64 : 0x5f6366;
  const fMat: Mat = mat === 'brick' ? 'concrete' : 'metal';
  add('floor', 'concrete', x0 - 0.4, baseY, z0 - 0.4, x1 + 0.4, by, z1 + 0.4, 0x77756f);
  for (let L = 0; L < floors; L++) {
    const yL = by + L * floorH, yTop = yL + floorH - ST, yBot = L === 0 ? baseY : yL;
    for (const [cx, cz] of [[x0, z0], [x1 - cw, z0], [x0, z1 - cw], [x1 - cw, z1 - cw]]) {
      add('wall', mat, cx, yBot, cz, cx + cw, yTop, cz + cw, shade(p.color, 0.94 + r() * 0.1));
    }
    const west = L % 2 === 0;
    const sx0 = west ? x0 + 0.5 : x1 - 0.5 - tw, sz0 = z0 + 0.7;
    const st = [sx0, sz0, sx0 + tw, sz0 + run];
    stairsZ(add, fMat, st[0], st[2], st[1], yL, floorH, 1, sCol);
    const top = L === floors - 1, y = yL + floorH, k: BoxKind = top ? 'roof' : 'floor';
    slab(add, k, fMat, x0, y - ST, z0, x1, y, z1, st, top ? p.roofColor : fCol);
    add(k, 'metal', x0, y, z0, x1, y + 1.05, z0 + 0.06, RAIL_COL, RAIL);
    add(k, 'metal', x0, y, z1 - 0.06, x1, y + 1.05, z1, RAIL_COL, RAIL);
    add(k, 'metal', x0, y, z0 + 0.06, x0 + 0.06, y + 1.05, z1 - 0.06, RAIL_COL, RAIL);
    add(k, 'metal', x1 - 0.06, y, z0 + 0.06, x1, y + 1.05, z1 - 0.06, RAIL_COL, RAIL);
    holeRail(add, st, y, k, west);
  }
  const yR = by + floors * floorH;
  const holeWest = (floors - 1) % 2 === 0;
  if (p.variant === 'radar') {
    const rx = holeWest ? x1 - 1.7 : x0 + 0.7;
    add('roof', 'metal', rx + 0.2, yR, z1 - 1.8, rx + 0.8, yR + 1.3, z1 - 1.2, 0x6a6d70);
    add('roof', 'metal', rx - 0.5, yR + 1.3, z1 - 1.62, rx + 1.5, yR + 2.8, z1 - 1.42, 0xc9c9c4);
  } else if (p.variant === 'bell') {
    // 종탑 지붕: 네 기둥 위 판
    const k: BoxKind = 'roof';
    for (const [cx, cz] of [[x0, z0], [x1 - cw, z0], [x0, z1 - cw], [x1 - cw, z1 - cw]]) add(k, mat, cx, yR, cz, cx + cw, yR + 2.4, cz + cw, p.color);
    add(k, mat, x0 - 0.2, yR + 2.4, z0 - 0.2, x1 + 0.2, yR + 2.7, z1 + 0.2, p.roofColor);
    add(k, 'metal', (x0 + x1) / 2 - 0.4, yR + 1.5, (z0 + z1) / 2 + 0.6, (x0 + x1) / 2 + 0.4, yR + 2.4, (z0 + z1) / 2 + 1.4, 0x8a6a3a);
  }
}
