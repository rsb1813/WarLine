// 로드아웃 수치 막대: 모든 무기 기본 구성 기준으로 정규화. 막대는 길수록 좋게 그린다.
// 피해·사거리·탄창은 저격총·기관총이 막대를 독차지하지 않도록 제곱근 눈금.
import type { FireMode, WeaponStats } from '../types';
import { PRIMARY_IDS, SECONDARY_IDS, computeStats, defaultAttachments } from '../defs';
import { esc } from './menu-util';

export interface StatRow { k: string; label: string; v: (s: WeaponStats) => number; fmt: (s: WeaponStats) => string }

const pel = (s: WeaponStats) => Math.max(1, s.pellets || 1);
const n = (x: number) => (Number.isFinite(x) ? x : 0);
const dmgTxt = (d: number, s: WeaponStats) => (pel(s) > 1 ? `${Math.round(d)}×${pel(s)}` : `${Math.round(d * 10) / 10}`);

export const DETAIL_ROWS: StatRow[] = [
  { k: 'dn', label: '근거리 피해', v: (s) => Math.sqrt(n(s.dmgNear) * Math.sqrt(pel(s))), fmt: (s) => dmgTxt(s.dmgNear, s) },
  { k: 'df', label: '원거리 피해', v: (s) => Math.sqrt(n(s.dmgFar) * Math.sqrt(pel(s))), fmt: (s) => dmgTxt(s.dmgFar, s) },
  { k: 'rg', label: '사거리', v: (s) => Math.sqrt((n(s.rangeNear) + n(s.rangeFar)) / 2), fmt: (s) => `${Math.round(s.rangeNear)}–${Math.round(s.rangeFar)}m` },
  { k: 'rpm', label: '연사 속도', v: (s) => n(s.rpm), fmt: (s) => `${Math.round(s.rpm)}발/분` },
  { k: 'vel', label: '탄속', v: (s) => n(s.velocity), fmt: (s) => `${Math.round(s.velocity)}m/s` },
  { k: 'rv', label: '수직 반동 제어', v: (s) => 1 / (n(s.recoilV) + 0.05), fmt: (s) => `${s.recoilV.toFixed(2)}°` },
  { k: 'rh', label: '수평 반동 제어', v: (s) => 1 / (n(s.recoilH) + 0.05), fmt: (s) => `±${s.recoilH.toFixed(2)}°` },
  { k: 'ads', label: '정조준 속도', v: (s) => 1 / Math.max(0.05, n(s.adsTime)), fmt: (s) => `${s.adsTime.toFixed(2)}초` },
  { k: 'hip', label: '허리 사격 정확도', v: (s) => 1 / (n(s.hipSpread) + 0.4), fmt: (s) => `${s.hipSpread.toFixed(2)}°` },
  { k: 'aim', label: '정조준 정확도', v: (s) => 1 / (n(s.adsSpread) + 0.08), fmt: (s) => `${s.adsSpread.toFixed(2)}°` },
  { k: 'mob', label: '기동성', v: (s) => n(s.moveMul), fmt: (s) => `${Math.round(s.moveMul * 100)}%` },
  { k: 'rl', label: '재장전 속도', v: (s) => 1 / Math.max(0.2, n(s.reload)), fmt: (s) => `${s.reload.toFixed(1)}초` },
  { k: 'mag', label: '탄창', v: (s) => Math.sqrt(n(s.mag)), fmt: (s) => `${Math.round(s.mag)}발` },
];

export const MINI_ROWS: StatRow[] = [
  { k: 'm-pow', label: '위력', v: (s) => Math.sqrt((n(s.dmgNear) * 0.6 + n(s.dmgFar) * 0.4) * Math.sqrt(pel(s))), fmt: () => '' },
  { k: 'm-rof', label: '연사', v: (s) => n(s.rpm), fmt: () => '' },
  { k: 'm-rng', label: '사거리', v: (s) => Math.sqrt((n(s.rangeNear) + n(s.rangeFar)) / 2), fmt: () => '' },
  { k: 'm-ads', label: '조준 속도', v: (s) => 1 / Math.max(0.05, n(s.adsTime)), fmt: () => '' },
  { k: 'm-rec', label: '반동 제어', v: (s) => 1 / (n(s.recoilV) + n(s.recoilH) * 0.6 + 0.05), fmt: () => '' },
  { k: 'm-mob', label: '기동성', v: (s) => n(s.moveMul), fmt: () => '' },
  { k: 'm-mag', label: '탄창', v: (s) => Math.sqrt(n(s.mag)), fmt: () => '' },
];

let ranges: Map<string, { lo: number; hi: number }> | null = null;

