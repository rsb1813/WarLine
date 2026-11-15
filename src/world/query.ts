// 세계 질의: 디딤면, 광선, 시야, 몸 충돌, 주변 상자. 초당 수천 번 불리므로 할당 없이 typed array 로 돈다.
import type { Box, RayHit, Vec3, World } from '../types';
import { getIndex, nextStamp, STEP } from './core';
import { groundTypeAt, heightAt, terrainNormal } from './terrain';

const GROUND_MAT: RayHit['mat'][] = ['snow', 'dirt', 'dirt', 'concrete', 'concrete', 'sand'];

// ───────────────────────── 주변 상자 ─────────────────────────

/** (x,z) 반지름 r 원과 xz 가 겹치는 살아 있는 상자마다 cb (한 번씩). cb 안에서 damageBox 를 불러도 안전 */
export function boxesNear(w: World, x: number, z: number, r: number, cb: (b: Box) => void): void {
  const ix = getIndex(w);
  const cs = ix.cs, n = ix.n;
  let i0 = Math.floor((x - r) / cs), i1 = Math.floor((x + r) / cs);
  let j0 = Math.floor((z - r) / cs), j1 = Math.floor((z + r) / cs);
  if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (i1 >= n) i1 = n - 1; if (j1 >= n) j1 = n - 1;
  if (i0 > i1 || j0 > j1) return;
  const q = nextStamp(ix), st = ix.stamp, bb = ix.bb, boxes = w.boxes, r2 = r * r;
  const out: number[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cell = ix.cells[j * n + i];
      for (let k = 0; k < cell.length; k++) {
        const id = cell[k];
        if (st[id] === q) continue;
        st[id] = q;
        if (!boxes[id].alive) continue;
        const p = id * 6;
        const dx = x < bb[p] ? bb[p] - x : x > bb[p + 3] ? x - bb[p + 3] : 0;
        const dz = z < bb[p + 2] ? bb[p + 2] - z : z > bb[p + 5] ? z - bb[p + 5] : 0;
        if (dx * dx + dz * dz > r2) continue;
        out.push(id);
      }
    }
  }
  for (let k = 0; k < out.length; k++) { const b = boxes[out[k]]; if (b.alive) cb(b); }
}

// ───────────────────────── 디딤면 ─────────────────────────

/** y+0.5 아래에서 가장 높은 디딤면 (지형, 또는 원과 겹치는 살아 있는 solid 상자의 윗면) */
export function floorAt(w: World, x: number, y: number, z: number, radius: number): number {
  let best = heightAt(w, x, z);
  const lim = y + STEP;
  if (lim <= best) return best;
  const ix = getIndex(w);
  const cs = ix.cs, n = ix.n, r = radius > 0 ? radius : 0, r2 = r * r;
  let i0 = Math.floor((x - r) / cs), i1 = Math.floor((x + r) / cs);
  let j0 = Math.floor((z - r) / cs), j1 = Math.floor((z + r) / cs);
  if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (i1 >= n) i1 = n - 1; if (j1 >= n) j1 = n - 1;
  const bb = ix.bb, boxes = w.boxes, cells = ix.cells;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * n + i;
      if (ix.top[c] <= best) continue;
      const cell = cells[c];
      for (let k = 0; k < cell.length; k++) {
        const id = cell[k], p = id * 6;
        const t = bb[p + 4];
        if (t > lim || t <= best) continue;
        const dx = x < bb[p] ? bb[p] - x : x > bb[p + 3] ? x - bb[p + 3] : 0;
        const dz = z < bb[p + 2] ? bb[p + 2] - z : z > bb[p + 5] ? z - bb[p + 5] : 0;
        if (dx * dx + dz * dz > r2) continue;
        const b = boxes[id];
        if (!b.alive || !b.solid) continue;
        best = t;
      }
    }
  }
  return best;
}

// ───────────────────────── 광선 ─────────────────────────

// 마지막 cast 결과 (할당 없이 돌려주려고 모듈 변수에 둔다)
let hitT = 0, hitId = -3, hitAx = -1;

