// 세계 생성: 배치(본부·거점·마을·다리) → 지형(fbm, 강·해안, 평탄화) → 도로 → 건물·소품 → 지면 종류 → 바위·나무 → 공간 색인.
import type { FlagSite, GroundType, MapDef, Road, Team, Tree, World } from '../types';
import { clamp, fbm, lerp, rng, smoothstep, valueNoise, yawTo } from '../math';
import { buildIndex, mkBox, shade } from './core';
import { buildBuilding } from './build';
import {
  ClusterKind, FlagPlan, Gen, H, occCircle, occMark, OC, rectStats, riverDist, riverSlope, riverZ, rock,
} from './gctx';
import { flagCluster, hqCompound, roadside, scattered, village } from './clusters';

type P2 = { x: number; z: number };

const NAME_KIND: Record<string, ClusterKind> = {
  '항구': 'harbor', '다리': 'bridge', '교회': 'church', '농장': 'farm', '학교': 'school', '광장': 'square',
  '창고': 'depot', '화물역': 'depot', '정유 탑': 'refinery', '발전소': 'refinery', '레이더 기지': 'radar',
  '기상 관측소': 'station', '검문소': 'checkpoint', '송신탑': 'station', '채석장': 'checkpoint', '등대': 'station',
};
const POOLS: Record<MapDef['theme'], string[]> = {
  industrial: ['정유 탑', '창고', '발전소', '화물역', '레이더 기지', '검문소', '광장', '학교', '교회'],
  snow: ['교회', '농장', '레이더 기지', '학교', '광장', '창고', '기상 관측소', '검문소', '정유 탑'],
  tundra: ['농장', '교회', '기상 관측소', '레이더 기지', '학교', '창고', '검문소', '광장', '정유 탑'],
};
const EXTRA_NAMES = ['송신탑', '채석장', '등대', '북쪽 고지', '남쪽 고지', '숲속 오두막', '철길 건널목', '옛 막사'];

/** 정규화한 거점 배치 (x, z), 지도 가운데 기준 180° 대칭 */
const TEMPLATES: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.38, 0.36], [0.62, 0.64]],
  3: [[0.35, 0.28], [0.5, 0.5], [0.65, 0.72]],
  4: [[0.32, 0.26], [0.66, 0.4], [0.34, 0.6], [0.68, 0.74]],
  5: [[0.3, 0.24], [0.68, 0.33], [0.5, 0.5], [0.32, 0.67], [0.7, 0.76]],
  6: [[0.28, 0.22], [0.7, 0.26], [0.38, 0.42], [0.62, 0.58], [0.3, 0.74], [0.72, 0.78]],
  7: [[0.25, 0.2], [0.68, 0.24], [0.32, 0.42], [0.5, 0.5], [0.68, 0.58], [0.32, 0.76], [0.75, 0.8]],
};

export function genWorld(def: MapDef, flagCount: number): World {
  const S = clamp(Math.round(def.size || 600), 200, 1400);
  const hfN = Math.max(16, Math.round(S / 3));
  const w: World = {
    def, size: S, hfN, hfCell: S / hfN,
    heights: new Float32Array((hfN + 1) * (hfN + 1)), ground: new Uint8Array(hfN * hfN),
    water: -1e9, boxes: [], buildings: [], trees: [], roads: [], flags: [],
    hq: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], vehicleSpawns: [], brokenLog: [], collapseLog: [], index: null,
  };
  const seed = (def.seed >>> 0) || 1;
  const on = Math.ceil(S / OC);
  const G: Gen = {
    w, def, S, r: rng(seed), W: -1e9, river: null, shoreX: null, bridges: [], flags: [], villages: [], hqs: [],
    occ: new Uint8Array(on * on), on, plans: [], later: [], roadS: [],
  };
  const nFlags = clamp(Math.round(flagCount) || 0, 0, 12);

  setupWater(G, seed);
  layoutHQ(G);
  layoutBridges(G);
  layoutFlags(G, nFlags);
  layoutVillages(G);
  rawTerrain(G, seed);
  basePads(G);
  const roadPolys = buildRoads(G);
  flattenRoads(G, roadPolys);
  carveRiver(G);
  markOccupancy(G);

  const padRects = vehicleSpawns(G);
  hqCompound(G, 0, padRects[0]);
  hqCompound(G, 1, padRects[1]);
  for (const f of G.flags) flagCluster(G, f);
  for (const v of G.villages) village(G, v);
  scattered(G, Math.round((3 + def.town * 7) * (S / 600) ** 2));
  roadside(G, Math.round((8 + def.town * 14) * (S / 600) ** 2));
  placeRocks(G);

  buildingPads(G);
  const br = rng(seed ^ 0x5bd1e995);
  const gfn = (x: number, z: number): number => H(G, x, z);
  for (const p of G.plans) buildBuilding(w, p, br, gfn);
  groundTypes(G, seed);
  buildBridges(G);
  for (const fn of G.later) fn();
  G.later.length = 0;
  plantTrees(G, seed);

  // 마무리
  w.hq = [0, 1].map((t) => { const h = G.hqs[t]; return { x: h.x, y: H(G, h.x, h.z), z: h.z }; }) as [typeof w.hq[0], typeof w.hq[1]];
  for (const v of w.vehicleSpawns) v.pos.y = H(G, v.pos.x, v.pos.z);
  const order = G.flags.slice().sort((a, b) => b.z - a.z);
  w.flags = order.map((f, i): FlagSite => ({ id: String.fromCharCode(65 + i), name: f.name, x: f.x, z: f.z, r: f.r }));
  buildIndex(w);
  return w;
}

