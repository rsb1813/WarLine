// 게임의 모든 수치와 정의. 거리 단위는 월드 단위(병사 반지름 8, 칸 한 변 32)

export type Side = 'us' | 'ru';
export type Team = 0 | 1;
export type ClassId = 'assault' | 'engineer' | 'medic' | 'recon';
export type WeaponId =
  | 'ar27' | 'kr9' | 'ck4' | 'v10' | 'vx45' | 'sg12' | 'l60' | 'l34' | 'd14' | 'b50' | 'b7';
export type GadgetId =
  | 'ugl' | 'smokegl' | 'stim' | 'plate' | 'rpg' | 'aa' | 'repair' | 'mine'
  | 'medbag' | 'ammobox' | 'smoke' | 'drone' | 'sensor' | 'beacon' | 'claymore';
export type VehicleType = 'tank' | 'ifv' | 'jeep' | 'heli';
export type Diff = 'easy' | 'normal' | 'hard';
export type SizeId = 'small' | 'medium' | 'large';
export type Optic = 'iron' | 'dot' | 'x2' | 'x6';
export type Muzzle = 'none' | 'supp' | 'comp';
export type MagAtt = 'std' | 'ext';
export type Grip = 'none' | 'vert';

export const SOLDIER_R = 8;
export const WALK = 132;
export const SPRINT_MUL = 1.5;
export const CROUCH_MUL = 0.55;
export const ADS_MUL = 0.62;
export const DOWN_TIME = 12;
export const RESPAWN_DELAY = 7;
export const BLEED_EVERY = 4;
export const FLAG_R = 200;
export const MATCH_LIMIT = 14 * 60;

// ───────── 무기 ─────────

export interface WeaponDef {
  name: string;
  kind: string;
  desc: string;
  dmg: number;
  dmgFar: number;
  near: number;
  far: number;
  range: number;
  rpm: number;
  mag: number;
  mags: number;
  reload: number;
  hip: number;
  ads: number;
  bloom: number;
  bloomMax: number;
  recover: number;
  speed: number;
  move: number;
  auto: boolean;
  pellets?: number;
  optics: Optic[];
  /** 소리: 기본 음높이, 길이, 묵직함 */
  snd: [number, number, number];
}

