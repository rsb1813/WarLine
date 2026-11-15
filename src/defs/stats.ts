// 부착물을 반영한 실제 무기 수치 계산.
import { SLOT_IDS } from '../types';
import type { AttachmentDef, Attachments, ClassId, SlotId, StatMods, WeaponDef, WeaponStats } from '../types';
import { WEAPONS, PRIMARY_IDS } from './weapons';
import { ATTACHMENTS } from './attachments';
import { CLASSES } from './classes';

type ModKey = Exclude<keyof StatMods, 'magAdd'>;
const MUL_KEYS: ModKey[] = [
  'dmg', 'range', 'velocity', 'recoilV', 'recoilH', 'firstShot', 'recover', 'adsTime', 'hipSpread', 'adsSpread',
  'moveSpread', 'spreadPerShot', 'moveMul', 'reload', 'swap', 'headMul', 'sway', 'mag',
];

/** 숙련 보너스: 병과 signature 분류 무기를 들면 */
export const SIGNATURE_BONUS = { adsTime: 0.9, recoilV: 0.92 };

const weaponDef = (id: string): WeaponDef => WEAPONS[id] ?? WEAPONS[PRIMARY_IDS[0]];

/** 그 무기의 한 슬롯에서 실제로 쓰이는 부착물 id (잘못된 값이면 기본값, 슬롯이 없으면 null) */
export function resolveAttachment(weaponId: string, slot: SlotId, id: string | undefined): string | null {
  const def = weaponDef(weaponId);
  const allowed = def.slots[slot];
  if (!allowed || allowed.length === 0) return null;
  if (id && allowed.includes(id) && ATTACHMENTS[id] && ATTACHMENTS[id].slot === slot) return id;
  return allowed[0];
}

/** 슬롯마다 기본 부착물(slots[slot][0]) */
export function defaultAttachments(weaponId: string): Attachments {
  const def = weaponDef(weaponId);
  const out: Attachments = {};
  for (const slot of SLOT_IDS) {
    const allowed = def.slots[slot];
    if (allowed && allowed.length > 0) out[slot] = allowed[0];
  }
  return out;
}

/** 빈 슬롯·잘못된 id 를 기본값으로 채운 완전한 부착물 목록 */
export function normalizeAttachments(weaponId: string, att: Attachments | null | undefined): Attachments {
  const out: Attachments = {};
  for (const slot of SLOT_IDS) {
    const id = resolveAttachment(weaponId, slot, att ? att[slot] : undefined);
    if (id) out[slot] = id;
  }
  return out;
}

/** 그 무기 한 슬롯에 달 수 있는 부착물 정의 목록 (첫 번째가 기본값) */
export function slotOptions(weaponId: string, slot: SlotId): AttachmentDef[] {
  const allowed = weaponDef(weaponId).slots[slot];
  if (!allowed) return [];
  return allowed.map((id) => ATTACHMENTS[id]).filter((a): a is AttachmentDef => !!a);
}

