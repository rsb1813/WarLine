// 병사 몸 치수와 판정 도우미 (공통 규약). 리드 외에는 수정 금지.
import type { Soldier, Stance, Vec3 } from '../types';
import { dirFrom, rayCapsule, raySphere } from '../math';

export const BODY = {
  radius: 0.34,
  /** 자세별 키 (충돌 캡슐 높이) */
  height: { stand: 1.8, crouch: 1.25, prone: 0.55 } as Record<Stance, number>,
  /** 자세별 눈높이 */
  eye: { stand: 1.62, crouch: 1.12, prone: 0.42 } as Record<Stance, number>,
  headR: 0.14,
  bodyR: 0.27,
};

/** 이동 속도 (m/s) */
export const SPEED = { walk: 4.2, sprint: 6.8, crouch: 2.4, prone: 1.0, ads: 2.6, slide: 9.0, jump: 4.8, gravity: 17 };

/** 눈 위치 (월드) */
export const eyePos = (s: Soldier): Vec3 => ({ x: s.pos.x, y: s.pos.y + s.eyeH, z: s.pos.z });

/** 지금 들고 있는 무기의 반동까지 더한 조준 방향 */
export function aimDir(s: Soldier): Vec3 {
  const w = s.weapons[s.cur];
  return dirFrom(s.yaw + (w ? w.kickY : 0), s.pitch + (w ? w.kickP : 0));
}

/** 머리 중심: 엎드리면 몸 앞으로 */
export function headCenter(s: Soldier): Vec3 {
  if (s.state === 'down' || s.stance === 'prone') {
    const f = 0.7;
    return { x: s.pos.x - Math.sin(s.yaw) * f, y: s.pos.y + 0.28, z: s.pos.z - Math.cos(s.yaw) * f };
  }
  return { x: s.pos.x, y: s.pos.y + s.eyeH + 0.06, z: s.pos.z };
}

/** 몸통 캡슐 (발 위 a 에서 어깨 b), 반지름 */
export function bodySegment(s: Soldier): [Vec3, Vec3, number] {
  if (s.state === 'down' || s.stance === 'prone') {
    const f = 0.55;
    return [
      { x: s.pos.x + Math.sin(s.yaw) * f, y: s.pos.y + 0.22, z: s.pos.z + Math.cos(s.yaw) * f },
      { x: s.pos.x - Math.sin(s.yaw) * f * 0.6, y: s.pos.y + 0.25, z: s.pos.z - Math.cos(s.yaw) * f * 0.6 },
      0.24,
    ];
  }
  const top = s.eyeH - 0.18;
  return [{ x: s.pos.x, y: s.pos.y + 0.3, z: s.pos.z }, { x: s.pos.x, y: s.pos.y + top, z: s.pos.z }, BODY.bodyR];
}

/** 광선과 병사 판정: 맞으면 t 와 머리 여부 */
export function raySoldier(s: Soldier, o: Vec3, d: Vec3, maxT: number): { t: number; head: boolean } | null {
  const h = raySphere(o, d, headCenter(s), BODY.headR);
  const [a, b, r] = bodySegment(s);
  const t = rayCapsule(o, d, a, b, r);
  let best: { t: number; head: boolean } | null = null;
  if (t >= 0 && t <= maxT) best = { t, head: false };
  if (h >= 0 && h <= maxT && (!best || h <= best.t + 0.05)) best = { t: h, head: true };
  return best;
}

/** 자세별 목표 눈높이 */
export const eyeFor = (st: Stance): number => BODY.eye[st];