const ALL_OPT: Optic[] = ['iron', 'dot', 'x2'];
const LONG_OPT: Optic[] = ['iron', 'dot', 'x2', 'x6'];

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar27: {
    name: 'AR-27', kind: '돌격소총', desc: '반동이 가볍고 어느 거리에서나 무난하다.',
    dmg: 24, dmgFar: 17, near: 300, far: 850, range: 1350, rpm: 680, mag: 30, mags: 5, reload: 2.0,
    hip: 0.05, ads: 0.013, bloom: 0.005, bloomMax: 0.045, recover: 0.2, speed: 1900, move: 1, auto: true,
    optics: ALL_OPT, snd: [1, 0.09, 0.5],
  },
  kr9: {
    name: 'KR-9', kind: '전투소총', desc: '한 발이 묵직하다. 연사는 느리고 반동이 크다.',
    dmg: 33, dmgFar: 26, near: 350, far: 950, range: 1450, rpm: 500, mag: 20, mags: 6, reload: 2.3,
    hip: 0.056, ads: 0.011, bloom: 0.009, bloomMax: 0.06, recover: 0.22, speed: 2100, move: 0.97, auto: true,
    optics: ALL_OPT, snd: [0.8, 0.12, 0.7],
  },
  ck4: {
    name: 'CK-4', kind: '카빈', desc: '짧고 가볍다. 근거리에서 빠르게 쏘고 빠르게 움직인다.',
    dmg: 22, dmgFar: 14, near: 240, far: 650, range: 1100, rpm: 780, mag: 30, mags: 5, reload: 1.8,
    hip: 0.045, ads: 0.017, bloom: 0.004, bloomMax: 0.04, recover: 0.25, speed: 1800, move: 1.04, auto: true,
    optics: ALL_OPT, snd: [1.15, 0.08, 0.45],
  },
  v10: {
    name: 'V-10', kind: '기관단총', desc: '가까이 붙으면 가장 빨리 녹인다. 멀리는 힘이 빠진다.',
    dmg: 20, dmgFar: 10, near: 170, far: 450, range: 820, rpm: 900, mag: 32, mags: 6, reload: 1.6,
    hip: 0.05, ads: 0.024, bloom: 0.003, bloomMax: 0.035, recover: 0.3, speed: 1600, move: 1.1, auto: true,
    optics: ALL_OPT, snd: [1.35, 0.06, 0.3],
  },
  vx45: {
    name: 'VX-45', kind: '중기관단총', desc: '느리지만 한 발이 굵은 기관단총.',
    dmg: 27, dmgFar: 13, near: 160, far: 420, range: 780, rpm: 620, mag: 25, mags: 6, reload: 1.7,
    hip: 0.045, ads: 0.022, bloom: 0.004, bloomMax: 0.04, recover: 0.28, speed: 1500, move: 1.08, auto: true,
    optics: ALL_OPT, snd: [1.0, 0.08, 0.45],
  },
  sg12: {
    name: 'SG-12', kind: '산탄총', desc: '건물 안에서 한 방. 조금만 멀어져도 힘이 빠진다.',
    dmg: 15, dmgFar: 3, near: 110, far: 320, range: 430, rpm: 75, mag: 7, mags: 5, reload: 2.8,
    hip: 0.09, ads: 0.075, bloom: 0, bloomMax: 0, recover: 1, speed: 1500, move: 1.05, auto: false, pellets: 8,
    optics: ['iron', 'dot'], snd: [0.7, 0.18, 0.9],
  },
  l60: {
    name: 'L-60', kind: '경기관총', desc: '100발로 오래 퍼붓는다. 무겁고 재장전이 길다.',
    dmg: 25, dmgFar: 20, near: 350, far: 900, range: 1400, rpm: 640, mag: 100, mags: 3, reload: 4.8,
    hip: 0.066, ads: 0.016, bloom: 0.004, bloomMax: 0.07, recover: 0.16, speed: 1900, move: 0.88, auto: true,
    optics: ALL_OPT, snd: [0.85, 0.1, 0.65],
  },
  l34: {
    name: 'L-34', kind: '분대지원화기', desc: '150발 벨트. 빠르게 긁지만 오래 쏘면 흩어진다.',
    dmg: 21, dmgFar: 16, near: 300, far: 800, range: 1300, rpm: 840, mag: 150, mags: 2, reload: 5.4,
    hip: 0.07, ads: 0.02, bloom: 0.0035, bloomMax: 0.07, recover: 0.15, speed: 1850, move: 0.86, auto: true,
    optics: ALL_OPT, snd: [1.0, 0.08, 0.55],
  },
  d14: {
    name: 'D-14', kind: '지정사수소총', desc: '세 발이면 쓰러뜨린다. 정확한 반자동.',
    dmg: 45, dmgFar: 38, near: 500, far: 1150, range: 1650, rpm: 320, mag: 15, mags: 6, reload: 2.4,
    hip: 0.05, ads: 0.006, bloom: 0.014, bloomMax: 0.06, recover: 0.3, speed: 2400, move: 0.97, auto: false,
    optics: LONG_OPT, snd: [0.75, 0.14, 0.75],
  },
  b50: {
    name: 'B-50', kind: '대물저격소총', desc: '가까운 거리에서는 한 발에 쓰러뜨린다. 노리는 동안 렌즈가 번쩍인다.',
    dmg: 110, dmgFar: 88, near: 700, far: 1500, range: 2100, rpm: 42, mag: 5, mags: 6, reload: 3.0,
    hip: 0.09, ads: 0.0025, bloom: 0.05, bloomMax: 0.1, recover: 0.35, speed: 3000, move: 0.92, auto: false,
    optics: LONG_OPT, snd: [0.55, 0.3, 1],
  },
  b7: {
    name: 'B-7', kind: '경저격소총', desc: '두 발에 쓰러뜨리지만 빠르게 다음 발을 쏜다.',
    dmg: 75, dmgFar: 60, near: 600, far: 1300, range: 1800, rpm: 75, mag: 8, mags: 6, reload: 2.6,
    hip: 0.07, ads: 0.004, bloom: 0.03, bloomMax: 0.08, recover: 0.35, speed: 2700, move: 0.96, auto: false,
    optics: LONG_OPT, snd: [0.65, 0.22, 0.85],
  },
};

