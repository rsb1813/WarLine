// 소리 레시피: 모두 합성. 각 함수는 채널 배열(Float32Array[])을 돌려주고 audio.ts 가 AudioBuffer 로 캐시한다.
import type { GunSound } from '../types';
import {
  type Buf, addTo, biquad, echo, envAD, fadeOut, grain, loopify, normalize, partials, rnd, samples, shape, softClip, svf, sweep, tone, white,
} from './dsp';

export type GunKind = GunSound['kind'];
/** own = 내 총 (스테레오, 가까이), near < 40m, mid < 140m, far 그 너머 */
export type GunDist = 'own' | 'near' | 'mid' | 'far';

/** 총소리 매개변수 */
export interface GunSpec {
  /** 몸통 대역 중심 Hz, Q, 몸통 감쇠 s */
  bp: number; bq: number; body: number;
  /** 날카로운 균열음 세기 */
  crack: number;
  /** 저음 쿵: 시작·끝 Hz, 감쇠 s, 세기 */
  th0: number; th1: number; thT: number; th: number;
  /** 잔향 감쇠 s, 잔향 저역 통과 Hz, 길이 s, 잔향 세기 */
  tail: number; tailLp: number; len: number; tailG: number;
}

export const GUN: Record<GunKind, GunSpec> = {
  rifle:   { bp: 1500, bq: 0.8, body: 0.017, crack: 1.0, th0: 150, th1: 52, thT: 0.055, th: 0.9, tail: 0.30, tailLp: 3200, len: 0.9, tailG: 1 },
  carbine: { bp: 1750, bq: 0.8, body: 0.014, crack: 0.95, th0: 165, th1: 58, thT: 0.05, th: 0.8, tail: 0.26, tailLp: 3400, len: 0.8, tailG: 0.95 },
  smg:     { bp: 2300, bq: 0.9, body: 0.010, crack: 0.75, th0: 200, th1: 75, thT: 0.035, th: 0.5, tail: 0.2, tailLp: 3800, len: 0.6, tailG: 0.8 },
  lmg:     { bp: 1350, bq: 0.75, body: 0.020, crack: 1.0, th0: 140, th1: 48, thT: 0.06, th: 1.0, tail: 0.34, tailLp: 3000, len: 1.0, tailG: 1.05 },
  dmr:     { bp: 1250, bq: 0.7, body: 0.022, crack: 1.2, th0: 140, th1: 45, thT: 0.07, th: 1.1, tail: 0.45, tailLp: 3000, len: 1.2, tailG: 1.15 },
  sniper:  { bp: 1050, bq: 0.7, body: 0.028, crack: 1.45, th0: 125, th1: 38, thT: 0.09, th: 1.35, tail: 0.8, tailLp: 2600, len: 1.9, tailG: 1.35 },
  shotgun: { bp: 850, bq: 0.6, body: 0.035, crack: 0.7, th0: 115, th1: 42, thT: 0.095, th: 1.5, tail: 0.45, tailLp: 2400, len: 1.2, tailG: 1.2 },
  pistol:  { bp: 2500, bq: 0.9, body: 0.008, crack: 0.85, th0: 230, th1: 85, thT: 0.032, th: 0.45, tail: 0.18, tailLp: 4000, len: 0.55, tailG: 0.75 },
};
/** 차량 기관포 (쿵쿵) */
export const AUTOCANNON: GunSpec = { bp: 700, bq: 0.8, body: 0.03, crack: 1.1, th0: 120, th1: 44, thT: 0.085, th: 1.7, tail: 0.42, tailLp: 2200, len: 1.3, tailG: 1.25 };
/** 차량 중기관총 */
export const HMG: GunSpec = { bp: 1150, bq: 0.75, body: 0.024, crack: 1.1, th0: 130, th1: 45, thT: 0.065, th: 1.15, tail: 0.36, tailLp: 2800, len: 1.0, tailG: 1.1 };

const DSEED: Record<GunDist, number> = { own: 11, near: 23, mid: 37, far: 53 };

/** 기계 철컥 (노리쇠) */
function mechClick(sr: number, seed: number, pitch = 1): Buf {
  const b = partials(sr, 0.06, [[2900 * pitch, 1, 0.01], [4300 * pitch, 0.6, 0.007], [6200 * pitch, 0.35, 0.004], [1700 * pitch, 0.4, 0.015]]);
  const nz = white(samples(sr, 0.012), seed);
  envAD(nz, sr, 0.0001, 0.0015);
  biquad(nz, sr, 'hp', 2800);
  addTo(b, nz, 0.9);
  return b;
}

/** 총성 한 발. v = 변형 번호 */
export function gunShot(sr: number, P: GunSpec, punch: number, dist: GunDist, v: number, seedBase: number): Buf[] {
  const sd = seedBase * 131 + v * 977 + DSEED[dist];
  const far = dist === 'far', mid = dist === 'mid', own = dist === 'own';
  const len = far ? 2.6 : mid ? 1.7 : P.len * (own ? 1.15 : 1);
  const n = samples(sr, len);
  const core = new Float32Array(n);
  const vf = 1 + (v - 0.5) * 0.07;
  // 1. 순간 균열 (고역 딸깍)
  if (!far) {
    const t = white(samples(sr, 0.004), sd + 1);
    envAD(t, sr, 0.00004, 0.00045);
    biquad(t, sr, 'hp', 1500, 0.6);
    addTo(core, t, 1.4 * P.crack * (mid ? 0.25 : 1));
  }
  // 2. 몸통: 대역 통과 잡음 폭발
  const body = white(samples(sr, Math.min(len, P.body * 9 + 0.01)), sd + 2);
  envAD(body, sr, 0.0003, P.body);
  biquad(body, sr, 'bp', P.bp * vf, P.bq);
  addTo(core, body, 2.2);
  // 넓은 대역 균열
  if (!far) {
    const c = white(samples(sr, P.body * 4 + 0.006), sd + 3);
    envAD(c, sr, 0.0001, P.body * 0.35);
    biquad(c, sr, 'lp', 9500, 0.7);
    addTo(core, c, 0.9 * P.crack * (mid ? 0.3 : 1));
  }
  // 3. 총구 폭풍 (저중역)
  const m = white(samples(sr, Math.min(len, P.body * 16 + 0.03)), sd + 4);
  envAD(m, sr, 0.0007, P.body * 2.5);
  biquad(m, sr, 'lp', 1000 * vf, 0.8);
  biquad(m, sr, 'hp', 60, 0.7);
  addTo(core, m, 1.6 * P.th);
  // 4. 저음 쿵 (음높이 떨어짐)
  const th = sweep(sr, Math.min(len, P.thT * 8), P.th0 * vf, P.th1, P.thT * 0.35, 0.0012, P.thT * (far ? 1.7 : 1));
  softClip(th, 2.2);
  addTo(core, th, 0.85 * P.th * punch);
  // 거리 저역 통과
  if (mid) biquad(core, sr, 'lp', 3000, 0.6);
  if (far) { biquad(core, sr, 'lp', 650, 0.6); biquad(core, sr, 'lp', 900, 0.6); }

  const nch = own ? 2 : 1;
  const chs: Buf[] = [];
  for (let c = 0; c < nch; c++) {
    const o = new Float32Array(n);
    addTo(o, core, 1);
    if (!far) {
      // 땅 반사, 주변 벽 반사
      echo(o, core, sr, 0.006 + 0.0025 * c + 0.002 * v, 0.3, mid ? 1800 : 4500, 0.25);
      echo(o, core, sr, 0.048 + 0.011 * c + 0.01 * v, mid ? 0.2 : 0.12, mid ? 1400 : 2500, 0.3);
    }
    // 잔향 꼬리 (채널마다 다른 잡음)
    const tn = white(n, sd + 10 + c * 101);
    envAD(tn, sr, far ? 0.06 : 0.012, P.tail * (far ? 2.4 : mid ? 1.5 : 1), 0.003);
    biquad(tn, sr, 'lp', far ? 520 : mid ? 1600 : P.tailLp, 0.6);
    biquad(tn, sr, 'hp', far ? 60 : 140, 0.6);
    addTo(o, tn, 0.22 * P.tailG * (far ? 1.6 : mid ? 1.3 : own ? 0.75 : 1));
    chs.push(o);
  }
  if (own) {
    // 살짝 넓은 스테레오 (몸통 일부를 좌우 반대로)
    const w = white(samples(sr, P.body * 9 + 0.01), sd + 20);
    envAD(w, sr, 0.0003, P.body * 1.4);
    biquad(w, sr, 'bp', P.bp * 1.3, 0.7);
    addTo(chs[0], w, 0.45); addTo(chs[1], w, -0.45);
    const mk = mechClick(sr, sd + 30);
    addTo(chs[0], mk, 0.16, 0.032 * sr); addTo(chs[1], mk, 0.16, 0.034 * sr);
  }
  if (mid) echo(chs[0], core, sr, 0.21 + 0.06 * v, 0.3, 1400, 0.5);
  if (far) {
    echo(chs[0], core, sr, 0.42 + 0.05 * v, 0.42, 420, 0.6);
    echo(chs[0], core, sr, 0.95 + 0.08 * v, 0.26, 380, 0.6);
    echo(chs[0], core, sr, 1.55, 0.14, 340, 0.6);
  }
  normalize(chs, 1);
  for (const c of chs) softClip(c, 1.6);
  normalize(chs, 0.92);
  for (const c of chs) fadeOut(c, sr, 0.03);
  return chs;
}

