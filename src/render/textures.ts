// 절차 생성 텍스처 (외부 그림 파일 없음). 모두 캐시해 두고 dispose 로 한꺼번에 푼다.
//
// 재질 묶음 텍스처(pack): 채널마다 뜻이 정해진 데이터 텍스처 (색 공간 변환 없음)
//   R = 밝기 변조 (0.5 = 그대로), G = 둘째 색 가림(줄눈·벗겨진 칠·녹 ...), B = 때·얼룩, A = 높이(범프) 또는 덮임(울타리)
// 색 텍스처(도로, 깃발 천, 창틀, 헬기장)는 캔버스에 그린 CanvasTexture (sRGB).
import * as THREE from 'three';

// ───────────────────────── 반복되는(타일링) 잡음 ─────────────────────────

function ih(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 정수 격자 해시 0..1 (다른 모듈도 쓸 수 있게 공개) */
export const hashInt = ih;

const fract = (x: number): number => x - Math.floor(x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const wrapI = (i: number, p: number): number => ((i % p) + p) % p;

/** 주기 (px, py) 로 반복되는 값 잡음. x, y 는 격자 좌표 */
export function tnoise(x: number, y: number, px: number, py: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const x0 = wrapI(xi, px), y0 = wrapI(yi, py);
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = ih(x0, y0, s), b = ih(x1, y0, s), c = ih(x0, y1, s), d = ih(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** u, v ∈ [0,1) 에서 반복되는 fbm. fx, fy = 첫 옥타브 격자 수(정수) */
export function tfbm(u: number, v: number, fx: number, fy: number, oct: number, s: number, gain = 0.5): number {
  let sum = 0, amp = 1, tot = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * tnoise(u * fx * f, v * fy * f, fx * f, fy * f, s + o * 17);
    tot += amp; amp *= gain; f *= 2;
  }
  return sum / tot;
}

const cellOut = { f1: 0, f2: 0, id: 0 };
/** 반복되는 셀(보로노이) 잡음: f1, f2 (셀 크기 단위 거리), id (0..1) */
export function tcell(u: number, v: number, n: number, s: number): { f1: number; f2: number; id: number } {
  const x = u * n, y = v * n;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = wrapI(cx, n), wy = wrapI(cy, n);
      const px = cx + 0.15 + 0.7 * ih(wx, wy, s), py = cy + 0.15 + 0.7 * ih(wx, wy, s + 7);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < f1) { f2 = f1; f1 = d; id = ih(wx, wy, s + 13); } else if (d < f2) f2 = d;
    }
  }
  cellOut.f1 = Math.sqrt(f1); cellOut.f2 = Math.sqrt(f2); cellOut.id = id;
  return cellOut;
}

// ───────────────────────── 캐시 ─────────────────────────

const cache = new Map<string, THREE.Texture>();
let anisotropy = 1;

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  const t = cache.get(key);
  if (t) return t as T;
  const n = make();
  n.anisotropy = anisotropy;
  n.name = key;
  cache.set(key, n);
  return n;
}

