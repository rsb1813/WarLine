// 건물 배치 계획: 본부, 거점마다 이름에 맞는 건물 무리와 엄폐물, 마을(거리 양옆), 흩어진 집.
import type { Mat } from '../types';
import type { BPlan, Style, Variant } from './build';
import { minStairDepth } from './build';
import {
  barrier, container, crates, fenceLine, fuelTank, FlagPlan, Gen, H, hay, occCircle, occFree, occMark,
  propBox, rectStats, rock, sandbagWall, Village, wreck,
} from './gctx';
import { mkBox, shade } from './core';
import type { World } from '../types';

const HOUSE_COLORS = [0x8e3b2f, 0x7a3a33, 0x3f5f7a, 0x4a6a86, 0x4f6b4a, 0x5d7553, 0xb08a3e, 0xa88f52, 0x4a7a78, 0xc2a35a, 0xb9b2a3, 0x9b5b3c];
const ROOF_COLORS = [0x3e3e40, 0x4a4644, 0x5a3a2c, 0x3c4a3a, 0x5b5f63];
const APT_COLORS = [0x8d8f8c, 0x9a9790, 0xa8a090, 0x8a9294, 0xb0a48e, 0x7f8a8c];
const OFFICE_COLORS = [0x8f8a80, 0x7a7f84, 0x9c8f7a, 0x6f6a64];
const BRICK_COLORS = [0x7a4a3a, 0x86513d, 0x6e4636];
const WH_COLORS = [0x6f7a80, 0x7d6a52, 0x5c6b5a, 0x8a8d8f, 0x6b5b4a, 0x4f5d6b];

const pick = <T>(G: Gen, a: T[]): T => a[Math.floor(G.r() * a.length) % a.length];
const rr = (G: Gen, a: number, b: number): number => a + (b - a) * G.r();

interface Dims { w: number; d: number; floors: number; floorH: number; mat: Mat; color: number; roofColor: number; trim: number; roofStair: boolean }

function dims(G: Gen, style: Style, v: Variant): Dims {
  const town = G.def.town;
  let w = 8, d = 7, floors = 1, floorH = 3, mat: Mat = 'wood', color = pick(G, HOUSE_COLORS), roofColor = pick(G, ROOF_COLORS), trim = 0xd6d1c4, roofStair = false;
  if (v === 'church') { w = rr(G, 9, 11); d = rr(G, 14, 17); floorH = 5.5; mat = G.r() < 0.5 ? 'brick' : 'wood'; color = mat === 'brick' ? 0xb8b2a6 : 0xc9c3b4; trim = 0x8a8478; roofColor = 0x3c4a3a; }
  else if (v === 'bell') { w = 4.6; d = 4.6; floors = 3; floorH = 3; mat = 'brick'; color = 0xb8b2a6; roofColor = 0x3c4a3a; }
  else if (v === 'radar') { w = 5; d = 5; floors = 4 + Math.floor(G.r() * 3); mat = 'metal'; color = 0x7c8084; roofColor = 0x5f6366; }
  else if (v === 'barn') { w = rr(G, 14, 18); d = rr(G, 12, 15); floorH = 5.5; mat = 'wood'; color = pick(G, [0x7e3326, 0x6e2f28, 0x5d4a3a]); roofColor = 0x4a4644; trim = 0xcfc8b8; }
  else if (v === 'school') { w = rr(G, 20, 26); d = rr(G, 10, 12); floors = 2; floorH = 3.2; mat = 'brick'; color = pick(G, [0xb08a3e, 0xa88f52, 0x9b5b3c]); trim = 0xd6d1c4; roofStair = true; }
  else if (v === 'hq') { w = 14; d = 11; floors = 2; floorH = 3.2; mat = 'concrete'; color = 0x7f8378; roofColor = 0x5b5f63; trim = shade(color, 0.85); roofStair = true; }
  else switch (style) {
    case 'house':
      w = rr(G, 7, 10); d = rr(G, 6.5, 8.5); floors = G.r() < 0.5 ? 2 : 1;
      mat = G.r() < 0.75 ? 'wood' : 'brick';
      if (mat === 'brick') { color = pick(G, BRICK_COLORS); trim = 0xc9c3b4; }
      roofStair = floors === 2 ? G.r() < 0.6 : G.r() < 0.35;
      break;
    case 'apartment':
      w = rr(G, 16, 24); d = rr(G, 10, 12.5); floors = town > 0.7 && G.r() < 0.35 ? 4 : 3;
      mat = 'concrete'; color = pick(G, APT_COLORS); roofColor = 0x5b5f63; trim = shade(color, 0.85); roofStair = true;
      break;
    case 'office':
      w = rr(G, 12, 18); d = rr(G, 10, 13); floors = G.r() < 0.5 ? 2 : 3; floorH = 3.2;
      mat = G.r() < 0.6 ? 'concrete' : 'brick'; color = mat === 'brick' ? pick(G, BRICK_COLORS) : pick(G, OFFICE_COLORS);
      roofColor = 0x55595c; trim = shade(color, 0.82); roofStair = true;
      break;
    case 'warehouse':
      w = rr(G, 18, 28); d = rr(G, 14, 20); floorH = 6.5;
      mat = G.r() < 0.8 ? 'metal' : 'brick'; color = mat === 'brick' ? pick(G, BRICK_COLORS) : pick(G, WH_COLORS);
      roofColor = shade(color, 0.8); trim = shade(color, 0.85);
      break;
    case 'shed':
      w = rr(G, 3.5, 5.5); d = rr(G, 3, 4.5); floorH = 2.7;
      mat = G.r() < 0.6 ? 'wood' : 'metal'; color = mat === 'metal' ? pick(G, WH_COLORS) : shade(pick(G, HOUSE_COLORS), 0.85);
      trim = shade(color, 0.85);
      break;
    case 'tower':
      w = 5; d = 5; floors = 4 + Math.floor(G.r() * 2); mat = 'metal'; color = 0x7c8084; roofColor = 0x5f6366;
      break;
  }
  if (style !== 'tower' && v !== 'bell' && v !== 'radar' && G.r() < 0.5) { const t = w; w = d; d = t; }
  // 계단이 들어갈 깊이 확보 (z 방향)
  if ((floors > 1 || roofStair) && style !== 'tower' && style !== 'warehouse') {
    const need = minStairDepth(floorH, mat) + 0.2;
    if (d < need) { if (w >= need) { const t = w; w = d; d = t; } else d = need; }
  }
  return { w, d, floors, floorH, mat, color, roofColor, trim, roofStair };
}

