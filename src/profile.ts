// 플레이어 프로필: 설정, 병과별 로드아웃, 경험치·전적. localStorage 'warline.v3' 에 저장한다.
import { SLOT_IDS } from './types';
import type { Attachments, ClassId, Diff, GadgetPick, Loadout, Profile, Quality, Settings, Side, SizeId, WeaponPick } from './types';
import { ATTACHMENTS, CLASSES, CLASS_IDS, DIFFS, GADGETS, MAPS, PRIMARY_IDS, SECONDARY_IDS, SIZES, WEAPONS } from './defs';

const KEY = 'warline.v3';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 터치 기기·모바일 브라우저인가 (그래픽 기본값 결정용) */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile|BlackBerry/i.test(ua)) return true;
  const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  // iPadOS 는 데스크톱 Mac 으로 자신을 밝힌다
  if (/Macintosh/i.test(ua) && touchPoints > 1) return true;
  try {
    if (touchPoints > 0 && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
  } catch {
    /* matchMedia 없음 */
  }
  return false;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: isMobileDevice() ? 'low' : 'high',
  sens: 1,
  adsSens: 0.85,
  fov: 75,
  invertY: false,
  volume: 0.8,
  aimAssist: 0.5,
  showFps: false,
  holdAds: true,
};

// ───────────────────────── 기본 로드아웃 ─────────────────────────

const DEFAULT_LOADOUTS: Record<ClassId, Loadout> = {
  assault: {
    primary: { id: 'ar47', att: { optic: 'holo', muzzle: 'comp', underbarrel: 'vgrip', magazine: 'mag_std', ammo: 'fmj' } },
    secondary: { id: 'p9', att: {} },
    gadget1: { id: 'ugl', variant: 'ugl_he' },
    gadget2: { id: 'stim', variant: 'stim_std' },
    throwable: { id: 'frag', variant: 'fr_std' },
  },
  engineer: {
    primary: { id: 'mc4', att: { optic: 'rd_tube', muzzle: 'flash', underbarrel: 'agrip', stock: 'stock_std' } },
    secondary: { id: 'p9', att: {} },
    gadget1: { id: 'rocket', variant: 'rk_heat' },
    gadget2: { id: 'repair', variant: 'rp_std' },
    throwable: { id: 'frag', variant: 'fr_std' },
  },
  support: {
    primary: { id: 'lm6', att: { optic: 'prism15', muzzle: 'flash', underbarrel: 'bipod' } },
    secondary: { id: 'mp18', att: {} },
    gadget1: { id: 'medbag', variant: 'mb_large' },
    gadget2: { id: 'ammobag', variant: 'ab_large' },
    throwable: { id: 'smoke', variant: 'sm_std' },
  },
  recon: {
    primary: { id: 'lr90', att: { optic: 'scope6', underbarrel: 'bipod', stock: 'stock_cheek' } },
    secondary: { id: 'pm45', att: {} },
    gadget1: { id: 'drone', variant: 'dr_recon' },
    gadget2: { id: 'beacon', variant: 'bc_std' },
    throwable: { id: 'smoke', variant: 'sm_std' },
  },
};

const cloneWeapon = (p: WeaponPick): WeaponPick => ({ id: p.id, att: { ...p.att } });
const cloneGadget = (p: GadgetPick): GadgetPick => ({ id: p.id, variant: p.variant });
const cloneLoadout = (l: Loadout): Loadout => ({
  primary: cloneWeapon(l.primary), secondary: cloneWeapon(l.secondary),
  gadget1: cloneGadget(l.gadget1), gadget2: cloneGadget(l.gadget2), throwable: cloneGadget(l.throwable),
});

/** 그 병과의 기본 로드아웃 (매번 새 객체) */
export function defaultLoadout(cls: ClassId): Loadout {
  return cloneLoadout(DEFAULT_LOADOUTS[cls] ?? DEFAULT_LOADOUTS.assault);
}

// ───────────────────────── 검증 ─────────────────────────

