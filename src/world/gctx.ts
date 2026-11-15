// 생성 중에만 쓰는 상태: 점유 격자, 평탄화, 강·해안 모양, 소품(나중에 높이가 확정되면 상자로 만든다).
import type { BoxKind, MapDef, Mat, World } from '../types';
import type { BPlan } from './build';
import { BoxOpt, mkBox, shade } from './core';
import { heightAt } from './terrain';
import { smoothstep } from '../math';

export interface River { mid: number; A1: number; k1: number; p1: number; A2: number; k2: number; p2: number; hw: number }
export const riverZ = (rv: River, x: number): number => rv.mid + rv.A1 * Math.sin(x * rv.k1 + rv.p1) + rv.A2 * Math.sin(x * rv.k2 + rv.p2);
export const riverSlope = (rv: River, x: number): number => rv.A1 * rv.k1 * Math.cos(x * rv.k1 + rv.p1) + rv.A2 * rv.k2 * Math.cos(x * rv.k2 + rv.p2);
/** 강 중심선까지 (근사) 수직 거리 */
export const riverDist = (rv: River, x: number, z: number): number => {
  const s = riverSlope(rv, x);
  return Math.abs(z - riverZ(rv, x)) / Math.sqrt(1 + s * s);
};

export interface Bridge { x: number; zc: number; z0: number; z1: number; hw: number; used: boolean }
export type ClusterKind = 'harbor' | 'bridge' | 'church' | 'farm' | 'school' | 'square' | 'depot' | 'refinery' | 'radar' | 'checkpoint' | 'station';
export interface FlagPlan { x: number; z: number; r: number; name: string; kind: ClusterKind; bridge: number }
export interface Village { x: number; z: number; axis: 0 | 1; len: number }
export interface HQPlan { x: number; z: number; team: 0 | 1; s: number }

export interface Gen {
  w: World; def: MapDef; S: number; r: () => number;
  /** 수면 (없으면 -1e9) */
  W: number;
  river: River | null;
  shoreX: ((z: number) => number) | null;
  bridges: Bridge[];
  flags: FlagPlan[];
  villages: Village[];
  hqs: HQPlan[];
  /** 2 m 점유 격자: 0 빈칸, 1 막힘(건물·도로·소품), 2 나무 */
  occ: Uint8Array; on: number;
  plans: BPlan[];
  later: (() => void)[];
  /** 도로 표본 (x, z, 반폭) 반복, 2.5 m 간격 */
  roadS: number[];
}

export const OC = 2;

export const H = (G: Gen, x: number, z: number): number => heightAt(G.w, x, z);

export function occFree(G: Gen, x0: number, z0: number, x1: number, z1: number, allowTree = false): boolean {
  if (x0 < 0 || z0 < 0 || x1 > G.S || z1 > G.S) return false;
  const n = G.on;
  const i0 = Math.max(0, Math.floor(x0 / OC)), i1 = Math.min(n - 1, Math.floor(x1 / OC));
  const j0 = Math.max(0, Math.floor(z0 / OC)), j1 = Math.min(n - 1, Math.floor(z1 / OC));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const v = G.occ[j * n + i];
    if (v === 1 || (v === 2 && !allowTree)) return false;
  }
  return true;
}

export function occMark(G: Gen, x0: number, z0: number, x1: number, z1: number, v: number): void {
  const n = G.on;
  const i0 = Math.max(0, Math.floor(x0 / OC)), i1 = Math.min(n - 1, Math.floor(x1 / OC));
  const j0 = Math.max(0, Math.floor(z0 / OC)), j1 = Math.min(n - 1, Math.floor(z1 / OC));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * n + i;
    if (G.occ[k] !== 1) G.occ[k] = v;
  }
}

