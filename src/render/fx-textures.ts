// render-fx: 절차 생성 스프라이트 아틀라스 (8×8 칸). 외부 그림 파일 없음.
// 연기·먼지 뭉치, 불꽃 플립북 16장, 섬광 별, 불티 줄, 충격파 고리, 파편 조각, 유리 조각, 나뭇잎, 물방울,
// 총구 옆 불꽃, 탄흔·유리 금·그을음·눈 자국 데칼. 한 번만 만든다.
import * as THREE from 'three';
import { clamp, rng, smoothstep } from '../math';

export const GRID = 8;

/** 아틀라스 칸 번호 */
export const F = {
  SMOKE: 0,   // 0..3 연기 4종
  DUST: 4,    // 4..5 먼지 2종
  GLOW: 6,
  STAR: 7,
  FIRE: 8,    // 8..23 불꽃 플립북
  FIRE_N: 16,
  RING: 24,
  STREAK: 25,
  CHIP: 26,
  SPLINTER: 27,
  SHARD: 28,
  LEAF: 29,
  DROP: 30,
  CONE: 31,
  HOLE: 32,
  CRACK: 33,
  SCORCH: 34,
  DENT: 35,
  FLARE: 36,
  CHIP2: 37,
} as const;

type Px = [number, number, number, number];
type Painter = (u: number, v: number, o: Px) => void;