function getRanges(): Map<string, { lo: number; hi: number }> {
  if (ranges) return ranges;
  const m = new Map<string, { lo: number; hi: number }>();
  const all: WeaponStats[] = [];
  for (const id of [...PRIMARY_IDS, ...SECONDARY_IDS]) {
    try { all.push(computeStats(id, defaultAttachments(id))); } catch { /* 빠진 무기는 건너뜀 */ }
  }
  for (const row of [...DETAIL_ROWS, ...MINI_ROWS]) {
    let lo = Infinity, hi = -Infinity;
    for (const s of all) { const v = row.v(s); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const span = Math.max(1e-6, hi - lo);
    m.set(row.k, { lo: lo - span * 0.12, hi: hi + span * 0.1 });
  }
  if (all.length) ranges = m;
  return m;
}

export function fillOf(row: StatRow, s: WeaponStats): number {
  const r = getRanges().get(row.k) ?? { lo: 0, hi: 1 };
  const f = (row.v(s) - r.lo) / Math.max(1e-6, r.hi - r.lo);
  return f < 0.02 ? 0.02 : f > 1 ? 1 : f;
}

/** 작은 막대 7개 (무기 카드) */
export function miniBars(s: WeaponStats): string {
  return `<span class="wlo-mini">${MINI_ROWS.map((row) => `<span class="wlo-mini-r"><span>${row.label}</span><i><b style="width:${(fillOf(row, s) * 100).toFixed(1)}%"></b></i></span>`).join('')}</span>`;
}

/** 자세한 수치 막대. next 가 있으면 base → next 증감을 초록/빨강으로 */
export function statRows(base: WeaponStats, next: WeaponStats | null): string {
  return DETAIL_ROWS.map((row) => {
    const b = fillOf(row, base);
    const tb = row.fmt(base);
    if (!next) return barRow(row.label, tb, '', b, 0, '');
    const nn = fillOf(row, next);
    const tn = row.fmt(next);
    const dv = row.v(next) - row.v(base);
    const same = tn === tb && Math.abs(nn - b) < 0.004;
    if (same) return barRow(row.label, tb, '', b, 0, '');
    const dir = dv > 0 ? 'up' : 'dn';
    return barRow(row.label, tb, tn, Math.min(b, nn), Math.abs(nn - b), dir);
  }).join('');
}

export function barRow(label: string, tb: string, tn: string, base: number, delta: number, dir: string): string {
  return `<div class="wlo-st${dir ? ' ' + dir : ''}">
    <span class="wlo-st-l">${label}</span>
    <span class="wlo-st-v">${tn ? `<s>${esc(tb)}</s><b>${esc(tn)}</b>` : `<b>${esc(tb)}</b>`}</span>
    <span class="wlo-st-bar"><i class="b" style="width:${(base * 100).toFixed(1)}%"></i>${delta > 0 ? `<i class="d" style="left:${(base * 100).toFixed(1)}%;width:${Math.max(0.6, delta * 100).toFixed(1)}%"></i>` : ''}</span>
  </div>`;
}

const MODE: Record<FireMode, string> = { auto: '자동', burst: '점사', semi: '반자동', bolt: '볼트', pump: '펌프' };
const RETICLE: Record<string, string> = { iron: '가늠자', dot: '도트', holo: '홀로', cross: '십자선', mil: '밀도트', chevron: '갈매기' };
const AMMO: Record<string, string> = { fmj: '일반탄', hp: '할로포인트', ap: '철갑탄', sub: '아음속탄', tracer: '예광탄' };

export const modeText = (s: WeaponStats): string => s.modes.map((m) => (m === 'burst' && s.burst > 1 ? `${s.burst}점사` : MODE[m] ?? m)).join(' · ');

/** 특성 칩: 배율, 조준선, 소음, 레이저, 손전등, 양각대, 탄종. next 에서 새로 생긴 것은 강조 */
export function traitChips(cur: WeaponStats, next: WeaponStats | null): string {
  const list = (s: WeaponStats) => {
    const o: string[] = [];
    o.push(s.zoom > 1.05 ? `${s.zoom.toFixed(s.zoom % 1 ? 1 : 0)}배율` : '1배율');
    o.push(RETICLE[s.reticle] ?? s.reticle);
    if (s.suppressed) o.push('소음');
    if (s.laser) o.push('레이저');
    if (s.flashlight) o.push('전술등');
    if (s.bipod) o.push('양각대');
    o.push(AMMO[s.ammoKind] ?? s.ammoKind);
    return o;
  };
  const a = list(cur);
  if (!next) return a.map((t) => `<i>${esc(t)}</i>`).join('');
  const b = list(next);
  const gone = a.filter((t) => !b.includes(t));
  return b.map((t) => `<i class="${a.includes(t) ? '' : 'new'}">${esc(t)}</i>`).join('') + gone.map((t) => `<i class="gone">${esc(t)}</i>`).join('');
}