function planAt(G: Gen, style: Style, v: Variant, D: Dims, cx: number, cz: number, fx: number, fz: number): BPlan {
  const dx = fx - cx, dz = fz - cz;
  const main = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 2 : 3) : (dz < 0 ? 0 : 1);
  const opp = [1, 0, 3, 2][main];
  let doors: number[];
  if (style === 'warehouse') {
    doors = [dz < 0 ? 0 : 1];
    if (G.r() < 0.6) doors.push(3);
  } else if (style === 'tower') doors = [];
  else if (style === 'apartment' || style === 'office') doors = [main, opp];
  else if (style === 'house') doors = G.r() < 0.45 ? [main, opp] : [main];
  else doors = [main];
  return {
    style, variant: v,
    x0: cx - D.w / 2, z0: cz - D.d / 2, x1: cx + D.w / 2, z1: cz + D.d / 2,
    floors: D.floors, floorH: D.floorH, mat: D.mat, color: D.color, roofColor: D.roofColor, trim: D.trim,
    doors, roofStair: D.roofStair, by: 0, baseY: 0,
  };
}

/** 자리 검사 후 점유 표시하고 계획 목록에 넣기 */
function tryPlace(G: Gen, p: BPlan, margin = 1.5): boolean {
  const S = G.S;
  if (p.x0 < 8 || p.z0 < 8 || p.x1 > S - 8 || p.z1 > S - 8) return false;
  if (!occFree(G, p.x0 - margin, p.z0 - margin, p.x1 + margin, p.z1 + margin, true)) return false;
  const st = rectStats(G, p.x0 - 1, p.z0 - 1, p.x1 + 1, p.z1 + 1);
  if (G.W > -1e8 && st.min < G.W + 1.0) return false;
  if (st.max - st.min > 7) return false;
  for (const h of G.hqs) {
    const dx = Math.max(p.x0 - h.x, 0, h.x - p.x1), dz = Math.max(p.z0 - h.z, 0, h.z - p.z1);
    if (Math.hypot(dx, dz) < 22) return false;
  }
  occMark(G, p.x0 - margin, p.z0 - margin, p.x1 + margin, p.z1 + margin, 1);
  G.plans.push(p);
  return true;
}