// ───────────────────────── 배치 ─────────────────────────

function setupWater(G: Gen, seed: number): void {
  const S = G.S, r = G.r;
  if (G.def.water === 'river') {
    G.river = {
      mid: S / 2 + (r() - 0.5) * S * 0.04,
      A1: S * 0.055, k1: (Math.PI * 2) / (S * (0.85 + r() * 0.3)), p1: r() * Math.PI * 2,
      A2: S * 0.018, k2: (Math.PI * 2) / (S * 0.32), p2: r() * Math.PI * 2,
      hw: 9 + r() * 3,
    };
    G.W = 4.5;
  } else if (G.def.water === 'coast') {
    const nC = valueNoise(seed + 77);
    const base = S * 0.84;
    G.shoreX = (z: number): number => base + S * 0.035 * (nC(z / 110, 3.7) - 0.5) * 2;
    G.W = 4.5;
  }
  G.w.water = G.W;
}

function layoutHQ(G: Gen): void {
  const S = G.S;
  let hx = S * 0.5 + (G.r() - 0.5) * S * 0.12;
  let hx1 = S - hx;
  if (G.shoreX) { hx = Math.min(hx, G.shoreX(S - 42) - 140); hx1 = Math.min(hx1, G.shoreX(42) - 140); }
  G.hqs = [
    { x: hx, z: S - 42, team: 0, s: -1 },
    { x: hx1, z: 42, team: 1, s: 1 },
  ];
}

function layoutBridges(G: Gen): void {
  const rv = G.river;
  if (!rv) return;
  const S = G.S;
  const fr = S >= 520 ? [0.2, 0.5, 0.8] : [0.28, 0.72];
  for (const f of fr) {
    const x = S * f + (G.r() - 0.5) * S * 0.05;
    const zc = riverZ(rv, x), sl = riverSlope(rv, x);
    const hl = (rv.hw + 9) * Math.sqrt(1 + sl * sl) + Math.abs(sl) * 5 + 1;
    G.bridges.push({ x, zc, z0: zc - hl, z1: zc + hl, hw: 4.5, used: false });
  }
}