/** 캐시된 텍스처 전부의 이방성 필터 값을 바꾼다 */
export function setTextureAnisotropy(a: number): void {
  anisotropy = Math.max(1, a);
  for (const t of cache.values()) {
    if (t.anisotropy !== anisotropy) { t.anisotropy = anisotropy; t.needsUpdate = true; }
  }
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

type PackFn = (u: number, v: number, o: Float32Array, i: number, j: number) => void;

/** 픽셀마다 fn 으로 채운 RGBA 데이터 텍스처 (반복, 밉맵) */
export function packTexture(w: number, h: number, fn: PackFn, srgb = false): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  const o = new Float32Array(4);
  let k = 0;
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h;
    for (let i = 0; i < w; i++) {
      o[0] = 0.5; o[1] = 0; o[2] = 0; o[3] = 1;
      fn((i + 0.5) / w, v, o, i, j);
      data[k++] = Math.round(clamp01(o[0]) * 255);
      data[k++] = Math.round(clamp01(o[1]) * 255);
      data[k++] = Math.round(clamp01(o[2]) * 255);
      data[k++] = Math.round(clamp01(o[3]) * 255);
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  return { c, g };
}

function canvasTex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────── 재질 묶음 텍스처 ─────────────────────────

export type PackId =
  | 'concrete' | 'concreteTop' | 'brick' | 'siding' | 'corrugated' | 'container' | 'planks'
  | 'roofmetal' | 'tar' | 'shingles' | 'sandbag' | 'rock' | 'crate' | 'plate'
  | 'chainlink' | 'picket' | 'foliage' | 'rubble';

/** 소련식 조립 패널 콘크리트 (한 장 = 타일 하나, 이음매는 타일 가장자리), 물 얼룩이 위에서 흘러내림 */
function genConcrete(top: boolean): THREE.DataTexture {
  const S = 512;
  return packTexture(S, S, (u, v, o) => {
    const blot = tfbm(u, v, 8, 8, 5, top ? 2 : 1);
    const fine = tnoise(u * 160, v * 160, 160, 160, 3);
    const pore = ih(Math.floor(u * S), Math.floor(v * S), 5) > 0.985 ? 1 : 0;
    // 타일 하나 = 패널 2x2 (패널마다 톤이 조금 다름)
    const pu = fract(u * 2), pv = fract(v * 2);
    const pid = ih(Math.floor(u * 2), Math.floor(v * 2), top ? 4 : 6);
    const sx = Math.min(pu, 1 - pu), sy = Math.min(pv, 1 - pv);
    const seam = top ? 0 : 1 - sstep(0.004, 0.012, Math.min(sx, sy));
    const streakN = tfbm(u, v, 64, 4, 3, 9);
    const streak = top ? 0 : sstep(0.52, 0.8, streakN) * sstep(0.0, 0.9, pv) * (0.5 + pid);
    const big = sstep(0.5, 0.8, tfbm(u, v, 4, 4, 4, 11));
    o[0] = 0.5 + (blot - 0.5) * 0.3 + (fine - 0.5) * 0.14 - pore * 0.18 + seam * 0.05 + (pid - 0.5) * (top ? 0.06 : 0.14);
    o[1] = seam;
    o[2] = clamp01(streak * 0.85 + big * 0.45);
    o[3] = 0.6 + (fine - 0.5) * 0.35 + (blot - 0.5) * 0.25 - seam * 0.5 - pore * 0.3;
  });
}

/** 붉은 벽돌 (2 m 타일: 한 줄에 8장, 28켜, 엇갈려 쌓기) */
function genBrick(): THREE.DataTexture {
  const S = 512, ROWS = 28, COLS = 8;
  return packTexture(S, S, (u, v, o) => {
    const ry = v * ROWS, row = Math.floor(ry), fy = ry - row;
    const off = (row & 1) * 0.5;
    const rx = u * COLS + off, col = Math.floor(rx), fx = rx - col;
    const cw = wrapI(col, COLS), rw = wrapI(row, ROWS);
    const bid = ih(cw, rw, 11);
    const dxm = Math.min(fx, 1 - fx) * (2 / COLS), dym = Math.min(fy, 1 - fy) * (2 / ROWS);
    const edge = Math.min(dxm, dym);
    const ne = tnoise(u * 96, v * 96, 96, 96, 4) * 0.005;
    const mortar = 1 - sstep(0.003 + ne, 0.007 + ne, edge);
    const tex = tnoise(u * 64, v * 64, 64, 64, 7);
    const chip = sstep(0.72, 0.8, tnoise(u * 40, v * 40, 40, 40, 8)) * (1 - sstep(0.0, 0.02, edge));
    let lum = 0.42 + bid * 0.2 + (tex - 0.5) * 0.14;
    if (bid > 0.92) lum -= 0.14;
    if (bid < 0.05) lum += 0.1;
    o[0] = lum;
    o[1] = clamp01(mortar + chip * 0.6);
    o[2] = sstep(0.58, 0.86, tfbm(u, v, 4, 4, 4, 21)) * 0.8;
    o[3] = (1 - mortar) * (0.65 + (tex - 0.5) * 0.25) * sstep(0.0, 0.012, edge) + 0.15 - chip * 0.3;
  });
}

/** 칠한 나무 판자벽 (가로 판자 12장 / 2 m, 아래쪽 턱 그림자, 칠 벗겨짐) */
function genSiding(): THREE.DataTexture {
  const S = 256, N = 12;
  return packTexture(S, S, (u, v, o) => {
    const by = v * N, b = Math.floor(by), fy = by - b;
    const bid = ih(wrapI(b, N), 0, 31);
    const lip = sstep(0.0, 0.06, fy);
    const grain = Math.sin((fy * 7 + tnoise(u * 12, v * N * 2, 12, N * 2, 33) * 5) * 6.283) * 0.5 + 0.5;
    const peel = sstep(0.7, 0.75, tfbm(u, v, 10, 10, 5, 35) + (1 - v) * 0.04) * (0.6 + 0.4 * tnoise(u * 40, v * 40, 40, 40, 36));
    // 판자 이음(세로 줄) 몇 군데
    const jx = fract(u * 3 + bid * 0.7);
    const joint = 1 - sstep(0.0, 0.006, Math.min(jx, 1 - jx));
    o[0] = 0.5 + (bid - 0.5) * 0.1 + (grain - 0.5) * 0.05 * (0.3 + peel) - (1 - lip) * 0.28 + fy * 0.07 - joint * 0.15;
    o[1] = peel;
    o[2] = clamp01(sstep(0.5, 0.9, tfbm(u, v, 3, 3, 3, 41)) * 0.6 + sstep(0.62, 0.9, tfbm(u, v, 24, 2, 3, 43)) * 0.4);
    o[3] = lip * (0.85 - 0.5 * fy) + (1 - lip) * 0.15 - joint * 0.2;
  });
}

/** 골함석 (세로 골 24개 / 2 m), 녹과 흘러내린 때 */
function genCorrugated(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o) => {
    const s = Math.sin(u * 24 * Math.PI * 2);
    const n = tfbm(u, v, 8, 8, 4, 51);
    const rust = clamp01(sstep(0.7, 0.8, tfbm(u, v, 8, 8, 5, 53)) * 0.8 + sstep(0.3, 0.0, v) * sstep(0.5, 0.72, tfbm(u, v, 40, 3, 3, 55)) + sstep(0.66, 0.85, tfbm(u, v, 30, 2, 3, 54)) * 0.35);
    const lap = 1 - sstep(0.0, 0.01, Math.min(v, 1 - v));
    o[0] = 0.5 + s * 0.04 + (n - 0.5) * 0.14 - lap * 0.12;
    o[1] = rust;
    o[2] = sstep(0.55, 0.85, tfbm(u, v, 32, 2, 3, 57)) * 0.7;
    o[3] = 0.5 + 0.42 * s - lap * 0.3;
  });
}