function placeAround(G: Gen, cx: number, cz: number, rMin: number, rMax: number, style: Style, v: Variant = '', tries = 40): BPlan | null {
  for (let k = 0; k < tries; k++) {
    const D = dims(G, style, v);
    const half = Math.max(D.w, D.d) * 0.5;
    const a = G.r() * Math.PI * 2, dist = rMin + half * 0.7 + G.r() * Math.max(1, rMax - rMin);
    const px = cx + Math.cos(a) * dist, pz = cz + Math.sin(a) * dist;
    const p = planAt(G, style, v, D, px, pz, cx, cz);
    if (tryPlace(G, p)) return p;
  }
  return null;
}

function placeMany(G: Gen, cx: number, cz: number, rMin: number, rMax: number, list: [Style, Variant, number][]): BPlan[] {
  const out: BPlan[] = [];
  for (const [s, v, n] of list) for (let i = 0; i < n; i++) { const p = placeAround(G, cx, cz, rMin, rMax, s, v); if (p) out.push(p); }
  return out;
}

/** 집 마당 울타리 (문 쪽은 비움) */
function yardFence(G: Gen, p: BPlan): void {
  const m = 3.2;
  const x0 = p.x0 - m, x1 = p.x1 + m, z0 = p.z0 - m, z1 = p.z1 + m;
  const metal = G.def.theme === 'industrial';
  if (!p.doors.includes(0)) fenceLine(G, x0, z0, x1, z0, metal);
  if (!p.doors.includes(1)) fenceLine(G, x0, z1, x1, z1, metal);
  if (!p.doors.includes(2)) fenceLine(G, x0, z0, x0, z1, metal);
  if (!p.doors.includes(3)) fenceLine(G, x1, z0, x1, z1, metal);
}

/** 사각 둘레 울타리 (한두 군데 틈) */
function perimeterFence(G: Gen, x0: number, z0: number, x1: number, z1: number, metal: boolean): void {
  fenceLine(G, x0, z0, x1, z0, metal); fenceLine(G, x0, z1, x1, z1, metal);
  fenceLine(G, x0, z0, x0, z1, metal); fenceLine(G, x1, z0, x1, z1, metal);
}

function aroundPoint(G: Gen, cx: number, cz: number, r0: number, r1: number): [number, number] {
  const a = G.r() * Math.PI * 2, d = r0 + G.r() * (r1 - r0);
  return [cx + Math.cos(a) * d, cz + Math.sin(a) * d];
}

/** 거점 원 안 엄폐물 */
function flagCover(G: Gen, f: FlagPlan): void {
  const ind = G.def.theme === 'industrial';
  const want = 9 + Math.floor(G.r() * 4) + (f.r > 17 ? 2 : 0);
  let n = 0;
  for (let k = 0; k < want * 6 && n < want; k++) {
    const [x, z] = aroundPoint(G, f.x, f.z, 6.5, f.r + 5);
    const ax = G.r() < 0.5;
    const t = G.r();
    let ok = false;
    if (t < 0.3) ok = sandbagWall(G, x, z, rr(G, 2.4, 4.8), ax) > 0;
    else if (t < 0.42) { ok = sandbagWall(G, x, z, 3.6, ax) > 0; if (ok) sandbagWall(G, x + (ax ? 1.8 : 0.9) , z + (ax ? 0.9 + 0.35 : 1.8), 2.4, !ax); }
    else if (t < 0.56) ok = barrier(G, x, z, G.r() < 0.5 ? 3 : 6, ax) > 0;
    else if (t < (ind ? 0.78 : 0.68)) ok = container(G, x, z, ax, false, G.r() < 0.25 ? 2 : 1);
    else if (t < 0.84) ok = crates(G, x, z);
    else if (t < 0.93) ok = rock(G, x, z, rr(G, 1.3, 2.6));
    else ok = wreck(G, x, z, ax);
    if (ok) n++;
  }
}

/** 컨테이너 야적장 (격자) */
function containerYard(G: Gen, cx: number, cz: number, rows: number, cols: number): void {
  const alongX = G.r() < 0.5;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (G.r() < 0.18) continue;
    const ox = alongX ? (j - (cols - 1) / 2) * 14 : (i - (rows - 1) / 2) * 4.2;
    const oz = alongX ? (i - (rows - 1) / 2) * 4.2 : (j - (cols - 1) / 2) * 14;
    container(G, cx + ox, cz + oz, alongX, G.r() < 0.5, 1 + Math.floor(G.r() * (G.r() < 0.3 ? 3 : 2)));
  }
}