function layoutFlags(G: Gen, n: number): void {
  if (n <= 0) return;
  const S = G.S, r = G.r;
  let tpl = TEMPLATES[n];
  if (!tpl) {
    tpl = [];
    for (let i = 0; i < n; i++) tpl.push([0.5 + (i % 2 ? 0.17 : -0.17), 0.22 + (0.56 * i) / Math.max(1, n - 1)]);
  }
  const fl: FlagPlan[] = tpl.map(([fx, fz]) => ({
    x: clamp(fx * S + (r() - 0.5) * S * 0.05, 60, S - 60),
    z: clamp(fz * S + (r() - 0.5) * S * 0.04, 95, S - 95),
    r: 14 + r() * 6, name: '', kind: 'depot' as ClusterKind, bridge: -1,
  }));
  const rv = G.river;
  if (rv && G.bridges.length) {
    // 가운데에 가장 가까운 거점 = 다리
    let bi = 0, bd = Infinity;
    fl.forEach((f, i) => { const d = Math.hypot(f.x - S / 2, f.z - S / 2); if (d < bd) { bd = d; bi = i; } });
    const f = fl[bi];
    let bk = 0;
    G.bridges.forEach((b, k) => { if (Math.abs(b.x - f.x) < Math.abs(G.bridges[bk].x - f.x)) bk = k; });
    const b = G.bridges[bk];
    const north = f.z < b.zc - 1 ? true : f.z > b.zc + 1 ? false : r() < 0.5;
    f.x = b.x + (r() - 0.5) * 4;
    f.z = north ? b.z0 - 8 : b.z1 + 8;
    f.r = 20; f.name = '다리'; f.kind = 'bridge'; f.bridge = bk;
    for (const g of fl) {
      if (g === f) continue;
      const need = rv.hw + 36;
      if (riverDist(rv, g.x, g.z) < need) {
        const sl = riverSlope(rv, g.x), zc = riverZ(rv, g.x);
        const side = g.z < zc ? -1 : 1;
        g.z = clamp(zc + side * need * Math.sqrt(1 + sl * sl), 95, S - 95);
      }
    }
  }
  if (G.shoreX) {
    let hi = -1;
    fl.forEach((f, i) => {
      const mx = G.shoreX!(f.z) - 55;
      if (f.x > mx) f.x = mx;
      if (!f.name && (hi < 0 || f.x > fl[hi].x)) hi = i;
    });
    if (hi >= 0) { const f = fl[hi]; f.x = G.shoreX(f.z) - 36; f.name = '항구'; f.kind = 'harbor'; }
  }
  // 나머지 이름
  const pool = POOLS[G.def.theme].slice();
  for (let i = pool.length - 1; i > 1; i--) { const j = 1 + Math.floor(r() * i); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  const used = new Set(fl.map((f) => f.name).filter((x) => x));
  const names = pool.filter((x) => !used.has(x)).concat(EXTRA_NAMES);
  let ni = 0;
  for (const f of fl) {
    if (f.name) continue;
    f.name = names[ni++] ?? `거점 ${ni}`;
    f.kind = NAME_KIND[f.name] ?? (ni % 2 ? 'checkpoint' : 'station');
  }
  G.flags = fl;
}

function layoutVillages(G: Gen): void {
  const S = G.S, town = G.def.town;
  let n = Math.round((0.6 + town * 3.4) * (S / 600) ** 2);
  if (town > 0.2) n = Math.max(1, n);
  for (let k = 0; k < 400 && G.villages.length < n; k++) {
    const x = 70 + G.r() * (S - 140), z = 70 + G.r() * (S - 140);
    let ok = true;
    for (const h of G.hqs) if (Math.hypot(h.x - x, h.z - z) < 125) ok = false;
    for (const f of G.flags) if (Math.hypot(f.x - x, f.z - z) < f.r + 80) ok = false;
    for (const v of G.villages) if (Math.hypot(v.x - x, v.z - z) < 125) ok = false;
    if (G.river && riverDist(G.river, x, z) < G.river.hw + 45) ok = false;
    if (G.shoreX && x > G.shoreX(z) - 60) ok = false;
    if (!ok) continue;
    G.villages.push({ x, z, axis: G.r() < 0.5 ? 0 : 1, len: 50 + town * 45 + G.r() * 20 });
  }
}

// ───────────────────────── 지형 ─────────────────────────

function rawTerrain(G: Gen, seed: number): void {
  const w = G.w, n = w.hfN, c = w.hfCell, s = n + 1, Hh = w.heights;
  const nA = fbm(seed + 1, 5), nB = fbm(seed + 2, 3), nD = valueNoise(seed + 3);
  const relief = 25 * clamp(G.def.hills, 0, 1) + 2;
  const rv = G.river, shore = G.shoreX;
  for (let j = 0; j <= n; j++) {
    const z = j * c;
    const sx = shore ? shore(z) : 0;
    for (let i = 0; i <= n; i++) {
      const x = i * c;
      const sh = smoothstep(0.3, 0.72, nA(x / 240, z / 240));
      const detail = nB(x / 45, z / 45) - 0.5;
      let h = 7.5 + relief * sh * sh * (3 - 2 * sh) + 1.6 * detail + 0.5 * (nD(x / 11, z / 11) - 0.5);
      if (rv) {
        const m = smoothstep(rv.hw + 6, rv.hw + 95, riverDist(rv, x, z));
        h = lerp(6.4 + 0.8 * detail, h, m);
      }
      if (shore) {
        const dc = x - sx;
        const m = smoothstep(-20, -110, dc);
        h = lerp(5.8 + 0.4 * detail, h, m);
        if (dc > -14) h = Math.max(-6, 5.8 - (dc + 14) * 0.2);
      }
      Hh[j * s + i] = h;
    }
  }
}

function basePads(G: Gen): void {
  for (const h of G.hqs) {
    const t = (H(G, h.x, h.z) + H(G, h.x + 30, h.z) + H(G, h.x - 30, h.z) + H(G, h.x, h.z + h.s * 25)) / 4;
    flattenCircleRaw(G, h.x, h.z, 88, 130, t, 1);
  }
  for (const f of G.flags) {
    let t = H(G, f.x, f.z);
    for (let k = 0; k < 4; k++) t += H(G, f.x + Math.cos(k * 1.57) * f.r, f.z + Math.sin(k * 1.57) * f.r);
    flattenCircleRaw(G, f.x, f.z, f.r + 14, f.r + 48, t / 5, 0.85);
  }
  for (const v of G.villages) flattenCircleRaw(G, v.x, v.z, v.len / 2 + 5, v.len / 2 + 45, H(G, v.x, v.z), 0.7);
  if (G.def.water === 'none' && G.def.theme !== 'industrial') {
    // 얼어붙은 작은 연못 자리: 평평하게 꺼진 땅
    for (let k = 0; k < 60; k++) {
      const x = 60 + G.r() * (G.S - 120), z = 60 + G.r() * (G.S - 120);
      let ok = true;
      for (const p of [...G.hqs, ...G.flags]) if (Math.hypot(p.x - x, p.z - z) < 110) ok = false;
      for (const v of G.villages) if (Math.hypot(v.x - x, v.z - z) < v.len / 2 + 50) ok = false;
      if (!ok) continue;
      const rad = 12 + G.r() * 8;
      flattenCircleRaw(G, x, z, rad, rad + 14, H(G, x, z) - 1.4, 1);
      occCircle(G, x, z, rad + 2, 1);
      break;
    }
  }
}

function flattenCircleRaw(G: Gen, cx: number, cz: number, r0: number, r1: number, target: number, strength: number): void {
  const w = G.w, n = w.hfN, c = w.hfCell, s = n + 1, Hh = w.heights;
  const i0 = Math.max(0, Math.floor((cx - r1) / c)), i1 = Math.min(n, Math.ceil((cx + r1) / c));
  const j0 = Math.max(0, Math.floor((cz - r1) / c)), j1 = Math.min(n, Math.ceil((cz + r1) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i * c - cx, j * c - cz);
    if (d >= r1) continue;
    const k = j * s + i;
    Hh[k] += (target - Hh[k]) * strength * (1 - smoothstep(r0, r1, d));
  }
}

function carveRiver(G: Gen): void {
  const rv = G.river;
  if (!rv) return;
  const w = G.w, n = w.hfN, c = w.hfCell, s = n + 1, Hh = w.heights, W = G.W, hw = rv.hw;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = i * c, z = j * c;
    const dr = riverDist(rv, x, z);
    if (dr >= hw + 8) continue;
    const k = j * s + i;
    const q = dr / hw;
    const target = dr < hw ? W - 0.8 - 2.2 * (1 - q * q) : lerp(W - 0.8, Hh[k], smoothstep(hw, hw + 8, dr));
    if (target < Hh[k]) Hh[k] = target;
  }
}