function sanitizeAtt(weaponId: string, raw: unknown): Attachments {
  const def = WEAPONS[weaponId];
  const out: Attachments = {};
  if (!def || !isObj(raw)) return out;
  for (const slot of SLOT_IDS) {
    const allowed = def.slots[slot];
    const v = raw[slot];
    if (allowed && typeof v === 'string' && allowed.includes(v) && ATTACHMENTS[v] && ATTACHMENTS[v].slot === slot) out[slot] = v;
  }
  return out;
}

function sanitizeWeapon(raw: unknown, ids: string[], fallback: WeaponPick): WeaponPick {
  if (!isObj(raw) || typeof raw.id !== 'string' || !ids.includes(raw.id) || !WEAPONS[raw.id]) return cloneWeapon(fallback);
  return { id: raw.id, att: sanitizeAtt(raw.id, raw.att) };
}

function sanitizeGadget(raw: unknown, allowed: string[], fallback: GadgetPick, exclude: string | null): GadgetPick {
  const fix = (id: string, variant: unknown): GadgetPick => {
    const def = GADGETS[id];
    const v = typeof variant === 'string' && def.variants.some((x) => x.id === variant) ? variant : def.variants[0].id;
    return { id, variant: v };
  };
  if (isObj(raw) && typeof raw.id === 'string' && allowed.includes(raw.id) && GADGETS[raw.id] && raw.id !== exclude) {
    return fix(raw.id, raw.variant);
  }
  if (fallback.id !== exclude && allowed.includes(fallback.id) && GADGETS[fallback.id]) return fix(fallback.id, fallback.variant);
  const other = allowed.find((id) => id !== exclude && GADGETS[id]) ?? allowed[0];
  return fix(other, null);
}

/** 저장된(또는 편집 중인) 로드아웃을 검증해 쓸 수 있는 로드아웃으로 만든다. 잘못된 칸은 기본값으로 */
export function sanitizeLoadout(cls: ClassId, raw: unknown): Loadout {
  const def = DEFAULT_LOADOUTS[cls] ?? DEFAULT_LOADOUTS.assault;
  const c = CLASSES[cls] ?? CLASSES.assault;
  const r: Obj = isObj(raw) ? raw : {};
  const gadget1 = sanitizeGadget(r.gadget1, c.gadgets, def.gadget1, null);
  const gadget2 = sanitizeGadget(r.gadget2, c.gadgets, def.gadget2, gadget1.id);
  return {
    primary: sanitizeWeapon(r.primary, PRIMARY_IDS, def.primary),
    secondary: sanitizeWeapon(r.secondary, SECONDARY_IDS, def.secondary),
    gadget1,
    gadget2,
    throwable: sanitizeGadget(r.throwable, c.throwables, def.throwable, null),
  };
}

const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : d);

function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r: Obj = isObj(raw) ? raw : {};
  return {
    quality: oneOf<Quality>(r.quality, ['low', 'medium', 'high'], d.quality),
    sens: num(r.sens, d.sens, 0.2, 3),
    adsSens: num(r.adsSens, d.adsSens, 0.4, 1.5),
    fov: num(r.fov, d.fov, 60, 95),
    invertY: bool(r.invertY, d.invertY),
    volume: num(r.volume, d.volume, 0, 1),
    aimAssist: num(r.aimAssist, d.aimAssist, 0, 1),
    showFps: bool(r.showFps, d.showFps),
    holdAds: bool(r.holdAds, d.holdAds),
  };
}

function defaultStats(): Profile['stats'] {
  return { games: 0, wins: 0, kills: 0, deaths: 0, revives: 0, caps: 0, heads: 0 };
}

/** 처음 시작하는 플레이어의 프로필 */
export function defaultProfile(): Profile {
  const loadouts = {} as Record<ClassId, Loadout>;
  for (const c of CLASS_IDS) loadouts[c] = defaultLoadout(c);
  return {
    version: 3,
    side: 'us', diff: 'easy', size: 'medium', map: MAPS[0].id, cls: 'assault',
    loadouts,
    settings: { ...DEFAULT_SETTINGS },
    xp: 0,
    stats: defaultStats(),
    seenHelp: false,
  };
}