export interface OpticDef { name: string; desc: string; look: number; ads: number }
export const OPTICS: Record<Optic, OpticDef> = {
  iron: { name: '기본 가늠쇠', desc: '정조준해도 시야가 조금만 앞으로 간다.', look: 150, ads: 1 },
  dot: { name: '반사 조준경', desc: '정조준 시야 조금 더 멀리, 탄 퍼짐 -10%.', look: 220, ads: 0.9 },
  x2: { name: '2배 조준경', desc: '정조준 시야가 멀리 간다. 탄 퍼짐 -25%. 정조준 중 조금 느리다.', look: 380, ads: 0.75 },
  x6: { name: '6배 저격 조준경', desc: '아주 멀리 본다. 탄 퍼짐 -50%. 정조준 중 렌즈가 번쩍여 위치가 드러난다.', look: 720, ads: 0.5 },
};
export const MUZZLES: Record<Muzzle, { name: string; desc: string }> = {
  none: { name: '없음', desc: '기본.' },
  supp: { name: '소음기', desc: '쏴도 적 지도에 드러나지 않고 소리가 작다. 먼 거리 피해 -10%.' },
  comp: { name: '보정기', desc: '연사할 때 탄이 덜 흩어진다(퍼짐 증가 -30%).' },
};
export const MAGS: Record<MagAtt, { name: string; desc: string }> = {
  std: { name: '기본 탄창', desc: '기본.' },
  ext: { name: '확장 탄창', desc: '탄창 +50%, 재장전 +20% 느림.' },
};
export const GRIPS: Record<Grip, { name: string; desc: string }> = {
  none: { name: '없음', desc: '기본.' },
  vert: { name: '수직 손잡이', desc: '정조준 없이 쏠 때 탄 퍼짐 -25%.' },
};

// ───────── 장비 ─────────

export interface GadgetDef {
  name: string;
  desc: string;
  /** aimed: 들고 쏜다, throw: 조준점에 던진다, deploy: 발밑에 놓는다, instant: 바로 쓴다, passive: 항상 적용 */
  use: 'aimed' | 'throw' | 'deploy' | 'instant' | 'passive';
  ammo: number;
  cd: number;
}