// ───────────────────────── 도로 ─────────────────────────

interface RoadPoly { pts: P2[]; hw: number }

function buildRoads(G: Gen): RoadPoly[] {
  const S = G.S, rv = G.river;
  type Node = P2 & { k: 0 | 1 | 2 };
  const nodes: Node[] = [
    ...G.hqs.map((h): Node => ({ x: h.x, z: h.z, k: 0 })),
    ...G.flags.map((f): Node => ({ x: f.x, z: f.z, k: 1 })),
    ...G.villages.map((v): Node => ({ x: v.x, z: v.z, k: 2 })),
  ];
  const side = (p: P2): number => (rv ? (p.z < riverZ(rv, p.x) ? -1 : 1) : 0);
  const cost = (a: Node, b: Node): number => Math.hypot(a.x - b.x, a.z - b.z) * (side(a) !== side(b) ? 1.8 : 1);
  const edges = new Map<string, [number, number]>();
  const addE = (a: number, b: number): void => { if (a === b) return; const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!edges.has(k)) edges.set(k, [a, b]); };
  // 최소 신장 트리 (Prim)
  const N = nodes.length;
  const inT = new Array(N).fill(false); inT[0] = true;
  for (let it = 1; it < N; it++) {
    let ba = -1, bb = -1, bc = Infinity;
    for (let a = 0; a < N; a++) if (inT[a]) for (let b = 0; b < N; b++) if (!inT[b]) { const c = cost(nodes[a], nodes[b]); if (c < bc) { bc = c; ba = a; bb = b; } }
    if (bb < 0) break;
    inT[bb] = true; addE(ba, bb);
  }
  const flagIdx = nodes.map((n, i) => (n.k === 1 ? i : -1)).filter((i) => i >= 0);
  for (const h of [0, 1]) {
    const near = flagIdx.slice().sort((a, b) => cost(nodes[h], nodes[a]) - cost(nodes[h], nodes[b]));
    for (const f of near.slice(0, 2)) addE(h, f);
  }
  for (const f of flagIdx) {
    let best = -1, bd = Infinity;
    for (const g of flagIdx) if (g !== f) { const d = cost(nodes[f], nodes[g]); if (d < bd) { bd = d; best = g; } }
    if (best >= 0) addE(f, best);
  }
  const polys: RoadPoly[] = [];
  const widthOf = (a: Node, b: Node): number => (a.k === 0 || b.k === 0 ? 4.5 : a.k === 2 || b.k === 2 ? 3.5 : 4);
  const route = (a: Node, b: Node, forced: number): void => {
    const hw = widthOf(a, b);
    if (rv && G.bridges.length && side(a) !== side(b)) {
      let bi = forced;
      if (bi < 0) {
        let bd = Infinity;
        G.bridges.forEach((br, i) => {
          const na = side(a) < 0 ? { x: br.x, z: br.z0 } : { x: br.x, z: br.z1 };
          const nb = side(a) < 0 ? { x: br.x, z: br.z1 } : { x: br.x, z: br.z0 };
          const d = Math.hypot(a.x - na.x, a.z - na.z) + Math.hypot(b.x - nb.x, b.z - nb.z);
          if (d < bd) { bd = d; bi = i; }
        });
      }
      const br = G.bridges[bi];
      br.used = true;
      const aN = side(a) < 0;
      const ea = { x: br.x, z: aN ? br.z0 : br.z1 }, eb = { x: br.x, z: aN ? br.z1 : br.z0 };
      const pa = { x: br.x, z: ea.z + (aN ? -14 : 14) }, pb = { x: br.x, z: eb.z + (aN ? 14 : -14) };
      polys.push({ pts: [...wiggle(G, a, pa), ea], hw });
      polys.push({ pts: [eb, ...wiggle(G, pb, b)], hw });
    } else polys.push({ pts: wiggle(G, a, b), hw });
  };
  for (const [a, b] of edges.values()) route(nodes[a], nodes[b], -1);
  // 안 쓰인 다리도 양쪽 가까운 마디와 잇는다
  G.bridges.forEach((br, bi) => {
    if (br.used) return;
    let na = -1, nb = -1, da = Infinity, db = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - br.x, n.z - br.zc);
      if (side(n) < 0 && d < da) { da = d; na = i; }
      if (side(n) > 0 && d < db) { db = d; nb = i; }
    });
    if (na >= 0 && nb >= 0) route(nodes[na], nodes[nb], bi);
  });
  // 마을 거리
  for (const v of G.villages) {
    const h = v.len / 2;
    const a = v.axis === 0 ? { x: v.x - h, z: v.z } : { x: v.x, z: v.z - h };
    const b = v.axis === 0 ? { x: v.x + h, z: v.z } : { x: v.x, z: v.z + h };
    polys.push({ pts: [a, { x: v.x, z: v.z }, b], hw: 3.5 });
  }
  // 지도 안, 바다 밖으로
  for (const p of polys) for (const q of p.pts) {
    q.x = clamp(q.x, 10, S - 10); q.z = clamp(q.z, 10, S - 10);
    if (G.shoreX) q.x = Math.min(q.x, G.shoreX(q.z) - 22);
  }
  G.w.roads = polys.map((p): Road => ({ pts: p.pts.map((q): [number, number] => [Math.round(q.x * 100) / 100, Math.round(q.z * 100) / 100]), w: p.hw * 2 }));
  return polys;
}