/** 지형 행진: [ta, tb] 에서 처음 지면 아래로 들어가는 t (없으면 -1) */
function marchTerrain(w: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ta: number, tb: number, hstep: number): number {
  let t = ta;
  if (oy + dy * t - heightAt(w, ox + dx * t, oz + dz * t) < 0) return t;
  while (t < tb) {
    let t2 = t + hstep;
    if (t2 > tb) t2 = tb;
    if (oy + dy * t2 - heightAt(w, ox + dx * t2, oz + dz * t2) < 0) {
      let lo = t, hi = t2;
      for (let i = 0; i < 10; i++) {
        const m = (lo + hi) * 0.5;
        if (oy + dy * m - heightAt(w, ox + dx * m, oz + dz * m) < 0) hi = m; else lo = m;
      }
      return lo;
    }
    t = t2;
  }
  return -1;
}

/**
 * 광선 핵심. 맞으면 true 와 hitT/hitId(-1 지형, -2 물, ≥0 상자)/hitAx(0 x,1 y,2 z,-1 안쪽).
 * 격자 DDA 로 칸을 차례로 지나며 상자(슬랩 판정)와 지형(칸 최대 높이로 건너뛰기)을 함께 본다.
 */
function cast(w: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, sight: boolean): boolean {
  hitId = -3; hitAx = -1; hitT = 0;
  if (!(maxT > 0) || ox !== ox || oy !== oy || oz !== oz || dx !== dx || dy !== dy || dz !== dz) return false;
  const S = w.size;
  let tEnd = maxT, waterT = -1;
  const W = w.water;
  if (W > -1e8 && dy < 0 && oy >= W) {
    const t = (W - oy) / dy;
    if (t <= tEnd) {
      const px = ox + dx * t, pz = oz + dz * t;
      if (px >= 0 && px <= S && pz >= 0 && pz <= S && heightAt(w, px, pz) < W) { waterT = t; tEnd = t; }
    }
  }
  // 지도 사각형으로 자르기
  let t0 = 0, t1 = tEnd;
  const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
  if (adx > 1e-12) {
    let a = -ox / dx, b = (S - ox) / dx;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
  } else if (ox < 0 || ox > S) t1 = -1;
  if (adz > 1e-12) {
    let a = -oz / dz, b = (S - oz) / dz;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
  } else if (oz < 0 || oz > S) t1 = -1;
  if (t0 <= t1) {
    const ix = getIndex(w);
    const cs = ix.cs, n = ix.n;
    let cx = Math.floor((ox + dx * t0) / cs), cz = Math.floor((oz + dz * t0) / cs);
    if (cx < 0) cx = 0; else if (cx >= n) cx = n - 1;
    if (cz < 0) cz = 0; else if (cz >= n) cz = n - 1;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = adx > 1e-12 ? ((cx + (dx > 0 ? 1 : 0)) * cs - ox) / dx : Infinity;
    let tMaxZ = adz > 1e-12 ? ((cz + (dz > 0 ? 1 : 0)) * cs - oz) / dz : Infinity;
    const tDX = adx > 1e-12 ? cs / adx : Infinity, tDZ = adz > 1e-12 ? cs / adz : Infinity;
    const hl = Math.sqrt(dx * dx + dz * dz);
    const hstep = (w.hfCell * 0.5) / (hl > 1e-4 ? hl : 1e-4);
    const ivx = adx > 1e-12 ? 1 / dx : 0, ivy = dy > 1e-12 || dy < -1e-12 ? 1 / dy : 0, ivz = adz > 1e-12 ? 1 / dz : 0;
    const q = nextStamp(ix), st = ix.stamp, bb = ix.bb, boxes = w.boxes, cells = ix.cells, top = ix.top, tmax = ix.tmax;
    let best = Infinity, bestId = -3, bestAx = -1;
    let tc = t0;
    for (;;) {
      let tn = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (tn > t1) tn = t1;
      const ci = cz * n + cx;
      const ya = oy + dy * tc, yb = oy + dy * tn;
      if ((ya < yb ? ya : yb) <= top[ci]) {
        const cell = cells[ci];
        for (let k = 0, L = cell.length; k < L; k++) {
          const id = cell[k];
          if (st[id] === q) continue;
          st[id] = q;
          const b = boxes[id];
          if (!b.alive || (sight && !b.opaque)) continue;
          const p = id * 6;
          let tin = 0, tout = best < tEnd ? best : tEnd, ax = -1;
          if (ivx !== 0) {
            let ta = (bb[p] - ox) * ivx, tb = (bb[p + 3] - ox) * ivx;
            if (ta > tb) { const s = ta; ta = tb; tb = s; }
            if (ta > tin) { tin = ta; ax = 0; }
            if (tb < tout) tout = tb;
            if (tin > tout) continue;
          } else if (ox < bb[p] || ox > bb[p + 3]) continue;
          if (ivy !== 0) {
            let ta = (bb[p + 1] - oy) * ivy, tb = (bb[p + 4] - oy) * ivy;
            if (ta > tb) { const s = ta; ta = tb; tb = s; }
            if (ta > tin) { tin = ta; ax = 1; }
            if (tb < tout) tout = tb;
            if (tin > tout) continue;
          } else if (oy < bb[p + 1] || oy > bb[p + 4]) continue;
          if (ivz !== 0) {
            let ta = (bb[p + 2] - oz) * ivz, tb = (bb[p + 5] - oz) * ivz;
            if (ta > tb) { const s = ta; ta = tb; tb = s; }
            if (ta > tin) { tin = ta; ax = 2; }
            if (tb < tout) tout = tb;
            if (tin > tout) continue;
          } else if (oz < bb[p + 2] || oz > bb[p + 5]) continue;
          if (tin < best) { best = tin; bestId = id; bestAx = ax; }
        }
      }
      // 지형
      const tl = best < tn ? best : tn;
      if (tl >= tc) {
        const yl = oy + dy * tl;
        if ((ya < yl ? ya : yl) <= tmax[ci]) {
          const th = marchTerrain(w, ox, oy, oz, dx, dy, dz, tc, tl, hstep);
          if (th >= 0 && th < best) { best = th; bestId = -1; bestAx = -1; }
        }
      }
      if (best <= tn || tn >= t1) break;
      if (tMaxX < tMaxZ) {
        cx += stepX; tc = tMaxX; tMaxX += tDX;
        if (cx < 0 || cx >= n) break;
      } else {
        cz += stepZ; tc = tMaxZ; tMaxZ += tDZ;
        if (cz < 0 || cz >= n) break;
      }
    }
    if (bestId !== -3) { hitT = best; hitId = bestId; hitAx = bestAx; return true; }
  }
  if (waterT >= 0) { hitT = waterT; hitId = -2; hitAx = 1; return true; }
  return false;
}