export const GADGETS: Record<GadgetId, GadgetDef> = {
  ugl: { name: '유탄 발사기', use: 'aimed', ammo: 4, cd: 0.9, desc: '조준한 곳에서 터진다. 벽을 뚫고 엄폐한 적을 날린다.' },
  smokegl: { name: '연막 유탄', use: 'aimed', ammo: 3, cd: 0.9, desc: '떨어진 곳에 15초간 시야를 가리는 연막을 친다.' },
  stim: { name: '아드레날린', use: 'instant', ammo: 0, cd: 22, desc: '체력 60을 바로 채우고 6초간 25% 빨라진다.' },
  plate: { name: '방탄판', use: 'passive', ammo: 0, cd: 0, desc: '항상 적용. 최대 체력 100 → 135.' },
  rpg: { name: '대전차 로켓', use: 'aimed', ammo: 4, cd: 1.2, desc: '전차와 헬기를 잡는다. 벽에 맞으면 구멍을 낸다. 전차는 뒤를 노리면 1.5배.' },
  aa: { name: '대공 미사일', use: 'aimed', ammo: 3, cd: 1.5, desc: '헬기를 1초 겨누면 잠기고, 쏘면 따라간다. 헬기는 섬광탄으로 피한다.' },
  repair: { name: '수리 토치', use: 'aimed', ammo: 0, cd: 0, desc: '아군 차량을 겨누고 쏘는 동안 고친다. 오래 쓰면 잠깐 식혀야 한다.' },
  mine: { name: '대전차 지뢰', use: 'deploy', ammo: 3, cd: 1, desc: '적 차량이 밟으면 크게 터진다. 보병은 밟아도 안 터진다.' },
  medbag: { name: '의무 가방', use: 'deploy', ammo: 0, cd: 15, desc: '내려놓으면 14초간 주변 아군의 체력을 채운다.' },
  ammobox: { name: '탄약 상자', use: 'deploy', ammo: 0, cd: 18, desc: '내려놓으면 주변 아군의 탄약과 장비를 채운다.' },
  smoke: { name: '연막탄', use: 'throw', ammo: 2, cd: 1, desc: '던진 곳에 15초간 시야를 가리는 연막을 친다.' },
  drone: { name: '정찰 드론', use: 'throw', ammo: 0, cd: 24, desc: '조준한 곳 위를 12초간 날며 넓은 범위의 적을 아군 모두에게 표시한다.' },
  sensor: { name: '동작 감지기', use: 'throw', ammo: 0, cd: 18, desc: '던진 곳 주변에서 움직이는 적을 20초간 표시한다. 건물 안도 잡는다.' },
  beacon: { name: '스폰 비컨', use: 'deploy', ammo: 0, cd: 30, desc: '놓은 곳에서 분대원이 다시 나올 수 있다. 한 번에 하나.' },
  claymore: { name: '대인 지뢰', use: 'deploy', ammo: 2, cd: 1, desc: '보는 방향으로 적 보병이 다가오면 터진다.' },
};

export const FRAG = { name: '수류탄', count: 2, fuse: 1.7, dmg: 115, r: 105, wall: 140, maxRange: 400 };

// ───────── 병과 ─────────

export interface ClassDef {
  name: string;
  short: string;
  role: string;
  trait: string;
  weapons: WeaponId[];
  gadgetsA: GadgetId[];
  gadgetsB: GadgetId[];
}

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: {
    name: '돌격병', short: '돌격', role: '앞장서서 거점을 뚫는다',
    trait: '체력이 3초 만에 차오르기 시작한다(다른 병과 5초).',
    weapons: ['ar27', 'kr9', 'ck4', 'sg12'], gadgetsA: ['ugl', 'smokegl'], gadgetsB: ['stim', 'plate'],
  },
  engineer: {
    name: '공병', short: '공병', role: '차량을 잡고 아군 차량을 고친다',
    trait: '내가 모는 차량은 스스로 천천히 고쳐진다.',
    weapons: ['v10', 'vx45', 'ck4', 'sg12'], gadgetsA: ['rpg', 'aa'], gadgetsB: ['repair', 'mine'],
  },
  medic: {
    name: '의무병', short: '의무', role: '쓰러진 아군을 일으키고 탄을 나눈다',
    trait: '어느 아군이든 1초 만에 일으키고, 일으킨 아군은 체력이 가득 찬다.',
    weapons: ['l60', 'l34', 'ar27'], gadgetsA: ['medbag'], gadgetsB: ['ammobox', 'smoke'],
  },
  recon: {
    name: '정찰병', short: '정찰', role: '멀리서 적을 찾아 표시한다',
    trait: '적 표시(Q)가 두 배 오래 가고 두 배 멀리 닿는다.',
    weapons: ['b50', 'b7', 'd14'], gadgetsA: ['drone', 'sensor'], gadgetsB: ['beacon', 'claymore'],
  },
};
export const CLASS_ORDER: ClassId[] = ['assault', 'engineer', 'medic', 'recon'];

