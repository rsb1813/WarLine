// 지도 카드용 절차 축소 지도: 테마·시드·물·마을·숲·언덕 값으로 위에서 본 그림을 그린다
import type { MapDef } from '../types';
import { fbm, rng } from '../math';

const cache = new Map<string, HTMLCanvasElement>();

const PAL: Record<MapDef['theme'], { lo: number[]; mid: number[]; hi: number[]; forest: number[]; road: string; roof: string[] }> = {
  snow: { lo: [148, 162, 176], mid: [196, 208, 219], hi: [236, 242, 247], forest: [38, 52, 50], road: 'rgba(70,76,84,0.75)', roof: ['#5b6168', '#6c5a4c', '#4a525a'] },
  tundra: { lo: [92, 98, 76], mid: [128, 126, 96], hi: [208, 212, 210], forest: [36, 50, 38], road: 'rgba(66,58,48,0.8)', roof: ['#5e5048', '#4c5057', '#6a5c4a'] },
  industrial: { lo: [96, 100, 104], mid: [132, 136, 140], hi: [206, 212, 218], forest: [42, 52, 48], road: 'rgba(40,42,46,0.85)', roof: ['#3e4348', '#5a4a40', '#2f3a44'] },
};

/** 캔버스에 지도 그림을 그린다 (같은 지도는 한 번만 계산) */
export function drawMapThumb(target: HTMLCanvasElement, def: MapDef): void {
  const src = cache.get(def.id) ?? build(def);
  cache.set(def.id, src);
  const rect = target.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(40, Math.round((rect.width || 320) * dpr)), h = Math.max(30, Math.round((rect.height || 180) * dpr));
  target.width = w; target.height = h;
  const g = target.getContext('2d');
  if (!g) return;
  // 가운데를 잘라 비율 맞춤
  const s = Math.max(w / src.width, h / src.height);
  const dw = src.width * s, dh = src.height * s;
  g.imageSmoothingEnabled = true;
  g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function build(def: MapDef): HTMLCanvasElement {
  const N = 220;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const pal = PAL[def.theme] ?? PAL.snow;
  const hn = fbm(def.seed, 5), fn = fbm(def.seed + 7, 4), wn = fbm(def.seed + 13, 3);
  const r = rng(def.seed * 31 + 5);
  const hills = 0.4 + def.hills * 1.2;
  const H = (x: number, y: number) => hn(x * 3.2, y * 3.2) * hills;
  // 물
  const riverY = (x: number) => 0.5 + Math.sin(x * 5.2 + def.seed * 0.37) * 0.12 + (wn(x * 2, 3) - 0.5) * 0.18;
  const coastSide = def.seed % 4;
  const isWater = (x: number, y: number): number => {
    if (def.water === 'river') {
      const d = Math.abs(y - riverY(x));
      return d < 0.028 ? 1 : d < 0.04 ? 0.5 : 0;
    }
    if (def.water === 'coast') {
      const u = coastSide === 0 ? x : coastSide === 1 ? 1 - x : coastSide === 2 ? y : 1 - y;
      const v = coastSide < 2 ? y : x;
      const edge = 0.2 + (wn(v * 3, 1) - 0.5) * 0.16;
      return u < edge ? 1 : u < edge + 0.015 ? 0.5 : 0;
    }
    return 0;
  };
  const img = g.createImageData(N, N);
  const lx = -0.6, ly = -0.8;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i / N, y = j / N;
      const h0 = H(x, y);
      const dx = H(x + 1 / N, y) - h0, dy = H(x, y + 1 / N) - h0;
      const shade = Math.max(-1, Math.min(1, -(dx * lx + dy * ly) * 70));
      let col: number[];
      const t = Math.min(1, h0 * 1.15);
      col = t < 0.5 ? mix(pal.lo, pal.mid, t * 2) : mix(pal.mid, pal.hi, (t - 0.5) * 2);
      // 숲
      const f = fn(x * 7, y * 7);
      if (f > 1 - def.forest * 0.55 && h0 < 0.85) col = mix(col, pal.forest, Math.min(0.9, (f - (1 - def.forest * 0.55)) * 6));
      col = col.map((v) => v * (1 + shade * 0.22));
      const wv = isWater(x, y);
      if (wv > 0) {
        const ice = def.theme === 'snow' && fn(x * 18, y * 18) > 0.62;
        const wc = ice ? [176, 192, 204] : [34, 50, 64];
        col = mix(col, wc, wv === 1 ? 1 : 0.55);
      }
      // 시간대
      if (def.time === 'dusk') col = [col[0] * 1.04 + 10, col[1] * 0.92, col[2] * 0.82];
      else if (def.time === 'overcast') { const gr = (col[0] + col[1] + col[2]) / 3; col = mix(col, [gr, gr, gr + 4], 0.35).map((v) => v * 0.92); }
      const k = (j * N + i) * 4;
      img.data[k] = clampByte(col[0]); img.data[k + 1] = clampByte(col[1]); img.data[k + 2] = clampByte(col[2]); img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // 마을과 길
  const towns: { x: number; y: number; r: number }[] = [];
  const tc = 2 + Math.round(def.town * 4);
  for (let k = 0; k < tc * 6 && towns.length < tc; k++) {
    const x = 0.12 + r() * 0.76, y = 0.12 + r() * 0.76;
    if (isWater(x, y) > 0 || towns.some((o) => Math.hypot(o.x - x, o.y - y) < 0.2)) continue;
    towns.push({ x, y, r: 0.05 + def.town * 0.07 * (0.6 + r() * 0.6) });
  }
  g.lineCap = 'round';
  g.strokeStyle = pal.road;
  g.lineWidth = 2.2;
  g.beginPath();
  for (let k = 1; k < towns.length; k++) {
    const a = towns[k - 1], b = towns[k];
    const mx = (a.x + b.x) / 2 + (r() - 0.5) * 0.12, my = (a.y + b.y) / 2 + (r() - 0.5) * 0.12;
    g.moveTo(a.x * N, a.y * N);
    g.quadraticCurveTo(mx * N, my * N, b.x * N, b.y * N);
  }
  if (towns.length) { g.moveTo(0, towns[0].y * N); g.lineTo(towns[0].x * N, towns[0].y * N); const z = towns[towns.length - 1]; g.moveTo(z.x * N, z.y * N); g.lineTo(N, z.y * N); }
  g.stroke();
  for (const t of towns) {
    const n = Math.round(8 + def.town * 22 * (t.r / 0.1));
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * t.r;
      const x = (t.x + Math.cos(a) * d) * N, y = (t.y + Math.sin(a) * d) * N;
      if (isWater(x / N, y / N) > 0) continue;
      const big = def.theme === 'industrial' && r() < 0.3;
      const bw = (big ? 7 : 3) + r() * (big ? 6 : 3), bh = (big ? 5 : 3) + r() * 3;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x - bw / 2 + 1, y - bh / 2 + 1, bw, bh);
      g.fillStyle = pal.roof[Math.floor(r() * pal.roof.length)];
      g.fillRect(x - bw / 2, y - bh / 2, bw, bh);
    }
  }
  // 격자와 가장자리 어둡게
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 1; k < 6; k++) { const p = Math.round((k * N) / 6) + 0.5; g.moveTo(p, 0); g.lineTo(p, N); g.moveTo(0, p); g.lineTo(N, p); }
  g.stroke();
  const vg = g.createRadialGradient(N / 2, N / 2, N * 0.25, N / 2, N / 2, N * 0.75);
  vg.addColorStop(0, 'rgba(5,8,12,0)');
  vg.addColorStop(1, 'rgba(5,8,12,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, N, N);
  return c;
}

const mix = (a: number[], b: number[], t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