/** 소음기 사격: 둔한 '퓻' + 기계 철컥 */
export function gunSuppressed(sr: number, P: GunSpec, punch: number, dist: 'own' | 'near' | 'mid', v: number, seedBase: number): Buf[] {
  const sd = seedBase * 71 + v * 313 + DSEED[dist];
  const own = dist === 'own';
  const n = samples(sr, dist === 'mid' ? 0.6 : 0.45);
  const core = new Float32Array(n);
  const th = white(samples(sr, 0.09), sd + 1);
  envAD(th, sr, 0.0004, 0.010 + P.body * 0.2);
  biquad(th, sr, 'bp', 1100 * (1 + v * 0.05), 0.9);
  addTo(core, th, 1.0);
  const gas = white(samples(sr, 0.02), sd + 2);
  envAD(gas, sr, 0.0002, 0.003);
  biquad(gas, sr, 'hp', 2500);
  addTo(core, gas, 0.35);
  const pop = sweep(sr, 0.12, 260, 110, 0.01, 0.001, 0.02 + P.thT * 0.15);
  addTo(core, pop, 0.45 * punch * Math.min(1.3, P.th));
  const mk = mechClick(sr, sd + 3, 0.62);
  addTo(core, mk, own ? 0.55 : 0.3, 0.012 * sr);
  if (P.body < 0.026) addTo(core, mechClick(sr, sd + 4, 0.55), own ? 0.35 : 0.18, 0.055 * sr);
  const tl = white(n, sd + 5);
  envAD(tl, sr, 0.005, 0.06);
  biquad(tl, sr, 'lp', 2000);
  addTo(core, tl, 0.08);
  if (dist === 'mid') biquad(core, sr, 'lp', 1500, 0.6);
  const chs: Buf[] = own ? [core, core.slice()] : [core];
  if (own) { const w = white(samples(sr, 0.05), sd + 6); envAD(w, sr, 0.0003, 0.008); biquad(w, sr, 'bp', 1600, 0.8); addTo(chs[0], w, 0.25); addTo(chs[1], w, -0.25); }
  normalize(chs, 0.9);
  for (const c of chs) fadeOut(c, sr, 0.02);
  return chs;
}

/** 머리 옆을 스치는 초음속 탄 '딱' / 아음속 '피융' */
export function bulletSnap(sr: number, v: number, whiz: boolean): Buf[] {
  const n = samples(sr, whiz ? 0.32 : 0.12);
  const b = new Float32Array(n);
  if (!whiz) {
    // N 파형 + 짧은 지글거림
    const nw = Math.max(4, Math.floor(sr * 0.0004));
    for (let i = 0; i < nw * 2 && i < n; i++) b[i] = i < nw ? 1 - i / nw : -(1 - (i - nw) / nw) * 0.8;
    const z = white(samples(sr, 0.06), 400 + v);
    envAD(z, sr, 0.0002, 0.008);
    biquad(z, sr, 'bp', 3800 + v * 500, 1.2);
    addTo(b, z, 0.8);
    biquad(b, sr, 'hp', 900);
  } else {
    const z = white(n, 500 + v);
    svf(z, sr, 'bp', (t) => 3200 - t * 6000, 3);
    shape(z, sr, (t) => Math.sin(Math.min(1, t / 0.3) * Math.PI) ** 2);
    addTo(b, z, 1);
  }
  normalize([b], 0.9);
  fadeOut(b, sr, 0.01);
  return [b];
}

// ───────────────────────── 폭발 ─────────────────────────

export function explosionNear(sr: number, v: number): Buf[] {
  const r = rnd(900 + v);
  const n = samples(sr, 3.4);
  const o = new Float32Array(n);
  const vf = 1 + (v - 0.5) * 0.1;
  const blast = white(samples(sr, 0.9), 901 + v);
  envAD(blast, sr, 0.0008, 0.07);
  svf(blast, sr, 'lp', (t) => 250 + 9000 * Math.exp(-t / 0.05), 0.8);
  addTo(o, blast, 1.6);
  const crack = white(samples(sr, 0.02), 902 + v);
  envAD(crack, sr, 0.00005, 0.002);
  biquad(crack, sr, 'hp', 1000);
  addTo(o, crack, 1.0);
  const sub = sweep(sr, 2.2, 78 * vf, 24, 0.18, 0.003, 0.5);
  softClip(sub, 3);
  addTo(o, sub, 1.5);
  const crump = white(samples(sr, 0.8), 903 + v);
  envAD(crump, sr, 0.002, 0.14);
  biquad(crump, sr, 'bp', 420 * vf, 0.7);
  addTo(o, crump, 1.4);
  const rum = white(n, 904 + v);
  envAD(rum, sr, 0.04, 0.85);
  biquad(rum, sr, 'lp', 160, 0.7); biquad(rum, sr, 'lp', 220, 0.7);
  addTo(o, rum, 4.5);
  const wash = white(n, 905 + v);
  envAD(wash, sr, 0.05, 0.6);
  biquad(wash, sr, 'lp', 900); biquad(wash, sr, 'hp', 80);
  addTo(o, wash, 0.4);
  // 파편 후드득
  for (let i = 0; i < 70; i++) {
    const t = 0.08 + Math.pow(r(), 1.8) * 1.7;
    const amp = (0.15 + r() * 0.35) * Math.exp(-t / 0.8);
    grain(o, sr, t, 0.003 + r() * 0.01, 800 + r() * 4200, 1.5 + r() * 3, amp, 950 + i * 7 + v);
  }
  normalize([o], 1);
  softClip(o, 1.8);
  normalize([o], 0.95);
  fadeOut(o, sr, 0.15);
  return [o];
}

