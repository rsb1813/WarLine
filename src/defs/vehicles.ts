// 차량과 차량 무기 정의. 두 진영이 같은 차체 수치를 쓴다(모양·색은 렌더가 진영별로 입힌다).
// 좌석 offset: 차체 기준 x 오른쪽, y 위(차체 바닥 기준), z 앞이 -. 차량 무기 spread 는 도 단위.
import type { VehicleDef, VehicleType, VWeaponDef } from '../types';

export const VWEAPONS: Record<string, VWeaponDef> = {
  cannon120: {
    id: 'cannon120', name: '120mm 활강포', kind: 'cannon',
    rpm: 13, dmg: 120, dmgVehicle: 380, radius: 4, wallDmg: 900,
    velocity: 380, mag: 1, reload: 4.5, spread: 0.12,
  },
  mbt_mg: {
    id: 'mbt_mg', name: '7.62mm 전차장 기관총', kind: 'mg',
    rpm: 650, dmg: 22, dmgVehicle: 4, radius: 0, wallDmg: 8,
    velocity: 850, mag: 100, reload: 4, spread: 0.6,
  },
  ac30: {
    id: 'ac30', name: '30mm 기관포', kind: 'autocannon',
    rpm: 200, dmg: 45, dmgVehicle: 45, radius: 1.8, wallDmg: 120,
    velocity: 700, mag: 30, reload: 3.5, spread: 0.35,
  },
  atgm: {
    id: 'atgm', name: '대전차 유도미사일', kind: 'atgm',
    rpm: 20, dmg: 100, dmgVehicle: 400, radius: 3, wallDmg: 500,
    velocity: 110, mag: 2, reload: 8, spread: 0,
  },
  ltv_mg: {
    id: 'ltv_mg', name: '12.7mm 중기관총', kind: 'mg',
    rpm: 500, dmg: 34, dmgVehicle: 10, radius: 0, wallDmg: 25,
    velocity: 880, mag: 100, reload: 5, spread: 0.7,
  },
  heli_rockets: {
    id: 'heli_rockets', name: '70mm 로켓 포드', kind: 'rockets',
    rpm: 240, dmg: 85, dmgVehicle: 130, radius: 4, wallDmg: 250,
    velocity: 180, mag: 14, reload: 6, spread: 1.2,
  },
  heli_gun: {
    id: 'heli_gun', name: '25mm 기수 기관포', kind: 'autocannon',
    rpm: 450, dmg: 38, dmgVehicle: 30, radius: 1.5, wallDmg: 80,
    velocity: 900, mag: 60, reload: 4, spread: 0.8,
  },
};

export const VEHICLES: Record<VehicleType, VehicleDef> = {
  mbt: {
    type: 'mbt', name: '주력전차', short: '전차',
    desc: '두꺼운 앞 장갑과 120mm 주포를 갖춘 전선의 주인. 옆과 뒤가 약하니 보병과 함께 움직여야 한다.',
    hp: 1200, speed: 14, reverse: 6, accel: 4,
    turn: 0.8, turretTurn: 0.85, air: false,
    size: { x: 3.7, y: 2.4, z: 7.8 },
    armor: { front: 0.5, side: 0.8, rear: 1.2, top: 1.0 },
    seats: [
      { name: '운전수 · 주포', weapon: 'cannon120', offset: { x: 0, y: 2.3, z: 0.4 }, turret: true, exposed: false },
      { name: '전차장 기관총', weapon: 'mbt_mg', offset: { x: 0.7, y: 2.75, z: 0.7 }, turret: false, exposed: true },
    ],
    respawn: 55,
    counter: 'smoke',
  },
  ifv: {
    type: 'ifv', name: '보병전투차', short: '장갑차',
    desc: '30mm 기관포와 대전차 미사일을 얹은 장갑차. 분대를 태우고 거점까지 데려다준다.',
    hp: 800, speed: 17, reverse: 7, accel: 5,
    turn: 1.0, turretTurn: 1.3, air: false,
    size: { x: 3.3, y: 2.7, z: 6.9 },
    armor: { front: 0.65, side: 0.9, rear: 1.2, top: 1.1 },
    seats: [
      { name: '운전수 · 기관포', weapon: 'ac30', offset: { x: 0, y: 2.4, z: -0.2 }, turret: true, exposed: false },
      { name: '대전차 미사일', weapon: 'atgm', offset: { x: -0.6, y: 2.4, z: 0.3 }, turret: false, exposed: false },
      { name: '승객 1', weapon: null, offset: { x: -0.6, y: 1.3, z: 1.8 }, turret: false, exposed: false },
      { name: '승객 2', weapon: null, offset: { x: 0.6, y: 1.3, z: 1.8 }, turret: false, exposed: false },
      { name: '승객 3', weapon: null, offset: { x: 0, y: 1.3, z: 2.6 }, turret: false, exposed: false },
    ],
    respawn: 50,
    counter: 'smoke',
  },
  ltv: {
    type: 'ltv', name: '경전술차량', short: '경차량',
    desc: '빠르고 가벼운 4륜 전술차량. 지붕 중기관총으로 보병을 쓸어 내지만 장갑은 얇다.',
    hp: 400, speed: 26, reverse: 10, accel: 8,
    turn: 1.5, turretTurn: 2.4, air: false,
    size: { x: 2.4, y: 2.0, z: 5.0 },
    armor: { front: 1.0, side: 1.1, rear: 1.25, top: 1.1 },
    seats: [
      { name: '운전수', weapon: null, offset: { x: -0.5, y: 1.3, z: -0.3 }, turret: false, exposed: false },
      { name: '지붕 기관총', weapon: 'ltv_mg', offset: { x: 0, y: 2.2, z: 0.5 }, turret: true, exposed: true },
      { name: '승객 1', weapon: null, offset: { x: 0.5, y: 1.3, z: -0.3 }, turret: false, exposed: false },
      { name: '승객 2', weapon: null, offset: { x: 0, y: 1.3, z: 1.2 }, turret: false, exposed: false },
    ],
    respawn: 40,
    counter: 'smoke',
  },
  heli: {
    type: 'heli', name: '공격 헬기', short: '헬기',
    desc: '로켓 포드와 기수 기관포를 단 2인승 공격 헬기. 조종사가 로켓을, 사수가 기관포를 맡는다. 대공 미사일에는 플레어로 맞선다.',
    hp: 600, speed: 45, reverse: 12, accel: 10,
    turn: 1.3, turretTurn: 2.2, air: true,
    size: { x: 2.8, y: 3.4, z: 13.5 },
    armor: { front: 0.9, side: 1.0, rear: 1.2, top: 1.1 },
    seats: [
      { name: '조종사 · 로켓', weapon: 'heli_rockets', offset: { x: 0, y: 1.9, z: -1.0 }, turret: false, exposed: false },
      { name: '사수 · 기관포', weapon: 'heli_gun', offset: { x: 0, y: 1.4, z: -2.6 }, turret: true, exposed: false },
    ],
    respawn: 60,
    counter: 'flare',
  },
};

export const VEHICLE_TYPES: VehicleType[] = ['mbt', 'ifv', 'ltv', 'heli'];
