// 장비 정의. id 는 GadgetKind 와 같다(장비 종류마다 하나). 변형(variants)의 params 키는 types.ts 의 GadgetKind 주석을 그대로 따른다.
// uses 0 = 횟수 제한 없음(수리 토치, 제세동기: 도구라서 횟수를 쓰지 않는다. HUD 는 ∞ 로 보여 준다).
import type { ClassId, GadgetDef } from '../types';

const ALL: ClassId[] = ['assault', 'engineer', 'support', 'recon'];

const list: GadgetDef[] = [
  // ───────────── 공병 ─────────────
  {
    id: 'rocket', name: 'RL-40 해머', kind: 'rocket', slot: 'gadget', classes: ['engineer'],
    desc: '어깨에 메는 무유도 로켓 발사기. 차량을 잡고 건물 벽에 구멍을 낸다. 탄이 무거워 멀리 쏘면 떨어진다.',
    uses: 4, cooldown: 3.2, icon: '로',
    variants: [
      { id: 'rk_heat', name: '대전차 고폭탄(HEAT)', desc: '성형 작약 탄두. 차량에 가장 큰 피해를 준다.', params: { velocity: 125, dmgVehicle: 380, dmgInfantry: 75, radius: 2.5, wallDmg: 260 } },
      { id: 'rk_he', name: '고폭 파편탄(HE)', desc: '넓게 터지는 탄두. 보병 무리와 벽에 강하다.', params: { velocity: 115, dmgVehicle: 260, dmgInfantry: 115, radius: 5, wallDmg: 520 } },
      { id: 'rk_tbx', name: '열압력탄', desc: '건물 안을 휩쓰는 폭풍. 벽을 무너뜨리지만 장갑에는 약하다.', params: { velocity: 110, dmgVehicle: 250, dmgInfantry: 130, radius: 6.5, wallDmg: 720 } },
    ],
  },
  {
    id: 'aa', name: 'AAM-7 스카이훅', kind: 'aa', slot: 'gadget', classes: ['engineer'],
    desc: '적외선 유도 대공 미사일. 헬기를 조준선 안에 붙잡아 고정한 뒤 쏜다. 플레어에 빗나간다.',
    uses: 3, cooldown: 4, icon: '공',
    variants: [
      { id: 'aa_std', name: '표준 탄두', desc: '고정 시간과 위력의 균형.', params: { lockTime: 1.8, dmgVehicle: 280, velocity: 95, range: 350 } },
      { id: 'aa_fast', name: '고속 추적', desc: '빨리 고정하고 빨리 날지만 탄두가 작다.', params: { lockTime: 1.2, dmgVehicle: 200, velocity: 125, range: 280 } },
      { id: 'aa_long', name: '장거리 탄두', desc: '멀리까지 쫓아가는 큰 탄두. 고정이 오래 걸린다.', params: { lockTime: 2.6, dmgVehicle: 340, velocity: 85, range: 480 } },
    ],
  },
  {
    id: 'repair', name: 'RT-3 수리 토치', kind: 'repair', slot: 'gadget', classes: ['engineer'],
    desc: '아군 차량에 대고 누르고 있으면 고친다. 너무 오래 쓰면 과열되어 잠시 식혀야 한다.',
    uses: 0, cooldown: 3, icon: '수',
    variants: [
      { id: 'rp_std', name: '표준 토치', desc: '수리 속도와 과열의 균형.', params: { rate: 45, heat: 6, range: 3 } },
      { id: 'rp_hot', name: '고열 토치', desc: '빨리 고치지만 금방 과열된다.', params: { rate: 70, heat: 3.5, range: 2.5 } },
      { id: 'rp_cool', name: '냉각 토치', desc: '느리지만 오래 쓸 수 있고 조금 더 멀리 닿는다.', params: { rate: 30, heat: 12, range: 3.5 } },
    ],
  },
  {
    id: 'atmine', name: 'AT-6 대전차 지뢰', kind: 'atmine', slot: 'gadget', classes: ['engineer'],
    desc: '바닥에 까는 압력 지뢰. 적 차량이 다가오면 터진다. 보병은 밟아도 터지지 않는다.',
    uses: 3, cooldown: 1, icon: '지',
    variants: [
      { id: 'mine_std', name: '표준 지뢰', desc: '감지 범위와 위력의 균형.', params: { dmgVehicle: 420, radius: 3 } },
      { id: 'mine_shaped', name: '성형 작약 지뢰', desc: '바로 위를 지나야 터지지만 매우 강하다.', params: { dmgVehicle: 540, radius: 1.8 } },
      { id: 'mine_wide', name: '광역 지뢰', desc: '넓게 감지하지만 위력이 약하다.', params: { dmgVehicle: 330, radius: 4.5 } },
    ],
  },

  // ───────────── 돌격병 ─────────────
  {
    id: 'ugl', name: 'GL-40 총열 하부 유탄 발사기', kind: 'ugl', slot: 'gadget', classes: ['assault'],
    desc: '소총 아래에 단 유탄 발사기. 포물선으로 날아가 부딪히면 터진다.',
    uses: 4, cooldown: 2.5, icon: '유',
    variants: [
      { id: 'ugl_he', name: '고폭 유탄', desc: '창문과 엄폐물 뒤의 적을 날린다.', params: { velocity: 75, dmg: 100, radius: 4.5, wallDmg: 200, smoke: 0 } },
      { id: 'ugl_smoke', name: '연막 유탄', desc: '멀리 연막을 친다. 피해는 없다.', params: { velocity: 70, dmg: 0, radius: 9, wallDmg: 0, smoke: 1 } },
      { id: 'ugl_frag', name: '근접 파편 유탄', desc: '더 빠르고 곧게 날아가 좁게 터진다. 벽에는 약하다.', params: { velocity: 105, dmg: 85, radius: 2.5, wallDmg: 60, smoke: 0 } },
    ],
  },
  {
    id: 'stim', name: 'ST-2 아드레날린', kind: 'stim', slot: 'gadget', classes: ['assault'],
    desc: '스스로 놓는 전투 주사. 체력을 채우고 잠깐 더 빨리 달린다.',
    uses: 2, cooldown: 10, icon: '아',
    variants: [
      { id: 'stim_std', name: '표준 주사', desc: '회복과 가속의 균형.', params: { heal: 60, speedMul: 1.12, duration: 6 } },
      { id: 'stim_rush', name: '돌진 주사', desc: '회복은 적지만 오래, 크게 빨라진다.', params: { heal: 25, speedMul: 1.25, duration: 8 } },
      { id: 'stim_med', name: '회복 주사', desc: '체력을 가득 채우고 가속은 거의 없다.', params: { heal: 100, speedMul: 1.04, duration: 3 } },
    ],
  },
  {
    id: 'breach', name: 'BX-4 접착 폭약', kind: 'breach', slot: 'gadget', classes: ['assault'],
    desc: '벽이나 차량에 던져 붙이고, 다시 눌러 터뜨린다. 벽을 뚫어 새 길을 낸다.',
    uses: 2, cooldown: 1.5, icon: '폭',
    variants: [
      { id: 'br_c4', name: '표준 폭약', desc: '벽, 보병, 차량 모두에 쓸 만하다.', params: { dmg: 160, radius: 5, wallDmg: 900, dmgVehicle: 420 } },
      { id: 'br_cut', name: '절단 폭약', desc: '벽을 확실히 끊어 내지만 사람과 차량에는 약하다.', params: { dmg: 80, radius: 3, wallDmg: 1600, dmgVehicle: 200 } },
      { id: 'br_vehicle', name: '대장갑 폭약', desc: '장갑을 녹이는 집중 장약. 폭발 범위가 좁다.', params: { dmg: 110, radius: 3.5, wallDmg: 500, dmgVehicle: 560 } },
    ],
  },

  // ───────────── 지원병 ─────────────
  {
    id: 'medbag', name: 'MK-1 의료 상자', kind: 'medbag', slot: 'gadget', classes: ['support'],
    desc: '바닥에 내려놓으면 둘레의 아군 체력을 계속 채운다.',
    uses: 2, cooldown: 15, icon: '의',
    variants: [
      { id: 'mb_large', name: '대형 의료 상자', desc: '넓게, 오래 천천히 회복한다.', params: { healPerSec: 6, radius: 4, life: 40 } },
      { id: 'mb_small', name: '소형 응급 키트', desc: '좁고 짧지만 빠르게 회복한다.', params: { healPerSec: 14, radius: 2.5, life: 18 } },
    ],
  },
  {
    id: 'ammobag', name: 'AB-2 탄약 상자', kind: 'ammobag', slot: 'gadget', classes: ['support'],
    desc: '바닥에 내려놓으면 둘레의 아군 탄약과 장비를 채운다.',
    uses: 2, cooldown: 15, icon: '탄',
    variants: [
      { id: 'ab_large', name: '대형 탄약 상자', desc: '넓게, 오래 천천히 보급한다.', params: { magsPerSec: 0.25, radius: 4, life: 45 } },
      { id: 'ab_small', name: '소형 탄약 팩', desc: '좁고 짧지만 빠르게 보급한다.', params: { magsPerSec: 0.6, radius: 2.5, life: 18 } },
    ],
  },
  {
    id: 'defib', name: 'DF-5 제세동기', kind: 'defib', slot: 'gadget', classes: ['support'],
    desc: '쓰러진 아군에게 대고 쏘면 그 자리에서 일으킨다.',
    uses: 0, cooldown: 1.5, icon: '제',
    variants: [
      { id: 'df_std', name: '표준 충전', desc: '소생 시간과 체력의 균형.', params: { reviveTime: 0.8, hp: 60, range: 2.5 } },
      { id: 'df_full', name: '고출력 충전', desc: '충전이 길지만 체력을 가득 채워 일으킨다.', params: { reviveTime: 1.6, hp: 100, range: 2.5 } },
      { id: 'df_quick', name: '신속 충전', desc: '눈 깜짝할 새 일으키지만 체력이 적다.', params: { reviveTime: 0.4, hp: 35, range: 2 } },
    ],
  },
  {
    id: 'cover', name: 'CB-1 이동식 방벽', kind: 'cover', slot: 'gadget', classes: ['support'],
    desc: '펼치면 허리 높이 방탄 방벽이 선다. 탁 트인 거점에 엄폐물을 만든다.',
    uses: 2, cooldown: 10, icon: '벽',
    variants: [
      { id: 'cv_std', name: '표준 방벽', desc: '폭과 내구도의 균형.', params: { width: 2.4, hp: 600 } },
      { id: 'cv_wide', name: '광폭 방벽', desc: '분대가 함께 숨을 만큼 넓지만 약하다.', params: { width: 4, hp: 450 } },
      { id: 'cv_heavy', name: '강화 방벽', desc: '좁지만 매우 단단하다.', params: { width: 1.8, hp: 1000 } },
    ],
  },

  // ───────────── 정찰병 ─────────────
  {
    id: 'drone', name: 'UAV-3 바다제비', kind: 'drone', slot: 'gadget', classes: ['recon'],
    desc: '조준한 지점 위로 날아가 맴돌며 주변 적을 계속 표시하는 정찰 드론.',
    uses: 1, cooldown: 30, icon: '드',
    variants: [
      { id: 'dr_recon', name: '정찰형', desc: '표시 범위와 비행 시간의 균형.', params: { duration: 25, spotRadius: 35, speed: 18 } },
      { id: 'dr_long', name: '장기 체공형', desc: '오래 떠 있지만 좁게 본다.', params: { duration: 45, spotRadius: 25, speed: 14 } },
      { id: 'dr_fast', name: '고속 탐지형', desc: '빨리 도착해 넓게 보지만 금방 돌아온다.', params: { duration: 15, spotRadius: 45, speed: 26 } },
    ],
  },
  {
    id: 'sensor', name: 'MS-2 동작 감지기', kind: 'sensor', slot: 'gadget', classes: ['recon'],
    desc: '던져 두면 둘레에서 움직이는 적을 아군 지도에 표시한다.',
    uses: 2, cooldown: 8, icon: '감',
    variants: [
      { id: 'sn_std', name: '표준 감지기', desc: '범위와 수명의 균형.', params: { radius: 18, life: 60 } },
      { id: 'sn_wide', name: '광역 감지기', desc: '넓게 감지하지만 배터리가 빨리 닳는다.', params: { radius: 28, life: 35 } },
      { id: 'sn_long', name: '장기 감지기', desc: '좁지만 아주 오래 버틴다.', params: { radius: 12, life: 120 } },
    ],
  },
  {
    id: 'beacon', name: 'SB-1 분대 비컨', kind: 'beacon', slot: 'gadget', classes: ['recon'],
    desc: '설치하면 분대원이 그 자리에서 출현할 수 있다. 적이 부수면 사라진다.',
    uses: 1, cooldown: 20, icon: '비',
    variants: [
      { id: 'bc_std', name: '표준 비컨', desc: '3분 동안 출현 지점이 된다.', params: { life: 180 } },
      { id: 'bc_ext', name: '대용량 배터리 비컨', desc: '5분 동안 출현 지점이 된다.', params: { life: 300 } },
    ],
  },
  {
    id: 'claymore', name: 'DFM-9 지향성 지뢰', kind: 'claymore', slot: 'gadget', classes: ['recon'],
    desc: '바라보는 방향으로 세워 둔다. 앞쪽 부채꼴로 적 보병이 들어오면 쇠구슬을 쏟아 낸다.',
    uses: 2, cooldown: 3, icon: '클',
    variants: [
      { id: 'cm_std', name: '표준 지향성 지뢰', desc: '감지 거리와 위력의 균형.', params: { dmg: 140, radius: 5, range: 4 } },
      { id: 'cm_wide', name: '광각 지향성 지뢰', desc: '멀리, 넓게 감지하지만 위력이 약하다.', params: { dmg: 100, radius: 6.5, range: 5.5 } },
      { id: 'cm_focus', name: '집중 지향성 지뢰', desc: '바로 앞만 지키지만 확실히 쓰러뜨린다.', params: { dmg: 200, radius: 3.5, range: 3 } },
    ],
  },

  // ───────────── 투척 (전 병과) ─────────────
  {
    id: 'frag', name: 'G-17 파편 수류탄', kind: 'frag', slot: 'throwable', classes: ALL,
    desc: '던지고 신관 시간이 지나면 터진다. 엄폐물 뒤의 적을 몰아낸다.',
    uses: 2, cooldown: 1, icon: '파',
    variants: [
      { id: 'fr_std', name: '표준 신관', desc: '2.5초 뒤 터진다.', params: { dmg: 110, radius: 6, fuse: 2.5, wallDmg: 120 } },
      { id: 'fr_short', name: '단신관', desc: '1.4초 만에 터져 피할 틈이 적다. 범위가 약간 좁다.', params: { dmg: 100, radius: 5.5, fuse: 1.4, wallDmg: 100 } },
      { id: 'fr_cluster', name: '집속 파편', desc: '넓게 흩어지는 파편. 한 사람에게 주는 피해는 적다.', params: { dmg: 80, radius: 8, fuse: 3, wallDmg: 80 } },
    ],
  },
  {
    id: 'smoke', name: 'SM-8 연막탄', kind: 'smoke', slot: 'throwable', classes: ALL,
    desc: '짙은 연막을 피워 시야를 가린다. 탁 트인 곳을 건너거나 소생할 때 쓴다.',
    uses: 2, cooldown: 1, icon: '연',
    variants: [
      { id: 'sm_std', name: '표준 연막', desc: '9m 연막이 25초 간다.', params: { radius: 9, life: 25 } },
      { id: 'sm_wide', name: '광역 연막', desc: '넓지만 금방 걷힌다.', params: { radius: 13, life: 15 } },
      { id: 'sm_long', name: '지속 연막', desc: '좁지만 오래 남는다.', params: { radius: 7, life: 40 } },
    ],
  },
  {
    id: 'flash', name: 'FB-3 섬광탄', kind: 'flash', slot: 'throwable', classes: ALL,
    desc: '강한 빛과 소리로 바라보던 적의 눈을 멀게 한다. 방에 들어가기 전에 던진다.',
    uses: 2, cooldown: 1, icon: '섬',
    variants: [
      { id: 'fl_std', name: '표준 섬광', desc: '범위와 실명 시간의 균형.', params: { radius: 10, blind: 3.5 } },
      { id: 'fl_wide', name: '광역 섬광', desc: '넓지만 짧게 눈을 멀게 한다.', params: { radius: 15, blind: 2 } },
      { id: 'fl_intense', name: '고강도 섬광', desc: '좁지만 오래 눈을 멀게 한다.', params: { radius: 7, blind: 5.5 } },
    ],
  },
  {
    id: 'incendiary', name: 'IN-5 소이탄', kind: 'incendiary', slot: 'throwable', classes: ALL,
    desc: '터진 자리에 불을 깐다. 길목을 막고 숨은 적을 몰아낸다.',
    uses: 2, cooldown: 1, icon: '화',
    variants: [
      { id: 'in_std', name: '표준 소이', desc: '범위와 지속의 균형.', params: { dps: 22, radius: 4.5, life: 9 } },
      { id: 'in_wide', name: '광역 소이', desc: '넓게 번지지만 약하고 빨리 꺼진다.', params: { dps: 14, radius: 6.5, life: 7 } },
      { id: 'in_long', name: '지속 소이', desc: '좁지만 오래 탄다.', params: { dps: 18, radius: 3.5, life: 16 } },
    ],
  },
  {
    id: 'impact', name: 'IG-2 충격 수류탄', kind: 'impact', slot: 'throwable', classes: ALL,
    desc: '어디든 부딪히는 순간 터진다. 파편 수류탄보다 범위가 좁다.',
    uses: 2, cooldown: 1, icon: '충',
    variants: [
      { id: 'im_std', name: '표준 충격', desc: '부딪히면 바로 터진다.', params: { dmg: 90, radius: 4.5, fuse: 0, wallDmg: 100 } },
      { id: 'im_heavy', name: '중장약 충격', desc: '좁지만 벽에 큰 피해를 준다.', params: { dmg: 105, radius: 3.5, fuse: 0, wallDmg: 240 } },
      { id: 'im_light', name: '경량 충격', desc: '조금 더 넓게 터지지만 피해가 적다.', params: { dmg: 70, radius: 5, fuse: 0, wallDmg: 70 } },
    ],
  },
];

export const GADGETS: Record<string, GadgetDef> = Object.fromEntries(list.map((g) => [g.id, g]));
export const GADGET_IDS: string[] = list.filter((g) => g.slot === 'gadget').map((g) => g.id);
export const THROWABLE_IDS: string[] = list.filter((g) => g.slot === 'throwable').map((g) => g.id);

/** 장비 변형 찾기 (없으면 첫 번째 변형) */
export function gadgetVariant(gadgetId: string, variantId: string): { def: GadgetDef; variant: GadgetDef['variants'][number] } | null {
  const def = GADGETS[gadgetId];
  if (!def) return null;
  const variant = def.variants.find((v) => v.id === variantId) ?? def.variants[0];
  return { def, variant };
}