/** 먼 폭발·포성: 둔한 쿵 + 굴러가는 메아리 */
export function explosionFar(sr: number, v: number, sharp: boolean): Buf[] {
  const n = samples(sr, 4.5);
  const o = new Float32Array(n);
  const core = new Float32Array(samples(sr, 1.4));
  const b = white(core.length, 1000 + v);
  envAD(b, sr, 0.002, sharp ? 0.08 : 0.12);
  biquad(b, sr, 'lp', sharp ? 800 : 500); biquad(b, sr, 'lp', 600);
  addTo(core, b, 3);
  const sub = sweep(sr, 1.4, 60, 22, 0.2, 0.004, 0.6);
  softClip(sub, 2);
  addTo(core, sub, 1.4);
  const rum = white(core.length, 1001 + v);
  envAD(rum, sr, 0.08, 0.7);
  biquad(rum, sr, 'lp', 200); biquad(rum, sr, 'lp', 260);
  addTo(core, rum, 5);
  addTo(o, core, 1);
  echo(o, core, sr, 0.5 + 0.1 * v, 0.45, 320, 1.4);
  echo(o, core, sr, 1.15 + 0.15 * v, 0.3, 280, 1.4);
  echo(o, core, sr, 1.9, 0.2, 240, 1.4);
  echo(o, core, sr, 2.8, 0.1, 200, 1.4);
  normalize([o], 1);
  softClip(o, 1.5);
  normalize([o], 0.95);
  fadeOut(o, sr, 0.3);
  return [o];
}

/** 전차포: 거대한 폭풍 + 저음 + 긴 우르릉 */
export function cannonNear(sr: number, v: number): Buf[] {
  const n = samples(sr, 3.2);
  const o = new Float32Array(n);
  const blast = white(samples(sr, 1.0), 1100 + v);
  envAD(blast, sr, 0.0005, 0.09);
  svf(blast, sr, 'lp', (t) => 300 + 11000 * Math.exp(-t / 0.06), 0.8);
  addTo(o, blast, 1.8);
  const crack = white(samples(sr, 0.02), 1101 + v);
  envAD(crack, sr, 0.00005, 0.0025);
  biquad(crack, sr, 'hp', 1200);
  addTo(o, crack, 1.2);
  const sub = sweep(sr, 2.4, 62, 22, 0.2, 0.002, 0.75);
  softClip(sub, 3.5);
  addTo(o, sub, 1.9);
  const crump = white(samples(sr, 1.0), 1102 + v);
  envAD(crump, sr, 0.002, 0.2);
  biquad(crump, sr, 'bp', 300, 0.7);
  addTo(o, crump, 1.4);
  const rum = white(n, 1103 + v);
  envAD(rum, sr, 0.05, 1.1);
  biquad(rum, sr, 'lp', 150, 0.7); biquad(rum, sr, 'lp', 220, 0.7);
  addTo(o, rum, 5);
  const head = o.slice(0, samples(sr, 0.6));
  echo(o, head, sr, 0.35, 0.35, 700, 0.6);
  echo(o, head, sr, 0.9, 0.2, 500, 0.6);
  normalize([o], 1);
  softClip(o, 2);
  normalize([o], 0.95);
  fadeOut(o, sr, 0.2);
  return [o];
}

/** 로켓 발사: 점화 '퍽' + 멀어지는 쉬익 */
export function rocketLaunch(sr: number, v: number, long: boolean): Buf[] {
  const len = long ? 2.2 : 1.4;
  const n = samples(sr, len);
  const o = new Float32Array(n);
  const pop = white(samples(sr, 0.06), 1200 + v);
  envAD(pop, sr, 0.0003, 0.008);
  biquad(pop, sr, 'lp', 4000);
  addTo(o, pop, 1.0);
  addTo(o, sweep(sr, 0.3, 160, 60, 0.03, 0.001, 0.04), 0.8);
  const wh = white(n, 1201 + v);
  envAD(wh, sr, 0.03, long ? 0.8 : 0.45);
  svf(wh, sr, 'bp', (t) => 900 + 2500 * Math.exp(-t / (long ? 0.6 : 0.35)), 0.9);
  addTo(o, wh, 1.3);
  const roar = white(n, 1202 + v);
  envAD(roar, sr, 0.02, long ? 0.6 : 0.4);
  biquad(roar, sr, 'lp', 350);
  addTo(o, roar, 1.4);
  if (long) { const hs = white(n, 1203 + v); envAD(hs, sr, 0.1, 0.9); biquad(hs, sr, 'hp', 4000); addTo(o, hs, 0.25); }
  normalize([o], 0.92);
  fadeOut(o, sr, 0.1);
  return [o];
}

/** 건물 무너짐: 긴 우르릉 + 부서지는 알갱이 + 큰 쿵 몇 번 */
export function collapse(sr: number, v: number): Buf[] {
  const r = rnd(1300 + v);
  const n = samples(sr, 5);
  const o = new Float32Array(n);
  const rum = white(n, 1301 + v);
  envAD(rum, sr, 0.25, 1.6);
  biquad(rum, sr, 'lp', 140, 0.7); biquad(rum, sr, 'lp', 200, 0.7);
  addTo(o, rum, 6);
  const mid = white(n, 1302 + v);
  envAD(mid, sr, 0.1, 1.2);
  biquad(mid, sr, 'bp', 600, 0.6);
  addTo(o, mid, 0.5);
  for (let i = 0; i < 120; i++) {
    const t = 0.1 + Math.pow(r(), 1.4) * 3.8;
    grain(o, sr, t, 0.005 + r() * 0.025, 300 + r() * 2200, 1 + r() * 2, (0.2 + r() * 0.5) * Math.exp(-t / 2), 1310 + i);
  }
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + r() * 2.4;
    addTo(o, sweep(sr, 0.6, 70 + r() * 20, 35, 0.06, 0.003, 0.1), 0.6 + r() * 0.4, t * sr);
  }
  normalize([o], 1);
  softClip(o, 1.5);
  normalize([o], 0.92);
  fadeOut(o, sr, 0.3);
  return [o];
}

// ───────────────────────── 탄착·파괴 ─────────────────────────

export type ImpactSurf = 'hard' | 'metal' | 'wood' | 'glass' | 'soft' | 'water' | 'flesh';

