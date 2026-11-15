// 무기 정의: 주무기 19종(돌격소총 4, 카빈 3, 기관단총 3, 경기관총 3, 지정사수소총 2, 저격소총 2, 산탄총 2) + 권총 3종.
// 2147년 베링 전선의 가상 화기. 실제 총기·게임 이름과 무관하다.
// 퍼짐·반동은 도 단위, 거리는 m, 탄속은 m/s.
import type { SlotId, WeaponCat, WeaponDef } from '../types';

type Slots = Partial<Record<SlotId, string[]>>;

// ── 슬롯 목록 틀 (첫 번째가 기본값) ──
const OPT_RIFLE = ['iron', 'rd_mini', 'rd_tube', 'holo', 'prism15', 'prism25', 'acog35', 'scope4', 'scope6'];
const OPT_CARB = ['iron', 'rd_mini', 'rd_tube', 'holo', 'prism15', 'prism25', 'acog35', 'scope4'];
const OPT_CQB = ['iron', 'rd_mini', 'rd_tube', 'holo', 'prism15', 'prism25'];
const OPT_DMR = ['iron', 'rd_mini', 'holo', 'prism25', 'acog35', 'scope4', 'scope6', 'scope8'];
const OPT_SHOT = ['iron', 'rd_mini', 'rd_tube', 'holo', 'prism15'];

const MUZ_RIFLE = ['muz_none', 'flash', 'comp', 'brake', 'supp', 'supp_heavy'];
const MUZ_SMG = ['muz_none', 'flash', 'comp', 'supp', 'supp_heavy'];
const MUZ_LMG = ['muz_none', 'flash', 'comp', 'brake', 'supp_heavy'];
const MUZ_PREC = ['muz_none', 'flash', 'brake', 'supp', 'supp_heavy'];
const MUZ_SNIPER = ['muz_none', 'brake', 'supp_heavy', 'supp', 'flash'];
const MUZ_SHOT = ['muz_none', 'choke', 'brake', 'supp'];

const BAR_RIFLE = ['bar_std', 'bar_short', 'bar_long', 'bar_heavy', 'bar_fluted'];
const BAR_SMG = ['bar_std', 'bar_short', 'bar_long', 'bar_fluted'];
const BAR_PREC = ['bar_std', 'bar_short', 'bar_long', 'bar_heavy', 'bar_match'];
const BAR_SNIPER = ['bar_std', 'bar_long', 'bar_match', 'bar_fluted', 'bar_heavy', 'bar_short'];
const BAR_SHOT = ['bar_std', 'bar_short', 'bar_long'];

const UB_RIFLE = ['ub_none', 'vgrip', 'agrip', 'stubby', 'handstop', 'laser', 'light', 'bipod'];
const UB_CQB = ['ub_none', 'vgrip', 'agrip', 'stubby', 'handstop', 'laser', 'light'];
const UB_LMG = ['ub_none', 'bipod', 'vgrip', 'agrip', 'stubby', 'handstop', 'laser'];
const UB_DMR = ['ub_none', 'bipod', 'vgrip', 'agrip', 'handstop', 'laser'];
const UB_SNIPER = ['ub_none', 'bipod', 'handstop', 'laser'];
const UB_SHOT = ['ub_none', 'vgrip', 'stubby', 'laser', 'light'];

const MAG_RIFLE = ['mag_std', 'mag_ext', 'mag_drum', 'mag_fast', 'mag_light'];
const MAG_LMG = ['mag_std', 'belt_ext', 'belt_light', 'mag_fast'];
const MAG_SNIPER = ['mag_std', 'smag_ext', 'mag_fast'];
const MAG_SHOT = ['mag_std', 'tube_ext', 'mag_fast'];

const AMMO_RIFLE = ['fmj', 'hp', 'ap', 'sub', 'tracer'];
const AMMO_PREC = ['fmj', 'match', 'ap', 'hp', 'sub', 'tracer'];
const AMMO_SHOT = ['buck', 'slug', 'flechette'];

const STOCK_RIFLE = ['stock_std', 'stock_light', 'stock_heavy', 'stock_fold'];
const STOCK_LMG = ['stock_std', 'stock_light', 'stock_heavy'];
const STOCK_PREC = ['stock_std', 'stock_cheek', 'stock_heavy', 'stock_light'];

const c = (a: string[]): string[] => a.slice();