/** a→b 부드럽게 휘는 선 (약 10 m 간격) */
function wiggle(G: Gen, a: P2, b: P2): P2[] {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  if (L < 1) return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  const n = Math.max(2, Math.ceil(L / 10));
  const px = -dz / L, pz = dx / L;
  const a1 = (G.r() - 0.5) * 0.16 * L, a2 = (G.r() - 0.5) * 0.06 * L;
  const out: P2[] = [];
  const rv = G.river;
  const sideA = rv ? (a.z < riverZ(rv, a.x) ? -1 : 1) : 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const o = i === 0 || i === n ? 0 : a1 * Math.sin(Math.PI * t) + a2 * Math.sin(2 * Math.PI * t);
    const q = { x: a.x + dx * t + px * o, z: a.z + dz * t + pz * o };
    if (rv && i > 0 && i < n) {
      const need = rv.hw + 16;
      if (riverDist(rv, q.x, q.z) < need) {
        const sl = riverSlope(rv, q.x);
        q.z = riverZ(rv, q.x) + sideA * need * Math.sqrt(1 + sl * sl);
      }
    }
    out.push(q);
  }
  return out;
}

/** 폴리라인을 2.5 m 간격 표본으로 */
function resample(pts: P2[], step: number): P2[] {
  const out: P2[] = [{ x: pts[0].x, z: pts[0].z }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    while (t <= L) { out.push({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L }); t += step; }
    carry = L - (t - step);
  }
  const last = pts[pts.length - 1];
  const e = out[out.length - 1];
  if (Math.hypot(e.x - last.x, e.z - last.z) > 0.3) out.push({ x: last.x, z: last.z });
  return out;
}

function flattenRoads(G: Gen, polys: RoadPoly[]): void {
  const w = G.w, n = w.hfN, c = w.hfCell, s = n + 1, Hh = w.heights;
  const wBest = new Float32Array(s * s), tBest = new Float32Array(s * s);
  for (const p of polys) {
    const sm = resample(p.pts, 2.5);
    const raw = sm.map((q) => H(G, q.x, q.z));
    const K = 6;
    const tg = raw.map((_, i) => {
      let a = 0, m = 0;
      for (let k = -K; k <= K; k++) { const j = i + k; if (j < 0 || j >= raw.length) continue; a += raw[j]; m++; }
      return a / m;
    });
    const R = p.hw + 5;
    for (let q = 0; q < sm.length; q++) {
      const { x, z } = sm[q];
      G.roadS.push(x, z, p.hw);
      const i0 = Math.max(0, Math.floor((x - R) / c)), i1 = Math.min(n, Math.ceil((x + R) / c));
      const j0 = Math.max(0, Math.floor((z - R) / c)), j1 = Math.min(n, Math.ceil((z + R) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i * c - x, j * c - z);
        if (d >= R) continue;
        const wt = 1 - smoothstep(p.hw + 0.5, R, d);
        const k = j * s + i;
        if (wt > wBest[k]) { wBest[k] = wt; tBest[k] = tg[q]; }
      }
    }
  }
  for (let k = 0; k < s * s; k++) if (wBest[k] > 0) Hh[k] += (tBest[k] - Hh[k]) * wBest[k] * 0.9;
}