export function impact(sr: number, surf: ImpactSurf, v: number): Buf[] {
  const r = rnd(1400 + v * 17 + surf.length * 3);
  const vf = 1 + (v - 1) * 0.08;
  let o: Buf;
  switch (surf) {
    case 'hard': {
      o = new Float32Array(samples(sr, 0.28));
      const c = white(samples(sr, 0.02), 1401 + v); envAD(c, sr, 0.0001, 0.003); biquad(c, sr, 'hp', 1500); addTo(o, c, 1);
      const b = white(samples(sr, 0.1), 1402 + v); envAD(b, sr, 0.0003, 0.012); biquad(b, sr, 'bp', 1800 * vf, 1); addTo(o, b, 1.4);
      const th = white(samples(sr, 0.1), 1403 + v); envAD(th, sr, 0.0005, 0.015); biquad(th, sr, 'lp', 400); addTo(o, th, 1.2);
      for (let i = 0; i < 6; i++) grain(o, sr, 0.03 + r() * 0.15, 0.003 + r() * 0.005, 2000 + r() * 3000, 2, 0.25 * (1 - i / 7), 1410 + i + v * 9);
      break;
    }
    case 'metal': {
      o = partials(sr, 0.45, [[1150 * vf, 1, 0.09], [2870 * vf, 0.7, 0.06], [4410 * vf, 0.45, 0.035], [6900 * vf, 0.25, 0.02], [620 * vf, 0.4, 0.05]]);
      const c = white(samples(sr, 0.02), 1420 + v); envAD(c, sr, 0.0001, 0.002); biquad(c, sr, 'hp', 2000); addTo(o, c, 1.4);
      break;
    }
    case 'wood': {
      o = new Float32Array(samples(sr, 0.26));
      const b = white(samples(sr, 0.15), 1430 + v); envAD(b, sr, 0.0004, 0.02); biquad(b, sr, 'bp', 450 * vf, 1.4); addTo(o, b, 2.2);
      const h = white(samples(sr, 0.05), 1431 + v); envAD(h, sr, 0.0002, 0.008); biquad(h, sr, 'bp', 1400 * vf, 1); addTo(o, h, 0.9);
      addTo(o, sweep(sr, 0.15, 180, 120, 0.02, 0.001, 0.03), 0.5);
      for (let i = 0; i < 4; i++) grain(o, sr, 0.01 + r() * 0.08, 0.002 + r() * 0.004, 2000 + r() * 2000, 2, 0.25, 1435 + i + v * 5);
      break;
    }
    case 'glass': {
      o = new Float32Array(samples(sr, 0.5));
      const c = white(samples(sr, 0.03), 1440 + v); envAD(c, sr, 0.0001, 0.004); biquad(c, sr, 'hp', 3000); addTo(o, c, 1);
      addTo(o, partials(sr, 0.4, [[4200 * vf, 0.5, 0.05], [6100 * vf, 0.4, 0.04], [7600 * vf, 0.3, 0.03]]), 0.7);
      for (let i = 0; i < 26; i++) { const t = Math.pow(r(), 1.5) * 0.32; grain(o, sr, t, 0.002 + r() * 0.004, 3000 + r() * 6000, 3, 0.5 * Math.exp(-t / 0.15), 1445 + i + v * 31); }
      break;
    }
    case 'water': {
      o = new Float32Array(samples(sr, 0.42));
      const s = white(samples(sr, 0.4), 1460 + v); envAD(s, sr, 0.004, 0.06); biquad(s, sr, 'bp', 1600 * vf, 0.7); addTo(o, s, 1.2);
      addTo(o, sweep(sr, 0.08, 900 * vf, 350, 0.015, 0.002, 0.02), 0.6);
      for (let i = 0; i < 4; i++) addTo(o, sweep(sr, 0.05, 600 + r() * 800, 1400 + r() * 600, 0.01, 0.002, 0.012), 0.25, (0.04 + r() * 0.2) * sr);
      break;
    }
    case 'flesh': {
      o = new Float32Array(samples(sr, 0.22));
      const n = white(samples(sr, 0.15), 1470 + v); envAD(n, sr, 0.001, 0.025); biquad(n, sr, 'lp', 900); addTo(o, n, 1.6);
      addTo(o, sweep(sr, 0.15, 140 * vf, 70, 0.02, 0.001, 0.03), 0.7);
      const b = white(samples(sr, 0.1), 1471 + v); envAD(b, sr, 0.0005, 0.02); biquad(b, sr, 'bp', 350, 2); addTo(o, b, 0.8);
      break;
    }
    default: {
      o = new Float32Array(samples(sr, 0.2));
      const n = white(samples(sr, 0.15), 1480 + v); envAD(n, sr, 0.001, 0.02); biquad(n, sr, 'lp', 600 * vf); addTo(o, n, 2);
      const p = white(samples(sr, 0.06), 1481 + v); envAD(p, sr, 0.0005, 0.01); biquad(p, sr, 'bp', 1200, 1); addTo(o, p, 0.5);
      for (let i = 0; i < 3; i++) grain(o, sr, 0.01 + r() * 0.06, 0.004, 700 + r() * 1200, 1.5, 0.3, 1485 + i + v);
    }
  }
  normalize([o], 0.9);
  fadeOut(o, sr, 0.02);
  return [o];
}

/** 도탄 '피융' */
export function ricochet(sr: number, v: number): Buf[] {
  const n = samples(sr, 0.5);
  const o = new Float32Array(n);
  const f0 = 4200 + v * 400, f1 = 1600 + v * 200;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.18) + 60 * Math.sin(2 * Math.PI * 28 * t);
    ph += f / sr;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.13);
    o[i] = Math.sin(2 * Math.PI * ph) * env;
  }
  const c = white(samples(sr, 0.02), 1490 + v); envAD(c, sr, 0.0001, 0.002); biquad(c, sr, 'hp', 2000); addTo(o, c, 0.8);
  normalize([o], 0.85);
  fadeOut(o, sr, 0.03);
  return [o];
}

export type BreakSurf = 'wood' | 'glass' | 'hard' | 'metal';
export function breakSound(sr: number, surf: BreakSurf, v: number): Buf[] {
  const r = rnd(1500 + v * 13 + surf.length);
  let o: Buf;
  if (surf === 'glass') {
    o = new Float32Array(samples(sr, 0.8));
    const c = white(samples(sr, 0.04), 1501 + v); envAD(c, sr, 0.0001, 0.006); biquad(c, sr, 'hp', 2500); addTo(o, c, 1);
    for (let i = 0; i < 60; i++) { const t = Math.pow(r(), 1.6) * 0.6; grain(o, sr, t, 0.002 + r() * 0.006, 2500 + r() * 7000, 3, 0.55 * Math.exp(-t / 0.25), 1510 + i + v * 61); }
    addTo(o, partials(sr, 0.6, [[3900, 0.4, 0.08], [5700, 0.3, 0.06], [7300, 0.2, 0.05]]), 0.6);
  } else if (surf === 'wood') {
    o = new Float32Array(samples(sr, 0.6));
    const c = white(samples(sr, 0.03), 1520 + v); envAD(c, sr, 0.0001, 0.004); biquad(c, sr, 'hp', 1200); addTo(o, c, 1.2);
    const b = white(samples(sr, 0.2), 1521 + v); envAD(b, sr, 0.001, 0.04); biquad(b, sr, 'bp', 300, 1.2); addTo(o, b, 2);
    for (let i = 0; i < 22; i++) { const t = r() * 0.3; grain(o, sr, t, 0.003 + r() * 0.01, 1200 + r() * 3000, 2, 0.4 * Math.exp(-t / 0.2), 1525 + i + v * 23); }
  } else if (surf === 'metal') {
    o = partials(sr, 1.0, [[520, 1, 0.25], [1310, 0.7, 0.18], [2210, 0.45, 0.12], [3460, 0.3, 0.08]]);
    const c = white(samples(sr, 0.03), 1540 + v); envAD(c, sr, 0.0001, 0.003); biquad(c, sr, 'hp', 1500); addTo(o, c, 1.2);
  } else {
    o = new Float32Array(samples(sr, 0.9));
    const th = white(samples(sr, 0.3), 1530 + v); envAD(th, sr, 0.002, 0.06); biquad(th, sr, 'lp', 300); addTo(o, th, 3);
    for (let i = 0; i < 34; i++) { const t = Math.pow(r(), 1.3) * 0.7; grain(o, sr, t, 0.004 + r() * 0.015, 500 + r() * 2500, 1.5, 0.45 * Math.exp(-t / 0.35), 1535 + i + v * 37); }
  }
  normalize([o], 0.9);
  fadeOut(o, sr, 0.04);
  return [o];
}

