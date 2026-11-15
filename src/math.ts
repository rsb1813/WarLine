// 공통 수학 도우미. 리드 외에는 수정 금지 (필요한 건 각자 모듈 안에 만든다).
import type { Vec3 } from './types';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const set = (o: Vec3, x: number, y: number, z: number): Vec3 => { o.x = x; o.y = y; o.z = z; return o; };
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const addScaled = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
/** 수평 거리 (x, z) */
export const distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const smoothstep = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** 지수 감쇠 보간 계수: 초당 rate 만큼 따라간다 */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
export const DEG = Math.PI / 180;

/** 각도 차이를 -PI..PI 로 */
export const wrapAngle = (a: number): number => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
export const angleDiff = (from: number, to: number): number => wrapAngle(to - from);

/**
 * 시선 각에서 방향 벡터. yaw 0 = -Z, yaw 증가 = 왼쪽(반시계), pitch 양수 = 위.
 * Three.js 카메라에 그대로 쓰려면 camera.rotation.set(pitch, yaw, 0, 'YXZ').
 */
export const dirFrom = (yaw: number, pitch: number): Vec3 => {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
};
/** 수평 앞 방향, 오른쪽 방향 */
export const forwardXZ = (yaw: number): Vec3 => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
export const rightXZ = (yaw: number): Vec3 => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });
/** a 에서 b 를 바라보는 yaw, pitch */
export const yawTo = (a: Vec3, b: Vec3): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));
export const pitchTo = (a: Vec3, b: Vec3): number => Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));

/** 결정적 난수 (mulberry32) */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 정수 좌표 해시 → 0..1 */
export const hash2 = (x: number, y: number, seed = 0): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** 값 잡음 (부드러운 2D) */
export function valueNoise(seed: number): (x: number, y: number) => number {
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}
/** 여러 옥타브 잡음 0..1 */
export function fbm(seed: number, oct = 4): (x: number, y: number) => number {
  const n = valueNoise(seed);
  return (x, y) => {
    let s = 0, a = 0.5, f = 1, t = 0;
    for (let i = 0; i < oct; i++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2.03; }
    return s / t;
  };
}
/** 원뿔 안 무작위 방향 (반각 rad) */
export function spreadDir(d: Vec3, half: number, r: () => number): Vec3 {
  if (half <= 0) return d;
  const up = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const a = norm(cross(d, up)), b = cross(a, d);
  const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * Math.tan(half);
  return norm({ x: d.x + (a.x * Math.cos(ang) + b.x * Math.sin(ang)) * rad, y: d.y + (a.y * Math.cos(ang) + b.y * Math.sin(ang)) * rad, z: d.z + (a.z * Math.cos(ang) + b.z * Math.sin(ang)) * rad });
}
/** 광선과 구: 가장 가까운 t (없으면 -1) */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  const s = Math.sqrt(h);
  const t = -b - s;
  return t >= 0 ? t : -b + s >= 0 ? 0 : -1;
}
/** 광선과 캡슐(선분 a-b, 반지름 r): 가장 가까운 t (없으면 -1). 근사: 선분 위 가장 가까운 점의 구로 판정 */
export function rayCapsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: number): number {
  const ba = sub(b, a), oa = sub(o, a);
  const baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
  const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  const t1 = raySphere(o, d, a, r), t2 = raySphere(o, d, b, r);
  if (t1 < 0) return t2; if (t2 < 0) return t1;
  return Math.min(t1, t2);
}
/** 광선과 축 정렬 상자: 들어가는 t 와 법선 축 (없으면 null) */
export function rayAABB(o: Vec3, d: Vec3, min: Vec3, max: Vec3, maxT: number): { t: number; nx: number; ny: number; nz: number } | null {
  let t0 = 0, t1 = maxT, nx = 0, ny = 0, nz = 0;
  const ax: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i++) {
    const k = ax[i];
    const inv = 1 / (d[k] || 1e-12);
    let ta = (min[k] - o[k]) * inv, tb = (max[k] - o[k]) * inv;
    let s = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
    if (ta > t0) { t0 = ta; nx = i === 0 ? s : 0; ny = i === 1 ? s : 0; nz = i === 2 ? s : 0; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return { t: t0, nx, ny, nz };
}