function markOccupancy(G: Gen): void {
  const rs = G.roadS;
  for (let i = 0; i < rs.length; i += 3) occCircle(G, rs[i], rs[i + 1], rs[i + 2] + 1.2, 1);
  for (const f of G.flags) occCircle(G, f.x, f.z, 6, 1);
  for (const b of G.bridges) if (b.used) occMark(G, b.x - b.hw - 3, b.z0 - 4, b.x + b.hw + 3, b.z1 + 4, 1);
}

// ───────────────────────── 차량 자리 ─────────────────────────

function vehicleSpawns(G: Gen): number[][][] {
  const S = G.S, w = G.w;
  const center = { x: S / 2, y: 0, z: S / 2 };
  const rects: number[][][] = [[], []];
  for (const h of G.hqs) {
    const team = h.team as Team;
    for (let row = 0; row < 2; row++) for (let k = 0; k < 5; k++) {
      const pos = { x: clamp(h.x + (k - 2) * 8, 12, S - 12), y: 0, z: h.z + h.s * (15 + row * 11) };
      w.vehicleSpawns.push({ team, pos, yaw: yawTo(pos, center), air: false });
      rects[team].push([pos.x - 3, pos.z - 5, pos.x + 3, pos.z + 5]);
    }
    let sx = team === 0 ? -1 : 1;
    if (h.x + sx * 85 < 12 || h.x + sx * 85 > S - 12) sx = -sx;
    for (let k = 0; k < 3; k++) {
      const pos = { x: h.x + sx * (42 + k * 17), y: 0, z: h.z + h.s * 2 };
      w.vehicleSpawns.push({ team, pos, yaw: yawTo(pos, center), air: true });
      rects[team].push([pos.x - 7, pos.z - 7, pos.x + 7, pos.z + 7]);
    }
  }
  return rects;
}

// ───────────────────────── 건물 평탄화 ─────────────────────────

function buildingPads(G: Gen): void {
  const w = G.w, n = w.hfN, c = w.hfCell, s = n + 1, Hh = w.heights;
  const V = s * s;
  const sw = new Float32Array(V), swt = new Float32Array(V), mx = new Float32Array(V);
  const inner = 1.8, outer = 6.0;
  for (const p of G.plans) {
    const st = rectStats(G, p.x0, p.z0, p.x1, p.z1);
    const target = (st.avg * 2 + st.max) / 3;
    const i0 = Math.max(0, Math.floor((p.x0 - outer) / c)), i1 = Math.min(n, Math.ceil((p.x1 + outer) / c));
    const j0 = Math.max(0, Math.floor((p.z0 - outer) / c)), j1 = Math.min(n, Math.ceil((p.z1 + outer) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * c, z = j * c;
      const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1);
      const d = Math.hypot(dx, dz);
      if (d >= outer) continue;
      const wt = 1 - smoothstep(inner, outer, d);
      const k = j * s + i;
      sw[k] += wt; swt[k] += wt * target;
      if (wt > mx[k]) mx[k] = wt;
    }
  }
  for (let k = 0; k < V; k++) if (sw[k] > 0) Hh[k] += (swt[k] / sw[k] - Hh[k]) * mx[k];
  for (const p of G.plans) {
    let mn = Infinity, mxh = -Infinity;
    const nx = Math.max(2, Math.ceil((p.x1 - p.x0) / 1.5)), nz = Math.max(2, Math.ceil((p.z1 - p.z0) / 1.5));
    for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) {
      const h = H(G, p.x0 + ((p.x1 - p.x0) * a) / nx, p.z0 + ((p.z1 - p.z0) * b) / nz);
      if (h < mn) mn = h; if (h > mxh) mxh = h;
    }
    p.by = mxh + 0.15;
    p.baseY = mn - 0.4;
  }
}

// ───────────────────────── 다리 ─────────────────────────