/** 컨테이너 벽: 사다리꼴 골, 위아래 레일 (v = 물체 높이 0..1) */
function genContainer(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o) => {
    const ph = fract(u * 10);
    let prof: number;
    if (ph < 0.12) prof = ph / 0.12; else if (ph < 0.5) prof = 1; else if (ph < 0.62) prof = 1 - (ph - 0.5) / 0.12; else prof = 0;
    const rail = v < 0.05 || v > 0.95 ? 1 : 0;
    const dent = tfbm(u, v, 4, 4, 3, 61);
    const scratch = sstep(0.8, 0.86, tnoise(u * 60, v * 6, 60, 6, 63));
    const rustN = tfbm(u, v, 8, 8, 5, 65);
    const streak = sstep(0.62, 0.8, tfbm(u, v, 36, 2, 3, 66)) * sstep(0.2, 0.9, 1 - v) * 0.5;
    const rust = clamp01(sstep(0.72, 0.8, rustN) * 0.8 + rail * sstep(0.5, 0.62, rustN) + scratch * 0.5 + sstep(0.1, 0.0, v) * sstep(0.52, 0.66, rustN) + streak);
    o[0] = rail ? 0.38 : 0.5 + prof * 0.04 + (dent - 0.5) * 0.12;
    o[1] = rust;
    o[2] = clamp01(sstep(0.55, 0.85, tfbm(u, v, 24, 2, 3, 67)) * 0.6 + sstep(0.25, 0.0, v) * 0.4);
    o[3] = rail ? 0.95 : 0.25 + prof * 0.5 + (dent - 0.5) * 0.15;
  });
}

/** 마루 널 (13장 / 2 m, 엇갈린 이음) */
function genPlanks(): THREE.DataTexture {
  const S = 256, N = 13;
  return packTexture(S, S, (u, v, o) => {
    const by = v * N, b = Math.floor(by), fy = by - b;
    const bw = wrapI(b, N);
    const sh = ih(bw, 1, 71);
    const ex = fract(u * 2 + sh);
    const seg = Math.floor(u * 2 + sh);
    const pid = ih(bw, wrapI(seg, 2), 73);
    const gap = Math.max(1 - sstep(0.0, 0.06, Math.min(fy, 1 - fy)), 1 - sstep(0.0, 0.004, Math.min(ex, 1 - ex)));
    const grain = Math.sin((fy * 5 + tnoise(u * 16, v * N * 2, 16, N * 2, 75) * 4) * 6.283) * 0.5 + 0.5;
    o[0] = 0.5 + (pid - 0.5) * 0.22 + (grain - 0.5) * 0.08;
    o[1] = gap;
    o[2] = sstep(0.55, 0.85, tfbm(u, v, 4, 4, 4, 77)) * 0.6;
    o[3] = 0.7 - gap * 0.6 + (grain - 0.5) * 0.05;
  });
}

/** 금속 지붕: 솟은 이음 4줄 / 2 m */
function genRoofMetal(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o) => {
    const ph = fract(u * 4);
    const d = Math.min(ph, 1 - ph);
    const seam = 1 - sstep(0.0, 0.025, d);
    const oil = tfbm(u, v, 4, 4, 3, 81);
    o[0] = 0.5 + seam * 0.1 + (oil - 0.5) * 0.1 - (1 - sstep(0.025, 0.05, d)) * 0.05;
    o[1] = sstep(0.7, 0.8, tfbm(u, v, 6, 6, 5, 83));
    o[2] = sstep(0.55, 0.85, tfbm(u, v, 2, 24, 3, 85)) * 0.6;
    o[3] = 0.35 + seam * 0.6 + (oil - 0.5) * 0.2;
  });
}