/** 부두: 바다 쪽(+x)으로 뻗는 상판 */
function pier(G: Gen, f: FlagPlan): void {
  if (!G.shoreX || G.W < -1e8) return;
  const len = 30, hw = 3;
  let pz = 0, x0 = -1;
  for (let k = 0; k < 8 && x0 < 0; k++) {
    const z = f.z + (k % 2 ? -1 : 1) * (6 + k * 3);
    let xs = -1;
    for (let x = f.x; x < G.S - 40; x += 1) if (H(G, x, z) < G.W + 0.3) { xs = x; break; }
    if (xs < 0) continue;
    // 상판과 뭍 쪽 접근로(12 m)가 비어 있어야
    if (!occFree(G, xs - 17, z - hw - 1, xs - 5, z + hw + 1, true)) continue;
    pz = z; x0 = xs - 5;
  }
  if (x0 < 0) return;
  occMark(G, x0 - 12, pz - hw - 1, x0 + len + 1, pz + hw + 1, 1);
  G.later.push(() => {
    const w = G.w;
    const top = G.W + 1.4;
    const startH = H(G, x0, pz);
    const nSeg = Math.ceil(len / 3);
    for (let i = 0; i < nSeg; i++) {
      const a = x0 + i * 3, b = Math.min(x0 + len, a + 3);
      const y1 = Math.min(top, Math.max(startH + 0.25 + i * 0.3, G.W + 0.6));
      mkDeck(w, a, y1 - 0.5, pz - hw, b, y1, pz + hw, 0x5e4a36);
    }
    for (let x = x0 + 6; x < x0 + len; x += 6) {
      for (const zz of [pz - hw + 0.2, pz + hw - 0.6]) {
        const g = H(G, x, zz) - 0.5;
        mkDeck(w, x, g, zz, x + 0.4, top - 0.5, zz + 0.4, 0x4a3a2c);
      }
    }
  });
}
function mkDeck(w: World, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number): void {
  mkBox(w, 'bridge', 'wood', x0, y0, z0, x1, y1, z1, col);
}