// ───────────────────────── 발소리·몸 ─────────────────────────

export type StepSurf = 'snow' | 'hard' | 'metal' | 'wood' | 'dirt' | 'water';

export function footstep(sr: number, surf: StepSurf, v: number): Buf[] {
  const r = rnd(1600 + v * 19 + surf.length * 7);
  const o = new Float32Array(samples(sr, surf === 'metal' ? 0.32 : 0.24));
  const vf = 1 + (v - 1) * 0.07;
  switch (surf) {
    case 'snow': {
      const cnt = 14 + Math.floor(r() * 6);
      for (let i = 0; i < cnt; i++) {
        const t = 0.004 + (i / cnt) * 0.12 + (r() - 0.5) * 0.01;
        grain(o, sr, Math.max(0, t), 0.002 + r() * 0.004, 1200 + r() * 3000, 1.2, 0.9 - (i / cnt) * 0.6, 1610 + i + v * 41);
      }
      const th = white(samples(sr, 0.06), 1605 + v); envAD(th, sr, 0.004, 0.018); biquad(th, sr, 'lp', 350); addTo(o, th, 1.2);
      break;
    }
    case 'hard': {
      for (let k = 0; k < 2; k++) {
        const at = k * (0.035 + r() * 0.015), gk = k ? 0.55 : 1;
        const c = white(samples(sr, 0.02), 1620 + v * 3 + k); envAD(c, sr, 0.0001, 0.003); biquad(c, sr, 'hp', 1500); addTo(o, c, 0.7 * gk, at * sr);
        const kn = white(samples(sr, 0.06), 1622 + v * 3 + k); envAD(kn, sr, 0.0003, 0.015); biquad(kn, sr, 'bp', 900 * vf, 2); addTo(o, kn, 1.3 * gk, at * sr);
      }
      const gr = white(samples(sr, 0.08), 1626 + v); envAD(gr, sr, 0.002, 0.02); biquad(gr, sr, 'lp', 4000); addTo(o, gr, 0.2);
      break;
    }
    case 'metal': {
      addTo(o, partials(sr, 0.3, [[330 * vf, 0.8, 0.08], [780 * vf, 0.6, 0.06], [1240 * vf, 0.5, 0.05], [2050 * vf, 0.3, 0.03]]), 1);
      const c = white(samples(sr, 0.02), 1630 + v); envAD(c, sr, 0.0001, 0.003); biquad(c, sr, 'hp', 1200); addTo(o, c, 0.8);
      break;
    }
    case 'wood': {
      const k = white(samples(sr, 0.12), 1640 + v); envAD(k, sr, 0.0005, 0.035); biquad(k, sr, 'bp', 220 * vf, 1.5); addTo(o, k, 2.5);
      const h = white(samples(sr, 0.05), 1641 + v); envAD(h, sr, 0.0003, 0.012); biquad(h, sr, 'bp', 650 * vf, 1.5); addTo(o, h, 1);
      break;
    }
    case 'water': {
      const s = white(samples(sr, 0.22), 1650 + v); envAD(s, sr, 0.01, 0.06); biquad(s, sr, 'bp', 1500 * vf, 0.7); addTo(o, s, 1.2);
      for (let i = 0; i < 3; i++) addTo(o, sweep(sr, 0.05, 500 + r() * 600, 1100 + r() * 500, 0.01, 0.002, 0.012), 0.3, (0.02 + r() * 0.12) * sr);
      break;
    }
    default: {
      const cnt = 7 + Math.floor(r() * 4);
      for (let i = 0; i < cnt; i++) grain(o, sr, 0.004 + (i / cnt) * 0.07 + r() * 0.01, 0.003 + r() * 0.005, 800 + r() * 1700, 1.2, 0.6 - (i / cnt) * 0.3, 1660 + i + v * 29);
      const th = white(samples(sr, 0.06), 1659 + v); envAD(th, sr, 0.003, 0.016); biquad(th, sr, 'lp', 260); addTo(o, th, 1.6);
    }
  }
  normalize([o], 0.9);
  fadeOut(o, sr, 0.02);
  return [o];
}

/** 옷·장비 바스락 */
export function cloth(sr: number, v: number, len = 0.22): Buf[] {
  const r = rnd(1700 + v);
  const o = new Float32Array(samples(sr, len));
  for (let i = 0; i < 10; i++) grain(o, sr, r() * len * 0.7, 0.01 + r() * 0.03, 900 + r() * 1800, 0.8, 0.4 + r() * 0.4, 1710 + i + v * 11);
  const s = white(o.length, 1705 + v); envAD(s, sr, 0.05, 0.06); biquad(s, sr, 'lp', 1200); addTo(o, s, 0.5);
  normalize([o], 0.8);
  fadeOut(o, sr, 0.03);
  return [o];
}

export function land(sr: number, v: number, hard: boolean): Buf[] {
  const r = rnd(1800 + v);
  const o = new Float32Array(samples(sr, 0.4));
  addTo(o, sweep(sr, 0.3, hard ? 95 : 80, 42, 0.03, 0.002, hard ? 0.07 : 0.05), 1);
  const n = white(samples(sr, 0.15), 1801 + v); envAD(n, sr, 0.001, 0.03); biquad(n, sr, 'lp', 500); addTo(o, n, 1.5);
  for (let i = 0; i < (hard ? 7 : 4); i++) grain(o, sr, 0.02 + r() * 0.12, 0.004, 2000 + r() * 2000, 3, 0.25, 1805 + i + v);
  normalize([o], 0.9);
  fadeOut(o, sr, 0.03);
  return [o];
}

/** 내가 맞았을 때: 둔하게 눌린 충격 */
export function hurt(sr: number, v: number): Buf[] {
  const o = new Float32Array(samples(sr, 0.35));
  addTo(o, softClip(sweep(sr, 0.3, 95 + v * 8, 48, 0.02, 0.002, 0.06), 2), 1.2);
  const n = white(samples(sr, 0.2), 1900 + v); envAD(n, sr, 0.001, 0.04); biquad(n, sr, 'lp', 350); addTo(o, n, 1.5);
  const b = white(samples(sr, 0.12), 1901 + v); envAD(b, sr, 0.0005, 0.03); biquad(b, sr, 'bp', 220, 1.5); addTo(o, b, 0.7);
  normalize([o], 0.9);
  fadeOut(o, sr, 0.03);
  return [o];
}