/** 평지붕 방수 시트 + 자갈 (4 m 타일) */
function genTar(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o, i, j) => {
    const g = ih(i, j, 91);
    const n = tfbm(u, v, 6, 6, 4, 93);
    const lapD = fract(v * 4);
    const lap = 1 - sstep(0.0, 0.012, Math.min(lapD, 1 - lapD));
    o[0] = 0.36 + (g - 0.5) * 0.22 + (n - 0.5) * 0.16 + lap * 0.06;
    o[1] = 0;
    o[2] = sstep(0.6, 0.85, tfbm(u, v, 3, 3, 4, 95)) * 0.8;
    o[3] = 0.4 + (g - 0.5) * 0.4 + lap * 0.4;
  });
}

/** 지붕 널(슁글) 10줄 / 2 m */
function genShingles(): THREE.DataTexture {
  const S = 256, R = 10, C = 6;
  return packTexture(S, S, (u, v, o) => {
    const ry = v * R, r = Math.floor(ry), fy = ry - r;
    const rx = u * C + (r & 1) * 0.5, c = Math.floor(rx), fx = rx - c;
    const id = ih(wrapI(c, C), wrapI(r, R), 101);
    const lip = sstep(0.0, 0.08, fy);
    const slot = 1 - sstep(0.0, 0.03, Math.min(fx, 1 - fx));
    o[0] = 0.48 + (id - 0.5) * 0.2 - (1 - lip) * 0.25 - slot * 0.2 + (tnoise(u * 64, v * 64, 64, 64, 103) - 0.5) * 0.1;
    o[1] = sstep(0.7, 0.78, tfbm(u, v, 8, 8, 4, 105));
    o[2] = sstep(0.5, 0.85, tfbm(u, v, 3, 3, 3, 107)) * 0.6;
    o[3] = lip * (0.9 - 0.5 * fy) - slot * 0.4 + 0.1;
  });
}

/** 모래주머니: 30 cm 줄 4개 / 1.2 m, 한 줄에 2개 엇갈림 */
function genSandbag(): THREE.DataTexture {
  const S = 256, R = 4, C = 2;
  return packTexture(S, S, (u, v, o, i, j) => {
    const ry = v * R, r = Math.floor(ry), fy = ry - r;
    const rx = u * C + (r & 1) * 0.5, c = Math.floor(rx), fx = rx - c;
    const id = ih(wrapI(c, C), wrapI(r, R), 111);
    const ex = (fx - 0.5) * 2, ey = (fy - 0.5) * 2;
    const d = Math.pow(Math.abs(ex), 3) * 0.9 + ey * ey;
    const pil = Math.sqrt(Math.max(0, 1 - d));
    const gap = 1 - sstep(0.0, 0.3, pil);
    const weave = ((i + j) & 1) * 0.5 + ((i - j) & 2) * 0.25;
    const fold = Math.max(0, Math.sin(fy * 40 + id * 6)) * sstep(0.35, 0.48, Math.abs(fx - 0.5));
    o[0] = 0.42 + id * 0.14 + pil * 0.12 + (weave - 0.4) * 0.05 - fold * 0.06;
    o[1] = gap;
    o[2] = sstep(0.5, 0.85, tfbm(u, v, 4, 4, 4, 113)) * 0.7;
    o[3] = pil * 0.85 + weave * 0.03 - fold * 0.05;
  });
}

/** 바위: 갈라진 틈, 층리, 이끼(지의류) */
function genRock(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o) => {
    const c = tcell(u, v, 6, 121);
    const crack = 1 - sstep(0.0, 0.07, c.f2 - c.f1);
    const fb = tfbm(u, v, 5, 5, 6, 123);
    const strata = Math.sin((v * 6 + fb * 3) * 6.283) * 0.5 + 0.5;
    o[0] = 0.42 + (fb - 0.5) * 0.42 + (strata - 0.5) * 0.08 + (c.id - 0.5) * 0.1 - crack * 0.2;
    o[1] = sstep(0.6, 0.68, tfbm(u, v, 10, 10, 4, 125)) * (1 - crack);
    o[2] = sstep(0.55, 0.8, tfbm(u, v, 3, 3, 4, 127)) * 0.7;
    o[3] = fb * 0.7 + 0.3 - crack * 0.45;
  });
}

/** 나무 상자 (면마다 0..1): 테두리, 가로 널, 대각 보강재 */
function genCrate(): THREE.DataTexture {
  const S = 128;
  return packTexture(S, S, (u, v, o) => {
    const fr = u < 0.1 || u > 0.9 || v < 0.1 || v > 0.9;
    const br = Math.abs(u - v) < 0.06 && !fr;
    const pv = fract(v * 4);
    const gap = !fr && !br && Math.min(pv, 1 - pv) < 0.025 ? 1 : 0;
    const grain = Math.sin((v * 30 + tnoise(u * 8, v * 32, 8, 32, 131) * 3) * 6.283) * 0.5 + 0.5;
    const id = fr ? 0.6 : br ? 0.7 : ih(Math.floor(v * 4), 0, 133);
    o[0] = 0.45 + (id - 0.5) * 0.16 + (grain - 0.5) * 0.08 + (fr || br ? 0.05 : 0);
    o[1] = gap;
    o[2] = sstep(0.55, 0.85, tfbm(u, v, 3, 3, 3, 135)) * 0.5;
    o[3] = fr || br ? 0.85 : 0.45 - gap * 0.4;
  });
}