/** 아무 값이나 받아 올바른 프로필로 만든다 (저장값을 기본값 위에 덮어쓴다) */
export function sanitizeProfile(raw: unknown): Profile {
  const p = defaultProfile();
  if (!isObj(raw)) return p;
  p.side = oneOf<Side>(raw.side, ['us', 'ru'], p.side);
  p.diff = oneOf<Diff>(raw.diff, Object.keys(DIFFS) as Diff[], p.diff);
  p.size = oneOf<SizeId>(raw.size, Object.keys(SIZES) as SizeId[], p.size);
  p.map = oneOf<string>(raw.map, MAPS.map((m) => m.id), p.map);
  p.cls = oneOf<ClassId>(raw.cls, CLASS_IDS, p.cls);
  const lo: Obj = isObj(raw.loadouts) ? raw.loadouts : {};
  for (const c of CLASS_IDS) p.loadouts[c] = sanitizeLoadout(c, lo[c]);
  p.settings = sanitizeSettings(raw.settings);
  p.xp = Math.floor(num(raw.xp, 0, 0, 1e9));
  const st: Obj = isObj(raw.stats) ? raw.stats : {};
  const s = p.stats;
  s.games = Math.floor(num(st.games, 0, 0, 1e9));
  s.wins = Math.floor(num(st.wins, 0, 0, 1e9));
  s.kills = Math.floor(num(st.kills, 0, 0, 1e9));
  s.deaths = Math.floor(num(st.deaths, 0, 0, 1e9));
  s.revives = Math.floor(num(st.revives, 0, 0, 1e9));
  s.caps = Math.floor(num(st.caps, 0, 0, 1e9));
  s.heads = Math.floor(num(st.heads, 0, 0, 1e9));
  p.seenHelp = bool(raw.seenHelp, false);
  return p;
}

// ───────────────────────── 저장 ─────────────────────────

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(): Profile {
  const ls = storage();
  if (!ls) return defaultProfile();
  try {
    const txt = ls.getItem(KEY);
    if (!txt) return defaultProfile();
    return sanitizeProfile(JSON.parse(txt));
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 저장 공간 부족·사생활 보호 모드: 무시 */
  }
}

// ───────────────────────── 계급 ─────────────────────────

export const MAX_RANK = 99;

/** 계급 r 에서 r+1 로 오르는 데 필요한 경험치: 1500, 2000, 2500, ... */
export const xpForRank = (rank: number): number => 1500 + (Math.max(1, rank) - 1) * 500;

/**
 * 경험치 → 계급. rank 는 1부터. cur = 이번 계급에서 쌓은 경험치, next = 다음 계급까지 필요한 이번 계급 전체 경험치
 * (진행 막대 = cur / next). 최고 계급이면 cur = next.
 */
export function rankOf(xp: number): { rank: number; cur: number; next: number } {
  let x = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let rank = 1;
  let need = xpForRank(rank);
  while (rank < MAX_RANK && x >= need) {
    x -= need;
    rank++;
    need = xpForRank(rank);
  }
  if (rank >= MAX_RANK) return { rank: MAX_RANK, cur: need, next: need };
  return { rank, cur: x, next: need };
}

/** 계급 이름 (화면 표시용) */
export function rankName(rank: number): string {
  const names = ['이병', '일병', '상병', '병장', '하사', '중사', '상사', '원사', '준위', '소위', '중위', '대위', '소령', '중령', '대령', '준장', '소장', '중장', '대장'];
  const tier = Math.min(names.length - 1, Math.floor((Math.max(1, rank) - 1) / 5));
  const step = ((Math.max(1, rank) - 1) % 5) + 1;
  return tier === names.length - 1 && rank > (names.length - 1) * 5 ? `${names[tier]} ${rank - (names.length - 1) * 5}` : `${names[tier]} ${step}`;
}
