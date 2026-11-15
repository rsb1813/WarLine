// 오프라인 합성 도우미 (Float32Array 에 직접 그린다). 소리 버퍼는 한 번 그려 캐시하고 재생만 한다.

export type Buf = Float32Array;

/** 결정적 0..1 난수 */
export function rnd(seed: number): () => number {
  let s = (Math.imul(seed + 1, 0x9e3779b1) ^ 0x5bd1e995) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const samples = (sr: number, sec: number): number => Math.max(1, Math.ceil(sec * sr));

/** 백색 잡음 -1..1 */
export function white(n: number, seed: number): Buf {
  const b = new Float32Array(n);
  let s = Math.imul(seed + 7, 0x9e3779b1) | 0 || 1;
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    b[i] = s / 2147483648;
  }
  return b;
}

/** 선형 attack 뒤 지수 감쇠 (tau 초). start 초 전은 0 */
export function envAD(b: Buf, sr: number, attack: number, tau: number, start = 0): Buf {
  const s0 = Math.floor(start * sr), na = Math.max(1, Math.floor(attack * sr)), k = Math.exp(-1 / Math.max(1e-5, tau * sr));
  let e = 1;
  for (let i = 0; i < b.length; i++) {
    const j = i - s0;
    if (j < 0) { b[i] = 0; continue; }
    if (j < na) b[i] *= j / na;
    else { b[i] *= e; e *= k; }
  }
  return b;
}

/** 시간 함수 곱하기 */
export function shape(b: Buf, sr: number, f: (t: number) => number): Buf {
  for (let i = 0; i < b.length; i++) b[i] *= f(i / sr);
  return b;
}

/** dst[offset..] += src * gain */
export function addTo(dst: Buf, src: Buf, gain = 1, offset = 0): Buf {
  const o = Math.max(0, Math.floor(offset));
  const n = Math.min(src.length, dst.length - o);
  for (let i = 0; i < n; i++) dst[o + i] += src[i] * gain;
  return dst;
}

export type BqType = 'lp' | 'hp' | 'bp' | 'peak';

/** RBJ 2차 필터 (제자리) */
export function biquad(b: Buf, sr: number, type: BqType, freq: number, q = 0.707, db = 0): Buf {
  const f = Math.max(10, Math.min(freq, sr * 0.45));
  const w = (2 * Math.PI * f) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { const A = Math.pow(10, db / 40); b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    b[i] = y;
  }
  return b;
}

/** 차단 주파수가 시간에 따라 바뀌는 상태 변수 필터 (TPT). fAt(t초) */
export function svf(b: Buf, sr: number, mode: 'lp' | 'bp' | 'hp', fAt: (t: number) => number, q = 0.707): Buf {
  const k = 1 / q;
  let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0;
  for (let i = 0; i < b.length; i++) {
    if ((i & 31) === 0) {
      const f = Math.max(10, Math.min(fAt(i / sr), sr * 0.45));
      const g = Math.tan((Math.PI * f) / sr);
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    }
    const v0 = b[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    b[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 * k : v0 - k * v1 - v2;
  }
  return b;
}

/** 내려가는 사인 (쿵): f(t) = f1 + (f0 - f1) e^(-t/tf), 진폭 attack 후 tau 감쇠 */
export function sweep(sr: number, dur: number, f0: number, f1: number, tf: number, attack: number, tau: number, tri = false): Buf {
  const n = samples(sr, dur), b = new Float32Array(n);
  const na = Math.max(1, attack * sr), k = Math.exp(-1 / Math.max(1e-5, tau * sr));
  let ph = 0, e = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / tf);
    ph += f / sr; ph -= Math.floor(ph);
    const s = tri ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(ph * 2 * Math.PI);
    let a: number;
    if (i < na) a = i / na; else { a = e; e *= k; }
    b[i] = s * a;
  }
  return b;
}