/** 가장 가까운 맞은 곳 (상자, 지형, 수면). sight=true 면 opaque 아닌 상자(유리, 울타리) 통과 */
export function raycast(w: World, o: Vec3, d: Vec3, maxT: number, sight = false): RayHit | null {
  if (!cast(w, o.x, o.y, o.z, d.x, d.y, d.z, maxT, sight)) return null;
  const t = hitT;
  const point = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  if (hitId === -1) {
    return { t, point, normal: terrainNormal(w, point.x, point.z), box: -1, mat: GROUND_MAT[groundTypeAt(w, point.x, point.z)] };
  }
  if (hitId === -2) return { t, point, normal: { x: 0, y: 1, z: 0 }, box: -2, mat: 'water' };
  let normal: Vec3;
  if (hitAx === 0) normal = { x: d.x > 0 ? -1 : 1, y: 0, z: 0 };
  else if (hitAx === 1) normal = { x: 0, y: d.y > 0 ? -1 : 1, z: 0 };
  else if (hitAx === 2) normal = { x: 0, y: 0, z: d.z > 0 ? -1 : 1 };
  else { const l = Math.hypot(d.x, d.y, d.z) || 1; normal = { x: -d.x / l, y: -d.y / l, z: -d.z / l }; }
  const b = w.boxes[hitId];
  return { t, point, normal, box: hitId, mat: b.mat };
}

/** a 에서 b 가 보이나 (opaque 상자와 지형만 막는다) */
export function lineOfSight(w: World, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (L < 0.06) return true;
  const inv = 1 / L;
  return !cast(w, a.x, a.y, a.z, dx * inv, dy * inv, dz * inv, L - 0.05, true);
}

// ───────────────────────── 몸 충돌 ─────────────────────────

/**
 * 세로 원기둥 몸(발 = pos). solid 상자에서 수평으로 밀어내고(막힌 쪽 속도 0), 0.5 m 턱은 올라서고,
 * 천장에 머리를 박으면 vel.y = 0, 지형 아래로는 못 가고, 지도 [1, size-1] 밖으로 못 나간다.
 * 천천히 내려가는 중(계단·내리막)이면 0.32 m 이내 디딤면에 붙인다.
 */