/** 표 기반 값 잡음 0..1 (math.valueNoise 보다 훨씬 빠름: 아틀라스 생성 시간 줄이기) */
function valueNoise(seed: number): (x: number, y: number) => number {
  const r = rng(seed);
  const perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { val[i] = r(); perm[i] = i; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255;
    const p0 = perm[Y], p1 = perm[Y + 1];
    const a = val[perm[X + p0]], b = val[perm[X + 1 + p0]], c = val[perm[X + p1]], d = val[perm[X + 1 + p1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** 여러 옥타브 값 잡음 0..1 */
function fbm(seed: number, oct: number): (x: number, y: number) => number {
  const n = valueNoise(seed);
  let tot = 0;
  for (let o = 0, a = 0.5; o < oct; o++, a *= 0.5) tot += a;
  return (x, y) => {
    let s = 0, a = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { s += n(x * f + o * 17.31, y * f + o * 9.13) * a; a *= 0.5; f *= 2.03; }
    return s / tot;
  };
}

/** 0..1 로 대비를 늘린 잡음 */
const contrast = (n: number, k: number): number => clamp((n - 0.5) * k + 0.5, 0, 1);

/** 곧은 알파 'over' 합성 */
function over(o: Px, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  const oa = a + o[3] * (1 - a);
  if (oa <= 1e-6) return;
  const k = o[3] * (1 - a);
  o[0] = (r * a + o[0] * k) / oa;
  o[1] = (g * a + o[1] * k) / oa;
  o[2] = (b * a + o[2] * k) / oa;
  o[3] = oa;
}

function smokePainter(seed: number, soft: boolean): Painter {
  const nA = fbm(seed, 3), nB = fbm(seed + 17, 5);
  return (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y);
    const warp = nA(x * 1.7 + 5.3, y * 1.7 + 9.1);
    const d = contrast(nB(x * 3.3 + 1.7, y * 3.3 + 3.9), 2.4);
    let a: number;
    if (soft) {
      const rr = r * (1 + (warp - 0.5) * 0.6);
      a = Math.pow(smoothstep(1.0, 0.0, rr), 1.5) * (0.62 + 0.5 * d);
    } else {
      const rr = r * (1 + (warp - 0.5) * 1.0);
      a = smoothstep(1.0, 0.22, rr) * (0.42 + 0.78 * d);
    }
    a = clamp(a, 0, 1) * smoothstep(1.0, 0.86, r);
    const sh = clamp((soft ? 0.86 + 0.14 * d : 0.7 + 0.3 * d) + 0.07 * y, 0, 1);
    o[0] = sh; o[1] = sh; o[2] = sh; o[3] = a;
  };
}

const FIRE_RAMP: [number, number, number, number][] = [
  [0.0, 0.18, 0.04, 0.01], [0.3, 0.75, 0.18, 0.02], [0.55, 1.0, 0.5, 0.08], [0.8, 1.0, 0.82, 0.42], [1.0, 1.0, 0.98, 0.85],
];

function firePainter(frame: number, frames: number): Painter {
  const t = frame / (frames - 1);
  const nA = fbm(311, 5), nB = fbm(733, 3);
  // 온도 → 색 (sRGB)
  const st = FIRE_RAMP;
  const ramp = (h: number, o: Px): void => {
    h = clamp(h, 0, 1);
    for (let i = 1; i < st.length; i++) {
      if (h <= st[i][0]) {
        const a = st[i - 1], b = st[i], k = (h - a[0]) / (b[0] - a[0]);
        o[0] = a[1] + (b[1] - a[1]) * k; o[1] = a[2] + (b[2] - a[2]) * k; o[2] = a[3] + (b[3] - a[3]) * k;
        return;
      }
    }
  };
  return (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y);
    const n1 = nA(x * 2.1 + 13.0 + frame * 0.37, y * 2.1 - t * 3.2 + 7.0);
    const n2 = nB(x * 5.2 + 3.0, y * 5.2 - t * 6.5 + frame * 0.21);
    const rad = 0.6 + 0.32 * t;
    const edge = 1 - r / rad;
    const turb = (n1 - 0.5) * (0.9 + 1.2 * t) + (n2 - 0.5) * 0.55;
    const dens = clamp((edge + turb * 0.95 - t * 0.32) * 2.2, 0, 1);
    const heat = dens * (1.12 - t * 0.8) + 0.12 * (1 - r) * (1 - t);
    ramp(heat, o);
    o[3] = smoothstep(0.0, 0.3, dens) * (1 - t * 0.45) * smoothstep(1.0, 0.85, r);
  };
}

function chipPainter(seed: number): Painter {
  const n = valueNoise(seed), n2 = fbm(seed + 3, 3);
  return (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y);
    const ang = Math.atan2(y, x);
    const rad = 0.45 + 0.42 * n(Math.cos(ang) * 1.6 + 3, Math.sin(ang) * 1.6 + 3);
    const facet = clamp(0.55 - 0.35 * (x * 0.7 - y * 0.7) + (n2(x * 4, y * 4) - 0.5) * 0.5, 0, 1);
    const sh = 0.55 + 0.45 * facet;
    o[0] = sh; o[1] = sh; o[2] = sh;
    o[3] = smoothstep(rad, rad - 0.07, r);
  };
}

function paint(data: Uint8Array, S: number, C: number, cell: number, fn: Painter): void {
  const cx = cell % GRID, cy = Math.floor(cell / GRID);
  const o: Px = [1, 1, 1, 0];
  for (let py = 0; py < C; py++) {
    const v = (py + 0.5) / C;
    for (let px = 0; px < C; px++) {
      const u = (px + 0.5) / C;
      o[0] = 1; o[1] = 1; o[2] = 1; o[3] = 0;
      fn(u, v, o);
      const i = ((cy * C + py) * S + cx * C + px) * 4;
      data[i] = clamp(o[0], 0, 1) * 255 + 0.5;
      data[i + 1] = clamp(o[1], 0, 1) * 255 + 0.5;
      data[i + 2] = clamp(o[2], 0, 1) * 255 + 0.5;
      data[i + 3] = clamp(o[3], 0, 1) * 255 + 0.5;
    }
  }
}

/** 아틀라스 만들기. cell = 한 칸 픽셀 (낮음 64, 보통 96, 높음 128) */
export function makeAtlas(cell: number): THREE.DataTexture {
  const C = cell, S = C * GRID;
  const data = new Uint8Array(S * S * 4);
  // 투명 칸의 색은 흰색 (선형 필터링 때 검은 테두리 방지)
  for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 0; }

  for (let i = 0; i < 4; i++) paint(data, S, C, F.SMOKE + i, smokePainter(1000 + i * 77, false));
  for (let i = 0; i < 2; i++) paint(data, S, C, F.DUST + i, smokePainter(2000 + i * 91, true));

  paint(data, S, C, F.GLOW, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r2 = x * x + y * y;
    o[3] = clamp(Math.exp(-r2 * 6) * 0.8 + Math.exp(-r2 * 40) * 0.4, 0, 1) * smoothstep(1.0, 0.75, Math.sqrt(r2));
  });

  paint(data, S, C, F.STAR, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x);
    const rays = Math.pow(Math.abs(Math.cos(ang * 2)), 70) + Math.pow(Math.abs(Math.cos(ang * 3 + 0.5)), 26) * 0.55;
    const ray = rays * Math.pow(Math.max(0, 1 - r), 1.6);
    const a = Math.exp(-r * r * 28) + ray + Math.exp(-r * r * 5) * 0.32;
    o[0] = 1; o[1] = 1 - 0.12 * r; o[2] = 1 - 0.38 * r;
    o[3] = clamp(a, 0, 1) * smoothstep(1.0, 0.88, r);
  });

  paint(data, S, C, F.FLARE, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y), ax = 1 - Math.abs(x);
    const a = Math.exp(-y * y * 420) * ax * ax * 0.85 + Math.exp(-y * y * 50) * ax * ax * ax * 0.25 + Math.exp(-r * r * 30) * 0.6;
    o[0] = 0.85; o[1] = 0.92; o[2] = 1;
    o[3] = clamp(a, 0, 1) * smoothstep(1.0, 0.92, Math.abs(x)) * smoothstep(1.0, 0.9, Math.abs(y));
  });

  for (let f = 0; f < F.FIRE_N; f++) paint(data, S, C, F.FIRE + f, firePainter(f, F.FIRE_N));

  {
    const n = valueNoise(57);
    paint(data, S, C, F.RING, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1, r0 = Math.sqrt(x * x + y * y);
      const r = r0 + (n(x * 6 + 2, y * 6 + 2) - 0.5) * 0.05;
      const ring = Math.exp(-Math.pow((r - 0.8) / 0.075, 2));
      const fill = smoothstep(0.82, 0.3, r) * 0.2 * (r / 0.82);
      o[3] = clamp(ring + fill, 0, 1) * smoothstep(0.99, 0.92, r0);
    });
  }

  paint(data, S, C, F.STREAK, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1;
    const core = Math.exp(-Math.pow(x / 0.13, 2)) + Math.exp(-Math.pow(x / 0.4, 2)) * 0.3;
    const along = smoothstep(-1, -0.35, y) * smoothstep(1, 0.82, y);
    const head = 0.35 + 0.65 * (y * 0.5 + 0.5);
    o[3] = clamp(core * along * head, 0, 1) * smoothstep(1, 0.85, Math.abs(x));
  });

  paint(data, S, C, F.CHIP, chipPainter(401));
  paint(data, S, C, F.CHIP2, chipPainter(977));

  {
    const n = valueNoise(88);
    paint(data, S, C, F.SPLINTER, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1;
      const w = 0.16 * Math.pow(Math.max(0, 1 - y * y), 0.7) * (0.7 + 0.6 * n(y * 7 + 1, 3.3));
      const grain = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(x * 60 + n(y * 3, x * 3) * 5));
      o[0] = grain; o[1] = grain; o[2] = grain;
      o[3] = smoothstep(w, w * 0.55, Math.abs(x)) * smoothstep(1, 0.9, Math.abs(y));
    });
  }

  const A = [-0.38, -0.78, 0], B = [0.6, -0.12, 0], Cc = [-0.08, 0.88, 0];
  A[2] = Math.hypot(B[0] - A[0], B[1] - A[1]); B[2] = Math.hypot(Cc[0] - B[0], Cc[1] - B[1]); Cc[2] = Math.hypot(A[0] - Cc[0], A[1] - Cc[1]);
  paint(data, S, C, F.SHARD, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1;
    const e = (p: number[], q: number[]): number => ((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])) / p[2];
    const d = Math.min(e(A, B), e(B, Cc), e(Cc, A));
    const edgeHi = Math.exp(-Math.pow(e(B, Cc) / 0.06, 2));
    const sh = clamp(0.7 + 0.2 * (y * 0.5 + 0.5) + edgeHi * 0.4, 0, 1);
    o[0] = sh; o[1] = sh; o[2] = sh;
    o[3] = smoothstep(0, 0.04, d) * (0.6 + 0.4 * edgeHi);
  });

  paint(data, S, C, F.LEAF, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1;
    const e = (x / 0.4) ** 2 + (y / 0.82) ** 2;
    const rib = 0.78 + 0.22 * smoothstep(0, 0.06, Math.abs(x));
    o[0] = rib; o[1] = rib; o[2] = rib;
    o[3] = smoothstep(1, 0.82, e);
  });

  paint(data, S, C, F.DROP, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y);
    const h = Math.exp(-((x + 0.25) ** 2 + (y - 0.3) ** 2) * 30);
    const sh = 0.82 + 0.18 * h;
    o[0] = sh; o[1] = sh; o[2] = sh;
    o[3] = smoothstep(0.85, 0.5, r) * 0.9;
  });

  {
    const n = fbm(515, 3);
    paint(data, S, C, F.CONE, (u, v, o) => {
      const x = u * 2 - 1, s = v; // s: 0 = 총구(밑), 1 = 끝
      const wid = 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.8) * (1 - s * 0.35) + 0.1 * (1 - s);
      const jag = (n(x * 4 + 1, s * 7 + 2) - 0.5) * 0.35;
      const w = Math.max(0.02, wid + jag * wid);
      const k = clamp(Math.abs(x) / w, 0, 1);
      o[0] = 1; o[1] = 0.95 - 0.3 * k; o[2] = 0.75 - 0.55 * k;
      o[3] = smoothstep(1, 0.25, k) * Math.pow(1 - s, 0.55) * smoothstep(0, 0.06, s) * smoothstep(1, 0.85, Math.abs(x));
    });
  }

  {
    const nn = fbm(808, 4), na = valueNoise(809);
    const hA: number[] = [], hL: number[] = [];
    for (let k = 0; k < 6; k++) { hA.push(k * 1.047 + na(k * 3.1, 1.7) * 0.8); hL.push(0.5 + 0.4 * na(k * 1.3, 4.1)); }
    paint(data, S, C, F.HOLE, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x);
      const n = contrast(nn(x * 6 + 4, y * 6 + 4), 2);
      o[0] = 1; o[1] = 1; o[2] = 1; o[3] = 0;
      // 그을음 테
      over(o, 0.35, 0.33, 0.31, 0.4 * smoothstep(0.85, 0.25, r));
      // 금
      let crack = 0;
      for (let k = 0; k < 6; k++) {
        const a0 = hA[k];
        let da = Math.abs(ang - a0); da = Math.min(da, Math.PI * 2 - da);
        const lenK = hL[k];
        crack = Math.max(crack, Math.exp(-Math.pow((da * r) / 0.022, 2)) * smoothstep(lenK, lenK * 0.6, r) * smoothstep(0.1, 0.2, r));
      }
      over(o, 0.18, 0.17, 0.16, crack * 0.85);
      // 패인 자리
      const cr = 0.36 + 0.1 * n;
      over(o, 0.32 + 0.3 * n, 0.31 + 0.3 * n, 0.3 + 0.3 * n, 0.92 * smoothstep(cr, cr - 0.05, r));
      // 구멍
      const hr = 0.15 + 0.04 * n;
      over(o, 0.03, 0.03, 0.03, smoothstep(hr, hr - 0.04, r));
    });
  }

  {
    const na = valueNoise(919);
    const cA: number[] = [], cL: number[] = [];
    for (let k = 0; k < 8; k++) { cA.push(k * 0.785 + na(k * 2.3, 0.5) * 0.6); cL.push(0.6 + 0.35 * na(k * 1.7, 2.2)); }
    paint(data, S, C, F.CRACK, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x);
      o[0] = 1; o[1] = 1; o[2] = 1; o[3] = 0;
      over(o, 0.75, 0.78, 0.8, 0.35 * smoothstep(0.25, 0.05, r));
      let line = 0;
      for (let k = 0; k < 8; k++) {
        const a0 = cA[k];
        let da = Math.abs(ang - a0 - Math.sin(r * 9 + k) * 0.05); da = Math.min(da, Math.PI * 2 - da);
        const lenK = cL[k];
        line = Math.max(line, Math.exp(-Math.pow((da * r) / 0.012, 2)) * smoothstep(lenK, lenK * 0.7, r));
      }
      for (let k = 0; k < 2; k++) {
        const rr = 0.25 + k * 0.22 + (na(ang * 2, k * 5) - 0.5) * 0.05;
        line = Math.max(line, Math.exp(-Math.pow((r - rr) / 0.012, 2)) * (na(Math.cos(ang) * 4 + k, Math.sin(ang) * 4) > 0.45 ? 1 : 0));
      }
      over(o, 0.35, 0.38, 0.4, line * 0.8 * smoothstep(0.98, 0.85, r));
      over(o, 0.08, 0.08, 0.08, smoothstep(0.06, 0.035, r));
    });
  }

  {
    const n = fbm(1212, 4), n2 = fbm(1313, 3), na = valueNoise(1414);
    paint(data, S, C, F.SCORCH, (u, v, o) => {
      const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x);
      const m = contrast(n(x * 3 + 2, y * 3 + 2), 2);
      const d = contrast(n2(x * 7 + 5, y * 7 + 5), 2);
      const rr = r * (1 + (m - 0.5) * 0.55);
      let a = Math.pow(smoothstep(1.0, 0.12, rr), 0.85) * (0.78 + 0.22 * d);
      const rays = Math.pow(na(Math.cos(ang) * 3.5 + 7, Math.sin(ang) * 3.5 + 7), 3);
      a = clamp(a + smoothstep(0.98, 0.35, r) * rays * 0.45, 0, 0.97) * smoothstep(1.0, 0.9, r);
      const c = 0.05 + 0.12 * d;
      o[0] = c; o[1] = c * 0.95; o[2] = c * 0.9; o[3] = a;
    });
  }

  paint(data, S, C, F.DENT, (u, v, o) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.sqrt(x * x + y * y);
    const sh = 0.42 + 0.35 * smoothstep(0.6, -0.6, y);
    o[0] = sh; o[1] = sh; o[2] = sh;
    o[3] = Math.pow(smoothstep(1, 0.05, r), 1.3) * 0.85;
  });

  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