/** 거점 하나: 이름(종류)에 맞는 건물 무리 */
export function flagCluster(G: Gen, f: FlagPlan): void {
  const cx = f.x, cz = f.z, r0 = f.r * 0.45, r1 = f.r + 28;
  const ind = G.def.theme === 'industrial';
  switch (f.kind) {
    case 'harbor': {
      pier(G, f);
      placeMany(G, cx, cz, r0, r1, [['warehouse', '', 2], ['office', '', 1], ['shed', '', 2], ['house', '', 2]]);
      const [yx, yz] = aroundPoint(G, cx, cz, f.r + 6, f.r + 16);
      containerYard(G, yx, yz, 3, 3);
      break;
    }
    case 'bridge': {
      placeMany(G, cx, cz, r0, r1, [['house', '', 4], ['shed', '', 2], ['office', '', 1]]);
      const b = G.bridges[f.bridge];
      if (b) {
        const ez = Math.abs(cz - b.z0) < Math.abs(cz - b.z1) ? b.z0 - 3 : b.z1 + 3;
        const sgn = ez < b.zc ? -1 : 1;
        sandbagWall(G, b.x - 8.5, ez + sgn * 2, 3.6, false);
        sandbagWall(G, b.x + 8.5, ez + sgn * 2, 3.6, false);
        sandbagWall(G, b.x - 10, ez + sgn * 9, 4.8, true);
        sandbagWall(G, b.x + 10, ez + sgn * 9, 4.8, true);
      }
      break;
    }
    case 'church': {
      const ch = placeAround(G, cx, cz, r0, r0 + 14, 'house', 'church', 60);
      if (ch) {
        // 종탑을 교회 옆에
        const bx = ch.x1 + 3.4, bz = ch.z0 + 2.6;
        const D = dims(G, 'tower', 'bell');
        if (!tryPlace(G, planAt(G, 'tower', 'bell', D, bx, bz, cx, cz), 0.6)) tryPlace(G, planAt(G, 'tower', 'bell', D, ch.x0 - 3.4, bz, cx, cz), 0.6);
      }
      const hs = placeMany(G, cx, cz, r0, r1, [['house', '', 5], ['shed', '', 2]]);
      for (const p of hs) if (p.style === 'house' && G.r() < 0.6) yardFence(G, p);
      break;
    }
    case 'farm': {
      placeMany(G, cx, cz, r0, r1, [['warehouse', 'barn', 1], ['house', '', 3], ['shed', '', 3]]);
      for (let i = 0; i < 2; i++) {
        const [fx, fz] = aroundPoint(G, cx, cz, f.r + 10, f.r + 30);
        const fw = rr(G, 18, 30), fd = rr(G, 14, 22);
        perimeterFence(G, fx - fw / 2, fz - fd / 2, fx + fw / 2, fz + fd / 2, false);
      }
      for (let i = 0; i < 8; i++) { const [hx, hz] = aroundPoint(G, cx, cz, 5, f.r + 10); hay(G, hx, hz); }
      break;
    }
    case 'school': {
      const s = placeAround(G, cx, cz, r0, r0 + 16, 'office', 'school', 60);
      if (s) perimeterFence(G, s.x0 - 6, s.z0 - 6, s.x1 + 6, s.z1 + 6, true);
      placeMany(G, cx, cz, r0, r1, [['shed', '', 1], ['house', '', 3], ['apartment', '', 1]]);
      break;
    }
    case 'square': {
      placeMany(G, cx, cz, r0 + 4, r1, [['apartment', '', ind ? 2 : 3], ['office', '', 1], ['house', '', 2]]);
      // 기념비
      const [sx, sz] = aroundPoint(G, cx, cz, 6, 9);
      propBox(G, 'prop', 'concrete', sx - 1.6, sz - 1.6, sx + 1.6, sz + 1.6, 0.8, 0x8d8a84, { destructible: false });
      G.later.push(() => {
        const st = rectStats(G, sx - 0.6, sz - 0.6, sx + 0.6, sz + 0.6);
        mkBox(G.w, 'prop', 'concrete', sx - 0.6, st.avg + 0.8, sz - 0.6, sx + 0.6, st.avg + 4.2, sz + 0.6, 0x7e7b75, -1, { destructible: false });
      });
      break;
    }
    case 'depot': {
      placeMany(G, cx, cz, r0, r1, [['warehouse', '', ind ? 3 : 2], ['shed', '', 2], ['office', '', 1]]);
      const [yx, yz] = aroundPoint(G, cx, cz, f.r + 4, f.r + 14);
      containerYard(G, yx, yz, 2, 3);
      for (let i = 0; i < 4; i++) { const [px, pz] = aroundPoint(G, cx, cz, 6, f.r + 12); crates(G, px, pz); }
      break;
    }
    case 'refinery': {
      // 탱크 농장
      const [tx, tz] = aroundPoint(G, cx, cz, f.r + 8, f.r + 16);
      let made = 0;
      for (let i = 0; i < 3 && made < 6; i++) for (let j = 0; j < 2; j++) if (fuelTank(G, tx + (i - 1) * 11, tz + (j - 0.5) * 11, rr(G, 6, 8.5))) made++;
      placeMany(G, cx, cz, r0, r1, [['tower', '', 1], ['warehouse', '', 2], ['office', '', 1], ['shed', '', 2]]);
      for (let i = 0; i < 5; i++) {
        // 땅 위 배관 (낮은 엄폐물)
        const [px, pz] = aroundPoint(G, cx, cz, 6, f.r + 18);
        const ax = G.r() < 0.5, L = rr(G, 6, 14);
        propBox(G, 'prop', 'metal', ax ? px - L / 2 : px - 0.4, ax ? pz - 0.4 : pz - L / 2, ax ? px + L / 2 : px + 0.4, ax ? pz + 0.4 : pz + L / 2, 0.9, 0x8b8f87, { hp: 900 });
      }
      for (let i = 0; i < 3; i++) { const [px, pz] = aroundPoint(G, cx, cz, f.r, f.r + 15); container(G, px, pz, G.r() < 0.5, false, 1); }
      break;
    }
    case 'radar': {
      placeAround(G, cx, cz, r0, r0 + 10, 'tower', 'radar', 60);
      placeMany(G, cx, cz, r0, r1, [['office', '', 1], ['shed', '', 2], ['house', '', 1]]);
      for (let i = 0; i < 4; i++) { const [px, pz] = aroundPoint(G, cx, cz, f.r * 0.6, f.r + 6); sandbagWall(G, px, pz, 4.8, G.r() < 0.5); }
      for (let i = 0; i < 3; i++) { const [px, pz] = aroundPoint(G, cx, cz, f.r, f.r + 14); container(G, px, pz, G.r() < 0.5, false, 1); }
      break;
    }
    case 'checkpoint': {
      placeMany(G, cx, cz, r0, r1, [['shed', '', 2], ['house', '', 2], ['office', '', 1]]);
      for (let i = 0; i < 5; i++) { const [px, pz] = aroundPoint(G, cx, cz, 5, f.r); barrier(G, px, pz, 6, G.r() < 0.5); }
      break;
    }
    case 'station': {
      placeAround(G, cx, cz, r0, r0 + 12, 'tower', 'radar', 60);
      placeMany(G, cx, cz, r0, r1, [['office', '', 1], ['shed', '', 2], ['house', '', 2]]);
      break;
    }
  }
  flagCover(G, f);
}