const r2 = (x: number): number => Math.round(x * 100) / 100;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export function computeStats(weaponId: string, att: Attachments, cls?: ClassId): WeaponStats {
  const def = weaponDef(weaponId);
  const m: Record<ModKey, number> = {
    dmg: 1, range: 1, velocity: 1, recoilV: 1, recoilH: 1, firstShot: 1, recover: 1, adsTime: 1, hipSpread: 1, adsSpread: 1,
    moveSpread: 1, spreadPerShot: 1, moveMul: 1, reload: 1, swap: 1, headMul: 1, sway: 1, mag: 1,
  };
  let magAdd = 0;
  let zoom = 1;
  let reticle: WeaponStats['reticle'] = 'iron';
  let suppressed = false, laser = false, flashlight = false, bipod = false;
  let ammoKind: WeaponStats['ammoKind'] = 'fmj';
  let slug = false;

  for (const slot of SLOT_IDS) {
    const id = resolveAttachment(def.id, slot, att ? att[slot] : undefined);
    if (!id) continue;
    const a = ATTACHMENTS[id];
    if (!a) continue;
    for (const k of MUL_KEYS) {
      const v = a.mods[k];
      if (typeof v === 'number') m[k] *= v;
    }
    if (typeof a.mods.magAdd === 'number') magAdd += a.mods.magAdd;
    if (slot === 'optic') {
      zoom = a.zoom ?? 1;
      reticle = a.reticle ?? 'iron';
    }
    if (a.suppressed) suppressed = true;
    if (a.laser) laser = true;
    if (a.flashlight) flashlight = true;
    if (a.bipod) bipod = true;
    if (slot === 'ammo') {
      ammoKind = a.ammoKind ?? 'fmj';
      if (a.id === 'slug') slug = true;
    }
  }

  let pellets = def.pellets ?? 1;
  let dmgNear = def.dmgNear * m.dmg;
  let dmgFar = def.dmgFar * m.dmg;
  let rangeNear = def.rangeNear * m.range;
  let rangeFar = def.rangeFar * m.range;
  let headMul = def.headMul * m.headMul;
  let hipSpread = def.hipSpread * m.hipSpread;
  let adsSpread = def.adsSpread * m.adsSpread;

  // 슬러그: 산탄 여러 알 대신 큰 탄두 하나
  if (slug && pellets > 1) {
    const total = def.dmgNear * pellets;
    dmgNear = total * 0.55 * m.dmg;
    dmgFar = dmgNear * 0.55;
    rangeNear = Math.max(def.rangeNear * 2.2, 22) * m.range;
    rangeFar = def.rangeFar * 2 * m.range;
    headMul = 1.8 * m.headMul;
    hipSpread *= 0.55;
    adsSpread = Math.min(adsSpread * 0.15, 0.35);
    pellets = 1;
  }

  const mag = Math.max(1, Math.round(def.mag * m.mag + magAdd));
  // 예비탄: 탄창 수를 대략 유지하되 탄창이 커지면 탄창 수는 조금 준다
  const reserve = Math.max(mag * 2, Math.round(def.reserve * (0.5 + 0.5 * (mag / def.mag))));

  let adsTime = def.adsTime * m.adsTime;
  let recoilV = def.recoilV * m.recoilV;
  if (cls && CLASSES[cls] && CLASSES[cls].signature.includes(def.cat)) {
    adsTime *= SIGNATURE_BONUS.adsTime;
    recoilV *= SIGNATURE_BONUS.recoilV;
  }

  if (rangeFar < rangeNear + 1) rangeFar = rangeNear + 1;

  return {
    id: def.id, name: def.name, cat: def.cat,
    modes: def.modes.slice(),
    burst: def.burst ?? (def.modes.includes('burst') ? 3 : 1),
    rpm: def.rpm,
    dmgNear: r2(dmgNear), dmgFar: r2(dmgFar),
    rangeNear: r2(rangeNear), rangeFar: r2(rangeFar),
    headMul: r3(headMul),
    velocity: Math.round(def.velocity * m.velocity),
    pellets,
    mag, reserve,
    reload: r3(def.reload * m.reload), reloadEmpty: r3(def.reloadEmpty * m.reload),
    adsTime: r3(adsTime), swap: r3(def.swap * m.swap),
    hipSpread: r3(hipSpread), adsSpread: r3(adsSpread),
    moveSpread: r3(def.moveSpread * m.moveSpread),
    spreadPerShot: r3(def.spreadPerShot * m.spreadPerShot),
    spreadMax: r3(def.spreadMax * Math.sqrt(m.spreadPerShot)),
    recoilV: r3(recoilV), recoilH: r3(def.recoilH * m.recoilH),
    firstShot: r3(def.firstShot * m.firstShot),
    recoilRecover: r3(def.recoilRecover * m.recover),
    moveMul: r3(def.moveMul * m.moveMul),
    sway: r3(m.sway),
    zoom, reticle,
    suppressed, laser, flashlight, bipod,
    ammoKind,
  };
}

/**
 * 로드아웃 화면 수치 막대용 0..1 점수 (클수록 좋음). 분류 사이 비교가 되도록 고정 기준으로 나눈다.
 * power: 근거리 한 발 총피해, rate: 연사, range: 사거리, control: 반동 제어, handling: 정조준·교체, mobility: 이동, accuracy: 정조준 퍼짐
 */
export function statBars(st: WeaponStats): { power: number; rate: number; range: number; control: number; handling: number; mobility: number; accuracy: number } {
  const cl = (x: number): number => Math.max(0, Math.min(1, x));
  return {
    power: cl((st.dmgNear * st.pellets) / 150),
    rate: cl(st.rpm / 1100),
    range: cl(st.rangeFar / 200),
    control: cl(1 - (st.recoilV + st.recoilH * 0.8) / 2.2),
    handling: cl(1 - (st.adsTime - 0.12) / 0.55),
    mobility: cl((st.moveMul - 0.82) / 0.28),
    accuracy: cl(1 - st.adsSpread / 0.7),
  };
}
