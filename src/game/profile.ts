// 저장: 설정, 병과별 로드아웃, 분대 편성, 계급
import { CLASSES, DEFAULT_KITS, MAPS, type ClassId, type Diff, type Kit, type Side, type SizeId } from './defs';
import type { Quality } from '../render/renderer';

const KEY = 'warline.v5';

export interface Profile {
  side: Side;
  diff: Diff;
  map: string;
  size: SizeId;
  cls: ClassId;
  kits: Record<ClassId, Kit>;
  squad: ClassId[];
  quality: Quality;
  volume: number;
  assist: number;
  autofire: boolean;
  hints: boolean;
  xp: number;
  stats: { games: number; wins: number; kills: number; deaths: number; revives: number; caps: number; vkills: number };
  seenHelp: boolean;
}

const lowEnd = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

export function newProfile(): Profile {
  return {
    side: 'us', diff: 'easy', map: MAPS[0].id, size: 'medium', cls: 'assault',
    kits: JSON.parse(JSON.stringify(DEFAULT_KITS)), squad: ['medic', 'engineer', 'recon'],
    quality: lowEnd() ? 'medium' : 'high', volume: 0.8, assist: 0.6, autofire: true, hints: true, xp: 0,
    stats: { games: 0, wins: 0, kills: 0, deaths: 0, revives: 0, caps: 0, vkills: 0 }, seenHelp: false,
  };
}

export function loadProfile(): Profile {
  const p = newProfile();
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const o = JSON.parse(s) as Partial<Profile>;
      Object.assign(p, o);
      for (const c of Object.keys(CLASSES) as ClassId[]) p.kits[c] = { ...DEFAULT_KITS[c], ...(o.kits?.[c] ?? {}) };
      p.stats = { ...newProfile().stats, ...(o.stats ?? {}) };
      if (!MAPS.some((m) => m.id === p.map)) p.map = MAPS[0].id;
    }
  } catch { /* 저장소를 못 쓰면 기본값 */ }
  return p;
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 저장 없이 진행 */ }
}

/** 계급: 경험치에 따라 1부터 */
export function rankOf(xp: number): { rank: number; cur: number; next: number } {
  let rank = 1, need = 1500, acc = 0;
  while (xp >= acc + need && rank < 99) { acc += need; rank++; need = Math.round(1500 + rank * 350); }
  return { rank, cur: xp - acc, next: need };
}

export const kitOf = (p: Profile, c: ClassId): Kit => p.kits[c];