const arSlots = (): Slots => ({
  optic: c(OPT_RIFLE), muzzle: c(MUZ_RIFLE), barrel: c(BAR_RIFLE), underbarrel: c(UB_RIFLE),
  magazine: c(MAG_RIFLE), ammo: c(AMMO_RIFLE), stock: c(STOCK_RIFLE),
});
const carbineSlots = (): Slots => ({
  optic: c(OPT_CARB), muzzle: c(MUZ_RIFLE), barrel: c(BAR_RIFLE), underbarrel: c(UB_CQB),
  magazine: c(MAG_RIFLE), ammo: c(AMMO_RIFLE), stock: c(STOCK_RIFLE),
});
const smgSlots = (): Slots => ({
  optic: c(OPT_CQB), muzzle: c(MUZ_SMG), barrel: c(BAR_SMG), underbarrel: c(UB_CQB),
  magazine: c(MAG_RIFLE), ammo: c(AMMO_RIFLE), stock: c(STOCK_RIFLE),
});
const lmgSlots = (): Slots => ({
  optic: c(OPT_CARB), muzzle: c(MUZ_LMG), barrel: c(BAR_RIFLE), underbarrel: c(UB_LMG),
  magazine: c(MAG_LMG), ammo: c(AMMO_RIFLE), stock: c(STOCK_LMG),
});
const dmrSlots = (): Slots => ({
  optic: c(OPT_DMR), muzzle: c(MUZ_PREC), barrel: c(BAR_PREC), underbarrel: c(UB_DMR),
  magazine: ['mag_std', 'mag_ext', 'mag_fast', 'mag_light'], ammo: c(AMMO_PREC), stock: c(STOCK_PREC),
});
const sniperSlots = (optic: string[]): Slots => ({
  optic, muzzle: c(MUZ_SNIPER), barrel: c(BAR_SNIPER), underbarrel: c(UB_SNIPER),
  magazine: c(MAG_SNIPER), ammo: c(AMMO_PREC), stock: c(STOCK_PREC),
});
const shotgunSlots = (): Slots => ({
  optic: c(OPT_SHOT), muzzle: c(MUZ_SHOT), barrel: c(BAR_SHOT), underbarrel: c(UB_SHOT),
  magazine: c(MAG_SHOT), ammo: c(AMMO_SHOT), stock: c(STOCK_RIFLE),
});

// 진영 색조 (총 몸통 보조색)
const NAC_BLUE = 0x3f7fae;
const NAC_STEEL = 0x4b8fb8;
const FEA_RED = 0x9a4434;
const FEA_RUST = 0x8f4a35;
const TAN = 0x8b7b5a;
const OLIVE = 0x6c7a5a;