/** 칠한 강판: 1 m 판, 용접 이음, 볼트, 칠 벗겨짐 */
function genPlate(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o) => {
    const pu = fract(u * 2), pv = fract(v * 2);
    const ds = Math.min(Math.min(pu, 1 - pu), Math.min(pv, 1 - pv));
    const seam = 1 - sstep(0.0, 0.008, ds);
    const near = 1 - sstep(0.02, 0.06, ds);
    const bx = fract(u * 20), by = fract(v * 20);
    const bolt = near * (1 - sstep(0.12, 0.2, Math.hypot(bx - 0.5, by - 0.5))) * (ds > 0.015 && ds < 0.04 ? 1 : 0);
    const chip = clamp01(sstep(0.68, 0.74, tfbm(u, v, 12, 12, 5, 141)) + near * sstep(0.55, 0.65, tfbm(u, v, 20, 20, 3, 143)));
    o[0] = 0.5 + (tfbm(u, v, 4, 4, 3, 145) - 0.5) * 0.1 - seam * 0.15 + bolt * 0.1;
    o[1] = chip;
    o[2] = sstep(0.55, 0.85, tfbm(u, v, 24, 2, 3, 147)) * 0.6;
    o[3] = 0.5 - seam * 0.4 + bolt * 0.45;
  });
}

/** 철망 울타리 (A = 덮임). u 는 월드 2.5 m, v 는 울타리 높이 0..1. 기둥 1개, 위아래 파이프 */
function genChainlink(): THREE.DataTexture {
  const W = 512, H = 256;
  return packTexture(W, H, (u, v, o) => {
    const cx = u * 42, cy = v * 32;
    const a1 = fract(cx + cy), a2 = fract(cx - cy);
    const d = Math.min(Math.min(a1, 1 - a1), Math.min(a2, 1 - a2));
    const wire = 1 - sstep(0.05, 0.11, d);
    const rail = v > 0.965 || v < 0.025 ? 1 : 0;
    const post = u < 0.012 || u > 0.988 ? 1 : 0;
    const cov = Math.max(wire, rail, post);
    o[0] = post || rail ? 0.55 : 0.62;
    o[1] = sstep(0.7, 0.8, tfbm(u, v, 10, 6, 3, 151)) * 0.8;
    o[2] = 0;
    o[3] = cov;
  });
}

/** 나무 울타리 (A = 덮임). 판자 13장 / 2 m, 뾰족한 머리, 가로대 2개 */
function genPicket(): THREE.DataTexture {
  const S = 256, N = 13;
  return packTexture(S, S, (u, v, o) => {
    const bx = u * N, b = Math.floor(bx), fx = bx - b;
    const id = ih(wrapI(b, N), 0, 161);
    const bf = fx / 0.64;
    const inBoard = bf < 1;
    const top = 0.86 + 0.12 * (1 - Math.abs(bf * 2 - 1)) - id * 0.03;
    const board = inBoard && v < top && v > 0.03;
    const rail = (v > 0.2 && v < 0.27) || (v > 0.68 && v < 0.75);
    const grain = Math.sin((u * 140 + tnoise(u * 20, v * 8, 20, 8, 163) * 4) * 6.283) * 0.5 + 0.5;
    o[0] = board ? 0.5 + (id - 0.5) * 0.16 + (grain - 0.5) * 0.06 : 0.38;
    o[1] = sstep(0.62, 0.7, tfbm(u, v, 8, 8, 4, 165));
    o[2] = sstep(0.3, 0.0, v) * 0.6;
    o[3] = board || rail ? 1 : 0;
  });
}

/** 생울타리·덤불 잎 덩어리 */
function genFoliage(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o) => {
    const c = tcell(u, v, 24, 171);
    const clump = 1 - sstep(0.2, 0.75, c.f1);
    const n = tfbm(u, v, 16, 16, 3, 173);
    o[0] = 0.3 + clump * 0.35 + (c.id - 0.5) * 0.15 + (n - 0.5) * 0.15;
    o[1] = 0;
    o[2] = (1 - clump) * 0.5;
    o[3] = clump * 0.7 + n * 0.3;
  });
}