/** 숨: v 0 = 내쉼(헉), 1 = 들이쉼 */
export function breath(sr: number, v: number): Buf[] {
  const o = new Float32Array(samples(sr, 0.65));
  const n = white(o.length, 1950 + v);
  if (v === 0) {
    const a = n.slice(); envAD(a, sr, 0.05, 0.16); biquad(a, sr, 'bp', 650, 1.8); addTo(o, a, 1);
    const b = n.slice(); envAD(b, sr, 0.05, 0.14); biquad(b, sr, 'bp', 1700, 2.5); addTo(o, b, 0.5);
    const c = n.slice(); envAD(c, sr, 0.04, 0.12); biquad(c, sr, 'lp', 400); addTo(o, c, 0.3);
  } else {
    const a = n.slice(); envAD(a, sr, 0.18, 0.12); svf(a, sr, 'bp', (t) => 900 + t * 1200, 2); addTo(o, a, 1);
    const b = n.slice(); envAD(b, sr, 0.18, 0.1); biquad(b, sr, 'hp', 2500); addTo(o, b, 0.15);
  }
  normalize([o], 0.8);
  fadeOut(o, sr, 0.08);
  return [o];
}

// ───────────────────────── 무기 다루기 ─────────────────────────

export type HandleKind = 'magOut' | 'magIn' | 'bolt' | 'shell' | 'dry' | 'pump' | 'boltAction' | 'slide';

export function handling(sr: number, kind: HandleKind, v: number): Buf[] {
  const vf = 1 + (v - 0.5) * 0.06;
  const o = new Float32Array(samples(sr, kind === 'boltAction' ? 0.6 : kind === 'pump' ? 0.4 : 0.3));
  const slide = (at: number, f: number, g: number, tau: number, seed: number) => {
    const s = white(samples(sr, tau * 8 + 0.03), seed); envAD(s, sr, 0.02, tau); biquad(s, sr, 'bp', f, 1.2); addTo(o, s, g, at * sr);
  };
  const clack = (at: number, p: number, g: number, seed: number) => addTo(o, mechClick(sr, seed, p * vf), g, at * sr);
  switch (kind) {
    case 'magOut': clack(0, 1.1, 0.6, 2001 + v); slide(0.02, 2200, 0.8, 0.04, 2002 + v); addTo(o, partials(sr, 0.12, [[640, 0.5, 0.03], [1500, 0.3, 0.02]]), 0.5, 0.09 * sr); break;
    case 'magIn': slide(0, 1800, 0.7, 0.03, 2011 + v); clack(0.06, 0.75, 1.0, 2012 + v); addTo(o, partials(sr, 0.15, [[2100, 0.6, 0.018], [3600, 0.4, 0.01], [5400, 0.25, 0.006]]), 0.6, 0.06 * sr); break;
    case 'bolt': clack(0, 0.9, 0.6, 2021 + v); slide(0.02, 2500, 0.6, 0.03, 2022 + v); clack(0.13, 0.55, 1.0, 2023 + v); addTo(o, partials(sr, 0.15, [[1500, 0.6, 0.03], [2700, 0.5, 0.02], [4800, 0.3, 0.01]]), 0.7, 0.13 * sr); break;
    case 'slide': clack(0, 0.8, 0.7, 2031 + v); clack(0.09, 0.6, 0.9, 2032 + v); break;
    case 'shell': addTo(o, partials(sr, 0.1, [[1200 * vf, 0.7, 0.015], [2600 * vf, 0.5, 0.008]]), 1); slide(0.01, 1500, 0.6, 0.02, 2041 + v); clack(0.05, 0.5, 0.5, 2042 + v); break;
    case 'dry': {
      addTo(o, partials(sr, 0.08, [[1900 * vf, 1, 0.012], [3300 * vf, 0.5, 0.006]]), 0.8);
      const c = white(samples(sr, 0.01), 2051 + v); envAD(c, sr, 0.0001, 0.002); biquad(c, sr, 'hp', 2000); addTo(o, c, 0.6);
      break;
    }
    case 'pump': slide(0, 1800, 0.8, 0.03, 2061 + v); clack(0.07, 0.6, 0.9, 2062 + v); slide(0.13, 2000, 0.6, 0.025, 2063 + v); clack(0.19, 0.5, 1.0, 2064 + v); break;
    case 'boltAction': clack(0, 0.9, 0.6, 2071 + v); slide(0.08, 2500, 0.7, 0.04, 2072 + v); clack(0.2, 0.7, 0.6, 2073 + v); slide(0.28, 2300, 0.6, 0.035, 2074 + v); clack(0.4, 0.55, 1.0, 2075 + v); break;
  }
  normalize([o], 0.85);
  fadeOut(o, sr, 0.02);
  return [o];
}

// ───────────────────────── 알림음 ─────────────────────────

export type CueKind =
  | 'tick' | 'head' | 'kill' | 'armor' | 'spot' | 'lockBeep' | 'lockDone' | 'warnBeep' | 'warnHi'
  | 'flagGood' | 'flagBad' | 'neutralGood' | 'neutralBad' | 'losing' | 'score' | 'heal' | 'revive'
  | 'click' | 'hover' | 'equip' | 'deploy' | 'win' | 'lose';