export interface Kit {
  weapon: WeaponId;
  optic: Optic;
  muzzle: Muzzle;
  mag: MagAtt;
  grip: Grip;
  ga: GadgetId;
  gb: GadgetId;
}

export const DEFAULT_KITS: Record<ClassId, Kit> = {
  assault: { weapon: 'ar27', optic: 'dot', muzzle: 'comp', mag: 'std', grip: 'vert', ga: 'ugl', gb: 'stim' },
  engineer: { weapon: 'v10', optic: 'dot', muzzle: 'none', mag: 'ext', grip: 'vert', ga: 'rpg', gb: 'repair' },
  medic: { weapon: 'l60', optic: 'x2', muzzle: 'none', mag: 'std', grip: 'none', ga: 'medbag', gb: 'ammobox' },
  recon: { weapon: 'b50', optic: 'x6', muzzle: 'none', mag: 'std', grip: 'none', ga: 'drone', gb: 'beacon' },
};

/** 무기와 부착물을 합친 실제 수치 */
export interface WeaponStats extends WeaponDef {
  look: number;
  supp: boolean;
  scope: boolean;
}

export function weaponStats(k: Kit): WeaponStats {
  const w = WEAPONS[k.weapon];
  const o = OPTICS[w.optics.includes(k.optic) ? k.optic : 'iron'];
  const s: WeaponStats = { ...w, look: o.look, supp: k.muzzle === 'supp', scope: k.optic === 'x6' && w.optics.includes('x6') };
  s.ads *= o.ads;
  if (k.muzzle === 'supp') { s.dmgFar *= 0.9; s.range *= 0.92; }
  if (k.muzzle === 'comp') s.bloom *= 0.7;
  if (k.mag === 'ext') { s.mag = Math.round(s.mag * 1.5); s.reload *= 1.2; }
  if (k.grip === 'vert') s.hip *= 0.75;
  return s;
}

// ───────── 차량 ─────────

export interface VehicleDef {
  name: string;
  short: string;
  desc: string;
  hp: number;
  r: number;
  speed: number;
  reverse: number;
  turn: number;
  tturn: number;
  air: boolean;
  /** 맞는 탄 종류별 피해 배율: 총탄, 기관포, 로켓·포탄·유탄 */
  vsBullet: number;
  vsCannon: number;
  vsBlast: number;
  /** 앞, 옆, 뒤에서 맞을 때 배율 */
  armor: [number, number, number];
  seats: number;
  crush: 'heavy' | 'light' | 'none';
  respawn: number;
}

export const VEHICLES: Record<VehicleType, VehicleDef> = {
  tank: {
    name: '주력전차', short: '전차', desc: '주포로 차량과 건물을 부순다. 우클릭은 동축 기관총. 총으로는 흠집도 안 난다.',
    hp: 1100, r: 27, speed: 135, reverse: 75, turn: 1.4, tturn: 1.7, air: false,
    vsBullet: 0, vsCannon: 0.25, vsBlast: 1, armor: [0.65, 1, 1.5], seats: 2, crush: 'heavy', respawn: 55,
  },
  ifv: {
    name: '보병전투차', short: '장갑차', desc: '기관포로 보병과 경차량을 쓸고 분대 셋을 싣는다.',
    hp: 720, r: 24, speed: 185, reverse: 95, turn: 1.9, tturn: 2.4, air: false,
    vsBullet: 0.05, vsCannon: 0.6, vsBlast: 1.1, armor: [0.8, 1, 1.35], seats: 4, crush: 'heavy', respawn: 45,
  },
  jeep: {
    name: '기동차량', short: '기동차', desc: '빠르다. 뒷자리에 기관총 사수가 탄다.',
    hp: 380, r: 19, speed: 310, reverse: 120, turn: 2.6, tturn: 4, air: false,
    vsBullet: 0.35, vsCannon: 1.2, vsBlast: 1.5, armor: [1, 1, 1], seats: 4, crush: 'light', respawn: 25,
  },
  heli: {
    name: '공격헬기', short: '헬기', desc: '어디든 날아간다. 조종사는 로켓, 사수는 기관포. 대공 미사일은 섬광탄으로 피한다.',
    hp: 820, r: 26, speed: 330, reverse: 330, turn: 2.2, tturn: 3, air: true,
    vsBullet: 0.12, vsCannon: 1, vsBlast: 1.1, armor: [1, 1, 1], seats: 2, crush: 'none', respawn: 70,
  },
};