/** 감쇠하는 부분음 묶음 (쇳소리). [주파수, 진폭, tau] */
export function partials(sr: number, dur: number, list: [number, number, number][], attack = 0.0004): Buf {
  const n = samples(sr, dur), b = new Float32Array(n);
  const na = Math.max(1, attack * sr);
  for (const [f, a, tau] of list) {
    if (f >= sr * 0.48) continue;
    const w = (2 * Math.PI * f) / sr, k = Math.exp(-1 / Math.max(1e-5, tau * sr));
    // 회전 오실레이터 (sin 반복 호출 대신)
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = -Math.sin(w), e = a;
    const lim = Math.min(n, Math.ceil(tau * sr * 9));
    for (let i = 0; i < lim; i++) {
      const s0 = c * s1 - s2;
      s2 = s1; s1 = s0;
      const env = i < na ? (i / na) * a : e;
      if (i >= na) e *= k;
      b[i] += s0 * env;
    }
  }
  return b;
}

/** 노이즈 알갱이 하나 (bp 필터) */
export function grain(dst: Buf, sr: number, at: number, dur: number, freq: number, q: number, gain: number, seed: number): void {
  const n = samples(sr, dur);
  const g = white(n, seed);
  envAD(g, sr, dur * 0.12, dur * 0.28);
  biquad(g, sr, 'bp', freq, q);
  addTo(dst, g, gain, at * sr);
}

/** 부드러운 포화 (|x|≈1 입력 기준) */
export function softClip(b: Buf, drive: number): Buf {
  const k = 1 / Math.tanh(drive);
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) * k;
  return b;
}

export function peak(chs: Buf[]): number {
  let m = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; }
  return m;
}

export function normalize(chs: Buf[], target: number): Buf[] {
  const m = peak(chs);
  if (m < 1e-9) return chs;
  const k = target / m;
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
  return chs;
}

/** 끝 dur 초를 0 으로 (잘림 딸깍 방지) */
export function fadeOut(b: Buf, sr: number, dur: number): Buf {
  const n = Math.min(b.length, samples(sr, dur));
  for (let i = 0; i < n; i++) b[b.length - 1 - i] *= i / n;
  return b;
}

/** 이음매 없는 반복 버퍼: 끝 xf 초를 처음에 겹쳐 섞고 잘라 낸다. power = 등전력 섞기(잡음용) */
export function loopify(b: Buf, sr: number, xf: number, power: boolean): Buf {
  const x = Math.min(Math.floor(b.length / 3), samples(sr, xf));
  const m = b.length - x;
  const out = b.slice(0, m);
  for (let i = 0; i < x; i++) {
    const t = i / x;
    const a = power ? Math.sqrt(t) : t, c = power ? Math.sqrt(1 - t) : 1 - t;
    out[i] = b[i] * a + b[m + i] * c;
  }
  return out;
}

/** 지연된 필터 사본 (메아리·반사) */
export function echo(dst: Buf, src: Buf, sr: number, delay: number, gain: number, lp: number, maxLen = 0.6): void {
  const e = src.slice(0, Math.min(src.length, samples(sr, maxLen)));
  biquad(e, sr, 'lp', lp, 0.6);
  addTo(dst, e, gain, delay * sr);
}

/** 연주 음 (UI): 사인 + 약한 배음, 부드러운 시작과 끝 */
export function tone(dst: Buf, sr: number, freq: number, at: number, dur: number, gain: number, harm = 0.25, attack = 0.008): void {
  const n = samples(sr, dur), o = Math.floor(at * sr);
  const na = Math.max(1, attack * sr), tail = dur * 0.35;
  for (let i = 0; i < n && o + i < dst.length; i++) {
    const t = i / sr;
    const env = (i < na ? i / na : 1) * (t > dur - tail ? Math.max(0, (dur - t) / tail) : 1) * Math.exp(-t * 2.2);
    const ph = 2 * Math.PI * freq * t;
    dst[o + i] += (Math.sin(ph) + harm * Math.sin(ph * 2) + harm * 0.4 * Math.sin(ph * 3)) * env * gain;
  }
}