export function cue(sr: number, kind: CueKind, v: number): Buf[] {
  const dur: Partial<Record<CueKind, number>> = { win: 2.8, lose: 3.0, deploy: 0.9, flagGood: 0.8, flagBad: 0.9, head: 0.45, kill: 0.4 };
  const o = new Float32Array(samples(sr, dur[kind] ?? 0.5));
  const click = (g: number, f = 3000, seed = 2100) => { const c = white(samples(sr, 0.01), seed + v); envAD(c, sr, 0.0001, 0.0015); biquad(c, sr, 'hp', f); addTo(o, c, g); };
  switch (kind) {
    case 'tick': addTo(o, partials(sr, 0.06, [[3000, 1, 0.012], [4600, 0.4, 0.008]], 0.0003), 1); click(0.6, 4000); break;
    case 'head': addTo(o, partials(sr, 0.45, [[2950, 1, 0.13], [4420, 0.7, 0.09], [6610, 0.5, 0.06], [8800, 0.25, 0.04]]), 1); click(0.5, 5000); break;
    case 'kill': addTo(o, softClip(sweep(sr, 0.3, 150, 72, 0.03, 0.001, 0.07), 2), 1); click(0.45, 1500); addTo(o, partials(sr, 0.3, [[1050, 0.25, 0.05], [1580, 0.15, 0.04]]), 1); break;
    case 'armor': addTo(o, partials(sr, 0.2, [[1800, 1, 0.04], [2900, 0.6, 0.03], [4300, 0.3, 0.02]]), 1); click(0.5, 2500); break;
    case 'spot': tone(o, sr, 1300, 0, 0.06, 0.6, 0.1, 0.003); tone(o, sr, 1950, 0.065, 0.09, 0.6, 0.1, 0.003); break;
    case 'lockBeep': tone(o, sr, 1150, 0, 0.07, 0.7, 0.3, 0.002); break;
    case 'lockDone': tone(o, sr, 1700, 0, 0.38, 0.6, 0.3, 0.003); break;
    case 'warnBeep': tone(o, sr, 900, 0, 0.065, 0.7, 0.5, 0.002); break;
    case 'warnHi': tone(o, sr, 1400, 0, 0.06, 0.7, 0.5, 0.002); break;
    case 'flagGood': tone(o, sr, 523, 0, 0.3, 0.5); tone(o, sr, 659, 0.1, 0.3, 0.5); tone(o, sr, 784, 0.2, 0.5, 0.55); tone(o, sr, 262, 0, 0.6, 0.25, 0.1, 0.03); break;
    case 'flagBad': tone(o, sr, 392, 0, 0.32, 0.5); tone(o, sr, 311, 0.13, 0.32, 0.5); tone(o, sr, 262, 0.26, 0.6, 0.55); tone(o, sr, 131, 0, 0.8, 0.3, 0.1, 0.03); break;
    case 'neutralGood': tone(o, sr, 523, 0, 0.2, 0.45); tone(o, sr, 784, 0.1, 0.32, 0.45); break;
    case 'neutralBad': tone(o, sr, 440, 0, 0.22, 0.45); tone(o, sr, 330, 0.12, 0.34, 0.45); break;
    case 'losing': tone(o, sr, 330, 0, 0.12, 0.5, 0.6); tone(o, sr, 330, 0.18, 0.12, 0.5, 0.6); break;
    case 'score': tone(o, sr, 2300, 0, 0.035, 0.4, 0.05, 0.001); break;
    case 'heal': tone(o, sr, 1200, 0, 0.16, 0.35); tone(o, sr, 1800, 0.06, 0.18, 0.3); break;
    case 'revive': tone(o, sr, 660, 0, 0.12, 0.4); tone(o, sr, 880, 0.08, 0.12, 0.4); tone(o, sr, 1320, 0.16, 0.25, 0.45); break;
    case 'click': addTo(o, partials(sr, 0.04, [[1800, 1, 0.01]]), 0.8); click(0.5); break;
    case 'hover': addTo(o, partials(sr, 0.03, [[2600, 0.5, 0.005]]), 0.6); break;
    case 'equip': {
      addTo(o, mechClick(sr, 2150 + v, 0.7), 0.9); addTo(o, mechClick(sr, 2151 + v, 0.5), 1, 0.08 * sr);
      const cl = cloth(sr, v, 0.2)[0]; addTo(o, cl, 0.4);
      break;
    }
    case 'deploy': {
      const w = white(samples(sr, 0.6), 2160 + v); envAD(w, sr, 0.15, 0.2); svf(w, sr, 'bp', (t) => 300 + t * 2400, 1.5); addTo(o, w, 0.7);
      tone(o, sr, 440, 0.25, 0.35, 0.4); tone(o, sr, 660, 0.32, 0.5, 0.45);
      break;
    }
    case 'win':
      for (const [f, g] of [[262, 0.35], [330, 0.3], [392, 0.3], [523, 0.32]] as [number, number][]) tone(o, sr, f, 0.05, 2.6, g, 0.2, 0.15);
      addTo(o, softClip(sweep(sr, 1.2, 80, 40, 0.1, 0.004, 0.35), 2), 0.6);
      break;
    case 'lose':
      for (const [f, g] of [[220, 0.32], [262, 0.3], [330, 0.28]] as [number, number][]) tone(o, sr, f, 0.05, 2.8, g, 0.2, 0.2);
      tone(o, sr, 55, 0, 3, 0.4, 0.3, 0.3);
      addTo(o, softClip(sweep(sr, 1.4, 70, 32, 0.12, 0.004, 0.45), 2), 0.6);
      break;
  }
  normalize([o], kind === 'hover' ? 0.5 : 0.85);
  fadeOut(o, sr, 0.02);
  return [o];
}

// ───────────────────────── 장비·차량 동작 ─────────────────────────

export type ActKind = 'throw' | 'pin' | 'place' | 'ugl' | 'stim' | 'defib' | 'torch' | 'drone' | 'smokePop' | 'flares' | 'smokeLaunch' | 'hatch';

export function action(sr: number, kind: ActKind, v: number): Buf[] {
  const r = rnd(2200 + v * 7 + kind.length);
  const o = new Float32Array(samples(sr, kind === 'drone' ? 1.0 : kind === 'smokePop' ? 1.2 : 0.55));
  switch (kind) {
    case 'throw': { const w = white(samples(sr, 0.35), 2201 + v); envAD(w, sr, 0.08, 0.06); svf(w, sr, 'bp', (t) => 500 + 1500 * Math.sin(Math.min(1, t / 0.25) * Math.PI), 1.2); addTo(o, w, 1); addTo(o, cloth(sr, v, 0.15)[0], 0.3); break; }
    case 'pin': addTo(o, partials(sr, 0.2, [[3800, 0.6, 0.05], [5200, 0.4, 0.03], [2400, 0.3, 0.04]]), 1); addTo(o, mechClick(sr, 2205 + v, 0.8), 0.5); break;
    case 'place': { const t = white(samples(sr, 0.1), 2210 + v); envAD(t, sr, 0.002, 0.03); biquad(t, sr, 'lp', 300); addTo(o, t, 2); addTo(o, mechClick(sr, 2211 + v, 0.6), 0.5, 0.06 * sr); break; }
    case 'ugl': { addTo(o, sweep(sr, 0.3, 260, 120, 0.03, 0.001, 0.05), 1); const b = white(samples(sr, 0.12), 2220 + v); envAD(b, sr, 0.0005, 0.03); biquad(b, sr, 'bp', 400, 0.8); addTo(o, b, 0.8); addTo(o, partials(sr, 0.25, [[320, 0.4, 0.06], [700, 0.2, 0.03]]), 0.6); break; }
    case 'stim': { const h = white(samples(sr, 0.3), 2230 + v); envAD(h, sr, 0.01, 0.08); biquad(h, sr, 'hp', 3000); addTo(o, h, 0.8); addTo(o, mechClick(sr, 2231 + v, 1.2), 0.5); break; }
    case 'defib': {
      const n = white(samples(sr, 0.4), 2240 + v);
      shape(n, sr, (t) => (Math.sin(2 * Math.PI * 120 * t) > 0 ? 1 : 0.2) * Math.min(1, t / 0.005) * Math.exp(-t / 0.15));
      biquad(n, sr, 'bp', 2500, 0.7); addTo(o, n, 1);
      addTo(o, softClip(sweep(sr, 0.25, 120, 60, 0.03, 0.002, 0.05), 2), 0.7);
      break;
    }
    case 'torch': {
      const h = white(o.length, 2250 + v); envAD(h, sr, 0.02, 0.25); biquad(h, sr, 'bp', 3500, 0.5); addTo(o, h, 0.8);
      for (let i = 0; i < 12; i++) grain(o, sr, r() * 0.35, 0.002, 3000 + r() * 4000, 3, 0.4, 2255 + i + v);
      break;
    }
    case 'drone': {
      const n = o.length;
      for (let i = 0; i < n; i++) { const t = i / sr; const ph = (180 + 40 * Math.min(1, t * 3)) * t; o[i] = ((ph % 1) * 2 - 1) * Math.min(1, t / 0.1) * Math.exp(-t / 0.5); }
      biquad(o, sr, 'bp', 600, 0.8);
      break;
    }
    case 'smokePop': { addTo(o, sweep(sr, 0.2, 200, 90, 0.02, 0.001, 0.03), 0.8); const h = white(o.length, 2260 + v); envAD(h, sr, 0.05, 0.4); biquad(h, sr, 'bp', 2200, 0.6); addTo(o, h, 0.6); break; }
    case 'smokeLaunch':
      for (let k = 0; k < 2; k++) {
        addTo(o, sweep(sr, 0.2, 180, 70, 0.02, 0.001, 0.03), 1, k * 0.15 * sr);
        const b = white(samples(sr, 0.1), 2270 + v + k); envAD(b, sr, 0.0005, 0.02); biquad(b, sr, 'bp', 500, 0.8); addTo(o, b, 0.7, k * 0.15 * sr);
      }
      break;
    case 'flares':
      for (let k = 0; k < 4; k++) {
        const b = white(samples(sr, 0.25), 2280 + v + k); envAD(b, sr, 0.001, 0.05); biquad(b, sr, 'bp', 2500, 0.7); addTo(o, b, 0.8, k * 0.09 * sr);
        addTo(o, sweep(sr, 0.1, 220, 100, 0.01, 0.001, 0.015), 0.5, k * 0.09 * sr);
      }
      break;
    case 'hatch': {
      addTo(o, partials(sr, 0.5, [[170, 1, 0.12], [410, 0.6, 0.08], [760, 0.4, 0.05], [1300, 0.2, 0.03]]), 1);
      const c = white(samples(sr, 0.05), 2290 + v); envAD(c, sr, 0.0003, 0.01); biquad(c, sr, 'lp', 1200); addTo(o, c, 0.8);
      break;
    }
  }
  normalize([o], 0.85);
  fadeOut(o, sr, 0.03);
  return [o];
}

