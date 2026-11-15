// 병과 정의: 돌격병, 공병, 지원병, 정찰병. 주무기는 모든 병과가 모든 분류를 쓸 수 있고,
// signature 분류를 들면 숙련 보너스(정조준 10% 빠름, 수직 반동 8% 감소, computeStats 가 반영)를 받는다.
import type { ClassDef, ClassId } from '../types';
import { THROWABLE_IDS } from './gadgets';

export const CLASS_IDS: ClassId[] = ['assault', 'engineer', 'support', 'recon'];

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: {
    id: 'assault', name: '돌격병', role: '거점 돌파 · 근접 교전',
    desc: '돌격소총과 유탄으로 거점에 가장 먼저 뛰어든다. 아드레날린으로 버티고, 접착 폭약으로 벽을 뚫어 새 길을 낸다.',
    trait: '체력이 더 일찍, 더 빨리 차오른다',
    icon: '돌',
    signature: ['ar'],
    gadgets: ['ugl', 'stim', 'breach'],
    throwables: THROWABLE_IDS.slice(),
    hp: 100,
  },
  engineer: {
    id: 'engineer', name: '공병', role: '대차량 · 차량 지원',
    desc: '대전차 로켓과 대공 미사일로 적 차량을 잡고, 수리 토치로 아군 차량을 살린다. 대전차 지뢰로 길목을 막는다.',
    trait: '직접 모는 차량이 천천히 저절로 수리된다',
    icon: '공',
    signature: ['smg', 'carbine'],
    gadgets: ['rocket', 'aa', 'repair', 'atmine'],
    throwables: THROWABLE_IDS.slice(),
    hp: 100,
  },
  support: {
    id: 'support', name: '지원병', role: '화력 지원 · 소생 · 보급',
    desc: '경기관총으로 적을 묶어 두고, 의료 상자와 탄약 상자로 분대를 먹여 살린다. 제세동기로 쓰러진 아군을 그 자리에서 일으킨다.',
    trait: '소생이 더 빠르고, 일으킨 아군의 체력을 가득 채운다',
    icon: '지',
    signature: ['lmg', 'shotgun'],
    gadgets: ['medbag', 'ammobag', 'defib', 'cover'],
    throwables: THROWABLE_IDS.slice(),
    hp: 100,
  },
  recon: {
    id: 'recon', name: '정찰병', role: '정찰 · 원거리 저격',
    desc: '드론과 동작 감지기로 적을 찾아 표시하고, 저격소총으로 먼 거리를 지배한다. 비컨으로 분대의 출현 지점을 만든다.',
    trait: '적을 표시하면 더 오래 보인다',
    icon: '정',
    signature: ['sniper', 'dmr'],
    gadgets: ['drone', 'sensor', 'beacon', 'claymore'],
    throwables: THROWABLE_IDS.slice(),
    hp: 100,
  },
};

/**
 * 병과 특성 수치 (sim 이 쓰고 싶으면 읽는다. 쓰지 않아도 규약 위반은 아님).
 * regenDelay: 피격 후 회복 시작까지 s, regenRate: 회복 hp/s, vehicleSelfRepair: 운전 중 자가 수리 hp/s,
 * reviveTime: 손으로 일으키는 데 걸리는 s, reviveHp: 일으킨 체력, spotMul: 표시 시간 배율
 */
export const CLASS_TRAITS: Record<ClassId, { regenDelay: number; regenRate: number; vehicleSelfRepair: number; reviveTime: number; reviveHp: number; spotMul: number }> = {
  assault: { regenDelay: 3.5, regenRate: 16, vehicleSelfRepair: 0, reviveTime: 2.5, reviveHp: 40, spotMul: 1 },
  engineer: { regenDelay: 5, regenRate: 10, vehicleSelfRepair: 6, reviveTime: 2.5, reviveHp: 40, spotMul: 1 },
  support: { regenDelay: 5, regenRate: 10, vehicleSelfRepair: 0, reviveTime: 1.0, reviveHp: 100, spotMul: 1 },
  recon: { regenDelay: 5, regenRate: 10, vehicleSelfRepair: 0, reviveTime: 2.5, reviveHp: 40, spotMul: 2 },
};
