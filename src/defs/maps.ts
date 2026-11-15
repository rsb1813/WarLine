// 지도, 판 규모, 난이도 정의.
import type { Diff, DiffDef, MapDef, SizeDef, SizeId } from '../types';

export const MAPS: MapDef[] = [
  {
    id: 'uelen', name: '우엘렌 항구', place: '추코트카 동단 · 베링 해협 연안',
    desc: '얼어붙은 부두와 컨테이너 야적장, 언덕 위 어촌 골목이 이어진 해안 전장. 좁은 골목에서는 보병이, 해안 도로에서는 전차가 맞붙는다.',
    seed: 21471, size: 560,
    theme: 'snow', water: 'coast',
    town: 0.8, forest: 0.25, hills: 0.45,
    time: 'overcast',
  },
  {
    id: 'amguema', name: '암구에마 강', place: '추코트카 중부 · 암구에마 강 유역',
    desc: '툰드라를 가로지르는 강과 다리를 두고 다투는 전장. 강변 숲과 낮은 언덕이 엄폐를 주고, 다리를 잃으면 진격이 막힌다.',
    seed: 80337, size: 640,
    theme: 'tundra', water: 'river',
    town: 0.4, forest: 0.5, hills: 0.55,
    time: 'day',
  },
  {
    id: 'kanchalan', name: '칸차란 정유 단지', place: '아나디리 만 서쪽 · 칸차란',
    desc: '저장 탱크와 배관, 창고가 빽빽한 정유 시설. 시야가 짧아 근접전이 잦고, 무너지는 벽이 길을 바꾼다.',
    seed: 51219, size: 480,
    theme: 'industrial', water: 'none',
    town: 0.95, forest: 0.1, hills: 0.25,
    time: 'dusk',
  },
];

export const SIZES: Record<SizeId, SizeDef> = {
  small: { id: 'small', name: '16 대 16', perTeam: 16, tickets: 250, flags: 3, vehicles: ['mbt', 'ltv'] },
  medium: { id: 'medium', name: '32 대 32', perTeam: 32, tickets: 400, flags: 5, vehicles: ['mbt', 'ifv', 'ltv', 'ltv', 'heli'] },
  large: { id: 'large', name: '64 대 64', perTeam: 64, tickets: 650, flags: 7, vehicles: ['mbt', 'mbt', 'ifv', 'ifv', 'ltv', 'ltv', 'heli', 'heli'] },
};

/** aimErr 는 도 단위 (ai 가 DEG 를 곱해 쓴다). react 는 s */
export const DIFFS: Record<Diff, DiffDef> = {
  easy: {
    id: 'easy', name: '쉬움',
    desc: '적이 늦게 반응하고 조준이 부정확하다. 받는 피해가 줄고 주는 피해가 늘어난다.',
    react: 0.55, aimErr: 4.5, dmgTaken: 0.6, dmgDealt: 1.25,
  },
  normal: {
    id: 'normal', name: '보통',
    desc: '적이 제때 반응하고 그럭저럭 정확하게 쏜다. 피해는 그대로.',
    react: 0.35, aimErr: 2.6, dmgTaken: 1, dmgDealt: 1,
  },
  hard: {
    id: 'hard', name: '어려움',
    desc: '적이 빠르게 반응하고 정확하게 쏜다. 받는 피해가 늘고 주는 피해가 줄어든다.',
    react: 0.22, aimErr: 1.3, dmgTaken: 1.2, dmgDealt: 0.9,
  },
};

export const SIZE_IDS: SizeId[] = ['small', 'medium', 'large'];
export const DIFF_IDS: Diff[] = ['easy', 'normal', 'hard'];