function buildBridges(G: Gen): void {
  const w = G.w;
  for (const b of G.bridges) {
    if (!b.used) continue;
    const zA = b.z0 - 2, zB = b.z1 + 2, L = zB - zA;
    const nSeg = Math.max(4, Math.ceil(L / 3));
    const hA = H(G, b.x, zA - 0.5), hB = H(G, b.x, zB + 0.5);
    const deck = 0x4b4d50, rail = 0x8d8b86;
    for (let i = 0; i < nSeg; i++) {
      const za = zA + (L * i) / nSeg, zb = zA + (L * (i + 1)) / nSeg;
      const u = (i + 0.5) / nSeg;
      const top = lerp(hA, hB, u) + 0.15 + 1.2 * 4 * u * (1 - u);
      mkBox(w, 'bridge', 'concrete', b.x - b.hw, top - 0.7, za, b.x + b.hw, top, zb, shade(deck, i % 2 ? 0.97 : 1.03));
      mkBox(w, 'bridge', 'concrete', b.x - b.hw - 0.35, top - 0.7, za, b.x - b.hw, top + 0.9, zb, rail);
      mkBox(w, 'bridge', 'concrete', b.x + b.hw, top - 0.7, za, b.x + b.hw + 0.35, top + 0.9, zb, rail);
    }
    for (const u of [1 / 3, 2 / 3]) {
      const z = zA + L * u;
      const top = lerp(hA, hB, u) + 0.15 + 1.2 * 4 * u * (1 - u) - 0.7;
      for (const x of [b.x - 3, b.x + 3]) mkBox(w, 'bridge', 'concrete', x - 0.6, H(G, x, z) - 1, z - 0.8, x + 0.6, top, z + 0.8, 0x7a7873);
    }
  }
}

// ───────────────────────── 지면 종류 ─────────────────────────

function groundTypes(G: Gen, seed: number): void {
  const w = G.w, n = w.hfN, c = w.hfCell, s = n + 1, Hh = w.heights, gr = w.ground;
  const nG1 = fbm(seed + 31, 4), nG2 = fbm(seed + 47, 3);
  const th = G.def.theme, W = G.W;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * c, z = (j + 0.5) * c;
    const a = nG1(x / 70, z / 70), b = nG2(x / 26, z / 26);
    let g: number;
    if (th === 'snow') { g = a > 0.64 ? 1 : 0; if (b > 0.77) g = 5; }
    else if (th === 'tundra') { g = a > 0.6 ? 0 : 1; if (b > 0.72) g = 2; }
    else { g = a > 0.62 ? 0 : a < 0.4 ? 4 : 1; if (b > 0.56) g = 5; else if (b < 0.3 && a > 0.45) g = 2; }
    const k = j * s + i;
    const h00 = Hh[k], h10 = Hh[k + 1], h01 = Hh[k + s], h11 = Hh[k + s + 1];
    const rng4 = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
    if (rng4 > 2.1) g = th === 'snow' ? 5 : 2;
    if (W > -1e8) {
      const hc = (h00 + h10 + h01 + h11) / 4;
      if (hc < W + 1.2) g = 5;
      if (hc < W - 0.4) g = 2;
    }
    gr[j * n + i] = g;
  }
  const mark = (x0: number, z0: number, x1: number, z1: number, g: GroundType, test?: (x: number, z: number) => boolean): void => {
    const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(n - 1, Math.floor(x1 / c));
    const j0 = Math.max(0, Math.floor(z0 / c)), j1 = Math.min(n - 1, Math.floor(z1 / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!test || test((i + 0.5) * c, (j + 0.5) * c)) gr[j * n + i] = g;
  };
  const circ = (cx: number, cz: number, r: number, g: GroundType, noise = 0): void =>
    mark(cx - r, cz - r, cx + r, cz + r, g, (x, z) => Math.hypot(x - cx, z - cz) < r * (1 - noise * nG2(x / 9, z / 9)));
  for (const f of G.flags) {
    if (th === 'industrial' || f.kind === 'refinery' || f.kind === 'depot' || f.kind === 'harbor') circ(f.x, f.z, f.r + 14, 4, 0.5);
    else if (f.kind === 'square') circ(f.x, f.z, f.r + 6, 4, 0.15);
    circ(f.x, f.z, f.r * 0.8, th === 'industrial' ? 5 : 2, 0.7);
  }
  for (const p of G.plans) {
    const hard = th === 'industrial' || p.style === 'warehouse' || p.style === 'office' || p.style === 'apartment';
    if (hard) mark(p.x0 - 6, p.z0 - 6, p.x1 + 6, p.z1 + 6, 4, (x, z) => nG2(x / 7, z / 7) > 0.3);
    mark(p.x0 - 2.5, p.z0 - 2.5, p.x1 + 2.5, p.z1 + 2.5, hard ? 5 : 2);
  }
  for (const h of G.hqs) { circ(h.x, h.z, 72, 5, 0.25); circ(h.x, h.z, 34, 4, 0.1); }
  for (const v of w.vehicleSpawns) {
    const r = v.air ? 7 : 4;
    mark(v.pos.x - r, v.pos.z - r, v.pos.x + r, v.pos.z + r, 4);
  }
  const rs = G.roadS;
  for (const pass of [0, 1]) {
    for (let q = 0; q < rs.length; q += 3) {
      const x = rs[q], z = rs[q + 1], hw = rs[q + 2], R = pass === 0 ? hw + 1.3 : hw;
      mark(x - R, z - R, x + R, z + R, pass === 0 ? 5 : 3, (px, pz) => Math.hypot(px - x, pz - z) < R);
    }
  }
}