export function occCircle(G: Gen, cx: number, cz: number, rad: number, v: number): void {
  const n = G.on;
  const i0 = Math.max(0, Math.floor((cx - rad) / OC)), i1 = Math.min(n - 1, Math.floor((cx + rad) / OC));
  const j0 = Math.max(0, Math.floor((cz - rad) / OC)), j1 = Math.min(n - 1, Math.floor((cz + rad) / OC));
  const r2 = (rad + OC * 0.5) * (rad + OC * 0.5);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = (i + 0.5) * OC - cx, dz = (j + 0.5) * OC - cz;
    if (dx * dx + dz * dz > r2) continue;
    const k = j * n + i;
    if (G.occ[k] !== 1) G.occ[k] = v;
  }
}

/** 사각형 안 지형 높이 최소·최대·평균 (3×3 표본) */
export function rectStats(G: Gen, x0: number, z0: number, x1: number, z1: number): { min: number; max: number; avg: number } {
  let mn = Infinity, mx = -Infinity, s = 0;
  for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) {
    const h = H(G, x0 + ((x1 - x0) * a) / 2, z0 + ((z1 - z0) * b) / 2);
    if (h < mn) mn = h; if (h > mx) mx = h; s += h;
  }
  return { min: mn, max: mx, avg: s / 9 };
}

/** 원 평탄화: r0 안은 strength 만큼 target 으로, r1 까지 부드럽게 */
export function flattenCircle(G: Gen, cx: number, cz: number, r0: number, r1: number, target: number, strength: number): void {
  const w = G.w, n = w.hfN, c = w.hfCell, s = n + 1, Hh = w.heights;
  const i0 = Math.max(0, Math.floor((cx - r1) / c)), i1 = Math.min(n, Math.ceil((cx + r1) / c));
  const j0 = Math.max(0, Math.floor((cz - r1) / c)), j1 = Math.min(n, Math.ceil((cz + r1) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i * c - cx, j * c - cz);
    if (d >= r1) continue;
    const wt = strength * (1 - smoothstep(r0, r1, d));
    const k = j * s + i;
    Hh[k] += (target - Hh[k]) * wt;
  }
}

// ───────────────────────── 소품 (점유는 바로, 상자는 나중에) ─────────────────────────

const inMap = (G: Gen, x0: number, z0: number, x1: number, z1: number): boolean => x0 > 2 && z0 > 2 && x1 < G.S - 2 && z1 < G.S - 2;
const wet = (G: Gen, x0: number, z0: number, x1: number, z1: number): boolean =>
  G.W > -1e8 && rectStats(G, x0, z0, x1, z1).min < G.W + 0.3;

export function propBox(G: Gen, kind: BoxKind, mat: Mat, x0: number, z0: number, x1: number, z1: number, h: number, color: number, o?: BoxOpt, check = true): boolean {
  if (!inMap(G, x0, z0, x1, z1)) return false;
  if (check && (!occFree(G, x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2) || wet(G, x0, z0, x1, z1))) return false;
  occMark(G, x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, 1);
  G.later.push(() => {
    const s = rectStats(G, x0, z0, x1, z1);
    mkBox(G.w, kind, mat, x0, s.min - 0.25, z0, x1, s.avg + h, z1, color, -1, o);
  });
  return true;
}

export const CONTAINER_COLORS = [0x8a3324, 0x2f5a7a, 0x3f6b43, 0xb5652a, 0x7d7f80, 0x9a8a3a, 0x5a3d6b, 0x6e2f2a, 0x34606a];

/** 선적 컨테이너 (20ft/40ft), levels 층 쌓기 */
export function container(G: Gen, cx: number, cz: number, alongX: boolean, long: boolean, levels: number, check = true): boolean {
  const L = long ? 12.19 : 6.06, Wc = 2.44, Hc = 2.59;
  const hx = (alongX ? L : Wc) / 2, hz = (alongX ? Wc : L) / 2;
  const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz;
  if (!inMap(G, x0, z0, x1, z1)) return false;
  if (check && (!occFree(G, x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3) || wet(G, x0, z0, x1, z1))) return false;
  occMark(G, x0 - 0.4, z0 - 0.4, x1 + 0.4, z1 + 0.4, 1);
  const cols = [0, 1, 2].map(() => CONTAINER_COLORS[Math.floor(G.r() * CONTAINER_COLORS.length)]);
  G.later.push(() => {
    const s = rectStats(G, x0, z0, x1, z1);
    const base = s.max - 0.05;
    for (let k = 0; k < levels; k++) {
      mkBox(G.w, 'container', 'metal', x0, k === 0 ? s.min - 0.25 : base + k * Hc, z0, x1, base + (k + 1) * Hc, z1, cols[k % 3], -1, { hp: 2200 });
    }
  });
  return true;
}