/** 본부: 평평한 마당, 지휘소, 창고, 컨테이너, 모래주머니. 차량 자리는 gen 이 정한다 */
export function hqCompound(G: Gen, team: 0 | 1, padRects: number[][]): void {
  const h = G.hqs[team];
  const s = h.s; // 앞쪽(지도 가운데) z 부호
  const side = team === 0 ? 1 : -1; // 지휘소는 헬기장 반대편
  for (const pr of padRects) occMark(G, pr[0], pr[1], pr[2], pr[3], 1);
  occCircle(G, h.x, h.z, 12, 1);
  const D = dims(G, 'office', 'hq');
  const hp = planAt(G, 'office', 'hq', D, h.x + side * 34, h.z - s * 6, h.x, h.z + s * 30);
  if (!tryPlaceHQ(G, hp)) tryPlaceHQ(G, planAt(G, 'office', 'hq', D, h.x + side * 40, h.z - s * 16, h.x, h.z + s * 30));
  for (let i = 0; i < 2; i++) {
    const Ds = dims(G, 'shed', '');
    tryPlaceHQ(G, planAt(G, 'shed', '', Ds, h.x + side * (22 + i * 7), h.z - s * 22, h.x, h.z));
  }
  // 뒤쪽 컨테이너 줄
  for (let i = 0; i < 5; i++) container(G, h.x + (i - 2) * 7.5, h.z - s * 19, false, false, 1 + (i % 2));
  // 앞쪽 모래주머니 방어선
  for (let i = -3; i <= 3; i++) sandbagWall(G, h.x + i * 12, h.z + s * 44, 4.8, true);
  barrier(G, h.x - side * 30, h.z + s * 36, 6, true);
  barrier(G, h.x + side * 30, h.z + s * 36, 6, true);
}

function tryPlaceHQ(G: Gen, p: BPlan): boolean {
  if (p.x0 < 8 || p.z0 < 4 || p.x1 > G.S - 8 || p.z1 > G.S - 4) return false;
  if (!occFree(G, p.x0 - 1.5, p.z0 - 1.5, p.x1 + 1.5, p.z1 + 1.5, true)) return false;
  occMark(G, p.x0 - 1.5, p.z0 - 1.5, p.x1 + 1.5, p.z1 + 1.5, 1);
  G.plans.push(p);
  return true;
}

