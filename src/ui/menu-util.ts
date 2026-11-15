// 메뉴 공용 도우미: 글 이스케이프, 동작 위임, 계급 진행, 터치 판별
import { rankOf } from '../profile';
import type { Profile } from '../types';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('ko-KR');

/** 터치가 주 입력인 기기 */
export function isTouch(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
  } catch {
    return false;
  }
}

export function reducedMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** data-a 속성을 가진 요소의 클릭을 한곳에서 받는다 */
export function onAct(el: HTMLElement, fn: (a: string, t: HTMLElement, e: MouseEvent) => void): () => void {
  const h = (e: MouseEvent) => {
    const t = (e.target as HTMLElement | null)?.closest('[data-a]') as HTMLElement | null;
    if (!t || !el.contains(t) || (t as HTMLButtonElement).disabled) return;
    fn(t.dataset.a ?? '', t, e);
  };
  el.addEventListener('click', h);
  return () => el.removeEventListener('click', h);
}

export interface RankInfo { rank: number; frac: number; inRank: number; span: number; toNext: number; title: string }

/** rankOf: cur = 이번 계급 안에서 쌓은 경험치, next = 다음 계급까지 필요한 양 (최고 계급이면 cur = next) */
export function rankInfo(xp: number): RankInfo {
  const r = rankOf(Math.max(0, Math.floor(xp || 0)));
  const span = Math.max(1, r.next);
  const inRank = Math.max(0, Math.min(span, r.cur));
  return { rank: r.rank, frac: clamp01(inRank / span), inRank, span, toNext: Math.max(0, span - inRank), title: rankTitle(r.rank) };
}

const TITLES = ['이병', '일병', '상병', '병장', '하사', '중사', '상사', '원사', '준위', '소위', '중위', '대위', '소령', '중령', '대령', '준장', '소장', '중장', '대장', '원수'];
/** 계급 1..99 → 칭호 20단계 × 호봉 5단계 */
export const rankTier = (rank: number): number => Math.min(TITLES.length, Math.floor((Math.max(1, Math.floor(rank)) - 1) / 5) + 1);
export const rankStep = (rank: number): number => ((Math.max(1, Math.floor(rank)) - 1) % 5) + 1;
export function rankTitle(rank: number): string {
  return `${TITLES[rankTier(rank) - 1]} ${rankStep(rank)}호봉`;
}

/** 계급장 SVG (직접 그린 문양: 갈매기, 마름모, 꽃, 별) */
export function rankBadge(rank: number, cls = 'wm-badge'): string {
  const n = rankTier(rank);
  const step = rankStep(rank);
  const parts: string[] = [];
  const chev = (y: number) => `<path d="M17 ${y + 7}L32 ${y}L47 ${y + 7}" />`;
  const diamond = (x: number, y: number, s: number) => `<path class="f" d="M${x} ${y - s}L${x + s * 0.72} ${y}L${x} ${y + s}L${x - s * 0.72} ${y}Z" />`;
  const star = (x: number, y: number, s: number) => {
    let d = '';
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? s : s * 0.42;
      d += `${k === 0 ? 'M' : 'L'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`;
    }
    return `<path class="f" d="${d}Z" />`;
  };
  const flower = (x: number, y: number, s: number) => {
    let d = '';
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      d += `<ellipse class="f" cx="${(x + Math.cos(a) * s * 0.55).toFixed(1)}" cy="${(y + Math.sin(a) * s * 0.55).toFixed(1)}" rx="${(s * 0.42).toFixed(1)}" ry="${(s * 0.24).toFixed(1)}" transform="rotate(${(a * 180) / Math.PI} ${(x + Math.cos(a) * s * 0.55).toFixed(1)} ${(y + Math.sin(a) * s * 0.55).toFixed(1)})" />`;
    }
    return d + `<circle cx="${x}" cy="${y}" r="${(s * 0.22).toFixed(1)}" class="k" />`;
  };
  const row = (count: number, y: number, gap: number, fn: (x: number, y: number) => string) => {
    const w = (count - 1) * gap;
    for (let k = 0; k < count; k++) parts.push(fn(32 - w / 2 + k * gap, y));
  };
  if (n <= 4) {
    const top = 32 - ((n - 1) * 7 + 7) / 2;
    for (let k = 0; k < n; k++) parts.push(chev(top + k * 7));
  } else if (n <= 8) {
    const c = n - 4;
    const top = 24 - ((c - 1) * 6) / 2;
    for (let k = 0; k < c; k++) parts.push(chev(top + k * 6));
    parts.push(`<path d="M17 ${top + c * 6 + 4}Q32 ${top + c * 6 + 13} 47 ${top + c * 6 + 4}" />`);
  } else if (n === 9) {
    parts.push(`<path d="M18 32H46" />`, diamond(32, 32, 7));
  } else if (n <= 12) {
    row(n - 9, 32, 13, (x, y) => diamond(x, y, 7));
  } else if (n <= 15) {
    row(n - 12, 32, 14, (x, y) => flower(x, y, 9));
  } else if (n <= 19) {
    row(n - 15, 32, n - 15 > 3 ? 10 : 12, (x, y) => star(x, y, n - 15 > 3 ? 5.5 : 6.5));
  } else {
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      parts.push(star(32 + Math.cos(a) * 11, 32 + Math.sin(a) * 11, 4.6));
    }
  }
  const pips = Array.from({ length: step }, (_, k) => `<circle class="pip" cx="${(32 - (step - 1) * 3.5 + k * 7).toFixed(1)}" cy="51" r="1.7" />`).join('');
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><path class="fr" d="M32 3L57 17V47L32 61L7 47V17Z" /><path class="fr2" d="M32 8L52 19.5V44.5L32 56L12 44.5V19.5Z" /><g class="ins" transform="translate(0 -3)">${parts.join('')}</g>${pips}</svg>`;
}

// ───────── 앱 공용 문맥 ─────────

export type Route = 'home' | 'play' | 'loadout' | 'settings' | 'help' | 'battle' | 'results';

export interface AppCtx {
  root: HTMLElement;
  profile: Profile;
  save(): void;
  /** 새 기록을 쌓으며 이동 */
  go(r: Route): void;
  /** 앱 안에서 왔으면 뒤로, 아니면 홈으로 */
  back(): void;
}