/** 차량 무기: 좌석별 */
export interface VWeapon { name: string; kind: 'shell' | 'cannon' | 'hmg' | 'rockets' | 'coax'; rpm: number; mag: number; reload: number; dmg: number; splash: number; splashR: number; wall: number; speed: number; spread: number; range: number }
export const VWEAPONS: Record<string, VWeapon> = {
  tankMain: { name: '120mm 주포', kind: 'shell', rpm: 20, mag: 1, reload: 3.1, dmg: 330, splash: 140, splashR: 110, wall: 420, speed: 1500, spread: 0.004, range: 1600 },
  tankCoax: { name: '동축 기관총', kind: 'coax', rpm: 700, mag: 200, reload: 4, dmg: 18, splash: 0, splashR: 0, wall: 0, speed: 1900, spread: 0.035, range: 1000 },
  tankHmg: { name: '12.7mm 기관총', kind: 'hmg', rpm: 520, mag: 100, reload: 4, dmg: 30, splash: 0, splashR: 0, wall: 6, speed: 2000, spread: 0.03, range: 1150 },
  ifvCannon: { name: '30mm 기관포', kind: 'cannon', rpm: 240, mag: 30, reload: 3.5, dmg: 42, splash: 28, splashR: 38, wall: 70, speed: 1700, spread: 0.012, range: 1300 },
  jeepHmg: { name: '12.7mm 기관총', kind: 'hmg', rpm: 520, mag: 100, reload: 4, dmg: 30, splash: 0, splashR: 0, wall: 6, speed: 2000, spread: 0.035, range: 1150 },
  heliRockets: { name: '로켓 포드', kind: 'rockets', rpm: 480, mag: 14, reload: 6, dmg: 85, splash: 60, splashR: 72, wall: 140, speed: 1100, spread: 0.03, range: 1200 },
  heliGun: { name: '30mm 기관포', kind: 'cannon', rpm: 420, mag: 60, reload: 3, dmg: 36, splash: 26, splashR: 36, wall: 50, speed: 1800, spread: 0.02, range: 1250 },
};
/** 좌석마다 쓰는 무기 (없으면 null). 우클릭 무기는 따로 */
export const SEAT_WEAPON: Record<VehicleType, (string | null)[]> = {
  tank: ['tankMain', 'tankHmg'],
  ifv: ['ifvCannon', null, null, null],
  jeep: [null, 'jeepHmg', null, null],
  heli: ['heliRockets', 'heliGun'],
};
export const SEAT_NAME: Record<VehicleType, string[]> = {
  tank: ['조종·주포', '기관총 사수'],
  ifv: ['조종·기관포', '탑승', '탑승', '탑승'],
  jeep: ['운전', '기관총 사수', '탑승', '탑승'],
  heli: ['조종·로켓', '기관포 사수'],
};

// ───────── 진영, 난이도, 규모 ─────────

