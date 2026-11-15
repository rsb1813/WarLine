// 부착물 정의: 7슬롯(조준경, 총구, 총열, 하부, 탄창, 탄약, 개머리판).
// mods 는 모두 곱셈 배율(기본 1), magAdd 만 덧셈. 어떤 무기에 달 수 있는지는 WeaponDef.slots 가 정한다.
import type { AttachmentDef, SlotId } from '../types';

export const SLOT_NAMES: Record<SlotId, string> = {
  optic: '조준경',
  muzzle: '총구',
  barrel: '총열',
  underbarrel: '하부',
  magazine: '탄창',
  ammo: '탄약',
  stock: '개머리판',
};

const list: AttachmentDef[] = [
  // ───────────── 조준경 ─────────────
  {
    id: 'iron', slot: 'optic', name: '기본 가늠자', desc: '총에 달린 기계식 가늠자와 가늠쇠.',
    mods: {}, zoom: 1, reticle: 'iron',
    pros: ['시야가 가장 넓다', '정조준이 가장 빠르다'], cons: ['먼 표적이 작게 보인다', '가늠쇠가 표적을 가린다'],
  },
  {
    id: 'rd_mini', slot: 'optic', name: 'RD-1 미니 도트', desc: '창이 없는 작은 반사식 조준경. 가볍고 깔끔하다.',
    mods: { adsTime: 1.02 }, zoom: 1, reticle: 'dot',
    pros: ['선명한 빨간 점', '거의 무게가 없다'], cons: ['배율 없음', '테두리가 얇아 반동 중 점을 잃기 쉽다'],
    model: { len: 0.05, size: 0.025, color: 0x1c1e21 },
  },
  {
    id: 'rd_tube', slot: 'optic', name: 'T-30 튜브 도트', desc: '원통형 도트 조준경. 점이 또렷해 연사 중에도 정확하다.',
    mods: { adsTime: 1.03, adsSpread: 0.96 }, zoom: 1, reticle: 'dot',
    pros: ['정조준 정확도 약간 증가', '점이 흔들려도 잘 보인다'], cons: ['정조준 약간 느림', '원통이 주변 시야를 가린다'],
    model: { len: 0.1, size: 0.032, color: 0x202326 },
  },
  {
    id: 'holo', slot: 'optic', name: 'HX-2 홀로그래픽', desc: '넓은 창의 홀로그램 조준경. 움직이면서 표적을 따라가기 좋다.',
    mods: { adsTime: 1.04, moveSpread: 0.94 }, zoom: 1, reticle: 'holo',
    pros: ['넓은 창으로 이동 중 조준이 쉽다', '이동 퍼짐 약간 감소'], cons: ['정조준 약간 느림', '배율 없음'],
    model: { len: 0.09, size: 0.045, color: 0x23262a },
  },
  {
    id: 'prism15', slot: 'optic', name: 'P-15 1.5배 프리즘', desc: '낮은 배율의 프리즘 조준경. 근거리 감각을 크게 잃지 않는다.',
    mods: { adsTime: 1.06, adsSpread: 0.92 }, zoom: 1.5, reticle: 'chevron',
    pros: ['1.5배 확대', '정조준 정확도 증가'], cons: ['정조준 느림', '시야가 약간 좁아진다'],
    model: { len: 0.1, size: 0.04, color: 0x24272b },
  },
  {
    id: 'prism25', slot: 'optic', name: 'P-25 2.5배 프리즘', desc: '중거리용 프리즘 조준경. 소총의 기본 짝.',
    mods: { adsTime: 1.09, adsSpread: 0.88, sway: 1.06 }, zoom: 2.5, reticle: 'chevron',
    pros: ['2.5배 확대', '정조준 정확도 증가'], cons: ['정조준 느림', '흔들림 약간 증가', '근거리에서 답답하다'],
    model: { len: 0.12, size: 0.042, color: 0x24272b },
  },
  {
    id: 'acog35', slot: 'optic', name: 'C-35 3.5배 전투 조준경', desc: '튼튼한 전투용 고정 배율 조준경. 중장거리 교전에 맞춘다.',
    mods: { adsTime: 1.13, adsSpread: 0.84, sway: 1.1, moveSpread: 1.05 }, zoom: 3.5, reticle: 'cross',
    pros: ['3.5배 확대', '정조준 정확도 크게 증가'], cons: ['정조준 느림', '흔들림 증가', '시야가 좁다'],
    model: { len: 0.14, size: 0.045, color: 0x2a2c2f },
  },
  {
    id: 'scope4', slot: 'optic', name: 'S-4 4배 조준경', desc: '경량 4배 조준경. 지정사수소총과 잘 맞는다.',
    mods: { adsTime: 1.15, adsSpread: 0.82, sway: 1.14, moveSpread: 1.06 }, zoom: 4, reticle: 'cross',
    pros: ['4배 확대', '정조준 정확도 크게 증가'], cons: ['정조준 느림', '흔들림 증가', '근거리 대응이 어렵다'],
    model: { len: 0.2, size: 0.05, color: 0x1e2023 },
  },
  {
    id: 'scope6', slot: 'optic', name: 'S-6 6배 조준경', desc: '중배율 저격 조준경. 빠른 재조준과 먼 시야 사이의 절충.',
    mods: { adsTime: 1.2, adsSpread: 0.78, sway: 1.2, moveSpread: 1.1 }, zoom: 6, reticle: 'mil',
    pros: ['6배 확대', '정조준 정확도 크게 증가'], cons: ['정조준 느림', '흔들림 증가', '이동 중 조준 불리'],
    model: { len: 0.26, size: 0.056, color: 0x1e2023 },
  },
  {
    id: 'scope8', slot: 'optic', name: 'L-8 8배 저격 조준경', desc: '장거리 저격 조준경. 밀 눈금으로 낙차를 잰다.',
    mods: { adsTime: 1.25, adsSpread: 0.74, sway: 1.28, moveSpread: 1.12 }, zoom: 8, reticle: 'mil',
    pros: ['8배 확대', '먼 표적도 또렷하다'], cons: ['정조준 매우 느림', '흔들림 크게 증가', '시야가 매우 좁다'],
    model: { len: 0.3, size: 0.062, color: 0x1b1d20 },
  },
  {
    id: 'scope10', slot: 'optic', name: 'L-10 10배 저격 조준경', desc: '최고 배율 조준경. 지도 끝의 표적을 노린다.',
    mods: { adsTime: 1.32, adsSpread: 0.7, sway: 1.38, moveSpread: 1.15 }, zoom: 10, reticle: 'mil',
    pros: ['10배 확대', '가장 먼 거리 저격'], cons: ['정조준 매우 느림', '흔들림 매우 큼', '가까운 적을 놓친다'],
    model: { len: 0.34, size: 0.068, color: 0x1b1d20 },
  },

  // ───────────── 총구 ─────────────
  {
    id: 'muz_none', slot: 'muzzle', name: '총구 없음', desc: '총구에 아무것도 달지 않는다.',
    mods: {}, pros: ['가볍다'], cons: ['반동 제어 도움 없음'],
  },
  {
    id: 'flash', slot: 'muzzle', name: 'FH-1 소염기', desc: '총구 화염을 흩어 연사 중 시야를 지킨다.',
    mods: { recoilV: 0.97, spreadPerShot: 0.92 },
    pros: ['연사 퍼짐 감소', '총구 화염이 줄어 시야가 맑다'], cons: ['반동 감소는 작다'],
    model: { len: 0.05, size: 0.022, color: 0x1f2124 },
  },
  {
    id: 'comp', slot: 'muzzle', name: 'CP-3 보정기', desc: '옆으로 가스를 뿜어 좌우 반동을 잡는다.',
    mods: { recoilH: 0.75, recoilV: 0.96, firstShot: 1.1, adsTime: 1.03 },
    pros: ['좌우 반동 크게 감소', '수직 반동 약간 감소'], cons: ['첫 발 반동 증가', '정조준 약간 느림'],
    model: { len: 0.06, size: 0.026, color: 0x2a2c30 },
  },
  {
    id: 'brake', slot: 'muzzle', name: 'MB-5 제퇴기', desc: '큰 포트로 가스를 뒤로 돌려 총이 들리는 힘을 줄인다.',
    mods: { recoilV: 0.82, firstShot: 0.88, recoilH: 1.08, hipSpread: 1.1 },
    pros: ['수직 반동 크게 감소', '첫 발이 안정된다'], cons: ['좌우 흔들림 증가', '허리 사격 퍼짐 증가'],
    model: { len: 0.07, size: 0.03, color: 0x2b2d31 },
  },
  {
    id: 'supp', slot: 'muzzle', name: 'SP-7 소음기', desc: '표준 소음기. 총성을 낮춰 적 미니맵에 잡히지 않는다.',
    mods: { velocity: 0.88, range: 0.85, recoilV: 0.95, adsTime: 1.06 }, suppressed: true,
    pros: ['사격해도 미니맵에 안 뜬다', '총성이 작다', '반동 약간 감소'], cons: ['탄속 감소', '유효 사거리 감소', '정조준 느림'],
    model: { len: 0.16, size: 0.032, color: 0x1d1f22 },
  },
  {
    id: 'supp_heavy', slot: 'muzzle', name: 'SP-12 중형 소음기', desc: '굵고 긴 소음기. 탄속 손실이 적고 반동도 잡지만 무겁다.',
    mods: { velocity: 0.96, range: 0.95, recoilV: 0.86, recoilH: 0.9, adsTime: 1.12, moveMul: 0.97, swap: 1.1 }, suppressed: true,
    pros: ['사격해도 미니맵에 안 뜬다', '반동 감소', '탄속·사거리 손실이 적다'], cons: ['정조준 느림', '교체 느림', '이동 속도 감소'],
    model: { len: 0.24, size: 0.04, color: 0x1a1c1f },
  },
  {
    id: 'choke', slot: 'muzzle', name: 'CK-2 산탄 조임쇠', desc: '산탄총 총구를 좁혀 산탄을 모은다.',
    mods: { hipSpread: 0.72, adsSpread: 0.7, range: 1.15, recoilV: 1.06 },
    pros: ['산탄이 좁게 모인다', '사거리 증가'], cons: ['반동 약간 증가', '아주 가까운 적은 빗나가기 쉽다'],
    model: { len: 0.05, size: 0.03, color: 0x2a2c30 },
  },

  // ───────────── 총열 ─────────────
  {
    id: 'bar_std', slot: 'barrel', name: '표준 총열', desc: '공장 출고 총열.',
    mods: {}, pros: ['균형 잡힌 성능'], cons: ['특별한 장점 없음'],
  },
  {
    id: 'bar_short', slot: 'barrel', name: '단축 총열', desc: '짧게 자른 총열. 좁은 실내에서 휘두르기 좋다.',
    mods: { adsTime: 0.9, moveMul: 1.03, swap: 0.9, velocity: 0.88, range: 0.85, recoilV: 1.08 },
    pros: ['정조준 빠름', '이동 속도 증가', '교체 빠름'], cons: ['탄속 감소', '사거리 감소', '수직 반동 증가'],
    model: { len: 0.7 },
  },
  {
    id: 'bar_long', slot: 'barrel', name: '장총열', desc: '긴 총열. 탄이 빠르고 멀리 간다.',
    mods: { velocity: 1.12, range: 1.18, adsSpread: 0.88, adsTime: 1.1, moveMul: 0.97, hipSpread: 1.1 },
    pros: ['탄속 증가', '사거리 증가', '정조준 정확도 증가'], cons: ['정조준 느림', '이동 속도 감소', '허리 사격 퍼짐 증가'],
    model: { len: 1.3 },
  },
  {
    id: 'bar_heavy', slot: 'barrel', name: '중총열', desc: '두꺼운 총열. 열에 강해 오래 쏴도 탄이 모인다.',
    mods: { recoilV: 0.88, recoilH: 0.86, spreadPerShot: 0.82, adsTime: 1.12, moveMul: 0.96, swap: 1.1 },
    pros: ['반동 감소', '연사 퍼짐 감소'], cons: ['정조준 느림', '이동 속도 감소', '교체 느림'],
    model: { len: 1.05, size: 1.4 },
  },
  {
    id: 'bar_fluted', slot: 'barrel', name: '경량 홈 총열', desc: '홈을 파서 무게를 덜어 낸 총열.',
    mods: { adsTime: 0.93, moveSpread: 0.82, swap: 0.92, spreadPerShot: 1.15, recoilV: 1.04 },
    pros: ['정조준 빠름', '이동 중 퍼짐 감소', '교체 빠름'], cons: ['빨리 달아올라 연사 퍼짐 증가', '반동 약간 증가'],
    model: { len: 1.0, size: 0.85 },
  },
  {
    id: 'bar_match', slot: 'barrel', name: '정밀 총열', desc: '공차를 줄인 경기용 총열. 정조준 사격이 바늘처럼 모인다.',
    mods: { adsSpread: 0.6, velocity: 1.06, headMul: 1.06, hipSpread: 1.2, adsTime: 1.06, recoilV: 1.05 },
    pros: ['정조준 정확도 크게 증가', '헤드샷 피해 증가', '탄속 증가'], cons: ['허리 사격 퍼짐 증가', '정조준 느림', '반동 약간 증가'],
    model: { len: 1.15, size: 1.1 },
  },

  // ───────────── 하부 ─────────────
  {
    id: 'ub_none', slot: 'underbarrel', name: '하부 없음', desc: '총열 아래를 비워 둔다.',
    mods: {}, pros: ['가볍다'], cons: ['반동 제어 도움 없음'],
  },
  {
    id: 'vgrip', slot: 'underbarrel', name: 'VG-1 수직 손잡이', desc: '곧게 선 앞손잡이. 총구가 들리는 것을 눌러 준다.',
    mods: { recoilV: 0.88, adsTime: 1.04 },
    pros: ['수직 반동 감소'], cons: ['정조준 약간 느림'],
    model: { len: 0.08, color: 0x24262a },
  },
  {
    id: 'agrip', slot: 'underbarrel', name: 'AG-2 경사 손잡이', desc: '비스듬한 앞손잡이. 총을 빠르게 어깨로 끌어올린다.',
    mods: { adsTime: 0.9, recoilH: 0.94, recoilV: 1.03 },
    pros: ['정조준 빠름', '좌우 반동 약간 감소'], cons: ['수직 반동 약간 증가'],
    model: { len: 0.07, color: 0x24262a },
  },
  {
    id: 'stubby', slot: 'underbarrel', name: 'SG-3 짧은 손잡이', desc: '짧고 뭉툭한 손잡이. 허리 사격과 이동 사격이 안정된다.',
    mods: { hipSpread: 0.85, moveSpread: 0.85, recoilH: 0.92, adsSpread: 1.08 },
    pros: ['허리 사격 정확도 증가', '이동 중 퍼짐 감소'], cons: ['정조준 정확도 감소'],
    model: { len: 0.045, color: 0x24262a },
  },
  {
    id: 'handstop', slot: 'underbarrel', name: 'HS-1 손멈춤쇠', desc: '손을 받쳐 주는 작은 턱. 첫 발과 반동 회복이 좋아진다.',
    mods: { firstShot: 0.85, recover: 1.15, adsTime: 0.97, recoilH: 1.08 },
    pros: ['첫 발 반동 감소', '반동 회복 빠름', '정조준 약간 빠름'], cons: ['좌우 반동 증가'],
    model: { len: 0.03, color: 0x24262a },
  },
  {
    id: 'laser', slot: 'underbarrel', name: 'LS-5 전술 레이저', desc: '총열 방향을 가리키는 레이저. 허리 사격이 크게 정확해진다.',
    mods: { hipSpread: 0.75, moveSpread: 0.9, adsTime: 1.02 }, laser: true,
    pros: ['허리 사격 정확도 크게 증가', '이동 중 퍼짐 감소'], cons: ['적에게 빛줄기가 보인다', '정조준 약간 느림'],
    model: { len: 0.06, color: 0x2a2c30 },
  },
  {
    id: 'light', slot: 'underbarrel', name: 'FL-2 전술 조명', desc: '강한 손전등. 어두운 실내와 그늘진 구석을 비춘다.',
    mods: { hipSpread: 0.92, swap: 1.03 }, flashlight: true,
    pros: ['어두운 건물 안이 밝아진다', '허리 사격 약간 증가'], cons: ['적에게 위치가 드러난다', '교체 약간 느림'],
    model: { len: 0.07, color: 0x2a2c30 },
  },
  {
    id: 'bipod', slot: 'underbarrel', name: 'BP-4 양각대', desc: '접이식 두 다리. 엎드리거나 앉아서 쏘면 반동이 크게 줄어든다.',
    mods: { adsTime: 1.1, moveMul: 0.97, swap: 1.08, sway: 0.9 }, bipod: true,
    pros: ['엎드리거나 앉으면 반동 크게 감소', '흔들림 감소'], cons: ['정조준 느림', '이동 속도 감소', '서서 쏘면 효과 없음'],
    model: { len: 0.16, color: 0x222428 },
  },

  // ───────────── 탄창 ─────────────
  {
    id: 'mag_std', slot: 'magazine', name: '표준 탄창', desc: '기본 탄창.',
    mods: {}, pros: ['균형 잡힌 장탄수'], cons: ['특별한 장점 없음'],
  },
  {
    id: 'mag_ext', slot: 'magazine', name: '확장 탄창', desc: '길게 늘린 탄창. 10발 더 넣는다.',
    mods: { magAdd: 10, reload: 1.12, adsTime: 1.04 },
    pros: ['장탄수 +10'], cons: ['재장전 느림', '정조준 약간 느림'],
    model: { len: 1.35 },
  },
  {
    id: 'mag_drum', slot: 'magazine', name: '드럼 탄창', desc: '둥근 대용량 탄창. 30발 더 넣지만 무겁다.',
    mods: { magAdd: 30, reload: 1.4, adsTime: 1.12, moveMul: 0.97, swap: 1.12 },
    pros: ['장탄수 +30'], cons: ['재장전 매우 느림', '정조준 느림', '이동 속도 감소'],
    model: { size: 1.6 },
  },
  {
    id: 'mag_fast', slot: 'magazine', name: '신속 탄창', desc: '당김 끈을 단 결속 탄창. 갈아 끼우기가 빠르다.',
    mods: { reload: 0.78, mag: 0.9 },
    pros: ['재장전 빠름'], cons: ['장탄수 10% 감소'],
    model: { len: 0.95 },
  },
  {
    id: 'mag_light', slot: 'magazine', name: '경량 단탄창', desc: '짧고 가벼운 탄창. 몸놀림이 가벼워진다.',
    mods: { magAdd: -10, reload: 0.88, adsTime: 0.94, moveMul: 1.02, swap: 0.94 },
    pros: ['정조준 빠름', '이동 속도 증가', '재장전 빠름'], cons: ['장탄수 -10'],
    model: { len: 0.7 },
  },
  {
    id: 'belt_ext', slot: 'magazine', name: '대용량 탄통', desc: '경기관총용 큰 탄통. 50발 더 들어간다.',
    mods: { magAdd: 50, reload: 1.25, adsTime: 1.08, moveMul: 0.96 },
    pros: ['장탄수 +50'], cons: ['재장전 느림', '정조준 느림', '이동 속도 감소'],
    model: { size: 1.4 },
  },
  {
    id: 'belt_light', slot: 'magazine', name: '경량 탄띠 상자', desc: '작은 탄띠 상자. 기관총을 소총처럼 다룬다.',
    mods: { magAdd: -40, reload: 0.8, adsTime: 0.9, moveMul: 1.03 },
    pros: ['재장전 빠름', '정조준 빠름', '이동 속도 증가'], cons: ['장탄수 -40'],
    model: { size: 0.7 },
  },
  {
    id: 'smag_ext', slot: 'magazine', name: '정밀 소총 확장 탄창', desc: '저격·지정사수 소총용 확장 탄창. 3발 더 넣는다.',
    mods: { magAdd: 3, reload: 1.1, adsTime: 1.03 },
    pros: ['장탄수 +3'], cons: ['재장전 느림', '정조준 약간 느림'],
    model: { len: 1.3 },
  },
  {
    id: 'tube_ext', slot: 'magazine', name: '산탄 확장 탄창', desc: '산탄총 관형 탄창을 늘리거나 큰 상자 탄창을 끼운다. 3발 더.',
    mods: { magAdd: 3, reload: 1.12, moveMul: 0.98 },
    pros: ['장탄수 +3'], cons: ['재장전 느림', '이동 속도 약간 감소'],
    model: { len: 1.3 },
  },
  {
    id: 'pmag_ext', slot: 'magazine', name: '권총 확장 탄창', desc: '손잡이 아래로 튀어나온 긴 권총 탄창.',
    mods: { magAdd: 8, reload: 1.1, adsTime: 1.05, swap: 1.05 },
    pros: ['장탄수 +8'], cons: ['재장전 느림', '꺼내기·정조준 약간 느림'],
    model: { len: 1.5 },
  },

  // ───────────── 탄약 ─────────────
  {
    id: 'fmj', slot: 'ammo', name: '보통탄', desc: '구리 피갑 표준탄.',
    mods: {}, ammoKind: 'fmj', pros: ['균형 잡힌 탄'], cons: ['특별한 장점 없음'],
  },
  {
    id: 'hp', slot: 'ammo', name: '할로포인트탄', desc: '맞으면 퍼지는 탄두. 가까운 보병에게 치명적이다.',
    mods: { dmg: 1.1, range: 0.75, velocity: 0.95 }, ammoKind: 'hp',
    pros: ['보병 피해 증가'], cons: ['피해가 더 일찍 떨어진다', '차량·엄폐물에 약하다', '탄속 약간 감소'],
  },
  {
    id: 'ap', slot: 'ammo', name: '철갑탄', desc: '강철 관통자 탄두. 차량과 얇은 벽에 강하다.',
    mods: { dmg: 0.94, velocity: 1.08, recoilV: 1.04 }, ammoKind: 'ap',
    pros: ['차량·엄폐물 관통 피해 증가', '탄속 증가', '얇은 나무·유리 관통'], cons: ['보병 피해 약간 감소', '반동 약간 증가'],
  },
  {
    id: 'sub', slot: 'ammo', name: '아음속탄', desc: '소리보다 느린 탄. 소음기와 함께 쓰면 총성이 거의 들리지 않는다.',
    mods: { velocity: 0.7, dmg: 0.92, range: 0.85, recoilV: 0.85 }, ammoKind: 'sub',
    pros: ['소음기와 함께 쓰면 미니맵에 전혀 안 뜬다', '반동 감소'], cons: ['탄속 크게 감소', '피해·사거리 감소'],
  },
  {
    id: 'tracer', slot: 'ammo', name: '예광탄', desc: '빛나는 꼬리를 남기는 탄. 탄도를 보며 고쳐 쏜다.',
    mods: { spreadPerShot: 0.9, recoilH: 0.95 }, ammoKind: 'tracer',
    pros: ['탄도가 보여 연사 보정이 쉽다', '연사 퍼짐 감소'], cons: ['적에게 사선이 드러난다'],
  },
  {
    id: 'match', slot: 'ammo', name: '정밀탄', desc: '무게를 맞춘 경기용 탄. 머리를 노리는 사수의 선택.',
    mods: { headMul: 1.1, adsSpread: 0.85, velocity: 1.04, dmg: 0.96 }, ammoKind: 'fmj',
    pros: ['헤드샷 배율 증가', '정조준 정확도 증가', '탄속 약간 증가'], cons: ['몸통 피해 약간 감소'],
  },
  {
    id: 'buck', slot: 'ammo', name: '벅샷', desc: '굵은 산탄 여러 알. 산탄총 기본탄.',
    mods: {}, ammoKind: 'fmj', pros: ['근거리 확실한 위력'], cons: ['거리가 벌어지면 급감'],
  },
  {
    id: 'slug', slot: 'ammo', name: '슬러그탄', desc: '한 덩어리 탄두. 산탄총을 짧은 소총처럼 쓴다.',
    mods: { recoilV: 1.15, velocity: 1.1 }, ammoKind: 'fmj',
    pros: ['한 발 고위력 탄두', '먼 거리까지 정확', '헤드샷 배율 증가'], cons: ['한 알뿐이라 빗나가기 쉽다', '반동 증가'],
  },
  {
    id: 'flechette', slot: 'ammo', name: '플레셰트탄', desc: '강철 화살 산탄. 멀리 날고 엄폐물을 뚫는다.',
    mods: { dmg: 0.85, range: 1.35, velocity: 1.2, hipSpread: 0.85, adsSpread: 0.85 }, ammoKind: 'ap',
    pros: ['사거리·탄속 증가', '산탄이 좁게 모인다', '엄폐물 관통'], cons: ['산탄 하나당 피해 감소'],
  },

  // ───────────── 개머리판 ─────────────
  {
    id: 'stock_std', slot: 'stock', name: '표준 개머리판', desc: '기본 개머리판.',
    mods: {}, pros: ['균형 잡힌 성능'], cons: ['특별한 장점 없음'],
  },
  {
    id: 'stock_light', slot: 'stock', name: '경량 골격 개머리판', desc: '뼈대만 남긴 가벼운 개머리판.',
    mods: { adsTime: 0.92, moveSpread: 0.85, moveMul: 1.02, recoilV: 1.08, sway: 1.1 },
    pros: ['정조준 빠름', '이동 중 퍼짐 감소', '이동 속도 증가'], cons: ['수직 반동 증가', '흔들림 증가'],
    model: { len: 0.85, size: 0.7 },
  },
  {
    id: 'stock_heavy', slot: 'stock', name: '안정화 개머리판', desc: '완충 장치가 든 무거운 개머리판.',
    mods: { recoilV: 0.9, sway: 0.8, recover: 1.12, adsTime: 1.1, moveMul: 0.97 },
    pros: ['반동 감소', '흔들림 감소', '반동 회복 빠름'], cons: ['정조준 느림', '이동 속도 감소'],
    model: { len: 1.1, size: 1.3 },
  },
  {
    id: 'stock_fold', slot: 'stock', name: '개머리판 접음', desc: '개머리판을 접어 총을 짧게 만든다.',
    mods: { adsTime: 0.82, swap: 0.8, moveMul: 1.04, hipSpread: 0.9, recoilV: 1.22, recoilH: 1.2, adsSpread: 1.25, sway: 1.25 },
    pros: ['정조준 매우 빠름', '교체 빠름', '이동 속도 증가', '허리 사격 약간 증가'], cons: ['반동 크게 증가', '정조준 정확도 감소', '흔들림 증가'],
    model: { len: 0.2 },
  },
  {
    id: 'stock_cheek', slot: 'stock', name: '볼받침 조절 개머리판', desc: '볼받침과 길이를 맞춘 정밀 사격용 개머리판.',
    mods: { sway: 0.72, adsSpread: 0.85, adsTime: 1.06, moveMul: 0.98 },
    pros: ['흔들림 크게 감소', '정조준 정확도 증가'], cons: ['정조준 약간 느림', '이동 속도 약간 감소'],
    model: { len: 1.05, size: 1.2 },
  },
  {
    id: 'stock_none', slot: 'stock', name: '개머리판 없음', desc: '권총 그대로 쓴다.',
    mods: {}, pros: ['가볍고 빠르다'], cons: ['반동 제어 도움 없음'],
  },
  {
    id: 'stock_brace', slot: 'stock', name: '권총 견착대', desc: '권총 뒤에 끼우는 접이식 견착대. 기관권총을 작은 기관단총처럼 쓴다.',
    mods: { recoilV: 0.78, recoilH: 0.8, adsSpread: 0.8, adsTime: 1.12, swap: 1.15, moveMul: 0.98 },
    pros: ['반동 크게 감소', '정조준 정확도 증가'], cons: ['정조준 느림', '꺼내기 느림', '이동 속도 약간 감소'],
    model: { len: 0.6, size: 0.8 },
  },
];

export const ATTACHMENTS: Record<string, AttachmentDef> = Object.fromEntries(list.map((a) => [a.id, a]));

/** 슬롯별 부착물 id (정의 순서) */
export const ATTACHMENT_IDS_BY_SLOT: Record<SlotId, string[]> = {
  optic: [], muzzle: [], barrel: [], underbarrel: [], magazine: [], ammo: [], stock: [],
};
for (const a of list) ATTACHMENT_IDS_BY_SLOT[a.slot].push(a.id);