/** 모래주머니 벽 (2.4 m 이하 토막으로 따로 부서진다) */
export function sandbagWall(G: Gen, cx: number, cz: number, len: number, alongX: boolean): number {
  const n = Math.max(1, Math.ceil(len / 2.4)), seg = len / n, th = 0.7;
  const col = G.def.theme === 'snow' ? 0xa39a82 : 0x8f8466;
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + i * seg;
    const x0 = alongX ? cx + a : cx - th / 2, x1 = alongX ? cx + a + seg : cx + th / 2;
    const z0 = alongX ? cz - th / 2 : cz + a, z1 = alongX ? cz + th / 2 : cz + a + seg;
    if (propBox(G, 'sandbag', 'sand', x0, z0, x1, z1, 1.05, shade(col, 0.93 + G.r() * 0.12), { hp: 250 })) ok++;
  }
  return ok;
}

/** 콘크리트 방벽 줄 (kind 'cover') */
export function barrier(G: Gen, cx: number, cz: number, len: number, alongX: boolean, check = true): number {
  const n = Math.max(1, Math.round(len / 3)), seg = len / n, th = 0.5;
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + i * seg + 0.05;
    const x0 = alongX ? cx + a : cx - th / 2, x1 = alongX ? cx + a + seg - 0.1 : cx + th / 2;
    const z0 = alongX ? cz - th / 2 : cz + a, z1 = alongX ? cz + th / 2 : cz + a + seg - 0.1;
    if (propBox(G, 'cover', 'concrete', x0, z0, x1, z1, 1.0, shade(0x9c9a94, 0.92 + G.r() * 0.1), { hp: 700 }, check)) ok++;
  }
  return ok;
}

/** 축 정렬 울타리 선 (3 m 토막, 막힌 토막은 건너뜀 → 자연스러운 틈) */
export function fenceLine(G: Gen, x0: number, z0: number, x1: number, z1: number, metal: boolean): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const n = Math.max(1, Math.round(len / 3)), seg = len / n;
  const sx = Math.min(x0, x1), sz = Math.min(z0, z1);
  const th = 0.08, h = metal ? 2.0 : 1.2;
  for (let i = 0; i < n; i++) {
    if (G.r() < 0.06) continue;
    const a = i * seg + 0.05, b = (i + 1) * seg - 0.05;
    const ax0 = alongX ? sx + a : x0 - th / 2, ax1 = alongX ? sx + b : x0 + th / 2;
    const az0 = alongX ? z0 - th / 2 : sz + a, az1 = alongX ? z0 + th / 2 : sz + b;
    propBox(G, 'fence', metal ? 'metal' : 'wood', ax0, az0, ax1, az1, h, metal ? 0x7a7f84 : shade(0x6b5a45, 0.9 + G.r() * 0.2), { hp: metal ? 120 : 60 });
  }
}

