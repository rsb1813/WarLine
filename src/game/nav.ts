// 길찾기: 목적지마다 거리장을 만들어 두고, 지형이 부서져 길이 열리면 그 주변만 갱신한다
import { Heap } from './mapgen';
import { BRIDGE, CELL, CRUSH_HEAVY, FENCE, MOVE_BLOCK, RUBBLE, VEH_BLOCK, type World } from './grid';

export interface Nav {
  /** 목적지 목록 (거점들, 본부 0, 본부 1) */
  targets: { x: number; y: number }[];
  foot: Float32Array[];
  veh: Float32Array[];
  vblock: Uint8Array;
  cool: number;
}

const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

function vblockAt(w: World, x: number, y: number): number {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w.cw || ny >= w.ch) return 1;
    const tt = w.t[ny * w.cw + nx];
    if (VEH_BLOCK[tt] && tt !== BRIDGE) return 1;
  }
  return 0;
}

function vehBlockMap(w: World): Uint8Array {
  const out = new Uint8Array(w.cw * w.ch);
  for (let y = 0; y < w.ch; y++) for (let x = 0; x < w.cw; x++) out[y * w.cw + x] = vblockAt(w, x, y);
  return out;
}

function blockedFn(w: World, veh: boolean, vblock: Uint8Array) {
  const t = w.t;
  return veh ? (i: number) => vblock[i] === 1 : (i: number) => MOVE_BLOCK[t[i]] === 1 && t[i] !== BRIDGE;
}
function costFn(w: World, veh: boolean) {
  const t = w.t;
  return veh ? (i: number) => (CRUSH_HEAVY[t[i]] ? 4 : 1) : (i: number) => (t[i] === RUBBLE ? 1.25 : t[i] === FENCE ? 99 : 1);
}

/** 큐에 든 칸에서부터 더 짧아진 거리를 퍼뜨린다 */
function propagate(w: World, d: Float32Array, heap: Heap, veh: boolean, vblock: Uint8Array) {
  const { cw, ch } = w;
  const blocked = blockedFn(w, veh, vblock);
  const cost = costFn(w, veh);
  while (heap.size) {
    const cur = heap.pop();
    const cd = d[cur];
    const cx = cur % cw, cy = (cur - cx) / cw;
    for (const [dx, dy, st] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const ni = ny * cw + nx;
      if (blocked(ni)) continue;
      if (dx && dy && (blocked(cy * cw + nx) || blocked(ny * cw + cx))) continue;
      const nd = cd + cost(ni) * st;
      if (nd < d[ni]) { d[ni] = nd; heap.push(ni, nd); }
    }
  }
}

function field(w: World, tx: number, ty: number, veh: boolean, vblock: Uint8Array): Float32Array {
  const { cw, ch } = w;
  const d = new Float32Array(cw * ch).fill(Infinity);
  const blocked = blockedFn(w, veh, vblock);
  const sx = Math.max(0, Math.min(cw - 1, Math.floor(tx / CELL))), sy = Math.max(0, Math.min(ch - 1, Math.floor(ty / CELL)));
  // 목적지 칸이 막혔으면 가장 가까운 열린 칸에서 시작한다
  let start = sy * cw + sx;
  if (blocked(start)) {
    let best = -1, bd = Infinity;
    for (let y = sy - 6; y <= sy + 6; y++) for (let x = sx - 6; x <= sx + 6; x++) {
      if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
      const i = y * cw + x;
      const dd = (x - sx) ** 2 + (y - sy) ** 2;
      if (!blocked(i) && dd < bd) { bd = dd; best = i; }
    }
    if (best >= 0) start = best;
  }
  const heap = new Heap();
  d[start] = 0;
  heap.push(start, 0);
  propagate(w, d, heap, veh, vblock);
  return d;
}

export function buildNav(w: World): Nav {
  const targets = [...w.flags.map((f) => ({ x: f.x, y: f.y })), ...w.hq];
  const vblock = vehBlockMap(w);
  w.opened.length = 0;
  return {
    targets,
    foot: targets.map((p) => field(w, p.x, p.y, false, vblock)),
    veh: targets.map((p) => field(w, p.x, p.y, true, vblock)),
    vblock,
    cool: 0,
  };
}

