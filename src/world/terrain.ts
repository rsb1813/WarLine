// 지형 질의: 높이(쌍선형), 지면 종류, 물.
import type { GroundType, Vec3, World } from '../types';

export function heightAt(w: World, x: number, z: number): number {
  const n = w.hfN;
  let fx = x / w.hfCell, fz = z / w.hfCell;
  if (!(fx > 0)) fx = 0; else if (fx >= n) fx = n - 1e-6;
  if (!(fz > 0)) fz = 0; else if (fz >= n) fz = n - 1e-6;
  const i = fx | 0, j = fz | 0;
  const u = fx - i, v = fz - j;
  const s = n + 1, k = j * s + i, H = w.heights;
  const a = H[k], b = H[k + 1], c = H[k + s], d = H[k + s + 1];
  return a + (b - a) * u + ((c - a) + (a - b - c + d) * u) * v;
}

export function groundTypeAt(w: World, x: number, z: number): GroundType {
  const n = w.hfN;
  let i = Math.floor(x / w.hfCell), j = Math.floor(z / w.hfCell);
  if (!(i > 0)) i = 0; else if (i >= n) i = n - 1;
  if (!(j > 0)) j = 0; else if (j >= n) j = n - 1;
  return w.ground[j * n + i] as GroundType;
}

export function inWater(w: World, x: number, z: number): boolean {
  return w.water > -1e8 && heightAt(w, x, z) < w.water;
}

/** 지형 법선 (중앙 차분) */
export function terrainNormal(w: World, x: number, z: number): Vec3 {
  const c = w.hfCell * 0.5;
  const nx = heightAt(w, x - c, z) - heightAt(w, x + c, z);
  const nz = heightAt(w, x, z - c) - heightAt(w, x, z + c);
  const ny = 2 * c;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}