/** 무너진 잔해: 부서진 콘크리트 조각, 철근 녹 */
function genRubble(): THREE.DataTexture {
  const S = 256;
  return packTexture(S, S, (u, v, o) => {
    const c = tcell(u, v, 10, 181);
    const edge = 1 - sstep(0.0, 0.08, c.f2 - c.f1);
    const n = tfbm(u, v, 8, 8, 5, 183);
    const rebar = sstep(0.93, 0.97, ih(Math.floor(u * 16), Math.floor(v * 16), 185)) * (1 - sstep(0.0, 0.05, Math.abs(fract(u * 16) - 0.5) - 0.42));
    o[0] = 0.45 + (c.id - 0.5) * 0.3 + (n - 0.5) * 0.25 - edge * 0.2;
    o[1] = clamp01(rebar + sstep(0.75, 0.82, n) * 0.5);
    o[2] = clamp01(edge * 0.6 + sstep(0.6, 0.8, tfbm(u, v, 3, 3, 3, 187)) * 0.5);
    o[3] = 0.3 + c.f1 * 0.5 + n * 0.3 - edge * 0.3;
  });
}

const PACKS: Record<PackId, () => THREE.DataTexture> = {
  concrete: () => genConcrete(false),
  concreteTop: () => genConcrete(true),
  brick: genBrick, siding: genSiding, corrugated: genCorrugated, container: genContainer,
  planks: genPlanks, roofmetal: genRoofMetal, tar: genTar, shingles: genShingles,
  sandbag: genSandbag, rock: genRock, crate: genCrate, plate: genPlate,
  chainlink: genChainlink, picket: genPicket, foliage: genFoliage, rubble: genRubble,
};

export function packTex(id: PackId): THREE.DataTexture {
  return cached('pack:' + id, PACKS[id]);
}

// ───────────────────────── 지형·자연 ─────────────────────────

/** 지형 세부: R 고운 결, G 큰 얼룩, B 자갈 셀(가장자리 0), A 반짝임 난수 */
export function terrainDetailTex(): THREE.DataTexture {
  return cached('terrainDetail', () => {
    const S = 512;
    return packTexture(S, S, (u, v, o, i, j) => {
      const c = tcell(u, v, 40, 201);
      const edge = sstep(0.0, 0.1, c.f2 - c.f1);
      o[0] = tfbm(u, v, 32, 32, 4, 203);
      o[1] = tfbm(u, v, 4, 4, 5, 205);
      o[2] = edge * (0.45 + 0.55 * c.id) * (1 - sstep(0.35, 0.7, c.f1) * 0.5);
      o[3] = ih(i, j, 207);
    });
  });
}

/** 물결 법선 맵 (접선 공간) */
export function waterNormalTex(): THREE.DataTexture {
  return cached('waterNormal', () => {
    const S = 256;
    const h = new Float32Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S, v = (j + 0.5) / S;
      h[j * S + i] = tfbm(u, v, 6, 6, 4, 211) + 0.45 * tfbm(u, v, 14, 14, 3, 213);
    }
    return packTexture(S, S, (_u, _v, o, i, j) => {
      const l = h[j * S + wrapI(i - 1, S)], r = h[j * S + wrapI(i + 1, S)];
      const d = h[wrapI(j - 1, S) * S + i], t = h[wrapI(j + 1, S) * S + i];
      const k = 9;
      let nx = (l - r) * k, ny = (d - t) * k, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz);
      nx *= il; ny *= il; nz *= il;
      o[0] = nx * 0.5 + 0.5; o[1] = ny * 0.5 + 0.5; o[2] = nz * 0.5 + 0.5; o[3] = 1;
    });
  });
}

/** 하늘 구름 잡음: R 큰 구름, G 잔 구름 */
export function cloudTex(): THREE.DataTexture {
  return cached('clouds', () => packTexture(256, 256, (u, v, o) => {
    o[0] = tfbm(u, v, 3, 3, 6, 221, 0.55);
    o[1] = tfbm(u, v, 6, 6, 5, 223, 0.5);
    o[2] = 0; o[3] = 1;
  }));
}

/** 나무껍질 (map 용, 밝기만): 세로 틈, 가로 껍질눈(자작나무) */
export function barkTex(): THREE.DataTexture {
  return cached('bark', () => packTexture(128, 256, (u, v, o) => {
    const fis = sstep(0.55, 0.78, tfbm(u, v, 10, 3, 4, 231));
    const gx = Math.floor(u * 10), gy = Math.floor(v * 48);
    const fx = fract(u * 10), fy = fract(v * 48);
    const dash = ih(wrapI(gx, 10), wrapI(gy, 48), 233) > 0.8 && Math.abs(fy - 0.5) < 0.16 && fx > 0.1 && fx < 0.85 ? 1 : 0;
    const n = tnoise(u * 32, v * 64, 32, 64, 235);
    const g = clamp01(0.92 - fis * 0.42 - dash * 0.6 + (n - 0.5) * 0.12);
    o[0] = g; o[1] = g; o[2] = g; o[3] = 1;
  }));
}