// ───────────────────────── 반복음 (엔진·바람) ─────────────────────────

export type LoopKind = 'diesel' | 'clatter' | 'whine' | 'tires' | 'rotor' | 'wind' | 'hiss';

/** 이음매 없는 반복 버퍼 */
export function loop(sr: number, kind: LoopKind): Buf[] {
  const L = kind === 'wind' ? 4 : kind === 'hiss' ? 1.5 : 2;
  const xf = 0.12;
  const n = samples(sr, L + xf);
  const o = new Float32Array(n);
  const r = rnd(2300 + kind.length);
  let power = true;
  switch (kind) {
    case 'diesel': {
      power = false;
      const f = 30;
      for (let k = 0; k < f * (L + xf); k++) {
        const at = k / f, a = 0.8 + (r() - 0.5) * 0.35;
        addTo(o, sweep(sr, 0.06, 78, 66, 0.02, 0.002, 0.018), a, at * sr);
        const nb = white(samples(sr, 0.04), 2310 + k); envAD(nb, sr, 0.001, 0.01); biquad(nb, sr, 'bp', 260, 1); addTo(o, nb, 0.45 * a, at * sr);
      }
      for (let i = 0; i < n; i++) { const t = i / sr; o[i] += 0.3 * (((15 * t) % 1) * 2 - 1); }
      biquad(o, sr, 'lp', 700, 0.6);
      const mech = white(n, 2305);
      shape(mech, sr, (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 30 * t));
      biquad(mech, sr, 'bp', 1400, 1.5);
      addTo(o, mech, 0.15);
      break;
    }
    case 'clatter': {
      const cnt = 26;
      for (let k = 0; k < cnt * (L + xf) / L; k++) {
        const at = (k * L) / cnt + (r() - 0.5) * 0.012, p = 0.9 + r() * 0.2, a = 0.5 + r() * 0.5;
        addTo(o, partials(sr, 0.12, [[700 * p, 1, 0.025], [1650 * p, 0.7, 0.018], [2900 * p, 0.5, 0.01]]), a, Math.max(0, at) * sr);
        const c = white(samples(sr, 0.02), 2320 + k); envAD(c, sr, 0.0001, 0.004); biquad(c, sr, 'hp', 1500); addTo(o, c, 0.4 * a, Math.max(0, at) * sr);
      }
      const rum = white(n, 2318); biquad(rum, sr, 'lp', 250); addTo(o, rum, 1.2);
      const sq = white(n, 2319); biquad(sq, sr, 'bp', 2400, 8); shape(sq, sr, (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t)); addTo(o, sq, 0.2);
      break;
    }
    case 'whine': {
      power = false;
      const f0 = 50;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let s = 0;
        for (let h = 1; h <= 12; h++) s += Math.sin(2 * Math.PI * f0 * h * t + h * 1.7) / h;
        o[i] = s * 0.5 + 0.06 * Math.sin(2 * Math.PI * 600 * t);
      }
      biquad(o, sr, 'lp', 1800, 0.6);
      const intake = white(n, 2330);
      biquad(intake, sr, 'bp', 500, 0.8);
      shape(intake, sr, (t) => 0.7 + 0.3 * Math.sin(2 * Math.PI * f0 * t));
      addTo(o, intake, 0.5);
      break;
    }
    case 'tires': {
      const a = white(n, 2340); biquad(a, sr, 'lp', 600); biquad(a, sr, 'lp', 900); addTo(o, a, 1);
      const b = white(n, 2341); biquad(b, sr, 'bp', 1800, 1); addTo(o, b, 0.12);
      break;
    }
    case 'rotor': {
      power = false;
      const chop = 10;
      for (let k = 0; k < chop * (L + xf); k++) {
        const at = k / chop;
        const nb = white(samples(sr, 0.09), 2350 + k); envAD(nb, sr, 0.004, 0.045); biquad(nb, sr, 'lp', 700); addTo(o, nb, 1.6, at * sr);
        addTo(o, sweep(sr, 0.1, 90, 55, 0.02, 0.003, 0.035), 0.9, at * sr);
      }
      const tail = white(n, 2349);
      biquad(tail, sr, 'bp', 900, 2);
      shape(tail, sr, (t) => Math.max(0, Math.sin(2 * Math.PI * 50 * t)) ** 2);
      addTo(o, tail, 0.5);
      for (let i = 0; i < n; i++) { const t = i / sr; o[i] += 0.035 * Math.sin(2 * Math.PI * 2200 * t) + 0.018 * Math.sin(2 * Math.PI * 3300 * t); }
      const wash = white(n, 2348); biquad(wash, sr, 'lp', 400); addTo(o, wash, 0.6);
      break;
    }
    case 'wind': {
      const a = white(n, 2360); biquad(a, sr, 'lp', 500, 0.5); biquad(a, sr, 'lp', 500, 0.5); addTo(o, a, 1);
      const b = white(n, 2361); biquad(b, sr, 'lp', 1500, 0.5); addTo(o, b, 0.08);
      break;
    }
    case 'hiss': {
      const a = white(n, 2370); biquad(a, sr, 'bp', 2800, 0.6); addTo(o, a, 1);
      const b = white(n, 2371); biquad(b, sr, 'lp', 300); addTo(o, b, 1.2);
      shape(o, sr, (t) => 0.8 + 0.2 * Math.sin(2 * Math.PI * 40 * t));
      break;
    }
  }
  const out = loopify(o, sr, xf, power);
  normalize([out], 0.8);
  return [out];
}

/** 잔향 응답 (스테레오, 점점 어두워지는 잡음) */
export function impulse(sr: number, dur: number): Buf[] {
  const n = samples(sr, dur), pre = Math.floor(sr * 0.012);
  const chs: Buf[] = [];
  for (let c = 0; c < 2; c++) {
    const b = white(n, 2400 + c);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 900 + 6000 * Math.exp(-t / 0.25);
      const a = 1 - Math.exp((-2 * Math.PI * f) / sr);
      y += (b[i] - y) * a;
      b[i] = i < pre ? 0 : y * Math.exp(-t / 0.38) * Math.min(1, (i - pre) / (sr * 0.02));
    }
    chs.push(b);
  }
  return normalize(chs, 0.5);
}