/** 새로 열린 칸에서 거리장을 부분 갱신한다 (길은 부서질수록 열리기만 한다) */
export function updateNav(w: World, nav: Nav, dt: number) {
  nav.cool -= dt;
  if (!w.opened.length || nav.cool > 0) return;
  nav.cool = 0.5;
  const { cw, ch } = w;
  const foot = new Set<number>(), veh = new Set<number>();
  for (const i of w.opened) {
    foot.add(i);
    const x = i % cw, y = (i - x) / cw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const ni = ny * cw + nx;
      const nb = vblockAt(w, nx, ny);
      if (nb !== nav.vblock[ni]) { nav.vblock[ni] = nb; if (!nb) veh.add(ni); }
      if (CRUSH_HEAVY[w.t[ni]] === 0) veh.add(ni);
    }
  }
  w.opened.length = 0;
  const seed = (d: Float32Array, cells: Set<number>, isVeh: boolean) => {
    const blocked = blockedFn(w, isVeh, nav.vblock);
    const cost = costFn(w, isVeh);
    const heap = new Heap();
    for (const c of cells) {
      if (blocked(c)) continue;
      const cx = c % cw, cy = (c - cx) / cw;
      let best = d[c];
      for (const [dx, dy, st] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const ni = ny * cw + nx;
        if (blocked(ni) || (dx && dy && (blocked(cy * cw + nx) || blocked(ny * cw + cx)))) continue;
        best = Math.min(best, d[ni] + cost(c) * st);
      }
      if (best < d[c]) d[c] = best;
      if (isFinite(d[c])) heap.push(c, d[c]);
    }
    propagate(w, d, heap, isVeh, nav.vblock);
  };
  for (const d of nav.foot) seed(d, foot, false);
  if (veh.size) for (const d of nav.veh) seed(d, veh, true);
}

/** 거리장을 따라 목적지로 가는 방향. 도착했거나 길이 없으면 null */
export function flow(w: World, nav: Nav, k: number, x: number, y: number, veh: boolean): [number, number] | null {
  const f = (veh ? nav.veh : nav.foot)[k];
  if (!f) return null;
  const { cw, ch } = w;
  const cx = Math.min(cw - 1, Math.max(0, Math.floor(x / CELL)));
  const cy = Math.min(ch - 1, Math.max(0, Math.floor(y / CELL)));
  const here = f[cy * cw + cx];
  if (here < 1.5) return null;
  let best = isFinite(here) ? here : Infinity, bx = -1, by = -1;
  for (const [dx, dy] of DIRS) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
    if (dx && dy && (!isFinite(f[cy * cw + nx]) || !isFinite(f[ny * cw + cx]))) continue;
    const v = f[ny * cw + nx];
    if (v < best) { best = v; bx = nx; by = ny; }
  }
  if (bx < 0) return null;
  // 두 칸 앞까지 보며 부드럽게 꺾는다
  let ax = bx, ay = by, best2 = best;
  for (const [dx, dy] of DIRS) {
    const nx = bx + dx, ny = by + dy;
    if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
    const v = f[ny * cw + nx];
    if (v < best2 - 0.5) { best2 = v; ax = nx; ay = ny; }
  }
  const tx = ((bx + ax) / 2 + 0.5) * CELL - x, ty = ((by + ay) / 2 + 0.5) * CELL - y;
  const l = Math.hypot(tx, ty) || 1;
  return [tx / l, ty / l];
}

/** 거리장에서 (x, y)까지의 길 거리 (칸 단위) */
export function pathDist(w: World, nav: Nav, k: number, x: number, y: number, veh = false): number {
  const f = (veh ? nav.veh : nav.foot)[k];
  if (!f) return Infinity;
  const cx = Math.min(w.cw - 1, Math.max(0, Math.floor(x / CELL)));
  const cy = Math.min(w.ch - 1, Math.max(0, Math.floor(y / CELL)));
  return f[cy * w.cw + cx];
}