/** 겨울 자작나무 잔가지 덩어리 (알파 = 덮임, 캔버스에 갈라지는 가지를 그린다) */
export function twigTex(): THREE.CanvasTexture {
  return cached('twigs', () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    g.clearRect(0, 0, S, S);
    let k = 0;
    const rnd = () => ih(k++, 7, 251);
    g.lineCap = 'round';
    const limb = (x: number, y: number, a: number, len: number, wdt: number, depth: number) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      const l = 150 + rnd() * 70;
      g.strokeStyle = `rgb(${l},${l * 0.9},${l * 0.88})`;
      g.lineWidth = wdt;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      // 가장자리 넘어가면 반대편에도 (반복 텍스처)
      for (const [ox, oy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
        if (Math.min(x, x2) + ox < S && Math.max(x, x2) + ox > 0 && Math.min(y, y2) + oy < S && Math.max(y, y2) + oy > 0 && (ox || oy)) {
          g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x2 + ox, y2 + oy); g.stroke();
        }
      }
      if (depth <= 0) return;
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) limb(x2, y2, a + (rnd() - 0.5) * 1.4, len * (0.55 + rnd() * 0.2), Math.max(0.6, wdt * 0.62), depth - 1);
    };
    for (let i = 0; i < 26; i++) limb(rnd() * S, rnd() * S, -Math.PI / 2 + (rnd() - 0.5) * 1.6, 26 + rnd() * 22, 2.2, 4);
    const t = canvasTex(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// ───────────────────────── 캔버스 색 텍스처 ─────────────────────────

/** 아스팔트 도로 (가로 = 도로 폭 + 양옆 눈 둔덕, 세로 = 12 m 반복). 가장자리 알파가 흐려진다 */
export function roadTex(): THREE.CanvasTexture {
  return cached('road', () => {
    const W = 256, H = 512;
    const { c, g } = canvas(W, H);
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H;
      for (let i = 0; i < W; i++) {
        const u = (i + 0.5) / W;
        const n = tfbm(u, v, 8, 16, 4, 301);
        const sp = ih(i, j, 303);
        let r = 56 + (n - 0.5) * 22 + (sp - 0.5) * 18;
        let gg = r + 2, b = r + 5;
        // 바퀴 자국(어둡고 매끈), 자국 사이 눈 진창
        const track = Math.max(1 - sstep(0.0, 0.06, Math.abs(u - 0.3)), 1 - sstep(0.0, 0.06, Math.abs(u - 0.7)));
        r -= track * 10; gg -= track * 10; b -= track * 9;
        const slushN = tfbm(u, v, 12, 24, 4, 305);
        const slushBand = sstep(0.05, 0.0, Math.abs(u - 0.5) - 0.05) * 0.6 + sstep(0.25, 0.12, Math.min(u, 1 - u));
        const slush = clamp01((slushN - 0.45) * 3) * slushBand * 0.75;
        // 중앙 점선 (3 m / 12 m), 가장자리 실선, 닳음
        const wear = tfbm(u, v, 24, 48, 3, 307);
        const dash = Math.abs(u - 0.5) < 0.009 && v < 0.25 ? 1 : 0;
        const edge = Math.abs(Math.min(u, 1 - u) - 0.125) < 0.007 ? 1 : 0;
        const paint = Math.max(dash * 0.85, edge * 0.7) * sstep(0.35, 0.55, wear);
        r = r + (212 - r) * paint; gg = gg + (206 - gg) * paint; b = b + (186 - b) * paint;
        // 눈 진창
        r = r + (196 - r) * slush; gg = gg + (202 - gg) * slush; b = b + (208 - b) * slush;
        // 길가 눈 둔덕
        const eu = Math.min(u, 1 - u);
        const bankN = tfbm(u, v, 16, 32, 4, 309);
        const bank = sstep(0.115, 0.06, eu + (bankN - 0.5) * 0.05);
        const snowL = 228 + (bankN - 0.5) * 22;
        r = r + (snowL - r) * bank; gg = gg + (snowL + 4 - gg) * bank; b = b + (snowL + 10 - b) * bank;
        const alpha = sstep(0.0, 0.05, eu + (bankN - 0.5) * 0.03);
        const k = (j * W + i) * 4;
        d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = alpha * 255;
      }
    }
    g.putImageData(img, 0, 0);
    // 금 (어두운 가는 선)
    const rnd = (k: number) => ih(k, 17, 311);
    g.strokeStyle = 'rgba(28,28,30,0.55)';
    for (let k = 0; k < 14; k++) {
      g.lineWidth = 0.8 + rnd(k * 5) * 1.2;
      g.beginPath();
      let x = W * (0.15 + rnd(k * 5 + 1) * 0.7), y = H * rnd(k * 5 + 2);
      g.moveTo(x, y);
      const steps = 4 + Math.floor(rnd(k * 5 + 3) * 6);
      for (let s = 0; s < steps; s++) {
        x += (rnd(k * 31 + s) - 0.5) * 30; y += (rnd(k * 37 + s) - 0.3) * 26;
        g.lineTo(Math.max(W * 0.13, Math.min(W * 0.87, x)), y);
      }
      g.stroke();
    }
    // 덧씌운 아스팔트 땜질
    for (let k = 0; k < 5; k++) {
      g.fillStyle = `rgba(${34 + rnd(k + 90) * 10},${35 + rnd(k + 90) * 10},${38 + rnd(k + 90) * 10},0.55)`;
      const w = 20 + rnd(k + 70) * 50, h = 20 + rnd(k + 80) * 60;
      g.fillRect(W * (0.18 + rnd(k + 60) * 0.55), H * rnd(k + 50), w, h);
    }
    return canvasTex(c);
  });
}