// ───────────────────────── 바위·나무 ─────────────────────────

function slopeAt(G: Gen, x: number, z: number): number {
  return Math.hypot(H(G, x + 2, z) - H(G, x - 2, z), H(G, x, z + 2) - H(G, x, z - 2)) / 4;
}

function farFromBases(G: Gen, x: number, z: number, hqR: number, flagPad: number): boolean {
  for (const h of G.hqs) if (Math.hypot(h.x - x, h.z - z) < hqR) return false;
  for (const f of G.flags) if (Math.hypot(f.x - x, f.z - z) < f.r + flagPad) return false;
  return true;
}

function placeRocks(G: Gen): void {
  const S = G.S, hills = clamp(G.def.hills, 0, 1);
  const want = Math.round((35 + 110 * hills) * (S / 600) ** 2);
  let made = 0;
  for (let k = 0; k < want * 25 && made < want; k++) {
    const x = 10 + G.r() * (S - 20), z = 10 + G.r() * (S - 20);
    const sl = slopeAt(G, x, z);
    if (G.r() > 0.12 + Math.min(1, sl * 2.2)) continue;
    if (G.W > -1e8 && H(G, x, z) < G.W + 0.6) continue;
    if (!farFromBases(G, x, z, 90, 2)) continue;
    const size = 0.9 + G.r() ** 2 * 3.2;
    if (!rock(G, x, z, size)) continue;
    made++;
    if (G.r() < 0.35) {
      const m = 1 + Math.floor(G.r() * 3);
      for (let i = 0; i < m; i++) {
        const a = G.r() * Math.PI * 2, d = size * 0.8 + 0.8 + G.r() * 2;
        rock(G, x + Math.cos(a) * d, z + Math.sin(a) * d, 0.7 + G.r() * size * 0.6);
      }
    }
  }
}

function plantTrees(G: Gen, seed: number): void {
  const S = G.S, w = G.w, forest = clamp(G.def.forest, 0, 1);
  const want = clamp(Math.round((320 + 900 * forest) * (S / 600) ** 2), 250, 1400);
  const nF = fbm(seed + 91, 4);
  // 숲 덩어리: 지도 15~35% 면적에 몰아서 심고, 나머지엔 드문드문
  const thr = 0.6 - 0.1 * forest;
  const occ = G.occ, on = G.on;
  const th = G.def.theme;
  const tr = rng(seed ^ 0x2c1b3c6d);
  let made = 0;
  for (let k = 0; k < want * 45 && made < want; k++) {
    const x = 4 + tr() * (S - 8), z = 4 + tr() * (S - 8);
    const d = smoothstep(thr, thr + 0.05, nF(x / 120, z / 120));
    if (tr() > 0.012 + 0.988 * d) continue;
    const ci = Math.floor(x / OC), cj = Math.floor(z / OC);
    let free = true;
    for (let b = -1; b <= 1 && free; b++) for (let a = -1; a <= 1; a++) {
      const ii = ci + a, jj = cj + b;
      if (ii < 0 || jj < 0 || ii >= on || jj >= on || occ[jj * on + ii] !== 0) { free = false; break; }
    }
    if (!free) continue;
    const y = H(G, x, z);
    if (G.W > -1e8 && y < G.W + 0.6) continue;
    if (!farFromBases(G, x, z, 80, 4)) continue;
    if (slopeAt(G, x, z) > 0.9) continue;
    const t = tr();
    let kind: Tree['kind'];
    if (th === 'snow') kind = t < 0.84 ? 'pine' : t < 0.95 ? 'birch' : 'dead';
    else if (th === 'tundra') kind = t < 0.6 ? 'pine' : t < 0.94 ? 'birch' : 'dead';
    else kind = t < 0.5 ? 'pine' : t < 0.72 ? 'birch' : 'dead';
    const h = kind === 'pine' ? 7 + tr() * 8 : kind === 'birch' ? 6 + tr() * 5 : 4 + tr() * 5;
    const half = 0.24 + h * 0.012;
    const canopy = kind === 'pine' ? h * 0.2 : kind === 'birch' ? h * 0.24 : h * 0.12;
    const col = kind === 'birch' ? 0xbdb8aa : kind === 'dead' ? 0x5a5047 : 0x4a3b2e;
    const id = mkBox(w, 'tree', 'wood', x - half, y - 0.3, z - half, x + half, y + h * 0.92, z + half, col, -1, { hp: 120 });
    w.trees.push({ x, z, y, h, r: canopy, kind, box: id });
    occ[cj * on + ci] = 2;
    made++;
  }
}