/** 마을: 거리 양옆으로 집, 마당 울타리, 버려진 차 */
export function village(G: Gen, v: Village): void {
  const ind = G.def.theme === 'industrial';
  const town = G.def.town;
  const target = 4 + Math.round(town * 8) + Math.floor(G.r() * 3);
  let placed = 0;
  const chooseStyle = (): Style => {
    const t = G.r();
    if (ind) return t < 0.35 ? 'house' : t < 0.6 ? 'warehouse' : t < 0.78 ? 'apartment' : t < 0.88 ? 'office' : 'shed';
    if (town > 0.55) return t < 0.55 ? 'house' : t < 0.7 ? 'shed' : t < 0.85 ? 'apartment' : t < 0.93 ? 'office' : 'warehouse';
    return t < 0.68 ? 'house' : t < 0.9 ? 'shed' : t < 0.96 ? 'warehouse' : 'apartment';
  };
  const half = v.len / 2;
  for (let s = -half + 6; s < half - 4 && placed < target; ) {
    let adv = 6;
    for (const sideSign of [-1, 1]) {
      if (placed >= target) break;
      const style = chooseStyle();
      const D = dims(G, style, '');
      const along = v.axis === 0 ? D.w : D.d, perp = v.axis === 0 ? D.d : D.w;
      const off = 3.5 + 2.5 + G.r() * 3 + perp / 2;
      const sc = s + along / 2;
      const cx = v.axis === 0 ? v.x + sc : v.x + sideSign * off;
      const cz = v.axis === 0 ? v.z + sideSign * off : v.z + sc;
      const fx = v.axis === 0 ? cx : v.x, fz = v.axis === 0 ? v.z : cz;
      const p = planAt(G, style, '', D, cx, cz, fx, fz);
      if (tryPlace(G, p)) {
        placed++;
        adv = Math.max(adv, along + 2 + G.r() * 4);
        if (p.style === 'house' && G.r() < 0.5) yardFence(G, p);
      }
    }
    s += adv;
  }
  // 거리에서 떨어진 뒷집
  for (let k = 0; k < 30 && placed < target; k++) {
    const p = placeAround(G, v.x, v.z, 14, half + 22, chooseStyle(), '', 1);
    if (p) placed++;
  }
  for (let i = 0; i < 2 + Math.floor(G.r() * 3); i++) {
    const t = (G.r() - 0.5) * v.len, o = (G.r() < 0.5 ? -1 : 1) * 5.6;
    const x = v.axis === 0 ? v.x + t : v.x + o, z = v.axis === 0 ? v.z + o : v.z + t;
    wreck(G, x, z, v.axis === 0);
  }
  for (let i = 0; i < 3; i++) { const [px, pz] = aroundPoint(G, v.x, v.z, 6, half + 10); if (G.r() < 0.5) crates(G, px, pz); else sandbagWall(G, px, pz, 3.6, G.r() < 0.5); }
  if (ind) {
    const [yx, yz] = aroundPoint(G, v.x, v.z, half * 0.5, half + 18);
    containerYard(G, yx, yz, 2, 2);
    const [tx, tz] = aroundPoint(G, v.x, v.z, half * 0.4, half + 20);
    for (let i = 0; i < 2; i++) fuelTank(G, tx + i * 9, tz, rr(G, 5, 7));
  }
}

/** 길가 외딴 건물 (헛간, 집, 감시탑) */
export function scattered(G: Gen, count: number): void {
  const rs = G.roadS;
  if (rs.length < 3) return;
  let made = 0;
  for (let k = 0; k < count * 12 && made < count; k++) {
    const i = Math.floor(G.r() * (rs.length / 3)) * 3;
    const x = rs[i], z = rs[i + 1], hw = rs[i + 2];
    let near = false;
    for (const f of G.flags) if (Math.hypot(f.x - x, f.z - z) < f.r + 40) near = true;
    for (const v of G.villages) if (Math.hypot(v.x - x, v.z - z) < v.len / 2 + 30) near = true;
    for (const h of G.hqs) if (Math.hypot(h.x - x, h.z - z) < 110) near = true;
    if (near) continue;
    const t = G.r();
    const style: Style = t < 0.45 ? 'shed' : t < 0.85 ? 'house' : 'tower';
    const D = dims(G, style, '');
    const a = G.r() * Math.PI * 2, off = hw + 4 + Math.max(D.w, D.d) / 2 + G.r() * 6;
    const cx = x + Math.cos(a) * off, cz = z + Math.sin(a) * off;
    if (tryPlace(G, planAt(G, style, '', D, cx, cz, x, z))) {
      made++;
      if (G.r() < 0.5) sandbagWall(G, cx + (G.r() - 0.5) * 10, cz + (G.r() - 0.5) * 10, 3.6, G.r() < 0.5);
    }
  }
}

/** 길가 잔해·버려진 차 */
export function roadside(G: Gen, count: number): void {
  const rs = G.roadS;
  if (rs.length < 9) return;
  for (let k = 0; k < count; k++) {
    const i = Math.floor(G.r() * (rs.length / 3 - 1)) * 3;
    const x = rs[i], z = rs[i + 1], hw = rs[i + 2];
    const dx = rs[i + 3] - x, dz = rs[i + 4] - z, L = Math.hypot(dx, dz) || 1;
    const sgn = G.r() < 0.5 ? -1 : 1, off = hw + 3.6;
    const px = x - (dz / L) * off * sgn, pz = z + (dx / L) * off * sgn;
    if (G.r() < 0.6) wreck(G, px, pz, Math.abs(dx) > Math.abs(dz));
    else rock(G, px, pz, rr(G, 1.2, 2.4));
  }
}