export const WEAPONS: Record<string, WeaponDef> = {
  // ───────────── 돌격소총 ─────────────
  ar47: {
    id: 'ar47', name: 'AR-47 스콜', cat: 'ar',
    desc: '미 북극사령부 제식 돌격소총. 반동이 고르고 가까운 거리부터 중거리까지 무난하게 해낸다.',
    modes: ['auto', 'semi'], rpm: 750,
    dmgNear: 25, dmgFar: 18, rangeNear: 25, rangeFar: 70, headMul: 1.7,
    velocity: 820, mag: 30, reserve: 150, reload: 2.2, reloadEmpty: 2.8, adsTime: 0.26,
    hipSpread: 3.4, adsSpread: 0.22, moveSpread: 1.6, spreadPerShot: 0.08, spreadMax: 2.4,
    recoilV: 0.5, recoilH: 0.22, firstShot: 1.4, recoilRecover: 10,
    moveMul: 1.0, swap: 0.55,
    slots: arSlots(),
    model: { body: 'rifle', length: 0.52, barrel: 0.36, mag: 'curved', color: 0x2d3035, accent: NAC_BLUE, rail: true },
    sound: { kind: 'rifle', pitch: 1.0, punch: 1.0 },
  },
  k12: {
    id: 'k12', name: 'K-12 바르가', cat: 'ar',
    desc: '러시아 극동군의 묵직한 돌격소총. 한 발 한 발이 세지만 위로 튀는 반동을 눌러야 한다.',
    modes: ['auto', 'semi'], rpm: 700,
    dmgNear: 27, dmgFar: 19, rangeNear: 22, rangeFar: 65, headMul: 1.7,
    velocity: 760, mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 3.0, adsTime: 0.29,
    hipSpread: 3.8, adsSpread: 0.26, moveSpread: 1.8, spreadPerShot: 0.1, spreadMax: 2.8,
    recoilV: 0.68, recoilH: 0.32, firstShot: 1.5, recoilRecover: 9,
    moveMul: 0.99, swap: 0.58,
    slots: arSlots(),
    model: { body: 'rifle', length: 0.54, barrel: 0.38, mag: 'curved', color: 0x34322c, accent: FEA_RED, rail: true },
    sound: { kind: 'rifle', pitch: 0.88, punch: 1.2 },
  },
  br9: {
    id: 'br9', name: 'BR-9 헤일스톰', cat: 'ar',
    desc: '짧고 빠른 불펍 돌격소총. 연사가 빠르고 정조준이 날렵하지만 좌우로 흔들리고 장전이 굼뜨다.',
    modes: ['auto', 'burst', 'semi'], burst: 3, rpm: 800,
    dmgNear: 24, dmgFar: 17, rangeNear: 22, rangeFar: 62, headMul: 1.7,
    velocity: 860, mag: 30, reserve: 150, reload: 2.6, reloadEmpty: 3.2, adsTime: 0.24,
    hipSpread: 3.2, adsSpread: 0.2, moveSpread: 1.5, spreadPerShot: 0.09, spreadMax: 2.6,
    recoilV: 0.42, recoilH: 0.34, firstShot: 1.3, recoilRecover: 11,
    moveMul: 1.01, swap: 0.52,
    slots: {
      optic: c(OPT_RIFLE), muzzle: c(MUZ_RIFLE), barrel: c(BAR_RIFLE), underbarrel: c(UB_RIFLE),
      magazine: c(MAG_RIFLE), ammo: c(AMMO_RIFLE),
    },
    model: { body: 'bullpup', length: 0.6, barrel: 0.32, mag: 'box', color: 0x3a3d40, accent: NAC_STEEL, rail: true },
    sound: { kind: 'rifle', pitch: 1.1, punch: 0.9 },
  },
  avk30: {
    id: 'avk30', name: 'AVK-30 폴랴르', cat: 'ar',
    desc: '긴 총열의 정밀 돌격소총. 탄속이 빠르고 멀리까지 위력이 남지만 무겁고 다루기가 느리다.',
    modes: ['auto', 'semi'], rpm: 720,
    dmgNear: 25, dmgFar: 19, rangeNear: 30, rangeFar: 85, headMul: 1.75,
    velocity: 900, mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.9, adsTime: 0.28,
    hipSpread: 3.6, adsSpread: 0.16, moveSpread: 1.7, spreadPerShot: 0.07, spreadMax: 2.2,
    recoilV: 0.6, recoilH: 0.18, firstShot: 1.45, recoilRecover: 9.5,
    moveMul: 0.97, swap: 0.6,
    slots: { ...arSlots(), barrel: [...BAR_RIFLE, 'bar_match'] },
    model: { body: 'rifle', length: 0.56, barrel: 0.42, mag: 'box', color: 0x2f332b, accent: FEA_RUST, rail: true },
    sound: { kind: 'rifle', pitch: 0.94, punch: 1.1 },
  },

  // ───────────── 카빈 ─────────────
  mc4: {
    id: 'mc4', name: 'MC-4 노스윈드', cat: 'carbine',
    desc: '미 북극사령부 공병 표준 카빈. 소총보다 가볍고 기관단총보다 멀리 닿는다.',
    modes: ['auto', 'semi'], rpm: 850,
    dmgNear: 23, dmgFar: 16, rangeNear: 18, rangeFar: 55, headMul: 1.65,
    velocity: 720, mag: 30, reserve: 150, reload: 2.0, reloadEmpty: 2.5, adsTime: 0.22,
    hipSpread: 3.0, adsSpread: 0.24, moveSpread: 1.3, spreadPerShot: 0.09, spreadMax: 2.6,
    recoilV: 0.44, recoilH: 0.24, firstShot: 1.35, recoilRecover: 11,
    moveMul: 1.02, swap: 0.48,
    slots: carbineSlots(),
    model: { body: 'rifle', length: 0.46, barrel: 0.26, mag: 'curved', color: 0x303338, accent: NAC_BLUE, rail: true },
    sound: { kind: 'carbine', pitch: 1.08, punch: 0.9 },
  },
  ks7: {
    id: 'ks7', name: 'KS-7 오호타', cat: 'carbine',
    desc: '접이식 개머리판의 짧은 카빈. 가까운 거리 위력이 좋지만 반동이 거칠다.',
    modes: ['auto', 'semi'], rpm: 800,
    dmgNear: 25, dmgFar: 16, rangeNear: 16, rangeFar: 50, headMul: 1.65,
    velocity: 680, mag: 30, reserve: 150, reload: 2.1, reloadEmpty: 2.6, adsTime: 0.23,
    hipSpread: 3.2, adsSpread: 0.26, moveSpread: 1.4, spreadPerShot: 0.11, spreadMax: 2.9,
    recoilV: 0.55, recoilH: 0.3, firstShot: 1.4, recoilRecover: 10,
    moveMul: 1.02, swap: 0.5,
    slots: carbineSlots(),
    model: { body: 'rifle', length: 0.44, barrel: 0.24, mag: 'curved', color: 0x3a362f, accent: FEA_RED, rail: true },
    sound: { kind: 'carbine', pitch: 0.96, punch: 1.05 },
  },
  cbx: {
    id: 'cbx', name: 'CB-X 프로스트바이트', cat: 'carbine',
    desc: '불펍 구조의 고속 카빈. 연사가 가장 빠른 카빈이지만 위력이 일찍 떨어진다.',
    modes: ['auto', 'burst', 'semi'], burst: 3, rpm: 900,
    dmgNear: 22, dmgFar: 15, rangeNear: 16, rangeFar: 48, headMul: 1.65,
    velocity: 700, mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 2.9, adsTime: 0.21,
    hipSpread: 2.9, adsSpread: 0.24, moveSpread: 1.2, spreadPerShot: 0.1, spreadMax: 2.6,
    recoilV: 0.38, recoilH: 0.3, firstShot: 1.3, recoilRecover: 12,
    moveMul: 1.03, swap: 0.46,
    slots: {
      optic: c(OPT_CARB), muzzle: c(MUZ_RIFLE), barrel: c(BAR_RIFLE), underbarrel: c(UB_CQB),
      magazine: c(MAG_RIFLE), ammo: c(AMMO_RIFLE),
    },
    model: { body: 'bullpup', length: 0.52, barrel: 0.24, mag: 'box', color: 0x3b3e42, accent: TAN, rail: true },
    sound: { kind: 'carbine', pitch: 1.15, punch: 0.85 },
  },

  // ───────────── 기관단총 ─────────────
  v10: {
    id: 'v10', name: 'V-10 와스프', cat: 'smg',
    desc: '분당 천 발을 넘기는 초고속 기관단총. 방 하나는 순식간에 정리하지만 거리가 멀면 힘이 빠진다.',
    modes: ['auto', 'semi'], rpm: 1050,
    dmgNear: 20, dmgFar: 12, rangeNear: 10, rangeFar: 40, headMul: 1.5,
    velocity: 420, mag: 32, reserve: 160, reload: 1.9, reloadEmpty: 2.4, adsTime: 0.18,
    hipSpread: 2.5, adsSpread: 0.3, moveSpread: 0.9, spreadPerShot: 0.07, spreadMax: 2.2,
    recoilV: 0.3, recoilH: 0.24, firstShot: 1.2, recoilRecover: 14,
    moveMul: 1.05, swap: 0.42,
    slots: smgSlots(),
    model: { body: 'smg', length: 0.36, barrel: 0.16, mag: 'box', color: 0x2c2f33, accent: NAC_STEEL, rail: true },
    sound: { kind: 'smg', pitch: 1.2, punch: 0.7 },
  },
  pp22: {
    id: 'pp22', name: 'PP-22 쇼로흐', cat: 'smg',
    desc: '위에 얹는 50발 나선 탄창의 기관단총. 오래 쏠 수 있고 반동이 순하지만 장전이 길다.',
    modes: ['auto', 'semi'], rpm: 900,
    dmgNear: 21, dmgFar: 13, rangeNear: 12, rangeFar: 42, headMul: 1.5,
    velocity: 460, mag: 50, reserve: 200, reload: 2.6, reloadEmpty: 3.1, adsTime: 0.2,
    hipSpread: 2.7, adsSpread: 0.32, moveSpread: 1.0, spreadPerShot: 0.06, spreadMax: 2.0,
    recoilV: 0.33, recoilH: 0.2, firstShot: 1.25, recoilRecover: 13,
    moveMul: 1.04, swap: 0.45,
    slots: { ...smgSlots(), magazine: ['mag_std', 'mag_ext', 'mag_fast'] },
    model: { body: 'smg', length: 0.4, barrel: 0.17, mag: 'top', color: 0x36332d, accent: FEA_RED, rail: true },
    sound: { kind: 'smg', pitch: 1.05, punch: 0.8 },
  },
  r5: {
    id: 'r5', name: 'R-5 레이스', cat: 'smg',
    desc: '정숙 작전용 기관단총. 소음기를 달아도 성능 손실이 적고 기관단총 중 가장 멀리 닿는다.',
    modes: ['auto', 'burst', 'semi'], burst: 2, rpm: 950,
    dmgNear: 23, dmgFar: 14, rangeNear: 13, rangeFar: 45, headMul: 1.55,
    velocity: 500, mag: 30, reserve: 150, reload: 1.8, reloadEmpty: 2.2, adsTime: 0.19,
    hipSpread: 2.8, adsSpread: 0.26, moveSpread: 1.0, spreadPerShot: 0.08, spreadMax: 2.4,
    recoilV: 0.36, recoilH: 0.2, firstShot: 1.3, recoilRecover: 13,
    moveMul: 1.05, swap: 0.44,
    slots: smgSlots(),
    model: { body: 'smg', length: 0.38, barrel: 0.18, mag: 'curved', color: 0x26292d, accent: OLIVE, rail: true },
    sound: { kind: 'smg', pitch: 1.0, punch: 0.85 },
  },

  // ───────────── 경기관총 ─────────────
  lm6: {
    id: 'lm6', name: 'LM-6 글레이셔', cat: 'lmg',
    desc: '미 북극사령부 분대 지원화기. 100발 탄통으로 길목을 오래 묶어 둔다. 양각대를 펴면 진가가 나온다.',
    modes: ['auto'], rpm: 700,
    dmgNear: 25, dmgFar: 19, rangeNear: 28, rangeFar: 80, headMul: 1.6,
    velocity: 840, mag: 100, reserve: 400, reload: 5.2, reloadEmpty: 6.2, adsTime: 0.42,
    hipSpread: 4.5, adsSpread: 0.3, moveSpread: 2.2, spreadPerShot: 0.06, spreadMax: 2.6,
    recoilV: 0.56, recoilH: 0.3, firstShot: 1.3, recoilRecover: 8,
    moveMul: 0.9, swap: 0.68,
    slots: lmgSlots(),
    model: { body: 'lmg', length: 0.6, barrel: 0.46, mag: 'box', color: 0x2e3136, accent: NAC_BLUE, rail: true },
    sound: { kind: 'lmg', pitch: 0.95, punch: 1.15 },
  },
  pkr9: {
    id: 'pkr9', name: 'PKR-9 두브', cat: 'lmg',
    desc: '굵은 탄을 쓰는 중(重)경기관총. 멀리서도 세게 때리지만 반동이 크고 몸이 무거워진다.',
    modes: ['auto'], rpm: 620,
    dmgNear: 30, dmgFar: 22, rangeNear: 30, rangeFar: 90, headMul: 1.6,
    velocity: 820, mag: 80, reserve: 320, reload: 5.6, reloadEmpty: 6.6, adsTime: 0.45,
    hipSpread: 4.8, adsSpread: 0.34, moveSpread: 2.4, spreadPerShot: 0.08, spreadMax: 3.0,
    recoilV: 0.82, recoilH: 0.4, firstShot: 1.5, recoilRecover: 7,
    moveMul: 0.88, swap: 0.7,
    slots: lmgSlots(),
    model: { body: 'lmg', length: 0.64, barrel: 0.5, mag: 'box', color: 0x33302a, accent: FEA_RED, rail: true },
    sound: { kind: 'lmg', pitch: 0.8, punch: 1.4 },
  },
  mg51: {
    id: 'mg51', name: 'MG-51 블리자드', cat: 'lmg',
    desc: '드럼 탄창 120발의 고속 경기관총. 탄을 퍼붓는 제압용으로, 오래 쏠수록 퍼짐이 커진다.',
    modes: ['auto'], rpm: 850,
    dmgNear: 23, dmgFar: 17, rangeNear: 24, rangeFar: 70, headMul: 1.6,
    velocity: 800, mag: 120, reserve: 480, reload: 5.8, reloadEmpty: 6.8, adsTime: 0.44,
    hipSpread: 4.6, adsSpread: 0.36, moveSpread: 2.3, spreadPerShot: 0.09, spreadMax: 3.2,
    recoilV: 0.6, recoilH: 0.42, firstShot: 1.25, recoilRecover: 8,
    moveMul: 0.89, swap: 0.7,
    slots: lmgSlots(),
    model: { body: 'lmg', length: 0.62, barrel: 0.44, mag: 'drum', color: 0x3a3d40, accent: OLIVE, rail: true },
    sound: { kind: 'lmg', pitch: 1.08, punch: 1.0 },
  },

  // ───────────── 지정사수소총 ─────────────
  dm14: {
    id: 'dm14', name: 'DM-14 하푼', cat: 'dmr',
    desc: '반자동 지정사수소총. 몸통 세 발, 머리 한 발. 빠르게 이어 쏠 수 있지만 반동을 기다려야 정확하다.',
    modes: ['semi'], rpm: 300,
    dmgNear: 48, dmgFar: 38, rangeNear: 40, rangeFar: 110, headMul: 2.1,
    velocity: 880, mag: 20, reserve: 80, reload: 2.4, reloadEmpty: 3.0, adsTime: 0.32,
    hipSpread: 4.2, adsSpread: 0.12, moveSpread: 2.0, spreadPerShot: 0.35, spreadMax: 3.0,
    recoilV: 1.05, recoilH: 0.3, firstShot: 1.0, recoilRecover: 12,
    moveMul: 0.97, swap: 0.6,
    slots: dmrSlots(),
    model: { body: 'dmr', length: 0.6, barrel: 0.46, mag: 'box', color: 0x2c2f34, accent: NAC_BLUE, rail: true },
    sound: { kind: 'dmr', pitch: 0.95, punch: 1.25 },
  },
  svk12: {
    id: 'svk12', name: 'SVK-12 타이가', cat: 'dmr',
    desc: '대구경 반자동 소총. 몸통 두 발로 끝내지만 10발 탄창과 큰 반동이 발목을 잡는다.',
    modes: ['semi'], rpm: 220,
    dmgNear: 54, dmgFar: 42, rangeNear: 45, rangeFar: 120, headMul: 1.9,
    velocity: 840, mag: 10, reserve: 50, reload: 2.6, reloadEmpty: 3.2, adsTime: 0.34,
    hipSpread: 4.5, adsSpread: 0.12, moveSpread: 2.2, spreadPerShot: 0.45, spreadMax: 3.2,
    recoilV: 1.25, recoilH: 0.38, firstShot: 1.0, recoilRecover: 11,
    moveMul: 0.96, swap: 0.62,
    slots: { ...dmrSlots(), magazine: ['mag_std', 'smag_ext', 'mag_fast'] },
    model: { body: 'dmr', length: 0.64, barrel: 0.5, mag: 'box', color: 0x35332c, accent: FEA_RUST, rail: true },
    sound: { kind: 'dmr', pitch: 0.85, punch: 1.4 },
  },

  // ───────────── 저격소총 ─────────────
  lr90: {
    id: 'lr90', name: 'LR-90 오로라', cat: 'sniper',
    desc: '가벼운 볼트액션 저격소총. 탄속이 빠르고 노리쇠가 빨라 50m 안에서는 몸통 한 발로 끝난다.',
    modes: ['bolt'], rpm: 48,
    dmgNear: 100, dmgFar: 85, rangeNear: 50, rangeFar: 150, headMul: 2.6,
    velocity: 920, mag: 5, reserve: 25, reload: 3.0, reloadEmpty: 3.6, adsTime: 0.38,
    hipSpread: 5.0, adsSpread: 0.1, moveSpread: 3.0, spreadPerShot: 0.5, spreadMax: 4.0,
    recoilV: 1.5, recoilH: 0.35, firstShot: 1.0, recoilRecover: 10,
    moveMul: 0.93, swap: 0.65,
    slots: sniperSlots(['scope6', 'scope8', 'scope10', 'scope4', 'acog35', 'prism25', 'holo', 'iron']),
    model: { body: 'sniper', length: 0.72, barrel: 0.6, mag: 'box', color: 0x2b2e32, accent: NAC_BLUE, rail: true },
    sound: { kind: 'sniper', pitch: 0.9, punch: 1.4 },
  },
  kv8: {
    id: 'kv8', name: 'KV-8 메텔', cat: 'sniper',
    desc: '대물 저격소총. 먼 거리에서도 몸통 한 발이 가능하지만 노리쇠가 느리고 총이 무겁다.',
    modes: ['bolt'], rpm: 40,
    dmgNear: 118, dmgFar: 96, rangeNear: 60, rangeFar: 180, headMul: 2.5,
    velocity: 860, mag: 5, reserve: 25, reload: 3.3, reloadEmpty: 4.0, adsTime: 0.42,
    hipSpread: 5.0, adsSpread: 0.1, moveSpread: 3.2, spreadPerShot: 0.6, spreadMax: 4.0,
    recoilV: 1.6, recoilH: 0.45, firstShot: 1.0, recoilRecover: 9,
    moveMul: 0.92, swap: 0.7,
    slots: sniperSlots(['scope8', 'scope10', 'scope6', 'scope4', 'acog35', 'holo', 'iron']),
    model: { body: 'sniper', length: 0.75, barrel: 0.66, mag: 'box', color: 0x36332c, accent: FEA_RED, rail: true },
    sound: { kind: 'sniper', pitch: 0.78, punch: 1.55 },
  },

  // ───────────── 산탄총 ─────────────
  sg12: {
    id: 'sg12', name: 'SG-12 매머드', cat: 'shotgun',
    desc: '펌프액션 산탄총. 산탄 8알로 문 앞의 적을 한 방에 쓰러뜨린다. 거리가 벌어지면 급격히 약해진다.',
    modes: ['pump'], rpm: 72, pellets: 8,
    dmgNear: 18, dmgFar: 6, rangeNear: 10, rangeFar: 40, headMul: 1.5,
    velocity: 440, mag: 7, reserve: 28, reload: 4.2, reloadEmpty: 5.0, adsTime: 0.24,
    hipSpread: 4.5, adsSpread: 2.0, moveSpread: 1.0, spreadPerShot: 0.8, spreadMax: 3.0,
    recoilV: 1.5, recoilH: 0.5, firstShot: 1.0, recoilRecover: 12,
    moveMul: 1.0, swap: 0.55,
    slots: shotgunSlots(),
    model: { body: 'shotgun', length: 0.5, barrel: 0.46, mag: 'tube', color: 0x2f3134, accent: 0x6b5a45, rail: true },
    sound: { kind: 'shotgun', pitch: 0.85, punch: 1.5 },
  },
  ksb20: {
    id: 'ksb20', name: 'KSB-20 보레아스', cat: 'shotgun',
    desc: '상자 탄창 반자동 산탄총. 한 발 위력은 매머드보다 약하지만 당기는 대로 연달아 나간다.',
    modes: ['semi'], rpm: 200, pellets: 9,
    dmgNear: 15, dmgFar: 5, rangeNear: 10, rangeFar: 40, headMul: 1.4,
    velocity: 420, mag: 8, reserve: 32, reload: 2.8, reloadEmpty: 3.4, adsTime: 0.26,
    hipSpread: 4.8, adsSpread: 2.4, moveSpread: 1.2, spreadPerShot: 0.9, spreadMax: 4.0,
    recoilV: 1.2, recoilH: 0.6, firstShot: 1.0, recoilRecover: 11,
    moveMul: 0.99, swap: 0.58,
    slots: shotgunSlots(),
    model: { body: 'shotgun', length: 0.52, barrel: 0.42, mag: 'box', color: 0x34312b, accent: FEA_RED, rail: true },
    sound: { kind: 'shotgun', pitch: 0.95, punch: 1.3 },
  },

  // ───────────── 권총 ─────────────
  p9: {
    id: 'p9', name: 'P-9 키스톤', cat: 'pistol',
    desc: '미 북극사령부 제식 권총. 빠르게 꺼내 정확하게 쏜다. 무난한 보조무기.',
    modes: ['semi'], rpm: 450,
    dmgNear: 26, dmgFar: 16, rangeNear: 12, rangeFar: 40, headMul: 1.6,
    velocity: 400, mag: 15, reserve: 60, reload: 1.5, reloadEmpty: 1.9, adsTime: 0.15,
    hipSpread: 2.6, adsSpread: 0.4, moveSpread: 0.9, spreadPerShot: 0.25, spreadMax: 2.4,
    recoilV: 0.7, recoilH: 0.3, firstShot: 1.1, recoilRecover: 14,
    moveMul: 1.08, swap: 0.35,
    slots: {
      optic: ['iron', 'rd_mini'], muzzle: ['muz_none', 'comp', 'supp'], underbarrel: ['ub_none', 'laser', 'light'],
      magazine: ['mag_std', 'pmag_ext', 'mag_fast'], ammo: ['fmj', 'hp', 'ap', 'sub'],
    },
    model: { body: 'pistol', length: 0.2, barrel: 0.1, mag: 'pistol', color: 0x2a2c30, accent: NAC_BLUE, rail: true },
    sound: { kind: 'pistol', pitch: 1.05, punch: 0.9 },
  },
  pm45: {
    id: 'pm45', name: 'PM-45 그롬', cat: 'pistol',
    desc: '대구경 권총. 7발뿐이지만 몸통 세 발이면 끝난다. 반동이 손을 크게 들어 올린다.',
    modes: ['semi'], rpm: 180,
    dmgNear: 45, dmgFar: 28, rangeNear: 14, rangeFar: 40, headMul: 1.7,
    velocity: 450, mag: 7, reserve: 35, reload: 1.9, reloadEmpty: 2.3, adsTime: 0.17,
    hipSpread: 3.0, adsSpread: 0.35, moveSpread: 1.0, spreadPerShot: 0.5, spreadMax: 3.0,
    recoilV: 1.6, recoilH: 0.5, firstShot: 1.0, recoilRecover: 10,
    moveMul: 1.07, swap: 0.38,
    slots: {
      optic: ['iron'], muzzle: ['muz_none', 'comp'], underbarrel: ['ub_none', 'laser'],
      magazine: ['mag_std', 'mag_fast'], ammo: ['fmj', 'hp', 'ap'],
    },
    model: { body: 'pistol', length: 0.24, barrel: 0.13, mag: 'pistol', color: 0x35322c, accent: FEA_RED, rail: false },
    sound: { kind: 'pistol', pitch: 0.8, punch: 1.3 },
  },
  mp18: {
    id: 'mp18', name: 'MP-18 코마르', cat: 'pistol',
    desc: '연발 기관권총. 근접 위기 상황을 뒤집는 비상용. 탄이 금방 바닥나고 멀리는 못 맞힌다.',
    modes: ['auto', 'semi'], rpm: 1100,
    dmgNear: 18, dmgFar: 10, rangeNear: 10, rangeFar: 40, headMul: 1.5,
    velocity: 400, mag: 20, reserve: 100, reload: 1.7, reloadEmpty: 2.1, adsTime: 0.16,
    hipSpread: 3.0, adsSpread: 0.5, moveSpread: 1.0, spreadPerShot: 0.12, spreadMax: 3.0,
    recoilV: 0.4, recoilH: 0.35, firstShot: 1.15, recoilRecover: 13,
    moveMul: 1.07, swap: 0.36,
    slots: {
      optic: ['iron', 'rd_mini'], muzzle: ['muz_none', 'comp', 'supp'], underbarrel: ['ub_none', 'laser', 'stubby'],
      magazine: ['mag_std', 'pmag_ext'], ammo: ['fmj', 'hp', 'sub'], stock: ['stock_none', 'stock_brace'],
    },
    model: { body: 'pistol', length: 0.22, barrel: 0.09, mag: 'pistol', color: 0x2c2e31, accent: OLIVE, rail: true },
    sound: { kind: 'pistol', pitch: 1.25, punch: 0.7 },
  },
};

export const PRIMARY_IDS: string[] = Object.keys(WEAPONS).filter((id) => WEAPONS[id].cat !== 'pistol');
export const SECONDARY_IDS: string[] = Object.keys(WEAPONS).filter((id) => WEAPONS[id].cat === 'pistol');

export const CAT_NAMES: Record<WeaponCat, string> = {
  ar: '돌격소총',
  carbine: '카빈',
  smg: '기관단총',
  lmg: '경기관총',
  dmr: '지정사수소총',
  sniper: '저격소총',
  shotgun: '산탄총',
  pistol: '권총',
};

/** 분류 표시 순서 (로드아웃 화면 탭용) */
export const CAT_ORDER: WeaponCat[] = ['ar', 'carbine', 'smg', 'lmg', 'dmr', 'sniper', 'shotgun', 'pistol'];