export function collideBody(w: World, pos: Vec3, vel: Vec3, radius: number, height: number): { ground: boolean; ceiling: boolean; wall: boolean } {
  const res = { ground: false, ceiling: false, wall: false };
  const S = w.size;
  if (!(pos.x === pos.x && pos.y === pos.y && pos.z === pos.z)) {
    pos.x = S / 2; pos.z = S / 2; pos.y = heightAt(w, pos.x, pos.z); vel.x = 0; vel.y = 0; vel.z = 0;
  }
  if (pos.x < 1) { pos.x = 1; if (vel.x < 0) vel.x = 0; res.wall = true; } else if (pos.x > S - 1) { pos.x = S - 1; if (vel.x > 0) vel.x = 0; res.wall = true; }
  if (pos.z < 1) { pos.z = 1; if (vel.z < 0) vel.z = 0; res.wall = true; } else if (pos.z > S - 1) { pos.z = S - 1; if (vel.z > 0) vel.z = 0; res.wall = true; }
  const ix = getIndex(w);
  const cs = ix.cs, n = ix.n, bb = ix.bb, boxes = w.boxes, cells = ix.cells;
  const r = radius > 0.01 ? radius : 0.01, r2 = r * r;
  for (let it = 0; it < 3; it++) {
    let any = false;
    let i0 = Math.floor((pos.x - r) / cs), i1 = Math.floor((pos.x + r) / cs);
    let j0 = Math.floor((pos.z - r) / cs), j1 = Math.floor((pos.z + r) / cs);
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (i1 >= n) i1 = n - 1; if (j1 >= n) j1 = n - 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * n + i;
        if (ix.top[c] <= pos.y + STEP) continue;
        const cell = cells[c];
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k], p = id * 6;
          const yb0 = bb[p + 1], yb1 = bb[p + 4];
          if (yb1 <= pos.y + STEP || yb0 >= pos.y + height) continue;
          const minX = bb[p], maxX = bb[p + 3], minZ = bb[p + 2], maxZ = bb[p + 5];
          const qx = pos.x < minX ? minX : pos.x > maxX ? maxX : pos.x;
          const qz = pos.z < minZ ? minZ : pos.z > maxZ ? maxZ : pos.z;
          const ddx = pos.x - qx, ddz = pos.z - qz, d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r2) continue;
          const b = boxes[id];
          if (!b.alive || !b.solid) continue;
          // 머리만 살짝 닿는 경우: 올라가는 중이면 천장
          const pen = pos.y + height - yb0;
          if (vel.y > 0 && pen < 0.45) {
            pos.y -= pen + 0.001; vel.y = 0; res.ceiling = true; any = true;
            continue;
          }
          if (d2 > 1e-10) {
            const dd = Math.sqrt(d2), nx = ddx / dd, nz = ddz / dd, push = r - dd + 1e-4;
            pos.x += nx * push; pos.z += nz * push;
            const vn = vel.x * nx + vel.z * nz;
            if (vn < 0) { vel.x -= nx * vn; vel.z -= nz * vn; }
          } else {
            // 중심이 상자 안: 가장 얕은 축으로
            const pl = pos.x - minX + r, pr = maxX - pos.x + r, pn = pos.z - minZ + r, ps = maxZ - pos.z + r;
            let m = pl, ax = 0;
            if (pr < m) { m = pr; ax = 1; }
            if (pn < m) { m = pn; ax = 2; }
            if (ps < m) { m = ps; ax = 3; }
            if (ax === 0) { pos.x -= pl; if (vel.x > 0) vel.x = 0; }
            else if (ax === 1) { pos.x += pr; if (vel.x < 0) vel.x = 0; }
            else if (ax === 2) { pos.z -= pn; if (vel.z > 0) vel.z = 0; }
            else { pos.z += ps; if (vel.z < 0) vel.z = 0; }
          }
          res.wall = true; any = true;
        }
      }
    }
    if (!any) break;
  }
  if (pos.x < 1) pos.x = 1; else if (pos.x > S - 1) pos.x = S - 1;
  if (pos.z < 1) pos.z = 1; else if (pos.z > S - 1) pos.z = S - 1;
  // 바닥
  const f = floorAt(w, pos.x, pos.y, pos.z, r * 0.7);
  if (vel.y <= 0 && (pos.y <= f + 0.05 || (vel.y > -2.5 && pos.y - f < 0.32))) {
    pos.y = f; vel.y = 0; res.ground = true;
  }
  const th = heightAt(w, pos.x, pos.z);
  if (pos.y < th - 0.01) { pos.y = th; if (vel.y < 0) vel.y = 0; res.ground = true; }
  return res;
}