/** 비포장 길: 눈 다져진 가운데, 자갈 바퀴 자국 2줄 */
export function trackTex(): THREE.CanvasTexture {
  return cached('track', () => {
    const W = 128, H = 256;
    const { c, g } = canvas(W, H);
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H;
      for (let i = 0; i < W; i++) {
        const u = (i + 0.5) / W;
        const n = tfbm(u, v, 8, 16, 4, 321);
        const sp = ih(i, j, 323);
        const rut = Math.max(1 - sstep(0.0, 0.1, Math.abs(u - 0.3) + (n - 0.5) * 0.04), 1 - sstep(0.0, 0.1, Math.abs(u - 0.7) + (n - 0.5) * 0.04));
        // 다져진 눈
        let r = 205 + (n - 0.5) * 30, gg = r + 4, b = r + 10;
        // 자갈·흙 자국
        const dr = 92 + (sp - 0.5) * 50 + (n - 0.5) * 30;
        const mud = rut * sstep(0.3, 0.6, n + rut * 0.3);
        r = r + (dr - r) * mud; gg = gg + (dr * 0.92 - gg) * mud; b = b + (dr * 0.82 - b) * mud;
        const eu = Math.min(u, 1 - u);
        const bank = sstep(0.14, 0.05, eu + (n - 0.5) * 0.06);
        r = r + (232 - r) * bank; gg = gg + (237 - gg) * bank; b = b + (244 - b) * bank;
        const k = (j * W + i) * 4;
        d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = sstep(0.0, 0.07, eu + (n - 0.5) * 0.04) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return canvasTex(c);
  });
}

/** 깃발 천 (흰색 바탕: 진영 색을 곱한다). 왼쪽 = 깃대 쪽 */
export function clothTex(): THREE.CanvasTexture {
  return cached('cloth', () => {
    const W = 128, H = 80;
    const { c, g } = canvas(W, H);
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const weave = ((i & 1) ^ (j & 1)) * 6 + ih(i, j, 331) * 8;
      let l = 236 + weave;
      if (i < 7) l -= 50;                        // 깃대 쪽 감침
      if (j < 3 || j > H - 4) l -= 30;           // 위아래 단
      // 가운데 문양: 테두리가 있는 마름모
      const cx = Math.abs(i - W * 0.55) / 22, cy = Math.abs(j - H / 2) / 22;
      const dd = cx + cy;
      if (dd < 1 && dd > 0.72) l -= 95;
      else if (dd < 0.45) l -= 70;
      const k = (j * W + i) * 4;
      d[k] = l; d[k + 1] = l; d[k + 2] = l; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = canvasTex(c, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** 창틀 (상자 면마다 0..1, 알파로 유리 자리 비움) */
export function frameTex(): THREE.CanvasTexture {
  return cached('frame', () => {
    const S = 64;
    const { c, g } = canvas(S, S);
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#ffffff';
    const b = Math.round(S * 0.09);
    g.fillRect(0, 0, S, b); g.fillRect(0, S - b, S, b); g.fillRect(0, 0, b, S); g.fillRect(S - b, 0, b, S);
    g.fillRect(S / 2 - 2, 0, 4, S);
    g.fillRect(0, Math.round(S * 0.36) - 2, S, 4);
    g.fillStyle = '#c8c8c8';
    g.fillRect(b, S - b - 2, S - 2 * b, 2);
    const t = canvasTex(c, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** 헬기장 표시 (콘크리트 원판, 고리, H) */
export function helipadTex(): THREE.CanvasTexture {
  return cached('helipad', () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    const img = g.createImageData(S, S);
    const d = img.data;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = (i + 0.5) / S - 0.5, y = (j + 0.5) / S - 0.5;
      const r = Math.hypot(x, y);
      const n = tnoise(i / 16, j / 16, 16, 16, 341);
      const l = 120 + (n - 0.5) * 30 + (ih(i, j, 343) - 0.5) * 16;
      const k = (j * S + i) * 4;
      d[k] = l; d[k + 1] = l; d[k + 2] = l + 3; d[k + 3] = sstep(0.5, 0.47, r) * 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(225,200,90,0.85)';
    g.lineWidth = S * 0.035;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(235,235,230,0.9)';
    const u = S / 100;
    g.fillRect(S / 2 - 22 * u, S / 2 - 26 * u, 10 * u, 52 * u);
    g.fillRect(S / 2 + 12 * u, S / 2 - 26 * u, 10 * u, 52 * u);
    g.fillRect(S / 2 - 12 * u, S / 2 - 5 * u, 24 * u, 10 * u);
    const t = canvasTex(c, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