/** 나무 상자 1~3개 */
export function crates(G: Gen, cx: number, cz: number): boolean {
  const s = 1.2, x0 = cx - s / 2, z0 = cz - s / 2;
  if (!inMap(G, x0 - 1.4, z0 - 1.4, x0 + s + 1.4, z0 + s + 1.4) || !occFree(G, x0 - 0.2, z0 - 0.2, x0 + s + 0.2, z0 + s + 0.2) || wet(G, x0, z0, x0 + s, z0 + s)) return false;
  const n = 1 + Math.floor(G.r() * 3);
  const side = G.r() < 0.5;
  const col = 0x76603f;
  occMark(G, x0 - 0.3, z0 - 0.3, x0 + s * 2.2 + 0.3, z0 + s + 0.3, 1);
  G.later.push(() => {
    const st = rectStats(G, x0, z0, x0 + s, z0 + s);
    const base = st.max - 0.02;
    mkBox(G.w, 'prop', 'wood', x0, st.min - 0.2, z0, x0 + s, base + s, z0 + s, col, -1, { hp: 150 });
    if (n >= 2) {
      if (side) mkBox(G.w, 'prop', 'wood', x0 + s + 0.05, st.min - 0.2, z0 + 0.1, x0 + 2 * s, base + s * 0.9, z0 + s * 0.95, shade(col, 0.9), -1, { hp: 150 });
      else mkBox(G.w, 'prop', 'wood', x0 + 0.1, base + s, z0 + 0.05, x0 + s - 0.05, base + 2 * s - 0.1, z0 + s - 0.1, shade(col, 1.08), -1, { hp: 150 });
    }
    if (n >= 3 && side) mkBox(G.w, 'prop', 'wood', x0 + 0.1, base + s, z0 + 0.1, x0 + s - 0.1, base + 2 * s - 0.15, z0 + s - 0.1, shade(col, 0.95), -1, { hp: 150 });
  });
  return true;
}

/** 연료 탱크 (큰 상자 + 꼭대기) */
export function fuelTank(G: Gen, cx: number, cz: number, size: number): boolean {
  const hx = size / 2, x0 = cx - hx, z0 = cz - hx, x1 = cx + hx, z1 = cz + hx;
  if (!inMap(G, x0, z0, x1, z1) || !occFree(G, x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5) || wet(G, x0, z0, x1, z1)) return false;
  occMark(G, x0 - 1, z0 - 1, x1 + 1, z1 + 1, 1);
  const h = size * (0.7 + G.r() * 0.35);
  const col = G.r() < 0.6 ? 0xc3c1b9 : 0x8b8f87;
  G.later.push(() => {
    const st = rectStats(G, x0, z0, x1, z1);
    mkBox(G.w, 'prop', 'metal', x0, st.min - 0.3, z0, x1, st.max + h, z1, col, -1, { hp: 1400 });
    mkBox(G.w, 'prop', 'metal', x0 + size * 0.2, st.max + h, z0 + size * 0.2, x1 - size * 0.2, st.max + h + 0.6, z1 - size * 0.2, shade(col, 0.92), -1, { hp: 1400 });
  });
  return true;
}

/** 바위 (부서지지 않음) */
export function rock(G: Gen, cx: number, cz: number, size: number, check = true): boolean {
  const wd = size, dp = size * (0.6 + G.r() * 0.4), h = size * (0.45 + G.r() * 0.4);
  const x0 = cx - wd / 2, x1 = cx + wd / 2, z0 = cz - dp / 2, z1 = cz + dp / 2;
  if (!inMap(G, x0, z0, x1, z1)) return false;
  if (check && !occFree(G, x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3)) return false;
  occMark(G, x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, 1);
  const col = shade(G.def.theme === 'industrial' ? 0x6a6763 : 0x6e6b66, 0.82 + G.r() * 0.3);
  G.later.push(() => {
    const st = rectStats(G, x0, z0, x1, z1);
    mkBox(G.w, 'rock', 'rock', x0, st.min - h * 0.35, z0, x1, st.avg + h * 0.65, z1, col);
  });
  return true;
}

/** 버려진 차 (엄폐물) */
export function wreck(G: Gen, cx: number, cz: number, alongX: boolean): boolean {
  const L = 4.3, Wd = 1.9;
  const hx = (alongX ? L : Wd) / 2, hz = (alongX ? Wd : L) / 2;
  const cols = [0x5a4030, 0x4a4f52, 0x6b5a3a, 0x3d4a3a];
  return propBox(G, 'prop', 'metal', cx - hx, cz - hz, cx + hx, cz + hz, 1.45, cols[Math.floor(G.r() * cols.length)], { hp: 600 });
}

/** 건초 더미 */
export function hay(G: Gen, cx: number, cz: number): boolean {
  return propBox(G, 'prop', 'foliage', cx - 0.8, cz - 0.6, cx + 0.8, cz + 0.6, 1.1, shade(0xb39a55, 0.9 + G.r() * 0.15), { hp: 80 });
}
