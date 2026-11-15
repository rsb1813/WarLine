// 파괴: 상자 피해, 건물 붕괴(잔해 상자 추가), 폭발 범위 피해.
import type { BreakResult, Building, Mat, Vec3, World } from '../types';
import { getIndex, indexBox, mixColor, mkBox, shade, unindexBox } from './core';
import { heightAt } from './terrain';
import { boxesNear } from './query';
import { hash2 } from '../math';

function kill(w: World, id: number, res: BreakResult): void {
  const b = w.boxes[id];
  if (!b.alive) return;
  b.alive = false;
  b.hp = 0;
  unindexBox(getIndex(w), b);
  w.brokenLog.push(id);
  res.broken.push(id);
}

/** 무너뜨리기: 남은 상자 전부 제거, 바닥에 잔해 상자 3~8개 (kind 'rubble', building = 건물 id, B.boxes 에도 추가) */
function collapse(w: World, B: Building, res: BreakResult): void {
  if (B.collapsed) return;
  B.collapsed = true;
  const ids = B.boxes.slice();
  let mat: Mat = 'concrete', x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = B.y;
  for (const id of ids) {
    const b = w.boxes[id];
    if (b.kind === 'wall' && b.mat !== 'glass') mat = b.mat;
    if (b.kind !== 'rubble') {
      if (b.min.x < x0) x0 = b.min.x; if (b.max.x > x1) x1 = b.max.x;
      if (b.min.z < z0) z0 = b.min.z; if (b.max.z > z1) z1 = b.max.z;
    }
    kill(w, id, res);
  }
  B.wallsAlive = 0;
  if (!(x1 > x0)) { x0 = B.x - B.w / 2; x1 = B.x + B.w / 2; z0 = B.z - B.d / 2; z1 = B.z + B.d / 2; }
  const bw = x1 - x0, bd = z1 - z0;
  const area = bw * bd;
  const count = Math.max(3, Math.min(8, 3 + Math.floor(area / 60)));
  const dust = mixColor(shade(B.color, 0.8), 0x8a857c, 0.55);
  const ix = getIndex(w);
  const tall = Math.min(1.6, 0.9 + B.floors * 0.2);
  let s = B.id * 7919 + w.collapseLog.length * 31;
  const rnd = (): number => hash2(s++, B.id, 911);
  for (let k = 0; k < count; k++) {
    let cx: number, cz: number, hw: number, hd: number, h: number;
    if (k === 0) {
      // 가운데 큰 더미
      cx = x0 + bw * (0.4 + rnd() * 0.2); cz = z0 + bd * (0.4 + rnd() * 0.2);
      hw = bw * 0.3; hd = bd * 0.3; h = tall;
    } else {
      cx = x0 + bw * (0.1 + rnd() * 0.8); cz = z0 + bd * (0.1 + rnd() * 0.8);
      hw = Math.max(0.8, bw * (0.12 + rnd() * 0.16)); hd = Math.max(0.8, bd * (0.12 + rnd() * 0.16));
      h = 0.6 + rnd() * Math.max(0, tall - 0.6) * 0.8;
    }
    const ax0 = Math.max(x0 - 0.6, cx - hw), ax1 = Math.min(x1 + 0.6, cx + hw);
    const az0 = Math.max(z0 - 0.6, cz - hd), az1 = Math.min(z1 + 0.6, cz + hd);
    const gy = Math.min(y0, heightAt(w, cx, cz)) - 0.3;
    const id = mkBox(w, 'rubble', mat, ax0, gy, az0, ax1, y0 + h, az1, shade(dust, 0.9 + rnd() * 0.15), B.id, { destructible: false, solid: true, opaque: true });
    B.boxes.push(id);
    indexBox(ix, w.boxes[id]);
  }
  w.collapseLog.push(B.id);
  res.collapsed.push(B.id);
}

function hit(w: World, id: number, dmg: number, res: BreakResult): void {
  const b = w.boxes[id];
  if (!b || !b.alive || !b.destructible || !(dmg > 0)) return;
  b.hp -= dmg;
  if (b.hp > 0) return;
  kill(w, id, res);
  if (b.building >= 0 && (b.kind === 'wall' || b.kind === 'window')) {
    const B = w.buildings[b.building];
    if (B && !B.collapsed) {
      B.wallsAlive--;
      if (B.wallsAlive < B.wallCount * 0.4) collapse(w, B, res);
    }
  }
}

export function damageBox(w: World, id: number, dmg: number): BreakResult {
  const res: BreakResult = { broken: [], collapsed: [] };
  hit(w, id, dmg, res);
  return res;
}

/** 폭발: 가장 가까운 점까지 거리로 선형 감쇠. 유리는 radius*1.5 안이면 무조건 깨진다 */
export function blastWorld(w: World, c: Vec3, radius: number, dmg: number): BreakResult {
  const res: BreakResult = { broken: [], collapsed: [] };
  if (!(radius > 0) || !(dmg > 0)) return res;
  const R = radius * 1.5;
  const ids: number[] = [], amt: number[] = [];
  boxesNear(w, c.x, c.z, R, (b) => {
    if (!b.destructible) return;
    const dx = c.x < b.min.x ? b.min.x - c.x : c.x > b.max.x ? c.x - b.max.x : 0;
    const dy = c.y < b.min.y ? b.min.y - c.y : c.y > b.max.y ? c.y - b.max.y : 0;
    const dz = c.z < b.min.z ? b.min.z - c.z : c.z > b.max.z ? c.z - b.max.z : 0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (b.mat === 'glass') { if (d <= R) { ids.push(b.id); amt.push(b.hp + 1); } return; }
    if (d > radius) return;
    ids.push(b.id); amt.push(dmg * Math.max(0.1, 1 - d / radius));
  });
  for (let i = 0; i < ids.length; i++) hit(w, ids[i], amt[i], res);
  return res;
}