export interface FactionDef { name: string; army: string; color: string; dark: string; light: string; names: string[] }
export const FACTIONS: Record<Side, FactionDef> = {
  us: {
    name: '미합중국', army: '미 북극사령부', color: '#4aa8ff', dark: '#173b5e', light: '#bfe0ff',
    names: ['존슨', '밀러', '데이비스', '가르시아', '로드리게스', '윌슨', '마르티네스', '앤더슨', '테일러', '토머스', '무어', '잭슨',
      '마틴', '톰프슨', '화이트', '해리스', '클라크', '루이스', '로빈슨', '워커', '영', '앨런', '킹', '라이트', '스콧', '그린',
      '베이커', '애덤스', '넬슨', '힐', '캠벨', '미첼'],
  },
  ru: {
    name: '러시아 연방', army: '러시아 극동군', color: '#ff5d4a', dark: '#5e1d16', light: '#ffc9bf',
    names: ['이바노프', '스미르노프', '쿠즈네초프', '포포프', '바실리예프', '페트로프', '소콜로프', '미하일로프', '노비코프',
      '페도로프', '모로조프', '볼코프', '알렉세예프', '레베데프', '세묘노프', '예고로프', '파블로프', '코즐로프', '스테파노프',
      '니콜라예프', '오를로프', '안드레예프', '마카로프', '니키틴', '자하로프', '자이체프', '솔로비요프', '보리소프',
      '야코블레프', '그리고리예프', '로마노프', '보로비요프'],
  },
};
export const SQUAD_NAMES = ['알파', '브라보', '찰리', '델타', '에코', '폭스트롯', '골프', '호텔', '인디아', '줄리엣', '킬로', '리마', '마이크', '노벰버', '오스카', '파파'];

export interface DiffDef { name: string; desc: string; react: number; err: number; taken: number; dealt: number; focus: number }
export const DIFFS: Record<Diff, DiffDef> = {
  easy: { name: '쉬움', desc: '적이 늦게 반응하고 잘 못 맞힌다. 받는 피해 절반.', react: 0.8, err: 0.16, taken: 0.5, dealt: 1.25, focus: 0.45 },
  normal: { name: '보통', desc: '적과 아군 봇의 실력이 같다. 받는 피해 -25%.', react: 0.5, err: 0.1, taken: 0.75, dealt: 1.1, focus: 0.8 },
  hard: { name: '어려움', desc: '적이 빠르고 정확하다. 보정 없음.', react: 0.3, err: 0.065, taken: 1, dealt: 1, focus: 1 },
};
/** 아군 봇의 실력 */
export const ALLY_SKILL = { react: 0.5, err: 0.1 };

export interface SizeDef { name: string; team: number; tickets: number; vehicles: VehicleType[] }
export const SIZES: Record<SizeId, SizeDef> = {
  small: { name: '16 대 16', team: 16, tickets: 250, vehicles: ['tank', 'ifv', 'jeep', 'jeep'] },
  medium: { name: '32 대 32', team: 32, tickets: 360, vehicles: ['tank', 'tank', 'ifv', 'jeep', 'jeep', 'heli'] },
  large: { name: '64 대 64', team: 64, tickets: 620, vehicles: ['tank', 'tank', 'tank', 'ifv', 'ifv', 'jeep', 'jeep', 'jeep', 'heli', 'heli'] },
};

// ───────── 전장 ─────────

export type SiteKind = 'town' | 'village' | 'industrial' | 'port' | 'radar' | 'farm' | 'bridge';
export type Theme = 'tundra' | 'snow' | 'industrial';

export interface MapDef {
  id: string;
  name: string;
  place: string;
  desc: string;
  w: number;
  h: number;
  seed: number;
  theme: Theme;
  coast: 'n' | 's' | '';
  /** 남북으로 흐르는 강과 다리 위치(v) */
  river: number[] | null;
  lake?: { u: number; v: number; r: number };
  forest: number;
  flags: { u: number; v: number; name: string; site: SiteKind }[];
  size: SizeId;
}

