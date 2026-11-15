// HUD 공용 도우미: DOM 만들기, 바뀔 때만 쓰는 setter, 색, 글자, 아이콘.
import type { ClassId, FireMode, Game, Soldier, Stance } from '../types';
import { GADGETS, VEHICLES, VWEAPONS, WEAPONS } from '../defs';

export const SVGNS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: Node | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function svgEl(tag: string, attrs: Record<string, string | number>, parent?: Node | null): SVGElement {
  const e = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

/** 아이콘 SVG 문자열을 담은 span (만들 때 한 번만 innerHTML) */
export function iconEl(svg: string, cls: string, parent?: Node | null): HTMLSpanElement {
  const s = el('span', cls, parent);
  s.innerHTML = svg;
  return s;
}

// ── 바뀔 때만 DOM 에 쓰는 setter ──
type MemoBag = Record<string, string | number | boolean>;
interface Memo { _hm?: MemoBag }
const memo = (e: object): MemoBag => { const m = e as Memo; return m._hm ?? (m._hm = {}); };

export function setText(e: Node, v: string): void {
  const m = memo(e);
  if (m.t !== v) { m.t = v; e.textContent = v; }
}
export function setShow(e: HTMLElement | SVGElement, on: boolean): void {
  const m = memo(e);
  if (m.s !== on) { m.s = on; e.style.display = on ? '' : 'none'; }
}
export function setStyle(e: HTMLElement | SVGElement, prop: string, v: string): void {
  const m = memo(e); const k = 'p' + prop;
  if (m[k] !== v) { m[k] = v; e.style.setProperty(prop, v); }
}
export function setAttr(e: Element, name: string, v: string): void {
  const m = memo(e); const k = 'a' + name;
  if (m[k] !== v) { m[k] = v; e.setAttribute(name, v); }
}
export function setCls(e: Element, c: string, on: boolean): void {
  const m = memo(e); const k = 'c' + c;
  if (m[k] !== on) { m[k] = on; e.classList.toggle(c, on); }
}
/** 한 무리 중 하나만 켜는 클래스 (예: own-0 / own-1 / own-n) */
export function setOneOf(e: Element, group: string, c: string): void {
  const m = memo(e); const k = 'g' + group;
  const prev = m[k] as string | undefined;
  if (prev === c) return;
  if (prev) e.classList.remove(prev);
  if (c) e.classList.add(c);
  m[k] = c;
}
export function setTf(e: HTMLElement | SVGElement, v: string): void { setStyle(e, 'transform', v); }
export function setOp(e: HTMLElement | SVGElement, v: number): void { setStyle(e, 'opacity', (Math.round(v * 100) / 100).toString()); }
/** 막대 채우기 (transform scaleX, 레이아웃 안 건드림) */
export function setBar(e: HTMLElement, f: number): void {
  const v = f < 0 ? 0 : f > 1 ? 1 : f;
  setStyle(e, 'transform', `scaleX(${v.toFixed(3)})`);
}
export function setBarY(e: HTMLElement, f: number): void {
  const v = f < 0 ? 0 : f > 1 ? 1 : f;
  setStyle(e, 'transform', `scaleY(${v.toFixed(3)})`);
}
export const px = (x: number, y: number): string => `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;

// ── 색 ──
export interface Pal { friend: string; squad: string; enemy: string; neutral: string; accent: string; fg: string; dim: string; bad: string; ok: string; warn: string; bg: string }
let palCache: Pal | null = null;
export function palette(): Pal {
  if (palCache) return palCache;
  let cs: CSSStyleDeclaration | null = null;
  try { cs = getComputedStyle(document.documentElement); } catch { cs = null; }
  const g = (n: string, d: string): string => { const v = cs ? cs.getPropertyValue(n).trim() : ''; return v || d; };
  palCache = {
    friend: g('--friend', '#4fb6ff'), squad: g('--squad', '#6dfca0'), enemy: g('--enemy', '#ff4a3d'), neutral: g('--neutral', '#e8e3d4'),
    accent: g('--accent', '#ffb52e'), fg: g('--fg', '#eef2f5'), dim: g('--dim', '#8e9aa6'), bad: g('--bad', '#ff4a3d'), ok: g('--ok', '#6dfca0'),
    warn: g('--warn', '#ffb52e'), bg: g('--bg', '#07090c'),
  };
  return palCache;
}
/** 사람 병사 기준 관계: 'me' | 'squad' | 'friend' | 'enemy' */
export function relation(g: Game, s: Soldier): 'me' | 'squad' | 'friend' | 'enemy' {
  const p = g.soldiers[g.player];
  if (s.id === g.player) return 'me';
  if (s.team !== p.team) return 'enemy';
  return s.squad === p.squad ? 'squad' : 'friend';
}
export function ownerClass(owner: number): string { return owner === 0 ? 'own-0' : owner === 1 ? 'own-1' : 'own-n'; }
export function ownerColor(owner: number): string { const p = palette(); return owner === 0 ? p.friend : owner === 1 ? p.enemy : p.neutral; }

// ── 글자 ──
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function flagLetter(g: Game, i: number): string {
  const f = g.flags[i];
  if (f && /^[A-Za-z]$/.test(f.id)) return f.id.toUpperCase();
  return LETTERS[i] ?? String(i + 1);
}
export function flagIndex(g: Game, id: string): number {
  for (let i = 0; i < g.flags.length; i++) if (g.flags[i].id === id) return i;
  return -1;
}
export const mmss = (sec: number): string => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const MODE_NAMES: Record<FireMode, string> = { auto: '자동', burst: '점사', semi: '단발', bolt: '볼트', pump: '펌프' };
export const STANCE_NAMES: Record<Stance, string> = { stand: '서기', crouch: '앉기', prone: '엎드림' };
export const CLASS_SHORT: Record<ClassId, string> = { assault: '돌격', engineer: '공병', support: '지원', recon: '정찰' };

const SPECIAL: Record<string, string> = {
  fall: '낙하', collapse: '붕괴', ram: '충돌', roadkill: '충돌', crash: '추락', fire: '화염', burn: '화염', bleed: '출혈',
  bleedout: '출혈', explosion: '폭발', vehicle: '차량 폭발', drown: '익사', water: '익사', suicide: '자결', world: '환경',
  melee: '근접', knife: '근접', giveup: '포기', redeploy: '재배치', mine: '지뢰', debris: '파편',
};
/** 무기·장비·차량 무기 id → 짧은 이름 */
export function weaponLabel(id: string): string {
  if (!id) return '—';
  const w = WEAPONS[id]; if (w) return w.name;
  const gd = GADGETS[id]; if (gd) return gd.name;
  const vw = VWEAPONS[id]; if (vw) return vw.name;
  const vd = (VEHICLES as unknown as Record<string, { short: string } | undefined>)[id]; if (vd) return vd.short;
  return SPECIAL[id] ?? id;
}

// ── 아이콘 (24 칸, 선) ──
const sv = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
export const CLASS_ICON: Record<ClassId, string> = {
  assault: sv('<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
  engineer: sv('<path d="M15.5 3.6a5 5 0 0 0-6 6.4L3.6 15.9a1.9 1.9 0 0 0 2.7 2.7l5.9-5.9a5 5 0 0 0 6.4-6l-2.9 2.9-2.6-.6-.6-2.6z"/>'),
  support: sv('<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M12 7.5v9M7.5 12h9" stroke-width="2.4"/>'),
  recon: sv('<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>'),
};
export const ICON = {
  board: sv('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4 6.5h1.5M4 12h1.5M4 17.5h1.5" stroke-width="2.6"/>'),
  map: sv('<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  pause: sv('<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.8"/>'),
  close: sv('<path d="M6 6l12 12M18 6L6 18" stroke-width="2.2"/>'),
  revive: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9" stroke-width="2.6"/>'),
  person: sv('<circle cx="12" cy="7" r="3.2"/><path d="M5.5 20.5c.6-4 3.2-6.5 6.5-6.5s5.9 2.5 6.5 6.5"/>'),
  skull: sv('<path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4.1 2.8 5.2V19h9.4v-3.3c1.7-1.1 2.8-2.8 2.8-5.2 0-4-3.1-7-7.5-7z"/><circle cx="9" cy="11" r="1.4" fill="currentColor"/><circle cx="15" cy="11" r="1.4" fill="currentColor"/>'),
  head: sv('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
  shield: sv('<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/>'),
  bolt: sv('<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>'),
};
export const STANCE_ICON: Record<Stance, string> = {
  stand: sv('<circle cx="12" cy="3.8" r="2"/><path d="M12 6.5v8M12 14.5l-3 7M12 14.5l3 7M8 10.5l4-2 4 2"/>'),
  crouch: sv('<circle cx="10.5" cy="7" r="2"/><path d="M11 9.5l1.2 5.5M12.2 15l4.3.6v5.9M12.2 15l-3.5 6.5M8 12.5l3.5-1.8 3.8 1.3"/>'),
  prone: sv('<circle cx="4.5" cy="15" r="2"/><path d="M7 16.5h8l6 2M7 16.5l3.5-2.5 4 .5"/>'),
};

export const isTouch = (): boolean => {
  try { return matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0); } catch { return false; }
};
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