export const MAPS: MapDef[] = [
  {
    id: 'uelen', name: '우엘렌 해안', place: '추코트카 동단', seed: 3101, theme: 'tundra', coast: 'n', river: null, forest: 0.35,
    desc: '북쪽 바다를 낀 어촌. 항구의 컨테이너 사이와 마을 골목에서 보병전이 벌어지고, 남쪽 들판은 전차가 달린다.',
    w: 5600, h: 3700, size: 'medium',
    flags: [
      { u: 0.24, v: 0.3, name: '항구', site: 'port' },
      { u: 0.5, v: 0.38, name: '우엘렌 마을', site: 'town' },
      { u: 0.76, v: 0.3, name: '등대 관측소', site: 'radar' },
      { u: 0.3, v: 0.76, name: '순록 농장', site: 'farm' },
      { u: 0.7, v: 0.76, name: '통신 중계소', site: 'industrial' },
    ],
  },
  {
    id: 'amguema', name: '암구에마 강', place: '암구에마 강 유역', seed: 3202, theme: 'tundra', coast: '', river: [0.18, 0.5, 0.82], forest: 0.45,
    desc: '전장 한가운데를 강이 가르고 다리는 셋뿐이다. 다리를 쥔 쪽이 강을 건넌다.',
    w: 7200, h: 4700, size: 'large',
    flags: [
      { u: 0.17, v: 0.52, name: '서쪽 마을', site: 'town' },
      { u: 0.28, v: 0.17, name: '벌목장', site: 'farm' },
      { u: 0.5, v: 0.18, name: '북쪽 다리', site: 'bridge' },
      { u: 0.5, v: 0.5, name: '다리 마을', site: 'village' },
      { u: 0.5, v: 0.82, name: '남쪽 다리', site: 'bridge' },
      { u: 0.72, v: 0.83, name: '기상 관측소', site: 'radar' },
      { u: 0.83, v: 0.48, name: '정유 시설', site: 'industrial' },
    ],
  },
  {
    id: 'kanchalan', name: '칸차란 정유 단지', place: '아나디리 만 남안', seed: 3303, theme: 'industrial', coast: 's', river: null, forest: 0.15,
    desc: '창고와 컨테이너가 빽빽한 좁은 전장. 벽을 뚫고 들어가는 근접전이 쉴 새 없다.',
    w: 4600, h: 3100, size: 'small',
    flags: [
      { u: 0.22, v: 0.3, name: '화물역', site: 'industrial' },
      { u: 0.5, v: 0.26, name: '저장 탱크', site: 'industrial' },
      { u: 0.78, v: 0.3, name: '제어동', site: 'radar' },
      { u: 0.3, v: 0.66, name: '노동자 숙소', site: 'village' },
      { u: 0.68, v: 0.68, name: '부두', site: 'port' },
    ],
  },
  {
    id: 'tundra', name: '추코트카 설원', place: '내륙 툰드라', seed: 3404, theme: 'snow', coast: '', river: null, forest: 0.6,
    lake: { u: 0.5, v: 0.84, r: 0.07 },
    desc: '눈 덮인 넓은 평원과 숲. 레이더 기지를 사이에 두고 전차와 헬기가 맞붙는다.',
    w: 7200, h: 4700, size: 'large',
    flags: [
      { u: 0.18, v: 0.24, name: '순록 목장', site: 'farm' },
      { u: 0.2, v: 0.74, name: '서쪽 촌락', site: 'village' },
      { u: 0.5, v: 0.16, name: '숲속 산장', site: 'village' },
      { u: 0.5, v: 0.5, name: '레이더 기지', site: 'radar' },
      { u: 0.5, v: 0.8, name: '얼음 호수', site: 'bridge' },
      { u: 0.8, v: 0.26, name: '동쪽 촌락', site: 'town' },
      { u: 0.82, v: 0.76, name: '송유관 펌프장', site: 'industrial' },
    ],
  },
];

export const LORE = '2147년, 얼음이 사라진 베링 해협. 북극 항로를 두고 미국과 러시아가 맞붙었다.';
